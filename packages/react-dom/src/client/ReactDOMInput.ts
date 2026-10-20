/** React 18.3.1 ReactDOMInput：保留默认 feature flags 的客户端 wrapper 协议；省略 DEV 警告。 */
import { getFiberCurrentPropsFromNode } from "./ReactDOMComponentTree";
import { updateValueIfChanged } from "./inputValueTracking";
import { getToStringValue, toString } from "./ToStringValue";
type Input = HTMLInputElement & {
  _wrapperState: {
    initialValue: any;
    initialChecked: any;
    controlled: boolean;
  };
};
export function getHostProps(element: Element, props: any): any {
  return {
    ...props,
    defaultChecked: undefined,
    defaultValue: undefined,
    value: undefined,
    checked:
      props.checked != null
        ? props.checked
        : (element as Input)._wrapperState.initialChecked,
  };
}
export function initWrapperState(element: Element, props: any): void {
  (element as Input)._wrapperState = {
    initialChecked:
      props.checked != null ? props.checked : props.defaultChecked,
    initialValue: getToStringValue(
      props.value != null ? props.value : (props.defaultValue ?? ""),
    ),
    controlled:
      props.type === "checkbox" || props.type === "radio"
        ? props.checked != null
        : props.value != null,
  };
}
export function updateChecked(element: Element, props: any): void {
  if (props.checked != null) (element as Input).checked = !!props.checked;
}
export function setDefaultValue(node: Input, type: any, value: any): void {
  if (type !== "number" || node.ownerDocument.activeElement !== node) {
    if (value == null)
      node.defaultValue = toString(node._wrapperState.initialValue);
    else if (node.defaultValue !== toString(value))
      node.defaultValue = toString(value);
  }
}
export function updateWrapper(element: Element, props: any): void {
  const node = element as Input;
  updateChecked(node, props);
  const value = getToStringValue(props.value);
  if (value != null) {
    if (props.type === "number") {
      if ((value === 0 && node.value === "") || node.value != value)
        node.value = toString(value);
    } else if (node.value !== toString(value)) node.value = toString(value);
  } else if (props.type === "submit" || props.type === "reset") {
    node.removeAttribute("value");
    return;
  }
  if (Object.prototype.hasOwnProperty.call(props, "value"))
    setDefaultValue(node, props.type, value);
  else if (Object.prototype.hasOwnProperty.call(props, "defaultValue"))
    setDefaultValue(node, props.type, getToStringValue(props.defaultValue));
  if (props.checked == null && props.defaultChecked != null)
    node.defaultChecked = !!props.defaultChecked;
}
export function postMountWrapper(element: Element, props: any): void {
  const node = element as Input;
  if (
    Object.prototype.hasOwnProperty.call(props, "value") ||
    Object.prototype.hasOwnProperty.call(props, "defaultValue")
  ) {
    if (
      (props.type === "submit" || props.type === "reset") &&
      props.value == null
    )
      return;
    const initialValue = toString(node._wrapperState.initialValue);
    if (initialValue !== node.value) node.value = initialValue;
    node.defaultValue = initialValue;
  }
  const name = node.name;
  if (name !== "") node.name = "";
  node.defaultChecked = !node.defaultChecked;
  node.defaultChecked = !!node._wrapperState.initialChecked;
  if (name !== "") node.name = name;
}
export function restoreControlledState(element: Element, props: any): void {
  const node = element as Input;
  updateWrapper(node, props);
  updateNamedCousins(node, props);
}
function updateNamedCousins(node: Input, props: any): void {
  if (props.type !== "radio" || props.name == null) return;
  let queryRoot: Node = node;
  while (queryRoot.parentNode) queryRoot = queryRoot.parentNode;
  // 先查询 radio 再比较 name，避免把用户 name 插入 CSS selector；匹配集合与官方相同。
  for (const other of (
    queryRoot as ParentNode
  ).querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
    if (
      other === node ||
      other.name !== String(props.name) ||
      other.form !== node.form
    )
      continue;
    const otherProps = getFiberCurrentPropsFromNode(other);
    if (!otherProps)
      throw new Error(
        "ReactDOMInput: Mixing React and non-React radio inputs with the same `name` is not supported.",
      );
    updateValueIfChanged(other);
    updateWrapper(other, otherProps);
  }
}
