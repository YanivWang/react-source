> 当前核心修复与运行验收以 [React 18.3.1 核心验证记录](./verification-core-react18.3.1.md) 为准。下列 Phase 保留开发脉络，不代表完整官方实现或全分支通过。

# React 源码实现路线图

本文档描述 react-source 项目的功能实现路径，按 React 18 的渲染主链路自然顺序逐步搭建核心模块。

## 已完成

### Phase 1: JSX / createElement

- [x] **packages/shared** 基础设施
  - ReactTypes（Key/Ref/Props/ElementType 类型定义）
  - ReactSymbols（REACT_ELEMENT_TYPE/REACT_FRAGMENT_TYPE 等 Symbol）
  - 工具函数（hasOwnProperty、objectIs、checkKeyStringCoercion、getComponentNameFromType）

- [x] **packages/react** JSX 运行时
  - ReactElement 工厂函数（createElement/jsx/jsxDEV）
  - ReactCurrentOwner（记录当前正在构建的组件，为 reconciler 铺垫）
  - 两套入口：
    - **经典入口**（react）：`createElement`
    - **automatic runtime 入口**（react/jsx-runtime、react/jsx-dev-runtime）：`jsx/jsxs/jsxDEV`
  - DEV 模式警告（字符串 ref 警告、key/ref 作为 prop 访问警告）
  - 标识注入（`__react_source: "g-react-source"`，方便控制台区分）
  - Rollup 构建产出 cjs/esm（dev+prod）和 iife 格式 bundle

### Phase 2（简版）: react-dom 包 + 真实 DOM 渲染

> 说明：走的是「同步渲染」路径（单 lane），react-dom 为简版（不含 hydrate / legacy render / 事件系统，见下文待实现区）。

- [x] **Fiber 数据结构**（`packages/react-reconciler/src/ReactFiber.ts`）
  - FiberNode 字段完整对齐官方（tag/key/elementType/type/stateNode/return/child/sibling/flags/subtreeFlags/lanes/childLanes/alternate…）
  - createFiber / createFiberFromElement / createFiberFromText / createFiberFromFragment / createHostRootFiber
  - createWorkInProgress 双缓存（惰性创建 alternate、复用并重置字段）

- [x] **常量体系**
  - ReactWorkTags（0~8：FunctionComponent/ClassComponent/IndeterminateComponent/HostRoot/HostPortal/HostComponent/HostText/Fragment/Mode）
  - ReactFiberFlags（主链路用得到的 Placement/Update/ChildDeletion/ContentReset/PerformedWork/Incomplete/DidCapture 等，数值与官方逐位对齐）
  - ReactFiberLane（**仅 SyncLane 一条**，位运算助手 mergeLanes/includesSomeLane/isSubsetOfLanes/removeLanes 齐备）
  - ReactRootTags（LegacyRoot/ConcurrentRoot）、ReactTypeOfMode（NoMode/ConcurrentMode）

- [x] **更新队列**（`ReactFiberClassUpdateQueue.ts`）
  - Update / UpdateQueue / SharedQueue 数据结构（单向循环链表）
  - createUpdate / enqueueUpdate / processUpdateQueue / cloneUpdateQueue / initializeUpdateQueue
  - markUpdateLaneFromFiberToRoot（lane 冒泡到根，支撑 beginWork 的 bailout 判断）

- [x] **FiberRoot 与对外入口**
  - FiberRootNode / createFiberRoot（`ReactFiberRoot.ts`）
  - createContainer / updateContainer（`ReactFiberReconciler.ts`）

- [x] **workLoop**（`ReactFiberWorkLoop.ts`）
  - scheduleUpdateOnFiber → renderRootSync → workLoopSync（同步一口气跑完，不可中断）
  - prepareFreshStack / performUnitOfWork / completeUnitOfWork
  - commitRoot **精简为只有 mutation 子阶段**（before-mutation / layout 留待后续）

- [x] **beginWork**（`ReactFiberBeginWork.ts`）
  - HostRoot / HostComponent / HostText / Fragment / Mode / FunctionComponent / IndeterminateComponent 全部分发
  - 基础 bailout：bailoutOnAlreadyFinishedWork + attemptEarlyBailoutIfNoScheduledUpdate + didReceiveUpdate（props/state 不变跳过子树）
  - renderWithHooks 的完整 Hook 链与 dispatcher 见 Phase 5

- [x] **completeWork**（`ReactFiberCompleteWork.ts`）
  - HostComponent：createInstance / appendAllChildren / finalizeInitialChildren
  - HostText：createTextInstance
  - updateHostComponent（prepareUpdate 生成 updatePayload 标记 Update）、updateHostText
  - bubbleProperties（子树 flags/lanes 向上汇总）

- [x] **commit mutation**（`ReactFiberCommitWork.ts`）
  - Placement（insertOrAppendPlacementNode，含 getHostSibling 锚点定位）
  - Update（commitUpdate / commitTextUpdate）
  - Deletion（递归卸载子树）
  - 错误边界 / effect 卸载 / Portal 分支留待后续

- [x] **HostConfig 接口**（`ReactFiberHostConfig.ts`）
  - 平台无关接口，**构建时 fork 注入**（对齐官方 `ReactFiberHostConfig.js` / forks/ReactFiberHostConfig.custom.js）
  - 占位模块模块加载时即 throw，react-dom 构建时把它替换成 `ReactDOMHostConfig`（reconciler 自身仍以 shim 打包）

- [x] **react-dom 简版**（`packages/react-dom`）
  - `createRoot(container).render(element)`：ReactDOMClient（转出层）→ ReactDOMRoot（createRoot 实现），底层走 reconciler 的 createContainer/updateContainer
  - DOM HostConfig（`packages/react-dom/src/client/ReactDOMHostConfig.ts`，对齐官方 18.3.1 的 react-dom 目录）：createInstance/createTextInstance、className/style/普通属性子集、prepareUpdate/commitUpdate、appendChild/insertBefore/removeChild 等
  - npm 分发文件夹 + rollup 构建产物（cjs dev/prod），bundles.js 注册 react-dom bundle，build.js fork 注入 HostConfig
  - 简版边界：不含 hydrate / legacy render / 事件系统 / DOMPropertyOperations 完整体系，留待后续 Phase

- [x] **Fragment**（beginWork / completeWork / ChildFiber / ReactFiber 均已处理 `REACT_FRAGMENT_TYPE`）

### Phase 3: 更新与 Diff 算法

- [x] **Diff 算法**（`ReactChildFiber.ts`）
  - 单节点 diff（reconcileSingleElement）、单文本 diff（reconcileSingleTextNode）
  - 多节点 diff（reconcileChildrenArray：头部逐位匹配 → 剩余全新建/全删除 → mapRemainingChildren Map 查找）
  - placeChild lastPlacedIndex 移动标记、key 匹配
  - mountChildFibers（不标记副作用）vs reconcileChildFibers（标记副作用）工厂

