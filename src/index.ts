/**
 * bib-parser (`@batchfy/bib-parser`) — a fully-typed TypeScript BibTeX parser and serializer.
 *
 * Ported from the original JavaScript library
 * {@link https://github.com/ORCID/bibtexParseJs ORCID/bibtexParseJs}
 * (original work by Henrik Muehe, 2010).
 *
 * @example
 * ```ts
 * import { parse, toBibtex } from "@batchfy/bib-parser";
 *
 * const entries = parse("@article{key, title = {Hello}, year = 2020}");
 * const bib = toBibtex(entries, { compact: false });
 * ```
 */

export { parse, BibtexParser } from "./parser.ts";
export { toBibtex } from "./serializer.ts";
export { BibtexParseError } from "./errors.ts";
export { expandStrings, getStringDefinitions } from "./strings.ts";
export type { ExpandStringsOptions } from "./strings.ts";

export {
  isRegularEntry,
  isStringEntry,
  isPreambleEntry,
  isCommentEntry,
} from "./types.ts";

export type {
  BibtexEntry,
  RegularEntry,
  StringEntry,
  PreambleEntry,
  CommentEntry,
  EntryTags,
  BibtexParserOptions,
  ToBibtexOptions,
} from "./types.ts";

import { parse } from "./parser.ts";
import type { BibtexEntry, BibtexParserOptions } from "./types.ts";

/**
 * Backwards-compatible alias for {@link parse}, matching the `toJSON` export of
 * the original `bibtexParseJs` library.
 *
 * @param bibtex - The BibTeX source text.
 * @param options - Optional parser configuration.
 */
export function toJSON(
  bibtex: string,
  options?: BibtexParserOptions,
): BibtexEntry[] {
  return parse(bibtex, options);
}
