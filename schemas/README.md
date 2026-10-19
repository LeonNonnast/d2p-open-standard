# schemas/

Canonical JSON Schemas (draft 2020-12) of the D2P Open Standard, one directory per module.

| Module | Scope |
|---|---|
| `core` | Identity, artifacts, revisions, references, units, extension mechanism |
| `pattern` | Pattern pieces, feature graph, typed expressions, grading, seams, sewing groups |
| `measurement` | Body measurement profiles, size systems, garment measurement specs, fit |
| `eval` | Pattern evaluation results, geometry snapshots, digests, constraint status |
| `validation` | Validation rules, profiles, findings, reports, gates, waivers |
| `command` | Command envelopes |
| `event` | Event envelopes |
| `error` | Error structure |
| `print` | `ExportScene2D`, `PrintJobSpec`, print conformance profile |
| `benchmark` | Test run reports, benchmark runs, quality evidence |
| `3d`, `assembly`, `production`, `package`, `import` | Later modules, added by minor releases |

Rules (enforced by `npm run validate`):

- File name `<name>.schema.json`; `$id` = `https://d2p.nonnast.dev/schemas/<module>/<name>.schema.json`.
- `$schema` = `https://json-schema.org/draft/2020-12/schema`.
- Compiles in Ajv strict mode; every `$ref` resolves.
- At least one valid example in `examples/<module>/<name>/valid/` (and a negative one in `invalid/`).

Only `core/units.schema.json` exists so far (seed schema).
