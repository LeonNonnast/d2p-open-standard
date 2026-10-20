// Module 3d (catalog §3.9): referential and semantic checks of garments,
// scene inputs, scene snapshots, scene expectations, panel mesh results,
// 3D edit inspections and pattern proposals. Kernel-free: nothing here
// meshes, simulates or measures geometry; derived values are compared on
// quantized numbers (catalog §3.4 numeric comparison).
import {
  bindingsDigestOf,
  canonicalize,
  evaluationKeyOf,
  meshDigestOf,
  scaledInteger,
  sceneDigestOf,
} from "./c14n.mjs";
import { pointer } from "./json.mjs";
import { isObject, refKey } from "./model.mjs";
import { indexPattern, interfaceCutInstance } from "./pattern.mjs";

/** Factor of the explicit pattern-to-scene unit conversion (mm -> m). */
export const MM_TO_M = 0.001;
/** Permitted deviation of a unit quaternion's norm from 1 (D2P-SEM-122). */
export const QUATERNION_NORM_SLACK = 1e-6;
const QUANTUM_SLACK = 2n;

const at = (unit, ...tokens) => pointer(unit.base, ...tokens);
const closeQuantized = (a, b) => {
  const d = scaledInteger(a) - scaledInteger(b);
  return (d < 0n ? -d : d) <= QUANTUM_SLACK;
};
const list = (v) => (Array.isArray(v) ? v : []);

/** Local index of a garment content document. */
export function indexGarment(g) {
  const byId = (items) => new Map(list(items).filter(isObject).map((x, i) => [x.id, { item: x, i }]));
  return {
    garment: g,
    evals: byId(g.patternEvaluations),
    panels: byId(g.panelInstances),
    bindings: byId(g.sewingBindings),
    assignments: byId(g.materialAssignments),
    arrangements: byId(g.arrangements),
  };
}

/** Pattern index of a garment's pattern evaluation reference, or null when the pattern is not in the bundle. */
function patternOf(ctx, cache, evalRef) {
  if (!evalRef) return null;
  const key = refKey(evalRef.patternRef);
  if (!cache.has(key)) {
    const p = ctx.index.contentOf(evalRef.patternRef);
    cache.set(key, p ? indexPattern(p) : null);
  }
  return cache.get(key);
}

/** The cut instance object (with its mirrored flag) of a pattern, or null. */
export function cutInstanceOf(idx, key) {
  const entry = idx?.cutInstances.get(key);
  if (!entry) return null;
  if (!entry.explicit) return { cutInstanceKey: key, mirrored: false, pieceId: entry.pieceId };
  const piece = idx.pieces.get(entry.pieceId)?.piece;
  const inst = list(piece?.cutInstruction?.instances).find((c) => c.cutInstanceKey === key);
  return inst ? { ...inst, pieceId: entry.pieceId } : null;
}

// ---------------------------------------------------------------------------
// Referential level

