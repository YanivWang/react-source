/**
 * @file react-dom 主入口
 * @description rollup 打包入口：转出 ReactDOMClient 的 createRoot。
 * 对照官方 packages/react-dom/index.js：官方这一层是 re-export './src/client/ReactDOMClient'，
 * 主入口只暴露 createRoot/hydrateRoot 等客户端 API。
 */

export { createRoot } from "./src/client/ReactDOMClient";
export { createPortal } from "react-reconciler/src/ReactPortal";

export { flushSync } from "react-reconciler/src/ReactFiberWorkLoop";
