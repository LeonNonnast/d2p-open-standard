// Golden T-Shirt drape v1 (catalog §3.9, §4.6): generator reproducibility,
// fixture verification, the oracle's body target resolution, drape digests
// and the metamorphic size comparison.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { bindingsDigestOf, drapedMeshDigestOf, meshDigestOf, resultDigestOf, sceneDigestOf } from "../lib/c14n.mjs";
import { verifyFixture } from "../lib/fixture.mjs";
import { resolveTargets, sourceValues } from "../oracle/lib/drape.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE = "fixtures/golden-tshirt-drape/v1";
const MANIFEST = `${FIXTURE}/manifest.json`;
const SCENE = "conformance/semantic/golden-tshirt-drape/drape-scene";
const SIZE_B = "conformance/semantic/golden-tshirt-drape/drape-expectation-met";
const PERSONAL = "conformance/semantic/golden-tshirt-drape/drape-scene-personal";
const readJson = async (rel) => JSON.parse(await readFile(path.join(REPO_ROOT, rel), "utf8"));
const avatarProfile = () => readJson("vocabularies/avatar-profiles/standard-a-pose-1.0.0.json");
const PANELS = ["back", "front", "sleeve-left", "sleeve-right"];

describe("Golden T-Shirt drape fixture", () => {
  it("is reproduced byte for byte by its generator", async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [path.join(REPO_ROOT, "tools/oracle/golden-tshirt-drape.mjs"), "--check"]);
    assert.match(stdout, /identical to generator output/);
  });

  it("verifies before any comparison (QEV-001)", async () => {
    const result = await verifyFixture(REPO_ROOT, MANIFEST);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics.slice(0, 5)));
    assert.deepEqual(result.integrity, []);
  });

  it("copies the body-l table values into the body profile except the two measured overrides (SZT-001)", async () => {
    const sizes = await readJson(`${FIXTURE}/inputs/body-sizes-r1.json`);
    const profile = await readJson(`${FIXTURE}/inputs/body-profile-r1.json`);
    assert.deepEqual(profile.baseline, { sizeSystemRef: { artifactId: sizes.artifactId, revisionId: sizes.revisionId }, sizeKey: "body-l" });
    const entry = new Map(sizes.sizes.find((s) => s.sizeKey === "body-l").measurements.map((m) => [m.definitionId, m.value]));
    const overrides = [];
    for (const m of profile.measurements) {
      if (m.method === "size-table") {
        assert.equal(m.source.kind, "size-table");
        assert.equal(m.value, entry.get(m.definitionId));
      } else overrides.push(m.definitionId);
    }
    assert.deepEqual(overrides, ["d2p:body.arm-length", "d2p:body.chest-girth"]);
  });
});

describe("body target resolution (oracle)", () => {
  it("reproduces both expected body models from their sources (AVA-001, SZT-001)", async () => {
    const avatar = await avatarProfile();
    const sizes = await readJson(`${FIXTURE}/inputs/body-sizes-r1.json`);
    const profile = await readJson(`${FIXTURE}/inputs/body-profile-r1.json`);
    for (const name of ["body-m", "body-profile"]) {
      const e = await readJson(`${FIXTURE}/expected/body-models/${name}.json`);
      const r = resolveTargets(sourceValues(e.source, { sizeSystem: sizes, profile }), avatar);
      assert.equal(e.expectedStatus, r.status);
      assert.deepEqual(e.controlMeasures.map(({ definitionId, origin, targetMm }) => ({ definitionId, origin, targetMm })), r.controlMeasures);
      for (const c of e.controlMeasures) assert.equal(c.maxDeviationMm, avatar.tolerances.find((t) => t.definitionId === c.definitionId).maxDeviationMm);
    }
  });

  it("takes source values first, infers derived definitions from them and fails without a required one (AVA-003)", async () => {
    const avatar = await avatarProfile();
    const values = new Map([
      ["d2p:body.arm-length", { value: 600, origin: "profile" }],
      ["d2p:body.chest-girth", { value: 900, origin: "profile" }],
      ["d2p:body.hip-girth", { value: 950, origin: "profile" }],
      ["d2p:body.neck-girth", { value: 360, origin: "size-table" }],
      ["d2p:body.shoulder-width", { value: 410, origin: "profile" }],
      ["d2p:body.waist-girth", { value: 760, origin: "profile" }],
    ]);
    const r = resolveTargets(values, avatar);
    assert.equal(r.status, "failed");
    assert.deepEqual(r.missingDefinitions, ["d2p:body.height"]);
    const byId = new Map(r.controlMeasures.map((c) => [c.definitionId, c]));
    assert.deepEqual(byId.get("d2p:body.neck-girth"), { definitionId: "d2p:body.neck-girth", origin: "size-table", targetMm: 360 });
    assert.deepEqual(byId.get("d2p:body.bust-girth"), { definitionId: "d2p:body.bust-girth", origin: "inferred", targetMm: 900 });
    assert.equal(byId.has("d2p:body.waist-height"), false); // derived from the missing height: no target
    assert.equal(byId.has("d2p:body.height"), false);
  });
});

