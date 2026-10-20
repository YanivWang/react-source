/**
 * @file React 主入口
 * @description 导出 React 经典 API（createElement、isValidElement）
 */

import { createElement, isValidElement } from "./ReactElement";
import { createContext } from "./ReactContext";
import { forwardRef } from "./ReactForwardRef";
import { lazy } from "./ReactLazy";
import { memo } from "./ReactMemo";
import {
  REACT_SUSPENSE_TYPE,
  REACT_FRAGMENT_TYPE,
  REACT_STRICT_MODE_TYPE,
} from "shared/ReactSymbols";
import { Component, PureComponent } from "./ReactBaseClasses";

// Suspense 运行时就是 REACT_SUSPENSE_TYPE 这个 symbol（beginWork 靠 === 比较分发），
// 这里的调用签名只为满足 TS 的 JSX 元素类型检查（同 ReactContext.ts 的 ReactProviderType
// 处理方式），不代表真的可以把 Suspense 当函数调用。
interface SuspenseType {
  (props: { children?: any; fallback?: any }): any;
}
const Suspense = REACT_SUSPENSE_TYPE as unknown as SuspenseType;
const Fragment = REACT_FRAGMENT_TYPE as unknown as (props: {
  children?: any;
}) => any;
const StrictMode = REACT_STRICT_MODE_TYPE as unknown as (props: {
  children?: any;
}) => any;
function createRef<T>(): { current: T | null } {
  const ref = { current: null };
  if (__DEV__) Object.seal(ref);
  return ref;
}
function startTransition(scope: () => void): void {
  const config = ReactSharedInternals.ReactCurrentBatchConfig;
  const previous = config.transition;
  config.transition = {};
  try {
    scope();
  } finally {
    config.transition = previous;
  }
}
import {
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "./ReactHooks";
import ReactSharedInternals from "./ReactSharedInternals";

// 对照官方 packages/react/index.js re-export './src/React'：
// 经典入口只暴露 createElement/isValidElement，jsx/jsxDEV 已经拆到
// jsx-runtime.ts / jsx-dev-runtime.ts 两个独立入口（对应 react/jsx-runtime、
// react/jsx-dev-runtime），不再从这里导出。
// Suspense 和 Fragment 一样只是一个 Symbol（不是像 forwardRef/memo 那样的工厂函数），
// 对照官方直接把 REACT_SUSPENSE_TYPE 重命名导出为 Suspense。
export {
  Component,
  PureComponent,
  Suspense,
  Fragment,
  StrictMode,
  createRef,
  startTransition,
  createContext,
  createElement,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
};

// 对照官方 v18 的 __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED：reconciler 与 react
// 是两个独立发布的包，reconciler 要在渲染前切换 ReactCurrentDispatcher.current 却不能反向
// 依赖 react 包的具体实现，只能通过这个"秘密"导出拿到共享单例。命名故意起得吓人，提醒使用者
// 这不是公共 API，版本不匹配时随时可能改变形状。
export { ReactSharedInternals as __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED };

export default {
  version: "1.0.0",
  Component,
  PureComponent,
  Suspense,
  Fragment,
  StrictMode,
  createRef,
  startTransition,
  createContext,
  createElement,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  useState,
  useReducer,
  useRef,
  useMemo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useTransition,
  useDeferredValue,
  useSyncExternalStore,
};
