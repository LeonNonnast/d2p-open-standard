// Module 3d, draft 0.3.0 (catalog §3.9 "Bodies, drapes and fit maps"):
// referential and semantic checks of avatar profiles, body bindings and
// simulation configurations of garments, body model snapshots and
// expectations, physical-simulation scenes, draped panel meshes, fit maps,
// simulation reports of drapes and drape expectations, plus the body target
// resolution (§2 of the 0.3.0 design) and the personal-derivation rule of
// D2P-SEM-050. Kernel-free: nothing here builds a body, drapes cloth or
// measures geometry; derived values are compared on quantized numbers
// (catalog §3.4 numeric comparison).
import { canonicalize, drapedMeshDigestOf, meshDigestOf, scaledInteger } from "./c14n.mjs";
import { indexGarment } from "./garment.mjs";
import { pointer } from "./json.mjs";
import { isObject, OPAQUE_MEMBERS, refKey, versionedKey, walkJson } from "./model.mjs";

const QUANTUM_SLACK = 2n;
const PHYSICAL = "physical-simulation";
/** inputDigests role pinning the artifact of each body source kind. */
const SOURCE_ROLE = { "body-measurement-profile": "body-measurement-profile", "size-entry": "size-system" };
const SOURCE_MEMBER = { "body-measurement-profile": "bodyMeasurementProfileRef", "size-entry": "sizeSystemRef" };

const at = (unit, ...tokens) => pointer(unit.base, ...tokens);
const list = (v) => (Array.isArray(v) ? v : []);
const absBig = (x) => (x < 0n ? -x : x);
/** Quantized closeness; false for a non-finite operand (an overflowing difference or inferred target). */
const closeQuantized = (a, b) => Number.isFinite(a) && Number.isFinite(b) && absBig(scaledInteger(a) - scaledInteger(b)) <= QUANTUM_SLACK;
const vkey = (v) => versionedKey(v?.id, v?.version);
const sameVersioned = (a, b) => isObject(a) && isObject(b) && a.id === b.id && a.version === b.version;
const show = (v) => `${v?.id} ${v?.version}`;

const avatarProfileOf = (index, v) => index.vocabDoc("d2p:avatar-profile", v?.id, v?.version)?.value;
const solverProfileOf = (index, v) => index.vocabDoc("d2p:solver-profile", v?.id, v?.version)?.value;
const materialProfileOf = (index, v) => index.vocabDoc("d2p:material-physics-profile", v?.id, v?.version)?.value;

/**
 * The simulation configuration `configId` of the garment pinned by
 * `garmentRef`, with its body binding: `{ gi, config, binding }`, or null
 * when the garment or the configuration is not in the bundle. `binding` is
 * undefined when the configuration names no existing body binding.
 */
export function configurationOf(index, garmentRef, configId) {
  const g = index.contentOf(garmentRef);
  if (!g || g.documentType !== "d2p:garment") return null;
  const gi = indexGarment(g);
  const config = gi.configurations.get(configId)?.item;
  if (!config) return null;
  return { gi, config, binding: gi.bodyBindings.get(config.bodyBindingId)?.item };
}

/** Garment index of a garmentRef, or null. */
function garmentIndexOf(index, garmentRef) {
  const g = index.contentOf(garmentRef);
  return g && g.documentType === "d2p:garment" ? indexGarment(g) : null;
}

// ---------------------------------------------------------------------------
// Body target resolution (design 0.3.0 §2; the oracle implements it independently)

/**
 * Source values S(d) of a body source: a map definitionId -> { value, origin }
 * with origin 'size-table' for a size entry and for profile values with method
 * 'size-table', else 'profile'. Null when the source document (or the size
 * entry) is not in the bundle.
 */
export function bodySourceValues(index, source) {
  if (source?.kind === "size-entry") {
    const ss = index.contentOf(source.sizeSystemRef);
    const entry = list(ss?.sizes).find((s) => s?.sizeKey === source.sizeKey);
    if (!entry) return null;
    return new Map(list(entry.measurements).filter(isObject).map((m) => [m.definitionId, { value: m.value, origin: "size-table" }]));
  }
  if (source?.kind === "body-measurement-profile") {
    const p = index.contentOf(source.bodyMeasurementProfileRef);
    if (!p) return null;
    return new Map(list(p.measurements).filter(isObject).map((m) => [m.definitionId, { value: m.value, origin: m.method === "size-table" ? "size-table" : "profile" }]));
  }
  return null;
}

/**
 * Body targets of an avatar profile for the source values `values`
 * (bodySourceValues): for every controlled definition (required or derived,
 * in UTF-16 definitionId order) the source value, or for a derived definition
 * whose terms all have source values the inferred value interceptMm +
 * Σ coefficient × value, computed in binary64 left to right in term order.
 * Required definitions without a value are `missingDefinitions`; the expected
 * status is 'failed' iff there is one.
 *
 * @returns {{ controlMeasures: {definitionId: string, origin: string, targetMm: number}[], missingDefinitions: string[], status: string }}
 */
