// Unit tests of the draft 0.3.0 drape checks (tools/lib/drape.mjs and the
// codes it shares with referential.mjs and semantic.mjs) on a small
// in-memory drape world: an avatar profile, a size system and a body profile,
// a garment with a body binding and a simulation configuration, a body model,
// a rest and a draped mesh, a physical scene, a fit map and a sim-report.
// Each test mutates one document and compares the diagnostics with those of
// the unchanged world, so unrelated findings of partial documents cancel out.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { bindingsDigestOf, contentDigestOf, digestOf, drapedMeshDigestOf, resultDigestOf, sceneDigestOf } from "../lib/c14n.mjs";
import { BundleIndex } from "../lib/bundle.mjs";
import { bodySourceValues, isPersonalDerived, resolveBodyTargets } from "../lib/drape.mjs";
import { OWN_ID_MEMBERS } from "../lib/model.mjs";
import { checkReferential } from "../lib/referential.mjs";
import { checkSemantic } from "../lib/semantic.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const load = async (p) => JSON.parse(await readFile(path.join(REPO_ROOT, p), "utf8"));
const REGISTRY = await load("vocabularies/measurement-definitions/measurement-definitions-1.1.0.json");
const SOLVER = await load("vocabularies/solver-profiles/fit-approximation-1.0.0.json");
const WOVEN = await load("vocabularies/material-physics-profiles/cotton-woven-1.0.0.json");
const KNIT = await load("vocabularies/material-physics-profiles/cotton-jersey-1.0.0.json");
const MESH_PROFILE = await load("vocabularies/mesh-profiles/drape-coarse-1.0.0.json");

const V = "1.0.0";
const REG_ID = { id: "d2p:measurement-definitions", version: "1.1.0" };
const AVATAR_ID = { id: "org.example.test:avatar", version: V };
const SOLVER_ID = { id: SOLVER.profileId, version: SOLVER.version };
const WOVEN_ID = { id: WOVEN.profileId, version: WOVEN.version };
const SIZES_REF = { artifactId: "art_t-bodies", revisionId: "rev_t-bodies-r1" };
const PROFILE_REF = { artifactId: "art_t-profile", revisionId: "rev_t-profile-r1" };
const GARMENT_REF = { artifactId: "art_t-garment-a", revisionId: "rev_t-garment-a-r1" };
const GARMENT_B_REF = { artifactId: "art_t-garment-b", revisionId: "rev_t-garment-b-r1" };
const CHEST = "d2p:body.chest-girth";
const HEIGHT = "d2p:body.height";
const NECK = "d2p:body.neck-girth";
const NAPE = "d2p:landmark.nape";
const VERTEX = "d2p:landmark.vertex";

const value = (definitionId, v, method = "size-table", kind = "synthetic") => ({ definitionId, value: v, unit: "mm", method, source: { kind } });
const derived = (doc) => ({ id: doc[OWN_ID_MEMBERS[doc.documentType][0]], digest: doc.resultDigest ?? doc.sceneDigest });
const pin = (role, x, doc) => (x.artifactId ? { role, artifactRef: x, digest: contentDigestOf(doc) } : { role, id: x, digest: digestOf(doc) });

