# Changelog

All notable changes to the D2P Open Standard are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the standard follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) as described in [GOVERNANCE.md](GOVERNANCE.md).

## [Unreleased]

## [0.3.0] - 2026-10-25

Pre-release **0.3.0**: a minor extension of the standard 1.0 draft by bodies, drapes and fit maps in the module `3d` (design decision ADR-029), the baseline size of a body measurement profile and the construction command `d2p:pattern.edit`. Documents still declare `schemaVersion: "1.0.0"`; nothing that was valid before becomes invalid, except for the `relativePath` fix and D2P-SEM-131 on `d2p:pattern.parameters.update` (both below, catalog §1.11). Every profile added by this release is **provisional**.

### Added

- **Bodies, drapes and fit maps** (catalog §3.9.1; design decisions ADR-029, ADR-009 §14) with eight new schemas in module `3d`, each with valid and invalid examples:
  - vocabularies `avatar-profile` (pose, required definitions, linear derivations, per-measure tolerances, landmarks, landmark-defined zones), `solver-profile` (profile kind, rest-mesh profile, fixed time stepping, gravity, damping, pre-positioning, collision, equilibrium, failure limits, budget) and `material-physics-profile` (material class, areal density, thickness, stretch, shear and bending stiffness, friction);
  - derived documents `body-model-snapshot` (`bms_`; body mesh in m, landmarks, control measures with target, origin `profile`/`size-table`/`inferred`, measured value and deviation; `failed` instead of an invented value), `draped-panel-mesh` (`dpm_`; draped positions of a rest mesh, vertex i of the rest mesh, so pattern positions and edge bindings stay) and `fit-map` (`fmp_`; strain, clearance and a contact-pressure approximation per zone and optionally per vertex, always `estimate: "model-estimate"` with solver profile and material status);
  - records `body-model-expectation` (`bmx_`) and `drape-expectation` (`drx_`; metamorphic comparisons of fit-map zone metrics between two drapes on the same body).
- **Garment body bindings and simulation configurations** (optional `garment.bodyBindings`, `garment.simulationConfigurations`; `$defs` `bodySource`, `bodyBinding`, `simulationConfiguration`, `materialPhysicsAssignment`): a pinned body source (body measurement profile or size entry), avatar profile and pose `d2p:a-pose`; per configuration the body binding, size, start arrangement, solver profile, one material physics profile per material assignment and the random seed.
- **Scene mode `physical-simulation`** (drapes): `scene-input` and `scene-snapshot` with `simulationConfigurationId` and `bodyModelRef`, the snapshot also with `drapedMeshRefs` (`$defs/drapedMeshRefEntry`); `personalDerived` on scene snapshots, simulation reports and the new derived documents. `sceneDigest` covers `bodyModelRef` and `drapedMeshRefs` only when present, so arrangement scene digests are unchanged.
- **Baseline size** of a body measurement profile (`body-measurement-profile.baseline`, `$defs/measurementBaseline`; catalog §3.3): table values carry `method` and `source.kind` `size-table` and equal the baseline entry, every other value overrides the table.
- **Measurement-definition registry `d2p:measurement-definitions` 1.1.0**: every 1.0.0 definition unchanged plus 15 body definitions (ankle, calf, head, knee, thigh and underbust girths, back width, shoulder length, height, bust, cervicale, hip, knee and waist heights, inside-leg length). 1.0.0 stays published.
- **Construction command `d2p:pattern.edit`** (catalog §3.6; `$defs` `editPatternPayload`, `patternOperation`): ordered `add`, `replace`, `remove` and `set-name` operations on the pattern's collections; the result of applying them to the expected revision is the only content the new revision may have.
- **Core extensions** (minor): global ID prefixes `bms`, `bmx`, `dpm`, `fmp`, `drx`; input roles `avatar-profile`, `solver-profile`, `material-physics-profile`; element types `d2p:body-binding`, `d2p:simulation-configuration`; tolerance metrics `d2p:avatar-measurement-deviation`, `d2p:drape-penetration`, `d2p:drape-seam-gap`; the eight new document types in `documentTypeName`; the body-zone vocabulary as the named `$defs/bodyZone` of `fit-profile` (same terms).
- **Digest kinds and orders**: `meshDigest` of body models (over `mesh`) and of draped meshes (over `{positionsM}`); `resultDigest` on `body-model-snapshot`, `draped-panel-mesh` and `fit-map`; array orders of the new documents; sorted avatar-profile arrays (D2P-REF-014).
- **Diagnostic codes** D2P-SEM-052 (findings about personal-derived documents of module `3d`, or documents stating `personalDerived: true`, are restricted), D2P-SEM-076 (baseline values), D2P-SEM-127 (avatar profiles and body models; body target resolution), D2P-SEM-128 (simulation configurations), D2P-SEM-129 (drape consistency), D2P-SEM-130 (drape expectations), D2P-SEM-131 (the committed content of a pattern command equals the result of applying it); D2P-SEM-050 extended to personal-derived documents, D2P-SEM-075 to avatar profiles and body models, and D2P-REF-001, -003, -005, -007, -008, -009, -011 and -014 extended; new referential resolution rows and schema-enforced conditions (catalog §1.12, §2.6). The new codes are assigned to no validation rule in this release.
- **Provisional profiles** (not calibrated, not to be used for comparing implementations): avatar profile `d2p:standard-a-pose` 1.0.0, solver profiles `d2p:fit-approximation` and `d2p:physical-cloth` 1.0.0, material physics profiles `d2p:cotton-jersey`, `d2p:cotton-woven`, `d2p:denim` and `d2p:chiffon` 1.0.0, mesh profiles `d2p:drape-coarse` and `d2p:drape-fine` 1.0.0, tolerance profile `d2p:golden-tshirt-drape` 1.0.0.
- **Golden T-Shirt drape v1 fixture** (`fixtures/golden-tshirt-drape/v1/`, catalog §4.6): a synthetic size system with two bodies, a synthetic profile with a baseline and two overrides, the two T-shirt sizes as garments with body bindings and simulation configurations, expected body models and a size comparison; generated and checked by `tools/oracle/golden-tshirt-drape.mjs`, with six negative fixtures.
- **Conformance cases** in `conformance/<level>/golden-tshirt-drape/` (manifest integrity, the whole fixture, a complete drape chain on a synthetic and on a personal body, a met drape expectation, and negative cases for D2P-REF-003, -007, -009, -011, D2P-SEM-050, -052, -076, -127 to -130 and D2P-STR-001) and in `conformance/<level>/pattern-edit/` (D2P-SEM-131, D2P-REF-003, D2P-REF-005, D2P-STR-001 and two accepted results).
- **Kit**: `tools/lib/drape.mjs` (body target resolution and the checks of the new documents) and `tools/lib/pattern-edit.mjs` (applying `d2p:pattern.edit` and `d2p:pattern.parameters.update` to a base content).

