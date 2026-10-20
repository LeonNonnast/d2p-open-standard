# tools/oracle/

Deterministic reference oracle for the Golden T-Shirt v1 fixture (`fixtures/golden-tshirt/v1`). Plain Node.js (>= 22), no dependencies except `schema-check.mjs`, which reuses the repository's strict Ajv configuration.

| File | Purpose |
|---|---|
| `golden-tshirt.mjs` | CLI. Without flags it regenerates the fixture; `--check` regenerates into a temporary directory and byte-compares with the repository (exit 1 on drift, missing or unexpected files); `--summary` prints seam lengths, garment measurements and the A4 tile grid |
| `schema-check.mjs` | Validates every fixture file against the schema of its `documentType`; checks that negative subjects are invalid or valid as their `case.json` expects |
| `lib/c14n.mjs` | d2p-c14n-v1 canonical form and d2p-digest-v1 digests (catalog §1.8); refuses to run if the catalog test vectors fail |
| `lib/geometry.mjs` | Lines and cubic Béziers: evaluation, adaptive Gauss-Kronrod arc length (1e-12 mm), arc-length inversion, exact extrema, Green's-theorem areas, instance transforms |
| `lib/evaluator.mjs` | Interpreter for the closed expression language (with dimension checking) and the feature types the fixture uses |
| `lib/construction.mjs` | The T-shirt construction: writes the pattern document, applies the change case, and computes all points a second time in closed form for the cross-check |
| `lib/snapshot.mjs` | Snapshot geometry per catalog §3.4 (contour paths, notches, grainlines, bounding boxes, areas, interface and seam lengths) and analytic garment measurements |
| `lib/documents.mjs` | Builds every input, expected and manifest document, and runs the oracle assertions |
| `lib/negative.mjs` | Negative fixtures of catalog §4.3 with their `case.json` |
| `lib/ids.mjs`, `lib/expr.mjs` | Normative identifiers and expression-node builders |
| `golden-tshirt-3d.mjs`, `lib/garment3d.mjs` | Golden T-Shirt 3D v1 generator (catalog §4.5): garments, scene inputs and expected scene structures from the 2D fixture, the 3D negative fixtures and the cases in `conformance/<level>/golden-tshirt-3d/` (including boundary-sampled panel meshes and a glTF view for the scene-snapshot case). It uses the kit's `lib/c14n.mjs` and asserts stable IDs, sides, the mm to m conversion and the rebind to pattern r2 on every run (`npm run oracle:3d`; `--check` is part of `npm run oracle:check`) |

```bash
npm run oracle         # node tools/oracle/golden-tshirt.mjs
npm run oracle:check   # node tools/oracle/golden-tshirt.mjs --check && node tools/oracle/schema-check.mjs
```

The oracle reads the external files the fixture pins (measurement-definition registry, tolerance profile, the `d2p:sample-cut` and `d2p:print-1to1` profiles and their rule files) and digests them into the expected documents and the manifest, so a change to one of them shows up as drift.

Assertions run on every generation (any failure aborts without writing):

- every point feature from the interpreter equals the closed-form construction within 1e-9 mm;
- shoulder, side and underarm seams have equal side lengths; each armhole seam matches its declared cap ease within the pinned relative seam-length tolerance;
- every outer contour is counter-clockwise and simple (sampled check);
- element IDs are identical in all snapshots, and pattern r2 keeps every element ID of r1, with new content and geometry digests;
- geometry is identical for both configurations of a size, differs between sizes, and size B is not a uniform scaling of size A.
