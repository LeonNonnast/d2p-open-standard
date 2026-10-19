// Builds every document of fixtures/golden-tshirt/v1 (inputs, expected
// results, negative fixtures, manifest) as plain objects keyed by their path
// relative to the fixture directory. See catalog section 4 for the layout.
import { readFileSync } from "node:fs";
import path from "node:path";
import { digests, quantizeDeep } from "./c14n.mjs";
import { applyParameterUpdates, buildPattern, C, CHANGE, directConstruction } from "./construction.mjs";
import { evaluatePattern } from "./evaluator.mjs";
import * as g from "./geometry.mjs";
import {
  ACTOR,
  ARTIFACT_SLUGS,
  CONFIGURATIONS,
  EVALUATOR,
  EVALUATOR_PROFILE,
  EXTERNAL,
  ids,
  PROFILE_PRINT,
  PROFILE_SAMPLE_CUT,
  REGISTRY,
  SIZES,
  TIMESTAMPS,
  TOLERANCE_PROFILE,
} from "./ids.mjs";
import { buildNegatives } from "./negative.mjs";
import { garmentMeasurements, notchGeometry, snapshotGeometry } from "./snapshot.mjs";

export const FIXTURE_DIR = "fixtures/golden-tshirt/v1";
const SCHEMA_VERSION = "1.0.0";

/**
 * Synthetic, NON-NORMATIVE body measurements of the two fixture sizes (mm).
 * They are invented test data: not taken from a size table, a norm or a person.
 */
export const SIZE_MEASUREMENTS = {
  "size-a": {
    "d2p:body.arm-length": 600,
    "d2p:body.back-length": 420,
    "d2p:body.chest-girth": 920,
    "d2p:body.neck-girth": 370,
    "d2p:body.shoulder-width": 420,
    "d2p:body.waist-girth": 800,
  },
  "size-b": {
    "d2p:body.arm-length": 630,
    "d2p:body.back-length": 440,
    "d2p:body.chest-girth": 1040,
    "d2p:body.neck-girth": 400,
    "d2p:body.shoulder-width": 460,
    "d2p:body.waist-girth": 940,
  },
};
/** Synthetic uncertainty (plus/minus, mm) by definition path type. */
const UNCERTAINTY_MM = { girth: 5, length: 3, arc: 5 };

/** Synthetic chest ease per fit profile (wearing ease, mm) and target tolerances. */
export const FIT = {
  "fit-profile-regular": { name: "Regular fit (synthetic)", intent: "d2p:regular", chestEase: 100 },
  "fit-profile-relaxed": { name: "Relaxed fit (synthetic)", intent: "d2p:relaxed", chestEase: 160 },
};
const TARGET_TOLERANCE = { chest: { minus: 10, plus: 10 }, sleeve: { minus: 5, plus: 5 } };

const SYNTHETIC_NOTE = "Synthetic, non-normative test value of the Golden T-Shirt fixture; not taken from a size table, a norm or a measured person.";

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortBy = (arr, ...keys) =>
  [...arr].sort((a, b) => {
    for (const k of keys) {
      const va = typeof k === "function" ? k(a) : a[k];
      const vb = typeof k === "function" ? k(b) : b[k];
      // Absent keys sort before present values.
      if (va === undefined && vb !== undefined) return -1;
      if (va !== undefined && vb === undefined) return 1;
      const c = cmp(va, vb);
      if (c !== 0) return c;
    }
    return 0;
  });
const sortRefs = (refs) => sortBy(refs, "artifactId", "revisionId");
const sortInputDigests = (list) =>
  sortBy(list, "role", (d) => d.artifactRef?.artifactId, (d) => d.artifactRef?.revisionId, (d) => d.id?.id, (d) => d.id?.version, "digest");

function readJson(root, rel) {
  return JSON.parse(readFileSync(path.join(root, rel), "utf8"));
}

