// Golden T-Shirt drape v1 (catalog §4.6): builds the fixture, its negative
// fixtures and the drape conformance cases from the Golden T-Shirt v1 2D and
// 3D fixtures and the pinned vocabulary files. Everything is deterministic.
//
// This module is the independent reference for the body target resolution
// (design rule "body target resolution", catalog §3.9): it implements the rule
// itself and never imports the kit's checks. Only the kit's c14n.mjs is used,
// for digests, as the 3D generator does.
//
// Values are synthetic test data, not a size table, a norm or a solver result:
// the body sizes are invented, the body mesh is a torso and two legs made of
// ring stacks, the drape wraps each flat rest mesh around a cylinder at the
// body, and the fit-map numbers come from the closed-form clearance model
// documented at `fitModel` below.
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  bindingsDigestOf,
  contentDigestOf,
  digestOf,
  drapedMeshDigestOf,
  evaluationKeyOf,
  meshDigestOf,
  quantize,
  resultDigestOf,
  sceneDigestOf,
} from "../../lib/c14n.mjs";
import { meshPiece } from "./garment3d.mjs";

export const FIXTURE_DIR = "fixtures/golden-tshirt-drape/v1";
export const CASE_DIR_NAME = "golden-tshirt-drape";
const TWO_D = "fixtures/golden-tshirt/v1";
const THREE_D = "fixtures/golden-tshirt-3d/v1";
const V = "1.0.0";
const ACTOR = { kind: "system", principalId: "prn_golden-fixture" };
const T_INPUT = "2026-01-08T00:00:00Z";
const T_DERIVED = "2026-01-09T00:00:00Z";
const SIZES = ["size-a", "size-b"];
const COORDS = { handedness: "right", up: "+y", front: "+z" };
const CONVERSION = { from: "mm", to: "m", factor: 0.001 };
const MM_TO_M = 0.001;
const POSE = "d2p:a-pose";
const EVAL_REF_ID = "eval-main";
const ARRANGEMENT_ID = "flat-lay";
const MATERIAL_ID = "material-main";
const RANDOM_SEED = 1;

const REGISTRY_1_0_PATH = "vocabularies/measurement-definitions/measurement-definitions-1.0.0.json";
const REGISTRY_PATH = "vocabularies/measurement-definitions/measurement-definitions-1.1.0.json";
const AVATAR_PATH = "vocabularies/avatar-profiles/standard-a-pose-1.0.0.json";
const SOLVER_PATH = "vocabularies/solver-profiles/fit-approximation-1.0.0.json";
const MATERIAL_PATH = "vocabularies/material-physics-profiles/cotton-woven-1.0.0.json";
const KNIT_MATERIAL_PATH = "vocabularies/material-physics-profiles/cotton-jersey-1.0.0.json";
const MESH_PROFILE_PATH = "vocabularies/mesh-profiles/drape-coarse-1.0.0.json";
const TOLERANCE_PATH = "tolerance-profiles/golden-tshirt-drape-1.0.0.json";
const SAMPLE_CUT_PATH = "vocabularies/validation/profiles/sample-cut-1.0.0.json";

const BODY_SIZES_ID = { artifactId: "art_golden-drape-body-sizes", revisionId: "rev_golden-drape-body-sizes-r1" };
const BODY_PROFILE_ID = { artifactId: "art_golden-drape-body-profile", revisionId: "rev_golden-drape-body-profile-r1" };
const PERSONAL_PROFILE_ID = { artifactId: "art_golden-drape-individual-profile", revisionId: "rev_golden-drape-individual-profile-r1" };
const PERSONAL_GARMENT_ID = { artifactId: "art_golden-drape-individual-garment", revisionId: "rev_golden-drape-individual-garment-r1" };
const NO_HEIGHT_PROFILE_ID = { artifactId: "art_golden-drape-body-profile-without-height", revisionId: "rev_golden-drape-body-profile-without-height-r1" };

/**
 * Synthetic body sizes (mm). Not a size table: the values are invented so that
 * T-shirt size A (garment chest girth 1020 mm in the 2D fixture) and size B
 * (1140 mm) both enclose both bodies, size A closer-fitting than size B.
 */
const BODY_SIZES = [
  {
    sizeKey: "body-m",
    label: "M",
    ordinal: 1,
    values: { "arm-length": 600, "chest-girth": 920, height: 1700, "hip-girth": 960, "neck-girth": 370, "shoulder-width": 420, "waist-girth": 780, "waist-height": 1060 },
  },
  {
    sizeKey: "body-l",
    label: "L",
    ordinal: 2,
    values: { "arm-length": 620, "chest-girth": 980, height: 1760, "hip-girth": 1020, "neck-girth": 390, "shoulder-width": 440, "waist-girth": 840, "waist-height": 1100 },
  },
];
const BASELINE_KEY = "body-l";
/** The synthetic body profile overrides two table values of its baseline body-l. */
const PROFILE_OVERRIDES = { "chest-girth": 960, "arm-length": 640 };
/** Individual profile of the personal cases (synthetic values standing in for personal measurements). */
const PERSONAL_VALUES = { "arm-length": 590, "chest-girth": 935, height: 1680, "hip-girth": 975, "shoulder-width": 415, "waist-girth": 812 };
/** Deterministic synthetic deviations (mm) of measured control measures, by control-measure index. */
const DEVIATIONS = [0.4, -0.3, 0.2, -0.1, 0.5, -0.6, 0.3, 0];

const body = (local) => `d2p:body.${local}`;
const clone = (x) => structuredClone(x);
const q = (n) => {
  const v = quantize(n);
  return Object.is(v, -0) ? 0 : v;
};
const round1 = (n) => q(Math.round(n * 10) / 10);
const round3 = (n) => q(Math.round(n * 1000) / 1000);
const round5 = (n) => q(Math.round(n * 1e5) / 1e5);
const toM = (p) => p.map((v) => q(v * MM_TO_M));
const cmp = (x, y) => (x === y ? 0 : x < y ? -1 : 1);
const sortBy = (list, ...keys) =>
  [...list].sort((a, b) => {
    for (const k of keys) {
      const c = cmp(typeof k === "function" ? k(a) : a[k], typeof k === "function" ? k(b) : b[k]);
      if (c) return c;
    }
    return 0;
  });
const json = (doc) => `${JSON.stringify(doc, null, 2)}\n`;
const versioned = (doc) => ({ id: doc.profileId ?? doc.registryId, version: doc.version });
const artifactRef = (doc) => ({ artifactId: doc.artifactId, revisionId: doc.revisionId });
const derivedRef = (id, digest) => ({ id, digest });

function loadJson(root, rel) {
  return JSON.parse(readFileSync(path.join(root, rel), "utf8"));
}

// ---------------------------------------------------------------------------
// Body target resolution (independent implementation of the shared rule)

/**
 * Source values S(d) of a body source: Map definitionId -> {value, origin}.
 * A size entry yields origin 'size-table'; a profile value yields 'size-table'
 * when its method is 'size-table', else 'profile'.
 */
export function sourceValues(source, docs) {
  const out = new Map();
  if (source.kind === "size-entry") {
    const entry = docs.sizeSystem.sizes.find((s) => s.sizeKey === source.sizeKey);
    for (const m of entry?.measurements ?? []) out.set(m.definitionId, { value: m.value, origin: "size-table" });
  } else {
    for (const m of docs.profile.measurements) out.set(m.definitionId, { value: m.value, origin: m.method === "size-table" ? "size-table" : "profile" });
  }
  return out;
}

/**
 * Resolves the targets of every controlled definition of an avatar profile
 * (required ∪ derived), in definitionId order. Returns
 * { controlMeasures: [{definitionId, origin, targetMm}], missingDefinitions, status }.
 */
export function resolveTargets(values, avatar) {
  const derivations = new Map((avatar.derivations ?? []).map((d) => [d.definitionId, d]));
  const controlled = [...new Set([...avatar.requiredDefinitions, ...derivations.keys()])].sort(cmp);
  const controlMeasures = [];
  const missingDefinitions = [];
  for (const d of controlled) {
    const s = values.get(d);
    if (s) {
      controlMeasures.push({ definitionId: d, origin: s.origin, targetMm: s.value });
      continue;
    }
    const rule = derivations.get(d);
    if (rule && rule.terms.every((t) => values.has(t.definitionId))) {
      // binary64, left to right in term order
      let t = rule.interceptMm;
      for (const term of rule.terms) t += term.coefficient * values.get(term.definitionId).value;
      controlMeasures.push({ definitionId: d, origin: "inferred", targetMm: q(t) });
      continue;
    }
    if (avatar.requiredDefinitions.includes(d)) missingDefinitions.push(d);
  }
  return { controlMeasures, missingDefinitions, status: missingDefinitions.length ? "failed" : "succeeded" };
}

const toleranceOf = (avatar, definitionId) => avatar.tolerances.find((t) => t.definitionId === definitionId).maxDeviationMm;

// ---------------------------------------------------------------------------
// Measurement inputs

function synthMeasurement(local, value) {
  return {
    definitionId: body(local),
    value,
    unit: "mm",
    method: "size-table",
    source: { kind: "synthetic", description: "Synthetic, non-normative test value of the Golden T-Shirt drape fixture; not taken from a size table, a norm or a measured person." },
    uncertainty: { type: "symmetric", plusMinus: 5 },
  };
}

function bodySizes() {
  return {
    documentType: "d2p:size-system",
    schemaVersion: V,
    ...BODY_SIZES_ID,
    name: "Golden drape synthetic bodies M and L",
    issuer: { kind: "synthetic", name: "Golden drape bodies" },
    definitionRegistries: [{ id: "d2p:measurement-definitions", version: "1.1.0" }],
    sizes: BODY_SIZES.map((s) => ({
      sizeKey: s.sizeKey,
      label: s.label,
      ordinal: s.ordinal,
      measurements: sortBy(Object.entries(s.values).map(([k, v]) => synthMeasurement(k, v)), "definitionId"),
    })),
  };
}

