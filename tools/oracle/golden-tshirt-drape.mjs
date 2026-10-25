#!/usr/bin/env node
// Golden T-Shirt drape v1 generator (pure Node, no dependencies).
//
//   node tools/oracle/golden-tshirt-drape.mjs           regenerate fixtures/golden-tshirt-drape/v1 and
//                                                       conformance/<level>/golden-tshirt-drape/
//   node tools/oracle/golden-tshirt-drape.mjs --check   regenerate into a temporary directory and
//                                                       byte-compare with the repository (exit 1 on drift)
//
// Everything in the owned trees is generated from the Golden T-Shirt v1 2D
// and 3D fixtures and the pinned vocabulary files. The hand-written description lives
// in fixtures/golden-tshirt-drape/README.md, outside the fixture directory.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAll, CASE_DIR_NAME, FIXTURE_DIR } from "./lib/drape.mjs";

const args = process.argv.slice(2);
const check = args.includes("--check");
const rootArg = args.find((a) => !a.startsWith("--"));
const root = path.resolve(rootArg ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".."));
const OWNED = [FIXTURE_DIR, ...["structural", "referential", "semantic"].map((l) => `conformance/${l}/${CASE_DIR_NAME}`)];

function listFiles(dir, base) {
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

const owned = (rel) => OWNED.some((d) => rel === d || rel.startsWith(`${d}/`));
const existing = (base) => OWNED.flatMap((d) => listFiles(path.join(base, d), base));

function writeTree(base, files) {
  for (const [rel, text] of files) {
    const target = path.join(base, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}

const { files, report } = buildAll(root);
for (const rel of files.keys()) if (!owned(rel)) throw new Error(`generator produced a file outside its owned trees: ${rel}`);

if (check) {
  const tmp = mkdtempSync(path.join(tmpdir(), "d2p-drape-"));
  try {
    writeTree(tmp, files);
    const problems = [];
    for (const rel of files.keys()) {
      let actual;
      try {
        actual = readFileSync(path.join(root, rel));
      } catch {
        problems.push(`missing in repository: ${rel}`);
        continue;
      }
      if (!actual.equals(readFileSync(path.join(tmp, rel)))) problems.push(`differs from generator output: ${rel}`);
    }
    for (const rel of existing(root)) if (!files.has(rel)) problems.push(`not produced by the generator: ${rel}`);
    if (problems.length) {
      for (const p of problems) console.error(`DRIFT ${p}`);
      console.error(`golden-tshirt-drape:check: ${problems.length} drifted file(s); run "npm run oracle:drape" and review the diff`);
      process.exitCode = 1;
    } else {
      console.log(`golden-tshirt-drape:check: ${files.size} file(s) identical to generator output, ${report.checks.length} assertion(s) passed`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
} else {
  for (const rel of existing(root)) if (!files.has(rel)) rmSync(path.join(root, rel));
  writeTree(root, files);
  console.log(`golden-tshirt-drape: wrote ${files.size} file(s), ${report.checks.length} assertion(s) passed; fixtureDigest ${report.manifest.fixtureDigest}`);
}
