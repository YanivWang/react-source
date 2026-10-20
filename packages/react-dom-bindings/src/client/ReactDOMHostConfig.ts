/**
 * @file react-dom 的 DOM HostConfig 实现（简版）
 * @description reconciler 通过 HostConfig 与具体渲染器解耦，react-dom 构建时通过 fork
 * 把本模块注入 reconciler（替换掉只抛错的 ReactFiberConfig 占位模块）。这里只覆盖
 * 客户端挂载/更新/删除、常用 DOM 属性、样式、受控表单所需的子集。
 * 事件处理器（on*）由 root 委托监听；setProp 直接
 * 跳过函数类型的 prop（不当成 DOM 属性设置），真正的监听靠 updateFiberProps 存到
 * ReactDOMComponentTree 的 WeakMap 上，由事件委托系统统一读取分发。
 *
 * 对照官方 ReactFiberConfigDOM.js：Container 官方是 Element | Document | DocumentFragment
 * 的联合类型（各自可挂 _reactRootContainer）。本项目简版只支持挂载到 Element，不含
 * document/DocumentFragment 作为根容器，也不挂 _reactRootContainer 引用。
 */

import { precacheFiberNode, updateFiberProps } from "./ReactDOMComponentTree";
import { setValueForStyles } from "./CSSPropertyOperations";
import { updateControlledState } from "./ReactDOMInput";

export type Container = Element;

// 常用属性子集不等同于完整 DOMPropertyOperations；事件处理器不写到 DOM 属性。

// 对照 DOMPropertyOperations：布尔属性的存在即为 true，不能写入字符串 "false"。
const booleanAttributes = new Set([
  "allowFullScreen",
  "async",
  "autoFocus",
  "autoPlay",
  "controls",
  "default",
  "defer",
  "disabled",
  "disablePictureInPicture",
  "disableRemotePlayback",
  "formNoValidate",
  "hidden",
  "loop",
  "noModule",
  "noValidate",
  "open",
  "playsInline",
  "readOnly",
  "required",
  "reversed",
  "scoped",
  "seamless",
  "itemScope",
]);
const propertyBooleans = new Set(["checked", "multiple", "muted", "selected"]);

function setProp(domElement: Element, propKey: string, value: any): void {
  if (
    /^on/i.test(propKey) ||
    propKey === "ref" ||
    propKey === "key" ||
    propKey === "suppressHydrationWarning" ||
    propKey === "suppressContentEditableWarning"
  )
    return;
  if (propKey === "style") {
    if (value != null) setValueForStyles(domElement, value);
    return;
  }
  if (propertyBooleans.has(propKey)) {
    (domElement as any)[propKey] = Boolean(value);
    return;
  }
  const attribute =
    propKey === "className" ? "class" : propKey === "htmlFor" ? "for" : propKey;
  if (booleanAttributes.has(propKey)) {
    if (value) domElement.setAttribute(attribute.toLowerCase(), "");
    else domElement.removeAttribute(attribute.toLowerCase());
    return;
  }
  if (propKey === "download" || propKey === "capture") {
    if (value === false || value == null) domElement.removeAttribute(attribute);
    else
      domElement.setAttribute(attribute, value === true ? "" : String(value));
    return;
  }
  if (
    value == null ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    (typeof value === "boolean" &&
      !/^(data-|aria-)/.test(propKey) &&
      !["contentEditable", "draggable", "spellCheck", "value"].includes(
        propKey,
      ))
  ) {
    domElement.removeAttribute(attribute);
    return;
  }
  domElement.setAttribute(attribute, String(value));
}

/** 挂载时设置初始属性（跳过 children，children 由 HostText fiber 单独 append） */
function setInitialProperties(
  domElement: Element,
  props: Record<string, any>,
): void {
  for (const propKey in props) {
    const form = ["INPUT", "TEXTAREA", "SELECT"].includes(domElement.nodeName);
    if (
      propKey === "children" ||
      (form &&
        ["value", "defaultValue", "checked", "defaultChecked"].includes(
          propKey,
        ))
    )
      continue;
    setProp(domElement, propKey, props[propKey]);
  }
}

