import { BibtexParseError } from "./errors.ts";
import type {
  BibtexEntry,
  BibtexParserOptions,
  EntryTags,
  RegularEntry,
} from "./types.ts";

/**
 * The month macros BibTeX recognises as bare (unquoted, unbraced) values.
 * A bare value equal to one of these (case-insensitively) is accepted and
 * normalised to lower case.
 */
const MONTHS: readonly string[] = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

/**
 * Characters that terminate a key/identifier token. The original library only
 * listed a literal space; we also terminate on tab/newline/carriage-return so
 * that bare values followed by any whitespace (e.g. `year = 1997\n}`) parse
 * correctly.
 */
const NOT_KEY: readonly string[] = [",", "{", "}", " ", "=", "\t", "\n", "\r"];

/**
 * A recursive-descent parser for the BibTeX grammar:
 *
 * ```
 * bibtex          -> (string | preamble | comment | entry)*
 * string          -> '@STRING'   '{' key_equals_value '}'
 * preamble        -> '@PREAMBLE' '{' value '}'
 * comment         -> '@COMMENT'  '{' value '}'
 * entry           -> '@' key '{' key ',' key_value_list '}'
 * key_value_list  -> key_equals_value (',' key_equals_value)*
 * key_equals_value-> key '=' value
 * value           -> value_quotes | value_braces | key
 * ```
 *
 * The class is instantiated fresh for each parse via the {@link parse} helper,
 * so instances are single-use and never shared across inputs.
 */
export class BibtexParser {
  private readonly input: string;
  private readonly options: Required<BibtexParserOptions>;
  private pos = 0;
  private readonly entries: BibtexEntry[] = [];

  constructor(input: string, options: BibtexParserOptions = {}) {
    this.input = input;
    this.options = {
      deriveMissingCitationKey: options.deriveMissingCitationKey ?? true,
    };
  }

  /** Parse the whole input and return the collected entries. */
  public parse(): BibtexEntry[] {
    this.bibtex();
    if (this.options.deriveMissingCitationKey) {
      this.deriveMissingCitationKeys();
    }
    return this.entries;
  }

  // --- Character helpers -------------------------------------------------

  private isWhitespace(ch: string | undefined): boolean {
    return ch === " " || ch === "\r" || ch === "\t" || ch === "\n";
  }

  /**
   * Consume literal `token`. Throws {@link BibtexParseError} on mismatch.
   * Surrounding whitespace (and, unless disabled, `%` comments) is skipped.
   */
  private match(token: string, canCommentOut = true): void {
    this.skipWhitespace(canCommentOut);
    if (this.input.substring(this.pos, this.pos + token.length) === token) {
      this.pos += token.length;
    } else {
      throw new BibtexParseError(
        `Token mismatch: expected "${token}", found "${this.input.substring(this.pos, this.pos + 20)}"`,
        this.pos,
      );
    }
    this.skipWhitespace(canCommentOut);
  }

  /** Peek: does literal `token` appear next (after skipping whitespace)? */
  private tryMatch(token: string, canCommentOut = true): boolean {
    this.skipWhitespace(canCommentOut);
    return this.input.substring(this.pos, this.pos + token.length) === token;
  }

  /**
   * Advance to the next `@`, skipping over `%` line comments so that an `@`
   * appearing inside a comment does not start a spurious block. Returns `true`
   * if a real `@` was found.
   */
  private matchAt(): boolean {
    while (this.pos < this.input.length && this.input[this.pos] !== "@") {
      if (this.input[this.pos] === "%") {
        while (this.pos < this.input.length && this.input[this.pos] !== "\n") {
          this.pos++;
        }
      } else {
        this.pos++;
      }
    }
    return this.input[this.pos] === "@";
  }

  /** Skip whitespace and, when enabled, `%`-to-end-of-line comments. */
  private skipWhitespace(canCommentOut: boolean): void {
    while (this.isWhitespace(this.input[this.pos])) {
      this.pos++;
    }
    if (this.input[this.pos] === "%" && canCommentOut) {
      while (this.pos < this.input.length && this.input[this.pos] !== "\n") {
        this.pos++;
      }
      this.skipWhitespace(canCommentOut);
    }
  }

