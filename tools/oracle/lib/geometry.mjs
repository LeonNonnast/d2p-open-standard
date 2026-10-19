// 2D curve geometry for the Golden T-Shirt oracle: lines and cubic Béziers only.
// Coordinates are millimetres, angles radians, X right, Y up.
//
// Arc length of a cubic Bézier has no closed form; it is computed by adaptive
// Gauss-Kronrod (G7/K15) quadrature of the speed |B'(t)|. A subinterval is
// accepted when |K15 - G7| <= ARC_LENGTH_TOLERANCE_MM * (subinterval width), so
// the summed error estimate over [0, 1] is at most ARC_LENGTH_TOLERANCE_MM
// (1e-12 mm), three orders of magnitude below the 1e-9 mm quantization step of
// d2p-digest-v1. The recursion depth is capped (MAX_DEPTH); hitting the cap is
// an error, never a silent approximation.

export const ARC_LENGTH_TOLERANCE_MM = 1e-12;
const MAX_DEPTH = 40;

// QUADPACK G7/K15 abscissae and weights on [-1, 1].
const XK = [
  0.991455371120812639206854697526329, 0.949107912342758524526189684047851, 0.864864423359769072789712788640926,
  0.741531185599394439863864773280788, 0.586087235467691130294144845693013, 0.405845151377397166906606412076961,
  0.207784955007898467600689403773245, 0.0,
];
const WK = [
  0.02293532201052922496373200805897, 0.063092092629978553290700663189204, 0.104790010322250183839876322541518,
  0.140653259715525918745189590510238, 0.16900472663926790282658342659855, 0.190350578064785409913256402421014,
  0.204432940075298892414161999234649, 0.209482141084727828012999174891714,
];
const WG = [0.129484966168869693270611432679082, 0.27970539148927666790146777142378, 0.381830050505118944950369775488975, 0.417959183673469387755102040816327];

export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const scale = (a, s) => [a[0] * s, a[1] * s];
export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** A curve is {kind: "line", p: [p0, p1]} or {kind: "cubic", p: [p0, p1, p2, p3]}. */
export function line(p0, p1) {
  return { kind: "line", p: [p0, p1] };
}
export function cubic(p0, p1, p2, p3) {
  return { kind: "cubic", p: [p0, p1, p2, p3] };
}
export function reverse(c) {
  return { kind: c.kind, p: [...c.p].reverse() };
}
export function start(c) {
  return c.p[0];
}
export function end(c) {
  return c.p[c.p.length - 1];
}

export function pointAt(c, t) {
  if (c.kind === "line") return add(c.p[0], scale(sub(c.p[1], c.p[0]), t));
  const [p0, p1, p2, p3] = c.p;
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return [a * p0[0] + b * p1[0] + d * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + d * p2[1] + e * p3[1]];
}

export function derivativeAt(c, t) {
  if (c.kind === "line") return sub(c.p[1], c.p[0]);
  const [p0, p1, p2, p3] = c.p;
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const d = 3 * t * t;
  return [
    a * (p1[0] - p0[0]) + b * (p2[0] - p1[0]) + d * (p3[0] - p2[0]),
    a * (p1[1] - p0[1]) + b * (p2[1] - p1[1]) + d * (p3[1] - p2[1]),
  ];
}

function speed(c, t) {
  const d = derivativeAt(c, t);
  return Math.hypot(d[0], d[1]);
}

function gk15(c, a, b) {
  const center = 0.5 * (a + b);
  const half = 0.5 * (b - a);
  let k = WK[7] * speed(c, center);
  let g = WG[3] * speed(c, center);
  for (let i = 0; i < 7; i++) {
    const dx = half * XK[i];
    const f = speed(c, center - dx) + speed(c, center + dx);
    k += WK[i] * f;
    if (i % 2 === 1) g += WG[(i - 1) / 2] * f;
  }
  return { k: k * half, err: Math.abs((k - g) * half) };
}

function adaptive(c, a, b, depth) {
  const { k, err } = gk15(c, a, b);
  if (err <= ARC_LENGTH_TOLERANCE_MM * (b - a)) return k;
  if (depth >= MAX_DEPTH) throw new Error("arc-length quadrature did not converge");
  const m = 0.5 * (a + b);
  return adaptive(c, a, m, depth + 1) + adaptive(c, m, b, depth + 1);
}

/** Arc length between parameters t0 <= t1 (default: whole curve). */
export function arcLength(c, t0 = 0, t1 = 1) {
  if (c.kind === "line") return dist(c.p[0], c.p[1]) * (t1 - t0);
  if (t1 <= t0) return 0;
  return adaptive(c, t0, t1, 0);
}

