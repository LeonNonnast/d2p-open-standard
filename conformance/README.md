# conformance/

Conformance cases in three levels that are **independently runnable**:

| Level | Checks | Command |
|---|---|---|
| `structural/` | Documents conform to the JSON Schemas | `npm run conformance:structural` |
| `referential/` | IDs and revision references resolve | `npm run conformance:referential` |
| `semantic/` | Domain rules (e.g. closed contours, matching seam lengths) | `npm run conformance:semantic` |

A case is a file named `*.case.json` anywhere below its level directory. Each run reports how many cases were discovered, passed, failed, inconclusive and skipped (`--json` for machine-readable output).

There are no cases and no level runners yet. A level with zero cases passes; a case for a level without a runner **fails**, so that an unimplemented check can never appear green. Every level is required to contain negative cases once runners exist.
