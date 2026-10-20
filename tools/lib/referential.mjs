// Referential level (catalog §2.1, §2.4 REF codes, §2.6 resolution scope).
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalize,
  contentDigestOf,
  digestOf,
  geometryDigestOf,
  RESULT_DIGEST_TYPES,
  sceneDigestOf,
  resultDigestOf,
  sha256,
} from "./c14n.mjs";
import { diagnostic } from "./diagnostics.mjs";
import { walkExpr } from "./expression.mjs";
import {
  checkGarmentReferences,
  checkInspectionReferences,
  checkPanelMeshReferences,
  checkProposalReferences,
  checkSceneExpectationReferences,
  checkSceneInputReferences,
  checkSceneSnapshotReferences,
} from "./garment.mjs";
import { rel, walk } from "./fs.mjs";
import { parseStrictJsonBytes, pointer } from "./json.mjs";
import { embeddedDocuments, identityKey, isObject, OPAQUE_MEMBERS, OWN_ID_MEMBERS, refKey, sameRefSet, walkJson } from "./model.mjs";
import {
  contentElementKinds,
  featureOutputs,
  indexPattern,
  isExtensionName,
  PARAM_REFERENCE_KINDS,
  satisfiesKind,
} from "./pattern.mjs";

const ELEMENT_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const INFORMATIVE_TYPES = new Set(["d2p:test-run-report", "d2p:benchmark-run"]);
const DERIVED_REF_TARGET = {
  snapshotRef: ["d2p:geometry-snapshot"],
  evaluationRef: ["d2p:pattern-evaluation"],
  reportRefs: ["d2p:validation-report"],
  evidenceRefs: ["d2p:quality-evidence-bundle"],
  validationReportRef: ["d2p:validation-report"],
  meshResultRef: ["d2p:panel-mesh-result"],
  sceneInputRef: ["d2p:scene-input"],
  sceneSnapshotRef: ["d2p:scene-snapshot"],
  proposalRef: ["d2p:pattern-proposal"],
  inspectionRef: ["d2p:inspect-3d-edit-result"],
};

/**
 * Runs the referential level on a structurally valid bundle.
 *
 * @param {import("./bundle.mjs").BundleIndex} index
 * @param {{ root: string }} options
 * @returns {Promise<object[]>} diagnostics
 */
export async function checkReferential(index, { root }) {
  const out = [];
  const ctx = {
    index,
    root,
    report(code, message, unit, instancePath, extra = {}) {
      out.push(diagnostic(code, message, { documentPath: unit.path, instancePath, ...extra }));
    },
    elementKindsCache: new Map(),
  };
  checkIdentity(ctx);
  for (const unit of index.units) {
    const t = unit.value.documentType;
    checkDuplicateIds(ctx, unit);
    if (INFORMATIVE_TYPES.has(t)) continue;
    checkReferences(ctx, unit);
    checkInputDigests(ctx, unit);
    checkDefinitions(ctx, unit);
    checkDefinitionMeanings(ctx, unit);
    checkSizeKeys(ctx, unit);
    switch (t) {
      case "d2p:pattern":
        checkPatternInternal(ctx, unit);
        break;
      case "d2p:grading-rule-set":
        checkGrading(ctx, unit);
        break;
      case "d2p:revision":
        checkRevision(ctx, unit);
        break;
      case "d2p:evaluation-request":
        checkRequest(ctx, unit);
        break;
      case "d2p:pattern-evaluation":
        checkEvaluationInputs(ctx, unit);
        break;
      case "d2p:fit-evaluation-report":
        checkFitReportInputs(ctx, unit);
        break;
      case "d2p:geometry-snapshot":
        checkSnapshot(ctx, unit);
        break;
      case "d2p:export-scene-2d":
        checkScene(ctx, unit);
        break;
      case "d2p:print-job-spec":
        checkPrintJob(ctx, unit);
        break;
      case "d2p:validation-report":
        checkReport(ctx, unit);
        break;
      case "d2p:validation-profile":
        checkProfile(ctx, unit);
        break;
      case "d2p:gate-evaluation":
        checkGate(ctx, unit);
        break;
      case "d2p:waiver":
        checkWaiver(ctx, unit);
        break;
      case "d2p:command":
        checkCommand(ctx, unit);
        break;
      case "d2p:garment":
        checkGarmentReferences(ctx, unit);
        break;
      case "d2p:scene-input":
        checkSceneInputReferences(ctx, unit);
        break;
      case "d2p:scene-snapshot":
        checkSceneSnapshotReferences(ctx, unit);
        break;
      case "d2p:scene-expectation":
        checkSceneExpectationReferences(ctx, unit);
        break;
      case "d2p:panel-mesh-result":
        checkPanelMeshReferences(ctx, unit);
        break;
      case "d2p:pattern-proposal":
        checkProposalReferences(ctx, unit, resolveExprReferences);
        break;
      case "d2p:inspect-3d-edit-result":
        checkInspectionReferences(ctx, unit, resolveExprReferences);
        break;
      case "d2p:fixture-manifest":
        if (!unit.embedded && unit.role === "manifest") await checkManifest(ctx, unit);
        break;
      default:
        break;
    }
  }
  return out;
}

const at = (unit, ...tokens) => pointer(unit.base, ...tokens);

/** Walks a unit without entering its embedded documents (they are units of their own). */
function walkUnit(unit, visit) {
  const embedded = new Set(unit.embedded ? [] : embeddedDocuments(unit.value).map((e) => e.pointer));
  walkJson(unit.value, (node, ptr, key, parent) => {
    if (embedded.has(ptr)) return false;
    return visit(node, ptr, key, parent);
  }, unit.base);
}

// ---------------------------------------------------------------------------
// D2P-REF-005: identity keys and element ID uniqueness

function checkIdentity(ctx) {
  const groups = new Map();
  for (const u of ctx.index.units) {
    if (u.embedded) continue;
    const key = identityKey(u.value);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(u);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const first = canonicalize(list[0].value);
    for (const u of list.slice(1)) {
      if (canonicalize(u.value) !== first) {
        const ids = OWN_ID_MEMBERS[u.value.documentType].map((m) => u.value[m]).join(", ");
        ctx.report("D2P-REF-005", `another bundle document (${list[0].path}) has the same identity (${u.value.documentType}: ${ids}) but different content`, u, "");
      }
    }
  }
}

