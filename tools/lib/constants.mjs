// Shared constants for the D2P Open Standard tooling.

/** The only JSON Schema dialect accepted for D2P schemas (design decision ADR-005). */
export const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

/**
 * Base URI for schema identifiers. A schema stored at `schemas/<path>` must
 * declare `$id` = SCHEMA_BASE_URI + `<path>`.
 */
export const SCHEMA_BASE_URI = "https://d2p.nonnast.dev/schemas/";

/** Separately runnable conformance levels (design decisions ADR-005, ADR-025). */
export const CONFORMANCE_LEVELS = Object.freeze(["structural", "referential", "semantic"]);

/** Result states as defined for test reports (design decision ADR-025 section 4). */
export const RESULT_STATES = Object.freeze(["passed", "failed", "inconclusive", "skipped"]);

/** Directories never scanned. */
export const IGNORED_DIRS = new Set([".git", "node_modules", "reports"]);
