# Changelog

All notable changes to the D2P Open Standard are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the standard follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) as described in [GOVERNANCE.md](GOVERNANCE.md).

## [Unreleased]

### Added

- Repository foundation: license (Apache-2.0), governance, contribution and security policies.
- Directory layout for schemas, examples, fixtures, tolerance profiles, conformance levels, specifications, vocabularies and mappings.
- Schema tooling (`npm run validate`) based on Ajv with JSON Schema 2020-12 in strict mode, including example validation.
- Conformance runners for the `structural`, `referential` and `semantic` levels (no cases yet).
- Seed schema `schemas/core/units.schema.json` (length units `mm`/`m`, angle units `rad`/`deg`; `mm` and `rad` canonical) with valid and invalid examples.
- CI workflow running validation, conformance levels and tooling tests.