### Changed

- **Validity change: D2P-SEM-131 on `d2p:pattern.parameters.update`** (catalog §1.11, §3.6). The committed revision of a parameter update must equal the base content with the `expr` of every named parameter replaced. A bundle with such a command, its base, the revision record carrying its `commandId` and a revision content that differs (for example a pattern also renamed in the same revision) was accepted by `0.2.1` and is rejected now. This is deliberate: the result of a command is defined, and a different committed content is an implementation error.
- **Scoped so that `0.2.1` documents stay valid**: D2P-SEM-052 binds only findings whose `subjectRef` names a personal-derived document of module `3d` or a document stating `personalDerived: true`; findings about other documents (for example a 2D evaluation that pins a personal profile) and findings whose `elementRefs` point into personal artifacts are not checked (`restricted` is recommended for them, catalog §3.5). The extended D2P-SEM-050 treats a simulation report as personal-derived only through its scene, never through its own references, which `0.2.1` left unconstrained.
- `specifications/gap-analysis.md` covers the module `3d` (glTF reused; ISO 8559-1 terminology for body definitions; ISO 20685 scanning not used; no garment-simulation standard known) instead of listing it as a module without schemas.
- The 1.0.0 validation rules and profiles are unchanged (fixtures pin their digests); the catalog states that their "all" targets name the document types before module `3d`, and that the 3D codes are assigned to no rule yet.
- `npm run fixture:verify` and `npm run oracle:check` cover the drape fixture.

### Fixed

- **`relativePath` without look-around** (`schemas/benchmark/fixture-manifest.schema.json`): the pattern is now RE2-compatible, so validators in Go and Rust compile it (the P8 MCP issue). It accepts exactly the paths of its rule; the previous look-ahead pattern also accepted some paths that break the rule after a line break, which are now rejected.

### Not yet done

