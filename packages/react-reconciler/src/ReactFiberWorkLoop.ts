/**
 * @file workLoop（调度入口 + 工作循环 + commit 总控）
 * @description 从 scheduleUpdateOnFiber 进入，ensureRootIsScheduled 按 lane 选择同步 flush
 * 或交给 Scheduler 分片执行；workLoopConcurrent 每次处理一个 Fiber 后检查 shouldYield，
 * 时间片用完就中断并交还主线程，下一段从中断点恢复。
 */

import is from "shared/objectIs";
import { beginWork } from "./ReactFiberBeginWork";
import { completeWork } from "./ReactFiberCompleteWork";
import {
  commitBeforeMutationEffects,
  commitDoubleInvokeEffectsInDEV,
  commitLayoutEffects,
  commitMutationEffects,
  commitPassiveMountEffects,
  commitPassiveUnmountEffects,
} from "./ReactFiberCommitWork";
import type { FiberNode } from "./ReactFiber";
import { createWorkInProgress } from "./ReactFiber";
import {
  HostEffectMask,
  Incomplete,
  NoFlags,
  PassiveMask,
  StoreConsistency,
} from "./ReactFiberFlags";
import { ClassComponent, HostRoot } from "./ReactWorkTags";
import { enqueueUpdate } from "./ReactFiberClassUpdateQueue";
import {
  createClassErrorUpdate,
  createRootErrorUpdate,
  throwException,
} from "./ReactFiberThrow";
import { unwindWork, unwindInterruptedWork } from "./ReactFiberUnwindWork";
import { onCommitRoot, onPostCommitRoot } from "./ReactFiberDevToolsHook";
import { resetHooksAfterThrow } from "./ReactFiberHooks";
import {
  NoLane,
  NoLanes,
  NoTimestamp,
  SyncLane,
  claimNextRetryLane,
  claimNextTransitionLane,
  getHighestPriorityLane,
  getNextLanes,
  includesBlockingLane,
  includesExpiredLane,
  includesSomeLane,
  markRootFinished,
  markRootPinged,
  markRootSuspended as markRootSuspended_dontCallThisOne,
  removeLanes,
  includesOnlyTransitions,
  markRootUpdated,
  markStarvedLanesAsExpired,
  mergeLanes,
  type Lane,
  type Lanes,
} from "./ReactFiberLane";
import ReactSharedInternals from "shared/ReactSharedInternals";
import type { FiberRootNode } from "./ReactFiberRoot";
import {
  enqueueConcurrentRenderForLane,
  finishQueueingConcurrentUpdates,
  getConcurrentlyUpdatedLanes,
} from "./ReactFiberConcurrentUpdates";
import type { Wakeable } from "shared/ReactTypes";
import type { SuspenseState } from "./ReactFiberSuspenseComponent";
import { resetContextDependencies } from "./ReactFiberNewContext";
import {
  ContinuousEventPriority,
  DefaultEventPriority,
  DiscreteEventPriority,
  IdleEventPriority,
  getCurrentUpdatePriority,
  lanesToEventPriority,
  lowerEventPriority,
  setCurrentUpdatePriority,
} from "./ReactEventPriorities";
import { ConcurrentMode, NoMode } from "./ReactTypeOfMode";
import { createCursor, push, pop } from "./ReactFiberStack";
import {
  getCurrentEventPriority,
  scheduleMicrotask,
} from "./ReactFiberHostConfig";
import {
  unstable_IdlePriority,
  unstable_ImmediatePriority,
  unstable_NormalPriority,
  unstable_UserBlockingPriority,
  unstable_cancelCallback,
  unstable_now,
  unstable_scheduleCallback,
  unstable_shouldYield,
} from "scheduler";

// 对照官方 ReactFiberWorkLoop.new.js 的 import 别名：scheduler 的 unstable_* 导出在这里改名，
// reconciler 内部不直接暴露 unstable 前缀。
const ImmediatePriority = unstable_ImmediatePriority;
const UserBlockingPriority = unstable_UserBlockingPriority;
const NormalPriority = unstable_NormalPriority;
const IdlePriority = unstable_IdlePriority;
const scheduleCallback = unstable_scheduleCallback;
const cancelCallback = unstable_cancelCallback;
const now = unstable_now;
const shouldYield = unstable_shouldYield;
const ReactCurrentBatchConfig = ReactSharedInternals.ReactCurrentBatchConfig;

// React 18.3.1 ExecutionContext：批处理、render、commit 的位掩码。
const NoContext = 0b000;
const BatchedContext = 0b001;
const RenderContext = 0b010;
const CommitContext = 0b100;

// 根节点的渲染退出状态。保留本实现使用的官方状态值。
const RootInProgress = 0;
const RootSuspended = 3;
const RootSuspendedWithDelay = 4;
const RootCompleted = 5;

