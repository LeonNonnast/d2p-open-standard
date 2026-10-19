# conformance/

Conformance cases in three levels that are **independently runnable**:

| Level | Checks | Command |
|---|---|---|
| `structural/` | Documents conform to the JSON Schemas (version gate, document type, schema, structural classifiers) | `npm run conformance:structural` |
| `referential/` | IDs, references and pinned revisions resolve inside the bundle; vocabulary order; staleness; digest and manifest integrity | `npm run conformance:referential` |
| `semantic/` | Domain rules that need no geometry kernel (feature DAG, expression dimensions, topology and sewing-group invariants, snapshot completeness, privacy, print scenes and jobs, report consistency, gates) | `npm run conformance:semantic` |

A case is a file named `*.case.json` anywhere below its level directory and conforms to `schemas/benchmark/conformance-case.schema.json`. Its data documents live in a directory with the same name next to the case file. Paths in cases are repository-relative. The rules for bundles, outcomes, expected diagnostics and editability are defined in `specifications/schema-catalog.md` §2. Each run reports how many cases were discovered, passed, failed, inconclusive and skipped (`--json` for machine-readable output including every reported diagnostic). A case for a level without a runner fails, so an unimplemented check can never appear green.

Every level contains positive (`accept`) and negative (`reject`) cases. Each negative case names the diagnostic code it must produce, and `npm test` requires every case to report **exactly** its expected codes.

## Layout

```text
conformance/
  structural/
    <slug>.case.json, <slug>/…
    sewing-groups/SWG-002-…, SWG-004-…
  referential/
    <slug>.case.json, <slug>/…
    topology/TOP-004-…
    sewing-groups/SWG-003-…, SWG-008-…
  semantic/
    <slug>.case.json, <slug>/…
    topology/TOP-001-…, TOP-002-…, TOP-003-…, TOP-010-…
    sewing-groups/SWG-001-…, SWG-005-…, SWG-006-…, SWG-007-…, SWG-011-…
  structural/golden-tshirt/         forbidden-expression-node, unpinned-reference, incompatible-schema-version
  referential/golden-tshirt/        manifest-integrity, unresolvable-reference, stale-revision
  semantic/golden-tshirt/           fixture, open-contour, self-intersection, impossible-constraint, feature-cycle,
                                    unit-mismatch, unknown-extension-feature, private-measurement-export
```

Topology and sewing-group cases follow catalog §4.4: the case file is `<ID>-<slug>.case.json`, its data directory `<ID>-<slug>/`, and the case carries `testIds: ["<ID>"]`. Every listed test ID has a positive and a negative case.

## Golden T-Shirt cases

The Golden T-Shirt v1 fixture (`fixtures/golden-tshirt/v1/`) is part of the suite:

| Case | Level | Expected |
|---|---|---|
| `manifest-integrity` | referential | accept: every listed file exists with a matching digest, no unlisted file, correct `fixtureDigest`; the whole fixture resolves. A changed fixture is rejected with D2P-REF-011/-012 and must not be compared against (test QEV-001; `npm run fixture:verify`) |
| `fixture` | semantic | accept: every semantic rule, including the gate decision procedure, holds on the whole fixture |
| `forbidden-expression-node` | structural | reject, D2P-STR-010 (with D2P-STR-001) |
| `unpinned-reference` | structural | reject, D2P-STR-011 (with D2P-STR-001) |
| `incompatible-schema-version` | structural | reject, D2P-STR-003 |
| `unresolvable-reference` | referential | reject, D2P-REF-002 |
| `stale-revision` | referential | reject, D2P-REF-006 |
| `open-contour` | semantic | reject, D2P-SEM-010 |
| `self-intersection` | semantic | reject, D2P-SEM-011 |
| `impossible-constraint` | semantic | reject, D2P-SEM-040 |
| `feature-cycle` | semantic | reject, D2P-SEM-001 |
| `unit-mismatch` | semantic | reject, D2P-SEM-002 (mm + rad) |
| `unknown-extension-feature` | semantic | accept with D2P-SEM-004, `editability: read-only` (the conforming snapshot stays displayable) |
| `private-measurement-export` | semantic | reject, D2P-SEM-050 |

