// Derives snapshot geometry (catalog section 3.4, snapshot generation rules)
// and the analytic garment measurements from an evaluated pattern.
import * as g from "./geometry.mjs";

const byId = (key) => (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);

/** Curve of an edge in edge direction. */
export function orientedEdgeCurve(evaluation, edge) {
  const c = evaluation.curve(edge.curveFeatureId).curve;
  return edge.reversed ? g.reverse(c) : c;
}

function edgeIndex(pattern) {
  const edges = new Map();
  for (const piece of pattern.pieces) {
    for (const contour of piece.contours) for (const e of contour.edges) edges.set(e.id, { piece, contour, edge: e });
  }
  return edges;
}

function segmentOf(edgeId, c) {
  if (c.kind === "line") return { kind: "line", edgeId, end: g.end(c) };
  return { kind: "cubic", edgeId, control1: c.p[1], control2: c.p[2], end: c.p[3] };
}

/** Notch point and tangent direction at normalized arc length `position` along the edge direction (rule 4). */
export function notchGeometry(evaluation, edge, position) {
  const c = orientedEdgeCurve(evaluation, edge);
  const t = g.parameterAtLength(c, position * g.arcLength(c));
  return { point: g.pointAt(c, t), tangent: g.derivativeAt(c, t) };
}

/**
 * Builds the geometry members of a geometry-snapshot: pieces, interfaces and
 * seams, in the array order required by catalog section 1.8. Numbers are raw
 * binary64 values; the caller quantizes the finished document.
 */
export function snapshotGeometry(pattern, evaluation) {
  const edges = edgeIndex(pattern);
  const pieces = [...pattern.pieces].sort(byId("id")).map((piece) => {
    const contours = [...piece.contours]
      .sort((a, b) => (a.role === b.role ? byId("id")(a, b) : a.role === "outer" ? -1 : 1))
      .map((contour) => {
        const curves = contour.edges.map((e) => orientedEdgeCurve(evaluation, e));
        return {
          contourId: contour.id,
          role: contour.role,
          start: g.start(curves[0]),
          segments: contour.edges.map((e, i) => segmentOf(e.id, curves[i])),
          curves,
        };
      });
    for (const c of contours) {
      const last = g.end(c.curves[c.curves.length - 1]);
      if (last[0] !== c.start[0] || last[1] !== c.start[1]) throw new Error(`contour ${c.contourId} is not closed`);
    }
    const allCurves = contours.flatMap((c) => c.curves);
    const signedArea = (c) => c.curves.reduce((s, curve) => s + g.greenArea(curve), 0);
    const outer = contours.find((c) => c.role === "outer");
    const area = signedArea(outer) + contours.filter((c) => c.role === "hole").reduce((s, c) => s + signedArea(c), 0);
    const notches = [...(piece.notches ?? [])].sort(byId("id")).map((n) => {
      const { point, tangent } = notchGeometry(evaluation, edges.get(n.edgeId).edge, n.position);
      return { notchId: n.id, edgeId: n.edgeId, point, angleRad: g.angleOf(tangent) };
    });
    const grainlines = [...(piece.grainlines ?? [])].sort(byId("id")).map((gl) => ({
      grainlineId: gl.id,
      start: evaluation.point(gl.startFeatureId),
      end: evaluation.point(gl.endFeatureId),
    }));
    const folds = [...(piece.folds ?? [])].sort(byId("id")).map((f) => ({ foldId: f.id, edgeId: f.edgeId }));
    return {
      pieceId: piece.id,
      contours: contours.map(({ curves, ...rest }) => rest),
      notches,
      grainlines,
      folds,
      boundingBox: g.unionBounds(allCurves.map(g.curveBounds)),
      areaMm2: area,
      _signedOuterArea: signedArea(outer),
    };
  });

  const interfaceLengths = new Map();
  const interfaces = [...pattern.seamInterfaces].sort(byId("id")).map((si) => {
    let length = 0;
    for (const s of si.segments) {
      const c = orientedEdgeCurve(evaluation, edges.get(s.edgeId).edge);
      length += (s.to - s.from) * g.arcLength(c);
    }
    interfaceLengths.set(si.id, length);
    const out = { seamInterfaceId: si.id };
    if (si.cutInstanceKey) out.cutInstanceKey = si.cutInstanceKey;
    out.lengthMm = length;
    return out;
  });

  const seams = [...pattern.seamConnections].sort(byId("id")).map((sc) => {
    const a = interfaceLengths.get(sc.interfaceIds[0]);
    const b = interfaceLengths.get(sc.interfaceIds[1]);
    const ease = sc.ease.mode === "none" ? 0 : evaluation.lengthExpr(sc.ease.amount.expr, `${sc.id}.ease.amount`);
    return { seamConnectionId: sc.id, lengthAMm: a, lengthBMm: b, declaredEaseMm: ease, deviationMm: a - b - ease };
  });

  return { pieces, interfaces, seams };
}

/**
 * Analytic garment measurements (registry definitions d2p:garment.chest-girth
 * and d2p:garment.sleeve-length): pieces joined at their seam lines, no seam
 * allowance.
 */
export function garmentMeasurements(evaluation) {
  const x = (id) => evaluation.point(id)[0];
  const frontWidth = x("front-underarm-left-pt") - x("front-underarm-right-pt");
  const backWidth = x("back-underarm-right-pt") - x("back-underarm-left-pt");
  const apex = evaluation.point("sleeve-apex-pt");
  const hf = evaluation.point("sleeve-hem-front-pt");
  const hb = evaluation.point("sleeve-hem-back-pt");
  // Top line of the sleeve: the vertical through the cap apex, down to the hem edge.
  const t = (apex[0] - hf[0]) / (hb[0] - hf[0]);
  const hemY = hf[1] + t * (hb[1] - hf[1]);
  return {
    "d2p:garment.chest-girth": frontWidth + backWidth,
    "d2p:garment.sleeve-length": apex[1] - hemY,
  };
}
