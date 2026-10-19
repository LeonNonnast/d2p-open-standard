# D2P Standard-Gap Analysis — standard 1.0

**Status:** informative companion of the [schema catalog](schema-catalog.md) for release `1.0.0` (test OSS-002). Where this document and the catalog disagree, the catalog wins.
**Purpose:** to show, module by module, which existing standards and formats the D2P Open Standard reuses or deliberately leaves untouched, and which textile semantic gap each module fills. The standard is meant to be the smallest useful standard: it only specifies transportable textile semantics that no suitable existing standard covers (design decision ADR-022.1, principles "reuse before standardize" and "smallest useful standard").

The analysis is a snapshot made while drafting 1.0. It does not claim to be a complete market survey. Editions, licences and the exact scope of the external documents named below MUST be checked again before any mapping to them is published (catalog §5).

## 1. Method

For each module of catalog §3 the analysis answers three questions:

1. **Reused:** which existing standards does the module build on directly (it references them, profiles them or follows their rules)?
2. **Not replaced:** which existing standards or formats cover neighbouring needs and stay the right tool for those needs? D2P neither re-specifies nor competes with them; at most it maps to them at an import/export boundary.
3. **Gap filled:** what textile or pattern-making meaning can none of the above carry, and is therefore specified by D2P?

The rule applied throughout: if an existing open standard can carry a meaning without loss, D2P uses or references it. D2P specifies a structure only where the meaning would otherwise be lost, approximated or locked into a proprietary file.

## 2. Cross-cutting standards reused by every module

| Standard | Used for | Catalog |
|---|---|---|
| JSON (RFC 8259), UTF-8 | Document encoding | §1.1, §1.8 |
| JSON Schema draft 2020-12 | Every schema; strict validation profile | §1.1, §1.10 |
| JSON Canonicalization Scheme (RFC 8785) | Serialization step of the canonical form `d2p-c14n-v1` | §1.8 |
| SHA-256 (FIPS 180-4) | All digests (`sha256:` prefix) | §1.8 |
| RFC 3339 date-time (UTC profile) | Timestamps | §1.4 |
| JSON Pointer (RFC 6901) | `instancePath` in diagnostics and findings | §2.3 |
| Semantic Versioning 2.0.0 | `schemaVersion`, vocabulary and extension versions | §1.11 |
| RFC 2119 / RFC 8174 | Requirement key words | front matter |
| UUIDv7 (RFC 9562) or ULID | Recommended form of the opaque part of global IDs | §1.4 |
| SI units (millimetre, radian) | Canonical length and angle units | §1.6 |

None of these standards is changed. The D2P-specific parts are the conventions on top of them: the ID and reference model, the digest kinds and array orders, and the extension model.

## 3. Modules with schemas in 1.0

### 3.1 core

- **Reused:** the cross-cutting standards of §2.
- **Not replaced:** general provenance and versioning models (for example W3C PROV) and version-control systems. D2P records only the minimum needed to pin a revision: artifacts, immutable revisions, lineage of element identities and pinned relationships. It does not define a general provenance graph.
- **Gap filled:** a portable way to say "this exact revision of this pattern element", independent of storage. That means stable element IDs that survive regrading and re-evaluation, references that are always pinned to a revision (never "latest"), lineage for split and merge of elements, and namespaced extensions with an explicit fallback (`ignore`, `read-only`, `reject`). Generic formats have object IDs, but those are not stable across revisions or re-exports (SVG and PDF object IDs, mesh indices); the catalog forbids deriving element IDs from them (§1.4).

### 3.2 pattern

- **Reused:** SI units and the cross-cutting standards. The geometry primitives (points, lines, circular arcs, cubic Bézier curves) are the ones common to SVG, PDF and CAD exchange formats, so that a snapshot can be converted to them without approximation.
- **Not replaced:**
  - the AAMA/ASTM DXF pattern exchange format and vendor pattern formats. They transport finished outlines with grade rules and annotations, and stay the exchange path to and from cutting rooms and existing CAD systems. An importer maps them to D2P (planned `import` module); D2P does not redefine DXF;
  - general CAD exchange formats (DXF, STEP, IGES). They carry curves and solids, but not pattern semantics;
  - SVG and PDF as drawing formats (see `print`).
