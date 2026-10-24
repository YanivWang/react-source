/**
 * @file commit 阶段（mutation 子阶段）
 * @description 将 render 阶段构建好的 Fiber 树变更应用到真实 DOM：插入/更新/删除
 */

import type { FiberNode } from "./ReactFiber";
import { onCommitUnmount } from "./ReactFiberDevToolsHook";
import {
  Callback,
  ChildDeletion,
  ContentReset,
  Passive,
  LayoutMask,
  MountLayoutDev,
  MountPassiveDev,
  MutationMask,
  PassiveMask,
  Placement,
  Ref,
  Snapshot,
  Update,
  Visibility,
} from "./ReactFiberFlags";
import {
  appendChild,
  appendChildToContainer,
  commitTextUpdate,
  commitUpdate,
  clearContainer,
  resetTextContent,
  hideInstance,
  hideTextInstance,
  insertBefore,
  insertInContainerBefore,
  removeChild,
  removeChildFromContainer,
  supportsMutation,
  unhideInstance,
  unhideTextInstance,
} from "./ReactFiberHostConfig";
import type { Lanes } from "./ReactFiberLane";
import type { FiberRootNode } from "./ReactFiberRoot";
import type { Effect, FunctionComponentUpdateQueue } from "./ReactFiberHooks";
import { commitUpdateQueue } from "./ReactFiberClassUpdateQueue";
import {
  HasEffect as HookHasEffect,
  Insertion as HookInsertion,
  Layout as HookLayout,
  Passive as HookPassive,
  type HookFlags,
} from "./ReactHookEffectTags";
import {
  ClassComponent,
  ForwardRef,
  FunctionComponent,
  HostComponent,
  HostPortal,
  HostRoot,
  HostText,
  MemoComponent,
  OffscreenComponent,
  SuspenseComponent,
} from "./ReactWorkTags";
import type { OffscreenInstance } from "./ReactFiberOffscreenComponent";
import type { Wakeable } from "shared/ReactTypes";
import {
  captureCommitPhaseError,
  resolveRetryWakeable,
} from "./ReactFiberWorkLoop";

// 删除操作需要在向上回溯过程中临时记住"最近的 host 父节点"，官方用模块级变量在
// commitDeletionEffectsOnFiber 递归间传递。
let hostParent: any = null;
let hostParentIsContainer = false;
let offscreenSubtreeWasHidden = false;

// 对照官方 commitHookEffectListMount：遍历 fiber.updateQueue（Hook effect 的循环链表），
// 只执行 tag 与 flags 按位匹配的 effect（HookHasEffect 标记 deps 是否变化，
// HookLayout/HookPassive 区分 effect 类型）。create 的返回值存回 effect.destroy，
// 供下次卸载/重新执行时调用。
function commitHookEffectListMount(
  flags: HookFlags,
  finishedWork: FiberNode,
): void {
  const updateQueue: FunctionComponentUpdateQueue | null =
    finishedWork.updateQueue;
  const lastEffect = updateQueue !== null ? updateQueue.lastEffect : null;
  if (lastEffect !== null) {
    const firstEffect = lastEffect.next;
    let effect: Effect = firstEffect;
    do {
      if ((effect.tag & flags) === flags) {
        const create = effect.create;
        try {
          effect.destroy = create();
        } catch (error) {
          captureCommitPhaseError(finishedWork, finishedWork.return, error);
        }
      }
      effect = effect.next;
    } while (effect !== firstEffect);
  }
}

// 对照官方 commitHookEffectListUnmount：同样按位匹配遍历，调用缓存的 destroy 并清空，
// 避免重复调用（对应 deps 不变、effect 未重新执行的场景不会被这里影响）。
function commitHookEffectListUnmount(
  flags: HookFlags,
  finishedWork: FiberNode,
  nearestMountedAncestor: FiberNode | null = finishedWork.return,
): void {
  const updateQueue: FunctionComponentUpdateQueue | null =
    finishedWork.updateQueue;
  const lastEffect = updateQueue !== null ? updateQueue.lastEffect : null;
  if (lastEffect !== null) {
    const firstEffect = lastEffect.next;
    let effect: Effect = firstEffect;
    do {
      if ((effect.tag & flags) === flags) {
        const destroy = effect.destroy;
        if (destroy !== undefined) {
          effect.destroy = undefined;
          try {
            destroy();
          } catch (error) {
            captureCommitPhaseError(
              finishedWork,
              nearestMountedAncestor,
              error,
            );
          }
        }
      }
      effect = effect.next;
    } while (effect !== firstEffect);
  }
}

function isHostParent(fiber: FiberNode): boolean {
  return (
    fiber.tag === HostComponent ||
    fiber.tag === HostRoot ||
    fiber.tag === HostPortal
  );
}

