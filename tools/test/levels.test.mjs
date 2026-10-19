// Unit tests of the three conformance levels on in-memory bundles. The
// documents are taken from the committed case data and mutated per test.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { contentDigestOf, digestOf, resultDigestOf } from "../lib/c14n.mjs";
import { checkBundle } from "../lib/conformance.mjs";
import { evidenceState, gateDecision, materialConditionMet, polylineSelfIntersection } from "../lib/semantic.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const load = async (p) => JSON.parse(await readFile(path.join(REPO_ROOT, p), "utf8"));
const REGISTRY = "vocabularies/measurement-definitions/measurement-definitions-1.0.0.json";

const PATTERN = await load("conformance/semantic/valid-pattern/pattern.json");
const SNAPSHOT = await load("conformance/semantic/topology/TOP-002-simple-snapshot-contour/geometry-snapshot.json");
const EXPORT_DIR = "conformance/semantic/print-job-calibrated";
const EVALUATION = await load(`${EXPORT_DIR}/pattern-evaluation.json`);
const EXPORT_SNAPSHOT = await load(`${EXPORT_DIR}/geometry-snapshot.json`);
const PRINT_JOB = await load(`${EXPORT_DIR}/print-job-spec.json`);
const GATE_DIR = "conformance/semantic/gate-allow-with-waiver";
const GATE = await load(`${GATE_DIR}/gate-evaluation.json`);
const REPORT = await load(`${GATE_DIR}/validation-report.json`);
const WAIVER = await load(`${GATE_DIR}/waiver.json`);
const PROFILE = await load(`${GATE_DIR}/validation-profile.json`);
const RULE = await load(`${GATE_DIR}/validation-rule.json`);
const REGISTRY_DOC = await load(REGISTRY);

const clone = (x) => structuredClone(x);
const doc = (value, p = "subject.json", role = "subject") => ({ path: p, role, value });

/** Runs a level on documents and returns "CODE@instancePath" strings. */
async function run(level, docs) {
  const { diagnostics } = await checkBundle(REPO_ROOT, docs, level);
  return diagnostics.map((d) => `${d.code}@${d.instancePath ?? ""}`);
}
const codes = (list) => [...new Set(list.map((s) => s.split("@")[0]))].sort();
const refOf = (d) => ({ artifactId: d.artifactId, revisionId: d.revisionId });

describe("structural level", () => {
  it("rejects a non-object document and a missing schemaVersion", async () => {
    assert.deepEqual(await run("structural", [doc([1, 2])]), ["D2P-STR-002@"]);
    const p = clone(PATTERN);
    delete p.schemaVersion;
    assert.deepEqual(codes(await run("structural", [doc(p)])), ["D2P-STR-003"]);
  });

  it("applies the version gate to embedded documents", async () => {
    const e = clone(EVALUATION);
    e.request.schemaVersion = "2.0.0";
    assert.deepEqual(await run("structural", [doc(e)]), ["D2P-STR-003@/request/schemaVersion"]);
  });

  it("reports unpinned elements of …Refs arrays", async () => {
    const r = clone(REPORT);
    r.targetRefs[0] = { artifactId: PATTERN.artifactId };
    assert.ok((await run("structural", [doc(r)])).includes("D2P-STR-011@/targetRefs/0"));
  });

  it("allows benchmark units only in benchmark documents", async () => {
    const report = await load("examples/benchmark/test-run-report/valid/evaluator-failed-seam-length.json");
    assert.deepEqual(await run("structural", [doc(report)]), []);
    const p = clone(PATTERN);
    p.parameters[0].expr = { op: "literal", value: 1, unit: "ms" };
    assert.ok((await run("structural", [doc(p)])).includes("D2P-STR-012@/parameters/0/expr/unit"));
  });

  it("reports a missing op as a forbidden expression node", async () => {
    const p = clone(PATTERN);
    p.parameters[0].expr = { value: 1, unit: "mm" };
    assert.ok((await run("structural", [doc(p)])).includes("D2P-STR-010@/parameters/0/expr"));
  });
});

