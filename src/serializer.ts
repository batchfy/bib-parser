import {
  isCommentEntry,
  isPreambleEntry,
  isRegularEntry,
  isStringEntry,
  type BibtexEntry,
  type ToBibtexOptions,
} from "./types.ts";

/**
 * Serialize a list of entries back into BibTeX source text.
 *
 * This is the inverse of {@link parse}. With `compact: true` (the default) the
 * output is terse; with `compact: false` it is indented and multi-line for
 * human readability.
 *
 * @param entries - The entries to serialize.
 * @param options - Optional serialization configuration.
 */
export function toBibtex(
  entries: readonly BibtexEntry[],
  options: ToBibtexOptions = {},
): string {
  const compact = options.compact ?? true;
  const entrySep = compact ? "," : ",\n";
  const indent = compact ? "" : "    ";

  let out = "";
  for (const entry of entries) {
    out += "@" + entry.entryType;
    out += "{";

    if (isRegularEntry(entry)) {
      if (entry.citationKey) {
        out += entry.citationKey + entrySep;
      }
      let tags = indent;
      for (const [name, value] of Object.entries(entry.entryTags)) {
        if (tags.trim().length !== 0) {
          tags += entrySep + indent;
        }
        tags += name + (compact ? "={" : " = {") + value + "}";
      }
      out += tags;
      // A regular entry's tag block closes on its own line in pretty mode.
      out += compact ? "}\n" : "\n}\n\n";
    } else {
      if (isStringEntry(entry)) {
        const [name, value] = entry.entry;
        out += name + (compact ? "={" : " = {") + value + "}";
      } else if (isPreambleEntry(entry) || isCommentEntry(entry)) {
        // The body is captured up to the closing brace on re-parse, so no
        // newline may be injected before the `}` (even in pretty mode).
        out += entry.entry;
      }
      out += compact ? "}\n" : "}\n\n";
    }
  }
  return out;
}
