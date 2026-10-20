import { getFiberCurrentPropsFromNode } from "./ReactDOMComponentTree";
import { track, updateValueIfChanged } from "./inputValueTracking";

// 覆盖客户端受控/非受控 input、textarea、select 的主链路；不含旧浏览器事件 polyfill。
export function updateControlledState(
  node: Element,
  props: Record<string, any>,
  mount = false,
): void {
  if (node.nodeName === "INPUT") {
    const input = node as HTMLInputElement;
    if (props.checked != null) input.checked = Boolean(props.checked);
    if (mount)
      input.defaultChecked = Boolean(props.checked ?? props.defaultChecked);
    else if (props.checked == null && props.defaultChecked != null)
      input.defaultChecked = Boolean(props.defaultChecked);
    const value = props.value ?? (mount ? props.defaultValue : null);
    if (value != null && input.value !== String(value))
      input.value = String(value);
    if (props.value != null) input.defaultValue = String(props.value);
    else if (props.defaultValue != null)
      input.defaultValue = String(props.defaultValue);
    if (mount) track(input);
  } else if (node.nodeName === "TEXTAREA") {
    const input = node as HTMLTextAreaElement;
    const value =
      props.value ??
      (mount ? (props.defaultValue ?? props.children ?? "") : null);
    if (value != null && input.value !== String(value))
      input.value = String(value);
    if (props.value != null) input.defaultValue = String(props.value);
    else if (props.defaultValue != null)
      input.defaultValue = String(props.defaultValue);
    if (mount) track(input);
  } else if (node.nodeName === "SELECT") {
    const select = node as HTMLSelectElement;
    const value = props.value ?? (mount ? props.defaultValue : null);
    if (value != null) {
      if (select.multiple) {
        const values = new Set((value as any[]).map(String));
        for (const option of select.options) {
          option.selected = values.has(option.value);
          if (mount && props.value == null && option.selected)
            option.defaultSelected = true;
        }
      } else {
        let found = false;
        for (const option of select.options) {
          if (option.value === String(value)) {
            option.selected = true;
            if (mount && props.value == null) option.defaultSelected = true;
            found = true;
            break;
          }
        }
        if (!found) {
          const fallback = [...select.options].find(
            (option) => !option.disabled,
          );
          if (fallback) fallback.selected = true;
        }
      }
    }
  }
}

export function restoreControlledState(node: Element): void {
  const props = getFiberCurrentPropsFromNode(node);
  if (props === null) return;
  updateControlledState(node, props);
  if (
    node.nodeName === "INPUT" &&
    props.type === "radio" &&
    props.name != null
  ) {
    const input = node as HTMLInputElement;
    // 同名 radio 的 checked 会被浏览器联动改变，必须一起恢复已提交的受控 props。
    const group = (
      node.getRootNode() as ParentNode
    ).querySelectorAll<HTMLInputElement>('input[type="radio"]');
    for (const other of group) {
      if (
        other === node ||
        other.name !== input.name ||
        other.form !== input.form
      )
        continue;
      const otherProps = getFiberCurrentPropsFromNode(other);
      if (otherProps !== null) {
        updateValueIfChanged(other);
        updateControlledState(other, otherProps);
      }
    }
  }
}
