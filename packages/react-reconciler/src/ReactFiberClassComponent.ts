/**
 * @file ClassComponent 生命周期
 * @description 对照官方 packages/react-reconciler/src/ReactFiberClassComponent.js：
 * class 组件的实例化、setState/forceUpdate 的 updater 注入、挂载/更新两条生命周期调用链。
 */

import { StrictLegacyMode, StrictEffectsMode } from "./ReactTypeOfMode";
import { MountLayoutDev } from "./ReactFiberFlags";
import shallowEqual from "shared/shallowEqual";

import type { FiberNode } from "./ReactFiber";
import {
  createUpdate,
  enqueueUpdate,
  entangleTransitions,
  processUpdateQueue,
  initializeUpdateQueue,
  cloneUpdateQueue,
  ForceUpdate,
  checkHasForceUpdateAfterProcessing,
  resetHasForceUpdateBeforeProcessing,
} from "./ReactFiberClassUpdateQueue";
import { Update as UpdateEffect, Snapshot } from "./ReactFiberFlags";
import { NoLanes, type Lanes } from "./ReactFiberLane";
import {
  requestEventTime,
  requestUpdateLane,
  scheduleUpdateOnFiber,
} from "./ReactFiberWorkLoop";

// 对照官方 classComponentUpdater：挂到每个 class 实例的 updater 上，setState/forceUpdate
// 通过它把 update 送回 Fiber 对应的 updateQueue，而不需要实例自己知道 Fiber 的存在。
const classComponentUpdater = {
  enqueueSetState(instance: any, payload: any, callback?: () => void): void {
    const fiber: FiberNode = getInstanceFiber(instance);
    const eventTime = requestEventTime();
    const lane = requestUpdateLane(fiber);

    const update = createUpdate(eventTime, lane);
    update.payload = payload;
    if (callback !== undefined && callback !== null) {
      update.callback = callback;
    }

    const root = enqueueUpdate(fiber, update, lane);
    if (root !== null) {
      scheduleUpdateOnFiber(root, fiber, lane, eventTime);
      entangleTransitions(root, fiber, lane);
    }
  },

  enqueueForceUpdate(instance: any, callback?: () => void): void {
    const fiber: FiberNode = getInstanceFiber(instance);
    const eventTime = requestEventTime();
    const lane = requestUpdateLane(fiber);

    const update = createUpdate(eventTime, lane);
    update.tag = ForceUpdate;
    if (callback !== undefined && callback !== null) {
      update.callback = callback;
    }

    const root = enqueueUpdate(fiber, update, lane);
    if (root !== null) {
      scheduleUpdateOnFiber(root, fiber, lane, eventTime);
      entangleTransitions(root, fiber, lane);
    }
  },
};

// instance._reactInternals 保存对应的 Fiber（官方同名字段），供 updater 反查
function getInstanceFiber(instance: any): FiberNode {
  return instance._reactInternals;
}

/**
 * 实例化 class 组件，并把 fiber 挂到实例上（对照官方 adoptClassInstance + constructClassInstance）
 * @param workInProgress - 正在处理的 fiber
 * @param Component - class 组件的构造函数
 * @param props - 本次渲染的 props
 */
export function constructClassInstance(
  workInProgress: FiberNode,
  Component: any,
  props: any,
): any {
  if (__DEV__ && (workInProgress.mode & StrictLegacyMode) !== 0)
    new Component(props);
  const instance = new Component(props);
  // 挂载 updater：react 包的 Component.prototype.setState/forceUpdate 都是转发给这个 updater
  instance.updater = classComponentUpdater;
  instance._reactInternals = workInProgress;
  workInProgress.stateNode = instance;
  // 官方约定：class 实例上的 state 是渲染用的唯一状态来源，同时也是 fiber.memoizedState
  // 记录的值——ClassComponent 的 memoizedState 就是"实例的 state"，与函数组件的 hook 链表语义不同
  workInProgress.memoizedState =
    instance.state !== undefined ? instance.state : null;
  return instance;
}

// 官方叫 callGetDerivedStateFromProps：静态方法，挂载和更新都可能调用，返回值与旧 state 浅合并
function applyDerivedStateFromProps(
  workInProgress: FiberNode,
  getDerivedStateFromProps: (props: any, state: any) => any,
  nextProps: any,
): void {
  const prevState = workInProgress.memoizedState;
  const partialState = getDerivedStateFromProps(nextProps, prevState);
  const newState =
    partialState === null || partialState === undefined
      ? prevState
      : Object.assign({}, prevState, partialState);
  workInProgress.memoizedState = newState;

  // 还有被跳过的更新时必须保留重放起点，不能用派生后的紧急 state 覆盖 baseState。
  if (workInProgress.lanes === NoLanes && workInProgress.updateQueue !== null) {
    workInProgress.updateQueue.baseState = newState;
  }
}

/**
 * 挂载阶段：constructor（已在外部完成）→ getDerivedStateFromProps → 组装 state
 * → componentDidMount 留到 commit 阶段（打 Update flag）
 * 对照官方 mountClassInstance
 */
