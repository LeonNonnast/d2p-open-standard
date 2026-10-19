# D2P Schema Catalog — standard 1.0

**Status:** normative draft of the first release, `1.0.0`. Nothing here is stable before the `v1.0.0` tag; until then any part may still change (see §1.11 and [GOVERNANCE.md](../GOVERNANCE.md)).
**Scope:** every JSON Schema, vocabulary file, fixture and conformance case of standard 1.0, plus the shared conventions they must follow.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as described in RFC 2119 / RFC 8174.

This catalog is the single source for schema shapes. A schema that contradicts it is a bug in the schema. A rule needed by a schema but missing here is changed in this catalog first.

---

## 1. Conventions

### 1.1 Files, dialect, identity

- Every schema is `schemas/<module>/<name>.schema.json`, declares `"$schema": "https://json-schema.org/draft/2020-12/schema"` and `"$id": "https://d2p.nonnast.dev/schemas/<module>/<name>.schema.json"` (enforced by `npm run validate`). `$id`s carry **no version segment**: the version of a schema is the release tag of this repository.
- Every schema compiles in the repository's strict Ajv configuration (`tools/lib/ajv.mjs`, `strict: true`). Practical consequences:
  - every name in `required` MUST also appear in `properties` of the **same** schema object (`strictRequired`). Inside `then`/`else`, add `"properties": {"x": true}` next to `"required": ["x"]`;
  - every schema object that uses a type-specific keyword (`properties`, `required`, `additionalProperties`, `propertyNames`, `items`, `prefixItems`, `contains`, `minItems`, `uniqueItems`, `minimum`, `exclusiveMinimum`, `pattern`, `minLength`, `format`, …) declares a single `type` in that same object (`strictTypes`). The only exception is an in-place applicator subschema (`if`, `then`, `else`, `allOf`, `anyOf`, `oneOf`, `not`) of a schema object that already declares the type. A nested `properties` entry, a `$defs` entry and a `$ref` target always declare their own `type`. Union types (`"type": ["string", "number"]`) are not used; use `anyOf` of single-type schemas instead;
  - `prefixItems` needs `minItems` and `items: false` (`strictTuples`);
  - no unknown keywords. Custom annotation keywords (`x-…`) are forbidden, so put machine hints in this catalog or in `$comment`.
- Every schema root and every `$defs` entry has a `title` and a `description`.
- Schemas do not use `default`. Every optional member has stated absence semantics, so digests never depend on whether a default was written out. An optional array member that would be empty is **omitted**, unless this catalog marks the member as required (then `[]` is written).

### 1.2 Document kinds

| Kind | Meaning | Header members (all required) |
|---|---|---|
| **Artifact content** | The content of one immutable artifact revision (design decisions ADR-001, ADR-002, ADR-003) | `documentType`, `schemaVersion`, `artifactId`, `revisionId` |
| **Derived document** | Immutable result computed from pinned inputs (evaluation, snapshot, report, gate, scene, print job). It is never an artifact revision | `documentType`, `schemaVersion`, own ID |
| **Record / vocabulary / envelope** | Metadata, registries, profiles, commands, events, test evidence | `documentType`, `schemaVersion`, own ID (where §3.0 lists one) |
| **Fragment** | Schema reused inside documents. It is never a file on its own except in `examples/` | none |

- `documentType` is a `const` per schema, from the registry in §3.0.
- `schemaVersion` is the full SemVer of the standard release the document was written against (§1.11). Documents in this release use `"1.0.0"`.
- Only three members MAY embed a complete top-level document, and the embedded document keeps its own header: `print-job-spec.scene` (an `export-scene-2d`), `pattern-evaluation.request` (an `evaluation-request`) and `command.payload.content` of a `d2p:artifact.create` command (an artifact content document, §3.6). The version gate (classifier C1) applies to embedded documents too, and an embedded `schemaVersion` MUST equal the `schemaVersion` of the embedding document (D2P-STR-003). An embedded `documentType` is fixed by the embedding schema, so a wrong value is a schema error (D2P-STR-001).

### 1.3 Naming

- Member names are `camelCase` ASCII. `$defs` names are `camelCase`. File names are `kebab-case`.
- A member holding an ID ends in `Id` (`artifactId`), and an array of IDs ends in `Ids`.
- A member whose schema is `artifactRef` or `elementRef` (§1.5) ends in `Ref`, and an array member whose items are `artifactRef` or `elementRef` ends in `Refs`. Conversely, no other member may use these suffixes except members holding a `derivedRef` (`snapshotRef`, `evaluationRef`, `reportRefs`, `evidenceRefs`, `validationReportRef`, `subjectRef`, `derivedSubjectRefs`). Structural classifier C4 (§2.2) relies on this. The only pinned artifact reference not shaped as `artifactRef` is the polymorphic `relationship.source` (§3.1), whose pinning is enforced by its schema.
- A member referencing a feature of the same pattern ends in `FeatureId` (`FeatureIds` for arrays). The feature-graph dependency extraction (§3.2.3) relies on this.
- Expressions appear **only** as the value of a member named `expr` (and recursively in `args`). Classifier C3 relies on this.
- Bare-word enum values (`outer`, `forward`) are **closed**. Values of extensible vocabularies are **qualified names** (`d2p:stitched`).

### 1.4 Identifiers

All identifier `$defs` live in `core/ids.schema.json`.

**Global IDs** identify documents and artifacts. Format: `<prefix>_<opaque>`, regex `^<prefix>_[0-9A-Za-z][0-9A-Za-z-]{0,63}$`. Consumers MUST treat the opaque part as opaque and compare IDs byte-wise. Producers SHOULD use UUIDv7 or ULID for the opaque part. Fixtures use readable slugs (§4.2).

| Prefix | Identifies | `$defs` name | Prefix | Identifies | `$defs` name |
|---|---|---|---|---|---|
| `prj` | Project | `projectId` | `snp` | Geometry snapshot | `snapshotId` |
| `prd` | Product | `productId` | `fer` | Fit evaluation report | `fitEvaluationReportId` |
| `art` | Artifact | `artifactId` | `vrp` | Validation report | `validationReportId` |
| `rev` | Artifact revision | `revisionId` | `gte` | Gate evaluation | `gateEvaluationId` |
| `rel` | Relationship | `relationshipId` | `wvr` | Waiver | `waiverId` |
| `cmd` | Command | `commandId` | `xsc` | Export scene | `sceneId` |
| `evt` | Event | `eventId` | `pjs` | Print job | `printJobId` |
| `job` | Job | `jobId` | `trr` | Test run report | `testRunReportId` |
| `prn` | Principal (actor) | `principalId` | `bmr` | Benchmark run | `benchmarkRunId` |
| `cor` | Correlation | `correlationId` | `qeb` | Quality evidence bundle | `evidenceBundleId` |
| `erq` | Evaluation request | `evaluationRequestId` | `pev` | Pattern evaluation | `evaluationId` |

`globalId` (the root of `core/ids.schema.json`) accepts any of the prefixes above.

**Element IDs** identify internal entities of one aggregate or document (pieces, edges, features, seam interfaces, size entries, layers, …). Regex `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`, maximum length 128 (`elementId`). The rules below follow design decisions ADR-002 and ADR-007:

1. All `id` members within one document share **one namespace** and MUST be unique (D2P-REF-005). Keys (`key`, `sizeKey`, `cutInstanceKey`, `configurationKey`) use the same format and are unique within their own kind. A `definitionId` is unique within the `measurements` of one size entry and within the `measurements` of one body measurement profile, so that measurement input resolution (§3.4) finds at most one value (D2P-REF-005). Within a vocabulary document, a `definitionId` occurs once in a registry's `definitions`, and across the registries of one resolution context it has one meaning (D2P-REF-015), a `ruleId` once in a profile's `rules`, and a (`d2pTerm`, `externalTerm`) pair once in a mapping profile's `entries` (D2P-REF-005); these arrays are sorted as their sections state (D2P-REF-014).
2. An element ID is **stable**. It is kept across revisions as long as the element exists, it is never reused for a different element in the same artifact lineage, and it MUST NOT be derived from coordinates, array positions, SVG/PDF object IDs, mesh indices or evaluation order.
3. Evaluating another size or configuration MUST NOT change element IDs while the topology is unchanged. A topology-changing grading rule declares its identity effects (§3.2.6).
4. Split, merge, replace and removal of elements are recorded as `lineage` in the revision record (§3.1). Old references stay valid against their pinned revision.

**Qualified names** name extensible vocabulary terms (feature types, rule IDs, profile IDs, event types, …):

| `$defs` | Regex | Example |
|---|---|---|
| `extensionNamespace` | `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$` (reverse-DNS, contains at least one dot, never `d2p`) | `com.example.atelier` |
| `d2pName` | `^d2p:[a-z][a-z0-9]*([.-][a-z0-9]+)*$` | `d2p:point.polar` |
| `extensionName` | `^<extensionNamespace>:[a-z][a-z0-9]*([.-][a-z0-9]+)*$` | `com.example.atelier:smocking` |
| `qualifiedName` | `d2pName` or `extensionName`, maximum length 128 | |

The local part of a qualified name starts with a letter (`d2p:print-1to1` is valid, `d2p:1to1-print` is not). The `d2p` namespace is reserved for this standard. Qualified names occur in two roles:

- **Vocabulary terms** are values of an extensible vocabulary (§1.10 rule 4): feature types, element types, artifact types, relationship types and roles, seam connection types, seam validation rule IDs (`seamConnection.validationRuleId`), sewing-group types, member and layer roles, material roles, ease zones, fit intents, postures, states, layer roles, output profiles, reason codes, command and event types, and tolerance metrics. An unknown `d2p:` term is always a structural error: the schema lists every `d2p:` term of the vocabulary (D2P-STR-001). Where 1.0 defines no `d2p:` term for a vocabulary (`relationship.role`), only extension names are valid.
- **Identifiers** name a vocabulary document or one of its entries: `definitionId`, `bodyDefinitionId`, `garmentDefinitionId`, `supersededBy`, `registryId`, `ruleId`, `profileId`, `suiteId`, `featureCapability.featureType`, `versionedId.id` and the items of `rule-definition.targetDocumentTypes`. Their schema accepts any `qualifiedName`. A `d2p:` identifier that names nothing defined by the standard is an unresolved reference where §2.6 resolves the member (D2P-REF-001, D2P-REF-008), and is informative elsewhere.

An unknown extension term is handled by the extension rules (§1.7).

**Other scalar and small `$defs`** in `core/ids.schema.json`: `semver` (SemVer 2.0.0 without build metadata: `^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$`), `schemaVersion` (= `semver`), `timestamp` (`format: date-time` plus pattern `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$`, UTC only), `idempotencyKey` (string, 1–255 chars, pattern `^[\x21-\x7E]+$`), `diagnosticCode` (`^D2P-(STR|REF|SEM|EVL)-[0-9]{3}$` or `^<extensionNamespace>:[A-Z][A-Z0-9-]*$`), `versionedId` (`{id: qualifiedName, version: semver}`, closed), `softwareInfo` (`{name: string 1..200, version: string 1..64}`, closed; used for implementations, generators and runners), `evaluatorDescriptor` and `evaluatorPrecision` (shape in §3.4; they live in core because the `measurement`, `eval` and `validation` modules all use them, §1.10.3).

### 1.5 References

Schemas live in `core/artifact-ref.schema.json`.

| `$defs` | Shape (all closed) | Use |
|---|---|---|
| `artifactRef` (root) | `{artifactId, revisionId}`, both required | Every cross-aggregate reference to an artifact revision |
| `elementRef` | `{artifactId, revisionId, elementId, elementType?}` | Reference to an element inside a pinned revision (design decision ADR-007 §4) |
| `derivedRef` | `{id: globalId, digest?}` | Reference to a derived document (evaluation, report, snapshot, scene, print job) |

Rules:

1. Every reference that leaves an aggregate is **pinned**: it names a concrete `revisionId`. A branch name, `HEAD`, "latest" or a missing revision is not expressible (D2P-STR-011). A different revision MUST NOT be substituted silently.
2. Inside one artifact content document, references are plain local element IDs (`edgeId`, `interfaceIds`, `connectionId`, …). Plain element IDs that point into **another** document resolve only through a pinned reference named in §2.6.
3. `elementType` takes values from the element-type registry: `d2p:feature`, `d2p:parameter`, `d2p:measurement-input`, `d2p:piece`, `d2p:contour`, `d2p:edge`, `d2p:notch`, `d2p:grainline`, `d2p:fold`, `d2p:seam-interface`, `d2p:seam-connection`, `d2p:sewing-group`, `d2p:grading-rule`, `d2p:size-entry`, `d2p:measurement-target`, `d2p:ease-rule`, `d2p:fit-target`. Extension element types use extension names.
4. A command `target` (`{artifactId, branch}`) is **not** a reference. It addresses a branch head and is paired with `expectedRevisionId` (§3.6).
5. **`derivedRef.digest`** holds the target's `resultDigest`. For a `geometry-snapshot` target it holds the `geometryDigest`. For a target that has neither, it holds the target's `contentDigest` as defined in §1.8 (computed whether or not the target writes it out). Where this catalog marks `digest` as required on a particular member, the schema requires it there.

### 1.6 Units and quantities

Canonical units: **millimetre** for length and **radian** for angle (design decisions ADR-006, ADR-017). The coordinate system is 2D Cartesian with X to the right and Y up, in mm (design decision ADR-007 §5).

- All 1.0 documents use canonical units only. `m` and `deg` stay reserved in `core/units.schema.json` for later import/export boundary schemas. No 1.0 document schema references the root of `core/units.schema.json` or its `unit`, `lengthUnit` or `angleUnit` definitions, so no 1.0 document accepts `m` or `deg`.
- **Bare numbers** carry physical values wherever the schema states the dimension (geometry coordinates, tolerances, `…Mm` members). A member whose name ends in `Mm` is in mm and one ending in `Rad` is in rad. Members inside geometry structures (`point2`, segments) are in mm without a suffix.
- **Quantity objects** `{value, unit}` are used where a value is entered or transported as a measurement (`measurement-value`, ease amounts, targets) and for expression literals.
- `core/units.schema.json` keeps its root and existing `$defs` unchanged and gains these `$defs`: `lengthMm` (number), `nonNegativeLengthMm` (number, `minimum: 0`), `positiveLengthMm` (`exclusiveMinimum: 0`), `angleRad` (number), `ratio` (number, `minimum: 0`, dimensionless), `dimension` (`enum: ["length", "angle", "dimensionless"]`), `quantityUnit` (`enum: ["mm", "rad", "1"]`, where `"1"` means dimensionless), `quantity` (`{value: number, unit: quantityUnit}`, closed), `lengthQuantity` (`unit` const `mm`), `angleQuantity` (`unit` const `rad`), `unitsDeclaration` (`{length: const "mm", angle: const "rad"}`, closed).
- JSON numbers MUST be finite. Derived documents MUST NOT contain `-0` (canonicalization maps it to `0` anyway).
- Areas (dimension L²) appear only in derived documents, in mm². The member name ends in `Mm2`.

### 1.7 Extensions

The schema lives in `core/extension.schema.json` (root = `extensions`). This follows design decisions ADR-005, ADR-006.2 and ADR-022.1.

```json
"extensions": {
  "com.example.atelier": {
    "version": "1.2.0",
    "provenance": { "publisher": "Example Atelier", "uri": "https://example.com/d2p-ext" },
    "onUnknown": "read-only",
    "data": { "smockingRows": 6 }
  }
}
```

- `extensions` is an object. `propertyNames` = `extensionNamespace` (so `d2p` is impossible), and values = `extensionBlock`.
- `extensionBlock` is closed and has these required members: `version` (semver of the extension), `provenance` (`$defs/provenance`: `{publisher: string 1..200, uri?: uri, specification?: uri}`, closed; reused by feature capabilities and measurement mappings), `onUnknown` (`ignore` | `read-only` | `reject`) and `data` (open object).
- Placement: every top-level document and every entity that has an `id` MAY carry an optional `extensions` member. Value objects (EdgeInterval, quantities, points) do not.
- Consumers that do not understand a namespace:
  - `ignore`: process normally and preserve the block verbatim when writing the document back;
  - `read-only`: display and validate, but MUST NOT modify the carrying object or its descendants (D2P-SEM-007, warning);
  - `reject`: refuse the document (D2P-SEM-006, error).
- **Extension feature types** (§3.2.3) and **extension vocabulary terms** (qualified names outside `d2p`) are the two other extension points. An extension MUST NOT change the meaning of standard members, and a consumer MUST never silently drop or reinterpret extension content.
- **A missing evaluator never blocks display.** A consumer without the evaluator of an extension feature type MAY restrict editing and re-evaluation of the pattern, but MUST NOT refuse a conforming geometry snapshot of it and MUST display such a snapshot read-only (design decision ADR-006.2; §3.4, TOP-009). A feature capability therefore has no `reject` behaviour: its `onUnknown` is always `read-only` (D2P-SEM-004, §3.2.6). `reject` applies to extension blocks only.

### 1.8 Digests, canonicalization and array order (digest profile `d2p-digest-v1`)

Digest schemas live in `core/digest.schema.json`. This follows design decisions ADR-006, ADR-017 §4 and ADR-025 §4.

**Format.** `^sha256:[0-9a-f]{64}$` (`digest`, root). In 1.0, `sha256` is the only algorithm.

**Canonical form `d2p-c14n-v1`** of a JSON value:

1. Parse as UTF-8 JSON. Duplicate member names are an error (D2P-STR-004).
2. Remove the **excluded members** defined for the digest kind (below). Exclusions apply to top-level members only, unless stated otherwise.
3. **Quantize numbers.** Replace every number `n` with the value obtained by taking its shortest round-trip decimal representation (ECMAScript `Number.prototype.toString`, Go `strconv.FormatFloat(n, 'g', -1, 64)`), rounding that decimal **half-to-even to 9 fractional digits**, and converting the result to the nearest binary64. Map `-0` to `0`. Integers are unaffected. The step is 1e-9 of the canonical unit (1 pm for lengths, 1 nrad for angles).
4. Serialize per **RFC 8785 (JCS)**: members sorted by UTF-16 code units, no insignificant whitespace, ECMAScript number and string serialization.
5. `digest = "sha256:" + lowercase hex(SHA-256(UTF-8 bytes))`.

Arrays keep their order. Order is significant, so producers of derived documents MUST emit arrays in the order defined below. Strings MUST be NFC-normalized by producers; the canonical form does not normalize them.

The quantization step is a **canonicalization parameter, not a tolerance**. Digest equality is required only for repeated runs of the same implementation, profile and platform (design decision ADR-017 §5). Agreement across implementations is judged with tolerance profiles (§3.8), never with digests. Changing any rule above creates a new digest profile ID.

**Test vectors** (canonical form → digest):

| Input | Canonical form | Digest |
|---|---|---|
| `{"b":[1.0000000004,2.0000000005,-0.0],"a":"x"}` | `{"a":"x","b":[1,2,0]}` | `sha256:e6636f36dab7c2a4bb2d6dd5b9784027f39dab43dd872092166fea5a73967c56` |
| `{"y":0.30000000000000004,"x":123.4567891235,"z":1e-10,"w":-2.5e-9}` | `{"w":-2e-9,"x":123.456789124,"y":0.3,"z":0}` | `sha256:3b8f1b665dfb9410c85014bd59056fae1e93559b102e6992d0337749b69a9895` |
| `{"units":{"length":"mm","angle":"rad"},"pieces":[]}` | `{"pieces":[],"units":{"angle":"rad","length":"mm"}}` | `sha256:096f11b5acef4032a893ccf25a958086a21cf14b8236d935fbba814a7c01cc0f` |

**Digest kinds**

| Member | Computed over | Excluded members |
|---|---|---|
| `contentDigest` (optional on any document) | the whole document | `contentDigest` |
| `revision.contentDigest` | the artifact content document of that revision | the content document's own `contentDigest` |
| `resultDigest` | the whole document | `contentDigest`, `resultDigest`, the document's own ID member, every top-level member ending in `At` |
| `geometry-snapshot.geometryDigest` | the object `{"units", "pieces", "interfaces", "seams"}` taken from the snapshot | not applicable |
| `fixture-manifest.fixtureDigest` | the manifest | `fixtureDigest` |
| manifest `files[].digest`, `externalFiles[].digest`, `toleranceProfile.digest` | the canonical form of the whole JSON file (raw-byte SHA-256 for non-JSON files) | none |
| `inputDigests[].digest` with `artifactRef` | the referenced artifact revision's `contentDigest` | as for `revision.contentDigest` |
| `inputDigests[].digest` with `id` (registries, profiles) | the canonical form of the whole vocabulary or profile document that has this `id` and `version` | none |
| `inputDigests[].digest` of role `material-assumptions` | the canonical form of the request's inline `materialAssumptions` object | none |

**`resultDigest` is required on exactly these document types:** `pattern-evaluation`, `fit-evaluation-report`, `validation-report`, `gate-evaluation`, `export-scene-2d` and `print-job-spec`. `geometry-snapshot` carries `geometryDigest` instead. No other document type has a `resultDigest` member.

`inputDigest` (`$defs`, closed): `{role, artifactRef?: artifactRef, id?: versionedId, digest}`. `role` is a closed enum: `pattern`, `grading-rule-set`, `body-measurement-profile`, `size-system`, `garment-measurement-spec`, `fit-profile`, `material-assumptions`, `measurement-definition-registry`, `tolerance-profile`, `validation-profile`. The first six roles require `artifactRef` and forbid `id`; `measurement-definition-registry`, `tolerance-profile` and `validation-profile` require `id` and forbid `artifactRef`; `material-assumptions` forbids both (schema-enforced, §1.12). Evaluator profiles are identified by `versionedId` only and are **not** digested in 1.0, because the standard defines no evaluator-profile document.

**Array order in derived documents.** All string comparisons use UTF-16 code-unit order. Where an order lists several keys, later keys break ties of earlier ones. An absent key sorts **before** any present value. The last tie-breaker is always the canonical form (`d2p-c14n-v1`, no exclusions) of the element, compared as a string.

