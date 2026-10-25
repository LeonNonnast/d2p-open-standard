#!/usr/bin/env node
// Generates the kit's conformance cases (conformance/<level>/**, except the
// fixture cases in conformance/<level>/golden-tshirt/,
// conformance/<level>/golden-tshirt-3d/ and
// conformance/<level>/golden-tshirt-drape/, catalog §4.1/§4.3/§4.5/§4.6).
// Every digest inside the case data is computed with tools/lib/c14n.mjs, so
// rerun this script after changing the base documents or the schemas.
//
// Usage: node tools/generate-conformance-cases.mjs [output root]
// The output root defaults to the repository root. The test suite generates
// into a temporary directory and requires the committed cases to be identical.
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contentDigestOf, digestOf, geometryDigestOf, resultDigestOf } from "./lib/c14n.mjs";
import { applyPatternEdit, expectedCommandContent } from "./lib/pattern-edit.mjs";

if (process.argv[2]?.startsWith("-")) {
  // No options: the committed cases are checked by `npm test` (test/conformance.test.mjs).
  console.error(`generate-conformance-cases: unknown option ${process.argv[2]}; usage: node tools/generate-conformance-cases.mjs [output root]`);
  process.exit(2);
}
const ROOT = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
/** Case directories owned by the Golden T-Shirt fixtures (2D oracle, 3D and drape generators), never touched here. */
const RESERVED = new Set(["golden-tshirt", "golden-tshirt-3d", "golden-tshirt-drape"]);

const V = "1.0.0";
const REGISTRY = "vocabularies/measurement-definitions/measurement-definitions-1.0.0.json";
const clone = (x) => structuredClone(x);
const lit = (value, unit = "mm") => ({ op: "literal", value, unit });
const ex = (node) => ({ expr: node });
const P = (id) => ({ op: "param", parameterId: id });
const ACTOR = { kind: "system", principalId: "prn_conformance-kit" };
const EVALUATOR = {
  engineId: "conformance-kit",
  engineVersion: "1.0.0",
  algorithmProfileVersion: "1.0.0",
  evaluatorProfile: { id: "org.example.conformance:analytic", version: "1.0.0" },
};
const T1 = "2026-01-01T00:00:00Z";
const T2 = "2026-01-02T00:00:00Z";
const T3 = "2026-01-03T00:00:00Z";

// ---------------------------------------------------------------------------
// Base pattern: front, back (one implicit cut instance each) and a sleeve cut
// twice. All geometry is synthetic test data, not a size table or norm.

const PIECES = [
  { id: "front", prefix: "f", x0: 0, w: "front-width", h: "body-height" },
  { id: "back", prefix: "b", x0: 400, w: "back-width", h: "body-height" },
  { id: "sleeve", prefix: "s", x0: 800, w: "sleeve-width", h: "sleeve-height" },
];
const PARAM_VALUES = { "front-width": 200, "back-width": 200, "body-height": 300, "sleeve-width": 150, "sleeve-height": 250 };

function rectFeatures({ prefix, x0, w, h }) {
  const line = (id, s, e) => ({ id, type: "d2p:line", params: { startFeatureId: s, endFeatureId: e } });
  return [
    { id: `${prefix}-bl`, type: "d2p:point.absolute", params: { x: ex(lit(x0)), y: ex(lit(0)) } },
    { id: `${prefix}-br`, type: "d2p:point.offset", params: { baseFeatureId: `${prefix}-bl`, dx: ex(P(w)), dy: ex(lit(0)) } },
    { id: `${prefix}-tr`, type: "d2p:point.offset", params: { baseFeatureId: `${prefix}-br`, dx: ex(lit(0)), dy: ex(P(h)) } },
    { id: `${prefix}-tl`, type: "d2p:point.offset", params: { baseFeatureId: `${prefix}-bl`, dx: ex(lit(0)), dy: ex(P(h)) } },
    line(`${prefix}-bottom-curve`, `${prefix}-bl`, `${prefix}-br`),
    line(`${prefix}-right-curve`, `${prefix}-br`, `${prefix}-tr`),
    line(`${prefix}-top-curve`, `${prefix}-tr`, `${prefix}-tl`),
    line(`${prefix}-left-curve`, `${prefix}-tl`, `${prefix}-bl`),
  ];
}

function rectPiece({ id, prefix }) {
  const e = (name, curve) => ({ id: `${id}-${name}`, curveFeatureId: `${prefix}-${curve}-curve`, reversed: false });
  const piece = {
    id,
    name: `${id[0].toUpperCase()}${id.slice(1)} (synthetic)`,
    contours: [{ id: `${id}-outer`, role: "outer", edges: [e("hem", "bottom"), e("side-right", "right"), e("top", "top"), e("side-left", "left")] }],
    grainlines: [{ id: `${id}-grainline`, startFeatureId: `${prefix}-bl`, endFeatureId: `${prefix}-tl` }],
  };
  if (id === "sleeve") {
    piece.cutInstruction = {
      instances: [
        { cutInstanceKey: "sleeve-left", mirrored: false },
        { cutInstanceKey: "sleeve-right", mirrored: true },
      ],
      materialRole: "d2p:main",
    };
  }
  return piece;
}

const full = (edgeId, direction = "forward") => ({ edgeId, from: 0, to: 1, direction });

function basePattern(slug = "square") {
  return {
    documentType: "d2p:pattern",
    schemaVersion: V,
    artifactId: `art_conformance-${slug}`,
    revisionId: `rev_conformance-${slug}-r1`,
    name: "Conformance kit base pattern (synthetic)",
    featureSetVersion: V,
    definitionRegistries: [],
    parameters: Object.entries(PARAM_VALUES).map(([id, value]) => ({ id, dimension: "length", expr: lit(value) })),
    measurementInputs: [],
    features: PIECES.flatMap(rectFeatures),
    pieces: PIECES.map(rectPiece),
    seamInterfaces: [
      { id: "si-front-side-left", segments: [full("front-side-left")] },
      { id: "si-back-side-left", segments: [full("back-side-right", "reverse")] },
      { id: "si-front-side-right", segments: [full("front-side-right")] },
      { id: "si-back-side-right", segments: [full("back-side-left", "reverse")] },
      { id: "si-sleeve-left-underarm-front", cutInstanceKey: "sleeve-left", segments: [full("sleeve-side-left")] },
      { id: "si-sleeve-left-underarm-back", cutInstanceKey: "sleeve-left", segments: [full("sleeve-side-right", "reverse")] },
      { id: "si-sleeve-right-underarm-front", cutInstanceKey: "sleeve-right", segments: [full("sleeve-side-left")] },
      { id: "si-sleeve-right-underarm-back", cutInstanceKey: "sleeve-right", segments: [full("sleeve-side-right", "reverse")] },
    ],
    seamConnections: [
      conn("seam-side-left", "si-front-side-left", "si-back-side-left"),
      conn("seam-side-right", "si-front-side-right", "si-back-side-right"),
      conn("seam-underarm-left", "si-sleeve-left-underarm-front", "si-sleeve-left-underarm-back"),
      conn("seam-underarm-right", "si-sleeve-right-underarm-front", "si-sleeve-right-underarm-back"),
    ],
    sewingGroups: [group("group-sides", ["seam-side-left", "seam-side-right"])],
    featureCapabilities: [],
  };
}

function conn(id, a, b, active = true) {
  return { id, interfaceIds: [a, b], type: "d2p:stitched", active, ease: { mode: "none" } };
}

function group(id, members, topology = "connected") {
  return {
    id,
    type: "d2p:composite-assembly",
    members: members.map((connectionId) => ({ connectionId })),
    requirements: { groupTopology: topology, validateMemberSeams: true },
  };
}

const refOf = (doc) => ({ artifactId: doc.artifactId, revisionId: doc.revisionId });

/** Line-only snapshot of the base pattern (rectangles, counter-clockwise). */
function snapshotOf(pattern, overrides = {}) {
  const pieces = PIECES.map(({ id, x0, w, h }) => {
    const W = PARAM_VALUES[w];
    const H = PARAM_VALUES[h];
    return {
      pieceId: id,
      contours: [
        {
          contourId: `${id}-outer`,
          role: "outer",
          start: [x0, 0],
          segments: [
            { kind: "line", edgeId: `${id}-hem`, end: [x0 + W, 0] },
            { kind: "line", edgeId: `${id}-side-right`, end: [x0 + W, H] },
            { kind: "line", edgeId: `${id}-top`, end: [x0, H] },
            { kind: "line", edgeId: `${id}-side-left`, end: [x0, 0] },
          ],
        },
      ],
      notches: [],
      grainlines: [{ grainlineId: `${id}-grainline`, start: [x0, 0], end: [x0, H] }],
      folds: [],
      boundingBox: { min: [x0, 0], max: [x0 + W, H] },
      areaMm2: W * H,
    };
  }).sort((a, b) => (a.pieceId < b.pieceId ? -1 : 1));
  const H = PARAM_VALUES["body-height"];
  const SH = PARAM_VALUES["sleeve-height"];
  const interfaces = [
    ["si-back-side-left", undefined, H],
    ["si-back-side-right", undefined, H],
    ["si-front-side-left", undefined, H],
    ["si-front-side-right", undefined, H],
    ["si-sleeve-left-underarm-back", "sleeve-left", SH],
    ["si-sleeve-left-underarm-front", "sleeve-left", SH],
    ["si-sleeve-right-underarm-back", "sleeve-right", SH],
    ["si-sleeve-right-underarm-front", "sleeve-right", SH],
  ].map(([seamInterfaceId, cutInstanceKey, lengthMm]) => ({ seamInterfaceId, ...(cutInstanceKey ? { cutInstanceKey } : {}), lengthMm }));
  const seams = [
    ["seam-side-left", H],
    ["seam-side-right", H],
    ["seam-underarm-left", SH],
    ["seam-underarm-right", SH],
  ].map(([seamConnectionId, l]) => ({ seamConnectionId, lengthAMm: l, lengthBMm: l, declaredEaseMm: 0, deviationMm: 0 }));
  const snap = {
    documentType: "d2p:geometry-snapshot",
    schemaVersion: V,
    snapshotId: "snp_conformance-square",
    createdAt: T2,
    patternRef: refOf(pattern),
    evaluator: EVALUATOR,
    featureSetVersion: V,
    inputDigests: [{ role: "pattern", artifactRef: refOf(pattern), digest: contentDigestOf(pattern) }],
    units: { length: "mm", angle: "rad" },
    pieces,
    interfaces,
    seams,
    diagnostics: [],
    ...overrides,
  };
  return finishSnapshot(snap);
}

function finishSnapshot(snap) {
  snap.geometryDigest = geometryDigestOf(snap);
  return snap;
}

function revisionOf(content, { sequence = 1, parents = [], createdAt = T1, commandId } = {}) {
  return {
    documentType: "d2p:revision",
    schemaVersion: V,
    revisionId: content.revisionId,
    artifactId: content.artifactId,
    sequence,
    parentRevisionIds: parents,
    contentDigest: contentDigestOf(content),
    createdAt,
    author: ACTOR,
    ...(commandId ? { commandId } : {}),
  };
}

function artifactOf(content, artifactType, dataClassification = "public") {
  return {
    documentType: "d2p:artifact",
    schemaVersion: V,
    artifactId: content.artifactId,
    artifactType,
    name: `${artifactType} (synthetic)`,
    dataClassification,
  };
}

function withResultDigest(doc, ownId) {
  doc.resultDigest = resultDigestOf(doc, [ownId]);
  return doc;
}

// ---------------------------------------------------------------------------
// Case writer

const written = [];

