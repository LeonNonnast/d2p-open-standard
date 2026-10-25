import path from "node:path";
import { createAjv, formatAjvErrors } from "./ajv.mjs";
import { DRAFT_2020_12, SCHEMA_BASE_URI } from "./constants.mjs";
import { readJson, rel, walk } from "./fs.mjs";

const SCHEMA_SUFFIX = ".schema.json";
// Files allowed inside schemas/ that are not schemas themselves.
const SCHEMA_DIR_ALLOWED = new Set([".gitkeep", "README.md"]);
// examples/<module path>/<schema name>/<valid|invalid>/<case>.json
const EXAMPLE_PATTERN = /^examples\/(.+)\/([^/]+)\/(valid|invalid)\/[^/]+\.json$/;

/**
 * Validates the whole standard repository:
 *
 * 1. every `**\/*.schema.json` parses, declares the 2020-12 dialect and an
 *    absolute, unique `$id`, and is valid against the 2020-12 meta-schema;
 * 2. schemas under `schemas/` use the `.schema.json` suffix and an `$id`
 *    derived from their path;
 * 3. every schema compiles in ajv strict mode with all `$ref`s resolvable;
 * 4. every example under `examples/` maps to a schema; `valid/` examples
 *    must pass and `invalid/` examples must fail;
 * 5. every schema under `schemas/` has at least one valid example
 *    (a missing negative example is reported as a warning);
 * 6. every data file the catalog names (§3.0 tooling requirement) is valid
 *    against the schema selected by its `documentType`: every JSON file under
 *    `vocabularies/`, `tolerance-profiles/` and `mappings/`, every fixture `manifest.json`,
 *    `inputs/**` and `expected/**` file under `fixtures/`, and every
 *    `conformance/**\/*.case.json`; an unknown `documentType` is an error.
 *    Vocabulary files must be named `<local-name>-<version>.json` after their
 *    ID. Fixture `negative/` directories and conformance case data are
 *    deliberately invalid in places and are left to the conformance cases;
 * 7. a repository with the schema catalog also has the standard-gap analysis
 *    `specifications/gap-analysis.md` (catalog §3.0, test OSS-002).
 *
 * All problems are collected; nothing stops at the first error.
 *
 * @param {string} root absolute path of the repository root
 */
