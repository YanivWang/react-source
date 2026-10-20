const { test, after } = require("node:test");
const { writeFileSync, mkdirSync } = require("node:fs");
const observations = [];
after(() => {
  const directory = path.resolve(__dirname, "../../build");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, "core-comparison-results.json"),
    JSON.stringify(
      {
        baseline: "React 18.3.1",
        generatedAt: new Date().toISOString(),
        observations,
      },
      null,
      2,
    ) + "\n",
  );
});
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const cases = [
  "basic-state",
  "state-batch",
  "props",
  "effect-only",
  "memo-effect",
  "memo-compare",
  "handler-update",
  "context",
  "render-phase",
  "render-phase-ref",
  "ref-update",
  "suspense-update",
  "suspense-lazy-function",
  "siblings-state",
  "suspense-lazy-class",
  "error-boundary",
];
function probe(runtime, scenario, mode) {
  const child = spawnSync(
    process.execPath,
    [path.join(__dirname, "probe.cjs"), runtime, scenario],
    {
      env: { ...process.env, NODE_ENV: mode },
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 2_000_000,
    },
  );
  assert.equal(
    child.status,
    0,
    `${runtime}/${scenario}: ${child.error || child.stderr || child.stdout}`,
  );
  const observation = JSON.parse(child.stdout.trim());
  assert.equal(observation.uncaught, undefined, child.stdout);
  assert.equal(observation.rejected, undefined, child.stdout);
  return observation;
}
cases.push(...Object.keys(require("./scenarios.cjs")));
const modes = process.env.CORE_TEST_MODE
  ? [process.env.CORE_TEST_MODE]
  : ["development", "production"];
for (const mode of modes)
  for (const scenario of cases) {
    if (
      process.env.CORE_TEST_FILTER &&
      !new RegExp(process.env.CORE_TEST_FILTER).test(scenario)
    )
      continue;
    test(`React 18.3.1 [${mode}]: ${scenario}`, () => {
      const reference = probe("official", scenario, mode);
      assert.equal(
        reference.version,
        "18.3.1",
        "official alias must use React 18.3.1",
      );
      assert.deepEqual(
        reference.actual,
        reference.expected,
        `official baseline: ${scenario}`,
      );
      const local = probe("local", scenario, mode);
      observations.push({ mode, scenario, reference, local });
      assert.deepEqual(
        local.actual,
        reference.actual,
        `${scenario}: ${JSON.stringify(local.messages)}`,
      );
    });
  }
