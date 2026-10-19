# D2P Open Standard

An open, vendor-neutral data standard for **digital garment patterns** — pattern pieces, measurements, grading, seams, validation and print-ready 1:1 output — together with a **conformance kit** anyone can run.

> **Status: pre-release (v0, foundation phase).** The repository structure, tooling and a single seed schema exist. Normative schemas, the Golden T-Shirt fixture and conformance cases follow in the next phase. Nothing here is stable yet; see [CHANGELOG.md](CHANGELOG.md).

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
| [`fixtures/`](fixtures/) | Golden fixtures (e.g. the *Golden T-Shirt*) with inputs, expected results and negative cases |
| [`tolerance-profiles/`](tolerance-profiles/) | Versioned numeric tolerances used to compare results |
| [`conformance/`](conformance/) | Conformance cases in three separately runnable levels: structural, referential, semantic |
| [`specifications/`](specifications/) | Normative prose: semantics, versioning and compatibility rules |
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
npm run validate                    # compile all schemas, check all examples
npm run conformance:structural      # each level runs on its own ...
npm run conformance:referential
npm run conformance:semantic
npm run conformance                 # ... or all three in sequence
npm test                            # unit tests of the tooling
npm run check                       # everything above
```

`npm run validate` enforces:

1. every `*.schema.json` is valid JSON, declares the 2020-12 dialect and a unique absolute `$id`, and is valid against the 2020-12 meta-schema;
2. every schema compiles in Ajv **strict mode** (unknown keywords are errors) with all `$ref`s resolvable;
3. every file in `examples/<module>/<schema>/valid/` validates and every file in `.../invalid/` is rejected;
4. every schema in `schemas/` has at least one valid example (a missing negative example produces a warning).

Pass `--json` to any tool for machine-readable output, e.g. `node tools/validate.mjs --json`.

## Contributing, governance, security

- [CONTRIBUTING.md](CONTRIBUTING.md) — how to propose changes (issue → RFC → tests)
- [GOVERNANCE.md](GOVERNANCE.md) — who decides and how releases work
- [SECURITY.md](SECURITY.md) — how to report vulnerabilities
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## License

Licensed under the [Apache License, Version 2.0](LICENSE). See [NOTICE](NOTICE).
