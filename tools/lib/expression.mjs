// Expression language (catalog §3.2.4): closed node list, dimension typing,
// complexity limits and constant evaluation for static constraint checks.
import { pointer } from "./json.mjs";
import { isObject } from "./model.mjs";
import { A, L, ONE } from "./pattern.mjs";

export const LEAF_OPS = Object.freeze(["literal", "constant", "param", "measurement", "featureOutput"]);
export const OPERATOR_OPS = Object.freeze([
  "add", "sub", "mul", "div", "neg", "abs", "min", "max", "clamp", "sqrt",
  "sin", "cos", "tan", "asin", "acos", "atan2", "lt", "le", "gt", "ge", "and", "or", "not", "if",
]);
/** The closed node list of feature set 1.0.0 (29 node kinds). */
export const CLOSED_OPS = new Set([...LEAF_OPS, ...OPERATOR_OPS]);

/** Limits of standard 1.0 (D2P-SEM-003). */
export const MAX_DEPTH = 64;
export const MAX_NODES = 1024;

export const BOOL = "boolean";

/**
 * Visits every node object of an expression tree (recursively through
 * `args`). `visit(node, ptr, depth)`.
 */
export function walkExpr(node, ptr, visit, depth = 1) {
  if (!isObject(node)) return;
  visit(node, ptr, depth);
  if (Array.isArray(node.args)) node.args.forEach((a, i) => walkExpr(a, pointer(ptr, "args", i), visit, depth + 1));
}

/** Depth and node count of one `expr` (root has depth 1). */
export function exprComplexity(node) {
  let maxDepth = 0;
  let nodes = 0;
  walkExpr(node, "", (_n, _p, depth) => {
    nodes += 1;
    if (depth > maxDepth) maxDepth = depth;
  });
  return { depth: maxDepth, nodes };
}

const eq = (a, b) => a !== null && b !== null && a !== BOOL && b !== BOOL && a[0] === b[0] && a[1] === b[1];
const isNum = (d) => Array.isArray(d);

export function dimToString(d) {
  if (d === null) return "unknown";
  if (d === BOOL) return "boolean";
  if (eq(d, L)) return "length";
  if (eq(d, A)) return "angle";
  if (eq(d, ONE)) return "dimensionless";
  return `L^${d[0]}·A^${d[1]}`;
}

/**
 * Infers the dimension of an expression. Unknown leaves (unresolvable
 * references, definitions outside the bundle) yield `null`, which never
 * produces a finding. Each mismatch is reported once, at the node where it
 * occurs; the node's result then becomes unknown so mismatches do not cascade.
 *
 * @param {object} node exprNode
 * @param {string} ptr JSON Pointer of the node
 * @param {{ param(id): any, measurement(key): any, featureOutput(featureId, output): any }} env
 * @param {(ptr: string, message: string) => void} report
 * @returns {[number, number] | "boolean" | null}
 */
export function inferDimension(node, ptr, env, report) {
  if (!isObject(node)) return null;
  const args = Array.isArray(node.args) ? node.args : [];
  const sub = () => args.map((a, i) => inferDimension(a, pointer(ptr, "args", i), env, report));
  const mismatch = (msg) => {
    report(ptr, `operator "${node.op}": ${msg}`);
    return null;
  };
  switch (node.op) {
    case "literal":
      return node.unit === "mm" ? L : node.unit === "rad" ? A : node.unit === "1" ? ONE : null;
    case "constant":
      return ONE;
    case "param":
      return env.param(node.parameterId);
    case "measurement":
      return env.measurement(node.key);
    case "featureOutput":
      return env.featureOutput(node.featureId, node.output);
    case "add":
    case "sub":
    case "min":
    case "max":
    case "clamp": {
      const ds = sub();
      if (ds.some((d) => d === BOOL)) return mismatch("boolean operand where a quantity is required");
      const known = ds.filter((d) => d !== null);
      if (known.length && !known.every((d) => eq(d, known[0]))) {
        return mismatch(`operands have different dimensions (${ds.map(dimToString).join(", ")})`);
      }
      return ds.includes(null) ? null : known[0] ?? null;
    }
    case "mul":
    case "div": {
      const ds = sub();
      if (ds.some((d) => d === BOOL)) return mismatch("boolean operand where a quantity is required");
      if (ds.includes(null)) return null;
      if (node.op === "mul") return ds.reduce((acc, d) => [acc[0] + d[0], acc[1] + d[1]], [0, 0]);
      return [ds[0][0] - ds[1][0], ds[0][1] - ds[1][1]];
    }
    case "neg":
    case "abs": {
      const [d] = sub();
      if (d === BOOL) return mismatch("boolean operand where a quantity is required");
      return d ?? null;
    }
    case "sqrt": {
      const [d] = sub();
      if (d === BOOL) return mismatch("boolean operand where a quantity is required");
      if (d === null) return null;
      if (d[0] % 2 !== 0 || d[1] % 2 !== 0) return mismatch(`argument dimension ${dimToString(d)} has odd exponents`);
      return [d[0] / 2, d[1] / 2];
    }
    case "sin":
    case "cos":
    case "tan": {
      const [d] = sub();
      if (d !== null && !eq(d, A)) return mismatch(`argument must be an angle, got ${dimToString(d)}`);
      return ONE;
    }
    case "asin":
    case "acos": {
      const [d] = sub();
      if (d !== null && !eq(d, ONE)) return mismatch(`argument must be dimensionless, got ${dimToString(d)}`);
      return A;
    }
    case "atan2": {
      const ds = sub();
      if (ds.some((d) => d === BOOL)) return mismatch("boolean operand where a quantity is required");
      if (ds[0] !== null && ds[1] !== null && !eq(ds[0], ds[1])) {
        return mismatch(`y and x have different dimensions (${ds.map(dimToString).join(", ")})`);
      }
      return A;
    }
    case "lt":
    case "le":
    case "gt":
    case "ge": {
      const ds = sub();
      if (ds.some((d) => d === BOOL)) return mismatch("boolean operand where a quantity is required");
      if (ds[0] !== null && ds[1] !== null && !eq(ds[0], ds[1])) {
        return mismatch(`compared operands have different dimensions (${ds.map(dimToString).join(", ")})`);
      }
      return BOOL;
    }
    case "and":
    case "or":
    case "not": {
      const ds = sub();
      if (ds.some((d) => d !== null && d !== BOOL)) return mismatch("operands must be boolean");
      return BOOL;
    }
    case "if": {
      const ds = sub();
      if (ds[0] !== null && ds[0] !== BOOL) return mismatch("condition must be boolean");
      if (ds[1] === BOOL || ds[2] === BOOL) return mismatch("branches must be quantities");
      if (ds[1] !== null && ds[2] !== null && !eq(ds[1], ds[2])) {
        return mismatch(`branches have different dimensions (${dimToString(ds[1])}, ${dimToString(ds[2])})`);
      }
      return ds[1] !== null && ds[2] !== null ? ds[1] : null;
    }
    default:
      return null;
  }
}

