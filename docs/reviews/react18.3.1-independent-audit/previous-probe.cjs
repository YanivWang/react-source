// Compare the previous commit using only APIs that existed in that commit.
// Its lack of public flushSync/unmount must not be patched to manufacture a baseline.
const path = require("node:path");
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><body><div id='root'></div>", { url: "http://localhost/" });
global.window = dom.window;
global.document = window.document;
Object.defineProperty(global, "navigator", { value: window.navigator, configurable: true });
global.HTMLElement = window.HTMLElement;
global.Element = window.Element;
global.Node = window.Node;
const target = process.argv[2], scenario = process.argv[3];
const built = target === "current" ? path.resolve(__dirname, "../../../build/node_modules") : process.env.PREVIOUS_BUILD;
const React = require(target === "official" ? "react-reference" : path.join(built, "react"));
const { createRoot } = require(target === "official" ? "react-dom-reference/client" : path.join(built, "react-dom/client"));
const h = React.createElement;
const container = document.getElementById("root");
const root = createRoot(container);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = [];
const snapshots = [];
console.error = console.warn = () => {};
async function render(element, ms = 80) {
  root.render(element);
  await sleep(ms);
  snapshots.push({ text: container.textContent, log: [...log] });
}
(async () => {
  if (scenario === "hidden-class-delete") {
    const promise = new Promise(() => {});
    class Child extends React.Component {
      componentDidMount() { log.push("mount"); }
      componentWillUnmount() { log.push("unmount"); }
      render() { return h("span", null, "child"); }
    }
    function Pending({ suspend }) { if (suspend) throw promise; return null; }
    function App({ suspend }) {
      return h(React.Suspense, { fallback: "waiting" }, h(Child), h(Pending, { suspend }));
    }
    await render(h(App, { suspend: false }));
    await render(h(App, { suspend: true }), 850);
    await render(null);
  } else if (scenario === "memo-subtree-effects") {
    function Leaf() {
      React.useEffect(() => { log.push("mount"); return () => log.push("cleanup"); }, []);
      return h("span", null, "leaf");
    }
    const Memo = React.memo(() => h(Leaf));
    await render(h("div", null, h(Memo), h("i", null, "0")));
    await render(h("div", null, h(Memo), h("i", null, "1")));
    await render(null);
  } else throw new Error("Unknown scenario");
  dom.window.close();
  console.log(JSON.stringify({ target, scenario, mode: process.env.NODE_ENV, snapshots }));
  process.exit(0);
})().catch((error) => { console.log(JSON.stringify({ error: String(error) })); process.exit(2); });
