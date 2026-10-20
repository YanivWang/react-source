/**
 * @file HostConfig（渲染器与平台无关接口的占位实现）
 * @description reconciler 通过这组接口与具体渲染器（如 react-dom）解耦。官方在本文件里直接
 * throw，真正的实现由各渲染器在构建时通过 fork 注入（rollup 把本模块替换成
 * forks/ReactFiberHostConfig.dom.ts，后者 re-export react-dom 的 ReactDOMHostConfig）。
 * 本项目对齐官方：模块加载时立刻 throw，一旦 fork 配置失效、误用了这份兜底实现，会在第一
 * 时间报错而非等到某个函数被调用才暴露问题。
 *
 * 对照官方 packages/react-reconciler/src/ReactFiberHostConfig.js：官方文件里**只有**这一句
 * throw，连类型声明都没有——因为官方在类型层也做了 fork：.flowconfig 的 module.name_mapper
 * 把 ./ReactFiberHostConfig 映射到 forks 文件，Flow 检查时看到的就是真实实现。
 *
 * 本项目用 TS，tsconfig 的 paths 只作用于裸导入、管不了 `./ReactFiberHostConfig` 这种相对导入，
 * 类型层无法 fork。若把下面的声明删掉，五处消费方（ReactFiberCommitWork / CompleteWork /
 * Reconciler / Root / WorkLoop）会直接报 TS2306 "not a module"。所以这些 `declare` 是
 * TS 移植的必要补充，充当 HostConfig 的类型契约，编译后不产生任何运行时代码。
 */

throw new Error("This module must be shimmed by a specific renderer.");

// 泛型 renderer 的 Instance/TextInstance/Container/Props/Type 都是抽象类型，由渲染器具体化，
// 这里用 any 兜底（与仓库 ReactTypes.ts 的 ElementType 处理一致）。
export type Instance = any;
export type TextInstance = any;
export type Container = any;
export type Type = any;
export type Props = Record<string, any>;

// updatePayload 是 [key1, value1, key2, value2, ...] 的扁平数组，commitUpdate 按这个约定消费
export type UpdatePayload = any[];

// 下面这些 `declare` 只充当 HostConfig 的类型契约，编译后不产生任何运行时代码——
// 真正的实现由构建时 fork 注入（forks/ReactFiberHostConfig.dom.ts / .custom.ts）。
export declare const supportsMutation: boolean;
export declare const supportsPersistence: boolean;

export declare function createInstance(
  type: Type,
  props: Props,
  rootContainerInstance: Container,
  hostContext: any,
  internalInstanceHandle: any,
): Instance;

export declare function createTextInstance(
  text: string,
  rootContainerInstance: Container,
  hostContext: any,
  internalInstanceHandle: any,
): TextInstance;

export declare function appendInitialChild(
  parentInstance: Instance,
  child: Instance | TextInstance,
): void;

export declare function finalizeInitialChildren(
  instance: Instance,
  type: Type,
  props: Props,
  rootContainerInstance: Container,
  hostContext: any,
): boolean;

export declare function prepareUpdate(
  instance: Instance,
  type: Type,
  oldProps: Props,
  newProps: Props,
  rootContainerInstance: Container,
  hostContext: any,
): UpdatePayload | null;

export declare function commitUpdate(
  instance: Instance,
  updatePayload: UpdatePayload,
  type: Type,
  oldProps: Props,
  newProps: Props,
  internalInstanceHandle: any,
): void;

export declare function commitTextUpdate(
  textInstance: TextInstance,
  oldText: string,
  newText: string,
): void;

export declare function appendChild(
  parentInstance: Instance,
  child: Instance | TextInstance,
): void;

export declare function appendChildToContainer(
  container: Container,
  child: Instance | TextInstance,
): void;

export declare function insertBefore(
  parentInstance: Instance,
  child: Instance | TextInstance,
  beforeChild: Instance | TextInstance,
): void;

export declare function insertInContainerBefore(
  container: Container,
  child: Instance | TextInstance,
  beforeChild: Instance | TextInstance,
): void;

export declare function removeChild(
  parentInstance: Instance,
  child: Instance | TextInstance,
): void;

export declare function removeChildFromContainer(
  container: Container,
  child: Instance | TextInstance,
): void;

export declare function shouldSetTextContent(type: Type, props: Props): boolean;

export declare function getRootHostContext(container: Container): any;
export declare function getChildHostContext(
  parent: any,
  type: Type,
  container: Container,
): any;
export declare function clearContainer(container: Container): void;
export declare function resetTextContent(instance: Instance): void;
export declare function getCurrentEventPriority(): number;
export declare function preparePortalMount(container: Container): void;

export declare function scheduleMicrotask(callback: () => void): void;

// Suspense/Offscreen 切换隐藏/显示态时调用（Phase 9.1），纯 CSS 层面隐藏，DOM 节点仍然存在
export declare function hideInstance(instance: Instance): void;
export declare function unhideInstance(instance: Instance, props: Props): void;
export declare function hideTextInstance(textInstance: TextInstance): void;
export declare function unhideTextInstance(
  textInstance: TextInstance,
  text: string,
): void;
