/**
 * @file Lane 优先级模型
 * @description 用位掩码表示更新优先级，多位 lane 组合成 lanes；不同 lane 的更新可独立调度。
 * 对照官方 packages/react-reconciler/src/ReactFiberLane.new.js（v18.3.1）：位表与优先级/
 * 过期计算逐位对齐。Suspense 相关（suspendedLanes/pingedLanes）字段已就位，但 Phase 4
 * 尚无 Suspense，运行时恒为 NoLanes。
 */

export type Lane = number;
export type Lanes = number;

export const TotalLanes = 31;

export const NoLanes: Lanes = 0b0000000000000000000000000000000;
export const NoLane: Lane = 0b0000000000000000000000000000000;

// 同步 lane 与各优先级的 hydration 变体
export const SyncLane: Lane = 0b0000000000000000000000000000001;

export const InputContinuousHydrationLane: Lane = 0b0000000000000000000000000000010;
export const InputContinuousLane: Lane = 0b0000000000000000000000000000100;

export const DefaultHydrationLane: Lane = 0b0000000000000000000000000001000;
export const DefaultLane: Lane = 0b0000000000000000000000000010000;

const TransitionHydrationLane: Lane = 0b0000000000000000000000000100000;
const TransitionLanes: Lanes = 0b0000000001111111111111111000000;
const TransitionLane1: Lane = 0b0000000000000000000000001000000;
const TransitionLane2: Lane = 0b0000000000000000000000010000000;
const TransitionLane3: Lane = 0b0000000000000000000000100000000;
const TransitionLane4: Lane = 0b0000000000000000000001000000000;
const TransitionLane5: Lane = 0b0000000000000000000010000000000;
const TransitionLane6: Lane = 0b0000000000000000000100000000000;
const TransitionLane7: Lane = 0b0000000000000000001000000000000;
const TransitionLane8: Lane = 0b0000000000000000010000000000000;
const TransitionLane9: Lane = 0b0000000000000000100000000000000;
const TransitionLane10: Lane = 0b0000000000000001000000000000000;
const TransitionLane11: Lane = 0b0000000000000010000000000000000;
const TransitionLane12: Lane = 0b0000000000000100000000000000000;
const TransitionLane13: Lane = 0b0000000000001000000000000000000;
const TransitionLane14: Lane = 0b0000000000010000000000000000000;
const TransitionLane15: Lane = 0b0000000000100000000000000000000;
const TransitionLane16: Lane = 0b0000000001000000000000000000000;

const RetryLanes: Lanes = 0b0000111110000000000000000000000;
const RetryLane1: Lane = 0b0000000010000000000000000000000;
const RetryLane2: Lane = 0b0000000100000000000000000000000;
const RetryLane3: Lane = 0b0000001000000000000000000000000;
const RetryLane4: Lane = 0b0000010000000000000000000000000;
const RetryLane5: Lane = 0b0000100000000000000000000000000;

export const SomeRetryLane: Lane = RetryLane1;

export const SelectiveHydrationLane: Lane = 0b0001000000000000000000000000000;

const NonIdleLanes: Lanes = 0b0001111111111111111111111111111;

export const IdleHydrationLane: Lane = 0b0010000000000000000000000000000;
export const IdleLane: Lane = 0b0100000000000000000000000000000;

export const OffscreenLane: Lane = 0b1000000000000000000000000000000;

export const NoTimestamp = -1;

// 轮转分配 TransitionLane 的游标（claimNextTransitionLane 每次右移一位）
let nextTransitionLane: Lane = TransitionLane1;

// 轮转分配 RetryLane 的游标（claimNextRetryLane 每次左移一位，对照 claimNextTransitionLane）
let nextRetryLane: Lane = RetryLane1;

/**
 * 求两条 lane 的并集
 * @param a - lane/lanes
 * @param b - lane/lanes
 * @returns 并集 lanes
 */
export function mergeLanes(a: Lanes | Lane, b: Lanes | Lane): Lanes {
  return a | b;
}

/**
 * 判断两条 lanes 是否有交集
 * @param a - lanes
 * @param b - lanes
 * @returns 是否有交集
 */
export function includesSomeLane(a: Lanes | Lane, b: Lanes | Lane): boolean {
  return (a & b) !== NoLanes;
}

/**
 * 判断 subset 是否为 set 的子集（subset 的每一位都包含在 set 里）
 * @param set - 超集 lanes
 * @param subset - 待判断的 lanes
 * @returns subset 是否为 set 的子集
 */