function bodyProfile(sizes) {
  const entry = sizes.sizes.find((s) => s.sizeKey === BASELINE_KEY);
  return {
    documentType: "d2p:body-measurement-profile",
    schemaVersion: V,
    ...BODY_PROFILE_ID,
    subject: { kind: "synthetic", pseudonym: "Synthetic figure P" },
    dataClassification: "public",
    definitionRegistries: [{ id: "d2p:measurement-definitions", version: "1.1.0" }],
    baseline: { sizeSystemRef: artifactRef(sizes), sizeKey: BASELINE_KEY },
    measurements: entry.measurements.map((m) => {
      const local = m.definitionId.slice("d2p:body.".length);
      if (PROFILE_OVERRIDES[local] === undefined) {
        return { definitionId: m.definitionId, value: m.value, unit: m.unit, method: "size-table", source: { kind: "size-table" }, uncertainty: clone(m.uncertainty) };
      }
      return {
        definitionId: m.definitionId,
        value: PROFILE_OVERRIDES[local],
        unit: "mm",
        method: "manual",
        source: { kind: "self-measured", description: "Synthetic override of the baseline value (test data)." },
        measuredAt: T_INPUT,
        uncertainty: { type: "symmetric", plusMinus: 10 },
      };
    }),
  };
}

function personalProfile() {
  return {
    documentType: "d2p:body-measurement-profile",
    schemaVersion: V,
    ...PERSONAL_PROFILE_ID,
    subject: { kind: "individual", pseudonym: "subject-0002" },
    dataClassification: "sensitive-personal",
    definitionRegistries: [{ id: "d2p:measurement-definitions", version: "1.1.0" }],
    measurements: sortBy(
      Object.entries(PERSONAL_VALUES).map(([k, v]) => ({
        definitionId: body(k),
        value: v,
        unit: "mm",
        method: "manual",
        source: { kind: "professional", description: "Synthetic value standing in for a personal measurement (test data)." },
        measuredAt: T_INPUT,
        uncertainty: { type: "symmetric", plusMinus: 5 },
      })),
      "definitionId",
    ),
  };
}

function artifactMeta(doc, artifactType, name, dataClassification) {
  return { documentType: "d2p:artifact", schemaVersion: V, artifactId: doc.artifactId, artifactType, name, dataClassification, createdAt: T_INPUT, createdBy: ACTOR };
}

function revisionRecord(doc, message) {
  return {
    documentType: "d2p:revision",
    schemaVersion: V,
    revisionId: doc.revisionId,
    artifactId: doc.artifactId,
    sequence: 1,
    parentRevisionIds: [],
    contentDigest: contentDigestOf(doc),
    createdAt: T_INPUT,
    author: ACTOR,
    message,
  };
}

// ---------------------------------------------------------------------------
// Garments: the Golden T-Shirt 3D garment r1 plus body bindings and drape configurations

const garmentId = (s) => ({ artifactId: `art_golden-tshirt-drape-garment-${s}`, revisionId: `rev_golden-tshirt-drape-garment-${s}-r1` });
const sizeLabel = (s) => s.slice(-1).toUpperCase();
const AVATAR_REF = { id: "d2p:standard-a-pose", version: "1.0.0" };
const SOLVER_REF = { id: "d2p:fit-approximation", version: "1.0.0" };
const MATERIAL_REF = { id: "d2p:cotton-woven", version: "1.0.0" };
const TOLERANCE_REF = { id: "d2p:golden-tshirt-drape", version: "1.0.0" };

const sizeEntrySource = (sizeKey) => ({ kind: "size-entry", sizeSystemRef: { ...BODY_SIZES_ID }, sizeKey });
const profileSource = (ref) => ({ kind: "body-measurement-profile", bodyMeasurementProfileRef: { ...ref } });

function configuration(id, bodyBindingId, materialProfile = MATERIAL_REF) {
  return {
    id,
    bodyBindingId,
    patternEvaluationId: EVAL_REF_ID,
    arrangementId: ARRANGEMENT_ID,
    solverProfile: { ...SOLVER_REF },
    materials: [{ materialAssignmentId: MATERIAL_ID, materialPhysicsProfile: { ...materialProfile } }],
    randomSeed: RANDOM_SEED,
  };
}

function garment(base3d, s) {
  const g = clone(base3d);
  Object.assign(g, garmentId(s));
  g.name = `Golden T-Shirt drape, size ${sizeLabel(s)}`;
  g.description = `Synthetic garment of the Golden T-Shirt drape fixture: the Golden T-Shirt 3D garment r1 of size ${sizeLabel(s)} (same panels, sewing bindings, material and flat-lay arrangement) with two body bindings, the reference body M of the synthetic body sizes and the synthetic body profile P, and one fit-approximation drape configuration per binding. Test data, not a design or norm.`;
  g.bodyBindings = [
    { id: "body-m", name: "Synthetic body M", source: sizeEntrySource("body-m"), avatarProfile: { ...AVATAR_REF }, pose: POSE },
    { id: "body-profile", name: "Synthetic figure P", source: profileSource(BODY_PROFILE_ID), avatarProfile: { ...AVATAR_REF }, pose: POSE },
  ];
  g.simulationConfigurations = [configuration("drape-body-m", "body-m"), configuration("drape-body-profile", "body-profile")];
  return g;
}

/** Case garment of the personal chain: size A bound to an individual profile only. */
function personalGarment(base3d) {
  const g = clone(base3d);
  Object.assign(g, PERSONAL_GARMENT_ID);
  g.name = "Golden T-Shirt drape, size A, individual body";
  g.description = "Conformance-case garment: the Golden T-Shirt 3D garment r1 of size A bound to one individual body measurement profile (sensitive-personal, synthetic values) with one fit-approximation drape configuration. Test data.";
  g.bodyBindings = [{ id: "body-own", source: profileSource(PERSONAL_PROFILE_ID), avatarProfile: { ...AVATAR_REF }, pose: POSE }];
  g.simulationConfigurations = [configuration("drape-body-own", "body-own")];
  return g;
}

// ---------------------------------------------------------------------------
// Body model snapshots (synthetic ring mesh)

const RING_SEGMENTS = 16;
const DEPTH_RATIO = 0.75; // half-depth / half-width of every torso ring; leg rings are round
const LEG_DEPTH_RATIO = 1;
const SEAT_GIRTH_RATIO = 0.95; // seat ring at crotch height: 0.95 × hip girth, so the hip stays the widest lower-torso girth

/** Perimeter of the RING_SEGMENTS-gon inscribed in the ellipse with half-axes (1, depth). */
function unitRingPerimeter(depth) {
  let p = 0;
  for (let k = 0; k < RING_SEGMENTS; k += 1) {
    const a = (2 * Math.PI * k) / RING_SEGMENTS;
    const b = (2 * Math.PI * (k + 1)) / RING_SEGMENTS;
    p += Math.hypot(Math.sin(b) - Math.sin(a), depth * (Math.cos(b) - Math.cos(a)));
  }
  return p;
}
const UNIT_RING_PERIMETER = unitRingPerimeter(DEPTH_RATIO);
const UNIT_LEG_PERIMETER = unitRingPerimeter(LEG_DEPTH_RATIO);

/**
 * Figure of a body model (mm): torso ring stack, one leg ring stack per leg
 * and the leg offset. Girths whose control measure exists are the measured
 * values, so every ring perimeter of the mesh is the measured girth (one leg
 * per leg girth); missing values fall back to the proportions of the standard
 * A-pose profile applied to a 1700 mm figure (only the negative fixture of a
 * source without height needs that). The torso starts with a seat ring at
 * crotch height; the legs are round and touch at the centre line, so below
 * the hip neither the seat nor the hull of both legs is wider than the hip.
 * The mesh has no arms: arm length and shoulder width are represented by
 * landmarks only, and the upper-arm, wrist and underbust girths, back width,
 * back length and shoulder length are not measured on it.
 */
function figureOf(measured) {
  const v = (local, fallback) => measured.get(body(local)) ?? fallback;
  const height = v("height", 1700);
  const chest = v("chest-girth", 920);
  const hip = v("hip-girth", 960);
  const crotchY = v("inside-leg-length", 0.46 * height);
  const kneeY = v("knee-height", 0.285 * height);
  const ankleY = 0.04 * height;
  const legRings = [
    { name: "ankle", y: ankleY, girth: v("ankle-girth", 0.13 * height) },
    { name: "calf", y: (ankleY + kneeY) / 2 + 0.05 * height, girth: v("calf-girth", 0.37 * hip) },
    { name: "knee", y: kneeY, girth: v("knee-girth", 0.36 * hip) },
    { name: "thigh", y: crotchY, girth: v("thigh-girth", 0.57 * hip) },
  ];
  const fig = {
    height,
    shoulderWidth: v("shoulder-width", 420),
    armLength: v("arm-length", 600),
    cervicale: v("cervicale-height", 0.845 * height),
    rings: [
      { name: "seat", y: crotchY, girth: SEAT_GIRTH_RATIO * hip },
      { name: "hip", y: v("hip-height", 0.5 * height), girth: hip },
      { name: "waist", y: v("waist-height", 0.63 * height), girth: v("waist-girth", 780) },
      { name: "chest", y: v("bust-height", 0.72 * height), girth: chest },
      { name: "shoulder", y: v("cervicale-height", 0.845 * height) - 40, girth: Math.PI * v("shoulder-width", 420) * 0.8 },
      { name: "neck", y: v("cervicale-height", 0.845 * height), girth: v("neck-girth", 0.38 * chest) },
      { name: "head", y: height - 0.11 * height, girth: v("head-girth", 220 + 0.2 * height) },
    ],
    legRings,
    legOffset: Math.max(...legRings.map((r) => legHalfWidthOf(r.girth))),
  };
  // Below the hip ring nothing is wider than the hip: the seat ring, and the
  // hull of both legs (two leg rings and the two tangents between them).
  for (const r of fig.legRings) invariant(r.girth + 4 * fig.legOffset <= hip, `leg ${r.name}: the hull of both legs is not wider than the hip girth`);
  invariant(fig.rings[0].girth <= hip && fig.rings[0].y < fig.rings[1].y, "seat ring below and not wider than the hip");
  return fig;
}

/** Generator invariant of the synthetic figure (throws; not a fixture check). */
function invariant(cond, what) {
  if (!cond) throw new Error(`Golden T-Shirt drape figure invariant failed: ${what}`);
}

const halfWidthOf = (girth) => girth / UNIT_RING_PERIMETER;
const legHalfWidthOf = (girth) => girth / UNIT_LEG_PERIMETER;

/**
 * Ring stack mesh: the rings (centre x `cx`, half-width per ring by
 * `halfWidth`, half-depth `depth` × half-width) closed by a cap vertex below
 * and above. Appends to `positions` and `triangles`.
 */
