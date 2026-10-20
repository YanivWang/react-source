/**
 * @file 原生事件监听器包装 + 事件优先级映射
 * @description 对照官方 packages/react-dom/src/events/ReactDOMEventListener.js。
 * 官方 dispatchEvent 还有 findInstanceBlockingEvent（hydration/Suspense 挂起时排队重放）
 * 分支，本项目无 hydrate（Phase 10 明确不做），直接分发，不做阻塞判断。getEventPriority
 * 的 switch 只覆盖 DOMEventNames.ts 里精简后的事件子集，也不做 'message' 事件的
 * Scheduler 优先级转换分支（本项目事件系统不监听 message）。
 */

import ReactSharedInternals from "shared/ReactSharedInternals";
import {
  DiscreteEventPriority,
  ContinuousEventPriority,
  DefaultEventPriority,
  getCurrentUpdatePriority,
  setCurrentUpdatePriority,
  type EventPriority,
} from "react-reconciler/src/ReactEventPriorities";
import type { DOMEventName } from "./DOMEventNames";
import type { EventSystemFlags } from "./EventSystemFlags";
import { dispatchEventForPluginEventSystem } from "./DOMPluginEventSystem";
import getEventTarget from "./getEventTarget";
import { getClosestInstanceFromNode } from "../client/ReactDOMComponentTree";

const ReactCurrentBatchConfig = ReactSharedInternals.ReactCurrentBatchConfig;

export function createEventListenerWrapperWithPriority(
  targetContainer: EventTarget,
  domEventName: DOMEventName,
  eventSystemFlags: EventSystemFlags,
): (nativeEvent: Event) => void {
  const eventPriority = getEventPriority(domEventName);
  let listenerWrapper: typeof dispatchDiscreteEvent;
  switch (eventPriority) {
    case DiscreteEventPriority:
      listenerWrapper = dispatchDiscreteEvent;
      break;
    case ContinuousEventPriority:
      listenerWrapper = dispatchContinuousEvent;
      break;
    default:
      listenerWrapper = dispatchEvent;
      break;
  }
  return listenerWrapper.bind(
    null,
    domEventName,
    eventSystemFlags,
    targetContainer,
  );
}

function dispatchDiscreteEvent(
  domEventName: DOMEventName,
  eventSystemFlags: EventSystemFlags,
  container: EventTarget,
  nativeEvent: Event,
): void {
  const prevTransition = ReactCurrentBatchConfig.transition;
  ReactCurrentBatchConfig.transition = null;
  const previousPriority = getCurrentUpdatePriority();
  try {
    setCurrentUpdatePriority(DiscreteEventPriority);
    dispatchEvent(domEventName, eventSystemFlags, container, nativeEvent);
  } finally {
    setCurrentUpdatePriority(previousPriority);
    ReactCurrentBatchConfig.transition = prevTransition;
  }
}

function dispatchContinuousEvent(
  domEventName: DOMEventName,
  eventSystemFlags: EventSystemFlags,
  container: EventTarget,
  nativeEvent: Event,
): void {
  const prevTransition = ReactCurrentBatchConfig.transition;
  ReactCurrentBatchConfig.transition = null;
  const previousPriority = getCurrentUpdatePriority();
  try {
    setCurrentUpdatePriority(ContinuousEventPriority);
    dispatchEvent(domEventName, eventSystemFlags, container, nativeEvent);
  } finally {
    setCurrentUpdatePriority(previousPriority);
    ReactCurrentBatchConfig.transition = prevTransition;
  }
}

// 对照官方 dispatchEvent：官方先调 findInstanceBlockingEvent 判断事件是否被挂起的
// hydration 边界阻塞（阻塞时排队重放）。本项目无 hydrate，直接从原生事件的 target 反查
// 最近的 Fiber，跳过阻塞判断分支。
export function dispatchEvent(
  domEventName: DOMEventName,
  eventSystemFlags: EventSystemFlags,
  targetContainer: EventTarget,
  nativeEvent: Event,
): void {
  const nativeEventTarget = getEventTarget(nativeEvent);
  const targetInst = getClosestInstanceFromNode(nativeEventTarget as Node);
  dispatchEventForPluginEventSystem(
    domEventName,
    eventSystemFlags,
    nativeEvent,
    targetInst,
    targetContainer,
  );
}

export function getEventPriority(domEventName: DOMEventName): EventPriority {
  switch (domEventName) {
    case "click":
    case "dblclick":
    case "contextmenu":
    case "mousedown":
    case "mouseup":
    case "keydown":
    case "keyup":
    case "keypress":
    case "focusin":
    case "focusout":
    case "input":
    case "change":
    case "submit":
      return DiscreteEventPriority;
    case "mousemove":
    case "mouseover":
    case "mouseout":
      return ContinuousEventPriority;
    default:
      return DefaultEventPriority;
  }
}
