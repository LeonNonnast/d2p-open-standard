// Semantic level (catalog §2.1, §2.4 SEM codes, §3.2.3-§3.2.6, §3.3, §3.5,
// §3.7, §3.8): domain rules that need no geometry kernel.
import { canonicalize, quantize, scaledInteger } from "./c14n.mjs";
import { diagnostic } from "./diagnostics.mjs";
import { evaluateConstant, exprComplexity, inferDimension, MAX_DEPTH, MAX_NODES, slotMismatch } from "./expression.mjs";
import { pointer } from "./json.mjs";
import { embeddedDocuments, isObject, OPAQUE_MEMBERS, PERSONAL_CLASSIFICATIONS, sameRefSet, walkJson } from "./model.mjs";
import {
  dimensionOfName,
  edgeEndpoints,
  featureOutputs,
  indexPattern,
  interfaceCutInstance,
  interfacePieces,
  isExtensionName,
  L,
  PARAM_EXPR_DIMENSIONS,
  satisfiesKind,
} from "./pattern.mjs";
import { compareTimestamps } from "./referential.mjs";

const SEVERITY_RANK = { info: 0, warning: 1, error: 2, critical: 3 };
const UNIT_OF_DIMENSION = { length: "mm", angle: "rad" };
const CALIBRATED_PROFILES = new Set(["d2p:home-print-a4", "d2p:home-print-a3", "d2p:plotter-1to1"]);
/** Media required by the home-print output profiles (catalog §3.7, D2P-SEM-095). */
const HOME_PRINT_MEDIA = { "d2p:home-print-a4": "iso-a4", "d2p:home-print-a3": "iso-a3" };
const MEDIA_SIZES = { "iso-a4": [210, 297], "iso-a3": [297, 420] };
const CLOSED_LAYER_ROLES = new Set(["d2p:cut-line", "d2p:seam-line"]);
const WITHOUT_EXTENSIONS = new Set([...OPAQUE_MEMBERS].filter((m) => m !== "extensions"));

/**
 * Runs the semantic level on a structurally and referentially valid bundle.
 *
 * @param {import("./bundle.mjs").BundleIndex} index
 * @returns {object[]} diagnostics
 */
export function checkSemantic(index) {
  const out = [];
  const ctx = {
    index,
    report(code, message, unit, instancePath, extra = {}) {
      out.push(diagnostic(code, message, { documentPath: unit.path, instancePath, ...extra }));
    },
  };
  for (const unit of index.units) {
    checkExtensionBlocks(ctx, unit);
    switch (unit.value.documentType) {
      case "d2p:pattern":
        checkPattern(ctx, unit);
        break;
      case "d2p:grading-rule-set":
        checkGrading(ctx, unit);
        break;
      case "d2p:command":
        checkCommandExpressions(ctx, unit);
        break;
      case "d2p:geometry-snapshot":
        checkSnapshot(ctx, unit);
        checkSnapshotCompleteness(ctx, unit);
        checkSnapshotSeams(ctx, unit);
        break;
      case "d2p:export-scene-2d":
        checkScene(ctx, unit);
        checkSceneGeometry(ctx, unit);
        checkExportPrivacy(ctx, unit);
        break;
      case "d2p:print-job-spec":
        checkPrintJob(ctx, unit);
        checkExportPrivacy(ctx, unit);
        break;
      case "d2p:body-measurement-profile":
        checkBodyProfile(ctx, unit);
        checkDefinitionKinds(ctx, unit);
        break;
      case "d2p:size-system":
        checkMeasurementUnits(ctx, unit);
        checkDefinitionKinds(ctx, unit);
        break;
      case "d2p:garment-measurement-spec":
        checkMeasurementUnits(ctx, unit);
        checkDefinitionKinds(ctx, unit);
        break;
      case "d2p:fit-profile":
        checkFitProfile(ctx, unit);
        checkDefinitionKinds(ctx, unit);
        break;
      case "d2p:evaluation-request":
        checkRequiredMeasurements(ctx, unit);
        checkEaseMaterial(ctx, unit);
        break;
      case "d2p:waiver":
        checkWaiver(ctx, unit);
        break;
      case "d2p:validation-report":
        checkReport(ctx, unit);
        break;
      case "d2p:gate-evaluation":
        checkGate(ctx, unit);
        break;
      case "d2p:quality-evidence-bundle":
        checkEvidenceBundle(ctx, unit);
        break;
      case "d2p:measurement-definition-registry":
        checkDefinitionUnits(ctx, unit);
        break;
      default:
        break;
    }
  }
  return out;
}

const at = (unit, ...tokens) => pointer(unit.base, ...tokens);

function walkUnit(unit, visit, skip = OPAQUE_MEMBERS) {
  const embedded = new Set(unit.embedded ? [] : embeddedDocuments(unit.value).map((e) => e.pointer));
  walkJson(unit.value, (node, ptr, key, parent) => (embedded.has(ptr) ? false : visit(node, ptr, key, parent)), unit.base, skip);
}

// ---------------------------------------------------------------------------
// Extension blocks (§1.7): D2P-SEM-006 / D2P-SEM-007. The kit understands no
// extension namespace.

function checkExtensionBlocks(ctx, unit) {
  walkUnit(unit, (node, ptr, key) => {
    if (key !== "extensions" || !isObject(node)) return true;
    for (const [ns, block] of Object.entries(node)) {
      if (block?.onUnknown === "reject") {
        ctx.report("D2P-SEM-006", `extension namespace ${ns} is not understood and declares onUnknown: reject`, unit, pointer(ptr, ns));
      } else if (block?.onUnknown === "read-only") {
        ctx.report("D2P-SEM-007", `extension namespace ${ns} is not understood and declares onUnknown: read-only; the carrying object must not be modified`, unit, pointer(ptr, ns));
      }
    }
    return false;
  }, WITHOUT_EXTENSIONS);
}

// ---------------------------------------------------------------------------
// Pattern

function patternEnv(ctx, idx) {
  const defs = ctx.index.definitionsOf(idx.pattern);
  return {
    param: (id) => dimensionOfName(idx.parameters.get(id)?.parameter.dimension),
    measurement: (key) => {
      const input = idx.inputs.get(key)?.input;
      if (!input) return null;
      const def = defs.get(input.definitionId);
      if (def) return dimensionOfName(def.dimension);
      return null;
    },
    featureOutput: (featureId, output) => {
      const f = idx.features.get(featureId)?.feature;
      if (!f) return null;
      return featureOutputs(idx, f)?.[output] ?? null;
    },
  };
}

/** Checks one expr slot: complexity (D2P-SEM-003) and dimensions (D2P-SEM-002). */
function checkExprSlot(ctx, unit, env, node, ptr, expected) {
  if (!isObject(node)) return;
  const { depth, nodes } = exprComplexity(node);
  if (depth > MAX_DEPTH || nodes > MAX_NODES) {
    ctx.report("D2P-SEM-003", `expression has depth ${depth} and ${nodes} nodes (limits: depth ${MAX_DEPTH}, ${MAX_NODES} nodes)`, unit, ptr);
  }
  const dim = inferDimension(node, ptr, env, (p, msg) => ctx.report("D2P-SEM-002", msg, unit, p));
  const problem = slotMismatch(dim, expected);
  if (problem) ctx.report("D2P-SEM-002", problem, unit, ptr);
}

function checkPattern(ctx, unit) {
  const p = unit.value;
  const idx = indexPattern(p, unit.base);
  const env = patternEnv(ctx, idx);
  const slot = (node, ptr, expected) => checkExprSlot(ctx, unit, env, node, ptr, expected);

  // Expressions (D2P-SEM-002, D2P-SEM-003).
  for (const { parameter, ptr } of idx.parameters.values()) slot(parameter.expr, pointer(ptr, "expr"), dimensionOfName(parameter.dimension));
  for (const { feature, ptr } of idx.features.values()) {
    const dims = PARAM_EXPR_DIMENSIONS[feature.type] ?? {};
    walkJson(feature.params ?? {}, (node, p, key, parent) => {
      if (key !== "expr") return true;
      // Only top-level params members have a known expected dimension.
      const member = parent === undefined ? undefined : Object.keys(feature.params ?? {}).find((k) => feature.params[k] === parent);
      slot(node, p, member ? dims[member] ?? null : null);
      return false;
    }, pointer(ptr, "params"));
  }
  for (const { piece, ptr } of idx.pieces.values()) {
    if (!isObject(piece.seamAllowance)) continue;
    slot(piece.seamAllowance.default?.expr, pointer(ptr, "seamAllowance", "default", "expr"), L);
    (piece.seamAllowance.edges ?? []).forEach((e, i) => slot(e.expr, pointer(ptr, "seamAllowance", "edges", i, "expr"), L));
  }
  for (const { conn, ptr } of idx.connections.values()) {
    if (conn.ease?.amount) slot(conn.ease.amount.expr, pointer(ptr, "ease", "amount", "expr"), L);
  }

  checkFeatureCycles(ctx, unit, idx);
  checkExtensionFeatures(ctx, unit, idx);
  checkContours(ctx, unit, idx);
  checkInterfaces(ctx, unit, idx);
  checkConnections(ctx, unit, idx);
  checkMatchPoints(ctx, unit, idx);
  checkSewingGroups(ctx, unit, idx);
  checkStaticConstraints(ctx, unit, idx);
  checkFallbackUnits(ctx, unit, idx);
}

/** Dependency edges of a node (§3.2.3). */
function dependencies(idx, id) {
  const deps = new Set();
  const fromExpr = (node) =>
    walkJson(node, (n) => {
      if (isObject(n) && n.op === "param" && typeof n.parameterId === "string") deps.add(n.parameterId);
      if (isObject(n) && n.op === "featureOutput" && typeof n.featureId === "string") deps.add(n.featureId);
      return true;
    });
  const param = idx.parameters.get(id)?.parameter;
  if (param) fromExpr(param.expr);
  const feature = idx.features.get(id)?.feature;
  if (feature) {
    walkJson(feature.params ?? {}, (node, _p, key) => {
      if (typeof key === "string" && key.endsWith("FeatureId") && typeof node === "string") deps.add(node);
      if (typeof key === "string" && key.endsWith("FeatureIds") && Array.isArray(node)) node.forEach((x) => typeof x === "string" && deps.add(x));
      if (key === "expr") {
        fromExpr(node);
        return false;
      }
      return true;
    });
    for (const d of feature.dependsOn ?? []) deps.add(d);
  }
  return [...deps].filter((d) => idx.parameters.has(d) || idx.features.has(d)).sort();
}