describe("drape documents", () => {
  it("pins every digest of the drape chain (SIM-004)", async () => {
    const scene = await readJson(`${SCENE}/scene-snapshot.json`);
    const body = await readJson(`${SCENE}/body-model-snapshot.json`);
    assert.equal(meshDigestOf(body), body.meshDigest);
    assert.equal(resultDigestOf(body, ["bodyModelId"]), body.resultDigest);
    assert.deepEqual(scene.bodyModelRef, { id: body.bodyModelId, digest: body.resultDigest });
    for (const p of PANELS) {
      const draped = await readJson(`${SCENE}/draped-mesh-${p}.json`);
      const rest = await readJson(`${SCENE}/rest-mesh-${p}.json`);
      assert.equal(drapedMeshDigestOf(draped), draped.meshDigest);
      assert.equal(draped.restMeshDigest, rest.meshDigest);
      assert.equal(draped.positionsM.length, rest.mesh.positions.length);
      assert.deepEqual(scene.drapedMeshRefs.find((r) => r.panelInstanceId === draped.panelInstanceId), {
        panelInstanceId: draped.panelInstanceId,
        drapedMeshRef: { id: draped.drapedMeshId, digest: draped.resultDigest },
        meshDigest: draped.meshDigest,
      });
    }
    assert.equal(sceneDigestOf(scene), scene.sceneDigest);
  });

  it("keeps the bindings of the 3D scene while the scene digest covers body model and draped meshes", async () => {
    const scene = await readJson(`${SCENE}/scene-snapshot.json`);
    const expected3d = await readJson("fixtures/golden-tshirt-3d/v1/expected/scenes/r1-size-a.json");
    assert.equal(bindingsDigestOf(scene), expected3d.bindingsDigest);
    const otherBody = structuredClone(scene);
    otherBody.bodyModelRef.digest = `sha256:${"0".repeat(64)}`;
    assert.equal(bindingsDigestOf(otherBody), scene.bindingsDigest);
    assert.notEqual(sceneDigestOf(otherBody), scene.sceneDigest);
    const otherDrape = structuredClone(scene);
    otherDrape.drapedMeshRefs[0].meshDigest = `sha256:${"0".repeat(64)}`;
    assert.notEqual(sceneDigestOf(otherDrape), scene.sceneDigest);
  });

  it("summarises the avatar profile's zones as a model estimate (FMP-001, FIT-004)", async () => {
    const avatar = await avatarProfile();
    const fitMap = await readJson(`${SCENE}/fit-map.json`);
    assert.equal(fitMap.estimate, "model-estimate");
    assert.equal(fitMap.materialStatus, "provisional");
    assert.deepEqual(
      fitMap.zones.map((z) => [z.zone, z.landmarkIds]),
      avatar.zones.map((z) => [z.zone, z.landmarkIds]),
    );
    for (const v of fitMap.vertexFields) {
      const draped = await readJson(`${SCENE}/draped-mesh-${v.panelInstanceId.replace(/^panel-/, "")}.json`);
      for (const k of ["strain", "clearanceMm", "contactPressure"]) assert.equal(v[k].length, draped.positionsM.length);
    }
  });

  it("gives size B more chest and waist clearance than size A on body M (DRP-004)", async () => {
    const a = await readJson(`${SCENE}/fit-map.json`);
    const b = await readJson(`${SIZE_B}/fit-map.json`);
    const metric = (m, zone) => m.zones.find((z) => z.zone === zone).meanClearanceMm;
    const expectation = await readJson(`${FIXTURE}/expected/drapes/size-comparison.json`);
    for (const c of expectation.comparisons.filter((x) => x.lower.simulationConfigurationId === "drape-body-m")) {
      assert.ok(metric(a, c.zone) < metric(b, c.zone), `${c.id}: ${metric(a, c.zone)} < ${metric(b, c.zone)}`);
    }
  });

  it("declares every document derived from an individual profile personal and restricts its findings (FMP-002, SIM-009)", async () => {
    const docs = ["body-model-snapshot", "scene-snapshot", "fit-map", "sim-report", ...PANELS.map((p) => `draped-mesh-${p}`)];
    for (const d of docs) assert.equal((await readJson(`${PERSONAL}/${d}.json`)).personalDerived, true, d);
    const report = await readJson(`${PERSONAL}/validation-report.json`);
    assert.deepEqual(report.findings.map((f) => f.visibility), ["restricted"]);
    const publicReport = await readJson(`${SCENE}/validation-report.json`);
    assert.deepEqual(publicReport.findings.map((f) => f.visibility), ["general"]);
  });
});
