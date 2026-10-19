# Governance

## Scope

The D2P Open Standard covers the **portable textile semantics** of digital garment patterns and the conformance kit that checks them. It intentionally excludes business workflows, product user experience, hosting and any proprietary implementation details of the Design2Production suite. New areas are added only when there is demonstrated need and no suitable existing standard.

## Roles

| Role | Responsibility | Current |
|---|---|---|
| **Maintainer** | Reviews and merges changes, cuts releases, triages issues and security reports, decides on RFCs | [@LeonNonnast](https://github.com/LeonNonnast) |
| **Contributor** | Anyone opening issues, RFCs or pull requests | — |

Additional maintainers may be appointed by the existing maintainers once they have a track record of substantial, high-quality contributions. This document will move to a broader model (e.g. a steering group) when there are several independent implementers.

## Decision process

Decisions are made in public:

1. **Issue** — describe the problem or gap, ideally with an example.
2. **RFC** — for any normative change (new schema, new field, changed semantics), a short RFC is opened as a pull request under `specifications/rfcs/`. It states motivation, the proposed change, compatibility impact and alternatives, including existing standards that were considered.
3. **Tests** — a normative change is only accepted together with schema changes, valid and invalid examples and, where relevant, conformance cases.

The maintainers aim for consensus. If none is reached, the maintainers decide and record the rationale in the pull request.

## Versioning and compatibility

The standard is versioned with [SemVer](https://semver.org/):

- **Major** — any breaking change: removing or renaming fields, tightening validation of previously valid documents, changing semantics.
- **Minor** — backwards-compatible additions: new optional fields, new schemas, new modules, new conformance cases for new features.
- **Patch** — clarifications, documentation, fixes to examples or tooling that do not change which documents are valid.

Before `1.0.0` the standard is considered unstable and minor releases may contain breaking changes; they are always called out in the changelog.

Releases are Git tags (`vMAJOR.MINOR.PATCH`). Every fixture pins the full versions it depends on. Implementations should pin a released tag, never a branch.

## Deprecation

Deprecated elements are marked in the schema (`"deprecated": true`) and the changelog, kept for at least one minor release, and removed only in the next major release.

## Security

See [SECURITY.md](SECURITY.md).
