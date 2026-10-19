// The Golden T-Shirt construction.
//
// buildPattern() writes the construction as a d2p:pattern content document
// (parameters, measurement inputs, feature graph, pieces, seam interfaces,
// seam connections, sewing groups). directConstruction() computes the same
// points with plain JavaScript arithmetic, independently of the expression
// interpreter; the oracle requires both to agree for every point feature.
//
// All proportions and constants below are SYNTHETIC design choices for a test
// fixture. They are not drafting rules, size tables or product norms.
import * as g from "./geometry.mjs";
import { add, cos, div, ev, fo, lit, m, max, mul, neg, num, p, pi, rad, sqrt, sub } from "./expr.mjs";
import { ids } from "./ids.mjs";

export const MEASUREMENT_INPUTS = [
  { key: "chest-girth", definitionId: "d2p:body.chest-girth", required: true },
  { key: "waist-girth", definitionId: "d2p:body.waist-girth", required: true },
  { key: "shoulder-width", definitionId: "d2p:body.shoulder-width", required: true },
  { key: "arm-length", definitionId: "d2p:body.arm-length", required: true },
  { key: "neck-girth", definitionId: "d2p:body.neck-girth", required: true },
  { key: "back-length", definitionId: "d2p:body.back-length", required: true },
];

/** Synthetic constants of the construction (mm unless noted). */
export const C = {
  bustEase: 100,
  sleeveLengthRatio: 0.33,
  bodyLengthAddition: 260,
  neckWidthAddition: 10,
  backNeckDepth: 20,
  shoulderExtension: 10,
  shoulderDrop: 45,
  armholeDepthAddition: 130,
  frontScoopRatio: 0.18,
  backScoopRatio: 0.12,
  frontHollow: 12,
  backHollow: 6,
  frontArmholeCtrlDrop: 0.5,
  backArmholeCtrlDrop: 0.55,
  capEaseFront: 6,
  capEaseBack: 8,
  capHeightRatio: 0.45,
  capWidthRatio: 0.9,
  taperRad: 0.06,
  seamAllowance: 10,
  grainBodyStart: 80,
  grainBodyTopClearance: 60,
  grainSleeveClearance: 30,
  // Sleeve cap prototype shape (fractions of cap half width w and cap height h).
  capBack: { c1: [0.72, -0.92], c2: [0.38, 0] },
  capFront: { c1: [-0.36, 0], c2: [-0.7, -0.9] },
};

const P = (id, dimension, expr, label) => ({ id, dimension, expr, label });

