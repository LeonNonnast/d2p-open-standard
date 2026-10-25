# tools/

Self-contained Node.js tooling for the standard (no network access, no dependency on any other repository).

| File | Purpose |
|---|---|
| `validate.mjs` | CLI for `npm run validate` |
| `conformance.mjs` | CLI for `npm run conformance:<level>` |
| `verify-fixture.mjs` | CLI for `npm run fixture:verify`: verifies a fixture manifest before any comparison (exit 1 = refused); `npm run fixture:verify` runs it on the Golden T-Shirt 2D, 3D and drape manifests |
| `generate-conformance-cases.mjs` | Regenerates the kit's conformance cases (see below) |
| `lib/validate.mjs` | Schema, example and data-file validation rules (data files by `documentType`, catalog §3.0; presence of the standard-gap analysis, OSS-002) |
| `lib/conformance.mjs` | Case discovery, the level runners (`RUNNERS`) and case evaluation |
| `lib/structural.mjs` | Structural level: version gate, document-type selection, schema validation, classifiers C1-C5 |
| `lib/referential.mjs` | Referential level: ID uniqueness, reference resolution, staleness, digest and manifest integrity |
| `lib/semantic.mjs` | Semantic level: kernel-free domain rules, gate decision procedure, evidence state |
| `lib/bundle.mjs` | Case bundles: loading, manifest expansion, lookup index |
| `lib/fixture.mjs` | Fixture gate (QEV-001): `verifyFixture` and `openFixtureForComparison`, which refuses a fixture whose digests, listed files or references do not match |
| `lib/pattern.mjs`, `lib/expression.mjs` | Feature set 1.0.0, topology helpers, expression typing and constant evaluation |
| `lib/c14n.mjs` | Canonical form `d2p-c14n-v1` and digest profile `d2p-digest-v1` |
| `lib/json.mjs` | Strict JSON parsing (duplicate member names and invalid UTF-8 are errors) |
| `lib/diagnostics.mjs` | Diagnostic code registry with default severities, SemVer and version gate |
| `lib/model.mjs`, `lib/schemas.mjs` | Document identity, embedded documents, schema loading by `documentType` |
| `lib/ajv.mjs` | The single strict Ajv 2020-12 configuration |
| `oracle/` | Reference oracle that generates the Golden T-Shirt fixture (`npm run oracle`, `npm run oracle:check`; see [oracle/README.md](oracle/README.md)), the Golden T-Shirt 3D generator (`npm run oracle:3d`) and the Golden T-Shirt drape generator (`npm run oracle:drape`) |
| `lib/garment.mjs` | Referential and semantic checks of module `3d` (garments, scene inputs, snapshots and expectations, panel meshes, edit inspections, proposals; catalog §3.9) |
| `lib/drape.mjs` | Bodies, drapes and fit maps (catalog §3.9.1, draft `0.3.0`): the body target resolution shared by D2P-SEM-127 (implemented independently of the oracle), and the referential and semantic checks of body bindings and simulation configurations, baselines, avatar profiles, body model snapshots and expectations, drape scenes, draped panel meshes, fit maps, drape expectations and personal-derived documents (D2P-SEM-050, -052, -076, -127 to -130 and the extended D2P-REF codes) |
| `lib/pattern-edit.mjs` | Applying a `d2p:pattern.edit` (`applyPatternEdit`) or `d2p:pattern.parameters.update` (`applyParameterUpdates`) to a base pattern content, and the content the committed revision must have (`expectedCommandContent`); used for D2P-REF-003/-005 on operation keys and D2P-SEM-131 (catalog §3.6) |
| `test/` | Unit tests (`npm test`, Node's built-in test runner), including the fixture wiring, OSS-001 and QEV-001 tests in `test/fixtures.test.mjs` |

The validation and conformance CLIs accept `--json` and an optional repository root argument; `verify-fixture.mjs` accepts `--json`, `--root <dir>` and an optional repository-relative manifest path (default: the Golden T-Shirt v1 manifest). With `--json`, every conformance result carries the full list of reported diagnostics.

## Conformance runners

The runners implement the three levels of the schema catalog (`specifications/schema-catalog.md` §2). A case is run at its level after all lower levels have run on the whole bundle:

1. **structural** checks each document alone: strict JSON (D2P-STR-004), the version gate including embedded documents (D2P-STR-003), the `documentType` (D2P-STR-002), JSON Schema validation (D2P-STR-001) and the classifiers for expression nodes, unpinned references and units (D2P-STR-010, -011, -012);
2. **referential** runs only on a structurally valid bundle and reports the D2P-REF codes;
3. **semantic** runs only on a structurally and referentially valid bundle and reports the D2P-SEM codes.

A rejecting diagnostic of a lower level that the case does not expect fails the case as a precondition failure. Each failure carries its catalog diagnostic code; conformance runs use the registry default severities. The runners have no extension evaluators and understand no extension namespace, as the catalog requires.

Known limits of the 1.0 runners (stated as open; nothing here is claimed as checked):

- D2P-SEM-050 detects references from export documents to artifacts classified `personal` or `sensitive-personal`. Copied measurement values that carry no reference cannot be recognized without the source data and are not detected.
- D2P-REF-015 (one meaning per `definitionId`) is checked per resolution context: one document's `definitionRegistries`, and the documents one evaluation request pins. Two unrelated documents of a bundle that use different registries may define a `definitionId` differently, because different registry versions may legitimately refine a definition.
- D2P-REF-007 "a `sizeKey` used with two different size systems" is checked within one export scene (across its evaluations), not across unrelated documents of a bundle.
- Profile rule `parameters` are not yet checked against the rule's `parametersSchema`; the catalog assigns no diagnostic code to that check.
- Conditions that need a geometry kernel (`D2P-EVL-*`, curved contours for D2P-SEM-011/-012) are out of scope of the 1.0 conformance levels.
- D2P-SEM-014 checks the topology of a snapshot (elements, edge order, one segment per `d2p:` curve edge), not whether a segment's kind or coordinates match the evaluated curve. D2P-SEM-096 compares scene paths with snapshot contours and edges, not with the pattern. With `seamAllowancePolicy: included`, every contour must be drawn on a seam-line layer and is compared there; a cut line is compared exactly only when the piece declares no seam allowance, otherwise only the kernel-free vertex-box bounds of line-only contours are checked (catalog §3.7), so a cut line that lies too far outside its contour (for example scaled about its own origin) is not detected without an evaluator. Markers and labels are not compared with the snapshot.
- D2P-SEM-025 compares a match-point notch's edge and normalized `position` with the intervals of its side's interface. Whether the two notches meet at equal arc length from the seam start is geometry and is not checked.
- Derived values (seam arithmetic, transformed scene coordinates) are compared on quantized values within two quantization steps (`QUANTUM_SLACK` in `lib/semantic.mjs`, catalog §3.4).
- Drapes (draft `0.3.0`) are checked kernel-free only: the runners compare body control measures with the body target resolution, counts, IDs, pins, digests, zones and the declared deviations, but never measure a body mesh, detect cloth penetration or seam gaps, or run a solver. Whether a body mesh actually has its measured values, and whether a drape is physically plausible, is tested against implementations with the (provisional) tolerance profile. D2P-SEM-130 compares the fit maps given in the bundle; it does not drape.
- Personal-derived detection (D2P-SEM-050) follows references inside the bundle (body sources, body models, scenes, configurations); a personal source that is not in the bundle with its artifact metadata cannot be recognized. A simulation report counts as personal-derived only through its scene. D2P-SEM-052 checks only findings whose subject states `personalDerived: true` or is a personal-derived 3D document; findings whose `elementRefs` point into personal artifacts are not checked, so `0.2.1` reports stay valid (catalog §2.4). Diagnostic messages of the drape checks print no measured or fit values (a fit map may be personal-derived).
- D2P-SEM-131 and the key checks of `d2p:pattern.edit` run only when the base content (and, for D2P-SEM-131, the revision record with the command's `commandId` and its content) are in the bundle.
- Every drape check (draft `0.3.0`) is skipped when a document it needs is not in the bundle. Avatar, solver and material physics profiles named outside `inputDigests` need not resolve (no D2P-REF-001 for them); the semantic level uses them when they are in the bundle.
- For the body source pin of a body model or drape scene, only the entry of the source kind's own role (`body-measurement-profile` or `size-system`) must occur exactly once; an additional entry of the other role (for example the pinned size system of a profile's baseline) is allowed.
- Not checked: a drape scene's `arrangementId` against its configuration's `arrangementId`, the scene's `patternEvaluations` pins against the configuration's `patternEvaluationId`, the personal derivation of a scene input (scene inputs have no `personalDerived` member), the array order of §1.8 in body models, draped meshes and fit maps (as for every derived document), and the edge length (`triangulation.maxEdgeLengthMm`) of rest meshes against their mesh profile. The rest meshes of the drape cases come from the boundary-only mesher of the 3D generator and exceed the `maxEdgeLengthMm` of `d2p:drape-coarse`; they are case data, not a meshing result of that profile.
- Elements a `d2p:pattern.edit` adds are checked only inside the resulting revision content, when it is in the bundle; inside the command, element IDs are unique per operation `element` (D2P-REF-005), and an add followed by a replace of the same ID is allowed. When a pattern pins several versions of one definition registry, `replace` and `remove` act on the first in array order (catalog §3.6).
- The body target resolution reads source values as millimetres. When a definition is both required and derivable (itself D2P-SEM-127), a derivation can supply its target.

## Fixtures in the conformance kit

The Golden T-Shirt v1 fixture is wired into all three levels (cases in `conformance/<level>/golden-tshirt/`):

- `referential/golden-tshirt/manifest-integrity.case.json` lists the fixture manifest with role `manifest`: every listed file must exist with a matching digest, no unlisted file may be in the fixture directory, `fixtureDigest` must match (D2P-REF-011, D2P-REF-012), and the expanded bundle of all `input` and `expected` files plus the external files must be structurally valid and resolve.
- `semantic/golden-tshirt/fixture.case.json` runs every semantic rule on the same bundle.
- One case per negative fixture (catalog §4.3). Each is a byte-identical copy of `fixtures/golden-tshirt/v1/negative/<name>/case.json`, which the oracle generates.

`test/fixtures.test.mjs` enforces the wiring:

- the expanded fixture bundle reports **no** diagnostic of any severity at any level, and every file of the fixture directory is listed in the manifest;
- the negative fixtures are exactly those of catalog §4.3 (the expected level, codes and outcome are written into the test, independent of the generated files); each case copy is identical to its source; every defective document of a negative directory is a subject; and the runner reports **exactly** the expected codes, only on subject documents;
- every conformance case of the repository reports exactly its expected codes, no additional ones;
- **QEV-001** (a fixture whose digest differs is refused for comparison): in a temporary copy, a changed expected result, input, external file or negative file, a wrong `fixtureDigest`, an unlisted file and a missing file are each refused by `verifyFixture`, `openFixtureForComparison` and the CLI, and the manifest-integrity case fails. Integrity is checked even when the changed file is no longer schema-valid;
- **OSS-001** (independent parsing): a consumer that uses only a generic JSON Schema 2020-12 validator (`ajv`) and the published schema files resolves every `$ref` offline and validates every fixture document, the manifest and the external files by `documentType`, with a `schemaVersion` readable by standard 1.0; the tooling imports nothing but Node.js built-ins, `ajv`, `ajv-formats` and files of this repository.

## Generated conformance cases

The cases below `conformance/<level>/` are generated by `node tools/generate-conformance-cases.mjs`, including the pattern-edit cases in `conformance/<level>/pattern-edit/` (draft `0.3.0`, catalog §4.6), except the Golden T-Shirt fixture cases in `conformance/<level>/golden-tshirt/`, `conformance/<level>/golden-tshirt-3d/` (generated by `tools/oracle/golden-tshirt-3d.mjs`, checked by `npm run oracle:check` and `test/golden-tshirt-3d.test.mjs`) and `conformance/<level>/golden-tshirt-drape/` (generated by `tools/oracle/golden-tshirt-drape.mjs`, checked by `npm run oracle:check`), which the script never touches. All digests in the case data are computed with `lib/c14n.mjs`. After changing the base documents in the script, or a schema that the case data must follow, rerun the script and commit the result; `npm test` fails while the committed cases differ from the generated ones.
