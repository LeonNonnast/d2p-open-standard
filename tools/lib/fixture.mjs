// Fixture verification before comparison (test QEV-001: a fixture whose
// digests do not match is refused; no comparison against it may start).
import path from "node:path";
import { BundleIndex, loadBundle } from "./bundle.mjs";
import { checkBundle } from "./conformance.mjs";
import { isRejecting, sortDiagnostics } from "./diagnostics.mjs";
import { checkReferential } from "./referential.mjs";

/** Diagnostic codes that mean the fixture content is not the one its manifest pins. */
export const INTEGRITY_CODES = Object.freeze(["D2P-REF-011", "D2P-REF-012"]);

/**
 * Verifies a fixture manifest and its expanded bundle at the referential level
 * (catalog §2.1, §2.5): structural validity of every listed document, manifest
 * integrity (digests, unlisted or missing files, `fixtureDigest`) and reference
 * resolution.
 *
 * Manifest integrity is checked even when a listed document is structurally
 * invalid (which stops the referential level of the conformance runners), so
 * a changed file is always reported with its digest mismatch.
 *
 * @param {string} root absolute repository root
 * @param {string} manifestPath repository-relative POSIX path of the manifest
 * @returns {Promise<{ok: boolean, diagnostics: object[], integrity: object[], docs: object[]}>}
 *   `ok` is false if any rejecting diagnostic is reported; `integrity` lists
 *   the D2P-REF-011/-012 diagnostics.
 */
export async function verifyFixture(root, manifestPath) {
  const testCase = { documents: [{ path: manifestPath, role: "manifest" }] };
  const { docs, caseErrors } = await loadBundle(root, testCase, "referential");
  if (caseErrors.length) throw new Error(caseErrors.join("; "));
  const { diagnostics: bundleDiagnostics } = await checkBundle(root, docs, "referential");

  // Integrity of the manifest alone, independent of the listed documents' validity.
  const manifestDoc = docs.filter((d) => d.role === "manifest");
  const manifestOnly = await checkBundle(root, manifestDoc, "structural");
  const integrity = manifestOnly.diagnostics.some(isRejecting)
    ? []
    : (await checkReferential(new BundleIndex(manifestDoc), { root })).filter((d) => INTEGRITY_CODES.includes(d.code));

  const key = (d) => `${d.code}|${d.documentPath}|${d.instancePath}|${d.message}`;
  const seen = new Set(bundleDiagnostics.map(key));
  const diagnostics = sortDiagnostics([...bundleDiagnostics, ...integrity.filter((d) => !seen.has(key(d)))]);
  return {
    ok: !diagnostics.some(isRejecting),
    diagnostics,
    integrity: diagnostics.filter((d) => INTEGRITY_CODES.includes(d.code)),
    docs,
  };
}

/** Thrown by `openFixtureForComparison` when a fixture fails verification. */
export class FixtureRefusedError extends Error {
  constructor(manifestPath, diagnostics) {
    const shown = diagnostics
      .filter(isRejecting)
      .slice(0, 10)
      .map((d) => `${d.code}${d.documentPath ? ` ${d.documentPath}` : ""}${d.instancePath ? `#${d.instancePath}` : ""}`);
    super(`fixture ${manifestPath} refused for comparison: ${shown.join(", ")}`);
    this.name = "FixtureRefusedError";
    this.manifestPath = manifestPath;
    this.diagnostics = diagnostics;
  }
}

/**
 * The only supported way to obtain fixture documents for a comparison. It
 * verifies the fixture first and throws `FixtureRefusedError` if any digest,
 * listed file or reference does not match (QEV-001), so an implementation
 * is never compared against altered expected results.
 *
 * @returns {Promise<{manifest: object, inputs: Map<string, object>, expected: Map<string, object>}>}
 *   maps from manifest-relative path to parsed document
 */
export async function openFixtureForComparison(root, manifestPath) {
  const result = await verifyFixture(root, manifestPath);
  if (!result.ok) throw new FixtureRefusedError(manifestPath, result.diagnostics);
  const manifestDoc = result.docs.find((d) => d.role === "manifest");
  const dir = path.posix.dirname(manifestPath);
  const byPath = new Map(result.docs.map((d) => [d.path, d.value]));
  const inputs = new Map();
  const expected = new Map();
  for (const f of manifestDoc.value.files) {
    const target = f.role === "input" ? inputs : f.role === "expected" ? expected : null;
    if (target) target.set(f.path, byPath.get(path.posix.join(dir, f.path)));
  }
  return { manifest: manifestDoc.value, inputs, expected };
}
