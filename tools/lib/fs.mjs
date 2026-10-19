import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { IGNORED_DIRS } from "./constants.mjs";

/**
 * Recursively lists files below `dir` (absolute paths, sorted for
 * deterministic output). Missing directories yield an empty list.
 */
export async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) out.push(...(await walk(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/** Converts an absolute path to a POSIX-style path relative to `root`. */
export function rel(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

/**
 * Reads and parses a JSON file. Returns `{ ok: true, value }` or
 * `{ ok: false, error }` so callers can collect all problems in one run.
 */
export async function readJson(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    return { ok: false, error: `cannot read file: ${err.message}` };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: `invalid JSON: ${err.message}` };
  }
}
