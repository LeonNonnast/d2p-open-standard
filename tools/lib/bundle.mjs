// Case bundles (catalog §2.1, §2.5): loading, manifest expansion and the
// lookup index used by the referential and semantic levels.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseStrictJsonBytes } from "./json.mjs";
import {
  ARTIFACT_CONTENT_TYPES,
  DERIVED_ID_MEMBER,
  documentUnits,
  isObject,
  PERSONAL_CLASSIFICATIONS,
  refKey,
  versionedKey,
} from "./model.mjs";

/**
 * Loads the documents of a case. Documents listed by the case that cannot be
 * read are case errors (the case is broken, not the implementation).
 * Manifest documents are expanded unless the level is structural: their
 * `input` and `expected` files and their external files join the bundle as
 * subjects; `negative` files never do.
 *
 * @param {string} root absolute repository root
 * @param {{documents: {path: string, role: string}[]}} testCase
 * @param {string} level
 * @returns {Promise<{docs: object[], caseErrors: string[]}>}
 */
export async function loadBundle(root, testCase, level) {
  const docs = [];
  const caseErrors = [];
  const seen = new Set();
  for (const entry of testCase.documents) {
    if (seen.has(entry.path)) {
      caseErrors.push(`document ${entry.path} is listed more than once`);
      continue;
    }
    seen.add(entry.path);
    const loaded = await loadDocument(root, entry.path, entry.role);
    if (loaded.missing) {
      caseErrors.push(`document ${entry.path} cannot be read: ${loaded.missing}`);
      continue;
    }
    docs.push(loaded);
  }
  if (level !== "structural") {
    for (const manifest of docs.filter((d) => d.role === "manifest" && isObject(d.value))) {
      const dir = path.posix.dirname(manifest.path);
      const listed = [
        ...(Array.isArray(manifest.value.files) ? manifest.value.files : [])
          .filter((f) => isObject(f) && (f.role === "input" || f.role === "expected") && typeof f.path === "string")
          .map((f) => path.posix.join(dir, f.path)),
        ...(Array.isArray(manifest.value.externalFiles) ? manifest.value.externalFiles : [])
          .filter((f) => isObject(f) && typeof f.path === "string")
          .map((f) => f.path),
      ];
      for (const p of listed) {
        if (seen.has(p) || !p.endsWith(".json")) continue;
        const loaded = await loadDocument(root, p, "subject");
        // A missing listed file is a manifest-integrity finding (D2P-REF-012), not a case error.
        if (loaded.missing) continue;
        seen.add(p);
        loaded.fromManifest = manifest.path;
        docs.push(loaded);
      }
    }
  }
  return { docs, caseErrors };
}

async function loadDocument(root, relPath, role) {
  const abs = path.resolve(root, relPath);
  if (!abs.startsWith(path.resolve(root) + path.sep)) return { missing: "path leaves the repository" };
  let bytes;
  try {
    bytes = await readFile(abs);
  } catch (err) {
    return { missing: err.code ?? err.message };
  }
  const parsed = parseStrictJsonBytes(bytes);
  return parsed.ok ? { path: relPath, role, value: parsed.value } : { path: relPath, role, parseError: parsed.error };
}

/** Vocabulary document types identified by (profileId, version). */
const PROFILE_VOCABULARY_TYPES = new Set([
  "d2p:validation-profile",
  "d2p:tolerance-profile",
  "d2p:mesh-profile",
  "d2p:avatar-profile",
  "d2p:solver-profile",
  "d2p:material-physics-profile",
]);

/**
 * Lookup index over the documents of a bundle. Only top-level documents are
 * resolution targets; embedded documents are checked but never resolved to.
 */