/** 对比新旧 props，产出 [key1, value1, key2, value2, ...] 的扁平 updatePayload */
function diffProperties(
  lastProps: Record<string, any>,
  nextProps: Record<string, any>,
): any[] | null {
  const updatePayload: any[] = [];
  let eventChanged = false;

  const propKeySet: Set<string> = new Set();
  for (const propKey in lastProps) {
    propKeySet.add(propKey);
  }
  for (const propKey in nextProps) {
    propKeySet.add(propKey);
  }

  for (const propKey of propKeySet) {
    if (propKey === "children") {
      continue;
    }
    const lastValue = lastProps[propKey];
    const nextValue = nextProps[propKey];
    if (lastValue === nextValue) {
      continue;
    }
    if (/^on/i.test(propKey)) {
      // 即使没有 DOM 属性变化，也必须提交缓存 props，事件委托才能读到新监听器。
      eventChanged = true;
      continue;
    }
    if (propKey === "style") {
      const updates: Record<string, any> = {};
      for (const name in lastValue)
        if (nextValue == null || !(name in nextValue)) updates[name] = "";
      for (const name in nextValue)
        if (lastValue == null || lastValue[name] !== nextValue[name])
          updates[name] = nextValue[name];
      updatePayload.push(propKey, updates);
    } else updatePayload.push(propKey, nextValue);
  }

  return updatePayload.length > 0 || eventChanged ? updatePayload : null;
}

// 根容器由 createRoot 在 createContainer 前注入，getRootHostContainer 返回它。
// createInstance/createTextInstance 通过 rootContainerInstance 取 ownerDocument
// （对照官方：rootContainerInstance 在 DOM 渲染器里用于创建元素时确定所属文档）。
let rootContainer: Container = document.documentElement;

/** 设置根容器（仅 createRoot 内部调用，不进对外 API） */
export function setRootHostContainer(container: Container): void {
  rootContainer = container;
}

export const supportsMutation = true;
export const supportsPersistence = false;

export function createInstance(
  type: string,
  props: Record<string, any>,
  rootContainerInstance: Container,
  _hostContext: unknown,
  internalInstanceHandle: any,
): Element {
  const ownerDocument = rootContainerInstance.ownerDocument || document;
  const domElement = ownerDocument.createElement(type);
  setInitialProperties(domElement, props);
  // 事件系统靠这两份映射反查 DOM 节点对应的 Fiber、以及取当前 props 上的监听器
  precacheFiberNode(internalInstanceHandle, domElement);
  updateFiberProps(domElement, props);
  if (type === "input" || type === "textarea")
    updateControlledState(domElement, props, true);
  return domElement;
}

export function createTextInstance(
  text: string,
  rootContainerInstance: Container,
  _hostContext: unknown,
  internalInstanceHandle: any,
): Text {
  const ownerDocument = rootContainerInstance.ownerDocument || document;
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
  if (type === "select") updateControlledState(instance, props, true);
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
  const payload = diffProperties(oldProps, newProps);
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
  for (let i = 0; i < updatePayload.length; i += 2) {
    const propKey = updatePayload[i];
    const propValue = updatePayload[i + 1];
    const form = ["INPUT", "TEXTAREA", "SELECT"].includes(instance.nodeName);
    if (
      !form ||
      !["value", "defaultValue", "checked", "defaultChecked"].includes(propKey)
    )
      setProp(instance, propKey, propValue);
  }
  updateFiberProps(instance, newProps);
  updateControlledState(instance, newProps);
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
  _type: string,
  _props: Record<string, any>,
): boolean {
  // 直接文本子节点优化（textarea/option 等）留到后续 Phase，简版恒返回 false，
  // 字符串 children 走 HostText fiber 路径
  return false;
}

export function getRootHostContainer(): Container {
  return rootContainer;
}

export function getHostContext(): object {
  // 本项目 host config 没有 context 栈（react-dom 落地 host context 时补），返回空对象
  return {};
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