/** Garment-internal and pattern references (§2.6 rows for module 3d), pinned evaluation consistency (D2P-REF-007). */
export function checkGarmentReferences(ctx, unit) {
  const g = unit.value;
  const gi = indexGarment(g);
  const patterns = new Map();
  const report = (code, msg, ptr) => ctx.report(code, msg, unit, ptr);
  const evalOf = (id, ptr) => {
    const e = gi.evals.get(id)?.item;
    if (!e) report("D2P-REF-003", `pattern evaluation reference "${id}" does not exist in this garment`, ptr);
    return e;
  };
  const panelRef = (id, ptr) => {
    if (!gi.panels.has(id)) report("D2P-REF-003", `panel instance "${id}" does not exist in this garment`, ptr);
  };

  list(g.patternEvaluations).forEach((e, i) => {
    const ptr = at(unit, "patternEvaluations", i);
    const ev = ctx.index.derivedDoc("d2p:pattern-evaluation", e.evaluationRef?.id)?.value;
    if (ev && isObject(ev.request)) {
      const req = ev.request;
      if (refKey(req.patternRef) !== refKey(e.patternRef)) {
        report("D2P-REF-007", `evaluation ${e.evaluationRef.id} evaluates ${refKey(req.patternRef)}, not the pinned pattern ${refKey(e.patternRef)}`, pointer(ptr, "patternRef"));
      }
      const sameSizeSystem = (req.sizeSystemRef === undefined && e.sizeSystemRef === undefined) || refKey(req.sizeSystemRef) === refKey(e.sizeSystemRef);
      if (req.sizeKey !== e.sizeKey || (e.sizeKey !== undefined && !sameSizeSystem)) {
        report("D2P-REF-007", `evaluation ${e.evaluationRef.id} is for size ${JSON.stringify(req.sizeKey ?? null)}, not the pinned size ${JSON.stringify(e.sizeKey ?? null)}`, pointer(ptr, "sizeKey"));
      }
      if (req.configurationKey !== e.configurationKey) {
        report("D2P-REF-007", `evaluation ${e.evaluationRef.id} is for configuration ${JSON.stringify(req.configurationKey ?? null)}, not ${JSON.stringify(e.configurationKey ?? null)}`, pointer(ptr, "configurationKey"));
      }
      if (ev.snapshotRef?.digest !== e.geometryDigest) {
        report("D2P-REF-007", `geometryDigest differs from the snapshot digest of evaluation ${e.evaluationRef.id}`, pointer(ptr, "geometryDigest"));
      }
    }
    if (e.sizeKey !== undefined && isObject(e.sizeSystemRef)) {
      const ss = ctx.index.contentOf(e.sizeSystemRef);
      if (ss && !list(ss.sizes).some((s) => s.sizeKey === e.sizeKey)) {
        report("D2P-REF-009", `sizeKey "${e.sizeKey}" is not defined in size system ${refKey(e.sizeSystemRef)}`, pointer(ptr, "sizeKey"));
      }
    }
  });

  list(g.panelInstances).forEach((p, i) => {
    const ptr = at(unit, "panelInstances", i);
    const e = evalOf(p.patternEvaluationId, pointer(ptr, "patternEvaluationId"));
    const idx = patternOf(ctx, patterns, e);
    if (!idx) return;
    if (!idx.pieces.has(p.pieceId)) report("D2P-REF-003", `piece "${p.pieceId}" does not exist in pattern ${refKey(e.patternRef)}`, pointer(ptr, "pieceId"));
    if (!idx.cutInstances.has(p.cutInstanceKey)) {
      report("D2P-REF-010", `cutInstanceKey "${p.cutInstanceKey}" is not declared by pattern ${refKey(e.patternRef)}`, pointer(ptr, "cutInstanceKey"));
    }
  });

  list(g.sewingBindings).forEach((b, i) => {
    const ptr = at(unit, "sewingBindings", i);
    const e = evalOf(b.patternEvaluationId, pointer(ptr, "patternEvaluationId"));
    const idx = patternOf(ctx, patterns, e);
    if (b.kind === "seam-connection") {
      if (idx && !idx.connections.has(b.seamConnectionId)) {
        report("D2P-REF-003", `seam connection "${b.seamConnectionId}" does not exist in pattern ${refKey(e.patternRef)}`, pointer(ptr, "seamConnectionId"));
      }
      list(b.interfaceBindings).forEach((ib, j) => {
        if (idx && !idx.interfaces.has(ib.seamInterfaceId)) {
          report("D2P-REF-003", `seam interface "${ib.seamInterfaceId}" does not exist in pattern ${refKey(e.patternRef)}`, pointer(ptr, "interfaceBindings", j, "seamInterfaceId"));
        }
        panelRef(ib.panelInstanceId, pointer(ptr, "interfaceBindings", j, "panelInstanceId"));
      });
    } else if (b.kind === "sewing-group") {
      if (idx && !idx.groups.has(b.sewingGroupId)) {
        report("D2P-REF-003", `sewing group "${b.sewingGroupId}" does not exist in pattern ${refKey(e.patternRef)}`, pointer(ptr, "sewingGroupId"));
      }
      list(b.memberBindingIds).forEach((id, j) => {
        if (!gi.bindings.has(id)) report("D2P-REF-003", `sewing binding "${id}" does not exist in this garment`, pointer(ptr, "memberBindingIds", j));
      });
    }
  });

  list(g.materialAssignments).forEach((m, i) => list(m.panelInstanceIds).forEach((id, j) => panelRef(id, at(unit, "materialAssignments", i, "panelInstanceIds", j))));
  list(g.arrangements).forEach((a, i) => list(a.placements).forEach((pl, j) => panelRef(pl.panelInstanceId, at(unit, "arrangements", i, "placements", j, "panelInstanceId"))));
}

/** Garment of a 3D document by its garmentRef: { gi, patterns } or null. */
function garmentContext(ctx, garmentRef) {
  const g = ctx.index.contentOf(garmentRef);
  return g && g.documentType === "d2p:garment" ? { gi: indexGarment(g), patterns: new Map() } : null;
}

/** Evaluation pins of a scene input / snapshot equal the garment's pattern evaluation references (as sets). */
function pinsDiffer(garment, pins) {
  const own = (e) => canonicalize({ patternEvaluationId: e.id, evaluationRef: e.evaluationRef, geometryDigest: e.geometryDigest });
  const a = new Set(list(garment.patternEvaluations).map(own));
  const b = new Set(list(pins).map((p) => canonicalize(p)));
  if (a.size !== b.size) return true;
  for (const k of a) if (!b.has(k)) return true;
  return false;
}

export function checkSceneInputReferences(ctx, unit) {
  const v = unit.value;
  const report = (code, msg, ptr) => ctx.report(code, msg, unit, ptr);
  if (typeof v.evaluationKey === "string" && evaluationKeyOf(v) !== v.evaluationKey) {
    report("D2P-REF-011", `evaluationKey differs from the recomputed key ${evaluationKeyOf(v)}`, at(unit, "evaluationKey"));
  }
  const gc = garmentContext(ctx, v.garmentRef);
  if (!gc) return;
  if (!gc.gi.arrangements.has(v.arrangementId)) report("D2P-REF-003", `arrangement "${v.arrangementId}" does not exist in garment ${refKey(v.garmentRef)}`, at(unit, "arrangementId"));
  list(v.patternEvaluations).forEach((p, i) => {
    if (!gc.gi.evals.has(p.patternEvaluationId)) report("D2P-REF-003", `pattern evaluation reference "${p.patternEvaluationId}" does not exist in garment ${refKey(v.garmentRef)}`, at(unit, "patternEvaluations", i, "patternEvaluationId"));
  });
  if (pinsDiffer(gc.gi.garment, v.patternEvaluations)) report("D2P-REF-007", "patternEvaluations differ from the pattern evaluation references of the pinned garment", at(unit, "patternEvaluations"));
}