describe("referential level", () => {
  it("requires one value per measurement definition in a body measurement profile", async () => {
    const profile = await load("conformance/semantic/private-measurement-export/body-measurement-profile.json");
    assert.deepEqual(await run("referential", [doc(profile), doc(REGISTRY_DOC, REGISTRY, "context")]), []);
    profile.measurements.push({ ...profile.measurements[0], value: profile.measurements[0].value + 10 });
    assert.deepEqual(await run("referential", [doc(profile), doc(REGISTRY_DOC, REGISTRY, "context")]), ["D2P-REF-005@/measurements/1/definitionId"]);
  });

  it("gives a definitionId one meaning across the declared registries, in either order (D2P-REF-015)", async () => {
    const dir = "conformance/semantic/definition-kinds-consistent";
    const sizes = await load(`${dir}/size-system.json`);
    const chest = REGISTRY_DOC.definitions.find((d) => d.definitionId === "d2p:body.chest-girth");
    const other = (definition) => ({ documentType: "d2p:measurement-definition-registry", schemaVersion: "1.0.0", registryId: "org.example.other:defs", version: "1.0.0", definitions: [definition] });
    const redefined = other({ ...clone(chest), kind: "garment", dimension: "angle", unit: "rad", path: { type: "width", description: "Redefined." } });
    const OTHER = { id: "org.example.other:defs", version: "1.0.0" };
    const runWith = (refs, registry) => {
      const s = clone(sizes);
      s.definitionRegistries = refs;
      return run("referential", [doc(s), doc(REGISTRY_DOC, REGISTRY, "context"), doc(registry, "other.json", "context")]);
    };
    const STD = sizes.definitionRegistries[0];
    assert.deepEqual(await runWith([STD, OTHER], redefined), ["D2P-REF-015@/definitionRegistries/1"], "appended");
    assert.deepEqual(await runWith([OTHER, STD], redefined), ["D2P-REF-015@/definitionRegistries/1"], "prepended");
    assert.deepEqual(await runWith([STD, OTHER], other(clone(chest))), [], "identical copies are allowed");
    // Semantic rules never run on the ambiguous bundle, so no order-dependent SEM codes appear.
    const s = clone(sizes);
    s.definitionRegistries = [OTHER, STD];
    const { diagnostics } = await checkBundle(REPO_ROOT, [doc(s), doc(REGISTRY_DOC, REGISTRY, "context"), doc(redefined, "other.json", "context")], "semantic");
    assert.deepEqual(codes(diagnostics.map((d) => `${d.code}@`)), ["D2P-REF-015"]);
  });

  it("gives a definitionId one meaning across the documents one request pins (D2P-REF-015)", async () => {
    const dir = "conformance/referential/request-definition-registries-ambiguous";
    const files = ["pattern.json", "size-system.json", "fit-profile.json", "revision-pattern-r1.json", "artifact-pattern.json", "other-registry.json"];
    const context = await Promise.all(files.map(async (f) => doc(await load(`${dir}/${f}`), f, "context")));
    const request = await load(`${dir}/evaluation-request.json`);
    const base = [doc(REGISTRY_DOC, REGISTRY, "context")];
    assert.deepEqual(await run("referential", [doc(request), ...context, ...base]), ["D2P-REF-015@/sizeSystemRef"]);
    const noSize = clone(request);
    delete noSize.sizeSystemRef;
    delete noSize.sizeKey;
    assert.deepEqual(await run("referential", [doc(noSize), ...context, ...base]), [], "without the size system the context is unambiguous");
  });

  it("accepts identical copies but rejects different documents with one identity key", async () => {
    assert.deepEqual(await run("referential", [doc(PATTERN, "a.json"), doc(clone(PATTERN), "b.json")]), []);
    const other = clone(PATTERN);
    other.name = "Changed";
    assert.deepEqual(await run("referential", [doc(PATTERN, "a.json"), doc(other, "b.json")]), ["D2P-REF-005@"]);
  });

  it("checks derivedRef digests against the recomputed target digest", async () => {
    const gate = clone(GATE);
    gate.reportRefs[0].digest = `sha256:${"2".repeat(64)}`;
    const out = await run("referential", [doc(gate, "gate.json"), doc(REPORT, "report.json"), doc(WAIVER, "waiver.json"), doc(PROFILE, "profile.json"), doc(RULE, "rule.json"), doc(PATTERN, "pattern.json")]);
    assert.deepEqual(out, ["D2P-REF-011@/reportRefs/0/digest"]);
  });

  it("checks inputDigests and print provenance digests", async () => {
    const snap = clone(SNAPSHOT);
    snap.inputDigests[0].digest = `sha256:${"3".repeat(64)}`;
    assert.deepEqual(await run("referential", [doc(snap, "snap.json"), doc(PATTERN, "pattern.json")]), ["D2P-REF-011@/inputDigests/0/digest"]);
    const job = clone(PRINT_JOB);
    job.provenance.sceneDigest = `sha256:${"4".repeat(64)}`;
    const out = await run("referential", [doc(job, "job.json"), doc(EVALUATION, "e.json"), doc(EXPORT_SNAPSHOT, "s.json"), doc(PATTERN, "p.json")]);
    assert.deepEqual(out, ["D2P-REF-011@/provenance/sceneDigest"]);
  });

  it("resolves snapshot element IDs against the pinned pattern", async () => {
    const snap = clone(SNAPSHOT);
    snap.pieces[0].contours[0].segments[0].edgeId = "back-shoulder";
    snap.interfaces[4].cutInstanceKey = "sleeve-middle";
    const out = await run("referential", [doc(snap, "snap.json"), doc(PATTERN, "pattern.json")]);
    assert.deepEqual(out.sort(), ["D2P-REF-003@/pieces/0/contours/0/segments/0/edgeId", "D2P-REF-010@/interfaces/4/cutInstanceKey"]);
  });

  it("rejects an unknown feature output and a missing registry", async () => {
    const p = clone(PATTERN);
    p.parameters[0].expr = { op: "featureOutput", featureId: "f-bl", output: "length" };
    p.definitionRegistries = [{ id: "org.example.test:registry", version: "1.0.0" }];
    assert.deepEqual((await run("referential", [doc(p)])).sort(), ["D2P-REF-004@/parameters/0/expr", "D2P-REF-008@/definitionRegistries/0"]);
  });

  it("detects a gate evaluated after its target revision was superseded", async () => {
    const r2 = { ...clone(PATTERN), revisionId: "rev_conformance-square-r2" };
    const rec2 = {
      documentType: "d2p:revision",
      schemaVersion: "1.0.0",
      revisionId: r2.revisionId,
      artifactId: r2.artifactId,
      sequence: 2,
      parentRevisionIds: [PATTERN.revisionId],
      contentDigest: contentDigestOf(r2),
      createdAt: "2026-01-01T12:00:00Z",
      author: { kind: "system", principalId: "prn_test" },
    };
    const out = await run("referential", [doc(GATE, "gate.json"), doc(REPORT, "report.json"), doc(WAIVER, "waiver.json"), doc(PROFILE, "profile.json"), doc(RULE, "rule.json"), doc(PATTERN, "p1.json"), doc(r2, "p2.json"), doc(rec2, "rec2.json")]);
    assert.deepEqual(out, ["D2P-REF-006@/targetRefs/0"]);
  });

  it("requires create-command content IDs to match the target", async () => {
    const command = {
      documentType: "d2p:command",
      schemaVersion: "1.0.0",
      commandId: "cmd_test-create",
      idempotencyKey: "test-create",
      type: "d2p:artifact.create",
      target: { artifactId: "art_test-other", branch: "main" },
      payload: { artifactType: "d2p:pattern", name: "Created", dataClassification: "public", initialRevisionId: "rev_test-other-r1", content: clone(PATTERN) },
      actorContext: { actorPrincipalId: "prn_test" },
    };
    const out = await run("referential", [doc(command)]);
    assert.deepEqual(out.sort(), ["D2P-REF-007@/payload/content/artifactId", "D2P-REF-007@/payload/content/revisionId"]);
  });

  it("checks configuration keys against a fixture manifest in the bundle", async () => {
    const request = await load("conformance/referential/resolving-bundle/evaluation-request.json");
    const fit = await load("conformance/referential/resolving-bundle/fit-profile.json");
    const sizes = await load("conformance/referential/resolving-bundle/size-system.json");
    const manifest = await load("conformance/referential/manifest-integrity/fixture/manifest.json");
    manifest.configurations = [{ configurationKey: "regular", fitProfileRef: refOf(fit), materialAssumptions: { materialClass: "woven" } }];
    const bundle = (r) => [doc(r, "r.json"), doc(PATTERN, "p.json"), doc(fit, "f.json"), doc(sizes, "s.json"), doc(REGISTRY_DOC, REGISTRY), doc(manifest, "m.json", "context")];
    assert.deepEqual(await run("referential", bundle({ ...request, configurationKey: "relaxed" })), ["D2P-REF-013@/configurationKey"]);
    assert.deepEqual(await run("referential", bundle({ ...request, configurationKey: "regular", materialAssumptions: { materialClass: "knit" } })), ["D2P-REF-007@/materialAssumptions"]);
    assert.deepEqual(await run("referential", bundle({ ...request, configurationKey: "regular", materialAssumptions: { materialClass: "woven" } })), []);
  });

  it("requires a sizeSystemRef for size keys in fit profiles", async () => {
    const fit = await load("conformance/referential/resolving-bundle/fit-profile.json");
    fit.fitTargets = [{ id: "fit-chest", garmentDefinitionId: "d2p:garment.chest-girth", comparison: "min", min: { value: 900, unit: "mm" }, priority: 0, scope: { sizeKeys: ["size-a"] } }];
    fit.definitionRegistries = [{ id: "d2p:measurement-definitions", version: "1.0.0" }];
    assert.deepEqual(await run("referential", [doc(fit), doc(REGISTRY_DOC, REGISTRY)]), ["D2P-REF-009@/fitTargets/0/scope/sizeKeys/0"]);
  });
});

