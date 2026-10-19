# Contributing

Thank you for helping improve the D2P Open Standard! Contributions of all kinds are welcome: bug reports, clarifications, examples, conformance cases, schemas and tooling.

## Before you start

- Read the [README](README.md) for conventions and [GOVERNANCE.md](GOVERNANCE.md) for how decisions are made.
- For anything normative (new schema, new field, changed semantics) open an issue first and expect an RFC. Small fixes can go straight to a pull request.
- Do not contribute private data: no real customer measurements, personal data, credentials or proprietary pattern data. Fixtures must be synthetic or explicitly cleared for publication.

## Development setup

Requires Node.js 22 or newer (see `.nvmrc`).

```bash
npm ci
npm run check   # validate + all conformance levels + tooling tests
```

## Adding or changing a schema

1. Place the schema at `schemas/<module>/<name>.schema.json`.
2. Declare `"$schema": "https://json-schema.org/draft/2020-12/schema"` and `"$id": "https://d2p.nonnast.dev/schemas/<module>/<name>.schema.json"`.
3. Add at least one valid example in `examples/<module>/<name>/valid/` and at least one negative example in `examples/<module>/<name>/invalid/`. Name negative examples after the rule they break (e.g. `missing-unit.json`).
4. Use canonical units (`mm`, `rad`) for domain data; reference `core/units.schema.json` instead of redefining units.
5. Run `npm run validate` and add a changelog entry under **Unreleased**.

## Pull requests

- Keep pull requests focused; one topic per pull request.
- CI must be green.
- Describe the compatibility impact (major/minor/patch) in the pull request.

## Developer Certificate of Origin

All commits must be signed off to certify the [Developer Certificate of Origin 1.1](https://developercertificate.org/):

```bash
git commit -s -m "Add measurement unit examples"
```

By contributing you agree that your contribution is licensed under the [Apache License 2.0](LICENSE).

## Code of conduct

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).