- Every profile of this release is provisional: values are proposals without calibration (anthropometric data, fabric samples), domain review or legal review of any source (E-23); freezing them is a maintainer decision.
- The domain reviews of the Golden T-Shirt v1, 3D v1 and drape v1 fixtures are pending (QEV-016 blocks `v1.0.0`).
- Size tables are **not** part of the standard (E-24): D2P size tables are size-system artifacts of implementations; the fixture's size system is synthetic test data.
- Deferred (catalog §5): a realistic avatar backend (E-22), poses other than `d2p:a-pose` and motion, the mode `kinematic-assembly`, material artifacts, garment command types, validation rules and a drape profile for the new codes, mappings of the new body definitions to ISO 8559-1.

## [0.2.1] - 2026-10-25

Patch release: maintainer freeze of the Golden T-Shirt profiles. No rule about which documents are valid changes.

### Changed

- **Profiles frozen** by maintainer decision with all values unchanged from the provisional proposals (same profile versions, catalog §3.8: only a changed value is a new version): tolerance profile `d2p:golden-tshirt-2d` 1.0.0 (contour 0.10 mm, relative seam length 0.005, control square 0.1 mm), tolerance profile `d2p:golden-tshirt-3d` 1.0.0 (mesh planar deviation 0.10 mm) and mesh profile `d2p:golden-tshirt-3d-preview` 1.0.0. Results compared against them can now count as benchmark evidence.
- **Fixtures regenerated** (`npm run oracle`, `npm run oracle:3d`): the profile digests changed, and with them the pins, evaluation keys and digests that depend on them in the Golden T-Shirt v1 and 3D v1 fixtures and the 3D conformance case data. Geometry and expected values are unchanged; implementations must re-pin the new fixture digests.

## [0.2.0] - 2026-10-20

Pre-release **0.2.0** (expert review of the 3D arrangement pending): a minor extension of the standard 1.0 draft by the module `3d`. Documents still declare `schemaVersion: "1.0.0"`; nothing that was valid before becomes invalid.

### Added

- **Module `3d`** (catalog §3.9; design decisions ADR-009, ADR-021) with nine schemas, each with valid and invalid examples:
  - `garment` (artifact content, `artifactType` `d2p:garment`): pinned pattern evaluation references (pattern revision, size, configuration, evaluation and snapshot digests), panel instances that bind one cut instance each (two sleeves of one sleeve piece are two panel instances), sewing bindings to the pattern's seam connections and sewing groups (never copies of them), material assignments and arrangements with placements (mm, unit quaternions);
  - `scene-input` with its `evaluationKey` (cache key; a scene built for another key is stale) and `scene-snapshot` (right-handed, Y up, front +Z, `sceneUnit: "m"`, explicit `unitConversion` mm to m with factor 0.001, input digests, backend build, mesh references, panel and seam bindings, control measures, quality status, optional glTF representation, `bindingsDigest` and `sceneDigest`);
  - `panel-mesh-result` (flat panel mesh in panel-local mm, `vertexUvToPattern2D`, edge bindings by edge ID, `maxApproximationErrorMm`, `meshDigest`; failures are results with diagnostics) and the vocabulary `mesh-profile`;
  - `sim-report` (solver, solver profile and tolerance profile always named, so findings are attributable);
  - `inspect-3d-edit-result` (every edit classified `supported`, `ambiguous` or `forbidden`, schema-enforced) and `pattern-proposal` (never a revision; accepting it is a separate `d2p:pattern.parameters.update` command);
  - `scene-expectation` (expected scene structure for fixtures).
