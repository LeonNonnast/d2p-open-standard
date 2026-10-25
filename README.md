# D2P Open Standard

An open, vendor-neutral data standard for **digital garment patterns** — pattern pieces, measurements, grading, seams, validation and print-ready 1:1 output — together with a **conformance kit** anyone can run.

> **Status: pre-release `v0.2.1` (draft of standard 1.0).** The schema catalog, 59 JSON Schemas (`0.2.0` added the module `3d`: garment, scene input and snapshot, panel mesh result, mesh profile, simulation report, 3D edit inspection, pattern proposal, scene expectation), the measurement-definition registry, the standard validation rules and profiles, the Golden T-Shirt v1 and Golden T-Shirt 3D v1 fixtures and a conformance kit with three runnable levels exist. Documents already declare `schemaVersion: "1.0.0"`, the release they are drafted for, but nothing is stable before the `v1.0.0` tag. That tag waits for the domain review of the fixture by a pattern maker or seamstress (test QEV-016, pending), and the maintainer confirmation of the digest quantization step. All fixture and case values are synthetic test data, not size tables or norms. See [CHANGELOG.md](CHANGELOG.md).

## Why this exists

Established formats such as SVG, PDF and glTF transport geometry and graphics, but not the textile semantics behind a sewing pattern: which edges are seam lines, which seams are sewn together, how a pattern grades across sizes, what a measurement actually means. The D2P Open Standard specifies **only that missing semantics** and references, profiles or extends existing standards instead of replacing them ("reuse before standardize", "smallest useful standard").

The standard is published so that it can be **implemented by third parties without any account, API or proprietary application**. It is developed alongside the commercial Design2Production (D2P) suite but is deliberately independent of it:

- this repository has **no dependency** on any proprietary code;
- the conformance kit runs locally with nothing but Node.js;
- business workflows, product logic and private data are explicitly **out of scope**.

## What is (and will be) in here

| Directory | Content |
|---|---|
| [`schemas/`](schemas/) | Canonical JSON Schemas (draft 2020-12), one directory per module |
| [`examples/`](examples/) | Normative valid and invalid examples per schema |
| [`fixtures/`](fixtures/) | Golden fixtures: the synthetic *Golden T-Shirt* v1 and *Golden T-Shirt 3D* v1 with inputs, expected results, negative cases and digest manifests |
| [`tolerance-profiles/`](tolerance-profiles/) | Versioned numeric tolerances used to compare results |
| [`conformance/`](conformance/) | Conformance cases in three separately runnable levels: structural, referential, semantic |
| [`specifications/`](specifications/) | Normative prose: the schema catalog (conventions, diagnostics, conformance levels, module catalog, fixture) |
| [`vocabularies/`](vocabularies/) | Controlled vocabularies and registries (e.g. measurement definitions) |
| [`mappings/`](mappings/) | Versioned mappings to external ontologies and industry conventions |
| [`tools/`](tools/) | The schema and conformance tooling itself |

### Conventions

- **JSON Schema 2020-12** only. Every schema declares `$schema` and an `$id` derived from its path: `schemas/<module>/<name>.schema.json` → `https://d2p.nonnast.dev/schemas/<module>/<name>.schema.json`.
- **Units:** canonical domain units are **millimetres** and **radians**. Other units (`m`, `deg`) are allowed only where a schema explicitly permits them at an import/export boundary. See [`schemas/core/units.schema.json`](schemas/core/units.schema.json).
- **Extensions** are namespaced and must declare provenance and version.
- **Versioning** follows SemVer: breaking changes only in a major release; every fixture pins full versions.

## Using the tooling

Requires Node.js 22 or newer.

```bash
npm ci                              # install the exact pinned toolchain
npm run validate                    # compile all schemas, check all examples and data files
npm run conformance:structural      # each level runs on its own ...
npm run conformance:referential
npm run conformance:semantic
npm run conformance                 # ... or all three in sequence
npm run fixture:verify              # verify both Golden T-Shirt manifests before comparing against them
npm run oracle:check                # regenerate both fixtures in a temp dir, byte-compare, schema-check
npm test                            # unit tests of the tooling, fixture wiring, OSS-001, QEV-001
npm run check                       # everything above
```

`npm run validate` enforces:

1. every `*.schema.json` is valid JSON, declares the 2020-12 dialect and a unique absolute `$id`, and is valid against the 2020-12 meta-schema;
2. every schema compiles in Ajv **strict mode** (unknown keywords are errors) with all `$ref`s resolvable;
3. every file in `examples/<module>/<schema>/valid/` validates and every file in `.../invalid/` is rejected;
4. every schema in `schemas/` has at least one valid example (a missing negative example produces a warning);
5. every vocabulary, tolerance-profile, fixture (`manifest.json`, `inputs/`, `expected/`) and conformance case file validates against the schema selected by its `documentType`, and vocabulary files are named after their ID and version;
6. the standard-gap analysis `specifications/gap-analysis.md` exists (test OSS-002).

The conformance kit runs each case at its level after all lower levels have passed on the whole bundle (structural → referential → semantic) and compares the outcome and the diagnostic codes with the case's expectation (`specifications/schema-catalog.md` §2). Every negative case, including each Golden T-Shirt negative fixture, must report exactly its expected diagnostic codes. See [`conformance/README.md`](conformance/README.md) and [`tools/README.md`](tools/README.md).

### Using the Golden T-Shirt to test an implementation

1. Pin a released tag of this repository.
2. Verify the fixture first: `npm run fixture:verify` (or `openFixtureForComparison` in `tools/lib/fixture.mjs`). If any digest, listed file or reference does not match, the fixture is **refused** and no comparison may start (test QEV-001).
3. Evaluate the inputs in `fixtures/golden-tshirt/v1/inputs/` with your implementation and compare with `expected/` using the pinned tolerance profile (`frozen` since `0.2.1`).
4. Run your implementation's validator on the negative fixtures; each one names the diagnostic code it must produce.

The Golden T-Shirt 3D v1 (`fixtures/golden-tshirt-3d/v1/`, catalog §4.5) is used the same way: verify it (`node tools/verify-fixture.mjs fixtures/golden-tshirt-3d/v1/manifest.json`), build a scene from each scene input and compare the scene's panel and seam bindings, control measures and anchors with `expected/scenes/` (exact, per catalog §3.4), and the meshes with the pinned 3D tolerance profile (`frozen` since `0.2.1`).

Everything needed is in this repository: the schemas, fixtures and kit are read with a generic JSON Schema 2020-12 validator and Node.js only, without any D2P account, service or proprietary code (test OSS-001).

Pass `--json` to any tool for machine-readable output, e.g. `node tools/validate.mjs --json`.

## Contributing, governance, security

- [CONTRIBUTING.md](CONTRIBUTING.md) — how to propose changes (issue → RFC → tests)
- [GOVERNANCE.md](GOVERNANCE.md) — who decides and how releases work
- [SECURITY.md](SECURITY.md) — how to report vulnerabilities
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## License

Licensed under the [Apache License, Version 2.0](LICENSE). See [NOTICE](NOTICE).