describe("vocabulary order and mapping profiles", () => {
  it("reports unsorted and duplicate profile rules and mapping entries (D2P-REF-014, D2P-REF-005)", async () => {
    const unsorted = clone(PROFILE);
    unsorted.rules = [{ ruleId: "org.example.z:rule", ruleVersion: "1.0.0", severity: "error" }, ...unsorted.rules];
    assert.ok((await run("referential", [doc(unsorted)])).includes("D2P-REF-014@/rules/1"));
    const dup = clone(PROFILE);
    dup.rules.push(clone(dup.rules[0]));
    assert.ok((await run("referential", [doc(dup)])).includes("D2P-REF-005@/rules/1/ruleId"));
    const mapping = await load("examples/core/mapping-profile/valid/measurement-terms.json");
    assert.deepEqual(await run("referential", [doc(mapping)]), []);
    const reversed = clone(mapping);
    reversed.entries.reverse();
    assert.deepEqual(await run("referential", [doc(reversed)]), ["D2P-REF-014@/entries/1"]);
    const twice = clone(mapping);
    twice.entries.splice(1, 0, clone(twice.entries[0]));
    assert.deepEqual(await run("referential", [doc(twice)]), ["D2P-REF-005@/entries/1"]);
  });
});

describe("semantic level", () => {
  it("requires match-point notches on the interface of their side (D2P-SEM-025)", async () => {
    const base = await load("conformance/semantic/match-points-on-interfaces/pattern.json");
    assert.deepEqual(await run("semantic", [doc(base)]), []);
    const c = base.seamConnections.findIndex((x) => x.matchPoints);
    const otherEdge = clone(base);
    otherEdge.pieces.find((x) => x.id === "front").notches[0].edgeId = "front-hem";
    assert.deepEqual(await run("semantic", [doc(otherEdge)]), [`D2P-SEM-025@/seamConnections/${c}/matchPoints/0/notchIdA`]);
    const reversedInterval = clone(base);
    // Side B runs reverse over back-side-right; position 0.75 lies inside [0.5, 1] whatever the direction.
    reversedInterval.seamInterfaces.find((i) => i.id === "si-back-side-left").segments = [{ edgeId: "back-side-right", from: 0.5, to: 1, direction: "reverse" }];
    assert.deepEqual(await run("semantic", [doc(reversedInterval)]), []);
    reversedInterval.pieces.find((x) => x.id === "back").notches[0].position = 0.4;
    assert.deepEqual(await run("semantic", [doc(reversedInterval)]), [`D2P-SEM-025@/seamConnections/${c}/matchPoints/0/notchIdB`]);
  });

  it("requires the canonical unit of a definition's dimension (D2P-SEM-070)", async () => {
    assert.deepEqual(await run("semantic", [doc(REGISTRY_DOC, REGISTRY)]), []);
    const r = clone(REGISTRY_DOC);
    r.definitions[0].unit = r.definitions[0].dimension === "length" ? "rad" : "mm";
    assert.deepEqual(await run("semantic", [doc(r, REGISTRY)]), ["D2P-SEM-070@/definitions/0/unit"]);
  });

  it("checks definition kinds of fit targets and body profile values", async () => {
    const fp = await load("conformance/semantic/definition-kinds-consistent/fit-profile.json");
    fp.fitTargets = [{ id: "fit-chest", garmentDefinitionId: "d2p:body.chest-girth", comparison: "min", min: { value: 900, unit: "mm" }, priority: 0 }];
    assert.deepEqual(await run("semantic", [doc(fp), doc(REGISTRY_DOC, REGISTRY, "context")]), ["D2P-SEM-075@/fitTargets/0/garmentDefinitionId"]);
    const profile = await load("conformance/semantic/private-measurement-export/body-measurement-profile.json");
    profile.measurements[0].definitionId = "d2p:garment.chest-girth";
    assert.deepEqual(await run("semantic", [doc(profile), doc(REGISTRY_DOC, REGISTRY, "context")]), ["D2P-SEM-075@/measurements/0/definitionId"]);
  });

  it("checks line-only snapshot orientation", async () => {
    const snap = clone(SNAPSHOT);
    const c = snap.pieces[0].contours[0];
    // Clockwise rectangle.
    const [x0, y0] = c.start;
    c.segments[0].end = [x0, y0 + 300];
    c.segments[1].end = [x0 + 200, y0 + 300];
    c.segments[2].end = [x0 + 200, y0];
    c.segments[3].end = [x0, y0];
    assert.deepEqual(await run("semantic", [doc(snap, "snap.json"), doc(PATTERN, "p.json")]), ["D2P-SEM-012@/pieces/0/contours/0"]);
    c.segments[3].end = [x0 + 1, y0];
    assert.ok((await run("semantic", [doc(snap, "snap.json"), doc(PATTERN, "p.json")])).includes("D2P-SEM-010@/pieces/0/contours/0"));
  });

  it("reports edge reuse, invalid intervals and ambiguous cut instances", async () => {
    const p = clone(PATTERN);
    p.pieces[0].contours[0].edges.push({ id: "front-hem-again", curveFeatureId: "f-bottom-curve", reversed: false });
    p.seamInterfaces[0].segments[0] = { edgeId: "front-side-left", from: 0.6, to: 0.2, direction: "forward" };
    delete p.seamInterfaces[4].cutInstanceKey;
    p.seamInterfaces.push({ id: "si-two-pieces", segments: [{ edgeId: "front-top", from: 0, to: 1, direction: "forward" }, { edgeId: "back-top", from: 0, to: 1, direction: "forward" }] });
    const out = await run("semantic", [doc(p)]);
    for (const expected of ["D2P-SEM-013@/pieces/0/contours/0/edges/4", "D2P-SEM-021@/seamInterfaces/0/segments/0", "D2P-SEM-022@/seamInterfaces/4", "D2P-SEM-022@/seamInterfaces/8"]) {
      assert.ok(out.includes(expected), `${expected} in ${out}`);
    }
  });

  it("checks layer order entries of multi-layer groups", async () => {
    const p = clone(PATTERN);
    p.sewingGroups[0] = {
      id: "group-layers",
      type: "d2p:layered-seam",
      members: [{ connectionId: "seam-side-left" }, { connectionId: "seam-side-right" }],
      requirements: { groupTopology: "connected", validateMemberSeams: true, multiLayer: true },
      layerOrder: [
        { cutInstanceKey: "front", role: "org.example.test:outer" },
        { cutInstanceKey: "front", role: "org.example.test:outer" },
        { cutInstanceKey: "sleeve-left", role: "org.example.test:inner" },
      ],
    };
    assert.deepEqual((await run("semantic", [doc(p)])).sort(), ["D2P-SEM-033@/sewingGroups/0/layerOrder/1", "D2P-SEM-033@/sewingGroups/0/layerOrder/2"]);
  });

  it("finds static constraint conflicts", async () => {
    const p = clone(PATTERN);
    const lit = (value) => ({ expr: { op: "literal", value, unit: "mm" } });
    p.features.push(
      { id: "c-h", type: "d2p:constraint.horizontal", params: { lineFeatureId: "f-top-curve" } },
      { id: "c-v", type: "d2p:constraint.vertical", params: { lineFeatureId: "f-top-curve" } },
      { id: "c-par", type: "d2p:constraint.parallel", params: { aFeatureId: "f-top-curve", bFeatureId: "f-bottom-curve" } },
      { id: "c-perp", type: "d2p:constraint.perpendicular", params: { aFeatureId: "f-bottom-curve", bFeatureId: "f-top-curve" } },
      { id: "c-len", type: "d2p:constraint.length", params: { curveFeatureId: "f-left-curve", value: lit(-5) } },
      { id: "c-len-ok", type: "d2p:constraint.length", params: { curveFeatureId: "f-right-curve", value: { expr: { op: "param", parameterId: "body-height" } } } },
    );
    const out = await run("semantic", [doc(p)]);
    assert.deepEqual(codes(out), ["D2P-SEM-040"]);
    assert.equal(out.length, 3);
  });

  it("limits expression complexity and rejects boolean slot results", async () => {
    const p = clone(PATTERN);
    let node = { op: "literal", value: 1, unit: "mm" };
    for (let i = 0; i < 64; i += 1) node = { op: "neg", args: [node] };
    p.parameters[0].expr = node;
    p.parameters[1].expr = { op: "lt", args: [{ op: "literal", value: 1, unit: "mm" }, { op: "literal", value: 2, unit: "mm" }] };
    const out = await run("semantic", [doc(p)]);
    assert.ok(out.includes("D2P-SEM-003@/parameters/0/expr"));
    assert.ok(out.includes("D2P-SEM-002@/parameters/1/expr"));
  });

  it("checks fit profiles: unit, path-type equivalence and negative ease", async () => {
    const fit = await load("conformance/referential/resolving-bundle/fit-profile.json");
    fit.definitionRegistries = [{ id: "d2p:measurement-definitions", version: "1.0.0" }];
    fit.easeRules = [
      { id: "ease-flat", bodyDefinitionId: "d2p:body.chest-girth", garmentDefinitionId: "d2p:garment.chest-width-flat", easeType: "wearing", amount: { value: 40, unit: "mm" }, priority: 0 },
      { id: "ease-negative", bodyDefinitionId: "d2p:body.chest-girth", garmentDefinitionId: "d2p:garment.chest-girth", easeType: "design", amount: { value: -20, unit: "mm" }, priority: 1 },
      { id: "ease-angle", bodyDefinitionId: "d2p:body.waist-girth", garmentDefinitionId: "d2p:garment.chest-girth", easeType: "design", amount: { value: 0.1, unit: "rad" }, priority: 2 },
    ];
    const { diagnostics } = await checkBundle(REPO_ROOT, [doc(fit), doc(REGISTRY_DOC, REGISTRY)], "semantic");
    assert.deepEqual(diagnostics.map((d) => `${d.code}@${d.instancePath}:${d.severity}`).sort(), [
      "D2P-SEM-070@/easeRules/2/amount/unit:error",
      "D2P-SEM-071@/easeRules/0:error",
      "D2P-SEM-073@/easeRules/1/amount:warning",
    ]);
  });

  it("checks grading rule sets", async () => {
    const grading = {
      documentType: "d2p:grading-rule-set",
      schemaVersion: "1.0.0",
      artifactId: "art_test-grading",
      revisionId: "rev_test-grading-r1",
      patternRef: refOf(PATTERN),
      mode: "point-increment",
      rules: [
        { id: "grade-corner", kind: "point-increment", pointFeatureId: "f-tr", increments: [{ sizeKey: "size-b", dxMm: 10, dyMm: 0 }] },
        { id: "grade-width", kind: "parameter-override", parameterId: "front-width", bySize: [{ sizeKey: "size-b", expr: { op: "literal", value: 0.2, unit: "rad" } }] },
      ],
    };
    const out = await run("semantic", [doc(grading), doc(PATTERN, "p.json")]);
    assert.deepEqual(out.sort(), ["D2P-SEM-002@/rules/1/bySize/0/expr", "D2P-SEM-080@/rules", "D2P-SEM-080@/rules/0", "D2P-SEM-080@/rules/1"]);
  });

  it("checks print scenes and jobs", async () => {
    const job = clone(PRINT_JOB);
    const scene = job.scene;
    const inst = scene.pieceInstances[0];
    inst.paths[0].closed = false;
    inst.markers[0].layerId = "missing";
    const second = clone(inst);
    second.id = "front-size-b";
    second.sizeKey = "size-b";
    second.paths[0].id = "front-cut-b";
    second.markers[0].id = "front-grain-b";
    second.labels.forEach((l, i) => (l.id = `front-label-b${i}`));
    scene.pieceInstances.push(second);
    scene.source.evaluations.push({ ...scene.source.evaluations[0], sizeKey: "size-b" });
    scene.sizeStyles = [{ sizeKey: "size-a", label: "A" }];
    job.pageLayout.media.widthMm = 200;
    job.requiredExtensions = ["org.example.test"];
    scene.resultDigest = resultDigestOf(scene, ["sceneId"]);
    job.provenance.sceneDigest = scene.resultDigest;
    const out = await run("semantic", [doc(job, "job.json"), doc(EVALUATION, "e.json"), doc(EXPORT_SNAPSHOT, "s.json"), doc(PATTERN, "p.json")]);
    // Size B holds only one cut instance, so D2P-SEM-096 reports the missing ones.
    assert.deepEqual(codes(out), ["D2P-SEM-006", "D2P-SEM-090", "D2P-SEM-092", "D2P-SEM-093", "D2P-SEM-094", "D2P-SEM-096"]);
    assert.ok(out.includes("D2P-SEM-090@/scene/pieceInstances/0/paths/0"));
  });

  it("ties scene instances to the cut instructions and the snapshot geometry (D2P-SEM-096)", async () => {
    const context = [doc(EVALUATION, "e.json", "context"), doc(EXPORT_SNAPSHOT, "s.json", "context"), doc(PATTERN, "p.json", "context")];
    const runScene = (scene) => {
      scene.resultDigest = resultDigestOf(scene, ["sceneId"]);
      return run("semantic", [doc(scene, "scene.json"), ...context]);
    };
    assert.deepEqual(await runScene(clone(PRINT_JOB.scene)), []);
    const i = PRINT_JOB.scene.pieceInstances.findIndex((p) => p.cutInstanceKey === "sleeve-right");
    const unmirrored = clone(PRINT_JOB.scene);
    unmirrored.pieceInstances[i].transform.mirror = false;
    const out = await runScene(unmirrored);
    assert.ok(out.includes(`D2P-SEM-096@/pieceInstances/${i}/transform/mirror`));
    assert.ok(out.includes(`D2P-SEM-096@/pieceInstances/${i}/paths/0`), "the unmirrored path no longer matches the transformed contour");
    const wrongPiece = clone(PRINT_JOB.scene);
    wrongPiece.pieceInstances[i].pieceId = "front";
    assert.ok((await runScene(wrongPiece)).includes(`D2P-SEM-096@/pieceInstances/${i}/pieceId`));
    const doubled = clone(PRINT_JOB.scene);
    const extra = clone(doubled.pieceInstances[i]);
    extra.id = "sleeve-right-copy";
    extra.paths[0].id = "sleeve-right-copy-cut";
    extra.markers[0].id = "sleeve-right-copy-grain";
    extra.labels[0].id = "sleeve-right-copy-label";
    doubled.pieceInstances.push(extra);
    assert.deepEqual(await runScene(doubled), ["D2P-SEM-096@/pieceInstances"]);
    const shifted = clone(PRINT_JOB.scene);
    shifted.pieceInstances[i].paths[0].segments[1].end[0] += 1e-9; // within the quantization slack
    assert.deepEqual(await runScene(shifted), []);
  });

  it("checks scene completeness with seam allowance included and on every layer (D2P-SEM-096)", async () => {
    const context = [doc(EVALUATION, "e.json", "context"), doc(EXPORT_SNAPSHOT, "s.json", "context"), doc(PATTERN, "p.json", "context")];
    const runScene = (scene) => {
      scene.resultDigest = resultDigestOf(scene, ["sceneId"]);
      return run("semantic", [doc(scene, "scene.json"), ...context]);
    };
    const i = PRINT_JOB.scene.pieceInstances.findIndex((p) => p.id === "front-size-a");
    const [tx, ty] = PRINT_JOB.scene.pieceInstances[i].transform.translate;
    const mapPath = (path, f) => ({ ...path, start: f(path.start), segments: path.segments.map((sg) => ({ ...sg, end: f(sg.end) })) });
    const scale2 = (p) => [tx + 2 * (p[0] - tx), ty + 2 * (p[1] - ty)];
    // seamAllowancePolicy "included" without seam lines: every contour is missing on a seam-line layer.
    const included = clone(PRINT_JOB.scene);
    included.seamAllowancePolicy = "included";
    const missingSeam = await runScene(clone(included));
    assert.deepEqual(missingSeam.sort(), included.pieceInstances.map((_, k) => `D2P-SEM-096@/pieceInstances/${k}/paths`).sort());
    // With seam lines added, the scene is accepted; the counter-examples are rejected.
    included.layers.push({ id: "seam", role: "d2p:seam-line", name: "Seam line" });
    for (const inst of included.pieceInstances) inst.paths.push({ ...clone(inst.paths[0]), id: `${inst.paths[0].id}-seam`, layerId: "seam" });
    assert.deepEqual(await runScene(clone(included)), []);
    const scaled = clone(included);
    scaled.pieceInstances[i].paths[0] = mapPath(scaled.pieceInstances[i].paths[0], scale2);
    assert.deepEqual(await runScene(scaled), [`D2P-SEM-096@/pieceInstances/${i}/paths/0`], "a piece without seam allowance has its contour as cut line");
    const empty = clone(included);
    for (const inst of empty.pieceInstances) inst.paths = [];
    assert.equal((await runScene(empty)).length, 2 * empty.pieceInstances.length, "cut and seam line missing per instance");
    // Policy "none": a distorted contour copy on a grainline layer, and a free path there.
    const grainId = PRINT_JOB.scene.layers.find((l) => l.role === "d2p:grainline")?.id ?? "grain";
    const grainScene = clone(PRINT_JOB.scene);
    if (!grainScene.layers.some((l) => l.id === grainId)) grainScene.layers.push({ id: grainId, role: "d2p:grainline", name: "Grainline" });
    const distorted = clone(grainScene);
    distorted.pieceInstances[i].paths.push({ ...mapPath(distorted.pieceInstances[i].paths[0], scale2), id: "copy", layerId: grainId });
    assert.deepEqual(await runScene(distorted), [`D2P-SEM-096@/pieceInstances/${i}/paths/1`]);
    const free = clone(grainScene);
    const { elementId, ...rest } = free.pieceInstances[i].paths[0];
    assert.ok(elementId);
    free.pieceInstances[i].paths.push({ ...rest, id: "free", layerId: grainId });
    assert.deepEqual(await runScene(free), [`D2P-SEM-096@/pieceInstances/${i}/paths/1`]);
    const construction = clone(grainScene);
    construction.layers.push({ id: "construction", role: "d2p:construction", name: "Construction" });
    construction.pieceInstances[i].paths.push({ ...rest, id: "free", layerId: "construction" });
    assert.deepEqual(await runScene(construction), [], "free paths are allowed on construction layers");
  });

  it("checks snapshot completeness and seam arithmetic (D2P-SEM-014, D2P-SEM-024)", async () => {
    const runSnap = (snap) => run("semantic", [doc(snap, "snap.json"), doc(PATTERN, "p.json", "context")]);
    assert.deepEqual(await runSnap(clone(SNAPSHOT)), []);
    const foreign = clone(SNAPSHOT);
    const front = foreign.pieces.find((p) => p.pieceId === "front");
    const back = foreign.pieces.find((p) => p.pieceId === "back");
    front.grainlines.push(clone(back.grainlines[0]));
    assert.deepEqual(await runSnap(foreign), [`D2P-SEM-014@/pieces/${foreign.pieces.indexOf(front)}/grainlines/1/grainlineId`]);
    const swapped = clone(SNAPSHOT);
    const segs = swapped.pieces[0].contours[0].segments;
    [segs[1].edgeId, segs[2].edgeId] = [segs[2].edgeId, segs[1].edgeId];
    assert.deepEqual(await runSnap(swapped), ["D2P-SEM-014@/pieces/0/contours/0/segments"]);
    const noSeam = clone(SNAPSHOT);
    noSeam.seams.pop();
    assert.deepEqual(await runSnap(noSeam), ["D2P-SEM-014@/seams"]);
    const length = clone(SNAPSHOT);
    length.seams[0].lengthAMm += 1;
    length.seams[0].deviationMm += 1;
    assert.deepEqual(await runSnap(length), ["D2P-SEM-024@/seams/0/lengthAMm"]);
    const ease = clone(SNAPSHOT);
    ease.seams[0].declaredEaseMm = 2;
    ease.seams[0].deviationMm -= 2;
    assert.deepEqual(await runSnap(ease), ["D2P-SEM-024@/seams/0/declaredEaseMm"]);
  });

  it("checks validation reports against their profile (D2P-SEM-103) and gate purposes (D2P-SEM-104)", async () => {
    const ctx = [doc(PATTERN, "p.json", "context"), doc(PROFILE, "vp.json", "context"), doc(RULE, "vr.json", "context")];
    assert.deepEqual(await run("semantic", [doc(clone(REPORT), "r.json"), ...ctx]), []);
    const foreignRule = clone(REPORT);
    foreignRule.findings[0].ruleId = "org.example.conformance:other";
    foreignRule.resultDigest = resultDigestOf(foreignRule, ["reportId"]);
    assert.deepEqual(await run("semantic", [doc(foreignRule, "r.json"), ...ctx]), ["D2P-SEM-103@/findings/0/ruleId"]);
    const failed = clone(REPORT);
    failed.status = "failed";
    failed.findings = [];
    failed.result = "pass";
    failed.resultDigest = resultDigestOf(failed, ["reportId"]);
    assert.deepEqual(await run("semantic", [doc(failed, "r.json"), ...ctx]), ["D2P-SEM-103@/result"]);
    const gate = clone(GATE);
    gate.action = "edit-draft";
    gate.resultDigest = resultDigestOf(gate, ["gateEvaluationId"]);
    const out = await run("semantic", [doc(gate, "g.json"), doc(REPORT, "r.json", "context"), doc(WAIVER, "w.json", "context"), ...ctx]);
    assert.ok(out.includes("D2P-SEM-104@/profile") && out.includes("D2P-SEM-104@/reportRefs/0"));
  });

  it("checks the binding page properties of home-print output profiles", async () => {
    const job = clone(PRINT_JOB);
    const run2 = (j) => run("semantic", [doc(j, "job.json"), doc(EVALUATION, "e.json"), doc(EXPORT_SNAPSHOT, "s.json"), doc(PATTERN, "p.json")]);
    assert.deepEqual(await run2(job), []);
    const a3 = clone(job);
    a3.outputProfile.profileId = "d2p:home-print-a3";
    assert.deepEqual(await run2(a3), ["D2P-SEM-095@/pageLayout/media/name"]);
    const noOverlap = clone(job);
    noOverlap.pageLayout.tiling.overlapMm = 0;
    assert.deepEqual(await run2(noOverlap), ["D2P-SEM-095@/pageLayout/tiling/overlapMm"]);
    const unlabelled = clone(job);
    unlabelled.scene.pieceInstances[0].labels = [];
    unlabelled.scene.resultDigest = resultDigestOf(unlabelled.scene, ["sceneId"]);
    unlabelled.provenance.sceneDigest = unlabelled.scene.resultDigest;
    assert.deepEqual(await run2(unlabelled), ["D2P-SEM-095@/scene/pieceInstances/0/labels"]);
    const plotter = clone(job);
    plotter.outputProfile.profileId = "d2p:plotter-1to1";
    plotter.pageLayout.tiling = { mode: "none", registrationMarks: false, sheetLabels: false };
    assert.deepEqual(await run2(plotter), []);
  });

  it("checks waivers against their report and gate", async () => {
    const report = clone(REPORT);
    report.findings[0].severity = "critical";
    report.resultDigest = resultDigestOf(report, ["reportId"]);
    const waiver = clone(WAIVER);
    waiver.findingIds = ["f-1", "f-9"];
    waiver.action = "export-1to1";
    const gate = clone(GATE);
    gate.reportRefs[0].digest = report.resultDigest;
    const out = await run("semantic", [doc(gate, "gate.json"), doc(report, "report.json"), doc(waiver, "waiver.json"), doc(PROFILE, "profile.json"), doc(RULE, "rule.json"), doc(PATTERN, "pattern.json")]);
    assert.ok(out.includes("D2P-SEM-100@/findingIds/0"));
    assert.ok(out.includes("D2P-SEM-101@/findingIds/1"));
    assert.ok(out.includes("D2P-SEM-101@/waiverIds/0"));
    assert.ok(out.includes("D2P-SEM-102@/decision"));
  });

  it("resolves required measurements through the grading rule source", async () => {
    const p = clone(PATTERN);
    p.definitionRegistries = [{ id: "d2p:measurement-definitions", version: "1.0.0" }];
    p.measurementInputs = [{ key: "chest-girth", definitionId: "d2p:body.chest-girth", required: true }];
    const sizes = await load("conformance/referential/resolving-bundle/size-system.json");
    const grading = {
      documentType: "d2p:grading-rule-set",
      schemaVersion: "1.0.0",
      artifactId: "art_test-grading",
      revisionId: "rev_test-grading-r1",
      patternRef: refOf(p),
      mode: "measurement-driven",
      rules: [{ id: "grade-chest", kind: "measurement-source", measurementKey: "chest-girth", source: "body-profile" }],
    };
    const request = {
      documentType: "d2p:evaluation-request",
      schemaVersion: "1.0.0",
      requestId: "erq_test",
      patternRef: refOf(p),
      evaluatorProfile: { id: "org.example.test:evaluator", version: "1.0.0" },
      gradingRuleSetRef: refOf(grading),
      sizeSystemRef: refOf(sizes),
      sizeKey: "size-a",
      requestedOutputs: ["geometry-snapshot"],
    };
    const bundle = (g) => [doc(request, "r.json"), doc(p, "p.json"), doc(g, "g.json"), doc(sizes, "s.json"), doc(REGISTRY_DOC, REGISTRY)];
    assert.deepEqual(await run("semantic", bundle(grading)), ["D2P-SEM-072@/patternRef"]);
    const fromSize = clone(grading);
    fromSize.rules[0].source = "size-entry";
    assert.deepEqual(await run("semantic", bundle(fromSize)), []);
  });
});

