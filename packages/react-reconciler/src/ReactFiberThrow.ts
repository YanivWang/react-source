/**
 * @file render 阶段抛错处理
 * @description 对照官方 packages/react-reconciler/src/ReactFiberThrow.js：workLoop 捕获到
 * render 阶段的 throw 后调用 throwException——给抛错的 fiber 打 Incomplete，先判断抛出的是不是
 * Suspense 用的 thenable（Promise），是则走挂起分支；否则沿 return 链向上找最近的错误边界
 * （class 组件实现 getDerivedStateFromError/componentDidCatch），命中就打 ShouldCapture 并塞
 * 一条 CaptureUpdate；找不到则兜底在 HostRoot 卸载整棵树。
 *
 * 简化范围：不追踪 componentStack；无 Suspense 边界的非同步更新等待 ping，
 * 同步输入挂起按官方 18.3.1 转成错误交给 Class 边界或 HostRoot。
 */

import type { FiberNode } from "./ReactFiber";
import type { FiberRootNode } from "./ReactFiberRoot";
import { ClassComponent, HostRoot, SuspenseComponent } from "./ReactWorkTags";
import { ShouldCapture, DidCapture, Incomplete } from "./ReactFiberFlags";
import { shouldCaptureSuspense } from "./ReactFiberSuspenseComponent";
import {
  getHighestPriorityLane,
  includesSomeLane,
  SyncLane,
  type Lanes,
} from "./ReactFiberLane";
import {
  CaptureUpdate,
  createUpdate,
  enqueueCapturedUpdate,
  type Update,
} from "./ReactFiberClassUpdateQueue";
import type { Wakeable } from "shared/ReactTypes";
import {
  onUncaughtError,
  renderDidSuspendDelayIfPossible,
  pingSuspendedRoot,
  isAlreadyFailedLegacyErrorBoundary,
  markLegacyErrorBoundaryAsFailed,
} from "./ReactFiberWorkLoop";

// 对照官方 createClassErrorUpdate：payload/callback 复用现有消费链路——payload 走
// processUpdateQueue 的浅合并语义（getDerivedStateFromError 返回值即 partial state），
// callback 走 commitUpdateQueue（layout 子阶段统一执行），不需要为 componentDidCatch
// 新增专门的 commit 分支。
export function createClassErrorUpdate(
  boundaryFiber: FiberNode,
  error: any,
  lane: any,
): Update<any> {
  const update = createUpdate<any>(0, lane);
  update.tag = CaptureUpdate;

  const instance = boundaryFiber.stateNode;
  const Component = boundaryFiber.type;
  if (typeof Component.getDerivedStateFromError === "function") {
    update.payload = () => Component.getDerivedStateFromError(error);
  }

  if (instance !== null && typeof instance.componentDidCatch === "function") {
    update.callback = () => {
      if (typeof Component.getDerivedStateFromError !== "function") {
        markLegacyErrorBoundaryAsFailed(instance);
      }
      instance.componentDidCatch(error, { componentStack: "" });
    };
  }

  return update;
}

// 兜底：整棵树都没有错误边界时，直接卸载 HostRoot 的 children（element: null），
// 并把错误打到控制台（不做 componentStack 追踪）
export function createRootErrorUpdate(error: any, lane: any): Update<any> {
  const update = createUpdate<any>(0, lane);
  update.tag = CaptureUpdate;
  update.payload = { element: null };
  update.callback = () => {
    onUncaughtError(error);
    console.error(error);
  };
  return update;
}

// 对照官方 isThenable判断：Suspense 只关心"是不是一个带 then 方法的对象"，不关心它到底是
// 原生 Promise 还是 Promise-like（用户自造的 thenable），二者都能被 wakeable.then(ping, ping) 监听。
function isThenable(value: any): value is Wakeable {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.then === "function"
  );
}

// 对照官方 getNearestSuspenseBoundaryToCapture：沿 return 链向上找最近的 SuspenseComponent，
// 正在渲染 fallback 的边界不再捕获（React 18.3.1 shouldCaptureSuspense）。
function getNearestSuspenseBoundaryToCapture(
  returnFiber: FiberNode | null,
): FiberNode | null {
  let node: FiberNode | null = returnFiber;
  while (node !== null) {
    if (node.tag === SuspenseComponent && shouldCaptureSuspense(node)) {
      return node;
    }
    node = node.return;
  }
  return null;
}

