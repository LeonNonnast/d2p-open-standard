import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CONFORMANCE_LEVELS } from "../lib/constants.mjs";
import { runConformance } from "../lib/conformance.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tempDirs = [];

after(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function repoWithCases(level, cases) {
  const root = await mkdtemp(path.join(os.tmpdir(), "d2p-std-conformance-"));
  tempDirs.push(root);
  const dir = path.join(root, "conformance", level);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(cases)) await writeFile(path.join(dir, name), content);
  return root;
}

describe("runConformance", () => {
  for (const level of CONFORMANCE_LEVELS) {
    it(`passes "${level}" with zero cases in this repository`, async () => {
      const { ok, summary } = await runConformance(REPO_ROOT, level);
      assert.equal(ok, true);
      assert.equal(summary.level, level);
      assert.equal(summary.failed, 0);
    });
  }

  it("rejects an unknown level", async () => {
    await assert.rejects(() => runConformance(REPO_ROOT, "visual"), /unknown conformance level/);
  });

  it("fails cases for a level without a runner instead of passing them", async () => {
    const root = await repoWithCases("structural", { "a.case.json": "{}", "ignored.json": "{}" });
    const { ok, summary, results } = await runConformance(root, "structural");
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
});
