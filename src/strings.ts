/**
 * Standalone `@string` macro expansion for BibTeX source text.
 *
 * This module is deliberately independent of {@link BibtexParser}: it operates
 * directly on raw BibTeX text so it can be used as a pre-processing step before
 * parsing (the core parser does not resolve macros itself).
 *
 * BibTeX / LaTeX permit several syntactic variations for `@string`, and every
 * one of them is supported here:
 *
 * ```
 * @string{ pub = "ACM Press" }            % quoted value, brace delimiters
 * @string( pub = {ACM Press} )            % braced value, PAREN delimiters
 * @STRING{ y2020 = 2020 }                 % numeric value, any @string casing
 * @string{ a = "A" # " and " # b }        % # concatenation + nested reference
 * @string{ x = "X", y = "Y" }             % multiple assignments per block
 * ```
 *
 * Definitions may reference earlier *and* later definitions (resolution is
 * order-independent, with cycles handled gracefully). References inside entry
 * field values are replaced with the resolved literal text.
 *
 * @module
 */

/** Options controlling {@link expandStrings}. */
export interface ExpandStringsOptions {
  /**
   * When `true` (default), `@string` definition blocks are removed from the
   * output once their values have been substituted. When `false`, they are
   * kept (with their own values fully resolved).
   */
  removeDefinitions?: boolean;
  /**
   * Extra macro definitions to seed the resolver with, e.g. values predefined
   * by a bibliography style. Keys are matched case-insensitively.
   */
  additionalStrings?: Record<string, string>;
  /**
   * When `true`, predefine the twelve standard month macros (`jan`..`dec`) to
   * their full English names. Defaults to `false` (months are left untouched
   * unless explicitly defined).
   */
  includeDefaultMonths?: boolean;
}

/** The twelve standard month macros, mapped to full English names. */
const DEFAULT_MONTHS: Readonly<Record<string, string>> = {
  jan: "January",
  feb: "February",
  mar: "March",
  apr: "April",
  may: "May",
  jun: "June",
  jul: "July",
  aug: "August",
  sep: "September",
  oct: "October",
  nov: "November",
  dec: "December",
};

/** A single piece of a (possibly `#`-concatenated) value. */
type Component =
  | { kind: "literal"; value: string }
  | { kind: "reference"; name: string };

/** A resolved chunk of output produced while scanning the source. */
type Part =
  | { kind: "raw"; text: string }
  | { kind: "value"; components: Component[] }
  | { kind: "stringdef"; assignments: Array<[string, Component[]]> };

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);
/** Characters that terminate a bare (unquoted, unbraced) value token. */
const VALUE_STOP = new Set([",", "#", "}", ")", "{", '"', "=", "%", " ", "\t", "\n", "\r"]);

/**
 * A small, tolerant scanner that walks BibTeX source, collecting `@string`
 * definitions and splitting the rest into raw text and expandable value slots.
 */
class StringScanner {
  private readonly input: string;
  private pos = 0;
  private readonly parts: Part[] = [];

  /** Raw (unresolved) definitions keyed by lower-cased macro name. */
  readonly definitions: Record<string, Component[]> = Object.create(null) as Record<
    string,
    Component[]
  >;

  constructor(input: string) {
    this.input = input;
  }

  /** Scan the whole input, returning the ordered output parts. */
  scan(): Part[] {
    while (this.pos < this.input.length) {
      // Copy verbatim up to the next real '@', treating '%' as a line comment
      // so that '@' inside a comment does not start a spurious block.
      const rawStart = this.pos;
      while (this.pos < this.input.length && this.input[this.pos] !== "@") {
        if (this.input[this.pos] === "%") {
          while (this.pos < this.input.length && this.input[this.pos] !== "\n") this.pos++;
        } else {
          this.pos++;
        }
      }
      this.pushRaw(this.input.substring(rawStart, this.pos));
      if (this.pos >= this.input.length) break;
      this.readBlock();
    }
    return this.parts;
  }

  // --- output helpers ----------------------------------------------------

  private pushRaw(text: string): void {
    if (text.length === 0) return;
    const last = this.parts[this.parts.length - 1];
    if (last && last.kind === "raw") {
      last.text += text;
    } else {
      this.parts.push({ kind: "raw", text });
    }
  }

  // --- character helpers -------------------------------------------------

  private isWhitespace(ch: string | undefined): boolean {
    return ch !== undefined && WHITESPACE.has(ch);
  }