export function parameters() {
  return [
    P("bust-ease", "length", lit(C.bustEase), "Chest ease added to the body chest girth (synthetic design value)"),
    P("sleeve-length", "length", mul(m("arm-length"), num(C.sleeveLengthRatio)), "Sleeve length from cap top to hem"),
    P("body-length", "length", add(m("back-length"), lit(C.bodyLengthAddition)), "Body length from the high shoulder point to the hem"),
    P("quarter-chest", "length", div(add(m("chest-girth"), p("bust-ease")), num(4)), "Quarter of the garment chest girth"),
    P("quarter-hem", "length", div(add(max(m("chest-girth"), m("waist-girth")), p("bust-ease")), num(4)), "Quarter of the garment hem width"),
    P("neck-half-width", "length", add(div(m("neck-girth"), num(6)), lit(C.neckWidthAddition)), "Half neck width at the high shoulder points"),
    P("front-neck-depth", "length", div(m("neck-girth"), num(4)), "Front neck depth below the high shoulder points"),
    P("back-neck-depth", "length", lit(C.backNeckDepth), "Back neck depth below the high shoulder points"),
    P("half-shoulder", "length", add(div(m("shoulder-width"), num(2)), lit(C.shoulderExtension)), "Horizontal distance from centre to shoulder point"),
    P("shoulder-drop", "length", lit(C.shoulderDrop), "Vertical drop from high shoulder point to shoulder point"),
    P("armhole-depth", "length", add(div(m("chest-girth"), num(8)), lit(C.armholeDepthAddition)), "Vertical distance from high shoulder point to underarm level"),
    P("armhole-height", "length", sub(p("armhole-depth"), p("shoulder-drop")), "Vertical distance from shoulder point to underarm level"),
    P("front-armhole-scoop", "length", mul(num(C.frontScoopRatio), p("quarter-chest")), "Horizontal handle of the front armhole curve at the underarm"),
    P("back-armhole-scoop", "length", mul(num(C.backScoopRatio), p("quarter-chest")), "Horizontal handle of the back armhole curve at the underarm"),
    P("front-armhole-hollow", "length", lit(C.frontHollow), "Inward offset of the front armhole handle at the shoulder point"),
    P("back-armhole-hollow", "length", lit(C.backHollow), "Inward offset of the back armhole handle at the shoulder point"),
    P("cap-ease-front", "length", lit(C.capEaseFront), "Sleeve cap ease against the front armhole (cap longer by this amount)"),
    P("cap-ease-back", "length", lit(C.capEaseBack), "Sleeve cap ease against the back armhole (cap longer by this amount)"),
    P("front-armhole-length", "length", fo("front-armhole-left-curve", "length"), "Arc length of one front armhole"),
    P("back-armhole-length", "length", fo("back-armhole-left-curve", "length"), "Arc length of one back armhole"),
    P("armhole-length-mean", "length", div(add(p("front-armhole-length"), p("back-armhole-length")), num(2)), "Mean of front and back armhole arc length"),
    P("cap-height", "length", mul(num(C.capHeightRatio), p("armhole-height")), "Nominal sleeve cap height (before cap scaling)"),
    P(
      "cap-half-width",
      "length",
      mul(num(C.capWidthRatio), sqrt(sub(mul(p("armhole-length-mean"), p("armhole-length-mean")), mul(p("cap-height"), p("cap-height"))))),
      "Nominal sleeve half width at the cap base (before cap scaling)",
    ),
    P(
      "cap-scale-front",
      "dimensionless",
      div(add(p("front-armhole-length"), p("cap-ease-front")), fo("sleeve-cap-front-proto-curve", "length")),
      "Similarity scale of the front cap prototype so that cap length = front armhole length + front cap ease",
    ),
    P(
      "cap-scale-back",
      "dimensionless",
      div(add(p("back-armhole-length"), p("cap-ease-back")), fo("sleeve-cap-back-proto-curve", "length")),
      "Similarity scale of the back cap prototype so that cap length = back armhole length + back cap ease",
    ),
    P("cap-scale-mean", "dimensionless", div(add(p("cap-scale-front"), p("cap-scale-back")), num(2)), "Mean cap scale"),
    P("sleeve-taper-angle", "angle", rad(C.taperRad), "Inward taper of both underarm seams from the vertical"),
    P(
      "underarm-length",
      "length",
      div(sub(p("sleeve-length"), mul(p("cap-height"), p("cap-scale-mean"))), cos(p("sleeve-taper-angle"))),
      "Length of both sleeve underarm seams (equal by construction)",
    ),
    P("seam-allowance", "length", lit(C.seamAllowance), "Seam allowance (declared; not part of the v1 expected results)"),
  ];
}

const abs = (id, x, y) => ({ id, type: "d2p:point.absolute", params: { x: ev(x), y: ev(y) } });
const off = (id, base, dx, dy) => ({ id, type: "d2p:point.offset", params: { baseFeatureId: base, dx: ev(dx), dy: ev(dy) } });
const polar = (id, base, distance, angle) => ({ id, type: "d2p:point.polar", params: { baseFeatureId: base, distance: ev(distance), angle: ev(angle) } });
const lineF = (id, a, b) => ({ id, type: "d2p:line", params: { startFeatureId: a, endFeatureId: b } });
const bez = (id, a, c1, c2, b) => ({ id, type: "d2p:bezier.cubic", params: { startFeatureId: a, control1FeatureId: c1, control2FeatureId: c2, endFeatureId: b } });
const signed = (sign, e) => (sign > 0 ? e : neg(e));
const ZERO = lit(0);

/**
 * Body piece (front or back). Pieces are drawn as seen from the outside of the
 * garment, so the wearer's left is at +X on the front and at -X on the back.
 */