async function writeJson(rel, value) {
  const abs = path.join(ROOT, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  written.push(rel);
}

/**
 * @param {object} c
 * @param {string} c.level
 * @param {string} [c.group] topology | sewing-groups | pattern-edit
 * @param {string} c.slug
 * @param {string} [c.caseId] defaults to the slug in a group, else <level>.<slug>
 * @param {string} c.title
 * @param {Record<string, object|string>} c.subjects file name -> document
 * @param {Record<string, object|string>} [c.context] file name -> document
 * @param {string[]} [c.external] repository-relative context documents
 * @param {object} c.expect
 */
async function writeCase(c) {
  const base = ["conformance", c.level, ...(c.group ? [c.group] : [])].join("/");
  const dir = `${base}/${c.slug}`;
  const documents = [];
  for (const [name, doc] of Object.entries(c.subjects)) {
    await writeJson(`${dir}/${name}`, doc);
    documents.push({ path: `${dir}/${name}`, role: "subject" });
  }
  for (const [name, doc] of Object.entries(c.context ?? {})) {
    await writeJson(`${dir}/${name}`, doc);
    documents.push({ path: `${dir}/${name}`, role: "context" });
  }
  for (const p of c.external ?? []) documents.push({ path: p, role: "context" });
  for (const p of c.manifests ?? []) documents.push({ path: p, role: "manifest" });
  const expect = {
    outcome: c.expect.outcome,
    diagnostics: (c.expect.diagnostics ?? []).map((d) => ({
      code: d.code,
      ...(d.doc ? { documentPath: `${dir}/${d.doc}` } : {}),
      ...(d.at !== undefined ? { instancePath: d.at } : {}),
    })),
    ...(c.expect.editability ? { editability: c.expect.editability } : {}),
  };
  const testCase = {
    documentType: "d2p:conformance-case",
    schemaVersion: V,
    caseId: c.caseId ?? (c.group ? c.slug : `${c.level}.${c.slug}`),
    level: c.level,
    title: c.title,
    documents,
    expect,
    ...(c.testIds ? { testIds: c.testIds } : {}),
    ...(c.description ? { description: c.description } : {}),
  };
  await writeJson(`${base}/${c.slug}.case.json`, testCase);
}

// ---------------------------------------------------------------------------
// Cases

for (const level of ["structural", "referential", "semantic"]) {
  const dir = path.join(ROOT, "conformance", level);
  let entries = [];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  for (const name of entries) if (!RESERVED.has(name)) await rm(path.join(dir, name), { recursive: true, force: true });
}

const pattern = basePattern();

// ===== structural ==========================================================

await writeCase({
  level: "structural",
  slug: "valid-pattern",
  title: "A schema-valid pattern of a compatible version is accepted",
  subjects: { "pattern.json": pattern },
  expect: { outcome: "accept" },
});

{
  const p = clone(pattern);
  p.parameters[0].expr = { op: "script", source: "return 200;" };
  await writeCase({
    level: "structural",
    slug: "forbidden-expression-node",
    title: "A script node inside an expression is rejected",
    description: "The expression language has a closed node list; any script or code node is a structural error.",
    subjects: { "pattern.json": p },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-STR-010", doc: "pattern.json", at: "/parameters/0/expr" }, { code: "D2P-STR-001", doc: "pattern.json" }] },
  });
}

{
  const request = {
    documentType: "d2p:evaluation-request",
    schemaVersion: V,
    requestId: "erq_conformance-unpinned",
    patternRef: refOf(pattern),
    evaluatorProfile: EVALUATOR.evaluatorProfile,
    fitProfileRef: { artifactId: "art_conformance-fit-profile" },
    garmentMeasurementSpecRef: { artifactId: "art_conformance-garment-spec", revisionId: "rev_conformance-garment-spec-r1" },
    requestedOutputs: ["fit-evaluation-report", "geometry-snapshot"],
  };
  await writeCase({
    level: "structural",
    slug: "unpinned-reference",
    title: "A cross-aggregate reference without a pinned revision is rejected",
    subjects: { "evaluation-request.json": request },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-STR-011", doc: "evaluation-request.json", at: "/fitProfileRef" }, { code: "D2P-STR-001", doc: "evaluation-request.json" }] },
  });
}

{
  const p = clone(pattern);
  p.schemaVersion = "99.0.0";
  await writeCase({
    level: "structural",
    slug: "incompatible-schema-version",
    title: "A document of an incompatible major version is rejected before schema validation",
    subjects: { "pattern.json": p },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-STR-003", doc: "pattern.json", at: "/schemaVersion" }] },
  });
}

{
  const p = clone(pattern);
  p.schemaVersion = "1.1.0";
  await writeCase({
    level: "structural",
    slug: "newer-minor-version",
    title: "A document written against a newer minor release is rejected by a 1.0.0 consumer",
    subjects: { "pattern.json": p },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-STR-003", doc: "pattern.json", at: "/schemaVersion" }] },
  });
}

{
  const p = clone(pattern);
  p.documentType = "d2p:dart";
  await writeCase({
    level: "structural",
    slug: "unknown-document-type",
    title: "An unregistered documentType is rejected",
    subjects: { "pattern.json": p },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-STR-002", doc: "pattern.json", at: "/documentType" }] },
  });
}

{
  const text = `${JSON.stringify(pattern, null, 2).replace('"name": "Conformance kit base pattern (synthetic)",', '"name": "Conformance kit base pattern (synthetic)",\n  "name": "Duplicate member",')}\n`;
  await writeCase({
    level: "structural",
    slug: "duplicate-member-name",
    title: "A document with a duplicate member name is rejected as invalid JSON",
    subjects: { "pattern.json": text },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-STR-004", doc: "pattern.json" }] },
  });
}

{
  const p = clone(pattern);
  p.parameters[0].expr = lit(8, "in");
  await writeCase({
    level: "structural",
    slug: "unit-not-permitted",
    title: "A unit outside the canonical units is rejected",
    description: "Standard 1.0 documents use millimetres and radians only.",
    subjects: { "pattern.json": p },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-STR-012", doc: "pattern.json", at: "/parameters/0/expr/unit" }, { code: "D2P-STR-001", doc: "pattern.json" }] },
  });
}

{
  const p = clone(pattern);
  p.pieces[0].contours[0].role = "outline";
  await writeCase({
    level: "structural",
    slug: "schema-violation",
    title: "A closed enum value outside the schema is rejected",
    subjects: { "pattern.json": p },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-STR-001", doc: "pattern.json" }] },
  });
}

// SWG-002 / SWG-004 (structural)
await writeCase({
  level: "structural",
  group: "sewing-groups",
  slug: "SWG-002-two-member-group",
  title: "A sewing group with two members is structurally valid",
  testIds: ["SWG-002"],
  subjects: { "pattern.json": pattern },
  expect: { outcome: "accept" },
});
{
  const p = clone(pattern);
  p.sewingGroups[0].members = [{ connectionId: "seam-side-left" }];
  await writeCase({
    level: "structural",
    group: "sewing-groups",
    slug: "SWG-002-single-member-group",
    title: "A sewing group with one member is rejected",
    testIds: ["SWG-002"],
    subjects: { "pattern.json": p },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-STR-001", doc: "pattern.json", at: "/sewingGroups/0/members" }] },
  });
}
await writeCase({
  level: "structural",
  group: "sewing-groups",
  slug: "SWG-004-binary-connection",
  title: "A seam connection with exactly two interfaces is structurally valid",
  testIds: ["SWG-004"],
  subjects: { "pattern.json": pattern },
  expect: { outcome: "accept" },
});
{
  const p = clone(pattern);
  p.seamConnections[0].interfaceIds = ["si-front-side-left", "si-back-side-left", "si-front-side-right"];
  await writeCase({
    level: "structural",
    group: "sewing-groups",
    slug: "SWG-004-three-interface-connection",
    title: "A seam connection with three interfaces is rejected",
    testIds: ["SWG-004"],
    subjects: { "pattern.json": p },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-STR-001", doc: "pattern.json", at: "/seamConnections/0/interfaceIds" }] },
  });
}

{
  const snap = snapshotOf(pattern, { inputDigests: [] });
  await writeCase({
    level: "structural",
    slug: "snapshot-without-pattern-input",
    title: "A geometry snapshot whose inputDigests name no pattern is rejected",
    description: "A snapshot records the digests of the inputs its geometry depends on; the pattern entry is mandatory (catalog §3.4).",
    subjects: { "geometry-snapshot.json": snap },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-STR-001", doc: "geometry-snapshot.json", at: "/inputDigests" }] },
  });
}

// ===== referential =========================================================

const sizeSystem = {
  documentType: "d2p:size-system",
  schemaVersion: V,
  artifactId: "art_conformance-size-system",
  revisionId: "rev_conformance-size-system-r1",
  name: "Conformance kit size system (synthetic)",
  issuer: { kind: "synthetic", name: "D2P conformance kit" },
  definitionRegistries: [{ id: "d2p:measurement-definitions", version: "1.0.0" }],
  sizes: [
    { sizeKey: "size-a", label: "A", ordinal: 1, measurements: [mv("d2p:body.chest-girth", 920)] },
    { sizeKey: "size-b", label: "B", ordinal: 2, measurements: [mv("d2p:body.chest-girth", 1000)] },
  ],
};
function mv(definitionId, value, unit = "mm") {
  return { definitionId, value, unit, method: "size-table", source: { kind: "synthetic" } };
}
const fitProfile = {
  documentType: "d2p:fit-profile",
  schemaVersion: V,
  artifactId: "art_conformance-fit-profile",
  revisionId: "rev_conformance-fit-profile-r1",
  name: "Conformance kit fit profile (synthetic)",
  intent: "d2p:regular",
  definitionRegistries: [],
  easeRules: [],
};
const request = {
  documentType: "d2p:evaluation-request",
  schemaVersion: V,
  requestId: "erq_conformance-square-size-a",
  patternRef: refOf(pattern),
  evaluatorProfile: EVALUATOR.evaluatorProfile,
  sizeSystemRef: refOf(sizeSystem),
  fitProfileRef: refOf(fitProfile),
  sizeKey: "size-a",
  requestedOutputs: ["geometry-snapshot"],
};
const resolvingContext = () => ({
  "pattern.json": pattern,
  "size-system.json": sizeSystem,
  "fit-profile.json": fitProfile,
  "revision-pattern-r1.json": revisionOf(pattern),
  "artifact-pattern.json": artifactOf(pattern, "d2p:pattern"),
});

await writeCase({
  level: "referential",
  slug: "resolving-bundle",
  title: "Pinned references, revision records and size keys resolve inside the bundle",
  subjects: { "evaluation-request.json": request },
  context: resolvingContext(),
  external: [REGISTRY],
  expect: { outcome: "accept" },
});

{
  const r = clone(request);
  r.fitProfileRef.revisionId = "rev_conformance-fit-profile-r9";
  await writeCase({
    level: "referential",
    slug: "unresolvable-revision",
    title: "A pinned revision that is not in the bundle is rejected",
    description: "The fit profile artifact is present in revision r1 only; the request pins r9. A different revision is never substituted.",
    subjects: { "evaluation-request.json": r },
    context: resolvingContext(),
    external: [REGISTRY],
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-002", doc: "evaluation-request.json", at: "/fitProfileRef" }] },
  });
}

{
  const r = clone(request);
  r.bodyMeasurementProfileRef = { artifactId: "art_conformance-missing-profile", revisionId: "rev_conformance-missing-profile-r1" };
  await writeCase({
    level: "referential",
    slug: "unresolved-document",
    title: "A reference to an artifact outside the bundle is rejected",
    subjects: { "evaluation-request.json": r },
    context: resolvingContext(),
    external: [REGISTRY],
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-001", doc: "evaluation-request.json", at: "/bodyMeasurementProfileRef" }] },
  });
}

{
  const r = clone(request);
  r.sizeKey = "size-z";
  await writeCase({
    level: "referential",
    slug: "unresolved-size-key",
    title: "A sizeKey that the pinned size system does not define is rejected",
    subjects: { "evaluation-request.json": r },
    context: resolvingContext(),
    external: [REGISTRY],
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-009", doc: "evaluation-request.json", at: "/sizeKey" }] },
  });
}

{
  const ctx = resolvingContext();
  ctx["revision-pattern-r1.json"].contentDigest = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  await writeCase({
    level: "referential",
    slug: "revision-digest-mismatch",
    title: "A revision record whose contentDigest does not match its content document is rejected",
    subjects: { "revision-pattern-r1.json": ctx["revision-pattern-r1.json"] },
    context: { "pattern.json": pattern },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-011", doc: "revision-pattern-r1.json", at: "/contentDigest" }] },
  });
}

{
  const p = clone(pattern);
  p.pieces[1].contours[0].edges[0].id = "front-hem";
  await writeCase({
    level: "referential",
    slug: "duplicate-element-id",
    title: "Two elements of one document with the same ID are rejected",
    subjects: { "pattern.json": p },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-005", doc: "pattern.json", at: "/pieces/1/contours/0/edges/0/id" }] },
  });
}

{
  const p = clone(pattern);
  p.features[4].params.endFeatureId = "f-right-curve";
  await writeCase({
    level: "referential",
    slug: "element-type-mismatch",
    title: "A line whose end point references a curve is rejected",
    subjects: { "pattern.json": p },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-004", doc: "pattern.json", at: "/features/4/params/endFeatureId" }] },
  });
}

{
  const p = clone(pattern);
  p.seamInterfaces[4].cutInstanceKey = "sleeve-middle";
  await writeCase({
    level: "referential",
    slug: "unresolved-cut-instance",
    title: "A seam interface naming an undeclared cut instance is rejected",
    subjects: { "pattern.json": p },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-010", doc: "pattern.json", at: "/seamInterfaces/4/cutInstanceKey" }] },
  });
}

{
  const p = clone(pattern);
  p.definitionRegistries = [{ id: "d2p:measurement-definitions", version: "1.0.0" }];
  p.measurementInputs = [{ key: "inseam", definitionId: "d2p:body.inseam-length", required: false }];
  await writeCase({
    level: "referential",
    slug: "unresolved-measurement-definition",
    title: "A measurement definition the declared registries do not define is rejected",
    subjects: { "pattern.json": p },
    external: [REGISTRY],
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-008", doc: "pattern.json", at: "/measurementInputs/0/definitionId" }] },
  });
}

{
  const s = clone(sizeSystem);
  s.definitionRegistries = [{ id: "d2p:measurement-definitions", version: "1.0.0" }];
  s.sizes[0].measurements.push(mv("d2p:body.chest-girth", 940));
  await writeCase({
    level: "referential",
    slug: "duplicate-measurement-definition",
    title: "A size entry holding two values for the same measurement definition is rejected",
    description: "Measurement input resolution takes the value of the size entry with the input's definitionId (catalog §3.4); two values would make the evaluation ambiguous. definitionId is unique within one size entry and within one body measurement profile (catalog §1.4).",
    subjects: { "size-system.json": s },
    external: [REGISTRY],
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-005", doc: "size-system.json", at: "/sizes/0/measurements/1/definitionId" }] },
  });
}

// Pinned inputs of evaluations and snapshots (catalog §3.4, D2P-REF-007, D2P-REF-009).
{
  const r2 = clone(pattern);
  r2.revisionId = "rev_conformance-square-r2";
  const snapshot = snapshotOf(pattern);
  const req = clone(request);
  const digestOfRef = (doc, role) => ({ role, artifactRef: refOf(doc), digest: contentDigestOf(doc) });
  const evaluationWith = (inputDigests) =>
    withResultDigest(
      {
        documentType: "d2p:pattern-evaluation",
        schemaVersion: V,
        evaluationId: "pev_conformance-square-size-a",
        createdAt: T2,
        request: req,
        evaluator: EVALUATOR,
        featureSetVersion: V,
        inputDigests,
        status: "succeeded",
        constraintStatus: "solved",
        snapshotRef: { id: snapshot.snapshotId, digest: snapshot.geometryDigest },
        measurements: [],
        diagnostics: [],
      },
      "evaluationId",
    );
  const context = {
    "pattern-r1.json": pattern,
    "pattern-r2.json": r2,
    "size-system.json": sizeSystem,
    "fit-profile.json": fitProfile,
    "geometry-snapshot.json": snapshot,
  };
  await writeCase({
    level: "referential",
    slug: "evaluation-inputs-match-request",
    title: "An evaluation whose artifact input digests are exactly the revisions its request pins is accepted",
    subjects: { "pattern-evaluation.json": evaluationWith([digestOfRef(fitProfile, "fit-profile"), digestOfRef(pattern, "pattern"), digestOfRef(sizeSystem, "size-system")]) },
    context,
    external: [REGISTRY],
    expect: { outcome: "accept" },
  });
  await writeCase({
    level: "referential",
    slug: "evaluation-inputs-differ-from-request",
    title: "An evaluation whose input digests name another pattern revision and omit a pinned input is rejected",
    description: "The embedded request pins pattern r1 and a size system; the evaluation claims pattern r2 as its pattern input and records no size-system digest. Each artifact the request pins needs exactly one input digest with the matching role and the same revision (catalog §3.4).",
    subjects: { "pattern-evaluation.json": evaluationWith([digestOfRef(fitProfile, "fit-profile"), digestOfRef(r2, "pattern")]) },
    context,
    external: [REGISTRY],
    expect: {
      outcome: "reject",
      diagnostics: [
        { code: "D2P-REF-007", doc: "pattern-evaluation.json", at: "/inputDigests/1/artifactRef" },
        { code: "D2P-REF-007", doc: "pattern-evaluation.json", at: "/inputDigests" },
      ],
    },
  });
  const withSize = (digests) => snapshotOf(pattern, { sizeKey: "size-a", inputDigests: digests });
  await writeCase({
    level: "referential",
    slug: "snapshot-size-key-resolves",
    title: "A snapshot sizeKey that its size-system input digest defines is accepted",
    subjects: { "geometry-snapshot.json": withSize([digestOfRef(pattern, "pattern"), digestOfRef(sizeSystem, "size-system")]) },
    context: { "pattern.json": pattern, "size-system.json": sizeSystem },
    external: [REGISTRY],
    expect: { outcome: "accept" },
  });
  await writeCase({
    level: "referential",
    slug: "snapshot-size-key-without-size-system",
    title: "A snapshot with a sizeKey but no size-system input digest is rejected",
    description: "A size key alone is no unique reference; the snapshot's sizeKey resolves only in the size system named by its inputDigests.",
    subjects: { "geometry-snapshot.json": withSize([digestOfRef(pattern, "pattern")]) },
    context: { "pattern.json": pattern },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-009", doc: "geometry-snapshot.json", at: "/sizeKey" }] },
  });
  await writeCase({
    level: "referential",
    slug: "snapshot-pattern-input-mismatch",
    title: "A snapshot whose pattern input digest names another revision than its patternRef is rejected",
    subjects: { "geometry-snapshot.json": snapshotOf(pattern, { inputDigests: [digestOfRef(r2, "pattern")] }) },
    context: { "pattern-r1.json": pattern, "pattern-r2.json": r2 },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-007", doc: "geometry-snapshot.json", at: "/inputDigests/0/artifactRef" }] },
  });
}

{
  const r2 = clone(pattern);
  r2.revisionId = "rev_conformance-square-r2";
  const rec1 = revisionOf(pattern);
  const rec2 = revisionOf(r2, { sequence: 3, parents: [pattern.revisionId], createdAt: T3 });
  await writeCase({
    level: "referential",
    slug: "revision-sequence",
    title: "A revision record whose sequence is not max(parent sequence) + 1 is rejected",
    subjects: { "revision-pattern-r2.json": rec2 },
    context: { "pattern-r1.json": pattern, "pattern-r2.json": r2, "revision-pattern-r1.json": rec1 },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-007", doc: "revision-pattern-r2.json", at: "/sequence" }] },
  });
}

// Stale revision (gate and command).
const rule = {
  documentType: "d2p:validation-rule-definition",
  schemaVersion: V,
  ruleId: "org.example.conformance:contour-closed",
  version: "1.0.0",
  title: "Contours are closed (conformance kit rule)",
  description: "Test rule of the conformance kit; it checks D2P-SEM-010.",
  layer: "domain",
  targetDocumentTypes: ["d2p:pattern"],
  defaultSeverity: "error",
  diagnosticCodes: ["D2P-SEM-010"],
  deterministic: true,
  requiresEvaluator: false,
};
const profile = {
  documentType: "d2p:validation-profile",
  schemaVersion: V,
  profileId: "org.example.conformance:sample-cut",
  version: "1.0.0",
  purpose: "sample-cut",
  rules: [{ ruleId: rule.ruleId, ruleVersion: "1.0.0", severity: "error" }],
  waiverPolicy: { allowed: true, maxSeverity: "error" },
};
const profileRef = { id: profile.profileId, version: profile.version };

function reportFor(target, { id = "vrp_conformance-square", findings = [] } = {}) {
  return withResultDigest(
    {
      documentType: "d2p:validation-report",
      schemaVersion: V,
      reportId: id,
      createdAt: T2,
      targetRefs: [refOf(target)],
      purpose: "sample-cut",
      profile: profileRef,
      inputDigests: [{ role: "pattern", artifactRef: refOf(target), digest: contentDigestOf(target) }],
      status: "completed",
      result: findings.some((f) => f.severity === "error" || f.severity === "critical") ? "fail" : "pass",
      findings,
    },
    "reportId",
  );
}

function gateFor(target, reports, { decision = "allow", reasonCodes = [], addressedFindings = [], waiverIds = [], evaluatedAt = T2 } = {}) {
  return withResultDigest(
    {
      documentType: "d2p:gate-evaluation",
      schemaVersion: V,
      gateEvaluationId: "gte_conformance-square",
      evaluatedAt,
      action: "cut-sample",
      targetRefs: [refOf(target)],
      profile: profileRef,
      reportRefs: reports.map((r) => ({ id: r.reportId, digest: resultDigestOf(r, ["reportId"]) })),
      waiverIds,
      decision,
      reasonCodes,
      addressedFindings,
    },
    "gateEvaluationId",
  );
}

{
  const r2 = clone(pattern);
  r2.revisionId = "rev_conformance-square-r2";
  const report = reportFor(pattern);
  const gate = gateFor(r2, [report]);
  await writeCase({
    level: "referential",
    slug: "stale-revision-gate",
    title: "A gate whose report checked an older revision than the gate's target is rejected",
    description: "The gate targets pattern r2, but its validation report targets r1; r2 is a child of r1 in the bundle.",
    subjects: { "gate-evaluation.json": gate, "validation-report.json": report },
    context: {
      "pattern-r1.json": pattern,
      "pattern-r2.json": r2,
      "revision-pattern-r1.json": revisionOf(pattern),
      "revision-pattern-r2.json": revisionOf(r2, { sequence: 2, parents: [pattern.revisionId], createdAt: T1 }),
      "validation-profile.json": profile,
      "validation-rule.json": rule,
    },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-006", doc: "gate-evaluation.json", at: "/reportRefs/0" }] },
  });
}

{
  const r2 = clone(pattern);
  r2.revisionId = "rev_conformance-square-r2";
  const command = {
    documentType: "d2p:command",
    schemaVersion: V,
    commandId: "cmd_conformance-change-2",
    idempotencyKey: "conformance-change-2",
    type: "d2p:pattern.parameters.update",
    target: { artifactId: pattern.artifactId, branch: "main" },
    expectedRevisionId: pattern.revisionId,
    payload: { updates: [{ parameterId: "front-width", expr: lit(210) }] },
    actorContext: { actorPrincipalId: "prn_conformance-kit" },
    issuedAt: T3,
  };
  await writeCase({
    level: "referential",
    slug: "stale-revision-command",
    title: "A command whose expected revision already has a child from another command is stale",
    subjects: { "command.json": command },
    context: {
      "pattern-r1.json": pattern,
      "pattern-r2.json": r2,
      "revision-pattern-r1.json": revisionOf(pattern),
      "revision-pattern-r2.json": revisionOf(r2, { sequence: 2, parents: [pattern.revisionId], createdAt: T2, commandId: "cmd_conformance-change-1" }),
    },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-006", doc: "command.json", at: "/expectedRevisionId" }] },
  });
}

// Manifest integrity (a miniature fixture inside the case data).
async function writeMiniFixture(dir, { unlisted = false, wrongDigest = false } = {}) {
  const tolerance = {
    documentType: "d2p:tolerance-profile",
    schemaVersion: V,
    profileId: "org.example.conformance:mini-fixture",
    version: "1.0.0",
    status: "provisional",
    scope: "Conformance kit miniature fixture (no product tolerance; test data only).",
    tolerances: [{ metric: "d2p:contour-deviation", limit: 0.1, unit: "mm", comparison: "absolute-lte" }],
  };
  await writeJson(`${dir}/tolerance-profile.json`, tolerance);
  const files = [
    { path: "expected/snapshot.json", role: "expected", documentType: "d2p:geometry-snapshot", value: snapshotOf(pattern) },
    { path: "inputs/pattern.json", role: "input", documentType: "d2p:pattern", value: pattern },
  ];
  for (const f of files) await writeJson(`${dir}/fixture/${f.path}`, f.value);
  if (unlisted) await writeJson(`${dir}/fixture/inputs/notes.json`, { note: "not listed in the manifest" });
  const manifest = {
    documentType: "d2p:fixture-manifest",
    schemaVersion: V,
    fixtureId: "conformance-mini",
    fixtureVersion: "1.0.0",
    title: "Conformance kit miniature fixture",
    description: "Synthetic test data for manifest integrity checks; not a norm.",
    synthetic: true,
    standardVersion: V,
    digestProfile: "d2p-digest-v1",
    toleranceProfile: { profileId: tolerance.profileId, version: tolerance.version, path: `${dir}/tolerance-profile.json`, digest: digestOf(tolerance) },
    files: files.map((f) => ({ path: f.path, role: f.role, documentType: f.documentType, digest: digestOf(f.value) })),
    externalFiles: [],
    review: { status: "pending" },
  };
  if (wrongDigest) manifest.files[1].digest = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
  manifest.fixtureDigest = digestOf(manifest, ["fixtureDigest"]);
  await writeJson(`${dir}/fixture/manifest.json`, manifest);
  return `${dir}/fixture/manifest.json`;
}

{
  const dir = "conformance/referential/manifest-integrity";
  await writeCase({
    level: "referential",
    slug: "manifest-integrity",
    title: "A fixture manifest with matching digests and no unlisted files is accepted",
    subjects: {},
    manifests: [await writeMiniFixture(dir)],
    expect: { outcome: "accept" },
  });
  const dir2 = "conformance/referential/manifest-unlisted-file";
  await writeCase({
    level: "referential",
    slug: "manifest-unlisted-file",
    title: "A file inside a fixture directory that the manifest does not list is rejected",
    subjects: {},
    manifests: [await writeMiniFixture(dir2, { unlisted: true })],
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-012" }] },
  });
  const dir3 = "conformance/referential/manifest-digest-mismatch";
  await writeCase({
    level: "referential",
    slug: "manifest-digest-mismatch",
    title: "A manifest file digest that does not match the file is rejected",
    subjects: {},
    manifests: [await writeMiniFixture(dir3, { wrongDigest: true })],
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-011", at: "/files/1/digest" }] },
  });
}

// TOP-004 / SWG-003 (referential)
await writeCase({
  level: "referential",
  group: "topology",
  slug: "TOP-004-connection-interfaces-resolve",
  title: "A seam connection referencing two interfaces of the same pattern resolves",
  testIds: ["TOP-004"],
  subjects: { "pattern.json": pattern },
  expect: { outcome: "accept" },
});
{
  const p = clone(pattern);
  p.seamConnections[1].interfaceIds = ["si-front-side-right", "si-back-side-middle"];
  await writeCase({
    level: "referential",
    group: "topology",
    slug: "TOP-004-unknown-interface",
    title: "A seam connection referencing an unknown interface ID is rejected",
    description: "Interface IDs are local to the pattern, so an interface of another pattern cannot be referenced: its ID is unknown in this pattern and resolves like any unknown ID (D2P-REF-003).",
    testIds: ["TOP-004"],
    subjects: { "pattern.json": p },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-003", doc: "pattern.json", at: "/seamConnections/1/interfaceIds/1" }] },
  });
}
await writeCase({
  level: "referential",
  group: "sewing-groups",
  slug: "SWG-003-members-resolve",
  title: "Sewing group members naming existing connections resolve",
  testIds: ["SWG-003"],
  subjects: { "pattern.json": pattern },
  expect: { outcome: "accept" },
});
{
  const p = clone(pattern);
  p.sewingGroups[0].members[1].connectionId = "seam-shoulder-left";
  await writeCase({
    level: "referential",
    group: "sewing-groups",
    slug: "SWG-003-unknown-member",
    title: "A sewing group member naming a non-existent connection is rejected",
    testIds: ["SWG-003"],
    subjects: { "pattern.json": p },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-003", doc: "pattern.json", at: "/sewingGroups/0/members/1/connectionId" }] },
  });
}
function layeredPattern(layerKeys) {
  const p = clone(pattern);
  p.sewingGroups[0].requirements.multiLayer = true;
  p.sewingGroups[0].layerOrder = layerKeys.map((cutInstanceKey, i) => ({ cutInstanceKey, role: i === 0 ? "d2p:outer-fabric" : "d2p:inner-fabric" }));
  return p;
}
await writeCase({
  level: "referential",
  group: "sewing-groups",
  slug: "SWG-008-layer-cut-instances-resolve",
  title: "A layer order naming declared cut instances resolves",
  testIds: ["SWG-008"],
  subjects: { "pattern.json": layeredPattern(["front", "back"]) },
  expect: { outcome: "accept" },
});
await writeCase({
  level: "referential",
  group: "sewing-groups",
  slug: "SWG-008-unknown-layer-cut-instance",
  title: "A layer order naming an undeclared cut instance is a reference error",
  testIds: ["SWG-008"],
  subjects: { "pattern.json": layeredPattern(["front", "front-lining"]) },
  expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-010", doc: "pattern.json", at: "/sewingGroups/0/layerOrder/1/cutInstanceKey" }] },
});

// ===== semantic ============================================================

await writeCase({
  level: "semantic",
  slug: "valid-pattern",
  title: "A pattern that satisfies every kernel-free domain rule is accepted and editable",
  subjects: { "pattern.json": pattern },
  expect: { outcome: "accept", editability: "editable" },
});

{
  const p = clone(pattern);
  // front-side-left now ends at the top-left point instead of the bottom-left point.
  p.features.push({ id: "f-left-curve-open", type: "d2p:line", params: { startFeatureId: "f-tl", endFeatureId: "f-tr" } });
  p.pieces[0].contours[0].edges[3].curveFeatureId = "f-left-curve-open";
  await writeCase({
    level: "semantic",
    slug: "open-contour",
    title: "An outer contour whose last edge does not end at the first edge's start is rejected",
    subjects: { "pattern.json": p },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-010", doc: "pattern.json", at: "/pieces/0/contours/0" }] },
  });
}

{
  const p = clone(pattern);
  p.features.push({ id: "f-free", type: "d2p:point.free", params: { x: ex(lit(50)), y: ex(lit(50)) } });
  p.features.push({ id: "c-distance-1", type: "d2p:constraint.distance", params: { aFeatureId: "f-bl", bFeatureId: "f-free", value: ex(lit(70)) } });
  p.features.push({ id: "c-distance-2", type: "d2p:constraint.distance", params: { aFeatureId: "f-free", bFeatureId: "f-bl", value: ex({ op: "add", args: [lit(60), lit(20)] }) } });
  await writeCase({
    level: "semantic",
    slug: "impossible-constraint",
    title: "Two constant distance constraints on the same point pair with different values are rejected",
    subjects: { "pattern.json": p },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-040", doc: "pattern.json", at: `/features/${p.features.length - 1}` }] },
  });
}

{
  const p = clone(pattern);
  // f-br is offset from f-bl; make f-bl depend on f-br's x output: f-bl -> f-br -> f-bl.
  p.features[0].params.x = ex({ op: "sub", args: [{ op: "featureOutput", featureId: "f-br", output: "x" }, P("front-width")] });
  await writeCase({
    level: "semantic",
    slug: "feature-cycle",
    title: "A cycle through a FeatureId reference and a featureOutput is rejected",
    subjects: { "pattern.json": p },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-001", doc: "pattern.json" }] },
  });
}

{
  const p = clone(pattern);
  p.parameters[0].expr = { op: "add", args: [lit(200), lit(0.5, "rad")] };
  await writeCase({
    level: "semantic",
    slug: "unit-mismatch",
    title: "Adding a length and an angle is rejected",
    subjects: { "pattern.json": p },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-002", doc: "pattern.json", at: "/parameters/0/expr" }] },
  });
}

{
  const p = clone(pattern);
  p.parameters.push({ id: "sleeve-angle", dimension: "angle", expr: { op: "mul", args: [{ op: "div", args: [{ op: "constant", name: "pi" }, lit(8, "1")] }, lit(1, "rad")] } });
  p.parameters.push({
    id: "cap-rise",
    dimension: "length",
    expr: { op: "mul", args: [P("sleeve-width"), { op: "sin", args: [P("sleeve-angle")] }] },
  });
  await writeCase({
    level: "semantic",
    slug: "consistent-dimensions",
    title: "Expressions mixing lengths, angles and dimensionless factors consistently are accepted",
    subjects: { "pattern.json": p },
    expect: { outcome: "accept" },
  });
}

{
  const p = clone(pattern);
  p.parameters.push({ id: "cap-rise", dimension: "length", expr: { op: "sin", args: [P("sleeve-width")] } });
  await writeCase({
    level: "semantic",
    slug: "slot-dimension-mismatch",
    title: "The sine of a length is rejected",
    subjects: { "pattern.json": p },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-002", doc: "pattern.json", at: "/parameters/5/expr" }] },
  });
}

function extensionPattern(onUnknown, withCapability = true) {
  const p = clone(pattern);
  p.features.push({
    id: "smocking-front",
    type: "org.example.atelier:smocking",
    params: { anchorFeatureId: "f-bl", rows: 6 },
    dependsOn: ["f-bl", "f-br"],
  });
  if (withCapability) {
    p.featureCapabilities = [
      {
        featureType: "org.example.atelier:smocking",
        version: "1.0.0",
        lowering: "extension",
        kind: "other",
        outputs: [],
        onUnknown,
        evaluator: { id: "org.example.atelier:smocking-evaluator", version: "1.0.0" },
        provenance: { publisher: "Example Atelier (fictitious)" },
      },
    ];
  }
  return p;
}

{
  const p = extensionPattern("read-only");
  await writeCase({
    level: "semantic",
    slug: "unknown-extension-feature",
    title: "An unknown extension feature type makes the pattern read-only; its conforming snapshot stays displayable",
    description: "The runner has no extension evaluator. The capability declares onUnknown: read-only, so the case is accepted with a warning and the pattern is not editable.",
    subjects: { "pattern.json": p, "geometry-snapshot.json": snapshotOf(p) },
    expect: { outcome: "accept", diagnostics: [{ code: "D2P-SEM-004", doc: "pattern.json" }], editability: "read-only" },
  });
}


{
  const p = extensionPattern("reject");
  await writeCase({
    level: "structural",
    slug: "feature-capability-reject",
    title: "A feature capability that declares onUnknown: reject is a schema error",
    description: "A missing extension evaluator may restrict editing but never prevents read-only display of a conforming snapshot, so 'read-only' is the only onUnknown value of a feature capability (catalog §1.7). 'reject' exists for extension blocks only.",
    subjects: { "pattern.json": p },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-STR-001", doc: "pattern.json" }] },
  });
}

{
  const p = extensionPattern("read-only", false);
  await writeCase({
    level: "semantic",
    slug: "missing-feature-capability",
    title: "An extension feature type without a matching feature capability is rejected",
    subjects: { "pattern.json": p },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-005", doc: "pattern.json" }] },
  });
}

{
  const p = clone(pattern);
  p.extensions = { "org.example.atelier": { version: "1.0.0", provenance: { publisher: "Example Atelier (fictitious)" }, onUnknown: "read-only", data: { note: "x" } } };
  await writeCase({
    level: "semantic",
    slug: "unknown-extension-block-read-only",
    title: "An unknown extension block with onUnknown: read-only is accepted but not editable",
    subjects: { "pattern.json": p },
    expect: { outcome: "accept", diagnostics: [{ code: "D2P-SEM-007", doc: "pattern.json", at: "/extensions/org.example.atelier" }], editability: "read-only" },
  });
  const q = clone(pattern);
  q.extensions = { "org.example.atelier": { version: "1.0.0", provenance: { publisher: "Example Atelier (fictitious)" }, onUnknown: "ignore", data: { note: "x" } } };
  await writeCase({
    level: "semantic",
    slug: "unknown-extension-block-ignore",
    title: "An unknown extension block with onUnknown: ignore is processed normally",
    subjects: { "pattern.json": q },
    expect: { outcome: "accept", editability: "editable" },
  });
}

// Privacy: measurement export and classification.
const privateProfile = {
  documentType: "d2p:body-measurement-profile",
  schemaVersion: V,
  artifactId: "art_conformance-private-profile",
  revisionId: "rev_conformance-private-profile-r1",
  subject: { kind: "individual", pseudonym: "subject-1" },
  dataClassification: "sensitive-personal",
  definitionRegistries: [{ id: "d2p:measurement-definitions", version: "1.0.0" }],
  measurements: [{ definitionId: "d2p:body.chest-girth", value: 950, unit: "mm", method: "manual", source: { kind: "self-measured" } }],
};

/**
 * Pattern, evaluation, snapshot and scene of the export cases. With
 * `included`, the scene draws every contour on a seam-line layer and a cut line
 * offset outward by `offsetMm` (0: the cut line is the contour).
 */
function exportChain(inputRefs, { source = pattern, included = false, offsetMm = 0 } = {}) {
  const pattern = source;
  const snapshot = snapshotOf(pattern);
  const req = {
    documentType: "d2p:evaluation-request",
    schemaVersion: V,
    requestId: "erq_conformance-square-export",
    patternRef: refOf(pattern),
    evaluatorProfile: EVALUATOR.evaluatorProfile,
    requestedOutputs: ["geometry-snapshot"],
  };
  const evaluation = withResultDigest(
    {
      documentType: "d2p:pattern-evaluation",
      schemaVersion: V,
      evaluationId: "pev_conformance-square-export",
      createdAt: T2,
      request: req,
      evaluator: EVALUATOR,
      featureSetVersion: V,
      inputDigests: [{ role: "pattern", artifactRef: refOf(pattern), digest: contentDigestOf(pattern) }],
      status: "succeeded",
      constraintStatus: "solved",
      snapshotRef: { id: snapshot.snapshotId, digest: snapshot.geometryDigest },
      measurements: [],
      diagnostics: [],
    },
    "evaluationId",
  );
  // Every cut instance of the pattern, laid out left to right; the right sleeve
  // is the mirrored cut instance. Paths are the snapshot contours under the
  // instance transform (catalog §3.7, D2P-SEM-096).
  const layout = [
    { id: "front-size-a", pieceId: "front", key: "front", mirror: false, x: 10, label: "Front (synthetic), size A" },
    { id: "back-size-a", pieceId: "back", key: "back", mirror: false, x: 230, label: "Back (synthetic), size A" },
    { id: "sleeve-left-size-a", pieceId: "sleeve", key: "sleeve-left", mirror: false, x: 450, label: "Sleeve left (synthetic), size A" },
    { id: "sleeve-right-size-a", pieceId: "sleeve", key: "sleeve-right", mirror: true, x: 620, label: "Sleeve right (synthetic, mirrored), size A" },
  ];
  const pieceInstances = layout.map((inst) => {
    const piece = snapshot.pieces.find((p) => p.pieceId === inst.pieceId);
    const c = piece.contours[0];
    const xs = [c.start, ...c.segments.map((s) => s.end)].map((p) => (inst.mirror ? -p[0] : p[0]));
    const transform = { translate: [inst.x - Math.min(...xs), 10], rotateRad: 0, mirror: inst.mirror };
    const tp = (p) => [(inst.mirror ? -p[0] : p[0]) + transform.translate[0], p[1] + transform.translate[1]];
    const net = [c.start, ...c.segments.map((s) => s.end)];
    const cx = (Math.min(...net.map((p) => p[0])) + Math.max(...net.map((p) => p[0]))) / 2;
    const cy = (Math.min(...net.map((p) => p[1])) + Math.max(...net.map((p) => p[1]))) / 2;
    // Outward offset of an axis-aligned rectangle (mitered corners).
    const off = (p) => [p[0] + (p[0] < cx ? -offsetMm : offsetMm), p[1] + (p[1] < cy ? -offsetMm : offsetMm)];
    const points = net.map((p) => tp(off(p)));
    const min = [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))];
    const max = [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))];
    const grain = piece.grainlines[0];
    return {
      id: inst.id,
      pieceId: inst.pieceId,
      cutInstanceKey: inst.key,
      sizeKey: "size-a",
      transform,
      paths: [
        {
          id: `${inst.key}-cut`,
          layerId: "cut",
          elementId: c.contourId,
          closed: true,
          start: tp(off(c.start)),
          segments: c.segments.map((s) => ({ kind: "line", end: tp(off(s.end)) })),
        },
        ...(included
          ? [
              {
                id: `${inst.key}-seam`,
                layerId: "seam",
                elementId: c.contourId,
                closed: true,
                start: tp(c.start),
                segments: c.segments.map((s) => ({ kind: "line", end: tp(s.end) })),
              },
            ]
          : []),
      ],
      markers: [{ id: `${inst.key}-grain`, layerId: "grain", kind: "grainline", elementId: grain.grainlineId, points: [tp(grain.start), tp(grain.end)] }],
      labels: [{ id: `${inst.key}-label`, layerId: "label", anchor: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2], text: inst.label }],
      boundingBox: { min, max },
    };
  }).sort((a, b) => (a.id < b.id ? -1 : 1));
  const scene = withResultDigest(
    {
      documentType: "d2p:export-scene-2d",
      schemaVersion: V,
      sceneId: "xsc_conformance-square",
      source: {
        patternRef: refOf(pattern),
        evaluations: [{ sizeKey: "size-a", evaluationId: evaluation.evaluationId, geometryDigest: snapshot.geometryDigest }],
        ...(inputRefs ? { inputRefs } : {}),
      },
      units: { length: "mm", angle: "rad" },
      coordinateSystem: { origin: "bottom-left", xAxis: "right", yAxis: "up" },
      layers: [
        { id: "cut", role: "d2p:cut-line", name: "Cut line" },
        { id: "grain", role: "d2p:grainline", name: "Grainline" },
        { id: "label", role: "d2p:label", name: "Label" },
        ...(included ? [{ id: "seam", role: "d2p:seam-line", name: "Seam line" }] : []),
      ],
      seamAllowancePolicy: included ? "included" : "none",
      pieceInstances,
      lineStyles: [
        { layerId: "cut", widthMm: 0.5 },
        { layerId: "grain", widthMm: 0.3 },
        ...(included ? [{ layerId: "seam", widthMm: 0.3, dashMm: [2, 1] }] : []),
      ],
    },
    "sceneId",
  );
  return { snapshot, evaluation, scene };
}