// 当前正在处理的 fiber 树根 / 当前处理到的 fiber / 本次渲染的 lanes
let workInProgressRoot: FiberRootNode | null = null;
let workInProgress: FiberNode | null = null;
let workInProgressRootRenderLanes: Lanes = NoLanes;
let workInProgressRootExitStatus = RootInProgress;
// 本次渲染中被跳过（优先级不足）的 lanes，processUpdateQueue 跳过低优先级 update 时累积到这里
let workInProgressRootSkippedLanes: Lanes = NoLanes;
let workInProgressRootPingedLanes: Lanes = NoLanes;
let workInProgressRootInterleavedUpdatedLanes: Lanes = NoLanes;
let subtreeRenderLanes: Lanes = NoLanes;
const subtreeRenderLanesCursor = createCursor(NoLanes);
const NESTED_UPDATE_LIMIT = 50;
let nestedUpdateCount = 0;
let rootWithNestedUpdates: FiberRootNode | null = null;

export function pushRenderLanes(fiber: FiberNode, lanes: Lanes): void {
  push(subtreeRenderLanesCursor, subtreeRenderLanes, fiber);
  subtreeRenderLanes = mergeLanes(subtreeRenderLanes, lanes);
}
export function popRenderLanes(fiber: FiberNode): void {
  subtreeRenderLanes = subtreeRenderLanesCursor.current;
  pop(subtreeRenderLanesCursor, fiber);
}
export function renderDidSuspend(): void {
  if (workInProgressRootExitStatus === RootInProgress)
    workInProgressRootExitStatus = RootSuspended;
}
export function renderDidSuspendDelayIfPossible(): void {
  if (
    workInProgressRootExitStatus === RootInProgress ||
    workInProgressRootExitStatus === RootSuspended
  )
    workInProgressRootExitStatus = RootSuspendedWithDelay;
}
function markRootSuspended(root: FiberRootNode, lanes: Lanes): void {
  const suspended = removeLanes(
    removeLanes(lanes, workInProgressRootPingedLanes),
    workInProgressRootInterleavedUpdatedLanes,
  );
  markRootSuspended_dontCallThisOne(root, suspended);
}
export function isUnsafeClassRenderPhaseUpdate(): boolean {
  return (executionContext & RenderContext) !== NoContext;
}

// 最近一次 update 的事件时间（requestEventTime 在批处理内复用同一时间戳）
let currentEventTime: number = NoTimestamp;
// 同一事件（同一次 startTransition 回调）内的多次更新复用同一条 TransitionLane，
// 避免每次 setState 都 claimNextTransitionLane 分走不同的 lane
let currentEventTransitionLane: Lane = NoLane;

let executionContext: number = NoContext;

// 同步任务队列：SyncLane 的 performSyncWorkOnRoot 先进这个队列，由微任务统一 flush
let syncQueue: Array<() => any> | null = null;
let isFlushingSyncQueue = false;

// 本次 commit 是否产生了待执行的 passive effect（useEffect）；有则记住 root，
// 交给 Scheduler 在 commit 完全结束后异步 flush（对照官方 rootWithPendingPassiveEffects）。
let rootWithPendingPassiveEffects: FiberRootNode | null = null;
let pendingPassiveEffectsLanes: Lanes = NoLanes;
let hasUncaughtError = false;
let firstUncaughtError: unknown = null;
export function onUncaughtError(error: unknown): void {
  if (!hasUncaughtError) {
    hasUncaughtError = true;
    firstUncaughtError = error;
  }
}
let legacyErrorBoundariesThatAlreadyFailed: Set<any> | null = null;

export function isAlreadyFailedLegacyErrorBoundary(instance: any): boolean {
  return legacyErrorBoundariesThatAlreadyFailed?.has(instance) ?? false;
}

export function markLegacyErrorBoundaryAsFailed(instance: any): void {
  if (legacyErrorBoundariesThatAlreadyFailed === null)
    legacyErrorBoundariesThatAlreadyFailed = new Set();
  legacyErrorBoundariesThatAlreadyFailed.add(instance);
}

export function getExecutionContext(): number {
  return executionContext;
}

// 对照官方 getWorkInProgressRoot：useId 的 mountId 需要拿到当前渲染所属的 root，
// 才能读到 root.identifierPrefix。
export function getWorkInProgressRoot(): FiberRootNode | null {
  return workInProgressRoot;
}

// 对照官方 requestEventTime：渲染/提交阶段内直接取真实时间；同一批事件内的多次 update
// 复用同一个 eventTime（currentEventTime），直到再次进入 React 才重新计算。
export function requestEventTime(): number {
  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    return now();
  }
  if (currentEventTime !== NoTimestamp) {
    return currentEventTime;
  }
  currentEventTime = now();
  return currentEventTime;
}

