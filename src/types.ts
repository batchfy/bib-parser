/**
 * Type definitions describing the abstract structure of a parsed BibTeX file.
 *
 * A BibTeX document is a sequence of top-level items. Each item is one of:
 *   - a regular entry   (`@article{...}`, `@book{...}`, ...)
 *   - a `@STRING`        (a reusable macro definition)
 *   - a `@PREAMBLE`      (raw LaTeX injected into the bibliography)
 *   - a `@COMMENT`       (free text ignored by consumers)
 *
 * The shapes below intentionally mirror the JSON emitted by the original
 * `bibtexParseJs` library so this port is a drop-in replacement, while adding
 * precise, discriminated types on top.
 */

/** The set of key/value fields (tags) attached to a regular entry. */
export type EntryTags = Record<string, string>;

/**
 * A standard bibliography entry such as `@article`, `@book`, `@inproceedings`.
 *
 * @example
 * // @article{smith2020, title = {Hello}, year = 2020}
 * {
 *   entryType: "article",
 *   citationKey: "smith2020",
 *   entryTags: { title: "Hello", year: "2020" }
 * }
 */
export interface RegularEntry {
  /** The lower-cased-agnostic type name without the leading `@`, e.g. `"article"`. */
  entryType: string;
  /**
   * The citation key, e.g. `"smith2020"`. May be `null` when the entry omits a
   * key (BibTeX permits `@misc{, ...}`). It can later be back-filled from the
   * author/year fields — see {@link BibtexParserOptions.deriveMissingCitationKey}.
   */
  citationKey: string | null;
  /** The parsed field/value pairs. */
  entryTags: EntryTags;
}

/**
 * A `@STRING` macro definition, e.g. `@string{ acm = "ACM Press" }`.
 * `entry` is a `[name, value]` tuple.
 */
export interface StringEntry {
  entryType: "STRING";
  entry: readonly [name: string, value: string];
}

/** A `@PREAMBLE` block. `entry` holds the raw text between the braces. */
export interface PreambleEntry {
  entryType: "PREAMBLE";
  entry: string;
}

/** A `@COMMENT` block. `entry` holds the raw text between the braces. */
export interface CommentEntry {
  entryType: "COMMENT";
  entry: string;
}

/** Any top-level item produced by the parser. */
export type BibtexEntry =
  | RegularEntry
  | StringEntry
  | PreambleEntry
  | CommentEntry;

/** Type guard: is this item a regular (`@article`, `@book`, ...) entry? */
export function isRegularEntry(entry: BibtexEntry): entry is RegularEntry {
  return "entryTags" in entry;
}

/** Type guard: is this item a `@STRING` macro definition? */
export function isStringEntry(entry: BibtexEntry): entry is StringEntry {
  return entry.entryType === "STRING" && "entry" in entry && Array.isArray(entry.entry);
}

/** Type guard: is this item a `@PREAMBLE` block? */
export function isPreambleEntry(entry: BibtexEntry): entry is PreambleEntry {
  return entry.entryType === "PREAMBLE";
}

/** Type guard: is this item a `@COMMENT` block? */
export function isCommentEntry(entry: BibtexEntry): entry is CommentEntry {
  return entry.entryType === "COMMENT";
}

/** Options controlling parser behaviour. */
export interface BibtexParserOptions {
  /**
   * When `true` (the default, matching the original library) an entry that has
   * no citation key gets one synthesised from its `author` and `year` fields.
   */
  deriveMissingCitationKey?: boolean;
}

/** Options controlling BibTeX serialization ({@link toBibtex}). */
export interface ToBibtexOptions {
  /**
   * `true` (default) emits terse, single-line-ish output. `false` emits a
   * prettier, indented multi-line layout.
   */
  compact?: boolean;
}
