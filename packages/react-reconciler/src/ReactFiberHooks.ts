/**
 * @file Hooks 实现（Hook 链表 + Dispatcher 切换 + useState/useReducer）
 * @description 对照官方 packages/react-reconciler/src/ReactFiberHooks.new.js 的核心子集：
 * Hook 以链表形式挂在 fiber.memoizedState 上，renderWithHooks 在函数组件渲染前根据
 * mount/update 切换 ReactCurrentDispatcher.current，组件体内调用的 useState/useReducer
 * 通过这个 dispatcher 找到对应的 mountXxx/updateXxx 实现。
 * 当前落地 useState/useReducer/useRef/useMemo/useCallback/useEffect/useLayoutEffect/
 * useTransition/useDeferredValue/useSyncExternalStore；eagerState dispatch 侧优化见
 * Phase 9.4，useId 见 Phase 9，均按官方结构逐步补齐。
 */

import { StrictLegacyMode, StrictEffectsMode } from "./ReactTypeOfMode";
import ReactSharedInternals from "shared/ReactSharedInternals";
import is from "shared/objectIs";

import type { FiberNode } from "./ReactFiber";
import type { FiberRootNode } from "./ReactFiberRoot";
import {
  Passive as PassiveEffect,
  PassiveStatic as PassiveStaticEffect,
  LayoutStatic as LayoutStaticEffect,
  MountLayoutDev,
  MountPassiveDev,
  StoreConsistency,
  Update as UpdateEffect,
} from "./ReactFiberFlags";
import {
  NoLanes,
  removeLanes,
  isSubsetOfLanes,
  isTransitionLane,
  markRootEntangled,
  includesBlockingLane,
  mergeLanes,
  NoLane,
  SyncLane,
  claimNextTransitionLane,
  includesOnlyNonUrgentLanes,
  type Lane,
  type Lanes,
} from "./ReactFiberLane";
import { markWorkInProgressReceivedUpdate } from "./ReactFiberBeginWork";
import {
  enqueueConcurrentHookUpdate,
  enqueueConcurrentHookUpdateAndEagerlyBailout,
  enqueueConcurrentRenderForLane,
} from "./ReactFiberConcurrentUpdates";
import {
  HasEffect as HookHasEffect,
  Insertion as HookInsertion,
  Layout as HookLayout,
  Passive as HookPassive,
  type HookFlags,
} from "./ReactHookEffectTags";
import {
  getWorkInProgressRoot,
  markSkippedUpdateLanes,
  requestEventTime,
  requestUpdateLane,
  scheduleUpdateOnFiber,
} from "./ReactFiberWorkLoop";
import {
  ContinuousEventPriority,
  getCurrentUpdatePriority,
  higherEventPriority,
  setCurrentUpdatePriority,
} from "./ReactEventPriorities";
import { readContext } from "./ReactFiberNewContext";

const ReactCurrentDispatcher = ReactSharedInternals.ReactCurrentDispatcher;
const ReactCurrentBatchConfig = ReactSharedInternals.ReactCurrentBatchConfig;

type BasicStateAction<S> = ((prevState: S) => S) | S;
type Dispatch<A> = (action: A) => void;

export interface Update<S, A> {
  lane: Lane;
  action: A;
  hasEagerState: boolean;
  eagerState: S | null;
  next: Update<S, A>;
}

export interface UpdateQueue<S, A> {
  pending: Update<S, A> | null;
  lanes: Lanes;
  dispatch: Dispatch<A> | null;
  lastRenderedReducer: ((state: S, action: A) => S) | null;
  lastRenderedState: S | null;
}

export interface Hook {
  memoizedState: any;
  baseState: any;
  baseQueue: Update<any, any> | null;
  queue: UpdateQueue<any, any> | null;
  next: Hook | null;
}

// 本次渲染的 lanes / 正在渲染的 fiber（渲染前由 renderWithHooks 设置，渲染结束清空）
let renderLanes: Lanes = NoLanes;
let currentlyRenderingFiber: FiberNode = null as any;

// current 树的 hook 链表指针 / workInProgress 树正在构建的 hook 链表指针
let currentHook: Hook | null = null;
let workInProgressHook: Hook | null = null;
let didScheduleRenderPhaseUpdate = false;
let didScheduleRenderPhaseUpdateDuringThisPass = false;
const RE_RENDER_LIMIT = 25;

// 对照官方 basicStateReducer：useState 是 useReducer 的特例，action 是函数则调用（reducer 形式），
// 否则直接作为新 state（对象/基础类型形式）
function basicStateReducer<S>(state: S, action: BasicStateAction<S>): S {
  return typeof action === "function"
    ? (action as (prevState: S) => S)(state)
    : action;
}

function mountWorkInProgressHook(): Hook {
  const hook: Hook = {
    memoizedState: null,
    baseState: null,
    baseQueue: null,
    queue: null,
    next: null,
  };

  if (workInProgressHook === null) {
    // 链表第一个 hook，挂到 fiber.memoizedState
    currentlyRenderingFiber.memoizedState = workInProgressHook = hook;
  } else {
    workInProgressHook = workInProgressHook.next = hook;
  }
  return workInProgressHook;
}