export function isSubsetOfLanes(set: Lanes, subset: Lanes | Lane): boolean {
  return (set & subset) === subset;
}

/**
 * 从 lanes 中移除指定的 lane
 * @param set - 原始 lanes
 * @param subset - 要移除的 lane
 * @returns 移除后的 lanes
 */
export function removeLanes(set: Lanes, subset: Lanes | Lane): Lanes {
  return set & ~subset;
}

/**
 * 取 lanes 中优先级最高（数值最小）的一条 lane
 * 位运算技巧：lanes & -lanes 保留最低的 1 位
 */
export function getHighestPriorityLane(lanes: Lanes): Lane {
  return lanes & -lanes;
}

// 取 lanes 里最高优先级的一组 lanes（同优先级的相邻 lane 一起返回，如多条 TransitionLane）
function getHighestPriorityLanes(lanes: Lanes | Lane): Lanes {
  switch (getHighestPriorityLane(lanes)) {
    case SyncLane:
      return SyncLane;
    case InputContinuousHydrationLane:
      return InputContinuousHydrationLane;
    case InputContinuousLane:
      return InputContinuousLane;
    case DefaultHydrationLane:
      return DefaultHydrationLane;
    case DefaultLane:
      return DefaultLane;
    case TransitionHydrationLane:
      return TransitionHydrationLane;
    case TransitionLane1:
    case TransitionLane2:
    case TransitionLane3:
    case TransitionLane4:
    case TransitionLane5:
    case TransitionLane6:
    case TransitionLane7:
    case TransitionLane8:
    case TransitionLane9:
    case TransitionLane10:
    case TransitionLane11:
    case TransitionLane12:
    case TransitionLane13:
    case TransitionLane14:
    case TransitionLane15:
    case TransitionLane16:
      return lanes & TransitionLanes;
    case RetryLane1:
    case RetryLane2:
    case RetryLane3:
    case RetryLane4:
    case RetryLane5:
      return lanes & RetryLanes;
    case SelectiveHydrationLane:
      return SelectiveHydrationLane;
    case IdleHydrationLane:
      return IdleHydrationLane;
    case IdleLane:
      return IdleLane;
    case OffscreenLane:
      return OffscreenLane;
    default:
      if (__DEV__) {
        console.error(
          "Should have found matching lanes. This is a bug in React.",
        );
      }
      return lanes;
  }
}

import type { FiberRootNode } from "./ReactFiberRoot";

// 计算下一次要渲染的 lanes：从 pendingLanes 里挑最高优先级，并处理正在渲染的 lanes 让路、
// DefaultLane 跟随 InputContinuousLane、以及纠缠（entangle）关系。Phase 4 无 Suspense，
// suspendedLanes/pingedLanes 恒为 NoLanes，相关分支保留但不生效。
export function getNextLanes(root: FiberRootNode, wipLanes: Lanes): Lanes {
  const pendingLanes = root.pendingLanes;
  if (pendingLanes === NoLanes) {
    return NoLanes;
  }

  let nextLanes = NoLanes;

  const suspendedLanes = root.suspendedLanes;
  const pingedLanes = root.pingedLanes;

  const nonIdlePendingLanes = pendingLanes & NonIdleLanes;
  if (nonIdlePendingLanes !== NoLanes) {
    const nonIdleUnblockedLanes = nonIdlePendingLanes & ~suspendedLanes;
    if (nonIdleUnblockedLanes !== NoLanes) {
      nextLanes = getHighestPriorityLanes(nonIdleUnblockedLanes);
    } else {
      const nonIdlePingedLanes = nonIdlePendingLanes & pingedLanes;
      if (nonIdlePingedLanes !== NoLanes) {
        nextLanes = getHighestPriorityLanes(nonIdlePingedLanes);
      }
    }
  } else {
    const unblockedLanes = pendingLanes & ~suspendedLanes;
    if (unblockedLanes !== NoLanes) {
      nextLanes = getHighestPriorityLanes(unblockedLanes);
    } else {
      if (pingedLanes !== NoLanes) {
        nextLanes = getHighestPriorityLanes(pingedLanes);
      }
    }
  }

  if (nextLanes === NoLanes) {
    return NoLanes;
  }

  // 已有更高优先级渲染在进行：不让低优先级 lane 打断它
  if (
    wipLanes !== NoLanes &&
    wipLanes !== nextLanes &&
    (wipLanes & suspendedLanes) === NoLanes
  ) {
    const nextLane = getHighestPriorityLane(nextLanes);
    const wipLane = getHighestPriorityLane(wipLanes);
    if (
      nextLane >= wipLane ||
      (nextLane === DefaultLane && (wipLane & TransitionLanes) !== NoLanes)
    ) {
      return wipLanes;
    }
  }

  // InputContinuous 更新时把 Default 更新一起带上（避免离散与默认优先级互相卡死）
  if ((nextLanes & InputContinuousLane) !== NoLanes) {
    nextLanes |= pendingLanes & DefaultLane;
  }

  // 纠缠 lane：一条 lane 需要与其它 lane 一起渲染时展开
  const entangledLanes = root.entangledLanes;
  if (entangledLanes !== NoLanes) {
    const entanglements = root.entanglements;
    let lanes = nextLanes & entangledLanes;
    while (lanes > 0) {
      const index = pickArbitraryLaneIndex(lanes);
      const lane = 1 << index;

      nextLanes |= entanglements[index];

      lanes &= ~lane;
    }
  }

  return nextLanes;
}

