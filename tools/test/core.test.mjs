import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalize, digestOf, drapedMeshDigestOf, quantize, scaledInteger, sceneDigestOf } from "../lib/c14n.mjs";
import { compareSemver, diagnostic, isCompatibleVersion, levelOfCode, sortDiagnostics } from "../lib/diagnostics.mjs";
import { parseStrictJson, parseStrictJsonBytes } from "../lib/json.mjs";
import { DERIVED_ID_MEMBER, OWN_ID_MEMBERS } from "../lib/model.mjs";
import { loadSchemaSet } from "../lib/schemas.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("d2p-c14n-v1 / d2p-digest-v1", () => {
  // Test vectors of the schema catalog, section 1.8.
  const vectors = [
    ['{"b":[1.0000000004,2.0000000005,-0.0],"a":"x"}', '{"a":"x","b":[1,2,0]}', "sha256:e6636f36dab7c2a4bb2d6dd5b9784027f39dab43dd872092166fea5a73967c56"],
    [
      '{"y":0.30000000000000004,"x":123.4567891235,"z":1e-10,"w":-2.5e-9}',
      '{"w":-2e-9,"x":123.456789124,"y":0.3,"z":0}',
      "sha256:3b8f1b665dfb9410c85014bd59056fae1e93559b102e6992d0337749b69a9895",
    ],
    ['{"units":{"length":"mm","angle":"rad"},"pieces":[]}', '{"pieces":[],"units":{"angle":"rad","length":"mm"}}', "sha256:096f11b5acef4032a893ccf25a958086a21cf14b8236d935fbba814a7c01cc0f"],
  ];
  for (const [input, canonical, digest] of vectors) {
    it(`matches the catalog vector ${canonical}`, () => {
      const value = JSON.parse(input);
      assert.equal(canonicalize(value), canonical);
      assert.equal(digestOf(value), digest);
    });
  }

  it("rounds half to even at 9 fractional digits and maps -0 to 0", () => {
    assert.equal(quantize(0.0000000005), 0);
    assert.equal(quantize(0.0000000015), 0.000000002);
    assert.equal(quantize(-0.0000000025), -0.000000002);
    assert.equal(Object.is(quantize(-0), 0), true);
    assert.equal(quantize(1e21), 1e21);
    assert.equal(quantize(123.456), 123.456);
  });

  it("gives exact scaled integers for geometric predicates", () => {
    assert.equal(scaledInteger(1.5), 1500000000n);
    assert.equal(scaledInteger(-0.000000001), -1n);
    assert.equal(scaledInteger(0.1 + 0.2), 300000000n);
  });

  it("excludes top-level members only", () => {
    assert.equal(digestOf({ a: 1, contentDigest: "x" }, ["contentDigest"]), digestOf({ a: 1 }));
    assert.notEqual(digestOf({ a: { contentDigest: "x" } }, ["contentDigest"]), digestOf({ a: {} }));
  });

  it("adds the drape members to sceneDigest only when present (draft 0.3.0)", () => {
    const scene = { coordinateSystem: {}, sceneUnit: "m", unitConversion: {}, panelBindings: [], seamBindings: [], controlMeasures: [], meshRefs: [] };
    assert.equal(sceneDigestOf(scene), digestOf(scene));
    const drape = { ...scene, bodyModelRef: { id: "bms_x" }, drapedMeshRefs: [], mode: "physical-simulation" };
    assert.equal(sceneDigestOf(drape), digestOf({ ...scene, bodyModelRef: { id: "bms_x" }, drapedMeshRefs: [] }));
    assert.equal(drapedMeshDigestOf({ positionsM: [[0, 1, 2]], meshDigest: "x" }), digestOf({ positionsM: [[0, 1, 2]] }));
  });

  it("sorts members by UTF-16 code units", () => {
    assert.equal(canonicalize({ "é": 1, z: 2, "😀": 3 }), '{"z":2,"é":1,"😀":3}');
  });
});