// 对照官方 updateWorkInProgressHook：按调用顺序把 workInProgress 的 hook 链表与 current 的
// hook 链表一一对应地往前走一格。链表顺序即调用顺序，这也是"不能在条件语句里调 hook"的原因——
// 顺序错位就会读到错误的 hook 状态。
function updateWorkInProgressHook(): Hook {
  let nextCurrentHook: Hook | null;
  if (currentHook === null) {
    const current = currentlyRenderingFiber.alternate;
    nextCurrentHook = current !== null ? current.memoizedState : null;
  } else {
    nextCurrentHook = currentHook.next;
  }

  let nextWorkInProgressHook: Hook | null;
  if (workInProgressHook === null) {
    nextWorkInProgressHook = currentlyRenderingFiber.memoizedState;
  } else {
    nextWorkInProgressHook = workInProgressHook.next;
  }

  if (nextWorkInProgressHook !== null) {
    // 重入（如渲染中途重新进入同一函数组件的多次调用），复用已构建的 hook
    workInProgressHook = nextWorkInProgressHook;
    currentHook = nextCurrentHook;
  } else {
    // 正常路径：从 current 克隆一个新 hook 节点
    if (nextCurrentHook === null) {
      throw new Error("Rendered more hooks than during the previous render.");
    }
    currentHook = nextCurrentHook;

    const newHook: Hook = {
      memoizedState: currentHook.memoizedState,
      baseState: currentHook.baseState,
      baseQueue: currentHook.baseQueue,
      queue: currentHook.queue,
      next: null,
    };

    if (workInProgressHook === null) {
      currentlyRenderingFiber.memoizedState = workInProgressHook = newHook;
    } else {
      workInProgressHook = workInProgressHook.next = newHook;
    }
  }
  return workInProgressHook;
}

function mountState<S>(
  initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  const hook = mountWorkInProgressHook();
  if (typeof initialState === "function") {
    initialState = (initialState as () => S)();
  }
  hook.memoizedState = hook.baseState = initialState;

  const queue: UpdateQueue<S, BasicStateAction<S>> = {
    pending: null,
    lanes: NoLanes,
    dispatch: null,
    lastRenderedReducer: basicStateReducer,
    lastRenderedState: initialState,
  };
  hook.queue = queue;

  // bind 对泛型函数的类型推导有已知局限（TS 会把 S/A 实例化成 unknown 再检查），
  // 官方源码在这里同样绕不开、直接 as any 兜底
  const dispatch = (queue.dispatch = dispatchSetState.bind(
    null,
    currentlyRenderingFiber,
    queue as any,
  ) as Dispatch<BasicStateAction<S>>);

  return [hook.memoizedState, dispatch];
}

function updateState<S>(
  _initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  return updateReducer(basicStateReducer);
}

function mountReducer<S, I, A>(
  reducer: (state: S, action: A) => S,
  initialArg: I,
  init?: (arg: I) => S,
): [S, Dispatch<A>] {
  const hook = mountWorkInProgressHook();
  const initialState =
    init !== undefined ? init(initialArg) : (initialArg as unknown as S);
  hook.memoizedState = hook.baseState = initialState;

  const queue: UpdateQueue<S, A> = {
    pending: null,
    lanes: NoLanes,
    dispatch: null,
    lastRenderedReducer: reducer,
    lastRenderedState: initialState,
  };
  hook.queue = queue;

  const dispatch = (queue.dispatch = dispatchReducerAction.bind(
    null,
    currentlyRenderingFiber,
    queue as any,
  ) as Dispatch<A>);

  return [hook.memoizedState, dispatch];
}

// 对照 React 18.3.1 updateReducer：把 pending 循环链表解环、并入 baseQueue，
// 按 renderLanes 逐条重放——优先级不足的 update 被跳过并保留在新的 baseQueue 里
// （baseState 停在第一条被跳过的 update 之前），供下次高优先级渲染完成后重放，
// 与 ReactFiberClassUpdateQueue.processUpdateQueue 的跳过/重放逻辑同源。
function updateReducer<S, A>(
  reducer: (state: S, action: A) => S,
): [S, Dispatch<A>] {
  const hook = updateWorkInProgressHook();
  const queue = hook.queue as UpdateQueue<S, A> | null;
  if (queue === null) {
    throw new Error(
      "Should have a queue. You are likely calling Hooks conditionally, which is not allowed.",
    );
  }

  queue.lastRenderedReducer = reducer;

  let baseQueue = hook.baseQueue as Update<S, A> | null;
  const pendingQueue = queue.pending;
  if (pendingQueue !== null) {
    // 把本次渲染前新收到的 pending update 并入 baseQueue
    if (baseQueue !== null) {
      const baseFirst = baseQueue.next;
      const pendingFirst = pendingQueue.next;
      baseQueue.next = pendingFirst;
      pendingQueue.next = baseFirst;
    }
    baseQueue = pendingQueue;
    hook.baseQueue = baseQueue;
    // current 也保留这批共享更新：并发 render 被丢弃后，重启仍能重放它们。
    if (currentHook !== null) currentHook.baseQueue = baseQueue;
    queue.pending = null;
  }

  if (baseQueue !== null) {
    const first = baseQueue.next;
    let newState = hook.baseState;

    let newBaseState: S | null = null;
    let newBaseQueueFirst: Update<S, A> | null = null;
    let newBaseQueueLast: Update<S, A> | null = null;
    let update: Update<S, A> = first;

    do {
      const updateLane = update.lane;
      if (!isSubsetOfLanes(renderLanes, updateLane)) {
        // 优先级不足：跳过，克隆进新的 baseQueue 留待后续高优先级渲染重放
        const clone: Update<S, A> = {
          lane: updateLane,
          action: update.action,
          hasEagerState: update.hasEagerState,
          eagerState: update.eagerState,
          next: null as any,
        };
        if (newBaseQueueLast === null) {
          newBaseQueueFirst = clone;
          newBaseQueueLast = clone;
          newBaseState = newState;
        } else {
          newBaseQueueLast.next = clone;
          newBaseQueueLast = clone;
        }
        currentlyRenderingFiber.lanes = mergeLanes(
          currentlyRenderingFiber.lanes,
          updateLane,
        );
        markSkippedUpdateLanes(updateLane);
      } else {
        // 优先级足够：处理该 update。若之前已经跳过过 update，本条也要克隆进 baseQueue
        // （lane 置 NoLane，保证重放时恒被消费）
        if (newBaseQueueLast !== null) {
          const clone: Update<S, A> = {
            lane: NoLane,
            action: update.action,
            hasEagerState: update.hasEagerState,
            eagerState: update.eagerState,
            next: null as any,
          };
          newBaseQueueLast.next = clone;
          newBaseQueueLast = clone;
        }
        // dispatchSetState 已经用当前 reducer 提前算过一次（eagerState），且入队时
        // reducer 没有变化，直接复用那次结果，不用再调一次 reducer（对照官方 hasEagerState 分支）
        if (update.hasEagerState) {
          newState = update.eagerState as S;
        } else {
          newState = reducer(newState, update.action);
        }
      }
      update = update.next;
    } while (update !== null && update !== first);

    if (newBaseQueueLast === null) {
      newBaseState = newState;
    } else {
      newBaseQueueLast.next = newBaseQueueFirst as Update<S, A>;
    }

    if (!is(newState, hook.memoizedState)) {
      markWorkInProgressReceivedUpdate();
    }

    hook.memoizedState = newState;
    hook.baseState = newBaseState;
    hook.baseQueue = newBaseQueueLast;
    queue.lastRenderedState = newState;
  }

  const dispatch = queue.dispatch as Dispatch<A>;
  return [hook.memoizedState, dispatch];
}