- [x] **Fiber 树反射**（`ReactFiberTreeReflection.ts` + `react-reconciler/reflection` 入口）
  - getNearestMountedFiber（沿 return 指针找最近的已挂载 Fiber）
  - findCurrentHostFiber（深度优先找第一个真实 DOM 节点对应的 Fiber）
  - reflection 入口独立于主入口打包，供渲染器按需引入定位真实 DOM 节点（对照官方 reflection.js）

**当前能做什么**：可以创建 ReactElement 对象，有一套完整的 reconciler 主链路——`createContainer/updateContainer` → `workLoop` → `commit mutation`，能对 Fiber 树做挂载、单/多节点 diff、更新、删除；并通过 react-dom 简版的 `createRoot().render()` 把结果渲染到真实 DOM（HostConfig 由构建时 fork 注入）。`fixtures/` 用 react-dom 驱动 reconciler 调试，`pnpm dev` 可看到挂载与二次更新的 DOM 变化。

### Phase 4: 调度器（Scheduler）+ 时间切片 + 客户端 Lane 模型

> 说明：引入可中断渲染，长渲染不再一次性占死主线程。scheduler 包按官方完整结构还原，reconciler 接入后普通 `createRoot().render()` 走 DefaultLane 并发路径（异步提交），`flushSync` 走 SyncLane 同步路径。

- [x] **scheduler 包**（`packages/scheduler`，对照官方完整结构）
  - `Scheduler.ts`：`unstable_scheduleCallback`/`unstable_cancelCallback`/`unstable_shouldYield`/`unstable_now` 等导出，taskQueue/timerQueue 双最小堆，expirationTime + timeout 表
  - `SchedulerMinHeap.ts`（按 sortIndex 排序）、`SchedulerPriorities.ts`（5 档优先级）（默认 feature 分支直接保留在 Scheduler fork）
  - `forks/Scheduler.ts` 内的宿主循环：setImmediate → 复用 MessageChannel → setTimeout，`shouldYieldToHost` 默认 5ms 时间片；与 18.3.1 同一文件职责

- [x] **客户端 Lane 模型**（`ReactFiberLane.ts` + `ReactFiberRoot.ts`）
  - 30 条 lane 位表逐位对齐官方（SyncLane 修正为 bit1、SyncHydrationLane=bit0，InputContinuous/Default/Transition×16/Retry×5/Idle/Offscreen…）
  - getHighestPriorityLane/getNextLanes/markRootUpdated/markRootFinished/markStarvedLanesAsExpired/computeExpirationTime 等优先级与过期/饥饿计算
  - FiberRootNode 补 eventTimes/expirationTimes/suspendedLanes/pingedLanes/expiredLanes/entangledLanes/entanglements

- [x] **事件优先级**（`ReactEventPriorities.ts` + `react-reconciler/constants` 转出）
  - Discrete/Continuous/Default/Idle 四档事件优先级、lanesToEventPriority、currentUpdatePriority 维护

- [x] **reconciler 接入 Scheduler**（`ReactFiberWorkLoop.ts`）
  - `scheduleUpdateOnFiber` → `markRootUpdated` + `ensureRootIsScheduled`（按 lane 选同步队列微任务 flush 或 `scheduleCallback` 分片）
  - executionContext 补 `BatchedContext`；`flushSync`/`scheduleSyncCallback`/`flushSyncCallbacks` 同步队列
  - `scheduleMicrotask` 走 HostConfig（react-dom 用 queueMicrotask/Promise 兜底）

- [x] **workLoop 可中断化**
  - `workLoopConcurrent`（每处理一个 Fiber 检查 `shouldYield`）、`renderRootConcurrent`、`performConcurrentWorkOnRoot`（含过期/阻塞 lane 走同步防饥饿）
  - `prepareFreshStack` 中断恢复：同一 root+lanes 复用 workInProgressRoot 续跑

- [x] **并发更新下的状态计算**（`ReactFiberClassUpdateQueue.ts`）
  - `processUpdateQueue` 按 renderLanes 跳过低优先级 update、记录 baseState/baseUpdate 重放链、`workInProgress.lanes = newLanes` 写回
  - `markUpdateLaneFromFiberToRoot` 改为返回 FiberRootNode；`markSkippedUpdateLanes` 迁入 workLoop

**阶段目标验收**：`fixtures/scheduler` 演示——原生任务 5ms 分片、5000 项大列表并发渲染不阻塞 rAF 帧、`flushSync` 同步更新抢占 DefaultLane 并发渲染。

---

### Phase 5: Hooks

**目标**：支持函数组件的状态管理和副作用（useState、useEffect 等）。

#### 5.1 Hook 数据结构

- `packages/react-reconciler/src/ReactFiberHooks.ts`
  - Hook 链表挂在 Fiber.memoizedState 上
  - 每个 Hook 节点：memoizedState（当前值）、queue（更新队列）、next（链表指针）

#### 5.2 Dispatcher 切换机制

- ReactCurrentDispatcher（shared/ReactSharedInternals 目前只有 ReactCurrentOwner，需补）
  - HooksDispatcherOnMount / HooksDispatcherOnUpdate / InvalidNestedHooksDispatcher
  - renderWithHooks 替换占位实现（切换 Dispatcher、建立 Hook 链表、设置 ReactCurrentOwner）

#### 5.3 核心 Hooks 实现

- [x] **useState**：mountState / updateState / dispatchSetState（创建 update、加入 queue、调度更新）
- [x] **useReducer**：mountReducer / updateReducer（useState 是其特例实现，共用同一套更新队列逻辑）
- [x] **useRef**：mountRef 创建 { current: initialValue }，updateRef 原样返回、不比较 deps
- [x] **useMemo / useCallback**：mountMemo/updateMemo、mountCallback/updateCallback，areHookInputsEqual 对比 deps，变化则重算/返回新引用，否则复用缓存
- [x] **useEffect**：mountEffect/updateEffect（`ReactFiberHooks.ts` 里的 `mountEffectImpl`/`updateEffectImpl`，deps 复用 areHookInputsEqual，标记 Passive fiber flag），effect 节点用 pushEffect 串成循环链表挂在 `fiber.updateQueue`（与 ClassComponent updateQueue 结构不同，只是复用字段名）
  - commit 阶段异步执行：`commitRootImpl` 检测到 Passive flag 后 `scheduleCallback(NormalPriority, flushPassiveEffects)`，先 `commitPassiveUnmountEffects` 再 `commitPassiveMountEffects`
  - 简化范围：`PassiveMask` 包含 `Passive | ChildDeletion`；DEV StrictMode 已补 render 双调用与 layout/passive effect 的模拟卸载/重挂载，生产模式不启用
- [x] **useLayoutEffect**：mountLayoutEffect/updateLayoutEffect（标记 Update fiber flag，复用同一套 pushEffect/deps 比较），`commitRootImpl` 在 `commitMutationEffects` 之后、`root.current` 切换之后同步跑 `commitLayoutEffects`
  - 旧 layout effect 的销毁提前到 mutation 阶段（`commitMutationEffectsOnFiber` 的 FunctionComponent 分支），保证一棵树里所有兄弟组件的销毁都先跑完才轮到挂载
  - 组件整体卸载时，mutation 清理 insertion/layout，passive 阶段再清理 useEffect；删除树中的 passive cleanup 按父到子执行