// 对照官方 requestUpdateLane：非并发根（legacy render）恒返回 SyncLane；startTransition
// 回调内（ReactCurrentBatchConfig.transition 非空）走 TransitionLane，同一事件内的多次更新
// 复用同一条 lane（currentEventTransitionLane），直到下次真正进入新的事件才重新分配；
// 否则并发根优先取 flushSync 设置的 DiscreteEventPriority，否则取事件系统的
// currentUpdatePriority，最后询问宿主原生事件优先级。
export function requestUpdateLane(fiber: FiberNode): Lane {
  const mode = fiber.mode;
  if ((mode & ConcurrentMode) === NoMode) {
    return SyncLane;
  }

  if (
    (executionContext & RenderContext) !== NoContext &&
    workInProgressRootRenderLanes !== NoLanes
  )
    return getHighestPriorityLane(workInProgressRootRenderLanes);

  const isTransition = ReactCurrentBatchConfig.transition !== null;
  if (isTransition) {
    if (currentEventTransitionLane === NoLane) {
      currentEventTransitionLane = claimNextTransitionLane();
    }
    return currentEventTransitionLane;
  }

  const updateLane = getCurrentUpdatePriority();
  if (updateLane !== NoLane) {
    return updateLane;
  }
  return getCurrentEventPriority();
}

// 对照官方 prepareFreshStack：重置 root 的 finished 状态，并把 root.current 克隆成新的
// workInProgress 树根。若上一次并发渲染被中断（workInProgress 非空），官方会 unwind 中断的
// 子树，恢复 Context 栈后再丢弃未提交的 WIP。
function prepareFreshStack(root: FiberRootNode, lanes: Lanes): FiberNode {
  if (workInProgress !== null) {
    let interrupted = workInProgress.return;
    while (interrupted !== null) {
      unwindInterruptedWork(interrupted);
      interrupted = interrupted.return;
    }
  }

  root.finishedWork = null;
  root.finishedLanes = NoLanes;

  if (workInProgress !== null) {
    // 上一次渲染被抢占，丢弃中断的 workInProgress
    workInProgress = null;
  }

  workInProgressRoot = root;
  const rootWorkInProgress = createWorkInProgress(root.current, null);
  workInProgress = rootWorkInProgress;
  workInProgressRootRenderLanes = lanes;
  workInProgressRootExitStatus = RootInProgress;
  workInProgressRootSkippedLanes = NoLanes;
  workInProgressRootPingedLanes = NoLanes;
  workInProgressRootInterleavedUpdatedLanes = NoLanes;
  subtreeRenderLanes = lanes;

  // 对照官方：新开一棵栈前，先把上一批（render 阶段之外触发的）并发 update 刷回各自
  // fiber 的 updateQueue，保证接下来遍历到的 updateQueue 一定是最新的
  finishQueueingConcurrentUpdates();

  return rootWorkInProgress;
}

// 对照官方 workLoopSync：同步模式不检查 shouldYield，一口气处理完整棵树。
function workLoopSync(): void {
  while (workInProgress !== null) {
    performUnitOfWork(workInProgress);
  }
}

// 对照官方 workLoopConcurrent：每次处理一个 Fiber 后检查 shouldYield，时间片用完就中断，
// 把剩余工作留给下一段（performConcurrentWorkOnRoot 被 Scheduler 再次调度时续跑）。
function workLoopConcurrent(): void {
  while (workInProgress !== null && !shouldYield()) {
    performUnitOfWork(workInProgress);
  }
}

// 对照官方 performUnitOfWork：对单个 fiber 先 beginWork，返回 null 说明没有子节点可继续，
// 就 completeUnitOfWork 向上归；否则继续处理返回的子 fiber。
function performUnitOfWork(unitOfWork: FiberNode): void {
  // current 树的状态就是 unitOfWork.alternate（这是官方在渲染阶段复用 alternate 字段的约定，
  // 省一个额外的字段）
  const current = unitOfWork.alternate;

  const next: FiberNode | null = beginWork(
    current,
    unitOfWork,
    subtreeRenderLanes,
  );

  unitOfWork.memoizedProps = unitOfWork.pendingProps;
  if (next === null) {
    // 没有新子节点，完成当前节点
    completeUnitOfWork(unitOfWork);
  } else {
    workInProgress = next;
  }
}