// 对照官方 mountRef：ref 对象只在 mount 时创建一次，之后每次渲染 updateRef 都原样返回，
// 不依赖 deps 比较——这也是 useRef 天然“跨渲染保持同一个引用”的由来。
function rerenderReducer<S, A>(
  reducer: (state: S, action: A) => S,
): [S, Dispatch<A>] {
  const hook = updateWorkInProgressHook();
  const queue = hook.queue as UpdateQueue<S, A> | null;
  if (queue === null)
    throw new Error(
      "Should have a queue. Hooks cannot be called conditionally.",
    );
  queue.lastRenderedReducer = reducer;
  let newState = hook.memoizedState;
  const pending = queue.pending;
  if (pending !== null) {
    queue.pending = null;
    const first = pending.next;
    let update = first;
    do {
      newState = reducer(newState, update.action);
      update = update.next;
    } while (update !== first);
    if (!is(newState, hook.memoizedState)) markWorkInProgressReceivedUpdate();
    hook.memoizedState = newState;
    if (hook.baseQueue === null) hook.baseState = newState;
    queue.lastRenderedState = newState;
  }
  return [newState, queue.dispatch as Dispatch<A>];
}

function rerenderState<S>(): [S, Dispatch<BasicStateAction<S>>] {
  return rerenderReducer(basicStateReducer);
}

function mountRef<T>(initialValue: T): { current: T } {
  const hook = mountWorkInProgressHook();
  const ref = { current: initialValue };
  hook.memoizedState = ref;
  return ref;
}

function updateRef<T>(_initialValue: T): { current: T } {
  const hook = updateWorkInProgressHook();
  return hook.memoizedState;
}

// 对照官方 mountId：官方还有 hydrate 分支（treeContext 按组件树路径编码 id，保证 SSR/CSR
// 一致），本项目没有 hydrateRoot，永远走不到那个分支，所以只落地客户端分支——用一个模块级
// 自增计数器生成 :{prefix}r{n}: 形式的 id（小写 r 前缀对照官方"客户端生成"的语义）。
// identifierPrefix 挂在 FiberRoot 上（createRoot 的 options.identifierPrefix），多个 root
// 共存时用它区分各自的 id 空间。
let globalClientIdCounter = 0;

function mountId(): string {
  const hook = mountWorkInProgressHook();
  const root = getWorkInProgressRoot() as FiberRootNode;
  const identifierPrefix = root.identifierPrefix;

  const globalClientId = globalClientIdCounter++;
  const id = ":" + identifierPrefix + "r" + globalClientId.toString(32) + ":";

  hook.memoizedState = id;
  return id;
}

function updateId(): string {
  const hook = updateWorkInProgressHook();
  return hook.memoizedState;
}

// 对照官方 areHookInputsEqual：逐项用 Object.is 比较新旧 deps，长度不同以官方实现为准——
// 不做额外校验（deps 数组长度变化本身就是误用），依赖数组为 null/undefined 视为每次都要重算。
function areHookInputsEqual(
  nextDeps: unknown[] | null,
  prevDeps: unknown[] | null,
): boolean {
  if (prevDeps === null) {
    return false;
  }
  for (let i = 0; i < prevDeps.length && i < nextDeps!.length; i++) {
    if (is(nextDeps![i], prevDeps[i])) {
      continue;
    }
    return false;
  }
  return true;
}

function mountMemo<T>(nextCreate: () => T, deps: unknown[] | void | null): T {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const nextValue = nextCreate();
  hook.memoizedState = [nextValue, nextDeps];
  return nextValue;
}

function updateMemo<T>(nextCreate: () => T, deps: unknown[] | void | null): T {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevState = hook.memoizedState;
  if (nextDeps !== null) {
    const prevDeps: unknown[] | null = prevState[1];
    if (areHookInputsEqual(nextDeps, prevDeps)) {
      return prevState[0];
    }
  }
  const nextValue = nextCreate();
  hook.memoizedState = [nextValue, nextDeps];
  return nextValue;
}

// 对照官方 mountCallback/updateCallback：useCallback 是 useMemo 的特例——缓存的是函数本身
// 而不是调用结果，所以不像 mountMemo 那样立刻执行 create。
function mountCallback<T>(callback: T, deps: unknown[] | void | null): T {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  hook.memoizedState = [callback, nextDeps];
  return callback;
}

function updateCallback<T>(callback: T, deps: unknown[] | void | null): T {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevState = hook.memoizedState;
  if (nextDeps !== null) {
    const prevDeps: unknown[] | null = prevState[1];
    if (areHookInputsEqual(nextDeps, prevDeps)) {
      return prevState[0];
    }
  }
  hook.memoizedState = [callback, nextDeps];
  return callback;
}