describe("strict JSON", () => {
  it("parses like JSON.parse", () => {
    const text = '{"a":[1,2.5,-3e2,true,false,null,"x\\u00e9\\n"],"b":{}}';
    assert.deepEqual(parseStrictJson(text), { ok: true, value: JSON.parse(text) });
  });

  it("rejects duplicate member names, trailing content and malformed input", () => {
    assert.match(parseStrictJson('{"a":1,"b":{"c":1,"c":2}}').error, /duplicate member name "c" at \/b/);
    assert.equal(parseStrictJson("{} x").ok, false);
    assert.equal(parseStrictJson("{'a':1}").ok, false);
    assert.equal(parseStrictJson("[1,]").ok, false);
    assert.equal(parseStrictJson("01").ok, false);
  });

  it("rejects invalid UTF-8 and a byte order mark", () => {
    assert.match(parseStrictJsonBytes(Uint8Array.from([0x22, 0xff, 0x22])).error, /UTF-8/);
    assert.match(parseStrictJsonBytes(new TextEncoder().encode("﻿{}")).error, /byte order mark/);
  });

  it("keeps __proto__ as an ordinary member", () => {
    const { value } = parseStrictJson('{"__proto__":{"x":1}}');
    assert.deepEqual(Object.keys(value), ["__proto__"]);
    assert.equal(Object.getPrototypeOf(value), Object.prototype);
  });
});

describe("version gate and diagnostics", () => {
  it("accepts only the same major version that is not newer than 1.0.0", () => {
    assert.equal(isCompatibleVersion("1.0.0"), true);
    assert.equal(isCompatibleVersion("1.0.1"), false);
    assert.equal(isCompatibleVersion("1.1.0"), false);
    assert.equal(isCompatibleVersion("2.0.0"), false);
    assert.equal(isCompatibleVersion("0.9.0"), false);
    assert.equal(isCompatibleVersion("1.0.0-rc.1"), false);
    assert.equal(isCompatibleVersion("1.0.0-rc.1", "1.0.0-rc.1"), true);
    assert.equal(isCompatibleVersion("1.0"), false);
    assert.equal(isCompatibleVersion(1), false);
    assert.equal(isCompatibleVersion("1.0.0", "1.2.0"), true);
  });

  it("orders SemVer by precedence", () => {
    assert.ok(compareSemver("1.0.0-alpha", "1.0.0") < 0);
    assert.ok(compareSemver("1.0.0-alpha.2", "1.0.0-alpha.10") < 0);
    assert.ok(compareSemver("1.0.0-alpha.1", "1.0.0-alpha.beta") < 0);
    assert.ok(compareSemver("1.10.0", "1.9.0") > 0);
    assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
  });

  it("builds diagnostics with registry severities and sorts them", () => {
    assert.equal(diagnostic("D2P-SEM-050", "x").severity, "critical");
    assert.equal(diagnostic("D2P-SEM-004", "x").severity, "warning");
    assert.throws(() => diagnostic("D2P-SEM-999", "x"), /not in the registry/);
    assert.equal(levelOfCode("D2P-REF-001"), "referential");
    assert.equal(levelOfCode("D2P-EVL-001"), "evaluator");
    const sorted = sortDiagnostics([diagnostic("D2P-SEM-010", "b"), diagnostic("D2P-REF-001", "a"), diagnostic("D2P-SEM-010", "a", { documentPath: "a" })]);
    assert.deepEqual(sorted.map((d) => `${d.code}|${d.documentPath ?? ""}`), ["D2P-REF-001|", "D2P-SEM-010|", "D2P-SEM-010|a"]);
  });

  it("registers the draft 0.3.0 codes as errors", () => {
    for (const code of ["D2P-SEM-052", "D2P-SEM-076", "D2P-SEM-127", "D2P-SEM-128", "D2P-SEM-129", "D2P-SEM-130", "D2P-SEM-131"]) {
      assert.equal(diagnostic(code, "x").severity, "error", code);
    }
  });
});

describe("document model", () => {
  it("knows the own ID of every document type a schema declares", async () => {
    const schemas = await loadSchemaSet(REPO_ROOT);
    const missing = [...schemas.byDocumentType.keys()].filter((t) => !(t in OWN_ID_MEMBERS));
    assert.deepEqual(missing, []);
    for (const [type, member] of Object.entries(DERIVED_ID_MEMBER)) assert.deepEqual(OWN_ID_MEMBERS[type], [member], type);
  });
});
