> 历史记录：本文件保留上一轮修复时的路径和结论。当前目录与新增修复验收见 [独立复审修复报告](reviews/react18.3.1-independent-audit/repair-report.md)。

# React 18.3.1 核心修复与验证

日期：2026-10-20。工作分支：`codex/fix-react18-core-flows`。原始代码提交：`92e6f0e267fc1742929a3734d6068621e25729b2`。

## 结论与范围

本轮按已有评估修复客户端核心流程，使用官方 React **18.3.1 发布包**运行同一组行为测试，再与本仓库构建产物比较。实现与审查的源码基准为官方 tag `v18.3.1`（`f1338f8080abd1386454a10bbf93d67bfe37ce85`），没有用官方仓库当前 main 代替 React 18。

最终运行结果见下方“验收结果”。验证覆盖根更新、Fiber 协调、Hooks、批处理、并发重放、Effect、Context、memo/ref、Class、Error Boundary、Suspense、事件和表单等典型核心机制。它支持将本项目作为这些调用链的 TS 阅读入口；不等于完整移植官方 React，也不能以通过率推算全部源码的正确率。

DOM 实现在 `packages/react-dom/src`（与官方 18.3.1 同路径）。早先的 `packages/react-dom-bindings` 已清空，不要再按那个目录找文件。

## 修复内容

| 问题                                                             | 本次处理                                                                                                                                                                        | 关键文件（相对于仓库根）                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 纯 useEffect / memo 内 Effect 不执行                             | Passive 与 Update 分开消费；PassiveMask 纳入 ChildDeletion；layout/passive 按对应阶段执行                                                                                       | `ReactFiberFlags.ts`、`ReactFiberCommitWork.ts`、`ReactFiberWorkLoop.ts`（均在 reconciler/src）               |
| 卸载清理错误或时机不对                                           | insertion/layout 在 mutation 清理，passive 在 passive 阶段清理；保留删除树直到 cleanup 完成，随后断开 return                                                                    | `packages/react-reconciler/src/ReactFiberCommitWork.ts`                                                       |
| 把 useEffect 一律当成绘制后异步任务                              | ConcurrentRoot 的 SyncLane 提交在当前任务结束前刷新 passive；普通更新走调度器；执行 passive 时恢复正确优先级与 transition 上下文                                                | `packages/react-reconciler/src/ReactFiberWorkLoop.ts`                                                         |
| render 内 setState 提交中间状态                                  | render-phase update 独立入队、rerender dispatcher、同一次 render 内重算、次数保护；throw 后 reset；最终状态未变时 bailoutHooks 不重复提交 Effect                                | `packages/react-reconciler/src/ReactFiberHooks.ts`、`ReactFiberBeginWork.ts`                                  |
| 并发重启可能丢 pending update 或污染 Context                     | 消费 pending 前备份到 currentHook.baseQueue；fresh stack 恢复中断 Provider 栈；连接 Hooks/Class/root 的 Transition entanglement；Class 派生状态仅在无剩余 lane 时覆盖 baseState | `ReactFiberHooks.ts`、`ReactFiberUnwindWork.ts`、`ReactFiberWorkLoop.ts`、`ReactFiberClassUpdateQueue.ts`     |
| useSyncExternalStore 缺提交前一致性检查                          | 注册 StoreConsistency，非阻塞 render 提交前检查快照；变化后先同步重算再提交，避免已测场景出现旧快照首帧                                                                         | `ReactFiberHooks.ts`、`ReactFiberWorkLoop.ts`                                                                 |
| Suspense 更新只隐藏 primary，未插 fallback                       | 新 fallback Fragment 标记 Placement；可见内容的 Transition 挂起保留 current；ping 后重试；隐藏/恢复重新连接 layout effects                                                      | `ReactFiberBeginWork.ts`、`ReactFiberCommitWork.ts`、`ReactFiberWorkLoop.ts`                                  |
| lazy Class / memo / forwardRef 不能正确解析                      | 按真实解析类型选择 Fiber 路径；尚无 Class 实例时走 construct/mount；无边界非同步挂起等待 ping，同步挂起转为错误                                                                 | `ReactFiberBeginWork.ts`、`ReactFiberThrow.ts`                                                                |
| componentDidCatch-only、更新时 fallback 或 commit 错误恢复不完整 | 错误捕获标志与队列隔离；错误恢复卸载旧子树并插入新树；commit 错误沿仍挂载祖先进入 SyncLane；删除树中的内部边界不再接收卸载错误                                                  | `ReactFiberClassUpdateQueue.ts`、`ReactFiberBeginWork.ts`、`ReactFiberCommitWork.ts`、`ReactFiberWorkLoop.ts` |
| handler-only 更新仍读到旧回调                                    | 监听器变化也生成提交载荷，刷新 DOM 已提交 props 缓存                                                                                                                            | `packages/react-dom/src/client/ReactDOMHostConfig.ts`                                                         |
| disabled=false 变 true、camelCase style 无效                     | 布尔属性使用存在/删除语义；style 支持 camelCase、单位、自定义属性与旧样式移除                                                                                                   | `packages/react-dom/src/client/ReactDOMHostConfig.ts`、`CSSPropertyOperations.ts`、`shared/CSSProperty.ts`    |
| value/onChange 缺受控闭环                                        | input/textarea/select 初始化和提交；值跟踪区分程序赋值与原生输入；事件后先 flush 再恢复值；radio 联动；select 在子 option 提交后更新                                            | `ReactDOMInput.ts`、`inputValueTracking.ts`、`DOMPluginEventSystem.ts`                                        |
| StrictMode、公共 API、root unmount 缺口                          | DEV render 双调用与 Effect 重挂载；生产关闭；导出 Fragment/StrictMode/createRef/startTransition/flushSync；unmount 同步清理且后续 render 拒绝                                   | `ReactTypeOfMode.ts`、`ReactFiber.ts`、`ReactFiberHooks.ts`、`ReactFiberCommitWork.ts`、React/ReactDOM 入口   |
| 教学说明混入 React 19                                            | 修正 async Action、DeferredLane、useDeferredValue initialValue 归属；更新 roadmap、README 与旧能力注释                                                                          | `README.md`、`CLAUDE.md`、`docs/roadmap.md`、相关 TS 注释                                                     |

