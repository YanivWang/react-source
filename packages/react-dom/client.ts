/**
 * @file react-dom/client 入口
 * @description 源码调试入口（vite/tsc 用），与主入口一致转出 createRoot 和 findDOMNode。
 * hydrateRoot 按项目范围不开放。
 */

export { createRoot, findDOMNode } from "./src/client/ReactDOMClient";
