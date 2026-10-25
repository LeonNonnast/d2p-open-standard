# specifications/

This directory holds the normative prose of the D2P Open Standard. Where a schema and a specification disagree, the specification wins, and the schema is fixed.

| Document | Status | Content |
|---|---|---|
| [schema-catalog.md](schema-catalog.md) | Normative draft of release `1.0.0` (not stable before the `v1.0.0` tag), as of the pre-release draft `0.3.0` | Conventions for all schemas: IDs, references, units, extensions, digest canonicalization `d2p-digest-v1` with array-order rules, authoring rules, the split between schema-enforced and semantic conditions, and versioning. It also defines the conformance levels, structural classifiers, the diagnostic code registry, the referential resolution scope, every schema file with its entities, required members, enums and canonical `$defs` names, the standard validation rules, profiles and gate decision procedure, the `d2p:print-v1` print conformance profile, the 3D module with garments, scenes, bodies, drapes and fit maps (§3.9, §3.9.1), and the Golden T-Shirt v1, 3D v1 and drape v1 fixtures with their normative identifiers and negative cases |
| [gap-analysis.md](gap-analysis.md) | Informative companion of release `1.0.0` (test OSS-002; required by `npm run validate`) | For each module: the existing standards and formats it reuses or deliberately does not replace, and the textile semantic gap it fills (see `schema-catalog.md` §3.0) |

## Conventions for this directory

- Specifications are written in English. They use RFC 2119 key words and state every rule in full, so that third parties can implement the standard without any other material.
- Normative changes follow the issue → RFC → tests process in [GOVERNANCE.md](../GOVERNANCE.md). RFCs live in `specifications/rfcs/`. A change is accepted only together with schema changes, valid and invalid examples and, where relevant, conformance cases.
- Changes are versioned with the standard (SemVer, see `schema-catalog.md` §1.11) and recorded in [CHANGELOG.md](../CHANGELOG.md).
