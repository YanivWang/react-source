import {
  popRenderLanes,
  renderDidSuspend,
  renderDidSuspendDelayIfPossible,
} from "./ReactFiberWorkLoop";
import {
  popSuspenseContext,
  suspenseStackCursor,
  InvisibleParentSuspenseContext,
} from "./ReactFiberSuspenseContext";
import { ConcurrentMode, NoMode } from "./ReactTypeOfMode";
import { OffscreenLane, includesSomeLane } from "./ReactFiberLane";
/**
 * @file completeWork（Fiber 树构建 - 向上归阶段）
 * @description 对 Fiber 执行"归"阶段：创建真实 DOM 节点（HostComponent/HostText），
 * 把子节点的副作用标记汇总到父节点（bubbleProperties）
 */

import type { ReactContext } from "shared/ReactTypes";

import type { FiberNode } from "./ReactFiber";
import {
  NoFlags,
  Placement,
  Update,
  Visibility,
  StaticMask,
  Snapshot,
  type Flags,
} from "./ReactFiberFlags";
import {
  appendInitialChild,
  createInstance,
  createTextInstance,
  finalizeInitialChildren,
  preparePortalMount,
  prepareUpdate,
  supportsMutation,
} from "./ReactFiberHostConfig";
import {
  getHostContext,
  getRootHostContainer,
  popHostContext,
  popHostContainer,
} from "./ReactFiberHostContext";
import { NoLanes, mergeLanes, type Lanes } from "./ReactFiberLane";
import { popProvider } from "./ReactFiberNewContext";
import {
  ClassComponent,
  ContextConsumer,
  ContextProvider,
  ForwardRef,
  Fragment,
  FunctionComponent,
  HostComponent,
  HostPortal,
  HostRoot,
  HostText,
  IndeterminateComponent,
  MemoComponent,
  Mode,
  OffscreenComponent,
  SuspenseComponent,
} from "./ReactWorkTags";
import type { OffscreenState } from "./ReactFiberOffscreenComponent";
import type { SuspenseState } from "./ReactFiberSuspenseComponent";

function markUpdate(workInProgress: FiberNode): void {
  // 打 Update 标记：让 Placement 变成 PlacementAndUpdate
  workInProgress.flags |= Update;
}

