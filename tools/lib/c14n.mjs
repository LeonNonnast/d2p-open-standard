// Canonical form d2p-c14n-v1 and digest profile d2p-digest-v1 (catalog §1.8).
import { createHash } from "node:crypto";

const FRACTION_DIGITS = 9n;
const SCALE = 10n ** FRACTION_DIGITS;

/**
 * Parses the shortest round-trip decimal representation of a finite number
 * into an exact `{ mantissa, exponent }` pair (value = mantissa × 10^exponent).
 */
function decimalOf(n) {
  const s = String(n);
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(s);
  if (!m) throw new Error(`cannot parse number representation "${s}"`);
  const [, sign, intPart, fracPart = "", expPart = "0"] = m;
  const mantissa = BigInt(`${sign}${intPart}${fracPart}`);
  const exponent = Number(expPart) - fracPart.length;
  return { mantissa, exponent };
}

/** Rounds `num / den` (den > 0) half-to-even to an integer. */
function divRoundHalfEven(num, den) {
  const negative = num < 0n;
  const a = negative ? -num : num;
  let q = a / den;
  const r = a % den;
  const twice = 2n * r;
  if (twice > den || (twice === den && q % 2n === 1n)) q += 1n;
  return negative ? -q : q;
}

/**
 * Quantizes a number to 9 fractional digits of its decimal representation,
 * rounding half-to-even, and maps -0 to 0 (§1.8 step 3).
 */
export function quantize(n) {
  if (!Number.isFinite(n)) throw new Error("numbers must be finite");
  if (n === 0) return 0;
  const { mantissa, exponent } = decimalOf(n);
  if (exponent >= -Number(FRACTION_DIGITS)) return n;
  const shift = 10n ** BigInt(-exponent - Number(FRACTION_DIGITS));
  const q = divRoundHalfEven(mantissa, shift);
  const out = Number(`${q}e-${FRACTION_DIGITS}`);
  return out === 0 ? 0 : out;
}

/**
 * Exact scaled integer (value × 10^9) of a number after quantization.
 * Used for exact geometric predicates on quantized coordinates.
 */
export function scaledInteger(n) {
  const { mantissa, exponent } = decimalOf(quantize(n));
  const e = exponent + Number(FRACTION_DIGITS);
  if (e >= 0) return mantissa * 10n ** BigInt(e);
  // Cannot happen after quantization, kept for safety.
  return divRoundHalfEven(mantissa, 10n ** BigInt(-e));
}

/** Serializes a JSON value per d2p-c14n-v1 (quantization + RFC 8785). */
export function canonicalize(value) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    const q = quantize(value);
    return String(q);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    // Default sort compares UTF-16 code units, as RFC 8785 requires.
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
  }
  throw new Error(`value of type ${typeof value} is not JSON`);
}

/** Returns a shallow copy of an object without the given top-level members. */
export function withoutMembers(obj, excluded) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (!excluded.includes(k)) out[k] = v;
  return out;
}

/** `sha256:<hex>` of UTF-8 bytes or a string. */
export function sha256(data) {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

/** Digest of the canonical form of a JSON value, optionally excluding top-level members. */
export function digestOf(value, excluded = []) {
  const v = excluded.length && value && typeof value === "object" && !Array.isArray(value) ? withoutMembers(value, excluded) : value;
  return sha256(canonicalize(v));
}

/** Document types that carry a resultDigest (§1.8). */
export const RESULT_DIGEST_TYPES = new Set([
  "d2p:pattern-evaluation",
  "d2p:fit-evaluation-report",
  "d2p:validation-report",
  "d2p:gate-evaluation",
  "d2p:export-scene-2d",
  "d2p:print-job-spec",
  "d2p:panel-mesh-result",
  "d2p:sim-report",
  "d2p:inspect-3d-edit-result",
]);

/** Recomputes a document's resultDigest: excludes contentDigest, resultDigest, the own ID and every top-level member ending in At. */
export function resultDigestOf(doc, ownIdMembers) {
  const excluded = ["contentDigest", "resultDigest", ...ownIdMembers, ...Object.keys(doc).filter((k) => k.endsWith("At"))];
  return digestOf(doc, excluded);
}

/** Recomputes a geometry snapshot's geometryDigest. */
export function geometryDigestOf(snapshot) {
  return digestOf({ units: snapshot.units, pieces: snapshot.pieces, interfaces: snapshot.interfaces, seams: snapshot.seams });
}

/** Members of a 3D scene snapshot (or scene expectation) covered by bindingsDigest (§1.8). */
export const SCENE_BINDING_MEMBERS = Object.freeze(["coordinateSystem", "sceneUnit", "unitConversion", "panelBindings", "seamBindings", "controlMeasures"]);

/** Recomputes a scene snapshot's (or scene expectation's) bindingsDigest. */
export function bindingsDigestOf(doc) {
  return digestOf(Object.fromEntries(SCENE_BINDING_MEMBERS.map((m) => [m, doc[m]])));
}

/** Recomputes a scene snapshot's sceneDigest: the binding members plus meshRefs. */
export function sceneDigestOf(snapshot) {
  return digestOf(Object.fromEntries([...SCENE_BINDING_MEMBERS, "meshRefs"].map((m) => [m, snapshot[m]])));
}

/** Recomputes a panel mesh result's meshDigest: the digest of its mesh object. */
export function meshDigestOf(result) {
  return digestOf(result.mesh);
}

/** Recomputes a scene input's evaluationKey: without its own ID, contentDigest, evaluationKey and members ending in At. */
export function evaluationKeyOf(input) {
  return digestOf(input, ["sceneInputId", "contentDigest", "evaluationKey", ...Object.keys(input).filter((k) => k.endsWith("At"))]);
}

/** Recomputes a document's contentDigest (whole document without contentDigest). */
export function contentDigestOf(doc) {
  return digestOf(doc, ["contentDigest"]);
}
