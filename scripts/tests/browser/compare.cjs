const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const repo = path.resolve(__dirname, "../../..");
const dir = path.resolve(
  process.argv[2] ||
    "docs/reviews/react18.3.1-independent-audit/browser-20261020",
);
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const hash = (p) =>
  crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const comparisons = [];
for (const mode of ["development", "production"]) {
  const reference = read(`official-${mode}.json`);
  const local = read(`local-${mode}.json`);
  assert.equal(reference.reactVersion, "18.3.1");
  assert.equal(
    reference.domVersion,
    mode === "development" ? "18.3.1" : "18.3.1-next-f1338f8080-20240426",
  );
  for (const [runtime, result] of [
    ["official", reference],
    ["local", local],
  ]) {
    assert.equal(result.runtime, runtime);
    assert.equal(result.mode, mode);
    assert.equal(result.visibility, "visible");
    assert.equal(
      result.observations.length,
      20,
      "All automatic and actual-input checks are required",
    );
    assert.equal(new Set(result.observations.map((o) => o.name)).size, 20);
    assert.deepEqual(result.errors, []);
    for (const observation of result.observations) {
      assert.equal(
        observation.pass,
        true,
        `${runtime}/${mode}/${observation.name}`,
      );
      assert.deepEqual(
        observation.actual,
        observation.expected,
        observation.name,
      );
    }
    assert.ok(result.inputEvents.length > 15);
    assert.ok(result.inputEvents.every((e) => e.trusted === true));
  }
  for (let i = 0; i < reference.observations.length; i++) {
    const a = reference.observations[i],
      b = local.observations[i];
    assert.equal(a.name, b.name);
    assert.deepEqual(a.actual, b.actual, `${mode}/${a.name}`);
    comparisons.push({ mode, name: a.name, pass: true });
  }
}
// Bind the observed browser bundles to the actual package files and test source.
const manifestPath = path.join(repo, "build/browser-validation/manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
for (const bundle of manifest.manifests) {
  assert.equal(
    hash(path.join(repo, "build/browser-validation", bundle.bundle)),
    bundle.sha256,
  );
  for (const file of bundle.files)
    assert.equal(hash(file.file), file.sha256, file.file);
}
fs.copyFileSync(manifestPath, path.join(dir, "bundle-manifest.json"));
fs.writeFileSync(
  path.join(dir, "comparison.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      compared: 40,
      browserAssertions: 80,
      passed: 40,
      bundleFingerprintsMatchCurrentFiles: true,
      comparisons,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "PASS: 40 official/local comparisons; 80 browser assertions; all bundle/source fingerprints match.",
);