// 对照官方 completeUnitOfWork：完成当前节点后尝试处理兄弟节点，没有兄弟就回到父节点。
// 到达根节点时把退出状态置为 RootCompleted。
function completeUnitOfWork(unitOfWork: FiberNode): void {
  let completedWork: FiberNode | null = unitOfWork;
  do {
    const current = completedWork.alternate;
    const returnFiber: FiberNode | null = completedWork.return;

    if ((completedWork.flags & Incomplete) === NoFlags) {
      const next = completeWork(current, completedWork, subtreeRenderLanes);

      if (next !== null) {
        // completeWork 派生了新工作（如 Suspense fallback），继续处理
        workInProgress = next;
        return;
      }

      const siblingFiber = completedWork.sibling;
      if (siblingFiber !== null) {
        // 有兄弟节点，处理兄弟
        workInProgress = siblingFiber;
        return;
      }
    } else {
      // 节点因抛错未完成：unwind 沿 return 链找 throwException 标记了 ShouldCapture 的
      // 边界（对照官方 unwindWork），找到就把它设为下一个 workInProgress 重新进入 beginWork
      // 渡染 fallback；没找到则把 Incomplete 继续向上传播，subtreeFlags/deletions 清空
      // （半成品子树的 effect 不该生效）。对照官方 unwindUnitOfWork 的 skipSiblings：
      // 抛错节点的兄弟节点不能再继续渲染——它们大概率是同一批数据的一部分，若也 throw，
      // 这时最近的边界已经被标记过 ShouldCapture，会找不到边界而误落进上一层兜底逻辑
      // （比如错误地把 update 打到 HostRoot 上）。所以这里故意跳过 siblingFiber 检查，
      // 直接向上找父节点。
      const next = unwindWork(completedWork);

      if (next !== null) {
        next.flags &= HostEffectMask;
        workInProgress = next;
        return;
      }

      if (returnFiber !== null) {
        returnFiber.flags |= Incomplete;
        returnFiber.subtreeFlags = NoFlags;
        returnFiber.deletions = null;
      }
    }

    completedWork = returnFiber;
    workInProgress = completedWork;
  } while (completedWork !== null);

  // 到达根节点
  if (workInProgressRootExitStatus === RootInProgress) {
    workInProgressRootExitStatus = RootCompleted;
  }
}

// 对照官方 handleError：render 阶段 throw 被 workLoop 的 try/catch 捕获后调用——
// throwException 沿 return 链标记最近的错误边界（或兜底 HostRoot），completeUnitOfWork
// 紧接着从抛错的 fiber 开始 unwind，找到边界后把它设为新的 workInProgress，
// 外层 do/while 循环会从那里继续 workLoopSync/workLoopConcurrent 渡染 fallback。
function handleError(root: FiberRootNode, thrownValue: any): void {
  resetHooksAfterThrow();
  const erroredWork = workInProgress;
  if (erroredWork === null) {
    throw thrownValue;
  }

  throwException(
    root,
    erroredWork.return,
    erroredWork,
    thrownValue,
    workInProgressRootRenderLanes,
  );
  completeUnitOfWork(erroredWork);
}

// 对照官方 renderRootSync：进入 RenderContext，必要时准备新栈，跑同步 workLoop。
// 同步渲染必须完成整棵树，workInProgress 非空说明出了 bug。
function renderRootSync(root: FiberRootNode, lanes: Lanes): number {
  const prevExecutionContext = executionContext;
  executionContext |= RenderContext;

  if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes) {
    prepareFreshStack(root, lanes);
  }

  do {
    try {
      workLoopSync();
      break;
    } catch (thrownValue) {
      handleError(root, thrownValue);
    }
  } while (true);
  // 渲染阶段结束（正常完成或本函数即将 throw），重置 context 依赖收集状态，
  // 避免渲染阶段外误读到上一次渲染残留的 currentlyRenderingFiber
  resetContextDependencies();

  executionContext = prevExecutionContext;

  if (workInProgress !== null) {
    // 同步渲染必须完成整棵树
    throw new Error(
      "Cannot commit an incomplete root. This error is likely caused by a " +
        "bug in React. Please file an issue.",
    );
  }

  workInProgressRoot = null;
  workInProgressRootRenderLanes = NoLanes;

  return workInProgressRootExitStatus;
}

// 对照官方 renderRootConcurrent：与 renderRootSync 的区别在于跑 workLoopConcurrent，
// 中断时（workInProgress 非空）返回 RootInProgress 且保留 workInProgressRoot/renderLanes，
// 供下一段从中断点续跑；只有整棵树完成才清空 root 指针并返回最终退出状态。
function renderRootConcurrent(root: FiberRootNode, lanes: Lanes): number {
  const prevExecutionContext = executionContext;
  executionContext |= RenderContext;

  if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes) {
    prepareFreshStack(root, lanes);
  }

  do {
    try {
      workLoopConcurrent();
      break;
    } catch (thrownValue) {
      handleError(root, thrownValue);
    }
  } while (true);
  // 时间片用完中途让出，或整棵树渲染完成，都要重置 context 依赖收集状态
  resetContextDependencies();

  executionContext = prevExecutionContext;

  if (workInProgress !== null) {
    // 还有剩余工作，被 shouldYield 中断，返回 RootInProgress
    return RootInProgress;
  }

  workInProgressRoot = null;
  workInProgressRootRenderLanes = NoLanes;

  return workInProgressRootExitStatus;
}