function checkDuplicateIds(ctx, unit) {
  const seen = new Map();
  walkUnit(unit, (node, ptr, key) => {
    if (key === "id" && typeof node === "string" && ELEMENT_ID_RE.test(node)) {
      if (seen.has(node)) ctx.report("D2P-REF-005", `element ID "${node}" is declared more than once in this document (first at ${seen.get(node)})`, unit, ptr);
      else seen.set(node, ptr);
    }
    return true;
  });
  const v = unit.value;
  const keyed = [];
  if (v.documentType === "d2p:pattern") {
    keyed.push(["measurement input key", (v.measurementInputs ?? []).map((m, i) => [m.key, at(unit, "measurementInputs", i, "key")])]);
    const inst = [];
    (v.pieces ?? []).forEach((p, pi) =>
      (p.cutInstruction?.instances ?? []).forEach((c, ci) => inst.push([c.cutInstanceKey, at(unit, "pieces", pi, "cutInstruction", "instances", ci, "cutInstanceKey")])),
    );
    keyed.push(["cutInstanceKey", inst]);
  }
  if (v.documentType === "d2p:size-system") {
    keyed.push(["sizeKey", (v.sizes ?? []).map((s, i) => [s.sizeKey, at(unit, "sizes", i, "sizeKey")])]);
    // One value per definition and size entry (catalog §1.4, §3.3): measurement input resolution must be unambiguous.
    (v.sizes ?? []).forEach((s, i) =>
      keyed.push([`definitionId of size entry "${s.sizeKey}"`, (s.measurements ?? []).map((m, j) => [m.definitionId, at(unit, "sizes", i, "measurements", j, "definitionId")])]),
    );
  }
  if (v.documentType === "d2p:body-measurement-profile") {
    keyed.push(["measurement definitionId", (v.measurements ?? []).map((m, j) => [m.definitionId, at(unit, "measurements", j, "definitionId")])]);
  }
  // One definition per definitionId within a registry (catalog §1.4, §3.3): a duplicate
  // with a different meaning would make every resolution ambiguous (MEA-001, MEA-002).
  if (v.documentType === "d2p:measurement-definition-registry") {
    keyed.push(["definitionId", (v.definitions ?? []).map((d, i) => [d.definitionId, at(unit, "definitions", i, "definitionId")])]);
  }
  // One entry per rule within a profile (catalog §3.5): finding severities are looked up by ruleId.
  if (v.documentType === "d2p:validation-profile") {
    keyed.push(["ruleId", (v.rules ?? []).map((r, i) => [r.ruleId, at(unit, "rules", i, "ruleId")])]);
  }
  // One entry per (d2pTerm, externalTerm) within a mapping profile (catalog §3.1).
  if (v.documentType === "d2p:mapping-profile") {
    keyed.push(["mapping entry", (v.entries ?? []).map((e, i) => [`${e.d2pTerm} -> ${e.externalTerm}`, at(unit, "entries", i)])]);
  }
  if (v.documentType === "d2p:fixture-manifest") {
    keyed.push(["configurationKey", (v.configurations ?? []).map((c, i) => [c.configurationKey, at(unit, "configurations", i, "configurationKey")])]);
  }
  if (v.documentType === "d2p:pattern-evaluation") keyed.push(["measurement key", (v.measurements ?? []).map((m, i) => [m.key, at(unit, "measurements", i, "key")])]);
  for (const [kind, entries] of keyed) {
    const s = new Set();
    for (const [k, ptr] of entries) {
      if (s.has(k)) ctx.report("D2P-REF-005", `${kind} "${k}" is declared more than once in this document`, unit, ptr);
      s.add(k);
    }
  }
  checkVocabularyOrder(ctx, unit);
}

/** Vocabulary arrays that the catalog declares sorted, with their sort keys (D2P-REF-014). */
const SORTED_VOCABULARY_ARRAYS = Object.freeze({
  "d2p:measurement-definition-registry": ["definitions", ["definitionId"]],
  "d2p:validation-profile": ["rules", ["ruleId"]],
  "d2p:mapping-profile": ["entries", ["d2pTerm", "externalTerm"]],
});

/**
 * D2P-REF-014: `measurement-definition-registry.definitions` (by definitionId),
 * `validation-profile.rules` (by ruleId) and `mapping-profile.entries` (by
 * d2pTerm, externalTerm) are in ascending UTF-16 order. Equal neighbours are
 * duplicates and reported as D2P-REF-005 only.
 */
function checkVocabularyOrder(ctx, unit) {
  const spec = SORTED_VOCABULARY_ARRAYS[unit.value.documentType];
  if (!spec) return;
  const [member, keys] = spec;
  const list = Array.isArray(unit.value[member]) ? unit.value[member] : [];
  const compare = (a, b) => {
    for (const k of keys) {
      if (typeof a?.[k] !== "string" || typeof b?.[k] !== "string") return 0;
      if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
    }
    return 0;
  };
  for (let i = 1; i < list.length; i += 1) {
    if (compare(list[i - 1], list[i]) > 0) {
      const show = (x) => keys.map((k) => x?.[k]).join(" / ");
      ctx.report("D2P-REF-014", `${member} must be sorted by ${keys.join(", ")}: "${show(list[i])}" follows "${show(list[i - 1])}"`, unit, at(unit, member, i));
    }
  }
}

// ---------------------------------------------------------------------------
// Generic references: artifactRef, elementRef, derivedRef (§2.6 rows 1-3)

function checkReferences(ctx, unit) {
  walkUnit(unit, (node, ptr, key) => {
    if (typeof key !== "string") return true;
    if (key.endsWith("Ref") && isObject(node)) resolveRefObject(ctx, unit, node, ptr, key);
    if (key.endsWith("Refs") && Array.isArray(node)) node.forEach((item, i) => isObject(item) && resolveRefObject(ctx, unit, item, pointer(ptr, i), key));
    return true;
  });
  const v = unit.value;
  if (v.documentType === "d2p:relationship" && v.source?.kind === "artifact") {
    resolveArtifactRef(ctx, unit, { artifactId: v.source.id, revisionId: v.source.revisionId }, at(unit, "source"), "source");
  }
}

function resolveRefObject(ctx, unit, ref, ptr, key) {
  if ("elementId" in ref) resolveElementRef(ctx, unit, ref, ptr, key);
  else if ("artifactId" in ref) resolveArtifactRef(ctx, unit, ref, ptr, key);
  else if ("id" in ref) resolveDerivedRef(ctx, unit, ref, ptr, key);
}

function resolveArtifactRef(ctx, unit, ref, ptr, key) {
  const r = ctx.index.resolveArtifactRef(ref);
  if (r.state === "no-artifact") ctx.report("D2P-REF-001", `${key}: artifact ${ref.artifactId} is not in the bundle`, unit, ptr);
  else if (r.state === "no-revision") {
    ctx.report("D2P-REF-002", `${key}: revision ${ref.revisionId} of artifact ${ref.artifactId} is not in the bundle (no content document and no revision record)`, unit, ptr);
  }
  return r;
}

function resolveElementRef(ctx, unit, ref, ptr, key) {
  const content = ctx.index.content.get(refKey(ref));
  if (!content) {
    if (ctx.index.artifactIds.has(ref.artifactId)) {
      ctx.report("D2P-REF-002", `${key}: the content document of revision ${ref.revisionId} of artifact ${ref.artifactId} is not in the bundle`, unit, ptr);
    } else ctx.report("D2P-REF-001", `${key}: artifact ${ref.artifactId} is not in the bundle`, unit, ptr);
    return;
  }
  let kinds = ctx.elementKindsCache.get(content);
  if (!kinds) {
    kinds = contentElementKinds(content.value);
    ctx.elementKindsCache.set(content, kinds);
  }
  const kind = kinds.get(ref.elementId);
  if (!kind) ctx.report("D2P-REF-003", `${key}: element "${ref.elementId}" does not exist in ${ref.artifactId}@${ref.revisionId}`, unit, ptr, { elementRef: ref });
  else if (ref.elementType !== undefined && ref.elementType !== kind) {
    ctx.report("D2P-REF-004", `${key}: element "${ref.elementId}" is a ${kind}, not a ${ref.elementType}`, unit, ptr, { elementRef: ref });
  }
}

