/**
 * @file react-reconciler 对外入口
 * @description createContainer / updateContainer 是渲染器（react-dom）调用 reconciler 的
 * 挂载/更新入口，对应官方 ReactFiberReconciler.new.js 的同名导出
 */

import { createFiberRoot } from "./ReactFiberRoot";
import {
  createUpdate,
  enqueueUpdate,
  entangleTransitions,
} from "./ReactFiberClassUpdateQueue";
import { enqueueConcurrentRenderForLane } from "./ReactFiberConcurrentUpdates";
import { injectInternals } from "./ReactFiberDevToolsHook";
import type { Fiber, FiberRoot } from "./ReactInternalTypes";
import { FiberNode } from "./ReactFiber";
import { NoLane, NoTimestamp, SyncLane, type Lane } from "./ReactFiberLane";
import { StrictLegacyMode } from "./ReactTypeOfMode";
import type { RootTag } from "./ReactRootTags";
import type { Container } from "./ReactFiberHostConfig";
import {
  findCurrentHostFiber,
  findCurrentHostFiberWithNoPortals,
} from "./ReactFiberTreeReflection";
import {
  requestEventTime,
  requestUpdateLane,
  scheduleUpdateOnFiber,
} from "./ReactFiberWorkLoop";
import getComponentNameFromType from "shared/getComponentNameFromType";
import ReactSharedInternals from "../../react/src/ReactSharedInternals";

// 对照官方：createContainer 返回值类型叫 OpaqueRoot，语义上是"不透明的根节点句柄"——
// 结构上等同于 FiberRoot，但用不同的名字提醒调用方（react-dom）不应假设其内部结构。
export type OpaqueRoot = FiberRoot;

/**
 * 创建容器（FiberRoot），对应 ReactDOM.createRoot 底层调用的入口
 * @param containerInfo - 渲染器提供的容器（如 DOM 元素）
 * @param tag - 根节点的渲染模式（LegacyRoot/ConcurrentRoot）
 * @param identifierPrefix - useId 生成的 id 前缀（createRoot 的 options.identifierPrefix）
 * @returns OpaqueRoot
 */
export function createContainer(
  containerInfo: Container,
  tag: RootTag,
  identifierPrefix?: string,
): OpaqueRoot {
  return createFiberRoot(containerInfo, tag, null, identifierPrefix);
}

/**
 * 更新容器：把新的 ReactElement 挂到根 fiber 的更新队列并触发渲染
 * @param element - 新的 ReactElement 树
 * @param container - createContainer 返回的 OpaqueRoot
 * @param callback - 提交完成后的回调（留到 commitRoot 的 layout 阶段消费，当前未执行）
 * @returns 本次更新的 lane
 */
export function updateContainer(
  element: any,
  container: OpaqueRoot,
  callback?: (() => void) | null,
): Lane {
  const current: Fiber = container.current;
  const eventTime = requestEventTime();
  const lane = requestUpdateLane(current);

  const update = createUpdate(eventTime, lane);
  // DevTools 依赖这个字段名叫 "element"
  update.payload = { element };
  if (callback !== undefined && callback !== null) {
    update.callback = callback;
  }

  const root = enqueueUpdate(current, update, lane);
  if (root !== null) {
    scheduleUpdateOnFiber(root, current, lane, eventTime);
    entangleTransitions(root, current, lane);
  }

  return lane;
}

const didWarnAboutFindNodeInStrictMode: Record<string, boolean> = {};

function componentName(fiber: FiberNode): string {
  return getComponentNameFromType(fiber.type) || "Component";
}

// 对照官方 findHostInstance：从 class 实例的 _reactInternals 找到 current 树上的宿主节点。
export function findHostInstance(component: any): any {
  const fiber: FiberNode | undefined = component?._reactInternals;
  if (fiber == null) {
    if (typeof component?.render === "function") {
      throw new Error("Unable to find node on an unmounted component.");
    }
    const keys = component != null ? Object.keys(component).join(",") : "";
    throw new Error(
      `Argument appears to not be a ReactComponent. Keys: ${keys}`,
    );
  }
  const hostFiber = findCurrentHostFiber(fiber);
  if (hostFiber === null) {
    return null;
  }
  return hostFiber.stateNode;
}

