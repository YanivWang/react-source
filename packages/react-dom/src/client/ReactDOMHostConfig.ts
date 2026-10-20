/**
 * @file react-dom 的 DOM HostConfig 实现（简版）
 * @description reconciler 通过 HostConfig 与具体渲染器解耦，react-dom 构建时通过 fork
 * 把本模块注入 reconciler（替换掉只抛错的 ReactFiberHostConfig 占位模块）。这里只覆盖
 * 客户端挂载/更新/删除、常用 DOM 属性、样式、受控表单所需的子集。
 * 事件处理器（on*）由 root 委托监听；setProp 直接
 * 跳过函数类型的 prop（不当成 DOM 属性设置），真正的监听靠 updateFiberProps 存到
 * ReactDOMComponentTree 的 WeakMap 上，由事件委托系统统一读取分发。
 *
 * 对照官方 packages/react-dom/src/client/ReactDOMHostConfig.js；
 * HostContext 栈分别保存根/Portal 的容器、ownerDocument 与 HTML/SVG/MathML namespace。
 */

import { precacheFiberNode, updateFiberProps } from "./ReactDOMComponentTree";
import {
  setInitialProperties,
  diffProperties,
  updateProperties,
} from "./ReactDOMComponent";
import {
  HTML_NAMESPACE,
  getChildNamespace,
  getIntrinsicNamespace,
} from "../shared/DOMNamespaces";
import { getEventPriority } from "../events/ReactDOMEventListener";
import { listenToAllSupportedEvents } from "../events/DOMPluginEventSystem";
import { DefaultEventPriority } from "react-reconciler/src/ReactEventPriorities";
import type { DOMEventName } from "../events/DOMEventNames";

export type Container = Element | Document | DocumentFragment;

// 根容器由 reconciler 的 HostContext 栈传入，Portal 可拥有另一份 document。
// createInstance/createTextInstance 通过 rootContainerInstance 取 ownerDocument
// （对照官方：rootContainerInstance 在 DOM 渲染器里用于创建元素时确定所属文档）。
export const supportsMutation = true;
export const supportsPersistence = false;

export function createInstance(
  type: string,
  props: Record<string, any>,
  rootContainerInstance: Container,
  hostContext: string,
  internalInstanceHandle: any,
): Element {
  const ownerDocument =
    rootContainerInstance.nodeType === 9
      ? (rootContainerInstance as Document)
      : rootContainerInstance.ownerDocument!;
  const namespace =
    hostContext === HTML_NAMESPACE ? getIntrinsicNamespace(type) : hostContext;
  const domElement =
    namespace === HTML_NAMESPACE
      ? ownerDocument.createElement(type)
      : ownerDocument.createElementNS(namespace, type);
  // 事件系统靠这两份映射反查 DOM 节点对应的 Fiber、以及取当前 props 上的监听器
  precacheFiberNode(internalInstanceHandle, domElement);
  updateFiberProps(domElement, props);
  return domElement;
}

export function createTextInstance(
  text: string,
  rootContainerInstance: Container,
  _hostContext: unknown,
  internalInstanceHandle: any,
): Text {
  const ownerDocument =
    rootContainerInstance.nodeType === 9
      ? (rootContainerInstance as Document)
      : rootContainerInstance.ownerDocument!;
  const textNode = ownerDocument.createTextNode(text);
  precacheFiberNode(internalInstanceHandle, textNode);
  return textNode;
}

export function appendInitialChild(
  parentInstance: Element,
  child: Element | Text,
): void {
  parentInstance.appendChild(child);
}

export function finalizeInitialChildren(
  instance: Element,
  type: string,
  props: Record<string, any>,
  _rootContainerInstance: Container,
  _hostContext: unknown,
): boolean {
  setInitialProperties(instance, type, props);
  // DOM 渲染器在这里返回 shouldAutoFocusHostComponent（autofocus 等初始副作用），
  // 简版不需要，恒返回 false
  return false;
}

export function prepareUpdate(
  _instance: Element,
  _type: string,
  oldProps: Record<string, any>,
  newProps: Record<string, any>,
  _rootContainerInstance: Container,
  _hostContext: unknown,
): any[] | null {
  const payload = diffProperties(_instance, _type, oldProps, newProps);
  // 表单包装逻辑必须在 option 等子节点提交后执行，即使 value 本身没有变化。
  return (
    payload ?? (["input", "textarea", "select"].includes(_type) ? [] : null)
  );
}

