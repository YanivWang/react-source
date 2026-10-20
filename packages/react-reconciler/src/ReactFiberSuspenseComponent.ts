import type { FiberNode } from "./ReactFiber";
import type { Lane } from "./ReactFiberLane";

// React v18.3.1 ReactFiberSuspenseComponent.new.js；客户端范围不含 dehydrated/treeContext。
export interface SuspenseState {
  retryLane: Lane;
}

export function shouldCaptureSuspense(workInProgress: FiberNode): boolean {
  // fallback 自己挂起应交给外层，不能重新捕获到正在渲染 fallback 的同一边界。
  return workInProgress.memoizedState === null;
}