// 对照官方 attachPingListener：用 root.pingCache 给同一个 wakeable 记录已经监听过的 lanes 集合，
// 避免重复挂 then 监听；resolve/reject 时都调用 pingSuspendedRoot，让 root 重新调度这些 lanes。
function attachPingListener(
  root: FiberRootNode,
  wakeable: Wakeable,
  lanes: Lanes,
): void {
  let pingCache = root.pingCache;
  let threadIDs: Set<Lanes> | undefined;
  if (pingCache === null) {
    pingCache = root.pingCache = new WeakMap();
    threadIDs = new Set();
    pingCache.set(wakeable, threadIDs);
  } else {
    threadIDs = pingCache.get(wakeable);
    if (threadIDs === undefined) {
      threadIDs = new Set();
      pingCache.set(wakeable, threadIDs);
    }
  }
  if (!threadIDs.has(lanes)) {
    threadIDs.add(lanes);
    const ping = () => pingSuspendedRoot(root, wakeable, lanes);
    wakeable.then(ping, ping);
  }
}

// 对照官方 attachRetryListener：把 wakeable 记到 Suspense 边界自身的 updateQueue（一个
// Set<Wakeable>），commit 阶段的 attachSuspenseRetryListeners 会消费这个 Set 挂上真正的
// resolveRetryWakeable 监听。这里只负责记录，不重复挂监听（同一个 wakeable 可能被 Set 去重）。
function attachRetryListener(
  suspenseBoundary: FiberNode,
  _root: FiberRootNode,
  wakeable: Wakeable,
  _lanes: Lanes,
): void {
  let retryQueue: Set<Wakeable> | null = suspenseBoundary.updateQueue;
  if (retryQueue === null) {
    retryQueue = new Set();
    suspenseBoundary.updateQueue = retryQueue;
  }
  retryQueue.add(wakeable);
}

// 对照官方 markSuspenseBoundaryShouldCapture：不走 CaptureUpdate（不需要 payload/callback），
// 直接打 ShouldCapture，重新进入 beginWork 走 unwindWork -> updateSuspenseComponent 渲染 fallback。
function markSuspenseBoundaryShouldCapture(
  suspenseBoundary: FiberNode,
  renderLanes: Lanes,
): void {
  suspenseBoundary.flags |= ShouldCapture;
  suspenseBoundary.lanes = renderLanes;
}

export function throwException(
  root: FiberRootNode,
  returnFiber: FiberNode | null,
  sourceFiber: FiberNode,
  value: any,
  renderLanes: Lanes,
): void {
  sourceFiber.flags |= Incomplete;

  if (isThenable(value)) {
    const wakeable: Wakeable = value;
    const suspenseBoundary = getNearestSuspenseBoundaryToCapture(returnFiber);
    if (suspenseBoundary !== null) {
      markSuspenseBoundaryShouldCapture(suspenseBoundary, renderLanes);
      attachPingListener(root, wakeable, renderLanes);
      attachRetryListener(suspenseBoundary, root, wakeable, renderLanes);
      return;
    }
    if (!includesSomeLane(renderLanes, SyncLane)) {
      attachPingListener(root, wakeable, renderLanes);
      renderDidSuspendDelayIfPossible();
      return;
    }
    value = new Error(
      "A component suspended while responding to synchronous input. Updates that suspend should be wrapped with startTransition.",
    );
  }

  const lane = getHighestPriorityLane(renderLanes);

  let workInProgress: FiberNode | null = returnFiber;
  while (workInProgress !== null) {
    switch (workInProgress.tag) {
      case HostRoot: {
        const update = createRootErrorUpdate(value, lane);
        enqueueCapturedUpdate(workInProgress, update);
        workInProgress.flags |= ShouldCapture;
        return;
      }
      case ClassComponent: {
        const instance = workInProgress.stateNode;
        const ctor = workInProgress.type;
        const canCapture =
          (workInProgress.flags & DidCapture) === 0 &&
          (typeof ctor.getDerivedStateFromError === "function" ||
            (instance !== null &&
              typeof instance.componentDidCatch === "function" &&
              !isAlreadyFailedLegacyErrorBoundary(instance)));
        if (canCapture) {
          const update = createClassErrorUpdate(workInProgress, value, lane);
          enqueueCapturedUpdate(workInProgress, update);
          workInProgress.flags |= ShouldCapture;
          return;
        }
        break;
      }
    }
    workInProgress = workInProgress.return;
  }
}