/** Builds the full fixture. Returns {files: Map<relPath, {doc, role}>, report} */
export function buildFixture(root) {
  // ---- external files -----------------------------------------------------
  const external = {
    registry: readJson(root, EXTERNAL.registry),
    tolerance: readJson(root, EXTERNAL.tolerance),
    profileSampleCut: readJson(root, EXTERNAL.profileSampleCut),
    profilePrint: readJson(root, EXTERNAL.profilePrint),
  };
  const externalFiles = new Map([
    [EXTERNAL.registry, external.registry],
    [EXTERNAL.tolerance, external.tolerance],
    [EXTERNAL.profileSampleCut, external.profileSampleCut],
    [EXTERNAL.profilePrint, external.profilePrint],
  ]);
  for (const profile of [external.profileSampleCut, external.profilePrint]) {
    for (const r of profile.rules) {
      const rel = `vocabularies/validation/rules/${r.ruleId.replace(/^d2p:/, "")}-${r.ruleVersion}.json`;
      if (!externalFiles.has(rel)) externalFiles.set(rel, readJson(root, rel));
    }
  }
  const definitions = new Map(external.registry.definitions.map((d) => [d.definitionId, d]));
  const definitionDimensions = Object.fromEntries([...definitions].map(([k, d]) => [k, d.dimension]));
  const toleranceLimit = (metric) => {
    const t = external.tolerance.tolerances.find((x) => x.metric === metric);
    if (!t) throw new Error(`tolerance profile has no ${metric}`);
    return t.limit;
  };

  const files = new Map(); // relPath -> { doc, role }
  const put = (rel, doc, role) => {
    if (files.has(rel)) throw new Error(`duplicate fixture file ${rel}`);
    files.set(rel, { doc: quantizeDeep(doc), role });
    return files.get(rel).doc;
  };

  // ---- inputs: artifact content documents ---------------------------------
  const pattern = buildPattern();
  const sizeSystem = {
    documentType: "d2p:size-system",
    schemaVersion: SCHEMA_VERSION,
    artifactId: ids.art("size-system"),
    revisionId: ids.rev("size-system", 1),
    name: "Golden T-Shirt synthetic sizes A and B",
    issuer: { kind: "synthetic", name: "D2P Golden T-Shirt fixture (synthetic test data)" },
    definitionRegistries: [REGISTRY],
    sizes: SIZES.map((s) => ({
      sizeKey: s.sizeKey,
      label: s.label,
      ordinal: s.ordinal,
      measurements: Object.entries(SIZE_MEASUREMENTS[s.sizeKey])
        .sort(([a], [b]) => cmp(a, b))
        .map(([definitionId, value]) => {
          const def = definitions.get(definitionId);
          if (!def) throw new Error(`registry lacks ${definitionId}`);
          return {
            definitionId,
            value,
            unit: def.unit,
            method: "size-table",
            source: { kind: "synthetic", description: SYNTHETIC_NOTE },
            uncertainty: { type: "symmetric", plusMinus: UNCERTAINTY_MM[def.path.type] },
          };
        }),
    })),
  };
  const gradingRuleSet = {
    documentType: "d2p:grading-rule-set",
    schemaVersion: SCHEMA_VERSION,
    artifactId: ids.art("grading-rule-set"),
    revisionId: ids.rev("grading-rule-set", 1),
    patternRef: ids.ref("pattern"),
    mode: "measurement-driven",
    sizeSystemRef: ids.ref("size-system"),
    rules: pattern.measurementInputs.map((mi) => ({ id: `grade-${mi.key}`, kind: "measurement-source", measurementKey: mi.key, source: "size-entry" })),
  };
  const fitProfiles = Object.fromEntries(
    CONFIGURATIONS.map((cfg) => [
      cfg.fitSlug,
      {
        documentType: "d2p:fit-profile",
        schemaVersion: SCHEMA_VERSION,
        artifactId: ids.art(cfg.fitSlug),
        revisionId: ids.rev(cfg.fitSlug, 1),
        name: FIT[cfg.fitSlug].name,
        intent: FIT[cfg.fitSlug].intent,
        definitionRegistries: [REGISTRY],
        easeRules: [
          {
            id: "ease-chest",
            bodyDefinitionId: "d2p:body.chest-girth",
            garmentDefinitionId: "d2p:garment.chest-girth",
            easeType: "wearing",
            amount: { value: FIT[cfg.fitSlug].chestEase, unit: "mm" },
            priority: 0,
            scope: { zones: ["d2p:chest"] },
          },
        ],
        materialAssumptions: cfg.materialAssumptions,
      },
    ]),
  );
  const sleeveTarget = (sizeKey) => Math.round(SIZE_MEASUREMENTS[sizeKey]["d2p:body.arm-length"] * C.sleeveLengthRatio);
  const garmentSpec = {
    documentType: "d2p:garment-measurement-spec",
    schemaVersion: SCHEMA_VERSION,
    artifactId: ids.art("garment-measurement-spec"),
    revisionId: ids.rev("garment-measurement-spec", 1),
    name: "Golden T-Shirt garment targets (synthetic)",
    definitionRegistries: [REGISTRY],
    targets: SIZES.flatMap((s) =>
      CONFIGURATIONS.flatMap((cfg) => [
        {
          id: `target-chest-girth-${s.sizeKey}-${cfg.configurationKey}`,
          definitionId: "d2p:garment.chest-girth",
          value: SIZE_MEASUREMENTS[s.sizeKey]["d2p:body.chest-girth"] + FIT[cfg.fitSlug].chestEase,
          unit: "mm",
          tolerance: TARGET_TOLERANCE.chest,
          sizeKey: s.sizeKey,
          configurationKey: cfg.configurationKey,
        },
        {
          id: `target-sleeve-length-${s.sizeKey}-${cfg.configurationKey}`,
          definitionId: "d2p:garment.sleeve-length",
          value: sleeveTarget(s.sizeKey),
          unit: "mm",
          tolerance: TARGET_TOLERANCE.sleeve,
          sizeKey: s.sizeKey,
          configurationKey: cfg.configurationKey,
        },
      ]),
    ),
    patternRef: ids.ref("pattern"),
    sizeSystemRef: ids.ref("size-system"),
  };
  const contents = {
    pattern,
    "grading-rule-set": gradingRuleSet,
    "size-system": sizeSystem,
    "fit-profile-regular": fitProfiles["fit-profile-regular"],
    "fit-profile-relaxed": fitProfiles["fit-profile-relaxed"],
    "garment-measurement-spec": garmentSpec,
  };
  const artifactTypes = {
    pattern: "d2p:pattern",
    "grading-rule-set": "d2p:grading-rule-set",
    "size-system": "d2p:size-system",
    "fit-profile-regular": "d2p:fit-profile",
    "fit-profile-relaxed": "d2p:fit-profile",
    "garment-measurement-spec": "d2p:garment-measurement-spec",
  };
  const artifactNames = {
    pattern: "Golden T-Shirt pattern",
    "grading-rule-set": "Golden T-Shirt grading rules",
    "size-system": "Golden T-Shirt size system",
    "fit-profile-regular": "Golden T-Shirt regular fit profile",
    "fit-profile-relaxed": "Golden T-Shirt relaxed fit profile",
    "garment-measurement-spec": "Golden T-Shirt garment measurement spec",
  };

  put("inputs/project.json", {
    documentType: "d2p:project",
    schemaVersion: SCHEMA_VERSION,
    projectId: ids.project,
    name: "Golden T-Shirt",
    description: "Synthetic reference project of the D2P Golden T-Shirt v1 fixture.",
    createdAt: TIMESTAMPS.r1Records,
  }, "input");

  const contentDigest = {};
  for (const slug of ARTIFACT_SLUGS) {
    const content = put(`inputs/${slug}-r1.json`, contents[slug], "input");
    contentDigest[`${slug}-r1`] = digests.content(content);
    put(`inputs/artifacts/${slug}.json`, {
      documentType: "d2p:artifact",
      schemaVersion: SCHEMA_VERSION,
      artifactId: ids.art(slug),
      artifactType: artifactTypes[slug],
      name: artifactNames[slug],
      dataClassification: "public",
      createdAt: TIMESTAMPS.r1Records,
      createdBy: ACTOR,
    }, "input");
    put(`inputs/revisions/${slug}-r1.json`, {
      documentType: "d2p:revision",
      schemaVersion: SCHEMA_VERSION,
      revisionId: ids.rev(slug, 1),
      artifactId: ids.art(slug),
      sequence: 1,
      parentRevisionIds: [],
      contentDigest: contentDigest[`${slug}-r1`],
      createdAt: TIMESTAMPS.r1Records,
      author: ACTOR,
      message: "Initial revision of the synthetic Golden T-Shirt fixture.",
    }, "input");
    put(`inputs/relationships/project-contains-${slug}.json`, {
      documentType: "d2p:relationship",
      schemaVersion: SCHEMA_VERSION,
      relationshipId: ids.rel(slug),
      relationshipType: "d2p:contains",
      source: { kind: "project", id: ids.project },
      targetRef: ids.ref(slug),
      createdAt: TIMESTAMPS.r1Records,
    }, "input");
  }

  // ---- inputs: evaluation requests and the change command -----------------
  const requests = new Map(); // caseKey -> request doc
  for (const s of SIZES) {
    for (const cfg of CONFIGURATIONS) {
      const c = ids.caseKey(1, s.sizeKey, cfg.configurationKey);
      requests.set(c, put(`inputs/evaluation-requests/${c}.json`, {
        documentType: "d2p:evaluation-request",
        schemaVersion: SCHEMA_VERSION,
        requestId: ids.erq(c),
        patternRef: ids.ref("pattern"),
        evaluatorProfile: EVALUATOR_PROFILE,
        gradingRuleSetRef: ids.ref("grading-rule-set"),
        sizeSystemRef: ids.ref("size-system"),
        fitProfileRef: ids.ref(cfg.fitSlug),
        garmentMeasurementSpecRef: ids.ref("garment-measurement-spec"),
        sizeKey: s.sizeKey,
        configurationKey: cfg.configurationKey,
        materialAssumptions: cfg.materialAssumptions,
        toleranceProfile: TOLERANCE_PROFILE,
        validationProfile: PROFILE_SAMPLE_CUT,
        requestedOutputs: ["fit-evaluation-report", "geometry-snapshot", "measurement-report", "validation-report"],
      }, "input"));
    }
  }
  const command = put("inputs/change/command.json", {
    documentType: "d2p:command",
    schemaVersion: SCHEMA_VERSION,
    commandId: ids.command,
    idempotencyKey: "golden-tshirt-change-1",
    type: "d2p:pattern.parameters.update",
    target: { artifactId: ids.art("pattern"), branch: "main" },
    expectedRevisionId: ids.rev("pattern", 1),
    payload: { updates: CHANGE.updates() },
    actorContext: { actorPrincipalId: ACTOR.principalId },
    issuedAt: TIMESTAMPS.change,
  }, "input");
  const regular = CONFIGURATIONS.find((c) => c.configurationKey === "regular-woven");
  for (const s of SIZES) {
    const c = ids.caseKey(2, s.sizeKey, regular.configurationKey);
    requests.set(c, put(`inputs/change/evaluation-requests/${c}.json`, {
      documentType: "d2p:evaluation-request",
      schemaVersion: SCHEMA_VERSION,
      requestId: ids.erq(c),
      patternRef: ids.ref("pattern", 2),
      evaluatorProfile: EVALUATOR_PROFILE,
      sizeSystemRef: ids.ref("size-system"),
      fitProfileRef: ids.ref(regular.fitSlug),
      sizeKey: s.sizeKey,
      configurationKey: regular.configurationKey,
      materialAssumptions: regular.materialAssumptions,
      toleranceProfile: TOLERANCE_PROFILE,
      requestedOutputs: ["geometry-snapshot", "measurement-report"],
    }, "input"));
  }

  // ---- change case: pattern r2, revision record, receipt -------------------
  const patternR2 = put("expected/change/pattern-r2.json", applyParameterUpdates(files.get("inputs/pattern-r1.json").doc, command.payload.updates, ids.rev("pattern", 2)), "expected");
  contentDigest["pattern-r2"] = digests.content(patternR2);
  put("expected/change/revision-pattern-r2.json", {
    documentType: "d2p:revision",
    schemaVersion: SCHEMA_VERSION,
    revisionId: ids.rev("pattern", 2),
    artifactId: ids.art("pattern"),
    sequence: 2,
    parentRevisionIds: [ids.rev("pattern", 1)],
    contentDigest: contentDigest["pattern-r2"],
    createdAt: TIMESTAMPS.change,
    author: ACTOR,
    commandId: ids.command,
    message: "Change case: bust-ease +20 mm, sleeve-length +30 mm (synthetic).",
  }, "expected");
  put("expected/change/command-receipt.json", {
    documentType: "d2p:command-receipt",
    schemaVersion: SCHEMA_VERSION,
    commandId: ids.command,
    status: "committed",
    revisionRefs: [ids.ref("pattern", 2)],
    eventCursor: "golden-tshirt-1",
  }, "expected");

  // ---- evaluation ----------------------------------------------------------
  const patternDocs = { 1: files.get("inputs/pattern-r1.json").doc, 2: patternR2 };
  const fileDigest = (doc) => digests.file(doc);
  const idDigest = { registry: fileDigest(external.registry), tolerance: fileDigest(external.tolerance), sampleCut: fileDigest(external.profileSampleCut), print: fileDigest(external.profilePrint) };

  function inputDigestsFor(request, validationProfileOverride) {
    const list = [];
    const artifactRole = [
      ["patternRef", "pattern"],
      ["gradingRuleSetRef", "grading-rule-set"],
      ["sizeSystemRef", "size-system"],
      ["fitProfileRef", "fit-profile"],
      ["garmentMeasurementSpecRef", "garment-measurement-spec"],
    ];
    for (const [member, role] of artifactRole) {
      const ref = request[member];
      if (!ref) continue;
      const slug = ref.artifactId.replace(/^art_golden-tshirt-/, "");
      const rev = ref.revisionId.endsWith("-r2") ? 2 : 1;
      const d = contentDigest[`${slug}-r${rev}`];
      if (!d) throw new Error(`no content digest for ${ref.artifactId}@${ref.revisionId}`);
      list.push({ role, artifactRef: ref, digest: d });
    }
    if (request.materialAssumptions) list.push({ role: "material-assumptions", digest: digests.file(request.materialAssumptions) });
    list.push({ role: "measurement-definition-registry", id: REGISTRY, digest: idDigest.registry });
    if (request.toleranceProfile) list.push({ role: "tolerance-profile", id: TOLERANCE_PROFILE, digest: idDigest.tolerance });
    const vp = validationProfileOverride ?? request.validationProfile;
    if (vp) list.push({ role: "validation-profile", id: vp, digest: vp.id === PROFILE_PRINT.id ? idDigest.print : idDigest.sampleCut });
    return sortInputDigests(list);
  }

  /** Measurement input values per §3.4 (grading rule set if given, else the size entry). */
  function resolveMeasurements(pat, request) {
    const sizeEntry = sizeSystem.sizes.find((s) => s.sizeKey === request.sizeKey);
    const values = {};
    for (const mi of pat.measurementInputs) {
      if (request.gradingRuleSetRef) {
        const rule = gradingRuleSet.rules.find((r) => r.kind === "measurement-source" && r.measurementKey === mi.key);
        if (!rule || rule.source !== "size-entry") throw new Error(`no size-entry grading rule for ${mi.key}`);
      }
      const v = sizeEntry.measurements.find((x) => x.definitionId === mi.definitionId);
      if (!v) throw new Error(`size ${request.sizeKey} has no value for ${mi.definitionId}`);
      values[mi.key] = v.value;
    }
    return values;
  }

  const evaluations = new Map(); // caseKey -> { evaluation, snapshot, measurements, geometry }
  const report = { cases: [], checks: [] };
  for (const [c, request] of requests) {
    const rev = request.patternRef.revisionId.endsWith("-r2") ? 2 : 1;
    const pat = patternDocs[rev];
    const mv = resolveMeasurements(pat, request);
    const ev = evaluatePattern(pat, mv, definitionDimensions);
    // Independent cross-check of every point feature.
    const direct = directConstruction(mv, {
      bustEase: C.bustEase + (rev === 2 ? CHANGE.bustEaseDeltaMm : 0),
      sleeveLength: (x) => x["arm-length"] * C.sleeveLengthRatio + (rev === 2 ? CHANGE.sleeveLengthDeltaMm : 0),
    });
    const pointFeatures = pat.features.filter((f) => f.type.startsWith("d2p:point."));
    if (pointFeatures.length !== Object.keys(direct).length) throw new Error("direct construction does not cover every point feature");
    for (const f of pointFeatures) {
      const a = ev.point(f.id);
      const b = direct[f.id];
      if (!b || Math.abs(a[0] - b[0]) > 1e-9 || Math.abs(a[1] - b[1]) > 1e-9) {
        throw new Error(`cross-check failed for ${f.id} in ${c}: interpreter ${a} vs direct ${b}`);
      }
    }
    const geom = snapshotGeometry(pat, ev);
    const signedAreas = geom.pieces.map((pc) => [pc.pieceId, pc._signedOuterArea]);
    for (const pc of geom.pieces) delete pc._signedOuterArea;
    const createdAt = rev === 2 ? TIMESTAMPS.r2Derived : TIMESTAMPS.r1Derived;
    const inputDigests = inputDigestsFor(request);
    const snapshot = {
      documentType: "d2p:geometry-snapshot",
      schemaVersion: SCHEMA_VERSION,
      snapshotId: ids.snp(c),
      createdAt,
      patternRef: request.patternRef,
      evaluationId: ids.pev(c),
      sizeKey: request.sizeKey,
      configurationKey: request.configurationKey,
      evaluator: EVALUATOR,
      featureSetVersion: "1.0.0",
      inputDigests,
      units: { length: "mm", angle: "rad" },
      pieces: geom.pieces,
      interfaces: geom.interfaces,
      seams: geom.seams,
      diagnostics: [],
    };
    const qSnapshot = quantizeDeep(snapshot);
    qSnapshot.geometryDigest = digests.geometry(qSnapshot);
    const snap = put(`expected/snapshots/${c}.json`, qSnapshot, "expected");

    // measurement-report: one entry per applicable garment target (r1 only; r2 requests pin no spec).
    const predicted = garmentMeasurements(ev);
    const applicable = request.garmentMeasurementSpecRef
      ? garmentSpec.targets.filter((t) => (!t.sizeKey || t.sizeKey === request.sizeKey) && (!t.configurationKey || t.configurationKey === request.configurationKey))
      : [];
    const measurements = sortBy(
      applicable.map((t) => ({ key: t.id, definitionId: t.definitionId, value: predicted[t.definitionId], unit: "mm" })),
      "key",
    );
    const evaluation = {
      documentType: "d2p:pattern-evaluation",
      schemaVersion: SCHEMA_VERSION,
      evaluationId: ids.pev(c),
      createdAt,
      request,
      evaluator: EVALUATOR,
      featureSetVersion: "1.0.0",
      inputDigests,
      status: "succeeded",
      constraintStatus: "solved",
      snapshotRef: { id: snap.snapshotId, digest: snap.geometryDigest },
      measurements,
      diagnostics: [],
    };
    const qEval = quantizeDeep(evaluation);
    qEval.resultDigest = digests.result(qEval, "evaluationId");
    const evalDoc = put(`expected/evaluations/${c}.json`, qEval, "expected");
    evaluations.set(c, { request, evaluation: evalDoc, snapshot: snap, ev, predicted, applicable, inputDigests, signedAreas });
    report.cases.push({ caseKey: c, seams: snap.seams, predicted });
  }

  // ---- fit evaluation reports and sample-cut validation reports (r1) --------
  for (const [c, x] of evaluations) {
    if (!c.startsWith("r1-")) continue;
    const results = sortBy(
      x.applicable.map((t) => {
        const predicted = x.predicted[t.definitionId];
        const deviation = predicted - t.value;
        const within = deviation >= -t.tolerance.minus - 1e-9 && deviation <= t.tolerance.plus + 1e-9;
        return {
          id: t.id,
          garmentDefinitionId: t.definitionId,
          predicted: { value: predicted, unit: "mm" },
          target: { value: t.value, unit: "mm" },
          deviation: { value: deviation, unit: "mm" },
          status: within ? "within-tolerance" : "outside-tolerance",
        };
      }),
      "id",
    );
    const fit = quantizeDeep({
      documentType: "d2p:fit-evaluation-report",
      schemaVersion: SCHEMA_VERSION,
      reportId: ids.fer(c),
      createdAt: TIMESTAMPS.r1Derived,
      evaluationRef: { id: x.evaluation.evaluationId, digest: x.evaluation.resultDigest },
      evaluator: EVALUATOR,
      inputDigests: x.inputDigests,
      evidenceKind: "analytical",
      results,
      containsPersonalData: false,
      diagnostics: [],
    });
    fit.resultDigest = digests.result(fit, "reportId");
    put(`expected/fit/${c}.json`, fit, "expected");

    const vr = {
      documentType: "d2p:validation-report",
      schemaVersion: SCHEMA_VERSION,
      reportId: ids.vrpSample(c),
      createdAt: TIMESTAMPS.r1Derived,
      targetRefs: targetRefsOf(x.request),
      derivedSubjectRefs: sortBy(
        [
          { id: x.evaluation.evaluationId, digest: x.evaluation.resultDigest },
          { id: x.snapshot.snapshotId, digest: x.snapshot.geometryDigest },
        ],
        "id",
      ),
      purpose: "sample-cut",
      profile: PROFILE_SAMPLE_CUT,
      inputDigests: inputDigestsFor(x.request, PROFILE_SAMPLE_CUT),
      status: "completed",
      result: "pass",
      findings: [],
      evaluator: EVALUATOR,
    };
    vr.resultDigest = digests.result(vr, "reportId");
    put(`expected/validation/${c}.sample-cut.json`, vr, "expected");
  }

  // ---- export scenes, print jobs, 1to1-print reports and gates -------------
  for (const s of SIZES) {
    const c = ids.caseKey(1, s.sizeKey, "regular-woven");
    const x = evaluations.get(c);
    const scene = buildScene(c, x, patternDocs[1], s);
    scene.resultDigest = digests.result(scene, "sceneId");
    const sceneDoc = put(`expected/export/scene-${c}.json`, scene, "expected");
    const print = quantizeDeep({
      documentType: "d2p:print-job-spec",
      schemaVersion: SCHEMA_VERSION,
      printJobId: ids.print(c),
      scene: sceneDoc,
      outputProfile: { profileId: "d2p:home-print-a4", version: "1.0.0" },
      pageLayout: {
        media: { name: "iso-a4", widthMm: 210, heightMm: 297 },
        orientation: "portrait",
        marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
        tiling: { mode: "tiled", overlapMm: 10, registrationMarks: true, sheetLabels: true },
      },
      scale: 1,
      calibration: { controlSquareMm: 100, placement: "every-sheet" },
      printNotice: {
        text: "Print at 100 % (actual size). Do not scale or fit to page. Measure the 100 mm control square on every sheet before cutting.",
        locale: "en",
      },
      conformance: { profileId: "d2p:print-v1", level: "geometry" },
      provenance: { generator: { name: "d2p-golden-tshirt-oracle", version: "1.0.0" }, sceneDigest: sceneDoc.resultDigest },
    });
    print.resultDigest = digests.result(print, "printJobId");
    const printDoc = put(`expected/export/print-${c}-a4.json`, print, "expected");

    const vr = {
      documentType: "d2p:validation-report",
      schemaVersion: SCHEMA_VERSION,
      reportId: ids.vrpPrint(c),
      createdAt: TIMESTAMPS.r1Derived,
      targetRefs: targetRefsOf(x.request),
      derivedSubjectRefs: sortBy(
        [
          { id: x.evaluation.evaluationId, digest: x.evaluation.resultDigest },
          { id: x.snapshot.snapshotId, digest: x.snapshot.geometryDigest },
          { id: sceneDoc.sceneId, digest: sceneDoc.resultDigest },
          { id: printDoc.printJobId, digest: printDoc.resultDigest },
        ],
        "id",
      ),
      purpose: "1to1-print",
      profile: PROFILE_PRINT,
      inputDigests: inputDigestsFor(x.request, PROFILE_PRINT),
      status: "completed",
      result: "pass",
      findings: [],
      evaluator: EVALUATOR,
    };
    vr.resultDigest = digests.result(vr, "reportId");
    const vrDoc = put(`expected/validation/${c}.1to1-print.json`, vr, "expected");

    const gate = {
      documentType: "d2p:gate-evaluation",
      schemaVersion: SCHEMA_VERSION,
      gateEvaluationId: ids.gate(c),
      evaluatedAt: TIMESTAMPS.r1Derived,
      action: "export-1to1",
      targetRefs: targetRefsOf(x.request),
      profile: PROFILE_PRINT,
      reportRefs: [{ id: vrDoc.reportId, digest: vrDoc.resultDigest }],
      waiverIds: [],
      decision: "allow",
      reasonCodes: [],
      addressedFindings: [],
    };
    gate.resultDigest = digests.result(gate, "gateEvaluationId");
    put(`expected/validation/gate-${c}.export-1to1.json`, gate, "expected");
    report.prints = report.prints ?? [];
    report.prints.push({ caseKey: c, tiles: tileGrid(sceneDoc, printDoc) });
  }

  // ---- oracle assertions ---------------------------------------------------
  runAssertions({ evaluations, patternDocs, contentDigest, toleranceLimit, report, files });

  // ---- negative fixtures ---------------------------------------------------
  const ctx = { files, evaluations, contentDigest, external, put, inputDigestsFor, FIXTURE_DIR, externalPaths: [...externalFiles.keys()].sort() };
  buildNegatives(ctx);

  // ---- manifest -------------------------------------------------------------
  const manifest = {
    documentType: "d2p:fixture-manifest",
    schemaVersion: SCHEMA_VERSION,
    fixtureId: "golden-tshirt",
    fixtureVersion: "1.0.0",
    title: "Golden T-Shirt v1",
    description:
      "Synthetic end-to-end reference fixture: a simple T-shirt (front, back, one sleeve cut twice) in two sizes (size-a, size-b) and two material/fit configurations (regular-woven, relaxed-knit), with a change case (bust-ease +20 mm, sleeve-length +30 mm). All measurements and design values are synthetic, non-normative test data. Expected results are generated by tools/oracle/golden-tshirt.mjs.",
    synthetic: true,
    standardVersion: SCHEMA_VERSION,
    digestProfile: "d2p-digest-v1",
    toleranceProfile: {
      profileId: TOLERANCE_PROFILE.id,
      version: TOLERANCE_PROFILE.version,
      path: EXTERNAL.tolerance,
      digest: idDigest.tolerance,
    },
    configurations: CONFIGURATIONS.map((cfg) => ({
      configurationKey: cfg.configurationKey,
      fitProfileRef: ids.ref(cfg.fitSlug),
      materialAssumptions: cfg.materialAssumptions,
    })),
    changeCase: {
      commandPath: "inputs/change/command.json",
      parameterDeltas: [
        { parameterId: "bust-ease", deltaMm: CHANGE.bustEaseDeltaMm },
        { parameterId: "sleeve-length", deltaMm: CHANGE.sleeveLengthDeltaMm },
      ],
    },
    files: [...files.keys()]
      .sort()
      .map((rel) => ({ path: rel, role: files.get(rel).role, documentType: files.get(rel).doc.documentType, digest: digests.file(files.get(rel).doc) })),
    externalFiles: [...externalFiles.keys()].sort().map((rel) => ({ path: rel, documentType: externalFiles.get(rel).documentType, digest: digests.file(externalFiles.get(rel)) })),
    review: {
      status: "pending",
      notes: "Domain review by a pattern maker or seamstress (QEV-016) has not been performed. All proportions, ease values and measurements are synthetic.",
    },
  };
  manifest.fixtureDigest = digests.fixture(manifest);

  return { files, manifest, report };
}

