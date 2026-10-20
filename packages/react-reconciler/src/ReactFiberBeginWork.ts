import { REACT_FORWARD_REF_TYPE, REACT_MEMO_TYPE } from "shared/ReactSymbols";
/**
 * @file beginWork（Fiber 树构建 - 向下递阶段）
 * @description 对每个 Fiber 执行"递"阶段：根据 tag 分发，计算新 props/state，reconcile 出子 fiber
 */

import is from "shared/objectIs";
import type { ReactContext, ReactProviderType } from "shared/ReactTypes";
import shallowEqual from "shared/shallowEqual";

import {
  cloneChildFibers,
  mountChildFibers,
  reconcileChildFibers,
} from "./ReactChildFiber";
import {
  cloneUpdateQueue,
  processUpdateQueue,
} from "./ReactFiberClassUpdateQueue";
import {
  constructClassInstance,
  mountClassInstance,
  resumeMountClassInstance,
  updateClassInstance,
} from "./ReactFiberClassComponent";
import {
  createFiberFromFragment,
  createFiberFromOffscreen,
  createFiberFromTypeAndProps,
  createWorkInProgress,
  type FiberNode,
} from "./ReactFiber";
import {
  ChildDeletion,
  DidCapture,
  NoFlags,
  PerformedWork,
  Placement,
  Ref,
} from "./ReactFiberFlags";
import {
  NoLanes,
  includesSomeLane,
  mergeLanes,
  type Lanes,
} from "./ReactFiberLane";
import { StrictLegacyMode } from "./ReactTypeOfMode";
import { renderWithHooks, bailoutHooks } from "./ReactFiberHooks";
import {
  prepareToReadContext,
  propagateContextChange,
  pushProvider,
  readContext,
} from "./ReactFiberNewContext";
import {
  ClassComponent,
  ContextConsumer,
  ContextProvider,
  ForwardRef,
  Fragment,
  FunctionComponent,
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
} from "./ReactWorkTags";
import type {
  OffscreenProps,
  OffscreenState,
} from "./ReactFiberOffscreenComponent";
import type { SuspenseState } from "./ReactFiberThrow";

// 模块级状态：本次 beginWork 是否接收到了新的 props/state/context。
// 官方用 didReceiveUpdate 在 dispatch 顶层与各 update* 分支之间传递"是否要重渲染"的信号，
// 函数组件渲染结束后据此决定是 bailout 还是继续 reconcile children。
let didReceiveUpdate = false;

// 对照官方 markRef：ref 引用变化（mount 时非空，或 update 时与上次不同）才打 Ref flag，
// commit 阶段的 commitAttachRef/commitDetachRef 据此决定要不要挂载/卸载 ref。
// HostComponent/ClassComponent/ForwardRef 三种能持有 stateNode/实例的 fiber 会调用它。
function markRef(current: FiberNode | null, workInProgress: FiberNode): void {
  const ref = workInProgress.ref;
  if (
    (current === null && ref !== null) ||
    (current !== null && current.ref !== ref)
  ) {
    workInProgress.flags |= Ref;
  }
}

/**
 * 对比 current 与新 children，决定复用/新建/删除子 fiber
 * @param current - current 树上的对应 fiber
 * @param workInProgress - workInProgress fiber
 * @param nextChildren - 新的 children
 * @param renderLanes - 本次渲染的 lanes
 */
export function reconcileChildren(
  current: FiberNode | null,
  workInProgress: FiberNode,
  nextChildren: any,
  renderLanes: Lanes,
): void {
  if (current === null) {
    // 全新的组件，子 fiber 全部新建；用 mountChildFibers（不标记副作用），
    // 父 fiber 自身已是 Placement，commit 阶段只挂顶层节点即可
    workInProgress.child = mountChildFibers(
      workInProgress,
      null,
      nextChildren,
      renderLanes,
    );
  } else {
    // 复用/更新：标记 Placement/ChildDeletion
    workInProgress.child = reconcileChildFibers(
      workInProgress,
      current.child,
      nextChildren,
      renderLanes,
    );
  }
}