describe("gate decision procedure", () => {
  const finding = (severity, id = "f-1") => ({ ...clone(REPORT.findings[0]), findingId: id, severity });
  const reportWith = (findings, extra = {}) => ({ ...clone(REPORT), findings, ...extra });
  const g = { ...clone(GATE), waiverIds: [] };

  it("follows the steps in order", () => {
    assert.deepEqual(gateDecision(g, PROFILE, [], []), { decision: "deny", reasonCodes: ["d2p:report-missing"], addressedFindings: [] });
    assert.equal(gateDecision(g, PROFILE, [reportWith([], { profile: { id: "org.example.other:p", version: "1.0.0" } })], []).reasonCodes[0], "d2p:report-stale");
    assert.equal(gateDecision(g, PROFILE, [reportWith([{ ...finding("error"), ruleVersion: "2.0.0" }])], []).reasonCodes[0], "d2p:report-stale");
    assert.equal(gateDecision(g, PROFILE, [reportWith([], { status: "failed" })], []).reasonCodes[0], "d2p:report-failed");
    assert.equal(gateDecision(g, PROFILE, [reportWith([finding("error")])], []).reasonCodes[0], "d2p:blocking-findings");
    assert.deepEqual(gateDecision(g, PROFILE, [reportWith([finding("warning")])], []), { decision: "allow-with-warning", reasonCodes: ["d2p:warnings-present"], addressedFindings: [] });
    assert.deepEqual(gateDecision(g, PROFILE, [reportWith([finding("info")])], []), { decision: "allow", reasonCodes: [], addressedFindings: [] });
  });

  it("applies only valid waivers", () => {
    const gate = { ...clone(GATE) };
    const report = reportWith([finding("error")]);
    assert.deepEqual(gateDecision(gate, PROFILE, [report], [WAIVER]), {
      decision: "allow",
      reasonCodes: ["d2p:waived"],
      addressedFindings: [{ reportId: REPORT.reportId, findingId: "f-1" }],
    });
    const expired = { ...clone(WAIVER), expiresAt: GATE.evaluatedAt };
    assert.equal(gateDecision(gate, PROFILE, [report], [expired]).decision, "deny");
    const strict = { ...clone(PROFILE), waiverPolicy: { allowed: true, maxSeverity: "warning" } };
    assert.equal(gateDecision(gate, strict, [report], [WAIVER]).decision, "deny");
    assert.equal(gateDecision(gate, PROFILE, [reportWith([finding("critical")])], [WAIVER]).decision, "deny");
    const twoFindings = reportWith([finding("error"), finding("warning", "f-2")]);
    assert.deepEqual(gateDecision(gate, PROFILE, [twoFindings], [WAIVER]).reasonCodes, ["d2p:waived", "d2p:warnings-present"]);
  });
});

