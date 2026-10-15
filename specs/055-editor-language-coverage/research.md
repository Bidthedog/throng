# Research: Editor Language Coverage (055)

## R1 — Where the filename rung lives

**Decision**: In `packages/core/src/editor/language-detect.ts`, beside the extension rung. A new pure
function `matchFilename(path)` returns the language a filename descriptor claims, or `undefined`.
`detectLanguage(path)` becomes "built-in detection" — filename match, else extension match, else plain
text — so its one other caller (`reveal-range.ts`, which asks "is this markdown?") gains `.mdx` without
change. `resolveLanguage` calls the two built-in rungs separately, because the user's extension mapping
sits *between* them (spec FR-007).

**Rationale**: The registry and detection are already core, pure and OS-free (Principle II). The
renderer passes the full `filePath` to `resolveLanguage` today (`editor-language.ts:117`), so the
folder qualifier of FR-004 needs no new plumbing — only separator normalisation, which is the known
trap this area records (`language-override.ts`, #229).

**Alternatives considered**: A separate `filename-detect.ts` module — rejected; the precedence chain is
one function, and splitting its rungs across files makes FR-007's order harder to read in one place.

## R2 — Descriptor shape

**Decision**: Keep the reserved `filenames?: readonly string[]` field (016 FR-004 reserved it so this is
not a breaking change). Each entry is one lower-case string whose form decides how it matches:

| Form | Example | Matches |
|---|---|---|
| exact | `dockerfile`, `.gitignore`, `cmakelists.txt` | the basename, whole |
| pattern | `tsconfig.*.json`, `.env.*`, `dockerfile.*` | the basename, one `*` = any run of characters, never a separator |
| folder-qualified | `.vscode/settings.json` | the basename **and** the immediate parent folder's name |

One `*` at most per entry, and no `*` in a folder-qualified entry. Both are asserted by the registry test.

**Rationale**: One field, three forms, all distinguishable by a character test. A tagged-union object
per entry would serve no case the spec has (YAGNI, Principle VIII), and the strings read exactly as a
user would write them.

**Alternatives considered**: Full glob syntax (`**`, `?`, character classes) — rejected: the spec needs
single-wildcard patterns only, and arbitrary globs make FR-006's overlap check undecidable in a unit
test. Regular expressions — rejected for the same reason.

## R3 — Proving no two languages can match one name (FR-006)

**Decision**: With at most one wildcard, overlap is decidable exactly. Split each entry at `*` into a
prefix and a suffix (an exact name is prefix = name, suffix = `` with no wildcard):

- exact vs exact → overlap iff equal.
- exact `n` vs pattern `p*s` → overlap iff `n` starts with `p`, ends with `s`, and `n.length ≥ p.length + s.length`.
- pattern `p1*s1` vs pattern `p2*s2` → overlap iff one prefix starts with the other **and** one suffix
  ends with the other (some name then satisfies both).
- folder-qualified entries compare only with each other (same folder and same name).

The registry test applies this to every pair of entries owned by **different** languages.

**Alternatives considered**: Fuzzing names — rejected; it can miss an overlap, and this check is exact
and cheap.

## R4 — The trailing-wildcard rule (FR-003a)

**Decision**: A pattern whose `*` is its last character does not match a basename that ends in any
extension the built-in registry claims (the same suffix list the extension rung uses, longest first).
`.env.json` → JSON; `.env.local` → Dotenv (`.local` is unclaimed); `Dockerfile.md` → Markdown.

**Rationale**: Clarified 2026-10-14. Reusing the extension rung's own suffix list keeps the two rules
consistent as languages are added.

## R5 — Grammars

**Decision**:

- **Already shipped** (`@codemirror/legacy-modes` 6.5.5, verified on disk): `diff`, `protobuf`, `cmake`,
  `groovy`, `mllike.fSharp`, `vb`, `vbscript`, `clike.scala`, `perl`, `r`, `haskell`, `elm`, `erlang`,
  `clojure`, `julia`, `http`, `gherkin`, `jinja2`, `nsis`, `nginx`, `dockerfile`. Each is one
  `stream(...)` line in `language-loaders.ts`, lazily imported like the existing legacy modes.
- **Written for this feature**: **Batch**, **Dotenv** and **Ignore file**, as `StreamParser`s in
  `packages/ui/src/renderer/editor/grammars/`, one file each, dynamically imported by their loader so they
  are not in the main chunk (FR-019).
- **Dotenv** is hand-written rather than reusing `properties`: `properties` treats `export KEY` as one key
  and does not separate quoted values, so it cannot meet FR-013's "keys, values, comments and `export`
  distinctly".

**Alternatives considered**: A third-party batch grammar package — rejected; the spec's assumption is no
new dependency, and a batch tokenizer is small.

## R6 — Theme coverage for tags no existing language emitted

**Finding**: `highlight-style.ts` maps tags onto the ten theme tokens. The **diff** grammar emits
`inserted`, `deleted` and `meta`, none of which is mapped, so a diff would render uncoloured although its
grammar loads — the same failure 016 hit with markdown's prose tags.

**Decision**: Map them onto existing tokens (FR-020: no new tokens): `inserted` → `syntaxString`,
`deleted` → `syntaxInvalid`, `meta` → `syntaxKeyword`.

**Side effect, accepted**: `meta` is not diff's alone. Existing grammars emit it for Python decorators,
YAML directives, preprocessor lines and annotations, which rendered in the editor's plain foreground
until now and take the keyword colour from this change. That is the conventional colouring in other
editors, it uses an existing token, and it changes no document's language, so it stays; the PR states it. The hand-written grammars emit only tags already
mapped (`comment`, `keyword`, `variableName`, `string`, `operator`, `labelName`, `propertyName`; a batch
`^` escape is emitted as `string`, because `escape` is not mapped). A unit test asserts every tag each new grammar emits on its fixture resolves to a
style, so a grammar that emits an unmapped tag fails a test rather than shipping flat.

## R7 — Precedence source reported to the UI

**Decision**: `LanguageResolution.source` keeps its four values; the filename rung reports `'registry'`
like the extension rung. Both are the built-in registry, and the only consumer
(`editor-language.ts:75`) compares the source for change detection, which a filename/extension
distinction would not improve.

## R8 — Responsive UI (Principle XII)

**Finding**: Detection runs once per document identity (016 FR-002a), never on a keystroke, and the
filename rung is a handful of string comparisons per open. New grammars load lazily and highlight the
visible region only, as every existing grammar does. No rendering work is added on an input path, so no
measurement is owed; the plan records that judgement rather than leaving it unstated.

## R9 — Documentation homes

**Decision**: `docs/quick-start.md` (the language count and a sentence on detection by name),
`README.md` (the count), and `docs/preferences.md`'s `editor.languageByExtension` row (filename matches
outrank the mapping). `CHANGELOG.md`'s `## Unreleased` gets one line per issue. `docs-currency.test.ts`
is the mechanical half and runs in the gate.
