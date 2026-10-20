/**
 * @file Context 读写与传播
 * @description 对照官方 packages/react-reconciler/src/ReactFiberNewContext.new.js：
 * Provider 在 beginWork 时把新 value 压栈（pushProvider，基于 ReactFiberStack 的通用栈），
 * 消费端（useContext/Context.Consumer）读取 context._currentValue 并把读取记录挂到
 * fiber.dependencies 上；Provider 的 value 变化时，propagateContextChange 沿子树查找
 * dependencies 里含该 context 的 fiber，标记其 lanes 需要重渲染。
 *
 * 简化范围（对照官方取舍）：
 * - 只支持单一渲染器（react-dom），不做官方 isPrimaryRenderer 分支和 _currentValue2 双份存储
 * - 只做 eager 传播（propagateContextChange），不做 enableLazyContextPropagation 分支——
 *   官方这个 flag 默认也是 false，两者行为一致
 * - 不做 legacy context / DehydratedFragment（Suspense）/ ClassComponent 强制更新分支
 */

import type { ReactContext } from "shared/ReactTypes";

import type { FiberNode } from "./ReactFiber";
import type { Dependencies } from "./ReactInternalTypes";
import { createCursor, pop, push, type StackCursor } from "./ReactFiberStack";
import {
  isSubsetOfLanes,
  includesSomeLane,
  mergeLanes,
  NoLanes,
  NoTimestamp,
  getHighestPriorityLane,
  type Lanes,
} from "./ReactFiberLane";
import { markWorkInProgressReceivedUpdate } from "./ReactFiberBeginWork";
import { ContextProvider, ClassComponent } from "./ReactWorkTags";
import { createUpdate, ForceUpdate } from "./ReactFiberClassUpdateQueue";

const valueCursor: StackCursor<any> = createCursor(null);

// 本次渲染中正在读 context 的 fiber，以及它已收集到的 context 依赖链表尾指针。
// 渲染阶段外读取 context（比如渲染之外调用 useContext）应该报错，靠 currentlyRenderingFiber
// 是否为 null 判断。
let currentlyRenderingFiber: FiberNode | null = null;
let lastContextDependency: Dependencies["firstContext"] = null;

/**
 * 渡染即将退出（本次工作单元处理完/被中断）时调用，防止 readContext 在渲染阶段外被调用
 */
export function resetContextDependencies(): void {
  currentlyRenderingFiber = null;
  lastContextDependency = null;
}

/**
 * Provider 在 beginWork 时把新 value 压栈，context._currentValue 立刻更新为新值，
 * 子树渲染期间读到的都是这个新值；completeWork 归的时候 popProvider 恢复旧值。
 */
export function pushProvider<T>(
  providerFiber: FiberNode,
  context: ReactContext<T>,
  nextValue: T,
): void {
  push(valueCursor, context._currentValue, providerFiber);
  context._currentValue = nextValue;
}

/**
 * completeWork 处理 ContextProvider 时调用，把 context._currentValue 恢复成入栈前的值
 */
export function popProvider(
  context: ReactContext<any>,
  providerFiber: FiberNode,
): void {
  const currentValue = valueCursor.current;
  pop(valueCursor, providerFiber);
  context._currentValue = currentValue;
}

/**
 * 每次进入函数组件渲染前调用（renderWithHooks 之前），重置本次渲染的 context 依赖收集状态。
 * 若 workInProgress 复用了 current 的 dependencies（bailout 场景），其 lanes 命中本次
 * renderLanes 说明有 context 更新触发了这次渲染，需要标记 didReceiveUpdate。
 */
export function prepareToReadContext(
  workInProgress: FiberNode,
  renderLanes: Lanes,
): void {
  currentlyRenderingFiber = workInProgress;
  lastContextDependency = null;

  const dependencies = workInProgress.dependencies;
  if (dependencies !== null) {
    const firstContext = dependencies.firstContext;
    if (firstContext !== null) {
      if (includesSomeLane(renderLanes, dependencies.lanes)) {
        markWorkInProgressReceivedUpdate();
      }
      // 重新开始收集本次渲染实际读取的 context 列表
      dependencies.firstContext = null;
    }
  }
}

/**
 * useContext(context) / Context.Consumer 消费端的实际读取逻辑：取 context 当前值，
 * 并把这次读取记录追加到 currentlyRenderingFiber.dependencies 链表上。
 */