// 对照官方 commitAttachRef：ref 挂到 stateNode 上（函数形式调用 ref(instance)，对象形式赋
// ref.current = instance）。HostComponent 官方还会转成 getPublicInstance(instance)（DOM 场景
// 就是节点本身，本项目 HostConfig 未实现该接口，直接用 stateNode，效果一致）。
// 字符串 ref 的自动转换未实现（对照 ReactFiber.ts 的取舍），这里不处理 string 分支。
function commitAttachRef(finishedWork: FiberNode): void {
  const ref = finishedWork.ref;
  if (ref !== null && typeof ref !== "string") {
    const instanceToUse = finishedWork.stateNode;
    if (typeof ref === "function") {
      ref(instanceToUse);
    } else {
      ref.current = instanceToUse;
    }
  }
}

// 对照官方 commitDetachRef：卸载/ref 变化时清空旧 ref（函数形式调用 ref(null)）
function commitDetachRef(current: FiberNode): void {
  const currentRef = current.ref;
  if (currentRef !== null && typeof currentRef !== "string") {
    if (typeof currentRef === "function") {
      currentRef(null);
    } else {
      currentRef.current = null;
    }
  }
}

// 对照官方安全调用：commit 阶段的 ref/生命周期异常交给仍挂载的错误边界。
function safelyDetachRef(
  fiber: FiberNode,
  nearestMountedAncestor: FiberNode | null,
): void {
  try {
    commitDetachRef(fiber);
  } catch (error) {
    captureCommitPhaseError(fiber, nearestMountedAncestor, error);
  }
}
function safelyCallComponentWillUnmount(
  fiber: FiberNode,
  nearestMountedAncestor: FiberNode | null,
): void {
  try {
    fiber.stateNode.componentWillUnmount?.();
  } catch (error) {
    captureCommitPhaseError(fiber, nearestMountedAncestor, error);
  }
}

function getHostParentFiber(fiber: FiberNode): FiberNode {
  let parent = fiber.return;
  while (parent !== null) {
    if (isHostParent(parent)) {
      return parent;
    }
    parent = parent.return;
  }

  throw new Error(
    "Expected to find a host parent. This error is likely caused by a bug " +
      "in React. Please file an issue.",
  );
}