export function resolveBodyTargets(profile, values) {
  const required = new Set(list(profile?.requiredDefinitions));
  const derivations = new Map(list(profile?.derivations).filter(isObject).map((d) => [d.definitionId, d]));
  const controlled = [...new Set([...required, ...derivations.keys()])].sort();
  const controlMeasures = [];
  const missingDefinitions = [];
  for (const d of controlled) {
    const s = values.get(d);
    if (s && typeof s.value === "number") {
      controlMeasures.push({ definitionId: d, origin: s.origin, targetMm: s.value });
      continue;
    }
    const rule = derivations.get(d);
    const terms = list(rule?.terms);
    if (rule && terms.length && terms.every((t) => typeof values.get(t?.definitionId)?.value === "number")) {
      let target = rule.interceptMm;
      for (const t of terms) target += t.coefficient * values.get(t.definitionId).value;
      controlMeasures.push({ definitionId: d, origin: "inferred", targetMm: target });
    } else if (required.has(d)) missingDefinitions.push(d);
  }
  return { controlMeasures, missingDefinitions, status: missingDefinitions.length ? "failed" : "succeeded" };
}

// ---------------------------------------------------------------------------
// Personal derivation (D2P-SEM-050, D2P-SEM-052)

/** Documents that state personalDerived and are personal-derived through their references. */
export const PERSONAL_DERIVED_TYPES = new Set([
  "d2p:scene-snapshot",
  "d2p:sim-report",
  "d2p:body-model-snapshot",
  "d2p:draped-panel-mesh",
  "d2p:fit-map",
  "d2p:body-model-expectation",
]);

/**
 * Why a document is personal-derived: `[{ ptr, message }]`, empty when it is
 * not. Direct: an artifactRef (in any …Ref / …Refs member, inputDigests and
 * body sources included) of an artifact classified personal or
 * sensitive-personal; not for a sim-report, whose references 0.2.1 left
 * unconstrained (catalog §3.9.1). Transitive: a scene through its body model
 * or the body binding of its configuration, a draped mesh through the body
 * binding of its configuration, a fit map through its scene or body model, a
 * sim-report through its scene. A referenced document that states
 * `personalDerived: true` counts as personal-derived. `path` holds the
 * documents being followed, so a reference cycle ends instead of recursing.
 */
export function personalDerivations(index, doc, base = "", path = new Set()) {
  const out = [];
  if (!isObject(doc) || path.has(doc)) return out;
  path.add(doc);
  if (doc.documentType !== "d2p:sim-report") walkJson(doc, (node, ptr, key) => {
    if (typeof key !== "string") return true;
    const refs = key.endsWith("Ref") && isObject(node) ? [[node, ptr]] : key.endsWith("Refs") && Array.isArray(node) ? node.map((r, i) => [r, pointer(ptr, i)]) : [];
    for (const [ref, p] of refs) {
      if (isObject(ref) && typeof ref.artifactId === "string" && index.isPersonal(ref.artifactId)) {
        out.push({ ptr: p, message: `references artifact ${ref.artifactId}, which is classified as personal data` });
      }
    }
    return true;
  }, base, OPAQUE_MEMBERS);
  const derived = (type, ref) => (isObject(ref) ? index.derivedDoc(type, ref.id)?.value : undefined);
  const through = (target, member, what) => {
    if (target && (target.personalDerived === true || personalDerivations(index, target, "", path).length)) {
      out.push({ ptr: pointer(base, member), message: `derives from ${what}, which is personal-derived` });
    }
  };
  const throughBinding = (garmentRef) => {
    const c = configurationOf(index, garmentRef, doc.simulationConfigurationId);
    const source = c?.binding?.source;
    const ref = source?.[SOURCE_MEMBER[source?.kind]];
    if (isObject(ref) && index.isPersonal(ref.artifactId)) {
      out.push({ ptr: pointer(base, "simulationConfigurationId"), message: `simulation configuration "${doc.simulationConfigurationId}" binds the body of artifact ${ref.artifactId}, which is classified as personal data` });
    }
  };
  switch (doc.documentType) {
    case "d2p:scene-snapshot":
      through(derived("d2p:body-model-snapshot", doc.bodyModelRef), "bodyModelRef", `body model ${doc.bodyModelRef?.id}`);
      if (doc.mode === PHYSICAL) throughBinding(doc.garmentRef);
      break;
    case "d2p:draped-panel-mesh":
      throughBinding(doc.garmentRef);
      break;
    case "d2p:fit-map":
      through(derived("d2p:scene-snapshot", doc.sceneSnapshotRef), "sceneSnapshotRef", `scene ${doc.sceneSnapshotRef?.id}`);
      through(derived("d2p:body-model-snapshot", doc.bodyModelRef), "bodyModelRef", `body model ${doc.bodyModelRef?.id}`);
      break;
    case "d2p:sim-report":
      through(derived("d2p:scene-snapshot", doc.sceneSnapshotRef), "sceneSnapshotRef", `scene ${doc.sceneSnapshotRef?.id}`);
      break;
    default:
      break;
  }
  path.delete(doc);
  return out;
}

/** True when a document states personalDerived: true or is personal-derived through its references. */
export function isPersonalDerived(index, doc) {
  return isObject(doc) && (doc.personalDerived === true || personalDerivations(index, doc).length > 0);
}

// ---------------------------------------------------------------------------
// Referential level

/** D2P-REF-009: the sizeKey of a size-entry body source resolves in its size system (when in the bundle). */
export function checkBodySourceSizeKey(ctx, unit, source, ptr) {
  if (source?.kind !== "size-entry") return;
  const ss = ctx.index.contentOf(source.sizeSystemRef);
  if (ss && !list(ss.sizes).some((s) => s?.sizeKey === source.sizeKey)) {
    ctx.report("D2P-REF-009", `sizeKey "${source.sizeKey}" is not defined in size system ${refKey(source.sizeSystemRef)}`, unit, pointer(ptr, "sizeKey"));
  }
}

