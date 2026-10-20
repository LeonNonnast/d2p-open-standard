// Structural level (catalog §2.1, §2.2): version gate, document-type
// selection, JSON Schema validation and the structural classifiers C1-C5.
import { diagnostic, isCompatibleVersion, isSemver, STANDARD_VERSION } from "./diagnostics.mjs";
import { CLOSED_OPS, walkExpr } from "./expression.mjs";
import { embeddedDocuments, isObject, walkJson } from "./model.mjs";

const REVISION_ID_RE = /^rev_[0-9A-Za-z][0-9A-Za-z-]{0,63}$/;
const BENCHMARK_UNIT_TYPES = new Set(["d2p:test-run-report", "d2p:benchmark-run", "d2p:tolerance-profile", "d2p:sim-report"]);
const UNITS = new Set(["mm", "rad", "1"]);
const BENCHMARK_UNITS = new Set(["mm", "rad", "1", "ms", "byte", "count"]);
const MAX_MESSAGES_PER_PATH = 5;

/**
 * Runs the structural level on one document.
 *
 * @param {{path: string, value?: unknown, parseError?: string}} doc
 * @param {import("./schemas.mjs").SchemaSet} schemas
 * @returns {object[]} diagnostics
 */
export function checkStructural(doc, schemas) {
  const out = [];
  const report = (code, message, instancePath) => out.push(diagnostic(code, message, { documentPath: doc.path, instancePath }));

  if (doc.parseError !== undefined) {
    report("D2P-STR-004", doc.parseError);
    return out;
  }
  const value = doc.value;
  if (!isObject(value)) {
    report("D2P-STR-002", "the top-level value is not an object, so it has no documentType", "");
    return out;
  }

  // C1: version gate, evaluated before schema validation.
  let understood = true;
  const versionProblem = versionGate(value.schemaVersion);
  if (versionProblem) {
    report("D2P-STR-003", versionProblem, "/schemaVersion");
    understood = false;
  }

  // C2: documentType selects the schema.
  const validate = typeof value.documentType === "string" ? schemas.byDocumentType.get(value.documentType) : undefined;
  if (!validate) {
    report(
      "D2P-STR-002",
      value.documentType === undefined
        ? "documentType is missing"
        : `documentType ${JSON.stringify(value.documentType)} is not a registered document type`,
      value.documentType === undefined ? "" : "/documentType",
    );
  }

  // C1 for embedded documents: compatible and equal to the embedding version.
  const skippedEmbedded = [];
  if (understood) {
    for (const e of embeddedDocuments(value)) {
      const problem = versionGate(e.value.schemaVersion);
      if (problem) {
        report("D2P-STR-003", `embedded document: ${problem}`, `${e.pointer}/schemaVersion`);
        skippedEmbedded.push(e.pointer);
      } else if (e.value.schemaVersion !== value.schemaVersion) {
        report(
          "D2P-STR-003",
          `embedded document schemaVersion ${JSON.stringify(e.value.schemaVersion)} differs from the embedding document's ${JSON.stringify(value.schemaVersion)}`,
          `${e.pointer}/schemaVersion`,
        );
        skippedEmbedded.push(e.pointer);
      }
    }
  }

  if (!understood) return out;

  if (validate && !validate(value)) {
    const byPath = new Map();
    for (const err of validate.errors ?? []) {
      if (skippedEmbedded.some((p) => err.instancePath === p || err.instancePath.startsWith(`${p}/`))) continue;
      const msgs = byPath.get(err.instancePath) ?? new Set();
      const params = err.params && Object.keys(err.params).length ? ` ${JSON.stringify(err.params)}` : "";
      msgs.add(`${err.message}${params}`);
      byPath.set(err.instancePath, msgs);
    }
    for (const [instancePath, msgs] of byPath) {
      const list = [...msgs];
      const more = list.length > MAX_MESSAGES_PER_PATH ? ` (+${list.length - MAX_MESSAGES_PER_PATH} more)` : "";
      report("D2P-STR-001", `schema violation: ${list.slice(0, MAX_MESSAGES_PER_PATH).join("; ")}${more}`, instancePath);
    }
  }

  for (const d of classify(value)) report(d.code, d.message, d.instancePath);
  return out;
}

/** Returns a problem description when a schemaVersion fails the version gate (§1.11), else null. */
export function versionGate(version) {
  if (version === undefined) return "schemaVersion is missing";
  if (!isSemver(version)) return `schemaVersion ${JSON.stringify(version)} is not a SemVer version`;
  if (!isCompatibleVersion(version)) {
    return `schemaVersion ${version} is not compatible with release ${STANDARD_VERSION} (same major version and not newer required)`;
  }
  return null;
}

/**
 * Structural classifiers C3-C5 on the raw instance (independent of how the
 * schema validator reports errors). Open containers and extension data are
 * not inspected.
 */
export function classify(value) {
  const out = [];
  const units = BENCHMARK_UNIT_TYPES.has(value.documentType) ? BENCHMARK_UNITS : UNITS;
  walkJson(value, (node, ptr, key) => {
    // C3: closed expression node list.
    if (key === "expr") {
      walkExpr(node, ptr, (n, p) => {
        if (n.op === undefined) out.push({ code: "D2P-STR-010", message: "expression node has no op", instancePath: p });
        else if (!CLOSED_OPS.has(n.op)) {
          out.push({ code: "D2P-STR-010", message: `expression node op ${JSON.stringify(n.op)} is not in the closed node list (scripts and code are never allowed)`, instancePath: p });
        }
      });
      // Keep walking: C4 and C5 also apply inside expression trees (for example literal units).
    }
    if (typeof key === "string") {
      // C4: pinned references.
      if (key.endsWith("Ref") && isUnpinned(node)) {
        out.push({ code: "D2P-STR-011", message: `${key} names artifact ${JSON.stringify(node.artifactId)} without a pinned revisionId`, instancePath: ptr });
      }
      if (key.endsWith("Refs") && Array.isArray(node)) {
        node.forEach((item, i) => {
          if (isUnpinned(item)) {
            out.push({ code: "D2P-STR-011", message: `${key}[${i}] names artifact ${JSON.stringify(item.artifactId)} without a pinned revisionId`, instancePath: `${ptr}/${i}` });
          }
        });
      }
      // C5: permitted units.
      if (key === "unit" && typeof node === "string" && !units.has(node)) {
        out.push({ code: "D2P-STR-012", message: `unit ${JSON.stringify(node)} is not permitted (allowed: ${[...units].join(", ")})`, instancePath: ptr });
      }
    }
    return true;
  });
  return out;
}

function isUnpinned(v) {
  return isObject(v) && "artifactId" in v && !(typeof v.revisionId === "string" && REVISION_ID_RE.test(v.revisionId));
}
