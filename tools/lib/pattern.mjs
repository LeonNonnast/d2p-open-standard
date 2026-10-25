// Pattern knowledge: feature set 1.0.0 (catalog §3.2.3), topology helpers (§3.2.5)
// and element indexes used by the referential and semantic levels.
import { pointer } from "./json.mjs";
import { isObject } from "./model.mjs";

export const L = Object.freeze([1, 0]);
export const A = Object.freeze([0, 1]);
export const ONE = Object.freeze([0, 0]);

/** Dimension name (`length` | `angle` | `dimensionless`) to exponent pair. */
export function dimensionOfName(name) {
  if (name === "length") return L;
  if (name === "angle") return A;
  if (name === "dimensionless") return ONE;
  return null;
}

const CURVE_TYPES = new Set(["d2p:line", "d2p:arc", "d2p:bezier.cubic"]);

/** Kind of a d2p: feature type, or null for extension types. */
export function d2pKind(type) {
  if (typeof type !== "string" || !type.startsWith("d2p:")) return null;
  if (type.startsWith("d2p:point.")) return "point";
  if (CURVE_TYPES.has(type)) return "curve";
  if (type.startsWith("d2p:constraint.")) return "constraint";
  return null;
}

export function isExtensionName(type) {
  return typeof type === "string" && !type.startsWith("d2p:") && type.includes(":");
}

/** Outputs per d2p: type: name -> dimension (§3.2.3). */
export function d2pOutputs(type) {
  const kind = d2pKind(type);
  if (kind === "point") return { x: L, y: L };
  if (type === "d2p:line") return { length: L, angle: A };
  if (type === "d2p:arc") return { length: L, radius: L, sweep: A };
  if (type === "d2p:bezier.cubic") return { length: L };
  return {};
}

/**
 * Required kind of every feature reference in `params`, per d2p: type.
 * `line` means a d2p:line feature.
 */
export const PARAM_REFERENCE_KINDS = Object.freeze({
  "d2p:point.offset": { baseFeatureId: "point" },
  "d2p:point.polar": { baseFeatureId: "point" },
  "d2p:point.along-curve": { curveFeatureId: "curve" },
  "d2p:point.intersection": { curveAFeatureId: "curve", curveBFeatureId: "curve" },
  "d2p:point.mirror": { pointFeatureId: "point", axisFeatureId: "line" },
  "d2p:line": { startFeatureId: "point", endFeatureId: "point" },
  "d2p:arc": { startFeatureId: "point", endFeatureId: "point", centerFeatureId: "point" },
  "d2p:bezier.cubic": { startFeatureId: "point", control1FeatureId: "point", control2FeatureId: "point", endFeatureId: "point" },
  "d2p:constraint.coincident": { aFeatureId: "point", bFeatureId: "point" },
  "d2p:constraint.distance": { aFeatureId: "point", bFeatureId: "point" },
  "d2p:constraint.length": { curveFeatureId: "curve" },
  "d2p:constraint.angle": { aFeatureId: "line", bFeatureId: "line" },
  "d2p:constraint.horizontal": { lineFeatureId: "line" },
  "d2p:constraint.vertical": { lineFeatureId: "line" },
  "d2p:constraint.parallel": { aFeatureId: "line", bFeatureId: "line" },
  "d2p:constraint.perpendicular": { aFeatureId: "line", bFeatureId: "line" },
  "d2p:constraint.tangent": { aFeatureId: "curve", bFeatureId: "curve" },
});

/** Expected dimension of every `{expr}` member of `params`, per d2p: type. */
export const PARAM_EXPR_DIMENSIONS = Object.freeze({
  "d2p:point.absolute": { x: L, y: L },
  "d2p:point.free": { x: L, y: L },
  "d2p:point.offset": { dx: L, dy: L },
  "d2p:point.polar": { distance: L, angle: A },
  "d2p:point.along-curve": { distance: L },
  "d2p:constraint.distance": { value: L },
  "d2p:constraint.length": { value: L },
  "d2p:constraint.angle": { value: A },
});

/**
 * Builds an index of one pattern document.
 *
 * @param {object} p pattern document (structurally valid)
 * @param {string} base JSON Pointer of the pattern inside its file
 */