/** D2P-SEM-001: strongly connected components (Tarjan) with more than one node or a self-loop. */
function checkFeatureCycles(ctx, unit, idx) {
  const nodes = [...new Set([...idx.parameters.keys(), ...idx.features.keys()])].sort();
  const graph = new Map(nodes.map((n) => [n, dependencies(idx, n)]));
  let counter = 0;
  const indexOf = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  const strong = (v) => {
    indexOf.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v)) {
      if (!indexOf.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), indexOf.get(w)));
    }
    if (low.get(v) === indexOf.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      components.push(comp.sort());
    }
  };
  for (const n of nodes) if (!indexOf.has(n)) strong(n);
  for (const comp of components) {
    if (comp.length === 1 && !graph.get(comp[0]).includes(comp[0])) continue;
    const first = comp[0];
    const ptr = idx.features.get(first)?.ptr ?? idx.parameters.get(first)?.ptr;
    ctx.report("D2P-SEM-001", `the dependency graph has a cycle through ${comp.map((c) => `"${c}"`).join(", ")}`, unit, ptr);
  }
}

/**
 * D2P-SEM-004 / -005 for extension feature types (the kit has no extension
 * evaluators). A feature capability has no 'reject' (catalog §1.7): a missing
 * evaluator restricts editing but never prevents read-only display of a
 * conforming snapshot.
 */
function checkExtensionFeatures(ctx, unit, idx) {
  const reported = new Set();
  for (const { feature, ptr } of idx.features.values()) {
    if (!isExtensionName(feature.type) || reported.has(feature.type)) continue;
    reported.add(feature.type);
    const caps = idx.capabilities.get(feature.type) ?? [];
    if (caps.length !== 1) {
      ctx.report("D2P-SEM-005", `extension feature type ${feature.type} has ${caps.length} matching featureCapabilities entries (exactly one required)`, unit, pointer(ptr, "type"));
    } else {
      ctx.report("D2P-SEM-004", `extension feature type ${feature.type} has no evaluator available; the pattern is read-only and only a conforming snapshot may be displayed`, unit, pointer(ptr, "type"));
    }
  }
}

/** D2P-SEM-010 (contour closure via shared point features) and D2P-SEM-013 (edge reuse). */
function checkContours(ctx, unit, idx) {
  for (const { piece, ptr: pptr } of idx.pieces.values()) {
    const curveUse = new Map();
    (piece.contours ?? []).forEach((contour, ci) => {
      const cptr = pointer(pptr, "contours", ci);
      const edges = contour.edges ?? [];
      edges.forEach((e, ei) => {
        if (curveUse.has(e.curveFeatureId)) {
          ctx.report("D2P-SEM-013", `edges "${curveUse.get(e.curveFeatureId)}" and "${e.id}" of piece "${piece.id}" reference the same curve feature "${e.curveFeatureId}"`, unit, pointer(cptr, "edges", ei));
        } else curveUse.set(e.curveFeatureId, e.id);
      });
      const ends = edges.map((e) => edgeEndpoints(idx, e));
      if (!edges.length || ends.some((x) => !x)) return; // extension curves: not applicable
      for (let i = 0; i < edges.length; i += 1) {
        const next = (i + 1) % edges.length;
        if (ends[i].end !== ends[next].start) {
          ctx.report(
            "D2P-SEM-010",
            `contour "${contour.id}" is open: edge "${edges[i].id}" ends at "${ends[i].end}" but edge "${edges[next].id}" starts at "${ends[next].start}"`,
            unit,
            cptr,
          );
          return;
        }
      }
    });
  }
}

const sameParam = (a, b) => quantize(a) === quantize(b);

/** Start and end parameters of an EdgeInterval in traversal order. */
function intervalEnds(s) {
  return s.direction === "reverse" ? { start: s.to, end: s.from } : { start: s.from, end: s.to };
}

/** D2P-SEM-020 / -021 / -022 per seam interface. */
function checkInterfaces(ctx, unit, idx) {
  for (const { iface, ptr } of idx.interfaces.values()) {
    const segs = iface.segments ?? [];
    const valid = segs.map((s, i) => {
      if (!(s.from < s.to)) {
        ctx.report("D2P-SEM-021", `seam interface "${iface.id}": interval on edge "${s.edgeId}" has from (${s.from}) >= to (${s.to})`, unit, pointer(ptr, "segments", i));
        return false;
      }
      return idx.edges.has(s.edgeId);
    });
    for (let i = 0; i + 1 < segs.length; i += 1) {
      if (!valid[i] || !valid[i + 1]) continue;
      const a = segs[i];
      const b = segs[i + 1];
      const ea = intervalEnds(a);
      const eb = intervalEnds(b);
      const ruleA = a.edgeId === b.edgeId && a.direction === b.direction && sameParam(ea.end, eb.start);
      let ruleB = false;
      const aEndsAtEndpoint = a.direction === "forward" ? sameParam(a.to, 1) : sameParam(a.from, 0);
      const bStartsAtEndpoint = b.direction === "forward" ? sameParam(b.from, 0) : sameParam(b.to, 1);
      if (aEndsAtEndpoint && bStartsAtEndpoint) {
        const pa = edgeEndpoints(idx, idx.edges.get(a.edgeId).edge);
        const pb = edgeEndpoints(idx, idx.edges.get(b.edgeId).edge);
        if (!pa || !pb) continue; // extension curves: not applicable
        const pointA = a.direction === "forward" ? pa.end : pa.start;
        const pointB = b.direction === "forward" ? pb.start : pb.end;
        ruleB = pointA === pointB;
      }
      if (!ruleA && !ruleB) {
        ctx.report(
          "D2P-SEM-020",
          `seam interface "${iface.id}": interval ${i + 1} (edge "${b.edgeId}") does not continue where interval ${i} (edge "${a.edgeId}") ends`,
          unit,
          pointer(ptr, "segments", i + 1),
        );
      }
    }
    const pieces = interfacePieces(idx, iface);
    if (pieces.size > 1) {
      ctx.report("D2P-SEM-022", `seam interface "${iface.id}" uses edges of more than one piece (${[...pieces].sort().join(", ")})`, unit, ptr);
    } else if (pieces.size === 1) {
      const [pieceId] = pieces;
      const instances = idx.pieces.get(pieceId).piece.cutInstruction?.instances ?? [];
      if (iface.cutInstanceKey === undefined && instances.length > 1) {
        ctx.report("D2P-SEM-022", `seam interface "${iface.id}" uses piece "${pieceId}", which has ${instances.length} cut instances, but names no cutInstanceKey`, unit, ptr);
      } else if (iface.cutInstanceKey !== undefined) {
        const owner = idx.cutInstances.get(iface.cutInstanceKey)?.pieceId;
        if (owner !== undefined && owner !== pieceId) {
          ctx.report("D2P-SEM-022", `seam interface "${iface.id}": cutInstanceKey "${iface.cutInstanceKey}" belongs to piece "${owner}", not to piece "${pieceId}"`, unit, pointer(ptr, "cutInstanceKey"));
        }
      }
    }
  }
}

/** D2P-SEM-023: one active connection per interface (TOP-010, SWG-011). */
function checkConnections(ctx, unit, idx) {
  const users = new Map();
  for (const { conn } of idx.connections.values()) {
    if (conn.active !== true) continue;
    for (const id of conn.interfaceIds ?? []) {
      const list = users.get(id) ?? [];
      list.push(conn.id);
      users.set(id, list);
    }
  }
  for (const [id, conns] of users) {
    if (conns.length < 2) continue;
    const entry = idx.interfaces.get(id);
    ctx.report("D2P-SEM-023", `seam interface "${id}" is used by ${conns.length} active seam connections (${conns.join(", ")})`, unit, entry?.ptr ?? at(unit, "seamInterfaces"));
  }
}

/**
 * D2P-SEM-025 (catalog §3.2.6, design decision ADR-007.1): a match point pairs
 * a notch on side A with a notch on side B. `notchIdA` lies on interface A
 * (`interfaceIds[0]`) and `notchIdB` on interface B (`interfaceIds[1]`): the
 * notch's edge carries an interval of that interface, and the notch position
 * (normalized arc length along the edge direction) lies within [from, to] of
 * such an interval, compared after quantization. Unresolved notches and
 * interfaces are referential findings (D2P-REF-003) and are skipped here.
 */
function checkMatchPoints(ctx, unit, idx) {
  const q = (n) => quantize(n);
  for (const { conn, ptr } of idx.connections.values()) {
    (conn.matchPoints ?? []).forEach((m, i) => {
      ["notchIdA", "notchIdB"].forEach((member, side) => {
        const notch = idx.notches.get(m[member])?.notch;
        const iface = idx.interfaces.get(conn.interfaceIds?.[side])?.iface;
        if (!notch || !iface) return;
        const onEdge = (iface.segments ?? []).filter((s) => s.edgeId === notch.edgeId);
        const inside = onEdge.some((s) => q(s.from) <= q(notch.position) && q(notch.position) <= q(s.to));
        if (inside) return;
        const where = onEdge.length ? `at position ${notch.position}, outside the interface's intervals on edge "${notch.edgeId}"` : `on edge "${notch.edgeId}", which interface "${iface.id}" does not use`;
        ctx.report("D2P-SEM-025", `seam connection "${conn.id}": match-point notch "${notch.id}" (side ${side === 0 ? "A" : "B"}) is not on interface "${iface.id}": it lies ${where}`, unit, pointer(ptr, "matchPoints", i, member));
      });
    });
  }
}