{
  const { snapshot, evaluation, scene } = exportChain([refOf(privateProfile)]);
  await writeCase({
    level: "semantic",
    slug: "private-measurement-export",
    title: "An export scene that references a personal measurement profile is rejected",
    description: "An individual's profile classified sensitive-personal is named in the scene's source.inputRefs.",
    subjects: {
      "body-measurement-profile.json": privateProfile,
      "artifact.json": artifactOf(privateProfile, "d2p:body-measurement-profile", "sensitive-personal"),
      "export-scene-2d.json": scene,
    },
    context: { "pattern.json": pattern, "pattern-evaluation.json": evaluation, "geometry-snapshot.json": snapshot },
    external: [REGISTRY],
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-050", doc: "export-scene-2d.json", at: "/source/inputRefs/0" }] },
  });
}

{
  const { snapshot, evaluation, scene } = exportChain();
  await writeCase({
    level: "semantic",
    slug: "export-scene",
    title: "An export scene without personal inputs, with closed cut lines and resolved layers is accepted",
    subjects: { "export-scene-2d.json": scene },
    context: { "pattern.json": pattern, "pattern-evaluation.json": evaluation, "geometry-snapshot.json": snapshot },
    expect: { outcome: "accept" },
  });
  const printJob = (calibrated) =>
    withResultDigest(
      {
        documentType: "d2p:print-job-spec",
        schemaVersion: V,
        printJobId: "pjs_conformance-square-a4",
        scene,
        outputProfile: { profileId: "d2p:home-print-a4", version: "1.0.0" },
        pageLayout: {
          media: { name: "iso-a4", widthMm: 210, heightMm: 297 },
          orientation: "portrait",
          marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
          tiling: { mode: "tiled", overlapMm: 10, registrationMarks: true, sheetLabels: true },
        },
        scale: 1,
        ...(calibrated ? { calibration: { controlSquareMm: 100, placement: "every-sheet" } } : {}),
        printNotice: { text: "Print at 100 % (actual size). Check the 100 mm control square.", locale: "en" },
        conformance: { profileId: "d2p:print-v1", level: "geometry" },
        provenance: { generator: { name: "conformance-kit", version: "1.0.0" }, sceneDigest: scene.resultDigest },
      },
      "printJobId",
    );
  await writeCase({
    level: "semantic",
    slug: "print-job-calibrated",
    title: "A home-print job with calibration square, matching media and a valid embedded scene is accepted",
    subjects: { "print-job-spec.json": printJob(true) },
    context: { "pattern.json": pattern, "pattern-evaluation.json": evaluation, "geometry-snapshot.json": snapshot },
    expect: { outcome: "accept" },
  });
  const a3Untiled = printJob(true);
  delete a3Untiled.resultDigest;
  a3Untiled.pageLayout = {
    media: { name: "iso-a3", widthMm: 297, heightMm: 420 },
    orientation: "portrait",
    marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
    tiling: { mode: "none", registrationMarks: false, sheetLabels: false },
  };
  withResultDigest(a3Untiled, "printJobId");
  await writeCase({
    level: "semantic",
    slug: "print-output-profile-violated",
    title: "A home-print-a4 job on A3 media without tiling, registration marks and sheet labels is rejected",
    description: "The output profile d2p:home-print-a4 binds A4 media, tiled output with overlap, registration marks, sheet labels and piece labels (catalog §3.7).",
    subjects: { "print-job-spec.json": a3Untiled },
    context: { "pattern.json": pattern, "pattern-evaluation.json": evaluation, "geometry-snapshot.json": snapshot },
    expect: {
      outcome: "reject",
      diagnostics: [
        { code: "D2P-SEM-095", doc: "print-job-spec.json", at: "/pageLayout/media/name" },
        { code: "D2P-SEM-095", doc: "print-job-spec.json", at: "/pageLayout/tiling/mode" },
        { code: "D2P-SEM-095", doc: "print-job-spec.json", at: "/pageLayout/tiling/registrationMarks" },
        { code: "D2P-SEM-095", doc: "print-job-spec.json", at: "/pageLayout/tiling/sheetLabels" },
      ],
    },
  });
  await writeCase({
    level: "semantic",
    slug: "print-calibration-missing",
    title: "A home-print job without a calibration square is rejected",
    subjects: { "print-job-spec.json": printJob(false) },
    context: { "pattern.json": pattern, "pattern-evaluation.json": evaluation, "geometry-snapshot.json": snapshot },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-091", doc: "print-job-spec.json", at: "/calibration" }] },
  });
}

