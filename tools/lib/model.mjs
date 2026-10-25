// Document-level knowledge shared by the conformance levels (catalog §1.2, §3.0).
import { pointer } from "./json.mjs";

/** Artifact content document types (header: artifactId + revisionId). */
export const ARTIFACT_CONTENT_TYPES = new Set([
  "d2p:pattern",
  "d2p:grading-rule-set",
  "d2p:body-measurement-profile",
  "d2p:size-system",
  "d2p:garment-measurement-spec",
  "d2p:fit-profile",
  "d2p:garment",
]);

/** Own ID members per documentType ("Own ID" column of §3.0). */
export const OWN_ID_MEMBERS = Object.freeze({
  "d2p:project": ["projectId"],
  "d2p:product": ["productId"],
  "d2p:artifact": ["artifactId"],
  "d2p:revision": ["revisionId"],
  "d2p:relationship": ["relationshipId"],
  "d2p:mapping-profile": ["mappingId", "version"],
  "d2p:pattern": ["artifactId", "revisionId"],
  "d2p:grading-rule-set": ["artifactId", "revisionId"],
  "d2p:measurement-definition-registry": ["registryId", "version"],
  "d2p:body-measurement-profile": ["artifactId", "revisionId"],
  "d2p:size-system": ["artifactId", "revisionId"],
  "d2p:garment-measurement-spec": ["artifactId", "revisionId"],
  "d2p:fit-profile": ["artifactId", "revisionId"],
  "d2p:fit-evaluation-report": ["reportId"],
  "d2p:evaluation-request": ["requestId"],
  "d2p:pattern-evaluation": ["evaluationId"],
  "d2p:geometry-snapshot": ["snapshotId"],
  "d2p:validation-rule-definition": ["ruleId", "version"],
  "d2p:validation-profile": ["profileId", "version"],
  "d2p:validation-report": ["reportId"],
  "d2p:gate-evaluation": ["gateEvaluationId"],
  "d2p:waiver": ["waiverId"],
  "d2p:command": ["commandId"],
  "d2p:command-receipt": ["commandId"],
  "d2p:capabilities": [],
  "d2p:event": ["eventId"],
  "d2p:export-scene-2d": ["sceneId"],
  "d2p:print-job-spec": ["printJobId"],
  "d2p:test-run-report": ["reportId"],
  "d2p:benchmark-run": ["reportId"],
  "d2p:quality-evidence-bundle": ["bundleId"],
  "d2p:tolerance-profile": ["profileId", "version"],
  "d2p:fixture-manifest": ["fixtureId", "fixtureVersion"],
  "d2p:conformance-case": ["caseId"],
  "d2p:garment": ["artifactId", "revisionId"],
  "d2p:scene-input": ["sceneInputId"],
  "d2p:scene-snapshot": ["sceneSnapshotId"],
  "d2p:panel-mesh-result": ["meshResultId"],
  "d2p:mesh-profile": ["profileId", "version"],
  "d2p:sim-report": ["simReportId"],
  "d2p:pattern-proposal": ["proposalId"],
  "d2p:inspect-3d-edit-result": ["inspectionId"],
  "d2p:scene-expectation": ["expectationId"],
  "d2p:avatar-profile": ["profileId", "version"],
  "d2p:solver-profile": ["profileId", "version"],
  "d2p:material-physics-profile": ["profileId", "version"],
  "d2p:body-model-snapshot": ["bodyModelId"],
  "d2p:draped-panel-mesh": ["drapedMeshId"],
  "d2p:fit-map": ["fitMapId"],
  "d2p:body-model-expectation": ["expectationId"],
  "d2p:drape-expectation": ["expectationId"],
});

/** Documents that are targets of a derivedRef / a global own ID (single member). */
export const DERIVED_ID_MEMBER = Object.freeze({
  "d2p:pattern-evaluation": "evaluationId",
  "d2p:geometry-snapshot": "snapshotId",
  "d2p:fit-evaluation-report": "reportId",
  "d2p:validation-report": "reportId",
  "d2p:gate-evaluation": "gateEvaluationId",
  "d2p:export-scene-2d": "sceneId",
  "d2p:print-job-spec": "printJobId",
  "d2p:test-run-report": "reportId",
  "d2p:benchmark-run": "reportId",
  "d2p:quality-evidence-bundle": "bundleId",
  "d2p:evaluation-request": "requestId",
  "d2p:waiver": "waiverId",
  "d2p:scene-input": "sceneInputId",
  "d2p:scene-snapshot": "sceneSnapshotId",
  "d2p:panel-mesh-result": "meshResultId",
  "d2p:sim-report": "simReportId",
  "d2p:pattern-proposal": "proposalId",
  "d2p:inspect-3d-edit-result": "inspectionId",
  "d2p:scene-expectation": "expectationId",
  "d2p:body-model-snapshot": "bodyModelId",
  "d2p:draped-panel-mesh": "drapedMeshId",
  "d2p:fit-map": "fitMapId",
  "d2p:body-model-expectation": "expectationId",
  "d2p:drape-expectation": "expectationId",
});

