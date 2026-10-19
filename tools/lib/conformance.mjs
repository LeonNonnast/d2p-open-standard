import path from "node:path";
import { BundleIndex, loadBundle } from "./bundle.mjs";
import { CONFORMANCE_LEVELS } from "./constants.mjs";
import { isRejecting, levelOfCode, sortDiagnostics } from "./diagnostics.mjs";
import { readJson, rel, walk } from "./fs.mjs";
import { checkReferential } from "./referential.mjs";
import { loadSchemaSet } from "./schemas.mjs";
import { checkSemantic } from "./semantic.mjs";
import { checkStructural } from "./structural.mjs";

const CASE_SUFFIX = ".case.json";
const CASE_DOCUMENT_TYPE = "d2p:conformance-case";
const LEVEL_RANK = { structural: 0, referential: 1, semantic: 2 };
const EDITABILITY_CODES = new Set(["D2P-SEM-004", "D2P-SEM-007"]);

/**
 * Runs the checks of every level up to `level` on a list of documents
 * (catalog §2.1): structural first; a higher level runs only when no lower
 * level reported a rejecting diagnostic (the higher levels need structurally
 * and referentially valid bundles).
 *
 * @param {string} root absolute repository root
 * @param {{path: string, role: string, value?: unknown, parseError?: string}[]} docs
 * @param {string} level
 * @returns {Promise<{diagnostics: object[], reached: string, stoppedBy?: string}>}
 */
export async function checkBundle(root, docs, level) {
  const schemas = await loadSchemaSet(root);
  if (schemas.loadErrors.length) throw new Error(`schemas do not load: ${schemas.loadErrors.join("; ")}`);
  const diagnostics = [];
  for (const doc of docs) diagnostics.push(...checkStructural(doc, schemas));
  if (level === "structural") return { diagnostics: sortDiagnostics(diagnostics), reached: "structural" };
  if (diagnostics.some(isRejecting)) return { diagnostics: sortDiagnostics(diagnostics), reached: "structural", stoppedBy: "structural" };

  const index = new BundleIndex(docs);
  diagnostics.push(...(await checkReferential(index, { root })));
  if (level === "referential") return { diagnostics: sortDiagnostics(diagnostics), reached: "referential" };
  if (diagnostics.some(isRejecting)) return { diagnostics: sortDiagnostics(diagnostics), reached: "referential", stoppedBy: "referential" };

  diagnostics.push(...checkSemantic(index));
  return { diagnostics: sortDiagnostics(diagnostics), reached: "semantic" };
}

/**
 * Validates a case file against benchmark/conformance-case.schema.json and the
 * rules the schema cannot express. Returns a list of problems.
 */
async function caseProblems(root, testCase, level) {
  const schemas = await loadSchemaSet(root);
  const validate = schemas.byDocumentType.get(CASE_DOCUMENT_TYPE);
  if (!validate) return [`schema for ${CASE_DOCUMENT_TYPE} is not available`];
  if (!validate(testCase)) return schemas.formatErrors(validate.errors).map((m) => `invalid case: ${m}`);
  const problems = [];
  if (testCase.level !== level) problems.push(`case level "${testCase.level}" does not match its directory level "${level}"`);
  const manifests = testCase.documents.filter((d) => d.role === "manifest");
  if (manifests.length > 1) problems.push("a case lists at most one manifest document");
  if (manifests.length && level === "structural") problems.push("a structural case never uses role manifest");
  if (!testCase.documents.some((d) => d.role === "subject" || d.role === "manifest")) problems.push("a case needs at least one subject or manifest document");
  if (testCase.expect.editability !== undefined && level !== "semantic") problems.push("editability is only observed at the semantic level");
  return problems;
}

/** Matches one expected diagnostic (§2.5). */
function matches(expected, d) {
  return (
    d.code === expected.code &&
    (expected.documentPath === undefined || d.documentPath === expected.documentPath) &&
    (expected.instancePath === undefined || d.instancePath === expected.instancePath)
  );
}

const describe = (d) => `${d.code}${d.documentPath ? ` ${d.documentPath}` : ""}${d.instancePath ? `#${d.instancePath}` : ""}`;

/**
 * Runs one conformance case at its level and compares the observation with
 * `expect` (§2.5).
 *
 * @param {string} root
 * @param {object} testCase parsed case document
 * @param {string} level
 */