export async function validateRepository(root) {
  const errors = [];
  const warnings = [];
  const error = (file, message) => errors.push({ file, message });
  const warn = (file, message) => warnings.push({ file, message });

  const allFiles = await walk(root);
  const relFiles = allFiles.map((f) => rel(root, f));
  const relFileSet = new Set(relFiles);

  // Rule 2a: only schemas (and a few housekeeping files) live in schemas/.
  for (const file of relFiles) {
    if (!file.startsWith("schemas/")) continue;
    const base = path.posix.basename(file);
    if (!file.endsWith(SCHEMA_SUFFIX) && !SCHEMA_DIR_ALLOWED.has(base)) {
      error(file, `files under schemas/ must end with "${SCHEMA_SUFFIX}"`);
    }
  }

  // Rule 1 + 2b: load and check every schema document.
  const ajv = createAjv();
  const schemas = []; // { file, id }
  const ids = new Map(); // $id -> file
  for (const file of relFiles.filter((f) => f.endsWith(SCHEMA_SUFFIX))) {
    const parsed = await readJson(path.join(root, file));
    if (!parsed.ok) {
      error(file, parsed.error);
      continue;
    }
    const schema = parsed.value;
    if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
      error(file, "schema document must be a JSON object");
      continue;
    }
    if (schema.$schema !== DRAFT_2020_12) {
      error(file, `"$schema" must be "${DRAFT_2020_12}", got ${JSON.stringify(schema.$schema)}`);
      continue;
    }
    if (typeof schema.$id !== "string" || !isAbsoluteUri(schema.$id)) {
      error(file, `"$id" must be an absolute URI, got ${JSON.stringify(schema.$id)}`);
      continue;
    }
    if (file.startsWith("schemas/")) {
      const expectedId = SCHEMA_BASE_URI + file.slice("schemas/".length);
      if (schema.$id !== expectedId) {
        error(file, `"$id" must be "${expectedId}" (derived from the file path), got "${schema.$id}"`);
      }
    }
    if (ids.has(schema.$id)) {
      error(file, `duplicate "$id" "${schema.$id}" (also declared in ${ids.get(schema.$id)})`);
      continue;
    }
    if (!ajv.validateSchema(schema)) {
      for (const msg of formatAjvErrors(ajv.errors)) error(file, `not valid against the 2020-12 meta-schema: ${msg}`);
      continue;
    }
    try {
      // Registering first lets cross-schema $refs resolve regardless of order.
      ajv.addSchema(schema);
    } catch (err) {
      error(file, `cannot register schema: ${err.message}`);
      continue;
    }
    ids.set(schema.$id, file);
    schemas.push({ file, id: schema.$id });
  }

  // Rule 3: compile everything once all schemas are registered.
  const validators = new Map(); // file -> validate fn
  for (const { file, id } of schemas) {
    try {
      validators.set(file, ajv.getSchema(id));
    } catch (err) {
      error(file, `does not compile: ${err.message}`);
    }
  }

  // Rule 4: examples.
  const exampleCounts = new Map(); // schema file -> { valid, invalid }
  let examplesChecked = 0;
  for (const file of relFiles) {
    if (!file.startsWith("examples/") || !file.endsWith(".json")) continue;
    const match = EXAMPLE_PATTERN.exec(file);
    if (!match) {
      error(file, "example path must be examples/<module>/<schema-name>/(valid|invalid)/<case>.json");
      continue;
    }
    const [, modulePath, schemaName, kind] = match;
    const schemaFile = `schemas/${modulePath}/${schemaName}${SCHEMA_SUFFIX}`;
    if (!relFileSet.has(schemaFile)) {
      error(file, `no schema found for example (expected ${schemaFile})`);
      continue;
    }
    const validate = validators.get(schemaFile);
    if (!validate) {
      error(file, `skipped because ${schemaFile} is broken`);
      continue;
    }
    const parsed = await readJson(path.join(root, file));
    if (!parsed.ok) {
      error(file, parsed.error);
      continue;
    }
    examplesChecked += 1;
    const counts = exampleCounts.get(schemaFile) ?? { valid: 0, invalid: 0 };
    counts[kind] += 1;
    exampleCounts.set(schemaFile, counts);
    const ok = validate(parsed.value);
    if (kind === "valid" && !ok) {
      for (const msg of formatAjvErrors(validate.errors)) error(file, `valid example rejected by ${schemaFile}: ${msg}`);
    } else if (kind === "invalid" && ok) {
      error(file, `invalid example unexpectedly accepted by ${schemaFile}`);
    }
  }

  // Rule 6: data files by documentType (catalog §3.0 tooling requirement).
  const validatorByType = new Map();
  for (const [file, fn] of validators) {
    const schema = fn?.schema;
    const documentType = schema?.properties?.documentType?.const;
    if (file.startsWith("schemas/") && typeof documentType === "string") validatorByType.set(documentType, { file, fn });
  }
  let dataFilesChecked = 0;
  for (const file of relFiles) {
    if (!isCatalogDataFile(file)) continue;
    const parsed = await readJson(path.join(root, file));
    if (!parsed.ok) {
      error(file, parsed.error);
      continue;
    }
    dataFilesChecked += 1;
    const doc = parsed.value;
    const documentType = doc !== null && typeof doc === "object" && !Array.isArray(doc) ? doc.documentType : undefined;
    const entry = validatorByType.get(documentType);
    if (!entry) {
      error(file, `unknown documentType ${JSON.stringify(documentType)}: no schema of schemas/ declares it`);
      continue;
    }
    if (!entry.fn(doc)) {
      for (const msg of formatAjvErrors(entry.fn.errors)) error(file, `not valid against ${entry.file} (documentType ${documentType}): ${msg}`);
      continue;
    }
    const expectedName = vocabularyFileName(doc);
    if (expectedName && path.posix.basename(file) !== expectedName) {
      error(file, `vocabulary file must be named "${expectedName}" after its ID and version (catalog §3.0)`);
    }
  }

  // Rule 7: the standard-gap analysis accompanies the catalog.
  if (relFileSet.has(CATALOG_FILE) && !relFileSet.has(GAP_ANALYSIS_FILE)) {
    error(GAP_ANALYSIS_FILE, "the standard-gap analysis is missing (catalog §3.0, test OSS-002)");
  }

  // Rule 5: example coverage for normative schemas.
  // Broken schemas are already reported above; only check compiled ones.
  for (const file of validators.keys()) {
    if (!file.startsWith("schemas/")) continue;
    const counts = exampleCounts.get(file) ?? { valid: 0, invalid: 0 };
    if (counts.valid === 0) error(file, "schema has no valid example under examples/");
    if (counts.invalid === 0) warn(file, "schema has no invalid (negative) example under examples/");
  }

  return {
    errors,
    warnings,
    summary: {
      schemaFiles: relFiles.filter((f) => f.endsWith(SCHEMA_SUFFIX)).length,
      schemasCompiled: validators.size,
      examplesChecked,
      dataFilesChecked,
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}

const CATALOG_FILE = "specifications/schema-catalog.md";
const GAP_ANALYSIS_FILE = "specifications/gap-analysis.md";
const VOCABULARY_ID_MEMBERS = {
  "d2p:measurement-definition-registry": "registryId",
  "d2p:validation-rule-definition": "ruleId",
  "d2p:validation-profile": "profileId",
  "d2p:tolerance-profile": "profileId",
  "d2p:mesh-profile": "profileId",
  "d2p:avatar-profile": "profileId",
  "d2p:solver-profile": "profileId",
  "d2p:material-physics-profile": "profileId",
  "d2p:mapping-profile": "mappingId",
};

/** Files covered by the §3.0 tooling requirement (repository-relative POSIX paths). */
export function isCatalogDataFile(file) {
  if (!file.endsWith(".json")) return false;
  if (file.startsWith("vocabularies/") || file.startsWith("tolerance-profiles/") || file.startsWith("mappings/")) return true;
  if (file.startsWith("conformance/")) return file.endsWith(".case.json");
  if (file.startsWith("fixtures/")) {
    const parts = file.split("/");
    if (parts.includes("negative")) return false;
    return path.posix.basename(file) === "manifest.json" || parts.includes("inputs") || parts.includes("expected");
  }
  return false;
}

/** `<local-name>-<version>.json` for a vocabulary document with a qualified-name ID, else null. */
function vocabularyFileName(doc) {
  const member = VOCABULARY_ID_MEMBERS[doc.documentType];
  if (!member || typeof doc[member] !== "string" || typeof doc.version !== "string") return null;
  const local = doc[member].slice(doc[member].indexOf(":") + 1);
  return `${local}-${doc.version}.json`;
}

function isAbsoluteUri(value) {
  try {
    const url = new URL(value);
    return url.protocol.length > 1 && !url.hash;
  } catch {
    return false;
  }
}