// 对照官方 shouldConstruct：看 type.prototype 上是否有 isReactComponent 标记
// （Component.prototype.isReactComponent，见 ReactBaseClasses.ts）区分 class/function。
function shouldConstruct(Component: any): boolean {
  const prototype = Component.prototype;
  return !!(prototype && prototype.isReactComponent);
}

// mountIndeterminateComponent：首次挂载时还不确定是 class 还是 function，
// shouldConstruct 命中就转去走 class 组件的实例化 + 生命周期链路；否则按函数组件定型。
// 官方这里还会探测"函数返回 class 实例"的 module pattern 组件，本项目不支持，忽略。
function mountIndeterminateComponent(
  _current: FiberNode | null,
  workInProgress: FiberNode,
  Component: any,
  renderLanes: Lanes,
): FiberNode | null {
  const props = workInProgress.pendingProps;

  if (shouldConstruct(Component)) {
    workInProgress.tag = ClassComponent;
    constructClassInstance(workInProgress, Component, props);
    mountClassInstance(workInProgress, Component, props);
    return finishClassComponent(
      null,
      workInProgress,
      Component,
      true,
      renderLanes,
    );
  }

  prepareToReadContext(workInProgress, renderLanes);
  const value = renderWithHooks(
    null,
    workInProgress,
    Component,
    props,
    undefined,
    renderLanes,
  );

  // DevTools 读取这个 flag 判断组件是否执行过
  workInProgress.flags |= PerformedWork;

  workInProgress.tag = FunctionComponent;

  reconcileChildren(null, workInProgress, value, renderLanes);
  return workInProgress.child;
}

