/**
 * @file Fiber 节点数据结构
 * @description Fiber 是 reconciler 的核心工作单元，构成 Fiber 树，替代旧版 Stack Reconciler 的递归调用栈
 */

import { REACT_FRAGMENT_TYPE } from "shared/ReactSymbols";
import type { ElementType, Key, Props, Ref } from "shared/ReactTypes";

import { NoFlags, StaticMask, type Flags } from "./ReactFiberFlags";
import { NoLanes, type Lanes } from "./ReactFiberLane";
import type { Dependencies } from "./ReactInternalTypes";
import { ConcurrentRoot, type RootTag } from "./ReactRootTags";
import {
  ConcurrentMode,
  NoMode,
  StrictLegacyMode,
  StrictEffectsMode,
  type TypeOfMode,
} from "./ReactTypeOfMode";
import {
  ClassComponent,
  ContextConsumer,
  ContextProvider,
  ForwardRef,
  Fragment,
  HostComponent,
  HostPortal,
  HostRoot,
  HostText,
  IndeterminateComponent,
  LazyComponent,
  MemoComponent,
  Mode,
  OffscreenComponent,
  SuspenseComponent,
  type WorkTag,
} from "./ReactWorkTags";
import {
  REACT_PROVIDER_TYPE,
  REACT_STRICT_MODE_TYPE,
  REACT_CONTEXT_TYPE,
  REACT_FORWARD_REF_TYPE,
  REACT_LAZY_TYPE,
  REACT_MEMO_TYPE,
  REACT_SUSPENSE_TYPE,
  REACT_OFFSCREEN_TYPE,
} from "shared/ReactSymbols";
import type { OffscreenInstance } from "./ReactFiberOffscreenComponent";

// 对照官方 packages/react-reconciler/src/ReactFiber.new.js：FiberNode 官方不用 class（用
// function 构造器 + new），这里为了 TS 里字段声明更直观改用 class，字段集合和初始值保持一致。
// pendingProps/memoizedProps 官方类型是 mixed（HostText 的 pendingProps 是字符串，其余是
// Props 对象），这里统一放宽成 any。
export class FiberNode {
  // Instance 相关：elementType 是未解析前的元素类型（可能被 lazy 等包装），type 是解析后的
  tag: WorkTag;
  key: Key;
  elementType: ElementType;
  type: ElementType;
  stateNode: any;

  // Fiber 树结构：父节点、第一个子节点、下一个兄弟节点，index 是在父节点 children 中的位置
  return: FiberNode | null;
  child: FiberNode | null;
  sibling: FiberNode | null;
  index: number;

  ref: Ref;

  pendingProps: any;
  memoizedProps: any;
  updateQueue: any;
  memoizedState: any;
  dependencies: Dependencies | null;

  mode: TypeOfMode;

  // 副作用标记：flags 是本 Fiber 自身的标记，subtreeFlags 是子树中所有 flags 的汇总（bubbleProperties 阶段收集）
  flags: Flags;
  subtreeFlags: Flags;
  deletions: FiberNode[] | null;

  // 优先级：lanes 是本 Fiber 自身待处理的更新优先级，childLanes 是子树汇总的优先级
  lanes: Lanes;
  childLanes: Lanes;

  // 双缓存树：current 树上的 Fiber 和 workInProgress 树上的 Fiber 互为 alternate
  alternate: FiberNode | null;

  constructor(tag: WorkTag, pendingProps: any, key: Key, mode: TypeOfMode) {
    this.tag = tag;
    this.key = key;
    this.elementType = null;
    this.type = null;
    this.stateNode = null;

    this.return = null;
    this.child = null;
    this.sibling = null;
    this.index = 0;

    this.ref = null;

    this.pendingProps = pendingProps;
    this.memoizedProps = null;
    this.updateQueue = null;
    this.memoizedState = null;
    this.dependencies = null;

    this.mode = mode;

    this.flags = NoFlags;
    this.subtreeFlags = NoFlags;
    this.deletions = null;

    this.lanes = NoLanes;
    this.childLanes = NoLanes;

    this.alternate = null;
  }
}