/** Digest a derivedRef must carry for a target document (§1.5 rule 5). */
export function derivedDigestOf(doc) {
  if (RESULT_DIGEST_TYPES.has(doc.documentType)) return resultDigestOf(doc, OWN_ID_MEMBERS[doc.documentType] ?? []);
  if (doc.documentType === "d2p:geometry-snapshot") return geometryDigestOf(doc);
  if (doc.documentType === "d2p:scene-snapshot") return sceneDigestOf(doc);
  return contentDigestOf(doc);
}

function resolveDerivedRef(ctx, unit, ref, ptr, key) {
  const candidates = ctx.index.derivedById.get(ref.id) ?? [];
  const wanted = DERIVED_REF_TARGET[key];
  const target = candidates.find((c) => !wanted || wanted.includes(c.value.documentType));
  if (!target) {
    ctx.report("D2P-REF-001", `${key}: no ${wanted ? wanted.join("/") : "derived document"} with ID ${ref.id} is in the bundle`, unit, ptr);
    return;
  }
  if (ref.digest !== undefined) {
    const expected = derivedDigestOf(target.value);
    if (expected !== ref.digest) ctx.report("D2P-REF-011", `${key}: digest ${ref.digest} differs from the recomputed digest ${expected} of ${ref.id}`, unit, pointer(ptr, "digest"));
  }
}

// ---------------------------------------------------------------------------
// inputDigests (§1.8, §2.6 row 4)