/** Shared by scene snapshots and scene expectations. */
function checkSceneGarmentReferences(ctx, unit, gc) {
  const v = unit.value;
  const report = (code, msg, ptr) => ctx.report(code, msg, unit, ptr);
  if (!gc.gi.arrangements.has(v.arrangementId)) report("D2P-REF-003", `arrangement "${v.arrangementId}" does not exist in garment ${refKey(v.garmentRef)}`, at(unit, "arrangementId"));
  const panelRef = (id, ptr) => {
    if (!gc.gi.panels.has(id)) report("D2P-REF-003", `panel instance "${id}" does not exist in garment ${refKey(v.garmentRef)}`, ptr);
  };
  list(v.panelBindings).forEach((b, i) => panelRef(b.panelInstanceId, at(unit, "panelBindings", i, "panelInstanceId")));
  list(v.meshRefs).forEach((m, i) => panelRef(m.panelInstanceId, at(unit, "meshRefs", i, "panelInstanceId")));
  list(v.anchors).forEach((a, i) => panelRef(a.panelInstanceId, at(unit, "anchors", i, "panelInstanceId")));
  list(v.controlMeasures).forEach((c, i) => {
    panelRef(c.panelInstanceId, at(unit, "controlMeasures", i, "panelInstanceId"));
    const panel = gc.gi.panels.get(c.panelInstanceId)?.item;
    const idx = panel ? patternOf(ctx, gc.patterns, gc.gi.evals.get(panel.patternEvaluationId)?.item) : null;
    if (idx && !idx.interfaces.has(c.seamInterfaceId)) report("D2P-REF-003", `seam interface "${c.seamInterfaceId}" does not exist in the pattern of panel "${c.panelInstanceId}"`, at(unit, "controlMeasures", i, "seamInterfaceId"));
  });
}

export function checkSceneSnapshotReferences(ctx, unit) {
  const v = unit.value;
  const report = (code, msg, ptr) => ctx.report(code, msg, unit, ptr);
  if (typeof v.bindingsDigest === "string" && bindingsDigestOf(v) !== v.bindingsDigest) report("D2P-REF-011", `bindingsDigest differs from the recomputed digest ${bindingsDigestOf(v)}`, at(unit, "bindingsDigest"));
  if (typeof v.sceneDigest === "string" && sceneDigestOf(v) !== v.sceneDigest) report("D2P-REF-011", `sceneDigest differs from the recomputed digest ${sceneDigestOf(v)}`, at(unit, "sceneDigest"));
  list(v.meshRefs).forEach((m, i) => {
    const r = ctx.index.derivedDoc("d2p:panel-mesh-result", m.meshResultRef?.id)?.value;
    if (r && r.meshDigest !== m.meshDigest) report("D2P-REF-011", `meshDigest differs from the meshDigest of ${m.meshResultRef.id}`, at(unit, "meshRefs", i, "meshDigest"));
  });
  // Pinned inputs: the garment, every pattern of the evaluation pins and the mesh profile (D2P-REF-007).
  const digests = list(v.inputDigests);
  const garmentEntries = digests.filter((d) => d.role === "garment");
  if (garmentEntries.length !== 1 || refKey(garmentEntries[0].artifactRef) !== refKey(v.garmentRef)) {
    report("D2P-REF-007", "inputDigests must contain exactly one entry of role garment, pinning garmentRef", at(unit, "inputDigests"));
  }
  const meshEntries = digests.filter((d) => d.role === "mesh-profile");
  if (meshEntries.length !== 1 || meshEntries[0].id?.id !== v.meshProfile?.id || meshEntries[0].id?.version !== v.meshProfile?.version) {
    report("D2P-REF-007", "inputDigests must contain exactly one entry of role mesh-profile, pinning meshProfile", at(unit, "inputDigests"));
  }
  if (isObject(v.sceneInputRef)) {
    const input = ctx.index.derivedDoc("d2p:scene-input", v.sceneInputRef.id)?.value;
    if (input) {
      if (input.evaluationKey !== v.evaluationKey) report("D2P-REF-007", `evaluationKey differs from the evaluationKey of scene input ${input.sceneInputId}`, at(unit, "evaluationKey"));
      if (refKey(input.garmentRef) !== refKey(v.garmentRef)) report("D2P-REF-007", `garmentRef differs from the garmentRef of scene input ${input.sceneInputId}`, at(unit, "garmentRef"));
    }
  }
  const gc = garmentContext(ctx, v.garmentRef);
  if (!gc) return;
  const patternKeys = new Set(digests.filter((d) => d.role === "pattern").map((d) => refKey(d.artifactRef)));
  for (const e of gc.gi.evals.values()) {
    if (!patternKeys.has(refKey(e.item.patternRef))) {
      report("D2P-REF-007", `inputDigests has no entry of role pattern for ${refKey(e.item.patternRef)} (pattern evaluation reference "${e.item.id}")`, at(unit, "inputDigests"));
    }
  }
  checkSceneGarmentReferences(ctx, unit, gc);
}