export function commitUpdate(
  instance: Element,
  updatePayload: any[],
  _type: string,
  _oldProps: Record<string, any>,
  newProps: Record<string, any>,
  _internalInstanceHandle: unknown,
): void {
  updateProperties(instance, updatePayload, _type, _oldProps, newProps);
  updateFiberProps(instance, newProps);
}

export function commitTextUpdate(
  textInstance: Text,
  _oldText: string,
  newText: string,
): void {
  textInstance.nodeValue = newText;
}

export function appendChild(
  parentInstance: Element,
  child: Element | Text,
): void {
  parentInstance.appendChild(child);
}

export function appendChildToContainer(
  container: Container,
  child: Element | Text,
): void {
  container.appendChild(child);
}

export function insertBefore(
  parentInstance: Element,
  child: Element | Text,
  beforeChild: Element | Text,
): void {
  parentInstance.insertBefore(child, beforeChild);
}

export function insertInContainerBefore(
  container: Container,
  child: Element | Text,
  beforeChild: Element | Text,
): void {
  container.insertBefore(child, beforeChild);
}

export function removeChild(
  parentInstance: Element,
  child: Element | Text,
): void {
  parentInstance.removeChild(child);
}

export function removeChildFromContainer(
  container: Container,
  child: Element | Text,
): void {
  container.removeChild(child);
}

export function shouldSetTextContent(
  type: string,
  props: Record<string, any>,
): boolean {
  return (
    type === "textarea" ||
    type === "noscript" ||
    typeof props.children === "string" ||
    typeof props.children === "number" ||
    (typeof props.dangerouslySetInnerHTML === "object" &&
      props.dangerouslySetInnerHTML !== null &&
      props.dangerouslySetInnerHTML.__html != null)
  );
}

export function getRootHostContext(container: Container): string {
  if (container.nodeType === 9 || container.nodeType === 11) {
    const root = (container as Document).documentElement;
    return root ? root.namespaceURI! : HTML_NAMESPACE;
  }
  const node = container as Element;
  return getChildNamespace(node.namespaceURI, node.tagName);
}
export function getChildHostContext(parent: string, type: string): string {
  return getChildNamespace(parent, type);
}
export function clearContainer(container: Container): void {
  (container as Node).textContent = "";
}
export function resetTextContent(instance: Element): void {
  instance.textContent = "";
}
export function getCurrentEventPriority(): number {
  const currentEvent = typeof window === "undefined" ? undefined : window.event;
  return currentEvent === undefined
    ? DefaultEventPriority
    : getEventPriority(currentEvent.type as DOMEventName);
}
export function preparePortalMount(container: Container): void {
  listenToAllSupportedEvents(container);
}

// 对照官方 hideInstance/unhideInstance：纯 CSS 层面隐藏，DOM 节点仍然存在（不走
// removeChild），Suspense 展示 fallback / Offscreen 切到 hidden 态时调用。
export function hideInstance(instance: Element): void {
  (instance as HTMLElement).style.display = "none";
}

export function unhideInstance(
  instance: Element,
  props: Record<string, any>,
): void {
  const styleProp = props.style;
  const display =
    styleProp != null &&
    Object.prototype.hasOwnProperty.call(styleProp, "display")
      ? styleProp.display
      : null;
  (instance as HTMLElement).style.display = display == null ? "" : display;
}

// 对照官方 hideTextInstance/unhideTextInstance：文本节点没有 style，只能清空/还原内容
export function hideTextInstance(textInstance: Text): void {
  textInstance.nodeValue = "";
}

export function unhideTextInstance(textInstance: Text, text: string): void {
  textInstance.nodeValue = text;
}

// 对照官方 scheduleMicrotask：SyncLane 的同步任务由微任务统一 flush。queueMicrotask 在
// ES2019 lib 里未声明，用 globalThis 兜底；老环境退回 Promise.resolve().then。
export function scheduleMicrotask(callback: () => void): void {
  const queueMicrotask = (globalThis as any).queueMicrotask;
  if (typeof queueMicrotask === "function") {
    queueMicrotask(callback);
  } else {
    Promise.resolve().then(callback);
  }
}