export function mountClassInstance(
  workInProgress: FiberNode,
  Component: any,
  newProps: any,
): void {
  const instance = workInProgress.stateNode;
  if (
    __DEV__ &&
    (workInProgress.mode & StrictEffectsMode) !== 0 &&
    typeof instance.componentDidMount === "function"
  ) {
    workInProgress.flags |= MountLayoutDev;
  }
  instance.props = newProps;
  instance.state = workInProgress.memoizedState;
  instance.refs = {};

  initializeUpdateQueue(workInProgress);

  const getDerivedStateFromProps = Component.getDerivedStateFromProps;
  if (typeof getDerivedStateFromProps === "function") {
    applyDerivedStateFromProps(
      workInProgress,
      getDerivedStateFromProps,
      newProps,
    );
    instance.state = workInProgress.memoizedState;
  }

  // componentWillMount（legacy）不在本项目实现范围内，直接跳过

  if (typeof instance.componentDidMount === "function") {
    // Update flag 让 commitLayoutEffects 在 mutation 阶段之后调用 componentDidMount，
    // 与 useLayoutEffect 共用同一个 flag/子阶段
    workInProgress.flags |= UpdateEffect;
  }
}

/**
 * 更新阶段：processUpdateQueue 算出新 state → getDerivedStateFromProps
 * → shouldComponentUpdate（forceUpdate 会短路跳过）→ getSnapshotBeforeUpdate（打 Snapshot flag）
 * → componentDidUpdate（打 Update flag，commit 阶段调用）
 * 对照官方 updateClassInstance，返回是否应该继续 render（未被 sCU 拦下）
 */
export function updateClassInstance(
  current: FiberNode,
  workInProgress: FiberNode,
  Component: any,
  newProps: any,
  renderLanes: Lanes,
): boolean {
  const instance = workInProgress.stateNode;

  cloneUpdateQueue(current, workInProgress);

  const oldProps = workInProgress.memoizedProps;
  instance.props = oldProps;
  const oldState = workInProgress.memoizedState;

  resetHasForceUpdateBeforeProcessing();
  processUpdateQueue(workInProgress, newProps, instance, renderLanes);
  let newState = workInProgress.memoizedState;

  const getDerivedStateFromProps = Component.getDerivedStateFromProps;
  if (typeof getDerivedStateFromProps === "function") {
    applyDerivedStateFromProps(
      workInProgress,
      getDerivedStateFromProps,
      newProps,
    );
    newState = workInProgress.memoizedState;
  }

  if (
    oldProps === newProps &&
    oldState === newState &&
    !checkHasForceUpdateAfterProcessing()
  ) {
    // props/state 都没变、也没有 forceUpdate：不需要触发任何生命周期或重渲染
    return false;
  }

  // forceUpdate 短路：不管 shouldComponentUpdate 怎么说，都要更新
  const shouldUpdate =
    checkHasForceUpdateAfterProcessing() ||
    checkShouldComponentUpdate(
      workInProgress,
      Component,
      oldProps,
      newProps,
      oldState,
      newState,
    );

  if (shouldUpdate) {
    if (typeof instance.getSnapshotBeforeUpdate === "function") {
      workInProgress.flags |= Snapshot;
    }
    if (typeof instance.componentDidUpdate === "function") {
      workInProgress.flags |= UpdateEffect;
    }
  }

  instance.props = newProps;
  instance.state = newState;

  return shouldUpdate;
}

/**
 * 边界组件本身也在本次渲染中首次挂载（current === null），但它的 render() 已经跑过
 * （finishClassComponent 在第一次 beginWork 时执行），子树抛错后 unwindWork 把它标记为
 * DidCapture 并重新进入 beginWork——此时 stateNode/updateQueue 已由 mountClassInstance
 * 初始化好，只需要消费 throwException 塞进去的 CaptureUpdate 算出 fallback state。
 * 对照官方 resumeMountClassInstance（简化版：省略 hasForceUpdate 为 false 时的
 * shouldComponentUpdate 判断，CaptureUpdate 必然已把 hasForceUpdate 置真，恒强制渲染）。
 */
export function resumeMountClassInstance(
  workInProgress: FiberNode,
  Component: any,
  newProps: any,
  renderLanes: Lanes,
): boolean {
  const instance = workInProgress.stateNode;

  resetHasForceUpdateBeforeProcessing();
  processUpdateQueue(workInProgress, newProps, instance, renderLanes);

  const getDerivedStateFromProps = Component.getDerivedStateFromProps;
  if (typeof getDerivedStateFromProps === "function") {
    applyDerivedStateFromProps(
      workInProgress,
      getDerivedStateFromProps,
      newProps,
    );
  }

  instance.props = newProps;
  instance.state = workInProgress.memoizedState;

  if (typeof instance.componentDidMount === "function") {
    workInProgress.flags |= UpdateEffect;
  }

  return true;
}

// 对照官方 checkShouldComponentUpdate：优先取用户定义的 shouldComponentUpdate，
// 其次是 PureComponent 的浅比较，都没有则默认总是更新（class 组件的默认行为）
function checkShouldComponentUpdate(
  workInProgress: FiberNode,
  Component: any,
  oldProps: any,
  newProps: any,
  oldState: any,
  newState: any,
): boolean {
  const instance = workInProgress.stateNode;
  if (typeof instance.shouldComponentUpdate === "function") {
    return instance.shouldComponentUpdate(newProps, newState);
  }

  if (Component.prototype && Component.prototype.isPureReactComponent) {
    return (
      !shallowEqual(oldProps, newProps) || !shallowEqual(oldState, newState)
    );
  }

  return true;
}