function ringStack(positions, triangles, rings, { cx = 0, depth, halfWidth, bottomY, topY }) {
  const n = RING_SEGMENTS;
  const first = positions.length;
  for (const r of rings) {
    const a = halfWidth(r.girth);
    for (let k = 0; k < n; k += 1) {
      const phi = (2 * Math.PI * k) / n; // 0 at the front (+Z), increasing towards +X (wearer's left)
      positions.push(toM([cx + a * Math.sin(phi), r.y, depth * a * Math.cos(phi)]));
    }
  }
  const bottom = positions.length;
  positions.push(toM([cx, bottomY, 0]));
  const top = positions.length;
  positions.push(toM([cx, topY, 0]));
  for (let i = 0; i + 1 < rings.length; i += 1) {
    for (let k = 0; k < n; k += 1) {
      const a0 = first + i * n + k;
      const a1 = first + i * n + ((k + 1) % n);
      const b0 = a0 + n;
      const b1 = a1 + n;
      triangles.push([a0, a1, b1], [a0, b1, b0]);
    }
  }
  const last = first + (rings.length - 1) * n;
  for (let k = 0; k < n; k += 1) {
    triangles.push([bottom, first + ((k + 1) % n), first + k]);
    triangles.push([top, last + k, last + ((k + 1) % n)]);
  }
}

/** Body mesh: the torso stack (seat to head, capped at crotch height and at the vertex) and two leg stacks (floor to crotch). */
function bodyMesh(fig) {
  const positionsM = [];
  const triangles = [];
  ringStack(positionsM, triangles, fig.rings, { depth: DEPTH_RATIO, halfWidth: halfWidthOf, bottomY: fig.rings[0].y, topY: fig.height });
  for (const side of [1, -1]) {
    const thigh = fig.legRings.at(-1);
    ringStack(positionsM, triangles, fig.legRings, { cx: side * fig.legOffset, depth: LEG_DEPTH_RATIO, halfWidth: legHalfWidthOf, bottomY: 0, topY: thigh.y });
  }
  return { positionsM, triangles };
}

function landmarksOf(fig, avatar) {
  const ring = (name) => fig.rings.find((r) => r.name === name);
  const leg = (name) => fig.legRings.find((r) => r.name === name);
  const a = (name) => halfWidthOf(ring(name).girth);
  const la = (name) => legHalfWidthOf(leg(name).girth);
  const sh = [fig.shoulderWidth / 2, ring("shoulder").y, 0];
  const arm = [Math.sin(Math.PI / 4), -Math.cos(Math.PI / 4)]; // A-pose: arms 45 degrees from the body
  const along = (side, t) => [side * (sh[0] + arm[0] * t), sh[1] + arm[1] * t, 0];
  const pos = {
    "ankle-left": [fig.legOffset + la("ankle"), leg("ankle").y, 0],
    "ankle-right": [-fig.legOffset - la("ankle"), leg("ankle").y, 0],
    "armpit-left": [a("chest"), ring("chest").y, 0],
    "armpit-right": [-a("chest"), ring("chest").y, 0],
    "bust-point-left": [a("chest") / 2, ring("chest").y, DEPTH_RATIO * a("chest")],
    "bust-point-right": [-a("chest") / 2, ring("chest").y, DEPTH_RATIO * a("chest")],
    crotch: [0, ring("seat").y, 0],
    "elbow-left": along(1, 0.45 * fig.armLength),
    "elbow-right": along(-1, 0.45 * fig.armLength),
    "hip-left": [a("hip"), ring("hip").y, 0],
    "hip-right": [-a("hip"), ring("hip").y, 0],
    "knee-left": [fig.legOffset, leg("knee").y, LEG_DEPTH_RATIO * la("knee")],
    "knee-right": [-fig.legOffset, leg("knee").y, LEG_DEPTH_RATIO * la("knee")],
    nape: [0, fig.cervicale, -DEPTH_RATIO * a("neck")],
    "shoulder-point-left": sh,
    "shoulder-point-right": [-sh[0], sh[1], 0],
    "side-neck-left": [a("neck"), fig.cervicale, 0],
    "side-neck-right": [-a("neck"), fig.cervicale, 0],
    vertex: [0, fig.height, 0],
    "waist-left": [a("waist"), ring("waist").y, 0],
    "waist-right": [-a("waist"), ring("waist").y, 0],
    "wrist-left": along(1, fig.armLength),
    "wrist-right": along(-1, fig.armLength),
  };
  return avatar.landmarks.map((l) => {
    const p = pos[l.landmarkId.slice("d2p:landmark.".length)];
    if (!p) throw new Error(`no synthetic position for landmark ${l.landmarkId}`);
    return { landmarkId: l.landmarkId, positionM: toM(p) };
  });
}

const BODY_BACKEND = { backendId: "conformance-kit-ring-body", backendVersion: "1.0.0", adapterVersion: "1.0.0" };

/**
 * Body model snapshot of a source. `resolved` is resolveTargets of that
 * source; `forceSucceeded` builds a succeeded model even when a required
 * definition is missing (negative fixture).
 */
function bodyModel(id, source, sourceDoc, resolved, ctx, { personal = false, forceSucceeded = false } = {}) {
  const { avatar, registry } = ctx;
  const sourceDigest =
    source.kind === "size-entry"
      ? { role: "size-system", artifactRef: clone(source.sizeSystemRef), digest: contentDigestOf(sourceDoc) }
      : { role: "body-measurement-profile", artifactRef: clone(source.bodyMeasurementProfileRef), digest: contentDigestOf(sourceDoc) };
  const doc = {
    documentType: "d2p:body-model-snapshot",
    schemaVersion: V,
    bodyModelId: id,
    createdAt: T_DERIVED,
    source: clone(source),
    avatarProfile: { ...AVATAR_REF },
    pose: avatar.pose,
    backend: BODY_BACKEND,
    inputDigests: sortBy(
      [
        { role: "avatar-profile", id: versioned(avatar), digest: digestOf(avatar) },
        { role: "measurement-definition-registry", id: versioned(registry), digest: digestOf(registry) },
        sourceDigest,
      ],
      "role",
    ),
    status: forceSucceeded ? "succeeded" : resolved.status,
  };
  if (doc.status === "failed") {
    Object.assign(doc, {
      controlMeasures: resolved.controlMeasures,
      diagnostics: [{ code: "D2P-SEM-127", severity: "error", message: `required body definitions without a value: ${resolved.missingDefinitions.join(", ")}` }],
    });
  } else {
    const controlMeasures = resolved.controlMeasures.map((c, i) => {
      const measuredMm = round3(c.targetMm + DEVIATIONS[i % DEVIATIONS.length]);
      return { ...c, measuredMm, deviationMm: round3(measuredMm - c.targetMm) };
    });
    const fig = figureOf(new Map(controlMeasures.map((c) => [c.definitionId, c.measuredMm])));
    Object.assign(doc, {
      coordinateSystem: COORDS,
      sceneUnit: "m",
      unitConversion: CONVERSION,
      mesh: bodyMesh(fig),
      landmarks: landmarksOf(fig, avatar),
      controlMeasures,
      diagnostics: [],
    });
    doc.meshDigest = meshDigestOf(doc);
  }
  if (personal) doc.personalDerived = true;
  doc.resultDigest = resultDigestOf(doc, ["bodyModelId"]);
  return doc;
}

function bodyModelExpectation(id, source, resolved, avatar) {
  const doc = {
    documentType: "d2p:body-model-expectation",
    schemaVersion: V,
    expectationId: id,
    source: clone(source),
    avatarProfile: { ...AVATAR_REF },
    expectedStatus: resolved.status,
    controlMeasures: resolved.controlMeasures.map((c) => ({ ...c, maxDeviationMm: toleranceOf(avatar, c.definitionId) })),
  };
  if (resolved.missingDefinitions.length) doc.missingDefinitions = resolved.missingDefinitions;
  doc.toleranceProfile = { ...TOLERANCE_REF };
  return doc;
}

// ---------------------------------------------------------------------------
// Drape chain: rest meshes, draped meshes, scene, fit map, simulation report

const MESH_BACKEND = { backendId: "conformance-kit-boundary-mesher", backendVersion: "1.0.0", adapterVersion: "1.0.0" };
const DRAPE_BACKEND = { backendId: "conformance-kit-cylinder-drape", backendVersion: "1.0.0", adapterVersion: "1.0.0" };
const SCENE_BUILDER = { name: "d2p-conformance-scene-builder", version: "1.0.0" };
const SHOULDER_LIFT_MM = 10; // top edge of the body panels above the cervicale height
const BODY_OFFSET_MM = 2; // collision body offset of d2p:fit-approximation 1.0.0
const short = (panelId) => panelId.replace(/^panel-/, "");

function restMesh(g, panel, piece, profile, tag) {
  const meshed = meshPiece(piece, profile.sampling.maxChordDeviationMm);
  const pin = g.patternEvaluations[0];
  const doc = {
    documentType: "d2p:panel-mesh-result",
    schemaVersion: V,
    meshResultId: `pmr_golden-drape-${tag}-${short(panel.id)}`,
    createdAt: T_DERIVED,
    garmentRef: artifactRef(g),
    panelInstanceId: panel.id,
    pieceId: panel.pieceId,
    cutInstanceKey: panel.cutInstanceKey,
    evaluationRef: clone(pin.evaluationRef),
    geometryDigest: pin.geometryDigest,
    meshProfile: versioned(profile),
    backend: MESH_BACKEND,
    status: "succeeded",
    mesh: meshed.mesh,
    vertexUvToPattern2D: meshed.vertexUvToPattern2D,
    edgeBindings: meshed.edgeBindings,
    maxApproximationErrorMm: meshed.maxApproximationErrorMm,
    diagnostics: [],
  };
  doc.meshDigest = meshDigestOf(doc);
  doc.resultDigest = resultDigestOf(doc, ["meshResultId"]);
  return doc;
}

/**
 * Closed-form clearance model of the synthetic drape (mm). The body panels
 * are wrapped around a vertical cylinder whose circumference is the garment
 * girth (front width + back width = d2p:garment.chest-girth of the 2D
 * fixture); the sleeves around a cylinder whose circumference is the sleeve
 * width, hanging 45 degrees from the shoulder (A-pose). The body at height y
 * is the circle of the same girth as the body model ring there (linear
 * between rings). Clearance = cloth radius − body radius, never less than the
 * solver's body offset; strain and contact pressure follow from clearance:
 * strain = 0.02 × max(0, 1 − clearance / 50), contact (clearance at the body
 * offset) carries its strain as contact pressure.
 */
