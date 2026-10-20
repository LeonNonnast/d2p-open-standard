// Golden T-Shirt 3D v1 (catalog §4.5): builds the fixture, its negative
// fixtures and the 3D conformance cases from the Golden T-Shirt v1 2D
// fixture. Everything is deterministic; the only inputs are files of this
// repository. Values are synthetic test data, not a size table or norm.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  bindingsDigestOf,
  contentDigestOf,
  digestOf,
  evaluationKeyOf,
  meshDigestOf,
  quantize,
  resultDigestOf,
  sceneDigestOf,
} from "../../lib/c14n.mjs";

export const FIXTURE_DIR = "fixtures/golden-tshirt-3d/v1";
export const CASE_DIR_NAME = "golden-tshirt-3d";
const TWO_D = "fixtures/golden-tshirt/v1";
const V = "1.0.0";
const ACTOR = { kind: "system", principalId: "prn_golden-fixture" };
const T_R1 = "2026-01-05T00:00:00Z";
const T_R2 = "2026-01-06T00:00:00Z";
const T_DERIVED = "2026-01-07T00:00:00Z";
const SIZES = ["size-a", "size-b"];
const REVS = ["r1", "r2"];
const MESH_PROFILE = { id: "d2p:golden-tshirt-3d-preview", version: "1.0.0" };
const MESH_PROFILE_PATH = "vocabularies/mesh-profiles/golden-tshirt-3d-preview-1.0.0.json";
const TOLERANCE_3D = { id: "d2p:golden-tshirt-3d", version: "1.0.0" };
const TOLERANCE_3D_PATH = "tolerance-profiles/golden-tshirt-3d-1.0.0.json";
const COORDS = { handedness: "right", up: "+y", front: "+z" };
const CONVERSION = { from: "mm", to: "m", factor: 0.001 };
const MM_TO_M = 0.001;
const IDENTITY = [0, 0, 0, 1];
const TURN_Y = [0, 1, 0, 0]; // 180 degrees about +Y: (x, y, z) -> (-x, y, -z)
const BODY_GAP_MM = 120; // front at z = +120 mm, back at z = -120 mm
const SLEEVE_GAP_MM = 80; // horizontal gap between body panels and sleeves
const SLEEVE_DROP_MM = 40; // sleeve top below the top of the front panel
/** Panel instances: id, piece, cut instance, side. Identical in every size and revision. */
const PANELS = [
  { id: "panel-back", pieceId: "back", cutInstanceKey: "back", side: "center" },
  { id: "panel-front", pieceId: "front", cutInstanceKey: "front", side: "center" },
  { id: "panel-sleeve-left", pieceId: "sleeve", cutInstanceKey: "sleeve-left", side: "left" },
  { id: "panel-sleeve-right", pieceId: "sleeve", cutInstanceKey: "sleeve-right", side: "right" },
];
const EVAL_REF_ID = "eval-main";
const ARRANGEMENT_ID = "flat-lay";