原评估的 16 个场景在旧构建中复核为 9 通过、7 失败；本轮首先处理这 7 项，再扩展组合与并发回归。`scheduler-order` 曾把真实时间中的低优先级任务与延迟任务规定成固定先后，测试现已分阶段验证，避免把操作系统耗时误判为 Scheduler 缺陷。

Class 派生状态补查用例在修复前复现：同一队列先 Transition +10、再同步 +1，官方为 `11:x`，本地为 `12:x`；原因是 getDerivedStateFromProps 无条件覆盖 baseState，破坏被跳过更新的重放起点。修复条件与官方保持一致。

## 面试常见机制与验证入口

“常见”用于界定用户需要的源码主题，不代表对全网面试频次做过统计。下表只陈述具体测试覆盖的行为，不承诺所有业务组合。

| 主题                                        | 主要代码入口                                           | 自动验证场景                                                                                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Element、JSX、组件与 Fiber                  | ReactElement / jsx runtime → createFiberFromElement    | 所有组件场景经 createElement 驱动；自动 JSX runtime 另经 fixtures Vite 构建检查，Element 全部 DEV 校验未覆盖                                                                                |
| createRoot 首次渲染与更新                   | ReactDOMRoot → updateContainer → scheduleUpdateOnFiber | `basic-state`、`root-unmount`                                                                                                                                                               |
| Fiber 双缓存、render/commit、DFS            | ReactFiber / BeginWork / CompleteWork / CommitWork     | `keyed-diff`、`class-lifecycle`、`effect-order`                                                                                                                                             |
| type/key 复用与状态保留                     | ReactChildFiber                                        | `keyed-diff`：C/A 重排保留实例、删除 B、插入 D                                                                                                                                              |
| Hook 链表与调用顺序                         | renderWithHooks / updateWorkInProgressHook             | `hook-order-error`、`hook-throw-recovery`、`render-phase-reducer`                                                                                                                           |
| useState / useReducer、render 内更新        | mount/update/rerenderReducer、dispatch                 | `basic-state`、`render-phase`、`render-phase-ref`、`render-phase-reducer`、`infinite-render-guard`                                                                                          |
| 自动批处理与 flushSync                      | WorkLoop、Hook/Class 队列                              | `state-batch`、`async-batch`、`promise-batch-flushsync`、`class-lifecycle`                                                                                                                  |
| baseState/baseQueue 重放、抢占              | updateReducer / processUpdateQueue                     | `transition-rebase`、`class-transition-rebase`、`derived-state-rebase`、`concurrent-context-rebase`                                                                                         |
| Scheduler 优先级、取消、续跑、延时          | Scheduler / SchedulerHostConfig                        | `scheduler-order`；抢占另见 `concurrent-context-rebase`                                                                                                                                     |
| Lane 与 Transition                          | requestUpdateLane / getNextLanes / markRootEntangled   | `transition-rebase`、`transition-suspense`、`concurrent-context-rebase`；所有过期/饥饿组合未穷尽                                                                                            |
| useEffect 注册、依赖与卸载                  | Hooks + passive commit traversal                       | `effect-only`、`memo-effect`、`effect-order`、`effect-tree-delete`                                                                                                                          |
| useInsertionEffect/layout/passive 顺序      | commitRootImpl / commitHookEffectList*                 | `effect-order`、`sync-effect-timing`、`suspense-layout-reconnect`                                                                                                                           |
| useMemo/useCallback 与闭包旧值              | mount/updateMemo、mount/updateCallback                 | `memo-callback-closure`，deps=[] 保留初始 n 的闭包                                                                                                                                          |
| eager bailout 与结果未变                    | dispatchSetState / bailoutHooks                        | `same-value-bailout`、`cancelled-state-effect`                                                                                                                                              |
| React.memo/PureComponent/childLanes         | updateMemoComponent / checkShouldComponentUpdate       | `memo-compare`、`pure-component`、`siblings-state`                                                                                                                                          |
| Context 穿透 memo 与中断栈                  | ReactFiberNewContext / unwindInterruptedWork           | `context`、`memo-context`、`concurrent-context-rebase`                                                                                                                                      |
| DOM ref / forwardRef / imperative handle    | markRef / commitAttachRef / useImperativeHandle        | `ref-update`、`render-phase-ref`、`forward-imperative-ref`、`ref-cleanup-error`                                                                                                             |
| Class 生命周期、snapshot、setState callback | ReactFiberClassComponent / CommitWork                  | `class-lifecycle`、`strict-class`、`pure-component`                                                                                                                                         |
| Error Boundary 的捕获范围                   | Throw / Unwind / captureCommitPhaseError               | `error-boundary`、`didcatch-only`、`error-boundary-update`、`layout-error-boundary`、`passive-error-boundary`、`deleted-tree-error`；事件与任意异步回调不由边界自动捕获                     |
| lazy / Suspense / Transition                | updateLazyComponent / updateSuspenseComponent / ping   | `suspense-lazy-function`、`suspense-lazy-class`、`lazy-wrappers`、`suspense-update`、`transition-suspense`、`lazy-without-boundary`、`sync-suspense-error`                                  |
| 合成事件、委托、捕获/冒泡                   | DOMPluginEventSystem / ReactDOMEventListener           | `event-order`、`handler-update`、`disabled-events`                                                                                                                                          |
| 受控与非受控表单                            | ReactDOMInput / inputValueTracking                     | `controlled-input`、`controlled-restore`、`uncontrolled-input`、`controlled-checkbox`、`controlled-select`、`controlled-select-options`、`controlled-radio-restore`、`select-default-reset` |
| React 18 Transition / DeferredValue         | useTransition / useDeferredValue                       | `transition-rebase`、`transition-suspense`、`deferred-value`                                                                                                                                |
| 外部 store 与防 tearing                     | useSyncExternalStore / StoreConsistency                | `external-store`、`external-store-consistency`                                                                                                                                              |
| DEV StrictMode 与 useId                     | mode / renderWithHooks / effect replay / mountId       | `strict-mode`、`strict-class`、`use-id`；生产模式对应关闭 DEV 双调用                                                                                                                        |

