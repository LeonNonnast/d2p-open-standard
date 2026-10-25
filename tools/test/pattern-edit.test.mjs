// Unit tests of the construction command 'd2p:pattern.edit' (catalog §3.6,
// draft 0.3.0): applying operations, applying parameter updates, the content
// a command yields, and the checks that use them (D2P-REF-003, D2P-REF-005,
// D2P-SEM-131) on small in-memory bundles.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { BundleIndex } from "../lib/bundle.mjs";
import { contentDigestOf } from "../lib/c14n.mjs";
import { applyParameterUpdates, applyPatternEdit, expectedCommandContent } from "../lib/pattern-edit.mjs";
import { checkReferential } from "../lib/referential.mjs";
import { checkSemantic } from "../lib/semantic.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = JSON.parse(await readFile(path.join(REPO_ROOT, "conformance/semantic/valid-pattern/pattern.json"), "utf8"));
const R2 = "rev_conformance-square-r2";
const literal = (value) => ({ op: "literal", value, unit: "mm" });
const parameter = (id, value) => ({ id, dimension: "length", expr: literal(value) });

const command = (type, payload) => ({
  documentType: "d2p:command", schemaVersion: "1.0.0", commandId: "cmd_t-edit", idempotencyKey: "t-edit", type,
  target: { artifactId: BASE.artifactId, branch: "main" }, expectedRevisionId: BASE.revisionId, payload,
  actorContext: { actorPrincipalId: "prn_t" }, correlationId: "cor_t", issuedAt: "2026-01-03T00:00:00Z",
});
const revision = (content, revisionId, parents, sequence, commandId) => ({
  documentType: "d2p:revision", schemaVersion: "1.0.0", artifactId: BASE.artifactId, revisionId, parentRevisionIds: parents, sequence,
  ...(commandId ? { commandId } : {}), contentDigest: contentDigestOf(content), createdAt: "2026-01-03T00:00:00Z",
});
const docs = (list) => new BundleIndex(list.map(([name, value]) => ({ path: `${name}.json`, role: "subject", value })));
const codes = (diagnostics, prefix) => diagnostics.filter((d) => d.code.startsWith(prefix)).map((d) => `${d.code} ${d.documentPath}#${d.instancePath ?? ""}`).sort();

describe("applyPatternEdit", () => {
  it("appends, replaces in place, removes and renames in order", () => {
    const { content, problems } = applyPatternEdit(BASE, [
      { op: "add", collection: "parameters", element: parameter("pocket-width", 140) },
      { op: "replace", collection: "parameters", element: parameter("front-width", 500) },
      { op: "remove", collection: "parameters", key: "back-width" },
      { op: "add", collection: "measurementInputs", element: { key: "chest", definitionId: "d2p:body.chest-girth", required: true } },
      { op: "set-name", name: "Edited" },
    ]);
    assert.deepEqual(problems, []);
    assert.deepEqual(content.parameters.map((p) => p.id), ["front-width", "body-height", "sleeve-width", "sleeve-height", "pocket-width"]);
    assert.deepEqual(content.parameters[0].expr, literal(500));
    assert.deepEqual(content.measurementInputs.map((m) => m.key), ["chest"]);
    assert.equal(content.name, "Edited");
    assert.equal(BASE.name, "Conformance kit base pattern (synthetic)", "the base stays untouched");
  });

  it("reports an add of an existing key and a replace or remove of a missing one, and skips them", () => {
    const { content, problems } = applyPatternEdit(BASE, [
      { op: "add", collection: "parameters", element: parameter("front-width", 1) },
      { op: "remove", collection: "parameters", key: "front-width" },
      { op: "remove", collection: "parameters", key: "front-width" },
      { op: "replace", collection: "pieces", element: { id: "pocket" } },
    ]);
    assert.deepEqual(problems.map((p) => [p.code, p.op]), [["D2P-REF-005", 0], ["D2P-REF-003", 2], ["D2P-REF-003", 3]]);
    assert.ok(!content.parameters.some((p) => p.id === "front-width"));
  });

  it("keys feature capabilities by featureType and definition registries by id", () => {
    const cap = { featureType: "org.example:pleat", minEvaluatorVersion: "1.0.0", fallback: "read-only" };
    const { content, problems } = applyPatternEdit(BASE, [
      { op: "add", collection: "featureCapabilities", element: cap },
      { op: "add", collection: "definitionRegistries", element: { id: "d2p:measurement-definitions", version: "1.1.0" } },
      { op: "add", collection: "featureCapabilities", element: cap },
      { op: "remove", collection: "definitionRegistries", key: "d2p:measurement-definitions" },
    ]);
    assert.deepEqual(problems.map((p) => [p.code, p.op]), [["D2P-REF-005", 2]]);
    assert.deepEqual(content.definitionRegistries, []);
  });

  it("acts on the first of several versions of one registry and upgrades by replace", () => {
    const v = (version) => ({ id: "d2p:measurement-definitions", version });
    const base = { ...BASE, definitionRegistries: [v("1.0.0"), v("1.1.0")] };
    const removed = applyPatternEdit(base, [{ op: "remove", collection: "definitionRegistries", key: "d2p:measurement-definitions" }]);
    assert.deepEqual(removed.content.definitionRegistries, [v("1.1.0")]);
    const upgraded = applyPatternEdit({ ...BASE, definitionRegistries: [v("1.0.0")] }, [
      { op: "add", collection: "definitionRegistries", element: v("1.1.0") },
      { op: "replace", collection: "definitionRegistries", element: v("1.1.0") },
    ]);
    assert.deepEqual(upgraded.problems.map((p) => [p.code, p.op]), [["D2P-REF-005", 0]]);
    assert.deepEqual(upgraded.content.definitionRegistries, [v("1.1.0")]);
  });
});