- [x] **useTransition**：mountTransition/updateTransition + startTransition（`ReactFiberHooks.ts`）。start 函数内部：先把 `currentUpdatePriority` 提升到 `ContinuousEventPriority` 并 `setPending(true)`（走一次紧急更新让"进入 pending"立刻反映到 UI），再把 `ReactCurrentBatchConfig.transition` 置为非 null，`setPending(false)` 与 callback() 内部的更新在这个标记内一起派发；`requestUpdateLane` 检测到 `transition` 非空就走 `claimNextTransitionLane`（同一事件内的多次更新复用 `currentEventTransitionLane`，直到 `performConcurrentWorkOnRoot` 重置）
  - 新增 `packages/react/src/ReactCurrentBatchConfig.ts`（`{ transition }` 字段），聚合进 `ReactSharedInternals`
  - 简化范围：对齐 React 18.3.1 的同步 scope；React 19 async Action 不是 React 18 的缺失功能。`Transition` 对象省略 DEV 调试字段；队列 Transition entanglement 已接通
- [x] **useDeferredValue**：mountDeferredValue/updateDeferredValue（`ReactFiberHooks.ts`），值变化且当前渲染含紧急 lane（`!includesOnlyNonUrgentLanes(renderLanes)`）时保留旧值、派生一条 deferred lane 稍后单独渲染；否则直接用新值
  - React 18.3.1 使用 `claimNextTransitionLane` 分配延后更新；不能用 React 19 的 DeferredLane 解释此版本
  - 版本边界：React 18.3.1 的 `useDeferredValue` 没有 `initialValue` 第二参数
- [x] **useSyncExternalStore**：mountSyncExternalStore/updateSyncExternalStore（`ReactFiberHooks.ts`）。渲染时直接读一次 `getSnapshot()` 作为本次值（打破"只依赖参数/上次状态"的常规，只因 store 更新语义恒为同步）；`mountEffect` 挂一条订阅 effect（`subscribeToStore`，commit 后才真正调用外部 `subscribe`），另 `pushEffect` 一条不比较 deps 的 passive effect（`updateStoreInstance`），每次 commit 后同步 `inst` 缓存并补一次快照检查
  - `subscribeToStore`/`updateStoreInstance` 检测到快照变化（`checkIfSnapshotChanged`）都调用 `forceStoreRerender`：新增 `enqueueConcurrentRenderForLane`（`ReactFiberConcurrentUpdates.ts`，只冒泡 lane、不携带 update 对象）+ `scheduleUpdateOnFiber`，强制走 `SyncLane` 同步重渲染
  - 简化范围：不支持 `getServerSnapshot`（SSR/hydrate 明确不做，见文末「待实现 › 明确搁置」）；已补 `pushStoreConsistencyCheck` 和提交前 `StoreConsistency` 扫描，非阻塞 render 快照变化时同步重渲染后再提交
- [x] **useInsertionEffect**：mountInsertionEffect/updateInsertionEffect（`ReactFiberHooks.ts`），与 useLayoutEffect 共用同一套 `mountEffectImpl`/`updateEffectImpl`，只是 hookFlags 换成新增的 `HookInsertion`（`ReactHookEffectTags.ts`）。区别在 commit 阶段消费的时机：`commitMutationEffectsOnFiber`（`ReactFiberCommitWork.ts`）在 DOM 变更完成后立刻按 `HookInsertion | HookHasEffect` 跑完销毁+挂载，不像 layout effect 那样把挂载推迟到 `commitLayoutEffects`——因为它的定位就是"比 useLayoutEffect 更早"，必须在其他组件读取布局信息之前把 `<style>` 等副作用插好
  - 简化范围：不做官方针对 CSS-in-JS 库的额外时序保证之外的特殊处理，机制上与 useLayoutEffect 完全对称，只是挂载时机提前到 mutation 子阶段
- [x] **useId**：mountId/updateId（`ReactFiberHooks.ts`）。官方还有 hydrate 分支（treeContext 的 `forkStack`/`idStack` 按组件树路径编码 id，保证 SSR/CSR 一致），本项目没有 `hydrateRoot`，永远走不到那个分支，只落地客户端分支——模块级自增计数器 `globalClientIdCounter` 生成 `:{identifierPrefix}r{n}:` 形式的 id。`identifierPrefix` 挂在 `FiberRootNode` 上，由 `createRoot(container, { identifierPrefix })` 透传（`ReactFiberReconciler.ts` 的 `createContainer` 新增第三个参数），`mountId` 通过新增的 `getWorkInProgressRoot()`（`ReactFiberWorkLoop.ts`）取当前渲染所属的 root
  - 简化范围：不实现 `ReactFiberTreeContext.ts`（`forkStack`/`idStack`/base32 溢出编码），因为该机制只服务 hydration 路径一致性，本项目无 SSR 场景可对照
- [x] **useImperativeHandle**：mountImperativeHandle/updateImperativeHandle（`ReactFiberHooks.ts`）。与 useLayoutEffect 共用同一套 `mountEffectImpl`/`updateEffectImpl`（hookFlags 用 `HookLayout`，挂载/销毁时机与 useLayoutEffect 完全一致——DOM 变更之后、浏览器绘制之前），真正的读写逻辑在新增的 `imperativeHandleEffect`：`create()` 算出暴露对象，按 `typeof ref` 分两路挂到 `ref.current` 或调用 `ref(instance)`，返回的清理函数在下次重新执行/卸载时把 ref 清空。deps 额外 `concat([ref])`——ref 引用本身变化（比如从一个 callback ref 换成另一个）也要重新跑一次 create，否则旧 ref 上挂的是过期对象
  - 只在 `packages/react/src/ReactHooks.ts` 新增对外 API（转发到当前 dispatcher），不需要 reconciler 侧新增 fiber flag 或 commit 分支——复用的是 useLayoutEffect 已有的整套 effect 基础设施
  - 顺带修正 `ReactForwardRef.ts` 的类型：`render` 的第二个参数（父组件传下来的 ref 容器）此前误标成解析后的实例类型 `Ref`，与 `useImperativeHandle` 期望接收的 `{ current } | ((instance) => void) | null` 容器类型不一致；同时把默认 `Props` 从 `Record<string, never>`（索引签名强制所有键为 `never`，与交叉进来的 `ref` 属性冲突）改成 `object`
  - 简化范围：省略部分 DEV 参数校验警告；effect 执行错误仍通过错误边界处理

#### 5.3.1 ReactFiberConcurrentUpdates（并发更新入队）