export function checkSceneExpectationReferences(ctx, unit) {
  const v = unit.value;
  const report = (code, msg, ptr) => ctx.report(code, msg, unit, ptr);
  if (typeof v.bindingsDigest === "string" && bindingsDigestOf(v) !== v.bindingsDigest) report("D2P-REF-011", `bindingsDigest differs from the recomputed digest ${bindingsDigestOf(v)}`, at(unit, "bindingsDigest"));
  const input = ctx.index.derivedDoc("d2p:scene-input", v.sceneInputRef?.id)?.value;
  if (input) {
    if (refKey(input.garmentRef) !== refKey(v.garmentRef)) report("D2P-REF-007", `garmentRef differs from the garmentRef of scene input ${input.sceneInputId}`, at(unit, "garmentRef"));
    for (const m of ["arrangementId", "mode"]) if (input[m] !== v[m]) report("D2P-REF-007", `${m} differs from the ${m} of scene input ${input.sceneInputId}`, at(unit, m));
    if (canonicalize(input.meshProfile) !== canonicalize(v.meshProfile)) report("D2P-REF-007", `meshProfile differs from the meshProfile of scene input ${input.sceneInputId}`, at(unit, "meshProfile"));
  }
  const gc = garmentContext(ctx, v.garmentRef);
  if (gc) checkSceneGarmentReferences(ctx, unit, gc);
}

export function checkPanelMeshReferences(ctx, unit) {
  const v = unit.value;
  const report = (code, msg, ptr) => ctx.report(code, msg, unit, ptr);
  if (isObject(v.mesh) && typeof v.meshDigest === "string" && meshDigestOf(v) !== v.meshDigest) report("D2P-REF-011", `meshDigest differs from the recomputed digest ${meshDigestOf(v)}`, at(unit, "meshDigest"));
  const gc = garmentContext(ctx, v.garmentRef);
  if (!gc) return;
  const panel = gc.gi.panels.get(v.panelInstanceId)?.item;
  if (!panel) {
    report("D2P-REF-003", `panel instance "${v.panelInstanceId}" does not exist in garment ${refKey(v.garmentRef)}`, at(unit, "panelInstanceId"));
    return;
  }
  for (const m of ["pieceId", "cutInstanceKey"]) {
    if (panel[m] !== v[m]) report("D2P-REF-007", `${m} "${v[m]}" differs from the panel instance's ${m} "${panel[m]}"`, at(unit, m));
  }
  const e = gc.gi.evals.get(panel.patternEvaluationId)?.item;
  if (e) {
    if (e.evaluationRef?.id !== v.evaluationRef?.id) report("D2P-REF-007", `evaluationRef ${v.evaluationRef?.id} is not the panel's pinned evaluation ${e.evaluationRef?.id}`, at(unit, "evaluationRef"));
    if (e.geometryDigest !== v.geometryDigest) report("D2P-REF-007", "geometryDigest differs from the panel's pinned geometryDigest", at(unit, "geometryDigest"));
  }
  const idx = patternOf(ctx, gc.patterns, e);
  if (!idx) return;
  list(v.edgeBindings).forEach((b, i) => {
    if (!idx.edges.has(b.edgeId)) report("D2P-REF-003", `edge "${b.edgeId}" does not exist in pattern ${refKey(e.patternRef)}`, at(unit, "edgeBindings", i, "edgeId"));
  });
}

/** Parameter IDs and expressions of parameter updates resolve in the base pattern. */
function checkUpdates(ctx, unit, idx, updates, basePtr, resolveExpr) {
  list(updates).forEach((u, i) => {
    if (!idx.parameters.has(u.parameterId)) ctx.report("D2P-REF-003", `parameter "${u.parameterId}" does not exist in the base pattern`, unit, pointer(basePtr, i, "parameterId"));
    resolveExpr(idx, u.expr, pointer(basePtr, i, "expr"), (code, msg, p) => ctx.report(code, msg, unit, p));
  });
}

export function checkProposalReferences(ctx, unit, resolveExpr) {
  const v = unit.value;
  const p = ctx.index.contentOf(v.basePatternRef);
  if (!p) return;
  checkUpdates(ctx, unit, indexPattern(p), v.parameterUpdates, at(unit, "parameterUpdates"), resolveExpr);
}

export function checkInspectionReferences(ctx, unit, resolveExpr) {
  const v = unit.value;
  const report = (code, msg, ptr) => ctx.report(code, msg, unit, ptr);
  const p = ctx.index.contentOf(v.basePatternRef);
  const idx = p ? indexPattern(p) : null;
  const scene = ctx.index.derivedDoc("d2p:scene-snapshot", v.sceneSnapshotRef?.id)?.value;
  const gc = scene ? garmentContext(ctx, scene.garmentRef) : null;
  list(v.edits).forEach((e, i) => {
    const ptr = at(unit, "edits", i);
    if (gc) {
      if (!gc.gi.panels.has(e.target?.panelInstanceId)) report("D2P-REF-003", `panel instance "${e.target?.panelInstanceId}" does not exist in the scene's garment`, pointer(ptr, "target", "panelInstanceId"));
      if (e.target?.sewingBindingId !== undefined && !gc.gi.bindings.has(e.target.sewingBindingId)) {
        report("D2P-REF-003", `sewing binding "${e.target.sewingBindingId}" does not exist in the scene's garment`, pointer(ptr, "target", "sewingBindingId"));
      }
    }
    if (!idx) return;
    if (e.target?.edgeId !== undefined && !idx.edges.has(e.target.edgeId)) report("D2P-REF-003", `edge "${e.target.edgeId}" does not exist in the base pattern`, pointer(ptr, "target", "edgeId"));
    checkUpdates(ctx, unit, idx, e.parameterUpdates, pointer(ptr, "parameterUpdates"), resolveExpr);
    list(e.parameterCandidates).forEach((id, j) => {
      if (!idx.parameters.has(id)) report("D2P-REF-003", `parameter "${id}" does not exist in the base pattern`, pointer(ptr, "parameterCandidates", j));
    });
  });
}

