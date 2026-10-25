import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { digestOf } from "../lib/c14n.mjs";
import { CONFORMANCE_LEVELS } from "../lib/constants.mjs";
import { runCase, runConformance } from "../lib/conformance.mjs";
import { rel, walk } from "../lib/fs.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tempDirs = [];

after(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function repoWithCases(level, cases) {
  const root = await tempDir("d2p-std-conformance-");
  const dir = path.join(root, "conformance", level);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(cases)) await writeFile(path.join(dir, name), content);
  return root;
}

const readJsonFile = async (p) => JSON.parse(await readFile(p, "utf8"));

const caseDoc = (level, documents, expect) => ({
  documentType: "d2p:conformance-case",
  schemaVersion: "1.0.0",
  caseId: "test-case",
  level,
  title: "Test case",
  documents,
  expect,
});

describe("runConformance", () => {
  for (const level of CONFORMANCE_LEVELS) {
    it(`passes every "${level}" case of this repository, including negative cases`, async () => {
      const { ok, summary, results } = await runConformance(REPO_ROOT, level);
      assert.deepEqual(results.filter((r) => r.state !== "passed").map((r) => `${r.file}: ${r.message}`), []);
      assert.equal(ok, true);
      assert.equal(summary.level, level);
    });
  }

  it("has at least one positive and one negative case per level", async () => {
    for (const level of CONFORMANCE_LEVELS) {
      const files = (await walk(path.join(REPO_ROOT, "conformance", level))).filter((f) => f.endsWith(".case.json"));
      const outcomes = new Set();
      for (const f of files) outcomes.add((await readJsonFile(f)).expect.outcome);
      assert.deepEqual([...outcomes].sort(), ["accept", "reject"], level);
    }
  });

  it("covers the required topology and sewing-group test IDs with positive and negative cases", async () => {
    const required = ["TOP-002", "TOP-003", "TOP-004", "TOP-010", "SWG-002", "SWG-003", "SWG-004", "SWG-005", "SWG-006", "SWG-007", "SWG-011"];
    const seen = new Map();
    for (const f of await walk(path.join(REPO_ROOT, "conformance"))) {
      if (!f.endsWith(".case.json")) continue;
      const c = await readJsonFile(f);
      for (const id of c.testIds ?? []) {
        const s = seen.get(id) ?? new Set();
        s.add(c.expect.outcome);
        seen.set(id, s);
      }
    }
    for (const id of required) assert.deepEqual([...(seen.get(id) ?? [])].sort(), ["accept", "reject"], id);
  });

  it("rejects an unknown level", async () => {
    await assert.rejects(() => runConformance(REPO_ROOT, "visual"), /unknown conformance level/);
  });

  it("fails cases for a level without a runner instead of passing them", async () => {
    const root = await repoWithCases("structural", { "a.case.json": "{}", "ignored.json": "{}" });
    const { ok, summary, results } = await runConformance(root, "structural", { structural: null });
    assert.equal(ok, false);
    assert.equal(summary.discovered, 1);
    assert.equal(summary.failed, 1);
    assert.match(results[0].message, /no runner implemented/);
  });

  it("uses an injected runner and counts result states", async () => {
    const root = await repoWithCases("semantic", {
      "a.case.json": '{"expect":"passed"}',
      "b.case.json": '{"expect":"skipped"}',
      "c.case.json": "{ broken",
    });
    const runners = { semantic: async ({ data }) => ({ state: data.expect }) };
    const { ok, summary } = await runConformance(root, "semantic", runners);
    assert.deepEqual(summary, {
      level: "semantic",
      discovered: 3,
      passed: 1,
      failed: 1,
      inconclusive: 0,
      skipped: 1,
    });
    assert.equal(ok, false);
  });

  it("reports a runner exception as a failed case", async () => {
    const root = await repoWithCases("referential", { "a.case.json": "{}" });
    const runners = {
      referential: async () => {
        throw new Error("boom");
      },
    };
    const { results } = await runConformance(root, "referential", runners);
    assert.match(results[0].message, /runner error: boom/);
  });
});

