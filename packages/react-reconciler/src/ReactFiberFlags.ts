/**
 * @file Fiber 副作用标记
 * @description 标记 Fiber 在 commit 阶段需要执行的 DOM 操作，用位掩码表示，可组合多个标记
 */

// 对照官方 packages/react-reconciler/src/ReactFiberFlags.js（v18.3.1）：数值逐位对齐，
// 保留注释里的 1/0 对齐格式，方便与官方逐行对照。主链路（挂载/更新）用得到 Placement/Update/
// ChildDeletion/ContentReset/Ref/PerformedWork/Incomplete/DidCapture；Effect/Strict 静态位也与官方对齐。

export type Flags = number;

// 这两个值不要改，DevTools 依赖它们
export const NoFlags = /*                      */ 0b00000000000000000000000000;
export const PerformedWork = /*                */ 0b00000000000000000000000001;

export const Placement = /*                    */ 0b00000000000000000000000010;
export const Update = /*                       */ 0b00000000000000000000000100;
export const Deletion = /*                     */ 0b00000000000000000000001000;
export const ChildDeletion = /*                */ 0b00000000000000000000010000;
export const ContentReset = /*                 */ 0b00000000000000000000100000;
export const Callback = /*                     */ 0b00000000000000000001000000;
export const DidCapture = /*                   */ 0b00000000000000000010000000;
export const Ref = /*                          */ 0b00000000000000001000000000;
export const Snapshot = /*                     */ 0b00000000000000010000000000;
export const Passive = /*                      */ 0b00000000000000100000000000;

// Suspense/Offscreen 切换隐藏/显示态时打的标记（Phase 9.1），commit 阶段据此调用
// hideInstance/unhideInstance
export const Visibility = /*                   */ 0b00000000000010000000000000;
export const StoreConsistency = /*             */ 0b00000000000100000000000000;

export const LifecycleEffectMask =
  Passive | Update | Callback | Ref | Snapshot | StoreConsistency;

// 所有 commit 阶段 flag 的并集（生命周期只存在于单次 commit）
export const HostEffectMask = /*               */ 0b00000000000111111111111111;

// 这几个不是真正的副作用，但仍复用 flags 这个字段
export const Incomplete = /*                   */ 0b00000000001000000000000000;
export const ShouldCapture = /*                */ 0b00000000010000000000000000;

// 静态标记跟随 Fiber 生命周期；bailout 仍保留它们，但不重放上次 commit 的动态标记。
export const RefStatic = /*                    */ 0b00001000000000000000000000;
export const LayoutStatic = /*                 */ 0b00010000000000000000000000;
export const PassiveStatic = /*                */ 0b00100000000000000000000000;

// commit 各阶段用来跳过不含对应 effect 子树的掩码
export const MutationMask =
  Placement | Update | ChildDeletion | ContentReset | Ref | Visibility;

// 对照官方 LayoutMask/PassiveMask：commit 的 layout/passive 子阶段据此跳过不含对应
// effect 的子树。Callback 并入 LayoutMask——setState/forceUpdate 的回调也在 layout 子阶段
// 执行（即使组件没有 componentDidMount/Update 生命周期，只要传了 callback 也要跑）。Ref 并入
// LayoutMask——commitAttachRef（Phase 9.2 forwardRef 落地）同样放在 layout 子阶段执行。
export const LayoutMask = Update | Callback | Ref | Visibility;
export const PassiveMask = Passive | ChildDeletion;
// before-mutation 子阶段（getSnapshotBeforeUpdate）用到的掩码，Phase 8 补上
export const BeforeMutationMask = Update | Snapshot;

// 在 clone（createWorkInProgress）时不会被重置的 flag 集合
export const StaticMask = LayoutStatic | PassiveStatic | RefStatic;

export const MountLayoutDev = 0b01000000000000000000000000;
export const MountPassiveDev = 0b10000000000000000000000000;