function targetRefsOf(request) {
  return sortRefs(
    ["patternRef", "gradingRuleSetRef", "sizeSystemRef", "fitProfileRef", "garmentMeasurementSpecRef", "bodyMeasurementProfileRef"]
      .map((k) => request[k])
      .filter(Boolean),
  );
}

const LAYERS = [
  { id: "layer-cut", role: "d2p:cut-line", name: "Cut line (net pattern, no seam allowance)" },
  { id: "layer-grainline", role: "d2p:grainline", name: "Grainline" },
  { id: "layer-label", role: "d2p:label", name: "Labels" },
  { id: "layer-notch", role: "d2p:notch", name: "Notches" },
];
const LAYOUT_GAP_MM = 20;
const NOTCH_DEPTH_MM = 6;

/**
 * ExportScene2D of one size: front, back and both sleeve cut instances laid
 * out left to right with a 20 mm gap, bottom edge at y = 0, no rotation. The
 * right sleeve is the mirrored cut instance.
 */
function buildScene(caseKey, x, pattern, size) {
  const ev = x.ev;
  const snap = x.snapshot;
  const instances = [
    { id: "inst-front", pieceId: "front", cutInstanceKey: "front", mirror: false, label: `Front, size ${size.label}, cut 1` },
    { id: "inst-back", pieceId: "back", cutInstanceKey: "back", mirror: false, label: `Back, size ${size.label}, cut 1` },
    { id: "inst-sleeve-left", pieceId: "sleeve", cutInstanceKey: "sleeve-left", mirror: false, label: `Sleeve left, size ${size.label}` },
    { id: "inst-sleeve-right", pieceId: "sleeve", cutInstanceKey: "sleeve-right", mirror: true, label: `Sleeve right (mirrored), size ${size.label}` },
  ];
  let cursor = 0;
  const pieceInstances = [];
  for (const inst of instances) {
    const piece = pattern.pieces.find((pc) => pc.id === inst.pieceId);
    const curvesOf = (contour) => contour.edges.map((e) => {
      const c = ev.curve(e.curveFeatureId).curve;
      return e.reversed ? g.reverse(c) : c;
    });
    const contourCurves = piece.contours.map((ct) => ({ contour: ct, curves: curvesOf(ct) }));
    const mirrorOnly = { mirror: inst.mirror, rotateRad: 0, translate: [0, 0] };
    const pre = g.unionBounds(contourCurves.flatMap((cc) => cc.curves.map((c) => g.curveBounds(g.transformCurve(c, mirrorOnly)))));
    const transform = { translate: [cursor - pre.min[0], -pre.min[1]], rotateRad: 0, mirror: inst.mirror };
    const tc = (c) => g.transformCurve(c, transform);
    const tp = (p) => g.transformPoint(p, transform);
    const paths = contourCurves.map(({ contour, curves }) => {
      const t = curves.map(tc);
      return {
        id: `${inst.id}-${contour.id}`,
        layerId: "layer-cut",
        elementId: contour.id,
        closed: true,
        start: g.start(t[0]),
        segments: t.map((c) => (c.kind === "line" ? { kind: "line", end: g.end(c) } : { kind: "cubic", control1: c.p[1], control2: c.p[2], end: c.p[3] })),
      };
    });
    const markers = [];
    const edgeById = new Map(piece.contours.flatMap((ct) => ct.edges.map((e) => [e.id, e])));
    for (const n of piece.notches ?? []) {
      const { point, tangent } = notchGeometry(ev, edgeById.get(n.edgeId), n.position);
      const len = Math.hypot(tangent[0], tangent[1]);
      const inward = [point[0] - (tangent[1] / len) * NOTCH_DEPTH_MM, point[1] + (tangent[0] / len) * NOTCH_DEPTH_MM]; // left normal of a CCW contour
      markers.push({ id: `${inst.id}-${n.id}`, layerId: "layer-notch", kind: "notch", elementId: n.id, points: [tp(point), tp(inward)] });
    }
    for (const gl of piece.grainlines ?? []) {
      markers.push({ id: `${inst.id}-${gl.id}`, layerId: "layer-grainline", kind: "grainline", elementId: gl.id, points: [tp(ev.point(gl.startFeatureId)), tp(ev.point(gl.endFeatureId))] });
    }
    const bbox = g.unionBounds(contourCurves.flatMap((cc) => cc.curves.map((c) => g.curveBounds(tc(c)))));
    const labels = [
      {
        id: `${inst.id}-label`,
        layerId: "layer-label",
        anchor: [(bbox.min[0] + bbox.max[0]) / 2, (bbox.min[1] + bbox.max[1]) / 2],
        text: inst.label,
        fontSizeMm: 8,
      },
    ];
    pieceInstances.push({
      id: inst.id,
      pieceId: inst.pieceId,
      cutInstanceKey: inst.cutInstanceKey,
      sizeKey: size.sizeKey,
      transform,
      paths: sortBy(paths, "id"),
      markers: sortBy(markers, "id"),
      labels,
      boundingBox: bbox,
    });
    cursor = bbox.max[0] + LAYOUT_GAP_MM;
  }
  return quantizeDeep({
    documentType: "d2p:export-scene-2d",
    schemaVersion: SCHEMA_VERSION,
    sceneId: ids.scene(caseKey),
    source: {
      patternRef: x.request.patternRef,
      evaluations: [{ sizeKey: size.sizeKey, configurationKey: x.request.configurationKey, evaluationId: x.evaluation.evaluationId, geometryDigest: snap.geometryDigest }],
    },
    units: { length: "mm", angle: "rad" },
    coordinateSystem: { origin: "bottom-left", xAxis: "right", yAxis: "up" },
    layers: LAYERS,
    seamAllowancePolicy: "none",
    pieceInstances: sortBy(pieceInstances, "id"),
    lineStyles: [
      { layerId: "layer-cut", widthMm: 0.5 },
      { layerId: "layer-grainline", widthMm: 0.35, dashMm: [5, 3] },
      { layerId: "layer-notch", widthMm: 0.5 },
    ],
  });
}