// ---------------------------------------------------------------------------
// Semantic level

/** D2P-SEM-120 (panel instances), D2P-SEM-121 (sewing bindings), D2P-SEM-122 (arrangements). */
export function checkGarmentSemantics(ctx, unit) {
  const g = unit.value;
  const gi = indexGarment(g);
  const patterns = new Map();
  const report = (code, msg, ptr) => ctx.report(code, msg, unit, ptr);

  // D2P-SEM-120: each panel binds a cut instance of its own piece, once per pattern evaluation.
  const seenCut = new Map();
  list(g.panelInstances).forEach((p, i) => {
    const ptr = at(unit, "panelInstances", i);
    const key = `${p.patternEvaluationId}|${p.cutInstanceKey}`;
    if (seenCut.has(key)) report("D2P-SEM-120", `cut instance "${p.cutInstanceKey}" of pattern evaluation reference "${p.patternEvaluationId}" is already bound by panel instance "${seenCut.get(key)}"`, pointer(ptr, "cutInstanceKey"));
    else seenCut.set(key, p.id);
    const idx = patternOf(ctx, patterns, gi.evals.get(p.patternEvaluationId)?.item);
    const inst = cutInstanceOf(idx, p.cutInstanceKey);
    if (inst && idx.pieces.has(p.pieceId) && inst.pieceId !== p.pieceId) {
      report("D2P-SEM-120", `cut instance "${p.cutInstanceKey}" belongs to piece "${inst.pieceId}", not to "${p.pieceId}"`, pointer(ptr, "cutInstanceKey"));
    }
  });
  const assigned = new Map();
  list(g.materialAssignments).forEach((m, i) => list(m.panelInstanceIds).forEach((id, j) => {
    if (assigned.has(id)) report("D2P-SEM-120", `panel instance "${id}" is already assigned a material by "${assigned.get(id)}"`, at(unit, "materialAssignments", i, "panelInstanceIds", j));
    else assigned.set(id, m.id);
  }));

  // D2P-SEM-121: bindings reproduce the pattern's connections and groups.
  const boundConnections = new Map();
  list(g.sewingBindings).forEach((b, i) => {
    const ptr = at(unit, "sewingBindings", i);
    const e = gi.evals.get(b.patternEvaluationId)?.item;
    const idx = patternOf(ctx, patterns, e);
    if (b.kind === "seam-connection") {
      const ck = `${b.patternEvaluationId}|${b.seamConnectionId}`;
      if (boundConnections.has(ck)) report("D2P-SEM-121", `seam connection "${b.seamConnectionId}" is already bound by "${boundConnections.get(ck)}"`, pointer(ptr, "seamConnectionId"));
      else boundConnections.set(ck, b.id);
      const conn = idx?.connections.get(b.seamConnectionId)?.conn;
      if (!conn) return;
      if (conn.active === false) report("D2P-SEM-121", `seam connection "${conn.id}" is inactive and cannot be bound`, pointer(ptr, "seamConnectionId"));
      list(b.interfaceBindings).forEach((ib, j) => {
        const want = list(conn.interfaceIds)[j];
        if (ib.seamInterfaceId !== want) {
          report("D2P-SEM-121", `interfaceBindings[${j}] names "${ib.seamInterfaceId}", but side ${j === 0 ? "A" : "B"} of "${conn.id}" is "${want}"`, pointer(ptr, "interfaceBindings", j, "seamInterfaceId"));
          return;
        }
        const panel = gi.panels.get(ib.panelInstanceId)?.item;
        const iface = idx.interfaces.get(ib.seamInterfaceId)?.iface;
        if (!panel || !iface) return;
        if (panel.patternEvaluationId !== b.patternEvaluationId) {
          report("D2P-SEM-121", `panel instance "${panel.id}" belongs to pattern evaluation reference "${panel.patternEvaluationId}", not "${b.patternEvaluationId}"`, pointer(ptr, "interfaceBindings", j, "panelInstanceId"));
          return;
        }
        const node = interfaceCutInstance(idx, iface);
        if (node !== null && node !== panel.cutInstanceKey) {
          report("D2P-SEM-121", `seam interface "${iface.id}" lies on cut instance "${node}", not on panel instance "${panel.id}" (cut instance "${panel.cutInstanceKey}")`, pointer(ptr, "interfaceBindings", j, "panelInstanceId"));
        }
      });
    } else if (b.kind === "sewing-group") {
      const group = idx?.groups.get(b.sewingGroupId)?.group;
      if (!group) return;
      const want = new Set(list(group.members).map((m) => m.connectionId));
      const got = new Set();
      list(b.memberBindingIds).forEach((id, j) => {
        const mb = gi.bindings.get(id)?.item;
        if (!mb) return;
        if (mb.kind !== "seam-connection" || mb.patternEvaluationId !== b.patternEvaluationId) {
          report("D2P-SEM-121", `member binding "${id}" is not a seam-connection binding of pattern evaluation reference "${b.patternEvaluationId}"`, pointer(ptr, "memberBindingIds", j));
          return;
        }
        got.add(mb.seamConnectionId);
      });
      const same = want.size === got.size && [...want].every((c) => got.has(c));
      if (!same) report("D2P-SEM-121", `member bindings bind the connections [${[...got].sort().join(", ")}], but sewing group "${group.id}" has the members [${[...want].sort().join(", ")}]`, pointer(ptr, "memberBindingIds"));
    }
  });

  // D2P-SEM-122: one placement per panel instance per arrangement, unit quaternions.
  list(g.arrangements).forEach((a, i) => {
    const ptr = at(unit, "arrangements", i);
    const seen = new Set();
    list(a.placements).forEach((pl, j) => {
      if (seen.has(pl.panelInstanceId)) report("D2P-SEM-122", `arrangement "${a.id}" places panel instance "${pl.panelInstanceId}" more than once`, pointer(ptr, "placements", j, "panelInstanceId"));
      seen.add(pl.panelInstanceId);
      const q = list(pl.rotation);
      const norm = Math.sqrt(q.reduce((s, x) => s + x * x, 0));
      if (q.length === 4 && Math.abs(norm - 1) > QUATERNION_NORM_SLACK) report("D2P-SEM-122", `rotation of panel instance "${pl.panelInstanceId}" is not a unit quaternion (norm ${norm})`, pointer(ptr, "placements", j, "rotation"));
    });
    for (const id of gi.panels.keys()) if (!seen.has(id)) report("D2P-SEM-122", `arrangement "${a.id}" has no placement for panel instance "${id}"`, pointer(ptr, "placements"));
  });
}