const clone = (x) => structuredClone(x);
const q = (n) => {
  const v = quantize(n);
  return Object.is(v, -0) ? 0 : v;
};
const round1 = (n) => q(Math.round(n * 10) / 10);
const sortBy = (list, ...keys) =>
  [...list].sort((a, b) => {
    for (const k of keys) {
      const x = typeof k === "function" ? k(a) : a[k];
      const y = typeof k === "function" ? k(b) : b[k];
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  });

/** Rotates a vector by a unit quaternion [x, y, z, w]. */
export function rotate(qv, p) {
  const [x, y, z, w] = qv;
  const [px, py, pz] = p;
  // t = 2 * cross(q.xyz, p); p' = p + w * t + cross(q.xyz, t)
  const tx = 2 * (y * pz - z * py);
  const ty = 2 * (z * px - x * pz);
  const tz = 2 * (x * py - y * px);
  return [px + w * tx + (y * tz - z * ty), py + w * ty + (z * tx - x * tz), pz + w * tz + (x * ty - y * tx)];
}

/** Panel-local mm point -> garment mm point (mirror, rotation, translation). */
export function placePoint(p2, mirrored, placement) {
  const local = [mirrored ? -p2[0] : p2[0], p2[1], 0];
  const r = rotate(placement.rotation, local);
  return [r[0] + placement.translationMm[0], r[1] + placement.translationMm[1], r[2] + placement.translationMm[2]];
}

// ---------------------------------------------------------------------------
// Inputs from the 2D fixture

function loadJson(root, rel) {
  return JSON.parse(readFileSync(path.join(root, rel), "utf8"));
}

function twoD(root) {
  const files = {
    pattern: { r1: `${TWO_D}/inputs/pattern-r1.json`, r2: `${TWO_D}/expected/change/pattern-r2.json` },
    sizeSystem: `${TWO_D}/inputs/size-system-r1.json`,
    gradingRuleSet: `${TWO_D}/inputs/grading-rule-set-r1.json`,
    fitProfile: `${TWO_D}/inputs/fit-profile-regular-r1.json`,
    garmentSpec: `${TWO_D}/inputs/garment-measurement-spec-r1.json`,
    bodyProfile: `${TWO_D}/negative/private-measurement-export/body-measurement-profile.json`,
  };
  const out = { files, pattern: {}, evaluation: {}, snapshot: {}, evaluationPath: {}, snapshotPath: {} };
  for (const r of REVS) out.pattern[r] = loadJson(root, files.pattern[r]);
  out.sizeSystem = loadJson(root, files.sizeSystem);
  out.bodyProfile = loadJson(root, files.bodyProfile);
  for (const r of REVS) {
    for (const s of SIZES) {
      const key = `${r}-${s}`;
      out.evaluationPath[key] = `${TWO_D}/expected/evaluations/${r}-${s}-regular-woven.json`;
      out.snapshotPath[key] = `${TWO_D}/expected/snapshots/${r}-${s}-regular-woven.json`;
      out.evaluation[key] = loadJson(root, out.evaluationPath[key]);
      out.snapshot[key] = loadJson(root, out.snapshotPath[key]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Garment documents

const garmentArtifactId = (s) => `art_golden-tshirt-3d-garment-${s}`;
const garmentRevisionId = (s, r) => `rev_golden-tshirt-3d-garment-${s}-${r}`;
const garmentRef = (s, r) => ({ artifactId: garmentArtifactId(s), revisionId: garmentRevisionId(s, r) });
const sizeLabel = (s) => s.slice(-1).toUpperCase();

/** Placements from the r1 snapshot of a size (a rebind keeps the arrangement). */
function placements(snapshot) {
  const box = (pieceId) => snapshot.pieces.find((p) => p.pieceId === pieceId).boundingBox;
  const f = box("front");
  const b = box("back");
  const s = box("sleeve");
  const fw = f.max[0] - f.min[0];
  const fh = f.max[1] - f.min[1];
  const cx = (bb) => (bb.min[0] + bb.max[0]) / 2;
  const cy = (bb) => (bb.min[1] + bb.max[1]) / 2;
  const sleeveY = fh / 2 - SLEEVE_DROP_MM - s.max[1];
  const out = {
    "panel-front": { translationMm: [-cx(f), -cy(f), BODY_GAP_MM], rotation: IDENTITY },
    // The turn maps x to -x, so the back's centre moves to -cx(b); translate by +cx(b).
    "panel-back": { translationMm: [cx(b), -cy(b), -BODY_GAP_MM], rotation: TURN_Y },
    "panel-sleeve-left": { translationMm: [fw / 2 + SLEEVE_GAP_MM - s.min[0], sleeveY, 0], rotation: IDENTITY },
    // Mirrored: local x -> -x, so the sleeve spans [-max, -min]; its right edge lands at -(fw/2 + gap).
    "panel-sleeve-right": { translationMm: [-(fw / 2 + SLEEVE_GAP_MM) + s.min[0], sleeveY, 0], rotation: IDENTITY },
  };
  return PANELS.map((p) => ({ panelInstanceId: p.id, translationMm: out[p.id].translationMm.map(round1), rotation: out[p.id].rotation }));
}

/** Panel instance carrying a seam interface: the interface's cut instance. */
function panelOfInterface(pattern, interfaceId) {
  const iface = pattern.seamInterfaces.find((i) => i.id === interfaceId);
  let key = iface.cutInstanceKey;
  if (key === undefined) {
    const edgeId = iface.segments[0].edgeId;
    key = pattern.pieces.find((p) => p.contours.some((c) => c.edges.some((e) => e.id === edgeId))).id;
  }
  return PANELS.find((p) => p.cutInstanceKey === key).id;
}

function sewingBindings(pattern) {
  const out = [];
  for (const c of pattern.seamConnections) {
    out.push({
      id: `bind-${c.id}`,
      kind: "seam-connection",
      patternEvaluationId: EVAL_REF_ID,
      seamConnectionId: c.id,
      interfaceBindings: c.interfaceIds.map((id) => ({ seamInterfaceId: id, panelInstanceId: panelOfInterface(pattern, id) })),
    });
  }
  for (const g of pattern.sewingGroups) {
    out.push({
      id: `bind-${g.id}`,
      kind: "sewing-group",
      patternEvaluationId: EVAL_REF_ID,
      sewingGroupId: g.id,
      memberBindingIds: g.members.map((m) => `bind-${m.connectionId}`).sort(),
    });
  }
  return out;
}

function evaluationPin(src, r, s) {
  const ev = src.evaluation[`${r}-${s}`];
  return {
    id: EVAL_REF_ID,
    patternRef: clone(ev.request.patternRef),
    sizeSystemRef: clone(ev.request.sizeSystemRef),
    sizeKey: ev.request.sizeKey,
    configurationKey: ev.request.configurationKey,
    evaluationRef: { id: ev.evaluationId, digest: ev.resultDigest },
    geometryDigest: ev.snapshotRef.digest,
  };
}

function garment(src, r, s) {
  return {
    documentType: "d2p:garment",
    schemaVersion: V,
    artifactId: garmentArtifactId(s),
    revisionId: garmentRevisionId(s, r),
    name: `Golden T-Shirt 3D, size ${sizeLabel(s)}`,
    description: "Synthetic garment of the Golden T-Shirt 3D fixture: front, back and two sleeve panel instances of one sleeve piece, bound to the pattern's seam connections and sewing groups, arranged as a flat lay. Test data, not a design or norm.",
    patternEvaluations: [evaluationPin(src, r, s)],
    panelInstances: PANELS.map((p) => ({ id: p.id, patternEvaluationId: EVAL_REF_ID, pieceId: p.pieceId, cutInstanceKey: p.cutInstanceKey, side: p.side })),
    sewingBindings: sewingBindings(src.pattern[r]),
    materialAssignments: [
      {
        id: "material-main",
        panelInstanceIds: PANELS.map((p) => p.id),
        material: { materialClass: "woven" },
        appearance: { baseColor: "#5b7fa6" },
      },
    ],
    arrangements: [
      {
        id: ARRANGEMENT_ID,
        name: "Flat lay",
        coordinateSystem: COORDS,
        placements: placements(src.snapshot[`r1-${s}`]),
      },
    ],
  };
}

function artifactMeta(s) {
  return {
    documentType: "d2p:artifact",
    schemaVersion: V,
    artifactId: garmentArtifactId(s),
    artifactType: "d2p:garment",
    name: `Golden T-Shirt 3D garment, size ${sizeLabel(s)}`,
    dataClassification: "public",
    createdAt: T_R1,
    createdBy: ACTOR,
  };
}

function revisionRecord(doc, r) {
  const rec = {
    documentType: "d2p:revision",
    schemaVersion: V,
    revisionId: doc.revisionId,
    artifactId: doc.artifactId,
    sequence: r === "r1" ? 1 : 2,
    parentRevisionIds: r === "r1" ? [] : [doc.revisionId.replace(/-r2$/, "-r1")],
    contentDigest: contentDigestOf(doc),
    createdAt: r === "r1" ? T_R1 : T_R2,
    author: ACTOR,
  };
  rec.message = r === "r1" ? "Initial garment" : "Rebind to pattern r2 (bust-ease +20 mm, sleeve-length +30 mm); arrangement and all element IDs kept";
  return rec;
}

function sceneInput(g, r, s) {
  const doc = {
    documentType: "d2p:scene-input",
    schemaVersion: V,
    sceneInputId: `sci_golden-tshirt-3d-${r}-${s}`,
    createdAt: r === "r1" ? T_R1 : T_R2,
    garmentRef: { artifactId: g.artifactId, revisionId: g.revisionId },
    arrangementId: ARRANGEMENT_ID,
    mode: "arrangement",
    meshProfile: MESH_PROFILE,
    toleranceProfile: TOLERANCE_3D,
    patternEvaluations: g.patternEvaluations.map((e) => ({ patternEvaluationId: e.id, evaluationRef: clone(e.evaluationRef), geometryDigest: e.geometryDigest })),
  };
  doc.evaluationKey = evaluationKeyOf(doc);
  return doc;
}

/** Scene bindings of a garment (shared by expectations and scene snapshots). */
function sceneBindings(src, g, r, s) {
  const pattern = src.pattern[r];
  const snapshot = src.snapshot[`${r}-${s}`];
  const arrangement = g.arrangements[0];
  const panelBindings = sortBy(
    g.panelInstances.map((p) => {
      const piece = pattern.pieces.find((x) => x.id === p.pieceId);
      const inst = piece.cutInstruction?.instances?.find((c) => c.cutInstanceKey === p.cutInstanceKey);
      const pl = arrangement.placements.find((x) => x.panelInstanceId === p.id);
      return {
        panelInstanceId: p.id,
        patternEvaluationId: p.patternEvaluationId,
        pieceId: p.pieceId,
        cutInstanceKey: p.cutInstanceKey,
        side: p.side,
        mirrored: Boolean(inst?.mirrored),
        transform: { translationM: pl.translationMm.map((v) => q(v * MM_TO_M)), rotation: clone(pl.rotation) },
      };
    }),
    "panelInstanceId",
  );
  const seamBindings = sortBy(clone(g.sewingBindings), "id");
  const lengths = new Map(snapshot.interfaces.map((i) => [i.seamInterfaceId, i.lengthMm]));
  const controlMeasures = sortBy(
    g.sewingBindings
      .filter((b) => b.kind === "seam-connection")
      .flatMap((b) => b.interfaceBindings.map((ib) => ({ seamInterfaceId: ib.seamInterfaceId, panelInstanceId: ib.panelInstanceId, lengthMm: lengths.get(ib.seamInterfaceId), lengthM: q(lengths.get(ib.seamInterfaceId) * MM_TO_M) }))),
    "seamInterfaceId",
    "panelInstanceId",
  );
  const anchors = sortBy(
    panelBindings.map((b) => {
      const contour = snapshot.pieces.find((p) => p.pieceId === b.pieceId).contours[0];
      const pl = arrangement.placements.find((x) => x.panelInstanceId === b.panelInstanceId);
      return { panelInstanceId: b.panelInstanceId, contourId: contour.contourId, positionM: placePoint(contour.start, b.mirrored, pl).map((v) => q(v * MM_TO_M)) };
    }),
    "panelInstanceId",
    "contourId",
  );
  return { panelBindings, seamBindings, controlMeasures, anchors };
}

function expectation(src, g, input, r, s) {
  const { panelBindings, seamBindings, controlMeasures, anchors } = sceneBindings(src, g, r, s);
  const doc = {
    documentType: "d2p:scene-expectation",
    schemaVersion: V,
    expectationId: `sxp_golden-tshirt-3d-${r}-${s}`,
    sceneInputRef: { id: input.sceneInputId, digest: contentDigestOf(input) },
    garmentRef: clone(input.garmentRef),
    arrangementId: ARRANGEMENT_ID,
    mode: "arrangement",
    meshProfile: MESH_PROFILE,
    toleranceProfile: TOLERANCE_3D,
    coordinateSystem: COORDS,
    sceneUnit: "m",
    unitConversion: CONVERSION,
    panelBindings,
    seamBindings,
    controlMeasures,
    anchors,
  };
  doc.bindingsDigest = bindingsDigestOf(doc);
  return doc;
}

// ---------------------------------------------------------------------------
// Panel meshes (boundary sampling + ear clipping) for the scene-snapshot cases

function cubicAt(p0, c1, c2, p1, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]];
}

function distanceToChord(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Samples a cubic so that every chord deviates by at most `tol`; returns the interior and end points and the measured deviation. */
function sampleCubic(p0, c1, c2, p1, tol) {
  const ts = [0];
  const rec = (t0, t1, depth) => {
    const a = cubicAt(p0, c1, c2, p1, t0);
    const b = cubicAt(p0, c1, c2, p1, t1);
    let dev = 0;
    for (let k = 1; k < 16; k += 1) dev = Math.max(dev, distanceToChord(cubicAt(p0, c1, c2, p1, t0 + ((t1 - t0) * k) / 16), a, b));
    if (dev > tol && depth < 24) {
      const tm = (t0 + t1) / 2;
      rec(t0, tm, depth + 1);
      rec(tm, t1, depth + 1);
    } else ts.push(t1);
  };
  rec(0, 1, 0);
  const points = ts.map((t) => cubicAt(p0, c1, c2, p1, t));
  let maxDev = 0;
  for (let i = 1; i < ts.length; i += 1) {
    for (let k = 1; k < 64; k += 1) {
      const t = ts[i - 1] + ((ts[i] - ts[i - 1]) * k) / 64;
      maxDev = Math.max(maxDev, distanceToChord(cubicAt(p0, c1, c2, p1, t), points[i - 1], points[i]));
    }
  }
  return { points: points.slice(1), maxDev };
}

/** Ear clipping of a simple counter-clockwise polygon. */
function triangulate(poly) {
  const area2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => area2(a, b, p) >= 0 && area2(b, c, p) >= 0 && area2(c, a, p) >= 0;
  const idx = poly.map((_, i) => i);
  const tris = [];
  while (idx.length > 3) {
    let clipped = false;
    for (let k = 0; k < idx.length; k += 1) {
      const i0 = idx[(k + idx.length - 1) % idx.length];
      const i1 = idx[k];
      const i2 = idx[(k + 1) % idx.length];
      const [a, b, c] = [poly[i0], poly[i1], poly[i2]];
      if (area2(a, b, c) <= 0) continue;
      if (idx.some((j) => j !== i0 && j !== i1 && j !== i2 && inside(poly[j], a, b, c))) continue;
      tris.push([i0, i1, i2]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) throw new Error("triangulation failed: polygon is not simple or not counter-clockwise");
  }
  tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

/** Flat boundary mesh of a snapshot piece (outer contour only). */
export function meshPiece(snapshotPiece, tol) {
  const contour = snapshotPiece.contours[0];
  const poly = [contour.start];
  const edges = [];
  let cur = contour.start;
  for (const seg of contour.segments) {
    let pts;
    let dev = 0;
    if (seg.kind === "line") pts = [seg.end];
    else if (seg.kind === "cubic") ({ points: pts, maxDev: dev } = sampleCubic(cur, seg.control1, seg.control2, seg.end, tol));
    else throw new Error(`segment kind ${seg.kind} is not used by the fixture`);
    edges.push({ edgeId: seg.edgeId, sampleCount: pts.length + 1, maxDeviationMm: q(dev) });
    poly.push(...pts);
    cur = seg.end;
  }
  poly.pop(); // the last end equals the start
  const qp = poly.map((p) => [q(p[0]), q(p[1])]);
  const triangles = triangulate(qp);
  const bb = snapshotPiece.boundingBox;
  const w = bb.max[0] - bb.min[0];
  const h = bb.max[1] - bb.min[1];
  return {
    mesh: {
      positions: qp.map((p) => [p[0], p[1], 0]),
      uvs: qp.map((p) => [q((p[0] - bb.min[0]) / w), q((p[1] - bb.min[1]) / h)]),
      triangles,
    },
    vertexUvToPattern2D: { kind: "affine", matrix: [q(w), 0, bb.min[0], 0, q(h), bb.min[1]] },
    edgeBindings: sortBy(edges, "edgeId"),
    maxApproximationErrorMm: q(Math.max(...edges.map((e) => e.maxDeviationMm))),
  };
}

// ---------------------------------------------------------------------------
// glTF view of a scene snapshot (one node per panel, metres, Y up)

function gltfOf(snapshot, meshes) {
  const chunks = [];
  const accessors = [];
  const bufferViews = [];
  const gltfMeshes = [];
  const nodes = [];
  let offset = 0;
  const push = (buf, target) => {
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target });
    chunks.push(buf);
    offset += buf.length;
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      offset += pad;
    }
    return bufferViews.length - 1;
  };
  for (const b of snapshot.panelBindings) {
    const m = meshes.get(b.panelInstanceId);
    const pos = Buffer.alloc(m.mesh.positions.length * 12);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    m.mesh.positions.forEach((p, i) => {
      const local = [b.mirrored ? -p[0] : p[0], p[1], 0];
      const r = rotate(b.transform.rotation, local).map((v) => v * MM_TO_M);
      const w = r.map((v, k) => Math.fround(v + b.transform.translationM[k]));
      w.forEach((v, k) => {
        pos.writeFloatLE(v, i * 12 + k * 4);
        min[k] = Math.min(min[k], v);
        max[k] = Math.max(max[k], v);
      });
    });
    const idx = Buffer.alloc(m.mesh.triangles.length * 12);
    m.mesh.triangles.forEach((t, i) => {
      // A mirrored panel reverses orientation: flip the winding so faces stay front-facing.
      const tri = b.mirrored ? [t[0], t[2], t[1]] : t;
      tri.forEach((v, k) => idx.writeUInt32LE(v, i * 12 + k * 4));
    });
    const pv = push(pos, 34962);
    const iv = push(idx, 34963);
    accessors.push({ bufferView: pv, componentType: 5126, count: m.mesh.positions.length, type: "VEC3", min, max });
    accessors.push({ bufferView: iv, componentType: 5125, count: m.mesh.triangles.length * 3, type: "SCALAR" });
    gltfMeshes.push({ name: b.panelInstanceId, primitives: [{ attributes: { POSITION: accessors.length - 2 }, indices: accessors.length - 1, mode: 4 }] });
    nodes.push({ name: b.panelInstanceId, mesh: gltfMeshes.length - 1, extras: { d2p: { panelInstanceId: b.panelInstanceId, pieceId: b.pieceId, cutInstanceKey: b.cutInstanceKey } } });
  }
  const buffer = Buffer.concat(chunks);
  const gltf = {
    asset: { version: "2.0", generator: "d2p open standard Golden T-Shirt 3D generator", extras: { d2p: { sceneSnapshotId: snapshot.sceneSnapshotId, sceneDigest: snapshot.sceneDigest } } },
    scene: 0,
    scenes: [{ name: snapshot.sceneSnapshotId, nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: gltfMeshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: buffer.length, uri: `data:application/octet-stream;base64,${buffer.toString("base64")}` }],
  };
  return `${JSON.stringify(gltf, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Documents of the scene-snapshot, inspection and proposal cases

const CASE_MESH_PROFILE = {
  documentType: "d2p:mesh-profile",
  schemaVersion: V,
  profileId: "org.example.conformance:boundary-only",
  version: "1.0.0",
  status: "provisional",
  title: "Boundary-only meshing (conformance kit)",
  description: "Conformance-case profile: the mesh boundary samples every edge within maxChordDeviationMm and the interior is triangulated by ear clipping without interior vertices. It is case data, not a quality profile.",
  sampling: { maxChordDeviationMm: 0.05, minSamplesPerEdge: 2 },
  triangulation: { maxEdgeLengthMm: 1000 },
  maxPlanarDeviationMm: 0.1,
  toleranceProfile: TOLERANCE_3D,
};
const MESH_BACKEND = { backendId: "conformance-kit-boundary-mesher", backendVersion: "1.0.0", adapterVersion: "1.0.0" };

function meshResult(src, g, r, s, panel, meshed) {
  const pin = g.patternEvaluations[0];
  const doc = {
    documentType: "d2p:panel-mesh-result",
    schemaVersion: V,
    meshResultId: `pmr_golden-tshirt-3d-${r}-${s}-${panel.id.replace(/^panel-/, "")}`,
    createdAt: T_DERIVED,
    garmentRef: { artifactId: g.artifactId, revisionId: g.revisionId },
    panelInstanceId: panel.id,
    pieceId: panel.pieceId,
    cutInstanceKey: panel.cutInstanceKey,
    evaluationRef: clone(pin.evaluationRef),
    geometryDigest: pin.geometryDigest,
    meshProfile: { id: CASE_MESH_PROFILE.profileId, version: CASE_MESH_PROFILE.version },
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

function sceneSnapshot(src, g, input, r, s, meshResults, profile, extra = {}) {
  const { panelBindings, seamBindings, controlMeasures } = sceneBindings(src, g, r, s);
  const doc = {
    documentType: "d2p:scene-snapshot",
    schemaVersion: V,
    sceneSnapshotId: `ssn_golden-tshirt-3d-${r}-${s}`,
    createdAt: T_DERIVED,
    sceneInputRef: { id: input.sceneInputId, digest: contentDigestOf(input) },
    garmentRef: clone(input.garmentRef),
    arrangementId: ARRANGEMENT_ID,
    mode: "arrangement",
    evaluationKey: input.evaluationKey,
    coordinateSystem: COORDS,
    sceneUnit: "m",
    unitConversion: CONVERSION,
    inputDigests: sortBy(
      [
        { role: "garment", artifactRef: clone(input.garmentRef), digest: contentDigestOf(g) },
        { role: "mesh-profile", id: { id: profile.profileId, version: profile.version }, digest: digestOf(profile) },
        { role: "pattern", artifactRef: clone(g.patternEvaluations[0].patternRef), digest: contentDigestOf(src.pattern[r]) },
        ...(extra.inputDigests ?? []),
      ],
      "role",
    ),
    patternEvaluations: clone(input.patternEvaluations),
    meshProfile: { id: profile.profileId, version: profile.version },
    backendBuild: { sceneBuilder: { name: "d2p-conformance-scene-builder", version: "1.0.0" }, mesher: MESH_BACKEND },
    panelBindings,
    seamBindings,
    controlMeasures,
    meshRefs: sortBy(meshResults.map((m) => ({ panelInstanceId: m.panelInstanceId, meshResultRef: { id: m.meshResultId, digest: m.resultDigest }, meshDigest: m.meshDigest })), "panelInstanceId"),
    qualityStatus: extra.qualityStatus ?? "preview",
    diagnostics: [],
  };
  doc.bindingsDigest = bindingsDigestOf(doc);
  doc.sceneDigest = sceneDigestOf(doc);
  return doc;
}

const lit = (value, unit = "mm") => ({ op: "literal", value, unit });

function proposalAndInspection(src, snapshot, scenePath) {
  const sleeveLength = src.pattern.r1.parameters.find((p) => p.id === "sleeve-length");
  const update = { parameterId: "sleeve-length", expr: { op: "add", args: [clone(sleeveLength.expr), lit(30)] } };
  const inspectionId = "ier_golden-tshirt-3d-r1-size-a-edits";
  const proposal = {
    documentType: "d2p:pattern-proposal",
    schemaVersion: V,
    proposalId: "ppr_golden-tshirt-3d-r1-size-a-sleeve-length",
    createdAt: T_DERIVED,
    basePatternRef: clone(src.pattern.r1 && { artifactId: src.pattern.r1.artifactId, revisionId: src.pattern.r1.revisionId }),
    inspectionRef: { id: inspectionId },
    origin: "mapped-mesh-edit",
    parameterUpdates: [update],
    rationale: "The left sleeve's underarm edge was lengthened by 30 mm in the 3D view. The edit maps to the sleeve-length parameter; a reviewer accepts the proposal by submitting a d2p:pattern.parameters.update command against pattern r1.",
    diagnostics: [],
  };
  const inspection = {
    documentType: "d2p:inspect-3d-edit-result",
    schemaVersion: V,
    inspectionId,
    createdAt: T_DERIVED,
    sceneSnapshotRef: { id: snapshot.sceneSnapshotId, digest: snapshot.sceneDigest },
    basePatternRef: clone(proposal.basePatternRef),
    edits: [
      {
        editId: "edit-1",
        target: { panelInstanceId: "panel-sleeve-left", edgeId: "sleeve-underarm-front" },
        delta: { kind: "d2p:edge-length-change", deltaMm: 30 },
        classification: "supported",
        parameterUpdates: [clone(update)],
        message: "Maps to sleeve-length (+30 mm); both sleeves change, because they are cut from one piece.",
      },
      {
        editId: "edit-2",
        target: { panelInstanceId: "panel-front", edgeId: "front-side-left" },
        delta: { kind: "d2p:edge-length-change", deltaMm: 15 },
        classification: "ambiguous",
        parameterCandidates: ["armhole-depth", "body-length"],
        message: "The side seam length depends on more than one parameter; choose one.",
      },
      {
        editId: "edit-3",
        target: { panelInstanceId: "panel-back" },
        delta: { kind: "d2p:free-deformation" },
        classification: "forbidden",
        reasonCode: "d2p:free-deformation-not-invertible",
        message: "A free surface deformation has no lossless inverse to a pattern; no proposal is made.",
      },
    ],
    proposalRef: { id: proposal.proposalId, digest: contentDigestOf(proposal) },
    diagnostics: [],
  };
  inspection.resultDigest = resultDigestOf(inspection, ["inspectionId"]);
  return { proposal, inspection, scenePath };
}

// ---------------------------------------------------------------------------
// Fixture, negative fixtures and cases

function caseDoc(level, name, title, documents, expect, testIds, description) {
  const doc = {
    documentType: "d2p:conformance-case",
    schemaVersion: V,
    caseId: `${CASE_DIR_NAME}.${name}`,
    level,
    title: `Golden T-Shirt 3D: ${title}`,
    documents,
    expect,
  };
  if (testIds?.length) doc.testIds = testIds;
  if (description) doc.description = description;
  return doc;
}

const subjects = (paths) => paths.map((p) => ({ path: p, role: "subject" }));
const contexts = (paths) => paths.map((p) => ({ path: p, role: "context" }));

/**
 * Builds everything. Returns { files: Map<repo-relative path, string>, report }.
 * JSON documents are serialized with two-space indentation and a final newline.
 */
export function buildAll(root) {
  const src = twoD(root);
  const docs = new Map(); // fixture-relative path -> { doc, role }
  const add = (rel, doc, role) => docs.set(rel, { doc, role });
  const checks = [];
  const assert = (cond, what) => {
    if (!cond) throw new Error(`Golden T-Shirt 3D assertion failed: ${what}`);
    checks.push(what);
  };

  const garments = {};
  const inputs = {};
  const expectations = {};
  for (const s of SIZES) {
    add(`inputs/artifacts/garment-${s}.json`, artifactMeta(s), "input");
    for (const r of REVS) {
      const g = garment(src, r, s);
      garments[`${r}-${s}`] = g;
      const base = r === "r1" ? "inputs" : "inputs/change";
      add(`${base}/garment-${s}-${r}.json`, g, "input");
      add(`${base}/revisions/garment-${s}-${r}.json`, revisionRecord(g, r), "input");
      const input = sceneInput(g, r, s);
      inputs[`${r}-${s}`] = input;
      add(`${base}/scene-inputs/${r}-${s}.json`, input, "input");
      const exp = expectation(src, g, input, r, s);
      expectations[`${r}-${s}`] = exp;
      add(`expected/scenes/${r}-${s}.json`, exp, "expected");
    }
  }

  // Oracle assertions (T3D-001..005, 008, 009; GAR-001, 003, 004, 013, 017; SIM-001, 002, 003, 005).
  const ids = (g) => canonical([g.panelInstances.map((p) => p.id), g.sewingBindings.map((b) => b.id), g.arrangements.map((a) => a.id)]);
  const firstIds = ids(garments["r1-size-a"]);
  for (const g of Object.values(garments)) assert(ids(g) === firstIds, `${g.revisionId}: panel, binding and arrangement IDs equal those of size A r1 (stable IDs across sizes and revisions)`);
  for (const g of Object.values(garments)) {
    const sleeves = g.panelInstances.filter((p) => p.pieceId === "sleeve");
    assert(sleeves.length === 2 && sleeves[0].id !== sleeves[1].id, `${g.revisionId}: two sleeve panel instances of one sleeve piece with distinct IDs`);
  }
  for (const s of SIZES) {
    const a = expectations[`r1-${s}`];
    const b = expectations[`r2-${s}`];
    assert(garments[`r1-${s}`].patternEvaluations[0].geometryDigest !== garments[`r2-${s}`].patternEvaluations[0].geometryDigest, `${s}: pattern r2 pins a different geometry digest than r1`);
    assert(inputs[`r1-${s}`].evaluationKey !== inputs[`r2-${s}`].evaluationKey, `${s}: the r2 scene input has a new evaluation key, so r1 scenes are stale`);
    assert(a.bindingsDigest !== b.bindingsDigest, `${s}: r2 bindings digest differs (new interface lengths)`);
    assert(canonical(a.panelBindings.map((p) => p.panelInstanceId)) === canonical(b.panelBindings.map((p) => p.panelInstanceId)), `${s}: r2 keeps every panel instance ID`);
    for (const e of [a, b]) {
      const anchor = (id) => e.anchors.find((x) => x.panelInstanceId === id).positionM;
      assert(anchor("panel-front")[2] > 0 && anchor("panel-back")[2] < 0, `${e.expectationId}: front faces +Z, back -Z`);
      assert(anchor("panel-sleeve-left")[0] > 0 && anchor("panel-sleeve-right")[0] < 0, `${e.expectationId}: left sleeve on +X (wearer's left), right sleeve on -X`);
      for (const c of e.controlMeasures) assert(c.lengthM === q(c.lengthMm * MM_TO_M), `${e.expectationId}: ${c.seamInterfaceId} lengthM = lengthMm × 0.001`);
      const pattern = src.pattern[e.expectationId.includes("-r2-") ? "r2" : "r1"];
      for (const sb of e.seamBindings.filter((x) => x.kind === "seam-connection")) {
        const conn = pattern.seamConnections.find((c) => c.id === sb.seamConnectionId);
        assert(conn && canonical(conn.interfaceIds) === canonical(sb.interfaceBindings.map((x) => x.seamInterfaceId)), `${e.expectationId}: ${sb.id} binds the existing interfaces of ${sb.seamConnectionId} in order`);
      }
    }
  }
  assert(expectations["r1-size-a"].bindingsDigest !== expectations["r1-size-b"].bindingsDigest, "size A and size B scenes differ");

  // External files (repository-relative) the fixture bundle needs.
  const sampleCut = loadJson(root, "vocabularies/validation/profiles/sample-cut-1.0.0.json");
  const external = [
    src.files.pattern.r1,
    src.files.pattern.r2,
    src.files.sizeSystem,
    src.files.gradingRuleSet,
    src.files.fitProfile,
    src.files.garmentSpec,
    ...Object.values(src.evaluationPath),
    ...Object.values(src.snapshotPath),
    "tolerance-profiles/golden-tshirt-2d-1.0.0.json",
    TOLERANCE_3D_PATH,
    "vocabularies/measurement-definitions/measurement-definitions-1.0.0.json",
    MESH_PROFILE_PATH,
    "vocabularies/validation/profiles/sample-cut-1.0.0.json",
    ...sampleCut.rules.map((r) => `vocabularies/validation/rules/${r.ruleId.slice(4)}-${r.ruleVersion}.json`),
  ].sort();
  const fx = (rel) => `${FIXTURE_DIR}/${rel}`;
  const inputPaths = [...docs].filter(([, v]) => v.role === "input").map(([k]) => fx(k));

  // Negative fixtures (catalog §4.5): changed documents only, with their cases.
  const cases = new Map(); // repo path -> case doc
  const negative = (name, level, title, changed, replaced, expect, testIds, description, extraContext = []) => {
    const subjectPaths = [];
    for (const [file, doc] of changed) {
      const rel = `negative/${name}/${file}`;
      add(rel, doc, "negative");
      subjectPaths.push(fx(rel));
    }
    const ctx = [...inputPaths.filter((p) => !replaced.includes(p)), ...extraContext, ...external];
    const c = caseDoc(level, name, title, [...subjects(subjectPaths), ...contexts(ctx)], expect, testIds, description);
    add(`negative/${name}/case.json`, c, "negative");
    cases.set(`conformance/${level}/${CASE_DIR_NAME}/${name}.case.json`, c);
    return subjectPaths;
  };
  const gA = garments["r1-size-a"];
  const gAPath = fx("inputs/garment-size-a-r1.json");
  const gARev = fx("inputs/revisions/garment-size-a-r1.json");
  const reject = (code, documentPath) => ({ outcome: "reject", diagnostics: [documentPath ? { code, documentPath } : { code }] });
  const garmentNegative = (name, level, title, mutate, code, testIds, description) => {
    const g = clone(gA);
    mutate(g);
    const p = fx(`negative/${name}/garment.json`);
    negative(name, level, title, [["garment.json", g]], [gAPath, gARev], reject(code, p), testIds, description);
  };

  garmentNegative("unknown-piece", "referential", "panel instance names a piece the pattern does not have", (g) => {
    g.panelInstances.find((p) => p.id === "panel-front").pieceId = "front-yoke";
  }, "D2P-REF-003", ["GAR-002"], "A garment can only bind pieces of its pinned pattern revision; a missing or foreign piece is an unresolved reference.");
  garmentNegative("unknown-seam-connection", "referential", "sewing binding names a seam connection the pattern does not have", (g) => {
    g.sewingBindings.find((b) => b.id === "bind-seam-shoulder-left").seamConnectionId = "seam-collar";
  }, "D2P-REF-003", ["GAR-002", "T3D-004"], "Sewing bindings refer to existing pattern seam elements only; the garment never defines seams of its own.");
  garmentNegative("unknown-cut-instance", "referential", "panel instance names a cut instance the pattern does not declare", (g) => {
    g.panelInstances.find((p) => p.id === "panel-sleeve-right").cutInstanceKey = "sleeve-middle";
  }, "D2P-REF-010", ["GAR-002"]);
  garmentNegative("evaluation-pin-mismatch", "referential", "evaluation reference pins pattern r2 but the evaluation evaluates r1", (g) => {
    g.patternEvaluations[0].patternRef.revisionId = "rev_golden-tshirt-pattern-r2";
  }, "D2P-REF-007", ["GAR-011", "T3D-001"], "A garment pins pattern revision, size, evaluation and snapshot digest together; disagreeing pins are rejected instead of silently substituting another revision.");
  garmentNegative("duplicate-cut-instance", "semantic", "a third sleeve panel instance binds the left sleeve cut instance again", (g) => {
    g.panelInstances.push({ id: "panel-sleeve-left-copy", patternEvaluationId: EVAL_REF_ID, pieceId: "sleeve", cutInstanceKey: "sleeve-left", side: "left" });
    const left = g.arrangements[0].placements.find((p) => p.panelInstanceId === "panel-sleeve-left");
    g.arrangements[0].placements.push({ ...clone(left), panelInstanceId: "panel-sleeve-left-copy" });
  }, "D2P-SEM-120", ["GAR-001", "T3D-002", "SIM-001"], "Two panel instances may share one piece definition, but each binds its own cut instance; a cut instance is never bound twice.");
  garmentNegative("binding-wrong-panel", "semantic", "left cap interface bound to the right sleeve panel", (g) => {
    const b = g.sewingBindings.find((x) => x.id === "bind-seam-armhole-front-left");
    b.interfaceBindings[1].panelInstanceId = "panel-sleeve-right";
  }, "D2P-SEM-121", ["T3D-004", "QEV-011"], "An interface binding must name the panel instance that carries the interface's cut instance.");
  garmentNegative("binding-swapped-sides", "semantic", "interface bindings in side B, side A order", (g) => {
    const b = g.sewingBindings.find((x) => x.id === "bind-seam-side-left");
    b.interfaceBindings.reverse();
  }, "D2P-SEM-121", ["T3D-004"]);
  garmentNegative("arrangement-incomplete", "semantic", "arrangement without a placement for the right sleeve", (g) => {
    g.arrangements[0].placements = g.arrangements[0].placements.filter((p) => p.panelInstanceId !== "panel-sleeve-right");
  }, "D2P-SEM-122", ["GAR-006"], "The arrangement mode needs one deterministic placement per panel instance and no physics.");

  const expA = expectations["r1-size-a"];
  const expPath = fx("expected/scenes/r1-size-a.json");
  const expContext = [fx("expected/scenes/r1-size-b.json")].filter(() => false);
  const expectationNegative = (name, level, title, mutate, code, testIds, description) => {
    const e = clone(expA);
    mutate(e);
    if (e.sceneUnit === "m") e.bindingsDigest = bindingsDigestOf(e);
    const p = fx(`negative/${name}/scene-expectation.json`);
    negative(name, level, title, [["scene-expectation.json", e]], [], reject(code, p), testIds, description, expContext);
    return p;
  };
  expectationNegative("scene-unit-mm", "structural", "scene expectation in millimetres", (e) => {
    e.sceneUnit = "mm";
  }, "D2P-STR-001", ["SIM-005", "T3D-005"], "The scene unit is always the metre; millimetre scene coordinates are not expressible.");
  expectationNegative("scene-unit-not-converted", "semantic", "control measure lengthM copied from lengthMm without conversion", (e) => {
    const c = e.controlMeasures.find((x) => x.seamInterfaceId === "si-front-side-left");
    c.lengthM = c.lengthMm;
  }, "D2P-SEM-123", ["T3D-005", "SIM-005", "GAR-017", "EXP-013"]);
  expectationNegative("scene-panel-missing", "semantic", "scene without the right sleeve panel binding", (e) => {
    e.panelBindings = e.panelBindings.filter((p) => p.panelInstanceId !== "panel-sleeve-right");
    e.anchors = e.anchors.filter((p) => p.panelInstanceId !== "panel-sleeve-right");
  }, "D2P-SEM-124", ["QEV-011", "GAR-013", "SIM-002"], "A scene keeps every panel and seam reference of its garment.");
  {
    const g = clone(gA);
    g.sewingBindings.find((b) => b.id === "bind-seam-shoulder-left").interfaceBindings.push({ seamInterfaceId: "si-front-shoulder-right", panelInstanceId: "panel-front" });
    const p = fx("negative/sewing-binding-three-interfaces/garment.json");
    negative("sewing-binding-three-interfaces", "structural", "seam-connection binding with three interfaces", [["garment.json", g]], [gAPath, gARev], reject("D2P-STR-001", p), ["T3D-004"], "Seam connections are binary, so a seam-connection binding binds exactly two interfaces.");
  }

  // Personal data must never reach a scene (T3D-012, SIM-009).
  {
    const profile = clone(src.bodyProfile);
    profile.artifactId = "art_golden-tshirt-3d-private-body-profile";
    profile.revisionId = "rev_golden-tshirt-3d-private-body-profile-r1";
    const meta = {
      documentType: "d2p:artifact",
      schemaVersion: V,
      artifactId: profile.artifactId,
      artifactType: "d2p:body-measurement-profile",
      name: "Individual body measurement profile (negative test data)",
      dataClassification: "sensitive-personal",
      createdAt: T_R1,
      createdBy: ACTOR,
    };
    const snapshot = sceneSnapshot(src, gA, inputs["r1-size-a"], "r1", "size-a", [], loadJson(root, MESH_PROFILE_PATH), {
      qualityStatus: "unsupported",
      inputDigests: [{ role: "body-measurement-profile", artifactRef: { artifactId: profile.artifactId, revisionId: profile.revisionId }, digest: contentDigestOf(profile) }],
    });
    snapshot.diagnostics = [];
    const p = fx("negative/personal-body-reference/scene-snapshot.json");
    negative(
      "personal-body-reference",
      "semantic",
      "scene snapshot pins a sensitive-personal body measurement profile",
      [["scene-snapshot.json", snapshot], ["body-measurement-profile.json", profile], ["artifact.json", meta]],
      [],
      reject("D2P-SEM-050", p),
      ["T3D-012", "SIM-009"],
      "An anonymous scene export never references personal body or fit data. The snapshot is otherwise consistent (quality status unsupported, no meshes).",
    );
  }

  // Fixture cases.
  const manifestPath = fx("manifest.json");
  cases.set(`conformance/referential/${CASE_DIR_NAME}/manifest-integrity.case.json`, caseDoc("referential", "manifest-integrity", "manifest integrity and resolution of the whole fixture", [{ path: manifestPath, role: "manifest" }], { outcome: "accept", diagnostics: [] }, ["T3D-001", "T3D-010", "SIM-004", "GAR-011", "GAR-018", "QEV-011"], "Every listed file matches its digest, nothing unlisted is in the fixture directory, and every garment, scene input and scene expectation resolves against the pinned 2D evaluations, snapshots and patterns."));
  cases.set(`conformance/semantic/${CASE_DIR_NAME}/fixture.case.json`, caseDoc("semantic", "fixture", "all semantic rules on the whole fixture", [{ path: manifestPath, role: "manifest" }], { outcome: "accept", diagnostics: [] }, ["GAR-001", "GAR-003", "GAR-004", "GAR-013", "GAR-015", "GAR-017", "T3D-002", "T3D-004", "T3D-005", "T3D-008", "T3D-009", "SIM-001", "SIM-002", "SIM-003", "SIM-005", "QEV-011"], "Both sizes and both pattern revisions: two sleeve panel instances of one piece, bindings to existing interfaces, exact mm to m conversion, stable IDs across sizes and revisions."));

  // Scene-snapshot, inspection and proposal cases (case data next to the cases).
  const caseFiles = new Map(); // repo path -> text
  const json = (doc) => `${JSON.stringify(doc, null, 2)}\n`;
  const dataDir = `conformance/semantic/${CASE_DIR_NAME}/scene-r1-size-a`;
  const meshes = new Map();
  const meshDocs = [];
  for (const panel of PANELS) {
    const piece = src.snapshot["r1-size-a"].pieces.find((p) => p.pieceId === panel.pieceId);
    const m = meshResult(src, gA, "r1", "size-a", panel, meshPiece(piece, CASE_MESH_PROFILE.sampling.maxChordDeviationMm));
    meshes.set(panel.id, m);
    meshDocs.push(m);
    assert(m.maxApproximationErrorMm <= CASE_MESH_PROFILE.maxPlanarDeviationMm, `${m.meshResultId}: approximation error ${m.maxApproximationErrorMm} mm within the profile`);
    caseFiles.set(`${dataDir}/mesh-${panel.id.replace(/^panel-/, "")}.json`, json(m));
  }
  assert(canonical(meshes.get("panel-sleeve-left").mesh) === canonical(meshes.get("panel-sleeve-right").mesh), "both sleeve panel meshes come from the same piece geometry (the mirror is the scene's job)");
  caseFiles.set(`${dataDir}/mesh-profile.json`, json(CASE_MESH_PROFILE));
  const snapshot = sceneSnapshot(src, gA, inputs["r1-size-a"], "r1", "size-a", meshDocs, CASE_MESH_PROFILE);
  assert(snapshot.bindingsDigest === expA.bindingsDigest, "the scene snapshot's bindingsDigest equals the expected bindingsDigest (T3D-015: bindings do not depend on the mesher)");
  const gltf = gltfOf(snapshot, meshes);
  snapshot.representations = [{ format: "gltf-2.0", mediaType: "model/gltf+json", path: "scene.gltf", digest: `sha256:${createHash("sha256").update(gltf).digest("hex")}` }];
  caseFiles.set(`${dataDir}/scene.gltf`, gltf);
  caseFiles.set(`${dataDir}/scene-snapshot.json`, json(snapshot));
  const { proposal, inspection } = proposalAndInspection(src, snapshot);
  caseFiles.set(`${dataDir}/pattern-proposal.json`, json(proposal));
  caseFiles.set(`${dataDir}/inspect-3d-edit-result.json`, json(inspection));
  const sceneContext = [gAPath, fx("inputs/scene-inputs/r1-size-a.json"), src.files.pattern.r1, src.evaluationPath["r1-size-a"], src.snapshotPath["r1-size-a"], src.files.sizeSystem, src.files.gradingRuleSet, src.files.fitProfile, src.files.garmentSpec, "vocabularies/measurement-definitions/measurement-definitions-1.0.0.json", "tolerance-profiles/golden-tshirt-2d-1.0.0.json", "vocabularies/validation/profiles/sample-cut-1.0.0.json", ...sampleCut.rules.map((r) => `vocabularies/validation/rules/${r.ruleId.slice(4)}-${r.ruleVersion}.json`)].sort();
  const meshPaths = PANELS.map((p) => `${dataDir}/mesh-${p.id.replace(/^panel-/, "")}.json`);
  cases.set(`conformance/semantic/${CASE_DIR_NAME}/scene-snapshot-preview.case.json`, caseDoc("semantic", "scene-snapshot-preview", "arrangement scene snapshot with four panel meshes and a glTF view", [...subjects([`${dataDir}/scene-snapshot.json`, ...meshPaths]), ...contexts([`${dataDir}/mesh-profile.json`, ...sceneContext])], { outcome: "accept", diagnostics: [] }, ["SIM-004", "SIM-012", "T3D-003", "T3D-006", "T3D-007", "T3D-010", "T3D-015", "TOP-008", "EXP-013", "GAR-006", "GAR-014"], "Scene and meshes pin every input, backend and digest; meshes bind pattern edges by ID, never by vertex index; the scene needs no physics solver. scene.gltf next to the snapshot is the glTF view (one node per panel instance, metres, Y up, sceneDigest in asset.extras) for import tests with independent viewers."));
  cases.set(`conformance/semantic/${CASE_DIR_NAME}/inspect-3d-edit.case.json`, caseDoc("semantic", "inspect-3d-edit", "3D edits classified as supported, ambiguous and forbidden; one proposal", [...subjects([`${dataDir}/inspect-3d-edit-result.json`, `${dataDir}/pattern-proposal.json`]), ...contexts([`${dataDir}/scene-snapshot.json`, ...meshPaths, `${dataDir}/mesh-profile.json`, ...sceneContext])], { outcome: "accept", diagnostics: [] }, ["CAD-012", "T3D-014", "SIM-008", "GAR-008", "GAR-009"], "A 3D edit never writes the pattern: the supported edit becomes a pattern proposal, the ambiguous and the forbidden edit are reported explicitly."));
  {
    const bad = clone(proposal);
    bad.parameterUpdates.push({ parameterId: "bust-ease", expr: lit(120) });
    const badInspection = clone(inspection);
    badInspection.proposalRef.digest = contentDigestOf(bad);
    badInspection.resultDigest = resultDigestOf(badInspection, ["inspectionId"]);
    const dir = `conformance/semantic/${CASE_DIR_NAME}/inspect-proposal-mismatch`;
    caseFiles.set(`${dir}/pattern-proposal.json`, json(bad));
    caseFiles.set(`${dir}/inspect-3d-edit-result.json`, json(badInspection));
    cases.set(`conformance/semantic/${CASE_DIR_NAME}/inspect-proposal-mismatch.case.json`, caseDoc("semantic", "inspect-proposal-mismatch", "proposal holds an update no supported edit asked for", [...subjects([`${dir}/inspect-3d-edit-result.json`, `${dir}/pattern-proposal.json`]), ...contexts([`${dataDir}/scene-snapshot.json`, ...meshPaths, `${dataDir}/mesh-profile.json`, ...sceneContext])], reject("D2P-SEM-126", `${dir}/inspect-3d-edit-result.json`), ["CAD-012", "T3D-014"]));
  }
  {
    const bad = clone(inspection);
    delete bad.edits[0].parameterUpdates;
    const dir = `conformance/structural/${CASE_DIR_NAME}/inspect-supported-without-updates`;
    caseFiles.set(`${dir}/inspect-3d-edit-result.json`, json(bad));
    cases.set(`conformance/structural/${CASE_DIR_NAME}/inspect-supported-without-updates.case.json`, caseDoc("structural", "inspect-supported-without-updates", "supported edit without parameter updates", subjects([`${dir}/inspect-3d-edit-result.json`]), reject("D2P-STR-001", `${dir}/inspect-3d-edit-result.json`), ["T3D-014", "CAD-012"], "A supported back-projection always states its parameter updates; nothing is applied implicitly."));
  }
  {
    const bad = clone(meshes.get("panel-front"));
    bad.maxApproximationErrorMm = 0.25;
    bad.resultDigest = resultDigestOf(bad, ["meshResultId"]);
    const dir = `conformance/semantic/${CASE_DIR_NAME}/mesh-approximation-exceeded`;
    caseFiles.set(`${dir}/mesh-front.json`, json(bad));
    cases.set(`conformance/semantic/${CASE_DIR_NAME}/mesh-approximation-exceeded.case.json`, caseDoc("semantic", "mesh-approximation-exceeded", "panel mesh deviates more than its mesh profile permits", [...subjects([`${dir}/mesh-front.json`]), ...contexts([`${dataDir}/mesh-profile.json`, ...sceneContext])], reject("D2P-SEM-125", `${dir}/mesh-front.json`), ["T3D-003"]));
  }

  // Manifest.
  const files = [...docs].map(([rel, { doc, role }]) => ({ path: rel, role, documentType: doc.documentType, digest: digestOf(doc) }));
  const manifest = {
    documentType: "d2p:fixture-manifest",
    schemaVersion: V,
    fixtureId: "golden-tshirt-3d",
    fixtureVersion: "1.0.0",
    title: "Golden T-Shirt 3D v1",
    description: "Synthetic 3D fixture on top of the Golden T-Shirt v1: one garment per size (size-a, size-b) pinning the regular-woven evaluation, with front, back and two sleeve panel instances of one sleeve piece, sewing bindings to the existing seam connections and sewing groups, a flat-lay arrangement, scene inputs and expected scene structures (panel and seam bindings, control measures in mm and m, anchors, bindings digest). The change case rebinds both garments to pattern r2 (bust-ease +20 mm, sleeve-length +30 mm): element IDs stay, digests change. Meshes are not expected results. Generated by tools/oracle/golden-tshirt-3d.mjs.",
    synthetic: true,
    standardVersion: V,
    digestProfile: "d2p-digest-v1",
    toleranceProfile: { profileId: TOLERANCE_3D.id, version: TOLERANCE_3D.version, path: TOLERANCE_3D_PATH, digest: digestOf(loadJson(root, TOLERANCE_3D_PATH)) },
    files: sortBy(files, "path"),
    externalFiles: external.map((p) => ({ path: p, documentType: loadJson(root, p).documentType, digest: digestOf(loadJson(root, p)) })),
    review: { status: "pending", notes: "Domain review of the 3D arrangement (panel orientation, sides, bindings) by a pattern maker or seamstress is pending (QEV-016)." },
  };
  manifest.fixtureDigest = digestOf(manifest, ["fixtureDigest"]);

  const out = new Map();
  for (const [rel, { doc }] of docs) out.set(`${FIXTURE_DIR}/${rel}`, json(doc));
  out.set(`${FIXTURE_DIR}/manifest.json`, json(manifest));
  for (const [p, c] of cases) out.set(p, json(c));
  for (const [p, t] of caseFiles) out.set(p, t);
  return { files: out, report: { checks, manifest } };
}

function canonical(x) {
  return JSON.stringify(x);
}