/**
 * 创建一个 Fiber 节点
 * @param tag - Fiber 对应的组件类型
 * @param pendingProps - 待处理的 props（HostText 是字符串，其余是 Props 对象）
 * @param key - 元素 key
 * @param mode - Fiber 所处的渲染模式，默认 NoMode（同步）
 */
export function createFiber(
  tag: WorkTag,
  pendingProps: any,
  key: Key,
  mode: TypeOfMode = NoMode,
): FiberNode {
  return new FiberNode(tag, pendingProps, key, mode);
}

// 对照官方 createWorkInProgress：双缓存（double buffering）的核心——一棵树最多只有两个版本，
// current 和 workInProgress 互为 alternate。首次更新时惰性新建 alternate，之后复用同一个
// alternate 对象并重置其字段，避免为从不更新的节点反复分配对象。
/**
 * 基于 current Fiber 创建（或复用）对应的 workInProgress Fiber
 * @param current - current 树上的 Fiber
 * @param pendingProps - 本次渲染待处理的 props
 * @returns workInProgress Fiber（与 current 互为 alternate）
 */
export function createWorkInProgress(
  current: FiberNode,
  pendingProps: any,
): FiberNode {
  let workInProgress = current.alternate;
  if (workInProgress === null) {
    // 惰性创建：只在第一次更新时分配 alternate
    workInProgress = createFiber(
      current.tag,
      pendingProps,
      current.key,
      current.mode,
    );
    workInProgress.elementType = current.elementType;
    workInProgress.type = current.type;
    workInProgress.stateNode = current.stateNode;

    workInProgress.alternate = current;
    current.alternate = workInProgress;
  } else {
    workInProgress.pendingProps = pendingProps;
    // Blocks 会把数据存在 type 上，这里需要同步最新的 type
    workInProgress.type = current.type;

    // 已有 alternate，重置 effect 标记
    workInProgress.flags = NoFlags;
    workInProgress.subtreeFlags = NoFlags;
    workInProgress.deletions = null;
  }

  // 重置除静态标记外的所有 effect（静态标记不随单次渲染变化，需保留）
  workInProgress.flags = current.flags & StaticMask;
  workInProgress.childLanes = current.childLanes;
  workInProgress.lanes = current.lanes;

  workInProgress.child = current.child;
  workInProgress.memoizedProps = current.memoizedProps;
  workInProgress.memoizedState = current.memoizedState;
  workInProgress.updateQueue = current.updateQueue;

  // dependencies 对象在渲染阶段会被修改，不能与 current 共享，浅克隆一份
  const currentDependencies = current.dependencies;
  workInProgress.dependencies =
    currentDependencies === null
      ? null
      : {
          lanes: currentDependencies.lanes,
          firstContext: currentDependencies.firstContext,
        };

  // 这些字段会在父级 reconcile 时被覆盖
  workInProgress.sibling = current.sibling;
  workInProgress.index = current.index;
  workInProgress.ref = current.ref;

  return workInProgress;
}

/**
 * 创建 HostRoot Fiber（整棵 Fiber 树的根节点）
 * @param tag - 根节点的渲染模式（LegacyRoot/ConcurrentRoot）
 */
export function createHostRootFiber(tag: RootTag): FiberNode {
  // 对照官方 createHostRootFiber：ConcurrentRoot 的根打上 ConcurrentMode，legacy 根是 NoMode
  const mode: TypeOfMode = tag === ConcurrentRoot ? ConcurrentMode : NoMode;
  return createFiber(HostRoot, null, null, mode);
}