describe("expectedCommandContent", () => {
  it("applies parameter updates and sets the new revisionId without contentDigest", () => {
    const { problems } = applyParameterUpdates(BASE, [{ parameterId: "nope", expr: literal(1) }]);
    assert.deepEqual(problems.map((p) => p.code), ["D2P-REF-003"]);
    const cmd = command("d2p:pattern.parameters.update", { updates: [{ parameterId: "front-width", expr: literal(510) }] });
    const result = expectedCommandContent(cmd, { ...BASE, contentDigest: "sha256:x" }, R2);
    assert.equal(result.revisionId, R2);
    assert.equal(result.contentDigest, undefined);
    assert.deepEqual(result.parameters[0].expr, literal(510));
    assert.equal(expectedCommandContent(command("d2p:artifact.archive", {}), BASE, R2), null);
  });
});

describe("pattern.edit checks", () => {
  const edit = command("d2p:pattern.edit", { operations: [
    { op: "add", collection: "parameters", element: parameter("pocket-width", 140) },
    { op: "add", collection: "parameters", element: parameter("pocket-width", 150) },
    { op: "remove", collection: "parameters", key: "missing" },
  ] });

  it("checks operation keys against the base content in order (D2P-REF-005, D2P-REF-003)", async () => {
    const out = await checkReferential(docs([["command", edit], ["base", BASE], ["rev1", revision(BASE, BASE.revisionId, [], 1)]]), { root: REPO_ROOT });
    assert.deepEqual(codes(out, "D2P-REF"), ["D2P-REF-003 command.json#/payload/operations/2", "D2P-REF-005 command.json#/payload/operations/1"]);
    assert.deepEqual(await checkReferential(docs([["command", edit]]), { root: REPO_ROOT }), [], "not applicable without the base content");
    const addThenReplace = command("d2p:pattern.edit", { operations: [
      { op: "add", collection: "parameters", element: parameter("pocket-width", 140) },
      { op: "replace", collection: "parameters", element: parameter("pocket-width", 150) },
    ] });
    const accepted = await checkReferential(docs([["command", addThenReplace], ["base", BASE], ["rev1", revision(BASE, BASE.revisionId, [], 1)]]), { root: REPO_ROOT });
    assert.deepEqual(codes(accepted, "D2P-REF"), [], "operation elements are not element IDs of the command");
    // Within one operation's element, element IDs are unique as in any document.
    const piece = structuredClone(BASE.pieces[0]);
    Object.assign(piece, { id: "pocket", name: "Pocket" });
    piece.contours[0].id = "pocket-outer";
    piece.contours[0].edges.forEach((e, i) => { e.id = i < 2 ? "pocket-edge" : `pocket-edge-${i}`; });
    piece.grainlines[0].id = "pocket-grainline";
    const twice = command("d2p:pattern.edit", { operations: [{ op: "add", collection: "pieces", element: piece }] });
    const out2 = await checkReferential(docs([["command", twice]]), { root: REPO_ROOT });
    assert.deepEqual(codes(out2, "D2P-REF-005"), ["D2P-REF-005 command.json#/payload/operations/0/element/contours/0/edges/1/id"]);
  });

  it("compares the committed content with the applied operations (D2P-SEM-131)", () => {
    const ok = command("d2p:pattern.edit", { operations: [{ op: "add", collection: "parameters", element: parameter("pocket-width", 140) }, { op: "set-name", name: "With pocket" }] });
    const r2 = { ...expectedCommandContent(ok, BASE, R2) };
    r2.contentDigest = contentDigestOf(r2);
    const bundle = (content, cmd = ok) => docs([
      ["command", cmd], ["base", BASE], ["rev1", revision(BASE, BASE.revisionId, [], 1)], ["r2", content], ["rev2", revision(content, R2, [BASE.revisionId], 2, cmd.commandId)],
    ]);
    assert.deepEqual(codes(checkSemantic(bundle(r2)), "D2P-SEM-131"), []);
    const wrong = structuredClone(r2);
    wrong.parameters.at(-1).expr = literal(141);
    assert.deepEqual(codes(checkSemantic(bundle(wrong)), "D2P-SEM-131"), ["D2P-SEM-131 r2.json#"]);
    const update = command("d2p:pattern.parameters.update", { updates: [{ parameterId: "front-width", expr: literal(510) }] });
    assert.deepEqual(codes(checkSemantic(bundle(r2, update)), "D2P-SEM-131"), ["D2P-SEM-131 r2.json#"], "a parameter update is checked the same way");
  });
});