/** Tile grid of catalog section 3.7 (informative summary, not a fixture file). */
function tileGrid(scene, print) {
  const box = g.unionBounds(scene.pieceInstances.map((pi) => pi.boundingBox));
  const { widthMm, heightMm } = print.pageLayout.media;
  const m = print.pageLayout.marginsMm;
  const overlap = print.pageLayout.tiling.overlapMm;
  const stepX = widthMm - m.left - m.right - overlap;
  const stepY = heightMm - m.top - m.bottom - overlap;
  const w = box.max[0] - box.min[0];
  const h = box.max[1] - box.min[1];
  return {
    layoutWidthMm: w,
    layoutHeightMm: h,
    columns: Math.max(1, Math.ceil((w - overlap) / stepX)),
    rows: Math.max(1, Math.ceil((h - overlap) / stepY)),
  };
}

function runAssertions({ evaluations, patternDocs, contentDigest, toleranceLimit, report, files }) {
  const check = (ok, message) => {
    if (!ok) throw new Error(`oracle assertion failed: ${message}`);
    report.checks.push(message);
  };
  const relLimit = toleranceLimit("d2p:seam-length-deviation-relative");
  const seam = (snap, id) => snap.seams.find((s) => s.seamConnectionId === id);
  for (const [c, x] of evaluations) {
    const snap = x.snapshot;
    for (const side of ["left", "right"]) {
      for (const kind of ["shoulder", "side", "underarm"]) {
        const s = seam(snap, `seam-${kind}-${side}`);
        check(Math.abs(s.lengthAMm - s.lengthBMm) <= 1e-9 && s.declaredEaseMm === 0, `${c}: seam-${kind}-${side} sides have equal length`);
      }
      for (const part of ["front", "back"]) {
        const s = seam(snap, `seam-armhole-${part}-${side}`);
        check(s.declaredEaseMm < 0 && Math.abs(s.deviationMm) <= relLimit * s.lengthAMm, `${c}: seam-armhole-${part}-${side} matches the declared cap ease within the provisional tolerance`);
      }
    }
    for (const [pieceId, area] of x.signedAreas) check(area > 0, `${c}: ${pieceId} outer contour is counter-clockwise`);
    for (const pc of snap.pieces) {
      const pts = [];
      // Sampled polyline of the evaluated contour (sanity check only).
      const ev = x.ev;
      const pattern = patternDocs[c.startsWith("r2-") ? 2 : 1];
      for (const e of pattern.pieces.find((p) => p.id === pc.pieceId).contours[0].edges) {
        const curve = ev.curve(e.curveFeatureId).curve;
        const oriented = e.reversed ? g.reverse(curve) : curve;
        pts.push(...g.sample(oriented, 64).slice(0, -1));
      }
      check(!g.polylineSelfIntersects(pts), `${c}: ${pc.pieceId} contour is simple (sampled check)`);
    }
  }
  // Element IDs are stable across sizes, configurations and the change case.
  const idsOf = (snap) =>
    JSON.stringify({
      pieces: snap.pieces.map((p) => [p.pieceId, p.contours.map((ct) => [ct.contourId, ct.segments.map((s) => s.edgeId)]), p.notches.map((n) => n.notchId), p.grainlines.map((gl) => gl.grainlineId)]),
      interfaces: snap.interfaces.map((i) => i.seamInterfaceId),
      seams: snap.seams.map((s) => s.seamConnectionId),
    });
  const all = [...evaluations.values()].map((x) => idsOf(x.snapshot));
  check(all.every((s) => s === all[0]), "element IDs are identical in every snapshot (sizes, configurations, change case)");
  const elementIds = (pat) => {
    const out = [];
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        if (typeof v.id === "string") out.push(v.id);
        if (typeof v.key === "string") out.push(`key:${v.key}`);
        Object.values(v).forEach(walk);
      }
    };
    walk({ parameters: pat.parameters, measurementInputs: pat.measurementInputs, features: pat.features, pieces: pat.pieces, seamInterfaces: pat.seamInterfaces, seamConnections: pat.seamConnections, sewingGroups: pat.sewingGroups });
    return out;
  };
  check(JSON.stringify(elementIds(patternDocs[1])) === JSON.stringify(elementIds(patternDocs[2])), "pattern r2 keeps every element ID of r1");
  check(contentDigest["pattern-r1"] !== contentDigest["pattern-r2"], "pattern r2 has a new content digest");
  for (const size of ["size-a", "size-b"]) {
    const r1 = evaluations.get(`r1-${size}-regular-woven`).snapshot;
    const r2 = evaluations.get(`r2-${size}-regular-woven`).snapshot;
    check(r1.geometryDigest !== r2.geometryDigest, `${size}: change case yields a new geometry digest`);
    const r1k = evaluations.get(`r1-${size}-relaxed-knit`).snapshot;
    check(r1.geometryDigest === r1k.geometryDigest, `${size}: geometry is independent of the material/fit configuration (standard 1.0 resolution rules)`);
  }
  const a = evaluations.get("r1-size-a-regular-woven").snapshot;
  const b = evaluations.get("r1-size-b-regular-woven").snapshot;
  check(a.geometryDigest !== b.geometryDigest, "sizes differ (measurement-driven grading)");
  // Grading is measurement-driven, not a uniform scale: the ratio of a girth-driven and a length-driven dimension changes between sizes.
  const ratio = (snap) => {
    const front = snap.pieces.find((p) => p.pieceId === "front").boundingBox;
    return (front.max[0] - front.min[0]) / (front.max[1] - front.min[1]);
  };
  check(Math.abs(ratio(a) - ratio(b)) > 1e-3, "size B is not a uniform scaling of size A");
  check(files.size > 0, "fixture files generated");
}