function fitModel(fig, garmentGirth, sleeveWidth, upperArmGirth) {
  const R = garmentGirth / (2 * Math.PI);
  const Rs = sleeveWidth / (2 * Math.PI);
  const rings = fig.rings;
  const bodyRadius = (y) => {
    if (y <= rings[0].y) return rings[0].girth / (2 * Math.PI);
    for (let i = 1; i < rings.length; i += 1) {
      if (y <= rings[i].y) {
        const t = (y - rings[i - 1].y) / (rings[i].y - rings[i - 1].y);
        return (rings[i - 1].girth + t * (rings[i].girth - rings[i - 1].girth)) / (2 * Math.PI);
      }
    }
    return rings.at(-1).girth / (2 * Math.PI);
  };
  const clearance = (raw) => Math.max(BODY_OFFSET_MM, raw);
  const strainOf = (c) => 0.02 * Math.max(0, 1 - c / 50);
  return {
    R,
    Rs,
    torso: (y) => clearance(R - bodyRadius(y)),
    sleeve: () => clearance(Rs - upperArmGirth / (2 * Math.PI)),
    strainOf,
    pressureOf: (c) => (c <= BODY_OFFSET_MM ? strainOf(c) : 0),
  };
}

/** Draped positions (mm) of a rest mesh: cylinder wrap of the body panels and sleeves. */
function drapePositions(panel, piece, rest, model, fig, mirrored) {
  const bb = piece.boundingBox;
  const cx = (bb.min[0] + bb.max[0]) / 2;
  const topY = fig.cervicale + SHOULDER_LIFT_MM;
  return rest.mesh.positions.map(([x, y]) => {
    if (panel.pieceId === "front" || panel.pieceId === "back") {
      // Garment x: the front keeps the panel x, the back is turned 180 degrees about +Y.
      const u = panel.pieceId === "front" ? x - cx : -(x - cx);
      const theta = u / model.R;
      const z = model.R * Math.cos(theta);
      return [model.R * Math.sin(theta), topY + (y - bb.max[1]), panel.pieceId === "front" ? z : -z];
    }
    const side = mirrored ? -1 : 1;
    const xs = mirrored ? -(x - cx) : x - cx;
    const t = bb.max[1] - y; // distance from the cap top along the arm
    const theta = xs / model.Rs;
    const d = [side * Math.sin(Math.PI / 4), -Math.cos(Math.PI / 4), 0]; // arm direction
    const n = [side * Math.cos(Math.PI / 4), Math.sin(Math.PI / 4), 0]; // up and outwards, perpendicular to d
    const anchor = [side * (model.R + model.Rs), topY - model.Rs, 0];
    return [0, 1, 2].map((k) => anchor[k] + d[k] * t + model.Rs * (Math.cos(theta) * n[k] + Math.sin(theta) * (k === 2 ? 1 : 0)));
  });
}

/**
 * Full drape of one garment configuration on one body model: four rest
 * meshes, four draped meshes, the scene input and snapshot, the fit map and
 * the simulation report. `tag` names the documents.
 */
function drapeChain(ctx, { tag, g, size, configId, bodyDoc, bodySourceDigest, personal }) {
  const { avatar, solver, material, meshProfile, pattern, snapshot2d, scene3d } = ctx;
  const config = g.simulationConfigurations.find((c) => c.id === configId);
  const snap = snapshot2d[size];
  const pieceOf = (id) => snap.pieces.find((p) => p.pieceId === id);
  const rests = new Map();
  for (const panel of g.panelInstances) rests.set(panel.id, restMesh(g, panel, pieceOf(panel.pieceId), meshProfile, tag));

  const measured = new Map(bodyDoc.controlMeasures.map((c) => [c.definitionId, c.measuredMm]));
  const fig = figureOf(measured);
  const width = (id) => pieceOf(id).boundingBox.max[0] - pieceOf(id).boundingBox.min[0];
  const garmentGirth = width("front") + width("back");
  const model = fitModel(fig, garmentGirth, width("sleeve"), measured.get(body("upper-arm-girth")));
  const mirroredOf = (panel) => Boolean(pattern.pieces.find((p) => p.id === panel.pieceId).cutInstruction?.instances?.find((i) => i.cutInstanceKey === panel.cutInstanceKey)?.mirrored);

  const draped = new Map();
  const drapedMm = new Map();
  for (const panel of g.panelInstances) {
    const rest = rests.get(panel.id);
    const mm = drapePositions(panel, pieceOf(panel.pieceId), rest, model, fig, mirroredOf(panel));
    drapedMm.set(panel.id, mm);
    const doc = {
      documentType: "d2p:draped-panel-mesh",
      schemaVersion: V,
      drapedMeshId: `dpm_golden-drape-${tag}-${short(panel.id)}`,
      createdAt: T_DERIVED,
      garmentRef: artifactRef(g),
      simulationConfigurationId: configId,
      panelInstanceId: panel.id,
      restMeshRef: derivedRef(rest.meshResultId, rest.resultDigest),
      restMeshDigest: rest.meshDigest,
      positionsM: mm.map(toM),
    };
    if (personal) doc.personalDerived = true;
    doc.diagnostics = [];
    doc.meshDigest = drapedMeshDigestOf(doc);
    doc.resultDigest = resultDigestOf(doc, ["drapedMeshId"]);
    draped.set(panel.id, doc);
  }

  const input = {
    documentType: "d2p:scene-input",
    schemaVersion: V,
    sceneInputId: `sci_golden-drape-${tag}`,
    createdAt: T_DERIVED, // not before the body model it pins
    garmentRef: artifactRef(g),
    arrangementId: ARRANGEMENT_ID,
    mode: "physical-simulation",
    meshProfile: versioned(meshProfile),
    toleranceProfile: { ...TOLERANCE_REF },
    patternEvaluations: g.patternEvaluations.map((e) => ({ patternEvaluationId: e.id, evaluationRef: clone(e.evaluationRef), geometryDigest: e.geometryDigest })),
    simulationConfigurationId: configId,
    bodyModelRef: derivedRef(bodyDoc.bodyModelId, bodyDoc.resultDigest),
  };
  input.evaluationKey = evaluationKeyOf(input);

  const materialDigests = config.materials.map((m) => ({ role: "material-physics-profile", id: clone(m.materialPhysicsProfile), digest: digestOf(material) }));
  const scene = {
    documentType: "d2p:scene-snapshot",
    schemaVersion: V,
    sceneSnapshotId: `ssn_golden-drape-${tag}`,
    createdAt: T_DERIVED,
    sceneInputRef: derivedRef(input.sceneInputId, contentDigestOf(input)),
    garmentRef: artifactRef(g),
    arrangementId: ARRANGEMENT_ID,
    mode: "physical-simulation",
    evaluationKey: input.evaluationKey,
    coordinateSystem: COORDS,
    sceneUnit: "m",
    unitConversion: CONVERSION,
    inputDigests: sortBy(
      [
        { role: "avatar-profile", id: versioned(avatar), digest: digestOf(avatar) },
        bodySourceDigest,
        { role: "garment", artifactRef: artifactRef(g), digest: contentDigestOf(g) },
        ...materialDigests,
        { role: "mesh-profile", id: versioned(meshProfile), digest: digestOf(meshProfile) },
        { role: "pattern", artifactRef: clone(g.patternEvaluations[0].patternRef), digest: contentDigestOf(pattern) },
        { role: "solver-profile", id: versioned(solver), digest: digestOf(solver) },
      ],
      "role",
    ),
    patternEvaluations: clone(input.patternEvaluations),
    meshProfile: versioned(meshProfile),
    backendBuild: { sceneBuilder: SCENE_BUILDER, mesher: MESH_BACKEND },
    panelBindings: clone(scene3d[size].panelBindings),
    seamBindings: clone(scene3d[size].seamBindings),
    controlMeasures: clone(scene3d[size].controlMeasures),
    meshRefs: sortBy([...rests.values()].map((m) => ({ panelInstanceId: m.panelInstanceId, meshResultRef: derivedRef(m.meshResultId, m.resultDigest), meshDigest: m.meshDigest })), "panelInstanceId"),
    simulationConfigurationId: configId,
    bodyModelRef: clone(input.bodyModelRef),
    drapedMeshRefs: sortBy([...draped.values()].map((d) => ({ panelInstanceId: d.panelInstanceId, drapedMeshRef: derivedRef(d.drapedMeshId, d.resultDigest), meshDigest: d.meshDigest })), "panelInstanceId"),
  };
  if (personal) scene.personalDerived = true;
  scene.qualityStatus = "preview";
  scene.diagnostics = [];
  scene.bindingsDigest = bindingsDigestOf(scene);
  scene.sceneDigest = sceneDigestOf(scene);

  // Fit map: zone values from the closed-form model at the zone height, vertex values per draped vertex.
  const ring = (name) => fig.rings.find((r) => r.name === name);
  const torsoPanels = ["panel-back", "panel-front"];
  const sleevePanels = ["panel-sleeve-left", "panel-sleeve-right"];
  const zoneOf = (zone, panelInstanceIds, meanClearance, minClearance) => {
    const meanStrain = model.strainOf(meanClearance);
    return {
      zone: zone.zone,
      landmarkIds: [...zone.landmarkIds],
      panelInstanceIds,
      meanStrain: round5(meanStrain),
      maxStrain: round5(model.strainOf(minClearance)),
      meanClearanceMm: round1(meanClearance),
      minClearanceMm: round1(minClearance),
      contactPressureIndex: round5(model.pressureOf(minClearance)),
    };
  };
  const zoneValues = {
    "d2p:chest": () => [torsoPanels, model.torso(ring("chest").y), model.torso(ring("chest").y + 40)],
    "d2p:hip": () => [torsoPanels, model.torso(ring("hip").y), model.torso(ring("hip").y - 40)],
    "d2p:shoulder": () => [[...torsoPanels, ...sleevePanels], model.torso(ring("shoulder").y - 60), model.torso(ring("shoulder").y)],
    "d2p:upper-arm": () => [sleevePanels, model.sleeve(), model.sleeve()],
    "d2p:waist": () => [torsoPanels, model.torso(ring("waist").y), model.torso(ring("waist").y + 40)],
  };
  const vertexClearance = new Map(
    g.panelInstances.map((panel) => [panel.id, drapedMm.get(panel.id).map(([, y]) => round1(sleevePanels.includes(panel.id) ? model.sleeve() : model.torso(y)))]),
  );
  // The zone minimum is the model at the zone's extreme height, but never below the lowest
  // vertex clearance of the zone's panels: the vertex fields sample the same model, and a
  // zone summary over those panels cannot be tighter than all of their vertices.
  const zones = sortBy(avatar.zones, "zone").map((z) => {
    const [panels, mean, min] = zoneValues[z.zone]();
    const vertexMin = Math.min(...panels.flatMap((id) => vertexClearance.get(id)));
    return zoneOf(z, panels, mean, Math.max(Math.min(mean, min), Math.min(mean, vertexMin)));
  });
  const vertexFields = sortBy(
    g.panelInstances.map((panel) => {
      const c = vertexClearance.get(panel.id);
      return {
        panelInstanceId: panel.id,
        strain: c.map((x) => round5(model.strainOf(x))),
        clearanceMm: c,
        contactPressure: c.map((x) => round5(model.pressureOf(x))),
      };
    }),
    "panelInstanceId",
  );
  const fitMap = {
    documentType: "d2p:fit-map",
    schemaVersion: V,
    fitMapId: `fmp_golden-drape-${tag}`,
    createdAt: T_DERIVED,
    sceneSnapshotRef: derivedRef(scene.sceneSnapshotId, scene.sceneDigest),
    bodyModelRef: clone(scene.bodyModelRef),
    avatarProfile: { ...AVATAR_REF },
    solverProfile: clone(config.solverProfile),
    materialStatus: material.status === "provisional" ? "provisional" : "frozen",
    estimate: "model-estimate",
    zones,
    vertexFields,
  };
  if (personal) fitMap.personalDerived = true;
  fitMap.diagnostics = [];
  fitMap.resultDigest = resultDigestOf(fitMap, ["fitMapId"]);

  const simReport = {
    documentType: "d2p:sim-report",
    schemaVersion: V,
    simReportId: `smr_golden-drape-${tag}`,
    createdAt: T_DERIVED,
    sceneSnapshotRef: derivedRef(scene.sceneSnapshotId, scene.sceneDigest),
    profileKind: solver.profileKind,
    solver: DRAPE_BACKEND,
    solverProfile: clone(config.solverProfile),
    materialPhysicsProfile: clone(config.materials[0].materialPhysicsProfile),
    toleranceProfile: { ...TOLERANCE_REF },
    inputDigests: clone(scene.inputDigests),
    randomSeed: config.randomSeed,
    status: "succeeded",
    convergence: "converged",
    durationMs: 1250,
    // Synthetic run metrics within the limits of the drape tolerance profile.
    metrics: [
      { metric: "d2p:drape-penetration", value: 0, unit: "mm" },
      { metric: "d2p:drape-seam-gap", value: 0.8, unit: "mm" },
    ],
  };
  if (personal) simReport.personalDerived = true;
  simReport.diagnostics = [];
  simReport.resultDigest = resultDigestOf(simReport, ["simReportId"]);

  return { rests, draped, input, scene, fitMap, simReport, model, fig };
}