/** A fresh, consistent drape world (documents by name). */
function world() {
  const avatar = {
    documentType: "d2p:avatar-profile", schemaVersion: V, profileId: AVATAR_ID.id, version: V, status: "provisional", title: "Test avatar", pose: "d2p:a-pose",
    definitionRegistries: [REG_ID], requiredDefinitions: [CHEST, HEIGHT],
    derivations: [{ definitionId: NECK, interceptMm: 10, terms: [{ definitionId: CHEST, coefficient: 0.38 }] }],
    tolerances: [CHEST, HEIGHT, NECK].map((definitionId) => ({ definitionId, maxDeviationMm: 5 })),
    landmarks: [{ landmarkId: NAPE, description: "Nape." }, { landmarkId: VERTEX, description: "Vertex." }],
    zones: [{ zone: "d2p:chest", landmarkIds: [NAPE] }],
    toleranceProfile: { id: "d2p:golden-tshirt-drape", version: V },
  };
  const sizes = {
    documentType: "d2p:size-system", schemaVersion: V, ...SIZES_REF, name: "Test bodies", issuer: { kind: "synthetic", name: "Test" }, definitionRegistries: [REG_ID],
    sizes: [{ sizeKey: "body-m", label: "M", ordinal: 1, measurements: [value(CHEST, 960), value(HEIGHT, 1700)] }],
  };
  const profile = {
    documentType: "d2p:body-measurement-profile", schemaVersion: V, ...PROFILE_REF, subject: { kind: "synthetic" }, dataClassification: "public", definitionRegistries: [REG_ID],
    baseline: { sizeSystemRef: SIZES_REF, sizeKey: "body-m" },
    measurements: [value(CHEST, 960, "size-table", "size-table"), value(HEIGHT, 1720, "manual", "self-measured")],
  };
  const garment = (ref) => ({
    documentType: "d2p:garment", schemaVersion: V, ...ref, name: "Test garment",
    patternEvaluations: [{ id: "eval-main", patternRef: { artifactId: "art_t-pattern", revisionId: "rev_t-pattern-r1" }, evaluationRef: { id: "pev_t-a" }, geometryDigest: `sha256:${"a".repeat(64)}` }],
    panelInstances: [{ id: "panel-front", patternEvaluationId: "eval-main", pieceId: "front", cutInstanceKey: "front", side: "center" }],
    sewingBindings: [],
    materialAssignments: [{ id: "material-main", panelInstanceIds: ["panel-front"], material: { materialClass: "woven" } }],
    arrangements: [{ id: "flat-lay", coordinateSystem: { handedness: "right", up: "+y", front: "+z" }, placements: [{ panelInstanceId: "panel-front", translationMm: [0, 0, 0], rotation: [0, 0, 0, 1] }] }],
    bodyBindings: [
      { id: "body-m", source: { kind: "size-entry", sizeSystemRef: SIZES_REF, sizeKey: "body-m" }, avatarProfile: AVATAR_ID, pose: "d2p:a-pose" },
      { id: "body-profile", source: { kind: "body-measurement-profile", bodyMeasurementProfileRef: PROFILE_REF }, avatarProfile: AVATAR_ID, pose: "d2p:a-pose" },
    ],
    simulationConfigurations: [
      { id: "drape-body-m", bodyBindingId: "body-m", patternEvaluationId: "eval-main", arrangementId: "flat-lay", solverProfile: SOLVER_ID, materials: [{ materialAssignmentId: "material-main", materialPhysicsProfile: WOVEN_ID }], randomSeed: 1 },
      { id: "drape-body-profile", bodyBindingId: "body-profile", patternEvaluationId: "eval-main", arrangementId: "flat-lay", solverProfile: SOLVER_ID, materials: [{ materialAssignmentId: "material-main", materialPhysicsProfile: WOVEN_ID }], randomSeed: 1 },
    ],
  });
  const body = {
    documentType: "d2p:body-model-snapshot", schemaVersion: V, bodyModelId: "bms_t-body-m",
    source: { kind: "size-entry", sizeSystemRef: SIZES_REF, sizeKey: "body-m" }, avatarProfile: AVATAR_ID, pose: "d2p:a-pose",
    backend: { backendId: "org.example.body", backendVersion: V, adapterVersion: V },
    inputDigests: [], status: "succeeded",
    coordinateSystem: { handedness: "right", up: "+y", front: "+z" }, sceneUnit: "m", unitConversion: { from: "mm", to: "m", factor: 0.001 },
    mesh: { positionsM: [[0, 0, 0.1], [0.1, 0, -0.05], [0, 1.7, 0]], triangles: [[0, 1, 2]] },
    landmarks: [{ landmarkId: NAPE, positionM: [0, 1.44, -0.05] }, { landmarkId: VERTEX, positionM: [0, 1.7, 0] }],
    controlMeasures: [
      { definitionId: CHEST, origin: "size-table", targetMm: 960, measuredMm: 961, deviationMm: 1 },
      { definitionId: HEIGHT, origin: "size-table", targetMm: 1700, measuredMm: 1699, deviationMm: -1 },
      { definitionId: NECK, origin: "inferred", targetMm: 374.8, measuredMm: 375, deviationMm: 0.2 },
    ],
    diagnostics: [],
  };
  const expectation = {
    documentType: "d2p:body-model-expectation", schemaVersion: V, expectationId: "bmx_t-body-profile",
    source: { kind: "body-measurement-profile", bodyMeasurementProfileRef: PROFILE_REF }, avatarProfile: AVATAR_ID, expectedStatus: "succeeded",
    controlMeasures: [
      { definitionId: CHEST, origin: "size-table", targetMm: 960, maxDeviationMm: 5 },
      { definitionId: HEIGHT, origin: "profile", targetMm: 1720, maxDeviationMm: 5 },
      { definitionId: NECK, origin: "inferred", targetMm: 374.8, maxDeviationMm: 5 },
    ],
    toleranceProfile: { id: "d2p:golden-tshirt-drape", version: V },
  };
  const rest = (ref, id) => ({
    documentType: "d2p:panel-mesh-result", schemaVersion: V, meshResultId: id, garmentRef: ref, panelInstanceId: "panel-front", pieceId: "front", cutInstanceKey: "front",
    status: "succeeded", mesh: { positions: [[0, 0, 0], [100, 0, 0], [0, 100, 0]], uvs: [[0, 0], [1, 0], [0, 1]], triangles: [[0, 1, 2]] }, edgeBindings: [], diagnostics: [],
  });
  const draped = (ref, id, restId) => ({
    documentType: "d2p:draped-panel-mesh", schemaVersion: V, drapedMeshId: id, garmentRef: ref, simulationConfigurationId: "drape-body-m", panelInstanceId: "panel-front",
    restMeshRef: { id: restId }, positionsM: [[0, 1.2, 0.13], [0.1, 1.2, 0.13], [0, 1.3, 0.14]], diagnostics: [],
  });
  const scene = (ref, id, restId, drapedId) => ({
    documentType: "d2p:scene-snapshot", schemaVersion: V, sceneSnapshotId: id, garmentRef: ref, arrangementId: "flat-lay", mode: "physical-simulation",
    simulationConfigurationId: "drape-body-m", evaluationKey: `sha256:${"b".repeat(64)}`,
    coordinateSystem: { handedness: "right", up: "+y", front: "+z" }, sceneUnit: "m", unitConversion: { from: "mm", to: "m", factor: 0.001 },
    inputDigests: [], patternEvaluations: [], meshProfile: { id: MESH_PROFILE.profileId, version: MESH_PROFILE.version }, backendBuild: {},
    panelBindings: [{ panelInstanceId: "panel-front", patternEvaluationId: "eval-main", pieceId: "front", cutInstanceKey: "front", side: "center", mirrored: false }],
    seamBindings: [], controlMeasures: [],
    meshRefs: [{ panelInstanceId: "panel-front", meshResultRef: { id: restId } }],
    drapedMeshRefs: [{ panelInstanceId: "panel-front", drapedMeshRef: { id: drapedId } }],
    qualityStatus: "preview", diagnostics: [],
  });
  const fitMap = (id, sceneId, clearance) => ({
    documentType: "d2p:fit-map", schemaVersion: V, fitMapId: id, sceneSnapshotRef: { id: sceneId }, bodyModelRef: { id: "bms_t-body-m" },
    avatarProfile: AVATAR_ID, solverProfile: SOLVER_ID, materialStatus: "provisional", estimate: "model-estimate",
    zones: [{ zone: "d2p:chest", landmarkIds: [NAPE], panelInstanceIds: ["panel-front"], meanStrain: 0.01, maxStrain: 0.02, meanClearanceMm: clearance, minClearanceMm: 1, contactPressureIndex: 0 }],
    vertexFields: [{ panelInstanceId: "panel-front", strain: [0, 0, 0], clearanceMm: [1, 2, 3], contactPressure: [0, 0, 0] }],
    diagnostics: [],
  });
  const simReport = {
    documentType: "d2p:sim-report", schemaVersion: V, simReportId: "sim_t-a", sceneSnapshotRef: { id: "ssn_t-a" }, profileKind: "fit-approximation",
    solver: { backendId: "org.example.cloth", backendVersion: V, adapterVersion: V }, solverProfile: SOLVER_ID, toleranceProfile: { id: "d2p:golden-tshirt-drape", version: V },
    inputDigests: [], status: "succeeded", randomSeed: 1, convergence: {}, durationMs: 1, metrics: [], diagnostics: [],
  };
  const drapeExpectation = {
    documentType: "d2p:drape-expectation", schemaVersion: V, expectationId: "drx_t-sizes",
    comparisons: [{ id: "chest", zone: "d2p:chest", metric: "meanClearanceMm", lower: { garmentRef: GARMENT_REF, simulationConfigurationId: "drape-body-m" }, higher: { garmentRef: GARMENT_B_REF, simulationConfigurationId: "drape-body-m" } }],
    toleranceProfile: { id: "d2p:golden-tshirt-drape", version: V },
  };
  return {
    registry: REGISTRY, solver: SOLVER, woven: WOVEN, knit: KNIT, meshProfile: MESH_PROFILE, avatar, sizes, profile,
    garment: garment(GARMENT_REF), garmentB: garment(GARMENT_B_REF), body, expectation,
    rest: rest(GARMENT_REF, "pmr_t-a"), restB: rest(GARMENT_B_REF, "pmr_t-b"),
    draped: draped(GARMENT_REF, "dpm_t-a", "pmr_t-a"), drapedB: draped(GARMENT_B_REF, "dpm_t-b", "pmr_t-b"),
    scene: scene(GARMENT_REF, "ssn_t-a", "pmr_t-a", "dpm_t-a"), sceneB: scene(GARMENT_B_REF, "ssn_t-b", "pmr_t-b", "dpm_t-b"),
    fitMap: fitMap("fmp_t-a", "ssn_t-a", 10), fitMapB: fitMap("fmp_t-b", "ssn_t-b", 20), simReport, drapeExpectation,
  };
}

