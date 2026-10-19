// Diagnostic code registry (catalog §2.4) and diagnostic construction (§2.3).

/** The standard release the kit implements (catalog §1.11). */
export const STANDARD_VERSION = "1.0.0";

/** Registry default severities used by conformance runs (§2.5). */
export const CODE_SEVERITY = Object.freeze({
  "D2P-STR-001": "error",
  "D2P-STR-002": "error",
  "D2P-STR-003": "error",
  "D2P-STR-004": "error",
  "D2P-STR-010": "error",
  "D2P-STR-011": "error",
  "D2P-STR-012": "error",
  "D2P-REF-001": "error",
  "D2P-REF-002": "error",
  "D2P-REF-003": "error",
  "D2P-REF-004": "error",
  "D2P-REF-005": "error",
  "D2P-REF-006": "error",
  "D2P-REF-007": "error",
  "D2P-REF-008": "error",
  "D2P-REF-009": "error",
  "D2P-REF-010": "error",
  "D2P-REF-011": "error",
  "D2P-REF-012": "error",
  "D2P-REF-013": "error",
  "D2P-REF-014": "error",
  "D2P-REF-015": "error",
  "D2P-SEM-001": "error",
  "D2P-SEM-002": "error",
  "D2P-SEM-003": "error",
  "D2P-SEM-004": "warning",
  "D2P-SEM-005": "error",
  "D2P-SEM-006": "error",
  "D2P-SEM-007": "warning",
  "D2P-SEM-010": "error",
  "D2P-SEM-011": "error",
  "D2P-SEM-012": "error",
  "D2P-SEM-013": "error",
  "D2P-SEM-014": "error",
  "D2P-SEM-020": "error",
  "D2P-SEM-021": "error",
  "D2P-SEM-022": "error",
  "D2P-SEM-023": "error",
  "D2P-SEM-024": "error",
  "D2P-SEM-025": "error",
  "D2P-SEM-030": "error",
  "D2P-SEM-031": "error",
  "D2P-SEM-032": "error",
  "D2P-SEM-033": "error",
  "D2P-SEM-034": "error",
  "D2P-SEM-040": "error",
  "D2P-SEM-050": "critical",
  "D2P-SEM-051": "error",
  "D2P-SEM-070": "error",
  "D2P-SEM-071": "error",
  "D2P-SEM-072": "error",
  "D2P-SEM-073": "warning",
  "D2P-SEM-074": "warning",
  "D2P-SEM-075": "error",
  "D2P-SEM-080": "error",
  "D2P-SEM-090": "error",
  "D2P-SEM-091": "critical",
  "D2P-SEM-092": "error",
  "D2P-SEM-093": "error",
  "D2P-SEM-094": "error",
  "D2P-SEM-095": "error",
  "D2P-SEM-096": "error",
  "D2P-SEM-100": "error",
  "D2P-SEM-101": "error",
  "D2P-SEM-102": "error",
  "D2P-SEM-103": "error",
  "D2P-SEM-104": "error",
  "D2P-SEM-110": "error",
});

const LEVEL_OF_PREFIX = { STR: "structural", REF: "referential", SEM: "semantic" };

/** Conformance level a registry code belongs to (EVL codes are not run by the kit). */
export function levelOfCode(code) {
  const m = /^D2P-(STR|REF|SEM|EVL)-/.exec(code);
  return m ? (LEVEL_OF_PREFIX[m[1]] ?? "evaluator") : "extension";
}

/** Diagnostics of severity error or critical reject (§2.5). */
export function isRejecting(diagnostic) {
  return diagnostic.severity === "error" || diagnostic.severity === "critical";
}

/**
 * Creates a diagnostic object (core/diagnostic.schema.json). Messages never
 * contain raw personal measurement values.
 *
 * @param {string} code registry code
 * @param {string} message
 * @param {{documentPath?: string, instancePath?: string, elementRef?: object, details?: object}} [where]
 */
export function diagnostic(code, message, where = {}) {
  const severity = CODE_SEVERITY[code];
  if (!severity) throw new Error(`diagnostic code ${code} is not in the registry`);
  const d = { code, severity, message: message.length > 2000 ? `${message.slice(0, 1997)}...` : message };
  if (where.documentPath !== undefined) d.documentPath = where.documentPath;
  if (where.instancePath !== undefined) d.instancePath = where.instancePath;
  if (where.elementRef !== undefined) d.elementRef = where.elementRef;
  if (where.details !== undefined) d.details = where.details;
  return d;
}

/** Sorts diagnostics in the order of catalog §1.8 (code, documentPath, elementRef, instancePath, message). */
export function sortDiagnostics(list) {
  const key = (d) => [
    d.code,
    d.documentPath ?? "",
    d.elementRef?.artifactId ?? "",
    d.elementRef?.revisionId ?? "",
    d.elementRef?.elementId ?? "",
    d.instancePath ?? "",
    d.message,
  ];
  return [...list].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i += 1) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });
}

/**
 * SemVer precedence comparison for the `semver` pattern of core/ids (no build
 * metadata). Returns <0, 0 or >0.
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (const k of ["major", "minor", "patch"]) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1;
  }
  if (!pa.pre.length && !pb.pre.length) return 0;
  if (!pa.pre.length) return 1;
  if (!pb.pre.length) return -1;
  const n = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < n; i += 1) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^[0-9]+$/.test(x);
    const yn = /^[0-9]+$/.test(y);
    if (xn && yn) {
      const d = BigInt(x) - BigInt(y);
      if (d !== 0n) return d < 0n ? -1 : 1;
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

export function isSemver(v) {
  return typeof v === "string" && SEMVER_RE.test(v);
}

function parseSemver(v) {
  const m = SEMVER_RE.exec(v);
  if (!m) throw new Error(`not a semver: ${v}`);
  return {
    major: BigInt(m[1]),
    minor: BigInt(m[2]),
    patch: BigInt(m[3]),
    pre: m[4] ? m[4].slice(1).split(".") : [],
  };
}

/**
 * Version gate (§1.11, classifier C1): a consumer implementing release R
 * accepts document version D iff L(D) = L(R) and D <= R; a pre-release D is
 * accepted only by the identical pre-release.
 */
export function isCompatibleVersion(documentVersion, release = STANDARD_VERSION) {
  if (!isSemver(documentVersion)) return false;
  const d = parseSemver(documentVersion);
  const r = parseSemver(release);
  if (d.pre.length) return documentVersion === release;
  if (d.major !== r.major) return false;
  return compareSemver(documentVersion, release) <= 0;
}