/** Compares an inferred dimension with the expected dimension of an `expr` slot. */
export function slotMismatch(actual, expected) {
  if (actual === null) return null;
  if (actual === BOOL) return "an expr slot never accepts a boolean result";
  if (expected && isNum(actual) && !eq(actual, expected)) {
    return `expression has dimension ${dimToString(actual)}, the slot expects ${dimToString(expected)}`;
  }
  return null;
}

/**
 * Evaluates a constant expression (only literal, constant and operators) in
 * binary64. Returns `undefined` when the expression is not constant or a
 * domain error occurs (a domain error is an evaluator concern, D2P-EVL-006).
 */
export function evaluateConstant(node) {
  if (!isObject(node)) return undefined;
  const args = Array.isArray(node.args) ? node.args.map(evaluateConstant) : [];
  if (args.some((v) => v === undefined)) return undefined;
  const num = (v) => (typeof v === "number" ? v : undefined);
  let r;
  switch (node.op) {
    case "literal":
      r = node.value;
      break;
    case "constant":
      r = node.name === "pi" ? Math.PI : undefined;
      break;
    case "add":
      r = args.reduce((a, b) => a + b, 0);
      break;
    case "sub":
      r = args[0] - args[1];
      break;
    case "mul":
      r = args.reduce((a, b) => a * b, 1);
      break;
    case "div":
      r = args[1] === 0 ? undefined : args[0] / args[1];
      break;
    case "neg":
      r = -args[0];
      break;
    case "abs":
      r = Math.abs(args[0]);
      break;
    case "min":
      r = Math.min(...args);
      break;
    case "max":
      r = Math.max(...args);
      break;
    case "clamp":
      r = Math.min(Math.max(args[0], args[1]), args[2]);
      break;
    case "sqrt":
      r = args[0] < 0 ? undefined : Math.sqrt(args[0]);
      break;
    case "sin":
      r = Math.sin(args[0]);
      break;
    case "cos":
      r = Math.cos(args[0]);
      break;
    case "tan":
      r = Math.tan(args[0]);
      break;
    case "asin":
      r = Math.abs(args[0]) > 1 ? undefined : Math.asin(args[0]);
      break;
    case "acos":
      r = Math.abs(args[0]) > 1 ? undefined : Math.acos(args[0]);
      break;
    case "atan2":
      r = Math.atan2(args[0], args[1]);
      break;
    case "lt":
      return args[0] < args[1];
    case "le":
      return args[0] <= args[1];
    case "gt":
      return args[0] > args[1];
    case "ge":
      return args[0] >= args[1];
    case "and":
      return args.every(Boolean);
    case "or":
      return args.some(Boolean);
    case "not":
      return !args[0];
    case "if":
      r = args[0] ? args[1] : args[2];
      break;
    default:
      return undefined;
  }
  r = num(r);
  return r !== undefined && Number.isFinite(r) ? r : undefined;
}
