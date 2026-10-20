import React from "@runtime/react";
import ReactDOM from "@runtime/dom";
import { createRoot } from "@runtime/client";
import * as S from "@runtime/scheduler";

const h = React.createElement;
const { flushSync, createPortal } = ReactDOM;
const $ = (id) => document.getElementById(id);
const observations = [],
  inputEvents = [],
  frameTrace = [],
  errors = [];
const keys = {};
const record = (name, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  observations.push({ name, actual, expected, pass });
  show();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(r));
async function until(test) {
  const end = performance.now() + 4000;
  while (!test()) {
    if (performance.now() > end) throw Error("Timed out");
    await sleep(5);
  }
}
const serializeError = (event) => {
  errors.push(String(event.error || event.reason || event.message));
  show();
};
window.addEventListener("error", serializeError);
window.addEventListener("unhandledrejection", serializeError);
function data() {
  return {
    runtime: __RUNTIME__,
    mode: __MODE__,
    reactVersion: React.version,
    domVersion: ReactDOM.version,
    browser: navigator.userAgent,
    generatedAt: new Date().toISOString(),
    visibility: document.visibilityState,
    observations,
    inputEvents,
    keys,
    frameTrace,
    errors,
  };
}
function show() {
  $("results").textContent = JSON.stringify(data(), null, 2);
  $("status").textContent =
    `${observations.filter((x) => x.pass).length}/${observations.length} PASS; errors=${errors.length}`;
}
async function save() {
  show();
  const response = await fetch("/results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data()),
  });
  if (!response.ok) throw Error("Saving failed");
  $("status").textContent += "；已保存";
}
const formState = {};
function event(id, e) {
  inputEvents.push({
    id,
    type: e.type,
    trusted: e.nativeEvent.isTrusted,
    value: e.target.value,
    checked: e.target.checked,
  });
}
function Forms() {
  const [text, setText] = React.useState("");
  const [number, setNumber] = React.useState(2);
  const [checked, setChecked] = React.useState(false);
  const [radio, setRadio] = React.useState("a");
  const [option, setOption] = React.useState("a");
  const [area, setArea] = React.useState("");
  Object.assign(formState, { text, number, checked, radio, option, area });
  const field = (name, node) => h("label", { key: name }, name, node);
  return h(
    React.Fragment,
    null,
    field(
      "动态文本",
      h("input", {
        id: "text",
        value: text,
        onChange(e) {
          event("text", e);
          setText(e.target.value);
        },
      }),
    ),
    field(
      "固定文本",
      h("input", {
        id: "frozen",
        value: 2,
        onChange(e) {
          event("frozen", e);
        },
      }),
    ),
    field(
      "数字",
      h("input", {
        id: "number",
        type: "number",
        value: number,
        onChange(e) {
          event("number", e);
          setNumber(Number(e.target.value));
        },
      }),
    ),
    field(
      "勾选",
      h("input", {
        id: "check",
        type: "checkbox",
        checked,
        onChange(e) {
          event("check", e);
          setChecked(e.target.checked);
        },
      }),
    ),
    field(
      "固定勾选",
      h("input", {
        id: "frozen-check",
        type: "checkbox",
        checked: false,
        onChange(e) {
          event("frozen-check", e);
        },
      }),
    ),
    ...["a", "b"].map((value) =>
      field(
        "单选" + value,
        h("input", {
          id: "radio-" + value,
          type: "radio",
          name: "choice",
          value,
          checked: radio === value,
          onChange(e) {
            event("radio", e);
            setRadio(value);
          },
        }),
      ),
    ),
    field(
      "下拉",
      h(
        "select",
        {
          id: "select",
          value: option,
          onChange(e) {
            event("select", e);
            setOption(e.target.value);
          },
        },
        h("option", { value: "a" }, "Alpha"),
        h("option", { value: "b" }, "Beta"),
      ),
    ),
    field(
      "多行",
      h("textarea", {
        id: "area",
        value: area,
        onChange(e) {
          event("area", e);
          setArea(e.target.value);
        },
      }),
    ),
    h(
      "div",
      {
        onClick(e) {
          event("portal-parent", e);
        },
      },
      createPortal(
        h(
          "button",
          {
            id: "portal-button",
            onClick(e) {
              event("portal-child", e);
            },
          },
          "Portal 点击",
        ),
        $("portal"),
      ),
    ),
  );
}
const formsRoot = createRoot($("forms"));
flushSync(() => formsRoot.render(h(Forms)));
document.addEventListener("keyup", (e) => {
  if (["text", "number"].includes(e.target.id))
    keys[e.target.id] = {
      value: e.target.value,
      defaultValue: e.target.defaultValue,
      selectionStart: e.target.selectionStart,
      selectionEnd: e.target.selectionEnd,
      focused: document.activeElement === e.target,
      trusted: e.isTrusted,
    };
});
// The root's focusout handler runs before this document listener. Record blur
// here: later sibling updates re-render Forms and synchronize defaultValue to 2.
document.addEventListener("focusout", (e) => {
  if (e.target.id === "number")
    keys.numberBlur = {
      value: e.target.value,
      defaultValue: e.target.defaultValue,
      trusted: e.isTrusted,
    };
});
$("capture").addEventListener("click", async () => {
  record(
    "trusted-text-caret",
    {
      value: $("text").value,
      model: formState.text,
      caret: keys.text?.selectionStart,
      trusted: keys.text?.trusted,
    },
    { value: "abXcd", model: "abXcd", caret: 3, trusted: true },
  );
  record("trusted-frozen-text", $("frozen").value, "2");
  record("trusted-number-focus", keys.number, {
    value: "2.0",
    defaultValue: "2",
    selectionStart: null,
    selectionEnd: null,
    focused: true,
    trusted: true,
  });
  record("trusted-number-blur", keys.numberBlur, {
    value: "2.0",
    defaultValue: "2.0",
    trusted: true,
  });
  record(
    "trusted-number-sibling-rerender",
    {
      value: $("number").value,
      defaultValue: $("number").defaultValue,
      model: formState.number,
    },
    { value: "2.0", defaultValue: "2", model: 2 },
  );
  record(
    "trusted-checkbox",
    {
      dom: $("check").checked,
      model: formState.checked,
      restored: $("frozen-check").checked,
    },
    { dom: true, model: true, restored: false },
  );
  record(
    "trusted-radio",
    {
      a: $("radio-a").checked,
      b: $("radio-b").checked,
      model: formState.radio,
    },
    { a: false, b: true, model: "b" },
  );
  record(
    "trusted-select",
    { dom: $("select").value, model: formState.option },
    { dom: "b", model: "b" },
  );
  record(
    "trusted-textarea",
    { dom: $("area").value, model: formState.area },
    { dom: "line one", model: "line one" },
  );
  record(
    "trusted-portal",
    inputEvents
      .filter((x) => x.id.startsWith("portal"))
      .map((x) => [x.id, x.trusted]),
    [
      ["portal-child", true],
      ["portal-parent", true],
    ],
  );
  record(
    "trusted-change-coverage",
    [
      "text",
      "frozen",
      "number",
      "check",
      "frozen-check",
      "radio",
      "select",
      "area",
    ].map((id) => inputEvents.some((e) => e.id === id && e.trusted)),
    Array(8).fill(true),
  );
  await save();
});
async function isolated(run) {
  const container = document.createElement("div");
  $("sandbox").append(container);
  const root = createRoot(container);
  const render = (el) => flushSync(() => root.render(el));
  try {
    await run({ container, root, render });
  } finally {
    flushSync(() => root.unmount());
    container.remove();
  }
}
$("auto").addEventListener("click", async () => {
  $("auto").disabled = true;
  try {
    await isolated(async ({ container, render }) => {
      // ReactDOMInput-test.js: only assigns defaultValue if it changes.
      render(h("input", { defaultValue: "0" }));
      const node = container.firstChild;
      let writes = 0;
      Object.defineProperty(node, "defaultValue", {
        configurable: true,
        get: () => "0",
        set() {
          writes++;
        },
      });
      render(h("input", { defaultValue: "0" }));
      record("official-input-defaultValue-no-reassign", writes, 0);
    });
    await isolated(async ({ container, render }) => {
      // ReactDOMInput-test.js: numeric zero and string precision.
      const values = [];
      for (const value of ["", 0, "3.0000", "3"]) {
        render(h("input", { type: "number", value, readOnly: true }));
        values.push(container.firstChild.value);
      }
      record("official-number-zero-and-precision", values, [
        "",
        "0",
        "3.0000",
        "3",
      ]);
    });
    await isolated(async ({ container, render }) => {
      // ReactDOMSelect-test.js: changing defaultValue leaves multiple selections.
      const options = ["monkey", "giraffe", "gorilla"].map((value) =>
        h("option", { key: value, value }, value),
      );
      const values = [];
      for (const defaultValue of [["giraffe", "gorilla"], ["monkey"]]) {
        render(h("select", { multiple: true, defaultValue }, options));
        values.push([...container.firstChild.options].map((o) => o.selected));
      }
      record("official-select-multiple-default", values, [
        [false, true, true],
        [false, true, true],
      ]);
    });
    await isolated(async ({ container, render }) => {
      // ReactFlushSync-test.js: sync render flushes its passive effects.
      const log = [];
      function App() {
        React.useLayoutEffect(() => {
          log.push("layout:" + container.textContent);
        }, []);
        React.useEffect(() => {
          log.push("passive:" + container.textContent);
        }, []);
        return h("span", null, "committed");
      }
      render(h(App));
      log.push("returned");
      record("official-sync-passive-and-layout", log, [
        "layout:committed",
        "passive:committed",
        "returned",
      ]);
    });
    await isolated(async ({ container, render }) => {
      const log = [];
      function App() {
        const [n, set] = React.useState(0);
        React.useLayoutEffect(() => {
          log.push("layout:" + n);
          if (!n) set(1);
        }, [n]);
        React.useEffect(() => {
          log.push("passive:" + n);
        }, [n]);
        return h("strong", null, n);
      }
      render(h(App));
      const returned = container.textContent;
      const t = await frame();
      record(
        "layout-update-before-next-frame",
        { returned, frame: container.textContent, log },
        {
          returned: "1",
          frame: "1",
          log: ["layout:0", "passive:0", "layout:1", "passive:1"],
        },
      );
      frameTrace.push({
        kind: "layout-update-frame",
        t,
        dom: container.textContent,
      });
    });
    await isolated(async ({ container, root }) => {
      const log = [];
      function App() {
        React.useLayoutEffect(() => {
          log.push("layout");
        }, []);
        React.useEffect(() => {
          log.push("passive");
        }, []);
        return h("i", null, "async");
      }
      root.render(h(App));
      const immediate = container.textContent;
      await until(() => log.includes("passive"));
      await frame();
      record(
        "default-render-deferred-commit",
        { immediate, final: container.textContent, log },
        { immediate: "", final: "async", log: ["layout", "passive"] },
      );
    });
    // Scheduler-test.js continuation/cancellation; SetTimeout-test priority order.
    {
      const log = [];
      const task = S.unstable_scheduleCallback(S.unstable_NormalPriority, () =>
        log.push("cancelled"),
      );
      S.unstable_cancelCallback(task);
      for (const [priority, label] of [
        [S.unstable_NormalPriority, "A"],
        [S.unstable_NormalPriority, "B"],
        [S.unstable_UserBlockingPriority, "C"],
        [S.unstable_UserBlockingPriority, "D"],
      ])
        S.unstable_scheduleCallback(priority, () => {
          log.push(label);
        });
      await until(() => log.length === 4);
      record("official-scheduler-priority-cancel", log, ["C", "D", "A", "B"]);
      const continuation = [];
      S.unstable_scheduleCallback(S.unstable_NormalPriority, () => {
        continuation.push("task");
        queueMicrotask(() => continuation.push("microtask"));
        const deadline = performance.now() + 100;
        while (!S.unstable_shouldYield() && performance.now() < deadline) {
          /* real host time */
        }
        return () => {
          continuation.push("continuation");
        };
      });
      await until(() => continuation.length === 3);
      record("official-scheduler-continuation-yields", continuation, [
        "task",
        "microtask",
        "continuation",
      ]);
    }
    await isolated(async ({ container, render }) => {
      let update,
        rendered = 0;
      let tracking = true;
      const samples = [];
      function Slow({ n }) {
        if (n) {
          const end = performance.now() + 0.7;
          while (performance.now() < end) {
            /* bounded CPU workload */
          }
          rendered++;
        }
        return h("span", null, n ? "B" : "A");
      }
      function App() {
        const [n, set] = React.useState(0);
        update = set;
        return h(
          "div",
          null,
          ...Array.from({ length: 120 }, (_, i) => h(Slow, { key: i, n })),
        );
      }
      render(h(App));
      function sample(t) {
        const text = container.textContent;
        samples.push({
          t,
          rendered,
          dom: text[0],
          length: text.length,
          homogeneous: text === text[0]?.repeat(120),
        });
        if (tracking) requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
      React.startTransition(() => update(1));
      await until(() => container.textContent[0] === "B");
      await frame();
      tracking = false;
      frameTrace.push(...samples.map((s) => ({ kind: "transition", ...s })));
      record(
        "transition-keeps-committed-dom-between-slices",
        {
          intermediateFrame: samples.some(
            (s) => s.rendered > 0 && s.rendered < 120 && s.dom === "A",
          ),
          atomic: samples.every(
            (s) =>
              s.homogeneous &&
              s.length === 120 &&
              (s.dom === "A" || s.dom === "B"),
          ),
          final: container.textContent === "B".repeat(120),
        },
        { intermediateFrame: true, atomic: true, final: true },
      );
      $("visual").textContent =
        "已观察：Transition 分片期间保留旧 DOM；提交后显示 B × 120。";
    });
  } catch (error) {
    errors.push(String(error.stack || error));
  }
  await save();
});
show();