// 找已提交的、稳定的兄弟 host 节点（作为 insertBefore 的锚点）。只找不带有 Placement 的
// 兄弟节点，带 Placement 的说明它自己也还没插入。
function getHostSibling(fiber: FiberNode): any {
  let node: FiberNode = fiber;
  siblings: while (true) {
    while (node.sibling === null) {
      if (node.return === null || isHostParent(node.return)) {
        return null;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
    while (node.tag !== HostComponent && node.tag !== HostText) {
      if (node.flags & Placement) {
        continue siblings;
      }
      if (node.child === null || node.tag === HostPortal) {
        continue siblings;
      } else {
        node.child.return = node;
        node = node.child;
      }
    }
    // 找到一个稳定或即将插入的 host 节点
    if (!(node.flags & Placement)) {
      return node.stateNode;
    }
  }
}

// 递归地把 Placement 子树里的所有 host 节点插入到父容器
function insertOrAppendPlacementNodeIntoContainer(
  node: FiberNode,
  before: any,
  parent: any,
): void {
  const tag = node.tag;
  const isHost = tag === HostComponent || tag === HostText;
  if (isHost) {
    const stateNode = node.stateNode;
    if (before) {
      insertInContainerBefore(parent, stateNode, before);
    } else {
      appendChildToContainer(parent, stateNode);
    }
  } else if (tag === HostPortal) {
    // portal 自己负责插入其子树
  } else {
    const child = node.child;
    if (child !== null) {
      insertOrAppendPlacementNodeIntoContainer(child, before, parent);
      let sibling = child.sibling;
      while (sibling !== null) {
        insertOrAppendPlacementNodeIntoContainer(sibling, before, parent);
        sibling = sibling.sibling;
      }
    }
  }
}

function insertOrAppendPlacementNode(
  node: FiberNode,
  before: any,
  parent: any,
): void {
  const tag = node.tag;
  const isHost = tag === HostComponent || tag === HostText;
  if (isHost) {
    const stateNode = node.stateNode;
    if (before) {
      insertBefore(parent, stateNode, before);
    } else {
      appendChild(parent, stateNode);
    }
  } else if (tag === HostPortal) {
    // portal 自己负责插入其子树
  } else {
    const child = node.child;
    if (child !== null) {
      insertOrAppendPlacementNode(child, before, parent);
      let sibling = child.sibling;
      while (sibling !== null) {
        insertOrAppendPlacementNode(sibling, before, parent);
        sibling = sibling.sibling;
      }
    }
  }
}

function commitPlacement(finishedWork: FiberNode): void {
  if (!supportsMutation) {
    return;
  }

  // 向上找到最近的 host 父 fiber，把整棵 Placement 子树插入
  const parentFiber = getHostParentFiber(finishedWork);
  switch (parentFiber.tag) {
    case HostComponent: {
      const parent = parentFiber.stateNode;
      if (parentFiber.flags & ContentReset) {
        resetTextContent(parent);
        parentFiber.flags &= ~ContentReset;
      }
      const before = getHostSibling(finishedWork);
      insertOrAppendPlacementNode(finishedWork, before, parent);
      break;
    }
    case HostRoot:
    case HostPortal: {
      const parent = parentFiber.stateNode.containerInfo;
      const before = getHostSibling(finishedWork);
      insertOrAppendPlacementNodeIntoContainer(finishedWork, before, parent);
      break;
    }
    default:
      throw new Error(
        "Invalid host parent fiber. This error is likely caused by a bug " +
          "in React. Please file an issue.",
      );
  }
}

function commitReconciliationEffects(finishedWork: FiberNode): void {
  const flags = finishedWork.flags;
  if (flags & Placement) {
    try {
      commitPlacement(finishedWork);
    } catch (error) {
      // 错误边界捕获留到 Phase 9
      throw error;
    }
    // 清除 Placement 标记，表示节点已插入（isMounted 等依赖这一点）
    finishedWork.flags &= ~Placement;
  }
}

function recursivelyTraverseDeletionEffects(
  _finishedRoot: FiberRootNode,
  _nearestMountedAncestor: FiberNode,
  parent: FiberNode,
): void {
  // 递归删除子节点（Phase 5 时这里会卸载 effect，现在只需移除 host 节点）
  let child = parent.child;
  while (child !== null) {
    commitDeletionEffectsOnFiber(_finishedRoot, _nearestMountedAncestor, child);
    child = child.sibling;
  }
}

function commitDeletionEffectsOnFiber(
  finishedRoot: FiberRootNode,
  nearestMountedAncestor: FiberNode,
  deletedFiber: FiberNode,
): void {
  onCommitUnmount(deletedFiber);
  switch (deletedFiber.tag) {
    case HostComponent: {
      // 先清 ref，随后故意 fall through 到 HostText 分支——
      // 宿主的子节点由它自己整体移除，所以递归时把 hostParent 置空，避免子节点重复 remove
      if (!offscreenSubtreeWasHidden)
        safelyDetachRef(deletedFiber, nearestMountedAncestor);
    }
    case HostText: {
      // 只需移除最近的宿主子节点：递归期间 hostParent 置空，嵌套的 host 节点不会各自 remove，
      // 因为它们已经随着顶层节点一起被移除了
      if (supportsMutation) {
        const prevHostParent = hostParent;
        const prevHostParentIsContainer = hostParentIsContainer;
        hostParent = null;
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber,
        );
        hostParent = prevHostParent;
        hostParentIsContainer = prevHostParentIsContainer;

        if (hostParent !== null) {
          if (hostParentIsContainer) {
            removeChildFromContainer(hostParent, deletedFiber.stateNode);
          } else {
            removeChild(hostParent, deletedFiber.stateNode);
          }
        }
      } else {
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber,
        );
      }
      return;
    }
    case HostRoot: {
      recursivelyTraverseDeletionEffects(
        finishedRoot,
        nearestMountedAncestor,
        deletedFiber,
      );
      return;
    }
    case HostPortal: {
      // 进入 Portal 后，"最近的宿主父节点"切换成 Portal 自己的容器——子树里的 host 节点
      // 应该从这个容器里移除，不是外层 hostParent（对照官方：递归期间临时替换 hostParent/
      // hostParentIsContainer，退出后恢复原值）。
      if (supportsMutation) {
        const prevHostParent = hostParent;
        const prevHostParentIsContainer = hostParentIsContainer;
        hostParent = deletedFiber.stateNode.containerInfo;
        hostParentIsContainer = true;
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber,
        );
        hostParent = prevHostParent;
        hostParentIsContainer = prevHostParentIsContainer;
      } else {
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber,
        );
      }
      return;
    }
    case FunctionComponent:
    case ForwardRef:
    case MemoComponent: {
      // 整棵组件被卸载：不管 deps 上次是否变化（HookHasEffect 未打也要清理），
      // 所有 layout/passive effect 的 destroy 都必须执行一次，否则会漏清理订阅等资源
      // （MemoComponent 本身没有 hook updateQueue，这里调用是安全的空操作，只为与官方
      // case 分组保持一致，真正的清理发生在它包裹的内部 fiber 上）
      commitHookEffectListUnmount(
        HookInsertion,
        deletedFiber,
        nearestMountedAncestor,
      );
      if (!offscreenSubtreeWasHidden)
        commitHookEffectListUnmount(
          HookLayout,
          deletedFiber,
          nearestMountedAncestor,
        );
      recursivelyTraverseDeletionEffects(
        finishedRoot,
        nearestMountedAncestor,
        deletedFiber,
      );
      return;
    }
    case ClassComponent: {
      // 从仍挂载的祖先捕获卸载错误，随后继续清理其余子节点。
      if (!offscreenSubtreeWasHidden) {
        safelyDetachRef(deletedFiber, nearestMountedAncestor);
        safelyCallComponentWillUnmount(deletedFiber, nearestMountedAncestor);
      }
      recursivelyTraverseDeletionEffects(
        finishedRoot,
        nearestMountedAncestor,
        deletedFiber,
      );
      return;
    }
    case OffscreenComponent: {
      const previous = offscreenSubtreeWasHidden;
      offscreenSubtreeWasHidden =
        previous || deletedFiber.memoizedState !== null;
      recursivelyTraverseDeletionEffects(
        finishedRoot,
        nearestMountedAncestor,
        deletedFiber,
      );
      offscreenSubtreeWasHidden = previous;
      return;
    }
    default: {
      // Fragment/Mode 等没有自己 DOM 的节点：保持 hostParent 不变，继续向下找可移除的 host 节点
      recursivelyTraverseDeletionEffects(
        finishedRoot,
        nearestMountedAncestor,
        deletedFiber,
      );
    }
  }
}

