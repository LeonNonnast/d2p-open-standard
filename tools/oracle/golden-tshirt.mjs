#!/usr/bin/env node
// Golden T-Shirt v1 reference oracle (pure Node, no dependencies).
//
//   node tools/oracle/golden-tshirt.mjs            regenerate fixtures/golden-tshirt/v1
//   node tools/oracle/golden-tshirt.mjs --check    regenerate into a temporary directory and
//                                                  byte-compare with the repository (exit 1 on drift)
//   node tools/oracle/golden-tshirt.mjs --summary  also print seam lengths, fit results and tiling
//
// Everything under fixtures/golden-tshirt/v1 is generated. The hand-written
// description lives outside the fixture directory (fixtures/golden-tshirt/README.md),
// because catalog §2.4 (D2P-REF-012) allows no unlisted file inside it.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selfTest } from "./lib/c14n.mjs";
import { buildFixture, FIXTURE_DIR } from "./lib/documents.mjs";

const HAND_WRITTEN = new Set();

const args = process.argv.slice(2);
const check = args.includes("--check");
const summary = args.includes("--summary");
const rootArg = args.find((a) => !a.startsWith("--"));
const root = path.resolve(rootArg ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".."));
const fixtureRoot = path.join(root, FIXTURE_DIR);

function listFiles(dir, base = dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const out = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full, base));
    else if (e.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}

function removeEmptyDirs(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) if (e.isDirectory()) removeEmptyDirs(path.join(dir, e.name));
  if (dir !== fixtureRoot && readdirSync(dir).length === 0) rmdirSync(dir);
}

function serialize(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function render() {
  selfTest();
  const { files, manifest, report } = buildFixture(root);
  const out = new Map();
  for (const [rel, { doc }] of files) out.set(rel, serialize(doc));
  out.set("manifest.json", serialize(manifest));
  return { out, report, manifest };
}

function writeTree(dir, out) {
  for (const [rel, text] of out) {
    const target = path.join(dir, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}

function printSummary(report, manifest) {
  const f = (n) => n.toFixed(3).padStart(9);
  for (const c of report.cases) {
    console.log(`\n${c.caseKey}`);
    for (const s of c.seams) {
      console.log(`  ${s.seamConnectionId.padEnd(26)} A ${f(s.lengthAMm)}  B ${f(s.lengthBMm)}  ease ${f(s.declaredEaseMm)}  dev ${f(s.deviationMm)} mm`);
    }
    for (const [k, v] of Object.entries(c.predicted)) console.log(`  ${k.padEnd(26)} ${f(v)} mm (analytic)`);
  }
  for (const p of report.prints ?? []) {
    console.log(`\nprint ${p.caseKey}: layout ${p.tiles.layoutWidthMm.toFixed(1)} x ${p.tiles.layoutHeightMm.toFixed(1)} mm -> ${p.tiles.columns} x ${p.tiles.rows} A4 tiles`);
  }
  console.log(`\n${report.checks.length} oracle assertion(s) passed; fixtureDigest ${manifest.fixtureDigest}`);
}

const { out, report, manifest } = render();

if (check) {
  const tmp = mkdtempSync(path.join(tmpdir(), "d2p-oracle-"));
  try {
    writeTree(tmp, out);
    const problems = [];
    for (const rel of listFiles(tmp)) {
      let actual;
      try {
        actual = readFileSync(path.join(fixtureRoot, rel));
      } catch {
        problems.push(`missing in repository: ${FIXTURE_DIR}/${rel}`);
        continue;
      }
      if (!actual.equals(readFileSync(path.join(tmp, rel)))) problems.push(`differs from oracle output: ${FIXTURE_DIR}/${rel}`);
    }
    for (const rel of listFiles(fixtureRoot)) {
      if (!out.has(rel) && !HAND_WRITTEN.has(rel)) problems.push(`not produced by the oracle: ${FIXTURE_DIR}/${rel}`);
    }
    if (summary) printSummary(report, manifest);
    if (problems.length > 0) {
      for (const p of problems) console.error(`DRIFT ${p}`);
      console.error(`oracle:check: ${problems.length} drifted file(s); run "npm run oracle" and review the diff`);
      process.exitCode = 1;
    } else {
      console.log(`oracle:check: ${out.size} file(s) identical to oracle output, ${report.checks.length} assertion(s) passed`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
} else {
  for (const rel of listFiles(fixtureRoot)) {
    if (!out.has(rel) && !HAND_WRITTEN.has(rel)) rmSync(path.join(fixtureRoot, rel));
  }
  removeEmptyDirs(fixtureRoot);
  writeTree(fixtureRoot, out);
  if (summary) printSummary(report, manifest);
  console.log(`oracle: wrote ${out.size} file(s) to ${FIXTURE_DIR}, ${report.checks.length} assertion(s) passed`);
}
