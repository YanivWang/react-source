/**
 * @file 事件注册表
 * @description 对照官方 packages/react-dom/src/events/EventRegistry.js。官方还有
 * registrationNameDependencies/possibleRegistrationNames 两张表，专供 DEV 模式下"注册名冲突"
 * 和"大小写拼写警告"用，本项目当前没有消费方，属于死代码，不引入。
 */

import type { DOMEventName } from "./DOMEventNames";

/** 需要监听的全部原生事件名（listenToAllSupportedEvents 据此在 root container 上挂监听器） */
export const allNativeEvents: Set<DOMEventName> = new Set();

/**
 * 注册一个两阶段事件（同时注册冒泡版 onXxx 与捕获版 onXxxCapture）
 * @param registrationName - React 侧的 prop 名，如 "onClick"
 * @param dependencies - 对应的原生事件名（大多数情况下只有一个）
 */
export function registerTwoPhaseEvent(
  registrationName: string,
  dependencies: DOMEventName[],
): void {
  registerDirectEvent(registrationName, dependencies);
  registerDirectEvent(registrationName + "Capture", dependencies);
}

export function registerDirectEvent(
  _registrationName: string,
  dependencies: DOMEventName[],
): void {
  for (let i = 0; i < dependencies.length; i++) {
    allNativeEvents.add(dependencies[i]);
  }
}