{
  const p = clone(privateProfile);
  p.dataClassification = "internal";
  await writeCase({
    level: "semantic",
    slug: "classification-inconsistent",
    title: "A measurement profile of an individual that is not classified as personal data is rejected",
    subjects: { "body-measurement-profile.json": p },
    external: [REGISTRY],
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-051", doc: "body-measurement-profile.json", at: "/dataClassification" }] },
  });
}

{
  const p = clone(privateProfile);
  p.measurements[0].unit = "rad";
  await writeCase({
    level: "semantic",
    slug: "measurement-unit-mismatch",
    title: "A length measurement given in radians is rejected",
    subjects: { "body-measurement-profile.json": p },
    external: [REGISTRY],
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-070", doc: "body-measurement-profile.json", at: "/measurements/0/unit" }] },
  });
}

// Body and garment definitions are never confused (catalog §3.3, D2P-SEM-075).
{
  const spec = {
    documentType: "d2p:garment-measurement-spec",
    schemaVersion: V,
    artifactId: "art_conformance-garment-spec",
    revisionId: "rev_conformance-garment-spec-r1",
    name: "Conformance kit garment spec (synthetic)",
    definitionRegistries: [{ id: "d2p:measurement-definitions", version: "1.0.0" }],
    targets: [{ id: "target-chest", definitionId: "d2p:garment.chest-girth", value: 1000, unit: "mm" }],
  };
  const easeProfile = clone(fitProfile);
  easeProfile.definitionRegistries = [{ id: "d2p:measurement-definitions", version: "1.0.0" }];
  easeProfile.easeRules = [
    { id: "ease-chest", bodyDefinitionId: "d2p:body.chest-girth", garmentDefinitionId: "d2p:garment.chest-girth", easeType: "wearing", amount: { value: 80, unit: "mm" }, priority: 0 },
  ];
  const sizes = clone(sizeSystem);
  sizes.definitionRegistries = [{ id: "d2p:measurement-definitions", version: "1.0.0" }];
  await writeCase({
    level: "semantic",
    slug: "definition-kinds-consistent",
    title: "Body definitions on the body side and garment definitions on the garment side are accepted",
    subjects: { "garment-measurement-spec.json": spec, "fit-profile.json": easeProfile, "size-system.json": sizes },
    external: [REGISTRY],
    expect: { outcome: "accept" },
  });
  const badSpec = clone(spec);
  badSpec.targets[0].definitionId = "d2p:body.chest-girth";
  await writeCase({
    level: "semantic",
    slug: "garment-target-body-definition",
    title: "A garment measurement target that uses a body definition is rejected",
    description: "Body measurements and finished garment measurements are different definitions and are never confused; garment targets use garment definitions.",
    subjects: { "garment-measurement-spec.json": badSpec },
    external: [REGISTRY],
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-075", doc: "garment-measurement-spec.json", at: "/targets/0/definitionId" }] },
  });
  const swapped = clone(easeProfile);
  swapped.easeRules[0].bodyDefinitionId = "d2p:garment.chest-girth";
  swapped.easeRules[0].garmentDefinitionId = "d2p:body.chest-girth";
  await writeCase({
    level: "semantic",
    slug: "ease-rule-definitions-swapped",
    title: "An ease rule whose body and garment definitions are swapped is rejected",
    description: "Both definitions are girths, so the path types match (D2P-SEM-071 does not apply); the definitions are on the wrong side.",
    subjects: { "fit-profile.json": swapped },
    external: [REGISTRY],
    expect: {
      outcome: "reject",
      diagnostics: [
        { code: "D2P-SEM-075", doc: "fit-profile.json", at: "/easeRules/0/bodyDefinitionId" },
        { code: "D2P-SEM-075", doc: "fit-profile.json", at: "/easeRules/0/garmentDefinitionId" },
      ],
    },
  });
  const garmentSize = clone(sizes);
  garmentSize.sizes[1].measurements[0].definitionId = "d2p:garment.chest-girth";
  await writeCase({
    level: "semantic",
    slug: "size-entry-garment-definition",
    title: "A size entry that holds a garment measurement is rejected",
    description: "A size system maps labels to body measurements; a finished garment measurement in a size entry is rejected.",
    subjects: { "size-system.json": garmentSize },
    external: [REGISTRY],
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-075", doc: "size-system.json", at: "/sizes/1/measurements/0/definitionId" }] },
  });
}

