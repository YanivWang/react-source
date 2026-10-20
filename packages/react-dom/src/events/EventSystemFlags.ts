/**
 * @file 事件系统标记位
 * @description 对照官方 packages/react-dom/src/events/EventSystemFlags.js。
 * 官方还有 IS_EVENT_HANDLE_NON_MANAGED_NODE/IS_NON_DELEGATED/IS_PASSIVE/IS_LEGACY_FB_SUPPORT_MODE
 * 等位，全部服务于本项目明确跳过的特性（createEventHandle API、非委托事件、legacy FB 兼容），
 * 只保留 IS_CAPTURE_PHASE（数值对齐官方第 3 位）区分捕获/冒泡阶段。
 */

export type EventSystemFlags = number;

export const IS_CAPTURE_PHASE: EventSystemFlags = 1 << 2;
