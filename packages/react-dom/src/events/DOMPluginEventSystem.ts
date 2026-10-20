/**
 * @file 事件插件系统：委托监听 + 事件抽取 + 分发
 * @description 对照官方 packages/react-dom/src/events/DOMPluginEventSystem.js。
 * 官方按插件（SimpleEventPlugin/EnterLeaveEventPlugin/ChangeEventPlugin/...）拆分
 * extractEvents，本项目内联 SimpleEventPlugin 和 ChangeEventPlugin 的常用客户端路径。
 * React 18.3.1 对应代码位于 packages/react-dom/src/events。
 *
 * 跳过的官方逻辑：
 * - Portal 场景下沿 fiber 树向上找匹配 rootContainer 的祖先重映射（本项目无 Portal）
 * - findInstanceBlockingEvent 相关的 hydration 阻塞重放（本项目无 hydrate）
 * - legacyFBSupport / non-delegated events / passive touch 特殊处理
 * - batchedUpdates 包裹分发：ensureRootIsScheduled 已经是"同 lane 重复调用早退 +
 *   SyncLane 走微任务统一 flush"，同一事件回调内的多次 setState 天然只触发一次 commit，
 *   不需要额外的 BatchedContext 包裹
 */

import { flushSyncCallbacks } from "react-reconciler/src/ReactFiberWorkLoop";
import { setDefaultValue } from "../client/ReactDOMInput";
import { updateValueIfChanged } from "../client/inputValueTracking";
import { restoreControlledState } from "../client/ReactDOMComponent";
import type { FiberNode } from "react-reconciler/src/ReactFiber";
import { HostComponent } from "react-reconciler/src/ReactWorkTags";

import type { DOMEventName } from "./DOMEventNames";
import { type EventSystemFlags, IS_CAPTURE_PHASE } from "./EventSystemFlags";
import { allNativeEvents } from "./EventRegistry";
import {
  topLevelEventsToReactNames,
  registerSimpleEvents,
} from "./DOMEventProperties";
import getEventTarget from "./getEventTarget";
import getListener from "./getListener";
import { createEventListenerWrapperWithPriority } from "./ReactDOMEventListener";
import {
  SyntheticEvent,
  SyntheticMouseEvent,
  SyntheticKeyboardEvent,
  SyntheticFocusEvent,
  type BaseSyntheticEvent,
} from "./SyntheticEvent";

// 对照官方顶层副作用 SimpleEventPlugin.registerEvents()：模块加载时把精简后的事件表
// 注册进 allNativeEvents/topLevelEventsToReactNames，供 listenToAllSupportedEvents 使用
registerSimpleEvents();

interface DispatchListener {
  instance: FiberNode | null;
  listener: (event: BaseSyntheticEvent) => void;
  currentTarget: EventTarget;
}

interface DispatchEntry {
  event: BaseSyntheticEvent;
  listeners: DispatchListener[];
}

type DispatchQueue = DispatchEntry[];

function getSyntheticEventCtor(domEventName: DOMEventName) {
  switch (domEventName) {
    case "keydown":
    case "keyup":
    case "keypress":
      return SyntheticKeyboardEvent;
    case "focusin":
    case "focusout":
      return SyntheticFocusEvent;
    case "click":
    case "dblclick":
    case "contextmenu":
    case "mousedown":
    case "mouseup":
    case "mousemove":
    case "mouseover":
    case "mouseout":
      return SyntheticMouseEvent;
    default:
      return SyntheticEvent;
  }
}

function createDispatchListener(
  instance: FiberNode | null,
  listener: (event: BaseSyntheticEvent) => void,
  currentTarget: EventTarget,
): DispatchListener {
  return { instance, listener, currentTarget };
}

/**
 * 沿 targetFiber 的 return 链向上（target → root 方向）收集挂了指定 registrationName
 * （如捕获阶段的 "onClickCapture" 或冒泡阶段的 "onClick"）的 HostComponent 监听器。
 * 对照官方 accumulateSinglePhaseListeners：root container 上 capture/bubble 是两个独立
 * 的原生监听器，同一次原生事件会触发两次 dispatchEvent 调用（各自带不同的 eventSystemFlags），
 * 每次只按 inCapturePhase 取其中一种 registrationName，不能在一次调用里同时收集两种——
 * 否则 onClick 和 onClickCapture 都会被执行两次。
 */