/** Validation report with one warning finding on a fit map (model-estimate observation). */
function fitReport(tag, g, fitMap, sampleCut, visibility) {
  const shoulder = fitMap.zones.findIndex((z) => z.zone === "d2p:shoulder");
  const rule = sampleCut.rules.find((r) => r.ruleId === "d2p:ease-material-compatible");
  const doc = {
    documentType: "d2p:validation-report",
    schemaVersion: V,
    reportId: `vrp_golden-drape-${tag}-fit`,
    createdAt: T_DERIVED,
    targetRefs: [artifactRef(g)],
    derivedSubjectRefs: [derivedRef(fitMap.fitMapId, fitMap.resultDigest)],
    purpose: sampleCut.purpose,
    profile: versioned(sampleCut),
    inputDigests: sortBy(
      [
        { role: "garment", artifactRef: artifactRef(g), digest: contentDigestOf(g) },
        { role: "validation-profile", id: versioned(sampleCut), digest: digestOf(sampleCut) },
      ],
      "role",
    ),
    status: "completed",
    result: "pass",
    findings: [
      {
        findingId: "f-1",
        ruleId: rule.ruleId,
        ruleVersion: rule.ruleVersion,
        code: "D2P-SEM-073",
        severity: rule.severity,
        message: "Model estimate: the cloth rests on the body in the shoulder zone (minimum clearance at the solver's body offset) while the woven material declares no stretch. Check the shoulder ease in a fitting; a fit map never replaces one.",
        elementRefs: [],
        subjectRef: derivedRef(fitMap.fitMapId, fitMap.resultDigest),
        instancePath: `/zones/${shoulder}/minClearanceMm`,
        visibility,
      },
    ],
  };
  doc.resultDigest = resultDigestOf(doc, ["reportId"]);
  return doc;
}

// ---------------------------------------------------------------------------
// Fixture, negative fixtures and cases

function caseDoc(level, name, title, documents, expect, testIds, description) {
  const doc = {
    documentType: "d2p:conformance-case",
    schemaVersion: V,
    caseId: `${CASE_DIR_NAME}.${name}`,
    level,
    title: `Golden T-Shirt drape: ${title}`,
    documents,
    expect,
  };
  if (testIds?.length) doc.testIds = testIds;
  if (description) doc.description = description;
  return doc;
}

const subjects = (paths) => paths.map((p) => ({ path: p, role: "subject" }));
const contexts = (paths) => paths.map((p) => ({ path: p, role: "context" }));
const ACCEPT = { outcome: "accept", diagnostics: [] };
const reject = (code, documentPath) => ({ outcome: "reject", diagnostics: [documentPath ? { code, documentPath } : { code }] });

/**
 * Builds everything. Returns { files: Map<repo-relative path, string>, report }.
 */
