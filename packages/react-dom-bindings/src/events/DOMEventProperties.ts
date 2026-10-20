/**
 * @file 原生事件名 ↔ React 注册名的映射表
 * @description 对照官方 packages/react-dom-bindings/src/events/DOMEventProperties.js，
 * 精简到 DOMEventNames.ts 里列出的事件子集。官方列表里的大小写很重要（大写首字母派生出
 * React 名），本项目按同样规则手写这份精简列表，不做 enableCreateEventHandleAPI/
 * enableScrollEndPolyfill 相关分支。
 */

import type { DOMEventName } from "./DOMEventNames";
import { registerTwoPhaseEvent } from "./EventRegistry";

export const topLevelEventsToReactNames: Map<DOMEventName, string> = new Map();

// 大小写敏感：从这份大写首字母的事件名派生 DOM 名（小写）和 React 名（onXxx）
const simpleEventPluginEvents: string[] = [
  "click",
  "contextMenu",
  "dblClick",
  "input",
  "keyDown",
  "keyPress",
  "keyUp",
  "mouseDown",
  "mouseMove",
  "mouseOut",
  "mouseOver",
  "mouseUp",
  "submit",
];

function registerSimpleEvent(
  domEventName: DOMEventName,
  reactName: string,
): void {
  topLevelEventsToReactNames.set(domEventName, reactName);
  registerTwoPhaseEvent(reactName, [domEventName]);
}

export function registerSimpleEvents(): void {
  for (let i = 0; i < simpleEventPluginEvents.length; i++) {
    const eventName = simpleEventPluginEvents[i];
    const domEventName = eventName.toLowerCase() as DOMEventName;
    const capitalizedEvent = eventName[0].toUpperCase() + eventName.slice(1);
    registerSimpleEvent(domEventName, "on" + capitalizedEvent);
  }
  registerSimpleEvent("dblclick", "onDoubleClick");
  // change 事件语义上对应 onChange，但 React 实际靠 input 事件驱动受控 input 的 onChange
  // （ChangeEventPlugin 才是完整实现），本项目简化为原生 change 事件直接映射 onChange，
  // 覆盖 checkbox/radio/select 等场景；文本输入建议用 onInput 语义等价的场景
  registerTwoPhaseEvent("onChange", ["change", "input", "click"]);
  registerSimpleEvent("focusin", "onFocus");
  registerSimpleEvent("focusout", "onBlur");
}