export function indexPattern(p, base = "") {
  const idx = {
    base,
    pattern: p,
    features: new Map(), // id -> { feature, ptr }
    parameters: new Map(), // id -> { parameter, ptr }
    inputs: new Map(), // key -> { input, ptr }
    pieces: new Map(), // id -> { piece, ptr }
    contours: new Map(), // id -> { contour, piece, ptr }
    edges: new Map(), // id -> { edge, piece, contour, ptr }
    notches: new Map(), // id -> { notch, piece, ptr }
    grainlines: new Map(),
    folds: new Map(),
    interfaces: new Map(), // id -> { iface, ptr }
    connections: new Map(), // id -> { conn, ptr }
    groups: new Map(), // id -> { group, ptr }
    cutInstances: new Map(), // cutInstanceKey -> { pieceId, explicit }
    capabilities: new Map(), // featureType -> [capability]
    elementKinds: new Map(), // elementId -> elementType (first declaration)
  };
  const kindOf = (id, type) => {
    if (typeof id === "string" && !idx.elementKinds.has(id)) idx.elementKinds.set(id, type);
  };
  (p.parameters ?? []).forEach((parameter, i) => {
    idx.parameters.set(parameter.id, { parameter, ptr: pointer(base, "parameters", i) });
    kindOf(parameter.id, "d2p:parameter");
  });
  (p.measurementInputs ?? []).forEach((input, i) => {
    idx.inputs.set(input.key, { input, ptr: pointer(base, "measurementInputs", i) });
    kindOf(input.key, "d2p:measurement-input");
  });
  (p.features ?? []).forEach((feature, i) => {
    idx.features.set(feature.id, { feature, ptr: pointer(base, "features", i) });
    kindOf(feature.id, "d2p:feature");
  });
  (p.featureCapabilities ?? []).forEach((cap) => {
    const list = idx.capabilities.get(cap.featureType) ?? [];
    list.push(cap);
    idx.capabilities.set(cap.featureType, list);
  });
  (p.pieces ?? []).forEach((piece, pi) => {
    const pptr = pointer(base, "pieces", pi);
    idx.pieces.set(piece.id, { piece, ptr: pptr });
    kindOf(piece.id, "d2p:piece");
    (piece.contours ?? []).forEach((contour, ci) => {
      const cptr = pointer(pptr, "contours", ci);
      idx.contours.set(contour.id, { contour, piece, ptr: cptr });
      kindOf(contour.id, "d2p:contour");
      (contour.edges ?? []).forEach((edge, ei) => {
        idx.edges.set(edge.id, { edge, piece, contour, ptr: pointer(cptr, "edges", ei) });
        kindOf(edge.id, "d2p:edge");
      });
    });
    (piece.notches ?? []).forEach((notch, i) => {
      idx.notches.set(notch.id, { notch, piece, ptr: pointer(pptr, "notches", i) });
      kindOf(notch.id, "d2p:notch");
    });
    (piece.grainlines ?? []).forEach((g, i) => {
      idx.grainlines.set(g.id, { grainline: g, piece, ptr: pointer(pptr, "grainlines", i) });
      kindOf(g.id, "d2p:grainline");
    });
    (piece.folds ?? []).forEach((f, i) => {
      idx.folds.set(f.id, { fold: f, piece, ptr: pointer(pptr, "folds", i) });
      kindOf(f.id, "d2p:fold");
    });
    const instances = piece.cutInstruction?.instances;
    if (Array.isArray(instances) && instances.length) {
      for (const inst of instances) if (!idx.cutInstances.has(inst.cutInstanceKey)) idx.cutInstances.set(inst.cutInstanceKey, { pieceId: piece.id, explicit: true });
    } else if (!idx.cutInstances.has(piece.id)) {
      idx.cutInstances.set(piece.id, { pieceId: piece.id, explicit: false });
    }
  });
  (p.seamInterfaces ?? []).forEach((iface, i) => {
    idx.interfaces.set(iface.id, { iface, ptr: pointer(base, "seamInterfaces", i) });
    kindOf(iface.id, "d2p:seam-interface");
  });
  (p.seamConnections ?? []).forEach((conn, i) => {
    idx.connections.set(conn.id, { conn, ptr: pointer(base, "seamConnections", i) });
    kindOf(conn.id, "d2p:seam-connection");
  });
  (p.sewingGroups ?? []).forEach((group, i) => {
    idx.groups.set(group.id, { group, ptr: pointer(base, "sewingGroups", i) });
    kindOf(group.id, "d2p:sewing-group");
  });
  return idx;
}

