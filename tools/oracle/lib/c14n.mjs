// Canonical form d2p-c14n-v1 and digest profile d2p-digest-v1
// (specifications/schema-catalog.md section 1.8). Pure Node, no dependencies.
import { createHash } from "node:crypto";

const FRACTION_DIGITS = 9;

/** Expands ECMAScript exponent notation of a small number ("2.5e-9") into a plain decimal string. */
function plainDecimal(text) {
  const m = /^(-?)(\d)(?:\.(\d+))?e-(\d+)$/.exec(text);
  if (!m) return text;
  const [, sign, lead, frac = "", exp] = m;
  return `${sign}0.${"0".repeat(Number(exp) - 1)}${lead}${frac}`;
}

/**
 * Quantizes a number per d2p-c14n-v1 step 3: shortest round-trip decimal,
 * rounded half-to-even to 9 fractional digits, converted back to binary64.
 * -0 maps to 0. Integers are unaffected.
 */
export function quantize(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`non-finite number: ${n}`);
  if (n === 0) return 0;
  if (Number.isInteger(n)) return n;
  let text = plainDecimal(String(n));
  const negative = text.startsWith("-");
  if (negative) text = text.slice(1);
  const [intPart, fracPart = ""] = text.split(".");
  let result;
  if (fracPart.length <= FRACTION_DIGITS) {
    result = Number(text);
  } else {
    const keep = fracPart.slice(0, FRACTION_DIGITS);
    const rest = fracPart.slice(FRACTION_DIGITS);
    let roundUp;
    if (rest[0] > "5") roundUp = true;
    else if (rest[0] < "5") roundUp = false;
    else if (/[1-9]/.test(rest.slice(1))) roundUp = true;
    else roundUp = Number(keep[FRACTION_DIGITS - 1]) % 2 === 1; // exact tie: half-to-even
    let digits = BigInt(intPart + keep);
    if (roundUp) digits += 1n;
    const s = digits.toString().padStart(FRACTION_DIGITS + 1, "0");
    result = Number(`${s.slice(0, -FRACTION_DIGITS)}.${s.slice(-FRACTION_DIGITS)}`);
  }
  const signed = negative ? -result : result;
  return signed === 0 ? 0 : signed;
}

/** Deep copy with every number quantized (used for canonical forms and for writing derived numbers). */
export function quantizeDeep(value) {
  if (typeof value === "number") return quantize(value);
  if (Array.isArray(value)) return value.map(quantizeDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = quantizeDeep(v);
    return out;
  }
  return value;
}

/** RFC 8785 (JCS) serialization of an already quantized JSON value. */
export function jcs(value) {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new Error("non-finite number in canonical form");
      return Object.is(value, -0) ? "0" : String(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
      // Default string sort compares UTF-16 code units, as JCS requires.
      const keys = Object.keys(value).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs(value[k])}`).join(",")}}`;
    }
    default:
      throw new Error(`value of type ${typeof value} is not JSON`);
  }
}

/** Canonical form d2p-c14n-v1 with optional top-level member exclusions. */
export function canonicalForm(doc, excludedMembers = []) {
  let value = doc;
  if (excludedMembers.length > 0 && doc && typeof doc === "object" && !Array.isArray(doc)) {
    value = Object.fromEntries(Object.entries(doc).filter(([k]) => !excludedMembers.includes(k)));
  }
  return jcs(quantizeDeep(value));
}

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** d2p-digest-v1 digest of a JSON value. */
export function digest(doc, excludedMembers = []) {
  return `sha256:${sha256Hex(canonicalForm(doc, excludedMembers))}`;
}

/** Digest kinds of catalog section 1.8. */
export const digests = {
  /** revision.contentDigest / inputDigests[].digest with artifactRef: the content document without its own contentDigest. */
  content: (doc) => digest(doc, ["contentDigest"]),
  /** resultDigest: without contentDigest, resultDigest, the own ID member and every top-level member ending in "At". */
  result: (doc, idMember) =>
    digest(
      doc,
      Object.keys(doc).filter((k) => k === "contentDigest" || k === "resultDigest" || k === idMember || k.endsWith("At")),
    ),
  /** geometry-snapshot.geometryDigest over {units, pieces, interfaces, seams}. */
  geometry: (snapshot) =>
    digest({ units: snapshot.units, pieces: snapshot.pieces, interfaces: snapshot.interfaces, seams: snapshot.seams }),
  /** fixture-manifest.fixtureDigest. */
  fixture: (manifest) => digest(manifest, ["fixtureDigest"]),
  /** Whole-file digest (manifest files, external files, tolerance pin, id-based input digests). */
  file: (doc) => digest(doc),
};

/** Test vectors of catalog section 1.8; the oracle refuses to run if any fails. */
export const TEST_VECTORS = [
  {
    input: '{"b":[1.0000000004,2.0000000005,-0.0],"a":"x"}',
    canonical: '{"a":"x","b":[1,2,0]}',
    digest: "sha256:e6636f36dab7c2a4bb2d6dd5b9784027f39dab43dd872092166fea5a73967c56",
  },
  {
    input: '{"y":0.30000000000000004,"x":123.4567891235,"z":1e-10,"w":-2.5e-9}',
    canonical: '{"w":-2e-9,"x":123.456789124,"y":0.3,"z":0}',
    digest: "sha256:3b8f1b665dfb9410c85014bd59056fae1e93559b102e6992d0337749b69a9895",
  },
  {
    input: '{"units":{"length":"mm","angle":"rad"},"pieces":[]}',
    canonical: '{"pieces":[],"units":{"angle":"rad","length":"mm"}}',
    digest: "sha256:096f11b5acef4032a893ccf25a958086a21cf14b8236d935fbba814a7c01cc0f",
  },
];

export function selfTest() {
  for (const v of TEST_VECTORS) {
    const parsed = JSON.parse(v.input);
    const c = canonicalForm(parsed);
    if (c !== v.canonical) throw new Error(`c14n test vector failed: ${v.input} -> ${c}`);
    const d = digest(parsed);
    if (d !== v.digest) throw new Error(`digest test vector failed: ${v.input} -> ${d}`);
  }
}
