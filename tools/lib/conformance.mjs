import path from "node:path";
import { CONFORMANCE_LEVELS } from "./constants.mjs";
import { readJson, rel, walk } from "./fs.mjs";

const CASE_SUFFIX = ".case.json";

/**
 * Runners per conformance level. A runner receives a parsed case
 * (`{ file, data }`) and resolves to `{ state, message? }` where state is one
 * of RESULT_STATES. No runner exists yet (phase P0); they are implemented
 * together with the first cases in phase P1.
 *
 * @type {Record<string, ((testCase: {file: string, data: unknown}) => Promise<{state: string, message?: string}>) | null>}
 */
export const RUNNERS = {
  structural: null,
  referential: null,
  semantic: null,
};

/**
 * Discovers and runs all cases of one conformance level. Each level is
 * independently runnable (ADR-005). Cases are files named `*.case.json`
 * below `conformance/<level>/`.
 *
 * A level with zero cases passes and reports zero counts. A case for a
 * level without a runner fails: an unimplemented check must never look green.
 *
 * @param {string} root absolute repository root
 * @param {string} level one of CONFORMANCE_LEVELS
 * @param {typeof RUNNERS} [runners] injectable for tests
 */
export async function runConformance(root, level, runners = RUNNERS) {
  if (!CONFORMANCE_LEVELS.includes(level)) {
    throw new Error(`unknown conformance level "${level}" (expected one of: ${CONFORMANCE_LEVELS.join(", ")})`);
  }
  const files = (await walk(path.join(root, "conformance", level))).filter((f) => f.endsWith(CASE_SUFFIX));
  const runner = runners[level];
  const results = [];
  for (const abs of files) {
    const file = rel(root, abs);
    const parsed = await readJson(abs);
    if (!parsed.ok) {
      results.push({ file, state: "failed", message: parsed.error });
      continue;
    }
    if (!runner) {
      results.push({ file, state: "failed", message: `no runner implemented for level "${level}"` });
      continue;
    }
    try {
      results.push({ file, ...(await runner({ file, data: parsed.value })) });
    } catch (err) {
      results.push({ file, state: "failed", message: `runner error: ${err.message}` });
    }
  }
  const count = (state) => results.filter((r) => r.state === state).length;
  const summary = {
    level,
    discovered: files.length,
    passed: count("passed"),
    failed: count("failed"),
    inconclusive: count("inconclusive"),
    skipped: count("skipped"),
  };
  return { summary, results, ok: summary.failed === 0 && summary.inconclusive === 0 };
}
