/**
 * @file 从 Fiber 上取指定事件的监听函数
 * @description 对照官方 packages/react-dom/src/events/getListener.js。官方还有
 * shouldPreventMouseEvent（disabled 表单元素抑制鼠标事件），本项目当前没有受控/disabled
 * 表单场景，不引入。
 */

import type { FiberNode } from "react-reconciler/src/ReactFiber";
import { getFiberCurrentPropsFromNode } from "../client/ReactDOMComponentTree";

export default function getListener(
  inst: FiberNode,
  registrationName: string,
): ((...args: any[]) => void) | null {
  const stateNode = inst.stateNode;
  if (stateNode === null) {
    return null;
  }
  const props = getFiberCurrentPropsFromNode(stateNode);
  if (props === null) {
    return null;
  }
  if (
    props.disabled &&
    ["button", "input", "select", "textarea"].includes(inst.type) &&
    /^on(?:Click|DoubleClick|MouseDown|MouseMove|MouseUp|MouseEnter)(?:Capture)?$/.test(
      registrationName,
    )
  )
    return null;
  const listener = props[registrationName];
  if (listener != null && typeof listener !== "function") {
    throw new Error(
      `Expected \`${registrationName}\` listener to be a function, instead got a value of \`${typeof listener}\` type.`,
    );
  }
  return listener ?? null;
}
