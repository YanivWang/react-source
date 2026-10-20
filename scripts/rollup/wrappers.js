"use strict";

// 对照官方 scripts/rollup/wrappers.js：standalone react-reconciler 产物的消费方式和其他包不同——
// 第三方渲染器用 `require('react-reconciler')(hostConfig)` 把 host config 作为参数传入，而不是
// 像 react/react-dom 那样直接 `require('xxx')` 拿到现成的 API。所以打包时要把整段产物包进一个
// `$$$reconciler` 顶层函数，形参 `$$$config` 就是渲染器传入的 host config，对应
// forks/ReactFiberHostConfig.custom.ts 里引用的那个「看起来像全局变量」的 `$$$config`。
//
// 官方 wrappers.js 还覆盖 FB_WWW/RN/PROFILING 等本项目未搭建的发布通道，这里只还原
// NODE_DEV/NODE_PROD 两种（对应 react-reconciler bundle 在 bundles.js 里声明的 bundleTypes）。
const USE_STRICT_HEADER_REGEX = /'use strict';\n+/;

function wrapWithReconcilerModule(source, isDev) {
  // rollup 的 cjs 输出会在文件头生成一份 'use strict'，包裹进函数体前先摘掉，
  // 避免出现两份指令序言（对照官方同名处理）
  const body = source.replace(USE_STRICT_HEADER_REGEX, "");

  if (isDev) {
    return `'use strict';

if (process.env.NODE_ENV !== "production") {
  module.exports = function $$$reconciler($$$config) {
    var exports = {};
${body}
    return exports;
  };
  module.exports.default = module.exports;
  Object.defineProperty(module.exports, "__esModule", { value: true });
}
`;
  }

  return `module.exports = function $$$reconciler($$$config) {
    var exports = {};
${body}
    return exports;
};
module.exports.default = module.exports;
Object.defineProperty(module.exports, "__esModule", { value: true });
`;
}

module.exports = { wrapWithReconcilerModule };