- **glTF view of personal-derived scenes** (catalog §3.9, D2P-SEM-050, SIM-009): a view of a scene pinning a body measurement profile states `personalDerived: true` in `asset.extras.d2p` and never names the profile or a body value.
- **Core extensions** (minor): global ID prefixes `sci`, `ssn`, `pmr`, `smr`, `ppr`, `ier`, `sxp`; artifact type `d2p:garment`; element types `d2p:pattern-evaluation-ref`, `d2p:panel-instance`, `d2p:sewing-binding`, `d2p:material-assignment`, `d2p:arrangement`; input roles `garment` and `mesh-profile`; tolerance metric `d2p:mesh-planar-deviation`; the 3D document types in `documentTypeName`.
- **Digest kinds** `bindingsDigest`, `sceneDigest`, `meshDigest` and `evaluationKey`; `resultDigest` on `panel-mesh-result`, `sim-report` and `inspect-3d-edit-result`; array orders of the 3D documents.
- **Diagnostic codes** D2P-SEM-120 (panel instances), D2P-SEM-121 (sewing bindings), D2P-SEM-122 (arrangements), D2P-SEM-123 (mm to m conversion), D2P-SEM-124 (scene bindings reproduce the garment), D2P-SEM-125 (panel meshes), D2P-SEM-126 (edit inspection and proposal); D2P-REF-007, D2P-REF-011 and D2P-SEM-050 extended to the 3D documents; new referential resolution rows (catalog §2.6). The kit implements them in `tools/lib/garment.mjs`.
- **Provisional profiles** `d2p:golden-tshirt-3d` 1.0.0 (tolerance profile, `d2p:mesh-planar-deviation` 0.10 mm) and `d2p:golden-tshirt-3d-preview` 1.0.0 (mesh profile, `vocabularies/mesh-profiles/`). Both must be frozen by maintainer decision before any implementation is compared against them.
- **Golden T-Shirt 3D v1 fixture** (`fixtures/golden-tshirt-3d/v1/`, catalog §4.5): one garment per size with front, back and two sleeve panel instances, bindings to the existing seam interfaces, a flat-lay arrangement, scene inputs, expected scene structures (bindings, control measures in mm and m, anchors, bindings digest) and the rebind to pattern r2 with stable IDs; generated and checked by `tools/oracle/golden-tshirt-3d.mjs` (`npm run oracle:3d`, part of `npm run oracle:check`).
- **20 conformance cases** in `conformance/<level>/golden-tshirt-3d/` (3 structural, 5 referential, 12 semantic), including an arrangement scene snapshot with four panel meshes and a glTF view, a 3D edit inspection with its proposal, and one negative case per new code; test IDs GAR-, SIM-, T3D-, CAD-012, EXP-013, TOP-008 and QEV-011 are recorded in the cases.

### Changed

- `npm run fixture:verify` verifies both fixtures; `npm run oracle:check` also checks the 3D generator.
- Classifier C5 accepts the benchmark units in `d2p:sim-report`.
- Module dependency order gains group (7) `3d`.

### Not yet done

- The 3D tolerance and mesh profiles are provisional; the domain review of the 3D arrangement is pending.
- Deferred (catalog §5): modes `kinematic-assembly` and `physical-simulation`, body bindings, material artifacts, a garment impact-report document, garment command types and proposals for free mesh deformations.

## [0.1.0] - 2026-10-19

First pre-release: a complete **draft of standard 1.0** with its conformance kit and the Golden T-Shirt v1 fixture. It is tagged `v0.1.0`, not `v1.0.0`, because the release criteria for 1.0 are not met yet (see *Not yet done* below). Before `1.0.0` the standard is unstable, and later 0.x releases may contain breaking changes (see [GOVERNANCE.md](GOVERNANCE.md)). Documents already declare `schemaVersion: "1.0.0"`, the release they are drafted for, and the fixture declares `fixtureVersion: "1.0.0"`; those values do not mean that 1.0 has been released.

### Added