function bodyFeatures(piece) {
  const leftSign = piece === "front" ? 1 : -1;
  const scoop = p(`${piece}-armhole-scoop`);
  const hollow = p(`${piece}-armhole-hollow`);
  const ctrlDrop = piece === "front" ? C.frontArmholeCtrlDrop : C.backArmholeCtrlDrop;
  const depth = p(`${piece}-neck-depth`);
  const L = p("body-length");
  const f = [];
  for (const side of ["left", "right"]) {
    const s = side === "left" ? leftSign : -leftSign;
    f.push(abs(`${piece}-hem-${side}-pt`, signed(s, p("quarter-hem")), ZERO));
    f.push(abs(`${piece}-underarm-${side}-pt`, signed(s, p("quarter-chest")), sub(L, p("armhole-depth"))));
    f.push(abs(`${piece}-shoulder-${side}-pt`, signed(s, p("half-shoulder")), sub(L, p("shoulder-drop"))));
    f.push(abs(`${piece}-neck-${side}-pt`, signed(s, p("neck-half-width")), L));
    f.push(off(`${piece}-armhole-${side}-ctrl1-pt`, `${piece}-underarm-${side}-pt`, signed(-s, scoop), ZERO));
    f.push(off(`${piece}-armhole-${side}-ctrl2-pt`, `${piece}-shoulder-${side}-pt`, signed(-s, hollow), neg(mul(num(ctrlDrop), p("armhole-height")))));
  }
  // Neckline runs from the +X high shoulder point to the -X one (contour order).
  const [nStart, nEnd] = piece === "front" ? ["left", "right"] : ["right", "left"];
  const necklineDrop = neg(div(mul(depth, num(4)), num(3))); // cubic midpoint depth = 3/4 of the handle drop
  f.push(off(`${piece}-neckline-ctrl1-pt`, `${piece}-neck-${nStart}-pt`, ZERO, necklineDrop));
  f.push(off(`${piece}-neckline-ctrl2-pt`, `${piece}-neck-${nEnd}-pt`, ZERO, necklineDrop));
  f.push(abs(`${piece}-grain-start-pt`, ZERO, lit(C.grainBodyStart)));
  f.push(abs(`${piece}-grain-end-pt`, ZERO, sub(L, add(depth, lit(C.grainBodyTopClearance)))));
  // Curves (all oriented from hem/underarm upwards and from +X to -X along the neckline).
  const [hemFrom, hemTo] = piece === "front" ? ["right", "left"] : ["left", "right"];
  f.push(lineF(`${piece}-hem-curve`, `${piece}-hem-${hemFrom}-pt`, `${piece}-hem-${hemTo}-pt`));
  for (const side of ["left", "right"]) {
    f.push(lineF(`${piece}-side-${side}-curve`, `${piece}-hem-${side}-pt`, `${piece}-underarm-${side}-pt`));
    f.push(
      bez(
        `${piece}-armhole-${side}-curve`,
        `${piece}-underarm-${side}-pt`,
        `${piece}-armhole-${side}-ctrl1-pt`,
        `${piece}-armhole-${side}-ctrl2-pt`,
        `${piece}-shoulder-${side}-pt`,
      ),
    );
    f.push(lineF(`${piece}-shoulder-${side}-curve`, `${piece}-shoulder-${side}-pt`, `${piece}-neck-${side}-pt`));
  }
  f.push(bez(`${piece}-neckline-curve`, `${piece}-neck-${nStart}-pt`, `${piece}-neckline-ctrl1-pt`, `${piece}-neckline-ctrl2-pt`, `${piece}-neck-${nEnd}-pt`));
  return f;
}

