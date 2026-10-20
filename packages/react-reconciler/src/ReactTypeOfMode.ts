/**
 * @file Fiber 模式标记
 * @description 描述 Fiber（及其子树）所处的渲染模式，用位掩码表示，可同时具备多种模式
 */

// 对照官方 packages/react-reconciler/src/ReactTypeOfMode.js：ConcurrentMode 是 createRoot 的
// 根 fiber 会打上的标记，beginWork/commit 里靠它判断是否走并发路径。当前 Phase 2/3 只有同步
// 渲染，但 createHostRootFiber 需要 ConcurrentMode 这个值来区分 createRoot/render 的根，
// 故先补上。StrictLegacyMode/ProfileMode 等留到对应功能落地时再补。

export type TypeOfMode = number;

export const NoMode: TypeOfMode = 0b000000;
export const ConcurrentMode: TypeOfMode = 0b000001;

export const StrictLegacyMode: TypeOfMode = 0b001000;
export const StrictEffectsMode: TypeOfMode = 0b010000;