function commitDeletionEffects(
  root: FiberRootNode,
  returnFiber: FiberNode,
  deletedFiber: FiberNode,
): void {
  if (supportsMutation) {
    // 先向上找最近的 host 父节点（在 fiber 树上搜索，而不是走 JS 调用栈）
    let parent = returnFiber;
    findParent: while (parent !== null) {
      switch (parent.tag) {
        case HostComponent: {
          hostParent = parent.stateNode;
          hostParentIsContainer = false;
          break findParent;
        }
        case HostRoot: {
          hostParent = parent.stateNode.containerInfo;
          hostParentIsContainer = true;
          break findParent;
        }
        case HostPortal: {
          hostParent = parent.stateNode.containerInfo;
          hostParentIsContainer = true;
          break findParent;
        }
      }
      parent = parent.return!;
    }
    if (hostParent === null) {
      throw new Error(
        "Expected to find a host parent. This error is likely caused by " +
          "a bug in React. Please file an issue.",
      );
    }
    commitDeletionEffectsOnFiber(root, returnFiber, deletedFiber);
    hostParent = null;
    hostParentIsContainer = false;
  }
}

function recursivelyTraverseBeforeMutationEffects(
  root: FiberRootNode,
  parentFiber: FiberNode,
): void {
  if (parentFiber.subtreeFlags & Snapshot) {
    let child = parentFiber.child;
    while (child !== null) {
      commitBeforeMutationEffectsOnFiber(root, child);
      child = child.sibling;
    }
  }
}