// 对照官方 commitRootImpl（三个同步子阶段 + passive 调度）：提交 finishedWork，应用所有 DOM
// 变更后交换 current 指针。pendingLanes 不再全量清零，而是只清掉本次 commit 掉的 lane、
// 保留被跳过的低优先级 lane（markRootFinished），提交后再 ensureRootIsScheduled 处理剩余工作。
function commitRootImpl(root: FiberRootNode): void {
  do {
    flushPassiveEffects();
  } while (rootWithPendingPassiveEffects !== null);
  const finishedWork = root.finishedWork;
  if (finishedWork === null) {
    return;
  }

  const lanes = root.finishedLanes;
  root.finishedWork = null;
  root.finishedLanes = NoLanes;
  root.callbackNode = null;
  root.callbackPriority = NoLane;

  // 只把本次真正提交掉的 lane 从 pendingLanes 里清掉，剩余的（被跳过的低优先级 lane）
  // 保留下来，供 ensureRootIsScheduled 继续调度（对应 4.5 的 base 重放链路）
  const remainingLanes = mergeLanes(
    mergeLanes(finishedWork.lanes, finishedWork.childLanes),
    getConcurrentlyUpdatedLanes(),
  );
  markRootFinished(root, remainingLanes);

  const prevExecutionContext = executionContext;
  executionContext |= CommitContext;
  const previousPriority = getCurrentUpdatePriority();
  const previousTransition = ReactCurrentBatchConfig.transition;
  ReactCurrentBatchConfig.transition = null;
  setCurrentUpdatePriority(DiscreteEventPriority);
  try {
    // before-mutation 子阶段：只处理 getSnapshotBeforeUpdate（必须在 DOM 变更前读）
    commitBeforeMutationEffects(root, finishedWork);

    // mutation 子阶段：插入/更新/删除 DOM
    commitMutationEffects(root, finishedWork, lanes);

    // 双缓存树交换：workInProgress 树提交后成为新的 current 树。layout effect 必须在这之后
    // 挂载——useLayoutEffect 里读 DOM/ref 时，fiber.stateNode 应该已经是最新的
    root.current = finishedWork;

    // layout 子阶段：同步挂载 useLayoutEffect（销毁已经在 commitMutationEffects 里做过了）
    commitLayoutEffects(finishedWork, root);
    if (
      __DEV__ &&
      ((finishedWork.flags | finishedWork.subtreeFlags) & PassiveMask) ===
        NoFlags
    ) {
      commitDoubleInvokeEffectsInDEV(finishedWork);
    }
  } finally {
    executionContext = prevExecutionContext;
    setCurrentUpdatePriority(previousPriority);
    ReactCurrentBatchConfig.transition = previousTransition;
  }

  // 有 useEffect 待执行，记住 root 并交给 Scheduler 异步 flush，不阻塞本次 commit 后的绘制
  if (
    (finishedWork.flags & PassiveMask) !== NoFlags ||
    (finishedWork.subtreeFlags & PassiveMask) !== NoFlags
  ) {
    if (rootWithPendingPassiveEffects !== root) {
      rootWithPendingPassiveEffects = root;
      pendingPassiveEffectsLanes = lanes;
      scheduleCallback(NormalPriority, flushPassiveEffects);
    }
  }

  if (root.pendingLanes === NoLanes)
    legacyErrorBoundariesThatAlreadyFailed = null;

  // 有剩余工作（被跳过的 lane）则重新调度
  ensureRootIsScheduled(root, now());
  if (hasUncaughtError) {
    hasUncaughtError = false;
    const error = firstUncaughtError;
    firstUncaughtError = null;
    throw error;
  }
  // React 18 ConcurrentRoot：离散同步更新的 passive effects 在当前任务结束前刷新。
  if (
    (finishedWork.mode & ConcurrentMode) !== NoMode &&
    includesSomeLane(lanes, SyncLane)
  )
    flushPassiveEffects();
  if (includesSomeLane(root.pendingLanes, SyncLane)) {
    if (rootWithNestedUpdates === root) nestedUpdateCount++;
    else {
      nestedUpdateCount = 0;
      rootWithNestedUpdates = root;
    }
  } else nestedUpdateCount = 0;
  flushSyncCallbacks();
  onCommitRoot(root);
}

// 对照官方 flushPassiveEffectsImpl（精简版）：commit 结束后异步执行，先卸载再挂载，
// 保证同一批里"旧的先清理、新的再挂载"这一顺序。异步执行的意义是不阻塞 commit 后的绘制——
// useLayoutEffect 始终在 commit 内同步执行；useEffect 通常延后，但离散 SyncLane 会提前刷新。
function flushPassiveEffects(): void {
  const root = rootWithPendingPassiveEffects;
  if (root === null) {
    return;
  }
  rootWithPendingPassiveEffects = null;
  const lanes = pendingPassiveEffectsLanes;
  pendingPassiveEffectsLanes = NoLanes;
  const previousPriority = getCurrentUpdatePriority();
  const previousTransition = ReactCurrentBatchConfig.transition;
  setCurrentUpdatePriority(
    lowerEventPriority(DefaultEventPriority, lanesToEventPriority(lanes)),
  );
  ReactCurrentBatchConfig.transition = null;

  const prevExecutionContext = executionContext;
  executionContext |= CommitContext;

  try {
    commitPassiveUnmountEffects(root.current);
    commitPassiveMountEffects(root, root.current);
    if (__DEV__) commitDoubleInvokeEffectsInDEV(root.current);
  } finally {
    executionContext = prevExecutionContext;
    setCurrentUpdatePriority(previousPriority);
    ReactCurrentBatchConfig.transition = previousTransition;
  }
  flushSyncCallbacks();
  onPostCommitRoot(root);
}