function accumulateSinglePhaseListeners(
  targetFiber: FiberNode | null,
  reactName: string,
  inCapturePhase: boolean,
): DispatchListener[] {
  const registrationName = inCapturePhase ? reactName + "Capture" : reactName;
  const listeners: DispatchListener[] = [];

  let instance: FiberNode | null = targetFiber;
  while (instance !== null) {
    const { stateNode, tag } = instance;
    if (tag === HostComponent && stateNode !== null) {
      const currentTarget = stateNode as EventTarget;
      const listener = getListener(instance, registrationName);
      if (listener != null) {
        // 统一 push，得到 target→root 顺序；捕获/冒泡的执行顺序差异交给
        // processDispatchQueueItemsInOrder 按 inCapturePhase 决定遍历方向
        listeners.push(
          createDispatchListener(instance, listener, currentTarget),
        );
      }
    }
    instance = instance.return;
  }
  return listeners;
}

/** 对照官方 SimpleEventPlugin.extractEvents：按 domEventName 选合成事件构造器，创建事件并收集监听器 */
function extractEvents(
  dispatchQueue: DispatchQueue,
  domEventName: DOMEventName,
  targetInst: FiberNode | null,
  nativeEvent: Event,
  nativeEventTarget: EventTarget | null,
  eventSystemFlags: EventSystemFlags,
): void {
  const reactName = topLevelEventsToReactNames.get(domEventName);
  if (reactName === undefined) {
    return;
  }

  let reactEventType: string = domEventName;
  if (domEventName === "focusin") {
    reactEventType = "focus";
  } else if (domEventName === "focusout") {
    reactEventType = "blur";
  }

  const SyntheticEventCtor = getSyntheticEventCtor(domEventName);
  const inCapturePhase = (eventSystemFlags & IS_CAPTURE_PHASE) !== 0;
  const listeners = accumulateSinglePhaseListeners(
    targetInst,
    reactName,
    inCapturePhase,
  );
  if (listeners.length > 0) {
    const event = new SyntheticEventCtor(
      reactName,
      reactEventType,
      targetInst,
      nativeEvent as unknown as Record<string, any>,
      nativeEventTarget,
    );
    dispatchQueue.push({ event, listeners });
  }
}

// 对应 18.3.1 ChangeEventPlugin.handleControlledInputBlur；本项目的插件入口合并在此文件。
function handleControlledInputBlur(node: HTMLInputElement): void {
  const state = (node as any)._wrapperState;
  if (state?.controlled && node.type === "number")
    setDefaultValue(node as any, "number", node.value);
}

// ChangeEventPlugin 主链路：文本 input/change、checkbox/radio click、select change。
function extractChangeEvent(
  queue: DispatchQueue,
  name: DOMEventName,
  inst: FiberNode | null,
  event: Event,
  target: EventTarget | null,
): void {
  if (!(target instanceof Element)) return;
  if (name === "focusout")
    handleControlledInputBlur(target as HTMLInputElement);
  const tag = target.nodeName;
  const type = (target as HTMLInputElement).type;
  const checkable =
    tag === "INPUT" && (type === "checkbox" || type === "radio");
  const nativeChange =
    (tag === "SELECT" || (tag === "INPUT" && type === "file")) &&
    name === "change";
  const textChange =
    (tag === "INPUT" || tag === "TEXTAREA") &&
    !checkable &&
    (name === "input" || name === "change");
  if (
    !nativeChange &&
    !(
      (textChange || (checkable && name === "click")) &&
      updateValueIfChanged(target)
    )
  )
    return;
  const capture = accumulateSinglePhaseListeners(
    inst,
    "onChange",
    true,
  ).reverse();
  const bubble = accumulateSinglePhaseListeners(inst, "onChange", false);
  const synthetic = new SyntheticEvent(
    "onChange",
    "change",
    inst,
    event as any,
    target,
  );
  queue.push({ event: synthetic, listeners: capture.concat(bubble) });
}

function executeDispatch(
  event: BaseSyntheticEvent,
  listener: (event: BaseSyntheticEvent) => void,
  currentTarget: EventTarget,
): void {
  event.currentTarget = currentTarget;
  try {
    listener(event);
  } catch (error) {
    // 对照官方 executeDispatch 的错误隔离语义：不吞掉监听器抛出的错误，异步抛给全局，不打断同批次
    // 其余监听器的执行（浏览器原生事件监听器之间也是这个语义）
    setTimeout(() => {
      throw error;
    });
  }
  event.currentTarget = null;
}