/** Recomputes every pin and digest of the world in dependency order. */
function seal(w) {
  const source = w.body.source.kind === "size-entry" ? pin("size-system", SIZES_REF, w.sizes) : pin("body-measurement-profile", PROFILE_REF, w.profile);
  w.body.inputDigests = [pin("avatar-profile", AVATAR_ID, w.avatar), pin("measurement-definition-registry", REG_ID, w.registry), source];
  w.body.meshDigest = digestOf(w.body.mesh);
  w.body.resultDigest = resultDigestOf(w.body, ["bodyModelId"]);
  for (const [r, d, s, g] of [[w.rest, w.draped, w.scene, w.garment], [w.restB, w.drapedB, w.sceneB, w.garmentB]]) {
    r.meshDigest = digestOf(r.mesh);
    r.resultDigest = resultDigestOf(r, ["meshResultId"]);
    d.restMeshRef.digest = r.resultDigest;
    d.restMeshDigest = r.meshDigest;
    d.meshDigest = drapedMeshDigestOf(d);
    d.resultDigest = resultDigestOf(d, ["drapedMeshId"]);
    s.inputDigests = [
      pin("garment", s.garmentRef, g), pin("mesh-profile", s.meshProfile, w.meshProfile), pin("avatar-profile", AVATAR_ID, w.avatar),
      pin("solver-profile", SOLVER_ID, w.solver), pin("material-physics-profile", WOVEN_ID, w.woven), pin("size-system", SIZES_REF, w.sizes),
      { role: "pattern", artifactRef: g.patternEvaluations[0].patternRef, digest: `sha256:${"e".repeat(64)}` },
    ];
    s.bodyModelRef = derived(w.body);
    s.meshRefs[0].meshResultRef.digest = r.resultDigest;
    s.meshRefs[0].meshDigest = r.meshDigest;
    s.drapedMeshRefs.forEach((e) => Object.assign(e, { drapedMeshRef: derived(d), meshDigest: d.meshDigest }));
    s.bindingsDigest = bindingsDigestOf(s);
    s.sceneDigest = sceneDigestOf(s);
  }
  for (const [f, s] of [[w.fitMap, w.scene], [w.fitMapB, w.sceneB]]) {
    f.sceneSnapshotRef = derived(s);
    f.bodyModelRef = derived(w.body);
    f.resultDigest = resultDigestOf(f, ["fitMapId"]);
  }
  w.simReport.sceneSnapshotRef = derived(w.scene);
  w.simReport.resultDigest = resultDigestOf(w.simReport, ["simReportId"]);
  return w;
}

const bundle = (w) => new BundleIndex(Object.entries(w).map(([name, value]) => ({ path: `${name}.json`, role: "subject", value })));
const keyOf = (d) => `${d.code} ${d.documentPath}#${d.instancePath ?? ""}`;
async function diagnose(level, w) {
  const index = bundle(w);
  return level === "referential" ? checkReferential(index, { root: REPO_ROOT }) : checkSemantic(index);
}
const BASE = { referential: (await diagnose("referential", seal(world()))).map(keyOf), semantic: (await diagnose("semantic", seal(world()))).map(keyOf) };

/**
 * Diagnostics of a mutated world that the unchanged world does not report
 * ("CODE file#pointer"), optionally only those with one of `codes`. With
 * `sealAfter`, pins and digests are recomputed after the mutation.
 */
