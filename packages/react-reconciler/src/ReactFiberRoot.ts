/**
 * @file FiberRoot 节点
 * @description FiberRootNode 是整棵 Fiber 树的根容器，current 指向当前已提交的 HostRoot fiber
 */

import type { FiberNode } from "./ReactFiber";
import { createHostRootFiber } from "./ReactFiber";
import {
  NoLane,
  NoLanes,
  NoTimestamp,
  TotalLanes,
  type Lane,
  type Lanes,
} from "./ReactFiberLane";
import type { RootTag } from "./ReactRootTags";
import { initializeUpdateQueue } from "./ReactFiberClassUpdateQueue";
import type { Container } from "./ReactFiberHostConfig";
import type { Wakeable } from "shared/ReactTypes";

// 对照官方 packages/react-reconciler/src/ReactFiberRoot.new.js：官方 FiberRootNode 还带
// 大量优先级/调度字段（eventTimes、expirationTimes、entangledLanes 等），这些服务于
// Scheduler 时间切片与 lane 抢占。Phase 4 已接入 Scheduler，故补齐 lane 过期/纠缠所需的字段；
// mutableReadLanes / hiddenUpdates / pendingChildren 等仍留待后续（Suspense/Offscreen）。

// HostRoot fiber 的 memoizedState 是一个 { element } 对象，updateHostRoot 从里面取本次要
// 渲染的 ReactElement（updateContainer 时作为 update.payload 写入）。
export interface RootState {
  element: any;
}

export class FiberRootNode {
  tag: RootTag;
  containerInfo: Container;
  current: FiberNode;
  finishedWork: FiberNode | null;
  finishedLanes: Lanes;
  pendingLanes: Lanes;
  callbackNode: any;
  callbackPriority: Lane;
  context: any;
  pendingContext: any;
  // 每条 lane 的事件发生时间（index = laneToIndex），用于饥饿检测
  eventTimes: number[];
  // 每条 lane 的过期时间（index = laneToIndex），markStarvedLanesAsExpired 据此判断是否过期
  expirationTimes: number[];
  suspendedLanes: Lanes;
  pingedLanes: Lanes;
  expiredLanes: Lanes;
  entangledLanes: Lanes;
  // 每条 lane 与之纠缠的 lanes 集合（index = laneToIndex）
  entanglements: Lanes[];
  // Suspense 挂起时 attachPingListener 用来去重同一个 wakeable 的监听（Phase 9.1）
  pingCache: WeakMap<Wakeable, Set<Lanes>> | null;
  // useId 生成的 id 前缀（createRoot(container, { identifierPrefix }) 透传），多个 root
  // 共存在同一页面时用来避免 id 冲突，本项目默认空字符串（对照官方默认值）
  identifierPrefix: string;

  constructor(
    containerInfo: Container,
    tag: RootTag,
    identifierPrefix: string,
  ) {
    this.tag = tag;
    this.containerInfo = containerInfo;
    this.current = null as unknown as FiberNode;
    this.finishedWork = null;
    this.finishedLanes = NoLanes;
    this.pendingLanes = NoLanes;
    this.callbackNode = null;
    this.callbackPriority = NoLane;
    this.context = null;
    this.pendingContext = null;
    this.eventTimes = createLaneMap(NoTimestamp);
    this.expirationTimes = createLaneMap(NoTimestamp);
    this.suspendedLanes = NoLanes;
    this.pingedLanes = NoLanes;
    this.expiredLanes = NoLanes;
    this.entangledLanes = NoLanes;
    this.entanglements = createLaneMap(NoLanes);
    this.pingCache = null;
    this.identifierPrefix = identifierPrefix;
  }
}

// 官方 createLaneMap：建一个长度 TotalLanes 的数组并填充初始值（对应 laneToIndex 的索引空间）
function createLaneMap<T>(initialValue: T): T[] {
  return new Array(TotalLanes).fill(initialValue);
}

/**
 * 创建 FiberRoot，并把 containerInfo 上的 HostRoot fiber 与 root 互相指向
 * @param containerInfo - 渲染器提供的容器（如 DOM 元素）
 * @param tag - 根节点的渲染模式（LegacyRoot/ConcurrentRoot）
 * @param initialChildren - 初始渲染的 children（createContainer 传 null，hydrateRoot 才传实际内容）
 * @param identifierPrefix - useId 生成的 id 前缀，默认空字符串
 * @returns FiberRootNode
 */
export function createFiberRoot(
  containerInfo: Container,
  tag: RootTag,
  initialChildren: any,
  identifierPrefix: string = "",
): FiberRootNode {
  const root = new FiberRootNode(containerInfo, tag, identifierPrefix);

  // 循环构造：HostRoot fiber 的 stateNode 指向 root，root.current 指向该 fiber
  const uninitializedFiber = createHostRootFiber(tag);
  root.current = uninitializedFiber;
  uninitializedFiber.stateNode = root;

  const initialState: RootState = {
    element: initialChildren,
  };
  uninitializedFiber.memoizedState = initialState;

  initializeUpdateQueue(uninitializedFiber);

  return root;
}