// 对照官方 Effect：单个副作用节点，create/destroy 是用户传入的函数，tag 标记 effect 类型
// （Layout/Passive）与本次渲染是否需要执行（HasEffect，由 deps 是否变化决定）。多个 effect
// 按调用顺序串成一个循环链表（不是 Hook 链表，而是挂在 fiber.updateQueue 上的独立链表——
// 这样 commit 阶段可以只遍历 effect，不用重新走一遍 Hook 链表）。
export interface Effect {
  tag: HookFlags;
  create: () => (() => void) | void;
  destroy: (() => void) | void;
  deps: unknown[] | null;
  next: Effect;
}

export interface FunctionComponentUpdateQueue {
  lastEffect: Effect | null;
  stores: Array<{ getSnapshot: () => unknown; value: unknown }> | null;
}

// 对照官方 pushEffect：把新 effect 接到 circular list 尾部（lastEffect.next 始终指向头部）。
function pushEffect(
  tag: HookFlags,
  create: () => (() => void) | void,
  destroy: (() => void) | void,
  deps: unknown[] | null,
): Effect {
  const effect: Effect = {
    tag,
    create,
    destroy,
    deps,
    next: null as any,
  };
  let componentUpdateQueue: FunctionComponentUpdateQueue | null =
    currentlyRenderingFiber.updateQueue;
  if (componentUpdateQueue === null) {
    componentUpdateQueue = { lastEffect: null, stores: null };
    currentlyRenderingFiber.updateQueue = componentUpdateQueue;
    componentUpdateQueue.lastEffect = effect.next = effect;
  } else {
    const lastEffect = componentUpdateQueue.lastEffect;
    if (lastEffect === null) {
      componentUpdateQueue.lastEffect = effect.next = effect;
    } else {
      const firstEffect = lastEffect.next;
      lastEffect.next = effect;
      effect.next = firstEffect;
      componentUpdateQueue.lastEffect = effect;
    }
  }
  return effect;
}

// 对照官方 mountEffectImpl：mount 时无论 deps 是什么，一定要执行一次 create，所以恒打
// HookHasEffect；fiberFlags（Update/Passive）标记到 fiber 上，供 commit 阶段的
// LayoutMask/PassiveMask 剪枝判断这棵子树要不要走 layout/passive 遍历。
function mountEffectImpl(
  fiberFlags: number,
  hookFlags: HookFlags,
  create: () => (() => void) | void,
  deps: unknown[] | void | null,
): void {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  currentlyRenderingFiber.flags |= fiberFlags;
  if (__DEV__ && (currentlyRenderingFiber.mode & StrictEffectsMode) !== 0) {
    if (hookFlags === HookPassive)
      currentlyRenderingFiber.flags |= MountPassiveDev;
    else if (hookFlags === HookLayout)
      currentlyRenderingFiber.flags |= MountLayoutDev;
  }
  hook.memoizedState = pushEffect(
    hookFlags | HookHasEffect,
    create,
    undefined,
    nextDeps,
  );
}

// 对照官方 updateEffectImpl：deps 不变时复用上一次的 destroy、不打 HookHasEffect（commit
// 阶段据此跳过这个 effect，达到"deps 不变就不重新执行"的效果）；deps 变化才重新打标记。
function updateEffectImpl(
  fiberFlags: number,
  hookFlags: HookFlags,
  create: () => (() => void) | void,
  deps: unknown[] | void | null,
): void {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  let destroy: Effect["destroy"] = undefined;
  // render-phase 重渲染必须与已提交的 effect 比较；首次挂载还没有 currentHook。
  if (currentHook !== null) {
    const prevEffect: Effect = currentHook.memoizedState;
    destroy = prevEffect.destroy;
    if (nextDeps !== null && areHookInputsEqual(nextDeps, prevEffect.deps)) {
      hook.memoizedState = pushEffect(hookFlags, create, destroy, nextDeps);
      return;
    }
  }

  currentlyRenderingFiber.flags |= fiberFlags;
  hook.memoizedState = pushEffect(
    hookFlags | HookHasEffect,
    create,
    destroy,
    nextDeps,
  );
}

function mountEffect(
  create: () => (() => void) | void,
  deps: unknown[] | void | null,
): void {
  mountEffectImpl(
    PassiveEffect | PassiveStaticEffect,
    HookPassive,
    create,
    deps,
  );
}

function updateEffect(
  create: () => (() => void) | void,
  deps: unknown[] | void | null,
): void {
  updateEffectImpl(PassiveEffect, HookPassive, create, deps);
}

function mountLayoutEffect(
  create: () => (() => void) | void,
  deps: unknown[] | void | null,
): void {
  mountEffectImpl(UpdateEffect | LayoutStaticEffect, HookLayout, create, deps);
}

function updateLayoutEffect(
  create: () => (() => void) | void,
  deps: unknown[] | void | null,
): void {
  updateEffectImpl(UpdateEffect, HookLayout, create, deps);
}

// 对照官方 mountInsertionEffect/updateInsertionEffect：与 useLayoutEffect 共用
// mountEffectImpl/updateEffectImpl，只是 hookFlags 换成 HookInsertion——commit 阶段靠这个
// tag 把它筛到 mutation 子阶段（DOM 变更前）执行，而不是 layout 子阶段。
function mountInsertionEffect(
  create: () => (() => void) | void,
  deps: unknown[] | void | null,
): void {
  mountEffectImpl(UpdateEffect, HookInsertion, create, deps);
}

function updateInsertionEffect(
  create: () => (() => void) | void,
  deps: unknown[] | void | null,
): void {
  updateEffectImpl(UpdateEffect, HookInsertion, create, deps);
}