function commitRoot(root: FiberRootNode): void {
  commitRootImpl(root);
}

// 对照官方 performConcurrentWorkOnRoot：所有走 Scheduler 的任务入口。按 lanes 决定是时间
// 切片（renderRootConcurrent）还是同步跑完（renderRootSync），树完成后提交。若本次任务节点
// 未被更高优先级替换，返回续跑函数让 Scheduler 下一段继续。
function performConcurrentWorkOnRoot(
  root: FiberRootNode,
  didTimeout: boolean,
): any {
  // 进入新的并发工作循环，重置事件时间与本轮 TransitionLane（对照官方
  // performConcurrentWorkOnRoot 的重置，让下一次 startTransition 重新分配 lane）
  currentEventTime = NoTimestamp;
  currentEventTransitionLane = NoLane;

  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    throw new Error("Should not already be working.");
  }

  const originalCallbackNode = root.callbackNode;
  flushPassiveEffects();
  if (root.callbackNode !== originalCallbackNode) return null;

  const lanes = getNextLanes(
    root,
    root === workInProgressRoot ? workInProgressRootRenderLanes : NoLanes,
  );
  if (lanes === NoLanes) {
    // 没有可做的并发工作（防御性分支）
    return null;
  }

  // 阻塞 lane / 已过期 lane / Scheduler 超时（didTimeout）时不再时间切片，同步跑完防饥饿
  const shouldTimeSlice =
    !includesBlockingLane(root, lanes) &&
    !includesExpiredLane(root, lanes) &&
    !didTimeout;

  let exitStatus = shouldTimeSlice
    ? renderRootConcurrent(root, lanes)
    : renderRootSync(root, lanes);

  if (
    exitStatus !== RootInProgress &&
    !includesBlockingLane(root, lanes) &&
    !isRenderConsistentWithExternalStores(root.current.alternate!)
  ) {
    exitStatus = renderRootSync(root, lanes);
  }
  if (exitStatus !== RootInProgress) {
    // 只有完整退出的树可以进入结束协议。
    const finishedWork = root.current.alternate;
    root.finishedWork = finishedWork;
    root.finishedLanes = lanes;
    finishConcurrentRender(root, exitStatus, lanes);
  }

  ensureRootIsScheduled(root, now());
  if (root.callbackNode === originalCallbackNode) {
    // 任务还是当前这个（未被更高优先级替换），返回续跑函数继续下一段
    return performConcurrentWorkOnRoot.bind(null, root);
  }
  return null;
}

// 保留 18.3.1 的 root 退出状态协议；省略 fallback 的 JND/500ms 等待启发式。
function finishConcurrentRender(
  root: FiberRootNode,
  exitStatus: number,
  lanes: Lanes,
): void {
  if (exitStatus === RootSuspended || exitStatus === RootSuspendedWithDelay) {
    markRootSuspended(root, lanes);
    if (exitStatus === RootSuspendedWithDelay && includesOnlyTransitions(lanes))
      return;
    // 没有 Suspense 边界的未完成根只能等 ping。
    if ((root.finishedWork!.flags & Incomplete) !== NoFlags) return;
  }
  commitRoot(root);
}

// 对照官方 performSyncWorkOnRoot：同步任务入口（不经过 Scheduler），取含 SyncLane 的
// lanes 同步渲染并提交，最后 ensureRootIsScheduled 处理剩余低优先级工作。
function performSyncWorkOnRoot(root: FiberRootNode): null {
  flushPassiveEffects();
  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    throw new Error("Should not already be working.");
  }

  const lanes = getNextLanes(root, NoLanes);
  if (!includesSomeLane(lanes, SyncLane)) {
    // 没有剩余同步工作
    ensureRootIsScheduled(root, now());
    return null;
  }

  const exitStatus = renderRootSync(root, lanes);

  if (exitStatus !== RootInProgress) {
    const finishedWork = root.current.alternate;
    root.finishedWork = finishedWork;
    root.finishedLanes = lanes;
    commitRoot(root);
  }

  ensureRootIsScheduled(root, now());

  return null;
}