// reconciler 不反向依赖 react 包（官方两者是解耦的独立包），这里只声明 createFiberFromElement
// 真正用得到的字段，而不是 import react 包里完整的 ReactElementType。
interface ReactElementLike {
  type: ElementType;
  key: Key;
  ref: Ref;
  props: Props;
}

/**
 * 根据 type + props 创建对应 WorkTag 的 Fiber 节点
 * @param type - 元素类型（原生标签名字符串 / 函数组件 / Fragment 等）
 * @param key - 元素 key
 * @param pendingProps - 元素 props
 * @param mode - Fiber 所处的渲染模式
 * @param lanes - Fiber 的优先级
 */
export function createFiberFromTypeAndProps(
  type: ElementType,
  key: Key,
  pendingProps: Props,
  mode: TypeOfMode,
  lanes: Lanes = NoLanes,
): FiberNode {
  let fiberTag: WorkTag = IndeterminateComponent;

  if (typeof type === "function") {
    fiberTag = type.prototype?.isReactComponent
      ? ClassComponent
      : IndeterminateComponent;
  } else if (typeof type === "string") {
    fiberTag = HostComponent;
  } else if (type === REACT_FRAGMENT_TYPE) {
    return createFiberFromFragment(pendingProps.children, mode, lanes, key);
  } else if (type === REACT_STRICT_MODE_TYPE) {
    fiberTag = Mode;
    mode |= StrictLegacyMode;
    if ((mode & ConcurrentMode) !== NoMode) mode |= StrictEffectsMode;
  } else if (type === REACT_SUSPENSE_TYPE) {
    return createFiberFromSuspense(pendingProps, mode, lanes, key);
  } else if (type === REACT_OFFSCREEN_TYPE) {
    return createFiberFromOffscreen(pendingProps, mode, lanes, key);
  } else if (typeof type === "object" && type !== null) {
    // <Context.Provider>/<Context.Consumer> 元素的 type 是 createContext 生成的
    // Provider/Context 对象本身（不是函数），forwardRef()/memo() 返回的也是对象而非函数，
    // 都靠 $$typeof 区分（对照官方 getTag 分支）
    switch (type.$$typeof) {
      case REACT_PROVIDER_TYPE:
        fiberTag = ContextProvider;
        break;
      case REACT_CONTEXT_TYPE:
        fiberTag = ContextConsumer;
        break;
      case REACT_FORWARD_REF_TYPE:
        fiberTag = ForwardRef;
        break;
      case REACT_MEMO_TYPE:
        fiberTag = MemoComponent;
        break;
      case REACT_LAZY_TYPE:
        fiberTag = LazyComponent;
        break;
      default:
        throw new Error(
          `Element type is invalid: expected a string (for built-in components) ` +
            `or a class/function (for composite components) but got: object.`,
        );
    }
  } else {
    throw new Error(
      `Element type is invalid: expected a string (for built-in components) ` +
        `or a class/function (for composite components) but got: ${type == null ? type : typeof type}.`,
    );
  }

  const fiber = createFiber(fiberTag, pendingProps, key, mode);
  fiber.elementType = type;
  fiber.type = type;
  fiber.lanes = lanes;
  return fiber;
}

/**
 * 根据 ReactElement 创建对应的 Fiber 节点
 * @param element - 待转换的 ReactElement
 * @param mode - Fiber 所处的渲染模式
 * @param lanes - Fiber 的优先级
 */
export function createFiberFromElement(
  element: ReactElementLike,
  mode: TypeOfMode,
  lanes: Lanes = NoLanes,
): FiberNode {
  const fiber = createFiberFromTypeAndProps(
    element.type,
    element.key,
    element.props,
    mode,
    lanes,
  );
  // 对照官方：ref 的赋值官方放在 ReactChildFiber 的 coerceRef（因为字符串 ref 要转成函数并
  // 触发警告，需要 returnFiber 上下文）。本项目字符串 ref 的自动转换尚未实现，这里直接透传。
  fiber.ref = element.ref;
  return fiber;
}

