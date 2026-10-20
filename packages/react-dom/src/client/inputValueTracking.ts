/** React 18.3.1 inputValueTracking：节点上的 _valueTracker 记录赋值和原生输入的差别。 */
interface ValueTracker {
  getValue(): string;
  setValue(value: any): void;
  stopTracking(): void;
}
type TrackedNode = (HTMLInputElement | HTMLTextAreaElement) & {
  _valueTracker?: ValueTracker | null;
};
function isCheckable(node: any): boolean {
  return (
    node.nodeName?.toLowerCase() === "input" &&
    (node.type === "checkbox" || node.type === "radio")
  );
}
function getValueFromNode(node: any): string {
  return isCheckable(node) ? String(node.checked) : node.value;
}
function trackValueOnNode(node: any): ValueTracker | undefined {
  const field = isCheckable(node) ? "checked" : "value";
  const descriptor = Object.getOwnPropertyDescriptor(
    node.constructor.prototype,
    field,
  );
  let currentValue = "" + node[field];
  if (
    Object.prototype.hasOwnProperty.call(node, field) ||
    !descriptor?.get ||
    !descriptor.set
  )
    return;
  const { get, set } = descriptor;
  Object.defineProperty(node, field, {
    configurable: true,
    get() {
      return get.call(this);
    },
    set(value) {
      currentValue = "" + value;
      set.call(this, value);
    },
  });
  Object.defineProperty(node, field, { enumerable: descriptor.enumerable });
  return {
    getValue() {
      return currentValue;
    },
    setValue(value) {
      currentValue = "" + value;
    },
    stopTracking() {
      node._valueTracker = null;
      delete node[field];
    },
  };
}
export function track(node: TrackedNode): void {
  if (!node._valueTracker) node._valueTracker = trackValueOnNode(node);
}
export function updateValueIfChanged(node: any): boolean {
  if (!node) return false;
  const tracker: ValueTracker | null = node._valueTracker;
  if (!tracker) return true;
  const next = getValueFromNode(node);
  if (next === tracker.getValue()) return false;
  tracker.setValue(next);
  return true;
}
export function stopTracking(node: TrackedNode): void {
  node._valueTracker?.stopTracking();
}