// 对照官方 commitBeforeMutationEffectsOnFiber：mutation 之前的一次遍历，只处理
// getSnapshotBeforeUpdate——它必须在 DOM 变更之前读（比如滚动位置），读到的值挂在实例的
// __reactInternalSnapshotBeforeUpdate 上，供 layout 阶段的 componentDidUpdate 取用。
function commitBeforeMutationEffectsOnFiber(
  root: FiberRootNode,
  finishedWork: FiberNode,
): void {
  try {
    const flags = finishedWork.flags;

    switch (finishedWork.tag) {
      case HostRoot: {
        recursivelyTraverseBeforeMutationEffects(root, finishedWork);
        if (flags & Snapshot) clearContainer(root.containerInfo);
        return;
      }
      case ClassComponent: {
        recursivelyTraverseBeforeMutationEffects(root, finishedWork);
        if (flags & Snapshot) {
          const current = finishedWork.alternate;
          const instance = finishedWork.stateNode;
          if (current !== null) {
            const prevProps = current.memoizedProps;
            const prevState = current.memoizedState;
            instance.__reactInternalSnapshotBeforeUpdate =
              instance.getSnapshotBeforeUpdate(prevProps, prevState);
          }
        }
        return;
      }
      default: {
        recursivelyTraverseBeforeMutationEffects(root, finishedWork);
        return;
      }
    }
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

export function commitBeforeMutationEffects(
  root: FiberRootNode,
  finishedWork: FiberNode,
): void {
  commitBeforeMutationEffectsOnFiber(root, finishedWork);
}

function recursivelyTraverseMutationEffects(
  root: FiberRootNode,
  parentFiber: FiberNode,
  lanes: Lanes,
): void {
  // 删除副作用可以出现在任何 fiber 类型上，且必须先于子树 effect 执行
  const deletions = parentFiber.deletions;
  if (deletions !== null) {
    for (let i = 0; i < deletions.length; i++) {
      const childToDelete = deletions[i];
      commitDeletionEffects(root, parentFiber, childToDelete);
    }
  }

  if (parentFiber.subtreeFlags & MutationMask) {
    let child = parentFiber.child;
    while (child !== null) {
      commitMutationEffectsOnFiber(child, root, lanes);
      child = child.sibling;
    }
  }
}

// 对照官方 hideOrUnhideAllChildren：只递归到子树里最外层的 host 节点就停手——嵌套的
// Offscreen 如果自己也是隐藏态，它内部的 host 节点已经被隐藏过，不需要重复处理。
function hideOrUnhideAllChildren(
  finishedWork: FiberNode,
  isHidden: boolean,
): void {
  let node: FiberNode = finishedWork;
  while (true) {
    if (node.tag === HostComponent) {
      const instance = node.stateNode;
      if (isHidden) {
        hideInstance(instance);
      } else {
        unhideInstance(instance, node.memoizedProps);
      }
    } else if (node.tag === HostText) {
      const instance = node.stateNode;
      if (isHidden) {
        hideTextInstance(instance);
      } else {
        unhideTextInstance(instance, node.memoizedProps);
      }
    } else if (
      node.tag === OffscreenComponent &&
      node.memoizedState !== null &&
      node !== finishedWork
    ) {
      // 已经隐藏的内层边界保持隐藏；可见的嵌套边界仍须随外层隐藏。
    } else if (node.child !== null) {
      node.child.return = node;
      node = node.child;
      continue;
    }
    if (node === finishedWork) {
      return;
    }
    while (node.sibling === null) {
      if (node.return === null || node.return === finishedWork) {
        return;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

// 对照官方 attachSuspenseRetryListeners：从 Suspense 边界的 updateQueue（Set<Wakeable>，
// throwException 阶段的 attachRetryListener 写入）取出本次新挂起的 wakeable，用
// finishedWork.stateNode 上的 retry 缓存去重，避免同一个 wakeable 被挂多次 then 监听。
function attachSuspenseRetryListeners(finishedWork: FiberNode): void {
  const wakeables: Set<Wakeable> | null = finishedWork.updateQueue;
  if (wakeables === null) {
    return;
  }
  finishedWork.updateQueue = null;

  let retryCache: Set<Wakeable> | null = finishedWork.stateNode;
  if (retryCache === null) {
    retryCache = new Set();
    finishedWork.stateNode = retryCache;
  }

  wakeables.forEach((wakeable) => {
    if (!retryCache!.has(wakeable)) {
      retryCache!.add(wakeable);
      const retry = resolveRetryWakeable.bind(null, finishedWork, wakeable);
      wakeable.then(retry, retry);
    }
  });
}

function commitMutationEffectsOnFiber(
  finishedWork: FiberNode,
  root: FiberRootNode,
  lanes: Lanes,
): void {
  try {
    const current = finishedWork.alternate;
    const flags = finishedWork.flags;

    switch (finishedWork.tag) {
      case HostComponent: {
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        commitReconciliationEffects(finishedWork);

        if (flags & Ref) {
          if (current !== null && !offscreenSubtreeWasHidden) {
            safelyDetachRef(current, finishedWork.return);
          }
        }
        if (finishedWork.flags & ContentReset) {
          resetTextContent(finishedWork.stateNode);
          finishedWork.flags &= ~ContentReset;
        }

        if (flags & Update) {
          const instance = finishedWork.stateNode;
          if (instance != null) {
            const newProps = finishedWork.memoizedProps;
            const oldProps =
              current !== null ? current.memoizedProps : newProps;
            const type = finishedWork.type;
            const updatePayload = finishedWork.updateQueue;
            finishedWork.updateQueue = null;
            if (updatePayload !== null) {
              commitUpdate(
                instance,
                updatePayload,
                type,
                oldProps,
                newProps,
                finishedWork,
              );
            }
          }
        }
        return;
      }
      case HostText: {
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        commitReconciliationEffects(finishedWork);

        if (flags & Update) {
          if (finishedWork.stateNode === null) {
            throw new Error(
              "This should have a text node initialized. This error is likely " +
                "caused by a bug in React. Please file an issue.",
            );
          }
          const textInstance = finishedWork.stateNode;
          const newText = finishedWork.memoizedProps;
          const oldText = current !== null ? current.memoizedProps : newText;
          commitTextUpdate(textInstance, oldText, newText);
        }
        return;
      }
      case HostRoot: {
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        commitReconciliationEffects(finishedWork);
        return;
      }
      case HostPortal: {
        // 官方在 mutation 模式下 Update flag 对应的分支只服务 supportsPersistence
        // （replaceContainerChildren，本项目 supportsPersistence 恒为 false），Portal 自身
        // 无生命周期，行为等同于 Fragment/Mode：只需递归子树并处理 Placement/Deletion。
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        commitReconciliationEffects(finishedWork);
        return;
      }
      case FunctionComponent:
      case ForwardRef:
      case MemoComponent: {
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        commitReconciliationEffects(finishedWork);

        if (flags & Update) {
          // 对照官方：useInsertionEffect 的销毁+挂载都在这里、DOM 变更之后立刻完成——它不像
          // useLayoutEffect 那样把挂载推迟到 commitLayoutEffects，因为它的定位就是"比
          // useLayoutEffect 更早"，必须在浏览器/其他组件读取布局信息之前就把 <style> 插进去。
          commitHookEffectListUnmount(
            HookInsertion | HookHasEffect,
            finishedWork,
          );
          commitHookEffectListMount(
            HookInsertion | HookHasEffect,
            finishedWork,
          );

          // layout effect 的销毁提前到 mutation 阶段（销毁旧值），挂载则统一放到
          // commit 完全结束、root.current 已切换之后的 commitLayoutEffects——这样能保证一棵树里
          // 所有兄弟组件的销毁都先跑完，才轮到任何一个组件挂载新的 layout effect，不会互相干扰。
          // MemoComponent 本身没有 hook updateQueue，这里调用是安全的空操作。
          if (!offscreenSubtreeWasHidden)
            commitHookEffectListUnmount(
              HookLayout | HookHasEffect,
              finishedWork,
            );
        }
        return;
      }
      case ClassComponent: {
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        commitReconciliationEffects(finishedWork);

        if (flags & Ref) {
          if (current !== null && !offscreenSubtreeWasHidden) {
            safelyDetachRef(current, finishedWork.return);
          }
        }
        return;
      }
      case SuspenseComponent: {
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        commitReconciliationEffects(finishedWork);

        // Visibility flag 打在子 Offscreen fiber 上（completeWork 阶段），真正的隐藏/显示
        // 切换由 OffscreenComponent 自己的 case 处理，这里只负责挂 retry 监听
        if (flags & Update) {
          attachSuspenseRetryListeners(finishedWork);
        }
        return;
      }
      case OffscreenComponent: {
        const previous = offscreenSubtreeWasHidden;
        const wasHidden = current !== null && current.memoizedState !== null;
        offscreenSubtreeWasHidden = previous || wasHidden;
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        offscreenSubtreeWasHidden = previous;
        commitReconciliationEffects(finishedWork);

        if (flags & Visibility) {
          const offscreenInstance: OffscreenInstance = finishedWork.stateNode;
          const isHidden = finishedWork.memoizedState !== null;
          offscreenInstance.isHidden = isHidden;
          if (supportsMutation) {
            hideOrUnhideAllChildren(finishedWork, isHidden);
          }
          if (isHidden && !wasHidden && !offscreenSubtreeWasHidden) {
            let child = finishedWork.child;
            while (child !== null) {
              disappearLayoutEffects(child);
              child = child.sibling;
            }
          }
        }
        return;
      }
      default: {
        // Fragment/Mode 等：无自身 DOM，只递归子树并处理 Placement
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        commitReconciliationEffects(finishedWork);
        return;
      }
    }
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

export function commitMutationEffects(
  root: FiberRootNode,
  finishedWork: FiberNode,
  committedLanes: Lanes,
): void {
  offscreenSubtreeWasHidden = false;
  commitMutationEffectsOnFiber(finishedWork, root, committedLanes);
}

function recursivelyTraverseLayoutEffects(
  root: FiberRootNode,
  parentFiber: FiberNode,
): void {
  if (parentFiber.subtreeFlags & LayoutMask) {
    let child = parentFiber.child;
    while (child !== null) {
      commitLayoutEffectsOnFiber(root, child);
      child = child.sibling;
    }
  }
}

// 对照官方 commitLayoutEffectsOnFiber：mutation 阶段结束、root.current 已切换之后的
// 第二次遍历，只挂载 layout effect（销毁已经在 mutation 阶段做过了）。ref 的挂载
// （commitAttachRef）统一放在 switch 之后按 Ref flag 判断，覆盖 HostComponent/ClassComponent/
// ForwardRef 三种持有 stateNode/实例的 fiber（对照官方同一处理方式）。
function commitLayoutEffectsOnFiber(
  root: FiberRootNode,
  finishedWork: FiberNode,
): void {
  try {
    const flags = finishedWork.flags;

    switch (finishedWork.tag) {
      case OffscreenComponent: {
        if (finishedWork.memoizedState !== null) return;
        const previous = offscreenSubtreeWasHidden;
        const wasHidden =
          finishedWork.alternate !== null &&
          finishedWork.alternate.memoizedState !== null;
        offscreenSubtreeWasHidden = previous || wasHidden;
        if (wasHidden && !previous) {
          let child = finishedWork.child;
          while (child !== null) {
            reappearLayoutEffects(child);
            child = child.sibling;
          }
        }
        recursivelyTraverseLayoutEffects(root, finishedWork);
        offscreenSubtreeWasHidden = previous;
        break;
      }
      case FunctionComponent:
      case ForwardRef:
      case MemoComponent: {
        recursivelyTraverseLayoutEffects(root, finishedWork);
        if (flags & Update && !offscreenSubtreeWasHidden) {
          commitHookEffectListMount(HookLayout | HookHasEffect, finishedWork);
        }
        break;
      }
      case HostRoot: {
        recursivelyTraverseLayoutEffects(root, finishedWork);
        if (flags & Callback && finishedWork.updateQueue !== null) {
          const child = finishedWork.child;
          const instance =
            child !== null &&
            (child.tag === HostComponent || child.tag === ClassComponent)
              ? child.stateNode
              : null;
          commitUpdateQueue(finishedWork, finishedWork.updateQueue, instance);
        }
        break;
      }
      case ClassComponent: {
        recursivelyTraverseLayoutEffects(root, finishedWork);
        const instance = finishedWork.stateNode;
        if (flags & Update && !offscreenSubtreeWasHidden) {
          const current = finishedWork.alternate;
          if (current === null) {
            instance.componentDidMount();
          } else {
            const prevProps = current.memoizedProps;
            const prevState = current.memoizedState;
            instance.componentDidUpdate(
              prevProps,
              prevState,
              instance.__reactInternalSnapshotBeforeUpdate,
            );
          }
        }
        if (flags & Callback) {
          commitUpdateQueue(finishedWork, finishedWork.updateQueue, instance);
        }
        break;
      }
      default: {
        recursivelyTraverseLayoutEffects(root, finishedWork);
        break;
      }
    }

    if (flags & Ref && !offscreenSubtreeWasHidden) {
      commitAttachRef(finishedWork);
    }
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

export function commitLayoutEffects(
  finishedWork: FiberNode,
  root: FiberRootNode,
): void {
  offscreenSubtreeWasHidden = false;
  commitLayoutEffectsOnFiber(root, finishedWork);
}

function recursivelyTraversePassiveMountEffects(
  root: FiberRootNode,
  parentFiber: FiberNode,
): void {
  if (parentFiber.subtreeFlags & PassiveMask) {
    let child = parentFiber.child;
    while (child !== null) {
      commitPassiveMountOnFiber(root, child);
      child = child.sibling;
    }
  }
}

// 对照官方 commitPassiveMountOnFiber：commit 完全结束后异步跑的一遍遍历，只挂载
// passive effect（useEffect）。销毁走 commitPassiveUnmountEffects，二者分开跑是因为
// 卸载可能发生在与本次渲染无关的更早 commit 里（比如上次渲染有、这次没有的组件）。
function commitPassiveMountOnFiber(
  root: FiberRootNode,
  finishedWork: FiberNode,
): void {
  const flags = finishedWork.flags;

  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef: {
      recursivelyTraversePassiveMountEffects(root, finishedWork);
      if (flags & Passive) {
        commitHookEffectListMount(HookPassive | HookHasEffect, finishedWork);
      }
      return;
    }
    default: {
      recursivelyTraversePassiveMountEffects(root, finishedWork);
      return;
    }
  }
}

export function commitPassiveMountEffects(
  root: FiberRootNode,
  finishedWork: FiberNode,
): void {
  commitPassiveMountOnFiber(root, finishedWork);
}

// 删除子树的 passive 销毁保留到 passive 阶段；顺序为父到子，与 layout 销毁分开。
function commitPassiveUnmountInsideDeletedTree(
  fiber: FiberNode,
  nearestMountedAncestor: FiberNode,
): void {
  if (
    fiber.tag === FunctionComponent ||
    fiber.tag === ForwardRef ||
    fiber.tag === MemoComponent
  ) {
    commitHookEffectListUnmount(HookPassive, fiber, nearestMountedAncestor);
  }
  let child = fiber.child;
  while (child !== null) {
    commitPassiveUnmountInsideDeletedTree(child, nearestMountedAncestor);
    child = child.sibling;
  }
  fiber.return = null;
  if (fiber.alternate !== null) fiber.alternate.return = null;
}

function recursivelyTraversePassiveUnmountEffects(
  parentFiber: FiberNode,
): void {
  if (parentFiber.flags & ChildDeletion) {
    for (const deleted of parentFiber.deletions ?? []) {
      commitPassiveUnmountInsideDeletedTree(deleted, parentFiber);
    }
    parentFiber.deletions = null;
  }
  if (parentFiber.subtreeFlags & PassiveMask) {
    let child = parentFiber.child;
    while (child !== null) {
      commitPassiveUnmountOnFiber(child);
      child = child.sibling;
    }
  }
}

// 对照官方 commitPassiveUnmountOnFiber：在 commitPassiveMountEffects 之前跑，保证同一个
// 组件"先销毁旧 effect，再挂载新 effect"的顺序（尽管这里销毁的是上一次渲染留下的 destroy，
// 挂载的是本次渲染新 push 的 effect，二者通过 fiber.updateQueue 是同一份数据，销毁一定要
// 先于挂载读到）。
function commitPassiveUnmountOnFiber(finishedWork: FiberNode): void {
  const flags = finishedWork.flags;

  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef: {
      recursivelyTraversePassiveUnmountEffects(finishedWork);
      if (flags & Passive) {
        commitHookEffectListUnmount(HookPassive | HookHasEffect, finishedWork);
      }
      return;
    }
    default: {
      recursivelyTraversePassiveUnmountEffects(finishedWork);
      return;
    }
  }
}

export function commitPassiveUnmountEffects(finishedWork: FiberNode): void {
  commitPassiveUnmountOnFiber(finishedWork);
}

// 对照 commitDoubleInvokeEffectsInDEV：四次独立遍历，不能逐组件销毁后立即重建。
export function commitDoubleInvokeEffectsInDEV(root: FiberNode): void {
  if (!__DEV__) return;
  function visit(fiber: FiberNode, flag: number, mount: boolean): void {
    if (fiber.tag === OffscreenComponent && fiber.memoizedState !== null)
      return;
    let child = fiber.child;
    while (child !== null) {
      visit(child, flag, mount);
      child = child.sibling;
    }
    if ((fiber.flags & flag) !== 0) {
      if (fiber.tag === ClassComponent) {
        const instance = fiber.stateNode;
        try {
          if (mount) instance.componentDidMount?.();
          else instance.componentWillUnmount?.();
        } catch (error) {
          captureCommitPhaseError(fiber, fiber.return, error);
        }
      } else if (mount)
        commitHookEffectListMount(
          flag === MountLayoutDev ? HookLayout : HookPassive,
          fiber,
        );
      else
        commitHookEffectListUnmount(
          flag === MountLayoutDev ? HookLayout : HookPassive,
          fiber,
        );
      if (mount) fiber.flags &= ~flag;
    }
  }
  visit(root, MountLayoutDev, false);
  visit(root, MountPassiveDev, false);
  visit(root, MountLayoutDev, true);
  visit(root, MountPassiveDev, true);
}

function disappearLayoutEffects(fiber: FiberNode): void {
  if (fiber.tag === OffscreenComponent && fiber.memoizedState !== null) return;
  if (fiber.tag === FunctionComponent || fiber.tag === ForwardRef)
    commitHookEffectListUnmount(HookLayout, fiber);
  else if (fiber.tag === ClassComponent) {
    safelyDetachRef(fiber, fiber.return);
    safelyCallComponentWillUnmount(fiber, fiber.return);
  } else if (fiber.tag === HostComponent) safelyDetachRef(fiber, fiber.return);
  let child = fiber.child;
  while (child !== null) {
    disappearLayoutEffects(child);
    child = child.sibling;
  }
}
function reappearLayoutEffects(fiber: FiberNode): void {
  if (fiber.tag === OffscreenComponent && fiber.memoizedState !== null) return;
  let child = fiber.child;
  while (child !== null) {
    reappearLayoutEffects(child);
    child = child.sibling;
  }
  try {
    if (fiber.tag === FunctionComponent || fiber.tag === ForwardRef)
      commitHookEffectListMount(HookLayout, fiber);
    else if (fiber.tag === ClassComponent) {
      fiber.stateNode.componentDidMount?.();
      commitAttachRef(fiber);
    } else if (fiber.tag === HostComponent) commitAttachRef(fiber);
  } catch (error) {
    captureCommitPhaseError(fiber, fiber.return, error);
  }
}
