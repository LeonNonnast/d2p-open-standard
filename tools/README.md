# tools/

Self-contained Node.js tooling for the standard (no network access, no dependency on any other repository).

| File | Purpose |
|---|---|
| `validate.mjs` | CLI for `npm run validate` |
| `conformance.mjs` | CLI for `npm run conformance:<level>` |
| `lib/validate.mjs` | Schema and example validation rules |
| `lib/conformance.mjs` | Case discovery and level runners |
| `lib/ajv.mjs` | The single strict Ajv 2020-12 configuration |
| `test/` | Unit tests (`npm test`, Node's built-in test runner) |

Both CLIs accept `--json` and an optional repository root argument.