function sleeveFeatures() {
  const w = p("cap-half-width");
  const h = p("cap-height");
  const apex = "sleeve-apex-pt";
  const f = [abs(apex, ZERO, p("sleeve-length"))];
  // Prototype caps (construction only, never part of a contour).
  const protoPoint = (id, [fx, fy]) => off(id, apex, mul(num(fx), w), fy === 0 ? ZERO : mul(num(fy), h));
  f.push(protoPoint("sleeve-cap-back-proto-corner-pt", [1, -1]));
  f.push(protoPoint("sleeve-cap-back-proto-ctrl1-pt", C.capBack.c1));
  f.push(protoPoint("sleeve-cap-back-proto-ctrl2-pt", C.capBack.c2));
  f.push(bez("sleeve-cap-back-proto-curve", "sleeve-cap-back-proto-corner-pt", "sleeve-cap-back-proto-ctrl1-pt", "sleeve-cap-back-proto-ctrl2-pt", apex));
  f.push(protoPoint("sleeve-cap-front-proto-ctrl1-pt", C.capFront.c1));
  f.push(protoPoint("sleeve-cap-front-proto-ctrl2-pt", C.capFront.c2));
  f.push(protoPoint("sleeve-cap-front-proto-corner-pt", [-1, -1]));
  f.push(bez("sleeve-cap-front-proto-curve", apex, "sleeve-cap-front-proto-ctrl1-pt", "sleeve-cap-front-proto-ctrl2-pt", "sleeve-cap-front-proto-corner-pt"));
  // Real caps: prototypes scaled about the apex (a similarity, so arc length scales exactly).
  const scaled = (id, scaleParam, [fx, fy]) =>
    off(id, apex, mul(num(fx), p(scaleParam), w), fy === 0 ? ZERO : mul(num(fy), p(scaleParam), h));
  f.push(scaled("sleeve-back-corner-pt", "cap-scale-back", [1, -1]));
  f.push(scaled("sleeve-cap-back-ctrl1-pt", "cap-scale-back", C.capBack.c1));
  f.push(scaled("sleeve-cap-back-ctrl2-pt", "cap-scale-back", C.capBack.c2));
  f.push(scaled("sleeve-cap-front-ctrl1-pt", "cap-scale-front", C.capFront.c1));
  f.push(scaled("sleeve-cap-front-ctrl2-pt", "cap-scale-front", C.capFront.c2));
  f.push(scaled("sleeve-front-corner-pt", "cap-scale-front", [-1, -1]));
  // Hem corners: same underarm length on both sides, mirrored taper.
  const halfPi = mul(rad(0.5), pi());
  f.push(polar("sleeve-hem-back-pt", "sleeve-back-corner-pt", p("underarm-length"), neg(add(halfPi, p("sleeve-taper-angle")))));
  f.push(polar("sleeve-hem-front-pt", "sleeve-front-corner-pt", p("underarm-length"), sub(p("sleeve-taper-angle"), halfPi)));
  f.push(abs("sleeve-grain-start-pt", ZERO, lit(C.grainSleeveClearance)));
  f.push(abs("sleeve-grain-end-pt", ZERO, sub(p("sleeve-length"), lit(C.grainSleeveClearance))));
  f.push(lineF("sleeve-hem-curve", "sleeve-hem-front-pt", "sleeve-hem-back-pt"));
  f.push(lineF("sleeve-underarm-back-curve", "sleeve-hem-back-pt", "sleeve-back-corner-pt"));
  f.push(bez("sleeve-cap-back-curve", "sleeve-back-corner-pt", "sleeve-cap-back-ctrl1-pt", "sleeve-cap-back-ctrl2-pt", apex));
  f.push(bez("sleeve-cap-front-curve", apex, "sleeve-cap-front-ctrl1-pt", "sleeve-cap-front-ctrl2-pt", "sleeve-front-corner-pt"));
  f.push(lineF("sleeve-underarm-front-curve", "sleeve-front-corner-pt", "sleeve-hem-front-pt"));
  return f;
}

const edge = (id, reversed = false) => ({ id, curveFeatureId: `${id}-curve`, reversed });
const seamAllowance = () => ({ default: ev(p("seam-allowance")) });

/** Normative edge order of catalog section 4.2 (counter-clockwise from the hem). */
export const CONTOUR_EDGES = {
  front: [
    edge("front-hem"),
    edge("front-side-left"),
    edge("front-armhole-left"),
    edge("front-shoulder-left"),
    edge("front-neckline"),
    edge("front-shoulder-right", true),
    edge("front-armhole-right", true),
    edge("front-side-right", true),
  ],
  back: [
    edge("back-hem"),
    edge("back-side-right"),
    edge("back-armhole-right"),
    edge("back-shoulder-right"),
    edge("back-neckline"),
    edge("back-shoulder-left", true),
    edge("back-armhole-left", true),
    edge("back-side-left", true),
  ],
  sleeve: [edge("sleeve-hem"), edge("sleeve-underarm-back"), edge("sleeve-cap-back"), edge("sleeve-cap-front"), edge("sleeve-underarm-front")],
};

/**
 * Notch positions are normalized arc length along the edge direction. Front
 * notches sit at 40 % of the armhole measured from the underarm, back notches
 * at 45 %; the cap notches sit at the same fractions measured from the sleeve
 * corner, so the cap ease is distributed proportionally.
 */
