#!/usr/bin/env node
// CLI: runs one conformance level. Usage: node tools/conformance.mjs <structural|referential|semantic> [--json] [root]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFORMANCE_LEVELS } from "./lib/constants.mjs";
import { runConformance } from "./lib/conformance.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const [level, rootArg] = args.filter((a) => !a.startsWith("--"));
if (!CONFORMANCE_LEVELS.includes(level)) {
  console.error(`usage: node tools/conformance.mjs <${CONFORMANCE_LEVELS.join("|")}> [--json] [root]`);
  process.exit(2);
}
const root = path.resolve(rootArg ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));

const { summary, results, ok } = await runConformance(root, level);

if (json) {
  process.stdout.write(`${JSON.stringify({ summary, results }, null, 2)}\n`);
} else {
  for (const r of results) {
    const line = `${r.state.toUpperCase().padEnd(12)} ${r.file}${r.message ? ` - ${r.message}` : ""}`;
    (r.state === "passed" ? console.log : console.error)(line);
  }
  console.log(
    `conformance:${level}: ${summary.discovered} case(s) discovered, ${summary.passed} passed, ` +
      `${summary.failed} failed, ${summary.inconclusive} inconclusive, ${summary.skipped} skipped`,
  );
}
process.exitCode = ok ? 0 : 1;
