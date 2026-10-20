const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const observations = [];
after(() =>
  fs.writeFileSync(
    path.resolve(__dirname, "../../build/regression-comparison-results.json"),
    JSON.stringify(
      {
        baseline: "React 18.3.1",
        generatedAt: new Date().toISOString(),
        observations,
      },
      null,
      2,
    ) + "\n",
  ),
);
function probe(runtime, scenario, mode) {
  const child = spawnSync(
    process.execPath,
    [path.join(__dirname, "regression-probe.cjs"), runtime, scenario],
    {
      env: { ...process.env, NODE_ENV: mode },
      encoding: "utf8",
      timeout: 6000,
      maxBuffer: 2_000_000,
    },
  );
  const events = child.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const result = events.findLast((e) => e.kind);
  assert.equal(
    child.status,
    0,
    `${runtime}/${scenario}: ${child.error || child.stderr || child.stdout}`,
  );
  assert.equal(result?.kind, "result", child.stdout);
  assert.equal(
    result.samePeer,
    true,
    "renderer must load the same React instance",
  );
  assert.deepEqual(result.cleanupErrors, [], child.stdout);
  return result;
}
for (const mode of process.env.REGRESSION_TEST_MODE
  ? [process.env.REGRESSION_TEST_MODE]
  : ["development", "production"])
  for (const scenario of Object.keys(require("./regressions.cjs"))) {
    if (
      process.env.REGRESSION_TEST_FILTER &&
      !new RegExp(process.env.REGRESSION_TEST_FILTER).test(scenario)
    )
      continue;
    test(`React 18.3.1 regression [${mode}]: ${scenario}`, () => {
      const reference = probe("official", scenario, mode);
      assert.equal(reference.reactVersion, "18.3.1");
      assert.equal(reference.domPackageVersion, "18.3.1");
      assert.equal(
        reference.domVersion,
        mode === "production" ? "18.3.1-next-f1338f8080-20240426" : "18.3.1",
      );
      assert.deepEqual(
        reference.actual,
        reference.expected,
        "official expected behavior",
      );
      const local = probe("local", scenario, mode);
      observations.push({ mode, scenario, reference, local });
      assert.deepEqual(
        local.actual,
        reference.actual,
        JSON.stringify(local.messages),
      );
    });
  }