/** The geometry snapshot pinned by a garment pattern evaluation reference, when evaluation and snapshot are in the bundle. */
function snapshotOf(ctx, evalRef) {
  const ev = ctx.index.derivedDoc("d2p:pattern-evaluation", evalRef?.evaluationRef?.id)?.value;
  const snap = ev?.snapshotRef ? ctx.index.derivedDoc("d2p:geometry-snapshot", ev.snapshotRef.id)?.value : undefined;
  return snap && snap.geometryDigest === evalRef.geometryDigest ? snap : undefined;
}

/**
 * D2P-SEM-123 (unit conversion) and D2P-SEM-124 (bindings reproduce the garment)
 * for scene snapshots and scene expectations.
 */
export function checkSceneSemantics(ctx, unit) {
  const v = unit.value;
  const report = (code, msg, ptr) => ctx.report(code, msg, unit, ptr);

  // D2P-SEM-123: control measures (kernel-free).
  list(v.controlMeasures).forEach((c, i) => {
    if (typeof c.lengthMm === "number" && typeof c.lengthM === "number" && !closeQuantized(c.lengthM, c.lengthMm * MM_TO_M)) {
      report("D2P-SEM-123", `lengthM ${c.lengthM} is not lengthMm ${c.lengthMm} × 0.001`, at(unit, "controlMeasures", i, "lengthM"));
    }
  });
  if (v.documentType === "d2p:scene-snapshot" && v.qualityStatus !== "failed" && v.qualityStatus !== "unsupported") {
    const meshed = new Set(list(v.meshRefs).map((m) => m.panelInstanceId));
    list(v.panelBindings).forEach((b, i) => {
      if (!meshed.has(b.panelInstanceId)) report("D2P-SEM-124", `qualityStatus "${v.qualityStatus}" but panel instance "${b.panelInstanceId}" has no mesh reference`, at(unit, "panelBindings", i));
    });
  }
  if (v.documentType === "d2p:scene-snapshot") {
    const seenMesh = new Set();
    list(v.meshRefs).forEach((m, i) => {
      if (seenMesh.has(m.panelInstanceId)) report("D2P-SEM-124", `panel instance "${m.panelInstanceId}" has more than one mesh reference`, at(unit, "meshRefs", i, "panelInstanceId"));
      seenMesh.add(m.panelInstanceId);
      const r = ctx.index.derivedDoc("d2p:panel-mesh-result", m.meshResultRef?.id)?.value;
      if (r && (r.panelInstanceId !== m.panelInstanceId || refKey(r.garmentRef) !== refKey(v.garmentRef))) {
        report("D2P-SEM-124", `mesh result ${m.meshResultRef.id} meshes panel instance "${r.panelInstanceId}" of ${refKey(r.garmentRef)}, not "${m.panelInstanceId}"`, at(unit, "meshRefs", i));
      }
      if (r && r.status !== "succeeded") report("D2P-SEM-124", `mesh result ${m.meshResultRef.id} has status "${r.status}"`, at(unit, "meshRefs", i));
    });
  }

  const g = ctx.index.contentOf(v.garmentRef);
  if (!g || g.documentType !== "d2p:garment") return;
  const gi = indexGarment(g);
  const patterns = new Map();
  if (v.documentType === "d2p:scene-snapshot" && pinsDiffer(g, v.patternEvaluations)) {
    report("D2P-SEM-124", "patternEvaluations differ from the pattern evaluation references of the garment", at(unit, "patternEvaluations"));
  }
  const arrangement = gi.arrangements.get(v.arrangementId)?.item;
  const placements = new Map(list(arrangement?.placements).map((p) => [p.panelInstanceId, p]));

  // Panel bindings: exactly one per panel instance, copying the garment and the cut instance.
  const seen = new Set();
  list(v.panelBindings).forEach((b, i) => {
    const ptr = at(unit, "panelBindings", i);
    if (seen.has(b.panelInstanceId)) report("D2P-SEM-124", `panel instance "${b.panelInstanceId}" is bound more than once`, pointer(ptr, "panelInstanceId"));
    seen.add(b.panelInstanceId);
    const p = gi.panels.get(b.panelInstanceId)?.item;
    if (!p) return;
    for (const m of ["patternEvaluationId", "pieceId", "cutInstanceKey", "side"]) {
      if (p[m] !== b[m]) report("D2P-SEM-124", `${m} "${b[m]}" differs from the garment's panel instance (${JSON.stringify(p[m])})`, pointer(ptr, m));
    }
    const inst = cutInstanceOf(patternOf(ctx, patterns, gi.evals.get(p.patternEvaluationId)?.item), p.cutInstanceKey);
    if (inst && Boolean(inst.mirrored) !== b.mirrored) report("D2P-SEM-124", `mirrored ${b.mirrored} differs from cut instance "${inst.cutInstanceKey}" (mirrored ${Boolean(inst.mirrored)})`, pointer(ptr, "mirrored"));
    const pl = placements.get(b.panelInstanceId);
    if (!pl || !isObject(b.transform)) return;
    const q = list(b.transform.rotation);
    if (q.length !== 4 || q.some((x, k) => !closeQuantized(x, pl.rotation[k]))) report("D2P-SEM-124", `transform.rotation differs from the placement rotation of arrangement "${v.arrangementId}"`, pointer(ptr, "transform", "rotation"));
    const t = list(b.transform.translationM);
    if (t.length === 3 && t.some((x, k) => !closeQuantized(x, pl.translationMm[k] * MM_TO_M))) {
      report("D2P-SEM-123", `transform.translationM [${t.join(", ")}] is not the placement translationMm [${pl.translationMm.join(", ")}] × 0.001`, pointer(ptr, "transform", "translationM"));
    }
  });
  for (const id of gi.panels.keys()) if (!seen.has(id)) report("D2P-SEM-124", `panel instance "${id}" of the garment has no panel binding`, at(unit, "panelBindings"));

  // Seam bindings: the garment's sewing bindings, unchanged.
  const want = new Map(list(g.sewingBindings).map((b) => [b.id, canonicalize(b)]));
  const got = new Set();
  list(v.seamBindings).forEach((b, i) => {
    got.add(b.id);
    if (!want.has(b.id)) report("D2P-SEM-124", `seam binding "${b.id}" is not a sewing binding of the garment`, at(unit, "seamBindings", i));
    else if (want.get(b.id) !== canonicalize(b)) report("D2P-SEM-124", `seam binding "${b.id}" differs from the garment's sewing binding`, at(unit, "seamBindings", i));
  });
  for (const id of want.keys()) if (!got.has(id)) report("D2P-SEM-124", `sewing binding "${id}" of the garment is missing from seamBindings`, at(unit, "seamBindings"));

  // Control measures: one per interface binding of every seam-connection binding, with the snapshot's length.
  const expected = new Map(); // seamInterfaceId|panelInstanceId -> length or undefined
  for (const { item: b } of gi.bindings.values()) {
    if (b.kind !== "seam-connection") continue;
    const snap = snapshotOf(ctx, gi.evals.get(b.patternEvaluationId)?.item);
    const lengths = new Map(list(snap?.interfaces).map((s) => [s.seamInterfaceId, s.lengthMm]));
    for (const ib of list(b.interfaceBindings)) expected.set(`${ib.seamInterfaceId}|${ib.panelInstanceId}`, lengths.get(ib.seamInterfaceId));
  }
  const seenMeasure = new Set();
  list(v.controlMeasures).forEach((c, i) => {
    const key = `${c.seamInterfaceId}|${c.panelInstanceId}`;
    if (seenMeasure.has(key) || !expected.has(key)) {
      report("D2P-SEM-124", `control measure (${c.seamInterfaceId}, ${c.panelInstanceId}) ${seenMeasure.has(key) ? "appears more than once" : "is not an interface binding of the garment"}`, at(unit, "controlMeasures", i));
      seenMeasure.add(key);
      return;
    }
    seenMeasure.add(key);
    const len = expected.get(key);
    if (typeof len === "number" && !closeQuantized(c.lengthMm, len)) report("D2P-SEM-124", `lengthMm ${c.lengthMm} differs from the snapshot length ${len} of seam interface "${c.seamInterfaceId}"`, at(unit, "controlMeasures", i, "lengthMm"));
  });
  for (const key of expected.keys()) if (!seenMeasure.has(key)) report("D2P-SEM-124", `control measure for interface binding (${key.replace("|", ", ")}) is missing`, at(unit, "controlMeasures"));
}