- **Gap filled:**
  - **parametric construction:** a closed, script-free expression language and a feature graph whose results are reproducible, dimension-checked and portable between independent evaluators. The parametric model is the source of truth, and geometry is derived (catalog §3.2.3, §3.2.4);
  - **sewing topology:** pieces with contours, oriented edges, notches, grainlines and folds; seam interfaces as ordered intervals on edges; binary seam connections with declared ease; sewing groups for multi-part constructions; cut instructions with mirrored cut instances (catalog §3.2.2, §3.2.5, §3.2.6). Outline formats do not express which edge interval is sewn to which, with how much ease, on which cut instance;
  - **measurement-driven grading:** grading rules that derive sizes from measurements or explicit per-size values. Uniform scaling is not expressible (catalog §3.2.6);
  - **portability of non-standard features:** feature capabilities with declarative, normative or extension lowering, plus a read-only geometry snapshot as fallback (catalog §1.7).

### 3.3 measurement

- **Reused (informatively):** body measurement definitions are described with landmarks, path type, posture and state so that they can be mapped to ISO 8559-1 (anthropometric definitions for body measurement in clothing), ASTM D5219 (terminology of body dimensions for apparel sizing) and, where relevant, ISO 7250-1 (basic human body measurements for technological design). Mappings are informative only: the registry copies no normative text or tables from these documents (catalog §3.3, §5).
- **Not replaced:**
  - the measurement definitions and size designation systems themselves (ISO 8559-1, ISO 8559-2, ASTM D5219, national size tables). A D2P size system records the values a producer uses and who issued them; it does not standardize sizes;
  - methods for body scanning (for example ISO 20685-1) and the scanners' data formats. D2P stores only the resulting values with method, source and uncertainty.
- **Gap filled:**
  - a machine-readable, versioned registry that keeps **body** and **garment** measurements apart and never treats them as implicitly equivalent (D2P-SEM-071);
  - measurement values that carry method, source, uncertainty and a data classification for personal data, so that individual measurements never leak into exports (D2P-SEM-050, D2P-SEM-051);
  - **fit intent as data:** ease rules (wearing, design and functional ease) with priorities, scope and material conditions, prioritized fit targets, and fit evaluation reports that state their evidence kind and never claim a guaranteed fit. No existing standard transports ease rules or fit intent.

### 3.4 eval

- **Reused:** the cross-cutting standards; the geometry primitives of `pattern`.
- **Not replaced:** solver, kernel and CAD file formats, and the internal representations of geometry libraries. The standard deliberately chooses no geometry or constraint kernel.
- **Gap filled:** a kernel-neutral contract for evaluation results. An evaluation request pins every input revision. An evaluation result records the evaluator identity and precision, the constraint status and the input digests. A geometry snapshot gives normative generation rules (contour start, segment direction, notch angles, exact bounding boxes and areas), so that independent evaluators can be compared within a tolerance profile instead of by bitwise equality.

### 3.5 validation

- **Reused:** RFC 6901 (JSON Pointer) for locations; the diagnostic code registry of catalog §2.4.
- **Not replaced:** general static-analysis result formats such as OASIS SARIF. SARIF is designed around source-code locations and tool runs. It has no concept of pinned artifact revisions, validation purposes, waivers with expiry and approval, or gate decisions, so D2P does not profile it. A tool MAY export D2P findings to SARIF for display; that mapping is not part of 1.0.
- **Gap filled:** purpose-specific validation profiles (draft editing, 1:1 print, sample cutting) over a shared rule vocabulary; reports pinned to the revisions they checked; waivers that can never cover critical findings; and a deterministic gate decision procedure that combines reports, waivers and test evidence (catalog §3.5).

### 3.6 command, event, error

- **Reused:** the cross-cutting standards. Error codes come with an informative HTTP status mapping (catalog §3.6).
- **Not replaced:**
  - transport and API description standards (HTTP, OpenAPI, the Model Context Protocol, WebSocket). The envelopes are transport-neutral;
  - general event and error envelopes such as CNCF CloudEvents and HTTP Problem Details (RFC 9457). A binding MAY wrap the D2P event or error object in them; the D2P members stay unchanged inside.
