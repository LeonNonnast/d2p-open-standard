// Negative fixtures of catalog section 4.3. Each negative/<name>/ directory
// holds only the changed documents plus case.json, a d2p:conformance-case that
// states the subjects, the resolution context and the expected diagnostic code.
// Every digest inside a subject is recomputed for the changed content
// (catalog section 4.3, rule 2).
import { digests } from "./c14n.mjs";
import { add, ev, fo, lit, neg, p, rad } from "./expr.mjs";
import { ACTOR, ids, REGISTRY } from "./ids.mjs";

const SCHEMA_VERSION = "1.0.0";

export function buildNegatives(ctx) {
  const { files, put, FIXTURE_DIR, externalPaths } = ctx;
  const doc = (rel) => {
    const f = files.get(rel);
    if (!f) throw new Error(`missing fixture file ${rel}`);
    return structuredClone(f.doc);
  };
  const repo = (rel) => `${FIXTURE_DIR}/${rel}`;
  const inputPaths = [...files.keys()].filter((k) => k.startsWith("inputs/")).sort();
  /** Fixture inputs without the change case and without the given files, plus the external files. */
  const baseContext = (exclude = [], { includeChange = false } = {}) => [
    ...inputPaths.filter((k) => !exclude.includes(k) && (includeChange || !k.startsWith("inputs/change/"))).map(repo),
    ...externalPaths,
  ];
  const caseA = "r1-size-a-regular-woven";

  const negative = (name, { level, title, description, subjects, context, outcome, codes, editability }) => {
    const subjectPaths = [];
    for (const [file, content] of Object.entries(subjects)) {
      const rel = `negative/${name}/${file}`;
      put(rel, content, "negative");
      subjectPaths.push(repo(rel));
    }
    const primary = subjectPaths[0];
    const expect = {
      outcome,
      diagnostics: codes.map(([code, file]) => ({ code, documentPath: file ? repo(`negative/${name}/${file}`) : primary })),
    };
    if (editability) expect.editability = editability;
    put(`negative/${name}/case.json`, {
      documentType: "d2p:conformance-case",
      schemaVersion: SCHEMA_VERSION,
      caseId: `golden-tshirt.${name}`,
      level,
      title,
      documents: [...subjectPaths.map((path) => ({ path, role: "subject" })), ...context.map((path) => ({ path, role: "context" }))],
      expect,
      description,
    }, "negative");
  };

  const patternContext = baseContext(["inputs/pattern-r1.json", "inputs/revisions/pattern-r1.json"]);
  const point = (id, x, y) => ({ id, type: "d2p:point.absolute", params: { x: ev(x), y: ev(y) } });

  // 1. open contour --------------------------------------------------------
  {
    const pat = doc("inputs/pattern-r1.json");
    pat.features.push(point("front-hem-right-open-pt", neg(p("quarter-hem")), lit(15)));
    pat.features.push({ id: "front-side-right-open-curve", type: "d2p:line", params: { startFeatureId: "front-hem-right-open-pt", endFeatureId: "front-underarm-right-pt" } });
    pat.pieces.find((pc) => pc.id === "front").contours[0].edges.find((e) => e.id === "front-side-right").curveFeatureId = "front-side-right-open-curve";
    negative("open-contour", {
      level: "semantic",
      title: "Golden T-Shirt: open front contour",
      description: "The last edge of the front outer contour (front-side-right) ends at front-hem-right-open-pt, which is not the start point (front-hem-right-pt) of the first edge front-hem.",
      subjects: { "pattern.json": pat },
      context: patternContext,
      outcome: "reject",
      codes: [["D2P-SEM-010"]],
    });
  }

  // 2. self-intersection (line-only snapshot contour shaped as a bow-tie) ----
  {
    const snap = doc(`expected/snapshots/${caseA}.json`);
    const front = snap.pieces.find((pc) => pc.pieceId === "front");
    const contour = front.contours[0];
    const pts = [
      [200, 0],
      [200, 300],
      [-200, 500],
      [-200, 600],
      [200, 600],
      [200, 500],
      [-200, 300],
      [-200, 0],
    ];
    contour.start = [-200, 0];
    contour.segments = contour.segments.map((s, i) => ({ kind: "line", edgeId: s.edgeId, end: pts[i] }));
    front.boundingBox = { min: [-200, 0], max: [200, 600] };
    const ring = [contour.start, ...pts.slice(0, -1)];
    let twice = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      twice += x1 * y2 - x2 * y1;
    }
    front.areaMm2 = Math.abs(twice / 2);
    snap.geometryDigest = digests.geometry(snap);
    negative("self-intersection", {
      level: "semantic",
      title: "Golden T-Shirt: self-intersecting snapshot contour",
      description: "The front outer contour of the snapshot is made only of line segments and shaped as a bow-tie: the segments of front-armhole-left and front-armhole-right cross at (0, 400). The net signed area stays positive (counter-clockwise), so only the self-intersection is defective.",
      subjects: { "geometry-snapshot.json": snap },
      context: baseContext(),
      outcome: "reject",
      codes: [["D2P-SEM-011"]],
    });
  }

  // 3. impossible constraint ---------------------------------------------------
  {
    const pat = doc("inputs/pattern-r1.json");
    for (const [id, value] of [["front-hem-width-constraint-a", 500], ["front-hem-width-constraint-b", 520]]) {
      pat.features.push({ id, type: "d2p:constraint.distance", params: { aFeatureId: "front-hem-left-pt", bFeatureId: "front-hem-right-pt", value: ev(lit(value)) } });
    }
    negative("impossible-constraint", {
      level: "semantic",
      title: "Golden T-Shirt: contradictory distance constraints",
      description: "Two d2p:constraint.distance features on the same point pair (front-hem-left-pt, front-hem-right-pt) with the constant values 500 mm and 520 mm.",
      subjects: { "pattern.json": pat },
      context: patternContext,
      outcome: "reject",
      codes: [["D2P-SEM-040"]],
    });
  }

  // 4. feature cycle -------------------------------------------------------------
  {
    const pat = doc("inputs/pattern-r1.json");
    pat.features.push({ id: "cycle-a-pt", type: "d2p:point.offset", params: { baseFeatureId: "cycle-b-pt", dx: ev(lit(10)), dy: ev(lit(0)) } });
    pat.features.push(point("cycle-b-pt", fo("cycle-a-pt", "x"), lit(0)));
    negative("feature-cycle", {
      level: "semantic",
      title: "Golden T-Shirt: feature dependency cycle",
      description: "cycle-a-pt depends on cycle-b-pt through baseFeatureId, and cycle-b-pt depends on cycle-a-pt through a featureOutput expression.",
      subjects: { "pattern.json": pat },
      context: patternContext,
      outcome: "reject",
      codes: [["D2P-SEM-001"]],
    });
  }

  // 5. unit mismatch -------------------------------------------------------------
  {
    const pat = doc("inputs/pattern-r1.json");
    pat.parameters.find((x) => x.id === "back-neck-depth").expr = add(lit(20), rad(0.1));
    negative("unit-mismatch", {
      level: "semantic",
      title: "Golden T-Shirt: length plus angle",
      description: "The expression of parameter back-neck-depth adds a literal in mm and a literal in rad.",
      subjects: { "pattern.json": pat },
      context: patternContext,
      outcome: "reject",
      codes: [["D2P-SEM-002"]],
    });
  }

  // 6. forbidden expression node ------------------------------------------------
  {
    const pat = doc("inputs/pattern-r1.json");
    pat.parameters.find((x) => x.id === "back-neck-depth").expr = { op: "script", source: "return 20;" };
    negative("forbidden-expression-node", {
      level: "structural",
      title: "Golden T-Shirt: script node in an expression",
      description: "The expression of parameter back-neck-depth is a script node, which is outside the closed node list.",
      subjects: { "pattern.json": pat },
      context: [],
      outcome: "reject",
      codes: [["D2P-STR-001"], ["D2P-STR-010"]],
    });
  }

  // 7. unknown extension feature (read-only, accepted) ----------------------------
  {
    const pat = doc("inputs/pattern-r1.json");
    pat.features.push({
      id: "front-smocking",
      type: "org.example.unknown:smocking",
      params: { rows: 6, rowSpacingMm: 8 },
      label: "Decorative smocking on the front (fictitious extension feature)",
      dependsOn: ["front-grain-end-pt", "front-grain-start-pt"],
    });
    pat.featureCapabilities.push({
      featureType: "org.example.unknown:smocking",
      version: "1.0.0",
      lowering: "extension",
      kind: "other",
      outputs: [],
      onUnknown: "read-only",
      evaluator: { id: "org.example.unknown:smocking-evaluator", version: "1.0.0" },
      provenance: { publisher: "Fictitious extension publisher (test data)" },
    });
    const snap = doc(`expected/snapshots/${caseA}.json`);
    snap.inputDigests = snap.inputDigests.map((d) => (d.role === "pattern" ? { ...d, digest: digests.content(pat) } : d));
    snap.extensionEvaluators = [{ featureType: "org.example.unknown:smocking", evaluator: { id: "org.example.unknown:smocking-evaluator", version: "1.0.0" } }];
    snap.geometryDigest = digests.geometry(snap);
    negative("unknown-extension-feature", {
      level: "semantic",
      title: "Golden T-Shirt: unknown extension feature stays read-only",
      description: "The pattern uses the extension feature type org.example.unknown:smocking with exactly one capability (lowering extension, onUnknown read-only, provenance). The kit has no evaluator for it, so the pattern is accepted read-only and the conforming snapshot (which records the extension evaluator it was produced with) stays displayable.",
      subjects: { "pattern.json": pat, "geometry-snapshot.json": snap },
      context: patternContext,
      outcome: "accept",
      codes: [["D2P-SEM-004", "pattern.json"]],
      editability: "read-only",
    });
  }

  // 8. unpinned reference -----------------------------------------------------------
  {
    const req = doc(`inputs/evaluation-requests/${caseA}.json`);
    delete req.fitProfileRef.revisionId;
    negative("unpinned-reference", {
      level: "structural",
      title: "Golden T-Shirt: fit profile reference without revision",
      description: "fitProfileRef names the artifact but no revisionId.",
      subjects: { "evaluation-request.json": req },
      context: [],
      outcome: "reject",
      codes: [["D2P-STR-001"], ["D2P-STR-011"]],
    });
  }

  // 9. unresolvable reference ---------------------------------------------------------
  {
    const req = doc(`inputs/evaluation-requests/${caseA}.json`);
    req.fitProfileRef.revisionId = "rev_golden-tshirt-fit-profile-regular-r9";
    negative("unresolvable-reference", {
      level: "referential",
      title: "Golden T-Shirt: fit profile revision not in the bundle",
      description: "fitProfileRef pins rev_golden-tshirt-fit-profile-regular-r9, which does not exist; the artifact itself is present with revision r1.",
      subjects: { "evaluation-request.json": req },
      context: baseContext([`inputs/evaluation-requests/${caseA}.json`]),
      outcome: "reject",
      codes: [["D2P-REF-002"]],
    });
  }

  // 10. stale revision ----------------------------------------------------------------
  {
    const report = doc(`expected/validation/${caseA}.1to1-print.json`);
    const gate = doc(`expected/validation/gate-${caseA}.export-1to1.json`);
    gate.targetRefs = gate.targetRefs.map((r) => (r.artifactId === ids.art("pattern") ? ids.ref("pattern", 2) : r));
    gate.resultDigest = digests.result(gate, "gateEvaluationId");
    negative("stale-revision", {
      level: "referential",
      title: "Golden T-Shirt: gate targets pattern r2 with a report for r1",
      description: "The export gate targets pattern revision r2, but its 1to1-print report targets r1 (r2 is a child of r1 in the bundle). validation-report.json is an unchanged copy of the fixture report.",
      subjects: { "gate-evaluation.json": gate, "validation-report.json": report },
      context: [
        ...baseContext([], { includeChange: true }),
        repo("expected/change/pattern-r2.json"),
        repo("expected/change/revision-pattern-r2.json"),
        repo(`expected/evaluations/${caseA}.json`),
        repo(`expected/snapshots/${caseA}.json`),
        repo(`expected/export/scene-${caseA}.json`),
        repo(`expected/export/print-${caseA}-a4.json`),
      ],
      outcome: "reject",
      codes: [["D2P-REF-006", "gate-evaluation.json"]],
    });
  }

  // 11. incompatible schema version ----------------------------------------------------
  {
    const pat = doc("inputs/pattern-r1.json");
    pat.schemaVersion = "99.0.0";
    negative("incompatible-schema-version", {
      level: "structural",
      title: "Golden T-Shirt: pattern written against standard 99.0.0",
      description: "schemaVersion 99.0.0 is outside the compatibility line of release 1.0.0; the version gate rejects the document before schema validation.",
      subjects: { "pattern.json": pat },
      context: [],
      outcome: "reject",
      codes: [["D2P-STR-003"]],
    });
  }

  // 12. private measurement export --------------------------------------------------------
  {
    const artifactId = "art_golden-tshirt-private-body-profile";
    const revisionId = "rev_golden-tshirt-private-body-profile-r1";
    const value = (definitionId, v) => ({
      definitionId,
      value: v,
      unit: "mm",
      method: "manual",
      source: { kind: "professional", description: "Synthetic value standing in for a personal measurement (negative test data)." },
      measuredAt: "2026-01-01T00:00:00Z",
      uncertainty: { type: "symmetric", plusMinus: 5 },
    });
    const profile = {
      documentType: "d2p:body-measurement-profile",
      schemaVersion: SCHEMA_VERSION,
      artifactId,
      revisionId,
      subject: { kind: "individual", pseudonym: "subject-0001" },
      dataClassification: "sensitive-personal",
      definitionRegistries: [REGISTRY],
      measurements: [value("d2p:body.chest-girth", 935), value("d2p:body.waist-girth", 812)],
    };
    const artifact = {
      documentType: "d2p:artifact",
      schemaVersion: SCHEMA_VERSION,
      artifactId,
      artifactType: "d2p:body-measurement-profile",
      name: "Individual body measurement profile (negative test data)",
      dataClassification: "sensitive-personal",
      createdAt: "2026-01-01T00:00:00Z",
      createdBy: ACTOR,
    };
    const scene = doc(`expected/export/scene-${caseA}.json`);
    scene.source.inputRefs = [{ artifactId, revisionId }];
    scene.resultDigest = digests.result(scene, "sceneId");
    negative("private-measurement-export", {
      level: "semantic",
      title: "Golden T-Shirt: export scene references a sensitive personal profile",
      description: "The export scene names an individual body measurement profile classified sensitive-personal in source.inputRefs. Profile and artifact metadata are consistent (no D2P-SEM-051); the export itself is the defect.",
      subjects: { "export-scene-2d.json": scene, "body-measurement-profile.json": profile, "artifact.json": artifact },
      context: [...baseContext(), repo(`expected/evaluations/${caseA}.json`), repo(`expected/snapshots/${caseA}.json`)],
      outcome: "reject",
      codes: [["D2P-SEM-050", "export-scene-2d.json"]],
    });
  }

}