/** D2P-SEM-030 .. -033: sewing group integrity (SWG-005/006/007). */
function checkSewingGroups(ctx, unit, idx) {
  const groupOf = new Map();
  for (const { group, ptr } of idx.groups.values()) {
    const seen = new Set();
    (group.members ?? []).forEach((m, i) => {
      const mp = pointer(ptr, "members", i);
      if (seen.has(m.connectionId)) {
        ctx.report("D2P-SEM-030", `sewing group "${group.id}" lists seam connection "${m.connectionId}" more than once`, unit, mp);
        return;
      }
      seen.add(m.connectionId);
      if (groupOf.has(m.connectionId)) {
        ctx.report("D2P-SEM-031", `seam connection "${m.connectionId}" is a member of sewing groups "${groupOf.get(m.connectionId)}" and "${group.id}"`, unit, mp);
      } else groupOf.set(m.connectionId, group.id);
    });

    // Cut instances taking part in member connections.
    const edges = [];
    let applicable = true;
    for (const connectionId of seen) {
      const conn = idx.connections.get(connectionId)?.conn;
      const ends = (conn?.interfaceIds ?? []).map((id) => {
        const iface = idx.interfaces.get(id)?.iface;
        return iface ? interfaceCutInstance(idx, iface) : null;
      });
      if (!conn || ends.length !== 2 || ends.some((e) => e === null)) {
        applicable = false;
        continue;
      }
      edges.push(ends);
    }
    const participants = new Set(edges.flat());
    if (applicable && group.requirements?.groupTopology === "connected" && edges.length) {
      const parent = new Map([...participants].map((n) => [n, n]));
      const find = (n) => (parent.get(n) === n ? n : find(parent.get(n)));
      for (const [a, b] of edges) parent.set(find(a), find(b));
      const roots = new Set([...participants].map(find));
      if (roots.size > 1) {
        ctx.report("D2P-SEM-032", `sewing group "${group.id}" requires connected topology, but its member connections form ${roots.size} separate components`, unit, ptr);
      }
    }
    if (applicable) {
      const listed = new Set();
      (group.layerOrder ?? []).forEach((l, i) => {
        const lp = pointer(ptr, "layerOrder", i);
        if (listed.has(l.cutInstanceKey)) ctx.report("D2P-SEM-033", `layerOrder of sewing group "${group.id}" lists cut instance "${l.cutInstanceKey}" twice`, unit, lp);
        else if (!participants.has(l.cutInstanceKey)) {
          ctx.report("D2P-SEM-033", `layerOrder of sewing group "${group.id}" names cut instance "${l.cutInstanceKey}", which takes part in no member connection`, unit, lp);
        }
        listed.add(l.cutInstanceKey);
      });
    }
  }
}

/** D2P-SEM-040: static constraint conflicts (§3.2.3). */
function checkStaticConstraints(ctx, unit, idx) {
  const valued = new Map(); // key -> { value, id }
  const lineFlags = new Map(); // line -> { horizontal?, vertical? }
  const pairFlags = new Map(); // unordered pair -> { parallel?, perpendicular? }
  const conflict = (msg, ptr) => ctx.report("D2P-SEM-040", msg, unit, ptr);
  for (const { feature, ptr } of idx.features.values()) {
    const p = feature.params ?? {};
    const t = feature.type;
    if (t === "d2p:constraint.distance" || t === "d2p:constraint.length" || t === "d2p:constraint.angle") {
      const value = evaluateConstant(p.value?.expr);
      if (value === undefined) continue;
      if ((t === "d2p:constraint.distance" || t === "d2p:constraint.length") && value < 0) {
        conflict(`constraint "${feature.id}" has a negative constant value`, pointer(ptr, "params", "value"));
      }
      let key;
      if (t === "d2p:constraint.distance") key = `distance|${[p.aFeatureId, p.bFeatureId].sort().join("|")}`;
      else if (t === "d2p:constraint.length") key = `length|${p.curveFeatureId}`;
      else key = `angle|${p.aFeatureId}|${p.bFeatureId}`;
      const prev = valued.get(key);
      if (prev && quantize(prev.value) !== quantize(value)) {
        conflict(`constraints "${prev.id}" and "${feature.id}" fix the same quantity to different constant values`, ptr);
      } else if (!prev) valued.set(key, { value, id: feature.id });
    }
    if (t === "d2p:constraint.horizontal" || t === "d2p:constraint.vertical") {
      const flags = lineFlags.get(p.lineFeatureId) ?? {};
      const mine = t.endsWith("horizontal") ? "horizontal" : "vertical";
      const other = mine === "horizontal" ? "vertical" : "horizontal";
      if (flags[other]) conflict(`line "${p.lineFeatureId}" is constrained both horizontal ("${flags[other]}") and vertical`, ptr);
      flags[mine] = flags[mine] ?? feature.id;
      lineFlags.set(p.lineFeatureId, flags);
    }
    if (t === "d2p:constraint.parallel" || t === "d2p:constraint.perpendicular") {
      const key = [p.aFeatureId, p.bFeatureId].sort().join("|");
      const flags = pairFlags.get(key) ?? {};
      const mine = t.endsWith("parallel") ? "parallel" : "perpendicular";
      const other = mine === "parallel" ? "perpendicular" : "parallel";
      if (flags[other]) conflict(`lines "${p.aFeatureId}" and "${p.bFeatureId}" are constrained both parallel and perpendicular`, ptr);
      flags[mine] = flags[mine] ?? feature.id;
      pairFlags.set(key, flags);
    }
  }
}

/** D2P-SEM-070 for measurement-input fallbacks. */
function checkFallbackUnits(ctx, unit, idx) {
  const defs = ctx.index.definitionsOf(idx.pattern);
  for (const { input, ptr } of idx.inputs.values()) {
    const def = defs.get(input.definitionId);
    if (def && input.fallback && input.fallback.unit !== UNIT_OF_DIMENSION[def.dimension]) {
      ctx.report("D2P-SEM-070", `fallback of measurement input "${input.key}" uses unit ${input.fallback.unit}, but ${input.definitionId} is a ${def.dimension}`, unit, pointer(ptr, "fallback", "unit"));
    }
  }
}

// ---------------------------------------------------------------------------
// Grading rule sets and commands

function checkGrading(ctx, unit) {
  const v = unit.value;
  const pattern = ctx.index.contentOf(v.patternRef);
  const idx = pattern ? indexPattern(pattern) : null;
  const env = idx ? patternEnv(ctx, idx) : { param: () => null, measurement: () => null, featureOutput: () => null };
  const rules = v.rules ?? [];
  if (rules.some((r) => r.kind === "point-increment") && v.baseSizeKey === undefined) {
    ctx.report("D2P-SEM-080", "point-increment rules require a baseSizeKey", unit, at(unit, "rules"));
  }
  rules.forEach((rule, i) => {
    const rp = at(unit, "rules", i);
    const sized = (rule.kind === "parameter-override" && (rule.bySize ?? []).length) || (rule.kind === "point-increment" && (rule.increments ?? []).length);
    if (sized && !isObject(v.sizeSystemRef)) ctx.report("D2P-SEM-080", `rule "${rule.id}" names size keys but the rule set has no sizeSystemRef`, unit, rp);
    if (rule.kind === "point-increment" && idx) {
      const f = idx.features.get(rule.pointFeatureId)?.feature;
      if (f && !satisfiesKind(idx, f, "point")) ctx.report("D2P-SEM-080", `rule "${rule.id}" targets the non-point feature "${rule.pointFeatureId}"`, unit, pointer(rp, "pointFeatureId"));
    }
    if (rule.kind === "parameter-override") {
      const expected = idx ? dimensionOfName(idx.parameters.get(rule.parameterId)?.parameter.dimension) : null;
      (rule.bySize ?? []).forEach((s, j) => checkExprSlot(ctx, unit, env, s.expr, pointer(rp, "bySize", j, "expr"), expected));
    }
  });
}

function checkCommandExpressions(ctx, unit) {
  const v = unit.value;
  if (v.type !== "d2p:pattern.parameters.update") return;
  const pattern = ctx.index.contentOf({ artifactId: v.target?.artifactId, revisionId: v.expectedRevisionId });
  const idx = pattern ? indexPattern(pattern) : null;
  const env = idx ? patternEnv(ctx, idx) : { param: () => null, measurement: () => null, featureOutput: () => null };
  (v.payload?.updates ?? []).forEach((u, i) => {
    const expected = idx ? dimensionOfName(idx.parameters.get(u.parameterId)?.parameter.dimension) : null;
    checkExprSlot(ctx, unit, env, u.expr, at(unit, "payload", "updates", i, "expr"), expected);
  });
}

// ---------------------------------------------------------------------------
// Line-only geometry on quantized coordinates (exact BigInt predicates)

const pt = (p) => [scaledInteger(p[0]), scaledInteger(p[1])];
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
const sign = (x) => (x > 0n ? 1 : x < 0n ? -1 : 0);
const orient = (a, b, c) => sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
const between = (a, b, c) => // c on the closed segment ab, given collinear
  (a[0] < b[0] ? a[0] : b[0]) <= c[0] && c[0] <= (a[0] > b[0] ? a[0] : b[0]) && (a[1] < b[1] ? a[1] : b[1]) <= c[1] && c[1] <= (a[1] > b[1] ? a[1] : b[1]);

function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  if (d1 === 0 && between(p3, p4, p1)) return true;
  if (d2 === 0 && between(p3, p4, p2)) return true;
  if (d3 === 0 && between(p1, p2, p3)) return true;
  if (d4 === 0 && between(p1, p2, p4)) return true;
  return false;
}

/**
 * Returns a description of the first self-intersection of a polyline
 * (`closed`: the last vertex equals the first), or null.
 */
export function polylineSelfIntersection(vertices, closed) {
  const n = vertices.length - 1; // segment count
  if (n < 2) return null;
  const seg = (i) => [vertices[i], vertices[i + 1]];
  for (let i = 0; i < n; i += 1) if (samePoint(...seg(i))) return null; // degenerate: evaluator concern (D2P-EVL-005)
  const adjacent = (i, j) => j === i + 1 || (closed && i === 0 && j === n - 1);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const [a, b] = seg(i);
      const [c, d] = seg(j);
      if (adjacent(i, j)) {
        // Shared vertex: the segments overlap if they are collinear and leave it in the same direction.
        const pairs = [];
        if (j === i + 1) pairs.push([a, b, d]); // shared b = c
        if (closed && i === 0 && j === n - 1) pairs.push([b, a, c]); // shared a = d
        for (const [x, shared, y] of pairs) {
          const ux = x[0] - shared[0];
          const uy = x[1] - shared[1];
          const vx = y[0] - shared[0];
          const vy = y[1] - shared[1];
          if (orient(x, shared, y) === 0 && ux * vx + uy * vy > 0n) return `segments ${i} and ${j} overlap`;
        }
      } else if (segmentsIntersect(a, b, c, d)) {
        return `segments ${i} and ${j} intersect`;
      }
    }
  }
  return null;
}

