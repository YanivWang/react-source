/**
 * @file React 内部 Symbol 常量
 * @description 定义 React 元素类型标识符，使用 Symbol.for 保证多实例互认
 */

// 对照官方 packages/shared/ReactSymbols.js：用 Symbol.for 而非普通 Symbol，
// 保证同一份 React 出现多份实例（如被打包两次）时依然能通过该值互认。
// 官方文件是一份完整的 REACT_*_TYPE 常量表，这里只列出后续 Phase 明确会用到的子集
// （STRICT_MODE/PROFILER/SCOPE/OFFSCREEN/LEGACY_HIDDEN/CACHE 等未列入），等对应功能
// 落地时再补，与 ReactWorkTags 只列主链路 tag 的取舍保持一致。

/**
 * ReactElement 的类型标识符
 * 用于 isValidElement 判断对象是否为 React 元素
 */
export const REACT_ELEMENT_TYPE = Symbol.for("react.element");

/**
 * Portal 的类型标识符
 * 用于识别 createPortal 创建的元素（Phase 9）
 */
export const REACT_PORTAL_TYPE = Symbol.for("react.portal");

/**
 * Fragment 的类型标识符
 * 用于识别 <React.Fragment> 或 <> 语法
 */
export const REACT_FRAGMENT_TYPE = Symbol.for("react.fragment");

/**
 * Context Provider 的类型标识符
 * 用于识别 <Context.Provider> 元素（Phase 7）
 */
export const REACT_PROVIDER_TYPE = Symbol.for("react.provider");

/**
 * Context 对象的类型标识符
 * 用于 createContext 返回的 Context 对象（Phase 7）
 */
export const REACT_CONTEXT_TYPE = Symbol.for("react.context");

/**
 * forwardRef 的类型标识符
 * 用于识别 forwardRef 包装的组件（Phase 9）
 */
export const REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref");

/**
 * Suspense 的类型标识符
 * 用于识别 <Suspense> 边界（Phase 9）
 */
export const REACT_SUSPENSE_TYPE = Symbol.for("react.suspense");

/**
 * memo 的类型标识符
 * 用于识别 memo 包装的组件（Phase 9）
 */
export const REACT_MEMO_TYPE = Symbol.for("react.memo");

/**
 * Offscreen 的类型标识符
 * Suspense 内部用它包裹 primary/fallback 子树，控制隐藏/显示（Phase 9.1）
 */
export const REACT_OFFSCREEN_TYPE = Symbol.for("react.offscreen");

/**
 * lazy 的类型标识符
 * 用于识别 lazy() 懒加载组件（Phase 9）
 */
export const REACT_LAZY_TYPE = Symbol.for("react.lazy");

export const REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode");
