// Construction command 'd2p:pattern.edit' (catalog §3.6, draft 0.3.0): applying
// the operations to the content of the expected revision, and the content a
// parameter update yields. Both are kernel-free and deterministic, so the
// referential level can check the operation keys and the semantic level the
// committed result (D2P-SEM-131).
import { isObject } from "./model.mjs";

/** Key member of each editable pattern collection. */
export const EDIT_COLLECTION_KEYS = Object.freeze({
  parameters: "id",
  measurementInputs: "key",
  features: "id",
  pieces: "id",
  seamInterfaces: "id",
  seamConnections: "id",
  sewingGroups: "id",
  featureCapabilities: "featureType",
  definitionRegistries: "id",
});

/**
 * Applies the operations of a 'd2p:pattern.edit' payload to a pattern content
 * document. Returns the edited content (a new object; `base` is untouched) and
 * the problems found on the way: `{ code, op, message }` with D2P-REF-005 for
 * an add of an existing key and D2P-REF-003 for a replace or remove of a
 * missing key. A failed operation is skipped; the following ones still apply.
 * An operation acts on the first element with its key in array order (a
 * pattern may pin several versions of one definition registry; catalog §3.6).
 */
export function applyPatternEdit(base, operations) {
  const out = structuredClone(base);
  const problems = [];
  (Array.isArray(operations) ? operations : []).forEach((o, i) => {
    if (!isObject(o)) return;
    if (o.op === "set-name") {
      out.name = o.name;
      return;
    }
    const keyMember = EDIT_COLLECTION_KEYS[o.collection];
    if (!keyMember) return;
    if (!Array.isArray(out[o.collection])) out[o.collection] = [];
    const list = out[o.collection];
    const key = o.op === "remove" ? o.key : o.element?.[keyMember];
    const at = list.findIndex((x) => isObject(x) && x[keyMember] === key);
    if (o.op === "add") {
      if (at >= 0) problems.push({ code: "D2P-REF-005", op: i, message: `${o.collection} already contains "${key}"` });
      else list.push(structuredClone(o.element));
    } else if (o.op === "replace" || o.op === "remove") {
      if (at < 0) problems.push({ code: "D2P-REF-003", op: i, message: `${o.collection} contains no "${key}" to ${o.op}` });
      else if (o.op === "replace") list[at] = structuredClone(o.element);
      else list.splice(at, 1);
    }
  });
  return { content: out, problems };
}

/** Applies the updates of a 'd2p:pattern.parameters.update' payload (new expressions of existing parameters). */
export function applyParameterUpdates(base, updates) {
  const out = structuredClone(base);
  const problems = [];
  (Array.isArray(updates) ? updates : []).forEach((u, i) => {
    const p = (out.parameters ?? []).find((x) => isObject(x) && x.id === u?.parameterId);
    if (!p) problems.push({ code: "D2P-REF-003", op: i, message: `parameter "${u?.parameterId}" does not exist` });
    else p.expr = structuredClone(u.expr);
  });
  return { content: out, problems };
}

/**
 * The content a pattern command yields from its base, with the header of the
 * committed revision, or null when the command type has no standard result.
 */
export function expectedCommandContent(command, base, revisionId) {
  let result;
  if (command.type === "d2p:pattern.edit") result = applyPatternEdit(base, command.payload?.operations).content;
  else if (command.type === "d2p:pattern.parameters.update") result = applyParameterUpdates(base, command.payload?.updates).content;
  else return null;
  result.revisionId = revisionId;
  delete result.contentDigest;
  return result;
}
