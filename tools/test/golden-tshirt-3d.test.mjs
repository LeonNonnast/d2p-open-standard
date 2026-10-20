// Golden T-Shirt 3D v1 (catalog §3.9, §4.5): generator reproducibility,
// fixture verification, digest kinds of module 3d and the placement maths.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { bindingsDigestOf, evaluationKeyOf, sceneDigestOf } from "../lib/c14n.mjs";
import { verifyFixture } from "../lib/fixture.mjs";
import { placePoint, rotate } from "../oracle/lib/garment3d.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = "fixtures/golden-tshirt-3d/v1/manifest.json";
const readJson = async (rel) => JSON.parse(await readFile(path.join(REPO_ROOT, rel), "utf8"));

describe("Golden T-Shirt 3D fixture", () => {
  it("is reproduced byte for byte by its generator", async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [path.join(REPO_ROOT, "tools/oracle/golden-tshirt-3d.mjs"), "--check"]);
    assert.match(stdout, /identical to generator output/);
  });

  it("verifies before any comparison (QEV-001)", async () => {
    const result = await verifyFixture(REPO_ROOT, MANIFEST);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics.slice(0, 5)));
    assert.deepEqual(result.integrity, []);
  });

  it("pins two sizes, two sleeve panel instances of one piece and bindings to existing interfaces (T3D-001, T3D-002, T3D-004)", async () => {
    const manifest = await readJson(MANIFEST);
    const garments = manifest.files.filter((f) => f.documentType === "d2p:garment" && f.role === "input");
    assert.equal(garments.length, 4); // 2 sizes x 2 revisions
    const pattern = await readJson("fixtures/golden-tshirt/v1/inputs/pattern-r1.json");
    for (const f of garments) {
      const g = await readJson(`fixtures/golden-tshirt-3d/v1/${f.path}`);
      const sleeves = g.panelInstances.filter((p) => p.pieceId === "sleeve");
      assert.deepEqual(sleeves.map((p) => p.cutInstanceKey).sort(), ["sleeve-left", "sleeve-right"]);
      for (const b of g.sewingBindings.filter((x) => x.kind === "seam-connection")) {
        const conn = pattern.seamConnections.find((c) => c.id === b.seamConnectionId);
        assert.deepEqual(b.interfaceBindings.map((x) => x.seamInterfaceId), conn.interfaceIds);
      }
    }
    const sizes = new Set();
    for (const f of garments) sizes.add((await readJson(`fixtures/golden-tshirt-3d/v1/${f.path}`)).patternEvaluations[0].sizeKey);
    assert.deepEqual([...sizes].sort(), ["size-a", "size-b"]);
  });

  it("expects every panel and seam binding, mm and m control measures and the bindings digest (T3D-005, QEV-011)", async () => {
    const e = await readJson("fixtures/golden-tshirt-3d/v1/expected/scenes/r1-size-a.json");
    assert.equal(e.sceneUnit, "m");
    assert.deepEqual(e.unitConversion, { from: "mm", to: "m", factor: 0.001 });
    assert.equal(e.panelBindings.length, 4);
    assert.equal(e.seamBindings.length, 12); // 10 seam connections + 2 sewing groups
    assert.equal(e.controlMeasures.length, 20);
    for (const c of e.controlMeasures) assert.ok(Math.abs(c.lengthM - c.lengthMm / 1000) <= 1e-9);
    assert.equal(bindingsDigestOf(e), e.bindingsDigest);
  });
});

describe("module 3d digests", () => {
  it("keeps the bindings digest independent of meshes (T3D-015) while the scene digest covers them", async () => {
    const s = await readJson("conformance/semantic/golden-tshirt-3d/scene-r1-size-a/scene-snapshot.json");
    assert.equal(bindingsDigestOf(s), s.bindingsDigest);
    assert.equal(sceneDigestOf(s), s.sceneDigest);
    const remeshed = structuredClone(s);
    remeshed.meshRefs[0].meshDigest = `sha256:${"0".repeat(64)}`;
    assert.equal(bindingsDigestOf(remeshed), s.bindingsDigest);
    assert.notEqual(sceneDigestOf(remeshed), s.sceneDigest);
  });

  it("derives the evaluation key from every pinned input except IDs and timestamps (GAR-016)", async () => {
    const input = await readJson("fixtures/golden-tshirt-3d/v1/inputs/scene-inputs/r1-size-a.json");
    assert.equal(evaluationKeyOf(input), input.evaluationKey);
    assert.equal(evaluationKeyOf({ ...input, sceneInputId: "sci_other", createdAt: "2030-01-01T00:00:00Z" }), input.evaluationKey);
    assert.notEqual(evaluationKeyOf({ ...input, arrangementId: "other" }), input.evaluationKey);
  });
});

describe("panel placement", () => {
  it("rotates with unit quaternions and mirrors before rotating", () => {
    assert.deepEqual(rotate([0, 0, 0, 1], [1, 2, 3]), [1, 2, 3]);
    assert.deepEqual(rotate([0, 1, 0, 0], [1, 2, 3]), [-1, 2, -3]);
    const pl = { translationMm: [10, 20, 30], rotation: [0, 1, 0, 0] };
    assert.deepEqual(placePoint([5, 7], false, pl), [5, 27, 30]);
    assert.deepEqual(placePoint([5, 7], true, pl), [15, 27, 30]);
  });
});
