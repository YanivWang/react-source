// React 18.3.1 ToStringValue：表单的 function/symbol 值按空字符串处理。
export function getToStringValue(value: any): any {
  switch (typeof value) {
    case "boolean":
    case "number":
    case "string":
    case "undefined":
    case "object":
      return value;
    default:
      return "";
  }
}
export function toString(value: any): string {
  return "" + value;
}