/**
 * Parameter t at which the arc length from the curve start equals `s`.
 * Bisection to the resolution of binary64 (deterministic, 80 steps max).
 */
export function parameterAtLength(c, s) {
  const total = arcLength(c);
  if (s <= 0) return 0;
  if (s >= total) return 1;
  if (c.kind === "line") return s / total;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80 && hi - lo > 0; i++) {
    const mid = 0.5 * (lo + hi);
    if (mid === lo || mid === hi) break;
    if (arcLength(c, 0, mid) < s) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Roots of a*t^2 + b*t + c in the open interval (0, 1). */
function quadraticRootsInUnit(a, b, c) {
  const roots = [];
  const eps = 1e-14;
  if (Math.abs(a) < eps) {
    if (Math.abs(b) > eps) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      // Numerically stable form.
      const q = -0.5 * (b + Math.sign(b || 1) * sq);
      roots.push(q / a);
      if (q !== 0) roots.push(c / q);
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

/** Exact axis-aligned extrema (curve endpoints plus interior stationary points), not the control polygon. */
export function curveBounds(c) {
  const pts = [start(c), end(c)];
  if (c.kind === "cubic") {
    const [p0, p1, p2, p3] = c.p;
    for (const axis of [0, 1]) {
      // B'(t)/3 = a t^2 + b t + c
      const a = -p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis];
      const b = 2 * (p0[axis] - 2 * p1[axis] + p2[axis]);
      const cc = p1[axis] - p0[axis];
      for (const t of quadraticRootsInUnit(a, b, cc)) pts.push(pointAt(c, t));
    }
  }
  return {
    min: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))],
    max: [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))],
  };
}

export function unionBounds(boxes) {
  return {
    min: [Math.min(...boxes.map((b) => b.min[0])), Math.min(...boxes.map((b) => b.min[1]))],
    max: [Math.max(...boxes.map((b) => b.max[0])), Math.max(...boxes.map((b) => b.max[1]))],
  };
}

/** Power-basis coefficients [c0, c1, c2, c3] of one coordinate of a curve. */
function powerBasis(c, axis) {
  if (c.kind === "line") return [c.p[0][axis], c.p[1][axis] - c.p[0][axis], 0, 0];
  const [p0, p1, p2, p3] = c.p.map((p) => p[axis]);
  return [p0, 3 * (p1 - p0), 3 * (p0 - 2 * p1 + p2), -p0 + 3 * p1 - 3 * p2 + p3];
}

/**
 * Exact signed area contribution 1/2 * integral of (x dy - y dx) over the curve
 * (Green's theorem). Summed over a closed contour this is the enclosed area,
 * positive for counter-clockwise orientation.
 */
export function greenArea(c) {
  const x = powerBasis(c, 0);
  const y = powerBasis(c, 1);
  const dx = [x[1], 2 * x[2], 3 * x[3]];
  const dy = [y[1], 2 * y[2], 3 * y[3]];
  // integral_0^1 sum_{i,j} (x_i dy_j - y_i dx_j) t^(i+j) dt
  let s = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) s += (x[i] * dy[j] - y[i] * dx[j]) / (i + j + 1);
  }
  return 0.5 * s;
}

/** Direction angle of a vector, counter-clockwise from +X, normalized to (-pi, pi]. */
export function angleOf(v) {
  const a = Math.atan2(v[1], v[0]);
  return a === -Math.PI ? Math.PI : a;
}

/** Rigid instance transform of export-scene-2d: mirror X (piece coordinates), then rotate, then translate. */
export function transformPoint(p, t) {
  const x0 = t.mirror ? -p[0] : p[0];
  const y0 = p[1];
  const cos = Math.cos(t.rotateRad);
  const sin = Math.sin(t.rotateRad);
  return [x0 * cos - y0 * sin + t.translate[0], x0 * sin + y0 * cos + t.translate[1]];
}

export function transformCurve(c, t) {
  return { kind: c.kind, p: c.p.map((p) => transformPoint(p, t)) };
}

/** Dense polyline sampling, used only for the oracle's own sanity checks (never for expected values). */
export function sample(c, n) {
  if (c.kind === "line") return [c.p[0], c.p[1]];
  const out = [];
  for (let i = 0; i <= n; i++) out.push(pointAt(c, i / n));
  return out;
}

function orient(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

export function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True if a closed polyline (first point not repeated) has two non-adjacent intersecting segments. */
export function polylineSelfIntersects(points) {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the closing segment
      if (segmentsIntersect(a1, a2, points[j], points[(j + 1) % n])) return true;
    }
  }
  return false;
}
