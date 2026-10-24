/**
 * @file Fiber 树反射工具
 * @description 在双缓存 Fiber 树上做只读查询：判断挂载状态、定位真实 DOM 节点等
 */

import { Placement } from "./ReactFiberFlags";
import { FiberNode } from "./ReactFiber";
import { HostComponent, HostPortal, HostRoot, HostText } from "./ReactWorkTags";

// 对照官方 packages/react-reconciler/src/ReactFiberTreeReflection.js 的
// getNearestMountedFiber：从任意 Fiber 出发，找到离它最近的、已经挂载到页面上的 Fiber。
// 分两阶段向上走 return 指针——第一阶段处理"还没 alternate 的新树"（新建但可能还没插入），
// 遇到 Placement 标记就把它的父节点记成候选；第二阶段一路走到根，如果根是 HostRoot
// 说明整棵树确实挂载在页面上，返回候选；如果没走到 HostRoot（树是孤立的），返回 null。
/**
 * 找到离给定 Fiber 最近的已挂载 Fiber
 * @param fiber - 起始 Fiber
 * @returns 最近的已挂载 Fiber，如果整棵树未挂载则返回 null
 */
export function getNearestMountedFiber(fiber: FiberNode): FiberNode | null {
  let node = fiber;
  let nearestMounted: FiberNode | null = fiber;

  if (!fiber.alternate) {
    // 还没有 alternate，说明这是本次渲染新建的 Fiber，沿途记录候选挂载点
    let nextNode: FiberNode | null = node;
    do {
      node = nextNode;
      if ((node.flags & Placement) !== 0) {
        nearestMounted = node.return;
      }
      nextNode = node.return;
    } while (nextNode);
  } else {
    // 已经有 alternate，说明这个 Fiber 至少经历过一次 commit，继续往上走确认整棵树挂载状态
    while (node.return) {
      node = node.return;
    }
  }

  if (node.tag === HostRoot) {
    return nearestMounted;
  }

  // 没有走到 HostRoot，说明这棵树是被删除的孤立子树
  return null;
}

function assertIsMounted(fiber: FiberNode): void {
  if (getNearestMountedFiber(fiber) !== fiber) {
    throw new Error("Unable to find node on an unmounted component.");
  }
}

// 对照官方 findCurrentFiberUsingSlowPath：在 current / workInProgress 两棵树里
// 确定传入 fiber 对应的 current 分支。findDOMNode 必须读已提交的树，不能读正在渲染的那份。
export function findCurrentFiberUsingSlowPath(
  fiber: FiberNode,
): FiberNode | null {
  const alternate = fiber.alternate;
  if (!alternate) {
    const nearestMounted = getNearestMountedFiber(fiber);
    if (nearestMounted === null) {
      throw new Error("Unable to find node on an unmounted component.");
    }
    if (nearestMounted !== fiber) {
      return null;
    }
    return fiber;
  }

  let a: FiberNode = fiber;
  let b: FiberNode = alternate;
  while (true) {
    const parentA = a.return;
    if (parentA === null) {
      break;
    }
    const parentB = parentA.alternate;
    if (parentB === null) {
      const nextParent = parentA.return;
      if (nextParent !== null) {
        a = nextParent;
        b = nextParent;
        continue;
      }
      break;
    }

    if (parentA.child === parentB.child) {
      let child = parentA.child;
      while (child) {
        if (child === a) {
          assertIsMounted(parentA);
          return fiber;
        }
        if (child === b) {
          assertIsMounted(parentA);
          return alternate;
        }
        child = child.sibling;
      }
    }

    if (a.return !== b.return) {
      a = parentA;
      b = parentB;
    } else {
      let didFindChild = false;
      let child = parentA.child;
      while (child) {
        if (child === a) {
          didFindChild = true;
          a = parentA;
          b = parentB;
          break;
        }
        if (child === b) {
          didFindChild = true;
          b = parentA;
          a = parentB;
          break;
        }
        child = child.sibling;
      }
      if (!didFindChild) {
        child = parentB.child;
        while (child) {
          if (child === a) {
            didFindChild = true;
            a = parentB;
            b = parentA;
            break;
          }
          if (child === b) {
            didFindChild = true;
            b = parentB;
            a = parentA;
            break;
          }
          child = child.sibling;
        }
        if (!didFindChild) {
          throw new Error(
            "Child was not found in either parent set. This indicates a bug " +
              "in React related to the return pointer. Please file an issue.",
          );
        }
      }
    }

    if (a.alternate !== b) {
      throw new Error(
        "Return fibers should always be each others' alternates. " +
          "This error is likely caused by a bug in React. Please file an issue.",
      );
    }
  }

  if (a.tag !== HostRoot) {
    throw new Error("Unable to find node on an unmounted component.");
  }
  if (a.stateNode.current === a) {
    return fiber;
  }
  return alternate;
}

function findCurrentHostFiberImpl(node: FiberNode): FiberNode | null {
  if (node.tag === HostComponent || node.tag === HostText) {
    return node;
  }
  let child = node.child;
  while (child !== null) {
    const match = findCurrentHostFiberImpl(child);
    if (match !== null) {
      return match;
    }
    child = child.sibling;
  }
  return null;
}

function findCurrentHostFiberWithNoPortalsImpl(
  node: FiberNode,
): FiberNode | null {
  if (node.tag === HostComponent || node.tag === HostText) {
    return node;
  }
  let child = node.child;
  while (child !== null) {
    if (child.tag !== HostPortal) {
      const match = findCurrentHostFiberWithNoPortalsImpl(child);
      if (match !== null) {
        return match;
      }
    }
    child = child.sibling;
  }
  return null;
}

// 对照官方 findCurrentHostFiber：先定位 current 分支，再深度优先找第一个宿主节点。
export function findCurrentHostFiber(parent: FiberNode): FiberNode | null {
  const currentParent = findCurrentFiberUsingSlowPath(parent);
  return currentParent !== null
    ? findCurrentHostFiberImpl(currentParent)
    : null;
}

// 对照官方 findCurrentHostFiberWithNoPortals：跳过 HostPortal，供根实例公开节点使用。
export function findCurrentHostFiberWithNoPortals(
  parent: FiberNode,
): FiberNode | null {
  const currentParent = findCurrentFiberUsingSlowPath(parent);
  return currentParent !== null
    ? findCurrentHostFiberWithNoPortalsImpl(currentParent)
    : null;
}