export function buildAll(root) {
  const checks = [];
  const assert = (cond, what) => {
    if (!cond) throw new Error(`Golden T-Shirt drape assertion failed: ${what}`);
    checks.push(what);
  };
  const avatar = loadJson(root, AVATAR_PATH);
  const registry = loadJson(root, REGISTRY_PATH);
  const solver = loadJson(root, SOLVER_PATH);
  const material = loadJson(root, MATERIAL_PATH);
  const knit = loadJson(root, KNIT_MATERIAL_PATH);
  const meshProfile = loadJson(root, MESH_PROFILE_PATH);
  const tolerance = loadJson(root, TOLERANCE_PATH);
  const sampleCut = loadJson(root, SAMPLE_CUT_PATH);
  const twoD = {
    pattern: `${TWO_D}/inputs/pattern-r1.json`,
    sizeSystem: `${TWO_D}/inputs/size-system-r1.json`,
    gradingRuleSet: `${TWO_D}/inputs/grading-rule-set-r1.json`,
    fitProfile: `${TWO_D}/inputs/fit-profile-regular-r1.json`,
    garmentSpec: `${TWO_D}/inputs/garment-measurement-spec-r1.json`,
    evaluation: (s) => `${TWO_D}/expected/evaluations/r1-${s}-regular-woven.json`,
    snapshot: (s) => `${TWO_D}/expected/snapshots/r1-${s}-regular-woven.json`,
  };
  const pattern = loadJson(root, twoD.pattern);
  const snapshot2d = Object.fromEntries(SIZES.map((s) => [s, loadJson(root, twoD.snapshot(s))]));
  const evaluation2d = Object.fromEntries(SIZES.map((s) => [s, loadJson(root, twoD.evaluation(s))]));
  const garment3d = Object.fromEntries(SIZES.map((s) => [s, loadJson(root, `${THREE_D}/inputs/garment-${s}-r1.json`)]));
  const scene3d = Object.fromEntries(SIZES.map((s) => [s, loadJson(root, `${THREE_D}/expected/scenes/r1-${s}.json`)]));
  const ctx = { avatar, registry, solver, material, meshProfile, pattern, snapshot2d, scene3d };

  // Inputs.
  const docs = new Map(); // fixture-relative path -> { doc, role }
  const add = (rel, doc, role) => docs.set(rel, { doc, role });
  const sizes = bodySizes();
  const profile = bodyProfile(sizes);
  const garments = Object.fromEntries(SIZES.map((s) => [s, garment(garment3d[s], s)]));
  add("inputs/artifacts/body-sizes.json", artifactMeta(sizes, "d2p:size-system", "Golden drape synthetic body sizes", "public"), "input");
  add("inputs/artifacts/body-profile.json", artifactMeta(profile, "d2p:body-measurement-profile", "Golden drape synthetic body profile P", "public"), "input");
  add("inputs/body-sizes-r1.json", sizes, "input");
  add("inputs/body-profile-r1.json", profile, "input");
  add("inputs/revisions/body-sizes-r1.json", revisionRecord(sizes, "Initial synthetic body sizes"), "input");
  add("inputs/revisions/body-profile-r1.json", revisionRecord(profile, "Initial synthetic body profile (baseline body-l, chest girth and arm length measured)"), "input");
  for (const s of SIZES) {
    add(`inputs/artifacts/garment-${s}.json`, artifactMeta(garments[s], "d2p:garment", `Golden T-Shirt drape garment, size ${sizeLabel(s)}`, "public"), "input");
    add(`inputs/garment-${s}-r1.json`, garments[s], "input");
    add(`inputs/revisions/garment-${s}-r1.json`, revisionRecord(garments[s], "Initial drape garment"), "input");
  }

  // Expected body models and the drape expectation.
  const valuesOf = (source) => sourceValues(source, { sizeSystem: sizes, profile });
  const resolvedM = resolveTargets(valuesOf(sizeEntrySource("body-m")), avatar);
  const resolvedP = resolveTargets(valuesOf(profileSource(BODY_PROFILE_ID)), avatar);
  const expM = bodyModelExpectation("bmx_golden-drape-body-m", sizeEntrySource("body-m"), resolvedM, avatar);
  const expP = bodyModelExpectation("bmx_golden-drape-body-profile", profileSource(BODY_PROFILE_ID), resolvedP, avatar);
  add("expected/body-models/body-m.json", expM, "expected");
  add("expected/body-models/body-profile.json", expP, "expected");
  const comparisons = [];
  for (const b of ["body-m", "body-profile"]) {
    for (const zone of ["d2p:chest", "d2p:waist"]) {
      const subject = (s) => ({ garmentRef: { ...garmentId(s) }, simulationConfigurationId: `drape-${b}` });
      comparisons.push({ id: `${b}-${zone.slice(4)}`, zone, metric: "meanClearanceMm", lower: subject("size-a"), higher: subject("size-b") });
    }
  }
  const drapeExp = { documentType: "d2p:drape-expectation", schemaVersion: V, expectationId: "drx_golden-drape-size-comparison", comparisons: sortBy(comparisons, "id"), toleranceProfile: { ...TOLERANCE_REF } };
  add("expected/drapes/size-comparison.json", drapeExp, "expected");

  // Oracle assertions on the inputs and expectations.
  const chestOf = (s) => evaluation2d[s].measurements.find((m) => m.definitionId === "d2p:garment.chest-girth").value;
  const girthOf = (s) => {
    const w = (id) => snapshot2d[s].pieces.find((p) => p.pieceId === id).boundingBox;
    return w("front").max[0] - w("front").min[0] + w("back").max[0] - w("back").min[0];
  };
  for (const s of SIZES) assert(girthOf(s) === chestOf(s), `${s}: front width + back width = garment chest girth ${chestOf(s)} mm of the 2D fixture`);
  assert(chestOf("size-a") < chestOf("size-b"), "size B garment is wider than size A");
  const allBodies = [...BODY_SIZES.map((b) => b.values), profile.measurements.reduce((o, m) => ({ ...o, [m.definitionId.slice(9)]: m.value }), {})];
  for (const v of allBodies) {
    assert(v["chest-girth"] < chestOf("size-a") && v["waist-girth"] < chestOf("size-a"), `body chest ${v["chest-girth"]} mm and waist ${v["waist-girth"]} mm lie below both garment girths`);
  }
  assert(resolvedM.status === "succeeded" && resolvedP.status === "succeeded", "both fixture bodies resolve every required definition");
  assert(resolvedM.controlMeasures.length === avatar.requiredDefinitions.length + avatar.derivations.length, "body-m: one target per required and derived definition");
  assert(resolvedM.controlMeasures.filter((c) => c.origin === "size-table").length === 8 && resolvedM.controlMeasures.filter((c) => c.origin === "inferred").length === 17, "body-m: eight table targets (six required, neck girth, waist height), seventeen inferred");
  assert(canonical(resolvedP.controlMeasures.filter((c) => c.origin === "profile").map((c) => c.definitionId)) === canonical([body("arm-length"), body("chest-girth")]), "body-profile: the two overrides are profile targets, everything else is from the baseline table or inferred");
  assert(resolvedP.controlMeasures.find((c) => c.definitionId === body("bust-girth")).targetMm === PROFILE_OVERRIDES["chest-girth"], "body-profile: inferred bust girth follows the overridden chest girth");
  const entryL = sizes.sizes.find((s) => s.sizeKey === BASELINE_KEY);
  for (const m of profile.measurements.filter((x) => x.method === "size-table")) {
    assert(entryL.measurements.some((e) => e.definitionId === m.definitionId && e.value === m.value && e.unit === m.unit), `body-profile: table value ${m.definitionId} equals the baseline entry`);
  }
  for (const g of Object.values(garments)) {
    assert(canonical(g.panelInstances) === canonical(garment3d["size-a"].panelInstances) && canonical(g.arrangements.map((a) => a.id)) === canonical([ARRANGEMENT_ID]), `${g.artifactId}: panels and arrangement of the 3D fixture garment`);
    for (const c of g.simulationConfigurations) {
      const assignments = g.materialAssignments.filter((a) => a.panelInstanceIds.length);
      assert(canonical(c.materials.map((m) => m.materialAssignmentId)) === canonical(assignments.map((a) => a.id)), `${g.artifactId} ${c.id}: one material physics profile per material assignment`);
      assert(material.materialClass === assignments[0].material.materialClass, `${g.artifactId} ${c.id}: ${material.profileId} is ${material.materialClass} like the assignment`);
    }
    for (const b of g.bodyBindings) assert(b.pose === avatar.pose, `${g.artifactId} ${b.id}: pose equals the avatar profile's pose`);
  }

  // External files (repository-relative).
  const sampleCutRules = sampleCut.rules.map((r) => `vocabularies/validation/rules/${r.ruleId.slice(4)}-${r.ruleVersion}.json`);
  const external = [
    twoD.pattern,
    twoD.sizeSystem,
    twoD.gradingRuleSet,
    twoD.fitProfile,
    twoD.garmentSpec,
    ...SIZES.map(twoD.evaluation),
    ...SIZES.map(twoD.snapshot),
    "tolerance-profiles/golden-tshirt-2d-1.0.0.json",
    TOLERANCE_PATH,
    REGISTRY_1_0_PATH,
    REGISTRY_PATH,
    AVATAR_PATH,
    SOLVER_PATH,
    MATERIAL_PATH,
    KNIT_MATERIAL_PATH, // used by the negative fixture material-class-mismatch
    MESH_PROFILE_PATH,
    SAMPLE_CUT_PATH,
    ...sampleCutRules,
  ].sort();
  const fx = (rel) => `${FIXTURE_DIR}/${rel}`;
  const inputPaths = [...docs].filter(([, v]) => v.role === "input").map(([k]) => fx(k));

  // Negative fixtures: changed documents only, with their cases.
  const cases = new Map(); // repo path -> case doc
  const negative = (name, level, title, changed, replaced, expect, testIds, description, extraContext = []) => {
    const subjectPaths = [];
    for (const [file, doc] of changed) {
      const rel = `negative/${name}/${file}`;
      add(rel, doc, "negative");
      subjectPaths.push(fx(rel));
    }
    const ctxPaths = [...inputPaths.filter((p) => !replaced.includes(p)), ...extraContext, ...external].sort();
    const c = caseDoc(level, name, title, [...subjects(subjectPaths), ...contexts(ctxPaths)], expect, testIds, description);
    add(`negative/${name}/case.json`, c, "negative");
    cases.set(`conformance/${level}/${CASE_DIR_NAME}/${name}.case.json`, c);
  };
  const profilePaths = [fx("inputs/body-profile-r1.json"), fx("inputs/revisions/body-profile-r1.json")];
  const garmentAPaths = [fx("inputs/garment-size-a-r1.json"), fx("inputs/revisions/garment-size-a-r1.json")];
  {
    const p = clone(profile);
    p.baseline.sizeKey = "body-xl";
    negative("baseline-missing-size", "referential", "body profile baseline names a size the size system does not have", [["body-profile.json", p]], profilePaths, reject("D2P-REF-009", fx("negative/baseline-missing-size/body-profile.json")), ["SZT-001"], "A baseline pins a size system revision and a size key that resolves in it.");
  }
  {
    const p = clone(profile);
    p.measurements.find((m) => m.definitionId === body("waist-girth")).value += 5;
    negative("baseline-value-mismatch", "semantic", "table value of the body profile differs from its baseline entry", [["body-profile.json", p]], profilePaths, reject("D2P-SEM-076", fx("negative/baseline-value-mismatch/body-profile.json")), ["SZT-001", "SZT-002"], "A value with method size-table is the baseline entry's value; a changed value is an override with its own method and source, never a silently edited table value.");
  }
  {
    const p = clone(profile);
    Object.assign(p, NO_HEIGHT_PROFILE_ID);
    delete p.baseline;
    p.measurements = p.measurements.filter((m) => m.definitionId !== body("height")).map((m) => (m.method === "size-table" ? { ...m, method: "manual", source: { kind: "self-measured" }, measuredAt: T_INPUT } : m));
    const meta = artifactMeta(p, "d2p:body-measurement-profile", "Synthetic body profile without height (negative test data)", "public");
    const resolved = resolveTargets(sourceValues(profileSource(NO_HEIGHT_PROFILE_ID), { profile: p }), avatar);
    assert(resolved.status === "failed" && canonical(resolved.missingDefinitions) === canonical([body("height")]), "a source without height misses exactly the required height");
    const bm = bodyModel("bms_golden-drape-without-height", profileSource(NO_HEIGHT_PROFILE_ID), p, resolved, ctx, { forceSucceeded: true });
    negative(
      "required-measurement-missing",
      "semantic",
      "succeeded body model of a source without the required height",
      [["body-model-snapshot.json", bm], ["body-measurement-profile.json", p], ["artifact.json", meta]],
      [],
      reject("D2P-SEM-127", fx("negative/required-measurement-missing/body-model-snapshot.json")),
      ["AVA-003"],
      "A body model whose source lacks a required definition fails with a diagnostic; it is never completed with invented values. The snapshot is otherwise consistent with its source.",
    );
  }
  {
    const g = clone(garments["size-a"]);
    g.simulationConfigurations[0].bodyBindingId = "body-missing";
    negative("drape-without-body-binding", "referential", "drape configuration names a body binding the garment does not have", [["garment.json", g]], garmentAPaths, reject("D2P-REF-003", fx("negative/drape-without-body-binding/garment.json")), ["DRP-001", "GAR-007"], "A drape always names one body binding of its garment; there is no drape without a body.");
  }
  {
    const g = clone(garments["size-a"]);
    g.simulationConfigurations[0].materials[0].materialPhysicsProfile = versioned(knit);
    negative("material-class-mismatch", "semantic", "woven material assignment simulated with a knit material physics profile", [["garment.json", g]], garmentAPaths, reject("D2P-SEM-128", fx("negative/material-class-mismatch/garment.json")), ["DRP-001"], "A material physics profile describes the declared material class of its assignment.");
  }
  const personal = personalProfile();
  const personalMeta = artifactMeta(personal, "d2p:body-measurement-profile", "Individual body measurement profile (synthetic test data)", "sensitive-personal");
  const personalSource = profileSource(PERSONAL_PROFILE_ID);
  const resolvedOwn = resolveTargets(sourceValues(personalSource, { profile: personal }), avatar);
  {
    const bm = bodyModel("bms_golden-drape-individual", personalSource, personal, resolvedOwn, ctx);
    negative(
      "personal-avatar-in-export",
      "semantic",
      "body model of a sensitive-personal profile without personalDerived",
      [["body-model-snapshot.json", bm], ["body-measurement-profile.json", personal], ["artifact.json", personalMeta]],
      [],
      reject("D2P-SEM-050", fx("negative/personal-avatar-in-export/body-model-snapshot.json")),
      ["AVA-004", "SIM-009"],
      "A body model of personal measurements is personal-derived geometry and states personalDerived: true, so it is served only under the export rules of its profile.",
    );
  }

  // Fixture cases.
  const manifestPath = fx("manifest.json");
  cases.set(
    `conformance/referential/${CASE_DIR_NAME}/manifest-integrity.case.json`,
    caseDoc("referential", "manifest-integrity", "manifest integrity and resolution of the whole fixture", [{ path: manifestPath, role: "manifest" }], ACCEPT, ["DRP-001", "GAR-007", "SIM-004"], "Every listed file matches its digest, nothing unlisted is in the fixture directory, and the garments, body sources, baselines, expectations and pinned vocabulary files resolve."),
  );
  cases.set(
    `conformance/semantic/${CASE_DIR_NAME}/fixture.case.json`,
    caseDoc("semantic", "fixture", "all semantic rules on the whole fixture", [{ path: manifestPath, role: "manifest" }], ACCEPT, ["AVA-005", "SZT-001", "DRP-004", "GAR-007"], "The body profile agrees with its baseline except for its two measured overrides, the body-model expectations hold the targets of the body target resolution with the avatar profile's tolerances, and both drape configurations name a woven material physics profile for the woven assignment."),
  );

  // Drape-scene cases (case data next to the cases).
  const caseFiles = new Map(); // repo path -> text
  const put = (p, doc) => {
    caseFiles.set(p, json(doc));
    return p;
  };
  const sceneDir = `conformance/semantic/${CASE_DIR_NAME}/drape-scene`;
  const sizesDigest = { role: "size-system", artifactRef: { ...BODY_SIZES_ID }, digest: contentDigestOf(sizes) };
  const bodyM = bodyModel("bms_golden-drape-body-m", sizeEntrySource("body-m"), sizes, resolvedM, ctx);
  const writeChain = (dir, chain, extraDocs = []) => {
    const paths = {
      input: put(`${dir}/scene-input.json`, chain.input),
      scene: put(`${dir}/scene-snapshot.json`, chain.scene),
      fitMap: put(`${dir}/fit-map.json`, chain.fitMap),
      simReport: put(`${dir}/sim-report.json`, chain.simReport),
      rests: [...chain.rests.values()].map((m) => put(`${dir}/rest-mesh-${short(m.panelInstanceId)}.json`, m)),
      draped: [...chain.draped.values()].map((m) => put(`${dir}/draped-mesh-${short(m.panelInstanceId)}.json`, m)),
    };
    for (const [file, doc] of extraDocs) paths[file] = put(`${dir}/${file}`, doc);
    return paths;
  };
  const chainA = drapeChain(ctx, { tag: "size-a-body-m", g: garments["size-a"], size: "size-a", configId: "drape-body-m", bodyDoc: bodyM, bodySourceDigest: sizesDigest });
  const reportA = fitReport("size-a-body-m", garments["size-a"], chainA.fitMap, sampleCut, "general");
  const pathsA = writeChain(sceneDir, chainA);
  pathsA.bodyModel = put(`${sceneDir}/body-model-snapshot.json`, bodyM);
  pathsA.report = put(`${sceneDir}/validation-report.json`, reportA);
  const fixtureContext = [...inputPaths, ...external].sort();
  const chainPaths = (p) => [p.bodyModel, p.input, p.scene, ...p.rests, ...p.draped, p.fitMap, p.simReport, p.report].filter(Boolean);
  const without = (list, ...drop) => list.filter((x) => !drop.includes(x));

  // Assertions on the drape (DRP-003, FMP-001, SIM-006).
  for (const c of bodyM.controlMeasures) assert(Math.abs(c.deviationMm) <= toleranceOf(avatar, c.definitionId), `${bodyM.bodyModelId}: ${c.definitionId} measured within the avatar tolerance`);
  assert(canonical(bodyM.controlMeasures.map(({ definitionId, origin, targetMm }) => ({ definitionId, origin, targetMm }))) === canonical(expM.controlMeasures.map(({ definitionId, origin, targetMm }) => ({ definitionId, origin, targetMm }))), `${bodyM.bodyModelId}: control measures carry the targets of ${expM.expectationId}`);
  assert(bodyM.landmarks.length === avatar.landmarks.length, `${bodyM.bodyModelId}: one landmark per avatar landmark`);
  assert(chainA.scene.bindingsDigest === scene3d["size-a"].bindingsDigest, "the drape scene keeps the bindings of the 3D fixture scene (bindings do not depend on the body)");
  for (const [id, d] of chainA.draped) assert(d.positionsM.length === chainA.rests.get(id).mesh.positions.length, `${d.drapedMeshId}: one draped position per rest vertex`);
  for (const m of chainA.rests.values()) assert(m.maxApproximationErrorMm <= meshProfile.maxPlanarDeviationMm, `${m.meshResultId}: approximation error ${m.maxApproximationErrorMm} mm within ${meshProfile.profileId}`);
  assert(canonical(chainA.fitMap.zones.map((z) => [z.zone, z.landmarkIds])) === canonical(sortBy(avatar.zones, "zone").map((z) => [z.zone, z.landmarkIds])), "the fit map has exactly the avatar profile's zones with their landmarks");
  // Zone summaries agree with the vertex fields: a zone covers part of its panels, so its minimum clearance is not below every vertex of them.
  const checkFitMap = ({ fitMap }) => {
    const fields = new Map(fitMap.vertexFields.map((f) => [f.panelInstanceId, f]));
    for (const z of fitMap.zones) {
      assert(z.minClearanceMm <= z.meanClearanceMm && z.meanStrain <= z.maxStrain && z.minClearanceMm >= BODY_OFFSET_MM, `${fitMap.fitMapId} ${z.zone}: min ≤ mean clearance, mean ≤ max strain, no penetration`);
      const vertexMin = Math.min(...z.panelInstanceIds.flatMap((id) => fields.get(id).clearanceMm));
      assert(z.minClearanceMm >= vertexMin, `${fitMap.fitMapId} ${z.zone}: minimum clearance ${z.minClearanceMm} mm is not below the lowest vertex clearance ${vertexMin} mm of its panels`);
    }
  };
  checkFitMap(chainA);

  cases.set(
    `conformance/semantic/${CASE_DIR_NAME}/drape-scene.case.json`,
    caseDoc("semantic", "drape-scene", "fit-approximation drape of size A on body M with fit map and report", [...subjects(chainPaths(pathsA)), ...contexts(fixtureContext)], ACCEPT, ["AVA-001", "AVA-005", "AVA-006", "DRP-001", "DRP-003", "FMP-001", "FMP-003", "GAR-007", "SIM-004", "SIM-006", "FIT-004"], "A complete drape chain: the body model meets every control measure within the avatar tolerance (its ring mesh has torso and leg rings of the measured girths and heights, but no arms: arm length and shoulder width are given by landmarks, and upper-arm, wrist and underbust girths, back width, back length and shoulder length are not represented on it), the physical-simulation scene pins body model, solver, material and avatar profiles and references one draped mesh per panel (same vertices as the rest mesh), the fit map has the avatar profile's zones and is labelled a model estimate, the simulation report carries the configuration's seed, and a general finding on the fit map is allowed because nothing personal is involved. Positions and fit numbers are synthetic."),
  );

  // Size B on body M for the drape expectation.
  const metDir = `conformance/semantic/${CASE_DIR_NAME}/drape-expectation-met`;
  const chainB = drapeChain(ctx, { tag: "size-b-body-m", g: garments["size-b"], size: "size-b", configId: "drape-body-m", bodyDoc: bodyM, bodySourceDigest: sizesDigest });
  checkFitMap(chainB);
  const pathsB = writeChain(metDir, chainB);
  const metric = (chain, zone) => chain.fitMap.zones.find((z) => z.zone === zone).meanClearanceMm;
  for (const zone of ["d2p:chest", "d2p:waist"]) assert(metric(chainA, zone) < metric(chainB, zone), `body-m ${zone}: size A clearance ${metric(chainA, zone)} mm < size B ${metric(chainB, zone)} mm`);
  const bothChains = [...without(chainPaths(pathsA), pathsA.report), ...chainPaths(pathsB)];
  const expPath = fx("expected/drapes/size-comparison.json");
  cases.set(
    `conformance/semantic/${CASE_DIR_NAME}/drape-expectation-met.case.json`,
    caseDoc("semantic", "drape-expectation-met", "fit maps of size A and size B on body M satisfy the size comparison", [...subjects([expPath, pathsA.fitMap, pathsB.fitMap]), ...contexts([...without(bothChains, pathsA.fitMap, pathsB.fitMap), ...fixtureContext].sort())], ACCEPT, ["DRP-004", "FMP-001"], "The larger size has more mean clearance at chest and waist on the same body; the comparisons on body P have no fit maps in the bundle and are checked for a common body source only."),
  );

  // Personal chain.
  const personalDir = `conformance/semantic/${CASE_DIR_NAME}/drape-scene-personal`;
  const gOwn = personalGarment(garment3d["size-a"]);
  const gOwnMeta = artifactMeta(gOwn, "d2p:garment", "Golden T-Shirt drape garment for an individual body (test data)", "internal");
  const ownDigest = { role: "body-measurement-profile", artifactRef: { ...PERSONAL_PROFILE_ID }, digest: contentDigestOf(personal) };
  const bodyOwn = bodyModel("bms_golden-drape-individual", personalSource, personal, resolvedOwn, ctx, { personal: true });
  const chainOwn = drapeChain(ctx, { tag: "size-a-individual", g: gOwn, size: "size-a", configId: "drape-body-own", bodyDoc: bodyOwn, bodySourceDigest: ownDigest, personal: true });
  checkFitMap(chainOwn);
  const reportOwn = fitReport("size-a-individual", gOwn, chainOwn.fitMap, sampleCut, "restricted");
  const pathsOwn = writeChain(personalDir, chainOwn);
  pathsOwn.bodyModel = put(`${personalDir}/body-model-snapshot.json`, bodyOwn);
  pathsOwn.report = put(`${personalDir}/validation-report.json`, reportOwn);
  const ownInputs = [
    put(`${personalDir}/garment.json`, gOwn),
    put(`${personalDir}/garment-artifact.json`, gOwnMeta),
    put(`${personalDir}/garment-revision.json`, revisionRecord(gOwn, "Initial drape garment for an individual body")),
    put(`${personalDir}/body-measurement-profile.json`, personal),
    put(`${personalDir}/body-measurement-profile-artifact.json`, personalMeta),
    put(`${personalDir}/body-measurement-profile-revision.json`, revisionRecord(personal, "Initial individual profile")),
  ];
  const personalContext = [...ownInputs, ...external].sort();
  cases.set(
    `conformance/semantic/${CASE_DIR_NAME}/drape-scene-personal.case.json`,
    caseDoc("semantic", "drape-scene-personal", "drape on a sensitive-personal individual profile, every derived document declared personal", [...subjects(chainPaths(pathsOwn)), ...contexts(personalContext)], ACCEPT, ["AVA-004", "FMP-002", "SIM-009"], "Body model, scene, draped meshes, fit map and simulation report derive from personal measurements and state personalDerived: true; the finding on the fit map is restricted."),
  );

  // Semantic and referential negatives on the drape chains.
  const caseNegative = (level, name, title, changed, subjectsKept, context, code, testIds, description) => {
    const dir = `conformance/${level}/${CASE_DIR_NAME}/${name}`;
    const changedPaths = changed.map(([file, doc]) => put(`${dir}/${file}`, doc));
    cases.set(`conformance/${level}/${CASE_DIR_NAME}/${name}.case.json`, caseDoc(level, name, title, [...subjects([...changedPaths, ...subjectsKept]), ...contexts([...context].sort())], reject(code, changedPaths[0]), testIds, description));
  };
  {
    const front = clone(chainA.draped.get("panel-front"));
    front.positionsM.pop();
    front.meshDigest = drapedMeshDigestOf(front);
    front.resultDigest = resultDigestOf(front, ["drapedMeshId"]);
    const scene = clone(chainA.scene);
    const entry = scene.drapedMeshRefs.find((r) => r.panelInstanceId === "panel-front");
    entry.drapedMeshRef.digest = front.resultDigest;
    entry.meshDigest = front.meshDigest;
    scene.sceneDigest = sceneDigestOf(scene);
    const frontPath = pathsA.draped.find((p) => p.endsWith("/draped-mesh-front.json"));
    caseNegative("semantic", "draped-mesh-vertex-count", "draped front mesh has one position fewer than its rest mesh", [["scene-snapshot.json", scene], ["draped-mesh-front.json", front]], [], [...without(chainPaths(pathsA), pathsA.scene, frontPath, pathsA.fitMap, pathsA.simReport, pathsA.report), ...fixtureContext], "D2P-SEM-129", ["SIM-004"], "A draped mesh holds positions only and reuses the triangles, UVs and edge bindings of its rest mesh, so vertex i of both meshes is the same pattern point.");
  }
  {
    const fm = clone(chainA.fitMap);
    fm.zones = fm.zones.filter((z) => z.zone !== "d2p:hip");
    fm.resultDigest = resultDigestOf(fm, ["fitMapId"]);
    caseNegative("semantic", "fit-map-zones-mismatch", "fit map without the hip zone of the avatar profile", [["fit-map.json", fm]], [], [...without(chainPaths(pathsA), pathsA.fitMap, pathsA.report), ...fixtureContext], "D2P-SEM-129", ["FMP-001"], "A fit map summarises exactly the landmark-defined zones of its avatar profile.");
  }
  {
    const sr = clone(chainA.simReport);
    sr.randomSeed = 7;
    sr.resultDigest = resultDigestOf(sr, ["simReportId"]);
    caseNegative("semantic", "sim-report-seed-mismatch", "simulation report states another seed than its configuration", [["sim-report.json", sr]], [], [...without(chainPaths(pathsA), pathsA.simReport), ...fixtureContext], "D2P-SEM-129", ["DRP-003", "GAR-007"], "A drape is reproducible from its pinned configuration; the report carries the configuration's seed and solver profile.");
  }
  {
    const r = clone(reportOwn);
    r.findings[0].visibility = "general";
    r.resultDigest = resultDigestOf(r, ["reportId"]);
    caseNegative("semantic", "fit-map-finding-not-restricted", "general finding on a personal-derived fit map", [["validation-report.json", r]], [], [...without(chainPaths(pathsOwn), pathsOwn.report), ...personalContext], "D2P-SEM-052", ["FMP-002", "VAL-006"], "Findings derived from a personal-derived fit map are restricted.");
  }
  {
    const e = clone(drapeExp);
    const c = e.comparisons.find((x) => x.id === "body-m-chest");
    [c.lower, c.higher] = [c.higher, c.lower];
    caseNegative("semantic", "drape-expectation-violated", "size comparison expects less chest clearance for the larger size", [["drape-expectation.json", e]], [pathsA.fitMap, pathsB.fitMap], [...without(bothChains, pathsA.fitMap, pathsB.fitMap), ...fixtureContext], "D2P-SEM-130", ["DRP-004"], "On the same body, the fit maps show more chest clearance for size B than for size A; an expectation stating the opposite is violated.");
  }
  {
    const s = clone(chainOwn.scene);
    delete s.personalDerived;
    caseNegative("semantic", "drape-scene-personal-undeclared", "drape scene of an individual body without personalDerived", [["scene-snapshot.json", s]], [], [...without(chainPaths(pathsOwn), pathsOwn.scene), ...personalContext], "D2P-SEM-050", ["SIM-009", "AVA-004"], "A scene that drapes a garment on a body model of personal measurements is personal-derived and states personalDerived: true.");
  }
  {
    const bm = clone(bodyM);
    const pin = bm.inputDigests.find((d) => d.role === "size-system");
    const golden = loadJson(root, twoD.sizeSystem);
    pin.artifactRef = artifactRef(golden);
    pin.digest = contentDigestOf(golden);
    bm.inputDigests = sortBy(bm.inputDigests, "role");
    bm.resultDigest = resultDigestOf(bm, ["bodyModelId"]);
    caseNegative("referential", "body-model-pin-mismatch", "body model pins another size system than its source", [["body-model-snapshot.json", bm]], [], fixtureContext, "D2P-REF-007", ["DRP-001", "AVA-006"], "A body model pins exactly its body source, its avatar profile and the avatar profile's registries.");
  }
  {
    const front = clone(chainA.draped.get("panel-front"));
    front.positionsM[0] = front.positionsM[0].map((v, k) => (k === 1 ? q(v + 0.001) : v));
    front.resultDigest = resultDigestOf(front, ["drapedMeshId"]);
    caseNegative("referential", "draped-mesh-digest-mismatch", "draped mesh moved after its meshDigest was computed", [["draped-mesh-front.json", front]], [], [...pathsA.rests, ...fixtureContext], "D2P-REF-011", ["DRP-003", "SIM-004"], "The meshDigest of a draped mesh is the digest of its positions.");
  }
  {
    const input = clone(chainA.input);
    delete input.bodyModelRef;
    input.evaluationKey = evaluationKeyOf(input);
    caseNegative("structural", "physical-scene-without-body-model", "physical-simulation scene input without a body model", [["scene-input.json", input]], [], [], "D2P-STR-001", ["DRP-001"], "A drape scene always pins the body model it is draped on.");
  }
  {
    const a = clone(avatar);
    a.derivations.find((d) => d.definitionId === body("neck-girth")).terms = [{ definitionId: body("waist-height"), coefficient: 0.35 }];
    caseNegative("semantic", "avatar-profile-derivation-invalid", "avatar profile derives neck girth from a derived definition", [["avatar-profile.json", a]], [], [REGISTRY_PATH, TOLERANCE_PATH], "D2P-SEM-127", ["AVA-001", "AVA-003"], "Derivations use required definitions only, so every inferred target depends on measured or table values and never on another inference.");
  }

  // Manifest.
  const files = [...docs].map(([rel, { doc, role }]) => ({ path: rel, role, documentType: doc.documentType, digest: digestOf(doc) }));
  const manifest = {
    documentType: "d2p:fixture-manifest",
    schemaVersion: V,
    fixtureId: "golden-tshirt-drape",
    fixtureVersion: "1.0.0",
    title: "Golden T-Shirt drape v1",
    description: "Synthetic drape fixture on top of the Golden T-Shirt v1 and 3D v1: a synthetic size system with bodies M and L, a synthetic body profile P with baseline L and two measured overrides, the size A and size B garments of the 3D fixture with body bindings to M and P and one fit-approximation drape configuration per body (woven cotton), the expected body-model targets of M and P under the standard A-pose avatar profile and the metamorphic expectation that size B has more chest and waist clearance than size A on both bodies. Drapes, meshes and fit maps are not expected results. Generated by tools/oracle/golden-tshirt-drape.mjs.",
    synthetic: true,
    standardVersion: V,
    digestProfile: "d2p-digest-v1",
    toleranceProfile: { profileId: tolerance.profileId, version: tolerance.version, path: TOLERANCE_PATH, digest: digestOf(tolerance) },
    files: sortBy(files, "path"),
    externalFiles: external.map((p) => ({ path: p, documentType: loadJson(root, p).documentType, digest: digestOf(loadJson(root, p)) })),
    review: { status: "pending", notes: "Domain review of the synthetic bodies, the avatar derivations and the drape expectations by a pattern maker is pending (QEV-016); avatar, solver, material and tolerance profiles are provisional." },
  };
  manifest.fixtureDigest = digestOf(manifest, ["fixtureDigest"]);

  const out = new Map();
  for (const [rel, { doc }] of docs) out.set(`${FIXTURE_DIR}/${rel}`, json(doc));
  out.set(`${FIXTURE_DIR}/manifest.json`, json(manifest));
  for (const [p, c] of cases) out.set(p, json(c));
  for (const [p, t] of caseFiles) out.set(p, t);
  const summary = {
    bodies: Object.fromEntries(BODY_SIZES.map((b) => [b.sizeKey, b.values])),
    profileOverrides: PROFILE_OVERRIDES,
    garmentChestGirthMm: Object.fromEntries(SIZES.map((s) => [s, chestOf(s)])),
    clearanceBodyM: Object.fromEntries(["d2p:chest", "d2p:waist", "d2p:hip"].map((z) => [z, { "size-a": metric(chainA, z), "size-b": metric(chainB, z) }])),
  };
  return { files: out, report: { checks, manifest, summary } };
}

function canonical(x) {
  return JSON.stringify(x);
}
