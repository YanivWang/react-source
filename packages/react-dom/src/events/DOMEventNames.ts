/**
 * @file 支持的原生 DOM 事件名
 * @description 对照官方 packages/react-dom/src/events/DOMEventNames.js，本项目
 * 只精简出常见交互用得到的一个子集（鼠标/键盘/表单/焦点），足够覆盖 onClick/onChange 等
 * 主流 demo 场景，其余事件（drag/touch/animation/wheel 等）待有需求时再补。
 */

export type DOMEventName =
  | "click"
  | "dblclick"
  | "contextmenu"
  | "mousedown"
  | "mouseup"
  | "mousemove"
  | "mouseover"
  | "mouseout"
  | "keydown"
  | "keyup"
  | "keypress"
  | "focusin"
  | "focusout"
  | "input"
  | "change"
  | "submit";