/**
 * D2P-REF-003 for body bindings and simulation configurations of a garment
 * (bodyBindingId, patternEvaluationId, arrangementId, materialAssignmentId)
 * and D2P-REF-009 for the size keys of body sources.
 */
export function checkGarmentDrapeReferences(ctx, unit) {
  const gi = indexGarment(unit.value);
  const report = (code, msg, ptr) => ctx.report(code, msg, unit, ptr);
  list(unit.value.bodyBindings).forEach((b, i) => checkBodySourceSizeKey(ctx, unit, b?.source, at(unit, "bodyBindings", i, "source")));
  list(unit.value.simulationConfigurations).forEach((c, i) => {
    const ptr = at(unit, "simulationConfigurations", i);
    const need = (map, id, what, member) => {
      if (!map.has(id)) report("D2P-REF-003", `simulation configuration "${c.id}": ${what} "${id}" does not exist in this garment`, pointer(ptr, member));
    };
    need(gi.bodyBindings, c.bodyBindingId, "body binding", "bodyBindingId");
    need(gi.evals, c.patternEvaluationId, "pattern evaluation reference", "patternEvaluationId");
    need(gi.arrangements, c.arrangementId, "arrangement", "arrangementId");
    list(c.materials).forEach((m, j) => {
      if (!gi.assignments.has(m?.materialAssignmentId)) {
        report("D2P-REF-003", `simulation configuration "${c.id}": material assignment "${m?.materialAssignmentId}" does not exist in this garment`, pointer(ptr, "materials", j, "materialAssignmentId"));
      }
    });
  });
}

/**
 * Checks that the entries of one inputDigests role pin exactly the wanted
 * keys, each once (D2P-REF-007). `keyOf` maps an entry to its pin key.
 */
function checkPins(report, digests, role, wanted, keyOf, what, ptr) {
  const got = digests.filter((d) => d?.role === role).map(keyOf).sort();
  const want = [...new Set(wanted)].sort();
  if (got.length !== want.length || got.some((k, i) => k !== want[i])) {
    report("D2P-REF-007", `inputDigests must contain exactly one entry of role ${role} for ${what}${want.length ? ` (${want.join(", ")})` : ""}, found ${got.length ? got.join(", ") : "none"}`, ptr);
  }
}

const artifactPin = (d) => (isObject(d?.artifactRef) ? refKey(d.artifactRef) : "(no artifactRef)");
const idPin = (d) => (isObject(d?.id) ? vkey(d.id) : "(no id)");

/** D2P-REF-007: the body source entry of inputDigests pins the source document. */
function checkSourcePin(report, digests, source, ptr) {
  const role = SOURCE_ROLE[source?.kind];
  const ref = source?.[SOURCE_MEMBER[source?.kind]];
  if (!role || !isObject(ref)) return;
  checkPins(report, digests, role, [refKey(ref)], artifactPin, "the body source", ptr);
}

/**
 * Physical-simulation scene inputs and snapshots (D2P-REF-003, D2P-REF-007,
 * D2P-REF-011): the configuration exists in the garment; the body model has
 * the body binding's source and avatar profile; the mesh profile is the
 * solver profile's; a snapshot pins the avatar, solver and material physics
 * profiles and the body source, and its draped mesh digests match.
 */
export function checkDrapeSceneReferences(ctx, unit) {
  const v = unit.value;
  if (v.mode !== PHYSICAL) return;
  const report = (code, msg, ptr) => ctx.report(code, msg, unit, ptr);
  if (v.documentType === "d2p:scene-snapshot") {
    list(v.drapedMeshRefs).forEach((e, i) => {
      const d = ctx.index.derivedDoc("d2p:draped-panel-mesh", e?.drapedMeshRef?.id)?.value;
      if (d && d.meshDigest !== e.meshDigest) report("D2P-REF-011", `meshDigest differs from the meshDigest of ${e.drapedMeshRef.id}`, at(unit, "drapedMeshRefs", i, "meshDigest"));
    });
  }
  const gi = garmentIndexOf(ctx.index, v.garmentRef);
  if (!gi) return;
  const config = gi.configurations.get(v.simulationConfigurationId)?.item;
  if (!config) {
    report("D2P-REF-003", `simulation configuration "${v.simulationConfigurationId}" does not exist in garment ${refKey(v.garmentRef)}`, at(unit, "simulationConfigurationId"));
    return;
  }
  const binding = gi.bodyBindings.get(config.bodyBindingId)?.item;
  const body = ctx.index.derivedDoc("d2p:body-model-snapshot", v.bodyModelRef?.id)?.value;
  if (body && binding) {
    if (canonicalize(body.source) !== canonicalize(binding.source)) report("D2P-REF-007", `body model ${body.bodyModelId} has another body source than body binding "${binding.id}"`, at(unit, "bodyModelRef"));
    if (!sameVersioned(body.avatarProfile, binding.avatarProfile)) report("D2P-REF-007", `body model ${body.bodyModelId} uses avatar profile ${show(body.avatarProfile)}, body binding "${binding.id}" ${show(binding.avatarProfile)}`, at(unit, "bodyModelRef"));
  }
  const solver = solverProfileOf(ctx.index, config.solverProfile);
  if (solver && !sameVersioned(solver.meshProfile, v.meshProfile)) {
    report("D2P-REF-007", `meshProfile ${show(v.meshProfile)} is not the mesh profile ${show(solver.meshProfile)} of solver profile ${show(config.solverProfile)}`, at(unit, "meshProfile"));
  }
  if (v.documentType !== "d2p:scene-snapshot") return;
  const digests = list(v.inputDigests);
  const ptr = at(unit, "inputDigests");
  if (binding) {
    checkPins(report, digests, "avatar-profile", [vkey(binding.avatarProfile)], idPin, `the avatar profile of body binding "${binding.id}"`, ptr);
    checkSourcePin(report, digests, binding.source, ptr);
  }
  checkPins(report, digests, "solver-profile", [vkey(config.solverProfile)], idPin, `the solver profile of configuration "${config.id}"`, ptr);
  checkPins(report, digests, "material-physics-profile", list(config.materials).map((m) => vkey(m?.materialPhysicsProfile)), idPin, `each material physics profile of configuration "${config.id}"`, ptr);
}