// 对照官方 ensureRootIsScheduled：按 pendingLanes 的最高优先级决定调度方式。SyncLane 走
// 内部同步队列（微任务 flush），其余 lane 交给 Scheduler 分片执行；优先级没变则复用现有任务。
function ensureRootIsScheduled(root: FiberRootNode, currentTime: number): void {
  const existingCallbackNode = root.callbackNode;

  // 先做饥饿检测：过期 lane 并入 expiredLanes
  markStarvedLanesAsExpired(root, currentTime);

  const nextLanes = getNextLanes(
    root,
    root === workInProgressRoot ? workInProgressRootRenderLanes : NoLanes,
  );

  if (nextLanes === NoLanes) {
    // 没有可做的工作
    if (existingCallbackNode !== null) {
      cancelCallback(existingCallbackNode);
    }
    root.callbackNode = null;
    root.callbackPriority = NoLane;
    return;
  }

  const newCallbackPriority = getHighestPriorityLane(nextLanes);

  const existingCallbackPriority = root.callbackPriority;
  if (existingCallbackPriority === newCallbackPriority) {
    // 优先级没变，复用现有调度任务
    return;
  }

  if (existingCallbackNode != null) {
    // 取消旧任务，下面重新调度一个
    cancelCallback(existingCallbackNode);
  }

  let newCallbackNode;
  if (newCallbackPriority === SyncLane) {
    // SyncLane 走内部同步队列：performSyncWorkOnRoot 进队列，微任务统一 flush
    scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root));
    scheduleMicrotask(flushSyncCallbacks);
    newCallbackNode = null;
  } else {
    let schedulerPriorityLevel;
    switch (lanesToEventPriority(nextLanes)) {
      case DiscreteEventPriority:
        schedulerPriorityLevel = ImmediatePriority;
        break;
      case ContinuousEventPriority:
        schedulerPriorityLevel = UserBlockingPriority;
        break;
      case DefaultEventPriority:
        schedulerPriorityLevel = NormalPriority;
        break;
      case IdleEventPriority:
        schedulerPriorityLevel = IdlePriority;
        break;
      default:
        schedulerPriorityLevel = NormalPriority;
        break;
    }
    newCallbackNode = scheduleCallback(
      schedulerPriorityLevel,
      performConcurrentWorkOnRoot.bind(null, root),
    );
  }

  root.callbackPriority = newCallbackPriority;
  root.callbackNode = newCallbackNode;
}

// 对照官方 scheduleSyncCallback / flushSyncCallbacks：SyncLane 的同步任务先入队列，由微任务
// 在 BatchedContext 下统一 flush，保证同一批同步更新只 commit 一次。
export function scheduleSyncCallback(callback: () => any): void {
  if (syncQueue === null) {
    syncQueue = [callback];
  } else {
    syncQueue.push(callback);
  }
}

export function flushSyncCallbacks(): void {
  if ((executionContext & (RenderContext | CommitContext)) !== NoContext)
    return;
  if (!isFlushingSyncQueue && syncQueue !== null) {
    isFlushingSyncQueue = true;
    let i = 0;
    const prevExecutionContext = executionContext;
    executionContext |= BatchedContext;
    try {
      for (; i < syncQueue.length; i++) {
        let callback = syncQueue[i];
        do {
          callback = callback();
        } while (callback !== null);
      }
      syncQueue = null;
    } catch (error) {
      syncQueue = syncQueue!.slice(i + 1);
      scheduleMicrotask(flushSyncCallbacks);
      throw error;
    } finally {
      executionContext = prevExecutionContext;
      isFlushingSyncQueue = false;
    }
  }
}

// 对照官方 flushSync：在 BatchedContext 下以 DiscreteEventPriority 执行 fn，期间的更新都被
// 标记为同步优先级，结束后统一 flush 同步队列。
export function flushSync<A, R>(fn: (a: A) => R): R {
  const prevExecutionContext = executionContext;
  executionContext |= BatchedContext;

  const previousPriority = getCurrentUpdatePriority();
  const previousTransition = ReactCurrentBatchConfig.transition;
  ReactCurrentBatchConfig.transition = null;
  try {
    setCurrentUpdatePriority(DiscreteEventPriority);
    if (fn) {
      return fn(null as unknown as A);
    }
    return undefined as unknown as R;
  } finally {
    ReactCurrentBatchConfig.transition = previousTransition;
    setCurrentUpdatePriority(previousPriority);
    executionContext = prevExecutionContext;
    if (syncQueue !== null) {
      flushSyncCallbacks();
    }
  }
}

// 对照官方 scheduleUpdateOnFiber：把 lane 标记到 root.pendingLanes（markRootUpdated），
// 然后 ensureRootIsScheduled 决定同步 flush 还是交给 Scheduler；中途更新要记录 interleaved lanes。
export function scheduleUpdateOnFiber(
  root: FiberRootNode,
  _fiber: FiberNode,
  lane: Lane,
  eventTime: number,
): void {
  if (nestedUpdateCount > NESTED_UPDATE_LIMIT) {
    nestedUpdateCount = 0;
    rootWithNestedUpdates = null;
    throw new Error(
      "Maximum update depth exceeded. React limits the number of nested updates to prevent infinite loops.",
    );
  }
  markRootUpdated(root, lane, eventTime);
  if (
    root === workInProgressRoot &&
    (executionContext & RenderContext) === NoContext
  ) {
    workInProgressRootInterleavedUpdatedLanes = mergeLanes(
      workInProgressRootInterleavedUpdatedLanes,
      lane,
    );
    if (workInProgressRootExitStatus === RootSuspendedWithDelay)
      markRootSuspended(root, workInProgressRootRenderLanes);
  }
  ensureRootIsScheduled(root, eventTime);
}

