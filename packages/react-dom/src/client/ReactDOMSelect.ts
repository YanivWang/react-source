/** React 18.3.1 ReactDOMSelect：选项在子节点处理后更新，记录 wasMultiple。 */
import { getToStringValue, toString } from "./ToStringValue";
type Select = HTMLSelectElement & { _wrapperState: { wasMultiple: boolean } };
export function getHostProps(_element: Element, props: any): any {
  return { ...props, value: undefined };
}
export function initWrapperState(element: Element, props: any): void {
  (element as Select)._wrapperState = { wasMultiple: !!props.multiple };
}
function updateOptions(
  node: HTMLSelectElement,
  multiple: boolean,
  value: any,
  setDefaultSelected: boolean,
): void {
  if (multiple) {
    const selectedValues = new Set((value as any[]).map(String));
    for (const option of node.options) {
      const selected = selectedValues.has(option.value);
      if (option.selected !== selected) option.selected = selected;
      if (selected && setDefaultSelected) option.defaultSelected = true;
    }
  } else {
    const selectedValue = toString(getToStringValue(value));
    let defaultSelected: HTMLOptionElement | null = null;
    for (const option of node.options) {
      if (option.value === selectedValue) {
        option.selected = true;
        if (setDefaultSelected) option.defaultSelected = true;
        return;
      }
      if (defaultSelected === null && !option.disabled)
        defaultSelected = option;
    }
    if (defaultSelected !== null) defaultSelected.selected = true;
  }
}
export function postMountWrapper(element: Element, props: any): void {
  const node = element as Select;
  node.multiple = !!props.multiple;
  if (props.value != null)
    updateOptions(node, !!props.multiple, props.value, false);
  else if (props.defaultValue != null)
    updateOptions(node, !!props.multiple, props.defaultValue, true);
}
export function postUpdateWrapper(element: Element, props: any): void {
  const node = element as Select;
  const wasMultiple = node._wrapperState.wasMultiple;
  node._wrapperState.wasMultiple = !!props.multiple;
  if (props.value != null)
    updateOptions(node, !!props.multiple, props.value, false);
  else if (wasMultiple !== !!props.multiple)
    updateOptions(
      node,
      !!props.multiple,
      props.defaultValue ?? (props.multiple ? [] : ""),
      props.defaultValue != null,
    );
}
export function restoreControlledState(element: Element, props: any): void {
  if (props.value != null)
    updateOptions(element as Select, !!props.multiple, props.value, false);
}
