const path = require("node:path");
const { JSDOM } = require("jsdom");
const jsdom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div></body></html>',
  { url: "http://localhost/", pretendToBeVisual: true },
);
global.window = jsdom.window;
global.document = window.document;
Object.defineProperty(global, "navigator", {
  value: window.navigator,
  configurable: true,
});
global.HTMLElement = window.HTMLElement;
global.Element = window.Element;
global.Node = window.Node;
global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
const repo = process.argv[2],
  test = process.argv[3];
let React, createRoot;
if (repo === "official") {
  React = require("react-reference");
  ({ createRoot } = require("react-dom-reference/client"));
} else {
  const built = path.resolve(__dirname, "../../build/node_modules");
  React = require(path.join(built, "react"));
  ({ createRoot } = require(path.join(built, "react-dom/client")));
}
const { flushSync, findDOMNode } =
  repo === "official"
    ? require("react-dom-reference")
    : require(path.resolve(__dirname, "../../build/node_modules/react-dom"));
const getScheduler = () =>
  repo === "official"
    ? require("node:module").createRequire(
        require.resolve("react-dom-reference"),
      )("scheduler")
    : require(path.resolve(__dirname, "../../build/node_modules/scheduler"));
const h = React.createElement,
  container = document.getElementById("root");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const root = createRoot(container);