// 对照官方 markSkippedUpdateLanes：记录本次渲染中被跳过的 lanes。processUpdateQueue
// 在按 renderLanes 跳过低优先级 update 时调用，写回 workInProgressRootSkippedLanes。
export function markSkippedUpdateLanes(lanes: Lanes): void {
  workInProgressRootSkippedLanes = mergeLanes(
    workInProgressRootSkippedLanes,
    lanes,
  );
}

// 对照官方 pingSuspendedRoot（简化：不做"是否要 restart from root"的启发式判断）：
// wakeable resolve/reject 后被 attachPingListener 的 then 回调触发——markRootPinged 把
// pingedLanes 记到 root，再 ensureRootIsScheduled 让被挂起的 lane 有机会重新参与调度。
export function pingSuspendedRoot(
  root: FiberRootNode,
  wakeable: Wakeable,
  pingedLanes: Lanes,
): void {
  const pingCache = root.pingCache;
  if (pingCache !== null) {
    pingCache.delete(wakeable);
  }
  markRootPinged(root, pingedLanes);
  if (root === workInProgressRoot) {
    workInProgressRootPingedLanes = mergeLanes(
      workInProgressRootPingedLanes,
      pingedLanes,
    );
  }
  ensureRootIsScheduled(root, now());
}

// 对照官方 requestRetryLane（简化版 requestUpdateLane）：legacy 模式固定 SyncLane，
// 否则从 RetryLanes 轮转分配一条，避免多个几乎同时 resolve 的 wakeable 抢同一条 lane。
function requestRetryLane(fiber: FiberNode): Lane {
  if ((fiber.mode & ConcurrentMode) === NoMode) {
    return SyncLane;
  }
  return claimNextRetryLane();
}

// 对照官方 resolveRetryWakeable：Suspense 边界自身挂的 retry 监听（attachSuspenseRetryListeners
// 在 commit 阶段挂上）触发后调用——从边界 fiber.stateNode 的 retry 缓存里删掉这个 wakeable，
// 优先复用 memoizedState.retryLane，没有指定 lane 时由 retryTimedOutBoundary 分配。
export function resolveRetryWakeable(
  boundaryFiber: FiberNode,
  wakeable: Wakeable,
): void {
  const retryCache: Set<Wakeable> | null = boundaryFiber.stateNode;
  if (retryCache !== null) {
    retryCache.delete(wakeable);
  }

  const suspenseState: SuspenseState | null = boundaryFiber.memoizedState;
  const retryLane = suspenseState === null ? NoLane : suspenseState.retryLane;
  retryTimedOutBoundary(boundaryFiber, retryLane);
}

function retryTimedOutBoundary(
  boundaryFiber: FiberNode,
  retryLane: Lane,
): void {
  if (retryLane === NoLane) retryLane = requestRetryLane(boundaryFiber);
  const eventTime = requestEventTime();
  const root = enqueueConcurrentRenderForLane(boundaryFiber, retryLane);
  if (root !== null) {
    markRootUpdated(root, retryLane, eventTime);
    ensureRootIsScheduled(root, eventTime);
  }
}

// 对照 captureCommitPhaseError：从已挂载祖先找边界，commit 错误也进入同步恢复队列。
export function captureCommitPhaseError(
  source: FiberNode,
  nearestMountedAncestor: FiberNode | null,
  error: unknown,
): void {
  let fiber = source.tag === HostRoot ? source : nearestMountedAncestor;
  while (fiber !== null) {
    if (fiber.tag === ClassComponent) {
      const instance = fiber.stateNode;
      if (
        typeof fiber.type.getDerivedStateFromError === "function" ||
        (instance !== null &&
          typeof instance.componentDidCatch === "function" &&
          !isAlreadyFailedLegacyErrorBoundary(instance))
      ) {
        const root = enqueueUpdate(
          fiber,
          createClassErrorUpdate(fiber, error, SyncLane),
          SyncLane,
        );
        if (root !== null)
          scheduleUpdateOnFiber(root, fiber, SyncLane, requestEventTime());
        return;
      }
    } else if (fiber.tag === HostRoot) {
      const root = enqueueUpdate(
        fiber,
        createRootErrorUpdate(error, SyncLane),
        SyncLane,
      );
      if (root !== null)
        scheduleUpdateOnFiber(root, fiber, SyncLane, requestEventTime());
      return;
    }
    fiber = fiber.return;
  }
}

function isRenderConsistentWithExternalStores(fiber: FiberNode): boolean {
  if ((fiber.flags & StoreConsistency) !== NoFlags) {
    const checks = fiber.updateQueue?.stores;
    if (checks != null)
      for (const check of checks) {
        try {
          if (!is(check.getSnapshot(), check.value)) return false;
        } catch {
          return false;
        }
      }
  }
  if ((fiber.subtreeFlags & StoreConsistency) !== NoFlags) {
    let child = fiber.child;
    while (child !== null) {
      if (!isRenderConsistentWithExternalStores(child)) return false;
      child = child.sibling;
    }
  }
  return true;
}