async function delta(level, mutate, { codes, sealAfter = false } = {}) {
  const w = seal(world());
  mutate(w);
  if (sealAfter) seal(w);
  const base = new Set(BASE[level]);
  const wanted = (k) => !codes || codes.some((c) => k.startsWith(`${c} `));
  return [...new Set((await diagnose(level, w)).map(keyOf).filter((k) => !base.has(k) && wanted(k)))].sort();
}

describe("body target resolution (design 0.3.0 §2)", () => {
  const w = world();
  const index = bundle(w);
  it("takes size-entry values as size-table targets and infers derived ones left to right", () => {
    const values = bodySourceValues(index, w.body.source);
    const r = resolveBodyTargets(w.avatar, values);
    assert.equal(r.status, "succeeded");
    assert.deepEqual(r.missingDefinitions, []);
    assert.deepEqual(r.controlMeasures, [
      { definitionId: CHEST, origin: "size-table", targetMm: 960 },
      { definitionId: HEIGHT, origin: "size-table", targetMm: 1700 },
      { definitionId: NECK, origin: "inferred", targetMm: 10 + 0.38 * 960 },
    ]);
  });

  it("marks profile values by method and prefers a stated value over a derivation", () => {
    const p = structuredClone(w.profile);
    p.measurements.push(value(NECK, 400, "manual", "self-measured"));
    const values = bodySourceValues(new BundleIndex([{ path: "p.json", role: "subject", value: p }]), w.expectation.source);
    assert.deepEqual(resolveBodyTargets(w.avatar, values).controlMeasures.map((m) => [m.definitionId, m.origin, m.targetMm]), [
      [CHEST, "size-table", 960],
      [HEIGHT, "profile", 1720],
      [NECK, "profile", 400],
    ]);
  });

  it("fails on a missing required definition and leaves an underivable derived one out", () => {
    const r = resolveBodyTargets(w.avatar, new Map([[HEIGHT, { value: 1700, origin: "profile" }]]));
    assert.equal(r.status, "failed");
    assert.deepEqual(r.missingDefinitions, [CHEST]);
    assert.deepEqual(r.controlMeasures.map((m) => m.definitionId), [HEIGHT]);
  });

  it("sums several terms in term order after the intercept", () => {
    const profile = { requiredDefinitions: ["a", "b"], derivations: [{ definitionId: "c", interceptMm: 0.1, terms: [{ definitionId: "a", coefficient: 0.2 }, { definitionId: "b", coefficient: 0.3 }] }] };
    const r = resolveBodyTargets(profile, new Map([["a", { value: 1, origin: "profile" }], ["b", { value: 1, origin: "profile" }]]));
    assert.equal(r.controlMeasures[2].targetMm, 0.1 + 0.2 * 1 + 0.3 * 1);
  });

  it("is not applicable without the source document", () => {
    assert.equal(bodySourceValues(new BundleIndex([]), w.body.source), null);
  });
});

describe("drape world baseline", () => {
  it("reports none of the drape codes for the consistent world", () => {
    const drapeCodes = /D2P-(SEM-05[02]|SEM-07[56]|SEM-12[7-9]|SEM-13[01]|REF-00[3789]|REF-01[14])/;
    assert.deepEqual([...BASE.referential, ...BASE.semantic].filter((k) => drapeCodes.test(k) && !k.includes("rest")), []);
  });
});