// 对照官方 finishClassComponent：调用 instance.render() 拿到 children 并 reconcile，
// shouldUpdate 为 false（sCU 拦下）时走 bailout（仍需 cloneChildFibers 保证子树结构一致）。
function finishClassComponent(
  current: FiberNode | null,
  workInProgress: FiberNode,
  _Component: any,
  shouldUpdate: boolean,
  renderLanes: Lanes,
): FiberNode | null {
  // ref 即使 shouldComponentUpdate 拦下了本次渲染也要更新（官方注释同此）
  markRef(current, workInProgress);

  const didCapture = (workInProgress.flags & DidCapture) !== NoFlags;
  if (!shouldUpdate && !didCapture) {
    return bailoutOnAlreadyFinishedWork(
      current as FiberNode,
      workInProgress,
      renderLanes,
    );
  }

  const instance = workInProgress.stateNode;
  if (__DEV__ && (workInProgress.mode & StrictLegacyMode) !== 0 && !didCapture)
    instance.render();
  const nextChildren =
    didCapture && typeof _Component.getDerivedStateFromError !== "function"
      ? null
      : instance.render();

  workInProgress.flags |= PerformedWork;
  if (current !== null && didCapture) {
    // 错误恢复不能复用已出错的子树，即使 fallback 的 type/key 相同。
    reconcileChildren(current, workInProgress, null, renderLanes);
    workInProgress.child = reconcileChildFibers(
      workInProgress,
      null,
      nextChildren,
      renderLanes,
    );
  } else reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

// 对照官方 updateClassComponent：current === null 是 resumeMountClassInstance 场景——
// 边界组件自身在本次渲染中首次挂载，子树抛错后 unwindWork 把它标记 DidCapture 重新进入
// beginWork（此时 stateNode 已由第一次 beginWork 的 constructClassInstance 建好，
// 只是还没走完 finishClassComponent，current 依旧是 null）。
function updateClassComponent(
  current: FiberNode | null,
  workInProgress: FiberNode,
  Component: any,
  nextProps: any,
  renderLanes: Lanes,
): FiberNode | null {
  if (workInProgress.stateNode === null) {
    constructClassInstance(workInProgress, Component, nextProps);
    mountClassInstance(workInProgress, Component, nextProps);
    return finishClassComponent(
      current,
      workInProgress,
      Component,
      true,
      renderLanes,
    );
  }
  const shouldUpdate =
    current === null
      ? resumeMountClassInstance(
          workInProgress,
          Component,
          nextProps,
          renderLanes,
        )
      : updateClassInstance(
          current,
          workInProgress,
          Component,
          nextProps,
          renderLanes,
        );
  return finishClassComponent(
    current,
    workInProgress,
    Component,
    shouldUpdate,
    renderLanes,
  );
}

function updateFunctionComponent(
  current: FiberNode | null,
  workInProgress: FiberNode,
  Component: any,
  nextProps: any,
  renderLanes: Lanes,
): FiberNode | null {
  prepareToReadContext(workInProgress, renderLanes);
  const nextChildren = renderWithHooks(
    current,
    workInProgress,
    Component,
    nextProps,
    undefined,
    renderLanes,
  );

  if (current !== null && !didReceiveUpdate) {
    bailoutHooks(current, workInProgress, renderLanes);
    // 没有新的 props/state，children 不变，bailout
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
  }

  workInProgress.flags |= PerformedWork;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

// 对照官方 updateForwardRef：是 updateFunctionComponent 的一个分支——render 函数额外多收
// fiber.ref 作为第二个参数（通过 renderWithHooks 的 secondArg 透传），其余渲染/bailout 逻辑
// 完全一致；ref 本身的挂载/更新由 markRef 统一处理（beginWork 分发处调用）。
function updateForwardRef(
  current: FiberNode | null,
  workInProgress: FiberNode,
  Component: any,
  nextProps: any,
  renderLanes: Lanes,
): FiberNode | null {
  const render = Component.render;
  const ref = workInProgress.ref;

  prepareToReadContext(workInProgress, renderLanes);
  const nextChildren = renderWithHooks(
    current,
    workInProgress,
    render,
    nextProps,
    ref,
    renderLanes,
  );

  if (current !== null && !didReceiveUpdate) {
    bailoutHooks(current, workInProgress, renderLanes);
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
  }

  workInProgress.flags |= PerformedWork;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

// 对照官方 updateMemoComponent（简化版，不含 SimpleMemoComponent 快路径升级）：
// mount 时直接建一个内部 fiber（类型是 Component.type，克隆走 createFiberFromTypeAndProps）；
// update 时若无待处理更新/context，用 compare（默认 shallowEqual）比较新旧 props，props 相等
// 且 ref 相同则 bailout，否则克隆内部 fiber 继续渲染。
function updateMemoComponent(
  current: FiberNode | null,
  workInProgress: FiberNode,
  Component: any,
  nextProps: any,
  renderLanes: Lanes,
): FiberNode | null {
  if (current === null) {
    const type = Component.type;
    const child = createFiberFromTypeAndProps(
      type,
      null,
      nextProps,
      workInProgress.mode,
      renderLanes,
    );
    child.ref = workInProgress.ref;
    child.return = workInProgress;
    workInProgress.child = child;
    return child;
  }

  const currentChild = current.child as FiberNode;
  const hasScheduledUpdateOrContext = checkScheduledUpdateOrContext(
    current,
    renderLanes,
  );
  if (!hasScheduledUpdateOrContext) {
    const prevProps = currentChild.memoizedProps;
    const compare =
      Component.compare !== null ? Component.compare : shallowEqual;
    if (compare(prevProps, nextProps) && current.ref === workInProgress.ref) {
      return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
    }
  }

  workInProgress.flags |= PerformedWork;
  const newChild = createWorkInProgress(currentChild, nextProps);
  newChild.ref = workInProgress.ref;
  newChild.return = workInProgress;
  workInProgress.child = newChild;
  return newChild;
}

// 对照官方 mountLazyComponent（简化：不含 resolveDefaultProps/热更新分支，只处理
// FunctionComponent/ClassComponent 两种最常见的懒加载目标）：_init(_payload) 还没 resolve
// 时直接 throw 出内部的 thenable（ReactLazy.ts 的 lazyInitializer），被 Suspense 的
// throwException 捕获走挂起流程；resolve 后这里能拿到真正的 Component，按 shouldConstruct
// 分流到 updateClassComponent/updateFunctionComponent，同时把 workInProgress.type 换成
// 解析后的 Component（下次更新直接按普通组件处理，不用再走 LazyComponent 分支）。
function mountLazyComponent(
  _current: FiberNode | null,
  workInProgress: FiberNode,
  elementType: any,
  renderLanes: Lanes,
): FiberNode | null {
  const props = workInProgress.pendingProps;
  const payload = elementType._payload;
  const init = elementType._init;
  const Component = init(payload);
  workInProgress.type = Component;

  if (shouldConstruct(Component)) {
    workInProgress.tag = ClassComponent;
    return updateClassComponent(
      null,
      workInProgress,
      Component,
      props,
      renderLanes,
    );
  }

  if (typeof Component === "object" && Component !== null) {
    if (Component.$$typeof === REACT_FORWARD_REF_TYPE) {
      workInProgress.tag = ForwardRef;
      return updateForwardRef(
        null,
        workInProgress,
        Component,
        props,
        renderLanes,
      );
    }
    if (Component.$$typeof === REACT_MEMO_TYPE) {
      workInProgress.tag = MemoComponent;
      return updateMemoComponent(
        null,
        workInProgress,
        Component,
        props,
        renderLanes,
      );
    }
  }
  if (typeof Component !== "function")
    throw new Error("lazy: expected a class or function component.");
  workInProgress.tag = FunctionComponent;
  return updateFunctionComponent(
    null,
    workInProgress,
    Component,
    props,
    renderLanes,
  );
}

// 对照官方 updatePortalComponent：Portal 没有 memoizedState 那一层间接（不像 HostRoot 要
// 从 update payload 里取 element），pendingProps 本身就是 children，reconcile 逻辑与
// updateHostComponent 平行——只是子树的真实 DOM 挂到 workInProgress.stateNode.containerInfo，
// 不是当前 Fiber 树的宿主父节点（在 completeWork/commitWork 里体现）。
function updatePortalComponent(
  current: FiberNode | null,
  workInProgress: FiberNode,
  renderLanes: Lanes,
): FiberNode | null {
  const nextChildren = workInProgress.pendingProps;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

function updateHostRoot(
  current: FiberNode | null,
  workInProgress: FiberNode,
  renderLanes: Lanes,
): FiberNode | null {
  if (current === null) {
    throw new Error("Should have a current fiber. This is a bug in React.");
  }

  const nextProps = workInProgress.pendingProps;
  const prevState = workInProgress.memoizedState;
  const prevChildren = prevState.element;

  cloneUpdateQueue(current, workInProgress);
  processUpdateQueue(workInProgress, nextProps, null, renderLanes);

  const nextState = workInProgress.memoizedState;
  // 官方注释：DevTools 依赖这个字段名叫 "element"
  const nextChildren = nextState.element;

  if (nextChildren === prevChildren) {
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
  }
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

function updateHostComponent(
  current: FiberNode | null,
  workInProgress: FiberNode,
  renderLanes: Lanes,
): FiberNode | null {
  const nextProps = workInProgress.pendingProps;
  // 官方这里还有 shouldSetTextContent 的直接文本子节点优化（textarea/option/input 等
  // 直接把 children 当 textContent、不再生成 HostText fiber），等 react-dom 落地时补。
  const nextChildren = nextProps.children;
  markRef(current, workInProgress);
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

function updateHostText(
  _current: FiberNode | null,
  _workInProgress: FiberNode,
): null {
  // 文本节点是终态，没有 children，complete 阶段紧接着处理
  return null;
}

function updateFragment(
  current: FiberNode | null,
  workInProgress: FiberNode,
  renderLanes: Lanes,
): FiberNode | null {
  const nextChildren = workInProgress.pendingProps;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

function updateMode(
  current: FiberNode | null,
  workInProgress: FiberNode,
  renderLanes: Lanes,
): FiberNode | null {
  const nextChildren = workInProgress.pendingProps.children;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

// 对照官方 updateContextProvider：把新 value 压栈（子树渲染期间 context._currentValue
// 就是这个新值），value 变化时用 propagateContextChange 主动标记消费该 context 的子树；
// value 没变且 children 引用也没变时可以直接 bailout。
function updateContextProvider(
  current: FiberNode | null,
  workInProgress: FiberNode,
  renderLanes: Lanes,
): FiberNode | null {
  const providerType: ReactProviderType<any> = workInProgress.type;
  const context: ReactContext<any> = providerType._context;

  const newProps = workInProgress.pendingProps;
  const oldProps = workInProgress.memoizedProps;
  const newValue = newProps.value;

  pushProvider(workInProgress, context, newValue);

  if (current !== null && oldProps !== null) {
    const oldValue = oldProps.value;
    if (is(oldValue, newValue)) {
      if (oldProps.children === newProps.children) {
        return bailoutOnAlreadyFinishedWork(
          current,
          workInProgress,
          renderLanes,
        );
      }
    } else {
      // value 变了，主动查找子树里消费该 context 的 fiber 并标记需要重渲染
      propagateContextChange(workInProgress, context, renderLanes);
    }
  }

  const newChildren = newProps.children;
  reconcileChildren(current, workInProgress, newChildren, renderLanes);
  return workInProgress.child;
}

// 对照官方 updateContextConsumer：<Context.Consumer> 的 children 是一个接收 context 当前值
// 的函数（render prop 模式），本项目暂不实现 class 组件 contextType，useContext 走
// ReactFiberHooks 的 dispatcher，不经过这里。
// 对照官方 mountSuspenseOffscreenState（简化：去掉 cachePool/transitions）
function mountSuspenseOffscreenState(renderLanes: Lanes): OffscreenState {
  return { baseLanes: renderLanes };
}

// 对照官方 updateSuspenseOffscreenState
function updateSuspenseOffscreenState(
  prevOffscreenState: OffscreenState,
  renderLanes: Lanes,
): OffscreenState {
  return { baseLanes: mergeLanes(prevOffscreenState.baseLanes, renderLanes) };
}

// 对照官方 mountSuspenseFallbackChildren：showFallback 分支的挂载——primary 内容包一层
// hidden 态 Offscreen（保留其渲染结果，只是隐藏），fallback 内容作为它的兄弟 Fragment 直接挂载。
function mountSuspenseFallbackChildren(
  workInProgress: FiberNode,
  primaryChildren: any,
  fallbackChildren: any,
  renderLanes: Lanes,
): FiberNode {
  const mode = workInProgress.mode;

  const primaryChildProps: OffscreenProps = {
    mode: "hidden",
    children: primaryChildren,
  };
  const primaryChildFragment = createFiberFromOffscreen(
    primaryChildProps,
    mode,
    NoLanes,
    null,
  );
  const fallbackChildFragment = createFiberFromFragment(
    fallbackChildren,
    mode,
    renderLanes,
    null,
  );

  primaryChildFragment.return = workInProgress;
  fallbackChildFragment.return = workInProgress;
  primaryChildFragment.sibling = fallbackChildFragment;
  workInProgress.child = primaryChildFragment;
  return fallbackChildFragment;
}

// 对照官方 mountSuspensePrimaryChildren：不挂起时只挂一个可见态的 Offscreen 包 primary 内容，
// 没有 fallback 兄弟节点。
function mountSuspensePrimaryChildren(
  workInProgress: FiberNode,
  primaryChildren: any,
): FiberNode {
  const mode = workInProgress.mode;
  const primaryChildProps: OffscreenProps = {
    mode: "visible",
    children: primaryChildren,
  };
  const primaryChildFragment = createFiberFromOffscreen(
    primaryChildProps,
    mode,
    NoLanes,
    null,
  );
  primaryChildFragment.return = workInProgress;
  workInProgress.child = primaryChildFragment;
  return primaryChildFragment;
}

// 对照官方 updateWorkInProgressOffscreenFiber：复用/克隆 current 的 Offscreen fiber，
// 只换 pendingProps（mode/children）。
function updateWorkInProgressOffscreenFiber(
  current: FiberNode,
  offscreenProps: OffscreenProps,
): FiberNode {
  return createWorkInProgress(current, offscreenProps);
}

// 对照官方 updateSuspenseFallbackChildren：update 时切到展示 fallback——复用 current 的
// primary Offscreen fiber（切成 hidden 态），fallback 一侧若 current 已有旧 fallback 就
// 复用 clone，否则新建。
function updateSuspenseFallbackChildren(
  current: FiberNode,
  workInProgress: FiberNode,
  primaryChildren: any,
  fallbackChildren: any,
  renderLanes: Lanes,
): FiberNode {
  const currentPrimaryChildFragment = current.child as FiberNode;
  const currentFallbackChildFragment: FiberNode | null =
    currentPrimaryChildFragment.sibling;

  const primaryChildProps: OffscreenProps = {
    mode: "hidden",
    children: primaryChildren,
  };
  const primaryChildFragment = updateWorkInProgressOffscreenFiber(
    currentPrimaryChildFragment,
    primaryChildProps,
  );
  primaryChildFragment.return = workInProgress;

  let fallbackChildFragment: FiberNode;
  if (currentFallbackChildFragment !== null) {
    fallbackChildFragment = createWorkInProgress(
      currentFallbackChildFragment,
      fallbackChildren,
    );
  } else {
    fallbackChildFragment = createFiberFromFragment(
      fallbackChildren,
      workInProgress.mode,
      renderLanes,
      null,
    );
    // 父 Suspense 已挂载，而 fallback 是新子树；mountChildFibers 不负责插入标志。
    fallbackChildFragment.flags |= Placement;
  }
  fallbackChildFragment.return = workInProgress;

  primaryChildFragment.sibling = fallbackChildFragment;
  workInProgress.child = primaryChildFragment;
  return fallbackChildFragment;
}

// 对照官方 updateSuspensePrimaryChildren：update 时切回/维持展示 primary——复用 current 的
// primary Offscreen fiber（切成 visible 态），若 current 还带着旧 fallback 则打 ChildDeletion。
function updateSuspensePrimaryChildren(
  current: FiberNode,
  workInProgress: FiberNode,
  primaryChildren: any,
): FiberNode {
  const currentPrimaryChildFragment = current.child as FiberNode;
  const currentFallbackChildFragment: FiberNode | null =
    currentPrimaryChildFragment.sibling;

  const primaryChildProps: OffscreenProps = {
    mode: "visible",
    children: primaryChildren,
  };
  const primaryChildFragment = updateWorkInProgressOffscreenFiber(
    currentPrimaryChildFragment,
    primaryChildProps,
  );
  primaryChildFragment.return = workInProgress;
  primaryChildFragment.sibling = null;

  if (currentFallbackChildFragment !== null) {
    const deletions = workInProgress.deletions;
    if (deletions === null) {
      workInProgress.deletions = [currentFallbackChildFragment];
      workInProgress.flags |= ChildDeletion;
    } else {
      deletions.push(currentFallbackChildFragment);
    }
  }

  workInProgress.child = primaryChildFragment;
  return primaryChildFragment;
}

// 对照官方 updateSuspenseComponent（简化：不含 SuspenseContext 栈/dehydration/SuspenseList）：
// showFallback 由 DidCapture 决定——unwindWork 在 throwException 命中这个边界后翻转了这个
// flag，重新进入 beginWork 时据此判断本次要渡染 fallback 还是 primary。
function updateSuspenseComponent(
  current: FiberNode | null,
  workInProgress: FiberNode,
  renderLanes: Lanes,
): FiberNode | null {
  const nextProps = workInProgress.pendingProps;
  let showFallback = false;
  const didSuspend = (workInProgress.flags & DidCapture) !== NoFlags;
  if (didSuspend) {
    showFallback = true;
    workInProgress.flags &= ~DidCapture;
  }

  if (current === null) {
    if (showFallback) {
      const fallbackFragment = mountSuspenseFallbackChildren(
        workInProgress,
        nextProps.children,
        nextProps.fallback,
        renderLanes,
      );
      const primaryChildFragment = workInProgress.child as FiberNode;
      primaryChildFragment.memoizedState =
        mountSuspenseOffscreenState(renderLanes);
      workInProgress.memoizedState = { retryLane: renderLanes };
      return fallbackFragment;
    }
    const primaryChildFragment = mountSuspensePrimaryChildren(
      workInProgress,
      nextProps.children,
    );
    workInProgress.memoizedState = null;
    return primaryChildFragment;
  }

  // update：current.memoizedState 非 null 说明上一次渲染就是展示 fallback
  const prevState: SuspenseState | null = current.memoizedState;
  if (showFallback) {
    const fallbackFragment = updateSuspenseFallbackChildren(
      current,
      workInProgress,
      nextProps.children,
      nextProps.fallback,
      renderLanes,
    );
    const primaryChildFragment = workInProgress.child as FiberNode;
    const prevOffscreenState: OffscreenState | null = (
      current.child as FiberNode
    ).memoizedState;
    primaryChildFragment.memoizedState =
      prevOffscreenState === null
        ? mountSuspenseOffscreenState(renderLanes)
        : updateSuspenseOffscreenState(prevOffscreenState, renderLanes);
    workInProgress.memoizedState = { retryLane: renderLanes };
    return fallbackFragment;
  }

  const primaryChildFragment = updateSuspensePrimaryChildren(
    current,
    workInProgress,
    nextProps.children,
  );
  workInProgress.memoizedState = null;
  void prevState;
  return primaryChildFragment;
}

// 对照官方 updateOffscreenComponent（简化：不做 hidden 时 bail-out-and-defer 到 OffscreenLane
// 的机制，始终正常 reconcile children——隐藏效果完全交给 commit 阶段的 Visibility flag +
// hideInstance/unhideInstance 处理，对应 Phase 9.1 计划的简化点 2）。memoizedState 是否为
// null 由 nextProps.mode 决定（"hidden" 才有 state），completeWork 据此对比新旧状态打
// Visibility flag。
function updateOffscreenComponent(
  current: FiberNode | null,
  workInProgress: FiberNode,
  renderLanes: Lanes,
): FiberNode | null {
  const nextProps: OffscreenProps = workInProgress.pendingProps;
  const nextChildren = nextProps.children;
  const nextIsHidden = nextProps.mode === "hidden";

  if (!nextIsHidden) {
    workInProgress.memoizedState = null;
  } else {
    const prevState: OffscreenState | null =
      current !== null ? current.memoizedState : null;
    workInProgress.memoizedState =
      prevState !== null
        ? updateSuspenseOffscreenState(prevState, renderLanes)
        : mountSuspenseOffscreenState(renderLanes);
  }

  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

function updateContextConsumer(
  current: FiberNode | null,
  workInProgress: FiberNode,
  renderLanes: Lanes,
): FiberNode | null {
  const context: ReactContext<any> = workInProgress.type;
  const newProps = workInProgress.pendingProps;
  const render = newProps.children;

  prepareToReadContext(workInProgress, renderLanes);
  const newValue = readContext(context);
  const newChildren = render(newValue);

  workInProgress.flags |= PerformedWork;
  reconcileChildren(current, workInProgress, newChildren, renderLanes);
  return workInProgress.child;
}

// legacy context 未实现，恒返回 false（官方在 hasLegacyContextChanged 里对比 context 栈）
function hasLegacyContextChanged(): boolean {
  return false;
}

function checkScheduledUpdateOrContext(
  current: FiberNode,
  renderLanes: Lanes,
): boolean {
  // 提前 bailout 前，检查是否有待处理的更新（context 懒传播留到 Phase 7）
  const updateLanes = current.lanes;
  return includesSomeLane(updateLanes, renderLanes);
}

function attemptEarlyBailoutIfNoScheduledUpdate(
  current: FiberNode,
  workInProgress: FiberNode,
  renderLanes: Lanes,
): FiberNode | null {
  // 官方这里还会按 tag 压栈 host context 等，Phase 2/3 的 host config 没有对应的栈
  // （getHostContext 恒返回空对象），先省略，react-dom 落地时补。ContextProvider 的栈
  // 必须压——即使这个 fiber 本身 bailout，子树读到的 context._currentValue 也得是新值。
  if (workInProgress.tag === ContextProvider) {
    const newValue = workInProgress.memoizedProps.value;
    const context: ReactContext<any> = workInProgress.type._context;
    pushProvider(workInProgress, context, newValue);
  }
  return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
}

function bailoutOnAlreadyFinishedWork(
  current: FiberNode,
  workInProgress: FiberNode,
  renderLanes: Lanes,
): FiberNode | null {
  if (current !== null) {
    // 复用上一次的依赖
    workInProgress.dependencies = current.dependencies;
  }

  // 检查子节点是否有待处理的工作
  if (!includesSomeLane(renderLanes, workInProgress.childLanes)) {
    // 子节点也没有工作，整棵子树跳过
    return null;
  }

  // 子树有工作，克隆子 fiber 继续向下
  cloneChildFibers(current, workInProgress);
  return workInProgress.child;
}

function beginWork(
  current: FiberNode | null,
  workInProgress: FiberNode,
  renderLanes: Lanes,
): FiberNode | null {
  if (current !== null) {
    const oldProps = current.memoizedProps;
    const newProps = workInProgress.pendingProps;

    if (oldProps !== newProps || hasLegacyContextChanged()) {
      // props 或 legacy context 变了，标记需要重渲染
      didReceiveUpdate = true;
    } else {
      // props 与 legacy context 都没变，检查是否有待处理的更新
      const hasScheduledUpdateOrContext = checkScheduledUpdateOrContext(
        current,
        renderLanes,
      );
      if (
        !hasScheduledUpdateOrContext &&
        // 错误/挂起边界的第二遍渲染可能没有调度在 current 上的工作，用这个 flag 兜底
        (workInProgress.flags & DidCapture) === NoFlags
      ) {
        didReceiveUpdate = false;
        return attemptEarlyBailoutIfNoScheduledUpdate(
          current,
          workInProgress,
          renderLanes,
        );
      }
      // 有更新调度，但 props/context 没变：置 false，updateQueue 或 context 真正产生变化时会置 true
      didReceiveUpdate = false;
    }
  } else {
    didReceiveUpdate = false;
  }

  // 进入 begin 阶段前清空待处理优先级
  workInProgress.lanes = NoLanes;

  switch (workInProgress.tag) {
    case IndeterminateComponent: {
      return mountIndeterminateComponent(
        current,
        workInProgress,
        workInProgress.type,
        renderLanes,
      );
    }
    case FunctionComponent: {
      const Component = workInProgress.type;
      return updateFunctionComponent(
        current,
        workInProgress,
        Component,
        workInProgress.pendingProps,
        renderLanes,
      );
    }
    case ClassComponent: {
      const Component = workInProgress.type;
      return updateClassComponent(
        current,
        workInProgress,
        Component,
        workInProgress.pendingProps,
        renderLanes,
      );
    }
    case HostRoot:
      return updateHostRoot(current, workInProgress, renderLanes);
    case HostPortal:
      return updatePortalComponent(current, workInProgress, renderLanes);
    case HostComponent:
      return updateHostComponent(current, workInProgress, renderLanes);
    case HostText:
      return updateHostText(current, workInProgress);
    case ForwardRef: {
      const Component = workInProgress.type;
      return updateForwardRef(
        current,
        workInProgress,
        Component,
        workInProgress.pendingProps,
        renderLanes,
      );
    }
    case MemoComponent: {
      const Component = workInProgress.type;
      return updateMemoComponent(
        current,
        workInProgress,
        Component,
        workInProgress.pendingProps,
        renderLanes,
      );
    }
    case Fragment:
      return updateFragment(current, workInProgress, renderLanes);
    case Mode:
      return updateMode(current, workInProgress, renderLanes);
    case ContextProvider:
      return updateContextProvider(current, workInProgress, renderLanes);
    case ContextConsumer:
      return updateContextConsumer(current, workInProgress, renderLanes);
    case SuspenseComponent:
      return updateSuspenseComponent(current, workInProgress, renderLanes);
    case OffscreenComponent:
      return updateOffscreenComponent(current, workInProgress, renderLanes);
    case LazyComponent: {
      const elementType = workInProgress.elementType;
      return mountLazyComponent(
        current,
        workInProgress,
        elementType,
        renderLanes,
      );
    }
  }

  throw new Error(
    `Unknown unit of work tag (${workInProgress.tag}). This error is likely caused by a bug in ` +
      "React. Please file an issue.",
  );
}

// 对照官方 markWorkInProgressReceivedUpdate：updateReducer 发现 hook state 真的变化时调用，
// 补上 didReceiveUpdate = true 这条路径——函数组件 props 没变但内部 setState 出了新值，
// 同样需要继续 reconcile children，而不是走 bailout。
export function markWorkInProgressReceivedUpdate(): void {
  didReceiveUpdate = true;
}

export { beginWork };
