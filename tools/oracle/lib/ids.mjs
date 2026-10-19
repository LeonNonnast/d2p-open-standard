// Normative identifiers of the Golden T-Shirt v1 fixture (catalog section 4.2).
export const ARTIFACT_SLUGS = ["pattern", "grading-rule-set", "size-system", "fit-profile-regular", "fit-profile-relaxed", "garment-measurement-spec"];

export const SIZES = [
  { sizeKey: "size-a", label: "A", ordinal: 1 },
  { sizeKey: "size-b", label: "B", ordinal: 2 },
];

export const CONFIGURATIONS = [
  { configurationKey: "regular-woven", fitSlug: "fit-profile-regular", materialAssumptions: { materialClass: "woven" } },
  { configurationKey: "relaxed-knit", fitSlug: "fit-profile-relaxed", materialAssumptions: { materialClass: "knit" } },
];

export const TIMESTAMPS = {
  r1Records: "2026-01-01T00:00:00Z",
  r1Derived: "2026-01-02T00:00:00Z",
  change: "2026-01-03T00:00:00Z",
  r2Derived: "2026-01-04T00:00:00Z",
};

export const ACTOR = { kind: "system", principalId: "prn_golden-fixture" };
export const EVALUATOR_PROFILE = { id: "d2p:golden-fixture-analytic", version: "1.0.0" };
export const EVALUATOR = {
  engineId: "golden-fixture",
  engineVersion: "1.0.0",
  algorithmProfileVersion: "1.0.0",
  evaluatorProfile: EVALUATOR_PROFILE,
};
export const REGISTRY = { id: "d2p:measurement-definitions", version: "1.0.0" };
export const TOLERANCE_PROFILE = { id: "d2p:golden-tshirt-2d", version: "1.0.0" };
export const PROFILE_SAMPLE_CUT = { id: "d2p:sample-cut", version: "1.0.0" };
export const PROFILE_PRINT = { id: "d2p:print-1to1", version: "1.0.0" };

export const ids = {
  project: "prj_golden-tshirt",
  art: (slug) => `art_golden-tshirt-${slug}`,
  rev: (slug, n) => `rev_golden-tshirt-${slug}-r${n}`,
  rel: (slug) => `rel_golden-tshirt-contains-${slug}`,
  ref: (slug, n = 1) => ({ artifactId: `art_golden-tshirt-${slug}`, revisionId: `rev_golden-tshirt-${slug}-r${n}` }),
  command: "cmd_golden-tshirt-change-1",
  caseKey: (rev, sizeKey, configurationKey) => `r${rev}-${sizeKey}-${configurationKey}`,
  erq: (c) => `erq_golden-tshirt-${c}`,
  pev: (c) => `pev_golden-tshirt-${c}`,
  snp: (c) => `snp_golden-tshirt-${c}`,
  fer: (c) => `fer_golden-tshirt-${c}`,
  vrpSample: (c) => `vrp_golden-tshirt-${c}-sample-cut`,
  vrpPrint: (c) => `vrp_golden-tshirt-${c}-print-1to1`,
  gate: (c) => `gte_golden-tshirt-${c}-export-1to1`,
  scene: (c) => `xsc_golden-tshirt-${c}`,
  print: (c) => `pjs_golden-tshirt-${c}-a4`,
};

/** External files of the fixture (repository-relative), see catalog section 4.1. */
export const EXTERNAL = {
  registry: "vocabularies/measurement-definitions/measurement-definitions-1.0.0.json",
  tolerance: "tolerance-profiles/golden-tshirt-2d-1.0.0.json",
  profileSampleCut: "vocabularies/validation/profiles/sample-cut-1.0.0.json",
  profilePrint: "vocabularies/validation/profiles/print-1to1-1.0.0.json",
  ruleFile: (ruleId) => `vocabularies/validation/rules/${ruleId.replace(/^d2p:/, "")}-${"1.0.0"}.json`,
};