{
  const p = clone(pattern);
  p.definitionRegistries = [{ id: "d2p:measurement-definitions", version: "1.0.0" }];
  p.measurementInputs = [{ key: "waist-girth", definitionId: "d2p:body.waist-girth", required: true }];
  const r = clone(request);
  r.patternRef = refOf(p);
  await writeCase({
    level: "semantic",
    slug: "required-measurement-missing",
    title: "A required measurement input that resolves to no value and has no fallback is rejected",
    description: "The size entry of size-a holds only the chest girth; the pattern requires the waist girth without a fallback.",
    subjects: { "evaluation-request.json": r },
    context: { "pattern.json": p, "size-system.json": sizeSystem, "fit-profile.json": fitProfile },
    external: [REGISTRY],
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-072", doc: "evaluation-request.json" }] },
  });
}

// Negative ease and material applicability (catalog §3.3, D2P-SEM-074; FIT-002).
{
  const fp = clone(fitProfile);
  fp.definitionRegistries = [{ id: "d2p:measurement-definitions", version: "1.0.0" }];
  fp.easeRules = [
    {
      id: "ease-chest-negative",
      bodyDefinitionId: "d2p:body.chest-girth",
      garmentDefinitionId: "d2p:garment.chest-girth",
      easeType: "wearing",
      amount: { value: -40, unit: "mm" },
      priority: 0,
      materialCondition: { materialClasses: ["knit"], minStretchRatio: 0.2 },
    },
  ];
  const woven = clone(request);
  woven.materialAssumptions = { materialClass: "woven" };
  await writeCase({
    level: "semantic",
    slug: "negative-ease-material-incompatible",
    title: "A stretch-conditioned negative-ease rule evaluated for a woven material is reported, not applied silently",
    description: "The fit profile's negative-ease rule requires a knit with at least 0.2 stretch; the request evaluates a woven configuration. The rule does not apply, and D2P-SEM-074 makes that visible (synthetic values, not a norm).",
    subjects: { "evaluation-request.json": woven },
    context: { "pattern.json": pattern, "size-system.json": sizeSystem, "fit-profile.json": fp },
    external: [REGISTRY],
    testIds: ["FIT-002"],
    expect: { outcome: "accept", diagnostics: [{ code: "D2P-SEM-074", doc: "evaluation-request.json", at: "/materialAssumptions" }] },
  });
  const knit = clone(request);
  knit.materialAssumptions = { materialClass: "knit", stretch: { lengthwise: 0.3, crosswise: 0.3 } };
  await writeCase({
    level: "semantic",
    slug: "negative-ease-material-compatible",
    title: "A stretch-conditioned negative-ease rule evaluated for a knit that meets the condition applies without a diagnostic",
    subjects: { "evaluation-request.json": knit },
    context: { "pattern.json": pattern, "size-system.json": sizeSystem, "fit-profile.json": fp },
    external: [REGISTRY],
    testIds: ["FIT-002"],
    expect: { outcome: "accept" },
  });
}

// Validation: gate decision procedure and waivers.
const openFinding = {
  findingId: "f-1",
  ruleId: rule.ruleId,
  ruleVersion: "1.0.0",
  code: "D2P-SEM-010",
  severity: "error",
  message: "Contour 'front-outer' is reported as open (synthetic finding).",
  elementRefs: [{ artifactId: pattern.artifactId, revisionId: pattern.revisionId, elementId: "front-outer", elementType: "d2p:contour" }],
  visibility: "general",
};
const validationContext = () => ({ "pattern.json": pattern, "validation-profile.json": profile, "validation-rule.json": rule });
{
  const report = reportFor(pattern, { findings: [openFinding] });
  const waiver = {
    documentType: "d2p:waiver",
    schemaVersion: V,
    waiverId: "wvr_conformance-1",
    createdAt: T1,
    expiresAt: T3,
    targetRefs: [refOf(pattern)],
    action: "cut-sample",
    reportId: report.reportId,
    findingIds: ["f-1"],
    justification: "Synthetic waiver of the conformance kit.",
    approvedBy: { kind: "person", principalId: "prn_conformance-reviewer" },
    grantId: "grant-conformance-1",
  };
  const gate = gateFor(pattern, [report], {
    decision: "allow",
    reasonCodes: ["d2p:waived"],
    waiverIds: [waiver.waiverId],
    addressedFindings: [{ reportId: report.reportId, findingId: "f-1" }],
  });
  await writeCase({
    level: "semantic",
    slug: "gate-allow-with-waiver",
    title: "A gate that allows an action because a valid waiver addresses the only blocking finding is consistent",
    subjects: { "gate-evaluation.json": gate },
    context: { ...validationContext(), "validation-report.json": report, "waiver.json": waiver },
    expect: { outcome: "accept" },
  });
  const wrong = gateFor(pattern, [report], { decision: "allow" });
  await writeCase({
    level: "semantic",
    slug: "gate-decision-inconsistent",
    title: "A gate that allows an action despite an unwaived blocking finding is rejected",
    subjects: { "gate-evaluation.json": wrong },
    context: { ...validationContext(), "validation-report.json": report },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-102", doc: "gate-evaluation.json", at: "/decision" }] },
  });
  const badWaiver = { ...clone(waiver), expiresAt: T1, createdAt: T2 };
  await writeCase({
    level: "semantic",
    slug: "waiver-scope-invalid",
    title: "A waiver that expires before it is created is rejected",
    subjects: { "waiver.json": badWaiver },
    context: { ...validationContext(), "validation-report.json": report },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-101", doc: "waiver.json", at: "/expiresAt" }] },
  });
}

{
  const bundle = {
    documentType: "d2p:quality-evidence-bundle",
    schemaVersion: V,
    bundleId: "qeb_conformance-1",
    createdAt: T3,
    gate: { id: "org.example.conformance:evidence-gate", version: "1.0.0" },
    subjectRefs: [refOf(pattern)],
    requiredSuites: [{ suiteId: "org.example.conformance:geometry", suiteVersion: "1.0.0" }],
    reports: [],
    overallState: "passed",
  };
  await writeCase({
    level: "semantic",
    slug: "evidence-state-inconsistent",
    title: "Evidence that lacks a required suite is never passed",
    subjects: { "quality-evidence-bundle.json": bundle },
    context: { "pattern.json": pattern },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-110", doc: "quality-evidence-bundle.json", at: "/overallState" }] },
  });
}

// Gate with test evidence (design decision ADR-025 §11.4, QEV-012).
{
  const evidence = {
    documentType: "d2p:quality-evidence-bundle",
    schemaVersion: V,
    bundleId: "qeb_conformance-gate",
    createdAt: T1,
    gate: profileRef,
    subjectRefs: [refOf(pattern)],
    requiredSuites: [{ suiteId: "org.example.conformance:geometry", suiteVersion: "1.0.0" }],
    reports: [],
    overallState: "failed",
  };
  const report = reportFor(pattern);
  const withEvidence = (bundle, opts) => {
    const g = gateFor(pattern, [report], opts);
    delete g.resultDigest;
    const keys = Object.keys(g);
    const ordered = {};
    for (const k of keys) {
      ordered[k] = g[k];
      if (k === "reportRefs") ordered.evidenceRefs = [{ id: bundle.bundleId, digest: contentDigestOf(bundle) }];
    }
    return withResultDigest(ordered, "gateEvaluationId");
  };
  await writeCase({
    level: "semantic",
    slug: "gate-evidence-missing",
    title: "A gate that references evidence lacking a required suite denies the action",
    description: "The validation report passes, but the referenced quality evidence bundle has no report for its required suite. QEV-012: a missing evidence report means the gate is not passed (step 4, d2p:evidence-missing).",
    subjects: { "gate-evaluation.json": withEvidence(evidence, { decision: "deny", reasonCodes: ["d2p:evidence-missing"] }) },
    context: { ...validationContext(), "validation-report.json": report, "quality-evidence-bundle.json": evidence },
    testIds: ["QEV-012"],
    expect: { outcome: "accept" },
  });
  await writeCase({
    level: "semantic",
    slug: "gate-evidence-ignored",
    title: "A gate that allows an action although its evidence lacks a required suite is rejected",
    subjects: { "gate-evaluation.json": withEvidence(evidence, { decision: "allow" }) },
    context: { ...validationContext(), "validation-report.json": report, "quality-evidence-bundle.json": evidence },
    testIds: ["QEV-012"],
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-102", doc: "gate-evaluation.json", at: "/decision" }] },
  });
  const foreign = { ...clone(evidence), bundleId: "qeb_conformance-foreign", gate: { id: "org.example.conformance:other-gate", version: "1.0.0" } };
  await writeCase({
    level: "referential",
    slug: "evidence-gate-mismatch",
    title: "A gate that references evidence collected for another gate is rejected",
    subjects: { "gate-evaluation.json": withEvidence(foreign, { decision: "deny", reasonCodes: ["d2p:evidence-missing"] }) },
    context: { ...validationContext(), "validation-report.json": report, "quality-evidence-bundle.json": foreign },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-007", doc: "gate-evaluation.json", at: "/evidenceRefs/0" }] },
  });
}

// ----- topology (semantic) -----
await writeCase({
  level: "semantic",
  group: "topology",
  slug: "TOP-001-closed-outer-contours",
  title: "Closed outer contours chained through shared point features are accepted",
  testIds: ["TOP-001"],
  subjects: { "pattern.json": pattern },
  expect: { outcome: "accept" },
});

await writeCase({
  level: "semantic",
  group: "topology",
  slug: "TOP-002-simple-snapshot-contour",
  title: "A line-only snapshot contour without self-intersection is accepted",
  testIds: ["TOP-002"],
  subjects: { "geometry-snapshot.json": snapshotOf(pattern) },
  context: { "pattern.json": pattern },
  expect: { outcome: "accept" },
});
{
  const snap = snapshotOf(pattern);
  const front = snap.pieces.find((p) => p.pieceId === "front");
  const segs = front.contours[0].segments;
  // Bow-tie: (0,0) -> (200,0) -> (0,300) -> (200,300) -> (0,0)
  segs[1].end = [0, 300];
  segs[2].end = [200, 300];
  delete snap.geometryDigest;
  finishSnapshot(snap);
  const fi = snap.pieces.indexOf(front);
  await writeCase({
    level: "semantic",
    group: "topology",
    slug: "TOP-002-self-intersecting-contour",
    title: "A bow-tie shaped line-only outer contour is rejected",
    testIds: ["TOP-002"],
    subjects: { "geometry-snapshot.json": snap },
    context: { "pattern.json": pattern },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-011", doc: "geometry-snapshot.json", at: `/pieces/${fi}/contours/0` }] },
  });
}

