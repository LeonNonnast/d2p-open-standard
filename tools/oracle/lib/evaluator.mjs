// Generic interpreter for the subset of feature set 1.0.0 used by the Golden
// T-Shirt: typed expressions (closed node list, dimension checking) and the
// feature types d2p:point.absolute, d2p:point.offset, d2p:point.polar,
// d2p:line and d2p:bezier.cubic. Any other feature type is refused.
//
// It evaluates a pattern document exactly as serialized, so the expected
// results are derived from the published input files, not from the oracle's
// own construction code (which is checked against it, see construction.mjs).
import { arcLength, cubic, line } from "./geometry.mjs";

const L = [1, 0];
const A = [0, 1];
const ONE = [0, 0];
const sameDim = (a, b) => a[0] === b[0] && a[1] === b[1];
const dimName = (d) => (sameDim(d, L) ? "length" : sameDim(d, A) ? "angle" : sameDim(d, ONE) ? "dimensionless" : `L^${d[0]} A^${d[1]}`);
const DIMENSIONS = { length: L, angle: A, dimensionless: ONE };
const UNIT_DIM = { mm: L, rad: A, 1: ONE };

const FEATURE_OUTPUT_DIM = {
  "d2p:point.absolute": { x: L, y: L },
  "d2p:point.offset": { x: L, y: L },
  "d2p:point.polar": { x: L, y: L },
  "d2p:line": { length: L, angle: A },
  "d2p:bezier.cubic": { length: L },
};

export class EvaluationError extends Error {}

/**
 * @param {object} pattern d2p:pattern content document
 * @param {Record<string, number>} measurementValues value in mm per measurement input key
 * @param {Record<string, string>} definitionDimensions dimension name per definitionId (from the registry)
 */
