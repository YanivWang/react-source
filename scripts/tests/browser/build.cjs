// Bundle the same public-API harness against the two published package layouts.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const { rollup } = require("rollup");
const commonjs = require("@rollup/plugin-commonjs");
const { nodeResolve } = require("@rollup/plugin-node-resolve");
const replace = require("@rollup/plugin-replace");
const repo = path.resolve(__dirname, "../../..");
const output = path.join(repo, "build/browser-validation");
const hash = (p) =>
  crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const manifests = [];
  for (const runtime of ["official", "local"]) {
    const react = require.resolve(
      runtime === "official"
        ? "react-reference"
        : path.join(repo, "build/node_modules/react"),
    );
    const dom = require.resolve(
      runtime === "official"
        ? "react-dom-reference"
        : path.join(repo, "build/node_modules/react-dom"),
    );
    const domRequire = createRequire(dom);
    if (fs.realpathSync(react) !== fs.realpathSync(domRequire.resolve("react")))
      throw Error("React peer mismatch");
    if (
      runtime === "official" &&
      domRequire("./package.json").version !== "18.3.1"
    )
      throw Error("Wrong official version");
    const aliases = {
      "@runtime/react": react,
      "@runtime/dom": dom,
      "@runtime/client": domRequire.resolve("./client"),
      "@runtime/scheduler": domRequire.resolve("scheduler"),
      react,
    };
    for (const mode of ["development", "production"]) {
      const bundle = await rollup({
        input: path.join(__dirname, "harness.js"),
        plugins: [
          {
            name: "runtime-alias",
            resolveId(id) {
              return aliases[id] || null;
            },
          },
          replace({
            preventAssignment: true,
            "process.env.NODE_ENV": JSON.stringify(mode),
            __RUNTIME__: JSON.stringify(runtime),
            __MODE__: JSON.stringify(mode),
          }),
          nodeResolve({ browser: true }),
          commonjs(),
        ],
      });
      const name = `${runtime}-${mode}`;
      const file = path.join(output, name + ".js");
      await bundle.write({ file, format: "iife" });
      const files = Object.keys(
        bundle.cache.modules.reduce((o, m) => ({ ...o, [m.id]: true }), {}),
      )
        .filter((p) => !p.includes("\0") && fs.existsSync(p))
        .map((p) => ({ file: p, sha256: hash(p) }));
      manifests.push({
        runtime,
        mode,
        bundle: path.basename(file),
        sha256: hash(file),
        files,
      });
      await bundle.close();
      fs.writeFileSync(
        path.join(output, name + ".html"),
        `<!doctype html><html lang="zh"><meta charset="utf-8"><title>React 18.3.1 ${name}</title><style>body{font:16px system-ui;margin:24px;max-width:1000px}label{display:inline-flex;gap:8px;align-items:center;margin:8px 16px 8px 0}input,select,textarea,button{font:inherit;padding:7px}input[type=text]{width:150px}input[type=number]{width:90px}button{margin:8px}pre{white-space:pre-wrap;font-size:12px}#visual{padding:10px;background:#e0f0ff;margin:12px 0}a{margin-right:14px}</style><h1>${name}</h1><nav>${["official", "local"].flatMap((r) => ["development", "production"].map((m) => `<a href="/${r}-${m}.html">${r}-${m}</a>`)).join("")}</nav><button id="auto">运行自动对照用例</button><button id="capture">保存输入检查</button><p id="status">就绪</p><section id="forms"></section><section id="portal"></section><section id="visual"></section><section id="sandbox"></section><pre id="results"></pre><script src="/${name}.js"></script></html>`,
      );
    }
  }
  fs.writeFileSync(
    path.join(output, "manifest.json"),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), manifests },
      null,
      2,
    ) + "\n",
  );
  console.log("Built four browser harnesses in", output);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