- [x] `packages/react-reconciler/src/ReactFiberConcurrentUpdates.ts`（官方同名文件，Phase 4 接入 Scheduler 时暂未还原，Hooks 落地时一起补齐）
  - `enqueueConcurrentHookUpdate` / `enqueueConcurrentClassUpdate` / `enqueueConcurrentRenderForLane`：并发渲染期间的 (fiber, queue, update, lane) 四元组先平铺记录到模块级数组 `concurrentQueues`，而非直接挂到 fiber 的 updateQueue 上，避免渲染中的 workInProgress 树被并发触发的 update 污染；`fiber.lanes`/`alternate.lanes` 在入队时立刻更新（beginWork 的提前 bailout 判断需要马上可见），`childLanes` 冒泡则延迟
  - `finishQueueingConcurrentUpdates`：统一把暂存的 update 刷回各自 fiber 的 updateQueue（接成 circular list），并调用迁移到本文件的 `markUpdateLaneFromFiberToRoot` 把 lane 冒泡到 root——取代了 `ReactFiberClassUpdateQueue.ts` 原先"入队即冒泡"的做法

#### 5.4 调试方式（第三种）

- hooks 调试：在 Dispatcher 切换 / Hook 链表构建处断点，观察 hook 状态变化

#### 5.5 noop-renderer（测试渲染器）

- 暂未实现，说明见文末「待实现 › 明确搁置」

**阶段目标验收**：`useState` 管理状态并触发重渲染，`useEffect` 在 commit 后异步执行。

---

### Phase 6: 事件系统

**目标**：实现合成事件（SyntheticEvent）和事件委托。

- [x] **6.1 事件插件系统**：新增 `packages/react-dom/src/events/`：
  - `EventRegistry.ts`：`allNativeEvents` Set + `registerTwoPhaseEvent`/`registerDirectEvent`（同时注册冒泡版 `onXxx` 与捕获版 `onXxxCapture`）
  - `DOMEventProperties.ts`：精简版 `topLevelEventsToReactNames` Map + `registerSimpleEvents()`（原生事件名 → React 注册名，如 `click` → `onClick`），模块加载时由 `DOMPluginEventSystem.ts` 顶层副作用调用
  - `DOMEventNames.ts`：只列出常见交互事件（`click/dblclick/contextmenu/mousedown/mouseup/mousemove/mouseover/mouseout/keydown/keyup/keypress/focusin/focusout/input/change/submit`），覆盖 onClick/onChange/onKeyDown 等主流场景
- [x] **6.2 事件委托（根节点监听）**：
  - `client/ReactDOMComponentTree.ts`：新增 DOM 节点 ↔ Fiber / Props 的双向 WeakMap（`precacheFiberNode`/`updateFiberProps`/`getClosestInstanceFromNode`/`getFiberCurrentPropsFromNode`），`ReactDOMHostConfig.ts` 的 `createInstance`/`createTextInstance`/`commitUpdate` 接住之前忽略的 `internalInstanceHandle`/`newProps` 参数写入这套映射
  - `DOMPluginEventSystem.ts` 的 `listenToAllSupportedEvents`：`ReactDOMRoot.ts` 的 `createRoot` 里调用，在根容器上给 `allNativeEvents` 里每个事件注册 capture+bubble 两个原生监听器（`_reactListening` 标记去重）
  - `accumulateSinglePhaseListeners`：原生事件触发后，从 `getClosestInstanceFromNode` 反查出的 targetFiber 沿 `return` 链向上收集挂了对应 registrationName（`onClick` 或 `onClickCapture`，按当前阶段二选一）的 HostComponent 监听器
  - `processDispatchQueueItemsInOrder`：捕获阶段倒序遍历（root→target）、冒泡阶段正序遍历（target→root），`isPropagationStopped()` 检查支持 `stopPropagation()` 提前退出
- [x] **6.3 合成事件对象**：`SyntheticEvent.ts` 的 `createSyntheticEvent` 工厂模式（对照官方：用工厂而非单构造器+分支，避免引擎去优化），落地 4 种 Interface（基础 `SyntheticEvent`/`SyntheticMouseEvent`/`SyntheticKeyboardEvent`/`SyntheticFocusEvent`），`preventDefault`/`stopPropagation`/`isPropagationStopped`/`isDefaultPrevented`；不做事件池（对齐 React 17+ 现状）
- [x] **6.4 事件优先级分发**：`ReactDOMEventListener.ts` 的 `createEventListenerWrapperWithPriority` 按 `getEventPriority` 选 `dispatchDiscreteEvent`/`dispatchContinuousEvent`（`setCurrentUpdatePriority` 包一层，复用 Phase 4 已有的 `ReactEventPriorities.ts`）

**简化范围**（渐进式搭建，明确取舍）：

- 已落地 SimpleEventPlugin 和 ChangeEventPlugin 常用客户端路径（文本输入、checkbox/radio、select/file）；不做 EnterLeave/Select/BeforeInput 等完整插件与旧浏览器 polyfill。React 19 Form Action 等不属于 18.3.1 对照范围
- 不做 hydration/Suspense 相关的 `findInstanceBlockingEvent` 阻塞重放逻辑（本项目无 hydrate，见 Phase 10）；不做 Portal 场景的祖先 fiber 重映射（本项目无 Portal）；不做 legacyFBSupport / non-delegated events / passive touch 特殊处理；事件结束时先 flush 同步队列，再恢复当前受控值，包含同名 radio 联动恢复
- **不引入官方的 `batchedUpdates`/`ReactDOMUpdateBatching.ts` 机制**：官方用它包裹事件分发主要是为受控组件回滚兜底、以及历史 legacy 模式的批处理保证。本项目 `ensureRootIsScheduled`（`ReactFiberWorkLoop.ts`）已经是"同 lane 重复调用直接早退 + SyncLane 走微任务统一 flush"，同一事件回调内连续多次 `setState` 只要停留在同一 lane，微任务 flush 前只会累积、不会重复提交——天然满足"多次 setState 只触发一次重渲染"的验收标准，不需要额外的 `BatchedContext` 包裹；当前常用受控输入路径在事件结束时额外执行 flush 与状态恢复
- `getListener.ts` 已补 disabled 交互元素抑制鼠标事件；`SyntheticEvent` 不做 `getModifierState`（跨浏览器修饰键归一化）

**阶段目标验收**：能够监听 onClick、onChange 等事件，事件回调中多次 setState 只触发一次重渲染（`fixtures/events`）。

---

### Phase 7: Context API

#### 7.0 ReactFiberStack（通用栈基础设施）

- [x] `packages/react-reconciler/src/ReactFiberStack.ts`（官方同名文件，Context/legacy context/host context 共用这一套通用栈）
  - `createCursor` / `push` / `pop`：用两个平行数组（`valueStack` + 栈顶指针 `index`）模拟调用栈，`pop` 时机由子树是否遍历完毕决定（对应 completeWork 归的时机）；官方 DEV 模式下还有 `fiberStack` 做 push/pop 配对校验，本项目省略
  - Context 的 `pushProvider`/`popProvider`（7.1）就是这套栈的具体应用之一，不是 Context 专属机制

#### 7.1 createContext / Provider / Consumer / useContext

