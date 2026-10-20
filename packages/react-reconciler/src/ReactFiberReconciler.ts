/**
 * @file react-reconciler 对外入口
 * @description createContainer / updateContainer 是渲染器（react-dom）调用 reconciler 的
 * 挂载/更新入口，对应官方 ReactFiberReconciler.new.js 的同名导出
 */

import { createFiberRoot } from "./ReactFiberRoot";
import {
  createUpdate,
  enqueueUpdate,
  entangleTransitions,
} from "./ReactFiberClassUpdateQueue";
import type { Fiber, FiberRoot } from "./ReactInternalTypes";
import { NoLane, type Lane } from "./ReactFiberLane";
import type { RootTag } from "./ReactRootTags";
import type { Container } from "./ReactFiberHostConfig";
import {
  requestEventTime,
  requestUpdateLane,
  scheduleUpdateOnFiber,
} from "./ReactFiberWorkLoop";

// 对照官方：createContainer 返回值类型叫 OpaqueRoot，语义上是"不透明的根节点句柄"——
// 结构上等同于 FiberRoot，但用不同的名字提醒调用方（react-dom）不应假设其内部结构。
export type OpaqueRoot = FiberRoot;

/**
 * 创建容器（FiberRoot），对应 ReactDOM.createRoot 底层调用的入口
 * @param containerInfo - 渲染器提供的容器（如 DOM 元素）
 * @param tag - 根节点的渲染模式（LegacyRoot/ConcurrentRoot）
 * @param identifierPrefix - useId 生成的 id 前缀（createRoot 的 options.identifierPrefix）
 * @returns OpaqueRoot
 */
export function createContainer(
  containerInfo: Container,
  tag: RootTag,
  identifierPrefix?: string,
): OpaqueRoot {
  return createFiberRoot(containerInfo, tag, null, identifierPrefix);
}

/**
 * 更新容器：把新的 ReactElement 挂到根 fiber 的更新队列并触发渲染
 * @param element - 新的 ReactElement 树
 * @param container - createContainer 返回的 OpaqueRoot
 * @param callback - 提交完成后的回调（留到 commitRoot 的 layout 阶段消费，当前未执行）
 * @returns 本次更新的 lane
 */
export function updateContainer(
  element: any,
  container: OpaqueRoot,
  callback?: (() => void) | null,
): Lane {
  const current: Fiber = container.current;
  const eventTime = requestEventTime();
  const lane = requestUpdateLane(current);

  const update = createUpdate(eventTime, lane);
  // DevTools 依赖这个字段名叫 "element"
  update.payload = { element };
  if (callback !== undefined && callback !== null) {
    update.callback = callback;
  }

  const root = enqueueUpdate(current, update, lane);
  if (root !== null) {
    scheduleUpdateOnFiber(root, current, lane, eventTime);
    entangleTransitions(root, current, lane);
  }

  return lane;
}

export { NoLane };