// 对照官方 imperativeHandleEffect：真正执行 create() 拿到暴露对象，再挂到 ref 上；
// 返回的清理函数负责在下次 effect 重新执行前（deps 变化）或组件卸载时把 ref 清空，
// 与 useLayoutEffect 的 destroy 语义一致——只是这里的"副作用"是"设置 ref.current"而非任意逻辑。
function imperativeHandleEffect<T>(
  create: () => T,
  ref:
    { current: T | null } | ((instance: T | null) => void) | null | undefined,
): (() => void) | void {
  if (typeof ref === "function") {
    const refCallback = ref;
    const inst = create();
    refCallback(inst);
    return () => refCallback(null);
  } else if (ref !== null && ref !== undefined) {
    const refObject = ref;
    const inst = create();
    refObject.current = inst;
    return () => {
      refObject.current = null;
    };
  }
}

// 对照官方 mountImperativeHandle/updateImperativeHandle：与 useLayoutEffect 共用同一套
// mountEffectImpl/updateEffectImpl（hookFlags 用 HookLayout，effect 挂载/销毁时机与
// useLayoutEffect 完全一致——DOM 变更之后、浏览器绘制之前，保证父组件通过 ref 读到的
// 是已完成布局的最新实例）。deps 额外 concat 上 ref 本身：ref 引用变化（比如从一个
// callback ref 换成另一个）也要重新跑一次 create，否则旧 ref 上挂的是过期的暴露对象。
function mountImperativeHandle<T>(
  ref:
    { current: T | null } | ((instance: T | null) => void) | null | undefined,
  create: () => T,
  deps: unknown[] | void | null,
): void {
  const effectDeps =
    deps !== null && deps !== undefined ? deps.concat([ref]) : null;
  mountEffectImpl(
    UpdateEffect | LayoutStaticEffect,
    HookLayout,
    () => imperativeHandleEffect(create, ref),
    effectDeps,
  );
}

function updateImperativeHandle<T>(
  ref:
    { current: T | null } | ((instance: T | null) => void) | null | undefined,
  create: () => T,
  deps: unknown[] | void | null,
): void {
  const effectDeps =
    deps !== null && deps !== undefined ? deps.concat([ref]) : null;
  updateEffectImpl(
    UpdateEffect,
    HookLayout,
    () => imperativeHandleEffect(create, ref),
    effectDeps,
  );
}

// 对照 React 18.3.1 mountDeferredValue：mount 时直接以当前值渲染。
// 按 React 18.3.1：首次客户端渲染直接使用当前值。
function mountDeferredValue<T>(value: T): T {
  const hook = mountWorkInProgressHook();
  hook.memoizedState = value;
  return value;
}

function updateDeferredValue<T>(value: T): T {
  const hook = updateWorkInProgressHook();
  const prevValue: T = currentHook!.memoizedState;
  return updateDeferredValueImpl(hook, prevValue, value);
}

function rerenderDeferredValue<T>(value: T): T {
  const hook = updateWorkInProgressHook();
  if (currentHook === null) {
    hook.memoizedState = value;
    return value;
  }
  return updateDeferredValueImpl(hook, currentHook.memoizedState, value);
}

// 对照官方 updateDeferredValueImpl：值不变直接复用（Object.is 快速跳过）；值变化时，
// 若当前渲染不是"只包含非紧急 lane"（renderLanes 里有 Sync/Continuous/Default 等紧急更新），
// 说明这是一次紧急渲染，先保留旧值渲染、同时派生一条 deferred lane 稍后单独渲染新值；
// 否则（渲染本身已经是非紧急优先级，比如就是那条 deferred lane 触发的重渲染）直接用新值。
function updateDeferredValueImpl<T>(hook: Hook, prevValue: T, value: T): T {
  const shouldDeferValue = !includesOnlyNonUrgentLanes(renderLanes);
  if (shouldDeferValue) {
    if (!is(value, prevValue)) {
      const deferredLane = claimNextTransitionLane();
      currentlyRenderingFiber.lanes = mergeLanes(
        currentlyRenderingFiber.lanes,
        deferredLane,
      );
      markSkippedUpdateLanes(deferredLane);
      hook.baseState = true;
    }
    return prevValue;
  }

  if (hook.baseState) {
    hook.baseState = false;
    markWorkInProgressReceivedUpdate();
  }
  hook.memoizedState = value;
  return value;
}

// 对照官方 startTransition：callback() 内触发的更新要落到 TransitionLane，靠
// ReactCurrentBatchConfig.transition 非空这个标记传递给 requestUpdateLane。isPending 的
// true/false 两次 setState 分别在标记内外派发——setPending(true) 在提升到
// ContinuousEventPriority 之后但转场标记之前，走一条紧急优先级更新让"进入 pending"立刻反映到
// UI；setPending(false) 与 callback() 内部真正的状态更新一起落在 transition 标记内，
// 因此会被 requestUpdateLane 分配同一条 TransitionLane、同批次渲染。
// 对齐 React 18.3.1 的同步 scope；React 19 async Action 不在此版本范围。
function startTransition(
  setPending: Dispatch<BasicStateAction<boolean>>,
  callback: () => void,
): void {
  const previousPriority = getCurrentUpdatePriority();
  setCurrentUpdatePriority(
    higherEventPriority(previousPriority, ContinuousEventPriority),
  );
  setPending(true);

  const prevTransition = ReactCurrentBatchConfig.transition;
  ReactCurrentBatchConfig.transition = {};
  try {
    setPending(false);
    callback();
  } finally {
    setCurrentUpdatePriority(previousPriority);
    ReactCurrentBatchConfig.transition = prevTransition;
  }
}

function mountTransition(): [boolean, (callback: () => void) => void] {
  const [, setPending] = mountState(false);
  // start 函数只在 mount 时创建一次，deps 恒为空——官方同样只 bind 一次（fiber 引用不变）
  const start = startTransition.bind(null, setPending);
  const hook = mountWorkInProgressHook();
  hook.memoizedState = start;
  return [false, start];
}

