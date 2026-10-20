/** React 18.3.1 ReactDOMTextarea：initialValue 与受控 value/defaultValue 分开保存。 */
import { getToStringValue, toString } from "./ToStringValue";
type Textarea = HTMLTextAreaElement & { _wrapperState: { initialValue: any } };
export function getHostProps(element: Element, props: any): any {
  if (props.dangerouslySetInnerHTML != null)
    throw new Error(
      "`dangerouslySetInnerHTML` does not make sense on <textarea>.",
    );
  return {
    ...props,
    value: undefined,
    defaultValue: undefined,
    children: toString((element as Textarea)._wrapperState.initialValue),
  };
}
export function initWrapperState(element: Element, props: any): void {
  let initialValue = props.value;
  if (initialValue == null) {
    let { children, defaultValue } = props;
    if (children != null) {
      if (defaultValue != null)
        throw new Error(
          "If you supply `defaultValue` on a <textarea>, do not pass children.",
        );
      if (Array.isArray(children)) {
        if (children.length > 1)
          throw new Error("<textarea> can only have at most one child.");
        children = children[0];
      }
      defaultValue = children;
    }
    initialValue = defaultValue ?? "";
  }
  (element as Textarea)._wrapperState = {
    initialValue: getToStringValue(initialValue),
  };
}
export function updateWrapper(element: Element, props: any): void {
  const node = element as Textarea;
  const value = getToStringValue(props.value);
  const defaultValue = getToStringValue(props.defaultValue);
  if (value != null) {
    const newValue = toString(value);
    if (newValue !== node.value) node.value = newValue;
    if (props.defaultValue == null && node.defaultValue !== newValue)
      node.defaultValue = newValue;
  }
  if (defaultValue != null) node.defaultValue = toString(defaultValue);
}
export function postMountWrapper(element: Element): void {
  const node = element as Textarea;
  const textContent = node.textContent;
  if (
    textContent === node._wrapperState.initialValue &&
    textContent !== "" &&
    textContent !== null
  )
    node.value = textContent;
}
export function restoreControlledState(element: Element, props: any): void {
  updateWrapper(element, props);
}
