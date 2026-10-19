# fixtures/

Golden fixtures: complete, synthetic end-to-end scenarios that implementations are tested against.

```text
fixtures/golden-tshirt/v1/
  inputs/      # measurements, fit/material configurations, grading rules, feature graph, topology
  expected/    # expected evaluation results (control points, seam lengths, print output) per size/configuration
  negative/    # invalid inputs, each with its expected diagnostic code
  manifest.json  # (next phase) file list with digests and pinned schema/tolerance versions
```

`manifest.json` is intentionally **not** part of this scaffold. It arrives together with the first fixture content and its own schema (`schemas/...`), so that the manifest is validated by `npm run validate` from day one instead of shipping as unchecked JSON.

The *Golden T-Shirt* (two sizes, two material/fit configurations, front/back piece, two sleeve instances) is the reference object across geometry, export and test suites. Fixture content follows in the next phase; expected results are compared using a pinned profile from `tolerance-profiles/`, and tolerances are never adjusted after the fact to match an implementation.
