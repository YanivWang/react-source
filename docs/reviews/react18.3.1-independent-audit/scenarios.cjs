module.exports = {
  "stable-element-effects": async ({ React, h, render, container }) => {
    const log = [];
    function Child() {
      React.useLayoutEffect(() => { log.push("layout+"); return () => log.push("layout-"); }, []);
      React.useEffect(() => { log.push("passive+"); return () => log.push("passive-"); }, []);
      return h("span", null, "stable");
    }
    const element = h("section", null, h(Child));
    render(element);
    const first = [...log];
    render(element);
    return { actual: { text: container.textContent, first, second: [...log] },
      expected: { text: "stable", first: ["layout+", "passive+"], second: ["layout+", "passive+"] } };
  },
  "memo-subtree-effects": async ({ React, h, render, container }) => {
    const log = [];
    function Leaf() {
      React.useEffect(() => { log.push("mount"); return () => log.push("cleanup"); }, []);
      return h("span", null, "leaf");
    }
    const Memo = React.memo(() => h(Leaf));
    render(h("div", null, h(Memo), h("i", null, "0")));
    render(h("div", null, h(Memo), h("i", null, "1")));
    return { actual: { text: container.textContent, log: [...log] },
      expected: { text: "leaf1", log: ["mount"] } };
  },
  "nested-suspending-fallback": async ({ React, h, render, container, checkpoint }) => {
    const promise = new Promise(() => {});
    function Pending() { throw promise; }
    checkpoint("before-render");
    render(h(React.Suspense, { fallback: h("b", null, "outer") },
      h(React.Suspense, { fallback: h(Pending) }, h(Pending))));
    return { actual: container.textContent, expected: "outer" };
  },
  "nested-suspense-hide": async ({ React, h, render, container }) => {
    const pending = new Promise(() => {});
    function Pending({ suspend }) { if (suspend) throw pending; return h("i", null, "sibling"); }
    function App({ suspend }) {
      return h(React.Suspense, { fallback: h("b", null, "outer") },
        h(React.Suspense, { fallback: "inner" }, h("span", null, "nested")),
        h(Pending, { suspend }));
    }
    render(h(App, { suspend: false }));
    render(h(App, { suspend: true }));
    const visible = [...container.children].filter((n) => n.style.display !== "none").map((n) => n.textContent);
    return { actual: visible, expected: ["outer"] };
  },
  "class-context-type": async ({ React, h, render, container }) => {
    const Context = React.createContext("default");
    class Reader extends React.PureComponent {
      static contextType = Context;
      render() { return h("span", null, String(this.context)); }
    }
    const child = h(Reader);
    render(h(Context.Provider, { value: "first" }, child));
    const first = container.textContent;
    render(h(Context.Provider, { value: "second" }, child));
    return { actual: [first, container.textContent], expected: ["first", "second"] };
  },
  "suspense-hidden-class-delete": async ({ React, h, render }) => {
    const log = [];
    const promise = new Promise(() => {});
    class Child extends React.Component {
      componentDidMount() { log.push("mount"); }
      componentWillUnmount() { log.push("unmount"); }
      render() { return h("span", null, "child"); }
    }
    function Pending({ suspend }) { if (suspend) throw promise; return null; }
    function App({ suspend }) { return h(React.Suspense, { fallback: "wait" }, h(Child), h(Pending, { suspend })); }
    render(h(App, { suspend: false }));
    render(h(App, { suspend: true }));
    render(null);
    return { actual: [...log], expected: ["mount", "unmount"] };
  },
  "portal-mount-update": async ({ ReactDOM, h, render }) => {
    const portal = document.createElement("aside");
    document.body.appendChild(portal);
    render(h("div", null, ReactDOM.createPortal(h("span", null, "one"), portal)));
    const first = portal.textContent;
    render(h("div", null, ReactDOM.createPortal(h("span", null, "two"), portal)));
    const second = portal.textContent;
    render(null);
    const last = portal.textContent;
    portal.remove();
    return { actual: [first, second, last], expected: ["one", "two", ""] };
  },
  "root-initial-content": async ({ h, makeRoot, flushSync }) => {
    const node = document.createElement("div");
    node.innerHTML = "<p>old</p>";
    document.body.appendChild(node);
    const root = makeRoot(node);
    flushSync(() => root.render(h("span", null, "new")));
    return { actual: node.innerHTML, expected: "<span>new</span>" };
  },
  "html-content-switch": async ({ h, render, container }) => {
    render(h("div", { dangerouslySetInnerHTML: { __html: "<b>html</b>" } }));
    const initial = container.firstChild.innerHTML;
    render(h("div", null, h("i", null, "child")));
    const updated = container.firstChild.innerHTML;
    return { actual: [initial, updated], expected: ["<b>html</b>", "<i>child</i>"] };
  },
  "strict-class-updater": async ({ React, h, render, flushSync, container, mode }) => {
    let instance, updates = 0;
    class Child extends React.Component {
      state = { n: 0 };
      constructor(p) { super(p); instance = this; }
      render() { return h("span", null, this.state.n); }
    }
    render(h(React.StrictMode, null, h(Child)));
    flushSync(() => instance.setState((s) => { updates++; return { n: s.n + 1 }; }));
    return { actual: { text: container.textContent, updates },
      expected: { text: "1", updates: mode === "development" ? 2 : 1 } };
  },
  "error-boundary-fallback-throws": async ({ React, h, render, container, checkpoint }) => {
    class Boundary extends React.Component {
      state = { failed: false };
      static getDerivedStateFromError() { return { failed: true }; }
      render() { return this.state.failed ? this.props.fallback : this.props.children; }
    }
    function Bad() { throw new Error("original"); }
    function BadFallback() { throw new Error("fallback"); }
    checkpoint("before-render");
    render(h(Boundary, { fallback: h("b", null, "outer-error") },
      h(Boundary, { fallback: h(BadFallback) }, h(Bad))));
    return { actual: container.textContent, expected: "outer-error" };
  },
  "concurrent-update-after-subtree-completes": async ({ React, h, render, container, sleep, waitFor, checkpoint }) => {
    let setCounter, setSlow, started = false;
    function Counter() {
      const [n, set] = React.useState(0); setCounter = set;
      return h("b", { id: "counter" }, n);
    }
    const Panel = React.memo(() => h("section", null, h(Counter)));
    function Slow({ n, i }) {
      if (n === 1) {
        started = true;
        const end = performance.now() + 2;
        while (performance.now() < end) {}
      }
      return h("i", null, `${n}:${i}`);
    }
    function App() {
      const [n, set] = React.useState(0); setSlow = set;
      return h("div", { "data-phase": n }, h(Panel),
        Array.from({ length: 50 }, (_, i) => h(Slow, { n, i, key: i })));
    }
    render(h(App));
    React.startTransition(() => setSlow(1));
    await waitFor(() => started, "slow transition started");
    const interrupted = container.firstChild.dataset.phase === "0";
    checkpoint("between-slices", { interrupted });
    React.startTransition(() => setCounter((n) => n + 1));
    await waitFor(() => container.firstChild.dataset.phase === "1", "slow transition committed");
    await sleep(200);
    return { actual: { interrupted, count: container.querySelector("#counter").textContent },
      expected: { interrupted: true, count: "1" } };
  },
  "context-after-suspended-transition": async ({ React, h, render, flushSync, container, waitFor }) => {
    const Context = React.createContext(0);
    const pending = new Promise(() => {});
    let set, tried = false;
    const Reader = React.memo(function Reader() {
      return h("b", null, React.useContext(Context));
    });
    const stableReader = h(Reader);
    function Pending({ n }) { if (n === 1) { tried = true; throw pending; } return null; }
    function App() {
      const [n, s] = React.useState(0); set = s;
      return h(Context.Provider, { value: n },
        h("div", { "data-phase": n }, stableReader, h(Pending, { n })));
    }
    render(h(React.Suspense, { fallback: "waiting" }, h(App)));
    React.startTransition(() => set(1));
    await waitFor(() => tried, "transition suspended after context read");
    flushSync(() => set(2));
    return { actual: { phase: container.firstChild.dataset.phase, context: container.querySelector("b").textContent },
      expected: { phase: "2", context: "2" } };
  },
  "scheduler-preempt-current-callback": async ({ getScheduler, sleep }) => {
    const s = getScheduler();
    const log = [];
    let once = false;
    s.unstable_scheduleCallback(s.unstable_NormalPriority, () => {
      log.push("normal");
      if (!once) {
        once = true;
        s.unstable_scheduleCallback(s.unstable_ImmediatePriority, () => log.push("immediate"));
      }
    });
    await sleep(80);
    return { actual: log, expected: ["normal", "immediate"] };
  },
  "scheduler-natural-exit": async ({ getScheduler, sleep }) => {
    const s = getScheduler();
    const log = [];
    s.unstable_scheduleCallback(s.unstable_NormalPriority, () => log.push("ran"));
    await sleep(50);
    return { actual: log, expected: ["ran"], naturalExit: true };
  },
  "effect-order-control": async ({ React, h, render }) => {
    const log = [];
    function Child({ n }) {
      React.useInsertionEffect(() => { log.push(`I+${n}`); return () => log.push(`I-${n}`); }, [n]);
      React.useLayoutEffect(() => { log.push(`L+${n}`); return () => log.push(`L-${n}`); }, [n]);
      React.useEffect(() => { log.push(`P+${n}`); return () => log.push(`P-${n}`); }, [n]);
      return h("span", null, n);
    }
    render(h(Child, { n: 0 })); log.length = 0;
    render(h(Child, { n: 1 }));
    return { actual: [...log], expected: ["I-0", "I+1", "L-0", "L+1", "P-0", "P+1"] };
  },
  "keyed-fragment-identity-control": async ({ React, h, render, container }) => {
    function Row({ id }) {
      const [state] = React.useState(id);
      return h(React.Fragment, null, h("b", { "data-key": id }, state), h("i", null, id));
    }
    const rows = (ids) => ids.map((id) => h(Row, { key: id, id }));
    render(rows(["a", "b", "c"]));
    const b = container.querySelector('[data-key="b"]');
    render(rows(["c", "b", "d"]));
    return { actual: { text: container.textContent, identity: b === container.querySelector('[data-key="b"]') },
      expected: { text: "ccbbdd", identity: true } };
  },
  "cross-root-passive-control": async ({ React, h, root, render, makeRoot, flushSync, sleep }) => {
    const log = [];
    function App({ id }) {
      React.useEffect(() => { log.push(id + "+"); return () => log.push(id + "-"); }, []);
      return h("span", null, id);
    }
    const node = document.createElement("div");
    document.body.appendChild(node);
    const other = makeRoot(node);
    root.render(h(App, { id: "A" }));
    await sleep(60);
    flushSync(() => other.render(h(App, { id: "B" })));
    render(null);
    flushSync(() => other.render(null));
    return { actual: [...log], expected: ["A+", "B+", "A-", "B-"] };
  },
  "store-subscription-control": async ({ React, h, render, container, waitFor }) => {
    let value = 0, subscriptions = 0, unsubscriptions = 0;
    const listeners = new Set();
    const subscribe = (listener) => { subscriptions++; listeners.add(listener); return () => { unsubscriptions++; listeners.delete(listener); }; };
    const get = () => value;
    function App() { return h("b", null, React.useSyncExternalStore(subscribe, get)); }
    render(h(App));
    value = 1; for (const listener of listeners) listener();
    await waitFor(() => container.textContent === "1", "store commit");
    const text = container.textContent;
    render(null);
    return { actual: { text, subscriptions, unsubscriptions, remaining: listeners.size },
      expected: { text: "1", subscriptions: 1, unsubscriptions: 1, remaining: 0 } };
  },
  "deferred-render-phase-mount": async ({ React, h, render, container }) => {
    const commits = [];
    function App() {
      const [n, set] = React.useState(0);
      const deferred = React.useDeferredValue(n);
      if (n === 0) set(1);
      React.useLayoutEffect(() => { commits.push(`${n}:${deferred}`); });
      return h("span", null, `${n}:${deferred}`);
    }
    render(h(App));
    return { actual: { text: container.textContent, commits: [...commits] },
      expected: { text: "1:1", commits: ["1:1"] } };
  },
  "lazy-default-props": async ({ React, h, root, container, waitFor }) => {
    function Child({ label }) { return h("span", null, label === undefined ? "missing" : label); }
    Child.defaultProps = { label: "default" };
    const Lazy = React.lazy(() => Promise.resolve({ default: Child }));
    root.render(h(React.Suspense, { fallback: "loading" }, h(Lazy)));
    await waitFor(() => container.querySelector("span"), "lazy resolved");
    return { actual: container.textContent, expected: "default" };
  },
};