export class BundleIndex {
  constructor(docs) {
    this.docs = docs.filter((d) => isObject(d.value));
    this.units = documentUnits(this.docs);
    this.content = new Map(); // refKey -> unit
    this.artifactIds = new Set();
    this.revisions = new Map(); // refKey -> unit
    this.revisionById = new Map(); // revisionId -> unit
    this.children = new Map(); // revisionId -> [revision unit]
    this.artifactMeta = new Map(); // artifactId -> unit
    this.derived = new Map(); // documentType|id -> unit
    this.derivedById = new Map(); // id -> [unit]
    this.vocab = new Map(); // documentType|id@version -> unit
    this.manifests = [];
    for (const u of this.units) {
      if (u.embedded) continue;
      const v = u.value;
      const t = v.documentType;
      if (ARTIFACT_CONTENT_TYPES.has(t)) {
        this.content.set(refKey(v), u);
        this.artifactIds.add(v.artifactId);
      } else if (t === "d2p:revision") {
        this.revisions.set(refKey(v), u);
        this.revisionById.set(v.revisionId, u);
        this.artifactIds.add(v.artifactId);
        for (const parent of v.parentRevisionIds ?? []) {
          const list = this.children.get(parent) ?? [];
          list.push(u);
          this.children.set(parent, list);
        }
      } else if (t === "d2p:artifact") {
        this.artifactMeta.set(v.artifactId, u);
        this.artifactIds.add(v.artifactId);
      } else if (t === "d2p:measurement-definition-registry") {
        this.vocab.set(`${t}|${versionedKey(v.registryId, v.version)}`, u);
      } else if (t === "d2p:validation-rule-definition") {
        this.vocab.set(`${t}|${versionedKey(v.ruleId, v.version)}`, u);
      } else if (PROFILE_VOCABULARY_TYPES.has(t)) {
        this.vocab.set(`${t}|${versionedKey(v.profileId, v.version)}`, u);
      } else if (t === "d2p:fixture-manifest") {
        this.manifests.push(u);
      }
      const idMember = DERIVED_ID_MEMBER[t];
      if (idMember && typeof v[idMember] === "string") {
        this.derived.set(`${t}|${v[idMember]}`, u);
        const list = this.derivedById.get(v[idMember]) ?? [];
        list.push(u);
        this.derivedById.set(v[idMember], list);
      }
    }
  }

  /** Resolves an artifactRef: `{ state: "content" | "revision" | "no-artifact" | "no-revision", unit? }`. */
  resolveArtifactRef(ref) {
    const key = refKey(ref);
    if (this.content.has(key)) return { state: "content", unit: this.content.get(key) };
    if (this.revisions.has(key)) return { state: "revision", unit: this.revisions.get(key) };
    return { state: this.artifactIds.has(ref.artifactId) ? "no-revision" : "no-artifact" };
  }

  /** Content document pinned by an artifactRef, or undefined. */
  contentOf(ref) {
    return ref ? this.content.get(refKey(ref))?.value : undefined;
  }

  /** Derived document by type and own ID. */
  derivedDoc(documentType, id) {
    return this.derived.get(`${documentType}|${id}`);
  }

  vocabDoc(documentType, id, version) {
    return this.vocab.get(`${documentType}|${versionedKey(id, version)}`);
  }

  /** Every measurement definition visible through a document's definitionRegistries. */
  definitionsOf(doc) {
    const defs = new Map();
    for (const r of doc?.definitionRegistries ?? []) {
      const reg = this.vocabDoc("d2p:measurement-definition-registry", r.id, r.version)?.value;
      for (const d of reg?.definitions ?? []) if (!defs.has(d.definitionId)) defs.set(d.definitionId, d);
    }
    return defs;
  }

  /** True when every registry declared by the document is in the bundle. */
  registriesPresent(doc) {
    return (doc?.definitionRegistries ?? []).every((r) => this.vocabDoc("d2p:measurement-definition-registry", r.id, r.version));
  }

  /** Data classifications known for an artifact (metadata and content). */
  classificationsOf(artifactId) {
    const out = new Set();
    const meta = this.artifactMeta.get(artifactId)?.value;
    if (meta?.dataClassification) out.add(meta.dataClassification);
    for (const u of this.content.values()) {
      if (u.value.artifactId === artifactId && typeof u.value.dataClassification === "string") out.add(u.value.dataClassification);
    }
    return out;
  }

  isPersonal(artifactId) {
    for (const c of this.classificationsOf(artifactId)) if (PERSONAL_CLASSIFICATIONS.has(c)) return true;
    return false;
  }
}
