import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DRAFT_2020_12, SCHEMA_BASE_URI } from "../lib/constants.mjs";
import { validateRepository } from "../lib/validate.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tempDirs = [];

after(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** Creates a throwaway repository from a { "rel/path": content } map. */
async function fixtureRepo(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "d2p-std-validate-"));
  tempDirs.push(root);
  for (const [file, content] of Object.entries(files)) {
    const abs = path.join(root, file);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  return root;
}

const colorSchema = (overrides = {}) => ({
  $schema: DRAFT_2020_12,
  $id: `${SCHEMA_BASE_URI}core/color.schema.json`,
  type: "string",
  enum: ["red", "blue"],
  ...overrides,
});

const healthyFiles = () => ({
  "schemas/core/color.schema.json": colorSchema(),
  "examples/core/color/valid/red.json": '"red"',
  "examples/core/color/invalid/green.json": '"green"',
});

const messages = (result) => result.errors.map((e) => `${e.file}: ${e.message}`);

describe("validateRepository", () => {
  it("passes for this repository", async () => {
    const result = await validateRepository(REPO_ROOT);
    assert.deepEqual(messages(result), []);
    assert.ok(result.summary.schemaFiles >= 1);
    assert.equal(result.summary.schemasCompiled, result.summary.schemaFiles);
  });

  it("passes for a healthy fixture repository", async () => {
    const result = await validateRepository(await fixtureRepo(healthyFiles()));
    assert.deepEqual(messages(result), []);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.summary.examplesChecked, 2);
  });

  it("rejects a schema with a different dialect", async () => {
    const files = healthyFiles();
    files["schemas/core/color.schema.json"] = colorSchema({ $schema: "http://json-schema.org/draft-07/schema#" });
    const result = await validateRepository(await fixtureRepo(files));
    assert.ok(messages(result).some((m) => m.includes('"$schema" must be')));
  });

  it("rejects a schema that violates the 2020-12 meta-schema", async () => {
    const files = healthyFiles();
    files["schemas/core/color.schema.json"] = colorSchema({ type: 42 });
    const result = await validateRepository(await fixtureRepo(files));
    assert.ok(messages(result).some((m) => m.includes("2020-12 meta-schema")));
  });

  it("rejects unknown keywords (strict mode)", async () => {
    const files = healthyFiles();
    files["schemas/core/color.schema.json"] = colorSchema({ minLenght: 1 });
    const result = await validateRepository(await fixtureRepo(files));
    assert.ok(messages(result).some((m) => m.includes('unknown keyword: "minLenght"')));
  });

  it("rejects an $id that does not match the file path", async () => {
    const files = healthyFiles();
    files["schemas/core/color.schema.json"] = colorSchema({ $id: `${SCHEMA_BASE_URI}core/colour.schema.json` });
    const result = await validateRepository(await fixtureRepo(files));
    assert.ok(messages(result).some((m) => m.includes("derived from the file path")));
  });

  it("rejects duplicate $id values", async () => {
    const files = healthyFiles();
    files["specifications/copy.schema.json"] = colorSchema();
    const result = await validateRepository(await fixtureRepo(files));
    assert.ok(messages(result).some((m) => m.includes("duplicate")));
  });

  it("rejects unresolvable $ref", async () => {
    const files = healthyFiles();
    files["schemas/core/color.schema.json"] = {
      $schema: DRAFT_2020_12,
      $id: `${SCHEMA_BASE_URI}core/color.schema.json`,
      $ref: "missing.schema.json",
    };
    const result = await validateRepository(await fixtureRepo(files));
    assert.ok(messages(result).some((m) => m.includes("does not compile")));
  });

  it("resolves $ref across schema files", async () => {
    const files = healthyFiles();
    files["schemas/core/palette.schema.json"] = {
      $schema: DRAFT_2020_12,
      $id: `${SCHEMA_BASE_URI}core/palette.schema.json`,
      type: "array",
      items: { $ref: "color.schema.json" },
    };
    files["examples/core/palette/valid/two.json"] = '["red","blue"]';
    files["examples/core/palette/invalid/bad-item.json"] = '["red","green"]';
    const result = await validateRepository(await fixtureRepo(files));
    assert.deepEqual(messages(result), []);
  });

  it("rejects malformed JSON", async () => {
    const files = healthyFiles();
    files["schemas/core/color.schema.json"] = "{ not json";
    const result = await validateRepository(await fixtureRepo(files));
    assert.ok(messages(result).some((m) => m.includes("invalid JSON")));
  });

  it("rejects non-schema files in schemas/", async () => {
    const files = healthyFiles();
    files["schemas/core/notes.json"] = "{}";
    const result = await validateRepository(await fixtureRepo(files));
    assert.ok(messages(result).some((m) => m.startsWith("schemas/core/notes.json")));
  });

  it("reports a valid example that fails its schema", async () => {
    const files = healthyFiles();
    files["examples/core/color/valid/purple.json"] = '"purple"';
    const result = await validateRepository(await fixtureRepo(files));
    assert.ok(messages(result).some((m) => m.startsWith("examples/core/color/valid/purple.json")));
  });

  it("reports an invalid example that passes its schema", async () => {
    const files = healthyFiles();
    files["examples/core/color/invalid/blue.json"] = '"blue"';
    const result = await validateRepository(await fixtureRepo(files));
    assert.ok(messages(result).some((m) => m.includes("unexpectedly accepted")));
  });

  it("reports examples without a matching schema or with a bad path", async () => {
    const files = healthyFiles();
    files["examples/core/shape/valid/circle.json"] = '"circle"';
    files["examples/stray.json"] = "{}";
    const result = await validateRepository(await fixtureRepo(files));
    assert.ok(messages(result).some((m) => m.includes("no schema found")));
    assert.ok(messages(result).some((m) => m.startsWith("examples/stray.json")));
  });

  it("requires a valid example and warns about a missing negative example", async () => {
    const files = healthyFiles();
    delete files["examples/core/color/valid/red.json"];
    delete files["examples/core/color/invalid/green.json"];
    const result = await validateRepository(await fixtureRepo(files));
    assert.ok(messages(result).some((m) => m.includes("no valid example")));
    assert.ok(result.warnings.some((w) => w.message.includes("no invalid")));
  });
});