  private skipWhitespace(): void {
    while (this.isWhitespace(this.input[this.pos])) this.pos++;
    if (this.input[this.pos] === "%") {
      while (this.pos < this.input.length && this.input[this.pos] !== "\n") this.pos++;
      this.skipWhitespace();
    }
  }

  // --- block reader ------------------------------------------------------

  private readBlock(): void {
    const blockStart = this.pos;
    this.pos++; // consume '@'

    const nameStart = this.pos;
    while (this.pos < this.input.length && /[A-Za-z]/.test(this.input[this.pos]!)) {
      this.pos++;
    }
    const name = this.input.substring(nameStart, this.pos);
    this.skipWhitespace();

    const open = this.input[this.pos];
    if (open !== "{" && open !== "(") {
      // Not a real block (e.g. a stray '@'); emit verbatim and move on.
      this.pushRaw(this.input.substring(blockStart, this.pos));
      return;
    }
    const close = open === "{" ? "}" : ")";
    const dir = name.toLowerCase();

    if (dir === "string") {
      this.readStringBlock(open, close);
    } else if (dir === "comment" || dir === "preamble") {
      this.pushRaw(this.input.substring(blockStart, this.pos));
      this.readVerbatimBlock(open, close);
    } else {
      this.readEntryBlock(blockStart, close);
    }
  }

  /** Read `@string{ name = value (, name = value)* }` (either delimiter). */
  private readStringBlock(_open: string, close: string): void {
    this.pos++; // consume opening delimiter
    const assignments: Array<[string, Component[]]> = [];

    while (true) {
      this.skipWhitespace();
      if (this.pos >= this.input.length || this.input[this.pos] === close) break;

      const nameStart = this.pos;
      while (
        this.pos < this.input.length &&
        !VALUE_STOP.has(this.input[this.pos]!) &&
        this.input[this.pos] !== close
      ) {
        this.pos++;
      }
      const name = this.input.substring(nameStart, this.pos).trim();
      this.skipWhitespace();
      if (this.input[this.pos] !== "=") break; // malformed; bail out of this block
      this.pos++; // consume '='

      const components = this.readValue(close);
      if (name.length > 0) {
        assignments.push([name, components]);
        this.definitions[name.toLowerCase()] = components;
      }

      this.skipWhitespace();
      if (this.input[this.pos] === ",") {
        this.pos++;
        continue;
      }
      break;
    }

    if (this.input[this.pos] === close) this.pos++;
    this.parts.push({ kind: "stringdef", assignments });
  }

  /** Copy a `@comment` / `@preamble` block through verbatim. */
  private readVerbatimBlock(open: string, close: string): void {
    const start = this.pos;
    this.pos++; // consume opening delimiter
    let depth = 1;
    while (this.pos < this.input.length && depth > 0) {
      const ch = this.input[this.pos];
      if (ch === open && open !== close) {
        depth++;
      } else if (ch === close) {
        depth--;
        if (depth === 0) {
          this.pos++;
          break;
        }
      } else if (ch === "{") {
        this.skipBraces();
        continue;
      } else if (ch === '"' && open !== '"') {
        this.skipQuotes();
        continue;
      }
      this.pos++;
    }
    this.pushRaw(this.input.substring(start, this.pos));
  }

  /**
   * Read a regular entry, preserving its skeleton (type, delimiters, citation
   * key, field names and layout) verbatim while turning each field *value*
   * into an expandable slot.
   */
  private readEntryBlock(blockStart: number, close: string): void {
    // Emit '@type{' (or '@type(') verbatim.
    this.pos++; // consume opening delimiter
    this.pushRaw(this.input.substring(blockStart, this.pos));

    // Citation key: everything up to the first comma (or the closing delimiter).
    const keyStart = this.pos;
    while (
      this.pos < this.input.length &&
      this.input[this.pos] !== "," &&
      this.input[this.pos] !== close
    ) {
      this.pos++;
    }
    this.pushRaw(this.input.substring(keyStart, this.pos));
    if (this.input[this.pos] === ",") {
      this.pushRaw(",");
      this.pos++;
    }

    // Fields.
    while (true) {
      const wsStart = this.pos;
      this.skipWhitespace();
      this.pushRaw(this.input.substring(wsStart, this.pos)); // preserve indentation/comments

      if (this.pos >= this.input.length || this.input[this.pos] === close) break;

      const fieldStart = this.pos;
      while (
        this.pos < this.input.length &&
        !VALUE_STOP.has(this.input[this.pos]!) &&
        this.input[this.pos] !== close
      ) {
        this.pos++;
      }
      this.skipWhitespace();
      if (this.input[this.pos] !== "=") {
        // Not a `name = value` pair; emit what we saw and stop to stay safe.
        this.pushRaw(this.input.substring(fieldStart, this.pos));
        break;
      }
      this.pos++; // consume '='
      this.pushRaw(this.input.substring(fieldStart, this.pos)); // `name =` verbatim

      const components = this.readValue(close);
      this.pushRaw(" ");
      this.parts.push({ kind: "value", components });

      const trailStart = this.pos;
      this.skipWhitespace();
      this.pushRaw(this.input.substring(trailStart, this.pos));
      if (this.input[this.pos] === ",") {
        this.pushRaw(",");
        this.pos++;
        continue;
      }
      break;
    }

    if (this.input[this.pos] === close) {
      this.pushRaw(close);
      this.pos++;
    }
  }

