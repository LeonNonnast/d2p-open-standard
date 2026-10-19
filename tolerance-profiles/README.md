# tolerance-profiles/

Versioned tolerance profiles (`documentType` `d2p:tolerance-profile`, schema `schemas/benchmark/tolerance-profile.schema.json`). A profile defines the numeric limits used to compare implementation results with golden fixtures: contour deviation, seam-length deviation, control-square deviation in print output, and so on. Agreement across implementations is judged with these profiles, never with digests.

A profile with ID `d2p:<local>` and version `<v>` is stored as `<local>-<v>.json`.

Rules:

- A profile is pinned (by version, path and digest) before any implementation is compared against it, and it is never adjusted afterwards to fit an implementation.
- `status: "provisional"` means the values are proposals, not adopted norms. A provisional profile MUST be set to `frozen` by maintainer decision before any implementation or benchmark run is compared against it. If any value changes on the way, the frozen profile is a new version.
- A `frozen` profile is immutable. A changed limit is a new version.

| File | Profile | Status |
|---|---|---|
| `golden-tshirt-2d-1.0.0.json` | `d2p:golden-tshirt-2d` `1.0.0`, used by the Golden T-Shirt v1 fixture | **provisional**: proposed values only (contour deviation 0.10 mm, relative seam-length deviation 0.005, control square 0.1 mm). `d2p:seam-length-deviation-absolute` and `d2p:angle-deviation` have no proposed value and are omitted. Not yet frozen; no benchmark run may use it until it is. |