export function readContext<T>(context: ReactContext<T>): T {
  const value = context._currentValue;

  const contextItem = {
    context: context as ReactContext<any>,
    memoizedValue: value,
    next: null,
  };

  if (lastContextDependency === null) {
    if (currentlyRenderingFiber === null) {
      throw new Error(
        "Context can only be read while React is rendering. " +
          "In classes, you can read it in the render method or getDerivedStateFromProps. " +
          "In function components, you can read it directly in the function body, but not " +
          "inside Hooks like useReducer() or useMemo().",
      );
    }

    // 本次渲染读到的第一个 context，新建链表
    lastContextDependency = contextItem;
    currentlyRenderingFiber.dependencies = {
      lanes: NoLanes,
      firstContext: contextItem,
    };
  } else {
    lastContextDependency = lastContextDependency.next = contextItem;
  }

  return value;
}

// 对照官方 propagateContextChange_eager：Provider value 变化后，从其子树里找出所有
// dependencies 含该 context 的 fiber，标记 lanes 需要在本次 renderLanes 下重渲染，
// 并把这条 lane 沿 return 链冒泡到 childLanes（scheduleContextWorkOnParentPath），
// 保证 bailout 检查 childLanes 时能发现这棵子树有工作要做。
export function propagateContextChange<T>(
  workInProgress: FiberNode,
  context: ReactContext<T>,
  renderLanes: Lanes,
): void {
  let fiber: FiberNode | null = workInProgress.child;
  if (fiber !== null) {
    fiber.return = workInProgress;
  }
  while (fiber !== null) {
    let nextFiber: FiberNode | null;

    const list = fiber.dependencies;
    if (list !== null) {
      nextFiber = fiber.child;

      let dependency = list.firstContext;
      while (dependency !== null) {
        if (dependency.context === context) {
          if (fiber.tag === ClassComponent && fiber.updateQueue !== null) {
            // 与 18.3.1 eager context propagation 一样直接进入 shared pending，
            // 当前 render 即将访问这个 Class，不能延后到下一次 fresh stack。
            const update = createUpdate(
              NoTimestamp,
              getHighestPriorityLane(renderLanes),
            );
            update.tag = ForceUpdate;
            const shared = fiber.updateQueue.shared;
            const pending = shared.pending;
            if (pending === null) update.next = update;
            else {
              update.next = pending.next;
              pending.next = update;
            }
            shared.pending = update;
          }
          // 命中：给这个 fiber 标记本次 renderLanes，冒泡到祖先的 childLanes
          fiber.lanes = mergeLanes(fiber.lanes, renderLanes);
          const alternate = fiber.alternate;
          if (alternate !== null) {
            alternate.lanes = mergeLanes(alternate.lanes, renderLanes);
          }
          scheduleContextWorkOnParentPath(
            fiber.return,
            renderLanes,
            workInProgress,
          );
          list.lanes = mergeLanes(list.lanes, renderLanes);
          break;
        }
        dependency = dependency.next;
      }
    } else if (fiber.tag === ContextProvider) {
      // 嵌套的同类型 Provider 会覆盖 value，其内部子树等它自己渲染时处理，不用继续往下扫
      nextFiber = fiber.type === workInProgress.type ? null : fiber.child;
    } else {
      nextFiber = fiber.child;
    }

    if (nextFiber !== null) {
      nextFiber.return = fiber;
    } else {
      // 没有子节点，转向兄弟节点；都没有则沿 return 链回溯，直到回到 workInProgress 本身
      nextFiber = fiber;
      while (nextFiber !== null) {
        if (nextFiber === workInProgress) {
          nextFiber = null;
          break;
        }
        const sibling = nextFiber.sibling;
        if (sibling !== null) {
          sibling.return = nextFiber.return;
          nextFiber = sibling;
          break;
        }
        nextFiber = nextFiber.return;
      }
    }
    fiber = nextFiber;
  }
}

// 把 renderLanes 合并到 parent..propagationRoot 路径上每个祖先（及其 alternate）的
// childLanes，让 bailout 检查 childLanes 时能发现这条子树需要重渲染。
function scheduleContextWorkOnParentPath(
  parent: FiberNode | null,
  renderLanes: Lanes,
  propagationRoot: FiberNode,
): void {
  let node = parent;
  while (node !== null) {
    const alternate = node.alternate;
    if (!isSubsetOfLanes(node.childLanes, renderLanes)) {
      node.childLanes = mergeLanes(node.childLanes, renderLanes);
      if (alternate !== null) {
        alternate.childLanes = mergeLanes(alternate.childLanes, renderLanes);
      }
    } else if (
      alternate !== null &&
      !isSubsetOfLanes(alternate.childLanes, renderLanes)
    ) {
      alternate.childLanes = mergeLanes(alternate.childLanes, renderLanes);
    }
    if (node === propagationRoot) {
      break;
    }
    node = node.return;
  }
}