{
  const p = clone(pattern);
  // Rule (a): same edge, same direction; rule (b): shared endpoint f-br between front-hem and front-side-right.
  p.seamInterfaces.push({
    id: "si-front-corner",
    segments: [
      { edgeId: "front-hem", from: 0.5, to: 0.75, direction: "forward" },
      { edgeId: "front-hem", from: 0.75, to: 1, direction: "forward" },
      { edgeId: "front-side-right", from: 0, to: 0.5, direction: "forward" },
    ],
  });
  await writeCase({
    level: "semantic",
    group: "topology",
    slug: "TOP-003-continuous-interface",
    title: "An ordered, continuous EdgeInterval chain is accepted",
    testIds: ["TOP-003"],
    subjects: { "pattern.json": p },
    expect: { outcome: "accept" },
  });
  const q = clone(pattern);
  q.seamInterfaces.push({
    id: "si-front-gap",
    segments: [
      { edgeId: "front-hem", from: 0, to: 0.4, direction: "forward" },
      { edgeId: "front-hem", from: 0.5, to: 1, direction: "forward" },
    ],
  });
  await writeCase({
    level: "semantic",
    group: "topology",
    slug: "TOP-003-discontinuous-interface",
    title: "An EdgeInterval chain with a gap is rejected",
    testIds: ["TOP-003"],
    subjects: { "pattern.json": q },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-020", doc: "pattern.json", at: `/seamInterfaces/${q.seamInterfaces.length - 1}/segments/1` }] },
  });
  const r = clone(pattern);
  r.seamInterfaces.push({
    id: "si-front-jump",
    segments: [
      { edgeId: "front-hem", from: 0, to: 1, direction: "forward" },
      { edgeId: "front-top", from: 0, to: 1, direction: "forward" },
    ],
  });
  await writeCase({
    level: "semantic",
    group: "topology",
    slug: "TOP-003-non-adjacent-edges",
    title: "An EdgeInterval chain jumping between edges that share no endpoint is rejected",
    testIds: ["TOP-003"],
    subjects: { "pattern.json": r },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-020", doc: "pattern.json", at: `/seamInterfaces/${r.seamInterfaces.length - 1}/segments/1` }] },
  });
}

{
  const p = clone(pattern);
  p.seamInterfaces.push({ id: "si-back-top", segments: [full("back-top")] });
  p.seamConnections.push(conn("seam-extra", "si-front-side-left", "si-back-top", false));
  await writeCase({
    level: "semantic",
    group: "topology",
    slug: "TOP-010-inactive-second-connection",
    title: "An interface used by one active and one inactive connection is accepted",
    testIds: ["TOP-010"],
    subjects: { "pattern.json": p },
    expect: { outcome: "accept" },
  });
  const q = clone(p);
  q.seamConnections[q.seamConnections.length - 1].active = true;
  await writeCase({
    level: "semantic",
    group: "topology",
    slug: "TOP-010-two-active-connections",
    title: "An active interface used by two active connections is rejected",
    testIds: ["TOP-010"],
    subjects: { "pattern.json": q },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-023", doc: "pattern.json", at: "/seamInterfaces/0" }] },
  });
}

// ----- sewing groups (semantic) -----
await writeCase({
  level: "semantic",
  group: "sewing-groups",
  slug: "SWG-001-two-connection-group",
  title: "A group of exactly two distinct connections is valid",
  testIds: ["SWG-001"],
  subjects: { "pattern.json": pattern },
  expect: { outcome: "accept" },
});
{
  const p = clone(pattern);
  p.sewingGroups.push(group("group-underarms", ["seam-underarm-left", "seam-underarm-right"], "logical-collection"));
  await writeCase({
    level: "semantic",
    group: "sewing-groups",
    slug: "SWG-005-disjoint-groups",
    title: "Two groups with disjoint member connections are valid",
    testIds: ["SWG-005"],
    subjects: { "pattern.json": p },
    expect: { outcome: "accept" },
  });
  const q = clone(pattern);
  q.sewingGroups.push(group("group-left", ["seam-side-left", "seam-underarm-left"], "logical-collection"));
  await writeCase({
    level: "semantic",
    group: "sewing-groups",
    slug: "SWG-005-connection-in-two-groups",
    title: "Two groups claiming the same connection are rejected",
    testIds: ["SWG-005"],
    subjects: { "pattern.json": q },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-031", doc: "pattern.json", at: "/sewingGroups/1/members/0" }] },
  });
}
{
  const p = clone(pattern);
  p.sewingGroups[0].members = [{ connectionId: "seam-side-left" }, { connectionId: "seam-side-right", role: "org.example.conformance:outer" }];
  await writeCase({
    level: "semantic",
    group: "sewing-groups",
    slug: "SWG-006-distinct-members",
    title: "A group whose members name distinct connections is valid",
    testIds: ["SWG-006"],
    subjects: { "pattern.json": p },
    expect: { outcome: "accept" },
  });
  const q = clone(pattern);
  q.sewingGroups[0].members = [{ connectionId: "seam-side-left" }, { connectionId: "seam-side-left", role: "org.example.conformance:outer" }];
  await writeCase({
    level: "semantic",
    group: "sewing-groups",
    slug: "SWG-006-duplicate-member",
    title: "A duplicate connection inside one group is rejected",
    testIds: ["SWG-006"],
    subjects: { "pattern.json": q },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-030", doc: "pattern.json", at: "/sewingGroups/0/members/1" }] },
  });
}
{
  const p = clone(pattern);
  p.sewingGroups[0] = group("group-left", ["seam-side-left", "seam-underarm-left"], "logical-collection");
  await writeCase({
    level: "semantic",
    group: "sewing-groups",
    slug: "SWG-007-logical-collection",
    title: "Disconnected members are valid in a logical collection",
    testIds: ["SWG-007"],
    subjects: { "pattern.json": p },
    expect: { outcome: "accept" },
  });
  const q = clone(pattern);
  q.sewingGroups[0] = group("group-left", ["seam-side-left", "seam-underarm-left"], "connected");
  await writeCase({
    level: "semantic",
    group: "sewing-groups",
    slug: "SWG-007-disconnected-members",
    title: "Disconnected members with groupTopology connected are rejected",
    description: "seam-side-left joins the front and back cut instances, seam-underarm-left joins sleeve-left to itself; the two components are not connected.",
    testIds: ["SWG-007"],
    subjects: { "pattern.json": q },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-032", doc: "pattern.json", at: "/sewingGroups/0" }] },
  });
}
{
  const p = clone(pattern);
  p.seamInterfaces.push({ id: "si-front-top", segments: [full("front-top")] });
  p.seamInterfaces.push({ id: "si-back-top", segments: [full("back-top")] });
  p.seamConnections.push(conn("seam-top", "si-front-top", "si-back-top"));
  p.sewingGroups[0].members.push({ connectionId: "seam-top" });
  await writeCase({
    level: "semantic",
    group: "sewing-groups",
    slug: "SWG-011-distinct-interfaces",
    title: "Connections of a group that use distinct interfaces are valid",
    testIds: ["SWG-011"],
    subjects: { "pattern.json": p },
    expect: { outcome: "accept" },
  });
  const q = clone(pattern);
  q.seamInterfaces.push({ id: "si-front-top", segments: [full("front-top")] });
  q.seamConnections.push(conn("seam-top", "si-front-top", "si-back-side-left"));
  q.sewingGroups[0].members.push({ connectionId: "seam-top" });
  await writeCase({
    level: "semantic",
    group: "sewing-groups",
    slug: "SWG-011-shared-interface",
    title: "The same interface used in two connections is rejected",
    testIds: ["SWG-011"],
    subjects: { "pattern.json": q },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-023", doc: "pattern.json", at: "/seamInterfaces/1" }] },
  });
}

// ===== Consistency of registries, fit reports, snapshots, scenes, reports and gates =====

// A measurement-definition registry defines each definitionId once and sorts its
// definitions (catalog §1.4, §3.3; D2P-REF-005, D2P-REF-014).
{
  const def = (local, kind, type, state) => ({
    definitionId: `org.example.conformance:${local}`,
    kind,
    dimension: "length",
    unit: "mm",
    path: { type, description: `Synthetic ${type} path of the conformance kit.` },
    landmarks: ["synthetic landmark"],
    posture: "d2p:standing-relaxed",
    state,
    description: `Synthetic ${kind} definition of the conformance kit.`,
    status: "active",
  });
  const registryWith = (definitions) => ({
    documentType: "d2p:measurement-definition-registry",
    schemaVersion: V,
    registryId: "org.example.conformance:measurements",
    version: "1.0.0",
    definitions,
  });
  const bodyGirth = def("body.chest-girth", "body", "girth", "d2p:minimal-clothing");
  const garmentGirth = def("garment.chest-girth", "garment", "girth", "d2p:flat-relaxed");
  await writeCase({
    level: "referential",
    slug: "registry-duplicate-definition",
    title: "A registry that defines the same definitionId twice with different meanings is rejected",
    description: "The second entry redefines the body chest girth as a flat width. A definition is the unique kind of a measurement (design decision ADR-011 §2), so a definitionId occurs once per registry; which duplicate a consumer picked would decide D2P-SEM-071.",
    subjects: { "measurement-definition-registry.json": registryWith([bodyGirth, { ...clone(bodyGirth), path: { type: "flat-width", description: "Changed meaning." } }, garmentGirth]) },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-005", doc: "measurement-definition-registry.json", at: "/definitions/1/definitionId" }] },
  });
  await writeCase({
    level: "referential",
    slug: "registry-unsorted",
    title: "A registry whose definitions are not sorted by definitionId is rejected",
    subjects: { "measurement-definition-registry.json": registryWith([garmentGirth, bodyGirth]) },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-014", doc: "measurement-definition-registry.json", at: "/definitions/1" }] },
  });
}

