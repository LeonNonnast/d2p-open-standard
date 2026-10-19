# examples/

Normative examples for each schema, organised by schema path:

```text
examples/<module>/<schema-name>/valid/<case>.json     # must validate
examples/<module>/<schema-name>/invalid/<case>.json   # must be rejected
```

`examples/core/units/valid/millimetre.json` belongs to `schemas/core/units.schema.json`. Negative examples are named after the rule they break. `npm run validate` checks all of them.