// 计算 lane 的过期时间：紧急 lane 250ms、Default/Transition 5s，其余永不饥饿
function computeExpirationTime(lane: Lane, currentTime: number): number {
  switch (lane) {
    case SyncLane:
    case InputContinuousHydrationLane:
    case InputContinuousLane:
      return currentTime + 250;
    case DefaultHydrationLane:
    case DefaultLane:
    case TransitionHydrationLane:
    case TransitionLane1:
    case TransitionLane2:
    case TransitionLane3:
    case TransitionLane4:
    case TransitionLane5:
    case TransitionLane6:
    case TransitionLane7:
    case TransitionLane8:
    case TransitionLane9:
    case TransitionLane10:
    case TransitionLane11:
    case TransitionLane12:
    case TransitionLane13:
    case TransitionLane14:
    case TransitionLane15:
    case TransitionLane16:
      return currentTime + 5000;
    case RetryLane1:
    case RetryLane2:
    case RetryLane3:
    case RetryLane4:
    case RetryLane5:
      return NoTimestamp;
    case SelectiveHydrationLane:
    case IdleHydrationLane:
    case IdleLane:
    case OffscreenLane:
      return NoTimestamp;
    default:
      if (__DEV__) {
        console.error(
          "Should have found matching lanes. This is a bug in React.",
        );
      }
      return NoTimestamp;
  }
}

// 把新 update 的 lane 标记到 root.pendingLanes，并记录事件时间（用于饥饿检测）
export function markRootUpdated(
  root: FiberRootNode,
  updateLane: Lane,
  eventTime: number,
): void {
  root.pendingLanes |= updateLane;

  if (updateLane !== IdleLane) {
    root.suspendedLanes = NoLanes;
    root.pingedLanes = NoLanes;
  }

  const eventTimes = root.eventTimes;
  const index = laneToIndex(updateLane);
  eventTimes[index] = eventTime;
}

// commit 完成后收尾：只保留尚未处理的 remainingLanes，清理已完成的 lane 的相关记录
export function markRootFinished(
  root: FiberRootNode,
  remainingLanes: Lanes,
): void {
  const noLongerPendingLanes = root.pendingLanes & ~remainingLanes;

  root.pendingLanes = remainingLanes;

  root.suspendedLanes = NoLanes;
  root.pingedLanes = NoLanes;

  root.expiredLanes &= remainingLanes;

  root.entangledLanes &= remainingLanes;

  const entanglements = root.entanglements;
  const eventTimes = root.eventTimes;
  const expirationTimes = root.expirationTimes;

  let lanes = noLongerPendingLanes;
  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;

    entanglements[index] = NoLanes;
    eventTimes[index] = NoTimestamp;
    expirationTimes[index] = NoTimestamp;

    lanes &= ~lane;
  }
}

// 饥饿检测：pendingLanes 里有 lane 已过期则并入 expiredLanes，强制其下一轮同步渲染
export function markStarvedLanesAsExpired(
  root: FiberRootNode,
  currentTime: number,
): void {
  const pendingLanes = root.pendingLanes;
  const suspendedLanes = root.suspendedLanes;
  const pingedLanes = root.pingedLanes;
  const expirationTimes = root.expirationTimes;

  let lanes = pendingLanes;
  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;

    const expirationTime = expirationTimes[index];
    if (expirationTime === NoTimestamp) {
      if (
        (lane & suspendedLanes) === NoLanes ||
        (lane & pingedLanes) !== NoLanes
      ) {
        expirationTimes[index] = computeExpirationTime(lane, currentTime);
      }
    } else if (expirationTime <= currentTime) {
      root.expiredLanes |= lane;
    }

    lanes &= ~lane;
  }
}

