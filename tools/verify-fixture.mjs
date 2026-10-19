#!/usr/bin/env node
// CLI: verifies a fixture before any comparison (QEV-001).
// Usage: node tools/verify-fixture.mjs [manifest path, repository-relative] [--json] [--root <dir>]
// Exit 0: fixture verified. Exit 1: refused (digest mismatch, unlisted or missing file, unresolved reference).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyFixture } from "./lib/fixture.mjs";

const DEFAULT_MANIFEST = "fixtures/golden-tshirt/v1/manifest.json";
const args = process.argv.slice(2);
const json = args.includes("--json");
const rootIdx = args.indexOf("--root");
const root = path.resolve(rootIdx >= 0 ? args[rootIdx + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const positional = args.filter((a, i) => !a.startsWith("--") && (rootIdx < 0 || i !== rootIdx + 1));
const manifestPath = positional[0] ?? DEFAULT_MANIFEST;

const { ok, diagnostics, docs } = await verifyFixture(root, manifestPath);
if (json) {
  process.stdout.write(`${JSON.stringify({ manifest: manifestPath, verified: ok, documents: docs.length, diagnostics }, null, 2)}\n`);
} else if (ok) {
  console.log(`fixture:verify: ${manifestPath} verified (${docs.length} document(s), all digests match)`);
} else {
  for (const d of diagnostics) console.error(`${d.code} ${d.documentPath ?? ""}${d.instancePath ? `#${d.instancePath}` : ""} ${d.message}`);
  console.error(`fixture:verify: ${manifestPath} REFUSED - do not compare against this fixture`);
}
process.exitCode = ok ? 0 : 1;
