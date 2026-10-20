// 对照 React 18.3.1 inputValueTracking：区分应用直接赋值与浏览器原生输入，避免重复 change。
const trackers = new WeakMap<Element, { value: string }>();
function valueOf(node: any): string {
  return node.type === "checkbox" || node.type === "radio"
    ? String(node.checked)
    : String(node.value);
}
export function track(node: any): void {
  if (trackers.has(node)) return;
  const field =
    node.type === "checkbox" || node.type === "radio" ? "checked" : "value";
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(node),
    field,
  );
  const tracker = { value: valueOf(node) };
  trackers.set(node, tracker);
  if (
    descriptor?.get &&
    descriptor.set &&
    !Object.prototype.hasOwnProperty.call(node, field)
  ) {
    const get = descriptor.get,
      set = descriptor.set;
    Object.defineProperty(node, field, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        return get.call(this);
      },
      set(value) {
        tracker.value = String(value);
        set.call(this, value);
      },
    });
  }
}
export function updateValueIfChanged(node: any): boolean {
  const tracker = trackers.get(node);
  const value = valueOf(node);
  if (!tracker) {
    track(node);
    return true;
  }
  if (tracker.value === value) return false;
  tracker.value = value;
  return true;
}
