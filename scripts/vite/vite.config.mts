import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { DepOptimizationOptions } from "vite";

const rootDir = path.resolve(import.meta.dirname, "../..");

// 对照 rollup 侧 __DEV__ 的用法：fixtures 场景固定跑 dev 分支，
// 不像 rollup build.js 那样区分 isProduction。
export default defineConfig({
  root: path.resolve(rootDir, "fixtures"),
  plugins: [
    // 对照 rollup 侧 build.js 的 react-dom-hostconfig-fork 插件：reconciler 内部对
    // HostConfig 用的是相对导入 ./ReactFiberHostConfig，vite 的 resolve.alias 只对裸导入
    // 生效、对相对导入不生效，所以必须用一个 resolveId 插件拦截（rollup 侧也是同样理由才
    // 没走 alias 而是自定义插件）。不拦截的话 pnpm dev 会直通 shim 文件、运行时报
    // "must be shimmed by a specific renderer"。
    {
      name: "react-dom-hostconfig-fork",
      enforce: "pre",
      resolveId(source, importer) {
        const reconcilerSrcDir = path
          .resolve(rootDir, "packages/react-reconciler/src")
          .replace(/\\/g, "/");
        if (
          source === "./ReactFiberHostConfig" &&
          importer &&
          importer.replace(/\\/g, "/").startsWith(reconcilerSrcDir + "/")
        ) {
          return path.resolve(
            rootDir,
            "packages/react-reconciler/src/forks/ReactFiberHostConfig.dom.ts",
          );
        }
        return null;
      },
    },
    react(),
    {
      name: "reset-optimize-deps",
      enforce: "post",
      configResolved(config) {
        // plugin-react 的 vite:react-refresh 会把 react/react-dom/jsx-runtime 塞到
        // optimizeDeps.include，并把这些 include 复制到每个 environment。
        // 源码调试场景下必须把它们清除，否则 alias 的源码永远走不到、改代码后必须 pnpm build 才能生效。
        const clear = (deps: DepOptimizationOptions | undefined) => {
          if (!deps) return;
          deps.include = [];
          deps.exclude = [];
          deps.entries = [];
          deps.noDiscovery = true;
        };
        if (config.optimizeDeps) clear(config.optimizeDeps);
        if (config.environments) {
          for (const env of Object.values(config.environments)) {
            if (env && env.optimizeDeps) clear(env.optimizeDeps);
          }
        }
      },
    },
  ],
  define: {
    __DEV__: JSON.stringify(true),
  },
  resolve: {
    alias: [
      // 更具体的子路径要排在 react 前面，避免被短 key 提前匹配掉
      {
        find: "react/jsx-dev-runtime",
        replacement: path.resolve(
          rootDir,
          "packages/react/src/jsx-dev-runtime.ts",
        ),
      },
      {
        find: "react/jsx-runtime",
        replacement: path.resolve(rootDir, "packages/react/src/jsx-runtime.ts"),
      },
      {
        // 必须使用精确匹配，否则会把 react/jsx-dev-runtime 拼成 ".../index.ts/jsx-dev-runtime"
        find: /^react$/,
        replacement: path.resolve(rootDir, "packages/react/src/index.ts"),
      },
      // packages/shared 的源码没有入口文件，react 等包内部按官方习惯直接写
      // import xxx from 'shared/yyy'，故用正则把 shared/xx 映射到其 ts 源码，
      // 保证 vite 的依赖图覆盖到 shared 文件（改动无需重启 dev 即可热更新）
      {
        find: /^shared\/(.*)$/,
        replacement: path.resolve(rootDir, "packages/shared/$1.ts"),
      },
      // react-reconciler 的常量入口（LegacyRoot/ConcurrentRoot）与主入口分开，
      // 与 react/jsx-runtime 一样需要精确匹配子路径，避免被主入口正则吞掉
      {
        find: /^react-reconciler\/constants$/,
        replacement: path.resolve(
          rootDir,
          "packages/react-reconciler/constants.ts",
        ),
      },
      // reconciler 内部子路径（react-dom 用 react-reconciler/src/... 风格引用），映射到 ts 源码
      {
        find: /^react-reconciler\/src\/(.*)$/,
        replacement: path.resolve(
          rootDir,
          "packages/react-reconciler/src/$1.ts",
        ),
      },
      {
        find: /^react-reconciler$/,
        replacement: path.resolve(
          rootDir,
          "packages/react-reconciler/index.ts",
        ),
      },
      // react-dom 的 client 子路径入口需精确匹配在前，避免被 /^react-dom$/ 吞掉
      {
        find: "react-dom/client",
        replacement: path.resolve(rootDir, "packages/react-dom/client.ts"),
      },
      // react-dom 子路径（react-dom 用 react-dom/src/... 风格引用），映射到 ts 源码
      {
        find: /^react-dom\/src\/(.*)$/,
        replacement: path.resolve(rootDir, "packages/react-dom/src/$1.ts"),
      },
      {
        find: /^react-dom$/,
        replacement: path.resolve(rootDir, "packages/react-dom/index.ts"),
      },
      // scheduler 子路径（reconciler 用 scheduler/src/... 风格引用），映射到 ts 源码
      {
        find: /^scheduler\/src\/(.*)$/,
        replacement: path.resolve(rootDir, "packages/scheduler/src/$1.ts"),
      },
      {
        find: /^scheduler$/,
        replacement: path.resolve(rootDir, "packages/scheduler/index.ts"),
      },
    ],
  },
});
