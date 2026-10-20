// 新增组合回归。原 audit/scenarios.cjs 的 21 个反例原样保留，期望值不改动。
module.exports = {
  ...require("../../docs/reviews/react18.3.1-independent-audit/scenarios.cjs"),
  "html-bidirectional-content": async ({ h, render, container }) => {
    const values = [];
    for (const props of [
      { dangerouslySetInnerHTML: { __html: "<b>A</b>" } },
      { children: h("i", null, "B") },
      { dangerouslySetInnerHTML: { __html: "<u>C</u>" } },
      { children: "D" },
      { dangerouslySetInnerHTML: { __html: "" } },
      { children: [h("em", { key: "e" }, "E"), "F"] },
      {},
    ]) {
      render(h("section", props));
      values.push(container.firstChild.innerHTML);
    }
    return {
      actual: values,
      expected: [
        "<b>A</b>",
        "<i>B</i>",
        "<u>C</u>",
        "D",
        "",
        "<em>E</em>F",
        "",
      ],
    };
  },
  "hidden-reveal-delete-lifecycle": async ({
    React: R,
    h,
    render,
    container,
  }) => {
    const log = [];
    const never = new Promise(() => {});
    class Child extends R.Component {
      componentDidMount() {
        log.push("mount");
      }
      componentWillUnmount() {
        log.push("unmount");
      }
      render() {
        return h("b", null, "child");
      }
    }
    const child = h(Child);
    function Pending({ hidden }) {
      if (hidden) throw never;
      return null;
    }
    function App({ hidden }) {
      return h(R.Suspense, { fallback: "wait" }, child, h(Pending, { hidden }));
    }
    render(h(App, { hidden: false }));
    render(h(App, { hidden: true }));
    render(h(App, { hidden: false }));
    const visible = container.textContent;
    render(null);
    return {
      actual: { visible, log },
      expected: {
        visible: "child",
        log: ["mount", "unmount", "mount", "unmount"],
      },
    };
  },
  "hidden-update-then-reveal": async ({
    React: R,
    h,
    render,
    flushSync,
    container,
    sleep,
  }) => {
    let set;
    const never = new Promise(() => {});
    const effects = [];
    function Child() {
      const [n, s] = R.useState(0);
      set = s;
      R.useLayoutEffect(() => {
        effects.push("mount" + n);
        return () => effects.push("clean" + n);
      }, [n]);
      return h("b", null, n);
    }
    function Pending({ hidden }) {
      if (hidden) throw never;
      return null;
    }
    const child = h(Child);
    function App({ hidden }) {
      return h(
        R.Suspense,
        { fallback: h("i", null, "wait") },
        child,
        h(Pending, { hidden }),
      );
    }
    render(h(App, { hidden: false }));
    render(h(App, { hidden: true }));
    flushSync(() => set(1));
    await sleep(20);
    render(h(App, { hidden: false }));
    const text = container.textContent;
    render(null);
    return {
      actual: { text, effects },
      expected: {
        text: "1",
        effects: ["mount0", "clean0", "mount1", "clean1"],
      },
    };
  },
  "class-context-constructor-scu": async ({
    React: R,
    h,
    render,
    container,
  }) => {
    const C = R.createContext("default");
    let constructed;
    let scu = 0;
    class Reader extends R.Component {
      static contextType = C;
      constructor(p, c) {
        super(p, c);
        constructed = c;
      }
      shouldComponentUpdate() {
        scu++;
        return false;
      }
      render() {
        return h("b", null, this.context);
      }
    }
    const child = h(Reader);
    render(h(C.Provider, { value: "a" }, child));
    render(h(C.Provider, { value: "b" }, child));
    return {
      actual: [constructed, container.textContent, scu],
      expected: ["a", "b", 0],
    };
  },
  "lazy-default-props-update": async ({
    React: R,
    h,
    render,
    container,
    waitFor,
  }) => {
    function Child({ text }) {
      return h("b", null, text);
    }
    Child.defaultProps = { text: "default" };
    const Lazy = R.lazy(() => Promise.resolve({ default: Child }));
    const ui = (text) => h(R.Suspense, { fallback: "wait" }, h(Lazy, { text }));
    render(ui(undefined));
    await waitFor(() => container.textContent === "default", "lazy resolves");
    const values = [container.textContent];
    render(ui("changed"));
    values.push(container.textContent);
    render(ui(undefined));
    values.push(container.textContent);
    return { actual: values, expected: ["default", "changed", "default"] };
  },
  "portal-state-event-reorder": async ({
    React: R,
    ReactDOM: D,
    h,
    render,
    flushSync,
    container,
  }) => {
    const portal = document.createElement("aside");
    document.body.appendChild(portal);
    const log = [];
    function App({ reverse }) {
      const [n, set] = R.useState(0);
      return h(
        "section",
        { onClick: () => log.push("parent") },
        D.createPortal(
          [
            h(
              "button",
              {
                key: "b",
                onClick: () => {
                  log.push("button");
                  set((x) => x + 1);
                },
              },
              n,
            ),
            h("i", { key: "i" }, "tail"),
          ].sort((a, b) =>
            reverse ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key),
          ),
          portal,
        ),
      );
    }
    render(h(App, { reverse: false }));
    flushSync(() => portal.querySelector("button").click());
    render(h(App, { reverse: true }));
    const actual = {
      text: portal.textContent,
      log,
      main: container.textContent,
    };
    render(null);
    portal.remove();
    return {
      actual,
      expected: { text: "tail1", log: ["button", "parent"], main: "" },
    };
  },
  "host-context-svg-portal-document": async ({
    ReactDOM: D,
    h,
    render,
    container,
  }) => {
    const other = document.implementation.createHTMLDocument("other");
    const portal = other.createElementNS("http://www.w3.org/2000/svg", "svg");
    other.body.appendChild(portal);
    render(
      h(
        "svg",
        null,
        h("g", null, h("circle")),
        h("foreignObject", null, h("div", null, "html")),
        D.createPortal(h("circle"), portal),
      ),
    );
    const actual = [
      container.querySelector("circle").namespaceURI,
      container.querySelector("div").namespaceURI,
      portal.firstChild.namespaceURI,
      portal.firstChild.ownerDocument === other,
    ];
    return {
      actual,
      expected: [
        "http://www.w3.org/2000/svg",
        "http://www.w3.org/1999/xhtml",
        "http://www.w3.org/2000/svg",
        true,
      ],
    };
  },
  "native-event-priority": async ({ React: R, h, render, container }) => {
    let set;
    function App() {
      const [n, s] = R.useState(0);
      set = s;
      return h("b", null, n);
    }
    render(h(App));
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.addEventListener("click", () => set(1));
    button.click();
    await Promise.resolve();
    const actual = container.textContent;
    button.remove();
    return { actual, expected: "1" };
  },
  "root-error-surfaces-and-recovers": async ({ h, render, container }) => {
    function Bad() {
      throw new Error("root-failure");
    }
    let caught;
    try {
      render(h(Bad));
    } catch (e) {
      caught = e.message;
    }
    const empty = container.textContent;
    render(h("b", null, "recovered"));
    return {
      actual: [caught, empty, container.textContent],
      expected: ["root-failure", "", "recovered"],
    };
  },
  "layout-nested-update-limit": async ({ React: R, h, render, container }) => {
    const errors = [];
    class Boundary extends R.Component {
      state = { bad: false };
      static getDerivedStateFromError() {
        return { bad: true };
      }
      componentDidCatch(e) {
        errors.push(
          /Maximum update depth/.test(e.message) || e.message.includes("#185"),
        );
      }
      render() {
        return this.state.bad ? h("i", null, "caught") : this.props.children;
      }
    }
    function Loop() {
      const [n, set] = R.useState(0);
      R.useLayoutEffect(() => set(n + 1));
      return h("b", null, n);
    }
    render(h(Boundary, null, h(Loop)));
    return {
      actual: [container.textContent, errors],
      expected: ["caught", [true]],
    };
  },
  "layout-cross-root-flushsync": async ({
    React: R,
    h,
    render,
    makeRoot,
    flushSync,
    container,
    sleep,
  }) => {
    const other = document.createElement("aside");
    document.body.appendChild(other);
    const r = makeRoot(other);
    const log = [];
    function Child() {
      R.useEffect(() => {
        log.push("effect-b");
        return () => log.push("clean-b");
      }, []);
      return h("b", null, "B");
    }
    function App() {
      R.useLayoutEffect(() => {
        flushSync(() => r.render(h(Child)));
        log.push("layout-a");
      }, []);
      R.useEffect(() => {
        log.push("effect-a");
        return () => log.push("clean-a");
      }, []);
      return h("i", null, "A");
    }
    render(h(App));
    await sleep(20);
    const actual = {
      text: container.textContent + other.textContent,
      log: [...log],
    };
    return {
      actual,
      expected: { text: "AB", log: ["layout-a", "effect-a", "effect-b"] },
    };
  },
  "select-multiple-default-toggle": async ({ h, render, container }) => {
    const values = [];
    const options = [
      h("option", { key: "a", value: "a" }, "A"),
      h("option", { key: "b", value: "b" }, "B"),
    ];
    for (const props of [
      { multiple: true, defaultValue: ["b"] },
      { multiple: false },
      { multiple: true },
      { multiple: false, defaultValue: "b" },
    ]) {
      render(h("select", props, options));
      values.push(
        [...container.firstChild.selectedOptions].map((o) => o.value),
      );
    }
    return { actual: values, expected: [["b"], ["a"], [], ["b"]] };
  },
  "textarea-default-value-reset": async ({ h, render, container }) => {
    render(
      h(
        "form",
        null,
        h("textarea", { value: "live", defaultValue: "reset", onChange() {} }),
      ),
    );
    const form = container.firstChild,
      ta = form.firstChild;
    const values = [ta.value, ta.defaultValue];
    render(
      h(
        "form",
        null,
        h("textarea", { value: "next", defaultValue: "reset2", onChange() {} }),
      ),
    );
    values.push(ta.value, ta.defaultValue);
    form.reset();
    values.push(ta.value);
    return {
      actual: values,
      expected: ["live", "live", "next", "reset2", "reset2"],
    };
  },
  "input-default-value-removed": async ({ h, render, container }) => {
    render(h("input", { defaultValue: "initial" }));
    const input = container.firstChild;
    input.value = "typed";
    render(h("input", { defaultValue: "changed" }));
    const values = [input.value, input.defaultValue];
    render(h("input", {}));
    values.push(input.value, input.defaultValue);
    render(h("input", { type: "submit", value: null }));
    values.push(input.hasAttribute("value"));
    return {
      actual: values,
      expected: ["typed", "changed", "typed", "changed", false],
    };
  },
  "controlled-number-blur": async ({ h, render, container }) => {
    render(h("input", { type: "number", value: 1, onChange() {} }));
    const input = container.firstChild;
    input.focus();
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set.call(input, "1.0");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const values = [input.value, input.defaultValue];
    input.blur();
    values.push(input.value, input.defaultValue);
    return { actual: values, expected: ["1.0", "1", "1.0", "1.0"] };
  },
  "context-error-boundary-resume": async ({
    React: R,
    h,
    render,
    container,
  }) => {
    const C = R.createContext("default");
    class Boundary extends R.Component {
      static contextType = C;
      state = { bad: false };
      static getDerivedStateFromError() {
        return { bad: true };
      }
      render() {
        return this.state.bad
          ? h("b", null, this.context)
          : this.props.children;
      }
    }
    function Bad() {
      throw new Error("child");
    }
    const child = h(Boundary, null, h(Bad));
    render(h(C.Provider, { value: "a" }, child));
    const first = container.textContent;
    render(h(C.Provider, { value: "b" }, child));
    return { actual: [first, container.textContent], expected: ["a", "b"] };
  },
  "legacy-boundary-didcatch-throws": async ({
    React: R,
    h,
    render,
    container,
  }) => {
    const log = [];
    class Outer extends R.Component {
      state = { bad: false };
      static getDerivedStateFromError() {
        return { bad: true };
      }
      componentDidCatch() {
        log.push("outer");
      }
      render() {
        return this.state.bad ? h("b", null, "recovered") : this.props.children;
      }
    }
    class Inner extends R.Component {
      componentDidCatch() {
        log.push("inner");
        throw new Error("didCatch");
      }
      render() {
        return this.props.children;
      }
    }
    function Bad() {
      throw new Error("child");
    }
    render(h(Outer, null, h(Inner, null, h(Bad))));
    return {
      actual: [container.textContent, log],
      expected: ["recovered", ["inner", "outer"]],
    };
  },
  "passive-cleanup-updates-other-root": async ({
    React: R,
    h,
    render,
    makeRoot,
    flushSync,
    sleep,
  }) => {
    const node = document.createElement("aside");
    document.body.appendChild(node);
    const other = makeRoot(node);
    const log = [];
    function B() {
      R.useEffect(() => {
        log.push("b mount");
      }, []);
      return h("b", null, "B");
    }
    function A() {
      R.useEffect(() => {
        log.push("a mount");
        return () => {
          log.push("a clean");
          flushSync(() => other.render(h(B)));
        };
      }, []);
      return h("i", null, "A");
    }
    render(h(A));
    render(null);
    await sleep(20);
    return {
      actual: { text: node.textContent, log: [...log] },
      expected: { text: "B", log: ["a mount", "a clean", "b mount"] },
    };
  },
  "scheduler-priority-context": async ({ getScheduler }) => {
    const S = getScheduler(),
      values = [];
    let wrapped;
    S.unstable_runWithPriority(S.unstable_UserBlockingPriority, () => {
      values.push(S.unstable_getCurrentPriorityLevel());
      wrapped = S.unstable_wrapCallback(() =>
        values.push(S.unstable_getCurrentPriorityLevel()),
      );
      S.unstable_next(() => values.push(S.unstable_getCurrentPriorityLevel()));
    });
    wrapped();
    values.push(S.unstable_getCurrentPriorityLevel());
    return { actual: values, expected: [2, 3, 2, 3] };
  },
  "scheduler-time-refresh": async ({ getScheduler, waitFor }) => {
    const S = getScheduler(),
      log = [];
    S.unstable_scheduleCallback(S.unstable_NormalPriority, () => {
      S.unstable_scheduleCallback(
        S.unstable_ImmediatePriority,
        () => log.push("immediate"),
        { delay: 5 },
      );
      const until = S.unstable_now() + 12;
      while (S.unstable_now() < until) {}
      log.push("first");
    });
    S.unstable_scheduleCallback(S.unstable_NormalPriority, () =>
      log.push("second"),
    );
    await waitFor(() => log.length === 3, "scheduler delayed immediate");
    return { actual: log, expected: ["first", "immediate", "second"] };
  },
};