/** Body model snapshots (D2P-REF-007, D2P-REF-009, D2P-REF-011). */
export function checkBodyModelReferences(ctx, unit) {
  const v = unit.value;
  const report = (code, msg, ptr) => ctx.report(code, msg, unit, ptr);
  if (isObject(v.mesh) && typeof v.meshDigest === "string" && meshDigestOf(v) !== v.meshDigest) report("D2P-REF-011", `meshDigest differs from the recomputed digest ${meshDigestOf(v)}`, at(unit, "meshDigest"));
  checkBodySourceSizeKey(ctx, unit, v.source, at(unit, "source"));
  const digests = list(v.inputDigests);
  const ptr = at(unit, "inputDigests");
  checkSourcePin(report, digests, v.source, ptr);
  checkPins(report, digests, "avatar-profile", [vkey(v.avatarProfile)], idPin, "avatarProfile", ptr);
  const profile = avatarProfileOf(ctx.index, v.avatarProfile);
  if (profile) checkPins(report, digests, "measurement-definition-registry", list(profile.definitionRegistries).map(vkey), idPin, `each registry of avatar profile ${show(v.avatarProfile)}`, ptr);
}

/** Body model expectations (D2P-REF-009). */
export function checkBodyModelExpectationReferences(ctx, unit) {
  checkBodySourceSizeKey(ctx, unit, unit.value.source, at(unit, "source"));
}

/** Draped panel meshes (D2P-REF-003, D2P-REF-011). */
export function checkDrapedMeshReferences(ctx, unit) {
  const v = unit.value;
  const report = (code, msg, ptr) => ctx.report(code, msg, unit, ptr);
  if (Array.isArray(v.positionsM) && typeof v.meshDigest === "string" && drapedMeshDigestOf(v) !== v.meshDigest) {
    report("D2P-REF-011", `meshDigest differs from the recomputed digest ${drapedMeshDigestOf(v)}`, at(unit, "meshDigest"));
  }
  const rest = ctx.index.derivedDoc("d2p:panel-mesh-result", v.restMeshRef?.id)?.value;
  if (rest && rest.meshDigest !== v.restMeshDigest) report("D2P-REF-011", `restMeshDigest differs from the meshDigest of rest mesh ${v.restMeshRef.id}`, at(unit, "restMeshDigest"));
  const gi = garmentIndexOf(ctx.index, v.garmentRef);
  if (!gi) return;
  if (!gi.configurations.has(v.simulationConfigurationId)) report("D2P-REF-003", `simulation configuration "${v.simulationConfigurationId}" does not exist in garment ${refKey(v.garmentRef)}`, at(unit, "simulationConfigurationId"));
  if (!gi.panels.has(v.panelInstanceId)) report("D2P-REF-003", `panel instance "${v.panelInstanceId}" does not exist in garment ${refKey(v.garmentRef)}`, at(unit, "panelInstanceId"));
}

/** Fit maps (D2P-REF-007): body model, avatar and solver profile of the scene's configuration. */
export function checkFitMapReferences(ctx, unit) {
  const v = unit.value;
  const report = (msg, member) => ctx.report("D2P-REF-007", msg, unit, at(unit, member));
  const scene = ctx.index.derivedDoc("d2p:scene-snapshot", v.sceneSnapshotRef?.id)?.value;
  if (!scene) return;
  if (isObject(scene.bodyModelRef) && scene.bodyModelRef.id !== v.bodyModelRef?.id) report(`bodyModelRef ${v.bodyModelRef?.id} is not the body model ${scene.bodyModelRef.id} of scene ${scene.sceneSnapshotId}`, "bodyModelRef");
  const c = configurationOf(ctx.index, scene.garmentRef, scene.simulationConfigurationId);
  if (!c) return;
  if (c.binding && !sameVersioned(v.avatarProfile, c.binding.avatarProfile)) report(`avatarProfile ${show(v.avatarProfile)} is not the avatar profile ${show(c.binding.avatarProfile)} of body binding "${c.binding.id}"`, "avatarProfile");
  if (!sameVersioned(v.solverProfile, c.config.solverProfile)) report(`solverProfile ${show(v.solverProfile)} is not the solver profile ${show(c.config.solverProfile)} of configuration "${c.config.id}"`, "solverProfile");
}