function processDispatchQueueItemsInOrder(
  event: BaseSyntheticEvent,
  dispatchListeners: DispatchListener[],
  inCapturePhase: boolean,
): void {
  if (inCapturePhase) {
    for (let i = dispatchListeners.length - 1; i >= 0; i--) {
      const { listener, currentTarget } = dispatchListeners[i];
      if (event.isPropagationStopped()) {
        return;
      }
      executeDispatch(event, listener, currentTarget);
    }
  } else {
    for (let i = 0; i < dispatchListeners.length; i++) {
      const { listener, currentTarget } = dispatchListeners[i];
      if (event.isPropagationStopped()) {
        return;
      }
      executeDispatch(event, listener, currentTarget);
    }
  }
}

function processDispatchQueue(
  dispatchQueue: DispatchQueue,
  eventSystemFlags: EventSystemFlags,
): void {
  const inCapturePhase = (eventSystemFlags & IS_CAPTURE_PHASE) !== 0;
  for (let i = 0; i < dispatchQueue.length; i++) {
    const { event, listeners } = dispatchQueue[i];
    processDispatchQueueItemsInOrder(event, listeners, inCapturePhase);
  }
}

/**
 * 事件分发的入口，由 ReactDOMEventListener 的 dispatchEvent 调用
 * 对照官方 dispatchEventForPluginEventSystem，跳过 Portal 祖先重映射和 legacyFBSupport 分支，
 * 也不用 batchedUpdates 包裹（原因见文件头注释）
 */
export function dispatchEventForPluginEventSystem(
  domEventName: DOMEventName,
  eventSystemFlags: EventSystemFlags,
  nativeEvent: Event,
  targetInst: FiberNode | null,
  // Portal 场景的祖先重映射需要用到 targetContainer，本项目无 Portal，参数保留签名对齐但不消费
  _targetContainer: EventTarget,
): void {
  const nativeEventTarget = getEventTarget(nativeEvent);
  const dispatchQueue: DispatchQueue = [];
  extractEvents(
    dispatchQueue,
    domEventName,
    targetInst,
    nativeEvent,
    nativeEventTarget,
    eventSystemFlags,
  );
  const bubble = (eventSystemFlags & IS_CAPTURE_PHASE) === 0;
  if (bubble)
    extractChangeEvent(
      dispatchQueue,
      domEventName,
      targetInst,
      nativeEvent,
      nativeEventTarget,
    );
  try {
    processDispatchQueue(dispatchQueue, eventSystemFlags);
  } finally {
    if (bubble) {
      // 先提交事件内更新，再恢复受控值；没有 setState 的受控输入也必须恢复。
      flushSyncCallbacks();
      // 对应 ChangeEventPlugin.createAndAccumulateChangeEvent → enqueueStateRestore。
      // focusout 只同步 number 的 defaultValue，不应再按受控 props 覆写该属性。
      if (
        nativeEventTarget instanceof Element &&
        dispatchQueue.some(({ event }) => event._reactName === "onChange")
      )
        restoreControlledState(nativeEventTarget);
    }
  }
}

function addTrappedEventListener(
  targetContainer: EventTarget,
  domEventName: DOMEventName,
  isCapturePhaseListener: boolean,
): void {
  const eventSystemFlags: EventSystemFlags = isCapturePhaseListener
    ? IS_CAPTURE_PHASE
    : 0;
  const listener = createEventListenerWrapperWithPriority(
    targetContainer,
    domEventName,
    eventSystemFlags,
  );
  targetContainer.addEventListener(
    domEventName,
    listener,
    isCapturePhaseListener,
  );
}

const listeningMarker = "__reactListening";

/**
 * 在根容器上无差别注册 allNativeEvents 里的每个事件（capture + bubble 各一个），
 * 用 _reactListening 标记去重。对照官方 listenToAllSupportedEvents，跳过
 * selectionchange 单独挂document、non-delegated events 单独处理的分支。
 */
export function listenToAllSupportedEvents(
  rootContainerElement: EventTarget,
): void {
  const marked = rootContainerElement as unknown as Record<string, boolean>;
  if (marked[listeningMarker]) {
    return;
  }
  marked[listeningMarker] = true;

  allNativeEvents.forEach((domEventName) => {
    addTrappedEventListener(rootContainerElement, domEventName, false);
    addTrappedEventListener(rootContainerElement, domEventName, true);
  });
}
