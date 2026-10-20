import { isUnitlessNumber } from "../shared/CSSProperty";

// 对照 React 18.3.1 CSSPropertyOperations / dangerousStyleValue：普通属性使用
// CSSStyleDeclaration 的 camelCase 字段，自定义属性保留原名；只有有单位的数值补 px。
export function setValueForStyles(
  node: Element,
  styles: Record<string, any>,
): void {
  const style = (node as HTMLElement).style;
  for (const name in styles) {
    const value = styles[name];
    const custom = name.startsWith("--");
    const empty = value == null || typeof value === "boolean" || value === "";
    const cssValue = empty
      ? ""
      : typeof value === "number" &&
          value !== 0 &&
          !custom &&
          !isUnitlessNumber[name]
        ? value + "px"
        : String(value).trim();
    if (custom) style.setProperty(name, cssValue);
    else (style as any)[name === "float" ? "cssFloat" : name] = cssValue;
  }
}
