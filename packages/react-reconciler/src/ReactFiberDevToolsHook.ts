/**
 * @file DevTools 注入
 * @description 对照官方 ReactFiberDevToolsHook.new.js。18.3.1 默认构建里
 * enableProfilerTimer / enableSchedulingProfiler 都是 __PROFILE__，普通 dev/prod 为 false，
 * 因此 onCommitRoot 走不带 schedulerPriority 的那条分支。
 */

import { DidCapture } from "./ReactFiberFlags";
import type { FiberNode } from "./ReactFiber";
import type { FiberRootNode } from "./ReactFiberRoot";

let rendererID: number | null = null;
let injectedHook: any = null;
let hasLoggedError = false;

function devToolsHook(): any {
  return (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
}

export function injectInternals(internals: object): boolean {
  const hook = devToolsHook();
  if (hook === undefined) {
    return false;
  }
  if (hook.isDisabled) {
    return true;
  }
  if (!hook.supportsFiber) {
    if (__DEV__) {
      console.error(
        "The installed version of React DevTools is too old and will not work " +
          "with the current version of React. Please update React DevTools. " +
          "https://reactjs.org/link/react-devtools",
      );
    }
    return true;
  }
  try {
    rendererID = hook.inject(internals);
    injectedHook = hook;
  } catch (err) {
    if (__DEV__) {
      console.error("React instrumentation encountered an error: %s.", err);
    }
  }
  if (hook.checkDCE) {
    return true;
  }
  return false;
}

export function onCommitRoot(root: FiberRootNode): void {
  if (injectedHook && typeof injectedHook.onCommitFiberRoot === "function") {
    try {
      const didError = (root.current.flags & DidCapture) === DidCapture;
      injectedHook.onCommitFiberRoot(rendererID, root, undefined, didError);
    } catch (err) {
      if (__DEV__ && !hasLoggedError) {
        hasLoggedError = true;
        console.error("React instrumentation encountered an error: %s", err);
      }
    }
  }
}

export function onPostCommitRoot(root: FiberRootNode): void {
  if (
    injectedHook &&
    typeof injectedHook.onPostCommitFiberRoot === "function"
  ) {
    try {
      injectedHook.onPostCommitFiberRoot(rendererID, root);
    } catch (err) {
      if (__DEV__ && !hasLoggedError) {
        hasLoggedError = true;
        console.error("React instrumentation encountered an error: %s", err);
      }
    }
  }
}

export function onCommitUnmount(fiber: FiberNode): void {
  if (injectedHook && typeof injectedHook.onCommitFiberUnmount === "function") {
    try {
      injectedHook.onCommitFiberUnmount(rendererID, fiber);
    } catch (err) {
      if (__DEV__ && !hasLoggedError) {
        hasLoggedError = true;
        console.error("React instrumentation encountered an error: %s", err);
      }
    }
  }
}