const NOTCHES = {
  front: [
    { id: "front-armhole-left-notch", edgeId: "front-armhole-left", position: 0.4, marks: 1 },
    { id: "front-armhole-right-notch", edgeId: "front-armhole-right", position: 0.6, marks: 1 },
  ],
  back: [
    { id: "back-armhole-left-notch", edgeId: "back-armhole-left", position: 0.55, marks: 2 },
    { id: "back-armhole-right-notch", edgeId: "back-armhole-right", position: 0.45, marks: 2 },
  ],
  sleeve: [
    { id: "sleeve-cap-back-notch", edgeId: "sleeve-cap-back", position: 0.45, marks: 2 },
    { id: "sleeve-cap-front-notch", edgeId: "sleeve-cap-front", position: 0.6, marks: 1 },
  ],
};

function pieces() {
  return [
    {
      id: "front",
      name: "Front",
      contours: [{ id: "front-outer", role: "outer", edges: CONTOUR_EDGES.front }],
      notches: NOTCHES.front,
      grainlines: [{ id: "front-grainline", startFeatureId: "front-grain-start-pt", endFeatureId: "front-grain-end-pt" }],
      cutInstruction: { instances: [{ cutInstanceKey: "front", mirrored: false }], materialRole: "d2p:main" },
      seamAllowance: seamAllowance(),
    },
    {
      id: "back",
      name: "Back",
      contours: [{ id: "back-outer", role: "outer", edges: CONTOUR_EDGES.back }],
      notches: NOTCHES.back,
      grainlines: [{ id: "back-grainline", startFeatureId: "back-grain-start-pt", endFeatureId: "back-grain-end-pt" }],
      cutInstruction: { instances: [{ cutInstanceKey: "back", mirrored: false }], materialRole: "d2p:main" },
      seamAllowance: seamAllowance(),
    },
    {
      id: "sleeve",
      name: "Sleeve",
      contours: [{ id: "sleeve-outer", role: "outer", edges: CONTOUR_EDGES.sleeve }],
      notches: NOTCHES.sleeve,
      grainlines: [{ id: "sleeve-grainline", startFeatureId: "sleeve-grain-start-pt", endFeatureId: "sleeve-grain-end-pt" }],
      cutInstruction: {
        instances: [
          { cutInstanceKey: "sleeve-left", mirrored: false },
          { cutInstanceKey: "sleeve-right", mirrored: true },
        ],
        materialRole: "d2p:main",
      },
      seamAllowance: seamAllowance(),
    },
  ];
}

const interval = (edgeId, direction) => [{ edgeId, from: 0, to: 1, direction }];

/**
 * Seam interfaces. Directions are chosen so that, per seam connection, side A
 * traversed in its direction corresponds to side B traversed in its direction.
 */
function seamInterfaces() {
  const si = [];
  for (const side of ["left", "right"]) {
    for (const part of ["shoulder", "side", "armhole"]) {
      si.push({ id: `si-front-${part}-${side}`, segments: interval(`front-${part}-${side}`, "forward") });
      si.push({ id: `si-back-${part}-${side}`, segments: interval(`back-${part}-${side}`, part === "armhole" ? "forward" : "reverse") });
    }
  }
  for (const side of ["left", "right"]) {
    const cap = side === "left" ? "reverse" : "forward";
    const key = `sleeve-${side}`;
    si.push({ id: `si-sleeve-${side}-cap-front`, segments: interval("sleeve-cap-front", cap), cutInstanceKey: key });
    si.push({ id: `si-sleeve-${side}-cap-back`, segments: interval("sleeve-cap-back", cap), cutInstanceKey: key });
    si.push({ id: `si-sleeve-${side}-underarm-front`, segments: interval("sleeve-underarm-front", "forward"), cutInstanceKey: key });
    si.push({ id: `si-sleeve-${side}-underarm-back`, segments: interval("sleeve-underarm-back", "reverse"), cutInstanceKey: key });
  }
  return si;
}

function seamConnections() {
  const sc = [];
  const conn = (id, a, b, ease, matchPoints) => {
    const c = { id, interfaceIds: [a, b], type: "d2p:stitched", active: true, ease };
    if (matchPoints) c.matchPoints = matchPoints;
    sc.push(c);
  };
  for (const side of ["left", "right"]) {
    conn(`seam-shoulder-${side}`, `si-front-shoulder-${side}`, `si-back-shoulder-${side}`, { mode: "none" });
    conn(`seam-side-${side}`, `si-front-side-${side}`, `si-back-side-${side}`, { mode: "none" });
    conn(`seam-armhole-front-${side}`, `si-front-armhole-${side}`, `si-sleeve-${side}-cap-front`, { mode: "eased", amount: ev(neg(p("cap-ease-front"))) }, [
      { notchIdA: `front-armhole-${side}-notch`, notchIdB: "sleeve-cap-front-notch" },
    ]);
    conn(`seam-armhole-back-${side}`, `si-back-armhole-${side}`, `si-sleeve-${side}-cap-back`, { mode: "eased", amount: ev(neg(p("cap-ease-back"))) }, [
      { notchIdA: `back-armhole-${side}-notch`, notchIdB: "sleeve-cap-back-notch" },
    ]);
    conn(`seam-underarm-${side}`, `si-sleeve-${side}-underarm-front`, `si-sleeve-${side}-underarm-back`, { mode: "none" });
  }
  return sc;
}

