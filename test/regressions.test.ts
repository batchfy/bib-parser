import { test } from "node:test";
import assert from "node:assert/strict";

import { parse, BibtexParseError } from "../src/index.ts";
import type { RegularEntry } from "../src/types.ts";

/**
 * Regression tests for bugs reported against the original ORCID/bibtexParseJs.
 * See https://github.com/ORCID/bibtexParseJs/issues
 */

function tags(bibtex: string): Record<string, string> {
  return (parse(bibtex)[0] as RegularEntry).entryTags;
}

// Issue #25 — https://github.com/ORCID/bibtexParseJs/issues/25
// A bare month macro as the LAST field (followed only by a newline before the
// closing brace) failed in the original because its key terminator set did not
// include newlines, so the token became "jan\n" and was rejected.
test("#25: bare `month = jan` as the last field of an entry", () => {
  const src = `@article{vanWoesik:2006ti,
author = {van Woesik, R and Lacharmoise, F and Koksal, S},
title = {{Annual cycles of solar insulation}},
year = {2006},
month = jan
}`;
  assert.equal(tags(src)["month"], "jan");
});

test("#25: bare numeric value as the last field of an entry", () => {
  assert.equal(tags("@article{k,\n  year = 2006\n}")["year"], "2006");
});

// Issue #27 — https://github.com/ORCID/bibtexParseJs/issues/27
// UTF-8 / non-ASCII characters must be preserved verbatim in values, field
// names, and citation keys.
test("#27: non-ASCII characters in values are preserved", () => {
  const src = `@inproceedings{Lanza,
    author   = {Wiedenhöfer, Thomas and Schwardmann, Ulrich},
    address  = {Jülich},
    title    = {Strategie für die inhaltliche Beschreibung numerischer Faktendatensätze},
    abstract = {große Herausforderung — Ökonomie, Heterogenität}
  }`;
  const t = tags(src);
  assert.equal(t["author"], "Wiedenhöfer, Thomas and Schwardmann, Ulrich");
  assert.equal(t["address"], "Jülich");
  assert.equal(t["title"], "Strategie für die inhaltliche Beschreibung numerischer Faktendatensätze");
  assert.equal(t["abstract"], "große Herausforderung — Ökonomie, Heterogenität");
});

test("#27: non-ASCII characters in citation keys are preserved", () => {
  // Cyrillic citation key (the original source even noted а-яА-Я support).
  const [entry] = parse("@book{Толстой1869, title = {Война и мир}}");
  assert.equal((entry as RegularEntry).citationKey, "Толстой1869");
  assert.equal((entry as RegularEntry).entryTags["title"], "Война и мир");
});

// Issue #31 — https://github.com/ORCID/bibtexParseJs/issues/31
// BibLaTeX-style `date` fields parse fine as plain fields (full date-part
// semantics is out of scope, but the value must not be dropped or mangled).
test("#31: BibLaTeX `date = {2010-10-13}` parses as a plain field", () => {
  assert.equal(tags("@article{k, date = {2010-10-13}}")["date"], "2010-10-13");
});

// Issue #33 — https://github.com/ORCID/bibtexParseJs/issues/33
// A citation key containing a comma is structurally invalid BibTeX (the comma
// is the key/field separator). We surface a clear, positioned error rather than
// silently mis-parsing.
test("#33: a comma inside the citation key raises a clear error", () => {
  assert.throws(
    () => parse("@ARTICLE{EuropeanCommission,T2019,\n author={X},\n year={2019}\n}"),
    BibtexParseError,
  );
});
