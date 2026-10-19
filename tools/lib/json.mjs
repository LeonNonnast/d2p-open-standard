// Strict JSON parsing for conformance runs (catalog §1.8 step 1, D2P-STR-004).
//
// JSON.parse silently keeps the last of several equal member names and
// replaces invalid UTF-8 with U+FFFD. A conformance runner must reject both,
// so documents are parsed here with a small recursive-descent parser that
// produces exactly the values JSON.parse would produce otherwise.

// ignoreBOM keeps a leading U+FEFF in the output so it can be rejected below.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * Parses raw bytes as strict JSON.
 *
 * @param {Uint8Array} bytes
 * @returns {{ ok: true, value: unknown } | { ok: false, error: string }}
 */
export function parseStrictJsonBytes(bytes) {
  let text;
  try {
    text = decoder.decode(bytes);
  } catch {
    return { ok: false, error: "not valid UTF-8" };
  }
  if (text.charCodeAt(0) === 0xfeff) return { ok: false, error: "byte order mark is not allowed" };
  return parseStrictJson(text);
}

/**
 * Parses a string as strict JSON (duplicate member names are an error).
 *
 * @param {string} text
 * @returns {{ ok: true, value: unknown } | { ok: false, error: string }}
 */
export function parseStrictJson(text) {
  const parser = new Parser(text);
  try {
    parser.skipWs();
    const value = parser.parseValue("");
    parser.skipWs();
    if (parser.pos !== text.length) parser.fail("unexpected trailing content");
    return { ok: true, value };
  } catch (err) {
    if (err instanceof JsonError) return { ok: false, error: err.message };
    throw err;
  }
}

class JsonError extends Error {}

const NUMBER_RE = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const STRING_RE = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;

class Parser {
  constructor(text) {
    this.text = text;
    this.pos = 0;
  }

  fail(message) {
    throw new JsonError(`invalid JSON at offset ${this.pos}: ${message}`);
  }

  skipWs() {
    const t = this.text;
    while (this.pos < t.length) {
      const c = t.charCodeAt(this.pos);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) this.pos += 1;
      else break;
    }
  }

  parseValue(pointer) {
    const c = this.text[this.pos];
    if (c === "{") return this.parseObject(pointer);
    if (c === "[") return this.parseArray(pointer);
    if (c === '"') return this.parseString();
    if (c === "t") return this.literal("true", true);
    if (c === "f") return this.literal("false", false);
    if (c === "n") return this.literal("null", null);
    return this.parseNumber();
  }

  literal(word, value) {
    if (this.text.startsWith(word, this.pos)) {
      this.pos += word.length;
      return value;
    }
    return this.fail("unexpected token");
  }

  parseNumber() {
    NUMBER_RE.lastIndex = this.pos;
    const m = NUMBER_RE.exec(this.text);
    if (!m) this.fail("unexpected token");
    this.pos += m[0].length;
    const n = Number(m[0]);
    if (!Number.isFinite(n)) this.fail("number is not finite in binary64");
    return n;
  }

  parseString() {
    STRING_RE.lastIndex = this.pos;
    const m = STRING_RE.exec(this.text);
    if (!m) this.fail("malformed string");
    this.pos += m[0].length;
    return JSON.parse(m[0]);
  }

  parseArray(pointer) {
    this.pos += 1;
    const out = [];
    this.skipWs();
    if (this.text[this.pos] === "]") {
      this.pos += 1;
      return out;
    }
    for (;;) {
      this.skipWs();
      out.push(this.parseValue(`${pointer}/${out.length}`));
      this.skipWs();
      const c = this.text[this.pos];
      if (c === ",") this.pos += 1;
      else if (c === "]") {
        this.pos += 1;
        return out;
      } else this.fail("expected ',' or ']'");
    }
  }

  parseObject(pointer) {
    this.pos += 1;
    const out = {};
    const seen = new Set();
    this.skipWs();
    if (this.text[this.pos] === "}") {
      this.pos += 1;
      return out;
    }
    for (;;) {
      this.skipWs();
      if (this.text[this.pos] !== '"') this.fail("expected member name");
      const key = this.parseString();
      if (seen.has(key)) {
        throw new JsonError(`duplicate member name ${JSON.stringify(key)} at ${pointer === "" ? "(root)" : pointer}`);
      }
      seen.add(key);
      this.skipWs();
      if (this.text[this.pos] !== ":") this.fail("expected ':'");
      this.pos += 1;
      this.skipWs();
      const value = this.parseValue(`${pointer}/${escapePointerToken(key)}`);
      // defineProperty keeps "__proto__" an ordinary own member, as JSON.parse does.
      Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
      this.skipWs();
      const c = this.text[this.pos];
      if (c === ",") this.pos += 1;
      else if (c === "}") {
        this.pos += 1;
        return out;
      } else this.fail("expected ',' or '}'");
    }
  }
}

/** Escapes one JSON Pointer reference token (RFC 6901). */
export function escapePointerToken(token) {
  return String(token).replaceAll("~", "~0").replaceAll("/", "~1");
}

/** Builds a JSON Pointer from a base pointer and further tokens. */
export function pointer(base, ...tokens) {
  return base + tokens.map((t) => `/${escapePointerToken(t)}`).join("");
}