/** D2P-SEM-125: panel mesh consistency (kernel-free). */
export function checkPanelMeshSemantics(ctx, unit) {
  const v = unit.value;
  if (v.status !== "succeeded" || !isObject(v.mesh)) return;
  const report = (msg, ...tokens) => ctx.report("D2P-SEM-125", msg, unit, at(unit, ...tokens));
  const positions = list(v.mesh.positions);
  const uvs = list(v.mesh.uvs);
  if (positions.length !== uvs.length) report(`mesh has ${positions.length} positions but ${uvs.length} uvs`, "mesh", "uvs");
  positions.forEach((p, i) => {
    if (Array.isArray(p) && p[2] !== 0) report(`position ${i} has z = ${p[2]}; a panel mesh is flat in panel-local coordinates`, "mesh", "positions", i);
  });
  list(v.mesh.triangles).forEach((t, i) => {
    if (list(t).some((k) => k >= positions.length)) report(`triangle ${i} names a vertex index outside positions`, "mesh", "triangles", i);
  });
  const maxErr = v.maxApproximationErrorMm;
  list(v.edgeBindings).forEach((b, i) => {
    if (typeof maxErr === "number" && b.maxDeviationMm > maxErr) report(`edge "${b.edgeId}" deviates by ${b.maxDeviationMm} mm, more than maxApproximationErrorMm ${maxErr}`, "edgeBindings", i, "maxDeviationMm");
  });
  const profile = ctx.index.vocabDoc("d2p:mesh-profile", v.meshProfile?.id, v.meshProfile?.version)?.value;
  if (profile && typeof maxErr === "number" && maxErr > profile.maxPlanarDeviationMm) {
    report(`maxApproximationErrorMm ${maxErr} exceeds maxPlanarDeviationMm ${profile.maxPlanarDeviationMm} of mesh profile ${profile.profileId} ${profile.version}`, "maxApproximationErrorMm");
  }
  if (profile) {
    list(v.edgeBindings).forEach((b, i) => {
      if (b.sampleCount < profile.sampling?.minSamplesPerEdge) report(`edge "${b.edgeId}" has ${b.sampleCount} samples, fewer than minSamplesPerEdge ${profile.sampling.minSamplesPerEdge}`, "edgeBindings", i, "sampleCount");
    });
  }
  // Completeness: exactly one edge binding per edge of the piece's contours.
  const g = ctx.index.contentOf(v.garmentRef);
  if (!g || g.documentType !== "d2p:garment") return;
  const gi = indexGarment(g);
  const panel = gi.panels.get(v.panelInstanceId)?.item;
  const e = panel ? gi.evals.get(panel.patternEvaluationId)?.item : undefined;
  const p = e ? ctx.index.contentOf(e.patternRef) : undefined;
  const piece = p ? list(p.pieces).find((x) => x.id === v.pieceId) : undefined;
  if (!piece) return;
  const edges = new Set(list(piece.contours).flatMap((c) => list(c.edges).map((x) => x.id)));
  const seen = new Set();
  list(v.edgeBindings).forEach((b, i) => {
    if (seen.has(b.edgeId)) report(`edge "${b.edgeId}" is bound more than once`, "edgeBindings", i, "edgeId");
    else if (!edges.has(b.edgeId)) report(`edge "${b.edgeId}" is not an edge of piece "${piece.id}"`, "edgeBindings", i, "edgeId");
    seen.add(b.edgeId);
  });
  for (const id of edges) if (!seen.has(id)) report(`edge "${id}" of piece "${piece.id}" has no edge binding`, "edgeBindings");
}

