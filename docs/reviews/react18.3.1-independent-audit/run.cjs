const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const scenarios = require("./scenarios.cjs");
const directory = path.join(__dirname, "run-20261020");
fs.mkdirSync(directory, { recursive: true });
const records = [];
const filter = new RegExp(process.env.AUDIT_FILTER || ".");
const modes = process.env.AUDIT_MODE ? [process.env.AUDIT_MODE] : ["development", "production"];
function run(runtime, scenario, mode) {
  const child = spawnSync(process.execPath, [path.join(__dirname, "probe.cjs"), runtime, scenario], {
    env: { ...process.env, NODE_ENV: mode },
    encoding: "utf8", timeout: 5000, maxBuffer: 2_000_000,
  });
  const events = child.stdout.trim().split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { invalidJSON: line }; }
  });
  return {
    status: child.status, signal: child.signal, error: child.error?.message,
    stderr: child.stderr, events,
    result: events.findLast((event) => event.kind),
  };
}
for (const mode of modes) for (const scenario of Object.keys(scenarios).filter((n) => filter.test(n))) {
  const reference = run("official", scenario, mode);
  let validBaseline = true;
  let baselineError;
  try {
    assert.equal(reference.status, 0);
    assert.equal(reference.result.kind, "result");
    assert.equal(reference.result.reactVersion, "18.3.1");
    assert.equal(reference.result.domPackageVersion, "18.3.1");
    // The installed, lockfile-pinned react-dom@18.3.1 production bundle exports
    // this internal version string. The package version, peer identity and paths
    // are checked separately; this is not a changed behavioral expectation.
    assert.equal(reference.result.domVersion, mode === "production"
      ? "18.3.1-next-f1338f8080-20240426" : "18.3.1");
    assert.equal(reference.result.samePeer, true);
    assert.deepEqual(reference.result.actual, reference.result.expected);
    assert.deepEqual(reference.result.cleanupErrors, []);
  } catch (e) { validBaseline = false; baselineError = e.message; }
  const local = run("local", scenario, mode);
  let match = false;
  if (validBaseline) {
    try {
      assert.equal(local.status, 0);
      assert.equal(local.result.samePeer, true);
      assert.deepEqual(local.result.actual, reference.result.actual);
      assert.deepEqual(local.result.cleanupErrors, []);
      match = true;
    } catch {}
  }
  records.push({ mode, scenario, validBaseline, baselineError, match, reference, local });
  console.log(`${mode} ${scenario}: ${!validBaseline ? "INVALID BASELINE" : match ? "MATCH" : "DIFF"}`);
  fs.writeFileSync(path.join(directory, process.env.AUDIT_OUTPUT || "independent-results.json"), JSON.stringify({
    generatedAt: new Date().toISOString(), baseline: "v18.3.1 f1338f8080abd1386454a10bbf93d67bfe37ce85", records,
  }, null, 2) + "\n");
}
console.log(JSON.stringify({
  total: records.length,
  invalidBaseline: records.filter((r) => !r.validBaseline).length,
  matches: records.filter((r) => r.match).length,
  differences: records.filter((r) => r.validBaseline && !r.match).length,
}));