/** Twice the signed area of a closed polygon (vertices without the repeated first point). */
function signedArea2(vertices) {
  let s = 0n;
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}

function pathVertices(start, segments) {
  return [pt(start), ...segments.map((s) => pt(s.end))];
}

function checkSnapshot(ctx, unit) {
  (unit.value.pieces ?? []).forEach((piece, pi) => {
    (piece.contours ?? []).forEach((c, ci) => {
      const cp = at(unit, "pieces", pi, "contours", ci);
      const segs = c.segments ?? [];
      if (!segs.length) return;
      const vertices = pathVertices(c.start, segs);
      const closed = samePoint(vertices[0], vertices[vertices.length - 1]);
      if (!closed) ctx.report("D2P-SEM-010", `snapshot contour "${c.contourId}" is open: its last segment does not end at its start`, unit, cp);
      if (!segs.every((s) => s.kind === "line")) return; // curves: evaluator concern
      const hit = polylineSelfIntersection(vertices, closed);
      if (hit) ctx.report("D2P-SEM-011", `snapshot contour "${c.contourId}" self-intersects: ${hit}`, unit, cp);
      if (closed && !hit) {
        const area = signedArea2(vertices.slice(0, -1));
        const ok = c.role === "outer" ? area > 0n : area < 0n;
        if (!ok) ctx.report("D2P-SEM-012", `snapshot contour "${c.contourId}" (${c.role}) must be ${c.role === "outer" ? "counter-clockwise" : "clockwise"}`, unit, cp);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Snapshot completeness (D2P-SEM-014) and seam arithmetic (D2P-SEM-024), §3.4

const D2P_CURVE_TYPES = new Set(["d2p:line", "d2p:arc", "d2p:bezier.cubic"]);

/**
 * Comparison of computed coordinates and lengths after quantization (catalog
 * §3.4, §3.7): at most this many quantization steps apart. It absorbs the
 * rounding of already quantized operands and of the rotation; it is a bound
 * for floating-point arithmetic, not a geometric tolerance.
 */
export const QUANTUM_SLACK = 2n;
const absBig = (x) => (x < 0n ? -x : x);
const closeQuantized = (a, b) => absBig(scaledInteger(a) - scaledInteger(b)) <= QUANTUM_SLACK;

/**
 * Reports every expected ID that is missing and every ID that appears twice.
 * Items whose ID is not in `expected` are passed to `foreign` (or ignored when
 * the ID is unknown: that is D2P-REF-003). Returns ID -> index of the first item.
 */
function exactlyOnce(report, expected, items, idOf, what, listPtr, itemPtr, foreign) {
  const own = new Set(expected);
  const seen = new Map();
  items.forEach((it, i) => {
    const id = idOf(it);
    if (!own.has(id)) {
      foreign?.(id, i);
      return;
    }
    if (seen.has(id)) report(`${what} "${id}" appears more than once`, itemPtr(i));
    else seen.set(id, i);
  });
  for (const id of expected) if (!seen.has(id)) report(`${what} "${id}" of the pattern is missing`, listPtr);
  return seen;
}

/**
 * D2P-SEM-014 (TOP-009, design decision ADR-006.2): a snapshot is the complete
 * geometry of its pinned pattern revision. Every piece, contour, notch,
 * grainline, fold and seam interface of the pattern and every active seam
 * connection appears exactly once, under its own piece; each contour has one
 * segment per edge in contour order (an extension curve may be approximated by
 * several consecutive segments with the same edgeId).
 */
function checkSnapshotCompleteness(ctx, unit) {
  const v = unit.value;
  const pattern = ctx.index.contentOf(v.patternRef);
  if (!pattern) return;
  const idx = indexPattern(pattern);
  const report = (msg, ptr) => ctx.report("D2P-SEM-014", `snapshot is incomplete or inconsistent with pattern ${v.patternRef.artifactId}@${v.patternRef.revisionId}: ${msg}`, unit, ptr);
  const pieces = Array.isArray(v.pieces) ? v.pieces : [];
  const firstPiece = exactlyOnce(report, [...idx.pieces.keys()], pieces, (p) => p.pieceId, "piece", at(unit, "pieces"), (i) => at(unit, "pieces", i, "pieceId"));
  pieces.forEach((sp, pi) => {
    if (firstPiece.get(sp.pieceId) !== pi) return;
    const piece = idx.pieces.get(sp.pieceId).piece;
    const pp = at(unit, "pieces", pi);
    const elements = (member, patternList, idKey, map, what) => {
      const items = Array.isArray(sp[member]) ? sp[member] : [];
      const seen = exactlyOnce(
        report,
        (patternList ?? []).map((x) => x.id),
        items,
        (x) => x[idKey],
        what,
        pointer(pp, member),
        (i) => pointer(pp, member, i, idKey),
        (id, i) => {
          const owner = map.get(id)?.piece?.id;
          if (owner !== undefined) report(`${what} "${id}" belongs to piece "${owner}", not to piece "${piece.id}"`, pointer(pp, member, i, idKey));
        },
      );
      return { items, seen };
    };
    const contours = elements("contours", piece.contours, "contourId", idx.contours, "contour");
    contours.items.forEach((c, ci) => {
      if (contours.seen.get(c.contourId) !== ci) return;
      const pc = idx.contours.get(c.contourId).contour;
      const cp = pointer(pp, "contours", ci);
      if (pc.role !== undefined && c.role !== pc.role) report(`contour "${c.contourId}" has role ${c.role}, the pattern contour is ${pc.role}`, pointer(cp, "role"));
      const edges = pc.edges ?? [];
      const runs = [];
      (c.segments ?? []).forEach((seg, si) => {
        if (runs.length && runs[runs.length - 1].edgeId === seg.edgeId) runs[runs.length - 1].items.push([seg, si]);
        else runs.push({ edgeId: seg.edgeId, items: [[seg, si]] });
      });
      const want = edges.map((e) => e.id);
      const got = runs.map((r) => r.edgeId);
      if (want.join("\u0000") !== got.join("\u0000")) {
        report(`contour "${c.contourId}" must have one segment per edge in contour order (${want.join(", ")}), got ${got.join(", ")}`, pointer(cp, "segments"));
        return;
      }
      // A d2p: curve is written as exactly one segment; only an extension curve may be
      // approximated by several (§3.4 rules 2, 3). The segment kind is geometry and is
      // left to evaluators (see tools/README.md, known limits).
      runs.forEach((r, k) => {
        const type = idx.features.get(edges[k].curveFeatureId)?.feature.type;
        if (!D2P_CURVE_TYPES.has(type) || r.items.length === 1) return;
        report(`edge "${r.edgeId}" (${type}) has ${r.items.length} segments; an edge with a d2p: curve has exactly one`, pointer(cp, "segments", r.items[1][1]));
      });
    });
    const notches = elements("notches", piece.notches, "notchId", idx.notches, "notch");
    notches.items.forEach((n, ni) => {
      const pn = idx.notches.get(n.notchId)?.notch;
      if (notches.seen.get(n.notchId) === ni && pn && n.edgeId !== pn.edgeId) report(`notch "${n.notchId}" is on edge "${pn.edgeId}", not "${n.edgeId}"`, pointer(pp, "notches", ni, "edgeId"));
    });
    elements("grainlines", piece.grainlines, "grainlineId", idx.grainlines, "grainline");
    const folds = elements("folds", piece.folds, "foldId", idx.folds, "fold");
    folds.items.forEach((f, fi) => {
      const pf = idx.folds.get(f.foldId)?.fold;
      if (folds.seen.get(f.foldId) === fi && pf && f.edgeId !== pf.edgeId) report(`fold "${f.foldId}" is on edge "${pf.edgeId}", not "${f.edgeId}"`, pointer(pp, "folds", fi, "edgeId"));
    });
  });
  const interfaces = Array.isArray(v.interfaces) ? v.interfaces : [];
  const firstIface = exactlyOnce(report, [...idx.interfaces.keys()], interfaces, (x) => x.seamInterfaceId, "seam interface", at(unit, "interfaces"), (i) => at(unit, "interfaces", i, "seamInterfaceId"));
  interfaces.forEach((x, i) => {
    if (firstIface.get(x.seamInterfaceId) !== i) return;
    const key = idx.interfaces.get(x.seamInterfaceId).iface.cutInstanceKey;
    if (x.cutInstanceKey !== key) report(`seam interface "${x.seamInterfaceId}" has cutInstanceKey ${x.cutInstanceKey ?? "(none)"}, the pattern interface ${key ?? "(none)"}`, at(unit, "interfaces", i));
  });
  const active = [...idx.connections.values()].filter(({ conn }) => conn.active === true).map(({ conn }) => conn.id);
  exactlyOnce(report, active, Array.isArray(v.seams) ? v.seams : [], (x) => x.seamConnectionId, "active seam connection", at(unit, "seams"), (i) => at(unit, "seams", i, "seamConnectionId"), (id, i) => {
    if (idx.connections.has(id)) report(`seam connection "${id}" is inactive and has no seam entry`, at(unit, "seams", i, "seamConnectionId"));
  });
}

/**
 * D2P-SEM-024: seam arithmetic of a snapshot (§3.4). `deviationMm` equals
 * `lengthAMm − lengthBMm − declaredEaseMm`; `lengthAMm` and `lengthBMm` equal
 * the `lengthMm` of the connection's interfaces A and B; `declaredEaseMm` is 0
 * for ease mode `none` and equals a constant ease amount. All comparisons are
 * made on quantized values within QUANTUM_SLACK.
 */
function checkSnapshotSeams(ctx, unit) {
  const v = unit.value;
  const pattern = ctx.index.contentOf(v.patternRef);
  const idx = pattern ? indexPattern(pattern) : null;
  const lengths = new Map((Array.isArray(v.interfaces) ? v.interfaces : []).map((x) => [x.seamInterfaceId, x.lengthMm]));
  (Array.isArray(v.seams) ? v.seams : []).forEach((s, i) => {
    const sp = at(unit, "seams", i);
    const report = (msg, member) => ctx.report("D2P-SEM-024", `seam "${s.seamConnectionId}": ${msg}`, unit, pointer(sp, member));
    if (scaledInteger(s.deviationMm) - (scaledInteger(s.lengthAMm) - scaledInteger(s.lengthBMm) - scaledInteger(s.declaredEaseMm)) > QUANTUM_SLACK
      || scaledInteger(s.lengthAMm) - scaledInteger(s.lengthBMm) - scaledInteger(s.declaredEaseMm) - scaledInteger(s.deviationMm) > QUANTUM_SLACK) {
      report(`deviationMm ${s.deviationMm} differs from lengthAMm − lengthBMm − declaredEaseMm`, "deviationMm");
    }
    const conn = idx?.connections.get(s.seamConnectionId)?.conn;
    if (!conn) return;
    const [a, b] = conn.interfaceIds ?? [];
    for (const [member, ifaceId] of [["lengthAMm", a], ["lengthBMm", b]]) {
      const len = lengths.get(ifaceId);
      if (typeof len === "number" && !closeQuantized(s[member], len)) report(`${member} ${s[member]} differs from the lengthMm ${len} of seam interface "${ifaceId}"`, member);
    }
    if (conn.ease?.mode === "none" && scaledInteger(s.declaredEaseMm) !== 0n) report("declaredEaseMm must be 0 for ease mode none", "declaredEaseMm");
    const constant = conn.ease?.amount ? evaluateConstant(conn.ease.amount.expr) : undefined;
    if (typeof constant === "number" && !closeQuantized(s.declaredEaseMm, constant)) report(`declaredEaseMm ${s.declaredEaseMm} differs from the constant ease amount ${constant}`, "declaredEaseMm");
  });
}

// ---------------------------------------------------------------------------
// Print (§3.7)

function checkScene(ctx, unit) {
  const v = unit.value;
  const layers = new Map((v.layers ?? []).map((l) => [l.id, l]));
  const layerRef = (layerId, ptr, what) => {
    if (!layers.has(layerId)) ctx.report("D2P-SEM-093", `${what} references layer "${layerId}", which does not exist`, unit, ptr);
  };
  (v.lineStyles ?? []).forEach((s, i) => layerRef(s.layerId, at(unit, "lineStyles", i, "layerId"), "line style"));
  (v.pieceInstances ?? []).forEach((inst, ii) => {
    const ip = at(unit, "pieceInstances", ii);
    (inst.paths ?? []).forEach((path, pi) => {
      const pp = pointer(ip, "paths", pi);
      layerRef(path.layerId, pointer(pp, "layerId"), `path "${path.id}"`);
      const segs = path.segments ?? [];
      if (!segs.length) return;
      const vertices = pathVertices(path.start, segs);
      const ends = samePoint(vertices[0], vertices[vertices.length - 1]);
      if (CLOSED_LAYER_ROLES.has(layers.get(path.layerId)?.role) && (path.closed !== true || !ends)) {
        ctx.report("D2P-SEM-090", `path "${path.id}" on a ${layers.get(path.layerId).role} layer is not closed`, unit, pp);
      }
      if (path.closed === true && segs.every((s) => s.kind === "line")) {
        const hit = polylineSelfIntersection(vertices, ends);
        if (hit) ctx.report("D2P-SEM-011", `closed path "${path.id}" self-intersects: ${hit}`, unit, pp);
      }
    });
    (inst.markers ?? []).forEach((m, mi) => layerRef(m.layerId, pointer(ip, "markers", mi, "layerId"), `marker "${m.id}"`));
    (inst.labels ?? []).forEach((l, li) => layerRef(l.layerId, pointer(ip, "labels", li, "layerId"), `label "${l.id}"`));
  });
  const sizeKeys = [...new Set((v.pieceInstances ?? []).map((p) => p.sizeKey))];
  if (sizeKeys.length > 1) {
    const styles = v.sizeStyles ?? [];
    for (const k of sizeKeys.sort()) {
      if (!styles.some((s) => s.sizeKey === k)) ctx.report("D2P-SEM-094", `the scene uses several sizes but has no sizeStyles entry for "${k}"`, unit, at(unit, "sizeStyles"));
    }
    const seen = new Map();
    styles.forEach((s, i) => {
      const look = canonicalize([s.color ?? null, s.dashMm ?? null]);
      if (seen.has(look)) ctx.report("D2P-SEM-094", `size styles "${seen.get(look)}" and "${s.sizeKey}" have equal color and dash pattern`, unit, at(unit, "sizeStyles", i));
      else seen.set(look, s.sizeKey);
    });
  }
}

/** Rigid instance transform (§3.7): mirror X in piece coordinates, then rotate, then translate. */
export function transformPoint(p, t) {
  const x0 = t.mirror === true ? -p[0] : p[0];
  const y0 = p[1];
  const cos = Math.cos(t.rotateRad);
  const sin = Math.sin(t.rotateRad);
  return [x0 * cos - y0 * sin + t.translate[0], x0 * sin + y0 * cos + t.translate[1]];
}

/** First difference between a scene path and a snapshot contour under an instance transform, or null. */
function contourPathMismatch(path, contour, transform) {
  const segs = path.segments ?? [];
  const want = contour.segments ?? [];
  const tp = (p) => transformPoint(p, transform);
  const near = (a, b) => Array.isArray(a) && Array.isArray(b) && closeQuantized(a[0], b[0]) && closeQuantized(a[1], b[1]);
  if (segs.length !== want.length) return `it has ${segs.length} segments, the contour has ${want.length}`;
  if (!near(path.start, tp(contour.start))) return "its start is not the transformed contour start";
  for (let i = 0; i < want.length; i += 1) {
    const a = segs[i];
    const b = want[i];
    if (a.kind !== b.kind) return `segment ${i} is a ${a.kind}, the contour segment a ${b.kind}`;
    const points = b.kind === "cubic" ? ["control1", "control2", "end"] : b.kind === "arc" ? ["center", "end"] : ["end"];
    for (const k of points) if (!near(a[k], tp(b[k]))) return `segment ${i} ${k} is not the transformed contour point`;
    if (b.kind === "arc") {
      const direction = transform.mirror === true ? (b.direction === "ccw" ? "cw" : "ccw") : b.direction;
      if (a.direction !== direction) return `segment ${i} direction must be ${direction}`;
    }
  }
  return null;
}

/**
 * Path geometry of one snapshot edge: the consecutive contour segments with
 * that `edgeId`, starting at the end of the segment before them.
 */
function edgeGeometries(contours) {
  const edges = new Map();
  for (const c of contours) {
    let prev = c.start;
    let current = null;
    for (const seg of c.segments ?? []) {
      if (current?.edgeId !== seg.edgeId) {
        current = edges.has(seg.edgeId) ? null : { edgeId: seg.edgeId, start: prev, segments: [] };
        if (current) edges.set(seg.edgeId, current);
      }
      current?.segments.push(seg);
      prev = seg.end;
    }
  }
  return edges;
}

/** Bounding box of the vertices (start and segment ends) of a path or contour, in scaled integers. */
function vertexBox(points) {
  const xs = points.map((p) => scaledInteger(p[0]));
  const ys = points.map((p) => scaledInteger(p[1]));
  const min = (l) => l.reduce((m, x) => (x < m ? x : m));
  const max = (l) => l.reduce((m, x) => (x > m ? x : m));
  return { min: [min(xs), min(ys)], max: [max(xs), max(ys)] };
}

/** True when box `inner` lies inside box `outer` within QUANTUM_SLACK. */
function boxInside(inner, outer) {
  return [0, 1].every((k) => inner.min[k] >= outer.min[k] - QUANTUM_SLACK && inner.max[k] <= outer.max[k] + QUANTUM_SLACK);
}

/**
 * First violation of the kernel-free bounds for a seam-allowance cut line
 * (`seamAllowancePolicy: included`, catalog §3.7), or null. Without a declared
 * seam allowance the cut line is the contour (adapters never invent seam
 * allowance). With one, a line-only contour bounds its offset: an outward
 * offset of an outer contour contains the contour's vertex box, and the offset
 * of a hole lies inside the hole's vertex box, for any non-negative widths and
 * any join. How far the offset lies from the contour is an evaluator check.
 */
function cutLineMismatch(path, contour, transform, hasAllowance) {
  if (!hasAllowance) {
    const m = contourPathMismatch(path, contour, transform);
    return m ? `the piece declares no seam allowance, so the cut line is the contour, but ${m}` : null;
  }
  if (!(contour.segments ?? []).every((sg) => sg.kind === "line")) return null;
  const pts = [path.start, ...(path.segments ?? []).map((sg) => sg.end)];
  if (!pts.every((p) => Array.isArray(p))) return null;
  const cut = vertexBox(pts);
  const net = vertexBox([contour.start, ...contour.segments.map((sg) => sg.end)].map((p) => transformPoint(p, transform)));
  if (contour.role === "hole") return boxInside(cut, net) ? null : "the cut line of a hole leaves the hole's vertex box";
  return boxInside(net, cut) ? null : "the cut line of an outer contour does not contain the contour's vertex box";
}

/** Layer roles that carry no free path: a path there materializes a contour or edge. */
const BOUND_PATH_ROLES = new Set(["d2p:cut-line", "d2p:seam-line", "d2p:grainline", "d2p:notch", "d2p:fold", "d2p:label"]);

/**
 * D2P-SEM-096 (design decision ADR-022 §1, §3): a scene reproduces the pinned
 * snapshot geometry under rigid instance transforms only. For every size of
 * `source.evaluations`, each cut instance of the pattern appears exactly once,
 * with its own piece and its `mirrored` flag as `transform.mirror`. Every path
 * on a `d2p:cut-line` or `d2p:seam-line` layer names a contour of the
 * instance's piece; every path that names a contour or edge is that snapshot
 * geometry under the instance transform, except a cut line with policy
 * `included`, which only has to meet the kernel-free offset bounds
 * (`cutLineMismatch`). A path that names no contour or edge is allowed only
 * on a `d2p:construction` or extension layer. Every contour is drawn on a
 * cut-line layer, and with policy `included` also on a seam-line layer. Not
 * applicable when the pattern or a snapshot is not in the bundle.
 */
function checkSceneGeometry(ctx, unit) {
  const v = unit.value;
  const source = isObject(v.source) ? v.source : {};
  const report = (msg, ptr) => ctx.report("D2P-SEM-096", msg, unit, ptr);
  const instances = Array.isArray(v.pieceInstances) ? v.pieceInstances : [];
  const pattern = ctx.index.contentOf(source.patternRef);
  if (pattern) {
    const idx = indexPattern(pattern);
    const mirroredOf = new Map();
    for (const { piece } of idx.pieces.values()) {
      const decl = piece.cutInstruction?.instances;
      if (Array.isArray(decl) && decl.length) decl.forEach((c) => !mirroredOf.has(c.cutInstanceKey) && mirroredOf.set(c.cutInstanceKey, c.mirrored === true));
      else if (!mirroredOf.has(piece.id)) mirroredOf.set(piece.id, false);
    }
    const sizeKeys = [...new Set((source.evaluations ?? []).map((e) => e.sizeKey))].sort();
    for (const k of sizeKeys) {
      const count = new Map();
      for (const inst of instances) if (inst.sizeKey === k) count.set(inst.cutInstanceKey, (count.get(inst.cutInstanceKey) ?? 0) + 1);
      for (const key of [...idx.cutInstances.keys()].sort()) {
        const n = count.get(key) ?? 0;
        if (n !== 1) report(`cut instance "${key}" appears ${n} times for size "${k}"; every cut instance of the pattern appears exactly once per size`, at(unit, "pieceInstances"));
      }
    }
    instances.forEach((inst, i) => {
      const ci = idx.cutInstances.get(inst.cutInstanceKey);
      if (!ci) return; // D2P-REF-010
      if (ci.pieceId !== inst.pieceId) report(`piece instance "${inst.id}": cut instance "${inst.cutInstanceKey}" belongs to piece "${ci.pieceId}", not "${inst.pieceId}"`, at(unit, "pieceInstances", i, "pieceId"));
      const mirrored = mirroredOf.get(inst.cutInstanceKey) === true;
      if ((inst.transform?.mirror === true) !== mirrored) report(`piece instance "${inst.id}": transform.mirror must be ${mirrored} (the cut instance's mirrored flag)`, at(unit, "pieceInstances", i, "transform", "mirror"));
    });
  }
  const allowanceOf = new Map();
  if (pattern) for (const { piece } of indexPattern(pattern).pieces.values()) allowanceOf.set(piece.id, piece.seamAllowance !== undefined);
  const snapshotsOf = new Map();
  for (const se of source.evaluations ?? []) {
    const e = ctx.index.derivedDoc("d2p:pattern-evaluation", se.evaluationId)?.value;
    const snap = e?.snapshotRef ? ctx.index.derivedDoc("d2p:geometry-snapshot", e.snapshotRef.id)?.value : undefined;
    if (snap) snapshotsOf.set(se.sizeKey, [...(snapshotsOf.get(se.sizeKey) ?? []), snap]);
  }
  const layers = new Map((v.layers ?? []).map((l) => [l.id, l.role]));
  const included = v.seamAllowancePolicy === "included";
  const contourRoles = included ? ["d2p:cut-line", "d2p:seam-line"] : ["d2p:cut-line"];
  instances.forEach((inst, i) => {
    const snaps = snapshotsOf.get(inst.sizeKey) ?? [];
    if (!snaps.length || !isObject(inst.transform)) return;
    const ip = at(unit, "pieceInstances", i);
    const problemsFor = (snap) => {
      const problems = [];
      const piece = (snap.pieces ?? []).find((p) => p.pieceId === inst.pieceId);
      if (!piece) return [[`the snapshot of size "${inst.sizeKey}" has no piece "${inst.pieceId}"`, ip]];
      const contours = new Map((piece.contours ?? []).map((c) => [c.contourId, c]));
      const edges = edgeGeometries(piece.contours ?? []);
      (inst.paths ?? []).forEach((path, j) => {
        const role = layers.get(path.layerId);
        if (role === undefined) return; // D2P-SEM-093
        const pp = pointer(ip, "paths", j);
        const what = `path "${path.id}" on a ${role} layer`;
        const contour = contours.get(path.elementId);
        const edge = contour ? undefined : edges.get(path.elementId);
        if (role === "d2p:cut-line" || role === "d2p:seam-line") {
          if (!contour) {
            problems.push([`${what} is not a contour of piece "${inst.pieceId}" (elementId ${path.elementId ?? "absent"})`, pp]);
            return;
          }
        } else if (!contour && !edge) {
          if (path.elementId !== undefined) problems.push([`${what} names ${path.elementId}, which is not a contour or edge of piece "${inst.pieceId}"`, pp]);
          else if (BOUND_PATH_ROLES.has(role)) problems.push([`${what} materializes no contour or edge; a free path is allowed only on a d2p:construction or extension layer`, pp]);
          return;
        }
        if (included && role === "d2p:cut-line") {
          const m = cutLineMismatch(path, contour, inst.transform, allowanceOf.get(inst.pieceId) !== false);
          if (m) problems.push([`${what} is not a seam-allowance cut line of contour "${contour.contourId}": ${m}`, pp]);
          return;
        }
        const target = contour ?? edge;
        const m = contourPathMismatch(path, target, inst.transform);
        if (m) problems.push([`${what} is not ${contour ? "contour" : "edge"} "${path.elementId}" of the pinned snapshot under the instance transform: ${m}`, pp]);
      });
      for (const c of piece.contours ?? []) {
        for (const r of contourRoles) {
          const drawn = (inst.paths ?? []).some((path) => layers.get(path.layerId) === r && path.elementId === c.contourId);
          if (!drawn) problems.push([`contour "${c.contourId}" of piece "${inst.pieceId}" is not drawn on a ${r} layer`, pointer(ip, "paths")]);
        }
      }
      return problems;
    };
    const results = snaps.map(problemsFor);
    if (results.some((r) => r.length === 0)) return;
    for (const [msg, ptr] of results[0]) report(`piece instance "${inst.id}": ${msg}`, ptr);
  });
}

function checkPrintJob(ctx, unit) {
  const v = unit.value;
  if (CALIBRATED_PROFILES.has(v.outputProfile?.profileId) && v.calibration === undefined) {
    ctx.report("D2P-SEM-091", `output profile ${v.outputProfile.profileId} requires a calibration control square`, unit, at(unit, "calibration"));
  }
  const media = v.pageLayout?.media;
  const size = MEDIA_SIZES[media?.name];
  if (size && (quantize(media.widthMm) !== size[0] || quantize(media.heightMm) !== size[1])) {
    ctx.report("D2P-SEM-092", `media ${media.name} must be ${size[0]} × ${size[1]} mm (portrait), got ${media.widthMm} × ${media.heightMm} mm`, unit, at(unit, "pageLayout", "media"));
  }
  (v.requiredExtensions ?? []).forEach((ns, i) => {
    ctx.report("D2P-SEM-006", `required extension ${ns} is not understood`, unit, at(unit, "requiredExtensions", i));
  });
  checkOutputProfile(ctx, unit);
}

/**
 * D2P-SEM-095: the binding page properties of the home-print output profiles
 * (catalog §3.7): the profile's media, tiling with a positive overlap,
 * registration marks and sheet labels, and at least one label on a
 * d2p:label layer per piece instance (piece and size identification).
 */
function checkOutputProfile(ctx, unit) {
  const v = unit.value;
  const profileId = v.outputProfile?.profileId;
  const media = HOME_PRINT_MEDIA[profileId];
  if (!media) return;
  const violated = (msg, ptr) => ctx.report("D2P-SEM-095", `output profile ${profileId}: ${msg}`, unit, ptr);
  const layout = v.pageLayout ?? {};
  if (layout.media?.name !== media) violated(`requires media ${media}, got ${layout.media?.name}`, at(unit, "pageLayout", "media", "name"));
  const tiling = layout.tiling ?? {};
  if (tiling.mode !== "tiled") violated(`requires tiling mode tiled, got ${tiling.mode}`, at(unit, "pageLayout", "tiling", "mode"));
  else if (!(tiling.overlapMm > 0)) violated("requires a positive overlap between sheets", at(unit, "pageLayout", "tiling", "overlapMm"));
  if (tiling.registrationMarks !== true) violated("requires registration marks", at(unit, "pageLayout", "tiling", "registrationMarks"));
  if (tiling.sheetLabels !== true) violated("requires sheet labels", at(unit, "pageLayout", "tiling", "sheetLabels"));
  const scene = isObject(v.scene) ? v.scene : {};
  const labelLayers = new Set((scene.layers ?? []).filter((l) => l.role === "d2p:label").map((l) => l.id));
  (scene.pieceInstances ?? []).forEach((inst, i) => {
    if (!(inst.labels ?? []).some((l) => labelLayers.has(l.layerId))) {
      violated(`piece instance "${inst.id}" has no label on a d2p:label layer (piece and size identification)`, at(unit, "scene", "pieceInstances", i, "labels"));
    }
  });
}

/** D2P-SEM-050: export documents never reference personal artifacts. */
function checkExportPrivacy(ctx, unit) {
  walkUnit(unit, (node, ptr, key) => {
    if (typeof key !== "string") return true;
    const refs = key.endsWith("Ref") && isObject(node) ? [[node, ptr]] : key.endsWith("Refs") && Array.isArray(node) ? node.map((r, i) => [r, pointer(ptr, i)]) : [];
    for (const [ref, p] of refs) {
      if (isObject(ref) && typeof ref.artifactId === "string" && ctx.index.isPersonal(ref.artifactId)) {
        ctx.report("D2P-SEM-050", `export document references artifact ${ref.artifactId}, which is classified as personal data`, unit, p);
      }
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Measurement (§3.3)

function checkBodyProfile(ctx, unit) {
  const v = unit.value;
  if (v.subject?.kind === "individual" && !PERSONAL_CLASSIFICATIONS.has(v.dataClassification)) {
    ctx.report("D2P-SEM-051", `a profile of an individual must be classified personal or sensitive-personal, got ${v.dataClassification}`, unit, at(unit, "dataClassification"));
  }
  const meta = ctx.index.artifactMeta.get(v.artifactId)?.value;
  if (meta && meta.dataClassification !== v.dataClassification) {
    ctx.report("D2P-SEM-051", `artifact metadata classifies ${v.artifactId} as ${meta.dataClassification}, the content as ${v.dataClassification}`, unit, at(unit, "dataClassification"));
  }
  checkMeasurementUnits(ctx, unit);
}

/**
 * D2P-SEM-070 for the definitions themselves (catalog §3.3): a definition's
 * `unit` is the canonical unit of its `dimension` (mm for length, rad for angle).
 */
function checkDefinitionUnits(ctx, unit) {
  (unit.value.definitions ?? []).forEach((d, i) => {
    const expected = UNIT_OF_DIMENSION[d.dimension];
    if (expected && d.unit !== expected) {
      ctx.report("D2P-SEM-070", `measurement definition ${d.definitionId} has dimension ${d.dimension} but unit ${d.unit}; its unit must be ${expected}`, unit, at(unit, "definitions", i, "unit"));
    }
  });
}

function checkMeasurementUnits(ctx, unit) {
  const v = unit.value;
  const defs = ctx.index.definitionsOf(v);
  const check = (definitionId, u, ptr, what) => {
    const def = defs.get(definitionId);
    if (def && u !== UNIT_OF_DIMENSION[def.dimension]) ctx.report("D2P-SEM-070", `${what} uses unit ${u}, but ${definitionId} is a ${def.dimension}`, unit, ptr);
  };
  if (v.documentType === "d2p:body-measurement-profile") {
    (v.measurements ?? []).forEach((m, i) => check(m.definitionId, m.unit, at(unit, "measurements", i, "unit"), "measurement value"));
  }
  if (v.documentType === "d2p:size-system") {
    (v.sizes ?? []).forEach((s, i) => (s.measurements ?? []).forEach((m, j) => check(m.definitionId, m.unit, at(unit, "sizes", i, "measurements", j, "unit"), `size "${s.sizeKey}" value`)));
  }
  if (v.documentType === "d2p:garment-measurement-spec") {
    (v.targets ?? []).forEach((t, i) => check(t.definitionId, t.unit, at(unit, "targets", i, "unit"), `target "${t.id}"`));
  }
  if (v.documentType === "d2p:fit-profile") {
    (v.easeRules ?? []).forEach((r, i) => check(r.garmentDefinitionId, r.amount?.unit, at(unit, "easeRules", i, "amount", "unit"), `ease rule "${r.id}"`));
    (v.fitTargets ?? []).forEach((t, i) => {
      for (const b of ["min", "max"]) if (t[b]) check(t.garmentDefinitionId, t[b].unit, at(unit, "fitTargets", i, b, "unit"), `fit target "${t.id}" ${b}`);
    });
  }
}

/**
 * D2P-SEM-075: body and garment definitions are never used on the other side
 * (catalog §3.3). Size-entry and body-profile values and ease-rule body
 * definitions are kind body; garment targets, fit targets and ease-rule
 * garment definitions are kind garment.
 */
function checkDefinitionKinds(ctx, unit) {
  const v = unit.value;
  const defs = ctx.index.definitionsOf(v);
  const expect = (definitionId, kind, ptr, what) => {
    const def = defs.get(definitionId);
    if (def && def.kind !== kind) ctx.report("D2P-SEM-075", `${what} uses ${definitionId}, a ${def.kind} definition, where a ${kind} definition is required`, unit, ptr);
  };
  switch (v.documentType) {
    case "d2p:body-measurement-profile":
      (v.measurements ?? []).forEach((m, i) => expect(m.definitionId, "body", at(unit, "measurements", i, "definitionId"), "measurement value"));
      break;
    case "d2p:size-system":
      (v.sizes ?? []).forEach((sz, i) =>
        (sz.measurements ?? []).forEach((m, j) => expect(m.definitionId, "body", at(unit, "sizes", i, "measurements", j, "definitionId"), `size "${sz.sizeKey}" value`)),
      );
      break;
    case "d2p:garment-measurement-spec":
      (v.targets ?? []).forEach((t, i) => expect(t.definitionId, "garment", at(unit, "targets", i, "definitionId"), `target "${t.id}"`));
      break;
    case "d2p:fit-profile":
      (v.easeRules ?? []).forEach((r, i) => {
        expect(r.bodyDefinitionId, "body", at(unit, "easeRules", i, "bodyDefinitionId"), `ease rule "${r.id}"`);
        expect(r.garmentDefinitionId, "garment", at(unit, "easeRules", i, "garmentDefinitionId"), `ease rule "${r.id}"`);
      });
      (v.fitTargets ?? []).forEach((t, i) => expect(t.garmentDefinitionId, "garment", at(unit, "fitTargets", i, "garmentDefinitionId"), `fit target "${t.id}"`));
      break;
    default:
      break;
  }
}

function checkFitProfile(ctx, unit) {
  const v = unit.value;
  checkMeasurementUnits(ctx, unit);
  const defs = ctx.index.definitionsOf(v);
  (v.easeRules ?? []).forEach((r, i) => {
    const rp = at(unit, "easeRules", i);
    const body = defs.get(r.bodyDefinitionId);
    const garment = defs.get(r.garmentDefinitionId);
    if (body && garment && body.path?.type !== garment.path?.type) {
      ctx.report("D2P-SEM-071", `ease rule "${r.id}" pairs a ${body.path?.type} body measurement with a ${garment.path?.type} garment measurement`, unit, rp);
    }
    if (typeof r.amount?.value === "number" && r.amount.value < 0 && !(r.materialCondition?.minStretchRatio > 0)) {
      ctx.report("D2P-SEM-073", `ease rule "${r.id}" has negative ease without a material condition requiring stretch`, unit, pointer(rp, "amount"));
    }
  });
}

/**
 * Whether an ease rule's materialCondition is met by the request's
 * materialAssumptions (catalog §3.3): the material class is listed and, when
 * minStretchRatio is given, the declared stretch reaches it in both directions.
 */
export function materialConditionMet(condition, assumptions) {
  if (!isObject(condition)) return true;
  if (!isObject(assumptions)) return false;
  if (!(condition.materialClasses ?? []).includes(assumptions.materialClass)) return false;
  if (condition.minStretchRatio === undefined) return true;
  const st = assumptions.stretch;
  if (!isObject(st)) return false;
  return st.lengthwise >= condition.minStretchRatio && st.crosswise >= condition.minStretchRatio;
}

/** D2P-SEM-074: a negative-ease rule whose material condition the request does not meet (§3.3). */
function checkEaseMaterial(ctx, unit) {
  const v = unit.value;
  if (!isObject(v.fitProfileRef)) return;
  const profile = ctx.index.contentOf(v.fitProfileRef);
  if (!profile) return;
  (profile.easeRules ?? []).forEach((r) => {
    if (!(typeof r.amount?.value === "number" && r.amount.value < 0) || !isObject(r.materialCondition)) return;
    const sizeKeys = r.scope?.sizeKeys;
    if (Array.isArray(sizeKeys) && v.sizeKey !== undefined && !sizeKeys.includes(v.sizeKey)) return;
    if (materialConditionMet(r.materialCondition, v.materialAssumptions)) return;
    const material = isObject(v.materialAssumptions) ? `material class ${v.materialAssumptions.materialClass}` : "no materialAssumptions";
    ctx.report(
      "D2P-SEM-074",
      `negative-ease rule "${r.id}" of the fit profile requires ${JSON.stringify(r.materialCondition)}, but the request states ${material}; the rule does not apply and its negative ease is not approved`,
      unit,
      at(unit, isObject(v.materialAssumptions) ? "materialAssumptions" : "fitProfileRef"),
    );
  });
}

/** D2P-SEM-072: measurement input resolution (§3.4). Not applicable when a pinned input is outside the bundle. */
function checkRequiredMeasurements(ctx, unit) {
  const v = unit.value;
  const pattern = ctx.index.contentOf(v.patternRef);
  if (!pattern) return;
  const load = (ref) => (isObject(ref) ? ctx.index.contentOf(ref) ?? null : undefined);
  const grading = load(v.gradingRuleSetRef);
  const sizeSystem = load(v.sizeSystemRef);
  const body = load(v.bodyMeasurementProfileRef);
  if (grading === null || sizeSystem === null || body === null) return;
  const sizeEntry = sizeSystem && v.sizeKey !== undefined ? (sizeSystem.sizes ?? []).find((s) => s.sizeKey === v.sizeKey) : undefined;
  const fromSize = (defId) => (sizeEntry?.measurements ?? []).some((m) => m.definitionId === defId);
  const fromBody = (defId) => (body?.measurements ?? []).some((m) => m.definitionId === defId);
  (pattern.measurementInputs ?? []).forEach((input) => {
    if (!input.required || input.fallback) return;
    const rule = grading ? (grading.rules ?? []).find((r) => r.kind === "measurement-source" && r.measurementKey === input.key) : undefined;
    let found;
    if (rule) found = rule.source === "size-entry" ? fromSize(input.definitionId) : fromBody(input.definitionId);
    else found = fromSize(input.definitionId) || fromBody(input.definitionId);
    if (!found) {
      ctx.report("D2P-SEM-072", `required measurement input "${input.key}" (${input.definitionId}) resolves to no value and has no fallback`, unit, at(unit, "patternRef"));
    }
  });
}

// ---------------------------------------------------------------------------
// Validation (§3.5)

function findingsOf(report) {
  return new Map((report?.findings ?? []).map((f) => [f.findingId, f]));
}

function checkWaiver(ctx, unit) {
  const v = unit.value;
  if (compareTimestamps(v.expiresAt, v.createdAt) <= 0) ctx.report("D2P-SEM-101", "waiver expiresAt is not after createdAt", unit, at(unit, "expiresAt"));
  const report = ctx.index.derivedDoc("d2p:validation-report", v.reportId)?.value;
  if (!report) return;
  const findings = findingsOf(report);
  (v.findingIds ?? []).forEach((id, i) => {
    const f = findings.get(id);
    if (!f) ctx.report("D2P-SEM-101", `waived finding ${id} is not in report ${v.reportId}`, unit, at(unit, "findingIds", i));
    else if (f.severity === "critical") ctx.report("D2P-SEM-100", `waived finding ${id} has severity critical, which is never waivable`, unit, at(unit, "findingIds", i));
  });
}

/** Action that a validation purpose gates (§3.5 purpose to action mapping). */
export const ACTION_OF_PURPOSE = Object.freeze({
  "draft-edit": "edit-draft",
  "1to1-print": "export-1to1",
  "sample-cut": "cut-sample",
  "product-release": "create-product-release",
  "manufacturing-release": "release-manufacturing",
  "package-publish": "publish-package",
  "import-promote": "promote-import",
});

/**
 * D2P-SEM-103 (design decision ADR-016 §3, §6, VAL-001, VAL-007): a validation
 * report agrees with itself and with its profile. `result` is `pass` if and
 * only if `status = completed` and no finding has severity error or critical;
 * `purpose` is the profile's purpose; every finding belongs to a rule of the
 * profile, carries that rule's `ruleVersion` and profile `severity`, and a
 * `code` the rule definition lists in `diagnosticCodes`.
 */
function checkReport(ctx, unit) {
  const r = unit.value;
  const report = (msg, ptr) => ctx.report("D2P-SEM-103", `validation report is inconsistent: ${msg}`, unit, ptr);
  const findings = Array.isArray(r.findings) ? r.findings : [];
  const blocking = findings.some((f) => f.severity === "error" || f.severity === "critical");
  const expected = r.status === "completed" && !blocking ? "pass" : "fail";
  if (r.result !== expected) report(`result must be ${expected} (status ${r.status}, ${blocking ? "with" : "no"} error or critical findings), got ${r.result}`, at(unit, "result"));
  const profile = isObject(r.profile) ? ctx.index.vocabDoc("d2p:validation-profile", r.profile.id, r.profile.version)?.value : undefined;
  if (!profile) return; // unresolved: D2P-REF-001
  if (r.purpose !== profile.purpose) report(`purpose ${r.purpose} differs from the purpose ${profile.purpose} of profile ${profile.profileId}`, at(unit, "purpose"));
  const rules = new Map((profile.rules ?? []).map((x) => [x.ruleId, x]));
  findings.forEach((f, i) => {
    const fp = at(unit, "findings", i);
    const entry = rules.get(f.ruleId);
    if (!entry) {
      report(`finding ${f.findingId}: rule ${f.ruleId} is not part of profile ${profile.profileId}`, pointer(fp, "ruleId"));
      return;
    }
    if (f.ruleVersion !== entry.ruleVersion) report(`finding ${f.findingId}: ruleVersion ${f.ruleVersion} differs from ${entry.ruleVersion} in the profile`, pointer(fp, "ruleVersion"));
    if (f.severity !== entry.severity) report(`finding ${f.findingId}: severity ${f.severity} differs from the profile severity ${entry.severity} of rule ${f.ruleId}`, pointer(fp, "severity"));
    const def = ctx.index.vocabDoc("d2p:validation-rule-definition", entry.ruleId, entry.ruleVersion)?.value;
    if (def && !(def.diagnosticCodes ?? []).includes(f.code)) report(`finding ${f.findingId}: code ${f.code} is not a diagnostic code of rule ${f.ruleId}`, pointer(fp, "code"));
  });
}

function checkGate(ctx, unit) {
  const g = unit.value;
  const reportIds = new Set((g.reportRefs ?? []).map((r) => r.id));
  const waivers = [];
  (g.waiverIds ?? []).forEach((id, i) => {
    const w = ctx.index.derivedDoc("d2p:waiver", id)?.value;
    if (!w) return;
    waivers.push(w);
    const wp = at(unit, "waiverIds", i);
    if (w.action !== g.action) ctx.report("D2P-SEM-101", `waiver ${id} is for action ${w.action}, the gate for ${g.action}`, unit, wp);
    if (!sameRefSet(w.targetRefs, g.targetRefs)) ctx.report("D2P-SEM-101", `waiver ${id} targets other revisions than the gate`, unit, wp);
    if (!reportIds.has(w.reportId)) ctx.report("D2P-SEM-101", `waiver ${id} waives findings of report ${w.reportId}, which the gate does not reference`, unit, wp);
  });

  const profile = isObject(g.profile) ? ctx.index.vocabDoc("d2p:validation-profile", g.profile.id, g.profile.version)?.value : undefined;
  const reports = (g.reportRefs ?? []).map((r) => ctx.index.derivedDoc("d2p:validation-report", r.id)?.value);
  const evidence = (g.evidenceRefs ?? []).map((r) => ctx.index.derivedDoc("d2p:quality-evidence-bundle", r.id)?.value);
  // D2P-SEM-104: the profile and every referenced report have the purpose that gates this action.
  if (profile && ACTION_OF_PURPOSE[profile.purpose] !== g.action) {
    ctx.report("D2P-SEM-104", `gate action ${g.action} is gated by profile ${profile.profileId} of purpose ${profile.purpose}, which gates ${ACTION_OF_PURPOSE[profile.purpose] ?? "no action"}`, unit, at(unit, "profile"));
  }
  reports.forEach((r, i) => {
    if (r && ACTION_OF_PURPOSE[r.purpose] !== g.action) {
      ctx.report("D2P-SEM-104", `report ${r.reportId} has purpose ${r.purpose}, which does not gate action ${g.action}`, unit, at(unit, "reportRefs", i));
    }
  });
  if (!profile || reports.some((r) => !r) || evidence.some((e) => !e)) return; // unresolved inputs are referential findings
  const expected = gateDecision(g, profile, reports, waivers, evidence);
  const actualReasons = [...(g.reasonCodes ?? [])].sort();
  const addressedKey = (list) => list.map((a) => `${a.reportId}|${a.findingId}`).sort().join(",");
  const problems = [];
  if (expected.decision !== g.decision) problems.push(`decision should be ${expected.decision}, got ${g.decision}`);
  if (actualReasons.join(",") !== expected.reasonCodes.join(",")) problems.push(`reasonCodes should be [${expected.reasonCodes.join(", ")}], got [${actualReasons.join(", ")}]`);
  if (addressedKey(g.addressedFindings ?? []) !== addressedKey(expected.addressedFindings)) problems.push("addressedFindings differ from the findings addressed by valid waivers");
  if (problems.length) ctx.report("D2P-SEM-102", `gate decision is inconsistent with the decision procedure: ${problems.join("; ")}`, unit, at(unit, "decision"));
}

/**
 * The deterministic gate decision procedure of §3.5.
 *
 * @returns {{ decision: string, reasonCodes: string[], addressedFindings: {reportId: string, findingId: string}[] }}
 */
export function gateDecision(gate, profile, reports, waivers, evidence = []) {
  const result = (decision, reason, addressed = []) => {
    const reasons = new Set(reason ? [reason] : []);
    if (addressed.length) reasons.add("d2p:waived");
    return { decision, reasonCodes: [...reasons].sort(), addressedFindings: addressed };
  };
  if (!reports.length) return result("deny", "d2p:report-missing");
  const ruleVersions = new Map((profile.rules ?? []).map((r) => [r.ruleId, r.ruleVersion]));
  const stale = reports.some(
    (r) =>
      r.profile?.id !== gate.profile?.id ||
      r.profile?.version !== gate.profile?.version ||
      !sameRefSet(r.targetRefs, gate.targetRefs) ||
      (r.findings ?? []).some((f) => ruleVersions.get(f.ruleId) !== f.ruleVersion),
  );
  if (stale) return result("deny", "d2p:report-stale");
  if (reports.some((r) => r.status === "failed")) return result("deny", "d2p:report-failed");
  // Steps 4 and 5: test evidence (design decision ADR-025 §11.4, QEV-012).
  if (evidence.some((b) => missingSuites(b))) return result("deny", "d2p:evidence-missing");
  if (evidence.some((b) => b.overallState !== "passed")) return result("deny", "d2p:evidence-not-passed");

  const policy = profile.waiverPolicy ?? { allowed: false };
  const listed = new Set(gate.waiverIds ?? []);
  const isAddressed = (report, f) =>
    waivers.some(
      (w) =>
        listed.has(w.waiverId) &&
        w.reportId === report.reportId &&
        (w.findingIds ?? []).includes(f.findingId) &&
        w.action === gate.action &&
        sameRefSet(w.targetRefs, gate.targetRefs) &&
        compareTimestamps(w.createdAt, gate.evaluatedAt) <= 0 &&
        compareTimestamps(gate.evaluatedAt, w.expiresAt) < 0 &&
        policy.allowed === true &&
        f.severity !== "critical" &&
        SEVERITY_RANK[f.severity] <= SEVERITY_RANK[policy.maxSeverity],
    );
  const addressed = [];
  const open = [];
  for (const r of reports) {
    for (const f of r.findings ?? []) {
      if (isAddressed(r, f)) addressed.push({ reportId: r.reportId, findingId: f.findingId });
      else open.push(f);
    }
  }
  addressed.sort((a, b) => (a.reportId === b.reportId ? (a.findingId < b.findingId ? -1 : 1) : a.reportId < b.reportId ? -1 : 1));
  if (open.some((f) => f.severity === "error" || f.severity === "critical")) return result("deny", "d2p:blocking-findings", addressed);
  // Step 7 (approval required) applies to no 1.0 profile.
  if (open.some((f) => f.severity === "warning")) return result("allow-with-warning", "d2p:warnings-present", addressed);
  return result("allow", null, addressed);
}

// ---------------------------------------------------------------------------
// Benchmark evidence (§3.8)

/** True if a required suite of the bundle has no report entry (QEV-012). */
function missingSuites(bundle) {
  const reports = bundle.reports ?? [];
  return (bundle.requiredSuites ?? []).some((s) => !reports.some((r) => r.suiteId === s.suiteId && r.suiteVersion === s.suiteVersion));
}

/** Expected overallState of a quality evidence bundle (D2P-SEM-110). */
export function evidenceState(bundle) {
  const reports = bundle.reports ?? [];
  if (missingSuites(bundle) || reports.some((r) => r.resultState === "failed")) return "failed";
  if (reports.some((r) => r.resultState === "inconclusive" || r.resultState === "skipped")) return "inconclusive";
  return "passed";
}

function checkEvidenceBundle(ctx, unit) {
  const expected = evidenceState(unit.value);
  if (unit.value.overallState !== expected) {
    ctx.report("D2P-SEM-110", `overallState should be ${expected}, got ${unit.value.overallState}`, unit, at(unit, "overallState"));
  }
}