/** Personal data classifications (§3.1, design decision ADR-013 policy tags). */
export const PERSONAL_CLASSIFICATIONS = new Set(["personal", "sensitive-personal"]);

export function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Identity key `(documentType, own ID members)` or null when the type has no own ID (§2.4 D2P-REF-005). */
export function identityKey(doc) {
  if (!isObject(doc)) return null;
  const members = OWN_ID_MEMBERS[doc.documentType];
  if (!members || members.length === 0) return null;
  const values = members.map((m) => doc[m]);
  if (values.some((v) => typeof v !== "string")) return null;
  return JSON.stringify([doc.documentType, ...values]);
}

/**
 * Embedded top-level documents (§1.2): pattern-evaluation.request,
 * print-job-spec.scene and the content of a d2p:artifact.create command.
 *
 * @returns {{ pointer: string, value: object }[]}
 */
export function embeddedDocuments(doc) {
  if (!isObject(doc)) return [];
  const out = [];
  if (doc.documentType === "d2p:pattern-evaluation" && isObject(doc.request)) out.push({ pointer: "/request", value: doc.request });
  if (doc.documentType === "d2p:print-job-spec" && isObject(doc.scene)) out.push({ pointer: "/scene", value: doc.scene });
  if (doc.documentType === "d2p:command" && doc.type === "d2p:artifact.create" && isObject(doc.payload?.content)) {
    out.push({ pointer: "/payload/content", value: doc.payload.content });
  }
  return out;
}

/**
 * Expands bundle documents into units: every top-level document plus its
 * embedded documents. A unit's `base` is the JSON Pointer of its value in the
 * file, so diagnostics point into the file.
 *
 * @param {{path: string, role: string, value: unknown}[]} docs
 * @returns {{path: string, role: string, value: object, base: string, embedded: boolean}[]}
 */
export function documentUnits(docs) {
  const out = [];
  for (const d of docs) {
    if (!isObject(d.value)) continue;
    out.push({ path: d.path, role: d.role, value: d.value, base: "", embedded: false });
    for (const e of embeddedDocuments(d.value)) out.push({ path: d.path, role: d.role, value: e.value, base: e.pointer, embedded: true });
  }
  return out;
}

/** Members whose subtree is an open container or extension data; classifiers and walkers skip them. */
export const OPAQUE_MEMBERS = new Set(["extensions", "paramsSchema", "parametersSchema", "details", "evidence"]);

/**
 * Depth-first walk over a JSON value. `visit(value, ptr, key, parent)` is
 * called for every node; returning `false` skips the subtree. Members in
 * `skip` are not entered.
 */
export function walkJson(value, visit, base = "", skip = OPAQUE_MEMBERS) {
  const rec = (v, ptr, key, parent) => {
    if (visit(v, ptr, key, parent) === false) return;
    if (Array.isArray(v)) v.forEach((item, i) => rec(item, pointer(ptr, i), i, v));
    else if (isObject(v)) {
      for (const [k, child] of Object.entries(v)) {
        if (skip.has(k)) continue;
        rec(child, pointer(ptr, k), k, v);
      }
    }
  };
  rec(value, base, undefined, undefined);
}

/** Compares two arrays of artifactRefs as sets of (artifactId, revisionId). */
export function sameRefSet(a = [], b = []) {
  const key = (r) => `${r?.artifactId}|${r?.revisionId}`;
  const sa = new Set(a.map(key));
  const sb = new Set(b.map(key));
  if (sa.size !== sb.size) return false;
  for (const k of sa) if (!sb.has(k)) return false;
  return true;
}

export function refKey(ref) {
  return `${ref?.artifactId}|${ref?.revisionId}`;
}

export function versionedKey(id, version) {
  return `${id}@${version}`;
}
