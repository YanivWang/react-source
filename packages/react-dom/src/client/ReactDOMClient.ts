/**
 * @file react-dom 客户端转出层
 * @description 对照官方 src/client/ReactDOM.js：转出 createRoot，并挂上 findDOMNode
 * 与 DevTools 注入。hydration 入口按项目范围不开放。
 */

import getComponentNameFromType from "shared/getComponentNameFromType";
import ReactCurrentOwner from "../../../react/src/ReactCurrentOwner";
import {
  findHostInstance,
  findHostInstanceWithWarning,
  injectIntoDevTools,
} from "react-reconciler/src/ReactFiberReconciler";
import { getClosestInstanceFromNode } from "./ReactDOMComponentTree";

export { createRoot } from "./ReactDOMRoot";

const ELEMENT_NODE = 1;
let didWarnAboutFindDOMNode = false;

// 对照官方 ReactDOMLegacy.js 的 findDOMNode。
export function findDOMNode(componentOrElement: any): any {
  if (__DEV__) {
    if (!didWarnAboutFindDOMNode) {
      didWarnAboutFindDOMNode = true;
      console.error(
        "findDOMNode is deprecated and will be removed in the next major " +
          "release. Instead, add a ref directly to the element you want " +
          "to reference. Learn more about using refs safely here: " +
          "https://reactjs.org/link/strict-mode-find-node",
      );
    }
    const owner = ReactCurrentOwner.current;
    if (owner !== null && owner.stateNode !== null) {
      const warnedAboutRefsInRender = owner.stateNode._warnedAboutRefsInRender;
      if (!warnedAboutRefsInRender) {
        console.error(
          "%s is accessing findDOMNode inside its render(). " +
            "render() should be a pure function of props and state. It should " +
            "never access something that requires stale data from the previous " +
            "render, such as refs. Move this logic to componentDidMount and " +
            "componentDidUpdate instead.",
          getComponentNameFromType(owner.type) || "A component",
        );
      }
      owner.stateNode._warnedAboutRefsInRender = true;
    }
  }
  if (componentOrElement == null) {
    return null;
  }
  if (componentOrElement.nodeType === ELEMENT_NODE) {
    return componentOrElement;
  }
  if (__DEV__) {
    return findHostInstanceWithWarning(componentOrElement, "findDOMNode");
  }
  return findHostInstance(componentOrElement);
}

const foundDevTools = injectIntoDevTools({
  findFiberByHostInstance: getClosestInstanceFromNode,
  bundleType: __DEV__ ? 1 : 0,
  version: "18.3.1",
  rendererPackageName: "react-dom",
});

if (
  __DEV__ &&
  !foundDevTools &&
  typeof window !== "undefined" &&
  window.top === window.self
) {
  const agent = window.navigator?.userAgent ?? "";
  if (
    (agent.indexOf("Chrome") > -1 && agent.indexOf("Edge") === -1) ||
    agent.indexOf("Firefox") > -1
  ) {
    const protocol = window.location.protocol;
    if (/^(https?|file):$/.test(protocol)) {
      console.info(
        "%cDownload the React DevTools " +
          "for a better development experience: " +
          "https://reactjs.org/link/react-devtools" +
          (protocol === "file:"
            ? "\nYou might need to use a local HTTP server (instead of file://): " +
              "https://reactjs.org/link/react-devtools-faq"
            : ""),
        "font-weight:bold",
      );
    }
  }
}