// 对照官方 findHostInstanceWithWarning：DEV 下 StrictLegacyMode 打印与官方相同的弃用文案。
export function findHostInstanceWithWarning(
  component: any,
  methodName: string,
): any {
  if (__DEV__) {
    const fiber: FiberNode | undefined = component?._reactInternals;
    if (fiber == null) {
      if (typeof component?.render === "function") {
        throw new Error("Unable to find node on an unmounted component.");
      }
      const keys = component != null ? Object.keys(component).join(",") : "";
      throw new Error(
        `Argument appears to not be a ReactComponent. Keys: ${keys}`,
      );
    }
    const hostFiber = findCurrentHostFiber(fiber);
    if (hostFiber === null) {
      return null;
    }
    if ((hostFiber.mode & StrictLegacyMode) !== 0) {
      const name = componentName(fiber);
      if (!didWarnAboutFindNodeInStrictMode[name]) {
        didWarnAboutFindNodeInStrictMode[name] = true;
        if ((fiber.mode & StrictLegacyMode) !== 0) {
          console.error(
            "%s is deprecated in StrictMode. " +
              "%s was passed an instance of %s which is inside StrictMode. " +
              "Instead, add a ref directly to the element you want to reference. " +
              "Learn more about using refs safely here: " +
              "https://reactjs.org/link/strict-mode-find-node",
            methodName,
            methodName,
            name,
          );
        } else {
          console.error(
            "%s is deprecated in StrictMode. " +
              "%s was passed an instance of %s which renders StrictMode children. " +
              "Instead, add a ref directly to the element you want to reference. " +
              "Learn more about using refs safely here: " +
              "https://reactjs.org/link/strict-mode-find-node",
            methodName,
            methodName,
            name,
          );
        }
      }
    }
    return hostFiber.stateNode;
  }
  return findHostInstance(component);
}

export function findHostInstanceWithNoPortals(fiber: FiberNode): any {
  const hostFiber = findCurrentHostFiberWithNoPortals(fiber);
  if (hostFiber === null) {
    return null;
  }
  return hostFiber.stateNode;
}

let shouldErrorImpl: (fiber: FiberNode) => boolean | null = () => null;
let shouldSuspendImpl: (fiber: FiberNode) => boolean = () => false;

export function shouldError(fiber: FiberNode): boolean | null {
  return shouldErrorImpl(fiber);
}

export function shouldSuspend(fiber: FiberNode): boolean {
  return shouldSuspendImpl(fiber);
}

function copyWithSet(obj: any, path: Array<string | number>, value: any): any {
  const copyWithSetImpl = (current: any, index: number): any => {
    if (index >= path.length) {
      return value;
    }
    const key = path[index];
    const updated = Array.isArray(current) ? current.slice() : { ...current };
    updated[key] = copyWithSetImpl(current?.[key], index + 1);
    return updated;
  };
  return copyWithSetImpl(obj, 0);
}

function copyWithDelete(obj: any, path: Array<string | number>): any {
  const copyWithDeleteImpl = (current: any, index: number): any => {
    const key = path[index];
    const updated = Array.isArray(current) ? current.slice() : { ...current };
    if (index + 1 === path.length) {
      if (Array.isArray(updated)) {
        updated.splice(key as number, 1);
      } else {
        delete updated[key];
      }
      return updated;
    }
    updated[key] = copyWithDeleteImpl(current[key], index + 1);
    return updated;
  };
  return copyWithDeleteImpl(obj, 0);
}

function copyWithRename(
  obj: any,
  oldPath: Array<string | number>,
  newPath: Array<string | number>,
): any {
  if (oldPath.length !== newPath.length) {
    console.warn("copyWithRename() expects paths of the same length");
    return;
  }
  for (let i = 0; i < newPath.length - 1; i++) {
    if (oldPath[i] !== newPath[i]) {
      console.warn(
        "copyWithRename() expects paths to be the same except for the deepest key",
      );
      return;
    }
  }
  const copyWithRenameImpl = (current: any, index: number): any => {
    const oldKey = oldPath[index];
    const updated = Array.isArray(current) ? current.slice() : { ...current };
    if (index + 1 === oldPath.length) {
      const newKey = newPath[index];
      updated[newKey] = updated[oldKey];
      if (Array.isArray(updated)) {
        updated.splice(oldKey as number, 1);
      } else {
        delete updated[oldKey];
      }
    } else {
      updated[oldKey] = copyWithRenameImpl(current[oldKey], index + 1);
    }
    return updated;
  };
  return copyWithRenameImpl(obj, 0);
}

function findHook(fiber: FiberNode, id: number): any {
  let currentHook = fiber.memoizedState;
  while (currentHook !== null && id > 0) {
    currentHook = currentHook.next;
    id--;
  }
  return currentHook;
}

function scheduleDevToolsUpdate(fiber: FiberNode): void {
  const root = enqueueConcurrentRenderForLane(fiber, SyncLane);
  if (root !== null) {
    scheduleUpdateOnFiber(root, fiber, SyncLane, NoTimestamp);
  }
}

let overrideHookState: any = null;
let overrideHookStateDeletePath: any = null;
let overrideHookStateRenamePath: any = null;
let overrideProps: any = null;
let overridePropsDeletePath: any = null;
let overridePropsRenamePath: any = null;
let scheduleUpdate: any = null;
let setErrorHandler: any = null;
let setSuspenseHandler: any = null;

