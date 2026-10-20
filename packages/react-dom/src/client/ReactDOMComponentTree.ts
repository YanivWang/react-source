/**
 * @file DOM 节点 ↔ Fiber / Props 的双向映射
 * @description 对照官方 packages/react-dom/src/client/ReactDOMComponentTree.js
 * 的 enableInternalInstanceMap 分支：官方还有字符串 key 挂 DOM 属性的 fallback 写法
 * （历史遗留，兼容不支持 WeakMap 的环境），本项目直接只实现 WeakMap 版本，更简洁。
 *
 * 事件系统需要这套映射做两件事：
 * 1. 原生事件的 target 是 DOM 节点，要反查出对应的 Fiber 才能沿 return 链收集 onClick 等监听器
 * 2. 监听器实际存在 Fiber 的 props 上（不是 DOM 属性），需要一份 DOM 节点 → 当前 props 的映射
 */

import type { FiberNode } from "react-reconciler/src/ReactFiber";

const instanceMap = new WeakMap<Node, FiberNode>();
const propsMap = new WeakMap<Node, Record<string, any>>();

/** 挂载时把 DOM 节点与其对应的 Fiber 关联起来（createInstance/createTextInstance 调用） */
export function precacheFiberNode(hostInst: FiberNode, node: Node): void {
  instanceMap.set(node, hostInst);
}

/** 记录 DOM 节点当前的 props（createInstance/commitUpdate 调用），事件分发时按 registrationName 取监听器要用 */
export function updateFiberProps(node: Node, props: Record<string, any>): void {
  propsMap.set(node, props);
}

/**
 * 从任意 DOM 节点出发，找到最近的、被 React 管理的 Fiber 对应节点
 * 对照官方 getClosestInstanceFromNode：事件的原生 target 可能是文本节点或没有直接挂载
 * Fiber 的子节点（如 SVG use 元素），需要沿 parentNode 向上找
 */
export function getClosestInstanceFromNode(targetNode: Node): FiberNode | null {
  let node: Node | null = targetNode;
  while (node !== null) {
    const targetInst = instanceMap.get(node);
    if (targetInst !== undefined) {
      return targetInst;
    }
    node = node.parentNode;
  }
  return null;
}

/** 取 DOM 节点当前的 props，找不到（尚未挂载完成）返回 null */
export function getFiberCurrentPropsFromNode(
  node: Node,
): Record<string, any> | null {
  return propsMap.get(node) ?? null;
}