  // --- value readers -----------------------------------------------------

  private readValue(close: string): Component[] {
    const components: Component[] = [this.readSingleValue(close)];
    this.skipWhitespace();
    while (this.input[this.pos] === "#") {
      this.pos++; // consume '#'
      components.push(this.readSingleValue(close));
      this.skipWhitespace();
    }
    return components;
  }

  private readSingleValue(_close: string): Component {
    this.skipWhitespace();
    const ch = this.input[this.pos];
    if (ch === "{") {
      return { kind: "literal", value: this.readBraces() };
    }
    if (ch === '"') {
      return { kind: "literal", value: this.readQuotes() };
    }
    const start = this.pos;
    while (this.pos < this.input.length && !VALUE_STOP.has(this.input[this.pos]!)) {
      this.pos++;
    }
    const token = this.input.substring(start, this.pos);
    if (/^[0-9]+$/.test(token)) {
      return { kind: "literal", value: token };
    }
    return { kind: "reference", name: token };
  }

  /** Read a `{ ... }` group and return its inner text (delimiters stripped). */
  private readBraces(): string {
    this.pos++; // consume '{'
    const start = this.pos;
    let depth = 0;
    let escaped = false;
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (!escaped) {
        if (ch === "}") {
          if (depth === 0) {
            const inner = this.input.substring(start, this.pos);
            this.pos++; // consume '}'
            return inner;
          }
          depth--;
        } else if (ch === "{") {
          depth++;
        }
      }
      escaped = ch === "\\" && !escaped;
      this.pos++;
    }
    return this.input.substring(start); // unterminated: return what we have
  }

  /** Read a `" ... "` string and return its inner text (quotes stripped). */
  private readQuotes(): string {
    this.pos++; // consume opening quote
    const start = this.pos;
    let depth = 0;
    let escaped = false;
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (!escaped) {
        if (ch === '"' && depth === 0) {
          const inner = this.input.substring(start, this.pos);
          this.pos++; // consume closing quote
          return inner;
        } else if (ch === "{") {
          depth++;
        } else if (ch === "}" && depth > 0) {
          depth--;
        }
      }
      escaped = ch === "\\" && !escaped;
      this.pos++;
    }
    return this.input.substring(start); // unterminated: return what we have
  }

  /** Skip over a balanced `{ ... }` group (used inside verbatim blocks). */
  private skipBraces(): void {
    this.pos++; // consume '{'
    let depth = 1;
    let escaped = false;
    while (this.pos < this.input.length && depth > 0) {
      const ch = this.input[this.pos];
      if (!escaped) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
      escaped = ch === "\\" && !escaped;
      this.pos++;
    }
  }

  /** Skip over a `" ... "` string (used inside verbatim blocks). */
  private skipQuotes(): void {
    this.pos++; // consume opening quote
    let escaped = false;
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (!escaped && ch === '"') {
        this.pos++;
        return;
      }
      escaped = ch === "\\" && !escaped;
      this.pos++;
    }
  }
}

/** Result of resolving one or more components to literal text. */
interface Resolved {
  text: string;
  ok: boolean;
}

/** Build a resolver closure over a raw definition map. */
function makeResolver(
  definitions: Record<string, Component[]>,
): (components: readonly Component[]) => Resolved {
  const cache = new Map<string, Resolved>();

  function resolveName(name: string, stack: Set<string>): Resolved {
    const key = name.toLowerCase();
    const cached = cache.get(key);
    if (cached) return cached;
    const def = definitions[key];
    if (def === undefined || stack.has(key)) {
      return { text: name, ok: false }; // undefined or cyclic → leave as-is
    }
    stack.add(key);
    const result = resolveComponents(def, stack);
    stack.delete(key);
    if (result.ok) cache.set(key, result);
    return result;
  }

  function resolveComponents(components: readonly Component[], stack: Set<string>): Resolved {
    let text = "";
    let ok = true;
    for (const c of components) {
      if (c.kind === "literal") {
        text += c.value;
      } else {
        const r = resolveName(c.name, stack);
        text += r.text;
        if (!r.ok) ok = false;
      }
    }
    return { text, ok };
  }

  return (components) => resolveComponents(components, new Set<string>());
}

