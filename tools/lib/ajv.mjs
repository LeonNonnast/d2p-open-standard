import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

// ajv ships CommonJS; normalise the default export for ESM consumers.
const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
const addFormats = addFormatsModule.default ?? addFormatsModule;

/**
 * Creates the single, strictly configured validator used by all tooling.
 * Strict mode rejects unknown keywords and ambiguous schemas so that
 * schema authoring errors surface early instead of silently passing.
 */
export function createAjv() {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    validateSchema: true,
    validateFormats: true,
  });
  addFormats(ajv);
  return ajv;
}

/** Renders ajv errors as short, human-readable lines. */
export function formatAjvErrors(errors) {
  return (errors ?? []).map((e) => {
    const where = e.instancePath === "" ? "(root)" : e.instancePath;
    const params = e.params && Object.keys(e.params).length ? ` ${JSON.stringify(e.params)}` : "";
    return `${where} ${e.message}${params}`;
  });
}