function sewingGroups() {
  return ["left", "right"].map((side) => ({
    id: `group-armhole-${side}`,
    type: "d2p:composite-assembly",
    members: [{ connectionId: `seam-armhole-front-${side}` }, { connectionId: `seam-armhole-back-${side}` }],
    requirements: { groupTopology: "connected", validateMemberSeams: true },
  }));
}

/** Pattern r1 content document. */
export function buildPattern() {
  return {
    documentType: "d2p:pattern",
    schemaVersion: "1.0.0",
    artifactId: ids.art("pattern"),
    revisionId: ids.rev("pattern", 1),
    name: "Golden T-Shirt (synthetic test pattern)",
    featureSetVersion: "1.0.0",
    definitionRegistries: [{ id: "d2p:measurement-definitions", version: "1.0.0" }],
    parameters: parameters(),
    measurementInputs: MEASUREMENT_INPUTS,
    features: [...bodyFeatures("front"), ...bodyFeatures("back"), ...sleeveFeatures()],
    pieces: pieces(),
    seamInterfaces: seamInterfaces(),
    seamConnections: seamConnections(),
    sewingGroups: sewingGroups(),
    featureCapabilities: [],
  };
}

/** The change case (synthetic deltas of catalog section 4.2). */
export const CHANGE = {
  bustEaseDeltaMm: 20,
  sleeveLengthDeltaMm: 30,
  updates: () => [
    { parameterId: "bust-ease", expr: lit(C.bustEase + 20) },
    { parameterId: "sleeve-length", expr: add(mul(m("arm-length"), num(C.sleeveLengthRatio)), lit(30)) },
  ],
};

/** Applies a parameters.update command payload to a pattern (new revision, same element IDs). */
export function applyParameterUpdates(pattern, updates, revisionId) {
  const next = structuredClone(pattern);
  next.revisionId = revisionId;
  for (const u of updates) {
    const param = next.parameters.find((x) => x.id === u.parameterId);
    if (!param) throw new Error(`unknown parameter ${u.parameterId}`);
    param.expr = structuredClone(u.expr);
  }
  return next;
}

/**
 * Independent closed-form construction (plain arithmetic, no expression
 * interpreter). Returns every point feature by ID.
 * @param {Record<string, number>} mv measurement values by input key
 * @param {{bustEase: number, sleeveLength: (mv) => number}} design
 */