describe("gate decision with test evidence (QEV-012)", () => {
  const g = { ...clone(GATE), waiverIds: [] };
  const clean = { ...clone(REPORT), findings: [] };
  const evidence = (reports, overallState) => ({ requiredSuites: [{ suiteId: "s:a", suiteVersion: "1.0.0" }], reports, overallState });
  const entry = (resultState) => ({ reportId: "trr_x", documentType: "d2p:test-run-report", suiteId: "s:a", suiteVersion: "1.0.0", resultState, contentDigest: digestOf({}) });
  it("denies a gate whose evidence lacks a required suite or has not passed", () => {
    assert.deepEqual(gateDecision(g, PROFILE, [clean], [], [evidence([], "failed")]), { decision: "deny", reasonCodes: ["d2p:evidence-missing"], addressedFindings: [] });
    assert.equal(gateDecision(g, PROFILE, [clean], [], [evidence([entry("skipped")], "inconclusive")]).reasonCodes[0], "d2p:evidence-not-passed");
    assert.equal(gateDecision(g, PROFILE, [clean], [], [evidence([entry("failed")], "failed")]).reasonCodes[0], "d2p:evidence-not-passed");
    assert.deepEqual(gateDecision(g, PROFILE, [clean], [], [evidence([entry("passed")], "passed")]), { decision: "allow", reasonCodes: [], addressedFindings: [] });
  });
  it("checks reports before evidence", () => {
    assert.equal(gateDecision(g, PROFILE, [], [], [evidence([], "failed")]).reasonCodes[0], "d2p:report-missing");
  });
});

