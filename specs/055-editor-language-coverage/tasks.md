# Tasks: Editor Language Coverage — Filename Detection and New Languages

**Input**: Design documents from `/specs/055-editor-language-coverage/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/language-detection.md

**Tests**: Required. Constitution Principle V (test-first, non-negotiable): every test task is written
first, run, and seen to fail for the stated reason before the implementation task after it. All tests are
in the Vitest `unit` project (`packages/**/tests/unit/**/*.test.ts`); no E2E (plan, Technical Context).

**Organization**: by user story. `packages/core/src/editor/languages.ts`,
`packages/ui/src/renderer/editor/language-loaders.ts` and `packages/core/tests/unit/languages.test.ts` are
shared by every story, so tasks touching them are sequential and never `[P]`.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Create the grammar folder `packages/ui/src/renderer/editor/grammars/` and the test folder `packages/ui/tests/unit/grammars/`, each with nothing in it but the files later tasks add (no barrel file)

---

## Phase 2: Foundational — the filename rung (#70; blocks every story)

**Goal**: filename descriptors exist, are validated, and are the second rung of the precedence chain.

- [x] T002 Replace the test "leaves `filenames` empty for every descriptor" in `packages/core/tests/unit/languages.test.ts` with registry-syntax tests per data-model.md: every `filenames` entry is lower-case; has at most one `*`; a folder-qualified entry has exactly one `/` and no `*`; every descriptor claims at least one extension **or** one filename. Relax "claims every extension" so `extensions` may be empty when `filenames` is not
- [x] T003 Add the FR-006 overlap test to `packages/core/tests/unit/languages.test.ts`: for every pair of filename entries owned by DIFFERENT languages, assert no name can match both, using research R3's exact rules (exact vs exact: equal; exact vs `p*s`: starts with `p`, ends with `s`, length ≥ |p|+|s|; `p1*s1` vs `p2*s2`: one prefix starts with the other AND one suffix ends with the other; folder-qualified only vs folder-qualified). Include a self-test that the helper reports a known overlap (`.env.*` vs `.env.local`) so the guard cannot pass vacuously
- [x] T004 Write failing tests for `matchFilename` in `packages/core/tests/unit/language-detect.test.ts` covering, with a temporary fixture registry or the real one as each row allows: exact match; case-insensitivity (`GEMFILE`); pattern with `*` in the middle (`tsconfig.*.json`) and at the end (`.env.*`); `*` never crossing a separator; folder-qualified match with `/`, `\` and mixed separators (`C:\p\.vscode\launch.json`) and its non-match outside the folder (`C:\p\launch.json`); exact/folder tier before pattern tier (FR-008); FR-003a — a trailing-`*` pattern does not match a basename ending in a registry-claimed extension (`.env.json`, `Dockerfile.md`) but does match an unclaimed one (`.env.local`, `Dockerfile.dev`); `.envrc` and `LICENSE` → `undefined`. Once US3 lands, add the contract row `.env.config` → `xml` (FR-003a against a later-claimed extension)
- [x] T004a [derived] In `packages/core/tests/unit/language-detect.test.ts`, rewrite the two `it` blocks that assert 016 FR-002b's superseded rule (`Dockerfile`, `.gitignore`, `.env` → plain text) and the `tsconfig.json` → `json` row so they assert only names this feature leaves unclaimed (`Makefile`, `LICENSE`, `.bazelignore`, `.envrc`, `package.json`); keep `script` as the content-never-inspected case (SC-005)
- [x] T005 Write failing tests in `packages/core/tests/unit/language-detect.test.ts` that `detectLanguage(path)` returns the filename match when there is one and falls back to the extension match, then plain text; and that a dotless or dot-first name no descriptor claims is still plain text (016 FR-002b remainder)
- [x] T006 Write failing precedence tests in `packages/core/tests/unit/language-precedence.test.ts` for every row of the `resolveLanguage` table in `contracts/language-detection.md`: filename match outranks the user extension mapping (`.json → json` leaves `tsconfig.json` as `jsonc`); the mapping still decides an unclaimed `package.json`; a manual override beats the filename match; an explicit Plain Text override terminates; an unresolvable override falls through to the filename match; both built-in rungs report `source: 'registry'`
- [x] T007 Implement `matchFilename(path)` in `packages/core/src/editor/language-detect.ts`: normalise `\` to `/`, lower-case, take the basename and the immediate parent folder name; build two match tables once from `LANGUAGES` (exact + folder-qualified, then patterns); apply FR-003a against the existing longest-first `SUFFIXES` list. Export it from `packages/core/src/editor/index.ts` and `packages/core/src/index.ts`. Update the module comment: detection is by name (and, for folder-qualified entries, the parent folder), never content
- [x] T008 Widen `detectLanguage` and add the filename rung to `resolveLanguage` in `packages/core/src/editor/language-detect.ts` in the FR-007 order: override → `matchFilename` → user extension mapping → extension match → plain text. `detectLanguage(path)` calls `matchFilename(path)` first and returns its result when defined; otherwise it runs the existing extension rung unchanged, `hasNoExtension` included. Update the doc comments that cite FR-002b's "plain text until #70"
- [x] T009 Update the `filenames` field comment in `packages/core/src/editor/languages.ts` from "RESERVED, MUST be empty" to the three forms of research R2, citing 055 FR-002–FR-004
- [x] T010 Run T002–T006 narrowly (`npx vitest run --project unit packages/core/tests/unit/languages.test.ts packages/core/tests/unit/language-detect.test.ts packages/core/tests/unit/language-precedence.test.ts`) and confirm green (the FR-006 test passes on a registry with no filename entries yet; its self-test proves the helper is live)

**Checkpoint**: filename rung works against any registry content.

---

## Phase 3: User Story 1 — Configuration files that allow comments stop showing errors (P1) 🎯 MVP

**Goal**: JSONC files named in FR-009 open as JSON with Comments. **Independent test**: spec US1.

- [x] T011 [US1] Write failing detection tests in `packages/core/tests/unit/language-detect.test.ts` that each of `tsconfig.json`, `tsconfig.build.json`, `jsconfig.json`, `.eslintrc.json`, `.babelrc`, `.swcrc`, `devcontainer.json`, `.devcontainer.json`, `.vscode/settings.json`, `.vscode/launch.json`, `.vscode/tasks.json`, `.vscode/extensions.json` resolves to `jsonc`; `package.json` and a bare `launch.json` stay `json`
- [x] T012 [US1] Add the `filenames` entries of data-model.md's `jsonc` row (lower-case) to the `jsonc` descriptor in `packages/core/src/editor/languages.ts`
- [x] T013 [US1] Run T011 and the full `languages.test.ts` narrowly; confirm green

---

## Phase 4: User Story 2 — Files known by name open highlighted (P1)

**Goal**: `.env*`, Dockerfiles, ignore files, INI/Ruby/CMake/Groovy/nginx names highlight. **Independent test**: spec US2.

- [x] T014 [P] [US2] Write failing tokenizer tests in `packages/ui/tests/unit/grammars/dotenv.test.ts` for the Dotenv `StreamParser`: `# comment` → comment; `KEY=value` → key (propertyName) and value (string); `export KEY=value` → `export` as keyword; single- and double-quoted values as string; a trailing ` # note` after an unquoted value as comment; `${OTHER}` inside a value may be a variable but the value is never altered (FR-013)
- [x] T015 [P] [US2] Write failing tokenizer tests in `packages/ui/tests/unit/grammars/ignore.test.ts` for the Ignore file `StreamParser`: `# comment` → comment; a pattern line → not a comment; a leading `!` negation → operator; `\#` escaped hash is a pattern, not a comment (FR-014)
- [x] T016 [P] [US2] Implement the Dotenv `StreamParser` in `packages/ui/src/renderer/editor/grammars/dotenv.ts`, emitting only tags `highlight-style.ts` already maps (research R6)
- [x] T017 [P] [US2] Implement the Ignore file `StreamParser` in `packages/ui/src/renderer/editor/grammars/ignore.ts`, emitting only already-mapped tags
- [x] T018 [US2] Write failing detection tests in `packages/core/tests/unit/language-detect.test.ts` for every US2 name: `.env`, `.env.local`, `.env.development`, `.env.production.local` → `dotenv`; `Dockerfile`, `Containerfile`, `Dockerfile.dev`, `api.Dockerfile`, `build.dockerfile`, `dockerfile` → `dockerfile`; the eight ignore names → `ignore`, `.bazelignore` → plain text; `.editorconfig`, `.npmrc`, `.gitconfig` → `ini`; `CMakeLists.txt` → `cmake`; `Jenkinsfile` → `groovy`; `Gemfile`, `Rakefile`, `Vagrantfile`, `GEMFILE` → `ruby`; `nginx.conf` → `nginx`
- [x] T019 [US2] Add descriptors `dotenv`, `ignore`, `dockerfile`, `nginx`, `cmake`, `groovy` (with the extensions, filenames and indent of data-model.md's table — "extensions may be empty for a language matched only by name") and add `filenames` to `ini` and `ruby`, in `packages/core/src/editor/languages.ts`
- [x] T020 [US2] Add loaders for `dotenv` and `ignore` (dynamic import of `./grammars/dotenv.js` / `./grammars/ignore.js`, wrapped with `StreamLanguage`) and `stream(...)` loaders for `dockerfile` (`mode/dockerfile`, `dockerFile`), `nginx` (`mode/nginx`, `nginx`), `cmake` (`mode/cmake`, `cmake`), `groovy` (`mode/groovy`, `groovy`) in `packages/ui/src/renderer/editor/language-loaders.ts`; confirm each export name against the `.d.ts` in `node_modules/@codemirror/legacy-modes/mode/`
- [x] T021 [US2] Update the target list and counts in `packages/core/tests/unit/languages.test.ts` and `packages/ui/tests/unit/language-loaders.test.ts` to include the six new ids, then run US2's tests narrowly and confirm green

---

## Phase 5: User Story 3 — More extensions for existing languages (P2)

**Independent test**: spec US3.

- [x] T022 [US3] Write failing detection tests in `packages/core/tests/unit/language-detect.test.ts` for every FR-010 extension → its listed language (`.csproj` … `.ps1xml` → `xml`; `.json5`, `.code-workspace` → `jsonc`; `.webmanifest` → `json`; `.mdx` → `markdown`; `.cshtml`, `.razor`, `.svelte`, `.astro` → `html`; `.properties` → `ini`)
- [x] T023 [US3] Add those extensions to the `xml`, `jsonc`, `json`, `markdown`, `html` and `ini` descriptors in `packages/core/src/editor/languages.ts`; run T022 and `languages.test.ts` narrowly, confirm green (FR-017 uniqueness included)

---

## Phase 6: User Story 4 — New languages from grammars throng already ships (P2)

**Independent test**: spec US4.

- [x] T024 [US4] Write a failing test in `packages/ui/tests/unit/grammars/styled-tags.test.ts` that the tags `inserted`, `deleted` and `meta` each resolve to a style in `throngHighlightStyle` (`packages/ui/src/renderer/editor/highlight-style.ts`) — the diff grammar's output (research R6)
- [x] T025 [US4] Map `tags.inserted` → `syntaxString`, `tags.deleted` → `syntaxInvalid`, `tags.meta` → `syntaxKeyword` in `packages/ui/src/renderer/editor/highlight-style.ts`, with a comment in the existing voice explaining why (the prose-tags precedent); no new theme token (FR-020)
- [x] T026 [US4] Write failing detection tests in `packages/core/tests/unit/language-detect.test.ts` for every FR-011 extension → its language id from data-model.md (`diff`, `protobuf`, `cmake` via `.cmake`, `groovy` via `.groovy`/`.gradle`, `fsharp`, `vb`, `vbscript`, `scala`, `perl`, `r` incl. `.R`, `haskell`, `elm`, `erlang`, `clojure`, `julia`, `http`, `gherkin`, `jinja`, `nsis`)
- [x] T027 [US4] Add the 17 remaining FR-011 descriptors (`diff`, `protobuf`, `fsharp`, `vb`, `vbscript`, `scala`, `perl`, `r`, `haskell`, `elm`, `erlang`, `clojure`, `julia`, `http`, `gherkin`, `jinja`, `nsis` — those not added in T019) with data-model.md's extensions and indent, in `packages/core/src/editor/languages.ts`
- [x] T028 [US4] Add a `stream(...)` loader per T027 language in `packages/ui/src/renderer/editor/language-loaders.ts` (`mllike` → `fSharp`, `clike` → `scala`, the rest by their mode's exported name, each confirmed against its `.d.ts`)
- [x] T029 [US4] Update target lists and counts in `packages/core/tests/unit/languages.test.ts` and `packages/ui/tests/unit/language-loaders.test.ts`; run US4's tests narrowly and confirm green

---

## Phase 7: User Story 5 — Windows batch files are highlighted (P2)

**Independent test**: spec US5.

- [x] T030 [US5] Write failing tokenizer tests in `packages/ui/tests/unit/grammars/batch.test.ts` for every FR-015 form: `REM x` and `:: x` → comment (`rem` in any case); `:label` → labelName, and the target of `goto label` / `call :label`; keywords `echo`, `set`, `if`, `else`, `for`, `in`, `do`, `exist`, `not`, `errorlevel`, `setlocal`, `endlocal`, `shift`, `pushd`, `popd`, `exit`, `goto`, `call` in any case → keyword; `%VAR%`, `%~dp0`, `%%i`, `!VAR!` → variableName; `"quoted"` → string; `@` prefix, `>`, `>>`, `<`, `|`, `&&`, `||`, `2>&1` → operator; `^` escape (with the character it escapes) → string — not `escape`, which `highlight-style.ts` does not map
- [x] T031 [US5] Implement the Batch `StreamParser` in `packages/ui/src/renderer/editor/grammars/batch.ts`, emitting only already-mapped tags
- [x] T032 [US5] Write a failing detection test for `.bat`/`.cmd` → `batch` in `packages/core/tests/unit/language-detect.test.ts`; add the `batch` descriptor (4-space indent) in `packages/core/src/editor/languages.ts` and its loader in `packages/ui/src/renderer/editor/language-loaders.ts`; update the counts in both registry tests; run narrowly, confirm green

---

## Phase 8: Polish & Cross-Cutting

- [x] T033 Extend `packages/ui/tests/unit/grammars/styled-tags.test.ts` to run each hand-written grammar (`batch`, `dotenv`, `ignore`) over its fixture and assert every tag it emits resolves to a style in `throngHighlightStyle` (FR-020, SC-006)
- [x] T032a [derived] Update the indentation test in `packages/core/tests/unit/languages.test.ts` ("overrides indentation only where the convention differs") to the exact FR-021 set: the existing 13 plus `fsharp`, `vb`, `vbscript`, `perl`, `haskell`, `elm`, `erlang`, `julia`, `groovy`, `scala`, `batch`, each `{ style: 'spaces', indentWidth: 4, tabWidth: 4 }`; every other descriptor's `indent` undefined
- [x] T033a [derived] Add a test to `packages/ui/tests/unit/language-loaders.test.ts` that reads `packages/ui/src/renderer/editor/language-loaders.ts` as text and asserts `grammars/` is referenced only inside `import(...)` calls, never by a static `import … from` (FR-019: a static import puts the grammar in the main chunk with every other test still green)
- [x] T033b [derived] Confirm the language picker (`packages/ui/src/renderer/editor/language-picker.tsx`) and the `editor.languageByExtension` value list derive their entries from `LANGUAGES`; if either is hard-coded, derive it and add a unit assertion that every registry id is offered, name-only languages (`dotenv`, `ignore`, `nginx`) included (FR-018)
- [x] T034 Update `packages/core/src/editor/languages.ts` header and `LANGUAGES` doc comments from 31 to 55, regrouping the new descriptors under the existing section headings with their counts, and remove the "Makefile is deliberately absent … (#70)" sentence's dependence on #70 (keep Makefile absent: no grammar ships)
- [x] T035 Update `README.md` and `docs/quick-start.md` from 31 to 55 languages, and in `docs/quick-start.md`'s editor section state that files are recognised by name as well as extension (`Dockerfile`, `.env`, `tsconfig.json`) and give the five-rung precedence order of FR-007 (FR-022/FR-023)
- [x] T036 Update the `editor.languageByExtension` row in `docs/preferences.md` to say a built-in filename match (for example `tsconfig.json`) outranks the mapping, and only a per-document override changes it, linking to the quick-start section of T035 (FR-007, FR-023)
- [x] T037 Add one line per issue (#70, #404, #490, #491, #492) under `## Unreleased` in `CHANGELOG.md`, in the file's existing voice
- [x] T038 Run the docs audit (`throng-docs` skill) and `npx vitest run --project unit packages/ui/tests/unit/docs-currency.test.ts`; fix any finding
- [x] T039 Run the short gates once after the last edit: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:unit`, `npm run test:component`; record results. The heavy gate (`gate.yml` on CI, the repo's only done-ness evidence) is dispatched by autopilot step 9 once the manual test plan is signed off, and its run URL and SHA are quoted then

---

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002–T010)** → every story.
- **US1 (T011–T013)** and **US2 (T014–T021)** depend only on Foundational.
- **US3, US4, US5** depend only on Foundational, but share `languages.ts`, `language-loaders.ts` and the two
  registry tests with US1/US2, so run in order: US1 → US2 → US3 → US4 → US5.
- **Polish** after all stories.

## Parallel Opportunities

- T014 ∥ T015 (different test files), then T016 ∥ T017 (different grammar files).
- The three hand-written grammars (T016, T017, T031) touch only their own files and tests; a second
  implementer could take them while the registry work proceeds, merging loader lines afterwards.

## Implementation Strategy

MVP = Foundational + US1: the correctness fix (no false errors in `tsconfig.json` and friends). Then US2
(the name-only files, the bulk of the issue reports), then US3–US5 as increments, then Polish. One
committed increment per phase.

## Phase 9: Convergence

- [x] T040 Extend `packages/ui/tests/unit/grammars/styled-tags.test.ts` to run every legacy-mode grammar 055 wires up (`diff`, `protobuf`, `cmake`, `groovy`, `fsharp`, `vb`, `vbscript`, `scala`, `perl`, `r`, `haskell`, `elm`, `erlang`, `clojure`, `julia`, `http`, `gherkin`, `jinja`, `nsis`, `nginx`, `dockerfile`) through `StreamLanguage` over a short representative fixture, and assert every highlight tag it emits resolves to a style in `throngHighlightStyle`; map any unstyled tag onto an existing token in `highlight-style.ts` per FR-020, SC-006 (partial)
- [x] T041 Record in `specs/055-editor-language-coverage/research.md` R6 that mapping `tags.meta` also colours decorators, annotations and directives in the existing grammars (keyword colour), and why that is accepted per research R6 (unrequested)

## Phase 10: User Story 6 — A manual language choice can be undone (P2, iteration 2026-10-14)

- [x] T042 [US6] Write failing tests in `packages/ui/tests/component/status-strip-language-reset.test.ts`: the reset control is absent for a detected language and present for an override, Plain Text included; pressing it writes `null` through `document.setState` and the control goes (FR-024, FR-024a, FR-024c)
- [x] T043 [P] [US6] Write failing tests in `packages/ui/tests/unit/document-language-events.test.ts`: a published change reaches every subscriber; document matching ignores case and slash direction, and never matches an unpathed document (FR-024a)
- [x] T044 [P] [US6] Write failing tests in `packages/ui/tests/unit/editor-content-menu-reset.test.ts`: *Reset Language* follows *Set Language…*, is disabled without an override, and calls its handler (FR-024b)
- [x] T045 [US6] Add `packages/ui/src/renderer/editor/document-language-events.ts`, plus `clearDocumentOverride` and a publish after a successful write in `setDocumentOverride` (`language-override.ts`) (FR-024a)
- [x] T046 [US6] Subscribe each editor in `packages/ui/src/renderer/editor/use-editor.ts`: re-run `refreshLanguage` on a change to its own document, and on its own reset; pass `resetLanguage` to the content menu (FR-024a, FR-024b)
- [x] T047 [US6] Render the reset `IconButton` in `packages/ui/src/renderer/editor/status-strip.tsx` and add the *Reset Language* item to `packages/ui/src/renderer/editor/content-menu.ts` (FR-024, FR-024b)
- [x] T048 [US6] Document the reset in `docs/quick-start.md`'s editor section, and add a line under Unreleased in `CHANGELOG.md` (FR-023)

