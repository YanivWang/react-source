const click = (window, node) =>
  node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const nativeValue = (window, node, value) =>
  Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set.call(node, value);

module.exports = {
  "effect-order": async ({ React: R, h, render, result }) => {
    const calls = [];
    function App({ n }) {
      R.useInsertionEffect(() => {
        calls.push("i" + n);
        return () => calls.push("-i" + n);
      }, [n]);
      R.useLayoutEffect(() => {
        calls.push("l" + n);
        return () => calls.push("-l" + n);
      }, [n]);
      R.useEffect(() => {
        calls.push("p" + n);
        return () => calls.push("-p" + n);
      }, [n]);
      return h("span", null, n);
    }
    await render(h(App, { n: 0 }));
    await render(h(App, { n: 0 }));
    await render(h(App, { n: 1 }));
    await render(null);
    result.actual = calls;
    result.expected = [
      "i0",
      "l0",
      "p0",
      "-i0",
      "i1",
      "-l0",
      "l1",
      "-p0",
      "p1",
      "-i1",
      "-l1",
      "-p1",
    ];
  },
  "effect-tree-delete": async ({ React: R, h, render, result, container }) => {
    const calls = [];
    function Child() {
      R.useEffect(() => {
        calls.push("child+");
        return () => calls.push("child-:" + container.textContent);
      }, []);
      return h("b", null, "child");
    }
    function Parent() {
      R.useEffect(() => {
        calls.push("parent+");
        return () => calls.push("parent-:" + container.textContent);
      }, []);
      return h(Child);
    }
    await render(h(Parent));
    await render(null);
    result.actual = calls;
    result.expected = ["child+", "parent+", "parent-:", "child-:"];
  },
  "render-phase-reducer": async ({
    React: R,
    h,
    render,
    result,
    container,
  }) => {
    const attached = [],
      effects = [];
    const ref = (node) => {
      if (node) attached.push(node.textContent);
    };
    function App() {
      const [n, set] = R.useState(0);
      const [v, dispatch] = R.useReducer((v, a) => v + a, 0);
      if (n === 0) {
        set(1);
        dispatch(2);
      }
      R.useEffect(() => {
        effects.push(n + ":" + v);
      }, [n, v]);
      return h("span", { ref }, n + ":" + v);
    }
    await render(h(App));
    result.actual = { text: container.textContent, attached, effects };
    result.expected = { text: "1:2", attached: ["1:2"], effects: ["1:2"] };
  },
  "memo-context": async ({ React: R, h, render, result, container }) => {
    const C = R.createContext("default");
    const Child = R.memo(() => h("b", null, R.useContext(C)));
    const child = h(Child);
    await render(h(C.Provider, { value: "old" }, child));
    await render(h(C.Provider, { value: "new" }, child));
    result.actual = container.textContent;
    result.expected = "new";
  },
  "keyed-diff": async ({ React: R, h, render, result, container }) => {
    function Item({ name }) {
      const [value] = R.useState(name);
      return h("span", { "data-key": name }, value);
    }
    const list = (names) =>
      h(
        "div",
        null,
        names.map((name) => h(Item, { key: name, name })),
      );
    await render(list(["A", "B", "C"]));
    const first = [...container.querySelectorAll("span")];
    await render(list(["C", "A", "D"]));
    const next = [...container.querySelectorAll("span")];
    result.actual = {
      text: container.textContent,
      reusedC: next[0] === first[2],
      reusedA: next[1] === first[0],
      removedB: !container.contains(first[1]),
    };
    result.expected = {
      text: "CAD",
      reusedC: true,
      reusedA: true,
      removedB: true,
    };
  },
  "event-order": async ({ h, render, result, container, window, sleep }) => {
    const calls = [];
    let stop = false;
    await render(
      h(
        "div",
        {
          onClickCapture: () => calls.push("parent capture"),
          onClick: () => calls.push("parent bubble"),
        },
        h(
          "button",
          {
            onClickCapture: () => calls.push("child capture"),
            onClick: (e) => {
              calls.push("child bubble");
              if (stop) e.stopPropagation();
            },
          },
          "go",
        ),
      ),
    );
    click(window, container.querySelector("button"));
    stop = true;
    click(window, container.querySelector("button"));
    await sleep(10);
    result.actual = calls;
    result.expected = [
      "parent capture",
      "child capture",
      "child bubble",
      "parent bubble",
      "parent capture",
      "child capture",
      "child bubble",
    ];
  },
  "disabled-events": async ({ h, render, result, container, window }) => {
    const calls = [];
    await render(
      h(
        "div",
        { onClick: () => calls.push("parent") },
        h(
          "button",
          { disabled: true, onClick: () => calls.push("button") },
          "go",
        ),
      ),
    );
    click(window, container.querySelector("button"));
    result.actual = calls;
    result.expected = ["parent"];
  },
  "controlled-input": async ({
    React: R,
    h,
    render,
    result,
    container,
    window,
    sleep,
  }) => {
    const calls = [];
    function App() {
      const [v, set] = R.useState("a");
      return h("input", {
        value: v,
        onChange: (e) => {
          calls.push(e.target.value);
          set(e.target.value.toUpperCase());
        },
      });
    }
    await render(h(App));
    const input = container.firstChild;
    nativeValue(window, input, "b");
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await sleep(75);
    result.actual = { value: input.value, calls };
    result.expected = { value: "B", calls: ["b"] };
  },
  "controlled-restore": async ({
    h,
    render,
    result,
    container,
    window,
    sleep,
  }) => {
    await render(h("input", { value: "fixed", onChange: () => {} }));
    const input = container.firstChild;
    nativeValue(window, input, "edited");
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await sleep(20);
    result.actual = input.value;
    result.expected = "fixed";
  },
  "uncontrolled-input": async ({ h, render, result, container, window }) => {
    await render(h("input", { defaultValue: "initial" }));
    const input = container.firstChild;
    nativeValue(window, input, "edited");
    await render(h("input", { defaultValue: "next" }));
    result.actual = { value: input.value, defaultValue: input.defaultValue };
    result.expected = { value: "edited", defaultValue: "next" };
  },
  "controlled-checkbox": async ({
    React: R,
    h,
    render,
    result,
    container,
    window,
    sleep,
  }) => {
    const calls = [];
    function App() {
      const [v, set] = R.useState(false);
      return h("input", {
        type: "checkbox",
        checked: v,
        onChange: (e) => {
          calls.push(e.target.checked);
          set(e.target.checked);
        },
      });
    }
    await render(h(App));
    click(window, container.firstChild);
    await sleep(75);
    result.actual = { checked: container.firstChild.checked, calls };
    result.expected = { checked: true, calls: [true] };
  },
  "controlled-select": async ({
    React: R,
    h,
    render,
    result,
    container,
    window,
    sleep,
  }) => {
    const calls = [];
    function App() {
      const [v, set] = R.useState("b");
      return h(
        "select",
        {
          value: v,
          onChange: (e) => {
            calls.push(e.target.value);
            set(e.target.value);
          },
        },
        h("option", { value: "a" }, "A"),
        h("option", { value: "b" }, "B"),
      );
    }
    await render(h(App));
    const select = container.firstChild;
    const initial = select.value;
    select.value = "a";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
    await sleep(75);
    result.actual = { initial, value: select.value, calls };
    result.expected = { initial: "b", value: "a", calls: ["a"] };
  },
  "style-removal": async ({ h, render, result, container }) => {
    await render(
      h("div", {
        style: {
          width: 10,
          lineHeight: 2,
          backgroundColor: "red",
          "--accent": "blue",
        },
      }),
    );
    await render(
      h("div", { style: { width: 0, opacity: 0.5, "--accent": "green" } }),
    );
    const s = container.firstChild.style;
    result.actual = {
      width: s.width,
      lineHeight: s.lineHeight,
      color: s.backgroundColor,
      opacity: s.opacity,
      accent: s.getPropertyValue("--accent"),
    };
    result.expected = {
      width: "0px",
      lineHeight: "",
      color: "",
      opacity: "0.5",
      accent: "green",
    };
  },
  "forward-imperative-ref": async ({ React: R, h, render, result }) => {
    const ref = { current: null };
    const App = R.forwardRef(({ n }, ref) => {
      R.useImperativeHandle(ref, () => ({ value: n }), [n]);
      return h("span", null, n);
    });
    await render(h(App, { n: 1, ref }));
    const first = ref.current.value;
    await render(h(App, { n: 2, ref }));
    const updated = ref.current.value;
    await render(null);
    result.actual = { first, updated, cleared: ref.current === null };
    result.expected = { first: 1, updated: 2, cleared: true };
  },
  "didcatch-only": async ({ React: R, h, render, result, container }) => {
    const calls = [];
    class Boundary extends R.Component {
      constructor(p) {
        super(p);
        this.state = { bad: false };
      }
      componentDidCatch(e) {
        calls.push(e.message);
        this.setState({ bad: true });
      }
      render() {
        return this.state.bad ? h("b", null, "caught") : this.props.children;
      }
    }
    function Bad() {
      throw Error("bad");
    }
    await render(h(Boundary, null, h(Bad)));
    result.actual = { text: container.textContent, calls };
    result.expected = { text: "caught", calls: ["bad"] };
  },
  "layout-error-boundary": async ({
    React: R,
    h,
    render,
    result,
    container,
  }) => {
    class Boundary extends R.Component {
      constructor(p) {
        super(p);
        this.state = { bad: false };
      }
      static getDerivedStateFromError() {
        return { bad: true };
      }
      render() {
        return this.state.bad ? h("b", null, "caught") : this.props.children;
      }
    }
    function Bad() {
      R.useLayoutEffect(() => {
        throw Error("layout");
      }, []);
      return h("span", null, "bad");
    }
    await render(h(Boundary, null, h(Bad)));
    result.actual = container.textContent;
    result.expected = "caught";
  },
  "hook-throw-recovery": async ({
    React: R,
    h,
    render,
    result,
    container,
    window,
    sleep,
  }) => {
    class Boundary extends R.Component {
      constructor(p) {
        super(p);
        this.state = { bad: false };
      }
      static getDerivedStateFromError() {
        return { bad: true };
      }
      render() {
        return this.state.bad ? h(Good) : this.props.children;
      }
    }
    function Good() {
      const [n, set] = R.useState(5);
      return h("button", { onClick: () => set((n) => n + 1) }, n);
    }
    function Bad() {
      const [n, set] = R.useState(0);
      if (n === 0) set(1);
      throw Error("render");
    }
    await render(h(Boundary, null, h(Bad)));
    click(window, container.firstChild);
    await sleep(75);
    let invalid = false;
    try {
      R.useState(0);
    } catch {
      invalid = true;
    }
    result.actual = { text: container.textContent, invalid };
    result.expected = { text: "6", invalid: true };
  },
  "external-store": async ({
    React: R,
    h,
    render,
    result,
    container,
    sleep,
  }) => {
    let value = 0,
      subscribed = 0,
      unsubscribed = 0;
    const listeners = new Set();
    const subscribe = (f) => {
      subscribed++;
      listeners.add(f);
      return () => {
        unsubscribed++;
        listeners.delete(f);
      };
    };
    function App() {
      const n = R.useSyncExternalStore(subscribe, () => value);
      return h("b", null, n);
    }
    await render(h(App));
    value = 1;
    for (const f of listeners) f();
    await sleep(75);
    const text = container.textContent;
    await render(null);
    result.actual = { text, subscribed, unsubscribed };
    result.expected = { text: "1", subscribed: 1, unsubscribed: 1 };
  },
  "transition-rebase": async ({
    React: R,
    h,
    render,
    result,
    container,
    window,
    sleep,
  }) => {
    function App() {
      const [n, set] = R.useState(0);
      const [p, start] = R.useTransition();
      return h(
        "button",
        {
          onClick: () => {
            start(() => set((n) => n + 10));
            set((n) => n + 1);
          },
        },
        n + ":" + p,
      );
    }
    await render(h(App));
    click(window, container.firstChild);
    await sleep(150);
    result.actual = container.textContent;
    result.expected = "11:false";
  },
  "async-batch": async ({ React: R, h, render, result, container, sleep }) => {
    let set;
    const commits = [];
    function App() {
      const [n, s] = R.useState(0);
      set = s;
      R.useLayoutEffect(() => {
        commits.push(n);
      }, [n]);
      return h("b", null, n);
    }
    await render(h(App));
    await new Promise((resolve) =>
      setTimeout(() => {
        set((n) => n + 1);
        set((n) => n + 1);
        resolve();
      }, 0),
    );
    await sleep(100);
    result.actual = { text: container.textContent, commits };
    result.expected = { text: "2", commits: [0, 2] };
  },
  "deferred-value": async ({
    React: R,
    h,
    render,
    result,
    container,
    window,
    sleep,
  }) => {
    const commits = [];
    function App() {
      const [n, set] = R.useState(0);
      const d = R.useDeferredValue(n);
      R.useLayoutEffect(() => {
        commits.push(n + ":" + d);
      }, [n, d]);
      return h("button", { onClick: () => set(1) }, n + ":" + d);
    }
    await render(h(App));
    click(window, container.firstChild);
    await sleep(150);
    result.actual = { text: container.textContent, commits };
    result.expected = { text: "1:1", commits: ["0:0", "1:0", "1:1"] };
  },
  "strict-mode": async ({
    React: R,
    h,
    render,
    result,
    container,
    window,
    sleep,
  }) => {
    let renders = 0,
      inits = 0;
    const effects = [];
    function App() {
      const [n, set] = R.useState(() => {
        inits++;
        return 0;
      });
      renders++;
      R.useEffect(() => {
        effects.push("+" + n);
        return () => effects.push("-" + n);
      }, [n]);
      return h("button", { onClick: () => set((n) => n + 1) }, n);
    }
    await render(h(R.StrictMode, null, h(App)));
    const initial = { renders, inits, effects: [...effects] };
    click(window, container.firstChild);
    await sleep(75);
    result.actual = {
      initial,
      text: container.textContent,
      renders,
      inits,
      effects,
    };
    result.expected = {
      initial: { renders: 2, inits: 2, effects: ["+0", "-0", "+0"] },
      text: "1",
      renders: 4,
      inits: 2,
      effects: ["+0", "-0", "+0", "-0", "+1"],
    };
    if (process.env.NODE_ENV === "production")
      result.expected = {
        initial: { renders: 1, inits: 1, effects: ["+0"] },
        text: "1",
        renders: 2,
        inits: 1,
        effects: ["+0", "-0", "+1"],
      };
  },
  "root-unmount": async ({
    React: R,
    h,
    render,
    result,
    container,
    root,
    sleep,
  }) => {
    const calls = [];
    const ref = { current: null };
    function App() {
      R.useEffect(() => {
        calls.push("mount");
        return () => calls.push("cleanup");
      }, []);
      return h("b", { ref }, "child");
    }
    await render(h(App));
    root.unmount();
    const syncEmpty = container.textContent === "";
    await sleep(20);
    let rejected = false;
    try {
      root.render(h("b"));
    } catch {
      rejected = true;
    }
    result.actual = {
      syncEmpty,
      calls,
      cleared: ref.current === null,
      rejected,
    };
    result.expected = {
      syncEmpty: true,
      calls: ["mount", "cleanup"],
      cleared: true,
      rejected: true,
    };
  },
  "external-store-consistency": async ({
    React: R,
    h,
    root,
    sleep,
    result,
    container,
  }) => {
    let value = 0,
      scheduled = false;
    const attached = [];
    const subscribe = () => () => {};
    function Reader() {
      const n = R.useSyncExternalStore(subscribe, () => value);
      return h(
        "b",
        {
          ref: (node) => {
            if (node) attached.push(node.textContent);
          },
        },
        n,
      );
    }
    function Slow() {
      if (!scheduled) {
        scheduled = true;
        setTimeout(() => {
          value = 1;
        }, 0);
      }
      const until = Date.now() + 2;
      while (Date.now() < until) {}
      return null;
    }
    R.startTransition(() =>
      root.render(
        h(
          "div",
          null,
          h(Reader),
          Array.from({ length: 40 }, (_, i) => h(Slow, { key: i })),
        ),
      ),
    );
    await sleep(500);
    result.actual = { text: container.textContent, attached };
    result.expected = { text: "1", attached: ["1"] };
  },
  "concurrent-context-rebase": async ({
    React: R,
    h,
    render,
    result,
    container,
    createRoot,
    flushSync,
    sleep,
  }) => {
    const C = R.createContext("default");
    let setN,
      setUrgent,
      scheduled = false;
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    const other = createRoot(outside);
    function Reader() {
      return h("b", null, R.useContext(C));
    }
    function Slow({ n }) {
      if (n === 10 && !scheduled) {
        scheduled = true;
        setTimeout(() => {
          flushSync(() => {
            setN((n) => n + 1);
            setUrgent(1);
          });
          flushSync(() => other.render(h(Reader)));
        }, 0);
      }
      const until = Date.now() + 2;
      while (Date.now() < until) {}
      return null;
    }
    function App() {
      const [n, s] = R.useState(0);
      setN = s;
      const [u, su] = R.useState(0);
      setUrgent = su;
      return h(
        C.Provider,
        { value: "inside" },
        h("span", null, n + ":" + u),
        n >= 10
          ? Array.from({ length: 40 }, (_, i) => h(Slow, { n, key: i }))
          : null,
      );
    }
    await render(h(App));
    R.startTransition(() => setN((n) => n + 10));
    await sleep(600);
    result.actual = {
      text: container.textContent,
      outside: outside.textContent,
    };
    result.expected = { text: "11:1", outside: "default" };
  },
  "lazy-wrappers": async ({ React: R, h, render, result, container }) => {
    const A = R.lazy(() =>
      Promise.resolve({ default: R.memo(() => h("b", null, "memo")) }),
    );
    const B = R.lazy(() =>
      Promise.resolve({
        default: R.forwardRef((_, ref) => h("b", { ref }, "forward")),
      }),
    );
    const ref = { current: null };
    await render(h(R.Suspense, { fallback: "loading" }, h(A), h(B, { ref })));
    result.actual = {
      text: container.textContent,
      ref: ref.current?.textContent,
    };
    result.expected = { text: "memoforward", ref: "forward" };
  },
  "scheduler-order": async ({ getScheduler, sleep, result }) => {
    const S = getScheduler(),
      calls = [];
    const task = S.unstable_scheduleCallback(S.unstable_NormalPriority, () =>
      calls.push("cancelled"),
    );
    S.unstable_cancelCallback(task);
    S.unstable_scheduleCallback(S.unstable_LowPriority, () => {
      calls.push("low");
    });
    S.unstable_scheduleCallback(S.unstable_NormalPriority, () => {
      calls.push("normal1");
      return () => {
        calls.push("normal2");
      };
    });
    S.unstable_scheduleCallback(S.unstable_ImmediatePriority, () => {
      calls.push("immediate");
    });
    await sleep(100);
    S.unstable_scheduleCallback(
      S.unstable_NormalPriority,
      () => {
        calls.push("delay");
      },
      { delay: 20 },
    );
    await sleep(100);
    result.actual = calls;
    result.expected = ["immediate", "normal1", "normal2", "low", "delay"];
  },
  "infinite-render-guard": async ({
    React: R,
    h,
    render,
    result,
    container,
  }) => {
    class Boundary extends R.Component {
      constructor(p) {
        super(p);
        this.state = { bad: false };
      }
      static getDerivedStateFromError() {
        return { bad: true };
      }
      render() {
        return this.state.bad ? "caught" : this.props.children;
      }
    }
    function Bad() {
      const [n, set] = R.useState(0);
      set(n + 1);
      return n;
    }
    await render(h(Boundary, null, h(Bad)));
    result.actual = container.textContent;
    result.expected = "caught";
  },

  "transition-suspense": async ({
    React: R,
    h,
    render,
    result,
    container,
    window,
    sleep,
  }) => {
    let resolved = false,
      resolve;
    const pending = new Promise((r) => {
      resolve = r;
    });
    function Child({ n }) {
      if (n === 1 && !resolved) throw pending;
      return h("b", null, "ready" + n);
    }
    function App() {
      const [n, set] = R.useState(0);
      const [p, start] = R.useTransition();
      return h(
        "div",
        null,
        h("button", { onClick: () => start(() => set(1)) }, String(p)),
        h(R.Suspense, { fallback: "loading" }, h(Child, { n })),
      );
    }
    await render(h(App));
    click(window, container.querySelector("button"));
    await sleep(100);
    const during = container.textContent;
    resolved = true;
    resolve();
    await sleep(150);
    result.actual = { during, after: container.textContent };
    result.expected = { during: "trueready0", after: "falseready1" };
  },
  "suspense-layout-reconnect": async ({
    React: R,
    h,
    render,
    result,
    sleep,
  }) => {
    let suspended = false,
      resolve;
    const pending = new Promise((r) => {
      resolve = r;
    });
    const calls = [];
    function Child() {
      R.useLayoutEffect(() => {
        calls.push("mount");
        return () => calls.push("cleanup");
      }, []);
      if (suspended) throw pending;
      return h("b", null, "ready");
    }
    function App({ tick }) {
      return h(R.Suspense, { fallback: "loading" }, h(Child, { tick }));
    }
    await render(h(App, { tick: 0 }));
    suspended = true;
    await render(h(App, { tick: 1 }));
    await sleep(750);
    suspended = false;
    resolve();
    await sleep(150);
    await render(null);
    result.actual = calls;
    result.expected = ["mount", "cleanup", "mount", "cleanup"];
  },
  "lazy-without-boundary": async ({
    React: R,
    h,
    render,
    result,
    container,
    sleep,
  }) => {
    const Lazy = R.lazy(() =>
      Promise.resolve({ default: () => h("b", null, "resolved") }),
    );
    await render(h(Lazy));
    await sleep(100);
    result.actual = container.textContent;
    result.expected = "resolved";
  },

  "error-boundary-update": async ({
    React: R,
    h,
    render,
    result,
    container,
    sleep,
  }) => {
    let set;
    const catches = [];
    class Boundary extends R.Component {
      constructor(p) {
        super(p);
        this.state = { bad: false };
      }
      static getDerivedStateFromError() {
        return { bad: true };
      }
      componentDidCatch(e) {
        catches.push(e.message);
      }
      render() {
        return this.state.bad ? h("b", null, "caught") : this.props.children;
      }
    }
    function Child() {
      const [n, s] = R.useState(0);
      set = s;
      if (n) throw Error("updated");
      return h("span", null, "ready");
    }
    await render(h(Boundary, null, h(Child)));
    set(1);
    await sleep(150);
    result.actual = { text: container.textContent, catches };
    result.expected = { text: "caught", catches: ["updated"] };
  },
  "passive-error-boundary": async ({
    React: R,
    h,
    render,
    result,
    container,
  }) => {
    class Boundary extends R.Component {
      constructor(p) {
        super(p);
        this.state = { bad: false };
      }
      static getDerivedStateFromError() {
        return { bad: true };
      }
      render() {
        return this.state.bad ? "caught" : this.props.children;
      }
    }
    function Child() {
      R.useEffect(() => {
        throw Error("passive");
      }, []);
      return "ready";
    }
    await render(h(Boundary, null, h(Child)));
    result.actual = container.textContent;
    result.expected = "caught";
  },
  "deleted-tree-error": async ({ React: R, h, render, result, container }) => {
    const catches = [];
    class Boundary extends R.Component {
      constructor(p) {
        super(p);
        this.state = { bad: false };
      }
      static getDerivedStateFromError() {
        return { bad: true };
      }
      componentDidCatch(e) {
        catches.push(this.props.name + ":" + e.message);
      }
      render() {
        return this.state.bad ? "caught" : this.props.children;
      }
    }
    function Child() {
      R.useEffect(
        () => () => {
          throw Error("cleanup");
        },
        [],
      );
      return "ready";
    }
    const app = (show) =>
      h(
        Boundary,
        { name: "outer" },
        show
          ? h(Boundary, { name: "removed" }, h(Child))
          : h("b", null, "replacement"),
      );
    await render(app(true));
    await render(app(false));
    result.actual = { text: container.textContent, catches };
    result.expected = { text: "caught", catches: ["outer:cleanup"] };
  },
  "class-lifecycle": async ({
    React: R,
    h,
    render,
    result,
    container,
    flushSync,
  }) => {
    const calls = [];
    let instance;
    class App extends R.Component {
      constructor(p) {
        super(p);
        this.state = { n: 0 };
        instance = this;
      }
      componentDidMount() {
        calls.push("mount:" + container.textContent);
      }
      getSnapshotBeforeUpdate(_, state) {
        calls.push("snapshot:" + container.textContent);
        return state.n;
      }
      componentDidUpdate(_, state, snapshot) {
        calls.push(
          "update:" + container.textContent + ":" + state.n + ":" + snapshot,
        );
      }
      componentWillUnmount() {
        calls.push("unmount:" + container.textContent);
      }
      render() {
        return h("b", null, this.state.n);
      }
    }
    await render(h(App));
    flushSync(() => {
      instance.setState(
        (n) => ({ n: n.n + 1 }),
        () => calls.push("callback:" + container.textContent),
      );
      instance.setState((n) => ({ n: n.n + 1 }));
    });
    await render(null);
    result.actual = calls;
    result.expected = [
      "mount:0",
      "snapshot:0",
      "update:2:0:0",
      "callback:2",
      "unmount:2",
    ];
  },
  "class-transition-rebase": async ({
    React: R,
    h,
    render,
    result,
    container,
    flushSync,
    sleep,
  }) => {
    let app;
    class App extends R.Component {
      constructor(p) {
        super(p);
        this.state = { n: 0 };
        app = this;
      }
      render() {
        return h("b", null, this.state.n);
      }
    }
    await render(h(App));
    R.startTransition(() => app.setState((s) => ({ n: s.n + 10 })));
    flushSync(() => app.setState((s) => ({ n: s.n + 1 })));
    await sleep(150);
    result.actual = container.textContent;
    result.expected = "11";
  },
  "pure-component": async ({
    React: R,
    h,
    render,
    result,
    container,
    flushSync,
  }) => {
    let instance,
      renders = 0;
    class App extends R.PureComponent {
      constructor(p) {
        super(p);
        this.state = { n: 0 };
        instance = this;
      }
      render() {
        renders++;
        return h("b", null, this.state.n);
      }
    }
    await render(h(App, { label: "same" }));
    await render(h(App, { label: "same" }));
    flushSync(() => instance.setState({ n: 0 }));
    const unchanged = renders;
    flushSync(() => instance.setState({ n: 1 }));
    result.actual = { unchanged, renders, text: container.textContent };
    result.expected = { unchanged: 1, renders: 2, text: "1" };
  },
  "hook-order-error": async ({ React: R, h, render, result, container }) => {
    class Boundary extends R.Component {
      constructor(p) {
        super(p);
        this.state = { bad: false };
      }
      static getDerivedStateFromError() {
        return { bad: true };
      }
      render() {
        return this.state.bad ? "caught" : this.props.children;
      }
    }
    function Child({ extra }) {
      R.useState(0);
      if (extra) R.useRef(null);
      return "ready";
    }
    await render(h(Boundary, null, h(Child, { extra: true })));
    await render(h(Boundary, null, h(Child, { extra: false })));
    result.actual = container.textContent;
    result.expected = "caught";
  },
  "memo-callback-closure": async ({
    React: R,
    h,
    render,
    result,
    container,
    window,
    sleep,
  }) => {
    let builds = 0;
    const calls = [];
    let previous;
    const identities = [];
    function App({ n }) {
      const doubled = R.useMemo(() => {
        builds++;
        return n * 2;
      }, [n]);
      const handler = R.useCallback(() => calls.push(n), []);
      identities.push(previous === undefined || previous === handler);
      previous = handler;
      return h("button", { onClick: handler }, doubled);
    }
    await render(h(App, { n: 1 }));
    await render(h(App, { n: 1 }));
    await render(h(App, { n: 2 }));
    click(window, container.firstChild);
    await sleep(10);
    result.actual = { text: container.textContent, builds, calls, identities };
    result.expected = {
      text: "4",
      builds: 2,
      calls: [1],
      identities: [true, true, true],
    };
  },
  "same-value-bailout": async ({ React: R, h, render, result, sleep }) => {
    let set,
      renders = 0;
    function App() {
      const [n, s] = R.useState(0);
      set = s;
      renders++;
      return n;
    }
    await render(h(App));
    set(0);
    await sleep(75);
    result.actual = renders;
    result.expected = 1;
  },
  "promise-batch-flushsync": async ({
    React: R,
    h,
    render,
    result,
    container,
    flushSync,
    sleep,
  }) => {
    let set;
    const commits = [];
    function App() {
      const [n, s] = R.useState(0);
      set = s;
      R.useLayoutEffect(() => {
        commits.push(n);
      }, [n]);
      return h("b", null, n);
    }
    await render(h(App));
    await Promise.resolve().then(() => {
      set((n) => n + 1);
      set((n) => n + 1);
    });
    await sleep(75);
    let syncText;
    flushSync(() => {
      set((n) => n + 1);
    });
    syncText = container.textContent;
    result.actual = { commits, syncText };
    result.expected = { commits: [0, 2, 3], syncText: "3" };
  },
  "controlled-select-options": async ({ h, render, result, container }) => {
    await render(
      h(
        "select",
        { value: "b", onChange: () => {} },
        h("option", { value: "a" }, "A"),
      ),
    );
    const before = container.firstChild.value;
    await render(
      h(
        "select",
        { value: "b", onChange: () => {} },
        h("option", { value: "a" }, "A"),
        h("option", { value: "b" }, "B"),
      ),
    );
    result.actual = { before, after: container.firstChild.value };
    result.expected = { before: "a", after: "b" };
  },
  "select-default-reset": async ({ h, render, result, container, window }) => {
    await render(
      h(
        "form",
        null,
        h(
          "select",
          { defaultValue: "b" },
          h("option", { value: "a" }, "A"),
          h("option", { value: "b" }, "B"),
        ),
      ),
    );
    const form = container.firstChild,
      select = form.firstChild;
    select.value = "a";
    form.reset();
    result.actual = select.value;
    result.expected = "b";
  },
  "controlled-radio-restore": async ({
    h,
    render,
    result,
    container,
    window,
    sleep,
  }) => {
    await render(
      h(
        "div",
        null,
        h("input", {
          type: "radio",
          name: "group",
          checked: true,
          onChange: () => {},
        }),
        h("input", {
          type: "radio",
          name: "group",
          checked: false,
          onChange: () => {},
        }),
      ),
    );
    const inputs = container.querySelectorAll("input");
    click(window, inputs[1]);
    await sleep(20);
    result.actual = [...inputs].map((n) => n.checked);
    result.expected = [true, false];
  },
  "strict-class": async ({ React: R, h, render, result }) => {
    let constructs = 0,
      renders = 0;
    const calls = [];
    class App extends R.Component {
      constructor(p) {
        super(p);
        constructs++;
      }
      componentDidMount() {
        calls.push("mount");
      }
      componentWillUnmount() {
        calls.push("unmount");
      }
      render() {
        renders++;
        return h("b", null, "ready");
      }
    }
    await render(h(R.StrictMode, null, h(App)));
    await render(null);
    result.actual = { constructs, renders, calls };
    result.expected =
      process.env.NODE_ENV === "production"
        ? { constructs: 1, renders: 1, calls: ["mount", "unmount"] }
        : {
            constructs: 2,
            renders: 2,
            calls: ["mount", "unmount", "mount", "unmount"],
          };
  },
  "use-id": async ({ React: R, h, render, result, container }) => {
    function Child() {
      const id = R.useId();
      return h("input", { id });
    }
    await render(h("div", null, h(Child), h(Child)));
    const before = [...container.querySelectorAll("input")].map((n) => n.id);
    await render(h("div", null, h(Child), h(Child)));
    const after = [...container.querySelectorAll("input")].map((n) => n.id);
    result.actual = {
      stable: JSON.stringify(before) === JSON.stringify(after),
      distinct: new Set(before).size === 2,
      nonempty: before.every(Boolean),
    };
    result.expected = { stable: true, distinct: true, nonempty: true };
  },

  "sync-effect-timing": async ({
    React: R,
    h,
    render,
    result,
    flushSync,
    sleep,
  }) => {
    const calls = [];
    let set;
    function App() {
      const [n, s] = R.useState(0);
      set = s;
      R.useEffect(() => {
        calls.push("effect:" + n);
        return () => calls.push("cleanup:" + n);
      }, [n]);
      return n;
    }
    await render(h(App));
    flushSync(() => set(1));
    calls.push("flush returned");
    await sleep(20);
    result.actual = calls;
    result.expected = ["effect:0", "cleanup:0", "effect:1", "flush returned"];
  },
  "sync-suspense-error": async ({
    React: R,
    h,
    render,
    result,
    flushSync,
    container,
  }) => {
    let set;
    const pending = new Promise(() => {});
    class Boundary extends R.Component {
      constructor(p) {
        super(p);
        this.state = { bad: false };
      }
      static getDerivedStateFromError() {
        return { bad: true };
      }
      render() {
        return this.state.bad ? "caught" : this.props.children;
      }
    }
    function Child() {
      const [n, s] = R.useState(0);
      set = s;
      if (n) throw pending;
      return "ready";
    }
    await render(h(Boundary, null, h(Child)));
    flushSync(() => set(1));
    result.actual = container.textContent;
    result.expected = "caught";
  },
  "ref-cleanup-error": async ({ React: R, h, render, result, container }) => {
    class Boundary extends R.Component {
      constructor(p) {
        super(p);
        this.state = { bad: false };
      }
      static getDerivedStateFromError() {
        return { bad: true };
      }
      render() {
        return this.state.bad ? "caught" : this.props.children;
      }
    }
    const ref = (node) => {
      if (node === null) throw Error("detach");
    };
    await render(h(Boundary, null, h("b", { ref }, "ready")));
    await render(h(Boundary, null, h("b", null, "next")));
    result.actual = container.textContent;
    result.expected = "caught";
  },
  "cancelled-state-effect": async ({
    React: R,
    h,
    render,
    result,
    container,
    window,
    sleep,
  }) => {
    const calls = [];
    function App() {
      const [n, set] = R.useState(0);
      R.useLayoutEffect(() => {
        calls.push("layout:" + n);
      });
      R.useEffect(() => {
        calls.push("passive:" + n);
      });
      return h(
        "button",
        {
          onClick: () => {
            set(1);
            set(0);
          },
        },
        n,
      );
    }
    await render(h(App));
    click(window, container.firstChild);
    await sleep(75);
    result.actual = { text: container.textContent, calls };
    result.expected = { text: "0", calls: ["layout:0", "passive:0"] };
  },
  "derived-state-rebase": async ({
    React: R,
    h,
    render,
    result,
    container,
    flushSync,
    sleep,
  }) => {
    let app;
    class App extends R.Component {
      constructor(p) {
        super(p);
        this.state = { n: 0 };
        app = this;
      }
      static getDerivedStateFromProps(props) {
        return { label: props.label };
      }
      render() {
        return h("b", null, this.state.n + ":" + this.state.label);
      }
    }
    await render(h(App, { label: "x" }));
    R.startTransition(() => app.setState((s) => ({ n: s.n + 10 })));
    flushSync(() => app.setState((s) => ({ n: s.n + 1 })));
    await sleep(150);
    result.actual = container.textContent;
    result.expected = "11:x";
  },
  "find-dom-node": async ({
    React: R,
    h,
    render,
    result,
    findDOMNode,
  }) => {
    let inst;
    class App extends R.Component {
      render() {
        inst = this;
        return h("div", null, "hi");
      }
    }
    await render(h(App));
    const node = findDOMNode(inst);
    const same = findDOMNode(node);
    let threw = false;
    try {
      findDOMNode({ foo: "bar" });
    } catch (error) {
      threw = true;
    }
    result.actual = {
      tag: node && node.tagName,
      text: node && node.textContent,
      same: same === node,
      nullish: findDOMNode(null),
      threw,
    };
    result.expected = {
      tag: "DIV",
      text: "hi",
      same: true,
      nullish: null,
      threw: true,
    };
  },
};
