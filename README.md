# bib-parser

A small, **fully-typed TypeScript** BibTeX parser, serializer, and `@string`
macro expander. It is a modern port of
[`ORCID/bibtexParseJs`](https://github.com/ORCID/bibtexParseJs) (original work by
Henrik Muehe, 2010) with a strict type layer, a robust hand-written scanner, and
a thorough test suite.

- **Zero runtime dependencies.**
- **Fully typed** — `strict` TypeScript with `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, and friends.
- Parse BibTeX → typed JSON, serialize JSON → BibTeX (compact or pretty).
- A **separate** `@string` expander supporting every common definition syntax.

## Installation

```bash
npm install
npm run build   # emits ./dist (JS + .d.ts)
```

Requires Node.js 24+ (the toolchain and test suite run TypeScript sources
natively via type stripping).

## Quick start

```ts
import { parse, toBibtex } from "bib-parser";

const entries = parse("@article{muehe2010, title = {A Parser}, year = 2010}");
// [{ entryType: "article", citationKey: "muehe2010",
//    entryTags: { title: "A Parser", year: "2010" } }]

toBibtex(entries); // '@article{muehe2010,title={A Parser},year={2010}}\n'
```

## API

### `parse(bibtex, options?) => BibtexEntry[]`

Parses BibTeX source into a list of typed entries. Also exported as `toJSON` for
compatibility with the original library.

```ts
interface BibtexParserOptions {
  /** Synthesise a citation key from author + year when one is missing. Default: true. */
  deriveMissingCitationKey?: boolean;
}
```

The parser is deliberately tolerant: unknown bare identifiers (e.g. an
unresolved `@string` reference like `publisher = acm`) are kept verbatim rather
than throwing. Genuinely malformed input (unterminated values, a missing `=`,
runaway keys) throws a `BibtexParseError` carrying the failing `position`.

### `toBibtex(entries, options?) => string`

Serializes entries back to BibTeX. `{ compact: true }` (default) is terse;
`{ compact: false }` is indented and multi-line.

### `expandStrings(bibtex, options?) => string`

**Separate, text-in / text-out** function that substitutes every `@string`
macro reference and returns the rewritten BibTeX **with the definitions
removed** (by default). Entry skeletons — types, delimiters, citation keys,
field names, and layout — are preserved; only field *values* are rewritten.

Every common `@string` syntax is supported:

```bibtex
@string{ pub = "ACM Press" }          % quoted value, brace delimiters
@string( pub = {ACM Press} )          % braced value, PAREN delimiters
@STRING{ y2020 = 2020 }               % numeric value, any @string casing
@string{ a = "A" # " and " # b }      % # concatenation + nested reference
@string{ x = "X", y = "Y" }           % multiple assignments per block
```

```ts
interface ExpandStringsOptions {
  /** Remove @string blocks from the output. Default: true. */
  removeDefinitions?: boolean;
  /** Extra predefined macros (matched case-insensitively). */
  additionalStrings?: Record<string, string>;
  /** Predefine jan..dec to full English month names. Default: false. */
  includeDefaultMonths?: boolean;
}
```

```ts
expandStrings('@string{acm = "ACM Press"}\n@article{k, publisher = acm}');
// '@article{k, publisher = {ACM Press}}\n'   (definition removed)
```

Definitions may reference each other in any order (resolved transitively;
cycles are handled gracefully). Text inside braced/quoted literals that merely
*looks* like a macro is never touched.

### `getStringDefinitions(bibtex, options?) => Record<string, string>`

Returns a map from (lower-cased) macro name to its fully-resolved value.

### Types & guards

`BibtexEntry` is a discriminated union of `RegularEntry`, `StringEntry`,
`PreambleEntry`, and `CommentEntry`. Narrow with the exported guards
`isRegularEntry`, `isStringEntry`, `isPreambleEntry`, `isCommentEntry`.

## Project layout

```
src/
  index.ts        # public API surface
  parser.ts       # recursive-descent BibTeX parser
  serializer.ts   # entries -> BibTeX (toBibtex)
  strings.ts      # standalone @string expander
  errors.ts       # BibtexParseError
  types.ts        # shared types + type guards
test/
  library.test.ts     # single consolidated suite driven by one fixture
  errors.test.ts      # malformed-input error handling
  fixtures/
    library.bib       # one comprehensive fixture exercising the whole grammar
```

## Scripts

| Command              | Description                                  |
| -------------------- | -------------------------------------------- |
| `npm test`           | Run the test suite (Node's built-in runner). |
| `npm run typecheck`  | Type-check without emitting.                 |
| `npm run build`      | Emit JS + declarations to `./dist`.          |

## License

MIT