describe("runCase", () => {
  const subject = "conformance/semantic/valid-pattern/pattern.json";
  const accept = { outcome: "accept", diagnostics: [] };

  it("fails a case that is not a valid conformance case", async () => {
    const r = await runCase(REPO_ROOT, { documentType: "d2p:conformance-case" }, "semantic");
    assert.equal(r.state, "failed");
    assert.match(r.message, /invalid case/);
  });

  it("fails a case stored under another level", async () => {
    const r = await runCase(REPO_ROOT, caseDoc("semantic", [{ path: subject, role: "subject" }], accept), "structural");
    assert.match(r.message, /does not match its directory level/);
  });

  it("fails a case whose documents do not exist or are listed twice", async () => {
    const r = await runCase(REPO_ROOT, caseDoc("semantic", [{ path: "conformance/missing.json", role: "subject" }], accept), "semantic");
    assert.match(r.message, /cannot be read/);
    const r2 = await runCase(REPO_ROOT, caseDoc("semantic", [{ path: subject, role: "subject" }, { path: subject, role: "context" }], accept), "semantic");
    assert.match(r2.message, /listed more than once/);
  });

  it("forbids manifests in structural cases and editability outside the semantic level", async () => {
    const r1 = await runCase(REPO_ROOT, caseDoc("structural", [{ path: subject, role: "manifest" }], accept), "structural");
    assert.match(r1.message, /never uses role manifest/);
    const r2 = await runCase(REPO_ROOT, caseDoc("referential", [{ path: subject, role: "subject" }], { ...accept, editability: "editable" }), "referential");
    assert.match(r2.message, /only observed at the semantic level/);
  });

  it("passes when the outcome and editability match", async () => {
    const r = await runCase(REPO_ROOT, caseDoc("semantic", [{ path: subject, role: "subject" }], { ...accept, editability: "editable" }), "semantic");
    assert.equal(r.state, "passed", r.message);
  });

  it("fails on a wrong outcome, a missing expected diagnostic or a wrong editability", async () => {
    const r1 = await runCase(REPO_ROOT, caseDoc("semantic", [{ path: subject, role: "subject" }], { outcome: "reject", diagnostics: [] }), "semantic");
    assert.match(r1.message, /expected outcome reject, observed accept/);
    const r2 = await runCase(REPO_ROOT, caseDoc("semantic", [{ path: subject, role: "subject" }], { outcome: "accept", diagnostics: [{ code: "D2P-SEM-004" }] }), "semantic");
    assert.match(r2.message, /D2P-SEM-004 was not reported/);
    const r3 = await runCase(REPO_ROOT, caseDoc("semantic", [{ path: subject, role: "subject" }], { ...accept, editability: "read-only" }), "semantic");
    assert.match(r3.message, /expected editability read-only, observed editable/);
  });

  it("matches documentPath and instancePath when given", async () => {
    const doc = "conformance/semantic/open-contour/pattern.json";
    const expectAt = (instancePath) => ({ outcome: "reject", diagnostics: [{ code: "D2P-SEM-010", documentPath: doc, instancePath }] });
    const good = await runCase(REPO_ROOT, caseDoc("semantic", [{ path: doc, role: "subject" }], expectAt("/pieces/0/contours/0")), "semantic");
    assert.equal(good.state, "passed", good.message);
    const bad = await runCase(REPO_ROOT, caseDoc("semantic", [{ path: doc, role: "subject" }], expectAt("/pieces/1/contours/0")), "semantic");
    assert.equal(bad.state, "failed");
  });

  it("reports an unexpected lower-level failure as a precondition failure", async () => {
    const doc = "conformance/structural/forbidden-expression-node/pattern.json";
    const r = await runCase(REPO_ROOT, caseDoc("semantic", [{ path: doc, role: "subject" }], { outcome: "reject", diagnostics: [] }), "semantic");
    assert.equal(r.state, "failed");
    assert.match(r.message, /precondition failure at the structural level/);
  });

  it("expands a manifest into the bundle and checks its integrity", async () => {
    const root = await tempDir("d2p-std-manifest-");
    for (const f of await walk(path.join(REPO_ROOT, "schemas"))) {
      const target = path.join(root, rel(REPO_ROOT, f));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await readFile(f));
    }
    const write = async (p, v) => {
      await mkdir(path.dirname(path.join(root, p)), { recursive: true });
      await writeFile(path.join(root, p), JSON.stringify(v));
    };
    const pattern = await readJsonFile(path.join(REPO_ROOT, subject));
    const tolerance = { note: "stand-in file; only its digest is pinned" };
    const manifest = {
      documentType: "d2p:fixture-manifest",
      schemaVersion: "1.0.0",
      fixtureId: "test-fixture",
      fixtureVersion: "1.0.0",
      title: "Test fixture",
      description: "Synthetic.",
      synthetic: true,
      standardVersion: "1.0.0",
      digestProfile: "d2p-digest-v1",
      toleranceProfile: { profileId: "org.example.test:tolerance", version: "1.0.0", path: "tolerance.json", digest: digestOf(tolerance) },
      files: [{ path: "inputs/pattern.json", role: "input", documentType: "d2p:pattern", digest: digestOf(pattern) }],
      externalFiles: [],
      review: { status: "pending" },
    };
    manifest.fixtureDigest = digestOf(manifest, ["fixtureDigest"]);
    await write("fixtures/test/manifest.json", manifest);
    await write("fixtures/test/inputs/pattern.json", pattern);
    await write("tolerance.json", tolerance);
    const documents = [{ path: "fixtures/test/manifest.json", role: "manifest" }];

    const ok = await runCase(root, caseDoc("semantic", documents, accept), "semantic");
    assert.equal(ok.state, "passed", ok.message);

    // The expanded pattern is checked at the semantic level.
    const twice = structuredClone(pattern);
    twice.seamConnections[1].interfaceIds[0] = "si-front-side-left";
    manifest.files[0].digest = digestOf(twice);
    manifest.fixtureDigest = digestOf(manifest, ["fixtureDigest"]);
    await write("fixtures/test/manifest.json", manifest);
    await write("fixtures/test/inputs/pattern.json", twice);
    const sem = await runCase(root, caseDoc("semantic", documents, { outcome: "reject", diagnostics: [{ code: "D2P-SEM-023", documentPath: "fixtures/test/inputs/pattern.json" }] }), "semantic");
    assert.equal(sem.state, "passed", sem.message);

    // A changed file and an unlisted file break manifest integrity.
    await write("fixtures/test/inputs/pattern.json", pattern);
    await write("fixtures/test/inputs/extra.json", {});
    const pre = await runCase(root, caseDoc("semantic", documents, { outcome: "reject", diagnostics: [] }), "semantic");
    assert.match(pre.message, /precondition failure at the referential level/);
    const integrity = await runCase(root, caseDoc("referential", documents, { outcome: "reject", diagnostics: [{ code: "D2P-REF-011" }, { code: "D2P-REF-012" }] }), "referential");
    assert.equal(integrity.state, "passed", integrity.message);
  });
});

describe("generate-conformance-cases", () => {
  it("reproduces the committed cases exactly", async () => {
    const out = await tempDir("d2p-std-generate-");
    await promisify(execFile)(process.execPath, [path.join(REPO_ROOT, "tools/generate-conformance-cases.mjs"), out]);
    const generated = (await walk(path.join(out, "conformance"))).map((f) => rel(out, f));
    const committed = (await walk(path.join(REPO_ROOT, "conformance")))
      .map((f) => rel(REPO_ROOT, f))
      .filter((f) => /^conformance\/(structural|referential|semantic)\//.test(f) && !/\/golden-tshirt(-3d|-drape)?\//.test(f));
    assert.deepEqual(generated.sort(), committed.sort());
    for (const f of generated) {
      assert.equal(await readFile(path.join(out, f), "utf8"), await readFile(path.join(REPO_ROOT, f), "utf8"), f);
    }
  });
});
