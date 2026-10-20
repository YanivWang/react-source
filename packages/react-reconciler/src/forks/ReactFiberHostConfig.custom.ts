/**
 * @file ReactFiberHostConfig 的 custom fork（供 npm 上的 react-reconciler 包使用）
 * @description 对照官方 packages/react-reconciler/src/forks/ReactFiberHostConfig.custom.js。
 *
 * 官方在 scripts/shared/inlinedHostConfigs.js 里给 `react-reconciler` 这个 entry 单独分了
 * shortName `custom`，所以 standalone reconciler 产物同样会被 fork——只有 throw 的那份
 * ReactFiberHostConfig 占位模块从不会进入任何 bundle。
 *
 * 第三方渲染器的 API 是「把 host config 作为参数传进来」（`reconciler(hostConfig)`），而
 * reconciler 内部一律把 host config 当模块用（`import { createInstance } from './ReactFiberHostConfig'`）。
 * 本文件就是这两种世界之间的桥：把 `$$$config` 的属性逐个转成模块导出。
 *
 * `$$$config` 看起来像全局变量，实际上是顶层包裹函数的形参——scripts/rollup/wrappers.js 把整个
 * 产物包成：
 *
 *   module.exports = function $$$reconciler($$$config) {
 *     var exports = {};
 *     ...bundle 源码...
 *     return exports;
 *   };
 *
 * 故用 `declare const` 声明它，不产生运行时代码。
 *
 * 本文件只转发本项目已实现的 HostConfig 成员（对照 ReactFiberHostConfig.ts 的声明），官方那份
 * 还有 hydration / persistence 等大量可选成员，等对应 Phase 落地再补。
 */

declare const $$$config: any;

// 官方用 Flow 的 `opaque type ... = mixed` 让第三方渲染器无法窥探这些类型的实体，
// TS 没有 opaque type，用 unknown 表达「不透明、不可直接消费」的等价语义。
export type Type = unknown;
export type Props = unknown;
export type Container = unknown;
export type Instance = unknown;
export type TextInstance = unknown;
export type UpdatePayload = unknown;

export const supportsMutation = $$$config.supportsMutation;
export const supportsPersistence = $$$config.supportsPersistence;

export const createInstance = $$$config.createInstance;
export const createTextInstance = $$$config.createTextInstance;
export const appendInitialChild = $$$config.appendInitialChild;
export const finalizeInitialChildren = $$$config.finalizeInitialChildren;
export const prepareUpdate = $$$config.prepareUpdate;
export const commitUpdate = $$$config.commitUpdate;
export const commitTextUpdate = $$$config.commitTextUpdate;
export const appendChild = $$$config.appendChild;
export const appendChildToContainer = $$$config.appendChildToContainer;
export const insertBefore = $$$config.insertBefore;
export const insertInContainerBefore = $$$config.insertInContainerBefore;
export const removeChild = $$$config.removeChild;
export const removeChildFromContainer = $$$config.removeChildFromContainer;
export const shouldSetTextContent = $$$config.shouldSetTextContent;
export const getRootHostContext = $$$config.getRootHostContext;
export const getChildHostContext = $$$config.getChildHostContext;
export const clearContainer = $$$config.clearContainer;
export const resetTextContent = $$$config.resetTextContent;
export const getCurrentEventPriority = $$$config.getCurrentEventPriority;
export const preparePortalMount = $$$config.preparePortalMount;
export const scheduleMicrotask = $$$config.scheduleMicrotask;
export const hideInstance = $$$config.hideInstance;
export const unhideInstance = $$$config.unhideInstance;
export const hideTextInstance = $$$config.hideTextInstance;
export const unhideTextInstance = $$$config.unhideTextInstance;