export function evaluatePattern(pattern, measurementValues, definitionDimensions) {
  const params = new Map(pattern.parameters.map((p) => [p.id, p]));
  const inputs = new Map(pattern.measurementInputs.map((m) => [m.key, m]));
  const features = new Map(pattern.features.map((f) => [f.id, f]));
  const paramValues = new Map();
  const featureValues = new Map();
  const visiting = new Set();

  const enter = (id) => {
    if (visiting.has(id)) throw new EvaluationError(`dependency cycle at ${id}`);
    visiting.add(id);
  };
  const leave = (id) => visiting.delete(id);

  function param(id) {
    if (paramValues.has(id)) return paramValues.get(id);
    const p = params.get(id);
    if (!p) throw new EvaluationError(`unknown parameter ${id}`);
    enter(id);
    const r = expr(p.expr);
    leave(id);
    if (r.bool !== undefined || !sameDim(r.d, DIMENSIONS[p.dimension])) {
      throw new EvaluationError(`parameter ${id}: expected ${p.dimension}, got ${r.bool !== undefined ? "boolean" : dimName(r.d)}`);
    }
    paramValues.set(id, r);
    return r;
  }

  function measurement(key) {
    const input = inputs.get(key);
    if (!input) throw new EvaluationError(`unknown measurement input ${key}`);
    const dimension = definitionDimensions[input.definitionId];
    if (!dimension) throw new EvaluationError(`unresolved measurement definition ${input.definitionId}`);
    if (!(key in measurementValues)) throw new EvaluationError(`no value for required measurement input ${key}`);
    return { v: measurementValues[key], d: DIMENSIONS[dimension] };
  }

  function featureOutput(featureId, output) {
    const f = features.get(featureId);
    if (!f) throw new EvaluationError(`unknown feature ${featureId}`);
    const dims = FEATURE_OUTPUT_DIM[f.type];
    if (!dims || !dims[output]) throw new EvaluationError(`feature ${featureId} (${f.type}) has no output ${output}`);
    const value = feature(featureId);
    switch (output) {
      case "x":
        return { v: value.point[0], d: L };
      case "y":
        return { v: value.point[1], d: L };
      case "length":
        return { v: value.length, d: L };
      case "angle":
        return { v: value.angle, d: A };
      default:
        throw new EvaluationError(`unsupported output ${output}`);
    }
  }

  function num(node) {
    const r = expr(node);
    if (r.bool !== undefined) throw new EvaluationError(`boolean where a number is required (op ${node.op})`);
    return r;
  }

  function finite(v, op) {
    if (!Number.isFinite(v)) throw new EvaluationError(`non-finite result of ${op}`);
    return v;
  }

  function expr(node) {
    switch (node.op) {
      case "literal":
        return { v: node.value, d: UNIT_DIM[node.unit] };
      case "constant":
        if (node.name !== "pi") throw new EvaluationError(`unknown constant ${node.name}`);
        return { v: Math.PI, d: ONE };
      case "param":
        return param(node.parameterId);
      case "measurement":
        return measurement(node.key);
      case "featureOutput":
        return featureOutput(node.featureId, node.output);
      default:
        break;
    }
    const args = node.args;
    const need = (n) => {
      if (args.length !== n) throw new EvaluationError(`${node.op} needs ${n} arguments`);
    };
    const equalDims = (rs) => {
      for (const r of rs) {
        if (!sameDim(r.d, rs[0].d)) throw new EvaluationError(`dimension mismatch in ${node.op}: ${dimName(rs[0].d)} vs ${dimName(r.d)}`);
      }
      return rs[0].d;
    };
    switch (node.op) {
      case "add": {
        const rs = args.map(num);
        return { v: rs.reduce((s, r) => s + r.v, 0), d: equalDims(rs) };
      }
      case "sub": {
        need(2);
        const rs = args.map(num);
        return { v: rs[0].v - rs[1].v, d: equalDims(rs) };
      }
      case "mul": {
        const rs = args.map(num);
        return { v: rs.reduce((s, r) => s * r.v, 1), d: rs.reduce((d, r) => [d[0] + r.d[0], d[1] + r.d[1]], [0, 0]) };
      }
      case "div": {
        need(2);
        const [a, b] = args.map(num);
        if (b.v === 0) throw new EvaluationError("division by zero");
        return { v: finite(a.v / b.v, "div"), d: [a.d[0] - b.d[0], a.d[1] - b.d[1]] };
      }
      case "neg": {
        need(1);
        const a = num(args[0]);
        return { v: -a.v, d: a.d };
      }
      case "abs": {
        need(1);
        const a = num(args[0]);
        return { v: Math.abs(a.v), d: a.d };
      }
      case "min":
      case "max": {
        const rs = args.map(num);
        const d = equalDims(rs);
        return { v: (node.op === "min" ? Math.min : Math.max)(...rs.map((r) => r.v)), d };
      }
      case "clamp": {
        need(3);
        const rs = args.map(num);
        const d = equalDims(rs);
        return { v: Math.min(Math.max(rs[0].v, rs[1].v), rs[2].v), d };
      }
      case "sqrt": {
        need(1);
        const a = num(args[0]);
        if (a.d[0] % 2 !== 0 || a.d[1] % 2 !== 0) throw new EvaluationError("sqrt of a dimension with odd exponents");
        if (a.v < 0) throw new EvaluationError("sqrt of a negative value");
        return { v: Math.sqrt(a.v), d: [a.d[0] / 2, a.d[1] / 2] };
      }
      case "sin":
      case "cos":
      case "tan": {
        need(1);
        const a = num(args[0]);
        if (!sameDim(a.d, A)) throw new EvaluationError(`${node.op} needs an angle`);
        return { v: finite(Math[node.op](a.v), node.op), d: ONE };
      }
      case "asin":
      case "acos": {
        need(1);
        const a = num(args[0]);
        if (!sameDim(a.d, ONE)) throw new EvaluationError(`${node.op} needs a dimensionless argument`);
        if (a.v < -1 || a.v > 1) throw new EvaluationError(`${node.op} out of domain`);
        return { v: Math[node.op](a.v), d: A };
      }
      case "atan2": {
        need(2);
        const rs = args.map(num);
        equalDims(rs);
        return { v: Math.atan2(rs[0].v, rs[1].v), d: A };
      }
      default:
        // Comparisons, boolean operators and "if" are part of the closed node
        // list but not used by this fixture; refusing them keeps the oracle small.
        throw new EvaluationError(`operator ${node.op} is not supported by the Golden T-Shirt oracle`);
    }
  }

  function length(node, what) {
    const r = num(node);
    if (!sameDim(r.d, L)) throw new EvaluationError(`${what}: expected length, got ${dimName(r.d)}`);
    return r.v;
  }
  function angle(node, what) {
    const r = num(node);
    if (!sameDim(r.d, A)) throw new EvaluationError(`${what}: expected angle, got ${dimName(r.d)}`);
    return r.v;
  }
  function point(id) {
    const v = feature(id);
    if (!v.point) throw new EvaluationError(`${id} is not a point feature`);
    return v.point;
  }

  function feature(id) {
    if (featureValues.has(id)) return featureValues.get(id);
    const f = features.get(id);
    if (!f) throw new EvaluationError(`unknown feature ${id}`);
    enter(id);
    const p = f.params;
    let value;
    switch (f.type) {
      case "d2p:point.absolute":
        value = { point: [length(p.x.expr, `${id}.x`), length(p.y.expr, `${id}.y`)] };
        break;
      case "d2p:point.offset": {
        const base = point(p.baseFeatureId);
        value = { point: [base[0] + length(p.dx.expr, `${id}.dx`), base[1] + length(p.dy.expr, `${id}.dy`)] };
        break;
      }
      case "d2p:point.polar": {
        const base = point(p.baseFeatureId);
        const d = length(p.distance.expr, `${id}.distance`);
        const a = angle(p.angle.expr, `${id}.angle`);
        value = { point: [base[0] + d * Math.cos(a), base[1] + d * Math.sin(a)] };
        break;
      }
      case "d2p:line": {
        const c = line(point(p.startFeatureId), point(p.endFeatureId));
        const dx = c.p[1][0] - c.p[0][0];
        const dy = c.p[1][1] - c.p[0][1];
        value = { curve: c, startId: p.startFeatureId, endId: p.endFeatureId, length: arcLength(c), angle: Math.atan2(dy, dx) };
        break;
      }
      case "d2p:bezier.cubic": {
        const c = cubic(point(p.startFeatureId), point(p.control1FeatureId), point(p.control2FeatureId), point(p.endFeatureId));
        value = { curve: c, startId: p.startFeatureId, endId: p.endFeatureId, length: arcLength(c) };
        break;
      }
      default:
        throw new EvaluationError(`feature type ${f.type} is not supported by the Golden T-Shirt oracle`);
    }
    leave(id);
    featureValues.set(id, value);
    return value;
  }

  // Evaluate everything (features and parameters) so that every expression is
  // dimension-checked, including construction-only features.
  for (const p of pattern.parameters) param(p.id);
  for (const f of pattern.features) feature(f.id);

  return {
    param: (id) => param(id).v,
    feature,
    point,
    curve: (id) => {
      const v = feature(id);
      if (!v.curve) throw new EvaluationError(`${id} is not a curve feature`);
      return v;
    },
    /** Value of a stand-alone expression (seam ease amounts, seam allowances). */
    lengthExpr: (node, what) => length(node, what),
  };
}