## 如何复验

仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm exec vite build --config scripts/vite/vite.config.mts
```

`pnpm test` 先重新构建，然后使用 Node 内置 test runner。`scripts/tests/core.test.cjs` 为每个场景与每种模式各启一个官方进程、一个本地进程；`probe.cjs` 安装 jsdom 环境，`scenarios.cjs` 保存扩展用例。

依赖调整保留了本会话安装时已清理的失效内网 tarball 地址，新增 jsdom 与两个官方基准别名及其传递依赖；没有批量升级原有工具链。

基准依赖固定为 `react-reference = npm:react@18.3.1`、`react-dom-reference = npm:react-dom@18.3.1`，只用于测试。runner 断言基准版本为 18.3.1，先验证官方满足用例预期，再断言本地 actual 等于官方 actual。生产比较通过 `NODE_ENV=production` 加载生产构建，StrictMode 预期随模式切换。

每轮将官方与本地的 expected/actual、模式、版本和诊断日志写入 `build/core-comparison-results.json`。单跑场景可以使用：

```bash
# 只重跑已有构建中的相关用例；修改源码后须先 pnpm build。
CORE_TEST_FILTER='effect|suspense' node --test scripts/tests/core.test.cjs
CORE_TEST_MODE=production node --test scripts/tests/core.test.cjs
```

筛选测试会覆盖该结果文件；需要全量证据时重新执行 `pnpm test`。

## 验收结果

| 检查                            | 实际结果                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                | 通过，TypeScript 无错误                                                                        |
| 修改与新增的全部 TS 文件 ESLint | 通过；最后一处 Class 修改单独再次通过                                                          |
| 本轮全部变更文件 Prettier       | 通过；pnpm-lock 格式也通过                                                                     |
| `pnpm test`                     | **134 / 134 通过，0 失败**：67 场景 × development/production，每项均运行官方与本地两个独立进程 |
| Rollup                          | 18 个 bundle 完成，4 个本地 npm 分发包就绪                                                     |
| fixtures Vite 构建              | 通过，78 个模块完成转换                                                                        |
| `git diff --check`              | 通过                                                                                           |

全量最终测试耗时约 118 秒。原始观察结果已核对 134 条记录，全部满足 official.actual = official.expected = local.actual。

本次运行证据保留在本机持久目录：

- [最终 TAP 日志](/Users/wangcheng/.codex/visualizations/2026/10/20/01a1570b-15d6-7fe2-b7bf-77e5fbc9a8ee/core-fix-final-tests-134.log)
- [官方与本地 expected/actual 原始结果](/Users/wangcheng/.codex/visualizations/2026/10/20/01a1570b-15d6-7fe2-b7bf-77e5fbc9a8ee/core-fix-comparison-results.json)

本轮修改提交在上述当前分支，未推送远端；官方 React 仓库没有修改。

## 保留的简化与验证限制

- 本轮（2026-10-20）范围是用户指定的客户端核心流程和原理学习，不实现 SSR/hydration/流式渲染、SuspenseList、Profiler timeline、完整 DEV 警告、legacy context/旧生命周期和所有 renderer。2026-10-24 已按 18.3.1 默认构建补上 `findDOMNode` 与 DevTools 注入（`injectIntoDevTools`、commit/unmount 回调）；`__PROFILE__` 的 timeline 和 hydration 仍然没有。
- Suspense 保留了常见挂起、fallback、ping/retry、Transition 保留旧内容与 layout 重新连接；官方所有超时节流启发式、嵌套隐藏树和重试优先级分支没有完整移植或穷尽验证。
- DOM 只覆盖常见 HTML 属性、样式、事件与表单。完整 SVG/namespace、selection/IME、跨文档 root、Portal 事件重映射、所有原生事件边界和旧浏览器兼容不在验收范围。表单类型切换和平台特殊输入行为也不能据这些用例推断全部正确。
- StrictMode 用例覆盖本轮列出的 render、初始化、effect 与 Class 主路径；不等于实现官方全部 StrictMode DEV 诊断。Hooks 调用顺序的开发期全部类型校验没有移植。
- 测试在 jsdom 中观察 DOM、回调与提交顺序；它不模拟真实浏览器绘制，因此“绘制前后”由官方源码时序对照解释，不能将 jsdom 结果当作浏览器 paint 性能验收。
- 未运行官方完整测试套件，也未证明所有 Lane 交错、异常/卸载组合、嵌套更新极限等分支。后续学习遇到本表未覆盖的特殊行为，仍应对照官方 v18.3.1。React 19 async Action、useDeferredValue initialValue 不属于 React 18 的缺失能力。

## 官方源码对应

- [Hooks](https://github.com/facebook/react/blob/v18.3.1/packages/react-reconciler/src/ReactFiberHooks.new.js)：render-phase queue、bailoutHooks、baseQueue、Strict render、StoreConsistency。
- [WorkLoop](https://github.com/facebook/react/blob/v18.3.1/packages/react-reconciler/src/ReactFiberWorkLoop.new.js)：中断恢复、根挂起、commit、passive 与离散同步刷新。
- [BeginWork](https://github.com/facebook/react/blob/v18.3.1/packages/react-reconciler/src/ReactFiberBeginWork.new.js)、[CommitWork](https://github.com/facebook/react/blob/v18.3.1/packages/react-reconciler/src/ReactFiberCommitWork.new.js)：fallback 插入、错误恢复、各类 Effect 与删除树清理。
- [ClassUpdateQueue](https://github.com/facebook/react/blob/v18.3.1/packages/react-reconciler/src/ReactFiberClassUpdateQueue.new.js)、[Lane](https://github.com/facebook/react/blob/v18.3.1/packages/react-reconciler/src/ReactFiberLane.new.js)、[Throw](https://github.com/facebook/react/blob/v18.3.1/packages/react-reconciler/src/ReactFiberThrow.new.js)：捕获隔离、纠缠与同步挂起错误。
- [ReactDOMComponent](https://github.com/facebook/react/blob/v18.3.1/packages/react-dom/src/client/ReactDOMComponent.js)、[Input](https://github.com/facebook/react/blob/v18.3.1/packages/react-dom/src/client/ReactDOMInput.js)、[inputValueTracking](https://github.com/facebook/react/blob/v18.3.1/packages/react-dom/src/client/inputValueTracking.js)、[ChangeEventPlugin](https://github.com/facebook/react/blob/v18.3.1/packages/react-dom/src/events/plugins/ChangeEventPlugin.js)：DOM 属性与表单事件。