- [x] `createContext(defaultValue)`（`packages/react/src/ReactContext.ts`）→ `{ Provider, Consumer, _currentValue }`；`Provider`/`Consumer` 通过 `$$typeof`（`REACT_PROVIDER_TYPE`/`REACT_CONTEXT_TYPE`）区分，`createFiberFromTypeAndProps`（`ReactFiber.ts`）按 `$$typeof` 分发出 `ContextProvider`/`ContextConsumer` 两个新 WorkTag（9/10，数值对齐官方）
- [x] Provider 组件：`updateContextProvider`（`ReactFiberBeginWork.ts`）在 beginWork 时 `pushProvider` 把新 value 压栈（`ReactFiberNewContext.ts`，基于 7.0 的通用栈），`context._currentValue` 立刻更新为新值；`completeWork` 归的时候 `popProvider` 恢复旧值
- [x] 消费：函数组件 `useContext(context)` 走 `ReactFiberHooks.ts` 的 dispatcher（mount/update 两个阶段都直接是 `readContext`，语义上不区分 mount/update）；`<Context.Consumer>`（render prop 写法）走 `updateContextConsumer`，同样调用 `readContext`
  - `readContext`（`ReactFiberNewContext.ts`）读取 `context._currentValue` 并把这次读取记录追加到 `currentlyRenderingFiber.dependencies` 链表上，供 7.2 的传播判断使用
  - 简化范围：不支持 class 组件 `contextType`（Phase 8 落地 class 组件时再补）

#### 7.2 context 变化时的传播与 bailout 兼容

- [x] Provider 的 value 变化时（`is(oldValue, newValue)` 为 false），`propagateContextChange`（`ReactFiberNewContext.ts`，对照官方 `propagateContextChange_eager`）从 Provider 子树里查找 `dependencies` 含该 context 的 fiber，标记其 `lanes` 需要在本次 `renderLanes` 下重渲染，并沿 `return` 链把 lane 冒泡到祖先的 `childLanes`（`scheduleContextWorkOnParentPath`）
- [x] context 与 bailout 联动：`FiberNode.dependencies`（`ReactInternalTypes.ts` 的 `Dependencies`/`ContextItem`）记录本次渲染读取过的 context 列表；`prepareToReadContext` 在每次函数组件渲染前重置收集状态，若复用的 dependencies.lanes 命中本次 renderLanes 则 `markWorkInProgressReceivedUpdate`
- [x] `attemptEarlyBailoutIfNoScheduledUpdate` 里 ContextProvider 分支即使自身 bailout 也要 `pushProvider`（子树读到的 `_currentValue` 必须是新值，否则会栈错位）

**简化范围**（渐进式搭建，明确取舍）：

- 只支持单一渲染器（react-dom），不做官方为兼容双渲染器（如 RN 主 + Fabric 副渲染器）准备的 `_currentValue2`/`isPrimaryRenderer` 分支
- 只做 eager 传播（`propagateContextChange`），不做官方 `enableLazyContextPropagation` 分支——该 flag 官方默认也是 `false`，两者行为一致
- 不做 legacy context（class 组件 `contextTypes`/`childContextTypes`）、`DehydratedFragment`（Suspense）、ClassComponent 强制更新分支（均依赖尚未落地的 Phase 8/9）
- `Consumer` 不做官方 DEV 专属的警告代理对象（`<Context.Consumer.Provider>` 误用警告等），直接复用 Provider 所属的同一个 context 引用（对齐官方 PROD 行为）

**阶段目标验收**：Provider 更新 value 后，消费该 context 的子组件自动重渲染，不消费该 context 的兄弟组件不重渲染（`fixtures/context`）。

---

### Phase 8: Class 组件生命周期

#### 8.1 ClassComponent beginWork

- [x] `shouldConstruct`（`packages/react-reconciler/src/ReactFiberBeginWork.ts`，看 `type.prototype.isReactComponent` 是否为真）区分 class/function：`mountIndeterminateComponent` 命中后把 `workInProgress.tag` 定成 `ClassComponent`，走 `constructClassInstance` + `mountClassInstance`；未命中则按函数组件走原路径
- [x] 实例化：`constructClassInstance`（`ReactFiberClassComponent.ts`，对照官方 `constructClassInstance`）`new Component(props)`，随后挂 `instance.updater = classComponentUpdater`、`instance._reactInternals = workInProgress`（官方字段名，供 updater 反查所属 fiber），`workInProgress.memoizedState` 初始化为 `instance.state`（ClassComponent 的 memoizedState 语义是"实例的 state"，与函数组件的 hook 链表不同）
- [x] 挂载阶段（`mountClassInstance`）：`constructor`（已在外部完成）→ `getDerivedStateFromProps`（`applyDerivedStateFromProps`，与旧 state 浅合并写回 `memoizedState`）→ `initializeUpdateQueue` → `render`（`finishClassComponent` 里调用 `instance.render()`）→ `componentDidMount`（若定义，打 `Update` flag，commit 的 layout 子阶段执行）
- [x] 更新阶段（`updateClassInstance`）：`cloneUpdateQueue` → `processUpdateQueue` 算出新 state → `getDerivedStateFromProps` → props/state 都没变且无 `forceUpdate` 时直接 bailout（不调用任何生命周期）→ `checkShouldComponentUpdate`（`forceUpdate` 短路跳过判断；用户定义 `shouldComponentUpdate` 优先；`PureComponent` 走 `shallowEqual` 浅比较；否则默认总是更新）→ `shouldUpdate` 为真才打 `Snapshot`/`Update` flag → `finishClassComponent` 调用 `instance.render()`

#### 8.2 setState / forceUpdate

- [x] 复用 `ReactFiberClassUpdateQueue` 的 Update 队列：`classComponentUpdater.enqueueSetState`/`enqueueForceUpdate`（`ReactFiberClassComponent.ts`）创建 `Update` 对象（`forceUpdate` 用 `tag = ForceUpdate`），走 `enqueueUpdate` → `scheduleUpdateOnFiber`，与函数组件/HostRoot 共用同一套并发更新入队机制
- [x] `hasForceUpdate` 模块级标记（`ReactFiberClassUpdateQueue.ts`）：`processUpdateQueue` 处理到 `ForceUpdate` 类型的 update 时置真，`resetHasForceUpdateBeforeProcessing`/`checkHasForceUpdateAfterProcessing` 供 `updateClassInstance` 读取，驱动"跳过 shouldComponentUpdate"与"props/state 都没变也要重渲染"两处判断
- [x] `setState`/`forceUpdate` 的 `callback` 参数：`processUpdateQueue` 把带 callback 的 update 收集进 `queue.effects` 并打 `Callback` flag（`LayoutMask` 并入 `Callback`），`commitClassCallbacks`（`ReactFiberCommitWork.ts`）在 layout 子阶段统一执行并清空

#### 8.3 getSnapshotBeforeUpdate / before-mutation 子阶段