const originalLog = console.log;
const messages = [];
console.log = (...args) => {
  messages.push(args.map(String).join(" "));
};
console.warn = (...args) => {
  messages.push("WARN " + args.map(String).join(" "));
};
console.error = (...args) => {
  messages.push("ERROR " + args.map(String).join(" "));
};
const result = { repo, test, version: React.version };
async function render(element) {
  root.render(element);
  await sleep(75);
}
async function run() {
  if (test === "basic-state") {
    let set;
    function App() {
      let [n, s] = React.useState(0);
      set = s;
      return h("span", null, String(n));
    }
    await render(h(App, null));
    result.initial = container.textContent;
    set((n) => n + 1);
    await sleep(75);
    result.updated = container.textContent;
    result.expected = { initial: "0", updated: "1" };
  } else if (test === "state-batch") {
    let set;
    function App() {
      let [n, s] = React.useState(0);
      set = s;
      return h(
        "button",
        {
          onClick: () => {
            set((n) => n + 1);
            set((n) => n + 1);
          },
        },
        String(n),
      );
    }
    await render(h(App, null));
    container.firstChild.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true }),
    );
    await sleep(75);
    result.actual = container.textContent;
    result.expected = "2";
  } else if (test === "props") {
    await render(
      h(
        "button",
        {
          className: "before",
          title: "old",
          disabled: false,
          style: { backgroundColor: "red" },
        },
        "same",
      ),
    );
    result.initial = {
      class: container.firstChild.className,
      title: container.firstChild.title,
      disabled: container.firstChild.disabled,
      color: container.firstChild.style.backgroundColor,
    };
    await render(
      h(
        "button",
        {
          className: "after",
          title: "new",
          disabled: false,
          style: { backgroundColor: "blue" },
        },
        "same",
      ),
    );
    result.updated = {
      class: container.firstChild.className,
      title: container.firstChild.title,
      disabled: container.firstChild.disabled,
      color: container.firstChild.style.backgroundColor,
    };
    result.expected = {
      initial: { class: "before", title: "old", disabled: false, color: "red" },
      updated: { class: "after", title: "new", disabled: false, color: "blue" },
    };
  } else if (test === "effect-only") {
    let calls = [];
    function App() {
      React.useEffect(() => {
        calls.push("mount");
        return () => calls.push("cleanup");
      }, []);
      return h("span", null, "ok");
    }
    await render(h(App, null));
    result.afterMount = [...calls];
    await render(null);
    result.afterUnmount = [...calls];
    result.expected = {
      afterMount: ["mount"],
      afterUnmount: ["mount", "cleanup"],
    };
  } else if (test === "memo-effect") {
    let calls = [];
    const App = React.memo(function App() {
      React.useEffect(() => {
        calls.push("mount");
        return () => calls.push("cleanup");
      }, []);
      return h("span", null, "ok");
    });
    await render(h(App, null));
    result.afterMount = [...calls];
    await render(null);
    result.afterUnmount = [...calls];
    result.expected = {
      afterMount: ["mount"],
      afterUnmount: ["mount", "cleanup"],
    };
  } else if (test === "memo-compare") {
    let renders = 0;
    const App = React.memo(
      ({ n }) => {
        renders++;
        return h("span", null, String(n));
      },
      () => true,
    );
    await render(h(App, { n: 1 }));
    await render(h(App, { n: 2 }));
    result.actual = { text: container.textContent, renders };
    result.expected = { text: "1", renders: 1 };
  } else if (test === "handler-update") {
    let calls = [];
    await render(h("button", { onClick: () => calls.push("old") }, "same"));
    await render(h("button", { onClick: () => calls.push("new") }, "same"));
    container.firstChild.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true }),
    );
    await sleep(30);
    result.actual = calls;
    result.expected = ["new"];
  } else if (test === "context") {
    const C = React.createContext("default");
    function App() {
      return h("span", null, React.useContext(C));
    }
    await render(h(C.Provider, { value: "first" }, h(App, null)));
    result.initial = container.textContent;
    await render(h(C.Provider, { value: "second" }, h(App, null)));
    result.updated = container.textContent;
    result.expected = { initial: "first", updated: "second" };
  } else if (test === "render-phase") {
    let count = 0;
    function App() {
      let [n, set] = React.useState(0);
      count++;
      if (n === 0) set(1);
      return h("span", null, String(n));
    }
    await render(h(App, null));
    result.actual = { text: container.textContent, renders: count };
    result.expected = { text: "1", renders: 2 };
  } else if (test === "render-phase-ref") {
    let mounted = [];
    const ref = (node) => {
      if (node) mounted.push(node.textContent);
    };
    function App() {
      let [n, set] = React.useState(0);
      if (n === 0) set(1);
      return h("span", { ref }, String(n));
    }
    await render(h(App, null));
    result.actual = { text: container.textContent, mounted };
    result.expected = { text: "1", mounted: ["1"] };
  } else if (test === "ref-update") {
    let first = { current: null },
      second = { current: null };
    await render(h("span", { ref: first }, "hello"));
    result.initial = {
      first: first.current !== null,
      second: second.current !== null,
    };
    await render(h("span", { ref: second }, "hello"));
    result.actual = {
      first: first.current !== null,
      second: second.current !== null,
    };
    result.expected = { first: false, second: true };
  } else if (test === "suspense-update") {
    let suspended = false;
    const pending = new Promise(() => {});
    function Child() {
      if (suspended) throw pending;
      return h("span", null, "ready");
    }
    function App({ tick }) {
      return h(
        React.Suspense,
        { fallback: h("b", null, "loading") },
        h(Child, { tick }),
      );
    }
    await render(h(App, { tick: 0 }));
    result.initial = container.innerHTML;
    suspended = true;
    await render(h(App, { tick: 1 }));
    result.after75ms = container.innerHTML;
    await sleep(750);
    result.actual = container.innerHTML;
    result.expected =
      "visible loading fallback (ready primary may remain hidden)";
  } else if (test === "suspense-lazy-function") {
    const Lazy = React.lazy(() =>
      Promise.resolve({
        default: function Child() {
          return h("span", null, "resolved");
        },
      }),
    );
    await render(
      h(React.Suspense, { fallback: h("b", null, "loading") }, h(Lazy, null)),
    );
    await sleep(100);
    result.actual = container.textContent;
    result.expected = "resolved";
  } else if (test === "suspense-lazy-class") {
    class Child extends React.Component {
      render() {
        return h("span", null, "resolved");
      }
    }
    const Lazy = React.lazy(() => Promise.resolve({ default: Child }));
    await render(
      h(React.Suspense, { fallback: h("b", null, "loading") }, h(Lazy, null)),
    );
    await sleep(100);
    result.actual = container.textContent;
    result.expected = "resolved";
  } else if (test === "siblings-state") {
    let setA, setB;
    function A() {
      let [n, s] = React.useState(0);
      setA = s;
      return h("span", null, "A" + n);
    }
    function B() {
      let [n, s] = React.useState(0);
      setB = s;
      return h("span", null, "B" + n);
    }
    function App() {
      return h("div", null, h(A, null), h(B, null));
    }
    await render(h(App, null));
    setB((n) => n + 1);
    await sleep(75);
    result.actual = container.textContent;
    result.expected = "A0B1";
  } else if (test === "error-boundary") {
    class Boundary extends React.Component {
      constructor(p) {
        super(p);
        this.state = { failed: false };
      }
      static getDerivedStateFromError() {
        return { failed: true };
      }
      render() {
        return this.state.failed ? h("b", null, "caught") : this.props.children;
      }
    }
    function Bad() {
      throw Error("probe throw");
    }
    await render(h(Boundary, null, h(Bad, null)));
    result.actual = container.textContent;
    result.expected = "caught";
  } else {
    const scenario = require("./scenarios.cjs")[test];
    if (!scenario) throw Error("Unknown test " + test);
    await scenario({
      React,
      h,
      container,
      root,
      createRoot,
      flushSync,
      findDOMNode,
      getScheduler,
      render,
      sleep,
      result,
      window,
    });
  }
  if (test === "suspense-update") {
    result.actual = [...container.children]
      .filter((node) => node.style.display !== "none")
      .map((node) => node.textContent)
      .join("");
    result.expected = "loading";
  }
  if (result.actual === undefined) {
    result.actual = Object.fromEntries(
      Object.keys(result.expected).map((key) => [key, result[key]]),
    );
  }
  result.messages = messages.slice(0, 15);
  originalLog(JSON.stringify(result));
  process.exit(0);
}
process.on("uncaughtException", (error) => {
  originalLog(
    JSON.stringify({
      ...result,
      uncaught: String(error),
      stack: error.stack,
      messages: messages.slice(0, 10),
    }),
  );
  process.exit(2);
});
run().catch((error) => {
  originalLog(
    JSON.stringify({
      ...result,
      rejected: String(error),
      stack: error.stack,
      messages: messages.slice(0, 10),
    }),
  );
  process.exit(2);
});
