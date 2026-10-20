/** React 18.3.1 ReactDOMComponent：DOM props 与表单 wrapper 生命周期的协调。属性表保留常用子集。 */
import { setValueForStyles } from "./CSSPropertyOperations";
import * as Input from "./ReactDOMInput";
import * as Select from "./ReactDOMSelect";
import * as Textarea from "./ReactDOMTextarea";
import { track } from "./inputValueTracking";
import { getFiberCurrentPropsFromNode } from "./ReactDOMComponentTree";
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
  if (propKey === "defaultValue" || propKey === "defaultChecked") return;
  if (propKey === "dangerouslySetInnerHTML") {
    if (value?.__html != null) domElement.innerHTML = value.__html;
    return;
  }
  if (propKey === "children") {
    if (typeof value === "string" || typeof value === "number")
      domElement.textContent = String(value);
    return;
  }
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

/** 子节点创建完成后初始化属性，字符串 children 直接写 textContent。 */
export function setInitialProperties(
  domElement: Element,
  type: string,
  rawProps: Record<string, any>,
): void {
  let props = rawProps;
  switch (type) {
    case "input":
      Input.initWrapperState(domElement, props);
      props = Input.getHostProps(domElement, props);
      break;
    case "textarea":
      Textarea.initWrapperState(domElement, props);
      props = Textarea.getHostProps(domElement, props);
      break;
    case "select":
      Select.initWrapperState(domElement, props);
      props = Select.getHostProps(domElement, props);
      break;
  }
  for (const propKey in props) {
    setProp(domElement, propKey, props[propKey]);
  }
  switch (type) {
    case "input":
      track(domElement as HTMLInputElement);
      Input.postMountWrapper(domElement, rawProps);
      break;
    case "textarea":
      track(domElement as HTMLTextAreaElement);
      Textarea.postMountWrapper(domElement);
      break;
    case "select":
      Select.postMountWrapper(domElement, rawProps);
      break;
  }
}

/** 对比新旧 props，产出 [key1, value1, key2, value2, ...] 的扁平 updatePayload */
export function diffProperties(
  domElement: Element,
  type: string,
  lastProps: Record<string, any>,
  nextProps: Record<string, any>,
): any[] | null {
  switch (type) {
    case "input":
      lastProps = Input.getHostProps(domElement, lastProps);
      nextProps = Input.getHostProps(domElement, nextProps);
      break;
    case "textarea":
      lastProps = Textarea.getHostProps(domElement, lastProps);
      nextProps = Textarea.getHostProps(domElement, nextProps);
      break;
    case "select":
      lastProps = Select.getHostProps(domElement, lastProps);
      nextProps = Select.getHostProps(domElement, nextProps);
      break;
  }
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
    if (
      propKey === "children" &&
      typeof nextProps.children !== "string" &&
      typeof nextProps.children !== "number"
    ) {
      continue;
    }
    if (propKey === "dangerouslySetInnerHTML") {
      const nextHtml = nextProps[propKey]?.__html;
      if (nextHtml != null && lastProps[propKey]?.__html !== nextHtml)
        updatePayload.push(propKey, { __html: nextHtml });
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

  return updatePayload.length > 0 ||
    eventChanged ||
    ["input", "textarea", "select"].includes(type)
    ? updatePayload
    : null;
}

export function updateProperties(
  element: Element,
  payload: any[],
  type: string,
  _oldProps: any,
  props: any,
): void {
  if (type === "input" && props.type === "radio" && props.name != null)
    Input.updateChecked(element, props);
  for (let i = 0; i < payload.length; i += 2)
    setProp(element, payload[i], payload[i + 1]);
  switch (type) {
    case "input":
      Input.updateWrapper(element, props);
      break;
    case "textarea":
      Textarea.updateWrapper(element, props);
      break;
    case "select":
      Select.postUpdateWrapper(element, props);
      break;
  }
}
export function restoreControlledState(element: Element): void {
  const props = getFiberCurrentPropsFromNode(element);
  if (props === null) return;
  switch (element.nodeName.toLowerCase()) {
    case "input":
      Input.restoreControlledState(element, props);
      break;
    case "textarea":
      Textarea.restoreControlledState(element, props);
      break;
    case "select":
      Select.restoreControlledState(element, props);
      break;
  }
}
