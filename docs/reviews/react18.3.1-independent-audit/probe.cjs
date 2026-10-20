// Independent public-API probes. No implementation imports or original test edits.
const path = require("node:path");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const { JSDOM, VirtualConsole } = require("jsdom");
const repo = path.resolve(__dirname, "../../..");
const runtime = process.argv[2];
const scenarioName = process.argv[3];
const messages = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => messages.push(String(error)));
const dom = new JSDOM("<!doctype html><body><div id='root'></div></body>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
  virtualConsole,
});
global.window = dom.window;
global.document = window.document;
Object.defineProperty(global, "navigator", { value: window.navigator, configurable: true });
for (const name of ["HTMLElement", "Element", "Node", "Event", "MouseEvent"])
  global[name] = window[name];
global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
const official = runtime === "official";
const reactPath = require.resolve(official ? "react-reference" : path.join(repo, "build/node_modules/react"));
const domPath = require.resolve(official ? "react-dom-reference" : path.join(repo, "build/node_modules/react-dom"));
const React = require(reactPath);
const ReactDOM = require(domPath);
const { createRoot } = require(official ? "react-dom-reference/client" : path.join(repo, "build/node_modules/react-dom/client"));
const domRequire = createRequire(domPath);
const peerPath = domRequire.resolve("react");
const meta = {
  runtime, scenario: scenarioName, mode: process.env.NODE_ENV,
  reactVersion: React.version, domVersion: ReactDOM.version,
  domPackageVersion: require(path.join(path.dirname(domPath), "package.json")).version,
  reactPath: fs.realpathSync(reactPath), domPath: fs.realpathSync(domPath),
  peerReactPath: fs.realpathSync(peerPath), samePeer: domRequire("react") === React,
  loadedFiles: [],
};
const output = (value) => process.stdout.write(JSON.stringify(value) + "\n");
console.log = console.warn = console.error = (...args) => {
  if (messages.length < 30) messages.push(args.map(String).join(" "));
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (predicate, label, timeout = 1400) => {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out: " + label);
    await sleep(5);
  }
};
const container = document.getElementById("root");
const roots = [];
const makeRoot = (node = container, options) => {
  const root = createRoot(node, options);
  roots.push(root);
  return root;
};
const root = makeRoot();
const flushSync = ReactDOM.flushSync;
const render = (element) => flushSync(() => root.render(element));
const h = React.createElement;
const checkpoint = (label, data) => output({ checkpoint: label, data });
const getScheduler = () => domRequire("scheduler");
function fail(kind, error) {
  output({ ...meta, kind, error: String(error), stack: error?.stack, messages });
  dom.window.close();
  process.exit(2);
}
process.on("uncaughtException", (e) => fail("uncaught", e));
process.on("unhandledRejection", (e) => fail("rejected", e));
(async () => {
  checkpoint("loaded", { ...meta });
  const fn = require("./scenarios.cjs")[scenarioName];
  if (!fn) throw new Error("Unknown scenario " + scenarioName);
  const observation = await fn({
    React, ReactDOM, h, root, container, render, flushSync, sleep, waitFor,
    makeRoot, checkpoint, getScheduler, mode: process.env.NODE_ENV,
  });
  const cleanup = [];
  for (const managed of roots.reverse()) {
    try { managed.unmount(); } catch (error) { cleanup.push(String(error)); }
  }
  await sleep(15);
  meta.loadedFiles = Object.keys(require.cache).filter((p) =>
    /(?:react|scheduler)[^/]*\/(?:cjs|index|client)/.test(p) && !p.includes("jsdom"));
  dom.window.close();
  output({ ...meta, kind: "result", ...observation, cleanupErrors: cleanup, messages });
  if (!observation.naturalExit) process.exit(0);
})().catch((e) => fail("rejected", e));