describe("referential drape checks", () => {
  it("resolves garment configuration members (D2P-REF-003)", async () => {
    assert.deepEqual(await delta("referential", (w) => {
      Object.assign(w.garment.simulationConfigurations[0], { bodyBindingId: "body-missing", arrangementId: "nowhere" });
      w.garment.simulationConfigurations[0].materials[0].materialAssignmentId = "material-missing";
    }, { codes: ["D2P-REF-003"] }), [
      "D2P-REF-003 garment.json#/simulationConfigurations/0/arrangementId",
      "D2P-REF-003 garment.json#/simulationConfigurations/0/bodyBindingId",
      "D2P-REF-003 garment.json#/simulationConfigurations/0/materials/0/materialAssignmentId",
    ]);
  });

  it("resolves the configuration of scenes, draped meshes and drape expectations (D2P-REF-003)", async () => {
    const out = await delta("referential", (w) => {
      w.draped.panelInstanceId = "panel-back";
      w.drapeExpectation.comparisons[0].higher.simulationConfigurationId = "drape-other";
      w.garment.simulationConfigurations[0].id = "drape-renamed";
    });
    for (const k of [
      "D2P-REF-003 draped.json#/panelInstanceId",
      "D2P-REF-003 draped.json#/simulationConfigurationId",
      "D2P-REF-003 drapeExpectation.json#/comparisons/0/higher/simulationConfigurationId",
      "D2P-REF-003 drapeExpectation.json#/comparisons/0/lower/simulationConfigurationId",
      "D2P-REF-003 scene.json#/simulationConfigurationId",
    ]) assert.ok(out.includes(k), `${k} in ${out.join("; ")}`);
  });

  it("resolves body source and baseline size keys (D2P-REF-009)", async () => {
    assert.deepEqual(await delta("referential", (w) => {
      w.profile.baseline.sizeKey = "body-xl";
      w.garment.bodyBindings[0].source.sizeKey = "body-xl";
      w.body.source.sizeKey = "body-xl";
    }, { codes: ["D2P-REF-009"] }), [
      "D2P-REF-009 body.json#/source/sizeKey",
      "D2P-REF-009 garment.json#/bodyBindings/0/source/sizeKey",
      "D2P-REF-009 profile.json#/baseline/sizeKey",
    ]);
  });

  it("resolves avatar-profile and body-model definitions in the profile's registries (D2P-REF-008)", async () => {
    assert.deepEqual(await delta("referential", (w) => {
      w.avatar.derivations[0].terms[0].definitionId = "d2p:body.unknown";
      w.expectation.controlMeasures[2].definitionId = "d2p:body.unknown-2";
    }, { codes: ["D2P-REF-008"] }), [
      "D2P-REF-008 avatar.json#/derivations/0/terms/0/definitionId",
      "D2P-REF-008 expectation.json#/controlMeasures/2/definitionId",
    ]);
  });

  it("keeps avatar-profile arrays sorted and unique (D2P-REF-014, D2P-REF-005)", async () => {
    assert.deepEqual(await delta("referential", (w) => {
      w.avatar.requiredDefinitions.reverse();
      w.avatar.landmarks.reverse();
      w.avatar.tolerances.push(structuredClone(w.avatar.tolerances[2]));
      w.avatar.zones[0].landmarkIds = [VERTEX, NAPE];
    }, { codes: ["D2P-REF-005", "D2P-REF-014"] }), [
      "D2P-REF-005 avatar.json#/tolerances/3/definitionId",
      "D2P-REF-014 avatar.json#/landmarks/1",
      "D2P-REF-014 avatar.json#/requiredDefinitions/1",
      "D2P-REF-014 avatar.json#/zones/0/landmarkIds/1",
    ]);
  });

  it("resolves avatar, solver and material physics input digests (D2P-REF-001, D2P-REF-011)", async () => {
    assert.deepEqual(await delta("referential", (w) => {
      w.scene.inputDigests[3].id = { id: "org.example:missing", version: V };
      w.scene.inputDigests[4].digest = `sha256:${"c".repeat(64)}`;
    }), [
      "D2P-REF-001 scene.json#/inputDigests/3/id",
      "D2P-REF-007 scene.json#/inputDigests",
      "D2P-REF-011 scene.json#/inputDigests/4/digest",
    ]);
  });

  it("pins the body source, avatar profile and registries of a body model (D2P-REF-007)", async () => {
    assert.deepEqual(await delta("referential", (w) => {
      w.body.inputDigests = w.body.inputDigests.filter((d) => d.role !== "measurement-definition-registry");
      w.body.inputDigests.push(pin("size-system", PROFILE_REF, w.profile));
    }, { codes: ["D2P-REF-007"] }), ["D2P-REF-007 body.json#/inputDigests"]);
  });

  it("ties a physical scene to its body binding and solver profile (D2P-REF-007)", async () => {
    assert.deepEqual(await delta("referential", (w) => {
      w.body.source = { kind: "body-measurement-profile", bodyMeasurementProfileRef: PROFILE_REF };
      w.scene.meshProfile = { id: "d2p:drape-fine", version: V };
    }, { sealAfter: true, codes: ["D2P-REF-007"] }), [
      "D2P-REF-007 scene.json#/bodyModelRef",
      "D2P-REF-007 scene.json#/meshProfile",
      "D2P-REF-007 sceneB.json#/bodyModelRef",
    ]);
    // Sealing pins the solver profile again, so the pin is dropped from the sealed world.
    assert.deepEqual(await delta("referential", (w) => {
      w.scene.inputDigests = w.scene.inputDigests.filter((d) => d.role !== "solver-profile");
      w.scene.sceneDigest = sceneDigestOf(w.scene);
    }, { codes: ["D2P-REF-007"] }), ["D2P-REF-007 scene.json#/inputDigests"]);
  });

  it("ties a fit map to its scene's body model and configuration (D2P-REF-007)", async () => {
    assert.deepEqual(await delta("referential", (w) => {
      w.fitMap.solverProfile = { id: "d2p:physical-cloth", version: V };
      w.fitMap.avatarProfile = { id: "d2p:standard-a-pose", version: V };
      w.fitMap.bodyModelRef = { id: "bms_t-other" };
    }), [
      "D2P-REF-001 fitMap.json#/bodyModelRef",
      "D2P-REF-007 fitMap.json#/avatarProfile",
      "D2P-REF-007 fitMap.json#/bodyModelRef",
      "D2P-REF-007 fitMap.json#/solverProfile",
    ]);
  });

  it("recomputes body, draped and rest mesh digests (D2P-REF-011)", async () => {
    assert.deepEqual(await delta("referential", (w) => {
      w.body.mesh.positionsM[0][0] = 0.5;
      w.draped.positionsM[0][0] = 0.5;
      w.draped.restMeshDigest = `sha256:${"d".repeat(64)}`;
    }), [
      "D2P-REF-011 body.json#/meshDigest",
      "D2P-REF-011 draped.json#/meshDigest",
      "D2P-REF-011 draped.json#/restMeshDigest",
      "D2P-REF-011 fitMap.json#/bodyModelRef/digest",
      "D2P-REF-011 fitMapB.json#/bodyModelRef/digest",
      "D2P-REF-011 scene.json#/bodyModelRef/digest",
      "D2P-REF-011 scene.json#/drapedMeshRefs/0/drapedMeshRef/digest",
      "D2P-REF-011 sceneB.json#/bodyModelRef/digest",
    ]);
    assert.deepEqual(await delta("referential", (w) => {
      w.scene.drapedMeshRefs[0].meshDigest = `sha256:${"d".repeat(64)}`;
      w.scene.sceneDigest = sceneDigestOf(w.scene);
    }, { codes: ["D2P-REF-011"] }), [
      "D2P-REF-011 fitMap.json#/sceneSnapshotRef/digest",
      "D2P-REF-011 scene.json#/drapedMeshRefs/0/meshDigest",
      "D2P-REF-011 simReport.json#/sceneSnapshotRef/digest",
    ]);
  });

  it("resolves derivedRefs of drapes to their document types", async () => {
    assert.deepEqual(await delta("referential", (w) => {
      w.draped.restMeshRef.id = "dpm_t-b";
    }, { codes: ["D2P-REF-001"] }), ["D2P-REF-001 draped.json#/restMeshRef"]);
  });
});