export function directConstruction(mv, design) {
  const pts = {};
  const bustEase = design.bustEase;
  const sleeveLength = design.sleeveLength(mv);
  const L = mv["back-length"] + C.bodyLengthAddition;
  const qc = (mv["chest-girth"] + bustEase) / 4;
  const qh = (Math.max(mv["chest-girth"], mv["waist-girth"]) + bustEase) / 4;
  const nw = mv["neck-girth"] / 6 + C.neckWidthAddition;
  const hs = mv["shoulder-width"] / 2 + C.shoulderExtension;
  const ad = mv["chest-girth"] / 8 + C.armholeDepthAddition;
  const ah = ad - C.shoulderDrop;
  const depth = { front: mv["neck-girth"] / 4, back: C.backNeckDepth };
  const scoop = { front: C.frontScoopRatio * qc, back: C.backScoopRatio * qc };
  const hollow = { front: C.frontHollow, back: C.backHollow };
  const ctrlDrop = { front: C.frontArmholeCtrlDrop, back: C.backArmholeCtrlDrop };
  for (const piece of ["front", "back"]) {
    const leftSign = piece === "front" ? 1 : -1;
    for (const side of ["left", "right"]) {
      const s = side === "left" ? leftSign : -leftSign;
      pts[`${piece}-hem-${side}-pt`] = [s * qh, 0];
      pts[`${piece}-underarm-${side}-pt`] = [s * qc, L - ad];
      pts[`${piece}-shoulder-${side}-pt`] = [s * hs, L - C.shoulderDrop];
      pts[`${piece}-neck-${side}-pt`] = [s * nw, L];
      pts[`${piece}-armhole-${side}-ctrl1-pt`] = [s * qc - s * scoop[piece], L - ad];
      pts[`${piece}-armhole-${side}-ctrl2-pt`] = [s * hs - s * hollow[piece], L - C.shoulderDrop - ctrlDrop[piece] * ah];
    }
    const [nStart, nEnd] = piece === "front" ? ["left", "right"] : ["right", "left"];
    const drop = (depth[piece] * 4) / 3;
    pts[`${piece}-neckline-ctrl1-pt`] = [pts[`${piece}-neck-${nStart}-pt`][0], L - drop];
    pts[`${piece}-neckline-ctrl2-pt`] = [pts[`${piece}-neck-${nEnd}-pt`][0], L - drop];
    pts[`${piece}-grain-start-pt`] = [0, C.grainBodyStart];
    pts[`${piece}-grain-end-pt`] = [0, L - (depth[piece] + C.grainBodyTopClearance)];
  }
  const armLen = (piece) =>
    g.arcLength(
      g.cubic(pts[`${piece}-underarm-left-pt`], pts[`${piece}-armhole-left-ctrl1-pt`], pts[`${piece}-armhole-left-ctrl2-pt`], pts[`${piece}-shoulder-left-pt`]),
    );
  const laf = armLen("front");
  const lab = armLen("back");
  const h = C.capHeightRatio * ah;
  const mean = (laf + lab) / 2;
  const w = C.capWidthRatio * Math.sqrt(mean * mean - h * h);
  const apex = [0, sleeveLength];
  pts["sleeve-apex-pt"] = apex;
  const at = (fx, fy, s = 1) => [apex[0] + fx * s * w, apex[1] + (fy === 0 ? 0 : fy * s * h)];
  pts["sleeve-cap-back-proto-corner-pt"] = at(1, -1);
  pts["sleeve-cap-back-proto-ctrl1-pt"] = at(...C.capBack.c1);
  pts["sleeve-cap-back-proto-ctrl2-pt"] = at(...C.capBack.c2);
  pts["sleeve-cap-front-proto-ctrl1-pt"] = at(...C.capFront.c1);
  pts["sleeve-cap-front-proto-ctrl2-pt"] = at(...C.capFront.c2);
  pts["sleeve-cap-front-proto-corner-pt"] = at(-1, -1);
  const protoBack = g.arcLength(g.cubic(at(1, -1), at(...C.capBack.c1), at(...C.capBack.c2), apex));
  const protoFront = g.arcLength(g.cubic(apex, at(...C.capFront.c1), at(...C.capFront.c2), at(-1, -1)));
  const sb = (lab + C.capEaseBack) / protoBack;
  const sf = (laf + C.capEaseFront) / protoFront;
  pts["sleeve-back-corner-pt"] = at(1, -1, sb);
  pts["sleeve-cap-back-ctrl1-pt"] = at(...C.capBack.c1, sb);
  pts["sleeve-cap-back-ctrl2-pt"] = at(...C.capBack.c2, sb);
  pts["sleeve-cap-front-ctrl1-pt"] = at(...C.capFront.c1, sf);
  pts["sleeve-cap-front-ctrl2-pt"] = at(...C.capFront.c2, sf);
  pts["sleeve-front-corner-pt"] = at(-1, -1, sf);
  const u = (sleeveLength - h * ((sf + sb) / 2)) / Math.cos(C.taperRad);
  const back = pts["sleeve-back-corner-pt"];
  const front = pts["sleeve-front-corner-pt"];
  const aBack = -(0.5 * Math.PI + C.taperRad);
  const aFront = C.taperRad - 0.5 * Math.PI;
  pts["sleeve-hem-back-pt"] = [back[0] + u * Math.cos(aBack), back[1] + u * Math.sin(aBack)];
  pts["sleeve-hem-front-pt"] = [front[0] + u * Math.cos(aFront), front[1] + u * Math.sin(aFront)];
  pts["sleeve-grain-start-pt"] = [0, C.grainSleeveClearance];
  pts["sleeve-grain-end-pt"] = [0, sleeveLength - C.grainSleeveClearance];
  return pts;
}