function checkInputDigests(ctx, unit) {
  const v = unit.value;
  if (!Array.isArray(v.inputDigests)) return;
  v.inputDigests.forEach((entry, i) => {
    const ptr = at(unit, "inputDigests", i);
    if (isObject(entry.artifactRef)) {
      const content = ctx.index.content.get(refKey(entry.artifactRef));
      const record = ctx.index.revisions.get(refKey(entry.artifactRef));
      const expected = content ? contentDigestOf(content.value) : record?.value.contentDigest;
      if (expected !== undefined && expected !== entry.digest) {
        ctx.report("D2P-REF-011", `inputDigests[${i}] (${entry.role}): digest differs from the content digest ${expected} of ${entry.artifactRef.artifactId}@${entry.artifactRef.revisionId}`, unit, pointer(ptr, "digest"));
      }
    } else if (isObject(entry.id)) {
      const type = {
        "measurement-definition-registry": "d2p:measurement-definition-registry",
        "tolerance-profile": "d2p:tolerance-profile",
        "validation-profile": "d2p:validation-profile",
        "mesh-profile": "d2p:mesh-profile",
      }[entry.role];
      if (!type) return;
      const target = ctx.index.vocabDoc(type, entry.id.id, entry.id.version);
      if (!target) {
        ctx.report("D2P-REF-001", `inputDigests[${i}]: no ${type} ${entry.id.id} ${entry.id.version} is in the bundle`, unit, pointer(ptr, "id"));
        return;
      }
      const expected = digestOf(target.value);
      if (expected !== entry.digest) ctx.report("D2P-REF-011", `inputDigests[${i}] (${entry.role}): digest differs from the recomputed digest ${expected}`, unit, pointer(ptr, "digest"));
    } else if (entry.role === "material-assumptions") {
      const request = v.documentType === "d2p:pattern-evaluation" ? v.request : undefined;
      if (isObject(request?.materialAssumptions)) {
        const expected = digestOf(request.materialAssumptions);
        if (expected !== entry.digest) ctx.report("D2P-REF-011", `inputDigests[${i}] (material-assumptions): digest differs from the request's materialAssumptions digest ${expected}`, unit, pointer(ptr, "digest"));
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Measurement definitions (D2P-REF-008)

function checkDefinitions(ctx, unit) {
  const v = unit.value;
  if (Array.isArray(v.definitionRegistries)) {
    v.definitionRegistries.forEach((r, i) => {
      if (!ctx.index.vocabDoc("d2p:measurement-definition-registry", r.id, r.version)) {
        ctx.report("D2P-REF-008", `measurement-definition registry ${r.id} ${r.version} is not in the bundle`, unit, at(unit, "definitionRegistries", i));
      }
    });
  }
  const sites = [];
  let owner = v;
  switch (v.documentType) {
    case "d2p:pattern":
      (v.measurementInputs ?? []).forEach((m, i) => sites.push([m.definitionId, at(unit, "measurementInputs", i, "definitionId")]));
      break;
    case "d2p:body-measurement-profile":
      (v.measurements ?? []).forEach((m, i) => sites.push([m.definitionId, at(unit, "measurements", i, "definitionId")]));
      break;
    case "d2p:size-system":
      (v.sizes ?? []).forEach((s, i) => (s.measurements ?? []).forEach((m, j) => sites.push([m.definitionId, at(unit, "sizes", i, "measurements", j, "definitionId")])));
      break;
    case "d2p:garment-measurement-spec":
      (v.targets ?? []).forEach((t, i) => sites.push([t.definitionId, at(unit, "targets", i, "definitionId")]));
      break;
    case "d2p:fit-profile":
      (v.easeRules ?? []).forEach((r, i) => {
        sites.push([r.bodyDefinitionId, at(unit, "easeRules", i, "bodyDefinitionId")]);
        sites.push([r.garmentDefinitionId, at(unit, "easeRules", i, "garmentDefinitionId")]);
      });
      (v.fitTargets ?? []).forEach((t, i) => sites.push([t.garmentDefinitionId, at(unit, "fitTargets", i, "garmentDefinitionId")]));
      break;
    case "d2p:pattern-evaluation":
      owner = ctx.index.contentOf(v.request?.patternRef);
      (v.measurements ?? []).forEach((m, i) => m.definitionId !== undefined && sites.push([m.definitionId, at(unit, "measurements", i, "definitionId")]));
      break;
    default:
      return;
  }
  if (!owner || !ctx.index.registriesPresent(owner)) return;
  const defs = ctx.index.definitionsOf(owner);
  for (const [id, ptr] of sites) {
    if (!defs.has(id)) ctx.report("D2P-REF-008", `measurement definition ${id} is not defined by the declared registries`, unit, ptr);
  }
}

/** Request members whose documents declare definitionRegistries (catalog §3.3, §3.4). */
const DEFINITION_OWNER_MEMBERS = ["patternRef", "sizeSystemRef", "bodyMeasurementProfileRef", "fitProfileRef", "garmentMeasurementSpecRef"];

/**
 * D2P-REF-015 (design decision ADR-011 §2: a definition is the unique kind of
 * a measurement): within one resolution context, a definitionId has one
 * meaning. A resolution context is the definitionRegistries of one document,
 * and the union of the registries of the documents an evaluation request pins.
 * Two different registries of a context that define the same definitionId
 * with different d2p-c14n-v1 canonical forms make resolution depend on
 * registry order. Identical definitions are allowed. Duplicates inside one
 * registry are D2P-REF-005; a registry that is not in the bundle is D2P-REF-008.
 */
function checkDefinitionMeanings(ctx, unit) {
  const v = unit.value;
  const registryOf = (r) => ctx.index.vocabDoc("d2p:measurement-definition-registry", r?.id, r?.version)?.value;
  // sources: [{ owner, ptr, registries: [{ key, reg }] }]
  const conflicts = (sources, report) => {
    const seen = new Map(); // definitionId -> { canon, owner, key }
    const reported = new Set();
    for (const src of sources) {
      for (const { key, reg, ptr } of src.registries) {
        for (const d of reg.definitions ?? []) {
          if (typeof d?.definitionId !== "string") continue;
          const canon = canonicalize(d);
          const first = seen.get(d.definitionId);
          if (!first) seen.set(d.definitionId, { canon, owner: src.owner, key });
          else if (first.key !== key && first.canon !== canon && !reported.has(`${d.definitionId}|${key}`)) {
            if (report(d.definitionId, first, key, src, ptr) !== false) reported.add(`${d.definitionId}|${key}`);
          }
        }
      }
    }
  };
  if (Array.isArray(v.definitionRegistries)) {
    const registries = [];
    v.definitionRegistries.forEach((r, i) => {
      const reg = registryOf(r);
      if (reg) registries.push({ key: `${r.id}@${r.version}`, reg, ptr: at(unit, "definitionRegistries", i) });
    });
    conflicts([{ owner: unit, registries }], (id, first, key, _src, ptr) =>
      ctx.report("D2P-REF-015", `measurement definition ${id} has different meanings in the declared registries ${first.key} and ${key}`, unit, ptr),
    );
  }
  if (v.documentType !== "d2p:evaluation-request") return;
  const sources = [];
  for (const member of DEFINITION_OWNER_MEMBERS) {
    const doc = ctx.index.contentOf(v[member]);
    if (!doc || !Array.isArray(doc.definitionRegistries)) continue;
    const registries = [];
    for (const r of doc.definitionRegistries) {
      const reg = registryOf(r);
      if (reg) registries.push({ key: `${r.id}@${r.version}`, reg, ptr: at(unit, member) });
    }
    sources.push({ owner: member, registries });
  }
  conflicts(sources, (id, first, key, src, ptr) => {
    if (first.owner === src.owner) return false; // reported on the pinned document itself
    ctx.report("D2P-REF-015", `measurement definition ${id} has different meanings in registry ${first.key} (via ${first.owner}) and ${key} (via ${src.owner}), both used by this request`, unit, ptr);
  });
}

// ---------------------------------------------------------------------------
// Size keys (D2P-REF-009) and configuration keys (D2P-REF-013, D2P-REF-007)

function sizeKeysOf(ctx, sizeSystemRef) {
  const ss = ctx.index.contentOf(sizeSystemRef);
  return ss ? new Set((ss.sizes ?? []).map((s) => s.sizeKey)) : null;
}

function checkSizeKeys(ctx, unit) {
  const v = unit.value;
  const uses = [];
  if (v.documentType === "d2p:evaluation-request" && v.sizeKey !== undefined) uses.push([v.sizeKey, at(unit, "sizeKey")]);
  if (v.documentType === "d2p:garment-measurement-spec") {
    (v.targets ?? []).forEach((t, i) => t.sizeKey !== undefined && uses.push([t.sizeKey, at(unit, "targets", i, "sizeKey")]));
  }
  if (v.documentType === "d2p:fit-profile") {
    for (const member of ["easeRules", "fitTargets"]) {
      (v[member] ?? []).forEach((r, i) => (r.scope?.sizeKeys ?? []).forEach((k, j) => uses.push([k, at(unit, member, i, "scope", "sizeKeys", j)])));
    }
  }
  if (!uses.length) return;
  if (!isObject(v.sizeSystemRef)) {
    for (const [k, ptr] of uses) ctx.report("D2P-REF-009", `sizeKey "${k}" is used but the document has no sizeSystemRef to resolve it`, unit, ptr);
    return;
  }
  const keys = sizeKeysOf(ctx, v.sizeSystemRef);
  if (!keys) return; // unresolved size system is reported by the reference check
  for (const [k, ptr] of uses) if (!keys.has(k)) ctx.report("D2P-REF-009", `sizeKey "${k}" is not defined in size system ${v.sizeSystemRef.artifactId}@${v.sizeSystemRef.revisionId}`, unit, ptr);
}

function checkRequest(ctx, unit) {
  const v = unit.value;
  // Pinned inputs must agree with the request's pattern.
  for (const member of ["gradingRuleSetRef", "garmentMeasurementSpecRef"]) {
    const doc = ctx.index.contentOf(v[member]);
    if (doc && isObject(doc.patternRef) && refKey(doc.patternRef) !== refKey(v.patternRef)) {
      ctx.report("D2P-REF-007", `${member} pins a document whose patternRef (${refKey(doc.patternRef)}) differs from the request's patternRef (${refKey(v.patternRef)})`, unit, at(unit, member));
    }
  }
  if (v.configurationKey === undefined) return;
  for (const m of ctx.index.manifests) {
    const configs = m.value.configurations;
    if (!Array.isArray(configs)) continue;
    const decl = configs.find((c) => c.configurationKey === v.configurationKey);
    if (!decl) {
      ctx.report("D2P-REF-013", `configurationKey "${v.configurationKey}" is not declared by fixture manifest ${m.path}`, unit, at(unit, "configurationKey"));
      continue;
    }
    const sameFit = isObject(v.fitProfileRef) && refKey(v.fitProfileRef) === refKey(decl.fitProfileRef);
    const sameMaterial = v.materialAssumptions !== undefined && canonicalize(v.materialAssumptions) === canonicalize(decl.materialAssumptions);
    if (!sameFit || !sameMaterial) {
      ctx.report("D2P-REF-007", `configuration "${v.configurationKey}" declares ${!sameFit ? "a different fitProfileRef" : "different materialAssumptions"} than this request uses (manifest ${m.path})`, unit, at(unit, !sameFit ? "fitProfileRef" : "materialAssumptions"));
    }
  }
}

/** Request member pinning the artifact of each artifact input role (catalog §1.8, §3.4). */
export const REQUEST_MEMBER_OF_ROLE = Object.freeze({
  pattern: "patternRef",
  "grading-rule-set": "gradingRuleSetRef",
  "size-system": "sizeSystemRef",
  "body-measurement-profile": "bodyMeasurementProfileRef",
  "fit-profile": "fitProfileRef",
  "garment-measurement-spec": "garmentMeasurementSpecRef",
});

/**
 * D2P-REF-007: the artifact inputDigests of an evaluation are exactly the
 * artifact revisions its embedded request pins: one entry per pinned
 * reference, with the matching role and the same (artifactId, revisionId),
 * and no other artifact entry (catalog §3.4).
 */
function checkEvaluationInputs(ctx, unit) {
  const v = unit.value;
  const request = isObject(v.request) ? v.request : {};
  const digests = Array.isArray(v.inputDigests) ? v.inputDigests : [];
  for (const [role, member] of Object.entries(REQUEST_MEMBER_OF_ROLE)) {
    const pinned = request[member];
    const entries = digests.map((d, i) => [d, i]).filter(([d]) => d.role === role);
    if (!isObject(pinned)) {
      for (const [, i] of entries) {
        ctx.report("D2P-REF-007", `inputDigests[${i}] has role ${role}, but the embedded request pins no ${member}`, unit, at(unit, "inputDigests", i));
      }
      continue;
    }
    if (entries.length === 0) {
      ctx.report("D2P-REF-007", `the embedded request pins ${member} ${refKey(pinned)}, but inputDigests has no entry with role ${role}`, unit, at(unit, "inputDigests"));
      continue;
    }
    entries.forEach(([d, i], n) => {
      if (n > 0) ctx.report("D2P-REF-007", `inputDigests has more than one entry with role ${role}`, unit, at(unit, "inputDigests", i));
      else if (!isObject(d.artifactRef) || refKey(d.artifactRef) !== refKey(pinned)) {
        ctx.report("D2P-REF-007", `inputDigests[${i}] (${role}) names ${isObject(d.artifactRef) ? refKey(d.artifactRef) : "no artifact"}, but the embedded request pins ${member} ${refKey(pinned)}`, unit, at(unit, "inputDigests", i, "artifactRef"));
      }
    });
  }
}

/**
 * D2P-REF-007: a fit evaluation report is about the pinned configuration of
 * its evaluation (catalog §3.3, FIT-003). Every artifact input digest of the
 * report names the same (role, artifactId, revisionId) as an input digest of
 * the evaluation named by `evaluationRef`; the report never pins another
 * revision than the evaluation used.
 */
function checkFitReportInputs(ctx, unit) {
  const v = unit.value;
  const evaluation = isObject(v.evaluationRef) ? ctx.index.derivedDoc("d2p:pattern-evaluation", v.evaluationRef.id)?.value : undefined;
  if (!evaluation) return; // unresolved: reported by the generic derivedRef check
  const pinned = new Set(
    (Array.isArray(evaluation.inputDigests) ? evaluation.inputDigests : [])
      .filter((d) => isObject(d.artifactRef))
      .map((d) => `${d.role}|${refKey(d.artifactRef)}`),
  );
  (Array.isArray(v.inputDigests) ? v.inputDigests : []).forEach((d, i) => {
    if (!isObject(d.artifactRef)) return;
    if (!pinned.has(`${d.role}|${refKey(d.artifactRef)}`)) {
      ctx.report(
        "D2P-REF-007",
        `inputDigests[${i}] (${d.role}) names ${refKey(d.artifactRef)}, which evaluation ${evaluation.evaluationId} does not pin with that role`,
        unit,
        at(unit, "inputDigests", i, "artifactRef"),
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Pattern-internal plain element references (D2P-REF-003, -004, -010)

function checkPatternInternal(ctx, unit) {
  const idx = indexPattern(unit.value, unit.base);
  const report = (code, msg, ptr) => ctx.report(code, msg, unit, ptr);
  const featureRef = (id, required, ptr, what) => {
    const f = idx.features.get(id)?.feature;
    if (!f) {
      report("D2P-REF-003", `${what}: feature "${id}" does not exist`, ptr);
      return;
    }
    if (required && !satisfiesKind(idx, f, required)) report("D2P-REF-004", `${what}: feature "${id}" (${f.type}) is not a ${required}`, ptr);
  };
  const exprRefs = (node, ptr) => resolveExprReferences(idx, node, ptr, report);

  for (const { feature, ptr } of idx.features.values()) {
    const params = isObject(feature.params) ? feature.params : {};
    const kinds = PARAM_REFERENCE_KINDS[feature.type];
    if (kinds) {
      for (const [member, required] of Object.entries(kinds)) {
        if (typeof params[member] === "string") featureRef(params[member], required, pointer(ptr, "params", member), `${feature.id}.${member}`);
      }
    } else if (isExtensionName(feature.type)) {
      for (const [member, value] of Object.entries(params)) {
        if (member.endsWith("FeatureId") && typeof value === "string") featureRef(value, null, pointer(ptr, "params", member), `${feature.id}.${member}`);
        if (member.endsWith("FeatureIds") && Array.isArray(value)) {
          value.forEach((id, i) => typeof id === "string" && featureRef(id, null, pointer(ptr, "params", member, i), `${feature.id}.${member}`));
        }
      }
    }
    (feature.dependsOn ?? []).forEach((id, i) => {
      if (!idx.features.has(id) && !idx.parameters.has(id)) report("D2P-REF-003", `${feature.id}.dependsOn: "${id}" is neither a feature nor a parameter`, pointer(ptr, "dependsOn", i));
    });
    walkJson(params, (node, p, key) => {
      if (key === "expr") {
        exprRefs(node, p);
        return false;
      }
      return true;
    }, pointer(ptr, "params"), OPAQUE_MEMBERS);
  }
  for (const { parameter, ptr } of idx.parameters.values()) exprRefs(parameter.expr, pointer(ptr, "expr"));

  for (const { piece, ptr: pptr } of idx.pieces.values()) {
    const ownEdges = new Set();
    (piece.contours ?? []).forEach((c) => (c.edges ?? []).forEach((e) => ownEdges.add(e.id)));
    (piece.contours ?? []).forEach((c, ci) =>
      (c.edges ?? []).forEach((e, ei) => featureRef(e.curveFeatureId, "curve", pointer(pptr, "contours", ci, "edges", ei, "curveFeatureId"), `edge ${e.id}`)),
    );
    const edgeOfPiece = (edgeId, ptr, what) => {
      if (!ownEdges.has(edgeId)) report("D2P-REF-003", `${what}: edge "${edgeId}" is not an edge of piece "${piece.id}"`, ptr);
    };
    (piece.notches ?? []).forEach((n, i) => edgeOfPiece(n.edgeId, pointer(pptr, "notches", i, "edgeId"), `notch ${n.id}`));
    (piece.folds ?? []).forEach((f, i) => edgeOfPiece(f.edgeId, pointer(pptr, "folds", i, "edgeId"), `fold ${f.id}`));
    (piece.grainlines ?? []).forEach((g, i) => {
      featureRef(g.startFeatureId, "point", pointer(pptr, "grainlines", i, "startFeatureId"), `grainline ${g.id}`);
      featureRef(g.endFeatureId, "point", pointer(pptr, "grainlines", i, "endFeatureId"), `grainline ${g.id}`);
    });
    if (isObject(piece.seamAllowance)) {
      exprRefs(piece.seamAllowance.default?.expr, pointer(pptr, "seamAllowance", "default", "expr"));
      (piece.seamAllowance.edges ?? []).forEach((e, i) => {
        edgeOfPiece(e.edgeId, pointer(pptr, "seamAllowance", "edges", i, "edgeId"), "seam allowance");
        exprRefs(e.expr, pointer(pptr, "seamAllowance", "edges", i, "expr"));
      });
    }
  }
  for (const { iface, ptr } of idx.interfaces.values()) {
    (iface.segments ?? []).forEach((s, i) => {
      if (!idx.edges.has(s.edgeId)) report("D2P-REF-003", `seam interface ${iface.id}: edge "${s.edgeId}" does not exist`, pointer(ptr, "segments", i, "edgeId"));
    });
    if (iface.cutInstanceKey !== undefined && !idx.cutInstances.has(iface.cutInstanceKey)) {
      report("D2P-REF-010", `seam interface ${iface.id}: cutInstanceKey "${iface.cutInstanceKey}" is not declared by the pattern's cut instructions`, pointer(ptr, "cutInstanceKey"));
    }
  }
  for (const { conn, ptr } of idx.connections.values()) {
    (conn.interfaceIds ?? []).forEach((id, i) => {
      if (!idx.interfaces.has(id)) report("D2P-REF-003", `seam connection ${conn.id}: seam interface "${id}" does not exist`, pointer(ptr, "interfaceIds", i));
    });
    if (conn.ease?.amount) exprRefs(conn.ease.amount.expr, pointer(ptr, "ease", "amount", "expr"));
    (conn.matchPoints ?? []).forEach((m, i) => {
      for (const member of ["notchIdA", "notchIdB"]) {
        if (!idx.notches.has(m[member])) report("D2P-REF-003", `seam connection ${conn.id}: notch "${m[member]}" does not exist`, pointer(ptr, "matchPoints", i, member));
      }
    });
  }
  for (const { group, ptr } of idx.groups.values()) {
    (group.members ?? []).forEach((m, i) => {
      if (!idx.connections.has(m.connectionId)) report("D2P-REF-003", `sewing group ${group.id}: seam connection "${m.connectionId}" does not exist`, pointer(ptr, "members", i, "connectionId"));
    });
    (group.alignmentAnchors ?? []).forEach((id, i) => {
      if (!idx.notches.has(id)) report("D2P-REF-003", `sewing group ${group.id}: alignment anchor notch "${id}" does not exist`, pointer(ptr, "alignmentAnchors", i));
    });
    (group.layerOrder ?? []).forEach((l, i) => {
      if (!idx.cutInstances.has(l.cutInstanceKey)) {
        report("D2P-REF-010", `sewing group ${group.id}: cutInstanceKey "${l.cutInstanceKey}" is not declared by the pattern's cut instructions`, pointer(ptr, "layerOrder", i, "cutInstanceKey"));
      }
    });
  }
}

/** Resolves param, measurement and featureOutput references inside one expression. */
export function resolveExprReferences(idx, node, ptr, report) {
  walkExpr(node, ptr, (n, p) => {
    if (n.op === "param" && !idx.parameters.has(n.parameterId)) report("D2P-REF-003", `parameter "${n.parameterId}" does not exist`, p);
    if (n.op === "measurement" && !idx.inputs.has(n.key)) report("D2P-REF-003", `measurement input "${n.key}" does not exist`, p);
    if (n.op === "featureOutput") {
      const f = idx.features.get(n.featureId)?.feature;
      if (!f) report("D2P-REF-003", `feature "${n.featureId}" does not exist`, p);
      else {
        const outputs = featureOutputs(idx, f);
        if (outputs && !(n.output in outputs)) report("D2P-REF-004", `feature "${n.featureId}" (${f.type}) has no output "${n.output}"`, p);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Grading rule sets (§2.6)

function checkGrading(ctx, unit) {
  const v = unit.value;
  const pattern = ctx.index.contentOf(v.patternRef);
  const keys = isObject(v.sizeSystemRef) ? sizeKeysOf(ctx, v.sizeSystemRef) : null;
  const sizeKey = (k, ptr) => {
    if (keys && !keys.has(k)) ctx.report("D2P-REF-009", `sizeKey "${k}" is not defined in size system ${refKey(v.sizeSystemRef)}`, unit, ptr);
  };
  if (v.baseSizeKey !== undefined) sizeKey(v.baseSizeKey, at(unit, "baseSizeKey"));
  const idx = pattern ? indexPattern(pattern) : null;
  const report = (code, msg, ptr) => ctx.report(code, msg, unit, ptr);
  (v.rules ?? []).forEach((rule, i) => {
    const rp = at(unit, "rules", i);
    if (rule.kind === "measurement-source" && idx && !idx.inputs.has(rule.measurementKey)) {
      report("D2P-REF-003", `rule ${rule.id}: measurement input "${rule.measurementKey}" does not exist in the graded pattern`, pointer(rp, "measurementKey"));
    }
    if (rule.kind === "parameter-override") {
      if (idx && !idx.parameters.has(rule.parameterId)) report("D2P-REF-003", `rule ${rule.id}: parameter "${rule.parameterId}" does not exist in the graded pattern`, pointer(rp, "parameterId"));
      (rule.bySize ?? []).forEach((s, j) => {
        sizeKey(s.sizeKey, pointer(rp, "bySize", j, "sizeKey"));
        if (idx) resolveExprReferences(idx, s.expr, pointer(rp, "bySize", j, "expr"), report);
      });
    }
    if (rule.kind === "point-increment") {
      if (idx) {
        const f = idx.features.get(rule.pointFeatureId)?.feature;
        if (!f) report("D2P-REF-003", `rule ${rule.id}: feature "${rule.pointFeatureId}" does not exist in the graded pattern`, pointer(rp, "pointFeatureId"));
        else if (!satisfiesKind(idx, f, "point")) report("D2P-REF-004", `rule ${rule.id}: feature "${rule.pointFeatureId}" (${f.type}) is not a point`, pointer(rp, "pointFeatureId"));
      }
      (rule.increments ?? []).forEach((inc, j) => sizeKey(inc.sizeKey, pointer(rp, "increments", j, "sizeKey")));
    }
  });
}

// ---------------------------------------------------------------------------
// Revision records: digest integrity and sequence (D2P-REF-011, D2P-REF-007)

function checkRevision(ctx, unit) {
  const v = unit.value;
  const content = ctx.index.content.get(refKey(v));
  if (content) {
    const expected = contentDigestOf(content.value);
    if (expected !== v.contentDigest) ctx.report("D2P-REF-011", `contentDigest differs from the recomputed digest ${expected} of the content document ${content.path}`, unit, at(unit, "contentDigest"));
  }
  const parents = v.parentRevisionIds ?? [];
  if (parents.length === 0) {
    if (v.sequence !== 1) ctx.report("D2P-REF-007", `a revision without parents must have sequence 1, got ${v.sequence}`, unit, at(unit, "sequence"));
    return;
  }
  if (v.sequence === 1) {
    ctx.report("D2P-REF-007", "a revision with parents cannot have sequence 1", unit, at(unit, "sequence"));
    return;
  }
  const records = parents.map((p) => ctx.index.revisionById.get(p)?.value);
  if (records.every(Boolean)) {
    const expected = Math.max(...records.map((r) => r.sequence)) + 1;
    if (v.sequence !== expected) ctx.report("D2P-REF-007", `sequence must be max(parent sequence) + 1 = ${expected}, got ${v.sequence}`, unit, at(unit, "sequence"));
  }
}

// ---------------------------------------------------------------------------
// Snapshots and scenes

function checkSnapshot(ctx, unit) {
  const v = unit.value;
  for (const evalUnit of ctx.index.units) {
    const e = evalUnit.value;
    if (e.documentType !== "d2p:pattern-evaluation" || e.snapshotRef?.id !== v.snapshotId) continue;
    if (isObject(e.request?.patternRef) && refKey(e.request.patternRef) !== refKey(v.patternRef)) {
      ctx.report("D2P-REF-007", `patternRef differs from the patternRef of the request of evaluation ${e.evaluationId}`, unit, at(unit, "patternRef"));
    }
  }
  // The pattern input digest names the snapshot's own pattern revision (D2P-REF-007).
  const digests = Array.isArray(v.inputDigests) ? v.inputDigests : [];
  digests.forEach((d, i) => {
    if (d.role === "pattern" && isObject(d.artifactRef) && isObject(v.patternRef) && refKey(d.artifactRef) !== refKey(v.patternRef)) {
      ctx.report("D2P-REF-007", `inputDigests[${i}] (pattern) names ${refKey(d.artifactRef)}, but the snapshot's patternRef is ${refKey(v.patternRef)}`, unit, at(unit, "inputDigests", i, "artifactRef"));
    }
  });
  // A snapshot sizeKey resolves in the size system of its size-system input digest (D2P-REF-009).
  if (v.sizeKey !== undefined) {
    const sizeSystems = digests.filter((d) => d.role === "size-system" && isObject(d.artifactRef));
    if (sizeSystems.length === 0) {
      ctx.report("D2P-REF-009", `sizeKey "${v.sizeKey}" is used but inputDigests names no size system to resolve it`, unit, at(unit, "sizeKey"));
    } else {
      for (const d of sizeSystems) {
        const keys = sizeKeysOf(ctx, d.artifactRef);
        if (keys && !keys.has(v.sizeKey)) ctx.report("D2P-REF-009", `sizeKey "${v.sizeKey}" is not defined in size system ${refKey(d.artifactRef)}`, unit, at(unit, "sizeKey"));
      }
    }
  }
  const pattern = ctx.index.contentOf(v.patternRef);
  if (!pattern) return;
  const idx = indexPattern(pattern);
  const need = (map, id, what, ptr) => {
    if (!map.has(id)) ctx.report("D2P-REF-003", `${what} "${id}" does not exist in pattern ${refKey(v.patternRef)}`, unit, ptr);
  };
  (v.pieces ?? []).forEach((p, i) => {
    const pp = at(unit, "pieces", i);
    need(idx.pieces, p.pieceId, "piece", pointer(pp, "pieceId"));
    (p.contours ?? []).forEach((c, ci) => {
      need(idx.contours, c.contourId, "contour", pointer(pp, "contours", ci, "contourId"));
      (c.segments ?? []).forEach((s, si) => need(idx.edges, s.edgeId, "edge", pointer(pp, "contours", ci, "segments", si, "edgeId")));
    });
    (p.notches ?? []).forEach((n, ni) => {
      need(idx.notches, n.notchId, "notch", pointer(pp, "notches", ni, "notchId"));
      need(idx.edges, n.edgeId, "edge", pointer(pp, "notches", ni, "edgeId"));
    });
    (p.grainlines ?? []).forEach((g, gi) => need(idx.grainlines, g.grainlineId, "grainline", pointer(pp, "grainlines", gi, "grainlineId")));
    (p.folds ?? []).forEach((f, fi) => {
      need(idx.folds, f.foldId, "fold", pointer(pp, "folds", fi, "foldId"));
      need(idx.edges, f.edgeId, "edge", pointer(pp, "folds", fi, "edgeId"));
    });
  });
  (v.interfaces ?? []).forEach((s, i) => {
    need(idx.interfaces, s.seamInterfaceId, "seam interface", at(unit, "interfaces", i, "seamInterfaceId"));
    if (s.cutInstanceKey !== undefined && !idx.cutInstances.has(s.cutInstanceKey)) {
      ctx.report("D2P-REF-010", `cutInstanceKey "${s.cutInstanceKey}" is not declared by the pattern's cut instructions`, unit, at(unit, "interfaces", i, "cutInstanceKey"));
    }
  });
  (v.seams ?? []).forEach((s, i) => need(idx.connections, s.seamConnectionId, "seam connection", at(unit, "seams", i, "seamConnectionId")));
}

function checkScene(ctx, unit) {
  const v = unit.value;
  const source = v.source ?? {};
  const evaluations = source.evaluations ?? [];
  const sizeSystems = new Map();
  evaluations.forEach((se, i) => {
    const ep = at(unit, "source", "evaluations", i);
    const evalUnit = ctx.index.derivedDoc("d2p:pattern-evaluation", se.evaluationId);
    if (!evalUnit) {
      ctx.report("D2P-REF-001", `evaluation ${se.evaluationId} is not in the bundle`, unit, pointer(ep, "evaluationId"));
      return;
    }
    const e = evalUnit.value;
    if (isObject(e.request?.patternRef) && refKey(e.request.patternRef) !== refKey(source.patternRef)) {
      ctx.report("D2P-REF-007", `source.patternRef differs from the patternRef of evaluation ${se.evaluationId}`, unit, at(unit, "source", "patternRef"));
    }
    const snapshot = e.snapshotRef ? ctx.index.derivedDoc("d2p:geometry-snapshot", e.snapshotRef.id)?.value : undefined;
    const snapshotDigest = snapshot?.geometryDigest ?? e.snapshotRef?.digest;
    if (snapshotDigest !== undefined && snapshotDigest !== se.geometryDigest) {
      ctx.report("D2P-REF-007", `geometryDigest differs from the geometryDigest of the snapshot of evaluation ${se.evaluationId}`, unit, pointer(ep, "geometryDigest"));
    }
    if (isObject(e.request?.sizeSystemRef)) {
      const k = refKey(e.request.sizeSystemRef);
      const prev = sizeSystems.get(se.sizeKey);
      if (prev && prev !== k) ctx.report("D2P-REF-007", `sizeKey "${se.sizeKey}" is used with two different size systems`, unit, pointer(ep, "sizeKey"));
      sizeSystems.set(se.sizeKey, k);
    }
  });
  const sizeKeys = new Set(evaluations.map((e) => e.sizeKey));
  const pattern = ctx.index.contentOf(source.patternRef);
  const idx = pattern ? indexPattern(pattern) : null;
  (v.pieceInstances ?? []).forEach((pi, i) => {
    const pp = at(unit, "pieceInstances", i);
    if (!sizeKeys.has(pi.sizeKey)) ctx.report("D2P-REF-007", `piece instance ${pi.id}: sizeKey "${pi.sizeKey}" is not in source.evaluations`, unit, pointer(pp, "sizeKey"));
    if (!idx) return;
    if (!idx.pieces.has(pi.pieceId)) ctx.report("D2P-REF-003", `piece "${pi.pieceId}" does not exist in the source pattern`, unit, pointer(pp, "pieceId"));
    if (!idx.cutInstances.has(pi.cutInstanceKey)) ctx.report("D2P-REF-010", `cutInstanceKey "${pi.cutInstanceKey}" is not declared by the pattern's cut instructions`, unit, pointer(pp, "cutInstanceKey"));
    for (const member of ["paths", "markers"]) {
      (pi[member] ?? []).forEach((x, j) => {
        if (x.elementId !== undefined && !idx.elementKinds.has(x.elementId)) {
          ctx.report("D2P-REF-003", `element "${x.elementId}" does not exist in the source pattern`, unit, pointer(pp, member, j, "elementId"));
        }
      });
    }
  });
}

function checkPrintJob(ctx, unit) {
  const v = unit.value;
  if (isObject(v.scene) && typeof v.provenance?.sceneDigest === "string") {
    const expected = resultDigestOf(v.scene, OWN_ID_MEMBERS["d2p:export-scene-2d"]);
    if (expected !== v.provenance.sceneDigest) ctx.report("D2P-REF-011", `provenance.sceneDigest differs from the recomputed resultDigest ${expected} of the embedded scene`, unit, at(unit, "provenance", "sceneDigest"));
  }
}

// ---------------------------------------------------------------------------
// Validation documents

function checkProfileRef(ctx, unit) {
  const p = unit.value.profile;
  if (isObject(p) && !ctx.index.vocabDoc("d2p:validation-profile", p.id, p.version)) {
    ctx.report("D2P-REF-001", `validation profile ${p.id} ${p.version} is not in the bundle`, unit, at(unit, "profile"));
  }
}

function checkReport(ctx, unit) {
  const v = unit.value;
  checkProfileRef(ctx, unit);
  const targets = new Set((v.targetRefs ?? []).map(refKey));
  const subjects = new Set((v.derivedSubjectRefs ?? []).map((r) => r.id));
  (v.findings ?? []).forEach((f, i) => {
    (f.elementRefs ?? []).forEach((r, j) => {
      if (!targets.has(refKey(r))) ctx.report("D2P-REF-007", `finding ${f.findingId}: elementRef points outside the report's targetRefs`, unit, at(unit, "findings", i, "elementRefs", j));
    });
    if (isObject(f.subjectRef) && !subjects.has(f.subjectRef.id)) {
      ctx.report("D2P-REF-007", `finding ${f.findingId}: subjectRef ${f.subjectRef.id} is not one of the report's derivedSubjectRefs`, unit, at(unit, "findings", i, "subjectRef"));
    }
  });
}

function checkProfile(ctx, unit) {
  (unit.value.rules ?? []).forEach((r, i) => {
    if (!ctx.index.vocabDoc("d2p:validation-rule-definition", r.ruleId, r.ruleVersion)) {
      ctx.report("D2P-REF-001", `validation rule ${r.ruleId} ${r.ruleVersion} is not in the bundle`, unit, at(unit, "rules", i));
    }
  });
}

function checkGate(ctx, unit) {
  const v = unit.value;
  checkProfileRef(ctx, unit);
  (v.waiverIds ?? []).forEach((id, i) => {
    const w = ctx.index.derivedDoc("d2p:waiver", id);
    if (!w) ctx.report("D2P-REF-001", `waiver ${id} is not in the bundle`, unit, at(unit, "waiverIds", i));
    else if (!sameRefSet(w.value.targetRefs, v.targetRefs)) {
      ctx.report("D2P-REF-006", `waiver ${id} targets other revisions than the gate`, unit, at(unit, "waiverIds", i));
    }
  });
  (v.addressedFindings ?? []).forEach((a, i) => {
    if (!ctx.index.derivedDoc("d2p:validation-report", a.reportId)) ctx.report("D2P-REF-001", `validation report ${a.reportId} is not in the bundle`, unit, at(unit, "addressedFindings", i, "reportId"));
  });
  (v.reportRefs ?? []).forEach((r, i) => {
    const report = ctx.index.derivedDoc("d2p:validation-report", r.id);
    if (report && !sameRefSet(report.value.targetRefs, v.targetRefs)) {
      ctx.report("D2P-REF-006", `validation report ${r.id} targets other revisions than the gate (stale report)`, unit, at(unit, "reportRefs", i));
    }
  });
  (v.evidenceRefs ?? []).forEach((r, i) => {
    const bundle = ctx.index.derivedDoc("d2p:quality-evidence-bundle", r.id)?.value;
    if (!bundle) return; // unresolved: reported by the generic derivedRef check
    const ptr = at(unit, "evidenceRefs", i);
    if (bundle.gate?.id !== v.profile?.id || bundle.gate?.version !== v.profile?.version) {
      ctx.report("D2P-REF-007", `evidence bundle ${r.id} is collected for gate ${bundle.gate?.id}@${bundle.gate?.version}, the gate applies profile ${v.profile?.id}@${v.profile?.version}`, unit, ptr);
    }
    if (!sameRefSet(bundle.subjectRefs, v.targetRefs)) {
      ctx.report("D2P-REF-007", `evidence bundle ${r.id} is about other revisions than the gate's targetRefs`, unit, ptr);
    }
  });
  (v.targetRefs ?? []).forEach((t, i) => {
    for (const child of ctx.index.children.get(t.revisionId) ?? []) {
      if (child.value.artifactId === t.artifactId && compareTimestamps(child.value.createdAt, v.evaluatedAt) <= 0) {
        ctx.report("D2P-REF-006", `target revision ${t.revisionId} was superseded by ${child.value.revisionId} before the gate was evaluated`, unit, at(unit, "targetRefs", i));
      }
    }
  });
}

function checkWaiver(ctx, unit) {
  const v = unit.value;
  if (!ctx.index.derivedDoc("d2p:validation-report", v.reportId)) ctx.report("D2P-REF-001", `validation report ${v.reportId} is not in the bundle`, unit, at(unit, "reportId"));
}

function checkCommand(ctx, unit) {
  const v = unit.value;
  if (v.type === "d2p:artifact.create" && isObject(v.payload?.content)) {
    const c = v.payload.content;
    if (c.artifactId !== v.target?.artifactId) {
      ctx.report("D2P-REF-007", `content artifactId ${c.artifactId} differs from target.artifactId ${v.target?.artifactId}`, unit, at(unit, "payload", "content", "artifactId"));
    }
    if (c.revisionId !== v.payload.initialRevisionId) {
      ctx.report("D2P-REF-007", `content revisionId ${c.revisionId} differs from payload.initialRevisionId ${v.payload.initialRevisionId}`, unit, at(unit, "payload", "content", "revisionId"));
    }
  }
  if (typeof v.expectedRevisionId === "string") {
    for (const child of ctx.index.children.get(v.expectedRevisionId) ?? []) {
      if (child.value.commandId !== v.commandId) {
        ctx.report("D2P-REF-006", `expectedRevisionId ${v.expectedRevisionId} already has the child revision ${child.value.revisionId}, which this command did not produce`, unit, at(unit, "expectedRevisionId"));
      }
    }
  }
}

/** Compares two UTC timestamps of the core/ids pattern (fractions up to 9 digits). */
export function compareTimestamps(a, b) {
  const norm = (t) => {
    const m = /^(.{19})(?:\.(\d{1,9}))?Z$/.exec(t ?? "");
    return m ? `${m[1]}.${(m[2] ?? "").padEnd(9, "0")}` : String(t);
  };
  const x = norm(a);
  const y = norm(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Manifest integrity (D2P-REF-011, D2P-REF-012)

async function fileDigest(root, relPath) {
  let bytes;
  try {
    bytes = await readFile(path.resolve(root, relPath));
  } catch {
    return null;
  }
  if (relPath.endsWith(".json")) {
    const parsed = parseStrictJsonBytes(bytes);
    if (parsed.ok) return digestOf(parsed.value);
  }
  return sha256(bytes);
}

async function checkManifest(ctx, unit) {
  const v = unit.value;
  const dir = path.posix.dirname(unit.path);
  const listed = new Set();
  const checkFile = async (relPath, digest, ptr, what) => {
    const actual = await fileDigest(ctx.root, relPath);
    if (actual === null) ctx.report("D2P-REF-012", `${what} ${relPath} is listed but does not exist`, unit, ptr);
    else if (actual !== digest) ctx.report("D2P-REF-011", `${what} ${relPath}: digest ${digest} differs from the recomputed digest ${actual}`, unit, pointer(ptr, "digest"));
  };
  for (const [i, f] of (v.files ?? []).entries()) {
    const p = path.posix.join(dir, f.path);
    listed.add(p);
    await checkFile(p, f.digest, at(unit, "files", i), "file");
  }
  for (const [i, f] of (v.externalFiles ?? []).entries()) await checkFile(f.path, f.digest, at(unit, "externalFiles", i), "external file");
  if (isObject(v.toleranceProfile)) await checkFile(v.toleranceProfile.path, v.toleranceProfile.digest, at(unit, "toleranceProfile"), "tolerance profile");
  for (const abs of await walk(path.resolve(ctx.root, dir))) {
    const p = rel(ctx.root, abs);
    // Only the manifest itself is excepted (catalog §2.4, D2P-REF-012).
    if (p === unit.path) continue;
    if (!listed.has(p)) ctx.report("D2P-REF-012", `file ${p} inside the fixture directory is not listed in the manifest`, unit, at(unit, "files"));
  }
  const expected = digestOf(v, ["fixtureDigest"]);
  if (expected !== v.fixtureDigest) ctx.report("D2P-REF-011", `fixtureDigest differs from the recomputed digest ${expected}`, unit, at(unit, "fixtureDigest"));
}
