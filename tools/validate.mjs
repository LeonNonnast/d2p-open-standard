#!/usr/bin/env node
// CLI: validates all schemas and examples. Usage: node tools/validate.mjs [--json] [root]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRepository } from "./lib/validate.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const rootArg = args.find((a) => !a.startsWith("--"));
const root = path.resolve(rootArg ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));

const result = await validateRepository(root);

if (json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  for (const w of result.warnings) console.warn(`WARN  ${w.file}: ${w.message}`);
  for (const e of result.errors) console.error(`ERROR ${e.file}: ${e.message}`);
  const s = result.summary;
  console.log(
    `validate: ${s.schemaFiles} schema file(s), ${s.schemasCompiled} compiled, ` +
      `${s.examplesChecked} example(s) checked, ${s.dataFilesChecked} data file(s) checked by documentType, ` +
      `${s.errors} error(s), ${s.warnings} warning(s)`,
  );
}
process.exitCode = result.errors.length === 0 ? 0 : 1;
