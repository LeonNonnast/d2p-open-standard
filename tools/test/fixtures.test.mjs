// Golden T-Shirt fixture wiring: structural and referential validity of every
// fixture file, negative fixtures detected with exactly their expected codes
// (catalog §4.3), fixture verification before comparison (QEV-001) and
// independent parsing without any implementation (OSS-001).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { loadBundle } from "../lib/bundle.mjs";
import { CONFORMANCE_LEVELS } from "../lib/constants.mjs";
import { checkBundle, runCase, runConformance } from "../lib/conformance.mjs";
import { FixtureRefusedError, openFixtureForComparison, verifyFixture } from "../lib/fixture.mjs";
import { rel, walk } from "../lib/fs.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE_DIR = "fixtures/golden-tshirt/v1";
const MANIFEST = `${FIXTURE_DIR}/manifest.json`;
const exec = promisify(execFile);
const tempDirs = [];

after(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

const readJsonFile = async (p) => JSON.parse(await readFile(p, "utf8"));
const manifest = await readJsonFile(path.join(REPO_ROOT, MANIFEST));

/**
 * The negative fixtures of catalog §4.3: name -> level, expected codes and
 * outcome. Kept here, independent of the generated case files, so that a
 * regenerated fixture cannot silently change what a negative case expects.
 * A structural classifier code always comes with D2P-STR-001 (catalog §2.2).
 */
const CATALOG_NEGATIVES = {
  "open-contour": { level: "semantic", codes: ["D2P-SEM-010"], outcome: "reject" },
  "self-intersection": { level: "semantic", codes: ["D2P-SEM-011"], outcome: "reject" },
  "impossible-constraint": { level: "semantic", codes: ["D2P-SEM-040"], outcome: "reject" },
  "feature-cycle": { level: "semantic", codes: ["D2P-SEM-001"], outcome: "reject" },
  "unit-mismatch": { level: "semantic", codes: ["D2P-SEM-002"], outcome: "reject" },
  "forbidden-expression-node": { level: "structural", codes: ["D2P-STR-001", "D2P-STR-010"], outcome: "reject" },
  "unknown-extension-feature": { level: "semantic", codes: ["D2P-SEM-004"], outcome: "accept", editability: "read-only" },
  "unpinned-reference": { level: "structural", codes: ["D2P-STR-001", "D2P-STR-011"], outcome: "reject" },
  "unresolvable-reference": { level: "referential", codes: ["D2P-REF-002"], outcome: "reject" },
  "stale-revision": { level: "referential", codes: ["D2P-REF-006"], outcome: "reject" },
  "incompatible-schema-version": { level: "structural", codes: ["D2P-STR-003"], outcome: "reject" },
  "private-measurement-export": { level: "semantic", codes: ["D2P-SEM-050"], outcome: "reject" },
};

/** Fixture cases that are not negative fixtures (catalog §4.1). */
const MANIFEST_CASES = ["referential/golden-tshirt/manifest-integrity.case.json", "semantic/golden-tshirt/fixture.case.json"];

const uniqueSorted = (list) => [...new Set(list)].sort();

describe("Golden T-Shirt fixture files", () => {
  it("expands every input, expected and external file into the manifest bundle and reports nothing at any level", async () => {
    const { docs, caseErrors } = await loadBundle(REPO_ROOT, { documents: [{ path: MANIFEST, role: "manifest" }] }, "semantic");
    assert.deepEqual(caseErrors, []);
    const listed = [
      ...manifest.files.filter((f) => f.role !== "negative").map((f) => `${FIXTURE_DIR}/${f.path}`),
      ...manifest.externalFiles.map((f) => f.path),
    ];
    assert.deepEqual(docs.filter((d) => d.role !== "manifest").map((d) => d.path).sort(), listed.sort());
    const { diagnostics, reached } = await checkBundle(REPO_ROOT, docs, "semantic");
    assert.equal(reached, "semantic");
    assert.deepEqual(diagnostics.map((d) => `${d.code} ${d.documentPath}#${d.instancePath ?? ""}: ${d.message}`), []);
  });

  it("lists every file of the fixture directory in the manifest (no hand-written file inside it)", async () => {
    const onDisk = (await walk(path.join(REPO_ROOT, FIXTURE_DIR))).map((f) => rel(path.join(REPO_ROOT, FIXTURE_DIR), f));
    assert.deepEqual(onDisk.filter((f) => f !== "manifest.json").sort(), manifest.files.map((f) => f.path).sort());
  });

  it("is verified by the fixture gate", async () => {
    const result = await verifyFixture(REPO_ROOT, MANIFEST);
    assert.equal(result.ok, true, result.diagnostics.map((d) => d.code).join(", "));
    const { expected, inputs } = await openFixtureForComparison(REPO_ROOT, MANIFEST);
    assert.equal(expected.size, manifest.files.filter((f) => f.role === "expected").length);
    assert.equal(inputs.size, manifest.files.filter((f) => f.role === "input").length);
    assert.ok([...expected.values(), ...inputs.values()].every((d) => d && typeof d.documentType === "string"));
  });
});

describe("Golden T-Shirt negative fixtures (catalog §4.3)", () => {
  const negativeDirs = uniqueSorted(manifest.files.filter((f) => f.role === "negative").map((f) => f.path.split("/")[1]));

  it("provides exactly the negative fixtures of the catalog", () => {
    assert.deepEqual(negativeDirs, Object.keys(CATALOG_NEGATIVES).sort());
  });

  it("has a conformance case per negative fixture and the two manifest cases, and nothing else", async () => {
    const found = [];
    for (const level of CONFORMANCE_LEVELS) {
      for (const f of await walk(path.join(REPO_ROOT, "conformance", level, "golden-tshirt"))) found.push(rel(path.join(REPO_ROOT, "conformance"), f));
    }
    const wanted = [
      ...MANIFEST_CASES,
      ...Object.entries(CATALOG_NEGATIVES).map(([name, c]) => `${c.level}/golden-tshirt/${name}.case.json`),
    ];
    assert.deepEqual(found.sort(), wanted.sort());
  });

  for (const [name, spec] of Object.entries(CATALOG_NEGATIVES)) {
    it(`${name}: detected at the ${spec.level} level with exactly ${spec.codes.join(" + ")}`, async () => {
      const dir = `${FIXTURE_DIR}/negative/${name}`;
      const caseText = await readFile(path.join(REPO_ROOT, dir, "case.json"), "utf8");
      const testCase = JSON.parse(caseText);

      // The case expresses the catalog row.
      assert.equal(testCase.level, spec.level);
      assert.equal(testCase.expect.outcome, spec.outcome);
      assert.equal(testCase.expect.editability, spec.editability);
      assert.deepEqual(uniqueSorted(testCase.expect.diagnostics.map((d) => d.code)), spec.codes);

      // The case is wired into the conformance suite unchanged.
      const copy = `conformance/${spec.level}/golden-tshirt/${name}.case.json`;
      assert.equal(await readFile(path.join(REPO_ROOT, copy), "utf8"), caseText, `${copy} must be a byte-identical copy of ${dir}/case.json`);

      // Every defective document of the directory is a subject, and only those.
      const files = (await readdir(path.join(REPO_ROOT, dir))).filter((f) => f !== "case.json").map((f) => `${dir}/${f}`);
      const subjects = testCase.documents.filter((d) => d.role === "subject").map((d) => d.path);
      assert.deepEqual(subjects.sort(), files.sort());
      // Context documents are never other negative files (catalog §2.1).
      assert.ok(testCase.documents.every((d) => d.role === "subject" || !d.path.startsWith(`${FIXTURE_DIR}/negative/`)));

      const result = await runCase(REPO_ROOT, testCase, spec.level);
      assert.equal(result.state, "passed", result.message);
      // Exactly the expected codes, nothing else of any severity, and only on subject documents.
      assert.deepEqual(uniqueSorted(result.diagnostics.map((d) => d.code)), spec.codes);
      assert.ok(result.diagnostics.every((d) => subjects.includes(d.documentPath)), "diagnostics must point at a subject");
    });
  }
});

describe("every conformance case", () => {
  it("reports exactly the codes it expects (no additional diagnostics)", async () => {
    const problems = [];
    for (const level of CONFORMANCE_LEVELS) {
      const { results } = await runConformance(REPO_ROOT, level);
      for (const r of results) {
        const testCase = await readJsonFile(path.join(REPO_ROOT, r.file));
        const expected = uniqueSorted(testCase.expect.diagnostics.map((d) => d.code));
        const reported = uniqueSorted((r.diagnostics ?? []).map((d) => d.code));
        if (r.state !== "passed") problems.push(`${r.file}: ${r.message}`);
        else if (expected.join() !== reported.join()) problems.push(`${r.file}: expected ${expected.join(", ") || "none"}, reported ${reported.join(", ") || "none"}`);
      }
    }
    assert.deepEqual(problems, []);
  });
});

/** Copies the parts of the repository a fixture verification reads into a temporary root. */
async function fixtureCopy() {
  const root = await mkdtemp(path.join(os.tmpdir(), "d2p-std-qev001-"));
  tempDirs.push(root);
  for (const dir of ["schemas", "vocabularies", "tolerance-profiles", "fixtures", "conformance/referential/golden-tshirt"]) {
    await cp(path.join(REPO_ROOT, dir), path.join(root, dir), { recursive: true });
  }
  return root;
}

async function editJson(root, relPath, edit) {
  const file = path.join(root, relPath);
  const value = JSON.parse(await readFile(file, "utf8"));
  edit(value);
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function assertRefused(root, expectedCode, instancePathPattern) {
  const result = await verifyFixture(root, MANIFEST);
  assert.equal(result.ok, false);
  const hit = result.integrity.find((d) => d.code === expectedCode && d.documentPath === MANIFEST && instancePathPattern.test(d.instancePath ?? ""));
  assert.ok(hit, `expected ${expectedCode} at ${instancePathPattern}, got ${result.diagnostics.map((d) => `${d.code}#${d.instancePath}`).join(", ")}`);
  await assert.rejects(() => openFixtureForComparison(root, MANIFEST), (err) => err instanceof FixtureRefusedError && err.diagnostics.some((d) => d.code === expectedCode));
  // The kit's own fixture case rejects the same fixture.
  const { results } = await runConformance(root, "referential");
  const integrityCase = results.find((r) => r.file === "conformance/referential/golden-tshirt/manifest-integrity.case.json");
  assert.equal(integrityCase.state, "failed");
}

describe("QEV-001: a fixture whose digest differs is refused for comparison", () => {
  const indexOf = (p) => manifest.files.findIndex((f) => f.path === p);

  it("accepts the unchanged copy", async () => {
    const root = await fixtureCopy();
    assert.equal((await verifyFixture(root, MANIFEST)).ok, true);
  });

  it("refuses a changed expected result (D2P-REF-011)", async () => {
    const root = await fixtureCopy();
    const target = "expected/snapshots/r1-size-a-regular-woven.json";
    await editJson(root, `${FIXTURE_DIR}/${target}`, (snapshot) => {
      snapshot.seams[0].lengthAMm += 0.001;
    });
    await assertRefused(root, "D2P-REF-011", new RegExp(`^/files/${indexOf(target)}/digest$`));
  });

  it("refuses a changed input (D2P-REF-011)", async () => {
    const root = await fixtureCopy();
    const target = "inputs/size-system-r1.json";
    await editJson(root, `${FIXTURE_DIR}/${target}`, (doc) => {
      doc.title = `${doc.title ?? "size system"} (edited)`;
    });
    await assertRefused(root, "D2P-REF-011", new RegExp(`^/files/${indexOf(target)}/digest$`));
  });

  it("refuses a changed external file (D2P-REF-011)", async () => {
    const root = await fixtureCopy();
    const target = "tolerance-profiles/golden-tshirt-2d-1.0.0.json";
    await editJson(root, target, (doc) => {
      doc.description = `${doc.description ?? ""} edited`;
    });
    const i = manifest.externalFiles.findIndex((f) => f.path === target);
    await assertRefused(root, "D2P-REF-011", new RegExp(`^/(externalFiles/${i}|toleranceProfile)/digest$`));
  });

  it("refuses a changed negative fixture (D2P-REF-011)", async () => {
    const root = await fixtureCopy();
    const target = "negative/open-contour/pattern.json";
    await editJson(root, `${FIXTURE_DIR}/${target}`, (doc) => {
      doc.name = `${doc.name} (edited)`;
    });
    await assertRefused(root, "D2P-REF-011", new RegExp(`^/files/${indexOf(target)}/digest$`));
  });

  it("refuses a wrong fixtureDigest (D2P-REF-011)", async () => {
    const root = await fixtureCopy();
    await editJson(root, MANIFEST, (m) => {
      m.fixtureDigest = `sha256:${"0".repeat(64)}`;
    });
    await assertRefused(root, "D2P-REF-011", /^\/fixtureDigest$/);
  });

  it("refuses an unlisted or a missing file (D2P-REF-012)", async () => {
    const unlisted = await fixtureCopy();
    await writeFile(path.join(unlisted, FIXTURE_DIR, "expected/notes.txt"), "not listed\n");
    await assertRefused(unlisted, "D2P-REF-012", /^\/files$/);

    const missing = await fixtureCopy();
    const target = "expected/fit/r1-size-b-relaxed-knit.json";
    await unlink(path.join(missing, FIXTURE_DIR, target));
    await assertRefused(missing, "D2P-REF-012", new RegExp(`^/files/${indexOf(target)}$`));
  });

  it("exits non-zero from the verification CLI for a refused fixture", async () => {
    const cli = path.join(REPO_ROOT, "tools/verify-fixture.mjs");
    const ok = await exec(process.execPath, [cli]);
    assert.match(ok.stdout, /verified/);
    const root = await fixtureCopy();
    await editJson(root, MANIFEST, (m) => {
      m.fixtureDigest = `sha256:${"f".repeat(64)}`;
    });
    await assert.rejects(() => exec(process.execPath, [cli, "--root", root]), (err) => err.code === 1 && /REFUSED/.test(err.stderr));
  });
});

describe("OSS-001: schemas and fixture documents are readable without any D2P implementation", () => {
  const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
  const addFormats = addFormatsModule.default ?? addFormatsModule;
  const SCHEMA_HOST = "https://d2p.nonnast.dev/schemas/";

  /** A consumer that uses nothing but a generic JSON Schema 2020-12 validator and the published schema files. */
  async function independentValidator() {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const byType = new Map();
    const schemas = [];
    for (const f of (await walk(path.join(REPO_ROOT, "schemas"))).filter((x) => x.endsWith(".schema.json"))) schemas.push(await readJsonFile(f));
    for (const s of schemas) ajv.addSchema(s);
    for (const s of schemas) {
      const type = s.properties?.documentType?.const;
      if (typeof type === "string") byType.set(type, ajv.getSchema(s.$id));
    }
    return { byType, schemas };
  }

  it("resolves every $ref offline within the published schema set", async () => {
    const { schemas } = await independentValidator();
    const ids = new Set(schemas.map((s) => s.$id));
    const bad = [];
    const visit = (node, owner) => {
      if (Array.isArray(node)) return node.forEach((n) => visit(n, owner));
      if (!node || typeof node !== "object") return;
      if (typeof node.$ref === "string") {
        const base = node.$ref.split("#")[0];
        if (base !== "" && !ids.has(base)) bad.push(`${owner}: ${node.$ref}`);
      }
      for (const v of Object.values(node)) visit(v, owner);
    };
    for (const s of schemas) {
      assert.ok(s.$id.startsWith(SCHEMA_HOST), s.$id);
      visit(s, s.$id);
    }
    assert.deepEqual(bad, []);
  });

  it("parses and validates every fixture document, manifest and external file by documentType and schemaVersion", async () => {
    const { byType } = await independentValidator();
    const paths = [
      MANIFEST,
      ...manifest.files.filter((f) => f.role !== "negative").map((f) => `${FIXTURE_DIR}/${f.path}`),
      ...manifest.externalFiles.map((f) => f.path),
    ];
    const problems = [];
    for (const p of paths) {
      const doc = JSON.parse(await readFile(path.join(REPO_ROOT, p), "utf8"));
      const validate = byType.get(doc.documentType);
      if (!validate) {
        problems.push(`${p}: no schema for documentType ${doc.documentType}`);
        continue;
      }
      // Version gate (catalog §1.11): same major version as standard 1.0.
      if (!/^1\.\d+\.\d+$/.test(doc.schemaVersion)) problems.push(`${p}: schemaVersion ${doc.schemaVersion} is not readable by standard 1.0`);
      if (!validate(doc)) problems.push(`${p}: ${JSON.stringify(validate.errors.slice(0, 2))}`);
    }
    assert.deepEqual(problems, []);
    assert.ok(paths.length > 90);
  });

  it("keeps the tooling self-contained: only Node built-ins, ajv, ajv-formats and files of this repository", async () => {
    const pkg = await readJsonFile(path.join(REPO_ROOT, "package.json"));
    assert.equal(pkg.dependencies, undefined);
    assert.deepEqual(Object.keys(pkg.devDependencies).sort(), ["ajv", "ajv-formats"]);
    const allowed = new Set(["ajv/dist/2020.js", "ajv-formats"]);
    const problems = [];
    for (const f of (await walk(path.join(REPO_ROOT, "tools"))).filter((x) => x.endsWith(".mjs"))) {
      const text = await readFile(f, "utf8");
      for (const m of text.matchAll(/(?:^|\s)(?:import|export)\s[^;]*?from\s+"([^"]+)"|import\(\s*"([^"]+)"\s*\)/gm)) {
        const spec = m[1] ?? m[2];
        if (spec.startsWith("node:") || allowed.has(spec)) continue;
        if (spec.startsWith(".")) {
          const target = path.resolve(path.dirname(f), spec);
          if (target.startsWith(REPO_ROOT + path.sep)) continue;
        }
        problems.push(`${rel(REPO_ROOT, f)}: imports ${spec}`);
      }
    }
    assert.deepEqual(problems, []);
  });
});