// 从 TransitionLane1 开始轮转分配 TransitionLane（useTransition 用，Phase 5 消费）
export function claimNextTransitionLane(): Lane {
  const lane = nextTransitionLane;
  nextTransitionLane <<= 1;
  if ((nextTransitionLane & TransitionLanes) === NoLanes) {
    nextTransitionLane = TransitionLane1;
  }
  return lane;
}

function laneToIndex(lane: Lane): number {
  return pickArbitraryLaneIndex(lane);
}

// 取 lanes 中最低位 1 所在的 bit 序号（0~30）
function pickArbitraryLaneIndex(lanes: Lanes): number {
  return 31 - Math.clz32(lanes);
}

export function includesExpiredLane(
  root: FiberRootNode,
  lanes: Lanes,
): boolean {
  return (lanes & root.expiredLanes) !== NoLanes;
}

// 是否包含「阻塞」lane（sync/input-continuous/default 这几条需要尽快同步处理的 lane）。
// 官方这里还有 ConcurrentUpdatesByDefaultMode 分支（本项目未引入该 mode），故 root 参数暂未用到。
export function includesBlockingLane(
  _root: FiberRootNode,
  lanes: Lanes,
): boolean {
  const SyncDefaultLanes =
    InputContinuousHydrationLane |
    InputContinuousLane |
    DefaultHydrationLane |
    DefaultLane;
  return (lanes & SyncDefaultLanes) !== NoLanes;
}

export function includesNonIdleWork(lanes: Lanes): boolean {
  return (lanes & NonIdleLanes) !== NoLanes;
}

export function includesOnlyNonUrgentLanes(lanes: Lanes): boolean {
  const UrgentLanes = SyncLane | InputContinuousLane | DefaultLane;
  return (lanes & UrgentLanes) === NoLanes;
}

export function includesOnlyTransitions(lanes: Lanes): boolean {
  return (lanes & TransitionLanes) === lanes;
}

export function isTransitionLane(lane: Lane): boolean {
  return (lane & TransitionLanes) !== NoLanes;
}

export function includesOnlyRetries(lanes: Lanes): boolean {
  return (lanes & RetryLanes) === lanes;
}

// 从 RetryLane1 开始轮转分配 RetryLane（Suspense resolveRetryWakeable 用，Phase 9.1 消费）
export function claimNextRetryLane(): Lane {
  const lane = nextRetryLane;
  nextRetryLane <<= 1;
  if ((nextRetryLane & RetryLanes) === NoLanes) {
    nextRetryLane = RetryLane1;
  }
  return lane;
}

// 对照官方 markRootPinged：把 wakeable resolve 时传入的 pingedLanes 与 root 当前挂起的
// suspendedLanes 取交集标记到 root.pingedLanes——只有本来就被挂起的 lane 才需要被 ping 唤醒。
export function markRootPinged(root: FiberRootNode, pingedLanes: Lanes): void {
  root.pingedLanes |= root.suspendedLanes & pingedLanes;
}

// 对照 markRootEntangled：同一更新队列中的 transition 及传递关联必须一起选择。
export function markRootEntangled(
  root: FiberRootNode,
  entangledLanes: Lanes,
): void {
  const rootEntangled = (root.entangledLanes |= entangledLanes);
  let lanes = rootEntangled;
  while (lanes !== NoLanes) {
    const lane = getHighestPriorityLane(lanes);
    const index = 31 - Math.clz32(lane);
    if (
      (lane & entangledLanes) !== NoLanes ||
      (root.entanglements[index] & entangledLanes) !== NoLanes
    ) {
      root.entanglements[index] |= entangledLanes;
    }
    lanes &= ~lane;
  }
}

export function markRootSuspended(
  root: FiberRootNode,
  suspendedLanes: Lanes,
): void {
  root.suspendedLanes |= suspendedLanes;
  root.pingedLanes &= ~suspendedLanes;
  let lanes = suspendedLanes;
  while (lanes !== NoLanes) {
    const lane = getHighestPriorityLane(lanes);
    root.expirationTimes[31 - Math.clz32(lane)] = NoTimestamp;
    lanes &= ~lane;
  }
}
