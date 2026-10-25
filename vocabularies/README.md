# vocabularies/

Controlled vocabularies and registries referenced by the schemas. Each file is a JSON document whose `documentType` selects its schema. A vocabulary with the qualified name `d2p:<local>` and version `<v>` is stored as `<dir>/<local>-<v>.json`.

Entries are versioned and never silently redefined; a changed meaning requires a new identifier.

| Directory | Document type | Schema | Published |
|---|---|---|---|
| `measurement-definitions/` | `d2p:measurement-definition-registry` | `schemas/measurement/measurement-definition-registry.schema.json` | `d2p:measurement-definitions` `1.0.0` |
| `validation/rules/` | `d2p:validation-rule-definition` | `schemas/validation/rule-definition.schema.json` | 25 standard rules, all `1.0.0` |
| `validation/profiles/` | `d2p:validation-profile` | `schemas/validation/profile.schema.json` | `d2p:draft-edit`, `d2p:sample-cut`, `d2p:print-1to1`, all `1.0.0` |
| `mesh-profiles/` | `d2p:mesh-profile` | `schemas/3d/mesh-profile.schema.json` | `d2p:golden-tshirt-3d-preview` `1.0.0` (`frozen` 2026-10-25) |

## `d2p:measurement-definitions` 1.0.0

The standard measurement-definition registry gives each body or garment measurement a precise, shared meaning: kind, dimension, canonical unit (mm), path type, landmarks, posture and clothing or garment state. Values are comparable only when they share a `definitionId`. A body girth and a flat garment width are never equivalent, even when their names look alike.

| `definitionId` | Path | State |
|---|---|---|
| `d2p:body.arm-length` | length | minimal clothing |
| `d2p:body.back-length` | length | minimal clothing |
| `d2p:body.bust-girth` | girth | minimal clothing |
| `d2p:body.chest-girth` | girth | minimal clothing |
| `d2p:body.hip-girth` | girth | minimal clothing |
| `d2p:body.neck-girth` | girth | minimal clothing |
| `d2p:body.shoulder-width` | arc | minimal clothing |
| `d2p:body.upper-arm-girth` | girth | minimal clothing |
| `d2p:body.waist-girth` | girth | minimal clothing |
| `d2p:body.wrist-girth` | girth | minimal clothing |
| `d2p:garment.body-length` | length | flat, relaxed |
| `d2p:garment.chest-girth` | girth | flat, relaxed |
| `d2p:garment.chest-width-flat` | flat-width | flat, relaxed |
| `d2p:garment.sleeve-length` | length | flat, relaxed |

The definitions are written for this registry. They state no numeric tolerances and copy no text or tables from other standards. Informative mappings to ISO 8559-1 or ASTM D5219 are **not** included yet: the edition and licence of those standards must be checked before any mapping is published.

## Validation rules and profiles 1.0.0

The standard validation rules and profiles implement the rule table of the schema catalog (§3.5). Each diagnostic code is assigned to exactly one rule. A finding's severity is the severity its rule has in the applied profile. The profiles are the initial profile contents, not numeric norms.

- `targetDocumentTypes`: a rule listed for "all" document types names every `documentType` of the catalog's document-type registry (§3.0).
- `defaultSeverity`: the highest registry severity (catalog §2.4) among the rule's codes. It applies only when no profile sets a severity.
- `requiresEvaluator` is `false` for rules whose kernel-free part is checked by the conformance runners (evaluators may extend the coverage, as each rule's `description` says), and `true` for rules that only an evaluator can check. `deterministic` is `true` for every rule.
- Codes assigned to no rule: D2P-SEM-004, D2P-SEM-007 and D2P-EVL-007 (they govern editability and fallback display, not gates) and D2P-SEM-100 to D2P-SEM-110 (they check validation and evidence documents themselves and are covered by the conformance runners).

| Rule | Layer | Codes (`D2P-` omitted) | Default | Evaluator | draft-edit | sample-cut | print-1to1 |
|---|---|---|---|---|---|---|---|
| `d2p:constraints-consistent` | domain | SEM-040 | error | no | warning | error | error |
| `d2p:constraints-solved` | derived | EVL-001, EVL-002, EVL-003 | error | yes | — | error | error |
| `d2p:contour-closed` | domain | SEM-010 | error | no | warning | error | error |
| `d2p:contour-orientation` | derived | SEM-012 | error | no | — | error | error |
| `d2p:contour-simple` | derived | SEM-011, SEM-013 | error | no | — | error | error |
| `d2p:data-classification-consistent` | contextual | SEM-051 | error | no | error | error | error |
| `d2p:ease-material-compatible` | domain | SEM-073, SEM-074 | warning | no | — | warning | warning |
| `d2p:evaluation-succeeded` | derived | EVL-004, EVL-005, EVL-006, EVL-008, EVL-009 | error | yes | — | error | error |
| `d2p:expression-dimensions` | domain | SEM-002, SEM-003 | error | no | error | error | error |
| `d2p:extensions-supported` | domain | SEM-005, SEM-006 | error | no | error | error | error |
| `d2p:feature-graph-acyclic` | domain | SEM-001 | error | no | error | error | error |
| `d2p:grading-consistent` | domain | SEM-080 | error | no | warning | error | error |
| `d2p:measurement-equivalence` | domain | SEM-071, SEM-075 | error | no | — | error | error |
| `d2p:measurement-fallback` | derived | EVL-011 | warning | yes | — | warning | warning |
| `d2p:measurements-complete` | domain | REF-008, SEM-070, SEM-072 | error | no | — | error | error |
| `d2p:no-personal-data-in-export` | contextual | SEM-050 | critical | no | — | — | critical |
| `d2p:print-calibrated` | contextual | SEM-091, SEM-092, SEM-095 | critical | no | — | — | critical |
| `d2p:print-geometry-valid` | contextual | SEM-090, SEM-093, SEM-094, SEM-096 | error | no | — | — | error |
| `d2p:references-resolve` | domain | REF-001, REF-002, REF-003, REF-004, REF-005, REF-006, REF-007, REF-009, REF-010, REF-011, REF-012, REF-013, REF-014 | error | no | error | error | error |
| `d2p:schema-valid` | schema | STR-001, STR-002, STR-003, STR-004, STR-010, STR-011, STR-012 | error | no | error | error | error |
| `d2p:seam-interface-continuous` | domain | SEM-020, SEM-021, SEM-022, SEM-025 | error | no | warning | error | — |
| `d2p:seam-interface-single-connection` | domain | SEM-023 | error | no | warning | error | — |
| `d2p:seam-length-match` | derived | EVL-010 | warning | yes | — | warning | — |
| `d2p:snapshot-consistent` | derived | SEM-014, SEM-024 | error | no | — | error | error |
| `d2p:sewing-group-integrity` | domain | SEM-030, SEM-031, SEM-032, SEM-033, SEM-034 | error | no (SEM-034 is reported by importers and editors only) | warning | error | — |

Waiver policies: `d2p:draft-edit` and `d2p:sample-cut` allow waivers up to `error`; `d2p:print-1to1` allows waivers up to `warning`. A finding of severity `critical` is never waivable.
