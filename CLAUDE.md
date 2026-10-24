# react-source

## 项目定位

个人学习/实现项目，当前核心修复以官方 **React v18.3.1** 为固定基准，保留可对照的架构、函数名和数据结构。外围与兼容分支可以简化；不能将已验证的核心场景外推为完整官方移植。验收范围见 [核心验证记录](./docs/verification-core-react18.3.1.md)。

代码组织方式尽量贴近官方仓库 [facebook/react](https://github.com/facebook/react)，方便随时对照源码。

## 技术栈与目录结构

- 语言：TypeScript
- 包管理：pnpm workspace（monorepo）
- 目录结构参照官方 `packages/` 划分，按需逐步搭建，典型包括：
  - `packages/react` — React 核心 API（createElement、Component、hooks 入口等）
  - `packages/react-dom` — DOM 渲染器
  - `packages/react-reconciler` — 协调器（Fiber、diff、commit）
  - `packages/scheduler` — 调度器（时间切片、优先级）
  - `packages/shared` — 跨包共享的工具函数、常量、类型

> 官方对照使用 `/Users/wangcheng/Documents/workSpace/frontEnd/referenceProjects/repos/react/react18` 的 `codex/react-18.3.1`（v18.3.1，`f1338f8080`）。`repos/react/react` 已切回默认分支 `main`，不要再拿它当 18.3.1 快照。DOM 与 HostConfig 在 `packages/react-dom/src`。最新修复验收见 [独立复审修复报告](docs/reviews/react18.3.1-independent-audit/repair-report.md)。

## 开发约定

- **对照优先**：实现任何功能前，先看官方源码对应实现，理解其设计意图，再动手还原，不凭记忆或直觉编造实现。
- **命名对齐**：变量名、函数名、文件名尽量与官方源码保持一致，方便对照和检索。
- **注释**：只在还原关键算法/设计取舍时写注释说明"为什么官方这么做"，不写"这段代码做了什么"的样板注释。
- **不做官方没有的抽象**：不引入官方源码中不存在的分层、封装或配置项，保持实现的可对照性。
- **渐进式搭建**：按 React 渲染链路的自然顺序推进（如 createElement → Fiber 树构建 → 调度 → commit → hooks），不一次性铺全部模块骨架。
- **commit message 用中文**：遵循 Conventional Commits 格式（`type: 描述`），描述部分用中文写，由 commitlint + husky 的 `commit-msg` hook 校验。

## 效率约定（省 token / 省时间）

写代码前的阅读要克制：**只读与当前改动直接相关的关键接口文件**（签名、导出、调用约定），读够就动手，不整包通读。像"新增 fixtures 调试案例"这类增量任务，默认走轻量路径：

1. 读少量关键文件确认接口后直接实现；
2. 用 `npx tsc --noEmit` + `npx vite build` 做一次构建验证即可；
3. 让用户 `pnpm dev` 在浏览器实际查看效果，**不要**默认搭 jsdom 无头测试 + 官方 React 对照那套重验证（除非用户明确要）。

"对照优先"是针对核心算法实现而言，不是要求每个小改动都反复对照验证；避免把验证手段选得过重造成返工。

## 当前状态

monorepo 骨架、reconciler 主链路（同步 + 并发）、react-dom 简版与 scheduler 已搭建：

- 根目录：`package.json`、`pnpm-workspace.yaml`、`tsconfig.json`、`eslint.config.js`、`turbo.json`
- 工具链：ESLint + Prettier（lint/格式化）、Husky + lint-staged + commitlint（提交检查）、Rollup（构建）、Vite（fixtures 源码调试）
- `packages/shared`：跨包共享工具/常量/类型（objectIs、hasOwnProperty、ReactSymbols、ReactTypes 等）
- `packages/react`：JSX 运行时（createElement/jsx/jsxDEV + jsx-runtime/jsx-dev-runtime 入口）、`Component`/`PureComponent` 基类（`ReactBaseClasses.ts`），构建产出 cjs（dev+prod）和 iife 三种格式
- `packages/react-reconciler`：Fiber 主链路——Fiber 数据结构、更新队列、beginWork/completeWork、commit mutation、单/多节点 diff、Fragment、Fiber 树反射（`reflection.ts` 转出 `findCurrentHostFiber`）、**客户端 Lane 模型 + 可中断 workLoop**（`ensureRootIsScheduled`/`workLoopConcurrent`/`flushSync`）、HostConfig 接口（**构建时 fork 注入**，对齐官方 forks.js）、**Hooks**（useState/useReducer/useRef/useMemo/useCallback/useEffect/useLayoutEffect/useTransition/useDeferredValue/useSyncExternalStore/useContext）、**Context API**（`ReactFiberStack.ts` 通用栈 + `ReactFiberNewContext.ts` 的 pushProvider/popProvider/readContext/propagateContextChange）、**Class 组件生命周期**（`ReactFiberClassComponent.ts` 的 constructClassInstance/mountClassInstance/updateClassInstance，commit 补 before-mutation 子阶段跑 getSnapshotBeforeUpdate）
- `packages/react-dom`：`createRoot(container).render(element)` 渲染到真实 DOM（DefaultLane 并发异步提交）；`findDOMNode` 与 DevTools 注入在 `ReactDOMClient.ts`（提交时 `onCommitFiberRoot`，卸载时 `onCommitFiberUnmount`）。HostConfig 由 build.js 的 fork 插件 / vite alias 把 `ReactFiberHostConfig` 替换为 `packages/react-dom` 的 `ReactDOMHostConfig`；npm 分发文件夹 + bundles.js 注册（cjs dev/prod）。边界：不含 hydrate / legacy render；已包含常用合成事件和受控表单主链。DevTools 按 18.3.1 默认构建，不含 `__PROFILE__` 的 timeline
- `packages/scheduler`：`forks/Scheduler.ts` 的任务/延时双最小堆、callback 清空与 continuation、宿主循环和 5ms 时间片；宿主优先使用 setImmediate，其次复用 MessageChannel
- 常用命令：`pnpm dev`（fixtures 调试）、`pnpm lint` / `pnpm lint:fix`、`pnpm format` / `pnpm format:check`、`pnpm build`、`pnpm typecheck`、`pnpm test`（官方 18.3.1 dev/prod 对比）

`hooks` / `事件系统` / `context` / `class 生命周期` / Suspense / 错误边界 / `memo` / `lazy` / `forwardRef` / Portal 已落地。hydrate、legacy `ReactDOM.render`、noop-renderer 仍搁置。详细进度见 [docs/roadmap.md](./docs/roadmap.md)；React 核心原理（分层架构、Fiber/Lane/Diff/Hooks 等知识点 + Mermaid 流程图）见 [docs/react-core.md](./docs/react-core.md)。