describe("ease rule material applicability", () => {
  const cond = { materialClasses: ["knit"], minStretchRatio: 0.2 };
  it("requires the material class and the stretch in both directions", () => {
    assert.equal(materialConditionMet(undefined, undefined), true);
    assert.equal(materialConditionMet(cond, undefined), false);
    assert.equal(materialConditionMet(cond, { materialClass: "woven" }), false);
    assert.equal(materialConditionMet(cond, { materialClass: "knit" }), false);
    assert.equal(materialConditionMet(cond, { materialClass: "knit", stretch: { lengthwise: 0.1, crosswise: 0.3 } }), false);
    assert.equal(materialConditionMet(cond, { materialClass: "knit", stretch: { lengthwise: 0.2, crosswise: 0.3 } }), true);
    assert.equal(materialConditionMet({ materialClasses: ["knit", "woven"] }, { materialClass: "woven" }), true);
  });
});

describe("evidence state", () => {
  const entry = (suiteId, resultState) => ({ reportId: "trr_x", documentType: "d2p:test-run-report", suiteId, suiteVersion: "1.0.0", resultState, contentDigest: digestOf({}) });
  const bundle = (reports) => ({ requiredSuites: [{ suiteId: "s:a", suiteVersion: "1.0.0" }], reports });
  it("is never passed when evidence is incomplete", () => {
    assert.equal(evidenceState(bundle([])), "failed");
    assert.equal(evidenceState(bundle([entry("s:a", "failed")])), "failed");
    assert.equal(evidenceState(bundle([entry("s:a", "skipped")])), "inconclusive");
    assert.equal(evidenceState(bundle([entry("s:a", "passed")])), "passed");
  });
});

describe("line-only geometry", () => {
  const P = (x, y) => [BigInt(x), BigInt(y)];
  it("accepts a simple polygon and finds crossings and overlaps", () => {
    assert.equal(polylineSelfIntersection([P(0, 0), P(2, 0), P(2, 2), P(0, 2), P(0, 0)], true), null);
    assert.match(polylineSelfIntersection([P(0, 0), P(2, 0), P(0, 2), P(2, 2), P(0, 0)], true), /segments 1 and 3 intersect/);
    assert.match(polylineSelfIntersection([P(0, 0), P(4, 0), P(2, 0), P(2, 2), P(0, 0)], true), /overlap/);
    // A vertex touching a non-adjacent segment.
    assert.match(polylineSelfIntersection([P(0, 0), P(4, 0), P(4, 4), P(2, 0), P(0, 4), P(0, 0)], true), /intersect/);
    assert.match(polylineSelfIntersection([P(0, 0), P(2, 0), P(0, 0)], true), /overlap/);
  });
});