/** Drape expectations (D2P-REF-003): each subject's configuration exists in its garment. */
export function checkDrapeExpectationReferences(ctx, unit) {
  list(unit.value.comparisons).forEach((cmp, i) => {
    for (const side of ["lower", "higher"]) {
      const s = cmp?.[side];
      const gi = garmentIndexOf(ctx.index, s?.garmentRef);
      if (gi && !gi.configurations.has(s.simulationConfigurationId)) {
        ctx.report("D2P-REF-003", `simulation configuration "${s.simulationConfigurationId}" does not exist in garment ${refKey(s.garmentRef)}`, unit, at(unit, "comparisons", i, side, "simulationConfigurationId"));
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Semantic level

/**
 * D2P-SEM-127 (a): an avatar profile derives no required definition, uses only
 * required definitions in derivation terms, has exactly one tolerance per
 * controlled (required or derived) definition and delimits zones by declared
 * landmarks.
 */
export function checkAvatarProfileSemantics(ctx, unit) {
  const v = unit.value;
  const report = (msg, ...tokens) => ctx.report("D2P-SEM-127", msg, unit, at(unit, ...tokens));
  const required = new Set(list(v.requiredDefinitions));
  const controlled = new Set(required);
  list(v.derivations).forEach((d, i) => {
    controlled.add(d?.definitionId);
    if (required.has(d?.definitionId)) report(`derivation of "${d.definitionId}", which is a required definition`, "derivations", i, "definitionId");
    list(d?.terms).forEach((t, j) => {
      if (!required.has(t?.definitionId)) report(`derivation of "${d.definitionId}" uses "${t?.definitionId}", which is not a required definition`, "derivations", i, "terms", j, "definitionId");
    });
  });
  const tolerated = new Set();
  list(v.tolerances).forEach((t, i) => {
    if (!controlled.has(t?.definitionId)) report(`tolerance for "${t?.definitionId}", which is neither required nor derived`, "tolerances", i, "definitionId");
    tolerated.add(t?.definitionId);
  });
  for (const d of [...controlled].sort()) if (!tolerated.has(d)) report(`no tolerance for the controlled definition "${d}"`, "tolerances");
  const landmarks = new Set(list(v.landmarks).map((l) => l?.landmarkId));
  list(v.zones).forEach((z, i) => list(z?.landmarkIds).forEach((id, j) => {
    if (!landmarks.has(id)) report(`zone ${z.zone} names landmark "${id}", which the profile does not declare`, "zones", i, "landmarkIds", j);
  }));
}

/**
 * D2P-SEM-127 (b) for body model snapshots and body model expectations:
 * targets per the body target resolution, status and missing definitions,
 * tolerances, measured deviations (AVA-001, AVA-003), landmarks and pose.
 * Target checks need the source document; profile checks need the avatar profile.
 */
export function checkBodyModelSemantics(ctx, unit) {
  const v = unit.value;
  const report = (msg, ...tokens) => ctx.report("D2P-SEM-127", msg, unit, at(unit, ...tokens));
  const snapshot = v.documentType === "d2p:body-model-snapshot";
  const status = snapshot ? v.status : v.expectedStatus;
  const statusMember = snapshot ? "status" : "expectedStatus";
  const measures = list(v.controlMeasures);

  if (snapshot) {
    measures.forEach((m, i) => {
      const has = typeof m?.measuredMm === "number" && typeof m?.deviationMm === "number";
      if (status === "succeeded" && !has) report(`control measure "${m?.definitionId}" of a succeeded body model has no measuredMm and deviationMm`, "controlMeasures", i);
      if (status === "failed" && (m?.measuredMm !== undefined || m?.deviationMm !== undefined)) report(`control measure "${m?.definitionId}" of a failed body model states a measured value`, "controlMeasures", i);
      if (has && !closeQuantized(m.deviationMm, m.measuredMm - m.targetMm)) report(`deviationMm ${m.deviationMm} of "${m.definitionId}" is not measuredMm − targetMm`, "controlMeasures", i, "deviationMm");
    });
  } else {
    const declared = list(v.missingDefinitions).length > 0;
    if (status === "failed" && !declared) report("a failed expectation names no missingDefinitions", statusMember);
  }

  const profile = avatarProfileOf(ctx.index, v.avatarProfile);
  if (!profile) return;
  if (snapshot && v.pose !== profile.pose) report(`pose ${v.pose} differs from the pose ${profile.pose} of avatar profile ${show(v.avatarProfile)}`, "pose");
  const tolerances = new Map(list(profile.tolerances).map((t) => [t?.definitionId, t?.maxDeviationMm]));
  measures.forEach((m, i) => {
    const tol = tolerances.get(m?.definitionId);
    if (typeof tol !== "number") return;
    if (!snapshot && !closeQuantized(m.maxDeviationMm, tol)) report(`maxDeviationMm ${m.maxDeviationMm} of "${m.definitionId}" differs from the tolerance ${tol} of the avatar profile`, "controlMeasures", i, "maxDeviationMm");
    if (snapshot && status === "succeeded" && typeof m.deviationMm === "number" && absBig(scaledInteger(m.deviationMm)) > scaledInteger(tol)) {
      report(`control measure "${m.definitionId}" deviates by more than the tolerance ${tol} mm of the avatar profile (AVA-001)`, "controlMeasures", i, "deviationMm");
    }
  });
  if (snapshot && status === "succeeded") {
    const want = list(profile.landmarks).map((l) => l?.landmarkId).sort();
    const got = list(v.landmarks).map((l) => l?.landmarkId).sort();
    if (want.length !== got.length || want.some((id, i) => id !== got[i])) report("landmarks are not exactly one per landmark of the avatar profile", "landmarks");
  }

  const values = bodySourceValues(ctx.index, v.source);
  if (!values) return;
  const expected = resolveBodyTargets(profile, values);
  const want = new Map(expected.controlMeasures.map((m) => [m.definitionId, m]));
  const seen = new Set();
  measures.forEach((m, i) => {
    const e = want.get(m?.definitionId);
    if (seen.has(m?.definitionId) || !e) {
      report(`control measure "${m?.definitionId}" ${seen.has(m?.definitionId) ? "appears more than once" : "has no target for this body source and avatar profile"}`, "controlMeasures", i);
      seen.add(m?.definitionId);
      return;
    }
    seen.add(m.definitionId);
    if (m.origin !== e.origin) report(`origin ${m.origin} of "${m.definitionId}" differs from the resolved origin ${e.origin}`, "controlMeasures", i, "origin");
    if (!closeQuantized(m.targetMm, e.targetMm)) report(`targetMm of "${m.definitionId}" differs from the resolved target`, "controlMeasures", i, "targetMm");
  });
  for (const d of want.keys()) if (!seen.has(d)) report(`control measure "${d}" is missing`, "controlMeasures");
  const missing = expected.missingDefinitions;
  if (status === "succeeded" && missing.length) report(`required definitions without a value (${missing.join(", ")}) make the body model failed (AVA-003)`, statusMember);
  if (!snapshot) {
    if (status === "failed" && !missing.length && list(v.missingDefinitions).length) report("expectedStatus failed although every required definition has a value", statusMember);
    const got = [...list(v.missingDefinitions)].sort();
    if (got.length !== missing.length || got.some((d, i) => d !== missing[i])) report(`missingDefinitions [${got.join(", ")}] differ from the resolved [${missing.join(", ")}]`, "missingDefinitions");
  }
}

/**
 * D2P-SEM-128 for a garment: each simulation configuration names exactly the
 * material assignments of its draped panels, once each, with material physics
 * profiles of the declared material class; body bindings use their avatar
 * profile's pose.
 */
export function checkGarmentDrapeSemantics(ctx, unit) {
  const g = unit.value;
  const gi = indexGarment(g);
  const report = (msg, ...tokens) => ctx.report("D2P-SEM-128", msg, unit, at(unit, ...tokens));
  list(g.simulationConfigurations).forEach((c, i) => {
    const panels = new Set([...gi.panels.values()].filter((p) => p.item.patternEvaluationId === c.patternEvaluationId).map((p) => p.item.id));
    const want = new Set([...gi.assignments.values()].filter((a) => list(a.item.panelInstanceIds).some((id) => panels.has(id))).map((a) => a.item.id));
    const named = new Set();
    list(c.materials).forEach((m, j) => {
      const id = m?.materialAssignmentId;
      if (named.has(id)) report(`configuration "${c.id}" names material assignment "${id}" more than once`, "simulationConfigurations", i, "materials", j);
      else if (!want.has(id)) report(`configuration "${c.id}" names material assignment "${id}", which has no panel instance of pattern evaluation reference "${c.patternEvaluationId}"`, "simulationConfigurations", i, "materials", j);
      named.add(id);
      const assignment = gi.assignments.get(id)?.item;
      const profile = materialProfileOf(ctx.index, m?.materialPhysicsProfile);
      if (assignment && profile && profile.materialClass !== assignment.material?.materialClass) {
        report(`material physics profile ${show(m.materialPhysicsProfile)} is for ${profile.materialClass}, material assignment "${id}" declares ${assignment.material?.materialClass}`, "simulationConfigurations", i, "materials", j, "materialPhysicsProfile");
      }
    });
    for (const id of [...want].sort()) if (!named.has(id)) report(`configuration "${c.id}" has no material physics profile for material assignment "${id}"`, "simulationConfigurations", i, "materials");
  });
  list(g.bodyBindings).forEach((b, i) => {
    const profile = avatarProfileOf(ctx.index, b?.avatarProfile);
    if (profile && profile.pose !== b.pose) report(`body binding "${b.id}" uses pose ${b.pose}, avatar profile ${show(b.avatarProfile)} ${profile.pose}`, "bodyBindings", i, "pose");
  });
}

/**
 * D2P-SEM-129 for a physical-simulation scene snapshot: one draped mesh per
 * panel binding (none for a failed drape), each draping the panel's rest mesh
 * with as many positions, for the scene's garment and configuration; a body
 * model that did not succeed only under a failed scene.
 */
export function checkDrapeSceneSemantics(ctx, unit) {
  const v = unit.value;
  if (v.documentType !== "d2p:scene-snapshot" || v.mode !== PHYSICAL) return;
  const report = (msg, ...tokens) => ctx.report("D2P-SEM-129", msg, unit, at(unit, ...tokens));
  const failed = v.qualityStatus === "failed";
  const refs = list(v.drapedMeshRefs);
  if (failed && refs.length) report("a failed drape has no draped meshes (drapedMeshRefs must be [])", "drapedMeshRefs");
  if (!failed && v.qualityStatus !== "unsupported") {
    const bound = new Set(list(v.panelBindings).map((b) => b?.panelInstanceId));
    const seen = new Set();
    refs.forEach((e, i) => {
      if (seen.has(e?.panelInstanceId)) report(`panel instance "${e.panelInstanceId}" has more than one draped mesh`, "drapedMeshRefs", i, "panelInstanceId");
      else if (!bound.has(e?.panelInstanceId)) report(`panel instance "${e?.panelInstanceId}" has no panel binding`, "drapedMeshRefs", i, "panelInstanceId");
      seen.add(e?.panelInstanceId);
    });
    for (const id of bound) if (!seen.has(id)) report(`qualityStatus "${v.qualityStatus}" but panel instance "${id}" has no draped mesh`, "drapedMeshRefs");
  }
  const restOf = new Map(list(v.meshRefs).map((m) => [m?.panelInstanceId, m?.meshResultRef?.id]));
  refs.forEach((e, i) => {
    const d = ctx.index.derivedDoc("d2p:draped-panel-mesh", e?.drapedMeshRef?.id)?.value;
    if (!d) return;
    const problems = [];
    if (d.panelInstanceId !== e.panelInstanceId) problems.push(`drapes panel instance "${d.panelInstanceId}"`);
    if (refKey(d.garmentRef) !== refKey(v.garmentRef)) problems.push(`belongs to garment ${refKey(d.garmentRef)}`);
    if (d.simulationConfigurationId !== v.simulationConfigurationId) problems.push(`belongs to configuration "${d.simulationConfigurationId}"`);
    if (restOf.has(e.panelInstanceId) && d.restMeshRef?.id !== restOf.get(e.panelInstanceId)) problems.push(`drapes rest mesh ${d.restMeshRef?.id}, not ${restOf.get(e.panelInstanceId)}`);
    const rest = ctx.index.derivedDoc("d2p:panel-mesh-result", d.restMeshRef?.id)?.value;
    if (Array.isArray(rest?.mesh?.positions) && list(d.positionsM).length !== rest.mesh.positions.length) {
      problems.push(`has ${list(d.positionsM).length} positions, its rest mesh ${rest.mesh.positions.length}`);
    }
    for (const p of problems) report(`draped mesh ${d.drapedMeshId} ${p}`, "drapedMeshRefs", i);
  });
  const body = ctx.index.derivedDoc("d2p:body-model-snapshot", v.bodyModelRef?.id)?.value;
  if (body && body.status !== "succeeded" && !failed) report(`body model ${body.bodyModelId} has status ${body.status}, but the drape is not failed`, "bodyModelRef");
}

/**
 * D2P-SEM-129 for a fit map: a succeeded physical scene, exactly the avatar
 * profile's zones (FMP-001), vertex fields (when present) exactly one per
 * draped panel with one value per draped position, and the material status
 * of the configuration's material physics profiles.
 */
export function checkFitMapSemantics(ctx, unit) {
  const v = unit.value;
  const report = (msg, ...tokens) => ctx.report("D2P-SEM-129", msg, unit, at(unit, ...tokens));
  const scene = ctx.index.derivedDoc("d2p:scene-snapshot", v.sceneSnapshotRef?.id)?.value;
  if (scene && (scene.mode !== PHYSICAL || scene.qualityStatus === "failed")) {
    report(`scene ${scene.sceneSnapshotId} is ${scene.mode !== PHYSICAL ? `of mode ${scene.mode}` : "a failed drape"}; a fit map needs a drape`, "sceneSnapshotRef");
  }
  const profile = avatarProfileOf(ctx.index, v.avatarProfile);
  if (profile) {
    const want = new Map(list(profile.zones).map((z) => [z?.zone, canonicalize([...list(z?.landmarkIds)].sort())]));
    const seen = new Set();
    list(v.zones).forEach((z, i) => {
      if (seen.has(z?.zone) || !want.has(z?.zone)) report(`zone ${z?.zone} ${seen.has(z?.zone) ? "appears more than once" : "is not a zone of the avatar profile"}`, "zones", i, "zone");
      else if (want.get(z.zone) !== canonicalize([...list(z.landmarkIds)].sort())) report(`zone ${z.zone} has other landmarks than the avatar profile defines`, "zones", i, "landmarkIds");
      seen.add(z?.zone);
    });
    for (const zone of want.keys()) if (!seen.has(zone)) report(`zone ${zone} of the avatar profile is missing`, "zones");
  }
  if (scene) {
    const draped = new Map(list(scene.drapedMeshRefs).map((e) => [e?.panelInstanceId, e?.drapedMeshRef?.id]));
    const fielded = new Set();
    list(v.vertexFields).forEach((f, i) => {
      if (fielded.has(f?.panelInstanceId) || !draped.has(f?.panelInstanceId)) {
        const why = fielded.has(f?.panelInstanceId) ? "appears more than once" : `has no draped mesh in scene ${scene.sceneSnapshotId}`;
        report(`vertex field of panel instance "${f?.panelInstanceId}" ${why}`, "vertexFields", i, "panelInstanceId");
        fielded.add(f?.panelInstanceId);
        return;
      }
      fielded.add(f.panelInstanceId);
      const d = ctx.index.derivedDoc("d2p:draped-panel-mesh", draped.get(f.panelInstanceId))?.value;
      if (!d) return;
      const n = list(d.positionsM).length;
      for (const member of ["strain", "clearanceMm", "contactPressure"]) {
        if (list(f[member]).length !== n) report(`${member} of panel instance "${f.panelInstanceId}" has ${list(f[member]).length} values, its draped mesh ${n} positions`, "vertexFields", i, member);
      }
    });
    if (Array.isArray(v.vertexFields)) {
      for (const id of [...draped.keys()].sort()) if (!fielded.has(id)) report(`draped panel instance "${id}" has no vertex field`, "vertexFields");
    }
    const c = configurationOf(ctx.index, scene.garmentRef, scene.simulationConfigurationId);
    const profiles = c ? list(c.config.materials).map((m) => materialProfileOf(ctx.index, m?.materialPhysicsProfile)) : [];
    if (profiles.length && profiles.every(Boolean)) {
      const expected = profiles.some((p) => p.status === "provisional") ? "provisional" : "frozen";
      if (v.materialStatus !== expected) report(`materialStatus must be ${expected} (status of the configuration's material physics profiles), got ${v.materialStatus}`, "materialStatus");
    }
  }
}

/**
 * D2P-SEM-129 for a simulation report about a physical scene: the
 * configuration's solver profile and seed, the solver profile's kind, and
 * failed exactly when the scene is failed.
 */
export function checkDrapeSimReportSemantics(ctx, unit) {
  const v = unit.value;
  const scene = ctx.index.derivedDoc("d2p:scene-snapshot", v.sceneSnapshotRef?.id)?.value;
  if (!scene || scene.mode !== PHYSICAL) return;
  const report = (msg, member) => ctx.report("D2P-SEM-129", msg, unit, at(unit, member));
  const c = configurationOf(ctx.index, scene.garmentRef, scene.simulationConfigurationId);
  if (c) {
    if (!sameVersioned(v.solverProfile, c.config.solverProfile)) report(`solverProfile ${show(v.solverProfile)} is not the solver profile ${show(c.config.solverProfile)} of configuration "${c.config.id}"`, "solverProfile");
    if (v.randomSeed !== c.config.randomSeed) report(`randomSeed ${v.randomSeed ?? "(absent)"} is not the seed ${c.config.randomSeed} of configuration "${c.config.id}"`, "randomSeed");
  }
  const solver = solverProfileOf(ctx.index, v.solverProfile);
  if (solver && solver.profileKind !== v.profileKind) report(`profileKind ${v.profileKind} differs from the kind ${solver.profileKind} of solver profile ${show(v.solverProfile)}`, "profileKind");
  if ((v.status === "failed") !== (scene.qualityStatus === "failed")) report(`status ${v.status} but scene ${scene.sceneSnapshotId} has qualityStatus ${scene.qualityStatus}`, "status");
}

/** Fit maps of a drape subject: fit maps whose scene drapes that garment revision with that configuration. */
function fitMapsOf(ctx, subject) {
  const out = [];
  for (const u of ctx.index.units) {
    if (u.embedded || u.value.documentType !== "d2p:fit-map") continue;
    const scene = ctx.index.derivedDoc("d2p:scene-snapshot", u.value.sceneSnapshotRef?.id)?.value;
    if (scene && refKey(scene.garmentRef) === refKey(subject?.garmentRef) && scene.simulationConfigurationId === subject?.simulationConfigurationId) out.push(u.value);
  }
  return out;
}

/**
 * D2P-SEM-130: both subjects of a comparison use the same body (source and
 * avatar profile), and when fit maps of both are in the bundle the zone metric
 * of 'lower' is strictly less than that of 'higher' (DRP-004).
 */
export function checkDrapeExpectationSemantics(ctx, unit) {
  list(unit.value.comparisons).forEach((cmp, i) => {
    const report = (msg) => ctx.report("D2P-SEM-130", `comparison "${cmp?.id}": ${msg}`, unit, at(unit, "comparisons", i));
    const lo = configurationOf(ctx.index, cmp?.lower?.garmentRef, cmp?.lower?.simulationConfigurationId);
    const hi = configurationOf(ctx.index, cmp?.higher?.garmentRef, cmp?.higher?.simulationConfigurationId);
    if (lo?.binding && hi?.binding) {
      if (canonicalize(lo.binding.source) !== canonicalize(hi.binding.source)) report("the two drapes use different body sources");
      if (!sameVersioned(lo.binding.avatarProfile, hi.binding.avatarProfile)) report("the two drapes use different avatar profiles");
    }
    const value = (m) => list(m.zones).find((z) => z?.zone === cmp.zone)?.[cmp.metric];
    for (const l of fitMapsOf(ctx, cmp?.lower)) {
      for (const h of fitMapsOf(ctx, cmp?.higher)) {
        const a = value(l);
        const b = value(h);
        if (typeof a === "number" && typeof b === "number" && !(scaledInteger(a) < scaledInteger(b))) {
          // No metric values: a fit map of a personal body would leak them (catalog §2.3).
          report(`${cmp.metric} of zone ${cmp.zone} in fit map ${l.fitMapId} (lower) is not strictly less than in fit map ${h.fitMapId} (higher) (DRP-004)`);
          return;
        }
      }
    }
  });
}