/**
 * Render a value's components to BibTeX source. Fully-resolved values collapse
 * to a single `{...}` literal; values containing an unresolved reference are
 * re-serialized as a `#`-concatenation so the reference is preserved.
 */
function serializeValue(
  components: readonly Component[],
  resolve: (components: readonly Component[]) => Resolved,
): string {
  const whole = resolve(components);
  if (whole.ok) {
    return `{${whole.text}}`;
  }
  return components
    .map((c) => {
      if (c.kind === "literal") return `{${c.value}}`;
      const r = resolve([c]);
      return r.ok ? `{${r.text}}` : c.name;
    })
    .join(" # ");
}

/**
 * Extract every `@string` definition from BibTeX source and return a map from
 * (lower-cased) macro name to its fully-resolved literal value.
 *
 * Chained/nested definitions are resolved transitively; unresolved or cyclic
 * definitions are omitted from the result.
 *
 * @example
 * getStringDefinitions('@string{a = "X"} @string{b = a # "Y"}')
 * // => { a: "X", b: "XY" }
 */
export function getStringDefinitions(
  bibtex: string,
  options: Pick<ExpandStringsOptions, "additionalStrings" | "includeDefaultMonths"> = {},
): Record<string, string> {
  const scanner = new StringScanner(bibtex);
  scanner.scan();
  const definitions = seedDefinitions(scanner.definitions, options);
  const resolve = makeResolver(definitions);

  const out: Record<string, string> = {};
  for (const key of Object.keys(definitions)) {
    const r = resolve([{ kind: "reference", name: key }]);
    if (r.ok) out[key] = r.text;
  }
  return out;
}

/** Merge user-seeded definitions with those scanned from the source. */
function seedDefinitions(
  scanned: Record<string, Component[]>,
  options: Pick<ExpandStringsOptions, "additionalStrings" | "includeDefaultMonths">,
): Record<string, Component[]> {
  const merged: Record<string, Component[]> = Object.create(null) as Record<
    string,
    Component[]
  >;
  if (options.includeDefaultMonths) {
    for (const [k, v] of Object.entries(DEFAULT_MONTHS)) {
      merged[k] = [{ kind: "literal", value: v }];
    }
  }
  if (options.additionalStrings) {
    for (const [k, v] of Object.entries(options.additionalStrings)) {
      merged[k.toLowerCase()] = [{ kind: "literal", value: v }];
    }
  }
  // Definitions found in the source take precedence over seeded ones.
  for (const [k, v] of Object.entries(scanned)) {
    merged[k] = v;
  }
  return merged;
}

/**
 * Expand (substitute) all `@string` macro references in BibTeX source text and
 * return the rewritten source.
 *
 * The entry skeleton — types, delimiters, citation keys, field names and
 * layout — is preserved; only field *values* are rewritten so that macro
 * references are replaced by their resolved literal text. By default the now
 * redundant `@string` definition blocks are stripped from the output.
 *
 * @param bibtex - The BibTeX source text.
 * @param options - Optional expansion configuration.
 *
 * @example
 * expandStrings('@string{pub = "ACM"}\n@article{k, publisher = pub}')
 * // => "@article{k, publisher = {ACM}}\n"
 */
export function expandStrings(bibtex: string, options: ExpandStringsOptions = {}): string {
  const removeDefinitions = options.removeDefinitions ?? true;

  const scanner = new StringScanner(bibtex);
  const parts = scanner.scan();
  const definitions = seedDefinitions(scanner.definitions, options);
  const resolve = makeResolver(definitions);

  let out = "";
  for (const part of parts) {
    switch (part.kind) {
      case "raw":
        out += part.text;
        break;
      case "value":
        out += serializeValue(part.components, resolve);
        break;
      case "stringdef":
        if (!removeDefinitions) {
          const body = part.assignments
            .map(([name, comps]) => `${name} = ${serializeValue(comps, resolve)}`)
            .join(", ");
          out += `@string{ ${body} }`;
        }
        break;
    }
  }

  // Collapse blank-line runs left behind by removed @string blocks.
  return out.replace(/[ \t]*\n[ \t]*\n[ \t]*(\n)+/g, "\n\n");
}