// 对照官方 appendAllChildren（mutation 模式）：completeWork 创建父节点时，子节点的真实 DOM
// 已经在各自的 completeWork 里创建好了（挂在 fiber.stateNode），这里深度优先把子树里所有
// HostComponent/HostText 的 stateNode append 到父节点，完成真实 DOM 树的组装。
function appendAllChildren(
  parent: any,
  workInProgress: FiberNode,
  _needsVisibilityToggle: boolean,
  _isHidden: boolean,
): void {
  if (!supportsMutation) {
    return;
  }
  let node = workInProgress.child;
  while (node !== null) {
    if (node.tag === HostComponent || node.tag === HostText) {
      appendInitialChild(parent, node.stateNode);
    } else if (node.tag === HostPortal) {
      // portal 的子节点不挂到当前树，由 portal 自己的 commit 处理
    } else if (node.child !== null) {
      node.child.return = node;
      node = node.child;
      continue;
    }
    if (node === workInProgress) {
      return;
    }
    while (node.sibling === null) {
      if (node.return === null || node.return === workInProgress) {
        return;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

// 对照官方 updateHostComponent（mutation 模式）：更新时对比新旧 props，生成 updatePayload
// 挂到 fiber.updateQueue，等 commit 阶段 commitUpdate 消费。
function updateHostComponent(
  current: FiberNode,
  workInProgress: FiberNode,
  type: any,
  newProps: any,
): void {
  const oldProps = current.memoizedProps;
  if (oldProps === newProps) {
    // mutation 模式下 props 没变就可以直接 bailout（子节点的变更不影响这个节点）
    return;
  }

  const instance = workInProgress.stateNode;
  const currentHostContext = getHostContext();
  const updatePayload = prepareUpdate(
    instance,
    type,
    oldProps,
    newProps,
    getRootHostContainer(),
    currentHostContext,
  );
  workInProgress.updateQueue = updatePayload;
  // 只有真正有变化（updatePayload 非空）才标记 Update
  if (updatePayload) {
    markUpdate(workInProgress);
  }
}

function updateHostText(
  _current: FiberNode,
  workInProgress: FiberNode,
  oldText: string,
  newText: string,
): void {
  // 文本变了就标记 Update，具体更新在 commitWork
  if (oldText !== newText) {
    markUpdate(workInProgress);
  }
}

// 对照官方 bubbleProperties：把子树的 flags/lanes 汇总到父节点。didBailout 时只冒泡静态标记
// 非 bailout 时冒泡全部 flags。
// 同时把子树里最早的优先级冒泡到 childLanes。
function bubbleProperties(completedWork: FiberNode): boolean {
  const didBailout =
    completedWork.alternate !== null &&
    completedWork.alternate.child === completedWork.child;

  let newChildLanes: Lanes = NoLanes;
  let subtreeFlags: Flags = NoFlags;

  let child = completedWork.child;
  while (child !== null) {
    newChildLanes = mergeLanes(
      newChildLanes,
      mergeLanes(child.lanes, child.childLanes),
    );

    if (didBailout) {
      subtreeFlags |= child.subtreeFlags & StaticMask;
      subtreeFlags |= child.flags & StaticMask;
    } else {
      subtreeFlags |= child.subtreeFlags;
      subtreeFlags |= child.flags;
    }

    // 修正 return 指针，保证整棵树结构一致（假定 commit 阶段不与 render 阶段并发）
    child.return = completedWork;

    child = child.sibling;
  }

  completedWork.subtreeFlags |= subtreeFlags;
  completedWork.childLanes = newChildLanes;

  return didBailout;
}

function completeWork(
  current: FiberNode | null,
  workInProgress: FiberNode,
  renderLanes: Lanes,
): FiberNode | null {
  const newProps = workInProgress.pendingProps;

  switch (workInProgress.tag) {
    case IndeterminateComponent:
    case FunctionComponent:
    case ClassComponent:
    case Fragment:
    case Mode:
    case ContextConsumer:
    case ForwardRef:
    case MemoComponent:
      bubbleProperties(workInProgress);
      return null;
    case ContextProvider: {
      const context: ReactContext<any> = workInProgress.type._context;
      popProvider(context, workInProgress);
      bubbleProperties(workInProgress);
      return null;
    }
    case HostRoot: {
      popHostContainer(workInProgress);
      const fiberRoot = workInProgress.stateNode;
      if (current === null || current.child === null) {
        workInProgress.flags |= Snapshot;
      }
      if (fiberRoot.pendingContext) {
        fiberRoot.context = fiberRoot.pendingContext;
        fiberRoot.pendingContext = null;
      }
      bubbleProperties(workInProgress);
      return null;
    }
    case HostPortal: {
      popHostContainer(workInProgress);
      if (current === null)
        preparePortalMount(workInProgress.stateNode.containerInfo);
      // 官方在 mutation 模式下 updateHostContainer 是 no-op（Portal 的容器不会变，
      // 变了会被当成新建/新的 Portal 处理），popHostContainer/preparePortalMount 依赖的
      // host context 栈本项目未落地（同 attemptEarlyBailoutIfNoScheduledUpdate 的取舍），
      // 这里只需要 bubbleProperties 把子树 flags/lanes 冒泡上去。
      bubbleProperties(workInProgress);
      return null;
    }
    case HostComponent: {
      popHostContext(workInProgress);
      const type = workInProgress.type;
      if (current !== null && workInProgress.stateNode != null) {
        updateHostComponent(current, workInProgress, type, newProps);
        // ref 变更标记留到 Phase 9 forwardRef 落地时补
      } else {
        if (!newProps) {
          if (workInProgress.stateNode === null) {
            throw new Error(
              "We must have new props for new mounts. This error is likely " +
                "caused by a bug in React. Please file an issue.",
            );
          }
          // 中断恢复场景（abort work），本项目尚未实现可中断渲染
          bubbleProperties(workInProgress);
          return null;
        }

        const currentHostContext = getHostContext();
        const instance = createInstance(
          type,
          newProps,
          getRootHostContainer(),
          currentHostContext,
          workInProgress,
        );

        appendAllChildren(instance, workInProgress, false, false);

        workInProgress.stateNode = instance;

        // 某些渲染器需要在 commit 阶段执行的初始副作用（如 DOM 的 autofocus）
        if (
          finalizeInitialChildren(
            instance,
            type,
            newProps,
            getRootHostContainer(),
            currentHostContext,
          )
        ) {
          markUpdate(workInProgress);
        }
      }
      bubbleProperties(workInProgress);
      return null;
    }
    case HostText: {
      const newText = newProps;
      if (current !== null && workInProgress.stateNode != null) {
        const oldText = current.memoizedProps;
        updateHostText(current, workInProgress, oldText, newText);
      } else {
        if (typeof newText !== "string") {
          if (workInProgress.stateNode === null) {
            throw new Error(
              "We must have new props for new mounts. This error is likely " +
                "caused by a bug in React. Please file an issue.",
            );
          }
          // 中断恢复场景
        }
        workInProgress.stateNode = createTextInstance(
          newText,
          getRootHostContainer(),
          getHostContext(),
          workInProgress,
        );
      }
      bubbleProperties(workInProgress);
      return null;
    }
    case SuspenseComponent: {
      popSuspenseContext(workInProgress);
      // DidCapture 未被 beginWork 清掉（updateSuspenseComponent 命中挂起分支会清掉它，
      // 这里能看到说明是嵌套 Suspense 的外层，本次遍历不用管，交给外层自己的完成阶段处理）
      const nextState: SuspenseState | null = workInProgress.memoizedState;
      const prevState: SuspenseState | null =
        current !== null ? current.memoizedState : null;
      // 展示 fallback/primary 的状态发生变化：给内部 Offscreen fiber 打 Visibility flag，
      // 供 commit 阶段 hideOrUnhideAllChildren 实际切换 DOM 显隐
      if ((nextState === null) !== (prevState === null)) {
        const offscreenFiber = workInProgress.child as FiberNode;
        offscreenFiber.flags |= Visibility;
        if (
          nextState !== null &&
          (workInProgress.mode & ConcurrentMode) !== NoMode
        ) {
          if (
            current === null ||
            (suspenseStackCursor.current & InvisibleParentSuspenseContext) !== 0
          )
            renderDidSuspend();
          else renderDidSuspendDelayIfPossible();
        }
      }
      // updateQueue 是 attachRetryListener 存的 Set<Wakeable>，非空说明本次渲染新挂起了，
      // 需要在 commit 阶段真正挂上 wakeable.then 监听
      if (workInProgress.updateQueue !== null) {
        workInProgress.flags |= Update;
      }
      bubbleProperties(workInProgress);
      return null;
    }
    case OffscreenComponent: {
      popRenderLanes(workInProgress);
      const nextState: OffscreenState | null = workInProgress.memoizedState;
      const prevState: OffscreenState | null =
        current !== null ? current.memoizedState : null;
      if ((nextState === null) !== (prevState === null)) {
        workInProgress.flags |= Visibility;
      }
      if (
        nextState === null ||
        (workInProgress.mode & ConcurrentMode) === NoMode ||
        includesSomeLane(renderLanes, OffscreenLane)
      ) {
        bubbleProperties(workInProgress);
        if (
          nextState !== null &&
          (workInProgress.subtreeFlags & (Placement | Update)) !== NoFlags
        )
          workInProgress.flags |= Visibility;
      }
      return null;
    }
  }

  throw new Error(
    `Unknown unit of work tag (${workInProgress.tag}). This error is likely caused by a bug in ` +
      "React. Please file an issue.",
  );
}

export { completeWork };