| Array | Order |
|---|---|
| any `inputDigests` | `role`, `artifactRef.artifactId`, `artifactRef.revisionId`, `id.id`, `id.version`, `digest` |
| any `diagnostics` (all document types) | `code`, `documentPath`, `elementRef.artifactId`, `elementRef.revisionId`, `elementRef.elementId`, `instancePath`, `message` |
| any array of `artifactRef` (`targetRefs`, `subjectRefs`, `inputRefs`, …) | `artifactId`, `revisionId` |
| any array of `elementRef` | `artifactId`, `revisionId`, `elementId` |
| any array of `derivedRef` | `id`, `digest` |
| any array of IDs, keys or qualified names that is a set (`waiverIds`, `reasonCodes`, `requiredExtensions`, `sizeKeys`, …) | the string value |
| `pattern-evaluation.measurements` | `key` |
| `geometry-snapshot.pieces` | `pieceId` |
| `snapshotPiece.contours` | the `outer` contour first, then holes by `contourId` |
| `snapshotPiece.notches`, `.grainlines`, `.folds` | `notchId`, `grainlineId`, `foldId` |
| `geometry-snapshot.interfaces`, `.seams`, `.extensionEvaluators` | `seamInterfaceId`, `seamConnectionId`, `featureType` |
| `fit-evaluation-report.results` | `id` |
| `validation-report.findings` | see §3.5 (finding order) |
| `gate-evaluation.addressedFindings` | `reportId`, `findingId` |
| `export-scene-2d.source.evaluations` | `sizeKey`, `configurationKey` |
| `export-scene-2d.layers`, `.pieceInstances`, `.sizeStyles` | `id`, `id`, `sizeKey` |
| `pieceInstance.paths`, `.markers`, `.labels` | `id` |
| `export-scene-2d.lineStyles` | `layerId` |

Arrays whose order carries meaning keep their semantic order and are not re-sorted: `point2`, `contourPath.segments` (contour order), `pathSegment` arrays, `sceneMarker.points`, `dashMm`, and every array inside an embedded document (`request`, `scene`), which is copied verbatim. Any other array in a derived document that this table does not list is sorted by the canonical form of its elements.

### 1.9 Actors, text, timestamps

- `actor` (`core/ids.schema.json#/$defs/actor`, closed): `{kind: "person" | "agent" | "system", principalId}`. Names, e-mail addresses and other personal data never appear in actor objects.
- `name` and `title` strings are 1–200 characters. `description` is at most 4000 characters. There is no localization in 1.0. A `locale` member (BCP 47 string) appears only where text is rendered (print notice).
- Timestamps are UTC `timestamp` values (§1.4). Every member holding a timestamp ends in `At`.

### 1.10 Schema authoring rules

