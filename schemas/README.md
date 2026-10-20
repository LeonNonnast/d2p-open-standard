# schemas/

Canonical JSON Schemas (draft 2020-12) of the D2P Open Standard, one directory per module.

| Module | Scope |
|---|---|
| `core` | Identity, artifacts, revisions, references, units, extension mechanism, mapping profiles |
| `pattern` | Pattern pieces, feature graph, typed expressions, grading, seams, sewing groups |
| `measurement` | Body measurement profiles, size systems, garment measurement specs, fit |
| `eval` | Evaluation requests, pattern evaluation results, geometry snapshots, constraint status |
| `validation` | Validation rules, profiles, findings, reports, gates, waivers |
| `command` | Command envelopes, command receipts, capability negotiation |
| `event` | Event envelopes |
| `error` | Error structure |
| `print` | Export scenes (`export-scene-2d`) and print job specifications (`print-job-spec`) |
| `benchmark` | Test run reports, benchmark runs, quality evidence bundles, tolerance profiles, fixture manifests, conformance cases |
| `3d` | Garments (pinned pattern evaluations, panel instances, sewing bindings, materials, arrangements), scene inputs and snapshots (right-handed, Y up, metres), panel mesh results, mesh profiles, simulation reports, 3D edit inspections, pattern proposals, scene expectations (draft `0.2.0`, catalog §3.9) |
| `assembly`, `production`, `package`, `import` | No schemas in release 1.0; added by later minor releases |

Rules (enforced by `npm run validate`):

- File name `<name>.schema.json`; `$id` = `https://d2p.nonnast.dev/schemas/<module>/<name>.schema.json`.
- `$schema` = `https://json-schema.org/draft/2020-12/schema`.
- Compiles in Ajv strict mode; every `$ref` resolves.
- At least one valid example in `examples/<module>/<name>/valid/` (and a negative one in `invalid/`).
- Every data file the catalog names (vocabularies, tolerance profiles, fixture files, conformance cases) validates against the schema of its `documentType` (catalog §3.0).

The shapes, member tables, canonical `$defs` names and module dependency order of every schema are defined in [`specifications/schema-catalog.md`](../specifications/schema-catalog.md). A schema that contradicts the catalog is a bug in the schema. Cross-file references use the absolute `$id` plus a JSON pointer, and a schema references only its own module and modules in earlier groups of the module order (catalog §1.10.3).