function updateTransition(): [boolean, (callback: () => void) => void] {
  const [isPending] = updateState(false);
  const hook = updateWorkInProgressHook();
  const start = hook.memoizedState;
  return [isPending, start];
}

// 对照官方 StoreInstance：缓存"最近一次已知的 store 值 + 读取它的函数"，供 commit 后（
// updateStoreInstance）与 store 变化时（subscribeToStore 的 handleStoreChange）判断是否
// 需要强制重渲染。挂在 hook.queue 上（借用字段名，不是真正的更新队列）。
interface StoreInstance<T> {
  value: T;
  getSnapshot: () => T;
}

// 对照官方 mountSyncExternalStore：渲染时直接读一次 getSnapshot 作为这次渲染的值——这打破了
// hook 通常"只依赖参数/前一次状态"的规则，只是因为 store 的更新语义上恒为同步，读到的值
// 不会滞后于当前时刻。mountEffect 挂一个订阅 effect（commit 后才真正 subscribe），另外用
// pushEffect 直接挂一个不比较 deps 的 passive effect（updateStoreInstance），每次 commit 后
// 都同步 inst 的缓存字段，顺带检测 render→commit 这段窗口内 store 是否被改过。
// SSR/getServerSnapshot 不在范围内；客户端非阻塞渲染在提交前检查 StoreConsistency。
function pushStoreConsistencyCheck(
  fiber: FiberNode,
  getSnapshot: () => unknown,
  value: unknown,
): void {
  const root = getWorkInProgressRoot();
  if (root === null || includesBlockingLane(root, renderLanes)) return;
  fiber.flags |= StoreConsistency;
  let queue: FunctionComponentUpdateQueue | null = fiber.updateQueue;
  if (queue === null)
    fiber.updateQueue = queue = { lastEffect: null, stores: null };
  (queue.stores ??= []).push({ getSnapshot, value });
}

function mountSyncExternalStore<T>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T,
): T {
  const fiber = currentlyRenderingFiber;
  const hook = mountWorkInProgressHook();

  const nextSnapshot = getSnapshot();
  pushStoreConsistencyCheck(fiber, getSnapshot, nextSnapshot);
  hook.memoizedState = nextSnapshot;
  const inst: StoreInstance<T> = {
    value: nextSnapshot,
    getSnapshot,
  };
  hook.queue = inst as any;

  mountEffect(subscribeToStore.bind(null, fiber, inst, subscribe), [subscribe]);

  fiber.flags |= PassiveEffect;
  pushEffect(
    HookHasEffect | HookPassive,
    updateStoreInstance.bind(null, fiber, inst, nextSnapshot, getSnapshot),
    undefined,
    null,
  );

  return nextSnapshot;
}

// 对照官方 updateSyncExternalStore：每次渲染都重新读 getSnapshot，与上次渲染的值比较——
// 不同则 markWorkInProgressReceivedUpdate（这里没有 update 要处理，走的是"收到外部变化"
// 的通用路径，而不是 dispatch 一条 update）。storeChanged 还要考虑 subscribe/getSnapshot
// 函数引用本身是否变化：变了也要重新跑一次 updateStoreInstance 同步 inst 缓存。
function updateSyncExternalStore<T>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T,
): T {
  const fiber = currentlyRenderingFiber;
  const hook = updateWorkInProgressHook();

  const nextSnapshot = getSnapshot();
  pushStoreConsistencyCheck(fiber, getSnapshot, nextSnapshot);
  const prevSnapshot = (currentHook ?? hook).memoizedState;
  const snapshotChanged = !is(prevSnapshot, nextSnapshot);
  if (snapshotChanged) {
    hook.memoizedState = nextSnapshot;
    markWorkInProgressReceivedUpdate();
  }
  const inst: StoreInstance<T> = hook.queue as any;

  updateEffect(subscribeToStore.bind(null, fiber, inst, subscribe), [
    subscribe,
  ]);

  // 除了快照本身变化，subscribe 函数变了（上面 updateEffect 因 deps 变化重新打了
  // HookHasEffect）也要重新跑一次 updateStoreInstance——借读刚 push 的订阅 effect 的 tag
  // 判断，不用额外记录状态。
  const storeChanged =
    inst.getSnapshot !== getSnapshot ||
    snapshotChanged ||
    (workInProgressHook !== null &&
      (workInProgressHook.memoizedState.tag & HookHasEffect) !== 0);

  pushEffect(
    storeChanged ? HookHasEffect | HookPassive : HookPassive,
    updateStoreInstance.bind(null, fiber, inst, nextSnapshot, getSnapshot),
    undefined,
    null,
  );

  if (storeChanged) {
    fiber.flags |= PassiveEffect;
  }

  return nextSnapshot;
}

// 对照官方 updateStoreInstance：在 passive effect 阶段（commit 后）运行，先把 inst 的缓存
// 字段更新为本次渲染的值，再检查一次快照是否变化——render 与 commit 之间的空隙里，
// store 可能已经被一次同步的外部变更修改过，此时 subscribeToStore 还没接上（订阅本身也是
// 一个 effect），只能靠这里补一次检测。
function updateStoreInstance<T>(
  fiber: FiberNode,
  inst: StoreInstance<T>,
  nextSnapshot: T,
  getSnapshot: () => T,
): void {
  inst.value = nextSnapshot;
  inst.getSnapshot = getSnapshot;

  if (checkIfSnapshotChanged(inst)) {
    forceStoreRerender(fiber);
  }
}

// 对照官方 subscribeToStore：commit 后才真正调用外部 subscribe，返回值即取消订阅函数
// （直接作为这个 effect 的 destroy）。store 变化时先检查快照是否真的变了才强制重渲染，
// 避免 subscribe 实现里"值没变也通知一次"的场景引发多余渲染。
function subscribeToStore<T>(
  fiber: FiberNode,
  inst: StoreInstance<T>,
  subscribe: (onStoreChange: () => void) => () => void,
): (() => void) | void {
  const handleStoreChange = (): void => {
    if (checkIfSnapshotChanged(inst)) {
      forceStoreRerender(fiber);
    }
  };
  return subscribe(handleStoreChange);
}

