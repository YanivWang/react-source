"use strict";

const path = require("path");
const rollup = require("rollup");
const typescript = require("@rollup/plugin-typescript");
const resolve = require("@rollup/plugin-node-resolve").default;
const commonjs = require("@rollup/plugin-commonjs");
const replace = require("@rollup/plugin-replace");
const terser = require("@rollup/plugin-terser");

const { bundles, bundleTypes } = require("./bundles");
const { prepareNpmPackages } = require("./packaging");
const { wrapWithReconcilerModule } = require("./wrappers");

const { NODE_DEV, NODE_PROD, UMD_DEV, UMD_PROD } = bundleTypes;

// 对照官方 scripts/shared/inlinedHostConfigs.js：每个渲染器 entry 对应一个 shortName，
// forks.js 据此把 ReactFiberHostConfig 占位模块替换成 forks/ReactFiberHostConfig.<shortName>。
// 本项目只有 react-dom 这一个真实渲染器 + standalone react-reconciler 自身（发布给
// 第三方渲染器用，fork 到 'custom'，运行时通过 $$$config 参数注入，见 forks/ReactFiberHostConfig.custom.ts
// 和 wrappers.js 的 wrapWithReconcilerModule）。reflection/constants 两个 reconciler
// 子入口不会触达 ReactFiberHostConfig，故落入 null，resolveId 直接放行交回默认解析。
function getHostConfigShortName(bundle) {
  if (bundle.packageName === "react-dom") {
    return "dom";
  }
  if (bundle.name === "react-reconciler") {
    return "custom";
  }
  return null;
}

function isProduction(type) {
  return type === NODE_PROD || type === UMD_PROD;
}

function isUMD(type) {
  return type === UMD_DEV || type === UMD_PROD;
}

// 对照官方 build.js 的 getFormat：UMD_* 对应 iife（<script> 标签直接引入、挂全局变量）
function getFormat(type) {
  return isUMD(type) ? "iife" : "cjs";
}

// 对照官方发布产物目录：NODE_* 落 cjs/，UMD_* 落 umd/
function getOutputDir(type) {
  return isUMD(type) ? "umd" : "cjs";
}

// 对照官方产物命名：目录已经区分了 cjs/esm/umd，文件名里不再重复格式后缀，只区分 development/production.min
function getFilename(bundle, type) {
  const suffix = isProduction(type) ? "production.min" : "development";
  return `${bundle.name}.${suffix}.js`;
}

// 对照官方 scripts/rollup/build.js 的 handleRollupWarning：reconciler 内部
// ReactFiberClassUpdateQueue ↔ ReactFiberWorkLoop ↔ ReactFiberBeginWork 存在循环引用
// （与官方源码一致）。ES 模块下这些 import 都是运行时才调用的函数引用，不存在模块
// 初始化期访问导致的 TDZ 问题，因此与官方一样直接忽略该告警，其余告警照常打印。
function handleRollupWarning(warning) {
  if (warning.code === "CIRCULAR_DEPENDENCY") {
    // Ignored
  } else if (typeof warning.code === "string") {
    console.warn(warning.message);
  }
}

async function buildBundle(bundle, type) {
  // 对照官方：__DEV__ 是构建时常量，dev 产物里为 true（保留校验/警告代码），
  // prod 产物里替换成 false 后交给 terser 做 dead code elimination 删掉这些分支。
  const isDev = !isProduction(type);

  const inputOptions = {
    input: path.resolve(process.cwd(), bundle.entry),
    external: bundle.externals || [],
    onwarn: handleRollupWarning,
    plugins: [
      // 对照官方 scripts/rollup/forks.js：把 reconciler 的 ReactFiberHostConfig 占位模块
      // fork 替换成 forks/ReactFiberHostConfig.<shortName>。官方按 entry 在
      // scripts/shared/inlinedHostConfigs.js 里查 shortName（react-dom → 'dom'，
      // react-reconciler 自身 → 'custom'），所以那份只有 throw 的占位模块从不进任何 bundle。
      // 本项目只有一个渲染器，故用 getHostConfigShortName 直接按 moduleType 判定，不铺
      // inlinedHostConfigs 那张表。resolveId 返回 null 时交回默认解析，不拦截其他模块。
      {
        name: "react-fiberconfig-fork",
        resolveId(source) {
          if (source !== "./ReactFiberHostConfig") {
            return null;
          }
          const shortName = getHostConfigShortName(bundle);
          if (shortName === null) {
            return null;
          }
          return path.resolve(
            process.cwd(),
            `packages/react-reconciler/src/forks/ReactFiberHostConfig.${shortName}.ts`,
          );
        },
      },
      resolve({ extensions: [".ts", ".tsx", ".js"] }),
      commonjs(),
      typescript({
        tsconfig: path.resolve(process.cwd(), "tsconfig.json"),
        declaration: false,
        composite: false,
      }),
      replace({
        preventAssignment: true,
        values: {
          __DEV__: JSON.stringify(isDev),
        },
      }),
      ...(isDev
        ? []
        : [
            terser({
              compress: { dead_code: true },
              mangle: false,
              format: { comments: false },
            }),
          ]),
      // 对照官方 build.js 的 top-level-definitions 插件（这里只还原 reconciler 分支）：
      // standalone react-reconciler 产物要在 renderChunk 阶段包成 $$$reconciler($$$config)，
      // 让第三方渲染器能把 host config 当参数传入。只对主入口生效，reflection/constants
      // 子入口是纯常量/工具转出，不触达 ReactFiberHostConfig，不需要包裹。
      ...(bundle.name === "react-reconciler"
        ? [
            {
              name: "wrap-reconciler-module",
              renderChunk(source) {
                return wrapWithReconcilerModule(source, isDev);
              },
            },
          ]
        : []),
    ],
  };

  const outputOptions = {
    // 对照官方：npm/ 目录本身是 git 跟踪的发布源码（index.js 等分发文件手写），
    // 但 npm/cjs、npm/umd 是构建产物子目录，由 rollup 写入、被 .gitignore 忽略
    file: path.resolve(
      process.cwd(),
      "packages",
      bundle.packageName,
      "npm",
      getOutputDir(type),
      getFilename(bundle, type),
    ),
    format: getFormat(type),
    exports: "named",
    // iife 格式需要 name 才能把 exports 挂到全局变量上（如 window.React）
    name: isUMD(type) ? bundle.global : undefined,
  };

  const build = await rollup.rollup(inputOptions);
  await build.write(outputOptions);
}

async function main() {
  if (bundles.length === 0) {
    console.log("No bundles configured in scripts/rollup/bundles.js yet.");
    return;
  }

  for (const bundle of bundles) {
    for (const type of bundle.bundleTypes) {
      await buildBundle(bundle, type);
      console.log(`built ${bundle.name} (${type})`);
    }
  }

  // 对照官方 build.js 末尾调用 Packaging.prepareNpmPackages：
  // 所有 bundle 打包完成后，把各包的构建产物 + LICENSE/README + 发布用 package.json
  // 收集到 build/node_modules/<pkg>/，这里才是真正 npm publish 的包根。
  const packageNames = [
    ...new Set(bundles.map((bundle) => bundle.packageName)),
  ];
  prepareNpmPackages(packageNames);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