  // --- Value readers -----------------------------------------------------

  /** Read a brace-delimited value `{ ... }`, honouring nesting and escapes. */
  private valueBraces(): string {
    let braceCount = 0;
    this.match("{", false);
    const start = this.pos;
    let escaped = false;
    while (true) {
      if (!escaped) {
        if (this.input[this.pos] === "}") {
          if (braceCount > 0) {
            braceCount--;
          } else {
            const end = this.pos;
            this.match("}", false);
            return this.input.substring(start, end);
          }
        } else if (this.input[this.pos] === "{") {
          braceCount++;
        } else if (this.pos >= this.input.length - 1) {
          throw new BibtexParseError("Unterminated value: value_braces", start);
        }
      }
      escaped = this.input[this.pos] === "\\" && !escaped;
      this.pos++;
    }
  }

  /**
   * Read the raw text of a `@PREAMBLE` / `@COMMENT` body up to the closing
   * brace of the block, honouring nested braces.
   */
  private valueComment(): string {
    const start = this.pos;
    let str = "";
    let bracketCount = 0;
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos]!;
      if (ch === "}" && bracketCount === 0) {
        return str;
      }
      if (ch === "{") bracketCount++;
      if (ch === "}") bracketCount--;
      str += ch;
      this.pos++;
    }
    throw new BibtexParseError("Unterminated value: value_comment", start);
  }

  /** Read a double-quote-delimited value `" ... "`, honouring escapes. */
  private valueQuotes(): string {
    this.match('"', false);
    const start = this.pos;
    let escaped = false;
    while (true) {
      if (!escaped) {
        if (this.input[this.pos] === '"') {
          const end = this.pos;
          this.match('"', false);
          return this.input.substring(start, end);
        } else if (this.pos >= this.input.length - 1) {
          throw new BibtexParseError("Unterminated value: value_quotes", start);
        }
      }
      escaped = this.input[this.pos] === "\\" && !escaped;
      this.pos++;
    }
  }

  /**
   * Read a single value: a braced group, a quoted string, a number, a month
   * macro, or a bare identifier.
   *
   * Bare identifiers that are neither numbers nor month macros are treated as
   * unresolved `@string` macro references and returned verbatim (rather than
   * throwing). This keeps the parser tolerant of real-world files that use
   * string macros; use {@link expandStrings} beforehand to substitute them.
   */
  private singleValue(): string {
    if (this.tryMatch("{")) {
      return this.valueBraces();
    }
    if (this.tryMatch('"')) {
      return this.valueQuotes();
    }
    const k = this.key();
    if (/^[0-9]+$/.test(k)) {
      return k;
    }
    if (MONTHS.indexOf(k.toLowerCase()) >= 0) {
      return k.toLowerCase();
    }
    return k;
  }

  /** Read a value, resolving `#`-concatenation into a single string. */
  private value(): string {
    const values: string[] = [this.singleValue()];
    while (this.tryMatch("#")) {
      this.match("#");
      values.push(this.singleValue());
    }
    return values.join("");
  }

  /**
   * Read an identifier/key token. When `optional` is `true` and the token is
   * terminated by a non-comma delimiter, the cursor is rewound and `null` is
   * returned (used to detect an absent citation key).
   */
  private key(): string;
  private key(optional: boolean): string | null;
  private key(optional = false): string | null {
    const start = this.pos;
    while (true) {
      if (this.pos >= this.input.length) {
        throw new BibtexParseError("Runaway key", start);
      }
      const ch = this.input[this.pos];
      if (ch !== undefined && NOT_KEY.indexOf(ch) >= 0) {
        if (optional && ch !== ",") {
          this.pos = start;
          return null;
        }
        return this.input.substring(start, this.pos);
      }
      this.pos++;
    }
  }

  /** Read `key '=' value`, returning the trimmed key and its value. */
  private keyEqualsValue(): [string, string] {
    const key = this.key();
    if (key === null) {
      throw new BibtexParseError("Field name expected", this.pos);
    }
    if (this.tryMatch("=")) {
      this.match("=");
      const val = this.value();
      return [key.trim(), val];
    }
    throw new BibtexParseError(
      "Value expected, equals sign missing after field name",
      this.pos,
    );
  }

  /** Read a comma-separated list of `key = value` field pairs. */
  private keyValueList(): EntryTags {
    const tags: EntryTags = {};
    let [k, v] = this.keyEqualsValue();
    tags[k] = v;
    while (this.tryMatch(",")) {
      this.match(",");
      // Tolerate a trailing comma before the closing brace.
      if (this.tryMatch("}")) {
        break;
      }
      [k, v] = this.keyEqualsValue();
      tags[k] = v;
    }
    return tags;
  }

  // --- Top-level productions --------------------------------------------

  /** Read a regular entry body: `citationKey ',' key_value_list`. */
  private entryBody(directive: string): void {
    const rawKey = this.key(true);
    // `key(true)` returns "" when the key slot is empty (`@misc{, ...}`) but a
    // comma still needs consuming; it returns null when there is no key slot at
    // all. Both mean "no citation key", so normalise the empty string to null.
    if (rawKey !== null) {
      this.match(",");
    }
    const entry: RegularEntry = {
      entryType: directive.substring(1),
      citationKey: rawKey === "" ? null : rawKey,
      entryTags: {},
    };
    entry.entryTags = this.keyValueList();
    this.entries.push(entry);
  }

  /** Read the `@name` directive that opens every top-level item. */
  private directive(): string {
    this.match("@");
    const name = this.key();
    if (name === null) {
      throw new BibtexParseError("Directive name expected after '@'", this.pos);
    }
    return "@" + name;
  }

  /** Read a `@STRING{ name = value }` macro definition. */
  private stringDefinition(): void {
    const [name, value] = this.keyEqualsValue();
    this.entries.push({ entryType: "STRING", entry: [name, value] });
  }

  /** Read a `@PREAMBLE{ ... }` block. */
  private preamble(): void {
    this.entries.push({ entryType: "PREAMBLE", entry: this.valueComment() });
  }

  /** Read a `@COMMENT{ ... }` block. */
  private comment(): void {
    this.entries.push({ entryType: "COMMENT", entry: this.valueComment() });
  }

  /** The top-level loop over every `@...{ ... }` item in the document. */
  private bibtex(): void {
    while (this.matchAt()) {
      const d = this.directive();
      this.match("{");
      const upper = d.toUpperCase();
      if (upper === "@STRING") {
        this.stringDefinition();
      } else if (upper === "@PREAMBLE") {
        this.preamble();
      } else if (upper === "@COMMENT") {
        this.comment();
      } else {
        this.entryBody(d);
      }
      this.match("}");
    }
  }

  /**
   * For entries with no citation key, synthesise one from the `author` (first
   * author's surname) and `year` fields, matching the original library.
   */
  private deriveMissingCitationKeys(): void {
    for (const entry of this.entries) {
      if (!("entryTags" in entry)) continue;
      if (entry.citationKey || !entry.entryTags) continue;

      let key = "";
      const author = entry.entryTags["author"];
      const year = entry.entryTags["year"];
      if (author !== undefined) {
        const firstAuthor = author.split(",")[0] ?? "";
        key += firstAuthor + ", ";
      }
      if (year !== undefined) {
        key += year;
      }
      entry.citationKey = key;
    }
  }
}

/**
 * Parse a BibTeX string into a list of typed entries.
 *
 * @param bibtex - The BibTeX source text.
 * @param options - Optional parser configuration.
 * @throws {BibtexParseError} When the input is malformed.
 */
export function parse(
  bibtex: string,
  options?: BibtexParserOptions,
): BibtexEntry[] {
  return new BibtexParser(bibtex, options).parse();
}