- [x] 新增 commit 的 before-mutation 子阶段（`commitBeforeMutationEffects`，`ReactFiberCommitWork.ts` + `ReactFiberWorkLoop.ts` 的 `commitRootImpl` 在 `commitMutationEffects` 之前调用）：只处理 `ClassComponent` 打了 `Snapshot` flag 的节点，调用 `instance.getSnapshotBeforeUpdate(prevProps, prevState)`，结果挂在 `instance.__reactInternalSnapshotBeforeUpdate` 上（官方同名字段），供 layout 子阶段的 `componentDidUpdate` 第三个参数取用
- [x] `ReactFiberFlags.ts` 补 `BeforeMutationMask = Snapshot`

#### 8.4 componentWillUnmount

- [x] `commitDeletionEffectsOnFiber`（`ReactFiberCommitWork.ts`）补 `ClassComponent` 分支：整棵组件被卸载时调用 `instance.componentWillUnmount()`（若定义），与 `FunctionComponent` 分支清理 hook effect 的位置对应

**简化范围**（渐进式搭建，明确取舍）：

- 不支持 legacy `componentWillMount`/`componentWillReceiveProps`/`componentWillUpdate`（官方也已废弃，仅 `UNSAFE_` 前缀保留兼容），`context`（第二个参数）恒为 `undefined`（legacy context 未实现，见 Phase 7 简化范围）
- 不做错误边界相关的 `getDerivedStateFromError`/`componentDidCatch`（留到 Phase 9.3），不做 `CaptureUpdate` 类型 update 的重放语义
- `Component`/`PureComponent` 用 TS class + 泛型实现（区别于官方 Flow 环境的 function + prototype 赋值写法），运行时行为（`updater` 注入、`isReactComponent`/`isPureReactComponent` 标记）与官方一致，只是语法载体不同，方便业务代码获得 `this.props`/`this.state` 类型推导

**阶段目标验收**：能够使用 class 组件，生命周期按正确顺序执行（`fixtures/class`：挂载/更新/卸载全链路 + setState 回调 + forceUpdate + PureComponent 浅比较跳过渲染）。

---

### Phase 9: 其他核心 API + 性能优化

#### 9.0 ReactFiberThrow / ReactFiberUnwindWork（unwind 地基）

- [x] `packages/react-reconciler/src/ReactFiberThrow.ts`（官方 ReactFiberThrow.js）
  - `throwException`：给抛错的 fiber 打 `Incomplete`，沿 `return` 链向上找最近的 `ClassComponent`（实现 `getDerivedStateFromError`/`componentDidCatch`）或兜底 `HostRoot`，命中后打 `ShouldCapture` 并 `enqueueCapturedUpdate` 塞一条 `CaptureUpdate`
  - `createClassErrorUpdate`：payload/callback 复用现有消费链路——`getDerivedStateFromError` 返回值走 `processUpdateQueue` 的浅合并语义，`componentDidCatch` 走 `commitClassCallbacks`（layout 子阶段统一执行），不需要新增专门的 commit 分支
  - `createRootErrorUpdate`：没有任何边界捕获时的兜底，`payload = {element: null}` 卸载整棵树，`callback` 里 `console.error(error)`
- [x] `packages/react-reconciler/src/ReactFiberUnwindWork.ts`（官方 ReactFiberUnwindWork.js）
  - `unwindWork`：completeUnitOfWork 的 `Incomplete` 分支调用，`ClassComponent`/`HostRoot` 命中 `ShouldCapture` 就翻转成 `DidCapture` 并返回该 fiber（重新进入 beginWork 渡染 fallback）；`ContextProvider` 主动 `popProvider` 做栈清理（它跳过了自己的 completeWork，栈会错位）；其余返回 null 继续向上
- [x] `ReactFiberWorkLoop.ts`：`renderRootSync`/`renderRootConcurrent` 把 `workLoopSync()`/`workLoopConcurrent()` 包进 `do/try/catch` 循环，捕获到异常调用新增的 `handleError`（`throwException` + `completeUnitOfWork`）；`completeUnitOfWork` 的 `Incomplete` 分支调用 `unwindWork`，找到边界则设为新的 `workInProgress`（`flags &= HostEffectMask` 清掉非法的 commit 标记），没找到则把 `Incomplete` 继续向上传播并清空 `subtreeFlags`/`deletions`
  - 这套机制是 Suspense（9.1）与错误边界（9.3）共用的同一地基，不是各自独立实现——当前只有 9.3 消费了它（`ClassComponent` 分支），9.1 落地时 `unwindWork`/`throwException` 需要再补 `SuspenseComponent`/`OffscreenComponent`/Promise 分支
  - **简化范围**：`throwException` 只处理 class 错误边界，不含 Suspense 的 Promise/thenable 判断（留给 9.1）；不追踪 componentStack

#### 9.1 Suspense 完整实现

- [x] **捕获 Promise throw**：`throwException`（`ReactFiberThrow.ts`，对照官方 `isThenable` 分支）render 阶段读到 pending 状态的资源直接 `throw` 出对应的 Promise；`throwException` 识别出抛出值是 thenable 后，沿 `return` 链找最近未被标记 `ShouldCapture` 的 `SuspenseComponent`（`getNearestSuspenseBoundaryToCapture`），命中则 `markSuspenseBoundaryShouldCapture` 打 `ShouldCapture`，同时 `attachPingListener`（`root.pingCache` 记录已监听的 wakeable+lanes，避免重复挂 `then`）与 `attachRetryListener`（挂到 Suspense 边界自身 `updateQueue` 的 `Set<Wakeable>`，供 commit 阶段消费）
- [x] **显示 fallback**：`unwindWork`（`ReactFiberUnwindWork.ts`）遇到打了 `ShouldCapture` 的 `SuspenseComponent` 翻转成 `DidCapture` 并重新进入 `updateSuspenseComponent`（`ReactFiberBeginWork.ts`）；`showFallback` 由 `DidCapture` 决定——`mount`/`update` 两个分支分别调用 `mountSuspenseFallbackChildren`/`updateSuspenseFallbackChildren`，用 `OffscreenComponent` 包裹 primary children（隐藏但不销毁）+ 正常渲染 fallback
- [x] **OffscreenComponent**：`packages/react-reconciler/src/ReactFiberOffscreenComponent.ts`（官方 `ReactFiberOffscreenComponent.old.js` 简化版，`OffscreenState` 只保留 `baseLanes`，去掉 cachePool/transitions）—— Suspense 用它包裹主内容并隐藏，保留 Fiber 状态不销毁；`updateOffscreenComponent`（`ReactFiberBeginWork.ts`）始终正常 reconcile children（不做官方 hidden 时 bail-out-and-defer 到 OffscreenLane 的机制），隐藏效果完全交给 commit 阶段的 `Visibility` flag + `hideInstance`/`unhideInstance`（`ReactFiberCommitWork.ts` 的 `OffscreenComponent` 分支）处理
- [x] **ping/retry 重渲染**：commit 阶段 `attachSuspenseRetryListeners`（`ReactFiberCommitWork.ts`）消费 Suspense 边界 `updateQueue` 里记录的 wakeable，挂上 `resolveRetryWakeable` 监听；Promise resolve 后触发 `pingSuspendedRoot`（`ReactFiberWorkLoop.ts`）用 `mergeLanes` 把之前挂起的 lanes 重新标记为待调度并 `ensureRootIsScheduled`，重渲染时 `updateSuspenseComponent` 读到资源已就绪（`AsyncBox` 不再 throw），正常渲染分支替换掉 fallback
- 简化范围：不含 `SuspenseContext` 栈 / SSR dehydration / `SuspenseList`；`lazy` 已在 9.1 实现并修复 Function/Class/memo/forwardRef 解析；`use` 不属于 React 18.3.1 稳定公开 API
- 补 ReactSymbols 的 `REACT_SUSPENSE_TYPE`、ReactWorkTags 的 `SuspenseComponent`/`OffscreenComponent` 等