export async function runCase(root, testCase, level) {
  const problems = await caseProblems(root, testCase, level);
  if (problems.length) return { state: "failed", message: problems.join("; ") };
  const { docs, caseErrors } = await loadBundle(root, testCase, level);
  if (caseErrors.length) return { state: "failed", message: caseErrors.join("; ") };

  const { diagnostics, stoppedBy } = await checkBundle(root, docs, level);
  const observedOutcome = diagnostics.some(isRejecting) ? "reject" : "accept";
  const expect = testCase.expect;
  const failures = [];

  if (observedOutcome !== expect.outcome) failures.push(`expected outcome ${expect.outcome}, observed ${observedOutcome}`);
  for (const e of expect.diagnostics) {
    if (!diagnostics.some((d) => matches(e, d))) failures.push(`expected diagnostic ${describe(e)} was not reported`);
  }
  // A lower-level failure the case does not expect is a precondition failure.
  const expectedCodes = new Set(expect.diagnostics.map((e) => e.code));
  const unexpectedLower = diagnostics.filter(
    (d) => isRejecting(d) && LEVEL_RANK[levelOfCode(d.code)] < LEVEL_RANK[level] && !expectedCodes.has(d.code),
  );
  if (unexpectedLower.length) {
    failures.push(`precondition failure at the ${stoppedBy ?? levelOfCode(unexpectedLower[0].code)} level: ${unexpectedLower.map(describe).join(", ")}`);
  }
  if (expect.editability !== undefined) {
    const subjects = new Set(docs.filter((d) => d.role === "subject").map((d) => d.path));
    const readOnly = diagnostics.some((d) => EDITABILITY_CODES.has(d.code) && subjects.has(d.documentPath));
    const observed = readOnly ? "read-only" : "editable";
    if (observed !== expect.editability) failures.push(`expected editability ${expect.editability}, observed ${observed}`);
  }

  const reported = diagnostics.map(describe);
  if (failures.length) {
    return {
      state: "failed",
      message: `${failures.join("; ")}${reported.length ? ` (reported: ${reported.join(", ")})` : " (nothing reported)"}`,
      diagnostics,
    };
  }
  const extra = diagnostics.filter((d) => !expect.diagnostics.some((e) => matches(e, d)));
  return {
    state: "passed",
    ...(extra.length ? { message: `note: additional diagnostics ${extra.map(describe).join(", ")}` } : {}),
    diagnostics,
  };
}

/**
 * Runners per conformance level. A runner receives a parsed case
 * (`{ file, data, root }`) and resolves to `{ state, message?, diagnostics? }`
 * where state is one of RESULT_STATES.
 *
 * @type {Record<string, ((testCase: {file: string, data: unknown, root: string}) => Promise<{state: string, message?: string}>) | null>}
 */
export const RUNNERS = {
  structural: ({ data, root }) => runCase(root, data, "structural"),
  referential: ({ data, root }) => runCase(root, data, "referential"),
  semantic: ({ data, root }) => runCase(root, data, "semantic"),
};

/**
 * Discovers and runs all cases of one conformance level. Each level is
 * independently runnable (design decision ADR-005). Cases are files named
 * `*.case.json` below `conformance/<level>/`.
 *
 * A level with zero cases passes and reports zero counts. A case for a
 * level without a runner fails: an unimplemented check must never look green.
 *
 * @param {string} root absolute repository root
 * @param {string} level one of CONFORMANCE_LEVELS
 * @param {typeof RUNNERS} [runners] injectable for tests
 */
export async function runConformance(root, level, runners = RUNNERS) {
  if (!CONFORMANCE_LEVELS.includes(level)) {
    throw new Error(`unknown conformance level "${level}" (expected one of: ${CONFORMANCE_LEVELS.join(", ")})`);
  }
  const files = (await walk(path.join(root, "conformance", level))).filter((f) => f.endsWith(CASE_SUFFIX));
  const runner = runners[level];
  const results = [];
  for (const abs of files) {
    const file = rel(root, abs);
    const parsed = await readJson(abs);
    if (!parsed.ok) {
      results.push({ file, state: "failed", message: parsed.error });
      continue;
    }
    if (!runner) {
      results.push({ file, state: "failed", message: `no runner implemented for level "${level}"` });
      continue;
    }
    try {
      results.push({ file, ...(await runner({ file, data: parsed.value, root })) });
    } catch (err) {
      results.push({ file, state: "failed", message: `runner error: ${err.message}` });
    }
  }
  const count = (state) => results.filter((r) => r.state === state).length;
  const summary = {
    level,
    discovered: files.length,
    passed: count("passed"),
    failed: count("failed"),
    inconclusive: count("inconclusive"),
    skipped: count("skipped"),
  };
  return { summary, results, ok: summary.failed === 0 && summary.inconclusive === 0 };
}