/**
 * 根据 Fragment 的 children 创建 Fragment 类型的 Fiber 节点
 * @param elements - Fragment 的 children
 * @param mode - Fiber 所处的渲染模式
 * @param lanes - Fiber 的优先级
 * @param key - 元素 key
 */
export function createFiberFromFragment(
  elements: any,
  mode: TypeOfMode,
  lanes: Lanes = NoLanes,
  key: Key = null,
): FiberNode {
  const fiber = createFiber(Fragment, elements, key, mode);
  fiber.lanes = lanes;
  return fiber;
}

/**
 * 创建 SuspenseComponent 类型的 Fiber 节点
 * @param pendingProps - Suspense 的 props（fallback/children）
 * @param mode - Fiber 所处的渲染模式
 * @param lanes - Fiber 的优先级
 * @param key - 元素 key
 */
export function createFiberFromSuspense(
  pendingProps: any,
  mode: TypeOfMode,
  lanes: Lanes,
  key: Key,
): FiberNode {
  const fiber = createFiber(SuspenseComponent, pendingProps, key, mode);
  fiber.elementType = REACT_SUSPENSE_TYPE;
  fiber.type = REACT_SUSPENSE_TYPE;
  fiber.lanes = lanes;
  return fiber;
}

/**
 * 创建 OffscreenComponent 类型的 Fiber 节点
 * @param pendingProps - Offscreen 的 props（mode/children）
 * @param mode - Fiber 所处的渲染模式
 * @param lanes - Fiber 的优先级
 * @param key - 元素 key
 */
export function createFiberFromOffscreen(
  pendingProps: any,
  mode: TypeOfMode,
  lanes: Lanes,
  key: Key,
): FiberNode {
  const fiber = createFiber(OffscreenComponent, pendingProps, key, mode);
  fiber.elementType = REACT_OFFSCREEN_TYPE;
  fiber.type = REACT_OFFSCREEN_TYPE;
  fiber.lanes = lanes;
  // OffscreenInstance：isHidden 供 commitWork 判断上一次的隐藏态，决定是否需要
  // hideOrUnhideAllChildren（对照官方 stateNode 的用途）
  const instance: OffscreenInstance = { isHidden: false };
  fiber.stateNode = instance;
  return fiber;
}

/**
 * 创建文本类型的 Fiber 节点
 * @param content - 文本内容（作为 pendingProps，memoizedProps 在 beginWork 结束后由 workLoop 赋同值）
 * @param mode - Fiber 所处的渲染模式
 * @param lanes - Fiber 的优先级
 */
export function createFiberFromText(
  content: string,
  mode: TypeOfMode,
  lanes: Lanes = NoLanes,
): FiberNode {
  const fiber = createFiber(HostText, content, null, mode);
  fiber.lanes = lanes;
  return fiber;
}

// reconciler 不反向依赖 react-reconciler/src/ReactPortal 的具体类型（保持与 ReactElementLike
// 一致的取舍），只声明用得到的字段。
interface ReactPortalLike {
  key: Key;
  children: any;
  containerInfo: any;
  implementation: any;
}

/**
 * 根据 Portal 创建 HostPortal 类型的 Fiber 节点
 * @param portal - createPortal 创建的 Portal 对象
 * @param mode - Fiber 所处的渲染模式
 * @param lanes - Fiber 的优先级
 */
export function createFiberFromPortal(
  portal: ReactPortalLike,
  mode: TypeOfMode,
  lanes: Lanes = NoLanes,
): FiberNode {
  const pendingProps = portal.children !== null ? portal.children : [];
  const fiber = createFiber(HostPortal, pendingProps, portal.key, mode);
  fiber.lanes = lanes;
  fiber.stateNode = {
    containerInfo: portal.containerInfo,
    pendingChildren: null,
    implementation: portal.implementation,
  };
  return fiber;
}