/** Kind of a feature: point | curve | constraint | other | unknown (extension without a single capability). */
export function featureKind(idx, feature) {
  const k = d2pKind(feature.type);
  if (k) return k;
  const caps = idx.capabilities.get(feature.type) ?? [];
  return caps.length === 1 ? caps[0].kind : "unknown";
}

/** Outputs of a feature: name -> dimension, or null when unknown. */
export function featureOutputs(idx, feature) {
  if (d2pKind(feature.type)) return d2pOutputs(feature.type);
  const caps = idx.capabilities.get(feature.type) ?? [];
  if (caps.length !== 1) return null;
  const out = {};
  for (const o of caps[0].outputs ?? []) out[o.name] = dimensionOfName(o.dimension);
  return out;
}

/** Whether a feature satisfies a required reference kind (point | curve | line). */
export function satisfiesKind(idx, feature, required) {
  const kind = featureKind(idx, feature);
  if (kind === "unknown") return true;
  if (required === "line") {
    if (feature.type === "d2p:line") return true;
    return isExtensionName(feature.type) && kind === "curve";
  }
  return kind === required;
}

/** Start and end point feature IDs of a d2p: curve feature, or null. */
export function curveEndpoints(feature) {
  if (!feature || !CURVE_TYPES.has(feature.type)) return null;
  return { start: feature.params?.startFeatureId, end: feature.params?.endFeatureId };
}

/** Start and end point feature IDs of an edge in edge direction, or null when not checkable. */
export function edgeEndpoints(idx, edge) {
  const f = idx.features.get(edge.curveFeatureId)?.feature;
  const ep = curveEndpoints(f);
  if (!ep) return null;
  return edge.reversed ? { start: ep.end, end: ep.start } : ep;
}

/** Cut instance (graph node) of an interface: its cutInstanceKey, else the implicit instance of its piece. */
export function interfaceCutInstance(idx, iface) {
  if (typeof iface.cutInstanceKey === "string") return iface.cutInstanceKey;
  const pieceIds = interfacePieces(idx, iface);
  if (pieceIds.size !== 1) return null;
  const [pieceId] = pieceIds;
  const piece = idx.pieces.get(pieceId)?.piece;
  const instances = piece?.cutInstruction?.instances;
  if (Array.isArray(instances) && instances.length === 1) return instances[0].cutInstanceKey;
  return pieceId;
}

/** Set of piece IDs whose edges an interface uses (unresolved edges are ignored). */
export function interfacePieces(idx, iface) {
  const out = new Set();
  for (const s of iface.segments ?? []) {
    const e = idx.edges.get(s.edgeId);
    if (e) out.add(e.piece.id);
  }
  return out;
}

/** Element-type index of a content document for elementRef resolution (§1.5 rule 3). */
export function contentElementKinds(doc) {
  if (!isObject(doc)) return new Map();
  switch (doc.documentType) {
    case "d2p:pattern":
      return indexPattern(doc).elementKinds;
    case "d2p:grading-rule-set":
      return new Map((doc.rules ?? []).map((r) => [r.id, "d2p:grading-rule"]));
    case "d2p:size-system":
      return new Map((doc.sizes ?? []).map((s) => [s.sizeKey, "d2p:size-entry"]));
    case "d2p:garment-measurement-spec":
      return new Map((doc.targets ?? []).map((t) => [t.id, "d2p:measurement-target"]));
    case "d2p:fit-profile":
      return new Map([
        ...(doc.easeRules ?? []).map((r) => [r.id, "d2p:ease-rule"]),
        ...(doc.fitTargets ?? []).map((t) => [t.id, "d2p:fit-target"]),
      ]);
    case "d2p:garment":
      return new Map([
        ...(doc.patternEvaluations ?? []).map((e) => [e.id, "d2p:pattern-evaluation-ref"]),
        ...(doc.panelInstances ?? []).map((p) => [p.id, "d2p:panel-instance"]),
        ...(doc.sewingBindings ?? []).map((b) => [b.id, "d2p:sewing-binding"]),
        ...(doc.materialAssignments ?? []).map((m) => [m.id, "d2p:material-assignment"]),
        ...(doc.arrangements ?? []).map((a) => [a.id, "d2p:arrangement"]),
        ...(doc.bodyBindings ?? []).map((b) => [b.id, "d2p:body-binding"]),
        ...(doc.simulationConfigurations ?? []).map((c) => [c.id, "d2p:simulation-configuration"]),
      ]);
    default:
      return new Map();
  }
}
