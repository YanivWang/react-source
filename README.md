# react-source

React 18 源码的 TypeScript 学习实现。当前客户端核心流程以官方 [v18.3.1](https://github.com/facebook/react/tree/v18.3.1) 为对照基准，保留主要函数名与数据结构，便于追踪调用链。外围功能和部分兼容分支有意简化，具体修复、验证范围与限制见 [核心验证记录](./docs/verification-core-react18.3.1.md)。

## 技术栈

- TypeScript
- pnpm workspace（monorepo）
- ESLint 10 + Prettier
- Rollup（构建）+ Turbo（任务编排）
- Husky + lint-staged + commitlint（提交检查）

## 目录结构

参照官方 `packages/` 划分，按渲染链路推进顺序逐步搭建：

```
react-source/
├── packages/
│   ├── shared/                # 跨包共享的工具函数、常量、类型
│   │   ├── CheckStringCoercion.ts      # DEV 模式下的字符串强制转换检查（key 等）
│   │   ├── getComponentNameFromType.ts # 从组件类型提取显示名称（用于警告信息）
│   │   ├── globals.d.ts                # 全局类型声明（__DEV__ 等构建时常量）
│   │   ├── hasOwnProperty.ts           # Object.prototype.hasOwnProperty 安全引用
│   │   ├── objectIs.ts                 # Object.is polyfill（兼容旧环境）
│   │   ├── ReactSymbols.ts             # React 内部 Symbol 常量（ELEMENT/FRAGMENT/PORTAL/PROVIDER/CONTEXT/FORWARD_REF/SUSPENSE/MEMO/LAZY 等）
│   │   └── ReactTypes.ts               # React 核心类型定义（Key/Ref/Props/ElementType）
│   │
│   ├── react/                 # React 核心 API（createElement、hooks 入口等）
│   │   └── src/
│   │       ├── jsx/
│   │       │   ├── ReactJSX.ts         # JSX automatic runtime 统一导出（jsx/jsxs/jsxDEV）
│   │       │   └── ReactJSXElement.ts  # JSX automatic runtime 的 ReactElement 工厂实现
│   │       ├── index.ts                # React 主入口（导出 createElement 等经典 API）
│   │       ├── jsx-dev-runtime.ts      # babel automatic runtime 开发环境入口
│   │       ├── jsx-runtime.ts          # babel automatic runtime 生产环境入口
│   │       ├── ReactCurrentOwner.ts    # 记录当前正在构建的组件（Fiber owner）
│   │       ├── ReactElement.ts         # ReactElement 工厂和经典 createElement 实现
│   │       └── ReactSharedInternals.ts # React 内部共享状态（聚合 CurrentOwner 等）
│   │
│   ├── react-reconciler/      # 协调器（Fiber、diff、commit、Lane、可中断 workLoop）
│   │   ├── index.ts                    # 主入口（转出 createContainer/updateContainer 等）
│   │   ├── constants.ts                # 常量入口（转出 LegacyRoot/ConcurrentRoot）
│   │   ├── reflection.ts               # Fiber 树反射入口（findCurrentHostFiber 等）
│   │   └── src/
│   │       ├── ReactFiber.ts           # Fiber 节点数据结构 + 双缓存 createWorkInProgress
│   │       ├── ReactChildFiber.ts      # ChildFiber 协调器（单/多节点 diff）
│   │       ├── ReactFiberBeginWork.ts  # beginWork（递阶段，按 tag 分发）
│   │       ├── ReactFiberCompleteWork.ts # completeWork（归阶段，创建 DOM + bubbleProperties）
│   │       ├── ReactFiberCommitWork.ts # commit mutation（插入/更新/删除）
│   │       ├── ReactFiberWorkLoop.ts   # 调度入口 + 可中断 workLoop（sync + concurrent）+ commit 总控
│   │       ├── ReactFiberClassUpdateQueue.ts # 更新队列（Update 循环链表，按 lane 消费）
│   │       ├── ReactFiberConfig.ts     # HostConfig 接口（构建时 fork 注入）
│   │       ├── ReactFiberLane.ts       # 完整 Lane 优先级模型（30 条 lane 位表）
│   │       ├── ReactFiberRoot.ts       # FiberRootNode / createFiberRoot
│   │       ├── ReactFiberFlags.ts      # 副作用标记位掩码
│   │       ├── ReactFiberReconciler.ts # 对外入口（createContainer/updateContainer）
│   │       ├── ReactFiberTreeReflection.ts # Fiber 树反射（getNearestMountedFiber/findCurrentHostFiber）
│   │       ├── ReactEventPriorities.ts # 事件优先级 → lane 映射
│   │       └── ...                     # WorkTags/RootTags/TypeOfMode 等常量
│   │
│   ├── react-dom/             # DOM 渲染器（简版 createRoot 已搭建）
│   │   ├── index.ts / client.ts        # npm 分发入口（转出 ReactDOMClient）
│   │   └── src/client/
│   │       ├── ReactDOMClient.ts       # 转出层（对照官方，还会挂 findDOMNode/DevTools 等）
│   │       └── ReactDOMRoot.ts         # createRoot 工厂函数 + ReactDOMRoot（render 包装 FiberRootNode）
│   │
│   ├── react-dom-bindings/    # DOM 平台绑定（供 react-dom 等渲染器共享，对齐官方 react-dom-bindings）
│   │   └── src/client/
│   │       └── ReactDOMHostConfig.ts   # DOM HostConfig 实现（createInstance/appendChild 等）
│   │
│   └── scheduler/             # 调度器（时间切片、优先级，对照官方完整结构已搭建）
│       ├── index.ts                    # 主入口（转出 Scheduler）
│       └── src/
│           ├── Scheduler.ts            # unstable_scheduleCallback/shouldYield 等 + taskQueue/timerQueue
│           ├── SchedulerMinHeap.ts     # 最小堆（按 sortIndex 排序）
│           ├── SchedulerPriorities.ts  # 5 档优先级常量
│           ├── SchedulerHostConfig.ts  # 占位接口（构建时 fork 注入）
│           └── forks/SchedulerHostConfig.default.ts # MessageChannel 宏任务 + 5ms 时间片实现
│
├── scripts/                   # 构建脚本
│   ├── rollup/
│   │   ├── build.js           # Rollup 打包入口（含 HostConfig fork 注入）
│   │   ├── bundles.js         # bundle 描述（react/reconciler/react-dom/scheduler 等打包配置）
│   │   └── packaging.js       # 打包辅助
│   └── vite/
│       └── vite.config.mts    # fixtures 源码调试配置（alias 到 packages 源码 + HostConfig fork）
│
├── docs/                      # 项目文档
│   ├── roadmap.md             # 实现路线图（按 Phase 划分的已完成/待实现清单）
│   └── react-core.md          # React 核心原理笔记（分层架构/Fiber/Lane/Diff/Hooks 等 + Mermaid 流程图）
│
├── fixtures/                  # 源码调试演示页（pnpm dev）
│   ├── main.tsx               # 入口（JSX 验证 + react-dom 驱动 reconciler 演示）
│   ├── index.html
│   ├── jsx/                   # JSX Demo 组件
│   ├── dom/                   # react-dom createRoot 渲染演示
│   ├── reconciler/            # reconciler 同步主链路演示（mount/update/diff）
│   └── scheduler/             # scheduler 时间切片 + 并发渲染 + flushSync 抢占演示
│
├── .husky/                    # Git hooks（pre-commit、commit-msg）
├── eslint.config.js           # ESLint 配置
├── .prettierrc.js             # Prettier 配置
├── tsconfig.json              # TypeScript 配置
├── turbo.json                 # Turbo 任务编排配置
└── pnpm-workspace.yaml        # pnpm workspace 配置
```

### 重要文件说明

**packages/react/src/ReactElement.ts**  
React 元素的核心工厂函数，包含 `createElement`（经典运行时入口）和 `jsx/jsxDEV`（此文件版本不对外导出，是历史遗留拷贝）。

**packages/react/src/jsx/ReactJSXElement.ts**  
babel automatic runtime 实际使用的 JSX 工厂实现，通过 `ReactSharedInternals` 获取 owner 以支持跨包单例共享。

**packages/shared/ReactSymbols.ts**  
使用 `Symbol.for` 定义 React 内部标识符（`REACT_ELEMENT_TYPE`、`REACT_FRAGMENT_TYPE`、`REACT_PORTAL_TYPE`、`REACT_CONTEXT_TYPE`、`REACT_SUSPENSE_TYPE`、`REACT_MEMO_TYPE`、`REACT_LAZY_TYPE` 等，按后续 Phase 用得到的子集逐步补充），保证多份 React 实例间能互认。

**packages/shared/globals.d.ts**  
声明构建时注入的全局常量（`__DEV__`），实际值由 Rollup 的 `@rollup/plugin-replace` 在打包时替换。

**packages/react-reconciler/src/ReactFiberWorkLoop.ts**  
调度与渲染总控：`scheduleUpdateOnFiber` → `ensureRootIsScheduled`（按 lane 选同步微任务或 `scheduler.scheduleCallback` 分片）→ `workLoopSync`/`workLoopConcurrent` → `commitRoot`；`flushSync` 走同步队列。

**packages/react-reconciler/src/ReactFiberConfig.ts**  
平台无关的宿主环境接口占位模块（对齐官方 `ReactFiberConfig.js` / `forks/ReactFiberConfig.custom.js`），构建时被 react-dom-bindings 的 `ReactDOMHostConfig` fork 替换。

**packages/react-dom-bindings/src/client/ReactDOMHostConfig.ts**  
DOM 平台的 HostConfig 实现（仓库沿用较新目录命名；React 18.3.1 对应实现实际位于 `packages/react-dom/src`）：`createInstance`/`createTextInstance`、`appendChild`/`insertBefore`/`removeChild`、`prepareUpdate`/`commitUpdate` 等。

**packages/scheduler/src/Scheduler.ts**  
调度器主循环：`unstable_scheduleCallback`/`unstable_shouldYield`/`unstable_now` 等导出，taskQueue/timerQueue 双最小堆管理任务过期时间。

## 常用命令

```bash
pnpm install

# fixtures 源码调试（浏览器查看渲染效果）
pnpm dev

# lint
pnpm lint
pnpm lint:fix

# 格式化
pnpm format
pnpm format:check

# 类型检查
npx tsc --noEmit

# 官方 18.3.1 与本地实现逐场景对比（development + production）
pnpm test

# 构建（输出 cjs / iife 产物）
pnpm build
```

## 文档

- [核心验证记录](./docs/verification-core-react18.3.1.md) — 当前分支修复、官方对照用例、面试主题入口和未覆盖边界

- [docs/roadmap.md](./docs/roadmap.md) — 实现路线图，按 React 18 渲染主链路自然顺序划分 Phase，记录已完成/待实现清单
- [docs/react-core.md](./docs/react-core.md) — React 核心原理笔记：分层架构、Fiber/Lane/UpdateQueue 数据结构、beginWork/completeWork/commit/Diff/调度接入等核心流程，每个知识点配 Mermaid 流程图

## 提交规范

commit message 使用中文描述，遵循 [Conventional Commits](https://www.conventionalcommits.org/) 格式（`type: 描述`），由 commitlint 校验。

## 开发约定

详见 [CLAUDE.md](./CLAUDE.md)。
