// Builders for expression nodes (pattern/expression.schema.json).
export const lit = (value, unit = "mm") => ({ op: "literal", value, unit });
export const num = (value) => lit(value, "1");
export const rad = (value) => lit(value, "rad");
export const pi = () => ({ op: "constant", name: "pi" });
export const m = (key) => ({ op: "measurement", key });
export const p = (parameterId) => ({ op: "param", parameterId });
export const fo = (featureId, output) => ({ op: "featureOutput", featureId, output });
const op = (name) => (...args) => ({ op: name, args });
export const add = op("add");
export const sub = op("sub");
export const mul = op("mul");
export const div = op("div");
export const neg = op("neg");
export const max = op("max");
export const sqrt = op("sqrt");
export const cos = op("cos");
/** Wraps an expression into an exprValue object {expr}. */
export const ev = (expr) => ({ expr });