1. **Closed objects.** Every object schema sets `additionalProperties: false`. The only open containers in 1.0 are: `extensionBlock.data`, extension-feature `params`, `error.details`, `finding.evidence`, `diagnostic.details`, `rule-definition.parametersSchema`, profile rule `parameters` (checked against the rule's `parametersSchema` at semantic level), `feature-capability.paramsSchema`, extension command `payload`s, and `event.payload` for event types without a registered payload schema (§3.6).
2. **No object composition.** Object shapes are not merged with `allOf`. Reuse happens at field level (`$ref` to a member `$defs`), and every document lists its own `properties`. `if`/`then` discriminators keyed on a `const` member (`type`, `op`, `kind`, `status`, `mode`, …) are allowed.
3. **`$defs` reuse and module order.** The module dependency order is: (1) `core`; (2) `error`, `event`; (3) `pattern`, `measurement`; (4) `eval`; (5) `validation`, `print`, `command`; (6) `benchmark`. A schema may reference only its own module, and modules in **earlier** groups. Modules in the same group never reference each other. A definition used by more than one module lives in the lowest module that owns the concept, or in `core/*.schema.json`. References across files always use the **absolute `$id`** plus a JSON pointer (`https://d2p.nonnast.dev/schemas/core/ids.schema.json#/$defs/elementId`). References within a file use `#/$defs/…`. Copying a definition is forbidden, and so are `$anchor` and `$dynamicRef`.
4. **Enums.** Closed bare-word enums use `enum`. An extensible vocabulary is `anyOf: [{"enum": [<d2p terms>]}, {"$ref": ".../core/ids.schema.json#/$defs/extensionName"}]`.
5. **Sets.** Arrays of IDs that are sets use `uniqueItems: true`. Uniqueness of objects by `id` is a referential check (D2P-REF-005).
6. **Codegen friendliness.** Every object type is a named `$defs` entry with `title`, using the canonical names of §3.0.1. Avoid anonymous nested `oneOf`, and use `patternProperties` only where this catalog shows a map.
7. **Roots.** A document schema's root is the document object itself (`type: object` with its `properties`). A fragment schema's root is `{"$ref": "#/$defs/<root>"}` with the root name of §3.0.1, so examples of a fragment validate against its root.

### 1.11 Versioning and compatibility

This section follows design decisions ADR-019 and ADR-022.1, and [GOVERNANCE.md](../GOVERNANCE.md).

- The standard has one SemVer version. `schemaVersion` in a document names the release whose schemas it was written against.
- **The first release is `1.0.0`.** The standard publishes no `0.x` *standard* releases: no document ever declares a `0.x` `schemaVersion`. Snapshots of the draft MAY be tagged `v0.x.y` (pre-releases, recorded in [CHANGELOG.md](../CHANGELOG.md)); a pre-release tag is a draft of `1.0.0`, its documents declare `"1.0.0"`, and it carries no stability or compatibility promise. Until the `v1.0.0` tag, the content of the default branch is a draft of `1.0.0`: documents in this repository already state `"1.0.0"`, and the draft may change in any way. The `v1.0.0` tag freezes the schemas, the vocabularies, the Golden T-Shirt fixture `1.0.0` and the conformance cases together. After the tag, every change follows the rules below.
- The **compatibility line** `L(v)` is the `MAJOR` version.
- A consumer implementing release `R` MUST accept a document with version `D` if and only if `L(D) = L(R)` and `D ≤ R` in SemVer precedence. A pre-release `D` is accepted only by the identical pre-release. Every other `D` is rejected with **D2P-STR-003** before schema validation. Because schemas are closed, a newer minor document is never "partially" accepted.
- Change classes:
  - **major**: removing or renaming a member, adding a required member, tightening a constraint, changing semantics or a digest rule;
  - **minor**: new optional members, new schemas or modules, new values in a closed enum, new `$defs`, new conformance cases, new digest-profile IDs;
  - **patch**: text, examples and tooling fixes that do not change which documents are valid.
- **Capability versions** (§3.6) follow the same rules per module. `featureSetVersion` (the version of the `d2p:` feature types and expression nodes) equals the release version that introduced the feature set in use (`1.0.0` in this release).
- **Vocabulary versions** (measurement-definition registry, validation rules and profiles, tolerance profiles) are versioned independently of the standard. Their initial versions in this release are `1.0.0`.
- Deprecated members are marked `"deprecated": true`, kept for at least one minor release, and removed in the next major release.
- Every fixture pins the full `standardVersion`, the tolerance profile version and the digest profile (§4).

### 1.12 Conditional requirements: schema or semantic

A conditional requirement is enforced **either** by the schema **or** by a semantic or referential check, never both, so that every builder reports the same code. The schema-enforced conditions are exactly the ones listed here. A violation of one of them is reported as **D2P-STR-001** (and the semantic level is never reached). Every other conditional requirement in this catalog MUST NOT be encoded in a schema; it is checked at the level and with the code stated next to it.

| Document / entity | Condition (schema-enforced, D2P-STR-001) |
|---|---|
| `relationship.source` | `revisionId` required when `kind = artifact`, forbidden otherwise |
| `piece.contours` | exactly one contour with `role: outer` (`contains` + `minContains: 1` + `maxContains: 1`) |
| `seamConnection.ease` | `amount` forbidden when `mode = none`, required otherwise |
| `sewingGroup` | `type = d2p:layered-seam` requires `requirements.multiLayer: true`; `requirements.multiLayer = true` requires `layerOrder` |
| `featureCapability` | `evaluator` required when `lowering = extension`, `specification` when `normative`, `lowersTo` when `declarative`, each forbidden otherwise; `provenance` required when `featureType` is an `extensionName` |
| `grading-rule-set` | `order` required when `mode = hybrid`, forbidden otherwise |
| `inputDigest` | presence of `artifactRef` / `id` by `role` (§1.8) |
| `measurementValue.uncertainty` | members by `type` |
| `fitTarget` | `min` required for `comparison` `min` and `range`, `max` for `max` and `range`, each forbidden otherwise |
| `evaluation-request` | `sizeKey` requires `sizeSystemRef` (`dependentRequired`); `requestedOutputs` containing `validation-report` requires `validationProfile`; containing `fit-evaluation-report` requires `fitProfileRef` and `garmentMeasurementSpecRef` |
| `pattern-evaluation` | `status = succeeded` requires `constraintStatus: solved` and `snapshotRef`; `status = failed` forbids `snapshotRef` |
| `command` | `type = d2p:artifact.create` forbids `expectedRevisionId`; every other `d2p:` type requires it; `payload` shape by `type`; create `content` schema by `payload.artifactType` |
| `command-receipt` | `status = committed` requires `eventCursor` and `revisionRefs` (min 1); `rejected` requires `error`; `accepted-async` requires `jobId` |
| `event` | `eventType = d2p:artifact.revision-committed` requires `revisionId` and the registered payload shape |
| `print-job-spec.pageLayout.tiling` | `overlapMm` required when `mode = tiled`, forbidden when `none` |
| `test-run-report` | `resultState = skipped` requires `skipReason`; `subjectKind = evaluator` requires `backend` and `evaluatorProfile` |

Conditions that are deliberately **not** schema-enforced: `seamInterface.cutInstanceKey` (D2P-SEM-022), grading `baseSizeKey` and `sizeSystemRef` (D2P-SEM-080), size keys in garment targets and ease-rule scopes without a document-level `sizeSystemRef`, and a `geometry-snapshot.sizeKey` without a `size-system` input digest (D2P-REF-009), print `calibration` (D2P-SEM-091), named media dimensions (D2P-SEM-092), multi-size `sizeStyles` (D2P-SEM-094), negative ease (D2P-SEM-073), one capability per extension feature type (D2P-SEM-005) and revision `sequence` (D2P-REF-007).

---

## 2. Conformance levels and diagnostics

### 2.1 Levels

The three levels are separately runnable (`npm run conformance:<level>`), following design decisions ADR-005 and ADR-025.

| Level | Checks | Input | Needs |
|---|---|---|---|
| **structural** | Version gate, document-type selection, JSON Schema validation (including the schema-enforced conditions of §1.12), structural classifiers (§2.2) | each document alone | schemas only |
| **referential** | ID uniqueness, order of sorted vocabulary arrays, reference resolution per §2.6, element-type match, consistency of pinned inputs, staleness, digest integrity, manifest integrity (§2.4 REF codes) | a **bundle** | structural validity of every bundle document |
| **semantic** | Domain rules checkable **without a geometry kernel**: feature DAG acyclicity, expression dimensions, closed AST semantics, contour closure via shared points, polyline-only simplicity/orientation, seam-interface continuity, match points on their side's interface, TOP-/SWG- invariants, static constraint conflicts, privacy flags, measurement units (including the unit of each measurement definition) and definition kinds, snapshot completeness and seam arithmetic, print scene geometry and output-profile rules, report consistency, gate/waiver/evidence rules (§2.4 SEM codes) | a bundle | structural and referential validity |

- A **bundle** is the explicit set of documents given to a check. IDs resolve only inside the bundle. There is no network access and no implicit lookup. Bundles are formed as follows:
  - a **case bundle** is the `documents` of a conformance case (subjects and context);
  - a case document with role `manifest` (§2.5) is **expanded**: its `files` with role `input` or `expected` and its `externalFiles` join the bundle (as subjects). Files with role `negative` are checked for manifest integrity only and **never** join a bundle;
  - a negative case's context MUST NOT contain the original document that a subject replaces (§4.3).
- Geometric evaluation (curve lengths, intersections, offsets, solving, seam-length matching) is **not** part of the 1.0 conformance levels. Conditions that need it carry `D2P-EVL-*` codes and are tested against evaluator implementations later. A semantic check whose precondition is not met (for example, a contour containing curves for the polyline-only rules) is **not applicable**. It reports nothing, and cases MUST be built so that the expected checks apply.
- A runner at a given level first runs the lower levels on the whole bundle. A case whose expected diagnostics do not include a lower-level failure that the runner finds fails (precondition failure).

### 2.2 Structural classifiers

These classifiers are deterministic and run on the raw instance. They refine schema failures into specific codes. A structural runner always reports `D2P-STR-001` for any schema error and additionally reports the refined codes:

| ID | Condition | Code |
|---|---|---|
| C1 | `schemaVersion` missing, not SemVer, or not compatible (§1.11); for an embedded document (§1.2) also: not equal to the embedding document's `schemaVersion`. Schema validation of that document is skipped | D2P-STR-003 |
| C2 | Top-level `documentType` missing or not in §3.0 | D2P-STR-002 |
| C3 | Inside any `expr` value (recursively through `args`): an object whose `op` is missing or not in the closed node list (§3.2.4) | D2P-STR-010 |
| C4 | The value of a member ending in `Ref`, or an element of an array member ending in `Refs`, is an object that has `artifactId` but no `revisionId` matching `revisionId` | D2P-STR-011 |
| C5 | A member named `unit` whose value is a string outside the allowed unit set. The set is `{mm, rad, 1, ms, byte, count}` inside documents of type `d2p:test-run-report`, `d2p:benchmark-run` and `d2p:tolerance-profile`, and `{mm, rad, 1}` everywhere else. (A unit inside the set but not allowed for its slot, such as `"1"` in a measurement value, is reported as D2P-STR-001 only.) | D2P-STR-012 |

C1 and C2 are evaluated before schema validation. C3 to C5 inspect the instance directly, independent of how a JSON Schema validator reports its errors.

### 2.3 Diagnostic object

`core/diagnostic.schema.json` (root `diagnostic`, closed):

| Member | Req. | Type |
|---|---|---|
| `code` | yes | `diagnosticCode` |
| `severity` | yes | `severity`: `info` \| `warning` \| `error` \| `critical` (`$defs/severity`, reused by validation; ordered `info < warning < error < critical`) |
| `message` | yes | string 1..2000. It MUST NOT contain raw personal measurement values |
| `documentPath` | no | POSIX path of the document the diagnostic is about. In conformance runs it is repository-relative |
| `instancePath` | no | JSON Pointer (RFC 6901) |
| `elementRef` | no | `elementRef` |
| `details` | no | open object. It MUST NOT contain raw personal measurement values |

### 2.4 Diagnostic code registry

The level in a code names the level at which this catalog assigns the check (§1.12 decides between schema and semantic checks). `EVL` codes need an evaluator. A code identifies a condition, not a detector: an evaluator that detects a self-intersection reports D2P-SEM-011 too. The severity column is the registry default, used by conformance runs; validation profiles set their own severity (§3.5).

**Structural**

| Code | Name | Sev. | Condition |
|---|---|---|---|
| D2P-STR-001 | schema-violation | error | Any JSON Schema error, including the schema-enforced conditions of §1.12 |
| D2P-STR-002 | unknown-document-type | error | C2 |
| D2P-STR-003 | incompatible-schema-version | error | C1 |
| D2P-STR-004 | invalid-json | error | Not UTF-8, not parseable, or duplicate member names |
| D2P-STR-010 | forbidden-expression-node | error | C3: operator outside the closed list, including any script or code node |
| D2P-STR-011 | unpinned-reference | error | C4 |
| D2P-STR-012 | unit-not-permitted | error | C5 |

**Referential**

| Code | Name | Sev. | Condition |
|---|---|---|---|
| D2P-REF-001 | unresolved-document | error | A reference resolved per §2.6 finds no document: an `artifactRef`/`elementRef` `artifactId` matches no document of that artifact, or a resolved global ID or versioned ID matches no document in the bundle |
| D2P-REF-002 | unresolved-revision | error | The artifact is present but the pinned `revisionId` is not (no content document and no revision record), or an `elementRef` pins a revision whose content document is not in the bundle |
| D2P-REF-003 | unresolved-element | error | An `elementRef.elementId` or a plain element ID reference (§2.6) has no target of that kind in the pinned revision or document |
| D2P-REF-004 | element-type-mismatch | error | The target exists but has the wrong kind (`elementType`, point vs curve feature, unknown `featureOutput.output`) |
| D2P-REF-005 | duplicate-id | error | Duplicate element ID, key or vocabulary entry within one document (§1.4), or two bundle documents with the same **identity key** whose `d2p-c14n-v1` canonical forms (no exclusions) differ. The identity key is `(documentType, own ID members)` per the "Own ID" column of §3.0; for artifact content documents it is `(documentType, artifactId, revisionId)`. Documents without an own ID have no identity key. Identical copies are allowed |
| D2P-REF-006 | stale-revision | error | A revision-bound decision references a revision that is not the one in force: (a) a gate whose referenced reports' or waivers' `targetRefs` differ from the gate's `targetRefs`, compared as sets of `(artifactId, revisionId)`; (b) a gate with a target revision that has a child revision whose revision record in the bundle has `createdAt` ≤ the gate's `evaluatedAt`; (c) a command whose `expectedRevisionId` has a child revision whose revision record in the bundle has no `commandId` or a `commandId` different from the command's |
| D2P-REF-007 | inconsistent-pinned-inputs | error | Pinned inputs disagree: `grading-rule-set.patternRef` or `garment-measurement-spec.patternRef` ≠ the request's `patternRef`; a snapshot `patternRef` ≠ its evaluation's request `patternRef`; an evaluation's artifact `inputDigests` that are not exactly the artifact revisions its embedded request pins (each of `patternRef`, `gradingRuleSetRef`, `sizeSystemRef`, `bodyMeasurementProfileRef`, `fitProfileRef` and `garmentMeasurementSpecRef` present in the request has exactly one input digest of the matching role (§3.4) with the same `(artifactId, revisionId)`, and no other input digest of an artifact role is present); a snapshot `inputDigests` entry of role `pattern` whose `artifactRef` ≠ the snapshot's `patternRef`; a fit evaluation report `inputDigests` entry with an `artifactRef` whose (`role`, `artifactId`, `revisionId`) is not an input digest of the evaluation named by its `evaluationRef` (§3.3); a scene `source.patternRef` ≠ the `patternRef` of any evaluation in `source.evaluations`, or a scene evaluation's `geometryDigest` ≠ the `geometryDigest` of that evaluation's snapshot; a `pieceInstances[].sizeKey` absent from `source.evaluations`; a `sizeKey` used with two different size systems; a finding `elementRef` or `subjectRef` outside the report's `targetRefs` / `derivedSubjectRefs`; a revision record whose `sequence` is not 1 with no parents, or not max(parent `sequence`) + 1 when the parent records are in the bundle; a create command whose `content` header `artifactId` ≠ `target.artifactId` or `revisionId` ≠ `payload.initialRevisionId`; an evaluation request whose `configurationKey` is declared in a fixture manifest of the bundle but whose `fitProfileRef` or `materialAssumptions` differ from that declaration; a quality evidence bundle named in a gate's `evidenceRefs` whose `gate` ≠ the gate's `profile` or whose `subjectRefs` ≠ the gate's `targetRefs` (as sets) |
| D2P-REF-008 | unresolved-measurement-definition | error | `definitionId` not found in the registries declared by `definitionRegistries` (or the registry is not in the bundle) |
| D2P-REF-009 | unresolved-size-key | error | `sizeKey` not defined in the referenced size system revision, or a `sizeKey` used where the document has no `sizeSystemRef` to resolve it (for a `geometry-snapshot`: no `inputDigests` entry of role `size-system`) |
| D2P-REF-010 | unresolved-cut-instance | error | `cutInstanceKey` not declared by the pattern's cut instructions |
| D2P-REF-011 | digest-mismatch | error | A digest in a reference, input digest, revision record, print provenance or manifest differs from the recomputed digest of its target (§1.8, §1.5 rule 5) |
| D2P-REF-012 | unlisted-fixture-file | error | A file inside a fixture directory is not listed in its manifest (`manifest.json` excepted), or a listed file does not exist |
| D2P-REF-013 | unresolved-configuration-key | error | A bundle containing a fixture manifest with `configurations` has an evaluation request whose `configurationKey` is not declared there |
| D2P-REF-014 | vocabulary-order-invalid | error | A vocabulary array that this catalog declares sorted is out of order (UTF-16 code-unit order): `measurement-definition-registry.definitions` by `definitionId`, `validation-profile.rules` by `ruleId`, `mapping-profile.entries` by `d2pTerm`, then `externalTerm`. Equal neighbours are duplicates and reported as D2P-REF-005 only |
| D2P-REF-015 | ambiguous-measurement-definition | error | Within one resolution context, two different measurement-definition registries define the same `definitionId` with different `d2p-c14n-v1` canonical forms, so the meaning would depend on registry order. A resolution context is (a) the `definitionRegistries` of one document (reported at the later registry entry) and (b) the union of the `definitionRegistries` of the documents an `evaluation-request` pins by `patternRef`, `sizeSystemRef`, `bodyMeasurementProfileRef`, `fitProfileRef` and `garmentMeasurementSpecRef` (reported at the request member of the later document; conflicts within one pinned document are reported on that document only). Identical definitions in several registries are allowed. A duplicate inside one registry is D2P-REF-005 |

**Semantic**

| Code | Name | Sev. | Condition |
|---|---|---|---|
| D2P-SEM-001 | feature-cycle | error | The dependency graph of features and parameters (§3.2.3) has a cycle |
| D2P-SEM-002 | dimension-mismatch | error | An expression's dimension check fails (operands of `add`, `sub`, `min`, `max`, `clamp`, comparisons or `if` branches differ; a function argument has the wrong dimension; the result does not match the expected dimension of its slot) |
| D2P-SEM-003 | expression-too-complex | error | Expression depth > 64 or more than 1024 nodes in one `expr` (limits of 1.0). The root node of an `expr` has depth 1 |
| D2P-SEM-004 | unsupported-extension-feature | warning | An extension feature type has no evaluator available and the capability declares `onUnknown: read-only`. The pattern becomes read-only; a conforming snapshot stays displayable |
| D2P-SEM-005 | missing-feature-capability | error | An extension feature type is used without exactly one matching `featureCapabilities` entry |
| D2P-SEM-006 | required-extension-unsupported | error | Unknown extension block with `onUnknown: reject`, or an unsupported entry of a print job's `requiredExtensions` (§3.7). Feature capabilities cannot declare `reject` (§1.7) |
| D2P-SEM-007 | unknown-extension-read-only | warning | Unknown extension block with `onUnknown: read-only` |
| D2P-SEM-010 | contour-open | error | Contour edge chain not closed via shared point features (§3.2.5), or a snapshot contour whose last segment `end` ≠ `start` after quantization |
| D2P-SEM-011 | contour-self-intersection | error | A snapshot contour or a closed scene path made only of `line` segments has two non-adjacent segments that intersect, or adjacent segments that overlap (exact orientation predicates on quantized coordinates) |
| D2P-SEM-012 | contour-orientation | error | A line-only snapshot contour has the wrong signed area: `outer` MUST be counter-clockwise and `hole` clockwise |
| D2P-SEM-013 | edge-reused | error | Two edges of the same piece reference the same `curveFeatureId` |
| D2P-SEM-014 | snapshot-incomplete | error | A geometry snapshot does not hold the complete topology of the pattern at its `patternRef` (§3.4 snapshot completeness): a piece, contour, notch, grainline, fold or seam interface of the pattern, or an active seam connection, is missing or appears more than once, appears under another piece, or an inactive connection has a seam entry; a contour's segments are not one per edge in contour order (an extension curve may be written as several consecutive segments with the same `edgeId`); or a contour `role`, notch or fold `edgeId` or interface `cutInstanceKey` differs from the pattern |
| D2P-SEM-020 | seam-interface-discontinuous | error | The EdgeInterval chain of an interface is not continuous (§3.2.5) |
| D2P-SEM-021 | edge-interval-invalid | error | An EdgeInterval does not satisfy `from < to` |
| D2P-SEM-022 | cut-instance-ambiguous | error | An interface's edges belong to a piece with more than one cut instance and the interface has no `cutInstanceKey`, or the edges belong to more than one piece |
| D2P-SEM-023 | interface-multiply-connected | error | A seam interface is used by more than one active seam connection |
| D2P-SEM-024 | snapshot-seam-inconsistent | error | A snapshot seam whose `deviationMm` ≠ `lengthAMm` − `lengthBMm` − `declaredEaseMm`, whose `lengthAMm` / `lengthBMm` ≠ the `lengthMm` of the connection's interface A / B in the same snapshot, or whose `declaredEaseMm` is not 0 for ease mode `none` or not the value of a constant ease amount; compared after quantization (§3.4 numeric comparison) |
| D2P-SEM-025 | match-point-off-interface | error | A seam connection's `matchPoints[].notchIdA` names a notch that is not on interface A (`interfaceIds[0]`), or `notchIdB` one that is not on interface B (`interfaceIds[1]`): the notch's `edgeId` carries no interval of that interface, or its `position` lies outside `[from, to]` of every interval of that interface on the edge (compared after quantization, §3.2.6) |
| D2P-SEM-030 | sewing-group-duplicate-member | error | The same `connectionId` appears twice in one group |
| D2P-SEM-031 | connection-in-multiple-groups | error | A seam connection is a member of more than one sewing group |
| D2P-SEM-032 | sewing-group-disconnected | error | `requirements.groupTopology = connected`, but the member connections do not form a connected graph (nodes = cut instances, edges = connections) |
| D2P-SEM-033 | layer-order-invalid | error | A `layerOrder` entry names a cut instance that does not take part in any member connection, or appears twice |
| D2P-SEM-034 | sewing-group-unsupported-profile | error | A construction cannot be expressed as binary seam connections plus sewing groups without losing meaning (design decision ADR-007.1 §10). Reported by an importer or editor instead of writing a lossy document; a conforming document is binary by construction, so the conformance runners never report it (§3.2.6) |
| D2P-SEM-040 | constraint-inconsistent | error | Static constraint conflict (§3.2.3). Evaluators use the same code for status `inconsistent` |
| D2P-SEM-041 | *retired* | — | Now schema-enforced (§1.12, D2P-STR-001). The number is not reused |
| D2P-SEM-050 | personal-data-in-export | critical | An export document (`export-scene-2d`, `print-job-spec`) contains a reference to, or measurement values from, an artifact classified `personal` or `sensitive-personal` |
| D2P-SEM-051 | classification-inconsistent | error | A body measurement profile with `subject.kind = individual` is not classified `personal` or `sensitive-personal`, or artifact metadata and content disagree on `dataClassification` |
| D2P-SEM-070 | measurement-unit-mismatch | error | A measurement value, target, fit target or ease amount uses a unit that does not match its definition's dimension, or a measurement definition's `unit` is not the canonical unit of its `dimension` (`mm` for `length`, `rad` for `angle`) |
| D2P-SEM-071 | implicit-measurement-equivalence | error | An ease rule pairs a body definition and a garment definition whose `path.type` differ (for example girth vs flat width) |
| D2P-SEM-072 | required-measurement-missing | error | An evaluation request resolves no value for a `required` measurement input of the pattern (§3.4 resolution order) and the input has no fallback |
| D2P-SEM-073 | negative-ease-without-stretch | warning | Negative ease amount without a `materialCondition` requiring stretch (`minStretchRatio` > 0) |
| D2P-SEM-074 | negative-ease-material-incompatible | warning | An evaluation request whose fit profile has a negative-ease rule that applies to the request's `sizeKey` but whose `materialCondition` the request's `materialAssumptions` do not meet, or the request states no `materialAssumptions` (§3.3 applicability). The rule does not apply; the diagnostic makes that visible instead of silently approving or dropping the negative ease |
| D2P-SEM-075 | definition-kind-mismatch | error | A measurement definition is used on the wrong side (design decision ADR-011 §1, §4: body measurements, size labels and finished garment measurements are never confused): a size-entry value, a body-measurement-profile value or an ease rule's `bodyDefinitionId` names a definition that is not `kind: body`; a garment-measurement-spec target, a fit target's `garmentDefinitionId` or an ease rule's `garmentDefinitionId` names a definition that is not `kind: garment` |
| D2P-SEM-080 | grading-rule-set-inconsistent | error | Point-increment rules without `baseSizeKey`; a size-specific rule without `sizeSystemRef`; a rule targeting a non-point feature |
| D2P-SEM-090 | print-cut-line-open | error | A scene path on a `cut-line` or `seam-line` layer is not closed (`closed: false`, or its last segment `end` ≠ `start` after quantization) |
| D2P-SEM-091 | print-calibration-missing | critical | A print job for `d2p:home-print-a4`, `d2p:home-print-a3` or `d2p:plotter-1to1` has no `calibration` |
| D2P-SEM-092 | media-size-mismatch | error | Named media does not match its dimensions (ISO 216: A4 = 210 × 297 mm, A3 = 297 × 420 mm, in portrait) |
| D2P-SEM-093 | layer-unresolved | error | A scene path, label, marker or line style references a layer that does not exist |
| D2P-SEM-094 | size-styles-insufficient | error | A scene whose piece instances use more than one `sizeKey` lacks a `sizeStyles` entry for one of them, or two entries have equal `color` and equal `dashMm` (both absent counts as equal) |
| D2P-SEM-095 | output-profile-violated | error | A print job for `d2p:home-print-a4` or `d2p:home-print-a3` does not meet the binding page properties of its output profile (§3.7): media `iso-a4` respectively `iso-a3`; `tiling.mode = tiled` with `overlapMm` > 0; `registrationMarks` and `sheetLabels` `true`; at least one scene label on a `d2p:label` layer per piece instance |
| D2P-SEM-096 | scene-geometry-mismatch | error | An export scene does not reproduce its pinned geometry under rigid instance transforms (§3.7 scene geometry): for a size of `source.evaluations`, a cut instance of the pattern at `source.patternRef` does not appear exactly once; a piece instance's `pieceId` is not the piece of its cut instance, or `transform.mirror` differs from the cut instance's `mirrored`; a path on a `d2p:cut-line` or `d2p:seam-line` layer names no contour of the piece; a path that names a contour or edge of the piece is not that snapshot geometry under the instance transform (except a cut line with policy `included`); a cut line with policy `included` violates the kernel-free offset bounds; a path names an element that is no contour or edge of the piece, or names none on a `d2p:grainline`, `d2p:notch`, `d2p:fold` or `d2p:label` layer; or a snapshot contour of the piece is drawn on no `d2p:cut-line` layer, or with policy `included` on no `d2p:seam-line` layer |
| D2P-SEM-100 | waiver-for-critical | error | A waiver covers a finding of severity `critical` (design decision ADR-016 §6) |
| D2P-SEM-101 | waiver-scope-invalid | error | Waiver `expiresAt` ≤ `createdAt`; a waived finding is not in the referenced report; or a gate lists the waiver while the waiver's `action` differs from the gate's, its `targetRefs` differ from the gate's (as sets), or its `reportId` is not among the gate's `reportRefs` |
| D2P-SEM-102 | gate-decision-inconsistent | error | A gate's `decision`, `reasonCodes` or `addressedFindings` differ from the result of the decision procedure (§3.5) |
| D2P-SEM-103 | validation-report-inconsistent | error | A validation report contradicts itself or its profile (§3.5): `result` is not `pass` exactly when `status = completed` and no finding has severity `error` or `critical`; `purpose` ≠ the profile's `purpose`; or a finding's `ruleId` is not in the profile, its `ruleVersion` or `severity` differs from that rule's profile entry, or its `code` is not in the rule definition's `diagnosticCodes` (checked when the profile, respectively the rule definition, is in the bundle) |
| D2P-SEM-104 | gate-purpose-mismatch | error | A gate's profile, or a report named in its `reportRefs`, has a `purpose` that does not map to the gate's `action` (§3.5 purpose to action mapping), for example an `export-1to1` gate with a `sample-cut` profile |
| D2P-SEM-110 | evidence-state-inconsistent | error | A quality evidence bundle's `overallState` contradicts §3.8 |
| D2P-SEM-111 | *retired* | — | Now schema-enforced (§1.12). The number is not reused |
| D2P-SEM-112 | *retired* | — | Now schema-enforced (§1.12). The number is not reused |

**Evaluator (reserved now, tested against implementations later)**

| Code | Name | Sev. | Condition |
|---|---|---|---|
| D2P-EVL-001 | constraint-underconstrained | error | Solver status `underconstrained` |
| D2P-EVL-002 | constraint-overconstrained | error | Solver status `overconstrained` |
| D2P-EVL-003 | constraint-nonconvergent | error | Solver status `nonconvergent` |
| D2P-EVL-004 | intersection-not-found | error | `d2p:point.intersection` has no intersection with the requested `index` |
| D2P-EVL-005 | degenerate-geometry | error | Zero-length curve, coincident Bézier control polygon, or zero-radius arc |
| D2P-EVL-006 | arithmetic-domain-error | error | Division by zero, `sqrt` of a negative value, `asin`/`acos` out of [-1, 1], or a non-finite result |
| D2P-EVL-007 | extension-evaluator-unavailable | warning | Snapshot fallback used because an extension evaluator is missing |
| D2P-EVL-008 | parameter-out-of-curve | error | `d2p:point.along-curve` distance outside [0, curve length] |
| D2P-EVL-009 | arc-radius-inconsistent | error | Arc start and end are not equidistant from the center within the evaluator's `linearToleranceMm` |
| D2P-EVL-010 | seam-length-mismatch | warning | `|lengthA − lengthB − declaredEase|` exceeds the pinned tolerance profile |
| D2P-EVL-011 | measurement-fallback-used | warning | A measurement input's fallback estimate was used |

### 2.5 Conformance case format

Case files are named `conformance/<level>/**/<case>.case.json` and conform to `benchmark/conformance-case.schema.json` (§3.8). Paths in cases are repository-relative POSIX paths.

- **Document roles.** `subject` documents are under test. `context` documents are needed for resolution and are expected to be valid. A document with role `manifest` (at most one per case, `documentType` `d2p:fixture-manifest`) triggers manifest handling: the runner checks manifest integrity (every listed file exists with a matching digest, no unlisted file in the manifest's directory tree, `fixtureDigest` correct; D2P-REF-011, D2P-REF-012) and expands the bundle as described in §2.1. Manifest integrity is a referential check; a structural case never uses role `manifest`.
- **Diagnostic severity.** Conformance runs use the registry severity of §2.4.
- **Outcome.** The observed outcome is `reject` if and only if at least one diagnostic of severity `error` or `critical` is reported for any bundle document at the case's level or below. Otherwise it is `accept`. Warnings and infos never reject.
- **Editability.** The observed editability is `read-only` if and only if D2P-SEM-004 or D2P-SEM-007 is reported for a subject document. Otherwise it is `editable`. Editability is only observed at the semantic level.
- **Runner assumptions.** The kit's runners have no extension evaluators and understand no extension namespace.
- A case **passes** if the observed outcome equals `expect.outcome`, every expected diagnostic is reported (matching `code`, and `documentPath`/`instancePath` when given), and the observed editability equals `expect.editability` when given. Additional diagnostics are allowed and reported as notes.

### 2.6 Referential resolution scope

The referential runner resolves exactly the members below. Every member not listed is **informative**: it is not resolved, and an absent target is not a finding.

| Member (path) | Target | Resolved against | Code if unresolved |
|---|---|---|---|
| every `…Ref` / `…Refs` holding an `artifactRef` | content document or revision record of `(artifactId, revisionId)` | the bundle | D2P-REF-001 / D2P-REF-002 |
| every `elementRef` (`…Ref`, `elementRefs`) | element in the content document | the pinned revision's content document | D2P-REF-002 / D2P-REF-003 / D2P-REF-004 |
| every `derivedRef` (`snapshotRef`, `evaluationRef`, `reportRefs`, `evidenceRefs`, `validationReportRef`, `subjectRef`, `derivedSubjectRefs`) | derived document with that own ID (`evidenceRefs`: a `d2p:quality-evidence-bundle`); `digest` per §1.5 rule 5 | the bundle | D2P-REF-001; D2P-REF-011 |
| `inputDigests[].artifactRef`, `inputDigests[].id` (roles `measurement-definition-registry`, `tolerance-profile`, `validation-profile`) | artifact revision; vocabulary/profile document with that `id` and `version` | the bundle | D2P-REF-001 / D2P-REF-002; D2P-REF-011 |
| `definitionRegistries[]` | `d2p:measurement-definition-registry` with that `registryId` and `version` | the bundle | D2P-REF-008 |
| `definitionId` in measurement inputs, measurement values, targets, ease rules, fit targets, evaluation measurements | definition | the registries of the document (for an evaluation: of its request's pattern); one meaning per resolution context (D2P-REF-015) | D2P-REF-008 |
| `validation-report.profile`, `gate-evaluation.profile` | `d2p:validation-profile` | the bundle | D2P-REF-001 |
| `profile.rules[].ruleId` + `ruleVersion` | `d2p:validation-rule-definition` | the bundle | D2P-REF-001 |
| `gate-evaluation.waiverIds[]` | `d2p:waiver` | the bundle | D2P-REF-001 |
| `waiver.reportId`, `gate-evaluation.addressedFindings[].reportId` | `d2p:validation-report` | the bundle | D2P-REF-001 |
| `export-scene-2d.source.evaluations[].evaluationId` | `d2p:pattern-evaluation`; its `geometryDigest` against the evaluation's snapshot | the bundle | D2P-REF-001; D2P-REF-007 |
| `grading-rule-set` `parameterId`, `pointFeatureId`, `measurementKey` | parameter, point feature, measurement input | pattern at `patternRef` | D2P-REF-003 / D2P-REF-004 |
| `grading-rule-set` `sizeKey`s, `baseSizeKey` | size entry | size system at `sizeSystemRef` | D2P-REF-009 |
| `evaluation-request.sizeKey`, `garment-measurement-spec.targets[].sizeKey`, `fit-profile` `scope.sizeKeys` | size entry | the document's `sizeSystemRef` | D2P-REF-009 |
| `evaluation-request.configurationKey` | configuration | a fixture manifest's `configurations`, only when one is in the bundle | D2P-REF-013 |
| `pattern` feature `params` members ending in `FeatureId` / `FeatureIds` (§3.2.3: point, curve or line as the table requires), extension-feature `dependsOn` | feature of the kind §3.2.3 requires (any feature for extension feature types); for `dependsOn` a feature or parameter | the same document | D2P-REF-003 / D2P-REF-004 |
| `pattern` expressions (`param.parameterId`, `measurement.key`, `featureOutput.featureId` + `output`) in parameters, feature `params`, seam allowances and seam ease | parameter; measurement input; feature and one of its outputs | the same document | D2P-REF-003 / D2P-REF-004 |
| `pattern` `edges[].curveFeatureId`; `grainlines[].startFeatureId`, `endFeatureId` | curve feature; point feature | the same document | D2P-REF-003 / D2P-REF-004 |
| `pattern` `notches[].edgeId`, `folds[].edgeId`, `seamAllowance.edges[].edgeId` | edge of the same piece | the same document | D2P-REF-003 |
| `pattern` `seamInterfaces[].segments[].edgeId` | edge | the same document | D2P-REF-003 |
| `pattern` `seamInterfaces[].cutInstanceKey`, `sewingGroups[].layerOrder[].cutInstanceKey` (SWG-008) | cut instance (declared or implicit, §3.2.2) | the same document | D2P-REF-010 |
| `pattern` `seamConnections[].interfaceIds[]` (TOP-004) | seam interface | the same document | D2P-REF-003 |
| `pattern` `seamConnections[].matchPoints[].notchIdA`, `notchIdB`, `sewingGroups[].alignmentAnchors[]` | notch (whether a match-point notch lies on the interface of its side is the semantic check D2P-SEM-025) | the same document | D2P-REF-003 |
| `pattern` `sewingGroups[].members[].connectionId` (SWG-003) | seam connection | the same document | D2P-REF-003 |
| `geometry-snapshot` `pieceId`, `contourId`, `edgeId`, `notchId`, `grainlineId`, `foldId`, `seamInterfaceId`, `seamConnectionId`, `cutInstanceKey` | element of that kind | pattern at `patternRef` | D2P-REF-003 / D2P-REF-010 |
| `geometry-snapshot.sizeKey` | size entry | the size system named by the snapshot's `size-system` input digest | D2P-REF-009 |
| `export-scene-2d` `pieceId`, `elementId`, `cutInstanceKey` | element; cut instance | pattern at `source.patternRef` | D2P-REF-003 / D2P-REF-010 |
| scene `layerId` | layer | the same scene | D2P-SEM-093 (semantic) |

Informative members include: `geometry-snapshot.evaluationId`, `revision.commandId`, `revision.parentRevisionIds` (used for `sequence` and staleness when present), `command.target`, `command.expectedRevisionId` (used for staleness when present), `command-receipt.commandId`, `event.aggregateId`, every `evaluatorProfile`, `evaluation-request.toleranceProfile` and `validationProfile`, `finding.ruleId`/`ruleVersion` (compared in the gate procedure, §3.5), `fit-evaluation-report.results[].garmentDefinitionId`, `quality-evidence-bundle.reports[].reportId`, every member of `mapping-profile.entries` and every member of `test-run-report` and `benchmark-run`.

---

## 3. Module catalog

### 3.0 Document-type registry and file list

| Module | Schema file | `documentType` / kind | Own ID |
|---|---|---|---|
| core | `units` | fragment (exists; extend per §1.6) | — |
| core | `ids` | fragment | — |
| core | `digest` | fragment | — |
| core | `extension` | fragment | — |
| core | `artifact-ref` | fragment | — |
| core | `diagnostic` | fragment | — |
| core | `project` | `d2p:project` | `projectId` |
| core | `product` | `d2p:product` | `productId` |
| core | `artifact` | `d2p:artifact` | `artifactId` |
| core | `revision` | `d2p:revision` | `revisionId` |
| core | `relationship` | `d2p:relationship` | `relationshipId` |
| core | `mapping-profile` | `d2p:mapping-profile` (vocabulary) | `mappingId` + `version` |
| pattern | `pattern` | `d2p:pattern` (artifact content) | — (`artifactId` + `revisionId`) |
| pattern | `grading-rule-set` | `d2p:grading-rule-set` (artifact content) | — (`artifactId` + `revisionId`) |
| pattern | `piece`, `feature-graph`, `expression`, `seam-interface`, `seam-connection`, `sewing-group`, `feature-capability` | fragments | — |
| measurement | `measurement-definition-registry` | `d2p:measurement-definition-registry` (vocabulary) | `registryId` + `version` |
| measurement | `measurement-value` | fragment | — |
| measurement | `body-measurement-profile` | `d2p:body-measurement-profile` (artifact content) | — (`artifactId` + `revisionId`) |
| measurement | `size-system` | `d2p:size-system` (artifact content) | — (`artifactId` + `revisionId`) |
| measurement | `garment-measurement-spec` | `d2p:garment-measurement-spec` (artifact content) | — (`artifactId` + `revisionId`) |
| measurement | `fit-profile` | `d2p:fit-profile` (artifact content) | — (`artifactId` + `revisionId`) |
| measurement | `fit-evaluation-report` | `d2p:fit-evaluation-report` (derived) | `reportId` (`fer_`) |
| eval | `evaluation-request` | `d2p:evaluation-request` | `requestId` (`erq_`) |
| eval | `pattern-evaluation` | `d2p:pattern-evaluation` (derived) | `evaluationId` |
| eval | `geometry-snapshot` | `d2p:geometry-snapshot` (derived) | `snapshotId` |
| validation | `rule-definition` | `d2p:validation-rule-definition` (vocabulary) | `ruleId` + `version` |
| validation | `profile` | `d2p:validation-profile` (vocabulary) | `profileId` + `version` |
| validation | `finding` | fragment | — |
| validation | `report` | `d2p:validation-report` (derived) | `reportId` (`vrp_`) |
| validation | `gate-evaluation` | `d2p:gate-evaluation` (derived) | `gateEvaluationId` |
| validation | `waiver` | `d2p:waiver` (record) | `waiverId` |
| command | `command-envelope` | `d2p:command` | `commandId` |
| command | `command-receipt` | `d2p:command-receipt` | `commandId` |
| command | `capabilities` | `d2p:capabilities` | — |
| event | `event-envelope` | `d2p:event` | `eventId` |
| error | `error` | fragment | — |
| print | `export-scene-2d` | `d2p:export-scene-2d` (derived) | `sceneId` |
| print | `print-job-spec` | `d2p:print-job-spec` (derived) | `printJobId` |
| benchmark | `test-run-report` | `d2p:test-run-report` | `reportId` (`trr_`) |
| benchmark | `benchmark-run` | `d2p:benchmark-run` | `reportId` (`bmr_`) |
| benchmark | `quality-evidence-bundle` | `d2p:quality-evidence-bundle` | `bundleId` |
| benchmark | `tolerance-profile` | `d2p:tolerance-profile` (vocabulary) | `profileId` + `version` |
| benchmark | `fixture-manifest` | `d2p:fixture-manifest` | `fixtureId` + `fixtureVersion` |
| benchmark | `conformance-case` | `d2p:conformance-case` | `caseId` |

The modules `3d`, `assembly`, `production`, `package` and `import` get no schemas in 1.0.

**Vocabulary and data files.** A vocabulary file whose ID is the qualified name `d2p:<local>` with version `<v>` is stored as `<dir>/<local>-<v>.json`, where `<dir>` is `vocabularies/measurement-definitions/` (registries), `vocabularies/validation/rules/`, `vocabularies/validation/profiles/`, `tolerance-profiles/` or `mappings/` (mapping profiles). Example: `d2p:measurement-definitions` `1.0.0` → `vocabularies/measurement-definitions/measurement-definitions-1.0.0.json`. **Tooling requirement:** `npm run validate` MUST validate every JSON file under `vocabularies/`, `tolerance-profiles/` and `mappings/`, every `manifest.json`, `inputs/**` and `expected/**` file of a fixture, and every `*.case.json` against the schema selected by its `documentType` (§3.0), and fail on an unknown `documentType`. Files under a fixture's `negative/` directory and conformance case data directories are deliberately invalid in places and are checked only by the conformance cases that use them.

**Specification documents.** Besides this catalog, standard 1.0 includes `specifications/gap-analysis.md` (design decision ADR-022.1 §2 principle 1, test OSS-002). For each module it names the existing standards and formats it reuses or deliberately does not replace (for example SVG, PDF, glTF, ISO 8559-1, ASTM D5219, the AAMA/ASTM DXF pattern exchange format), and the semantic gap the module fills. It is informative; where it and this catalog disagree, this catalog wins. `npm run validate` fails if the file is missing.

Member tables below list members **in addition to the header members** of §1.2. "Req." = required. Every document and every entity with an `id` also accepts optional `extensions` (§1.7), which is not repeated in the tables. `[x]` = array of x.

#### 3.0.1 Roots and canonical `$defs` names

Every object type has a named `$defs` entry with exactly the name given here. Fragment roots are `{"$ref": "#/$defs/<root>"}` (§1.10.7).

| File | Root | `$defs` |
|---|---|---|
| `core/ids` | `globalId` | `globalId`, one per prefix of §1.4 (`projectId` … `evaluationId`), `elementId`, `extensionNamespace`, `d2pName`, `extensionName`, `qualifiedName`, `semver`, `schemaVersion`, `timestamp`, `idempotencyKey`, `diagnosticCode`, `versionedId`, `softwareInfo`, `actor`, `evaluatorDescriptor`, `evaluatorPrecision` |
| `core/units` | `unit` (unchanged) | existing: `unit`, `lengthUnit`, `angleUnit`, `canonicalLengthUnit`, `canonicalAngleUnit`; new per §1.6 |
| `core/digest` | `digest` | `digest`, `inputDigest`, `inputRole` |
| `core/extension` | `extensions` | `extensions`, `extensionBlock`, `provenance`, `onUnknown` |
| `core/artifact-ref` | `artifactRef` | `artifactRef`, `elementRef`, `derivedRef`, `elementType` |
| `core/diagnostic` | `diagnostic` | `diagnostic`, `severity` |
| `core/artifact` | document | `artifactType`, `dataClassification` |
| `core/revision` | document | `lineageEntry` |
| `core/relationship` | document | `relationshipSource`, `relationshipType` |
| `core/mapping-profile` | document | `mappingEntry`, `mappingRelation` |
| `pattern/pattern` | document | `parameter`, `measurementInput` |
| `pattern/piece` | `piece` | `piece`, `contour`, `edge`, `notch`, `grainline`, `fold`, `cutInstruction`, `cutInstance`, `seamAllowance`, `edgeSeamAllowance` |
| `pattern/feature-graph` | `featureList` | `featureList`, `feature`, `featureType`, and one params object per `d2p:` type: `pointAbsoluteParams`, `pointOffsetParams`, `pointPolarParams`, `pointAlongCurveParams`, `pointIntersectionParams`, `pointMirrorParams`, `pointFreeParams`, `lineParams`, `arcParams`, `bezierCubicParams`, `constraintCoincidentParams`, `constraintDistanceParams`, `constraintLengthParams`, `constraintAngleParams`, `constraintLineParams` (horizontal, vertical), `constraintLinePairParams` (parallel, perpendicular), `constraintTangentParams` |
| `pattern/expression` | `exprNode` | `exprNode`, `literalNode`, `constantNode`, `paramNode`, `measurementNode`, `featureOutputNode`, `operatorNode`, `exprValue` (the `{expr}` wrapper) |
| `pattern/seam-interface` | `seamInterface` | `seamInterface`, `edgeInterval` |
| `pattern/seam-connection` | `seamConnection` | `seamConnection`, `seamEase`, `matchPoint` |
| `pattern/sewing-group` | `sewingGroup` | `sewingGroup`, `sewingGroupMember`, `sewingGroupRequirements`, `layerOrderEntry`, `sewingRole` |
| `pattern/feature-capability` | `featureCapability` | `featureCapability`, `featureOutputDeclaration` |
| `pattern/grading-rule-set` | document | `gradingRule`, `measurementSourceRule`, `parameterOverrideRule`, `pointIncrementRule`, `sizeExpr`, `pointIncrement` |
| `measurement/measurement-definition-registry` | document | `measurementDefinition`, `measurementPath`, `definitionMapping` |
| `measurement/measurement-value` | `measurementValue` | `measurementValue`, `measurementSource`, `uncertainty` |
| `measurement/body-measurement-profile` | document | `measurementSubject` |
| `measurement/size-system` | document | `sizeEntry`, `sizeIssuer` |
| `measurement/garment-measurement-spec` | document | `measurementTarget`, `targetTolerance` |
| `measurement/fit-profile` | document | `easeRule`, `easeScope`, `materialCondition`, `materialAssumptions`, `materialClass`, `materialStretch`, `fitTarget` |
| `measurement/fit-evaluation-report` | document | `fitResult` |
| `eval/evaluation-request` | document | `requestedOutput` |
| `eval/pattern-evaluation` | document | `constraintStatus`, `evaluationMeasurement` |
| `eval/geometry-snapshot` | document | `point2`, `segment`, `lineSegment`, `arcSegment`, `cubicSegment`, `pathSegment`, `linePathSegment`, `arcPathSegment`, `cubicPathSegment`, `contourPath`, `boundingBox`, `snapshotPiece`, `snapshotNotch`, `snapshotGrainline`, `snapshotFold`, `snapshotInterface`, `snapshotSeam`, `extensionEvaluatorUse` |
| `validation/rule-definition` | document | `ruleLayer` |
| `validation/profile` | document | `profileRule`, `waiverPolicy`, `validationPurpose` |
| `validation/finding` | `finding` | `finding`, `findingVisibility` |
| `validation/report` | document | — |
| `validation/gate-evaluation` | document | `gateAction`, `gateDecision`, `reasonCode`, `addressedFinding` |
| `validation/waiver` | document | — |
| `command/command-envelope` | document | `commandType`, `commandTarget`, `actorContext`, `createArtifactPayload`, `updateParametersPayload`, `parameterUpdate` |
| `command/command-receipt` | document | `receiptStatus` |
| `command/capabilities` | document | `conformanceClaim`, `printConformanceClaim` |
| `event/event-envelope` | document | `eventType`, `revisionCommittedPayload` |
| `error/error` | `error` | `error`, `errorCode` |
| `print/export-scene-2d` | document | `sceneSource`, `sceneEvaluation`, `layer`, `layerRole`, `lineStyle`, `sizeStyle`, `pieceInstance`, `instanceTransform`, `scenePath`, `sceneMarker`, `sceneLabel` |
| `print/print-job-spec` | document | `outputProfile`, `pageLayout`, `media`, `margins`, `tiling`, `calibration`, `printNotice`, `printConformance`, `printProvenance` |
| `benchmark/test-run-report` | document | `resultState`, `benchmarkUnit`, `subjectKind`, `fixturePin`, `executionEnvironment`, `backendPin`, `runMeasurement`, `measurementProvenance`, `runProvenance`, `attachment` |
| `benchmark/benchmark-run` | document | `benchmarkOperation` |
| `benchmark/quality-evidence-bundle` | document | `suitePin`, `evidenceReportEntry` |
| `benchmark/tolerance-profile` | document | `toleranceEntry`, `toleranceComparison`, `toleranceMetric` |
| `benchmark/fixture-manifest` | document | `fixtureFile`, `externalFile`, `tolerancePin`, `fixtureReview`, `fixtureConfiguration`, `changeCase`, `parameterDelta`, `relativePath`, `documentTypeName` |
| `benchmark/conformance-case` | document | `caseDocument`, `caseExpectation`, `expectedDiagnostic` |

### 3.1 core

**`project`** (design decision ADR-001)

| Member | Req. | Type / rule |
|---|---|---|
| `projectId` | yes | `projectId` |
| `name` | yes | string |
| `description` | no | string |
| `createdAt` | no | timestamp |

**`product`** has the members `productId` (req.), `name` (req.), `description` and `createdAt`. Projects and products organize artifacts only through relationships and never copy them.

**`artifact`** (artifact metadata)

| Member | Req. | Type / rule |
|---|---|---|
| `artifactId` | yes | `artifactId` |
| `artifactType` | yes | extensible: `d2p:pattern`, `d2p:grading-rule-set`, `d2p:body-measurement-profile`, `d2p:size-system`, `d2p:garment-measurement-spec`, `d2p:fit-profile` |
| `name` | yes | string |
| `dataClassification` | yes | `dataClassification` (`$defs` here, reused): `public` \| `internal` \| `confidential` \| `personal` \| `sensitive-personal` (policy tags, design decision ADR-013) |
| `description` | no | string |
| `createdAt` | no | timestamp |
| `createdBy` | no | `actor` |

**`revision`** (revision record, design decision ADR-003)

| Member | Req. | Type / rule |
|---|---|---|
| `revisionId` | yes | `revisionId` |
| `artifactId` | yes | `artifactId` |
| `sequence` | yes | integer ≥ 1. It is 1 if and only if `parentRevisionIds` is empty, and otherwise max(parent `sequence`) + 1 (checked when the parent records are in the bundle, D2P-REF-007) |
| `parentRevisionIds` | yes | `[revisionId]`, 0–2 items, `uniqueItems` (2 is reserved for merges) |
| `contentDigest` | yes | `digest` of the content document (§1.8) |
| `createdAt` | yes | timestamp |
| `author` | yes | `actor` |
| `commandId` | no | `commandId` that produced the revision (used by D2P-REF-006 (c)) |
| `lineage` | no | `[lineageEntry]`, min 1 when present (omitted when there is nothing to record): `{operation: "split" \| "merge" \| "replace" \| "remove", fromElementIds: [elementId] (min 1), toElementIds: [elementId]}` (`toElementIds` is empty only for `remove`). This makes TOP-006 checkable |
| `message` | no | string |

A revision is immutable. Undo is a new revision (a compensating commit), never an edit.

**`relationship`** (design decision ADR-001, with the target revision pinned)

| Member | Req. | Type / rule |
|---|---|---|
| `relationshipId` | yes | `relationshipId` |
| `relationshipType` | yes | extensible: `d2p:contains` (project/product → artifact), `d2p:depends-on`, `d2p:derived-from`, `d2p:variant-of` |
| `source` | yes | `relationshipSource`: `{kind: "project" \| "product" \| "artifact", id: globalId, revisionId?}`, closed. `revisionId` is required when `kind = artifact` and forbidden otherwise (schema, §1.12) |
| `targetRef` | yes | `artifactRef` (the pinned target revision) |
| `role` | no | extensible vocabulary without `d2p:` terms in 1.0: an `extensionName` (e.g. `com.example.atelier:base-pattern`). A `d2p:` role is a schema error until a minor release registers one (§1.4) |
| `createdAt` | no | timestamp |

**`mapping-profile`** (vocabulary; design decision ADR-005: external ontologies and industry conventions are mapped through versioned profiles that declare their provenance)

| Member | Req. | Type / rule |
|---|---|---|
| `mappingId` | yes | `qualifiedName` (`d2p:` for mappings published with the standard, an extension name otherwise) |
| `version` | yes | semver of the mapping, independent of the standard and of the external edition |
| `title` | yes | string 1..200 |
| `description` | no | string 1..4000 |
| `system` | yes | string 1..200: the external ontology, standard or convention |
| `systemVersion` | yes | string 1..64: the edition it refers to |
| `provenance` | yes | `core/extension.schema.json#/$defs/provenance` |
| `entries` | yes | `[mappingEntry: {d2pTerm: qualifiedName, relation: "exact" \| "close" \| "broader" \| "narrower" \| "related", externalTerm: string 1..200, note?: string}]`, min 1, sorted by `d2pTerm`, then `externalTerm` (D2P-REF-014), each pair once (D2P-REF-005) |

`relation` follows the SKOS mapping properties (`exactMatch`, `closeMatch`, `broadMatch`, `narrowMatch`, `relatedMatch`); `broader` means the external term is broader than the D2P term. A mapping translates to and from the canonical model and never replaces or redefines a D2P term: entries are informative (§2.6), and no reference resolves through a mapping. A mapping names external terms and carries no copied normative text or tables. Files live at `mappings/<local-name>-<version>.json` (§3.0). The inline `definitionMapping` of a measurement definition (§3.3) stays available for single definitions; a mapping profile covers a whole external system. Standard 1.0 publishes no mapping profile yet (§5).

**Fragments:** `ids`, `units`, `digest`, `extension`, `artifact-ref` and `diagnostic`, as specified in §1–§2, with the roots of §3.0.1.

### 3.2 pattern

This module follows design decisions ADR-006, ADR-006.1, ADR-006.2, ADR-007, ADR-007.1 and ADR-011 §5.

#### 3.2.1 `pattern` (artifact content, `artifactType` `d2p:pattern`)

| Member | Req. | Type / rule |
|---|---|---|
| `name` | yes | string |
| `featureSetVersion` | yes | semver of the `d2p:` feature types and expression nodes used (`1.0.0` in this release) |
| `definitionRegistries` | yes | `[versionedId]` of the measurement-definition registries used (may be empty) |
| `parameters` | yes | `[parameter]`: `{id, dimension, expr, label?, description?}`, where `expr` MUST evaluate to `dimension` |
| `measurementInputs` | yes | `[measurementInput]`: `{key, definitionId: qualifiedName, required: boolean, fallback?: quantity}`. `fallback` is an estimate, and using it emits D2P-EVL-011 |
| `features` | yes | `feature-graph.schema.json#/$defs/featureList` |
| `pieces` | yes | `[piece]`, min 1 (`piece.schema.json`) |
| `seamInterfaces` | yes | `[seamInterface]` (may be empty) |
| `seamConnections` | yes | `[seamConnection]` (may be empty) |
| `sewingGroups` | yes | `[sewingGroup]` (may be empty) |
| `featureCapabilities` | yes | `[featureCapability]`: exactly one per extension feature type used (D2P-SEM-005). It MUST NOT list `d2p:` types |

All arrays keep authoring order. The pattern's `contentDigest` therefore changes when elements are reordered, which is intended.

#### 3.2.2 `piece` (fragment; `$defs` per §3.0.1)

| Entity | Members (req. in **bold**) | Rules |
|---|---|---|
| `piece` | **`id`**, **`name`**, **`contours`** [contour] (min 1, `contains` role `outer` with `minContains: 1`, `maxContains: 1`), `notches`, `grainlines`, `folds`, `cutInstruction`, `seamAllowance` | Exactly one connected outer boundary per piece. Separate cut islands are separate pieces |
| `contour` | **`id`**, **`role`** (`outer` \| `hole`), **`edges`** [edge] (min 1) | Edges are in traversal order |
| `edge` | **`id`**, **`curveFeatureId`**, **`reversed`** (boolean) | The edge direction is the curve direction, flipped if `reversed`. Edge identity is independent of seam allowance, SVG IDs and sewing order |
| `notch` | **`id`**, **`edgeId`**, **`position`** (number in [0,1]: normalized arc length along the edge direction), **`marks`** (integer 1..3) | |
| `grainline` | **`id`**, **`startFeatureId`**, **`endFeatureId`** (points) | |
| `fold` | **`id`**, **`edgeId`** | The edge is the fold line |
| `cutInstruction` | **`instances`** [cutInstance: `{cutInstanceKey, mirrored: boolean}`] (min 1), **`materialRole`** (extensible: `d2p:main`, `d2p:lining`, `d2p:interfacing`, `d2p:contrast`) | Without a cut instruction the piece has one implicit instance with `cutInstanceKey` = piece `id`, `mirrored: false`. The fabric layer/face ("Stofflage") is not modelled in 1.0 (§5) |
| `seamAllowance` | **`default`** (`{expr}`, length), `edges` [edgeSeamAllowance: `{edgeId, expr}`] | Derived geometry (the offset is an evaluator capability). It is never part of seam identity |

#### 3.2.3 `feature-graph` (fragment; root = `featureList`)

`feature` (closed): **`id`**, **`type`** (`qualifiedName`), **`params`** (object), `label`, `dependsOn` ([elementId]). An `if`/`then` per `d2p:` type validates `params` (closed). Extension types (any `extensionName`) have open `params` and MUST declare `dependsOn`. `d2p:` types MUST NOT declare `dependsOn`. A `d2p:` type outside the list below is a structural error.

**Feature set `1.0.0`.** The notation `x: {expr} L` means the member `x` is an `exprValue` object `{"expr": <exprNode>}` (closed) whose expression has dimension L (length) or A (angle). The same wrapper is used for `seamAllowance`, constraint `value` and seam `ease.amount`.

| Type | `params` (all required unless marked `?`) | Kind | Outputs (`featureOutput.output`) | Lowering |
|---|---|---|---|---|
| `d2p:point.absolute` | `x: {expr} L`, `y: {expr} L` | point | `x`, `y` (L) | normative |
| `d2p:point.offset` | `baseFeatureId` (point), `dx: {expr} L`, `dy: {expr} L` | point | `x`, `y` | normative |
| `d2p:point.polar` | `baseFeatureId` (point), `distance: {expr} L`, `angle: {expr} A` (counter-clockwise from +X) | point | `x`, `y` | normative |
| `d2p:point.along-curve` | `curveFeatureId`, `distance: {expr} L` (from curve start) | point | `x`, `y` | normative |
| `d2p:point.intersection` | `curveAFeatureId`, `curveBFeatureId`, `index` (integer ≥ 0, ordered by parameter on curve A) | point | `x`, `y` | normative |
| `d2p:point.mirror` | `pointFeatureId`, `axisFeatureId` (line) | point | `x`, `y` | normative |
| `d2p:point.free` | `x: {expr} L`, `y: {expr} L` (initial values; solver variables) | point | `x`, `y` | normative |
| `d2p:line` | `startFeatureId`, `endFeatureId` (points) | curve | `length` (L), `angle` (A) | normative |
| `d2p:arc` | `startFeatureId`, `endFeatureId`, `centerFeatureId` (points), `direction` (`ccw` \| `cw`) | curve | `length`, `radius` (L), `sweep` (A) | normative |
| `d2p:bezier.cubic` | `startFeatureId`, `control1FeatureId`, `control2FeatureId`, `endFeatureId` (points) | curve | `length` (L) | normative |
| `d2p:constraint.coincident` | `aFeatureId`, `bFeatureId` (points) | constraint | — | normative |
| `d2p:constraint.distance` | `aFeatureId`, `bFeatureId` (points), `value: {expr} L` | constraint | — | normative |
| `d2p:constraint.length` | `curveFeatureId`, `value: {expr} L` | constraint | — | normative |
| `d2p:constraint.angle` | `aFeatureId`, `bFeatureId` (lines), `value: {expr} A` | constraint | — | normative |
| `d2p:constraint.horizontal` / `.vertical` | `lineFeatureId` | constraint | — | normative |
| `d2p:constraint.parallel` / `.perpendicular` | `aFeatureId`, `bFeatureId` (lines) | constraint | — | normative |
| `d2p:constraint.tangent` | `aFeatureId`, `bFeatureId` (curves sharing an endpoint feature) | constraint | — | normative |

Tier 1 (geometry core) is the table above. Tier 2 (pattern features) in 1.0 consists of the piece-level elements of §3.2.2. Further domain features (darts, pleats, …) arrive by minor release or as extension feature types (§5). Constraints act on `d2p:point.free` points and their dependents. Constraining fully determined geometry is diagnosed by the evaluator (D2P-EVL-002 or D2P-SEM-040).

**Dependency graph.** Nodes are features and parameters. Edges run from a node to every feature named in a `…FeatureId`/`…FeatureIds` member of its `params`, every `featureOutput.featureId` and every `param.parameterId` inside its `expr` members, and (for extension types) every `dependsOn` entry. Measurement inputs are leaves. The graph MUST be acyclic (D2P-SEM-001). Evaluation order is the topological order with ties broken by `id` (UTF-16 code-unit ascending).

**Static constraint conflicts (D2P-SEM-040, kernel-free).** A constant expression contains only `literal`, `constant` and operators. The following are conflicts:

1. Two `distance` constraints on the same unordered point pair, two `length` constraints on the same curve, or two `angle` constraints on the same ordered line pair, whose `value` expressions are both constant and evaluate to different numbers after quantization (§1.8).
2. `horizontal` and `vertical` on the same line.
3. `parallel` and `perpendicular` on the same unordered line pair.
4. A constant `distance` or `length` value < 0.

#### 3.2.4 `expression` (fragment; root = `exprNode`)

The expression language is a typed AST with a **closed** node list and no scripts, strings, user functions, loops or recursion (design decision ADR-006.1). A node is an object with `op` (required) and only the members listed for it:

| `op` | Members | Typing (dimension = integer exponent pair (L, A); boolean is separate) |
|---|---|---|
| `literal` | `value` (number), `unit` (`mm` \| `rad` \| `1`) | (1,0), (0,1) or (0,0) |
| `constant` | `name` (`pi`) | (0,0) |
| `param` | `parameterId` | the parameter's `dimension` |
| `measurement` | `key` (a `measurementInputs` key) | the dimension of the input's definition |
| `featureOutput` | `featureId`, `output` | per output (§3.2.3) |
| `add` | `args` (min 2) | all equal, result the same |
| `sub` | `args` (exactly 2) | equal |
| `mul` | `args` (min 2) | exponents add |
| `div` | `args` (exactly 2) | exponents subtract |
| `neg`, `abs` | `args` (exactly 1) | unchanged |
| `min`, `max` | `args` (min 2) | all equal |
| `clamp` | `args` (exactly 3: value, lower, upper) | all equal |
| `sqrt` | `args` (exactly 1) | even exponents, halved |
| `sin`, `cos`, `tan` | `args` (exactly 1, angle) | → (0,0) |
| `asin`, `acos` | `args` (exactly 1, (0,0)) | → angle |
| `atan2` | `args` (exactly 2: y, x; equal) | → angle |
| `lt`, `le`, `gt`, `ge` | `args` (exactly 2; equal) | → boolean |
| `and`, `or` | `args` (min 2, boolean) | → boolean |
| `not` | `args` (exactly 1, boolean) | → boolean |
| `if` | `args` (exactly 3: boolean, a, b; a and b equal) | dimension of a |

- Schema shape: `$defs/exprNode` is a `oneOf` of closed per-kind `$defs`: `literalNode`, `constantNode`, `paramNode`, `measurementNode`, `featureOutputNode` and `operatorNode`. `operatorNode` has `op` with an `enum` of the 24 operator names above (29 node kinds in total) and `args` (items `$ref` `#/$defs/exprNode`). The exact arity per `op` is enforced by `if`/`then` with `minItems`/`maxItems`.
- Every `expr` slot has an expected dimension from its context. A mismatch is D2P-SEM-002. An `expr` slot never accepts a boolean result.
- Depth: the root node of an `expr` has depth 1, and each `args` level adds 1 (limit: D2P-SEM-003).
- Evaluation uses IEEE-754 binary64 in node order. Results are deterministic, and domain errors are D2P-EVL-006.

#### 3.2.5 Topology rules (kernel-free; TOP-/SWG- invariants)

These rules follow design decisions ADR-007 and ADR-007.1.

- **Endpoints.** For a `d2p:line`, `d2p:arc` or `d2p:bezier.cubic` curve, start and end are its `startFeatureId` and `endFeatureId`. For an edge they are swapped if `reversed`. Edges whose curve is an extension type are not checked at semantic level.
- **Contour closure (D2P-SEM-010).** For the edges e1…en of a contour: end(e_i) = start(e_{i+1}) for all i, and end(e_n) = start(e_1). Equality is identity of point feature IDs. A coincident constraint does not count.
- **EdgeInterval** (`seam-interface.schema.json#/$defs/edgeInterval`, closed): **`edgeId`**, **`from`**, **`to`** (numbers in [0,1]: normalized arc length along the edge direction), **`direction`** (`forward` \| `reverse`). `from < to` is required (D2P-SEM-021). A `forward` interval runs from `from` to `to`, and a `reverse` interval runs from `to` to `from`.
- **Interface continuity (D2P-SEM-020).** For consecutive intervals s_i and s_{i+1}, at least one of the following holds:
  - (a) both are on the same edge with the same direction, and the end parameter of s_i equals the start parameter of s_{i+1};
  - (b) s_i ends at an edge endpoint (parameter 1 forward / 0 reverse), s_{i+1} starts at an edge endpoint (0 forward / 1 reverse), and those endpoints are the same point feature.

  All edges of an interface belong to one piece, and to one cut instance (D2P-SEM-022).
- **One active connection per interface (D2P-SEM-023, TOP-010/SWG-011).**
- **Sewing groups (SWG-005/006/007):** D2P-SEM-030, D2P-SEM-031, D2P-SEM-032 and D2P-SEM-033. The connectivity graph has cut instances as nodes (for an interface without `cutInstanceKey`, the implicit instance of its piece) and one edge per member connection.

#### 3.2.6 Fragments `seam-interface`, `seam-connection`, `sewing-group`, `feature-capability`; document `grading-rule-set`

**`seamInterface`**: **`id`**, **`segments`** [edgeInterval] (min 1), `cutInstanceKey` (required when the piece has more than one cut instance, D2P-SEM-022, not schema-enforced), `name`.

**`seamConnection`** (binary only, design decision ADR-007.1):

| Member | Req. | Type / rule |
|---|---|---|
| `id` | yes | elementId |
| `interfaceIds` | yes | `[elementId]`, `minItems: 2`, `maxItems: 2`, `uniqueItems` (SWG-004 is structural). The first item is side A and the second side B. A traversed in its direction corresponds to B traversed in its direction |
| `type` | yes | extensible: `d2p:stitched` |
| `active` | yes | boolean |
| `ease` | yes | `seamEase`: `{mode: "none" \| "gathered" \| "eased" \| "stretched", amount?: {expr} L}`. `amount` is forbidden when `mode = none` and required otherwise (schema). It means the expected length of A minus B |
| `matchPoints` | no | `[matchPoint: {notchIdA, notchIdB}]`. `notchIdA` is a notch on interface A and `notchIdB` a notch on interface B: the notch's edge carries an interval of that interface and its `position` lies within that interval's `[from, to]` (both are normalized arc length along the edge direction, so the check is kernel-free; D2P-SEM-025). A notch elsewhere on the pattern is not a match point of this seam |
| `validationRuleId` | no | extensible: the `d2p:` rule IDs of the 1.0 rule vocabulary (§3.5, e.g. `d2p:seam-length-match`) or an `extensionName`. Informative for the referential level (§2.6) |

**`sewingGroup`**:

| Member | Req. | Type / rule |
|---|---|---|
| `id` | yes | elementId |
| `type` | yes | extensible: `d2p:layered-seam`, `d2p:binding`, `d2p:reinforcement`, `d2p:composite-assembly` |
| `members` | yes | `[sewingGroupMember: {connectionId, role?: sewingRole}]`, min 2 (SWG-002 is structural). Member order is the layer/relationship order, not sewing order |
| `requirements` | yes | `sewingGroupRequirements`: `{groupTopology: "connected" \| "logical-collection", validateMemberSeams: boolean, multiLayer?: boolean}`. `multiLayer` absent means `false`. `type = d2p:layered-seam` requires `multiLayer: true` (schema) |
| `layerOrder` | when `requirements.multiLayer = true` (schema) | `[layerOrderEntry: {cutInstanceKey, role: sewingRole}]`, min 1, each `cutInstanceKey` once (D2P-SEM-033) |
| `alignmentAnchors` | no | `[elementId]` of notches |
| `annotations` | no | string |

`sewingRole` (`$defs` here) is extensible: `d2p:outer-fabric`, `d2p:inner-fabric`, `d2p:binding`, `d2p:lining`, `d2p:reinforcement`, `d2p:interfacing` (the role vocabulary of design decision ADR-007.1 §4); other roles, such as a member role for a front attachment, use extension names. The group-level `roles` of design decision ADR-007.1 §4 are expressed by the member roles and the layer roles; there is no separate group-level `roles` member. Groups contain no geometry and create no implicit connections. Nested groups are impossible by construction.

**Group status** (design decision ADR-007.1 §7, §10). A sewing group has no stored status member: its operating status is derived from the diagnostics reported for it (diagnostics whose `instancePath` lies inside the group, or inside one of its member connections or their interfaces):

| Status | Derived when |
|---|---|
| `valid` | no diagnostic of severity `warning` or higher is reported for the group |
| `warning` | only diagnostics of severity `warning` (for example D2P-EVL-010 on a member seam when `validateMemberSeams` is `true`) |
| `invalid` | any diagnostic of severity `error` or `critical`, including D2P-SEM-030 to D2P-SEM-033 and a member naming a missing connection (D2P-REF-003, the group's "invalid reference" state) |
| `unsupported-profile` | D2P-SEM-034: the construction cannot be broken down into binary connections without losing meaning. The application either proves a valid binary decomposition or reports D2P-SEM-034; it never drops information silently |

A group whose pattern changed since it was validated ("needs revalidation") is not a document state: a validation report pins the pattern revision it checked, and a gate on a newer revision treats that report as stale (D2P-REF-006, §3.5 step 2).

**`featureCapability`** (lowering per design decision ADR-006.2):

| Member | Req. | Type / rule |
|---|---|---|
| `featureType` | yes | `qualifiedName` |
| `version` | yes | semver |
| `lowering` | yes | `declarative` \| `normative` \| `extension` |
| `kind` | yes | `point` \| `curve` \| `constraint` \| `other` |
| `outputs` | yes | `[featureOutputDeclaration: {name, dimension}]` |
| `onUnknown` | yes | `read-only` (consumer behaviour without an evaluator; the only value in 1.0). Without the evaluator the pattern is not editable and not re-evaluated, and a conforming snapshot stays displayable read-only (D2P-SEM-004). There is no `reject` (§1.7) |
| `evaluator` | `lowering = extension` | `versionedId` |
| `specification` | `lowering = normative` | URI |
| `lowersTo` | `lowering = declarative` | `[featureType]` restricted to its `d2p:` values (the closed feature set 1.0.0; an unknown `d2p:` name or an extension name is D2P-STR-001). Informative in 1.0, see below |
| `provenance` | when `featureType` is an `extensionName` | `core/extension.schema.json#/$defs/provenance` (publisher of the feature type) |
| `paramsSchema` | no | open object (a JSON Schema for `params`; data, not compiled by the kit) |

**Declarative lowering in 1.0.** Design decision ADR-006.2 prefers declarative decomposition, but standard 1.0 defines no decomposition template that maps an extension feature's `params` to generated `d2p:` features. `lowersTo` therefore only declares which feature types the decomposition produces. A consumer that has no evaluator for the feature type treats a `declarative` feature exactly like an `extension` feature: the pattern is read-only and a conforming snapshot stays displayable (D2P-SEM-004). A normative template is deferred (§5).

**`grading-rule-set`** (artifact content, `artifactType` `d2p:grading-rule-set`; measurement-driven, never scaling, design decisions ADR-011 §5 and ADR-017):

| Member | Req. | Type / rule |
|---|---|---|
| `patternRef` | yes | `artifactRef` of the graded pattern revision |
| `mode` | yes | `measurement-driven` \| `point-increment` \| `hybrid` |
| `order` | `mode = hybrid` (schema) | `["measurement-driven", "point-increment"]` or the reverse |
| `sizeSystemRef` | when any rule names a `sizeKey` (D2P-SEM-080) | `artifactRef` |
| `baseSizeKey` | when any `point-increment` rule exists (D2P-SEM-080) | elementId |
| `rules` | yes | `[gradingRule]`, discriminated by `kind`: `measurement-source` `{id, kind, measurementKey, source: "size-entry" \| "body-profile"}`; `parameter-override` `{id, kind, parameterId, bySize: [sizeExpr: {sizeKey, expr}]}`; `point-increment` `{id, kind, pointFeatureId, increments: [pointIncrement: {sizeKey, dxMm, dyMm}]}` |
| `identityEffects` | no | `[lineageEntry]` (from `core/revision`) declaring the element identity changes of topology-changing rules (TOP-012) |

There is no `scale` rule kind. Uniform scaling is not expressible.

### 3.3 measurement

This module follows design decision ADR-011.

**`measurement-definition-registry`** (vocabulary). Files live at `vocabularies/measurement-definitions/<local-name>-<version>.json` (§3.0).

| Member | Req. | Type / rule |
|---|---|---|
| `registryId` | yes | `qualifiedName` (the standard registry is `d2p:measurement-definitions`) |
| `version` | yes | semver |
| `definitions` | yes | `[measurementDefinition]`, min 1, sorted by `definitionId` (D2P-REF-014); each `definitionId` once (D2P-REF-005), because a definition is one unique kind of measurement and a duplicate with another meaning would make every resolution ambiguous (MEA-001, MEA-002). For the same reason, two registries used in one resolution context do not define a `definitionId` differently (D2P-REF-015) |

`measurementDefinition` (closed):

- **`definitionId`**: `qualifiedName`, `d2p:body.*` or `d2p:garment.*` in the standard registry.
- **`kind`**: `body` \| `garment`.
- **`dimension`**: `length` \| `angle`.
- **`unit`**: `mm` \| `rad`, the canonical unit of the dimension: `mm` for `length`, `rad` for `angle` (D2P-SEM-070, checked on the registry document).
- **`path`**: `{type: "girth" | "length" | "width" | "flat-width" | "height" | "depth" | "arc", description}`.
- **`landmarks`**: `[string]`, min 1.
- **`posture`**: extensible: `d2p:standing-relaxed`.
- **`state`**: extensible; body: `d2p:minimal-clothing`; garment: `d2p:flat-relaxed`, `d2p:on-form`.
- **`description`**, **`status`** (`active` \| `deprecated`), `supersededBy`, `mappings` (`[definitionMapping: {system, systemVersion, provenance, term?, note?}]`, informative; `systemVersion` names the edition of the external system, `provenance` is `core/extension.schema.json#/$defs/provenance`; no copied normative text or tables).

**Definition versioning.** A definition's meaning never changes, and a changed meaning requires a new `definitionId`. The per-definition version of design decision ADR-011 §4 is therefore fulfilled by the pair (immutable `definitionId`, pinned registry `version`): a registry version change can only touch editorial text, status and mappings. Definitions carry no separate `version` member.

**`measurement-value`** (fragment, root `measurementValue`, closed):

- **`definitionId`**.
- **`value`**: number.
- **`unit`**: `mm` \| `rad`. It must match the definition's dimension (D2P-SEM-070).
- **`method`**: `manual` \| `scan` \| `inferred` \| `size-table`.
- **`source`**: `{kind: "self-measured" | "professional" | "device" | "size-table" | "synthetic" | "derived", description?}`.
- `measuredAt`: timestamp.
- `uncertainty`: `{type: "symmetric", plusMinus ≥ 0}` \| `{type: "interval", lower, upper}`, discriminated by `type` (schema).

No value is ever replaced silently by a size-table value.

| Document | Members (req. in **bold**) | Rules |
|---|---|---|
| `body-measurement-profile` | **`subject`** (`{kind: "individual" \| "reference-figure" \| "synthetic", pseudonym?}`; never a real name), **`dataClassification`**, **`definitionRegistries`**, **`measurements`** [measurementValue] (may be incomplete, MEA-004) | `individual` ⇒ `personal` or `sensitive-personal` (D2P-SEM-051). Values of `personal`/`sensitive-personal` profiles never enter exports (D2P-SEM-050). Values use `kind: body` definitions (D2P-SEM-075), at most one value per `definitionId` (D2P-REF-005) |
| `size-system` | **`name`**, **`issuer`** (`{kind: "market" \| "norm" \| "brand" \| "synthetic", name}`), **`definitionRegistries`**, **`sizes`** [sizeEntry: `{sizeKey, label, ordinal: integer, measurements: [measurementValue]}`] (min 1) | A size is resolvable only as `sizeSystemRef` + `sizeKey` (MEA-003). A label alone is never a reference. Size-entry values use `kind: body` definitions (D2P-SEM-075), at most one value per `definitionId` within one size entry (D2P-REF-005) |
| `garment-measurement-spec` | **`name`**, **`definitionRegistries`**, **`targets`** [measurementTarget: `{id, definitionId, value, unit, tolerance?: {minus ≥ 0, plus ≥ 0} (in `unit`), sizeKey?, configurationKey?}`] (min 1), `patternRef`, `sizeSystemRef` | Target definitions are `kind: garment` (D2P-SEM-075). A target `sizeKey` requires the document-level `sizeSystemRef` (D2P-REF-009, not schema-enforced) |
| `fit-profile` | **`name`**, **`intent`** (extensible: `d2p:fitted`, `d2p:regular`, `d2p:relaxed`, `d2p:oversized`), **`definitionRegistries`**, **`easeRules`** [easeRule], `fitTargets` [fitTarget], `materialAssumptions`, `sizeSystemRef` (required when any `scope.sizeKeys` is used, D2P-REF-009) | — |
| `fit-evaluation-report` | **`reportId`**, **`createdAt`**, **`evaluationRef`** (`derivedRef` to a `pattern-evaluation`, `digest` **required**), **`evaluator`** (`evaluatorDescriptor`), **`inputDigests`** [inputDigest] (min 1; roles `pattern`, `fit-profile` and `garment-measurement-spec` mandatory), **`evidenceKind`** (`analytical` \| `simulation` \| `fitting-observation`, design decision ADR-011 §7), **`results`** [fitResult: `{id, garmentDefinitionId, predicted: quantity, target?: quantity, deviation?: quantity, status: "within-tolerance" \| "outside-tolerance" \| "not-evaluated"}`], **`containsPersonalData`** (boolean), **`diagnostics`** [diagnostic], **`resultDigest`** | It never claims a guaranteed fit. Every artifact input digest names a (`role`, `artifactId`, `revisionId`) that the evaluation at `evaluationRef` pins (D2P-REF-007; design decision ADR-011 §3, FIT-003: no implicit pull of other revisions). Order per §1.8 |

`easeRule` (closed): **`id`**, **`bodyDefinitionId`**, **`garmentDefinitionId`** (path types must match, D2P-SEM-071; `bodyDefinitionId` is `kind: body` and `garmentDefinitionId` is `kind: garment`, D2P-SEM-075), **`easeType`** (`wearing` \| `design` \| `functional`), **`amount`** (quantity; unit per the definitions' dimension, D2P-SEM-070), **`priority`** (integer ≥ 0; 0 is the highest priority), `scope` (easeScope: `{sizeKeys?: [elementId], zones?: [qualifiedName]}`, at least one member; `zones` is extensible: `d2p:chest`, `d2p:waist`, `d2p:hip`, `d2p:shoulder`, `d2p:upper-arm`; absent `scope` means the rule applies to all sizes and zones), `materialCondition` (`{materialClasses: [materialClass], minStretchRatio?: ratio}`). Negative ease needs a stretch condition (D2P-SEM-073). An ease amount given as an expression is not part of 1.0 (§5).

**Ease rule applicability** (design decision ADR-011 §6, FIT-002). For an evaluation request with a `fitProfileRef`, an ease rule applies if and only if all of the following hold:

1. its `scope.sizeKeys` is absent, or the request has no `sizeKey`, or it contains the request's `sizeKey` (`zones` select where the rule acts, not whether it applies);
2. its `materialCondition` is absent, or the condition is **met**: the request states `materialAssumptions`, `materialAssumptions.materialClass` is listed in `materialClasses`, and, when `minStretchRatio` is present, `materialAssumptions.stretch` is present and both its `lengthwise` and `crosswise` values are at least `minStretchRatio`. (1.0 does not model the stretch direction an ease zone needs, so both directions are required.)

A rule that does not apply is skipped. It never falls back to another material, and its amount is never applied partially. For a negative-ease rule that fails only condition 2, the skip is reported as D2P-SEM-074 on the request, so negative ease is never approved, or silently dropped, for an incompatible material. `stretch` values are declared, not tested (see `materialAssumptions` below).

`fitTarget` (closed; design decision ADR-011 §2 "prioritised fit goals"): **`id`**, **`garmentDefinitionId`** (`kind: garment`, D2P-SEM-075), **`comparison`** (`min` \| `max` \| `range`), `min` (quantity), `max` (quantity), **`priority`** (integer ≥ 0; 0 is the highest priority), `scope` (easeScope). `min`/`max` presence by `comparison` is schema-enforced (§1.12).

`materialAssumptions` (`fit-profile.schema.json#/$defs/materialAssumptions`, reused by `eval`): **`materialClass`** (`woven` \| `knit` \| `nonwoven`), `stretch` (`{lengthwise: ratio, crosswise: ratio}`, declared, not tested), `description`. References to material artifacts are not part of 1.0 (§5).

### 3.4 eval

This module follows design decisions ADR-006, ADR-011 §3 and ADR-017.

**`evaluation-request`**

| Member | Req. | Type / rule |
|---|---|---|
| `requestId` | yes | `evaluationRequestId` |
| `patternRef` | yes | `artifactRef` |
| `evaluatorProfile` | yes | `versionedId` (informative, not digested) |
| `gradingRuleSetRef`, `sizeSystemRef`, `bodyMeasurementProfileRef`, `fitProfileRef`, `garmentMeasurementSpecRef` | no | `artifactRef` |
| `sizeKey` | no | elementId. It requires `sizeSystemRef` (`dependentRequired`) |
| `configurationKey` | no | elementId (names the material/fit configuration; declared by a fixture manifest's `configurations` inside fixtures) |
| `materialAssumptions` | no | `materialAssumptions` |
| `toleranceProfile` | no | `versionedId` |
| `validationProfile` | when `requestedOutputs` contains `validation-report` (schema) | `versionedId` of a validation profile |
| `requestedOutputs` | yes | `[requestedOutput]`, min 1, `uniqueItems`; values `geometry-snapshot`, `measurement-report`, `fit-evaluation-report`, `validation-report`. `fit-evaluation-report` requires `fitProfileRef` and `garmentMeasurementSpecRef` (schema) |

Individual measurement values are never inlined: they are referenced, and each reference is authorized individually by the implementation.

**Requested outputs.** `geometry-snapshot`: a `geometry-snapshot` document (always produced on `status: succeeded`). `measurement-report`: the evaluation's `measurements` member contains one entry per target of the referenced garment measurement spec that applies to the request's `sizeKey` and `configurationKey` (a target without `sizeKey`/`configurationKey` applies to all), with `key` = the target `id`; without `measurement-report`, or without a garment measurement spec, `measurements` is `[]`. `fit-evaluation-report`: a `fit-evaluation-report` whose `evaluationRef` is the evaluation. `validation-report`: a `validation-report` against `validationProfile`.

**Measurement input resolution.** For each measurement input of the pattern: if `gradingRuleSetRef` is given, its `measurement-source` rule for the input's `key` decides the source; otherwise the value is taken from the size entry (`sizeSystemRef` + `sizeKey`) with the input's `definitionId`, and if there is none, from the body measurement profile. If no value is found, the input's `fallback` is used (D2P-EVL-011); a `required` input without value and fallback is D2P-SEM-072.

**`pattern-evaluation`** (derived; `resultDigest` per §1.8)

| Member | Req. | Type / rule |
|---|---|---|
| `evaluationId` | yes | `evaluationId` |
| `createdAt` | no | timestamp |
| `request` | yes | the full `evaluation-request` document (embedded, §1.2) |
| `evaluator` | yes | `evaluatorDescriptor` (`core/ids.schema.json#/$defs/evaluatorDescriptor`, also used by `geometry-snapshot`, `fit-evaluation-report` and `validation-report`): `{engineId: string 1..128, engineVersion: string, algorithmProfileVersion: string, evaluatorProfile: versionedId, precision?: evaluatorPrecision {linearToleranceMm, angularToleranceRad, curveApproximationToleranceMm, solverTolerance, maxIterations}}`. `precision` is mandatory for evaluator implementations and MAY be omitted only in analytically computed fixture files |
| `featureSetVersion` | yes | semver |
| `inputDigests` | yes | `[inputDigest]`, min 1 (role `pattern` mandatory). The artifact entries are exactly the revisions the embedded request pins: one entry per pinned reference, with the role of that reference (`patternRef` → `pattern`, `gradingRuleSetRef` → `grading-rule-set`, `sizeSystemRef` → `size-system`, `bodyMeasurementProfileRef` → `body-measurement-profile`, `fitProfileRef` → `fit-profile`, `garmentMeasurementSpecRef` → `garment-measurement-spec`) and the same `(artifactId, revisionId)`, and no other artifact entry (D2P-REF-007). Design decisions ADR-006 and ADR-011 §3: an evaluation records exactly the pinned inputs it used |
| `status` | yes | `succeeded` \| `failed` |
| `constraintStatus` | yes | `constraintStatus` (`$defs` here): `solved` \| `underconstrained` \| `overconstrained` \| `inconsistent` \| `nonconvergent`. A pattern without constraints is `solved`. `status = succeeded` requires `solved` (schema). Mapping of common solver vocabularies: unique → `solved`, timeout → `nonconvergent`, generic failure → `status: failed` plus the closest status and a diagnostic, never `solved` |
| `snapshotRef` | if and only if `status = succeeded` (schema) | `derivedRef` (`digest` required; = the snapshot's `geometryDigest`) |
| `measurements` | yes | `[evaluationMeasurement: {key: elementId, definitionId?, value, unit}]` (see requested outputs) |
| `diagnostics` | yes | `[diagnostic]` |
| `resultDigest` | yes | digest |

**`geometry-snapshot`** (derived; read-only portable fallback, design decision ADR-006.2)

| Member | Req. | Type / rule |
|---|---|---|
| `snapshotId` | yes | `snapshotId` |
| `createdAt` | no | timestamp |
| `patternRef` | yes | `artifactRef` |
| `evaluationId` | no | `evaluationId` (informative) |
| `sizeKey`, `configurationKey` | no | elementId. `sizeKey` resolves in the size system named by the `size-system` input digest, which is then required (D2P-REF-009); a size key alone is never a reference (MEA-003) |
| `evaluator` | yes | `evaluatorDescriptor` |
| `featureSetVersion` | yes | semver |
| `inputDigests` | yes | `[inputDigest]`, min 1 (role `pattern` mandatory, schema); the `pattern` entry's `artifactRef` equals `patternRef` (D2P-REF-007) |
| `units` | yes | `unitsDeclaration` |
| `pieces` | yes | `[snapshotPiece]`: `{pieceId, contours: [contourPath], notches: [snapshotNotch: {notchId, edgeId, point: point2, angleRad}], grainlines: [snapshotGrainline: {grainlineId, start: point2, end: point2}], folds: [snapshotFold: {foldId, edgeId}], boundingBox, areaMm2}` (all members required; empty arrays written as `[]`) |
| `interfaces` | yes | `[snapshotInterface: {seamInterfaceId, cutInstanceKey?, lengthMm}]` |
| `seams` | yes | `[snapshotSeam: {seamConnectionId, lengthAMm, lengthBMm, declaredEaseMm, deviationMm}]`. `deviationMm = lengthAMm − lengthBMm − declaredEaseMm` (`declaredEaseMm` is 0 when the ease mode is `none`) |
| `extensionEvaluators` | no | `[extensionEvaluatorUse: {featureType, evaluator: versionedId}]` used to produce the snapshot |
| `diagnostics` | yes | `[diagnostic]` |
| `geometryDigest` | yes | digest (§1.8) |

Geometry `$defs` (here, reused by `print`):

- `point2`: `[x, y]`, `prefixItems` of 2 numbers, `items: false`, `minItems: 2`.
- `segment` (snapshot): `oneOf` `lineSegment` `{kind: "line", edgeId, end}`, `arcSegment` `{kind: "arc", edgeId, end, center: point2, direction: "ccw" | "cw"}`, `cubicSegment` `{kind: "cubic", edgeId, control1, control2, end}`; all members required, closed.
- `pathSegment` (print paths): the same three shapes without `edgeId` (`linePathSegment`, `arcPathSegment`, `cubicPathSegment`).
- `contourPath`: `{contourId, role, start: point2, segments: [segment] (min 1)}`. Closure: the last `end` equals `start` exactly after quantization (D2P-SEM-010).
- `boundingBox`: `{min: point2, max: point2}`.

**Snapshot generation rules** (so that independent producers write the same geometry):

1. One `contourPath` per contour. `start` is the start point of the contour's first edge, in edge direction.
2. One segment per edge, in contour order, with `edgeId` = that edge. The segment kind equals the curve type (`d2p:line` → `line`, `d2p:arc` → `arc`, `d2p:bezier.cubic` → `cubic`). For a `reversed` edge the segment runs from the curve's end to its start: `end` is the curve start; a cubic writes `control1` = the curve's `control2` and `control2` = the curve's `control1`; an arc keeps its `center` and flips `direction` (`ccw` ↔ `cw`).
3. An edge whose curve is an extension type is written as one or more `line`, `arc` or `cubic` segments with the same `edgeId`, approximating the curve within `curveApproximationToleranceMm`.
4. A notch `point` is the point at normalized arc length `position` along the edge direction. `angleRad` is the direction of the edge tangent at that point, in edge direction, measured counter-clockwise from +X and normalized to (−π, π].
5. `boundingBox` is the axis-aligned box of the exact extrema of all contour curves (not of the control polygon).
6. `areaMm2` is the exact area enclosed by the outer contour minus the areas of the holes (Green's theorem, closed forms for lines, arcs and cubics).
7. `lengthMm` of an interface is the summed arc length of its intervals. Seam lengths are the interface lengths of sides A and B.

**Snapshot completeness** (kernel-free, D2P-SEM-014; design decision ADR-006.2, TOP-009). A snapshot holds the complete topology of the pattern revision at its `patternRef`, so that a read-only fallback never shows a partial or false topology: every piece of the pattern appears exactly once in `pieces`; under it, every contour, notch, grainline and fold of that piece appears exactly once (and no element of another piece); every seam interface appears exactly once in `interfaces`, with the pattern interface's `cutInstanceKey`; every **active** seam connection appears exactly once in `seams`, and an inactive one does not appear. A contour has the pattern contour's `role`, and its segments, read as runs of equal `edgeId`, are exactly the contour's edges in contour order (rules 1-3): an edge whose curve is a `d2p:` curve type has exactly one segment, an extension curve one or more. A notch or fold has the `edgeId` of its pattern element. Whether a segment's kind and coordinates match the curve is geometry and is checked by evaluators.

**Seam arithmetic** (kernel-free, D2P-SEM-024). For every snapshot seam: `deviationMm` = `lengthAMm` − `lengthBMm` − `declaredEaseMm`; `lengthAMm` and `lengthBMm` equal the `lengthMm` of the connection's first and second interface (`interfaceIds[0]`, `interfaceIds[1]`) in the same snapshot (rule 7); `declaredEaseMm` is 0 for ease mode `none` and equals the ease amount when that amount is a constant expression (otherwise it is not checked).

**Numeric comparison of derived values.** Where this catalog compares a computed value with a stated one (seam arithmetic above, scene geometry in §3.7), both sides are quantized (§1.8 step 3) and may differ by at most **two quantization steps** (2e-9 of the canonical unit). This bound absorbs the rounding of already quantized operands and of floating-point rotation; it is a property of the canonical form, not a geometric tolerance, and it is fixed together with the quantization step (§5). Copied values (an interface length used as a seam length) use the same comparison.

A snapshot holds piece geometry in piece coordinates once per piece. Mirrored cut instances are a layout concern (§3.7). Consumers without the extension evaluator MUST display a conforming snapshot read-only and MUST NOT offer editing of the affected pattern (TOP-009).

### 3.5 validation

This module follows design decision ADR-016.

| Document | Members (req. in **bold**) |
|---|---|
| `rule-definition` | **`ruleId`** (qualifiedName), **`version`**, **`title`**, **`description`**, **`layer`** (`schema` \| `domain` \| `derived` \| `contextual` \| `external`), **`targetDocumentTypes`** [qualifiedName], **`defaultSeverity`**, **`diagnosticCodes`** [diagnosticCode] (min 1, `uniqueItems`; full codes, no wildcards or ranges), **`deterministic`** (boolean), **`requiresEvaluator`** (boolean), `requiredCapabilities` [versionedId], `parametersSchema` (open) |
| `profile` | **`profileId`** (qualifiedName), **`version`**, **`purpose`** (`draft-edit` \| `1to1-print` \| `sample-cut` \| `product-release` \| `manufacturing-release` \| `package-publish` \| `import-promote`), **`rules`** [profileRule: `{ruleId, ruleVersion: semver, severity, parameters?}`] (sorted by `ruleId`, D2P-REF-014; each `ruleId` once, D2P-REF-005), **`waiverPolicy`** (`{allowed: boolean, maxSeverity: "warning" \| "error"}`; `critical` is never waivable) |
| `finding` (fragment) | **`findingId`** (elementId), **`ruleId`**, **`ruleVersion`**, **`code`**, **`severity`**, **`message`**, **`elementRefs`** [elementRef] (may be empty; each points into a report `targetRefs` revision), `subjectRef` (`derivedRef`; one of the report's `derivedSubjectRefs`), `instancePath` (JSON Pointer into the subject), **`visibility`** (`general` \| `restricted`), `evidence` (open; `restricted` when it contains protected data), `recommendation` |
| `report` | **`reportId`**, **`createdAt`**, **`targetRefs`** [artifactRef] (min 1), `derivedSubjectRefs` [derivedRef] (derived documents checked by the report, such as evaluations, snapshots, scenes and print jobs), **`purpose`**, **`profile`** (versionedId), **`inputDigests`**, **`status`** (`completed` \| `failed`), **`result`** (`pass` \| `fail`; `pass` if and only if `status = completed` and no finding has severity `error` or `critical`, D2P-SEM-103), **`findings`** [finding], **`resultDigest`**, `evaluator` (evaluatorDescriptor) |
| `gate-evaluation` | **`gateEvaluationId`**, **`evaluatedAt`**, **`action`** (`edit-draft` \| `export-1to1` \| `cut-sample` \| `create-product-release` \| `release-manufacturing` \| `publish-package` \| `promote-import`), **`targetRefs`** [artifactRef] (min 1), **`profile`** (versionedId), **`reportRefs`** [derivedRef] (`digest` required), `evidenceRefs` [derivedRef] (`digest` required; quality evidence bundles, §3.8; omitted when the gate uses no test evidence), **`waiverIds`** [waiverId], **`decision`** (`allow` \| `allow-with-warning` \| `deny` \| `pending-approval`), **`reasonCodes`** [extensible: `d2p:report-missing`, `d2p:report-stale`, `d2p:report-failed`, `d2p:evidence-missing`, `d2p:evidence-not-passed`, `d2p:blocking-findings`, `d2p:warnings-present`, `d2p:approval-required`, `d2p:waived`], **`addressedFindings`** [addressedFinding: `{reportId, findingId}`], **`resultDigest`** |
| `waiver` | **`waiverId`**, **`createdAt`**, **`expiresAt`**, **`targetRefs`** [artifactRef] (min 1), **`action`**, **`reportId`**, **`findingIds`** [elementId] (min 1), **`justification`**, **`approvedBy`** (actor), **`grantId`** (opaque string 1..255: the resource grant authorizing the waiver, design decision ADR-016 §6) |

- **Finding severity.** A finding's `severity` is the `severity` of its rule in the applied profile. It overrides the registry default of §2.4.
- **Report consistency** (D2P-SEM-103; design decision ADR-016 §6: a report records the applied rule and profile version). A report's `purpose` is its profile's `purpose`. Every finding belongs to a rule of the profile (`ruleId`), carries that rule's `ruleVersion` and profile `severity`, and a `code` that the rule definition lists in `diagnosticCodes`. Because the gate procedure decides on `finding.severity`, a finding downgraded below its profile severity is an inconsistent report, never a reason to allow.
- **Finding order and IDs.** Findings are sorted by `ruleId`, `code`, the first `elementRefs` entry (`artifactId`, `revisionId`, `elementId`), the whole `elementRefs` list (canonical form), `subjectRef.id`, `instancePath`, `message`, and finally the canonical form of the finding without `findingId` (§1.8 rules: UTF-16 order, absent keys first). `findingId` = `f-<1-based index>` in that order. Identical pinned inputs therefore yield identical reports apart from the excluded members (VAL-001).
- **Valid waiver.** A waiver `w` applies to finding `f` of report `r` in gate `G` with profile `P` if and only if all of the following hold: `w` is listed in `G.waiverIds`; `w.reportId = r.reportId` and `f.findingId ∈ w.findingIds`; `w.action = G.action`; `w.targetRefs = G.targetRefs` as sets; `w.createdAt ≤ G.evaluatedAt < w.expiresAt`; `P.waiverPolicy.allowed = true`; `f.severity ≤ P.waiverPolicy.maxSeverity` and `f.severity ≠ critical`. A waiver that fails one of the intrinsic conditions is also reported (D2P-SEM-100, D2P-SEM-101); an expired waiver simply does not apply.
- **Validation and test evidence** (design decision ADR-025 §11.4). Domain validation reports (this section) and test or benchmark evidence (`quality-evidence-bundle`, §3.8) stay separate documents; a gate references both, the reports through `reportRefs` and the evidence through `evidenceRefs`. Each evidence bundle named by a gate is collected for that gate: its `gate` equals `G.profile` and its `subjectRefs` equal `G.targetRefs` as sets (D2P-REF-007). Whether a gate needs evidence at all is decided by the implementation's release policy; no 1.0 validation profile requires evidence, so a missing `evidenceRefs` member is not itself a reason to deny in 1.0.
- **Gate decision procedure** (deterministic, D2P-SEM-102). Let `R` be the reports named by `G.reportRefs`, `E` the evidence bundles named by `G.evidenceRefs` (empty when the member is absent) and `P` the profile named by `G.profile`. The steps are evaluated in order, and the first step whose condition holds decides:
  1. `deny` with `d2p:report-missing` if `R` is empty.
  2. `deny` with `d2p:report-stale` if any report in `R` has a `profile` (id or version) different from `G.profile`, a `targetRefs` set different from `G.targetRefs`, or a finding whose `ruleVersion` differs from the `ruleVersion` of its rule in `P` (the referential level reports target differences and newer revisions as D2P-REF-006).
  3. `deny` with `d2p:report-failed` if any report in `R` has `status: failed`.
  4. `deny` with `d2p:evidence-missing` if any bundle in `E` has a `requiredSuites` entry without a `reports` entry of the same `suiteId` and `suiteVersion` (QEV-012: a missing evidence report means the gate is not passed).
  5. `deny` with `d2p:evidence-not-passed` if any bundle in `E` has an `overallState` other than `passed` (`failed` or `inconclusive`; incomplete evidence is never `passed`, §3.8).
  6. `deny` with `d2p:blocking-findings` if any finding of severity `error` or `critical` is not addressed by a valid waiver.
  7. `pending-approval` with `d2p:approval-required` if the profile requires approvals (no 1.0 profile does).
  8. `allow-with-warning` with `d2p:warnings-present` if any finding of severity `warning` is not addressed by a valid waiver.
  9. Otherwise `allow`.

  `addressedFindings` lists every finding addressed by a valid waiver (empty when the decision is made in steps 1–5). `reasonCodes` is the sorted set of the deciding step's reason code (none for step 9) plus `d2p:waived` if `addressedFindings` is not empty. A report alone never authorizes an action.
- **Purpose to action mapping:** `draft-edit` ↔ `edit-draft`, `1to1-print` ↔ `export-1to1`, `sample-cut` ↔ `cut-sample`, `product-release` ↔ `create-product-release`, `manufacturing-release` ↔ `release-manufacturing`, `package-publish` ↔ `publish-package`, `import-promote` ↔ `promote-import`. Only the first three purposes have a 1.0 profile. A gate's profile and every report it names have the purpose that maps to the gate's `action` (D2P-SEM-104), so an action is never gated by a profile made for another purpose (for example a 1:1 export by `d2p:sample-cut`, which has no print-calibration or export-privacy rules; design decision ADR-016 §5, VAL-003).
- **Print reports.** A `1to1-print` report has the pattern and its pinned inputs as `targetRefs`, and the evaluation, snapshot, scene and print job it checks as `derivedSubjectRefs`. Findings about derived documents use `subjectRef` and `instancePath`.
- Privacy: findings with `visibility: restricted` MUST NOT include raw personal measurements in `message`. Protected detail goes only into `evidence`.

**Standard vocabulary.** Rule files are `vocabularies/validation/rules/<local-name>-1.0.0.json` and profile files are `vocabularies/validation/profiles/<local-name>-1.0.0.json` (§3.0). All rule and profile versions are `1.0.0`. The profiles are `d2p:draft-edit` (purpose `draft-edit`), `d2p:sample-cut` (purpose `sample-cut`) and `d2p:print-1to1` (purpose `1to1-print`). These are the initial profile contents, not numeric norms. Each code is assigned to exactly one rule; `requiresEvaluator` is `false` for rules whose kernel-free part is checked by the conformance runners (evaluators MAY extend coverage, as noted in the rule's `description`), and `true` for rules that only an evaluator can check. `deterministic` is `true` for every rule.

| Rule (`d2p:` + name) | Layer | Targets | Codes | `requiresEvaluator` | draft-edit | sample-cut | 1to1-print |
|---|---|---|---|---|---|---|---|
| `schema-valid` | schema | all | STR-001, STR-002, STR-003, STR-004, STR-010, STR-011, STR-012 | false | error | error | error |
| `references-resolve` | domain | all | REF-001, REF-002, REF-003, REF-004, REF-005, REF-006, REF-007, REF-009, REF-010, REF-011, REF-012, REF-013, REF-014 | false | error | error | error |
| `feature-graph-acyclic` | domain | pattern | SEM-001 | false | error | error | error |
| `expression-dimensions` | domain | pattern, grading-rule-set | SEM-002, SEM-003 | false | error | error | error |
| `extensions-supported` | domain | all | SEM-005, SEM-006 | false | error | error | error |
| `data-classification-consistent` | contextual | artifact, body-measurement-profile | SEM-051 | false | error | error | error |
| `contour-closed` | domain | pattern, geometry-snapshot | SEM-010 | false | warning | error | error |
| `contour-simple` | derived | pattern, geometry-snapshot, export-scene-2d | SEM-011, SEM-013 | false (line-only part; evaluators extend to curves) | — | error | error |
| `contour-orientation` | derived | geometry-snapshot | SEM-012 | false (line-only part; evaluators extend to curves) | — | error | error |
| `snapshot-consistent` | derived | geometry-snapshot | SEM-014, SEM-024 | false | — | error | error |
| `seam-interface-continuous` | domain | pattern | SEM-020, SEM-021, SEM-022, SEM-025 | false | warning | error | — |
| `seam-interface-single-connection` | domain | pattern | SEM-023 | false | warning | error | — |
| `sewing-group-integrity` | domain | pattern | SEM-030, SEM-031, SEM-032, SEM-033, SEM-034 | false (SEM-034 is reported by importers and editors only) | warning | error | — |
| `constraints-consistent` | domain | pattern | SEM-040 | false | warning | error | error |
| `constraints-solved` | derived | pattern-evaluation | EVL-001, EVL-002, EVL-003 | true | — | error | error |
| `evaluation-succeeded` | derived | pattern-evaluation | EVL-004, EVL-005, EVL-006, EVL-008, EVL-009 | true | — | error | error |
| `grading-consistent` | domain | grading-rule-set | SEM-080 | false | warning | error | error |
| `measurements-complete` | domain | evaluation-request, pattern, size-system, body-measurement-profile, garment-measurement-spec, fit-profile | SEM-070, SEM-072, REF-008, REF-015 | false | — | error | error |
| `measurement-equivalence` | domain | body-measurement-profile, fit-profile, garment-measurement-spec, size-system | SEM-071, SEM-075 | false | — | error | error |
| `measurement-fallback` | derived | pattern-evaluation | EVL-011 | true | — | warning | warning |
| `ease-material-compatible` | domain | evaluation-request, fit-profile | SEM-073, SEM-074 | false | — | warning | warning |
| `seam-length-match` | derived | geometry-snapshot | EVL-010 | true | — | warning | — |
| `print-geometry-valid` | contextual | export-scene-2d | SEM-090, SEM-093, SEM-094, SEM-096 | false | — | — | error |
| `print-calibrated` | contextual | print-job-spec | SEM-091, SEM-092, SEM-095 | false | — | — | critical |
| `no-personal-data-in-export` | contextual | export-scene-2d, print-job-spec | SEM-050 | false | — | — | critical |

Codes are written in full in rule files (`D2P-SEM-001`; the table abbreviates the `D2P-` prefix). The "Targets" column names `documentType`s without the `d2p:` prefix; rule files write them in full. A rule whose Targets are "all" lists every `documentType` of §3.0 in `targetDocumentTypes`. A rule's `defaultSeverity` is the highest registry severity (§2.4) among its codes; it applies only where no profile sets a severity. Codes assigned to no rule: D2P-SEM-004, D2P-SEM-007 and D2P-EVL-007 (they govern editability and fallback display, not gates) and D2P-SEM-100 to D2P-SEM-110, including D2P-SEM-103 and D2P-SEM-104 (they check validation and evidence documents themselves and are covered by the conformance runners).

`waiverPolicy`: draft-edit `{allowed: true, maxSeverity: "error"}`, sample-cut `{allowed: true, maxSeverity: "error"}`, 1to1-print `{allowed: true, maxSeverity: "warning"}`.

### 3.6 command, event, error

This section follows design decision ADR-019.

**`command-envelope`** (`d2p:command`)

| Member | Req. | Type / rule |
|---|---|---|
| `commandId` | yes | `commandId` |
| `idempotencyKey` | yes | `idempotencyKey` |
| `type` | yes | extensible: `d2p:artifact.create`, `d2p:pattern.parameters.update` |
| `target` | yes | `{artifactId, branch: elementId}` (1.0: `branch` is `main`). For `d2p:artifact.create`, `artifactId` is the client-chosen ID of the new artifact |
| `expectedRevisionId` | per `type` (schema) | `revisionId`. Forbidden for `d2p:artifact.create`, required for every other `d2p:` type. Extension command types decide in their payload specification; the schema does not require it for them |
| `payload` | yes | `if`/`then` on `type`: `d2p:artifact.create` → `createArtifactPayload` `{artifactType, name, dataClassification, initialRevisionId: revisionId, content}`, where `artifactType` is one of the six `d2p:` artifact types (closed for this command) and `content` is the complete artifact content document of that type (selected by `if`/`then` on `artifactType`); `d2p:pattern.parameters.update` → `updateParametersPayload` `{updates: [parameterUpdate: {parameterId, expr}]}` (min 1; `expr` uses `pattern/expression.schema.json#/$defs/exprNode`). Payloads of extension types are open objects |
| `actorContext` | yes | `{actorPrincipalId, onBehalfOfPrincipalId?, clientId?, credentialId?}`: opaque IDs, never secrets |
| `correlationId` | no | `correlationId` |
| `issuedAt` | no | timestamp |
| `evaluatorProfile` | no | versionedId |

**Create content IDs.** The `content` header carries `artifactId` = `target.artifactId` and `revisionId` = `payload.initialRevisionId` (D2P-REF-007). Both IDs are proposed by the client. An implementation either commits the first revision under exactly these IDs or rejects the command with error code `conflict`; it never substitutes other IDs silently.

**`command-receipt`**: **`commandId`**, **`status`** (`committed` \| `rejected` \| `accepted-async`), **`revisionRefs`** [artifactRef] (exactly one per affected aggregate when `committed`), `eventCursor` (string 1..255; required when `committed`), `jobId` (required when `accepted-async`), `error` (`error`; required when `rejected`). The conditions are schema-enforced (§1.12).

**`capabilities`** (`d2p:capabilities`; the capability negotiation document):

- **`implementation`**: `softwareInfo`.
- **`standardVersion`**: semver.
- **`capabilities`**: `[versionedId]`.
- **`featureTypes`**: `[versionedId]`.
- **`evaluatorProfiles`**: `[versionedId]`.
- **`conformance`**: `conformanceClaim` `{levels: ["structural" | "referential" | "semantic"], printProfile?: printConformanceClaim {profileId: "d2p:print-v1", levels: ["parse" | "geometry" | "print"]}}`.

Unknown features MUST be answered with error code `unsupported_capability` and a snapshot fallback, never with a silent change of a construction.

**Initial capability versions (1.0):** `d2p:core`, `d2p:pattern`, `d2p:measurement`, `d2p:eval`, `d2p:validation`, `d2p:command`, `d2p:event`, `d2p:error`, `d2p:print`, `d2p:benchmark`, `d2p:feature-set` and `d2p:expression`, all at `1.0.0`, plus `d2p:digest` at `1.0.0` (= `d2p-digest-v1`). Capability versions change with their module's schemas under §1.11.

**`event-envelope`** (`d2p:event`)

| Member | Req. | Type / rule |
|---|---|---|
| `eventId` | yes | `eventId` |
| `aggregateId` | yes | `globalId` (artifact or job) |
| `revisionId` | for `d2p:artifact.revision-committed` (schema) | `revisionId` |
| `eventType` | yes | extensible: `d2p:artifact.revision-committed`, `d2p:job.state-changed`, `d2p:job.progress`, `d2p:job.result-ready`, `d2p:validation.requested`, `d2p:validation.completed`, `d2p:validation.invalidated`, `d2p:impact.reported` |
| `sequence` | yes | integer ≥ 1, strictly increasing without gaps per `aggregateId` stream (order is guaranteed per stream, not globally) |
| `occurredAt` | yes | timestamp |
| `payload` | yes | for `d2p:artifact.revision-committed`: `revisionCommittedPayload` `{artifactRef, parentRevisionIds, commandId?}` (closed). Other 1.0 event types have **open** payloads until a minor release registers them |
| `correlationId` | no | `correlationId` |

Events are delivery and projection data, never write commands. Consumers deduplicate by `eventId`, and a gap in `sequence` requires a resync from a query or snapshot.

**`error`** (fragment, closed):

- **`code`**: `^[a-z][a-z0-9_]*$` from the registry below, or an `extensionName`.
- **`message`**.
- **`correlationId`**.
- **`retryable`**: boolean.
- `details`: open; it MAY hold `diagnostics: [diagnostic]` and MUST NOT hold secrets or raw personal measurements.
- `validationReportRef`: `derivedRef`.

| `code` | retryable | Informative HTTP mapping |
|---|---|---|
| `invalid_request` | false | 400 |
| `schema_violation` | false | 422 |
| `incompatible_schema_version` | false | 422 |
| `unsupported_capability` | false | 422 |
| `validation_failed` | false | 422 |
| `gate_denied` | false | 422 |
| `unauthenticated` | false | 401 |
| `forbidden` | false | 403 |
| `not_found` | false | 404 |
| `stale_revision` | false | 409 |
| `conflict` | false | 409 |
| `idempotency_key_reused` | false | 409 |
| `rate_limited` | true | 429 |
| `unavailable` | true | 503 |
| `internal` | true | 500 |

### 3.7 print

This module follows design decisions ADR-022 and ADR-022.1.

**`export-scene-2d`** (derived; fully materialized 2D geometry, no feature graph)

| Member | Req. | Type / rule |
|---|---|---|
| `sceneId` | yes | `sceneId` |
| `source` | yes | `sceneSource` (closed): `{patternRef, evaluations: [sceneEvaluation: {sizeKey, configurationKey?, evaluationId, geometryDigest}] (min 1), inputRefs?: [artifactRef]}`. Each entry pins the evaluation and snapshot digest of one size (and configuration). Entries are unique by (`sizeKey`, `configurationKey`). `inputRefs` MUST NOT name `personal`/`sensitive-personal` artifacts (D2P-SEM-050) |
| `units` | yes | `unitsDeclaration` |
| `coordinateSystem` | yes | const `{origin: "bottom-left", xAxis: "right", yAxis: "up"}` |
| `layers` | yes | `[layer: {id, role, name}]`, `role` extensible: `d2p:cut-line`, `d2p:seam-line`, `d2p:grainline`, `d2p:notch`, `d2p:fold`, `d2p:label`, `d2p:marker`, `d2p:construction` |
| `seamAllowancePolicy` | yes | `none` (net pattern, cut line = seam line) \| `included` (cut lines materialized as paths). Adapters never invent seam allowance |
| `pieceInstances` | yes | `[pieceInstance: {id, pieceId, cutInstanceKey, sizeKey, transform: instanceTransform {translate: point2, rotateRad, mirror: boolean}, paths: [scenePath: {id, layerId, elementId?, closed: boolean, start: point2, segments: [pathSegment] (min 1)}], markers: [sceneMarker: {id, layerId, kind: "notch" \| "grainline" \| "fold", elementId, points: [point2]}], labels: [sceneLabel: {id, layerId, anchor: point2, text, fontSizeMm?}], boundingBox}]`. Every `sizeKey` appears in `source.evaluations` (D2P-REF-007). Coordinates are in the scene (layout) plane after the transform. `mirror` flips the X axis in piece coordinates before rotation, then translation |
| `lineStyles` | yes | `[lineStyle: {layerId, widthMm (> 0), dashMm?: [positiveLengthMm]}]` |
| `sizeStyles` | when more than one `sizeKey` is used (D2P-SEM-094) | `[sizeStyle: {sizeKey, label, color?: "^#[0-9a-f]{6}$" (sRGB), dashMm?: [positiveLengthMm]}]`: how sizes are told apart in a multi-size scene. A size style overrides `lineStyles` color and dash for the paths of its piece instances |
| `resultDigest` | yes | digest |

**Scene geometry** (kernel-free, D2P-SEM-096; design decision ADR-022 §1, §3: outputs come from the pinned evaluation without duplicating or changing the geometry, and no adapter changes a cut by scaling). For every `sizeKey` of `source.evaluations`, every cut instance of the pattern at `source.patternRef` (declared or implicit, §3.2.2) appears exactly once among the piece instances of that size, with the `pieceId` of its piece and `transform.mirror` equal to the cut instance's `mirrored` (false for an implicit instance). The snapshot of a piece instance is the snapshot of the evaluation in `source.evaluations` with its `sizeKey` (any of them, if several configurations share the size). Paths (the elementId of a path names a contour or edge of the instance's piece in the pattern at `source.patternRef`):

1. Every path on a `d2p:cut-line` or `d2p:seam-line` layer names a contour of the instance's piece by `elementId`.
2. Every path that names a contour or an edge, on any layer, is that snapshot geometry under the instance transform: `start` and every segment point (`end`, `center`, `control1`, `control2`) are the transformed snapshot points, segments in the same order and of the same kind, and an arc's `direction` flips when `mirror` is true. The geometry of an edge is the run of consecutive contour segments with its `edgeId`, starting at the end of the segment before it. The only exception is a path on a `d2p:cut-line` layer with `seamAllowancePolicy: included` (rule 3).
3. With `included`, a cut line is the seam-allowance offset of the contour it names. If the piece declares no `seamAllowance`, the cut line is the contour itself (rule 2 applies), because adapters never invent seam allowance. If it declares one, the kernel-free bounds apply to a line-only contour: the vertex box (box of `start` and segment `end` points) of the cut line contains the transformed vertex box of an `outer` contour and lies inside that of a `hole` contour. This holds for every non-negative width and every join. How far the offset lies from the contour (the width itself) is checked only by an evaluator.
4. A path that names an element which is no contour or edge of the piece is an error. A path without `elementId` is a free path, which is allowed only on a `d2p:construction` layer or a layer with an extension role; grainlines, notches and folds are markers, and text is a label.
5. Every contour of the piece is drawn on a `d2p:cut-line` layer, and with `included` also on a `d2p:seam-line` layer, so the net geometry of every piece is in the scene and compared.

Coordinates are compared per §3.4 (numeric comparison). The check is not applicable when the pattern or the snapshot is not in the bundle.

Every domain element ID is carried through (`pieceId`, `cutInstanceKey`, `elementId` on paths and markers). Orientation is not normative for scene paths: a mirrored instance (`mirror: true`) reverses the orientation of its paths, so an outer contour that is counter-clockwise in the snapshot is clockwise in the scene. Consumers MUST NOT report that as an orientation error (D2P-SEM-012 applies to snapshots only). Labels MUST NOT contain personal measurement values. **Drawing order** is deterministic: renderers draw piece instances in array order and, within an instance, paths, then markers, then labels, each in array order (design decision ADR-022 §5: no random z-order).

**`print-job-spec`** (derived; the only renderer input)

| Member | Req. | Type / rule |
|---|---|---|
| `printJobId` | yes | `printJobId` |
| `scene` | yes | the full `export-scene-2d` document (embedded, §1.2) |
| `outputProfile` | yes | `{profileId, version}`; `profileId` extensible: `d2p:home-print-a4`, `d2p:home-print-a3`, `d2p:plotter-1to1`, `d2p:vector-svg` (definitions below; all at version `1.0.0`) |
| `pageLayout` | yes | `{media: {name: "iso-a4" \| "iso-a3" \| "custom", widthMm, heightMm}, orientation: "portrait" \| "landscape", marginsMm: {top, right, bottom, left} (nonNegative), tiling: {mode: "none" \| "tiled", overlapMm?, registrationMarks: boolean, sheetLabels: boolean}}`. `overlapMm` is required when `mode = tiled` and forbidden when `none` (schema) |
| `scale` | yes | const `1` (no fit-to-page, ever) |
| `calibration` | for `d2p:home-print-*` and `d2p:plotter-1to1` (D2P-SEM-091) | `{controlSquareMm: const 100, placement: "every-sheet" \| "first-sheet"}` |
| `printNotice` | yes | `{text, locale}`. The text MUST instruct printing at 100 % / actual size |
| `conformance` | yes | `{profileId: const "d2p:print-v1", level: "parse" \| "geometry" \| "print"}`: the level the producer claims |
| `provenance` | yes | `{generator: softwareInfo, sceneDigest: digest}` (= the embedded scene's `resultDigest`, D2P-REF-011) |
| `requiredExtensions` | no | `[extensionNamespace]` that a renderer MUST understand (equivalent to `onUnknown: reject`) |
| `resultDigest` | yes | digest |

**Output profiles** (design decision ADR-022 §4). The `d2p:` output profiles are defined here; their version is `1.0.0`. Every profile keeps `scale` 1 and the print notice (schema).

| Profile | Binding properties checked by the semantic level | Further properties (renderer, `print` level) |
|---|---|---|
| `d2p:home-print-a4` | media `iso-a4`; `tiling.mode = tiled` with `overlapMm` > 0; `registrationMarks: true`; `sheetLabels: true`; at least one scene label on a `d2p:label` layer per piece instance, identifying piece and size (D2P-SEM-095); `calibration` (D2P-SEM-091) | tiled PDF at 1:1 |
| `d2p:home-print-a3` | as `d2p:home-print-a4`, with media `iso-a3` | tiled PDF at 1:1 |
| `d2p:plotter-1to1` | `calibration` (D2P-SEM-091) | large-format PDF bound to the stated media; units and bounding box correct; no fit-to-page |
| `d2p:vector-svg` | — | SVG with `viewBox` and explicit physical `width`/`height` in mm; layer and path IDs kept; documented curve approximation |

No numeric overlap or margin value is prescribed: both are stated by the producer, and margins are device facts.

Media and tiling semantics: `widthMm`/`heightMm` are always the **portrait** dimensions, and `orientation` rotates the sheet. The tile grid covers the union of piece-instance bounding boxes. The printable width is the sheet width minus the left and right margins, the horizontal step is the printable width minus `overlapMm` (vertical likewise), and columns = max(1, ceil((layoutWidth − overlapMm) / step)). The grid origin is the top-left corner of the layout box. Sheets are labelled `<row letter><column number>` (A1, A2, …, B1, …), with rows running top to bottom and columns left to right. Printer margins are device facts and MUST be stated, because the standard provides no default.

**Conformance profile `d2p:print-v1`** (levels are cumulative):

| Level | A conforming consumer/renderer MUST |
|---|---|
| `parse` | accept every structurally valid print job of a compatible version, including the embedded scene (structural level, §2.1); reject unknown `requiredExtensions`/`reject` extensions with D2P-SEM-006; ignore or preserve `ignore` extensions |
| `geometry` | in addition, pass the semantic print rules (D2P-SEM-090, D2P-SEM-091, D2P-SEM-092, D2P-SEM-093, D2P-SEM-094, D2P-SEM-096, D2P-SEM-050, D2P-SEM-011 for line-only paths) and reproduce every path exactly as given (no rescaling, no added or removed geometry, no seam allowance invented; only the stated instance transforms), in the stated drawing order |
| `print` | in addition, produce output whose page size equals the media size (PDF: `pt = mm × 72 / 25.4`), with a control square of 100 mm measured in file coordinates within the pinned tolerance profile metric `d2p:control-square-deviation`, the stated overlaps, registration marks and sheet labels, and the print notice on every sheet. For a multi-size scene it draws each size with its `sizeStyles` entry and prints a legend of the size labels. Sheet furniture is placed as stated below the table; scene `labels` are drawn as given, and keeping them clear of cut and seam lines is the producer's responsibility. Physical print accuracy additionally depends on the printer and is out of scope |

**Placement of sheet furniture** (`print` level). Sheet labels, the print notice, the legend and control squares are drawn inside the printable area of a sheet. They MUST NOT cross or cover any path on a `d2p:cut-line` or `d2p:seam-line` layer, any marker, or any scene label drawn on that sheet. They MAY lie inside a piece-instance bounding box, on the piece interior, so a sheet whose printable area lies entirely inside a piece needs no special treatment: such a sheet holds no cut or seam line of that piece. Each sheet carries its sheet label and the print notice. With `calibration.placement = every-sheet`, every sheet carries a control square; with `first-sheet`, the first sheet in grid order (A1) carries it, and the legend of a multi-size scene is on that sheet. If a sheet offers no free position for an item, the item for that sheet is printed on an additional information sheet appended after the grid, which carries no pattern geometry, is labelled `INFO` and names the sheet label each item belongs to; a renderer never moves furniture onto cut or seam lines and never omits it silently.

Unknown extensions in print jobs follow §1.7. A renderer that ignores an `ignore` extension MUST still render the baseline geometry unchanged.

### 3.8 benchmark

This module follows design decisions ADR-017.1 and ADR-025.

- `resultState` (`test-run-report.schema.json#/$defs/resultState`): `passed` \| `failed` \| `inconclusive` \| `skipped`. These are the same values as the tooling's `RESULT_STATES`.
- `benchmarkUnit` (`$defs` there): `mm` \| `rad` \| `1` \| `ms` \| `byte` \| `count`.
- `subjectKind` (`$defs` there): `evaluator` (geometry, constraint or evaluation backend) \| `renderer` \| `validator` \| `other`.
- `backendPin` (`$defs` there): `{backendId, backendVersion, adapterVersion}`, all required strings 1..128 (design decision ADR-017.1 §10). An implementation without a separate adapter states its own version as `adapterVersion`.
- `measurementProvenance` (`$defs` there): `{method: string 1..200, toolVersion?: string}`: how a measured value was obtained.
- `runProvenance` (`$defs` there): `{producer: softwareInfo, sourceRevision?: string 1..200, notes?: string}`: who produced the report and from which source revision of the implementation.

| Document | Members (req. in **bold**) |
|---|---|
| `test-run-report` | **`reportId`** (`trr_`), **`suiteId`** (qualifiedName), **`suiteVersion`**, **`subjectKind`**, **`fixture`** (`fixturePin`: `{fixtureId, fixtureVersion, fixtureDigest}`), **`implementation`** (`softwareInfo`), **`executionEnvironment`** (`{os, arch, runtime?, buildFlags?, hardware?}`), **`toleranceProfile`** (versionedId), **`testRunnerVersion`**, **`startedAt`**, **`durationMs`** (≥ 0), **`resultState`**, **`measurements`** [runMeasurement: `{id, metric: toleranceMetric, value, unit: benchmarkUnit, limit?, state: resultState, provenance: measurementProvenance}`], **`findings`** [diagnostic], `skipReason` (required if `skipped`, schema), `backend` (`backendPin`; required when `subjectKind = evaluator`, schema), `evaluatorProfile` (versionedId; required when `subjectKind = evaluator`, schema), `targetRefs` [artifactRef], `randomSeed` (integer), `provenance` (`runProvenance`), `attachments` [attachment: `{path, mediaType, digest}`], `contentDigest` |
| `benchmark-run` | all `test-run-report` members (listed explicitly, not composed; ID prefix `bmr_`), except that **`backend`** and **`evaluatorProfile`** are always required, plus **`warmupIterations`**, **`repetitions`**, **`operations`** [benchmarkOperation: `{operationId, pieceCount, samples, p50Ms, p95Ms, peakRssBytes, allocations?}`] |
| `quality-evidence-bundle` | **`bundleId`**, **`createdAt`**, **`gate`** (versionedId: the validation profile, ID and version, applied by the gates this evidence is collected for; §3.5), **`subjectRefs`** [artifactRef], **`requiredSuites`** [suitePin: `{suiteId, suiteVersion}`], **`reports`** [evidenceReportEntry: `{reportId, documentType, suiteId, suiteVersion, resultState, contentDigest, backend?: backendPin}`], **`overallState`** (resultState), `contentDigest` |
| `tolerance-profile` | **`profileId`**, **`version`**, **`status`** (`provisional` \| `frozen`), **`scope`** (string), **`tolerances`** [toleranceEntry: `{metric, limit: number ≥ 0, unit: benchmarkUnit, comparison: "absolute-lte" \| "relative-lte"}`] (sorted by `metric`), `notes` |
| `fixture-manifest` | see §4.1 |
| `conformance-case` | **`caseId`** (`^[A-Za-z0-9][A-Za-z0-9.-]*$`), **`level`** (`structural` \| `referential` \| `semantic`), **`title`**, **`documents`** [caseDocument: `{path, role: "subject" \| "context" \| "manifest"}`] (min 1), **`expect`** (`caseExpectation`: `{outcome: "accept" \| "reject", diagnostics: [expectedDiagnostic: {code, documentPath?, instancePath?}], editability?: "editable" \| "read-only"}`), `testIds` [string], `description` |

- **Evidence state rule (D2P-SEM-110).** It is evaluated from the bundle document alone, using the `reports` entries. `overallState` is `failed` if a `requiredSuites` entry has no `reports` entry with the same `suiteId` and `suiteVersion`, or any entry is `failed`. Otherwise it is `inconclusive` if any entry is `inconclusive` or `skipped`. Otherwise it is `passed`. Incomplete evidence is never `passed`. A gate that references the bundle applies the same rule at gate level (§3.5 steps 4 and 5).
- **Comparison rule.** A test run compares only with the fixture whose recomputed digest equals `fixture.fixtureDigest`, and refuses the comparison otherwise (QEV-001). It compares results with the pinned tolerance profile only. Profiles are immutable once `frozen`, and a changed limit is a new version.
- **Tolerance metrics** (extensible; `toleranceMetric` in `tolerance-profile.schema.json`, reused by `runMeasurement.metric`):

| Metric | Unit | Comparison | Meaning |
|---|---|---|---|
| `d2p:contour-deviation` | mm | absolute-lte | Hausdorff distance between expected and actual contour. Control points compare under this metric (a point is a degenerate contour) |
| `d2p:seam-length-deviation-relative` | 1 | relative-lte | \|actual − expected\| / expected |
| `d2p:seam-length-deviation-absolute` | mm | absolute-lte | For short seams. **No value proposed yet** |
| `d2p:control-square-deviation` | mm | absolute-lte | Control-square side in file coordinates vs 100 mm |
| `d2p:angle-deviation` | rad | absolute-lte | Angular difference. **No value proposed yet** |

**Golden tolerance profile** `d2p:golden-tshirt-2d` `1.0.0` lives at `tolerance-profiles/golden-tshirt-2d-1.0.0.json` with **`status: "provisional"`**. Its values are the proposals from the design decisions, not adopted product norms:

- `d2p:contour-deviation` 0.10 mm;
- `d2p:seam-length-deviation-relative` 0.005;
- `d2p:control-square-deviation` 0.1 mm.

Metrics without a proposal are omitted. The profile is set to `frozen` (as a new version if any value changes) by maintainer decision **before** any implementation is compared against it, and it is never adjusted afterwards to fit an implementation.

---

## 4. Golden T-Shirt v1 fixture

The fixture is synthetic: two sizes, two material/fit configurations, front and back pieces, and one sleeve piece cut twice (design decisions ADR-017 §7, ADR-017.1 §4 and ADR-025 §5). Its values are **synthetic test data, not a size table or norm**. Expected results are machine-readable, and reference images are never assertions.

### 4.1 Layout

```text
fixtures/golden-tshirt/v1/
  manifest.json
  inputs/
    project.json
    artifacts/{pattern,grading-rule-set,size-system,fit-profile-regular,fit-profile-relaxed,garment-measurement-spec}.json
    revisions/{pattern,grading-rule-set,size-system,fit-profile-regular,fit-profile-relaxed,garment-measurement-spec}-r1.json
    relationships/project-contains-<artifact>.json          (6)
    pattern-r1.json
    grading-rule-set-r1.json
    size-system-r1.json
    fit-profile-regular-r1.json
    fit-profile-relaxed-r1.json
    garment-measurement-spec-r1.json
    evaluation-requests/r1-<sizeKey>-<configurationKey>.json   (4)
    change/command.json
    change/evaluation-requests/r2-<sizeKey>-regular-woven.json (2)
  expected/
    change/pattern-r2.json
    change/revision-pattern-r2.json
    change/command-receipt.json
    evaluations/<case>.json        (6: 4 × r1, 2 × r2)
    snapshots/<case>.json          (6)
    fit/<case>.json                (4, r1 only)
    validation/<case>.sample-cut.json        (4, r1 only)
    validation/<case>.1to1-print.json        (2)
    validation/gate-<case>.export-1to1.json  (2)
    export/scene-<case>.json                 (2)
    export/print-<case>-a4.json              (2)
  negative/<name>/…                (§4.3)
```

`<case>` = `<rev>-<sizeKey>-<configurationKey>`, with `sizeKey` ∈ {`size-a`, `size-b`} and `configurationKey` ∈ {`regular-woven`, `relaxed-knit`}. The export, print and 1to1-print cases are `r1-size-a-regular-woven` and `r1-size-b-regular-woven`.

| File | Conforms to |
|---|---|
| `manifest.json` | `benchmark/fixture-manifest` |
| `inputs/project.json` | `core/project` |
| `inputs/artifacts/*` | `core/artifact` (all `dataClassification: "public"`) |
| `inputs/revisions/*`, `expected/change/revision-pattern-r2.json` | `core/revision` |
| `inputs/relationships/*` | `core/relationship` (`d2p:contains`, source = project) |
| `inputs/pattern-r1.json`, `expected/change/pattern-r2.json` | `pattern/pattern` |
| `inputs/grading-rule-set-r1.json` | `pattern/grading-rule-set` (`mode: measurement-driven`) |
| `inputs/size-system-r1.json` | `measurement/size-system` (`issuer.kind: synthetic`; values `method: size-table`, `source.kind: synthetic`, with `uncertainty`) |
| `inputs/fit-profile-*-r1.json` | `measurement/fit-profile` |
| `inputs/garment-measurement-spec-r1.json` | `measurement/garment-measurement-spec` |
| `inputs/**/evaluation-requests/*` | `eval/evaluation-request` |
| `inputs/change/command.json` | `command/command-envelope` (`d2p:pattern.parameters.update`, `expectedRevisionId` = pattern r1) |
| `expected/change/command-receipt.json` | `command/command-receipt` (`committed`, `revisionRefs` = [pattern r2], `eventCursor`) |
| `expected/evaluations/*` | `eval/pattern-evaluation` |
| `expected/snapshots/*` | `eval/geometry-snapshot` |
| `expected/fit/*` | `measurement/fit-evaluation-report` (`evidenceKind: analytical`) |
| `expected/validation/*.sample-cut.json`, `*.1to1-print.json` | `validation/report` |
| `expected/validation/gate-*` | `validation/gate-evaluation` (decision `allow`, `reasonCodes: []`, `addressedFindings: []`, `waiverIds: []`; the fixture is built so that both 1to1-print reports have no findings) |
| `expected/export/scene-*` | `print/export-scene-2d` (`seamAllowancePolicy: none`; one `source.evaluations` entry, so no `sizeStyles`) |
| `expected/export/print-*` | `print/print-job-spec` (`d2p:home-print-a4`, tiled, conformance level `geometry`) |

**External files** (listed in `externalFiles` and digested):

- `vocabularies/measurement-definitions/measurement-definitions-1.0.0.json`;
- the rule files of §3.5 used by `d2p:sample-cut` and `d2p:print-1to1`, and these two profile files;
- `tolerance-profiles/golden-tshirt-2d-1.0.0.json`.

**`fixture-manifest`** members:

| Member | Req. | Type / rule |
|---|---|---|
| `fixtureId` | yes | elementId (`golden-tshirt`) |
| `fixtureVersion` | yes | semver (`1.0.0`) |
| `title`, `description` | yes | strings |
| `synthetic` | yes | boolean (`true`) |
| `standardVersion` | yes | semver (`1.0.0`) |
| `digestProfile` | yes | const `d2p-digest-v1` |
| `toleranceProfile` | yes | `tolerancePin`: `{profileId, version, path, digest}` |
| `configurations` | no | `[fixtureConfiguration: {configurationKey, fitProfileRef: artifactRef, materialAssumptions}]`, sorted by `configurationKey`, unique keys. Checked referentially (D2P-REF-013, D2P-REF-007) |
| `changeCase` | no | `changeCase`: `{commandPath (relative to the manifest directory), parameterDeltas: [parameterDelta: {parameterId, deltaMm}] (min 1, sorted by parameterId)}`: the machine-readable change deltas. `deltaMm` = value of the parameter in r2 minus its value in r1, for every size and configuration |
| `files` | yes | `[fixtureFile: {path (relative to the manifest directory), role: "input" \| "expected" \| "negative", documentType, digest}]` sorted by `path` |
| `externalFiles` | yes | `[externalFile: {path (repository-relative), documentType, digest}]` sorted by `path` |
| `review` | yes | `fixtureReview`: `{status: "pending" \| "completed", reviewerRole?, completedAt?, notes?}`: the domain review by a pattern maker or seamstress (QEV-016). It stays `pending` until performed and is never claimed as done |
| `fixtureDigest` | yes | digest (§1.8) |

Two non-object `$defs` of `fixture-manifest` are reused across the `benchmark` module: `relativePath` (a relative POSIX path: no leading `/`, no backslash, no empty, `.` or `..` segment; used by every `path` member of fixture manifests, conformance cases and test-run attachments) and `documentTypeName` (closed `enum` of every `documentType` in §3.0).

**Fixture cases.** `conformance/referential/golden-tshirt/manifest-integrity.case.json` lists `fixtures/golden-tshirt/v1/manifest.json` with role `manifest` and expects `accept`. It checks manifest integrity (D2P-REF-011, D2P-REF-012) and resolves the expanded bundle of `input` and `expected` files plus external files. `conformance/semantic/golden-tshirt/fixture.case.json` lists the same manifest with role `manifest` and expects `accept`, so all semantic rules, including the gate decision procedure, run on the fixture. In the expanded bundle, the r1 and r2 pattern documents have different identity keys (§2.4 D2P-REF-005); the change command is not stale because the r2 revision record carries its `commandId` (D2P-REF-006 (c)); and the r1 gates are not stale because the r2 revision record is created after them (D2P-REF-006 (b), timestamps below).

### 4.2 Minimum content and normative identifiers

- **Pattern r1**:
  - pieces `front`, `back` and `sleeve`, where `sleeve` has `cutInstruction.instances` `sleeve-left` (`mirrored: false`) and `sleeve-right` (`mirrored: true`);
  - front and back are full pieces (not on the fold) with separate left/right shoulder, armhole and side edges, plus neckline and hem;
  - curves use `d2p:line` and `d2p:bezier.cubic`;
  - parameters include `bust-ease` and `sleeve-length` (length);
  - measurement inputs bind the registry definitions listed below;
  - each piece has one grainline and the notches listed below.
- **Seam connections** (10) and **sewing groups** as listed below. Sleeve interfaces carry `cutInstanceKey`.
- **Measurement registry**: the `d2p:body.*` definitions used plus the `d2p:garment.*` definitions for the garment spec. Each definition has its landmarks, path type, posture and state.
- **Change case**: `command.json` updates `bust-ease` and `sleeve-length`; `manifest.changeCase` records the deltas. `pattern-r2` keeps every element ID of r1. The r2 revision record has `parentRevisionIds: [r1]`, `sequence: 2`, `commandId` = the change command's ID and **no** `lineage` member.
- **Expected values**:
  - control points (contour starts, segment ends and controls), notch points and angles, interface lengths and seam lengths per case;
  - seam allowances are **not** part of v1 expected results (§5: known deviation).
- **Constraints**: `constraintStatus: solved` for every case. Expected files MAY omit `evaluator.precision` (analytic computation) and state `evaluator.engineId: "golden-fixture"`.

The identifiers below are normative, so that independently written fixture files fit together. "Left" and "right" are the wearer's sides. Values marked *synthetic* are test data chosen for the fixture, not norms.

| Item | Identifier(s) |
|---|---|
| Project | `prj_golden-tshirt` |
| Artifacts (`<slug>` ∈ `pattern`, `grading-rule-set`, `size-system`, `fit-profile-regular`, `fit-profile-relaxed`, `garment-measurement-spec`) | `art_golden-tshirt-<slug>` |
| Revisions | `rev_golden-tshirt-<slug>-r1`; pattern r2: `rev_golden-tshirt-pattern-r2` |
| Relationships | `rel_golden-tshirt-contains-<slug>` |
| Principal (all actors) | `{kind: "system", principalId: "prn_golden-fixture"}` |
| Change command | `cmd_golden-tshirt-change-1`, `idempotencyKey` `golden-tshirt-change-1`; receipt `eventCursor` `golden-tshirt-1` |
| Change deltas (*synthetic*) | `bust-ease` +20 mm, `sleeve-length` +30 mm |
| Evaluation requests, evaluations, snapshots, fit reports | `erq_golden-tshirt-<case>`, `pev_golden-tshirt-<case>`, `snp_golden-tshirt-<case>`, `fer_golden-tshirt-<case>` |
| Validation reports, gates | `vrp_golden-tshirt-<case>-sample-cut`, `vrp_golden-tshirt-<case>-print-1to1`, `gte_golden-tshirt-<case>-export-1to1` |
| Scenes, print jobs | `xsc_golden-tshirt-<case>`, `pjs_golden-tshirt-<case>-a4` |
| Evaluator profile (all fixture documents) | `{id: "d2p:golden-fixture-analytic", version: "1.0.0"}` (reserved identifier for analytically computed fixture files; it names no evaluator) |
| Validation profiles | `d2p:sample-cut` `1.0.0` (r1 sample-cut reports), `d2p:print-1to1` `1.0.0` (1to1-print reports and export gates) |
| Tolerance profile | `d2p:golden-tshirt-2d` `1.0.0` |
| Registry | `d2p:measurement-definitions` `1.0.0` |
| Body definitions → pattern measurement input keys | `d2p:body.chest-girth` → `chest-girth`, `d2p:body.waist-girth` → `waist-girth`, `d2p:body.shoulder-width` → `shoulder-width`, `d2p:body.arm-length` → `arm-length` (all `required: true`) |
| Garment definitions | `d2p:garment.chest-girth` (path `girth`), `d2p:garment.chest-width-flat` (path `flat-width`), `d2p:garment.body-length`, `d2p:garment.sleeve-length` |
| Sizes | `size-a` (label `A`, ordinal 1), `size-b` (label `B`, ordinal 2) |
| Configurations (`manifest.configurations`) | `regular-woven` → fit profile regular r1, `materialAssumptions.materialClass: woven`; `relaxed-knit` → fit profile relaxed r1, `materialClass: knit` |
| Ease rules (both fit profiles) | `ease-chest` (`d2p:body.chest-girth` ↔ `d2p:garment.chest-girth`, `wearing`, non-negative *synthetic* amount) |
| Garment targets | `target-chest-girth-<sizeKey>-<configurationKey>`, `target-sleeve-length-<sizeKey>-<configurationKey>` (8) |
| Grading rules | `grade-<key>` (`measurement-source`, `source: size-entry`) for each measurement input key |
| Contours | `front-outer`, `back-outer`, `sleeve-outer` |
| Front edges (contour order, counter-clockwise from the hem) | `front-hem`, `front-side-left`, `front-armhole-left`, `front-shoulder-left`, `front-neckline`, `front-shoulder-right`, `front-armhole-right`, `front-side-right` |
| Back edges (contour order, counter-clockwise from the hem) | `back-hem`, `back-side-right`, `back-armhole-right`, `back-shoulder-right`, `back-neckline`, `back-shoulder-left`, `back-armhole-left`, `back-side-left` |
| Sleeve edges (contour order, counter-clockwise from the hem) | `sleeve-hem`, `sleeve-underarm-back`, `sleeve-cap-back`, `sleeve-cap-front`, `sleeve-underarm-front` |
| Notches (`marks`) | `front-armhole-left-notch`, `front-armhole-right-notch` (1); `back-armhole-left-notch`, `back-armhole-right-notch` (2); `sleeve-cap-front-notch` (1); `sleeve-cap-back-notch` (2) |
| Grainlines | `front-grainline`, `back-grainline`, `sleeve-grainline` |
| Body seam interfaces (one full-edge interval each) | `si-<edgeId>` for every front and back shoulder, side and armhole edge (12), e.g. `si-front-shoulder-left` |
| Sleeve seam interfaces (with `cutInstanceKey`) | `si-sleeve-left-cap-front`, `si-sleeve-left-cap-back`, `si-sleeve-left-underarm-front`, `si-sleeve-left-underarm-back`, and the same four with `sleeve-right` (8) |
| Seam connections (side A, side B) | `seam-shoulder-<side>` (`si-front-shoulder-<side>`, `si-back-shoulder-<side>`); `seam-side-<side>` (`si-front-side-<side>`, `si-back-side-<side>`); `seam-armhole-front-<side>` (`si-front-armhole-<side>`, `si-sleeve-<side>-cap-front`); `seam-armhole-back-<side>` (`si-back-armhole-<side>`, `si-sleeve-<side>-cap-back`); `seam-underarm-<side>` (`si-sleeve-<side>-underarm-front`, `si-sleeve-<side>-underarm-back`), with `<side>` ∈ {`left`, `right`}; all `type: d2p:stitched`, `active: true`; ease mode chosen by the author |
| Sewing groups | `group-armhole-<side>`: `type: d2p:composite-assembly`, members `seam-armhole-front-<side>`, `seam-armhole-back-<side>` (in this order, no roles), `requirements: {groupTopology: connected, validateMemberSeams: true}` |
| Timestamps | r1 records and relationships `2026-01-01T00:00:00Z`; r1 derived documents that have a `createdAt` member (evaluations, snapshots, fit and validation reports; scenes and print jobs have none, §3.7) and gates (`evaluatedAt`) `2026-01-02T00:00:00Z`; command `issuedAt` and r2 revision record `createdAt` `2026-01-03T00:00:00Z`; r2 derived documents `2026-01-04T00:00:00Z` |

Feature, parameter and other element IDs not listed here are chosen by the fixture author and MUST then be kept by every fixture file. The r1 requests name every r1 input artifact, the case's `fitProfileRef` and `materialAssumptions` per `configurations`, `toleranceProfile`, `validationProfile` `d2p:sample-cut` and `requestedOutputs` `["fit-evaluation-report", "geometry-snapshot", "measurement-report", "validation-report"]`. The r2 requests name pattern r2, the size system, the regular fit profile and the woven material assumptions, and **no** `gradingRuleSetRef` and `garmentMeasurementSpecRef` (both pin pattern r1; measurement inputs then resolve from the size entry, §3.4), with `requestedOutputs` `["geometry-snapshot", "measurement-report"]`. Each validation report's `targetRefs` are the artifact revisions pinned by its case's request; the 1to1-print reports additionally list the case's evaluation, snapshot, scene and print job in `derivedSubjectRefs`.

### 4.3 Negative fixtures

Each negative fixture is a directory `negative/<name>/` that holds only the changed documents. Its conformance case lists them as `subject` and the documents needed for resolution as `context`. Cases live at `conformance/<level>/golden-tshirt/<name>.case.json`.

Rules for negative cases:

1. A subject that changes a fixture document keeps that document's identity key (§2.4 D2P-REF-005). The context MUST NOT contain the original it replaces.
2. Every digest inside a subject document is recomputed for the changed content. The context MUST NOT contain a document that pins a changed document by digest (revision records, evaluations, gates, print jobs), unless the negative directory holds a regenerated copy that is then a subject too. An `artifactRef` resolves against the content document alone, so leaving out a revision record is always possible.
3. Apart from 1 and 2, the context SHOULD be the fixture's `input` files plus the external files, and the expected documents the subjects reference. The case MUST be built so that the only lower-level failures are the expected ones (§2.1).

| `<name>` | Subject document(s) | Defect | Level | Expected code | Outcome |
|---|---|---|---|---|---|
| `open-contour` | `pattern.json` | The front outer contour's last edge ends at a point other than the first edge's start | semantic | D2P-SEM-010 | reject |
| `self-intersection` | `geometry-snapshot.json` | A line-only outer contour shaped as a bow-tie | semantic | D2P-SEM-011 | reject |
| `impossible-constraint` | `pattern.json` | Two constant `d2p:constraint.distance` constraints on the same point pair with different values | semantic | D2P-SEM-040 | reject |
| `feature-cycle` | `pattern.json` | `a → b → a` through `…FeatureId` references and a `featureOutput` | semantic | D2P-SEM-001 | reject |
| `unit-mismatch` | `pattern.json` | A parameter `expr` adds `{literal mm}` and `{literal rad}` | semantic | D2P-SEM-002 | reject |
| `forbidden-expression-node` | `pattern.json` | An `expr` contains `{"op": "script", "source": "…"}` | structural | D2P-STR-010 | reject |
| `unknown-extension-feature` | `pattern.json`, `geometry-snapshot.json` | A feature of type `org.example.unknown:smocking` with a capability (`lowering: extension`, `onUnknown: read-only`, `provenance`) and a conforming snapshot | semantic | D2P-SEM-004 | accept, `editability: read-only` |
| `unpinned-reference` | `evaluation-request.json` | `fitProfileRef` without `revisionId` | structural | D2P-STR-011 | reject |
| `unresolvable-reference` | `evaluation-request.json` | `fitProfileRef.revisionId` = `rev_golden-tshirt-fit-profile-regular-r9` (not in the bundle) | referential | D2P-REF-002 | reject |
| `stale-revision` | `gate-evaluation.json`, `validation-report.json` | The gate targets pattern r2, but its report targets r1 (r2 is a child of r1 in the bundle) | referential | D2P-REF-006 | reject |
| `incompatible-schema-version` | `pattern.json` | `schemaVersion: "99.0.0"` | structural | D2P-STR-003 | reject |
| `private-measurement-export` | `body-measurement-profile.json`, `artifact.json`, `export-scene-2d.json` | An individual profile classified `sensitive-personal`, referenced in the scene's `source.inputRefs` | semantic | D2P-SEM-050 | reject |

Every level has at least one negative case. The structural and referential runners also cover the generic codes through the TOP/SWG cases below.

### 4.4 Topology and sewing-group cases

Case data lives next to the case file: `conformance/<level>/topology/<ID>-<slug>/` and `conformance/<level>/sewing-groups/<ID>-<slug>/`. The case file is `<ID>-<slug>.case.json`. Each case carries `testIds: ["<ID>"]`.

| ID | Rule (stated in full in §3.2.5/§3.2.6) | Positive case | Negative case: level → code |
|---|---|---|---|
| TOP-001 | Closed outer contour with 1..n edges | semantic, accept | — |
| TOP-002 | Self-intersecting outer contour fails (line-only snapshot) | — | semantic → D2P-SEM-011 |
| TOP-003 | EdgeInterval chain is ordered and continuous | semantic, accept | semantic → D2P-SEM-020 |
| TOP-004 | A connection references two interfaces of the same pattern | referential, accept | referential → D2P-REF-003 (unknown interface ID). `interfaceIds` are plain local element IDs (§1.5 rule 2) and resolve only inside the connection's own pattern, so a reference to an interface of another pattern is not expressible: the ID of a foreign interface is an unknown local ID and is reported as D2P-REF-003. No separate code exists |
| TOP-010 | An active interface is used by more than one active connection | — | semantic → D2P-SEM-023 |
| SWG-001 | A group of exactly two distinct connections is valid | semantic, accept | — |
| SWG-002 | A group with one member is rejected | — | structural → D2P-STR-001 |
| SWG-003 | A group member names a non-existent connection | — | referential → D2P-REF-003 |
| SWG-004 | A connection with three interfaces is rejected | — | structural → D2P-STR-001 |
| SWG-005 | Two groups claim the same connection | — | semantic → D2P-SEM-031 |
| SWG-006 | A duplicate connection inside one group | — | semantic → D2P-SEM-030 |
| SWG-007 | Disconnected members with `groupTopology: connected` | — | semantic → D2P-SEM-032 |
| SWG-008 | A `cutInstanceKey` in a group's `layerOrder` (or a seam interface) that the pattern does not declare is a reference error | referential, accept | referential → D2P-REF-010 |
| SWG-011 | The same interface is used in two connections | — | semantic → D2P-SEM-023 |

---

## 5. Open points and deferred items (not decided by this catalog)

**Maintainer decisions pending**

- The tolerance values in `d2p:golden-tshirt-2d` are **provisional** until the maintainers freeze them. `d2p:seam-length-deviation-absolute` and `d2p:angle-deviation` have no proposed values.
- The `d2p-digest-v1` quantization step (1e-9 of the canonical unit), and with it the two-step bound for comparing derived values (§3.4), is fixed for 1.0 and needs maintainer confirmation before the first stable tag (`v1.0.0`). Pre-release tags (`v0.x`, see [CHANGELOG.md](../CHANGELOG.md)) MAY be cut before that confirmation; they carry no stability promise.
- Measurement-definition mappings to ISO 8559-1 / ASTM D5219 are informative. Edition and licence must be checked before any mapping is published. The mechanism (`mapping-profile`, §3.1) is part of 1.0; no mapping profile is published yet.
- The fixture's domain review (`review.status`) stays `pending` until it is performed.

**Pending deliverables of release 1.0**

- The domain review of the Golden T-Shirt fixture (QEV-016, `review.status`) is the remaining deliverable that blocks the `v1.0.0` tag. The standard-gap analysis (`specifications/gap-analysis.md`, §3.0, OSS-002) exists; `npm run validate` fails if it is missing.

**Known deviations from the design decisions, to be resolved later**

- Seam allowances and their offsets are not part of the v1 expected results, although design decision ADR-025 §5 asks for offset checks. This is a known deviation. Expected offset results MUST be added (as a new fixture version) before any geometry kernel benchmark compares offsets.
- Darts (design decision ADR-007 §2 lists `Dart` as a piece-level object) are not modelled in 1.0. Rationale: a dart needs a normative lowering to contour edges and expected results, and the first fixture contains no dart. Darts arrive by minor release or as an extension feature type.
- The fabric layer or face of a cut instruction ("Stofflage", design decision ADR-007 §2) is not modelled in 1.0; it arrives as an optional `cutInstruction` member by minor release.
- The `d2p:sample-cut` profile covers geometric printability, but not the second minimum that design decision ADR-016 §5 lists for cutting a sample: an explicit pattern status. Standard 1.0 has no pattern or sample status member (draft, approved for sample, …) and therefore no rule that checks it; an implementation that gates `cut-sample` MUST check the status in its own release policy. A status member and a matching rule are planned for a later minor release.
- A rule requiring grainlines on production-ready woven pieces (design decision ADR-007 §2) is not part of the 1.0 profiles, because the material class is known only from the evaluation request, not from the pattern. It is planned together with a `product-release` profile.
- Ease amounts given as expressions (design decision ADR-011 §6) are not supported; `easeRule.amount` is a quantity. Expressions would make the `measurement` module depend on the `pattern` module's expression language.
- Declarative lowering (design decision ADR-006.2) has no normative decomposition template in 1.0: `featureCapability.lowersTo` is informative, and a `declarative` feature without an evaluator behaves like an `extension` feature (read-only, D2P-SEM-004; §3.2.6). A template that maps `params` to generated `d2p:` features with derived element IDs arrives by minor release.
- The output-profile properties of `d2p:plotter-1to1` (binding to the configured media) and `d2p:vector-svg` (`viewBox`, physical size, ID preservation, curve approximation) are renderer properties and are not checked by the 1.0 semantic level (§3.7).
- Mapping profiles (design decision ADR-005): standard 1.0 contains only the mechanism, the `d2p:mapping-profile` document (§3.1) with its version, external edition, provenance and term-level relations, validated by `npm run validate` and checked for entry uniqueness and order (D2P-REF-005, D2P-REF-014). Deferred to later minor releases, and not decided here: (1) every concrete mapping profile, including measurement definitions to ISO 8559-1 / ASTM D5219, seam and stitch types to ISO 4916 / ISO 4915, and any garment or textile ontology, each after an edition and licence check; (2) value-level mappings (unit conversion, formulas, landmark translation) beyond term relations; (3) mapping entries for structured content (pieces, seams, sewing groups) rather than vocabulary terms; (4) resolving references through a mapping, which 1.0 forbids (§3.1). Until then, a mapping is informative and never changes how a document validates.
- References from a fit profile to material artifacts (design decision ADR-011 §3) are not possible, because the standard has no material aggregate yet. `materialAssumptions` is the inline substitute.

**Tested against implementations only**

- Seam-allowance geometry, solver behaviour, seam-length matching and the `print` level of `d2p:print-v1` are specified here but are tested against implementations only, not by the 1.0 conformance runners.