function checkIfSnapshotChanged<T>(inst: StoreInstance<T>): boolean {
  const latestGetSnapshot = inst.getSnapshot;
  const prevValue = inst.value;
  try {
    const nextValue = latestGetSnapshot();
    return !is(prevValue, nextValue);
  } catch {
    return true;
  }
}

// 对照官方 forceStoreRerender：store 语义上要求订阅者立刻看到最新值，强制走 SyncLane
// 同步重渲染，不能被并发特性打断或推迟到更低优先级。
function forceStoreRerender(fiber: FiberNode): void {
  const root = enqueueConcurrentRenderForLane(fiber, SyncLane);
  if (root !== null) {
    scheduleUpdateOnFiber(root, fiber, SyncLane, requestEventTime());
  }
}

function dispatchReducerAction<S, A>(
  fiber: FiberNode,
  queue: UpdateQueue<S, A>,
  action: A,
): void {
  const lane = requestUpdateLane(fiber);

  const update: Update<S, A> = {
    lane,
    action,
    hasEagerState: false,
    eagerState: null,
    next: null as any,
  };
  if (isRenderPhaseUpdate(fiber)) {
    enqueueRenderPhaseUpdate(queue, update);
    return;
  }

  const root = enqueueConcurrentHookUpdate(fiber, queue, update, lane);
  if (root !== null) {
    scheduleUpdateOnFiber(root, fiber, lane, requestEventTime());
    entangleTransitionUpdate(root, queue, lane);
  }
}

// 对照官方 dispatchSetState：queue 当前为空（fiber/alternate 都没有待处理的 lanes）时，
// 用 lastRenderedReducer 提前对 lastRenderedState 算一次新值——如果算出来的新值和当前值
// Object.is 相等，说明这次更新不会改变任何东西，直接用 NoLane 入队（不冒泡、不调度）即可
// 完全跳过这次渲染；否则把提前算好的值缓存到 update.hasEagerState/eagerState 上，
// updateReducer 重放时如果 reducer 没变就能直接复用，省一次重复调用。
function dispatchSetState<S, A>(
  fiber: FiberNode,
  queue: UpdateQueue<S, A>,
  action: A,
): void {
  const lane = requestUpdateLane(fiber);

  const update: Update<S, A> = {
    lane,
    action,
    hasEagerState: false,
    eagerState: null,
    next: null as any,
  };
  if (isRenderPhaseUpdate(fiber)) {
    enqueueRenderPhaseUpdate(queue, update);
    return;
  }

  const alternate = fiber.alternate;
  if (
    fiber.lanes === NoLanes &&
    (alternate === null || alternate.lanes === NoLanes)
  ) {
    const lastRenderedReducer = queue.lastRenderedReducer;
    if (lastRenderedReducer !== null) {
      try {
        const currentState = queue.lastRenderedState as S;
        const eagerState = lastRenderedReducer(currentState, action);
        update.hasEagerState = true;
        update.eagerState = eagerState;
        if (is(eagerState, currentState)) {
          enqueueConcurrentHookUpdateAndEagerlyBailout(fiber, queue, update);
          return;
        }
      } catch {
        // 提前计算出错则忽略，留给正式渲染阶段再抛一次
      }
    }
  }

  const root = enqueueConcurrentHookUpdate(fiber, queue, update, lane);
  if (root !== null) {
    scheduleUpdateOnFiber(root, fiber, lane, requestEventTime());
    entangleTransitionUpdate(root, queue, lane);
  }
}

function entangleTransitionUpdate<S, A>(
  root: FiberRootNode,
  queue: UpdateQueue<S, A>,
  lane: Lane,
): void {
  if (isTransitionLane(lane)) {
    queue.lanes = (queue.lanes & root.pendingLanes) | lane;
    markRootEntangled(root, queue.lanes);
  }
}

function isRenderPhaseUpdate(fiber: FiberNode): boolean {
  return (
    fiber === currentlyRenderingFiber ||
    (fiber.alternate !== null && fiber.alternate === currentlyRenderingFiber)
  );
}

function enqueueRenderPhaseUpdate<S, A>(
  queue: UpdateQueue<S, A>,
  update: Update<S, A>,
): void {
  didScheduleRenderPhaseUpdate =
    didScheduleRenderPhaseUpdateDuringThisPass = true;
  const pending = queue.pending;
  if (pending === null) update.next = update;
  else {
    update.next = pending.next;
    pending.next = update;
  }
  queue.pending = update;
}

// 本次计算结果未变时复用已提交的 effect 队列，不能因执行过 render 就重新提交 effect。
export function bailoutHooks(
  current: FiberNode,
  workInProgress: FiberNode,
  lanes: Lanes,
): void {
  workInProgress.updateQueue = current.updateQueue;
  workInProgress.flags &= ~(
    PassiveEffect |
    UpdateEffect |
    MountPassiveDev |
    MountLayoutDev
  );
  current.lanes = removeLanes(current.lanes, lanes);
}

export function resetHooksAfterThrow(): void {
  ReactCurrentDispatcher.current = ContextOnlyDispatcher;
  if (didScheduleRenderPhaseUpdate && currentlyRenderingFiber !== null) {
    let hook: Hook | null = currentlyRenderingFiber.memoizedState;
    while (hook !== null) {
      if (hook.queue !== null) hook.queue.pending = null;
      hook = hook.next;
    }
  }
  didScheduleRenderPhaseUpdate =
    didScheduleRenderPhaseUpdateDuringThisPass = false;
  renderLanes = NoLanes;
  currentlyRenderingFiber = null as any;
  currentHook = workInProgressHook = null;
}