describe("semantic drape checks", () => {
  it("D2P-SEM-127: avatar profile derivations, tolerances and zones", async () => {
    assert.deepEqual(await delta("semantic", (w) => {
      w.avatar.derivations.push({ definitionId: "d2p:body.waist-girth", interceptMm: 0, terms: [{ definitionId: NECK, coefficient: 1 }] });
      w.avatar.derivations.push({ definitionId: HEIGHT, interceptMm: 0, terms: [{ definitionId: CHEST, coefficient: 1 }] });
      w.avatar.tolerances.push({ definitionId: "d2p:body.hip-girth", maxDeviationMm: 5 });
      w.avatar.zones[0].landmarkIds = ["d2p:landmark.crotch"];
    }).then((out) => out.filter((k) => k.includes("avatar.json"))), [
      "D2P-SEM-127 avatar.json#/derivations/1/terms/0/definitionId",
      "D2P-SEM-127 avatar.json#/derivations/2/definitionId",
      "D2P-SEM-127 avatar.json#/tolerances",
      "D2P-SEM-127 avatar.json#/tolerances/3/definitionId",
      "D2P-SEM-127 avatar.json#/zones/0/landmarkIds/0",
    ]);
  });

  it("D2P-SEM-127: body model targets, origins, status, deviations, landmarks and pose", async () => {
    assert.deepEqual(await delta("semantic", (w) => {
      w.body.controlMeasures[0].origin = "profile";
      w.body.controlMeasures[1] = { ...w.body.controlMeasures[1], targetMm: 1710, deviationMm: -11 };
      w.body.controlMeasures[2].deviationMm = 9;
      w.body.landmarks.pop();
      w.body.pose = "org.example.pose:t-pose";
    }), [
      "D2P-SEM-127 body.json#/controlMeasures/0/origin",
      "D2P-SEM-127 body.json#/controlMeasures/1/deviationMm",
      "D2P-SEM-127 body.json#/controlMeasures/1/targetMm",
      "D2P-SEM-127 body.json#/controlMeasures/2/deviationMm",
      "D2P-SEM-127 body.json#/landmarks",
      "D2P-SEM-127 body.json#/pose",
    ]);
  });

  it("D2P-SEM-127: overflowing deviations and inferred targets are reported, not thrown", async () => {
    assert.deepEqual(await delta("semantic", (w) => {
      w.body.controlMeasures[0] = { ...w.body.controlMeasures[0], targetMm: -1.7e308, measuredMm: 1.7e308, deviationMm: 1 };
    }, { codes: ["D2P-SEM-127"] }), [
      "D2P-SEM-127 body.json#/controlMeasures/0/deviationMm",
      "D2P-SEM-127 body.json#/controlMeasures/0/targetMm",
    ]);
    assert.deepEqual(await delta("semantic", (w) => {
      w.avatar.derivations[0].terms[0].coefficient = 1e306;
    }, { codes: ["D2P-SEM-127"] }), [
      "D2P-SEM-127 body.json#/controlMeasures/2/targetMm",
      "D2P-SEM-127 expectation.json#/controlMeasures/2/targetMm",
    ]);
  });

  it("D2P-SEM-127: a succeeded body model of a source without a required value (AVA-003)", async () => {
    const out = await delta("semantic", (w) => {
      w.sizes.sizes[0].measurements = w.sizes.sizes[0].measurements.filter((m) => m.definitionId !== HEIGHT);
    });
    assert.ok(out.includes("D2P-SEM-127 body.json#/status"), out.join("; "));
    assert.ok(out.includes("D2P-SEM-127 body.json#/controlMeasures/1"), out.join("; "));
  });

  it("D2P-SEM-127: expectation tolerances, status and missing definitions", async () => {
    assert.deepEqual(await delta("semantic", (w) => {
      w.expectation.controlMeasures[0].maxDeviationMm = 4;
      w.expectation.missingDefinitions = [HEIGHT];
    }), [
      "D2P-SEM-127 expectation.json#/controlMeasures/0/maxDeviationMm",
      "D2P-SEM-127 expectation.json#/missingDefinitions",
    ]);
    assert.deepEqual(await delta("semantic", (w) => {
      w.expectation.expectedStatus = "failed";
    }), ["D2P-SEM-127 expectation.json#/expectedStatus"]);
  });

  it("D2P-SEM-128: configuration materials, material classes and binding poses", async () => {
    assert.deepEqual(await delta("semantic", (w) => {
      w.garment.simulationConfigurations[0].materials[0].materialPhysicsProfile = { id: KNIT.profileId, version: KNIT.version };
      w.garment.simulationConfigurations[1].materials.push(structuredClone(w.garment.simulationConfigurations[1].materials[0]));
      w.garment.bodyBindings[1].pose = "org.example.pose:t-pose";
    }), [
      "D2P-SEM-128 garment.json#/bodyBindings/1/pose",
      "D2P-SEM-128 garment.json#/simulationConfigurations/0/materials/0/materialPhysicsProfile",
      "D2P-SEM-128 garment.json#/simulationConfigurations/1/materials/1",
    ]);
    assert.deepEqual(await delta("semantic", (w) => {
      w.garment.simulationConfigurations[0].materials = [];
    }), ["D2P-SEM-128 garment.json#/simulationConfigurations/0/materials"]);
  });

  it("D2P-SEM-129: draped meshes of a physical scene", async () => {
    const w0 = seal(world());
    assert.deepEqual(await delta("semantic", (w) => {
      w.draped.positionsM.push([0, 0, 0]);
      w.draped.simulationConfigurationId = "drape-body-profile";
      w.body.status = "failed";
    }), [
      "D2P-SEM-127 body.json#/controlMeasures/0",
      "D2P-SEM-127 body.json#/controlMeasures/1",
      "D2P-SEM-127 body.json#/controlMeasures/2",
      "D2P-SEM-129 fitMap.json#/vertexFields/0/clearanceMm",
      "D2P-SEM-129 fitMap.json#/vertexFields/0/contactPressure",
      "D2P-SEM-129 fitMap.json#/vertexFields/0/strain",
      "D2P-SEM-129 scene.json#/bodyModelRef",
      "D2P-SEM-129 scene.json#/drapedMeshRefs/0",
      "D2P-SEM-129 sceneB.json#/bodyModelRef",
    ]);
    assert.deepEqual(await delta("semantic", (w) => {
      w.scene.drapedMeshRefs = [];
      w.sceneB.qualityStatus = "failed";
    }), [
      "D2P-SEM-129 fitMap.json#/vertexFields/0/panelInstanceId",
      "D2P-SEM-129 fitMapB.json#/sceneSnapshotRef",
      "D2P-SEM-129 scene.json#/drapedMeshRefs",
      "D2P-SEM-129 sceneB.json#/drapedMeshRefs",
    ]);
    /** Changes the draped mesh of scene A and reseals its digests and the scene's entry. */
    const redrape = (change) => (w) => {
      change(w.draped);
      w.draped.meshDigest = drapedMeshDigestOf(w.draped);
      w.draped.resultDigest = resultDigestOf(w.draped, ["drapedMeshId"]);
      Object.assign(w.scene.drapedMeshRefs[0], { drapedMeshRef: derived(w.draped), meshDigest: w.draped.meshDigest });
      w.scene.sceneDigest = sceneDigestOf(w.scene);
    };
    assert.deepEqual(await delta("semantic", redrape((d) => {
      Object.assign(d, { restMeshRef: { id: "pmr_t-b", digest: w0.restB.resultDigest }, restMeshDigest: w0.restB.meshDigest });
    }), { codes: ["D2P-SEM-129"] }), ["D2P-SEM-129 scene.json#/drapedMeshRefs/0"]);
    assert.deepEqual(await delta("semantic", redrape((d) => {
      d.garmentRef = GARMENT_B_REF;
    }), { codes: ["D2P-SEM-129"] }), ["D2P-SEM-129 scene.json#/drapedMeshRefs/0"]);
  });

  it("D2P-SEM-129: fit map zones, vertex fields and material status (FMP-001)", async () => {
    assert.deepEqual(await delta("semantic", (w) => {
      w.fitMap.zones[0].landmarkIds = [VERTEX];
      w.fitMap.vertexFields[0].strain.pop();
      w.fitMap.materialStatus = "frozen";
      w.fitMapB.zones[0].zone = "d2p:waist";
    }), [
      "D2P-SEM-129 fitMap.json#/materialStatus",
      "D2P-SEM-129 fitMap.json#/vertexFields/0/strain",
      "D2P-SEM-129 fitMap.json#/zones/0/landmarkIds",
      "D2P-SEM-129 fitMapB.json#/zones",
      "D2P-SEM-129 fitMapB.json#/zones/0/zone",
    ]);
    assert.deepEqual(await delta("semantic", (w) => {
      w.woven = { ...w.woven, status: "frozen" };
    }), ["D2P-SEM-129 fitMap.json#/materialStatus", "D2P-SEM-129 fitMapB.json#/materialStatus"]);
    // vertexFields, when present, has exactly one entry per draped panel.
    assert.deepEqual(await delta("semantic", (w) => {
      w.fitMap.vertexFields.push(structuredClone(w.fitMap.vertexFields[0]));
      w.fitMapB.vertexFields[0].panelInstanceId = "panel-back";
    }), [
      "D2P-SEM-129 fitMap.json#/vertexFields/1/panelInstanceId",
      "D2P-SEM-129 fitMapB.json#/vertexFields",
      "D2P-SEM-129 fitMapB.json#/vertexFields/0/panelInstanceId",
    ]);
    assert.deepEqual(await delta("semantic", (w) => {
      delete w.fitMap.vertexFields;
    }), []);
  });

  it("D2P-SEM-129: sim-report solver profile, seed, kind and status", async () => {
    assert.deepEqual(await delta("semantic", (w) => {
      Object.assign(w.simReport, { randomSeed: 2, profileKind: "physical-cloth", status: "failed" });
    }), [
      "D2P-SEM-129 simReport.json#/profileKind",
      "D2P-SEM-129 simReport.json#/randomSeed",
      "D2P-SEM-129 simReport.json#/status",
    ]);
  });

  it("D2P-SEM-130: drape expectation bodies and zone metrics (DRP-004)", async () => {
    assert.deepEqual(await delta("semantic", (w) => {
      w.fitMapB.zones[0].meanClearanceMm = 10;
    }), ["D2P-SEM-130 drapeExpectation.json#/comparisons/0"]);
    assert.deepEqual(await delta("semantic", (w) => {
      w.drapeExpectation.comparisons[0].higher.simulationConfigurationId = "drape-body-profile";
    }), ["D2P-SEM-130 drapeExpectation.json#/comparisons/0"]);
  });

  it("D2P-SEM-050: personal-derived documents state personalDerived, directly and transitively", async () => {
    const personal = (w) => {
      Object.assign(w.profile, { subject: { kind: "individual" }, dataClassification: "sensitive-personal" });
      delete w.profile.baseline;
      w.profile.measurements = [value(CHEST, 900, "manual", "self-measured"), value(HEIGHT, 1650, "manual", "self-measured")];
      w.body.source = { kind: "body-measurement-profile", bodyMeasurementProfileRef: PROFILE_REF };
      w.body.controlMeasures = [
        { definitionId: CHEST, origin: "profile", targetMm: 900, measuredMm: 900, deviationMm: 0 },
        { definitionId: HEIGHT, origin: "profile", targetMm: 1650, measuredMm: 1650, deviationMm: 0 },
        { definitionId: NECK, origin: "inferred", targetMm: 352, measuredMm: 352, deviationMm: 0 },
      ];
      w.scene.simulationConfigurationId = "drape-body-profile";
      w.draped.simulationConfigurationId = "drape-body-profile";
    };
    const out = await delta("semantic", personal);
    for (const k of [
      "D2P-SEM-050 body.json#/source/bodyMeasurementProfileRef",
      "D2P-SEM-050 draped.json#/simulationConfigurationId",
      "D2P-SEM-050 expectation.json#/source/bodyMeasurementProfileRef",
      "D2P-SEM-050 fitMap.json#/bodyModelRef",
      "D2P-SEM-050 fitMap.json#/sceneSnapshotRef",
      "D2P-SEM-050 fitMapB.json#/bodyModelRef",
      "D2P-SEM-050 scene.json#/bodyModelRef",
      "D2P-SEM-050 scene.json#/simulationConfigurationId",
      "D2P-SEM-050 simReport.json#/sceneSnapshotRef",
    ]) assert.ok(out.includes(k), `${k} in ${out.join("; ")}`);
    const declared = await delta("semantic", (w) => {
      personal(w);
      for (const d of [w.body, w.expectation, w.draped, w.scene, w.sceneB, w.fitMap, w.fitMapB, w.simReport]) d.personalDerived = true;
    });
    assert.deepEqual(declared.filter((k) => k.startsWith("D2P-SEM-050")), []);
    // A sim-report is personal-derived only through its scene: a direct
    // reference to a personal artifact stays as unconstrained as in 0.2.1.
    assert.deepEqual(await delta("semantic", (w) => {
      w.profile.dataClassification = "personal";
      w.simReport.inputDigests = [pin("body-measurement-profile", PROFILE_REF, w.profile)];
    }, { codes: ["D2P-SEM-050"] }).then((out) => out.filter((k) => k.includes("simReport.json"))), []);
    const w = seal(world());
    personal(w);
    assert.equal(isPersonalDerived(bundle(w), w.fitMap), true);
    assert.equal(isPersonalDerived(bundle(seal(world())), w.fitMap), false);
  });

  it("D2P-SEM-052: findings about personal-derived documents are restricted", async () => {
    const report = {
      documentType: "d2p:validation-report", schemaVersion: V, reportId: "vrp_t", targetRefs: [PROFILE_REF], derivedSubjectRefs: [{ id: "fmp_t-a" }, { id: "pev_t-personal" }],
      findings: [
        { findingId: "f-1", ruleId: "org.example:fit", ruleVersion: V, code: "D2P-SEM-129", severity: "warning", message: "Tight.", subjectRef: { id: "fmp_t-a" }, visibility: "general" },
        { findingId: "f-2", ruleId: "org.example:fit", ruleVersion: V, code: "D2P-SEM-076", severity: "warning", message: "Table.", elementRefs: [{ ...PROFILE_REF, elementId: "x" }], visibility: "general" },
        { findingId: "f-3", ruleId: "org.example:fit", ruleVersion: V, code: "D2P-SEM-070", severity: "warning", message: "Eval.", subjectRef: { id: "pev_t-personal" }, visibility: "general" },
      ],
    };
    // A 2D evaluation that pins the personal profile states no personalDerived
    // and is no personal-derived document of module 3d: its findings, like
    // findings on elements of the personal profile, stay as valid as in 0.2.1.
    const evaluation = { documentType: "d2p:pattern-evaluation", schemaVersion: V, evaluationId: "pev_t-personal", request: { bodyMeasurementProfileRef: PROFILE_REF }, inputDigests: [{ role: "body-measurement-profile", artifactRef: PROFILE_REF }] };
    assert.deepEqual(await delta("semantic", (w) => {
      w.report = structuredClone(report);
      w.evaluation = structuredClone(evaluation);
    }).then((out) => out.filter((k) => k.startsWith("D2P-SEM-052"))), []);
    assert.deepEqual(await delta("semantic", (w) => {
      w.report = structuredClone(report);
      w.evaluation = structuredClone(evaluation);
      w.fitMap.personalDerived = true;
      w.profile.dataClassification = "personal";
    }).then((out) => out.filter((k) => k.startsWith("D2P-SEM-052"))), ["D2P-SEM-052 report.json#/findings/0/visibility"]);
    // Personal-derived through its references without stating it (the fit map's scene binds the personal profile).
    assert.deepEqual(await delta("semantic", (w) => {
      w.report = structuredClone(report);
      w.profile.dataClassification = "personal";
      w.scene.simulationConfigurationId = "drape-body-profile";
    }).then((out) => out.filter((k) => k.startsWith("D2P-SEM-052"))), ["D2P-SEM-052 report.json#/findings/0/visibility"]);
  });

  it("D2P-SEM-076: baseline values agree with their size entry (SZT-001)", async () => {
    assert.deepEqual(await delta("semantic", (w) => {
      w.profile.measurements[0].value = 961;
      w.profile.measurements.push(value(NECK, 380, "size-table", "self-measured"));
      w.profile.measurements.push(value("d2p:body.hip-girth", 1000, "size-table", "size-table"));
    }).then((out) => out.filter((k) => k.startsWith("D2P-SEM-076"))), [
      "D2P-SEM-076 profile.json#/measurements/0/value",
      "D2P-SEM-076 profile.json#/measurements/2/source/kind",
      "D2P-SEM-076 profile.json#/measurements/3/definitionId",
    ]);
  });

  it("D2P-SEM-075: avatar profiles and body models use body definitions", async () => {
    assert.deepEqual(await delta("semantic", (w) => {
      w.avatar.tolerances.push({ definitionId: "d2p:garment.chest-width-flat", maxDeviationMm: 5 });
      w.expectation.controlMeasures.push({ definitionId: "d2p:garment.chest-width-flat", origin: "profile", targetMm: 500, maxDeviationMm: 5 });
    }).then((out) => out.filter((k) => k.startsWith("D2P-SEM-075"))), [
      "D2P-SEM-075 avatar.json#/tolerances/3/definitionId",
      "D2P-SEM-075 expectation.json#/controlMeasures/3/definitionId",
    ]);
  });
});