- **Schema catalog** `specifications/schema-catalog.md` (normative draft of release 1.0): identifiers, pinned references (`artifactRef`, `elementRef`, derived references), canonical units (mm, rad), namespaced extensions with provenance, version and `onUnknown` fallback, canonical form `d2p-c14n-v1` and digest profile `d2p-digest-v1`, schema authoring and SemVer compatibility rules, the three conformance levels, structural classifiers, the diagnostic code registry (`D2P-STR-*`, `D2P-REF-*`, `D2P-SEM-*`, reserved `D2P-EVL-*`), the conformance case format, the referential resolution scope, the module catalog and the Golden T-Shirt v1 fixture.
- **50 JSON Schemas** (2020-12, strict, `$id` derived from the path) in the modules `core`, `pattern`, `measurement`, `eval`, `validation`, `command`, `event`, `error`, `print` and `benchmark`, each with valid and invalid examples. The directories `3d`, `assembly`, `production`, `package` and `import` exist and are still empty.
- **Vocabularies**: measurement-definition registry `d2p:measurement-definitions` 1.0.0 (landmarks, path type, posture, state; mappings to external standards are informative only), 25 standard validation rule definitions and the validation profiles `d2p:draft-edit`, `d2p:sample-cut` and `d2p:print-1to1`.
- **Tolerance profile** `d2p:golden-tshirt-2d` 1.0.0, status **provisional**: proposed values only, not frozen, not usable for benchmark runs.
- **Golden T-Shirt v1 fixture** (`fixtures/golden-tshirt/v1/`): two synthetic sizes, two material/fit configurations, front, back and one sleeve cut twice, ten seam connections, two sewing groups, a change case (`bust-ease` +20 mm, `sleeve-length` +30 mm), expected evaluations, geometry snapshots, fit and validation reports, gates, export scenes and A4 print jobs, twelve negative fixtures and a manifest with a digest for every file. All values are synthetic test data, not a size table or a drafting norm.
- **Reference oracle** `tools/oracle/` that generates the fixture from a closed-form construction with an independent cross-check (`npm run oracle`, `npm run oracle:check`).
- **Conformance kit** with runners for the `structural`, `referential` and `semantic` levels (strict JSON parsing, version gate, schema validation and classifiers; ID, reference, staleness, digest and manifest integrity; kernel-free domain rules, gate decision procedure and evidence state) and 141 cases: 18 structural, 43 referential and 80 semantic, including positive and negative topology (TOP-001..004, TOP-010) and sewing-group (SWG-001..008, SWG-011) cases.
- **Golden T-Shirt conformance cases** in `conformance/<level>/golden-tshirt/`: manifest integrity with resolution of the whole fixture (referential), all semantic rules on the whole fixture, and one case per negative fixture. Each negative fixture is detected with exactly its expected diagnostic code.
- **Standard-gap analysis** `specifications/gap-analysis.md` (test OSS-002): per module, the existing standards and formats that are reused or deliberately not replaced, and the textile semantic gap the module fills. `npm run validate` fails if it is missing.
- **Data-file validation** in `npm run validate` (catalog §3.0 tooling requirement): every vocabulary, tolerance-profile, fixture (`manifest.json`, `inputs/`, `expected/`) and conformance case file is validated against the schema of its `documentType`, an unknown `documentType` is an error, and vocabulary files must be named after their ID and version.
- **Gates reference test evidence**: optional `gate-evaluation.evidenceRefs` (quality evidence bundles) with the decision steps `d2p:evidence-missing` (QEV-012) and `d2p:evidence-not-passed`; `quality-evidence-bundle.gate` is defined as the validation profile of the gates it serves (D2P-REF-007 on mismatch).
- **Ease rule applicability** (FIT-002): an ease rule applies only when the request's material meets its `materialCondition`; a skipped negative-ease rule is reported as D2P-SEM-074 instead of being approved or dropped silently.
- **Pinned inputs of evaluations and snapshots** (D2P-REF-007, D2P-REF-009): an evaluation's artifact input digests are exactly the revisions its embedded request pins; a snapshot's input digests always include its pattern, and a snapshot `sizeKey` resolves in the size system named by its `size-system` input digest.
- **Body and garment definitions are never confused** (new code D2P-SEM-075 in `d2p:measurement-equivalence`): size-entry and body-profile values and ease-rule body definitions are `kind: body`; garment targets, fit targets and ease-rule garment definitions are `kind: garment`. A `definitionId` appears at most once per size entry and per body profile (D2P-REF-005).
- **Output profiles defined** (new code D2P-SEM-095 in `d2p:print-calibrated`): `d2p:home-print-a4`/`-a3` bind their media, tiling with overlap, registration marks, sheet labels and a label per piece instance. The `print` level places sheet furniture so that it never covers cut or seam lines, instead of requiring it outside every piece bounding box.
- **Mapping profiles** (`core/mapping-profile`, document type `d2p:mapping-profile`, files under `mappings/`): the versioned, provenance-carrying mechanism for mappings to external ontologies and industry conventions (design decision ADR-005). No mapping profile is published yet.
- **Consistency checks for derived documents** (new codes): D2P-SEM-014 (a geometry snapshot holds the complete topology of its pinned pattern) and D2P-SEM-024 (seam deviation and lengths agree with the interfaces and the declared ease), both in the new rule `d2p:snapshot-consistent`; D2P-SEM-096 in `d2p:print-geometry-valid` (an export scene reproduces the pinned snapshot contours under rigid instance transforms, with every cut instance once per size); D2P-SEM-103 (a validation report agrees with its status, findings and profile: purpose, rule versions, severities and codes) and D2P-SEM-104 (a gate's profile and reports have the purpose of its action). Derived values are compared on quantized values within two quantization steps.
- **Match points on their side** (new code D2P-SEM-025 in `d2p:seam-interface-continuous`): `notchIdA` lies on interface A and `notchIdB` on interface B of the seam connection, by edge and normalized position.
- **Definition units** (D2P-SEM-070 extended): a measurement definition's `unit` is the canonical unit of its `dimension`.
- **Mapping-profile conformance cases** (accept, unsorted entries, duplicate entry); concrete mappings and value-level mappings are listed as deferred in catalog §5.
- **Vocabulary integrity**: a `definitionId` occurs once per registry, a `ruleId` once per profile and a mapping entry once per mapping profile (D2P-REF-005); these arrays are sorted (new code D2P-REF-014 in `d2p:references-resolve`). A fit evaluation report's artifact input digests are pinned by its evaluation (D2P-REF-007, FIT-003).
- **One meaning per measurement definition** (new code D2P-REF-015 in `d2p:measurements-complete`): two registries declared by one document, or used by the documents one evaluation request pins, must not define the same `definitionId` differently; resolution no longer depends on registry order.
- **Scene geometry completeness** (D2P-SEM-096 extended): every path that names a contour or edge is compared with the snapshot on every layer; free paths are allowed only on construction or extension layers; with `seamAllowancePolicy: included` every contour is drawn on a seam-line layer, a cut line equals its contour when the piece declares no seam allowance, and otherwise meets kernel-free vertex-box bounds.
- **Referential resolution scope** lists every pattern-internal element reference (edges, interfaces, connections, notches, cut instances, features, parameters, measurement inputs), including SWG-008 for `layerOrder.cutInstanceKey`.
- **Sewing-group status**: derived operating status (`valid`, `warning`, `invalid`, `unsupported-profile`) and the reserved code D2P-SEM-034 for constructions that cannot be expressed as binary connections.
- **Extensible vocabularies** for sewing member and layer roles (`d2p:outer-fabric`, `d2p:inner-fabric`, `d2p:binding`, `d2p:lining`, `d2p:reinforcement`, `d2p:interfacing`), seam validation rule IDs and tolerance metrics in test runs; `relationship.role` accepts extension names only. An unknown `d2p:` term is now a schema error in all of them (catalog §1.4 separates vocabulary terms from identifiers).
- **Fixture verification** before comparison: `npm run fixture:verify` and `openFixtureForComparison` in `tools/lib/fixture.mjs` refuse a fixture whose digests, listed files or references do not match (test QEV-001).
- Tests for **independent parsing** (test OSS-001): every schema `$ref` resolves offline within the published schema set, and every fixture document, the manifest and the external files are read and validated with a generic JSON Schema 2020-12 validator, without the kit's own code; the tooling depends only on Node.js built-ins, `ajv` and `ajv-formats`.

### Changed

- `schemas/core/units.schema.json` gained bare-number definitions for lengths in mm and angles in rad; `m` and `deg` stay reserved for later import/export boundary schemas.
- `npm run check` now runs validation, the three conformance levels, fixture verification, the oracle check and the unit tests. The CI workflow runs the same checks, including `fixture:verify` and `oracle:check`.
- `featureCapability.lowersTo` accepts only the `d2p:` feature types of feature set 1.0.0; declarative lowering is informative in 1.0 (no decomposition template yet) and behaves like extension lowering without an evaluator.
- A feature capability's `onUnknown` is always `read-only`: a missing extension evaluator may restrict editing but never prevents read-only display of a conforming snapshot, so `reject` is reserved for extension blocks (D2P-SEM-006 no longer applies to feature types).
- The hand-written description of the Golden T-Shirt moved from `fixtures/golden-tshirt/v1/README.md` to `fixtures/golden-tshirt/README.md`, because catalog §2.4 (`D2P-REF-012`) allows no unlisted file inside a fixture directory.

### Not yet done (blocking `v1.0.0`)

- Domain review of the Golden T-Shirt by a pattern maker or seamstress (test QEV-016): **pending** (`manifest.json` → `review.status: "pending"`).
- The tolerance profile `d2p:golden-tshirt-2d` is provisional and must be frozen by maintainer decision before any implementation is compared against it.
- The `d2p-digest-v1` quantization step needs maintainer confirmation before the first stable tag (`v1.0.0`); pre-release tags may be cut before it.
- Known simplifications of the Golden T-Shirt construction that the domain review must judge (neck opening too small for a woven pull-over, unsquared shoulder-seam and sleeve underarm corners, front armhole longer than back) are listed in [fixtures/golden-tshirt/README.md](fixtures/golden-tshirt/README.md).
- Known runner limits and deferred items are listed in [tools/README.md](tools/README.md) and catalog §5 (among them: seam-allowance offsets are not part of the v1 expected results; geometry-kernel conditions `D2P-EVL-*` are tested against implementations only).