// A definitionId has one meaning within one resolution context: the registries
// of one document, and those of the documents one evaluation request pins
// (catalog §2.4, §3.3; D2P-REF-015).
{
  // Read from this repository, not from the output root (which may be a temporary directory).
  const standard = JSON.parse(await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", REGISTRY), "utf8"));
  const chest = standard.definitions.find((d) => d.definitionId === "d2p:body.chest-girth");
  const otherRegistry = (definition) => ({
    documentType: "d2p:measurement-definition-registry",
    schemaVersion: V,
    registryId: "org.example.other:definitions",
    version: "1.0.0",
    definitions: [definition],
  });
  const redefined = otherRegistry({ ...clone(chest), path: { type: "flat-width", description: "Synthetic redefinition of the conformance kit." }, description: "A different meaning under the same definitionId (synthetic)." });
  const copied = otherRegistry(clone(chest));
  const STANDARD_REF = { id: "d2p:measurement-definitions", version: "1.0.0" };
  const OTHER_REF = { id: "org.example.other:definitions", version: "1.0.0" };
  const withRegistries = (refs) => ({ ...clone(sizeSystem), definitionRegistries: refs });
  for (const [slug, refs, title] of [
    ["definition-registries-ambiguous", [STANDARD_REF, OTHER_REF], "A document whose declared registries define the same definitionId differently is rejected"],
    ["definition-registries-ambiguous-reordered", [OTHER_REF, STANDARD_REF], "The same ambiguity is rejected when the registries are declared in the other order"],
  ]) {
    await writeCase({
      level: "referential",
      slug,
      title,
      description: "A second registry redefines d2p:body.chest-girth as a flat width. A definition is the unique kind of a measurement (design decision ADR-011 §2); which meaning applied would otherwise depend on the order of definitionRegistries.",
      subjects: { "size-system.json": withRegistries(refs) },
      context: { "other-registry.json": redefined },
      external: [REGISTRY],
      expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-015", doc: "size-system.json", at: "/definitionRegistries/1" }] },
    });
  }
  await writeCase({
    level: "referential",
    slug: "definition-registries-identical-copy",
    title: "Two declared registries that carry the identical definition are accepted",
    subjects: { "size-system.json": withRegistries([STANDARD_REF, OTHER_REF]) },
    context: { "other-registry.json": copied },
    external: [REGISTRY],
    expect: { outcome: "accept" },
  });
  const p = clone(pattern);
  p.revisionId = "rev_conformance-square-r1-registries";
  p.definitionRegistries = [STANDARD_REF];
  const sizes = withRegistries([OTHER_REF]);
  const r = { ...clone(request), requestId: "erq_conformance-square-registries", patternRef: refOf(p) };
  const context = (registry) => ({
    "pattern.json": p,
    "size-system.json": sizes,
    "fit-profile.json": fitProfile,
    "revision-pattern-r1.json": revisionOf(p),
    "artifact-pattern.json": artifactOf(p, "d2p:pattern"),
    "other-registry.json": registry,
  });
  await writeCase({
    level: "referential",
    slug: "request-definition-registries-ambiguous",
    title: "A request whose pattern and size system use registries that define the same definitionId differently is rejected",
    description: "The pattern resolves d2p:body.chest-girth in the standard registry, the size system in a registry that redefines it; one evaluation would use both meanings.",
    subjects: { "evaluation-request.json": r },
    context: context(redefined),
    external: [REGISTRY],
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-015", doc: "evaluation-request.json", at: "/sizeSystemRef" }] },
  });
  await writeCase({
    level: "referential",
    slug: "request-definition-registries-consistent",
    title: "A request whose pinned documents use different registries with identical definitions is accepted",
    subjects: { "evaluation-request.json": r },
    context: context(copied),
    external: [REGISTRY],
    expect: { outcome: "accept" },
  });
}

// A fit evaluation report pins the configuration of its evaluation (catalog §3.3, FIT-003, D2P-REF-007).
{
  const spec = {
    documentType: "d2p:garment-measurement-spec",
    schemaVersion: V,
    artifactId: "art_conformance-garment-spec",
    revisionId: "rev_conformance-garment-spec-r1",
    name: "Conformance kit garment spec (synthetic)",
    definitionRegistries: [{ id: "d2p:measurement-definitions", version: "1.0.0" }],
    targets: [{ id: "target-chest", definitionId: "d2p:garment.chest-girth", value: 1000, unit: "mm" }],
  };
  const relaxed = { ...clone(fitProfile), revisionId: "rev_conformance-fit-profile-r2", intent: "d2p:relaxed" };
  const snapshot = snapshotOf(pattern);
  const req = { ...clone(request), garmentMeasurementSpecRef: refOf(spec) };
  const digestOfRef = (doc, role) => ({ role, artifactRef: refOf(doc), digest: contentDigestOf(doc) });
  const evaluation = withResultDigest(
    {
      documentType: "d2p:pattern-evaluation",
      schemaVersion: V,
      evaluationId: "pev_conformance-square-fit",
      createdAt: T2,
      request: req,
      evaluator: EVALUATOR,
      featureSetVersion: V,
      inputDigests: [digestOfRef(fitProfile, "fit-profile"), digestOfRef(spec, "garment-measurement-spec"), digestOfRef(pattern, "pattern"), digestOfRef(sizeSystem, "size-system")],
      status: "succeeded",
      constraintStatus: "solved",
      snapshotRef: { id: snapshot.snapshotId, digest: snapshot.geometryDigest },
      measurements: [],
      diagnostics: [],
    },
    "evaluationId",
  );
  const fitReport = (fit) =>
    withResultDigest(
      {
        documentType: "d2p:fit-evaluation-report",
        schemaVersion: V,
        reportId: "fer_conformance-square-fit",
        createdAt: T2,
        evaluationRef: { id: evaluation.evaluationId, digest: evaluation.resultDigest },
        evaluator: EVALUATOR,
        inputDigests: [digestOfRef(fit, "fit-profile"), digestOfRef(spec, "garment-measurement-spec"), digestOfRef(pattern, "pattern")],
        evidenceKind: "analytical",
        results: [{ id: "result-chest", garmentDefinitionId: "d2p:garment.chest-girth", predicted: { value: 1000, unit: "mm" }, status: "not-evaluated" }],
        containsPersonalData: false,
        diagnostics: [],
      },
      "reportId",
    );
  const context = {
    "pattern.json": pattern,
    "size-system.json": sizeSystem,
    "fit-profile-r1.json": fitProfile,
    "fit-profile-r2.json": relaxed,
    "garment-measurement-spec.json": spec,
    "pattern-evaluation.json": evaluation,
    "geometry-snapshot.json": snapshot,
  };
  await writeCase({
    level: "referential",
    slug: "fit-report-inputs-match-evaluation",
    title: "A fit evaluation report whose artifact input digests are pinned by its evaluation is accepted",
    subjects: { "fit-evaluation-report.json": fitReport(fitProfile) },
    context,
    external: [REGISTRY],
    testIds: ["FIT-003"],
    expect: { outcome: "accept" },
  });
  await writeCase({
    level: "referential",
    slug: "fit-report-inputs-differ-from-evaluation",
    title: "A fit evaluation report that claims another fit profile revision than its evaluation used is rejected",
    description: "The evaluation pins fit profile r1; the report names fit profile r2 as its fit-profile input. A fit evaluation refers to one concrete pattern evaluation configuration and never pulls in other revisions implicitly (design decision ADR-011 §3).",
    subjects: { "fit-evaluation-report.json": fitReport(relaxed) },
    context,
    external: [REGISTRY],
    testIds: ["FIT-003"],
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-007", doc: "fit-evaluation-report.json", at: "/inputDigests/0/artifactRef" }] },
  });
}

// A snapshot is the complete geometry of its pinned pattern (catalog §3.4, TOP-009; D2P-SEM-014, D2P-SEM-024).
{
  const incomplete = snapshotOf(pattern);
  incomplete.pieces = incomplete.pieces.filter((p) => p.pieceId !== "sleeve");
  finishSnapshot(incomplete);
  await writeCase({
    level: "semantic",
    slug: "snapshot-incomplete",
    title: "A snapshot that leaves out a piece of its pinned pattern is rejected",
    description: "The sleeve piece is missing. A snapshot is the read-only fallback of its pattern revision and must hold every piece, contour, edge, notch, grainline, fold, interface and active seam exactly once (design decision ADR-006.2).",
    subjects: { "geometry-snapshot.json": incomplete },
    context: { "pattern.json": pattern },
    testIds: ["TOP-009"],
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-014", doc: "geometry-snapshot.json", at: "/pieces" }] },
  });
  const deviating = snapshotOf(pattern);
  deviating.seams[0].deviationMm = 5;
  finishSnapshot(deviating);
  await writeCase({
    level: "semantic",
    slug: "snapshot-seam-inconsistent",
    title: "A snapshot seam whose deviation is not lengthA − lengthB − declared ease is rejected",
    subjects: { "geometry-snapshot.json": deviating },
    context: { "pattern.json": pattern },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-024", doc: "geometry-snapshot.json", at: "/seams/0/deviationMm" }] },
  });
}

// A scene reproduces the pinned snapshot under rigid transforms only (catalog §3.7, D2P-SEM-096).
{
  const { snapshot, evaluation, scene } = exportChain();
  const context = { "pattern.json": pattern, "pattern-evaluation.json": evaluation, "geometry-snapshot.json": snapshot };
  const scaled = clone(scene);
  const i = scaled.pieceInstances.findIndex((p) => p.id === "front-size-a");
  const path0 = scaled.pieceInstances[i].paths[0];
  const [tx, ty] = scaled.pieceInstances[i].transform.translate;
  const twice = (p) => [tx + 2 * (p[0] - tx), ty + 2 * (p[1] - ty)];
  path0.start = twice(path0.start);
  path0.segments = path0.segments.map((sg) => ({ ...sg, end: twice(sg.end) }));
  withResultDigest(scaled, "sceneId");
  await writeCase({
    level: "semantic",
    slug: "scene-geometry-scaled",
    title: "A scene whose cut line is the snapshot contour scaled by 2 is rejected",
    description: "No adapter changes a cut by scaling (design decision ADR-022 §3); a scene path is the pinned snapshot contour under the instance transform.",
    subjects: { "export-scene-2d.json": scaled },
    context,
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-096", doc: "export-scene-2d.json", at: `/pieceInstances/${i}/paths/0` }] },
  });
  const missing = clone(scene);
  missing.pieceInstances = missing.pieceInstances.filter((p) => p.cutInstanceKey !== "sleeve-right");
  withResultDigest(missing, "sceneId");
  await writeCase({
    level: "semantic",
    slug: "scene-cut-instance-missing",
    title: "A scene that leaves out a cut instance is rejected",
    description: "The mirrored right sleeve is missing; every cut instance of the pattern appears once per size of the scene.",
    subjects: { "export-scene-2d.json": missing },
    context,
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-096", doc: "export-scene-2d.json", at: "/pieceInstances" }] },
  });
}

// Scene completeness (catalog §3.7, D2P-SEM-096): every contour is drawn, every
// path that names a contour or edge is compared on every layer, free paths only
// on construction layers, and seam-allowance cut lines meet the offset rules.
{
  const SCENE = "export-scene-2d.json";
  const chainContext = ({ snapshot, evaluation }, p = pattern) => ({ "pattern.json": p, "pattern-evaluation.json": evaluation, "geometry-snapshot.json": snapshot });
  const frontIndex = (sc) => sc.pieceInstances.findIndex((p) => p.id === "front-size-a");
  const mapPath = (path, f) => ({ ...path, start: f(path.start), segments: path.segments.map((sg) => ({ ...sg, end: f(sg.end) })) });

  const included = exportChain(undefined, { included: true });
  await writeCase({
    level: "semantic",
    slug: "scene-included-seam-lines",
    title: "A scene with seam allowance included, seam lines for every contour and cut lines equal to the contours of pieces without seam allowance is accepted",
    subjects: { [SCENE]: included.scene },
    context: chainContext(included),
    expect: { outcome: "accept" },
  });
  {
    const sc = clone(included.scene);
    const i = frontIndex(sc);
    const [tx, ty] = sc.pieceInstances[i].transform.translate;
    sc.pieceInstances[i].paths[0] = mapPath(sc.pieceInstances[i].paths[0], (p) => [tx + 2 * (p[0] - tx), ty + 2 * (p[1] - ty)]);
    withResultDigest(sc, "sceneId");
    await writeCase({
      level: "semantic",
      slug: "scene-included-cut-line-scaled",
      title: "A scene with seam allowance included whose cut line is scaled by 2 for a piece without seam allowance is rejected",
      description: "The piece declares no seam allowance, so its cut line is the contour; adapters never invent seam allowance.",
      subjects: { [SCENE]: sc },
      context: chainContext(included),
      expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-096", doc: SCENE, at: `/pieceInstances/${i}/paths/0` }] },
    });
  }
  {
    const sc = clone(included.scene);
    for (const inst of sc.pieceInstances) inst.paths = [];
    withResultDigest(sc, "sceneId");
    await writeCase({
      level: "semantic",
      slug: "scene-included-paths-missing",
      title: "A scene with seam allowance included that draws no geometry is rejected",
      description: "Every contour is drawn on a cut-line layer and, with seam allowance included, on a seam-line layer.",
      subjects: { [SCENE]: sc },
      context: chainContext(included),
      expect: { outcome: "reject", diagnostics: sc.pieceInstances.map((_, k) => ({ code: "D2P-SEM-096", doc: SCENE, at: `/pieceInstances/${k}/paths` })) },
    });
  }

  const allowed = clone(pattern);
  allowed.revisionId = "rev_conformance-square-r1-seam-allowance";
  for (const piece of allowed.pieces) piece.seamAllowance = { default: ex(lit(10)) };
  const offset = exportChain(undefined, { source: allowed, included: true, offsetMm: 10 });
  await writeCase({
    level: "semantic",
    slug: "scene-included-seam-allowance",
    title: "A scene whose cut lines enclose the contours of pieces with a declared seam allowance is accepted",
    subjects: { [SCENE]: offset.scene },
    context: chainContext(offset, allowed),
    expect: { outcome: "accept" },
  });
  {
    const inside = exportChain(undefined, { source: allowed, included: true, offsetMm: -5 });
    await writeCase({
      level: "semantic",
      slug: "scene-included-cut-line-inside-contour",
      title: "A scene whose cut lines lie inside the contours of pieces with a declared seam allowance is rejected",
      description: "An outward seam-allowance offset of an outer contour contains the contour's vertex box for every non-negative width and join.",
      subjects: { [SCENE]: inside.scene },
      context: chainContext(inside, allowed),
      expect: {
        outcome: "reject",
        diagnostics: inside.scene.pieceInstances.map((_, k) => ({ code: "D2P-SEM-096", doc: SCENE, at: `/pieceInstances/${k}/paths/0` })),
      },
    });
  }

  const net = exportChain();
  {
    const sc = clone(net.scene);
    const i = frontIndex(sc);
    const [tx, ty] = sc.pieceInstances[i].transform.translate;
    sc.pieceInstances[i].paths.push({ ...mapPath(sc.pieceInstances[i].paths[0], (p) => [tx + 1.5 * (p[0] - tx), p[1] + 3]), id: "front-grain-copy", layerId: "grain" });
    withResultDigest(sc, "sceneId");
    await writeCase({
      level: "semantic",
      slug: "scene-contour-path-distorted-on-grain-layer",
      title: "A distorted copy of a contour drawn on a grainline layer is rejected",
      description: "A path that names a contour is that snapshot contour under the instance transform on every layer, not only on cut and seam lines.",
      subjects: { [SCENE]: sc },
      context: chainContext(net),
      expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-096", doc: SCENE, at: `/pieceInstances/${i}/paths/1` }] },
    });
  }
  {
    const sc = clone(net.scene);
    const i = frontIndex(sc);
    const { elementId, ...free } = sc.pieceInstances[i].paths[0];
    void elementId;
    sc.pieceInstances[i].paths.push({ ...free, id: "front-grain-free", layerId: "grain" });
    withResultDigest(sc, "sceneId");
    await writeCase({
      level: "semantic",
      slug: "scene-free-path-on-grain-layer",
      title: "A path that names no contour or edge on a grainline layer is rejected",
      description: "Grainlines, notches and folds are markers and text is a label; free paths are allowed only on construction or extension layers.",
      subjects: { [SCENE]: sc },
      context: chainContext(net),
      expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-096", doc: SCENE, at: `/pieceInstances/${i}/paths/1` }] },
    });
  }
  {
    const withConstruction = (moveMm) => {
      const sc = clone(net.scene);
      sc.layers.push({ id: "construction", role: "d2p:construction", name: "Construction" });
      sc.lineStyles.push({ layerId: "construction", widthMm: 0.2, dashMm: [1, 1] });
      const i = frontIndex(sc);
      const cut = sc.pieceInstances[i].paths[0];
      // The hem edge is the first contour segment, from the contour start.
      const hem = { id: "front-hem-line", layerId: "construction", elementId: "front-hem", closed: false, start: cut.start, segments: [{ kind: "line", end: [cut.segments[0].end[0] + moveMm, cut.segments[0].end[1]] }] };
      const free = { id: "front-guide", layerId: "construction", closed: false, start: [cut.start[0], cut.start[1] + 50], segments: [{ kind: "line", end: [cut.segments[0].end[0], cut.start[1] + 50] }] };
      sc.pieceInstances[i].paths.push(hem, free);
      withResultDigest(sc, "sceneId");
      return { sc, i };
    };
    await writeCase({
      level: "semantic",
      slug: "scene-edge-and-construction-paths",
      title: "An edge drawn as its snapshot geometry and a free path on a construction layer are accepted",
      subjects: { [SCENE]: withConstruction(0).sc },
      context: chainContext(net),
      expect: { outcome: "accept" },
    });
    const { sc, i } = withConstruction(1);
    await writeCase({
      level: "semantic",
      slug: "scene-edge-path-moved",
      title: "An edge path whose end is moved by 1 mm is rejected",
      subjects: { [SCENE]: sc },
      context: chainContext(net),
      expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-096", doc: SCENE, at: `/pieceInstances/${i}/paths/1` }] },
    });
  }
}

// A validation report agrees with itself and its profile (catalog §3.5, D2P-SEM-103).
{
  const variants = [
    ["report-pass-with-blocking-finding", "A report that passes despite a finding of severity error is rejected", (r) => { r.result = "pass"; }, "/result", [openFinding]],
    ["report-finding-severity-differs", "A report whose finding downgrades the profile severity of its rule is rejected", (r) => { r.result = "pass"; }, "/findings/0/severity", [{ ...clone(openFinding), severity: "info" }]],
    ["report-finding-code-not-of-rule", "A report whose finding carries a code its rule does not list is rejected", () => {}, "/findings/0/code", [{ ...clone(openFinding), code: "D2P-SEM-050" }]],
    ["report-purpose-differs", "A report whose purpose differs from its profile's purpose is rejected", (r) => { r.purpose = "1to1-print"; }, "/purpose", []],
    ["report-finding-rule-not-in-profile", "A report whose finding names a rule that is not part of its profile is rejected", () => {}, "/findings/0/ruleId", [{ ...clone(openFinding), ruleId: "org.example.conformance:not-in-profile" }]],
  ];
  for (const [slug, title, change, at, findings] of variants) {
    const r = reportFor(pattern, { findings });
    change(r);
    withResultDigest(r, "reportId");
    await writeCase({
      level: "semantic",
      slug,
      title,
      subjects: { "validation-report.json": r },
      context: validationContext(),
      testIds: ["VAL-007"],
      expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-103", doc: "validation-report.json", at }] },
    });
  }
}

// A gate's profile and reports have the purpose of its action (catalog §3.5, D2P-SEM-104).
{
  const report = reportFor(pattern);
  const gate = gateFor(pattern, [report]);
  gate.action = "export-1to1";
  withResultDigest(gate, "gateEvaluationId");
  await writeCase({
    level: "semantic",
    slug: "gate-purpose-mismatch",
    title: "A 1:1 export gated by a sample-cut profile and report is rejected",
    description: "A sample-cut profile has no print calibration or export privacy rules; a 1:1 export needs a 1to1-print profile (design decision ADR-016 §5, VAL-003).",
    subjects: { "gate-evaluation.json": gate },
    context: { ...validationContext(), "validation-report.json": report },
    testIds: ["VAL-003"],
    expect: {
      outcome: "reject",
      diagnostics: [
        { code: "D2P-SEM-104", doc: "gate-evaluation.json", at: "/profile" },
        { code: "D2P-SEM-104", doc: "gate-evaluation.json", at: "/reportRefs/0" },
      ],
    },
  });
}

// Mapping profiles: the versioned, provenance-carrying mechanism for external
// ontologies and conventions (catalog §3.1, design decision ADR-005; D2P-REF-005, D2P-REF-014).
{
  const entry = (d2pTerm, relation, externalTerm) => ({ d2pTerm, relation, externalTerm });
  const mappingWith = (entries) => ({
    documentType: "d2p:mapping-profile",
    schemaVersion: V,
    mappingId: "org.example.conformance:house-terms",
    version: "1.0.0",
    title: "Conformance kit house measurement terms (fictitious)",
    system: "Fictitious house size charts",
    systemVersion: "2026",
    provenance: { publisher: "Conformance kit (fictitious)" },
    entries,
  });
  const chest = entry("d2p:body.chest-girth", "exact", "Chest");
  const waist = entry("d2p:body.waist-girth", "exact", "Waist");
  await writeCase({
    level: "referential",
    slug: "mapping-profile-valid",
    title: "A mapping profile with sorted, unique entries is accepted",
    subjects: { "mapping-profile.json": mappingWith([chest, waist]) },
    expect: { outcome: "accept" },
  });
  await writeCase({
    level: "referential",
    slug: "mapping-profile-unsorted",
    title: "A mapping profile whose entries are not sorted by d2pTerm is rejected",
    subjects: { "mapping-profile.json": mappingWith([waist, chest]) },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-014", doc: "mapping-profile.json", at: "/entries/1" }] },
  });
  await writeCase({
    level: "referential",
    slug: "mapping-profile-duplicate-entry",
    title: "A mapping profile that lists the same (d2pTerm, externalTerm) pair twice is rejected",
    subjects: { "mapping-profile.json": mappingWith([chest, { ...clone(chest), relation: "close" }, waist]) },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-005", doc: "mapping-profile.json", at: "/entries/1" }] },
  });
}

// Match points pair a notch on side A with a notch on side B (catalog §3.2.6, D2P-SEM-025).
{
  const withMatchPoints = (change = () => {}) => {
    const p = basePattern("match-points");
    p.pieces.find((x) => x.id === "front").notches = [{ id: "front-side-left-notch", edgeId: "front-side-left", position: 0.25, marks: 1 }];
    p.pieces.find((x) => x.id === "back").notches = [{ id: "back-side-right-notch", edgeId: "back-side-right", position: 0.75, marks: 1 }];
    p.seamConnections.find((c) => c.id === "seam-side-left").matchPoints = [{ notchIdA: "front-side-left-notch", notchIdB: "back-side-right-notch" }];
    change(p);
    return p;
  };
  const sideLeft = (p) => p.seamConnections.findIndex((c) => c.id === "seam-side-left");
  const base = withMatchPoints();
  await writeCase({
    level: "semantic",
    slug: "match-points-on-interfaces",
    title: "A seam connection whose match-point notches lie on the interfaces of their sides is accepted",
    subjects: { "pattern.json": base },
    expect: { outcome: "accept" },
  });
  await writeCase({
    level: "semantic",
    slug: "match-point-wrong-side",
    title: "A match point whose notches are swapped between side A and side B is rejected",
    description: "Both notches exist, but notchIdA names the notch on the back (side B) and notchIdB the notch on the front (side A). Match points tell the sewer which points of the two sides meet (design decision ADR-007.1), so each notch must lie on the interface of its side.",
    subjects: {
      "pattern.json": withMatchPoints((p) => {
        p.seamConnections[sideLeft(p)].matchPoints = [{ notchIdA: "back-side-right-notch", notchIdB: "front-side-left-notch" }];
      }),
    },
    expect: {
      outcome: "reject",
      diagnostics: [
        { code: "D2P-SEM-025", doc: "pattern.json", at: `/seamConnections/${sideLeft(base)}/matchPoints/0/notchIdA` },
        { code: "D2P-SEM-025", doc: "pattern.json", at: `/seamConnections/${sideLeft(base)}/matchPoints/0/notchIdB` },
      ],
    },
  });
  await writeCase({
    level: "semantic",
    slug: "match-point-outside-interval",
    title: "A match-point notch on the right edge but outside the interface's interval is rejected",
    description: "Interface A covers only the upper half (0.5 to 1) of the front side edge, and the notch sits at 0.25 of that edge.",
    subjects: {
      "pattern.json": withMatchPoints((p) => {
        p.seamInterfaces.find((i) => i.id === "si-front-side-left").segments = [{ edgeId: "front-side-left", from: 0.5, to: 1, direction: "forward" }];
      }),
    },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-025", doc: "pattern.json", at: `/seamConnections/${sideLeft(base)}/matchPoints/0/notchIdA` }] },
  });
}

// A measurement definition's unit is the canonical unit of its dimension (catalog §3.3, D2P-SEM-070).
{
  const definition = (local, dimension, unit) => ({
    definitionId: `org.example.conformance:${local}`,
    kind: "body",
    dimension,
    unit,
    path: { type: dimension === "angle" ? "arc" : "girth", description: `Synthetic ${dimension} path of the conformance kit.` },
    landmarks: ["synthetic landmark"],
    posture: "d2p:standing-relaxed",
    state: "d2p:minimal-clothing",
    description: `Synthetic ${dimension} definition of the conformance kit.`,
    status: "active",
  });
  const registryWith = (definitions) => ({
    documentType: "d2p:measurement-definition-registry",
    schemaVersion: V,
    registryId: "org.example.conformance:units",
    version: "1.0.0",
    definitions,
  });
  await writeCase({
    level: "semantic",
    slug: "definition-units-consistent",
    title: "A registry whose definitions use the canonical unit of their dimension is accepted",
    subjects: { "measurement-definition-registry.json": registryWith([definition("body.chest-girth", "length", "mm"), definition("body.shoulder-slope", "angle", "rad")]) },
    expect: { outcome: "accept" },
  });
  await writeCase({
    level: "semantic",
    slug: "definition-unit-mismatch",
    title: "A length definition whose unit is rad is rejected",
    description: "A definition states what is measured, including its canonical unit; a length in radians would make every value of the definition contradict either its unit or its dimension.",
    subjects: { "measurement-definition-registry.json": registryWith([definition("body.chest-girth", "length", "rad"), definition("body.shoulder-slope", "angle", "rad")]) },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-070", doc: "measurement-definition-registry.json", at: "/definitions/0/unit" }] },
  });
}

// Construction commands (catalog §3.6, draft 0.3.0): a 'd2p:pattern.edit' or
// 'd2p:pattern.parameters.update' applied to the base pattern r1. The committed
// r2 content is computed with tools/lib/pattern-edit.mjs; a committed content
// that differs from it is D2P-SEM-131, operation keys are checked against r1.
{
  const POCKET = { id: "pocket", prefix: "p", x0: 1200, w: "pocket-width", h: "pocket-height" };
  const editCommand = (n, type, payload) => ({
    documentType: "d2p:command",
    schemaVersion: V,
    commandId: `cmd_conformance-edit-${n}`,
    idempotencyKey: `conformance-edit-${n}`,
    type,
    target: { artifactId: pattern.artifactId, branch: "main" },
    expectedRevisionId: pattern.revisionId,
    payload,
    actorContext: { actorPrincipalId: "prn_conformance-kit" },
    issuedAt: T2,
  });
  const r2Id = "rev_conformance-square-r2";
  /** Bundle of a committed command: r1 and its record as context, the command, r2 and its record as subjects. */
  const committed = (command, r2) => ({
    subjects: {
      "command.json": command,
      "pattern-r2.json": r2,
      "revision-pattern-r2.json": revisionOf(r2, { sequence: 2, parents: [pattern.revisionId], createdAt: T2, commandId: command.commandId }),
    },
    context: { "pattern-r1.json": pattern, "revision-pattern-r1.json": revisionOf(pattern) },
  });
  /** Instance path of the single operation that applyPatternEdit rejects with `code`. */
  const failedOp = (command, code) => {
    const { problems } = applyPatternEdit(pattern, command.payload.operations);
    if (problems.length !== 1 || problems[0].code !== code) throw new Error(`${command.commandId}: expected exactly one ${code}`);
    return `/payload/operations/${problems[0].op}`;
  };

  const addPocket = editCommand("1", "d2p:pattern.edit", {
    operations: [
      ...[
        ["pocket-width", 120],
        ["pocket-height", 140],
      ].map(([id, value]) => ({ op: "add", collection: "parameters", element: { id, dimension: "length", expr: lit(value) } })),
      ...rectFeatures(POCKET).map((element) => ({ op: "add", collection: "features", element })),
      { op: "add", collection: "pieces", element: rectPiece(POCKET) },
      { op: "add", collection: "seamInterfaces", element: { id: "si-pocket-top", segments: [full("pocket-top")] } },
      { op: "set-name", name: "Conformance kit base pattern with pocket (synthetic)" },
    ],
  });
  const pocketR2 = expectedCommandContent(addPocket, pattern, r2Id);
  await writeCase({
    level: "semantic",
    group: "pattern-edit",
    caseId: "pattern-edit.edit-add-piece",
    slug: "edit-add-piece",
    title: "A pattern edit that adds a rectangular piece, committed with the content its operations yield, is accepted",
    description:
      "The command adds two parameters, the eight point and line features of a pocket, the pocket piece with its closed outer contour and a seam interface on its top edge, and sets the name. The r2 content is the result of applying the operations in order to r1 (added elements appended), with the revisionId of r2.",
    testIds: ["CAD-001", "TOP-001", "UX-005"],
    ...committed(addPocket, pocketR2),
    expect: { outcome: "accept" },
  });
  {
    // Same elements, but the pocket is inserted before the other pieces: authoring order is digest-relevant.
    const r2 = clone(pocketR2);
    r2.pieces.unshift(r2.pieces.pop());
    await writeCase({
      level: "semantic",
      group: "pattern-edit",
      caseId: "pattern-edit.edit-result-mismatch",
      slug: "edit-result-mismatch",
      title: "A pattern edit committed with a content other than its operations yield is rejected",
      description:
        "The r2 content holds the same elements as the result of the operations, but the added pocket piece stands first instead of last. 'add' appends, and the order of a collection is part of the content (catalog §1.8), so r2 is not the result of the command.",
      testIds: ["CAD-001"],
      ...committed(addPocket, r2),
      expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-131", doc: "pattern-r2.json" }] },
    });
  }
  {
    const command = editCommand("2", "d2p:pattern.edit", {
      operations: [
        { op: "add", collection: "parameters", element: { id: "pocket-width", dimension: "length", expr: lit(120) } },
        { op: "add", collection: "pieces", element: rectPiece(PIECES[0]) },
      ],
    });
    await writeCase({
      level: "referential",
      group: "pattern-edit",
      caseId: "pattern-edit.edit-add-existing-key",
      slug: "edit-add-existing-key",
      title: "A pattern edit that adds a piece whose ID already exists in the expected revision is rejected",
      testIds: ["UX-005"],
      subjects: { "command.json": command },
      context: { "pattern-r1.json": pattern, "revision-pattern-r1.json": revisionOf(pattern) },
      expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-005", doc: "command.json", at: failedOp(command, "D2P-REF-005") }] },
    });
  }
  {
    const command = editCommand("3", "d2p:pattern.edit", {
      operations: [
        { op: "remove", collection: "sewingGroups", key: "group-sides" },
        { op: "remove", collection: "seamConnections", key: "seam-shoulder" },
      ],
    });
    await writeCase({
      level: "referential",
      group: "pattern-edit",
      caseId: "pattern-edit.edit-remove-missing-key",
      slug: "edit-remove-missing-key",
      title: "A pattern edit that removes a seam connection the expected revision does not contain is rejected",
      testIds: ["UX-005"],
      subjects: { "command.json": command },
      context: { "pattern-r1.json": pattern, "revision-pattern-r1.json": revisionOf(pattern) },
      expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-003", doc: "command.json", at: failedOp(command, "D2P-REF-003") }] },
    });
  }
  {
    // Removing a bound interface yields a consistent result whose seam connection no longer resolves.
    const command = editCommand("4", "d2p:pattern.edit", { operations: [{ op: "remove", collection: "seamInterfaces", key: "si-front-side-left" }] });
    const r2 = expectedCommandContent(command, pattern, r2Id);
    const at = r2.seamConnections.findIndex((c) => c.interfaceIds.includes("si-front-side-left"));
    await writeCase({
      level: "referential",
      group: "pattern-edit",
      caseId: "pattern-edit.edit-remove-bound-interface",
      slug: "edit-remove-bound-interface",
      title: "A pattern edit that removes a seam interface still bound by a seam connection yields a revision that is rejected",
      description:
        "The committed r2 is exactly the result of the operation, but seam connection 'seam-side-left' still names the removed interface. A change of the seam topology needs a valid rebinding in the same command (design decision ADR-020); without it the result does not resolve.",
      testIds: ["COL-004", "UX-005"],
      ...committed(command, r2),
      expect: { outcome: "reject", diagnostics: [{ code: "D2P-REF-003", doc: "pattern-r2.json", at: `/seamConnections/${at}/interfaceIds/0` }] },
    });
  }
  await writeCase({
    level: "structural",
    group: "pattern-edit",
    caseId: "pattern-edit.edit-remove-with-element",
    slug: "edit-remove-with-element",
    title: "A remove operation that also carries an element is rejected",
    description: "The members of an operation depend on 'op' (schema-enforced): 'remove' takes 'collection' and 'key' only.",
    subjects: {
      "command.json": editCommand("5", "d2p:pattern.edit", {
        operations: [{ op: "remove", collection: "pieces", key: "sleeve", element: rectPiece(PIECES[2]) }],
      }),
    },
    expect: { outcome: "reject", diagnostics: [{ code: "D2P-STR-001", doc: "command.json" }] },
  });

  const update = editCommand("6", "d2p:pattern.parameters.update", { updates: [{ parameterId: "front-width", expr: lit(210) }] });
  const updateR2 = expectedCommandContent(update, pattern, r2Id);
  await writeCase({
    level: "semantic",
    group: "pattern-edit",
    caseId: "pattern-edit.parameter-update-result",
    slug: "parameter-update-result",
    title: "A parameter update committed with the content its updates yield is accepted",
    testIds: ["CAD-001"],
    ...committed(update, updateR2),
    expect: { outcome: "accept" },
  });
  {
    const r2 = clone(updateR2);
    r2.parameters.find((x) => x.id === "front-width").expr = lit(220);
    await writeCase({
      level: "semantic",
      group: "pattern-edit",
      caseId: "pattern-edit.parameter-update-result-mismatch",
      slug: "parameter-update-result-mismatch",
      title: "A parameter update committed with another expression than the command sets is rejected",
      description: "The command sets front-width to 210 mm, the committed r2 holds 220 mm.",
      testIds: ["CAD-001"],
      ...committed(update, r2),
      expect: { outcome: "reject", diagnostics: [{ code: "D2P-SEM-131", doc: "pattern-r2.json" }] },
    });
  }
}

console.log(`generate-conformance-cases: wrote ${written.length} file(s) below ${path.relative(process.cwd(), ROOT) || "."}/conformance`);
