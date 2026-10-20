# tools/

Self-contained Node.js tooling for the standard (no network access, no dependency on any other repository).

| File | Purpose |
|---|---|
| `validate.mjs` | CLI for `npm run validate` |
| `conformance.mjs` | CLI for `npm run conformance:<level>` |
| `verify-fixture.mjs` | CLI for `npm run fixture:verify`: verifies a fixture manifest before any comparison (exit 1 = refused) |
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
| `oracle/` | Reference oracle that generates the Golden T-Shirt fixture (`npm run oracle`, `npm run oracle:check`; see [oracle/README.md](oracle/README.md)) and the Golden T-Shirt 3D generator (`npm run oracle:3d`) |
| `lib/garment.mjs` | Referential and semantic checks of module `3d` (garments, scene inputs, snapshots and expectations, panel meshes, edit inspections, proposals; catalog §3.9) |
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

The cases below `conformance/<level>/` are generated by `node tools/generate-conformance-cases.mjs`, except the Golden T-Shirt fixture cases in `conformance/<level>/golden-tshirt/` and `conformance/<level>/golden-tshirt-3d/` (generated by `tools/oracle/golden-tshirt-3d.mjs`, checked by `npm run oracle:check` and `test/golden-tshirt-3d.test.mjs`), which the script never touches. All digests in the case data are computed with `lib/c14n.mjs`. After changing the base documents in the script, or a schema that the case data must follow, rerun the script and commit the result; `npm test` fails while the committed cases differ from the generated ones.
