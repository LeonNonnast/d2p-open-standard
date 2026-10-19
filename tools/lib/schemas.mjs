// Loads the repository's schemas once and selects validators by documentType.
import path from "node:path";
import { createAjv, formatAjvErrors } from "./ajv.mjs";
import { readJson, rel, walk } from "./fs.mjs";

const SCHEMA_SUFFIX = ".schema.json";
const cache = new Map();

/**
 * Loads all `schemas/**\/*.schema.json` of a repository into one strict Ajv
 * instance. The result is cached per root.
 *
 * @param {string} root absolute repository root
 * @returns {Promise<SchemaSet>}
 */
export async function loadSchemaSet(root) {
  const key = path.resolve(root);
  if (!cache.has(key)) cache.set(key, buildSchemaSet(key));
  return cache.get(key);
}

/**
 * @typedef {object} SchemaSet
 * @property {Map<string, Function>} byDocumentType documentType -> compiled validator
 * @property {Map<string, string>} fileByDocumentType documentType -> schema file
 * @property {(id: string) => Function | undefined} byId validator for a schema $id or $id#pointer
 * @property {string[]} loadErrors problems encountered while loading
 */

async function buildSchemaSet(root) {
  const ajv = createAjv();
  const loadErrors = [];
  const documentSchemas = []; // { documentType, id, file }
  const files = (await walk(path.join(root, "schemas"))).filter((f) => f.endsWith(SCHEMA_SUFFIX));
  for (const abs of files) {
    const file = rel(root, abs);
    const parsed = await readJson(abs);
    if (!parsed.ok) {
      loadErrors.push(`${file}: ${parsed.error}`);
      continue;
    }
    try {
      ajv.addSchema(parsed.value);
    } catch (err) {
      loadErrors.push(`${file}: ${err.message}`);
      continue;
    }
    const documentType = parsed.value?.properties?.documentType?.const;
    if (typeof documentType === "string") documentSchemas.push({ documentType, id: parsed.value.$id, file });
  }
  const byDocumentType = new Map();
  const fileByDocumentType = new Map();
  for (const { documentType, id, file } of documentSchemas) {
    try {
      byDocumentType.set(documentType, ajv.getSchema(id));
      fileByDocumentType.set(documentType, file);
    } catch (err) {
      loadErrors.push(`${file}: does not compile: ${err.message}`);
    }
  }
  const byId = (id) => {
    try {
      return ajv.getSchema(id);
    } catch {
      return undefined;
    }
  };
  return { byDocumentType, fileByDocumentType, byId, loadErrors, formatErrors: formatAjvErrors };
}
