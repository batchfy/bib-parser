import { test } from "node:test";
import assert from "node:assert/strict";

import { parse, BibtexParseError } from "../src/index.ts";

test("throws BibtexParseError on an unterminated brace value", () => {
  assert.throws(
    () => parse("@article{k, title = {unterminated"),
    BibtexParseError,
  );
});

test("throws BibtexParseError on an unterminated quoted value", () => {
  assert.throws(
    () => parse('@article{k, title = "unterminated'),
    BibtexParseError,
  );
});

test("throws when the equals sign is missing", () => {
  assert.throws(
    () => parse("@article{k, title {T}}"),
    BibtexParseError,
  );
});

test("is tolerant of a bare identifier value (unresolved macro reference)", () => {
  // A bare token that is neither a number nor a month is kept verbatim rather
  // than throwing, so files using @string macros still parse.
  const [entry] = parse("@article{k, publisher = acm}");
  assert.ok(entry && "entryTags" in entry);
  assert.equal((entry as { entryTags: Record<string, string> }).entryTags["publisher"], "acm");
});

test("throws on a runaway key with no delimiter", () => {
  assert.throws(() => parse("@article{k, title"), BibtexParseError);
});

test("BibtexParseError carries a numeric position", () => {
  try {
    parse("@article{k, title = {oops");
    assert.fail("expected a throw");
  } catch (err) {
    assert.ok(err instanceof BibtexParseError);
    assert.equal(typeof err.position, "number");
    assert.ok(err.message.includes("position"));
  }
});

test("BibtexParseError is a proper Error subclass", () => {
  const err = new BibtexParseError("boom", 5);
  assert.ok(err instanceof Error);
  assert.ok(err instanceof BibtexParseError);
  assert.equal(err.name, "BibtexParseError");
});