A negative case file is a byte-identical copy of `fixtures/golden-tshirt/v1/negative/<name>/case.json`, which the reference oracle generates; `npm test` fails if a copy differs, if a negative fixture has no case, or if a case reports any code other than its expected ones. After regenerating the fixture (`npm run oracle`), copy changed `case.json` files here.

## Coverage

| Level | Negative cases (expected code) |
|---|---|
| structural | feature capability declaring `onUnknown: reject` (D2P-STR-001; a missing evaluator never blocks the read-only snapshot, so feature capabilities have no `reject`), forbidden expression node / script (D2P-STR-010), unpinned reference (D2P-STR-011), incompatible and newer schema version (D2P-STR-003), unknown document type (D2P-STR-002), duplicate member name (D2P-STR-004), unit not permitted (D2P-STR-012), schema violation (D2P-STR-001), snapshot without a pattern input digest (D2P-STR-001), SWG-002 and SWG-004 (D2P-STR-001) |
| referential | unresolved document (D2P-REF-001), unresolvable pinned revision (D2P-REF-002), TOP-004 and SWG-003 unknown IDs (D2P-REF-003), element-type mismatch (D2P-REF-004), duplicate element ID and duplicate measurement definition in a size entry (D2P-REF-005), stale gate and stale command (D2P-REF-006), revision sequence, evidence collected for another gate, evaluation input digests that differ from the request and a snapshot pattern digest that differs from its patternRef (D2P-REF-007), unresolved measurement definition (D2P-REF-008), unresolved size key, including a snapshot sizeKey without a size-system input digest (D2P-REF-009), unresolved cut instance, including SWG-008 (D2P-REF-010), revision and manifest digest mismatch (D2P-REF-011), unlisted fixture file (D2P-REF-012) |
| semantic | feature cycle (D2P-SEM-001), unit mismatch mm + rad and slot mismatch (D2P-SEM-002), missing capability (D2P-SEM-005), open contour (D2P-SEM-010), TOP-002 self-intersection (D2P-SEM-011), TOP-003 discontinuous interface (D2P-SEM-020), TOP-010 and SWG-011 (D2P-SEM-023), SWG-006 (D2P-SEM-030), SWG-005 (D2P-SEM-031), SWG-007 (D2P-SEM-032), impossible constraint (D2P-SEM-040), private measurement export (D2P-SEM-050), classification (D2P-SEM-051), measurement unit (D2P-SEM-070), required measurement missing (D2P-SEM-072), body and garment definitions on the wrong side (D2P-SEM-075), missing print calibration (D2P-SEM-091), home-print output profile violated (D2P-SEM-095), waiver scope (D2P-SEM-101), gate decision, including a gate that ignores missing test evidence (D2P-SEM-102), evidence state (D2P-SEM-110) |

Accepted cases with warnings: an unknown extension feature type with `onUnknown: read-only` (D2P-SEM-004) and an unknown extension block with `onUnknown: read-only` (D2P-SEM-007) are accepted with `editability: read-only`; the conforming geometry snapshot of the read-only pattern stays displayable. A stretch-conditioned negative-ease rule evaluated for a woven material (D2P-SEM-074, FIT-002) is accepted with a warning; the same rule evaluated for a knit that meets the condition is accepted without one. A gate that denies because its test evidence lacks a required suite (`d2p:evidence-missing`, QEV-012) is a consistent, accepted gate.

All case data is synthetic test data. Geometry values and measurements are chosen for the tests and are not a size table or a norm. The cases (except `golden-tshirt/`) are generated by `tools/generate-conformance-cases.mjs`; see `tools/README.md`.