**验收**：`fixtures/suspense`——单个 Suspense 挂起 2s 后从 fallback 自动切到真实内容；一个 Suspense 包裹两个异步子节点，两者都完成才整体切换；多个独立 Suspense 互不影响

#### 9.2 forwardRef / memo / lazy / Portal

- [x] **forwardRef**（`packages/react/src/ReactForwardRef.ts` + reconciler 新增 `ForwardRef` WorkTag）：`forwardRef(render)` 返回 `{ $$typeof: REACT_FORWARD_REF_TYPE, render }`，`createFiberFromTypeAndProps`（`ReactFiber.ts`）按 `$$typeof` 分发出 `ForwardRef` tag；`updateForwardRef`（`ReactFiberBeginWork.ts`）是 `updateFunctionComponent` 的分支——`renderWithHooks` 新增 `secondArg` 参数（对照官方同名参数），只有 ForwardRef 会把 `workInProgress.ref` 透传给 `render(props, ref)`，其余组件类型传 `undefined`
- [x] **markRef / commitAttachRef / commitDetachRef**（`ReactFiberBeginWork.ts` + `ReactFiberCommitWork.ts`）：`markRef` 在 `updateHostComponent`/`finishClassComponent` 里调用——ref 引用变化（mount 时非空，或 update 时与上次不同）才打 `Ref` flag（`ForwardRef`/`MemoComponent` 自身不调用，只是把 `workInProgress.ref` 转发给内部 fiber，由内部 fiber 的 tag 决定要不要 markRef）；`Ref` 并入 `LayoutMask`，`commitAttachRef` 挂载/更新时在 `commitLayoutEffectsOnFiber` 末尾统一按 flag 调用（函数形式调用 `ref(instance)`，对象形式 `ref.current = instance`），`commitDetachRef` 在 `commitMutationEffectsOnFiber` 的 `HostComponent`/`ClassComponent` 分支（ref 变化）和 `commitDeletionEffectsOnFiber`（整体卸载）里调用
  - 简化范围：不做字符串 ref 的自动转换（`coerceRef`），`commitAttachRef`/`commitDetachRef` 遇到 `typeof ref === "string"` 直接跳过；`commitAttachRef` 对 HostComponent 不做官方的 `getPublicInstance` 包装（本项目 HostConfig 未实现该接口，直接用 `stateNode`，DOM 场景效果一致）
- [x] **memo**（`packages/react/src/ReactMemo.ts` + reconciler 新增 `MemoComponent` WorkTag）：`memo(type, compare?)` 返回 `{ $$typeof: REACT_MEMO_TYPE, type, compare }`；`updateMemoComponent`（`ReactFiberBeginWork.ts`，简化版，不含官方 `SimpleMemoComponent` 快路径升级）mount 时直接用 `createFiberFromTypeAndProps` 建内部 fiber，update 时若无待处理更新/context，用 `compare`（默认 `shallowEqual`）比较新旧 props，props 相等且 `current.ref === workInProgress.ref` 才 bailout，否则 `createWorkInProgress` 克隆内部 fiber 继续渲染
- **lazy**：`packages/react/src/ReactLazy.ts` + reconciler 新增 `LazyComponent` WorkTag（16，对齐官方数值）。`lazy(ctor)` 返回 `{ $$typeof: REACT_LAZY_TYPE, _payload, _init }`，`_payload._status` 是简易状态机（Uninitialized/Pending/Resolved/Rejected），`_init(_payload)`（`lazyInitializer`）首次调用触发 `ctor()` 拿到 thenable，resolve 前直接 `throw` 这个 thenable——天然复用已有的 Suspense `throwException` 的 `isThenable` 分支，不需要新增挂起逻辑；resolve 后返回 `moduleObject.default`。`createFiberFromTypeAndProps`（`ReactFiber.ts`）按 `$$typeof` 分发出 `LazyComponent` tag；`mountLazyComponent`（`ReactFiberBeginWork.ts`，简化版）调用 `_init` 解析出真正的 Component，用 `shouldConstruct` 分流到 `updateClassComponent`/`updateFunctionComponent`，同时把 `workInProgress.tag`/`type` 改写成解析后的结果——下次渲染直接按普通组件走，不再经过 `LazyComponent` 分支，`completeWork` 不需要为它单独开分支
  - 简化范围：不含 `resolveDefaultProps`（`Component.defaultProps` 合并）与热更新分支；只处理 `FunctionComponent`/`ClassComponent` 两种最常见的懒加载目标，不支持 `lazy` 包裹 `forwardRef`/`memo` 的组合场景
- **Portal**：`packages/react-reconciler/src/ReactPortal.ts` 的 `createPortal(children, containerInfo, key?)` 返回 `{ $$typeof: REACT_PORTAL_TYPE, key, children, containerInfo, implementation: null }`，由 `packages/react-dom/index.ts` 转出对外（Portal 是 DOM 特定概念，放在 react-dom 而非 react 包）。`createFiberFromPortal`（`ReactFiber.ts`）建出 `HostPortal` fiber，`stateNode = { containerInfo, pendingChildren: null, implementation }`；`ReactChildFiber.ts` 新增 `isPortal` 判断（`$$typeof === REACT_PORTAL_TYPE`，Portal 元素不是 `isReactElement`）与 `updatePortal`/`reconcileSinglePortal`，接入 `createChild`/`updateSlot`/`updateFromMap`/`reconcileChildFibers` 顶层分发；`updatePortalComponent`（`ReactFiberBeginWork.ts`）结构与 `updateHostRoot` 平行，`pendingProps` 本身就是 children；`completeWork`/`commitMutationEffectsOnFiber` 各补一个 `HostPortal` case（本项目只支持 mutation 模式，官方 `updateHostContainer` 在 mutation 模式下是 no-op，效果上等同于 Fragment/Mode 的 default 分支，只是显式列出与官方结构对照）；`commitDeletionEffectsOnFiber` 补 `HostPortal` case——进入 Portal 后临时把 `hostParent`/`hostParentIsContainer` 切换成 Portal 自己的容器，子树里的 host 节点从这个容器里移除而不是外层 `hostParent`
  - `commitPlacement`/`getHostSibling`/`isHostParent`/`appendAllChildren` 等 commit 侧骨架此前（Suspense/Class 组件阶段对照官方结构时）已预先补好 `HostPortal` 分支，本次不需要改动

