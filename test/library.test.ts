import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  parse,
  toBibtex,
  expandStrings,
  getStringDefinitions,
  isCommentEntry,
  isPreambleEntry,
  isRegularEntry,
  isStringEntry,
} from "../src/index.ts";
import type {
  BibtexEntry,
  CommentEntry,
  PreambleEntry,
  RegularEntry,
  StringEntry,
} from "../src/types.ts";

/** The one BibTeX fixture that drives the whole suite. */
const RAW = readFileSync(new URL("./fixtures/library.bib", import.meta.url), "utf8");

/** Index the regular entries of a parse result by citation key. */
function byKey(entries: readonly BibtexEntry[]): Map<string, RegularEntry> {
  const map = new Map<string, RegularEntry>();
  for (const e of entries) {
    if (isRegularEntry(e)) map.set(e.citationKey ?? "", e);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Parsing the fixture
// ---------------------------------------------------------------------------

test("parses every top-level item in the fixture", () => {
  const entries = parse(RAW);
  // 1 preamble + 4 strings + 4 regular entries + 1 comment = 10
  assert.equal(entries.length, 10);

  const preambles = entries.filter(isPreambleEntry);
  const strings = entries.filter(isStringEntry);
  const comments = entries.filter(isCommentEntry);
  const regulars = entries.filter(isRegularEntry);

  assert.equal(preambles.length, 1);
  assert.equal(strings.length, 4);
  assert.equal(comments.length, 1);
  assert.equal(regulars.length, 4);
});

test("parses the @preamble block", () => {
  const preamble = parse(RAW).find(isPreambleEntry) as PreambleEntry;
  assert.equal(preamble.entryType, "PREAMBLE");
  assert.equal(preamble.entry, '"\\newcommand{\\noopsort}[1]{}" ');
});

test("parses the @comment block, preserving raw text", () => {
  const comment = parse(RAW).find(isCommentEntry) as CommentEntry;
  assert.equal(comment.entryType, "COMMENT");
  assert.equal(comment.entry, "This entire block is a free-form comment. ");
});

test("parses all @string definitions as [name, value] tuples", () => {
  const strings = parse(RAW).filter(isStringEntry) as StringEntry[];
  const defs = new Map(strings.map((s) => [s.entry[0], s.entry[1]]));
  assert.equal(defs.get("acm"), "ACM Press");
  assert.equal(defs.get("ieee"), "IEEE Computer Society");
  assert.equal(defs.get("y2020"), "2020");
  // The parser itself does NOT resolve macros, so `acm` stays unexpanded here.
  assert.equal(defs.get("jacm"), "Journal of the acm");
});

test("parses a full article entry, keeping macro references verbatim", () => {
  const article = byKey(parse(RAW)).get("muehe2010")!;
  assert.equal(article.entryType, "article");
  assert.deepEqual(article.entryTags, {
    author: "Muehe, Henrik",
    title: "A {BibTeX} Parser in {JavaScript}",
    journal: "jacm", // unresolved reference (parser is tolerant, not expanding)
    year: "y2020",
    month: "jan", // month macro lower-cased
    publisher: "acm",
    note: "Ported to {TypeScript}",
  });
});

test("parses numeric and plain-brace values", () => {
  const book = byKey(parse(RAW)).get("knuth1997")!;
  assert.equal(book.entryType, "book");
  assert.equal(book.entryTags["year"], "1997");
  assert.equal(book.entryTags["volume"], "1");
  assert.equal(book.entryTags["publisher"], "Addison-Wesley");
});

test("handles multiple authors and a trailing comma", () => {
  const inproc = byKey(parse(RAW)).get("lysenko2013")!;
  assert.equal(inproc.entryTags["author"], "Lysenko, Mikola and Bailey, Nick");
  assert.equal(inproc.entryTags["year"], "2013");
});

test("derives a citation key for the key-less @misc entry", () => {
  const derived = byKey(parse(RAW)).get("Lovelace, 1843");
  assert.ok(derived, "expected a derived citation key of 'Lovelace, 1843'");
  assert.equal(derived!.entryType, "misc");
  assert.equal(derived!.entryTags["title"], "Notes on the Analytical Engine");
});

test("citation-key derivation can be disabled", () => {
  const entries = parse(RAW, { deriveMissingCitationKey: false });
  const misc = entries.filter(isRegularEntry).find((e) => e.entryType === "misc")!;
  assert.ok(!misc.citationKey, "expected an empty/null citation key");
});

// ---------------------------------------------------------------------------
// Expanding @string macros (separate, text-in / text-out function)
// ---------------------------------------------------------------------------

test("expandStrings resolves all references and removes definitions", () => {
  const expanded = expandStrings(RAW);
  // No real @string *definition* survives (the substring may still appear in a
  // preserved % comment line, which is why we check parsed entries).
  assert.equal(parse(expanded).filter(isStringEntry).length, 0);

  const article = byKey(parse(expanded)).get("muehe2010")!;
  assert.equal(article.entryTags["publisher"], "ACM Press");
  assert.equal(article.entryTags["year"], "2020");
  assert.equal(article.entryTags["journal"], "Journal of the ACM Press"); // chained
  assert.equal(article.entryTags["month"], "jan"); // undefined macro left as-is

  const inproc = byKey(parse(expanded)).get("lysenko2013")!;
  assert.equal(inproc.entryTags["booktitle"], "Proceedings of the IEEE Computer Society");
});

test("expandStrings keeps @preamble and @comment blocks intact", () => {
  const expanded = expandStrings(RAW);
  assert.ok(expanded.includes("@preamble"));
  assert.ok(expanded.includes("@comment"));
});

test("expandStrings can keep definitions when asked", () => {
  const expanded = expandStrings(RAW, { removeDefinitions: false });
  assert.match(expanded, /@string\{\s*acm = \{ACM Press\}\s*\}/);
});

test("getStringDefinitions returns the fully resolved macro map", () => {
  const defs = getStringDefinitions(RAW);
  assert.equal(defs["acm"], "ACM Press");
  assert.equal(defs["ieee"], "IEEE Computer Society");
  assert.equal(defs["jacm"], "Journal of the ACM Press"); // chained resolution
});

// The following cases cover @string syntaxes not present in the fixture.

test("expandStrings supports parenthesis-delimited @string blocks", () => {
  const out = expandStrings('@string( p = "X" )\n@misc{k, a = p}');
  assert.equal(byKey(parse(out)).get("k")!.entryTags["a"], "X");
});

test("expandStrings supports parenthesis-delimited entries", () => {
  const out = expandStrings('@string{pub = "IEEE"}\n@article(k, publisher = pub)');
  assert.match(out, /@article\(k, publisher = \{IEEE\}\)/);
});

test("expandStrings supports multiple assignments per @string block", () => {
  const out = expandStrings('@string{ a = "A", b = "B" }\n@misc{k, one = a, two = b}');
  const tags = byKey(parse(out)).get("k")!.entryTags;
  assert.equal(tags["one"], "A");
  assert.equal(tags["two"], "B");
});

test("expandStrings can predefine month macros on request", () => {
  const out = expandStrings("@article{k, month = jan}", { includeDefaultMonths: true });
  assert.equal(byKey(parse(out)).get("k")!.entryTags["month"], "January");
});

test("expandStrings accepts additional predefined definitions", () => {
  const out = expandStrings("@article{k, publisher = mypub}", {
    additionalStrings: { mypub: "My Publisher" },
  });
  assert.equal(byKey(parse(out)).get("k")!.entryTags["publisher"], "My Publisher");
});

test("expandStrings does not touch braced literals that look like macros", () => {
  const out = expandStrings('@string{pub = "ACM"}\n@misc{k, note = {pub}}');
  assert.equal(byKey(parse(out)).get("k")!.entryTags["note"], "pub");
});

test("expandStrings handles cyclic definitions without hanging", () => {
  const out = expandStrings("@string{a = a}\n@misc{k, x = a}");
  assert.match(out, /x =\s*a/);
});

// ---------------------------------------------------------------------------
// Serialization + round-tripping
// ---------------------------------------------------------------------------

test("toBibtex emits compact output by default", () => {
  const out = toBibtex([
    { entryType: "article", citationKey: "k", entryTags: { title: "Hello", year: "2020" } },
  ]);
  assert.equal(out, "@article{k,title={Hello},year={2020}}\n");
});

test("toBibtex emits pretty output when compact is false", () => {
  const out = toBibtex(
    [{ entryType: "article", citationKey: "k", entryTags: { title: "Hello" } }],
    { compact: false },
  );
  assert.equal(out, "@article{k,\n    title = {Hello}\n}\n\n");
});

test("toBibtex serializes @string, @preamble and @comment items", () => {
  assert.equal(toBibtex([{ entryType: "STRING", entry: ["acm", "ACM"] }]), "@STRING{acm={ACM}}\n");
  assert.equal(toBibtex([{ entryType: "PREAMBLE", entry: '"x"' }]), '@PREAMBLE{"x"}\n');
  assert.equal(toBibtex([{ entryType: "COMMENT", entry: " hi " }]), "@COMMENT{ hi }\n");
});

test("parse -> toBibtex -> parse is stable for the whole (expanded) library", () => {
  // Derivation is disabled so no synthesised "Surname, year" keys (which are
  // not valid, round-trippable citation keys) are introduced.
  const first = parse(expandStrings(RAW), { deriveMissingCitationKey: false });
  const roundTripped = parse(toBibtex(first), { deriveMissingCitationKey: false });
  assert.equal(roundTripped.length, first.length);
  for (let i = 0; i < first.length; i++) {
    assert.deepEqual(roundTripped[i], first[i]);
  }
});

test("compact and pretty serialization re-parse to identical values", () => {
  const entries = parse(expandStrings(RAW), { deriveMissingCitationKey: false });
  const opts = { deriveMissingCitationKey: false };
  assert.deepEqual(
    parse(toBibtex(entries, { compact: false }), opts),
    parse(toBibtex(entries, { compact: true }), opts),
  );
});
