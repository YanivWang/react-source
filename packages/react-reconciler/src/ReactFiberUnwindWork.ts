import { popRenderLanes } from "./ReactFiberWorkLoop";
import { popSuspenseContext } from "./ReactFiberSuspenseContext";
/**
 * @file unwind：completeUnitOfWork 的 Incomplete 分支专用
 * @description 对照官方 packages/react-reconciler/src/ReactFiberUnwindWork.js：沿 return 链
 * 向上找到 throwException 标记了 ShouldCapture 的边界 fiber，把它翻转成 DidCapture 并作为
 * 下一个 workInProgress 重新进入 beginWork（渡染 fallback）；路过的 ContextProvider 等带栈
 * 结构的 fiber 需要主动 pop，否则栈会因为它跳过了自己的 completeWork 而错位。
 */

import type { FiberNode } from "./ReactFiber";
import {
  ClassComponent,
  ContextProvider,
  HostRoot,
  HostComponent,
  HostPortal,
  SuspenseComponent,
  OffscreenComponent,
} from "./ReactWorkTags";
import { DidCapture, NoFlags, ShouldCapture } from "./ReactFiberFlags";
import { popProvider } from "./ReactFiberNewContext";
import type { ReactContext } from "shared/ReactTypes";
import { popHostContainer, popHostContext } from "./ReactFiberHostContext";

export function unwindWork(workInProgress: FiberNode): FiberNode | null {
  if (workInProgress.tag === HostRoot || workInProgress.tag === HostPortal)
    popHostContainer(workInProgress);
  else if (workInProgress.tag === HostComponent) popHostContext(workInProgress);
  switch (workInProgress.tag) {
    case ClassComponent:
    case HostRoot: {
      const flags = workInProgress.flags;
      if ((flags & ShouldCapture) !== NoFlags) {
        workInProgress.flags = (flags & ~ShouldCapture) | DidCapture;
        return workInProgress;
      }
      return null;
    }
    // 对照官方：Suspense 边界与 ClassComponent/HostRoot 走同一套 ShouldCapture -> DidCapture
    // 翻转，唯一区别是不带 update（不复用 CaptureUpdate 那条路径）——重新进入 beginWork 时，
    // updateSuspenseComponent 直接读 DidCapture 决定渲染 fallback，不需要经过 updateQueue。
    case SuspenseComponent: {
      popSuspenseContext(workInProgress);
      const flags = workInProgress.flags;
      if ((flags & ShouldCapture) !== NoFlags) {
        workInProgress.flags = (flags & ~ShouldCapture) | DidCapture;
        return workInProgress;
      }
      return null;
    }
    case OffscreenComponent:
      popRenderLanes(workInProgress);
      return null;
    case ContextProvider: {
      const context: ReactContext<any> = workInProgress.type._context;
      popProvider(context, workInProgress);
      return null;
    }
    default:
      return null;
  }
}

// 抢占/切换 root 时并非错误恢复；只还原已压栈的祖先，不消费 ShouldCapture。
export function unwindInterruptedWork(workInProgress: FiberNode): void {
  if (workInProgress.tag === SuspenseComponent)
    popSuspenseContext(workInProgress);
  if (workInProgress.tag === OffscreenComponent) popRenderLanes(workInProgress);
  if (workInProgress.tag === HostRoot || workInProgress.tag === HostPortal)
    popHostContainer(workInProgress);
  else if (workInProgress.tag === HostComponent) popHostContext(workInProgress);
  if (workInProgress.tag === ContextProvider) {
    popProvider(workInProgress.type._context, workInProgress);
  }
}