// 渲染阶段外调用 hook（不合法调用）统一走这个 dispatcher，行为是直接抛错
function throwInvalidHookError(): never {
  throw new Error(
    "Invalid hook call. Hooks can only be called inside of the body of a function component.",
  );
}

const ContextOnlyDispatcher = {
  useState: throwInvalidHookError,
  useReducer: throwInvalidHookError,
  useRef: throwInvalidHookError,
  useMemo: throwInvalidHookError,
  useCallback: throwInvalidHookError,
  useEffect: throwInvalidHookError,
  useLayoutEffect: throwInvalidHookError,
  useInsertionEffect: throwInvalidHookError,
  useImperativeHandle: throwInvalidHookError,
  useTransition: throwInvalidHookError,
  useDeferredValue: throwInvalidHookError,
  useSyncExternalStore: throwInvalidHookError,
  useContext: throwInvalidHookError,
  useId: throwInvalidHookError,
};

const HooksDispatcherOnMount = {
  useState: mountState,
  useReducer: mountReducer,
  useRef: mountRef,
  useMemo: mountMemo,
  useCallback: mountCallback,
  useEffect: mountEffect,
  useLayoutEffect: mountLayoutEffect,
  useInsertionEffect: mountInsertionEffect,
  useImperativeHandle: mountImperativeHandle,
  useTransition: mountTransition,
  useDeferredValue: mountDeferredValue,
  useSyncExternalStore: mountSyncExternalStore,
  // useContext 不区分 mount/update：读取的是当前 context 值，不依赖上次渲染的 hook 状态
  // （官方两个 dispatcher 里都是同一个 readContext），不需要额外的 mountContext 包装
  useContext: readContext,
  useId: mountId,
};

const HooksDispatcherOnUpdate = {
  useState: updateState,
  useReducer: updateReducer,
  useRef: updateRef,
  useMemo: updateMemo,
  useCallback: updateCallback,
  useEffect: updateEffect,
  useLayoutEffect: updateLayoutEffect,
  useInsertionEffect: updateInsertionEffect,
  useImperativeHandle: updateImperativeHandle,
  useTransition: updateTransition,
  useDeferredValue: updateDeferredValue,
  useSyncExternalStore: updateSyncExternalStore,
  useContext: readContext,
  useId: updateId,
};

function rerenderTransition(): [boolean, (callback: () => void) => void] {
  const [isPending] = rerenderState<boolean>();
  const hook = updateWorkInProgressHook();
  return [isPending, hook.memoizedState];
}

const HooksDispatcherOnRerender = {
  ...HooksDispatcherOnUpdate,
  useState: rerenderState,
  useReducer: rerenderReducer,
  useTransition: rerenderTransition,
  useDeferredValue: rerenderDeferredValue,
};

// 对照官方 18.3.1：render-phase 更新在同一次 render 内重试，不提交中间状态。
// 本地拆分映射：此主体对应 18.3.1 ReactFiberHooks.new.js 的 renderWithHooks；
// 下方导出包装把 BeginWork.new.js 的 DEV Strict 第二次调用集中到同一处，
// 不是声称官方存在 renderWithHooksImpl。两次都从 current 重放，保留 18 的语义。
function renderWithHooksImpl<Props>(
  current: FiberNode | null,
  workInProgress: FiberNode,
  Component: (props: Props, secondArg?: any) => any,
  props: Props,
  secondArg: any,
  nextRenderLanes: Lanes,
): any {
  renderLanes = nextRenderLanes;
  currentlyRenderingFiber = workInProgress;
  currentHook = workInProgressHook = null;
  didScheduleRenderPhaseUpdate =
    didScheduleRenderPhaseUpdateDuringThisPass = false;
  workInProgress.memoizedState = null;
  workInProgress.updateQueue = null;
  workInProgress.lanes = NoLanes;
  ReactCurrentDispatcher.current =
    current === null || current.memoizedState === null
      ? HooksDispatcherOnMount
      : HooksDispatcherOnUpdate;
  let children = Component(props, secondArg);
  let rerenders = 0;
  while (didScheduleRenderPhaseUpdateDuringThisPass) {
    if (rerenders++ >= RE_RENDER_LIMIT) {
      throw new Error(
        "Too many re-renders. React limits the number of renders to prevent an infinite loop.",
      );
    }
    didScheduleRenderPhaseUpdateDuringThisPass = false;
    currentHook = workInProgressHook = null;
    workInProgress.updateQueue = null;
    ReactCurrentDispatcher.current = HooksDispatcherOnRerender;
    children = Component(props, secondArg);
  }
  const tooFew = currentHook !== null && (currentHook as Hook).next !== null;
  ReactCurrentDispatcher.current = ContextOnlyDispatcher;
  renderLanes = NoLanes;
  currentlyRenderingFiber = null as any;
  currentHook = workInProgressHook = null;
  didScheduleRenderPhaseUpdate = false;
  if (tooFew)
    throw new Error(
      "Rendered fewer hooks than expected. This may be caused by an accidental early return statement.",
    );
  return children;
}

// React 18.3.1 的 StrictLegacyMode 在 DEV 再执行一次组件 render；生产产物不启用。
export function renderWithHooks<Props>(
  current: FiberNode | null,
  workInProgress: FiberNode,
  Component: (props: Props, secondArg?: any) => any,
  props: Props,
  secondArg: any,
  lanes: Lanes,
): any {
  let children = renderWithHooksImpl(
    current,
    workInProgress,
    Component,
    props,
    secondArg,
    lanes,
  );
  if (__DEV__ && (workInProgress.mode & StrictLegacyMode) !== 0) {
    children = renderWithHooksImpl(
      current,
      workInProgress,
      Component,
      props,
      secondArg,
      lanes,
    );
  }
  return children;
}