- **Gap filled:** the pattern-specific parts of a write contract: commands always name the expected revision (optimistic concurrency per aggregate, with explicit stale and conflict errors), carry an idempotency key and actor context without secrets, and produce receipts with pinned revisions; the revision-committed event pins the new revision and its parents; capability negotiation declares supported feature types, evaluator profiles and conformance levels; an unknown feature is answered with an explicit unsupported-capability error and a snapshot fallback, never with a silent change.

### 3.7 print

- **Reused:** ISO 216 paper sizes (A4, A3) for named media (D2P-SEM-092); millimetre layout units; sRGB hex colours for size styles. The output of a renderer is an ordinary PDF or SVG file.
- **Not replaced:**
  - **PDF** (ISO 32000) and **SVG** (W3C) as page and drawing formats. D2P does not define a drawing format and does not extend PDF or SVG; renderers write standard files;
  - plotter languages (for example HPGL) and the DXF formats used by cutting systems;
  - colour management and printer calibration standards. Physical print accuracy depends on the printer and is out of scope.
- **Gap filled:** the pattern-specific meaning that PDF and SVG files lose: a materialized 2D export scene that keeps every domain element ID (piece, cut instance, contour, notch, grainline), layer roles (cut line, seam line, grainline, notch, fold), the seam-allowance policy, deterministic drawing order and size styles for multi-size scenes; and a print job specification that fixes scale 1, tiling with overlap, registration marks, sheet labels, a mandatory 100 mm control square and a print notice. The conformance profile `d2p:print-v1` makes "prints at true scale" testable (catalog §3.7).

### 3.8 benchmark

- **Reused:** the cross-cutting standards.
- **Not replaced:** general test report formats (JUnit XML, TAP) and CI systems. They report pass or fail per test case, but carry no pinned fixture digest, no tolerance profile and no geometry backend identity.
- **Gap filled:** reproducible comparison of independent implementations: fixture manifests with a digest for every file (a test run refuses a fixture whose digest differs, QEV-001), versioned tolerance profiles with a provisional/frozen status, test-run and benchmark records that pin fixture, tolerance profile, backend and environment, quality evidence bundles whose state is never `passed` when evidence is incomplete, and a machine-readable conformance case format for the three conformance levels.

## 4. Modules without schemas in 1.0

| Module | Existing standards that stay the right tool | Expected gap (not specified in 1.0) |
|---|---|---|
| `3d` | glTF 2.0 (Khronos, also ISO/IEC 12113) for meshes, materials and scenes | References from a 3D garment to pinned pattern revisions and seams; 3D edits expressed as proposals back to the pattern instead of silent geometry changes |
| `assembly` | — (no assembly-sequence standard for garments is known to the authors) | Sewing order as a dependency graph over seam connections and sewing groups |
| `production` | Cutting-room and marker formats (for example the AAMA/ASTM DXF pattern exchange format), product data exchange standards | Production, sample and fitting records tied to pinned pattern revisions |
| `package` | General archive and packaging formats (ZIP and similar) | A signed, digest-pinned bundle of artifacts and derived documents |
| `import` | The source formats themselves (DXF variants, vendor formats, SVG) | Import provenance and the mapping of external outlines to D2P topology, without inventing semantics |

These modules get no schemas in 1.0 (catalog §3.0). They are listed so that their later scope can be checked against the same rule: reuse first, specify only the gap.

## 5. Licence and access notes

- JSON, JSON Schema, the IETF RFCs, SemVer, SVG (W3C) and glTF (Khronos) are openly available. D2P references them normatively.
- ISO and ASTM documents (for example ISO 8559-1, ISO 8559-2, ISO 7250-1, ISO 20685-1, ISO 216, ISO 32000, ASTM D5219) are copyrighted publications. D2P uses only facts that are needed for interoperability (paper dimensions, the names of measurement concepts) and copies no normative text or tables. Mappings to measurement standards are informative and are published only after the edition and licence have been checked (catalog §5).

## 6. Open points

- No mapping to an external measurement standard has been published yet. The mechanism, the `mapping-profile` document (catalog §3.1), exists; `mappings/` holds no profile.
- The import/export boundary schemas that would accept `m` or `deg` (catalog §1.6) and an AAMA/ASTM DXF import profile are not part of 1.0.
- This analysis is reviewed with every minor release that adds a module or a vocabulary.