if (__DEV__) {
  overrideHookState = (
    fiber: FiberNode,
    id: number,
    path: Array<string | number>,
    value: any,
  ) => {
    const hook = findHook(fiber, id);
    if (hook !== null) {
      const newState = copyWithSet(hook.memoizedState, path, value);
      hook.memoizedState = newState;
      hook.baseState = newState;
      fiber.memoizedProps = { ...fiber.memoizedProps };
      scheduleDevToolsUpdate(fiber);
    }
  };
  overrideHookStateDeletePath = (
    fiber: FiberNode,
    id: number,
    path: Array<string | number>,
  ) => {
    const hook = findHook(fiber, id);
    if (hook !== null) {
      const newState = copyWithDelete(hook.memoizedState, path);
      hook.memoizedState = newState;
      hook.baseState = newState;
      fiber.memoizedProps = { ...fiber.memoizedProps };
      scheduleDevToolsUpdate(fiber);
    }
  };
  overrideHookStateRenamePath = (
    fiber: FiberNode,
    id: number,
    oldPath: Array<string | number>,
    newPath: Array<string | number>,
  ) => {
    const hook = findHook(fiber, id);
    if (hook !== null) {
      const newState = copyWithRename(hook.memoizedState, oldPath, newPath);
      hook.memoizedState = newState;
      hook.baseState = newState;
      fiber.memoizedProps = { ...fiber.memoizedProps };
      scheduleDevToolsUpdate(fiber);
    }
  };
  overrideProps = (
    fiber: FiberNode,
    path: Array<string | number>,
    value: any,
  ) => {
    fiber.pendingProps = copyWithSet(fiber.memoizedProps, path, value);
    if (fiber.alternate) {
      fiber.alternate.pendingProps = fiber.pendingProps;
    }
    scheduleDevToolsUpdate(fiber);
  };
  overridePropsDeletePath = (
    fiber: FiberNode,
    path: Array<string | number>,
  ) => {
    fiber.pendingProps = copyWithDelete(fiber.memoizedProps, path);
    if (fiber.alternate) {
      fiber.alternate.pendingProps = fiber.pendingProps;
    }
    scheduleDevToolsUpdate(fiber);
  };
  overridePropsRenamePath = (
    fiber: FiberNode,
    oldPath: Array<string | number>,
    newPath: Array<string | number>,
  ) => {
    fiber.pendingProps = copyWithRename(fiber.memoizedProps, oldPath, newPath);
    if (fiber.alternate) {
      fiber.alternate.pendingProps = fiber.pendingProps;
    }
    scheduleDevToolsUpdate(fiber);
  };
  scheduleUpdate = (fiber: FiberNode) => {
    scheduleDevToolsUpdate(fiber);
  };
  setErrorHandler = (impl: (fiber: FiberNode) => boolean | null) => {
    shouldErrorImpl = impl;
  };
  setSuspenseHandler = (impl: (fiber: FiberNode) => boolean) => {
    shouldSuspendImpl = impl;
  };
}

function findHostInstanceByFiber(fiber: FiberNode): any {
  const hostFiber = findCurrentHostFiber(fiber);
  if (hostFiber === null) {
    return null;
  }
  return hostFiber.stateNode;
}

// 对照官方 injectIntoDevTools。React Refresh 与 __PROFILE__ 的 timeline hook
// 属于官方 feature flag 关闭的分支，18.3.1 默认构建不注入。
export function injectIntoDevTools(devToolsConfig: {
  findFiberByHostInstance?: (instance: any) => FiberNode | null;
  bundleType: number;
  version: string;
  rendererPackageName: string;
}): boolean {
  const { ReactCurrentDispatcher } = ReactSharedInternals;
  return injectInternals({
    bundleType: devToolsConfig.bundleType,
    version: devToolsConfig.version,
    rendererPackageName: devToolsConfig.rendererPackageName,
    overrideHookState,
    overrideHookStateDeletePath,
    overrideHookStateRenamePath,
    overrideProps,
    overridePropsDeletePath,
    overridePropsRenamePath,
    setErrorHandler,
    setSuspenseHandler,
    scheduleUpdate,
    currentDispatcherRef: ReactCurrentDispatcher,
    findHostInstanceByFiber,
    findFiberByHostInstance:
      devToolsConfig.findFiberByHostInstance || (() => null),
    findHostInstancesForRefresh: null,
    scheduleRefresh: null,
    scheduleRoot: null,
    setRefreshHandler: null,
    getCurrentFiber: null,
    reconcilerVersion: "18.3.1",
  });
}

export { NoLane };