/** D2P-SEM-126: the proposal of an inspection holds exactly the supported edits. */
export function checkInspectionSemantics(ctx, unit) {
  const v = unit.value;
  const report = (msg, ...tokens) => ctx.report("D2P-SEM-126", msg, unit, at(unit, ...tokens));
  const supported = list(v.edits).filter((e) => e.classification === "supported");
  if (supported.length && !isObject(v.proposalRef)) report(`${supported.length} edit(s) are supported but the inspection names no proposal`, "edits");
  if (!supported.length && isObject(v.proposalRef)) report("no edit is supported, so the inspection must not name a proposal", "proposalRef");
  const proposal = isObject(v.proposalRef) ? ctx.index.derivedDoc("d2p:pattern-proposal", v.proposalRef.id)?.value : undefined;
  if (!proposal) return;
  if (refKey(proposal.basePatternRef) !== refKey(v.basePatternRef)) report(`proposal ${proposal.proposalId} changes ${refKey(proposal.basePatternRef)}, not ${refKey(v.basePatternRef)}`, "proposalRef");
  const want = supported.flatMap((e) => list(e.parameterUpdates)).map((u) => canonicalize(u)).sort();
  const got = list(proposal.parameterUpdates).map((u) => canonicalize(u)).sort();
  if (want.length !== got.length || want.some((x, i) => x !== got[i])) report(`proposal ${proposal.proposalId} does not hold exactly the parameter updates of the supported edits`, "proposalRef");
}