**简化范围**（渐进式搭建，明确取舍）：

- 不做 `SimpleMemoComponent` 快路径（官方在 `updateMemoComponent` 里探测"纯函数组件 + 无 compare + 无 defaultProps"时把 tag 升级为 `SimpleMemoComponent` 走更快的 bailout 路径），统一走 `MemoComponent`，效果一致只是少一层优化
- 不做 `resolveDefaultProps`（`Component.defaultProps` 合并），forwardRef/memo 包装的组件不支持 `defaultProps`

**验收**：`fixtures/forwardref-memo`——`forwardRef` 转发 ref 到内部 DOM 节点（点击按钮 focus 真实 input），`memo` 包裹的组件只在 props 变化时重渲染（renderCount 观察）

#### 9.3 错误边界与异常处理

- [x] **ErrorBoundary**：class 组件实现 `getDerivedStateFromError`/`componentDidCatch`，render 错误沿 `throwException`/`unwindWork` 恢复，commit 错误另走 `captureCommitPhaseError`
- [x] **捕获与回退**：render 阶段抛错 → `throwException`（9.0）沿 `return` 链找最近的错误边界 → 标记 `ShouldCapture` → `unwindWork`（9.0）翻转 `DidCapture` → 重新进入 `updateClassComponent`（`ReactFiberBeginWork.ts`）
  - `updateClassComponent` 新增分流：`current === null` 时说明边界组件自身也是本次渲染首次挂载（第一次 beginWork 已经 `constructClassInstance`/`mountClassInstance` 过），走新增的 `resumeMountClassInstance`（`ReactFiberClassComponent.ts`，官方同名函数的简化版）消费 `CaptureUpdate` 算出 fallback state；`current !== null`（边界组件是复用的已挂载节点）则仍走原有 `updateClassInstance`——`CaptureUpdate` 塞进它的 base 队列，走 `processUpdateQueue` 时被消费
  - `getStateFromUpdate`（`ReactFiberClassUpdateQueue.ts`）的 `CaptureUpdate` 分支：清除 `ShouldCapture`、设置 `DidCapture` 后 fallthrough 到 `UpdateState`；finishClassComponent 即使被 sCU 拦截也处理 DidCapture fallback
- **retry**：本次未新增任何机制——错误边界捕获后，用户在 `componentDidCatch`/fallback UI 里手动 `setState` 即可触发正常更新流程重新挂载被卸载的子树，这条路径天然可行，不需要额外代码
- **简化范围**（本次明确不做，留待后续）：
  - 已补 `captureCommitPhaseError`：生命周期、ref、effect 的 commit 错误进入仍挂载祖先边界的 SyncLane；componentDidCatch-only 与更新时 fallback 也已修复，验证覆盖范围见核心记录
  - 不追踪 componentStack（`componentDidCatch` 的第二个参数恒为 `{componentStack: ""}`）
  - `HostRoot` 兜底（无任何边界捕获）只做整棵树卸载 + `console.error`，不做官方的 `logCapturedError` 格式化

**验收**：`fixtures/error-boundary`——挂载时立即抛错（`MountBombDemo`）、更新时抛错（`UpdateBombDemo`，点击按钮后触发）均被 `ErrorBoundary` 捕获显示 fallback UI 并打印 `componentDidCatch` 日志，点击"重置"能恢复；无边界包裹的 `NoBoundaryDemo` 触发后整棵树被卸载且控制台打印 `console.error`

#### 9.4 性能优化策略

- [x] **eagerState**：`dispatchSetState`（`ReactFiberHooks.ts`）在 `fiber.lanes`/`alternate.lanes` 都为 `NoLanes`（queue 当前为空）时，用 `queue.lastRenderedReducer` 对 `queue.lastRenderedState` 提前算一次新值——若与当前值 `Object.is` 相等，走新增的 `enqueueConcurrentHookUpdateAndEagerlyBailout`（`ReactFiberConcurrentUpdates.ts`，lane 恒为 `NoLane` 入队但不冒泡不调度）直接跳过整次调度；否则把提前算好的值缓存到 `update.hasEagerState`/`eagerState` 上，`updateReducer` 重放时若 reducer 没变直接复用这个值，省一次重复调用。`dispatchReducerAction`（useReducer）不做这个优化（对照官方：eager 优化只在 `dispatchSetState` 分支里做）
- [x] **React.memo / useMemo / useCallback**：与 bailout 联动的 props 浅比较（已实现，见 9.2 / Phase 5.3）

---

## 待实现

> 汇总当前所有未完成项，按「计划中」与「明确搁置」分组；各项详细设计见对应 Phase 小节。

### 计划中

> 当前无计划中事项，主链路 + Phase 5~9 已全部完成（noop-renderer、Hydrate/Legacy render 明确搁置，见下）。

### 明确搁置（暂不安排，仅记录范围）

- **noop-renderer**（Phase 5.5）：新建 `react-noop-renderer` 包（官方 `packages/react-noop-renderer` 对应用来测 reconciler 的宿主），实现一套不操作真实 DOM 的 HostConfig（内存树），配合 useEffect 等副作用做确定性测试
- **Phase 10 Hydrate / Legacy render**：Lane 表里已经铺了 `SyncHydrationLane`/`InputContinuousHydrationLane`/`DefaultHydrationLane`/`SelectiveHydrationLane`/`IdleHydrationLane` 五条 hydration lane（对齐官方位表），但本项目 react-dom 简版目前只有 `createRoot`，没有 `hydrateRoot`/`ReactDOM.render`（legacy）：
  - **hydrateRoot**：SSR 场景下复用已有 DOM 而非新建，需要 `getIsHydrating`/`tryToClaimNextHydratableInstance` 等一整套匹配已有 DOM 节点的逻辑（`ReactFiberHydrationContext.ts`）
  - **legacy render（ReactDOM.render）**：LegacyRoot 模式，更新恒为 SyncLane，行为上更接近 React 17（无并发特性），本项目 ReactRootTags 已有 LegacyRoot 占位但未接入
  - **selective hydration**：并发模式下 hydration 与交互事件的优先级协调（用户点击未 hydrate 完的区域时优先 hydrate 该部分）

---

## 参考资料

- 官方仓库：https://github.com/facebook/react
- 对照文件路径：
  - react 核心：`packages/react/src/`
  - react-dom：`packages/react-dom/src/`
  - react-dom DOM 模块：`packages/react-dom/src/`
  - reconciler：`packages/react-reconciler/src/`
  - scheduler：`packages/scheduler/src/`

---

## 开发原则

1. **1:1 对照官方源码**：保持文件路径、函数命名、算法逻辑与官方一致
2. **渐进式实现**：先跑通主链路，再补边界 case 和优化
3. **注释说明意图**：只在关键算法处注释"为什么官方这么做"，不写样板注释
4. **验收标准清晰**：每个 Phase 结束都有可执行的示例代码验证功能正确性
