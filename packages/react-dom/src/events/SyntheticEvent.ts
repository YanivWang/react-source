/**
 * @file 合成事件对象
 * @description 对照官方 packages/react-dom/src/events/SyntheticEvent.js 的
 * createSyntheticEvent 工厂模式（用工厂而不是单一构造器 + if 分支，避免构造函数 megamorphic
 * 导致引擎去优化）。本项目只做 4 种 Interface：基础事件、鼠标、键盘、焦点，够覆盖
 * DOMEventNames.ts 里精简后的事件子集。不做 getModifierState（跨浏览器修饰键归一化表）、
 * 不做事件池（React 17 后官方也已移除池化，直接对齐现状）。
 */

type EventInterface = Record<string, 0 | ((event: Record<string, any>) => any)>;

function functionThatReturnsTrue(): boolean {
  return true;
}

function functionThatReturnsFalse(): boolean {
  return false;
}

export interface BaseSyntheticEvent {
  _reactName: string | null;
  _targetInst: unknown;
  type: string;
  nativeEvent: Record<string, any>;
  target: EventTarget | null;
  currentTarget: EventTarget | null;
  defaultPrevented: boolean;
  isDefaultPrevented(): boolean;
  isPropagationStopped(): boolean;
  preventDefault(): void;
  stopPropagation(): void;
  persist(): void;
  isPersistent(): boolean;
  [propName: string]: any;
}

type SyntheticEventCtor = new (
  reactName: string | null,
  reactEventType: string,
  targetInst: unknown,
  nativeEvent: Record<string, any>,
  nativeEventTarget: EventTarget | null,
) => BaseSyntheticEvent;

function createSyntheticEvent(Interface: EventInterface): SyntheticEventCtor {
  function SyntheticBaseEvent(
    this: BaseSyntheticEvent,
    reactName: string | null,
    reactEventType: string,
    targetInst: unknown,
    nativeEvent: Record<string, any>,
    nativeEventTarget: EventTarget | null,
  ) {
    this._reactName = reactName;
    this._targetInst = targetInst;
    this.type = reactEventType;
    this.nativeEvent = nativeEvent;
    this.target = nativeEventTarget;
    this.currentTarget = null;

    for (const propName in Interface) {
      if (!Object.prototype.hasOwnProperty.call(Interface, propName)) {
        continue;
      }
      const normalize = Interface[propName];
      this[propName] = normalize
        ? normalize(nativeEvent)
        : nativeEvent[propName];
    }

    const defaultPrevented =
      nativeEvent.defaultPrevented != null
        ? nativeEvent.defaultPrevented
        : nativeEvent.returnValue === false;
    this.defaultPrevented = !!defaultPrevented;
    this.isDefaultPrevented = defaultPrevented
      ? functionThatReturnsTrue
      : functionThatReturnsFalse;
    this.isPropagationStopped = functionThatReturnsFalse;
  }

  Object.assign(SyntheticBaseEvent.prototype, {
    preventDefault(this: BaseSyntheticEvent): void {
      this.defaultPrevented = true;
      const event = this.nativeEvent;
      if (event && event.preventDefault) {
        event.preventDefault();
      }
      this.isDefaultPrevented = functionThatReturnsTrue;
    },
    stopPropagation(this: BaseSyntheticEvent): void {
      const event = this.nativeEvent;
      if (event && event.stopPropagation) {
        event.stopPropagation();
      }
      this.isPropagationStopped = functionThatReturnsTrue;
    },
    persist(): void {
      // 现代事件系统不做池化，persist 是历史遗留 API，空实现
    },
    isPersistent: functionThatReturnsTrue,
  });

  return SyntheticBaseEvent as unknown as SyntheticEventCtor;
}

const EventInterface: EventInterface = {
  eventPhase: 0,
  bubbles: 0,
  cancelable: 0,
  timeStamp: (event) => event.timeStamp || Date.now(),
  defaultPrevented: 0,
  isTrusted: 0,
};
export const SyntheticEvent: SyntheticEventCtor =
  createSyntheticEvent(EventInterface);

const MouseEventInterface: EventInterface = {
  ...EventInterface,
  screenX: 0,
  screenY: 0,
  clientX: 0,
  clientY: 0,
  pageX: 0,
  pageY: 0,
  ctrlKey: 0,
  shiftKey: 0,
  altKey: 0,
  metaKey: 0,
  button: 0,
  buttons: 0,
  relatedTarget: (event) => event.relatedTarget,
};
export const SyntheticMouseEvent: SyntheticEventCtor =
  createSyntheticEvent(MouseEventInterface);

const KeyboardEventInterface: EventInterface = {
  ...EventInterface,
  key: (event) => event.key,
  code: 0,
  location: 0,
  ctrlKey: 0,
  shiftKey: 0,
  altKey: 0,
  metaKey: 0,
  repeat: 0,
  keyCode: (event) => event.keyCode,
  charCode: (event) => (event.type === "keypress" ? event.charCode : 0),
  which: (event) => event.keyCode,
};
export const SyntheticKeyboardEvent: SyntheticEventCtor = createSyntheticEvent(
  KeyboardEventInterface,
);

const FocusEventInterface: EventInterface = {
  ...EventInterface,
  relatedTarget: (event) => event.relatedTarget,
};
export const SyntheticFocusEvent: SyntheticEventCtor =
  createSyntheticEvent(FocusEventInterface);
