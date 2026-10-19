#!/usr/bin/env node
// Validates every Golden T-Shirt v1 fixture file against the schema selected by
// its documentType (strict Ajv configuration of tools/lib/ajv.mjs):
//   - manifest.json, inputs/** and expected/** MUST be valid;
//   - negative/<name>/case.json MUST be a valid d2p:conformance-case;
//   - negative subjects of structural cases that expect D2P-STR-001 MUST be
//     invalid, subjects of D2P-STR-003 cases MUST carry an incompatible
//     schemaVersion, and every other negative subject MUST be schema-valid
//     (its defect is referential or semantic).
// Usage: node tools/oracle/schema-check.mjs [root]
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAjv, formatAjvErrors } from "../lib/ajv.mjs";

const rootArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const root = path.resolve(rootArg ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".."));
const FIXTURE = "fixtures/golden-tshirt/v1";

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile()) out.push(full);
  }
  return out.sort();
}
const rel = (abs) => path.relative(root, abs).split(path.sep).join("/");
const readJson = (abs) => JSON.parse(readFileSync(abs, "utf8"));

const ajv = createAjv();
const byType = new Map();
for (const abs of walk(path.join(root, "schemas")).filter((f) => f.endsWith(".schema.json"))) {
  const schema = readJson(abs);
  ajv.addSchema(schema);
  const t = schema.properties?.documentType?.const;
  if (t) byType.set(t, schema.$id);
}

const errors = [];
let checked = 0;
function validate(abs, doc) {
  const id = byType.get(doc.documentType);
  if (!id) return { ok: false, messages: [`unknown documentType ${JSON.stringify(doc.documentType)}`] };
  const fn = ajv.getSchema(id);
  const ok = fn(doc);
  return { ok, messages: ok ? [] : formatAjvErrors(fn.errors) };
}

const fixtureFiles = walk(path.join(root, FIXTURE)).filter((f) => f.endsWith(".json"));
const cases = new Map();
for (const abs of fixtureFiles) {
  const r = rel(abs);
  if (r.includes("/negative/") && path.basename(r) === "case.json") cases.set(r, readJson(abs));
}
const negativeExpectation = new Map(); // subject path -> codes
for (const [, c] of cases) {
  for (const d of c.documents) if (d.role === "subject") negativeExpectation.set(d.path, c.expect.diagnostics.map((x) => x.code));
}

for (const abs of fixtureFiles) {
  const r = rel(abs);
  const doc = readJson(abs);
  checked += 1;
  const res = validate(abs, doc);
  const isNegativeSubject = r.includes("/negative/") && path.basename(r) !== "case.json";
  if (!isNegativeSubject) {
    if (!res.ok) for (const m of res.messages) errors.push(`${r}: ${m}`);
    continue;
  }
  const codes = negativeExpectation.get(r);
  if (!codes) {
    errors.push(`${r}: negative file is not a subject of its case.json`);
    continue;
  }
  if (codes.includes("D2P-STR-003")) {
    if (doc.schemaVersion === "1.0.0") errors.push(`${r}: expected an incompatible schemaVersion`);
  } else if (codes.includes("D2P-STR-001")) {
    if (res.ok) errors.push(`${r}: expected a schema violation (D2P-STR-001), but the document is schema-valid`);
  } else if (!res.ok) {
    for (const m of res.messages) errors.push(`${r}: negative subject must be schema-valid (its defect is ${codes.join(", ")}): ${m}`);
  }
}

// Every path a case names must exist.
for (const [r, c] of cases) {
  for (const d of c.documents) {
    try {
      readFileSync(path.join(root, d.path));
    } catch {
      errors.push(`${r}: document ${d.path} does not exist`);
    }
  }
}

for (const e of errors) console.error(`ERROR ${e}`);
console.log(`oracle:schemas: ${checked} fixture file(s) checked, ${cases.size} negative case(s), ${errors.length} error(s)`);
process.exitCode = errors.length === 0 ? 0 : 1;
