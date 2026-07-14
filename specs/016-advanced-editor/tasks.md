# Tasks: Advanced Editor — Rich Code Editing (Part 1)

**Feature**: `016-advanced-editor` | **Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

## Test discipline (NON-NEGOTIABLE — constitution v3.15.0, Principle V)

Tests are **not optional here**. Every task below is **Red → Green → Refactor**: write the failing test,
**run it**, confirm it fails **for the reason you expect** (a test that fails on a typo'd import proves
nothing), then make it pass.

The repo has exactly **four** layers — tasks target these and no others (there is **no** component/DOM
test stack):

| Layer | Command | Notes |
|---|---|---|
| unit | `npm run test:unit` | parallel; pure core logic |
| integration | `npm run test:integration` | **serial** — spawns real OS processes |
| contract | `npm run test:contract` | **serial** — where `runClipboardContract` runs |
| E2E | `npm run test:e2e` | Playwright-Electron; real windows, no headless mode |

**Every user-facing UI change MUST ship E2E coverage** (Principle V). **Run a suite once, unfiltered,
capture the full output**; re-run only failures; then the full suite once. A test that passes on re-run
with **no code change** is **flaky, not fixed**.

> **E2E on this machine**: use `THRONG_E2E_WORKERS=2`. The default (6) is benchmarked for a
> 10-core/20-thread box and exhausts the Windows desktop heap on 8 cores (`STATUS_DLL_INIT_FAILED`).

---

## Phase 1: Setup

- [X] T001 Add CodeMirror grammar dependencies to `packages/ui/package.json`: `@codemirror/lang-{javascript,python,rust,cpp,java,php,sql,xml,json,html,css,markdown,yaml,go,vue,less,sass}` and `@codemirror/legacy-modes`. (`@codemirror/language`, `-state`, `-view`, `-commands` are already present.)
- [X] T002 Add a `manualChunks` rule in `packages/ui/vite.config.ts` giving each language grammar its own chunk, so 31 grammars do not inflate the main bundle (FR-008's 200 ms budget).

---

## Phase 2: Foundational (BLOCKING — no user story can proceed without these)

These are first because `cut-line` **provably cannot fire** without T010–T013 (`resolveAction` returns
`file.cut` for `Ctrl+X` inside an editor), and the settings maps **provably fail the completeness test**
without T016–T019.

### Language registry & detection (pure core)

- [X] T003 [P] Unit test in `packages/core/tests/unit/languages.test.ts`: registry invariants — no extension claimed by two descriptors (FR-004a); ids unique; `.h` → `cpp`; all 31 FR-001 targets present; `filenames` empty for every descriptor in Part 1 (FR-002b).
- [X] T004 [P] Unit test in `packages/core/tests/unit/language-detect.test.ts`: longest declared suffix wins (`types.d.ts` → `.d.ts` over `.ts`); case-insensitive; no dot (`Dockerfile`) and leading-dot-only (`.gitignore`) → **no extension** → plain text; content is **never** read.
- [X] T005 [P] Unit test in `packages/core/tests/unit/language-precedence.test.ts`: precedence chain (FR-005a) document override → user mapping → registry → plain text; an **explicit Plain Text terminates** the chain (FR-004c); an **unresolvable id falls through and is preserved** (FR-005b). These two must not be conflated.
- [X] T006 Implement `LanguageDescriptor`, `IndentProfile`, `PLAIN_TEXT_ID` and the 31-descriptor registry in `packages/core/src/editor/languages.ts`.
- [X] T007 Implement extension detection + the precedence chain in `packages/core/src/editor/language-detect.ts`.
- [X] T008 [P] Unit test in `packages/core/tests/unit/indent-infer.test.ts`: sample = `min(ceil(10% lines), 100)`, never < 1; only first 20 chars; a tab anywhere in the prefix forces `tabs`; most-frequent space count wins, ties → smaller; leading whitespace **past 20 chars is excluded from the tally** (not counted as 20); no considered lines → `null`.
- [X] T009 Implement bounded indentation inference in `packages/core/src/editor/indent-infer.ts`.

### Dispatch scope (F4 — without this, `cut-line` never fires)

- [X] T010 Unit test in `packages/core/tests/unit/keybindings-scope.test.ts`: `resolveAction(kb, ev, 'editor')` resolves `Ctrl+X` → `editor.cutLine` while `resolveAction(kb, ev, 'explorer')` → `file.cut`. Prove the **current** scope-blind resolver returns `file.cut` for both (this is the Red that justifies the change).
- [X] T011 Unit test in `packages/core/tests/unit/keybindings-scope.test.ts`: every registered command declares a **non-empty** scope set; an unscoped command **fails** the completeness test (FR-017b0 — there is no default). **Also assert the absence (G7/FR-017c)**: Cut, Copy, Paste, Select All, Undo and Redo are **NOT** registered commands and do **not** appear in the Key Bindings editor — they keep their native OS bindings so they interoperate with the rest of the system. Exactly **seven** new commands are registered, no more.
- [X] T012 Add `DispatchScope`, the per-command scope sets for all **36** shipped commands, and the seven new `ActionId`s to `packages/core/src/config/keybindings.ts`; make `resolveAction` **scope-aware**. **Use the `ActionId` spellings pinned in `data-model.md` §5 (A1)** — `editor.cutLine`, `editor.indentLines`, `editor.outdentLines`, `editor.columnSelectUp|Down|Left|Right` — matching the shipped `dot.camelCase` convention (`file.cut`, `editor.saveAll`). The spec's prose names (`cut-line`, `column-select-*`) are **not** ids; that table is the single mapping, and T013's collision test and T114's descriptors both key off it.
- [X] T114 **Keybinding editor-metadata descriptors — MUST land WITH T012 or the build breaks.** `keybindings-metadata.test.ts` derives `ACTION_IDS` from `Object.keys(DEFAULT_KEYBINDINGS.bindings)` and calls `assertEveryKeyDescribed(...)`, so the moment T012 adds seven `ActionId`s **that test goes red** — and `reset-completeness.test.ts` additionally requires every descriptor to resolve to a shipped chord set. Add seven `control: 'chord'` descriptors (group `Editor`, hand-written label + description) to `packages/core/src/config/keybindings-metadata.ts`, **and add the `scope` field to the command's editor metadata** (the plan's Complexity Tracking accepts *"a `scope` field on the command descriptor **and its editor metadata**"*; T095 only *renders* it — nothing else *adds* it). Extend `packages/core/tests/unit/keybindings-metadata.test.ts`. This is the **NON-NEGOTIABLE** Configuration-editor completeness rule: a new config key without an editor descriptor **fails the test**, by design.
- [X] T013 Unit test + implementation in `packages/core/tests/unit/keybindings-collision.test.ts` + `keybindings.ts`: the collision test is **enumerated from the command registry** (never a hand-listed set of features) and **scope-aware** — two commands clash **iff their scope sets intersect** on a chord. It must PASS with `cut-line` (`{editor}`) and `file.cut` (`{explorer}`) both on `Ctrl+X`.
- [X] T014 Unit test + implementation: every shipped default chord round-trips through `normalizeToken(eventToToken(...))` in `packages/core/tests/unit/keybindings.test.ts` — this is what catches F2 (`Alt+Shift+…` must be written `Shift+Alt+…` or it never matches).
- [X] T015 Make `findConflict` scope-aware in `packages/core/src/config/chord-capture.ts` (two commands conflict only if their scope sets intersect), and remove `Tab`/`Shift+Tab` from `EXCLUDED_KEYS` (F1). Unit-test both in `packages/core/tests/unit/chord-capture.test.ts`.

### Platform-keyed shipped defaults (FR-017e — MUST land with T012, not after it)

> **Why here.** `DEFAULT_KEYBINDINGS` is a flat `Record<action, string[]>` today and `shipped-defaults.ts`
> clones it directly. Reshaping a **shared, already-shipped record** gets dramatically more expensive once
> seven commands and 36 scope sets are stacked on the flat shape. This is the Principle II foreclosure
> FR-017e exists to prevent: a macOS port must be an addition of **values**, never a change of **shape**.

- [X] T103 Unit test in `packages/core/tests/unit/keybindings-platform.test.ts` (SC-010b): the shipped-defaults keybinding record is **keyed by platform**; only the **Windows** values are populated; adding a `darwin`/`linux` key is a change of **values, not shape** (no existing key moves or changes type). Assert **no macOS/Linux chord is guessed** in Part 1.
- [X] T104 Reshape the keybinding shipped-defaults record to be platform-keyed, and update the parse/restore path (`parseKeybindings`, reset-to-default) to resolve the current platform's values. **Bump `SHIPPED_DEFAULTS_VERSION` 2 → 3 UNCONDITIONALLY (I2)** — not "if the on-disk shape changes". The bump is **required regardless** of how the keybinding record is shaped, because T020/T021/T042 add ~150 new shipped **theme colour values** and the additive on-disk upgrade is gated on the version: without the bump, an existing install's theme files **never materialise the new tokens** and code renders unstyled. One bump, one owner (this task); T023 verifies, never re-bumps. **Enumerate the blast radius up front — a shape change to a shared shipped record must NOT discover its consumers at build time** (the same discipline T036 applies to the two version pins). `.bindings` is read by **19** call sites: production — `keybindings.ts`, `shipped-defaults.ts`, `config-watcher.ts`, `shipped-defaults-service.ts`, `config-store.tsx`, `on-entry.tsx`; tests — including the **contract** test `shipped-defaults-fidelity.contract.test.ts` plus `keybindings-metadata.test.ts` and `reset-completeness.test.ts`, which read `.bindings` directly. Update every one, or keep `.bindings` as a resolved-for-this-platform view over the new record so existing readers stay correct by construction.
- [X] T105 Declare the **column-select mouse modifier** per platform in the same record (FR-017e — it is not just the chords). Note T077 mounts CM6's `rectangularSelection()`, which **hardcodes Alt**: pass the modifier from the record rather than accepting CM's default, or the record's platform key is decorative.

### Settings metadata: the `map` control (F5/F6 — without this, the build fails)

- [X] T016 Unit test in `packages/core/tests/unit/metadata-map.test.ts`: a **non-empty** keyed map is **one leaf**, not one leaf per entry. Prove the **current** `leavesOf` explodes it (the Red).
- [X] T017 Add `'map'` to `ControlKind` and `columns?: readonly MapColumn[]` to `FieldDescriptor` in `packages/core/src/config/metadata.ts`; make `settingsLeaves()`/`leavesOf` **stop at a map** (map-ness is **declared, not inferred**).
- [X] T018 Add map arms to `emptyValueFor` and `auditClearable` in `packages/core/src/config/metadata.ts` (F6 — otherwise a clear writes `''` into a `Record` and the audit fails to notice). Unit-test in `packages/core/tests/unit/clearable.test.ts`.
- [X] T019 Give `terminals.defaultParams` the descriptor it has always lacked, in `packages/core/src/config/settings-metadata.ts` — the **pre-existing** JSON-only setting this feature closes rather than steps around (F5 corollary).

**Checkpoint**: `npm run test:unit` green. `resolveAction` is scope-aware; a keyed map is one leaf.

---

## Phase 3: User Story 1 — Language-aware syntax highlighting (P1) 🎯 MVP

**Goal**: open a source file → it is highlighted per its language, detected from the extension, live as
you type, legible on every bundled theme.

**Independent test**: open one fixture per language → each highlights distinctly from plain text. Type →
new text highlights live. Unknown extension → plain text, no error. Type a `#!` shebang → nothing
re-highlights.

### Theme tokens (do these BEFORE the highlighter — the colours are what it renders)

- [X] T020 [P] [US1] Add the 10 syntax tokens (`syntaxKeyword`, `syntaxString`, `syntaxComment`, `syntaxNumber`, `syntaxType`, `syntaxFunction`, `syntaxVariable`, `syntaxOperator`, `syntaxPunctuation`, `syntaxInvalid`) to `THRONG_THEME.colours` in `packages/core/src/config/theme.ts`.
- [X] T021 [US1] Extend `Palette` and `makeTheme()` in `packages/core/src/config/default-themes/index.ts` with the syntax hues, and author a palette **per theme, drawn from that theme's own character**. **A copy-pasted palette provably fails the build** (D4): identical tokens contribute ΔE00 = 0, dragging the distinctness mean to `4.469 × 33/43 ≈ 3.43 < 4.3`.
- [X] T022 [US1] Hand-write copy for each new token in `packages/core/src/config/theme-copy.ts`. It must avoid `BANNED_ABBREVIATIONS` (notably **`bg`/`fg`**) and must **not** equal `mechanicalCopy(key)` — both are asserted by `theme-copy.test.ts`.
- [X] T023 [US1] Confirm the new theme tokens are carried by the **single** `SHIPPED_DEFAULTS_VERSION` bump **owned by T104** (2 → 3). **Do NOT bump again (I3)** — T104 already reshapes the record for the platform-keyed chords, and a second bump in a later phase would either be a no-op or skip an upgrade step. One bump, one owner; this task only verifies that an existing install materialises the new tokens after it.
- [X] T024 [US1] Run `packages/core/tests/unit/theme-quality.test.ts`; **re-measure** `CLOSEST_LEGITIMATE_PAIR_DELTA` in `packages/core/src/config/theme-quality.ts` (it is asserted to 2 dp, so it must be updated even if the gate still passes). Recalibrate `DISTINCTNESS_THRESHOLD` **only** if the closest *legitimate* pair genuinely moved — **never** loosen it to let a lazy palette through.
- [X] T025 [US1] Add the 20 syntax-on-match-background pairings (10 tokens × {`searchMatch`, `searchMatchCurrent`}) to `CONTRAST_PAIRINGS` in `packages/core/src/config/theme-quality.ts` at `WCAG_AA_BODY`. They inherit 009's **existing** policy unchanged — build-blocking on `IN_SCOPE_THEMES`, reported elsewhere — and the gated set is **read from 009's list, never copied** (FR-007a). **Also add the status-strip pairing** — `editorStatusStripFg` on `editorStatusStripBg`, using the **prefixed** names T042 mandates (I4) — at `WCAG_AA_BODY` (H2): **SC-007 promises the language indicator is readable on every bundled theme**, and without a pairing that half of SC-007 is asserted but never measured.
- [X] T026 [US1] Verify theme-token completeness + metadata tests pass (`theme-metadata.test.ts`, `theme-copy.test.ts`) — new colour tokens are auto-exposed in the Themes editor because both derive from `THRONG_THEME`.
- [X] T108 [US1] **Implement the *composing* half of FR-007a, not just the measuring half.** T025 only *measures* contrast; nothing yet makes it true. The search-match decoration MUST render as a **background** layer with the syntax token colour remaining the **foreground** — matched code keeps its highlighting rather than flattening into a solid block. Order the decorations in `packages/ui/src/renderer/search/editor-search.ts` so the match mark sits **below** the syntax layer. E2E in `packages/ui/tests/e2e/editor-search-highlight.e2e.ts`: search a **highlighted code** file and assert the current match still carries its token colours. (Without this, the contrast guard passes while the rendering flattens — SC-007b.)

### Highlighting

- [X] T027 [P] [US1] Create the grammar loader map (id → `() => import('@codemirror/lang-*')`, `StreamLanguage` for the legacy modes) in `packages/ui/src/renderer/editor/language-loaders.ts`. JSONC → the **JavaScript** grammar (CM's `json` rejects comments); `.ipynb` → **JSON** (FR-009).
- [X] T122 [US1] **Prove the loader map is TOTAL over the registry (E2) — SC-001 is the MVP's headline criterion and nothing currently verifies it.** T003 asserts the 31 **descriptors** exist and T033's E2E opens only three fixtures; a descriptor whose loader entry is **missing or typo'd degrades silently to plain text** and every other test still passes. Add: (a) a unit test in `packages/ui/tests/unit/language-loaders.test.ts` asserting **every registry id has a loader entry and there are no orphan loaders** (a set-equality assertion, ~10 lines); and (b) an integration test that **each loader actually resolves** and yields **non-plain tokens** against a small per-language fixture. Cheaper and far stronger than 31 E2E cases — this is the difference between SC-001 being *asserted* and being *true*.
- [X] T028 [P] [US1] Create `HighlightStyle.define([...])` mapping `@lezer/highlight` tags to `color: 'var(--throng-colour-syntax*)'` in `packages/ui/src/renderer/editor/highlight-style.ts`. CSS vars are what make a theme change repaint code **live** with no view rebuild.
- [X] T029 [US1] Mount `syntaxHighlighting(...)` + a language `Compartment` in `packages/ui/src/renderer/editor/use-editor.ts`; swap the language extension in place when the effective language changes (no view rebuild → FR-004b's "without reopening").
- [X] T030 [US1] Apply the same extension set to the second CodeMirror view in `packages/ui/src/renderer/editor/standalone-editor.tsx` (the preferences JSON editor) — it must not silently miss highlighting. **Ship E2E for it (C2)**: this is user-facing UI, so assert in a preferences E2E that the settings/keybindings/theme **JSON editor is syntax-highlighted** — which is exactly FR-001a's point, that throng's own config files are among the files a user is most likely to open.
- [X] T031 [US1] Implement the **long-line guard** (FR-008a) in `packages/ui/src/renderer/editor/highlight-style.ts`: any single line **> 10,000 chars** renders as unhighlighted plain text while the **rest of the document highlights normally**; the line stays fully editable. Threshold is **fixed, not configurable**.
- [X] T032 [US1] Integration test in `packages/ui/tests/integration/language-detect.integration.test.ts`: opening a document resolves the effective language through the precedence chain and re-runs detection **only** on identity/content replacement (rename, Save-As, revert, external reload) — **never** while typing (FR-002a).
- [X] T033 [US1] E2E in `packages/ui/tests/e2e/editor-highlighting.e2e.ts`: open `.ts`/`.py`/`.json` fixtures → highlighted (assert on `.cm-line` token spans, not screenshots); type → live highlight; unknown extension → plain text, no error; type a `#!` shebang → language unchanged; `bundle.min.js` long line → unhighlighted but editable; switch theme → colours repaint live. **Also cover the mixed-language SHOULD (U1)**: open a **Vue SFC** and an **HTML file with embedded `<script>`/`<style>`** and assert the embedded regions highlight (best-effort per the Edge Cases — `lang-vue`/`lang-html` support it). If a grammar does not, the outer language's highlighting is acceptable and **no error** may be raised — assert *that* instead, so the SHOULD is either verified or explicitly recorded as best-effort, not silently assumed.

**Checkpoint**: US1 is independently shippable — highlighting works and is legible on every theme.

---

## Phase 4: User Story 5 — Correct a wrong language guess (P3, pulled early)

Pulled ahead of P2 because the status strip is the **only** way to observe US1's result, and the override
is what makes an undetectable file usable.

**Independent test**: open an extension-less file → strip reads "Plain Text" → click → pick a language →
re-highlights immediately → restart → still overridden.

### Persistence (v7 migration + RPC)

- [X] T034 [P] [US5] Integration test in `packages/persistence/tests/integration/migration-v7.integration.test.ts`: the migration is **idempotent** (re-running it, and running it against an already-migrated store, converge on the same state); `LATEST_VERSION` becomes 7; `document_state` + its index exist.
- [X] T035 [US5] Write the v7 migration in `packages/persistence/src/migrations/v7-document-state.ts` and register it in the `MIGRATIONS` array in `packages/persistence/src/migration-runner.ts` (`LATEST_VERSION` is **derived**, so it bumps automatically). A fresh `CREATE TABLE` needs **no** schema-guard registration; a column added to it later would.
- [X] T036 [US5] **Retire BOTH version pins** — `packages/persistence/tests/integration/no-editor-migration.integration.test.ts` (named by the spec) **and** `packages/persistence/tests/integration/user-version-pin.integration.test.ts` (**not** named, and would fail identically — F7). Rewrite them to assert the **new** intent (an editor table now legitimately exists at v7). This is an explicit, reviewed reversal of 006's decision — **never a quiet deletion to make a migration pass**.
- [X] T037 [P] [US5] Implement `DocumentStateRepository` in `packages/persistence/src/document-state-repository.ts`; export from `packages/persistence/src/index.ts`.
- [X] T038 [P] [US5] Define the `document.*` DTOs in `packages/ipc-contract/src/document.ts`; re-export from `packages/ipc-contract/src/index.ts`.
- [X] T039 [US5] Integration test in `packages/daemon/tests/integration/document-ipc.integration.test.ts` (follow `projects-ipc.integration.test.ts`): set→get round-trip; `null` deletes; **a stale id round-trips unchanged** (FR-005b); `'plaintext'` is stored as a real row and **not** collapsed to null (FR-004c); prune drops only missing paths; **deleting the project cascades**; and **a rename/move within throng carries the row with the file** (SC-013a — G4; otherwise renaming a file silently drops its override).
- [X] T040 [US5] Implement `DocumentIpcService` in `packages/daemon/src/document-service.ts` and register it on the router in `packages/daemon/src/composition-root.ts`. The client **never sends the owner** — the daemon resolves it from `IUserContext`.
- [X] T041 [US5] Add the renderer client in `packages/ui/src/renderer/state/document-client.ts` and wire it into `Services` in `packages/ui/src/renderer/composition-root.tsx`. No change is needed to `throng:rpc`, the preload, or `DaemonClient` (it is generic).
- [X] T119 [US5] **Implement `document.movePath` (E1) — T039 already tests this and nothing makes it green.** FR-028e requires *"a rename or move within throng MUST carry the row with the file"*; without it a rename **silently discards the user's language override**. Add the method to `packages/ipc-contract/src/document.ts`, `DocumentStateRepository` and `DocumentIpcService` as a **single atomic `UPDATE`** — *not* a client-side get→set-new→delete-old sequence, which is three round-trips with two crash windows in which the override is duplicated or lost. `moved: false` when there is no row is the **common case, not an error**.
- [X] T120 [US5] **Wire the two callers of `document.movePath` (E1) — the part that is easy to forget.** Both paths that change a file's project-relative path must call it or the override is lost: (a) the **File Explorer's rename/move** (`file.rename` and drag-move within the tree); (b) the editor's **Save-As** (`editor-coordinator.save`, which already re-points the open registry — do it there). Integration-test both.
- [X] T121 [US5] **Remove the row when a file is deleted in throng (E4).** FR-028e says *"deleting the file removes it"*, but `document.pruneMissing` is explicitly opportunistic and "never on the open path" — so nothing removes the row at delete time, and **a file later re-created at the same path silently inherits the old override**. Delete the row on `file.delete`. (Prune remains the backstop for files removed **outside** throng.)
- [X] T123 [US5] **Give `document.pruneMissing` a caller — it has an implementation and a test but nothing invokes it.** FR-028e requires rows for vanished files be **pruned** *"so the table cannot grow without bound"*, and SC-013a asserts exactly that — but T037–T040 only *implement* prune, and T121's own aside ("prune remains the backstop for files removed **outside** throng") assumes a caller no task creates. Without one, **FR-028e/SC-013a ship unmet**. Invoke it **on project open** (once, off the critical path — FR-028e forbids it on the open path, so it must not block the first file opening), passing the project's current file list. Integration-test that a row whose file was deleted **outside** throng is removed on the next project open.

### Status strip & picker

- [X] T042 [P] [US5] Add the 3 status-strip tokens — name them **`editorStatusStripBg` / `Fg` / `Hover`** — to `theme.ts`, `default-themes/index.ts` and `theme-copy.ts`. The active/inactive treatment **reuses 012's** `activePanelBorder`/`activePanelBorderInactive` — **do not** invent a parallel pair (FR-010g). **The `editor` prefix is deliberate (L1)**: the theme already ships **`statusBarBg`** for the *app chrome*, and a bare `statusStripBg` sits one letter away from it. `theme-copy` forbids a description that merely restates its identifier, so the copy must actively distinguish *"the strip along the bottom of an editor panel"* from the application's status bar.
- [X] T043 [US5] Build the status strip in `packages/ui/src/renderer/editor/status-strip.tsx` (right-aligned language label). Make `.editor-panel-wrap` a flex column and `.editor-panel` `flex: 1 1 auto; min-height: 0` in `packages/ui/src/renderer/editor/editor.css` so the strip sits below the text area without overlaying it. It must dim with its panel (mirror the `isActiveDimmed` pattern in `panel-placeholder.tsx`), truncate its label in a narrow panel, and never collapse the text area.
- [X] T044 [US5] Build the searchable language picker in `packages/ui/src/renderer/editor/language-picker.tsx` — filterable across all supported languages **plus Plain Text**, marking the currently effective language, applying immediately on selection.
- [X] T107 [US5] **Themeable icon control**: the language indicator is a **clickable action control**, so its colours MUST derive from theme tokens and it MUST carry a **hover title** naming the action ("Set language"). No hardcoded CSS colour, no inline SVG (constitution, NON-NEGOTIABLE). Its *label* is the language name — that is data, not a control label, so the icon rule's text-label ban does not apply to the name itself.
- [X] T045 [US5] Wire the override end-to-end: selecting a language persists via `document.setState` and re-highlights immediately; on open, the override is read and **outranks** detection (FR-005a). A panel opening the file **later adopts it** rather than re-detecting.
- [X] T046 [US5] E2E in `packages/ui/tests/e2e/editor-language-override.e2e.ts`: strip shows the language; extension-less file reads "Plain Text"; click → filter → choose → re-highlights + strip updates + indentation profile switches; **restart → still overridden**; a persisted id the registry no longer knows → opens **without error** as plain text and the **stored id is preserved**. **Also assert the themeable-icon rule (CA1)**: the indicator resolves its colours from **theme tokens** and carries a **hover title** — the constitution's rule is NON-NEGOTIABLE and code-review-gated, and its failure mode (a hardcoded colour or inline SVG creeping back) is exactly what a guard catches. **And count the clicks (U2/SC-004a)**: the language is reachable and changeable in **at most two clicks** from both entry points — SC-004a states a measurable bound, so measure it rather than merely exercising the journey. **Plus the two strip behaviours T043 implements but nothing asserts (G1)**: (a) the strip **dims with its panel** under 012's inactive treatment when the panel is not active or the window is backgrounded (FR-010g) — a strip left brightly lit while every other panel dimmed would contradict 012's indicator; and (b) in a **narrow** panel the label **truncates** rather than overflowing, and in a **short** panel the strip still renders **without collapsing the text area to zero height** (FR-010c + Edge Cases).

**Checkpoint**: a user can see and correct the language, durably.

---

## Phase 5: Clipboard seam + mode record (blocks US2/US3/US6)

- [X] T047 [P] Define `IClipboard` in `packages/core/src/abstractions/clipboard.ts`; export from `packages/core/src/index.ts`.
- [X] T048 [P] Write `runClipboardContract(name, make)` in `packages/core/src/testing/clipboard-contract.ts`; export from `packages/core/src/testing/index.ts` (the `@throng/core/testing` subpath only — **not** the production entry). Cases: round-trip (ASCII/Unicode/CRLF); overwrite; empty is legal; never throws; **line endings survive verbatim** (normalisation is a document concern, FR-023a); idempotent read.
- [X] T049 Implement `ElectronClipboard` in `packages/ui/src/main/electron-clipboard.ts`, **constructor-injecting** Electron's `clipboard` module so the contract test can drive a fake. It lives in UI main, **not** `platform-windows` (that package has no Electron dependency — precedent: `ElectronDisplayInfo`).
- [X] T050 Contract test in `packages/ui/tests/contract/electron-clipboard.contract.test.ts` running `runClipboardContract` against `ElectronClipboard` with an in-memory fake.
- [X] T051 Bind `UI_TYPES.Clipboard` in `packages/ui/src/main/composition-root.ts` (one container per boundary — Principle IX).
- [X] T052 **Route the three existing unseamed clipboard calls** in `packages/ui/src/main/terminal-ipc.ts` (`writeText` ~:201, `readText` ~:207, the `clipboardWrite` handler ~:220-223) through the seam. Leaving them would make the abstraction a **fiction**. **Then guard it (M2/SC-011c)**: add an ESLint `no-restricted-imports` rule confining Electron's `clipboard` to `electron-clipboard.ts`. SC-011c claims **every** OS clipboard access goes through the abstraction — without a guard it decays exactly as the three unseamed calls already prove it does, and the next feature reintroduces a direct call with nothing to stop it.
- [X] T053 [P] Unit test in `packages/core/tests/unit/clipboard-mode.test.ts`: the mode is decided by the **selection**, not the command (FR-016b) — rectangular ⇒ `rectangular`; **every** cursor a bare caret ⇒ `full-line`; anything else, including a **mixed** set ⇒ `verbatim`.
- [X] T054 Implement the mode decision in `packages/core/src/editor/clipboard-mode.ts` (pure).
- [X] T055 Implement the app-global mode record + paste-mode decision in `packages/ui/src/main/clipboard-service.ts`: one in-memory `{text, mode}` shared by every panel in every window, **validated against the live OS clipboard on every paste** — any mismatch ⇒ verbatim. Self-correcting: **no polling, no clipboard observer** (SC-011a). Expose over IPC; never persisted, no daemon RPC.
- [X] T056 Integration test in `packages/ui/tests/integration/clipboard-mode.integration.test.ts`: the mode survives crossing panels/windows, but **any** other source touching the clipboard makes the next paste verbatim.

---

## Phase 5b: The document authority & undo foundation (BLOCKS Phases 6–9)

**This lands *before* the editing commands, deliberately.** Every command in Phases 6–9 asserts *"one
command = one Undo"* (FR-026). If those assertions run against CodeMirror's **local `history()`**, a later
phase deletes it and **every one of those green bars becomes meaningless** — the work would be done,
invalidated, and redone. Build the mechanism first, then assert against the real thing once.

**Two violations are being fixed here, not one** (research F8/D7, constitution **XI** v3.15.0):

1. **Separate undo stacks.** Mirrored views mount **separate `EditorView`s with separate `history()`** —
   **FR-026c is violated in the shipped code**.
2. **Two originals.** They reconcile by **whole-document replace**: each view is **its own source of
   truth**. That is **peer-to-peer reconciliation between co-equal copies**, which Principle XI forbids
   **by name** — and **FR-028f** replaces it with a single authority in UI main.

> ⚠️ **Do NOT "just relay ChangeSets".** Swapping the whole-document relay for a `ChangeSet` relay
> *without a version and a rebase* is **worse than what ships today**: a change that was **in flight**
> against a since-superseded version lands **at the position it originally named**, silently corrupting
> text — where whole-doc replace was crude but internally consistent. The version and the rebase are the
> point, not a refinement. *(An earlier draft of T086 said exactly this and would have built the forbidden
> design; caught by `/speckit-analyze` on 2026-07-13.)*

- [X] T084 [P] Unit test in `packages/ui/tests/unit/undo-service.test.ts`: one command = **one** entry regardless of cursors/rows; bounded at **≥ 500** entries, oldest discarded; survives a **save** (undo past it re-dirties); **cleared** by revert/external reload and by the last view closing.
- [X] T124 [P] **Contract test FIRST** in `packages/ui/tests/contract/document-authority.contract.test.ts`, per `contracts/document-authority.md`: a change whose `baseVersion` **equals** `version` applies directly; a **stale** `baseVersion` is **rebased** (`ChangeSet.map`) and lands at the **mapped** position, not the one it originally named; a `baseVersion` **ahead** of `version` **throws** (a replica cannot outrun its authority — guessing would corrupt the document); `dirty` is **derived** (`version !== savedVersion`) and a view-supplied `dirty` is **rejected**. Red first — no authority exists yet.
- [X] T125 **Implement the document authority** in `packages/ui/src/main/document-authority.ts` (**FR-028f**, constitution XI): it owns the **canonical text**, a **monotonic `version`**, and `savedVersion`. `dispatch({documentId, panelId, changes, baseVersion, selectionBefore})` → serialise in arrival order, **rebase** a stale change via `ChangeSet.map()`, apply, `version++`, and **broadcast `{changes, version, dirty, echoTo}` to EVERY view — including the originator**, whose optimistic copy is now wrong when a rebase changed it. **Never reject a stale change**: the view has already shown the user their keystroke, and rejecting would visibly revert input they watched themselves type (FR-028f). Key by **`documentId`** (aliased to `panelId` in Part 1 — data-model §7), never by view.
- [X] T126 **Integration test — SC-013b, the race, CONSTRUCTED not observed** in `packages/ui/tests/integration/document-authority.integration.test.ts`: dispatch a change from view A **and** view B **both tagged with the same `baseVersion`**, and assert the resulting document contains **both** edits, each **intact and correctly placed**. A race that only fires under real timing **passes in CI and corrupts a user's file in the field** — so build it deterministically, do not wait for it.
- [X] T085 Implement the document-level undo history in `packages/ui/src/main/undo-service.ts`, **owned by the authority** (T125): entries of `{changes, inverted, selectionBefore}` keyed by **document**; undo pops, broadcasts the **inverted** ChangeSet through the authority's canonical stream to every view, and returns the recorded cursor set to the **invoking** panel only (FR-026f) — other panels keep their own cursors.
- [X] T086 **Delete the whole-document-replace relay** in `packages/ui/src/main/editor-coordinator.ts` + `use-editor.ts` and route every edit through the authority (T125): the view **echoes locally at once** (typing MUST NOT wait for a round trip), sends `{changes, baseVersion, …}`, and applies the canonical stream with **`addToHistory: false`**. Remove the local `history()` from the extension list. **`dirty` is no longer relayed** — it arrives derived from the authority (FR-028f); 006's `{text, dirty}` relay is **removed, not adapted**.
- [X] T116 **RE-WIRE THE UNDO TRIGGER — without this, removing `history()` silently breaks Undo.** CodeMirror's `undo`/`redo` commands operate on the `history()` state field that T086 deletes, so **native `Ctrl+Z`/`Ctrl+Y` become dead no-ops** — and FR-017c *requires* those stay **native and unregistered**. Replace CM's `undo`/`redo` **keymap entries** with dispatches to `undo-service.ts`, installed at **`Prec.highest`**. The E2E must actually **press Ctrl+Z / Ctrl+Y** and assert the document reverts/reapplies — merely counting stack entries would pass against a **dead trigger**. **Scope: the keymap only.** The content menu's Undo/Redo (FR-026b) dies the same way, but that menu does not exist until **T057** in Phase 6 — a Phase-5b task cannot wire a Phase-6 artifact, so **T057 owns that half** and says so.
- [X] T087 Integration test in `packages/ui/tests/integration/undo-shared.integration.test.ts` — **this file's owner**: two **mirrored views** share **one** stack (Undo in view B reverts an edit made in view A, dirty state updates in both — FR-026c); two panels on **different files** have **entirely separate** stacks (FR-026e). *(Moved here from Phase 10 on 2026-07-13: this is the **central proof** of FR-026c, and it was landing **five phases after** the checkpoint that already declared constitution XI satisfied. A checkpoint that asserts a guarantee it has not tested is a green bar that means nothing.)*
- [X] T117 **Re-base 013's replace-all onto the new undo stack.** The spec requires 013's replace-all — *"a single undoable step"* — to **join this feature's per-document undo stack** under the same atomicity and cursor rules (FR-026/FR-026e/FR-026f). It currently relies on the CM `history()` that T086 deletes, so it would become **un-undoable**. Route it through the authority as **one atomic entry**, **extending** T087's `undo-shared.integration.test.ts` (T087 creates it; this adds the replace-all case). **This is also why an edit lock was rejected** (FR-028f): replace-all originates from a view that may not hold focus.

- [X] T127 **E2E — prove constitution XI to a *user*, not just to a unit test** (`packages/ui/tests/e2e/editor-mirrored-undo.e2e.ts`, SC-013). Everything else in this phase asserts the authority through its API; this is the only test that shows a person the rule holds. **Mirror an Editor Panel into a sub-workspace window** (006 FR-034) so one file has **two views**. Type in view **A** → view **B** shows the edit. **Press Ctrl+Z in view B** → it reverts **A's** edit (one shared stack, FR-026c) and **both** views update. Assert the **dirty state agrees in both**, and that **scroll/cursor stay independent** (view state is per view, FR-028c). Principle V requires *every* user-facing UI change to ship E2E coverage, and the mirrored-view guarantee is the headline of FR-028 — without this, SC-013 is asserted only at integration level. *(Added 2026-07-13: `contracts/document-authority.md` **named this test** and no task delivered it — a contract naming a test nobody builds is how a guarantee ships unverified.)*

**Checkpoint**: there is **one** authority, **one** ordered change stream, and **one** undo stack; a stale
in-flight change **rebases** rather than corrupting; dirty state is **derived**; Undo is driven by native
Ctrl+Z; and a **mirrored view proves it end-to-end** (T127). Constitution XI is now satisfied — both
clauses. Every later phase's *"one command = one Undo"* now means something.

---

## Phase 5c: Focus scoping (BLOCKS Phases 6–9)

**This is not polish, and it is not optional.** T015 (Phase 2) removes **`Tab`** from `EXCLUDED_KEYS` and T072
(Phase 8) binds `indent-lines` to it. Between those two, **nothing stops `Tab` indenting the document while
013's find bar has focus** — an editing command silently mutating the file while the user types a search term.
The guard must exist **before** the chord does. (Same class of mistake as the undo ordering, caught the same
way.)

- [X] T093 Lift the duplicated active-panel/kind computation out of `editor-chrome.tsx` and `search-keybindings.tsx` into one scope provider in `packages/ui/src/renderer/keybindings/scope.ts`, and thread it into the scope-aware `resolveAction`. ~~**Delete `reservedByTerminal`** (`search-actions.ts:55-59`) — a hand-rolled, hard-coded terminal-scope table that `scope` now subsumes (DRY, Principle VIII).~~
  > **AMENDED 2026-07-13 — `reservedByTerminal` is KEPT, and the deletion this task ordered would have broken the shell.** The scope provider landed in Phase 2 (pulled forward, since making `resolveAction` scope-aware broke five call sites), and `editor-chrome.tsx`, `search-keybindings.tsx` and `terminal-panel.tsx` all resolve through it. The deletion is the part that was wrong. `reservedByTerminal` is **not** a scope table: scope answers *"is this command live here?"*, it answers *"does throng take this key, or does the SHELL?"*, and a key can belong to a command that is live in a terminal and still belong to the program. `COMMAND_SCOPES` marks `search.replace*` and `editor.save*` as live in a terminal — so replacing this with `resolveAction(kb, ev, 'terminal') !== null` would have thrown away **Ctrl+H (backspace)**, **Ctrl+S (XOFF)** and, with no find bar open, **Escape (vim's insert mode)**. Its default is DENY — the shell keeps a key unless there is a specific reason to take it — and that is now pinned by a test (`search-actions.test.ts`, "is NOT a scope table") and stated in the function's own doc comment, so the next reader does not try to DRY it away again.
- [X] T094 Implement focus-scoped dispatch (FR-017f): while a transient input surface inside the panel holds focus — **013's find bar above all** — that surface's keys win and none of the seven commands fire. **Tab in the find bar must move within the bar, never indent the file.**
  > Implemented in `scope.ts` (`transientInputFocused` + `resolveScoped`) and unit-tested in `scope.test.ts`: with the guard down, `Tab` resolves to `editor.indentLines`; with it up, to nothing — while a **window** command (zoom, move-focus) still resolves, because a user must be able to leave a panel from inside its find bar. The E2E half must land with **T072**, which is what first binds `Tab` to a command that can actually mutate the document; asserting it before then would be asserting against a command that does not exist.
- [X] T109 **FR-024b — 012's window-level chords MUST outrank editor-scoped commands.** Not theoretical: T062/T072/T078 install the seven at **`Prec.highest` inside CodeMirror**, which is *exactly* the mechanism by which an editor swallows a window-level chord. The shipped defaults don't collide (012 = `Ctrl+Alt+Arrow`, this = `Shift+Alt+Arrow`), but a **rebind** can create the collision the FR forbids. Intercept 012's move-focus/zoom chords **ahead of** the editor keymap in `packages/ui/src/renderer/keybindings/scope.ts`. E2E (with T096): a move-focus chord reaches 012 even with an editor focused, **and even when a seven-command rebind lands on it**.
  > Implemented as `windowChords()` + `editorChordsFor()` in `scope.ts`, enforced by **OMISSION**: a chord 012 owns is never bound inside CodeMirror at all, so the keypress is not handled there, is not `preventDefault`ed, and reaches the window listener exactly as it would with no editor focused. A runtime guard inside each handler would work too, but it would have to be remembered by every one of the seven — and forgetting it in one is invisible until a user rebinds that one command. **Phases 7–9 must build their keymaps from `editorChordsFor`, not from `kb.bindings[action]` directly.** Unit-tested in `scope.test.ts` (the shipped defaults do not collide, so the rule is proven against a *rebind* that makes them collide — nothing in the shipped app would ever exercise it).

**Checkpoint**: chords resolve by scope *and* input focus. `Tab` is now safe to bind.

---

## Phase 6: User Story 2 — Right-click editing menu (P2)

- [X] T057 [US2] Build the editor **content** context menu in `packages/ui/src/renderer/editor/content-menu.ts` via the existing `useContextMenu()` provider: Cut, Copy, Paste, Select All, Undo, Redo, **Set Language…** (FR-012). It must be **distinct** from 006's panel-header menu, which is unchanged (FR-014). **Wire its Undo/Redo to `undo-service.ts`, NOT to CodeMirror's `undo`/`redo`** — T086 deleted the local `history()` those commands operate on, so a menu item bound to them is a **dead no-op** (FR-026b). T116 did the keymap half; this is the menu half, and it must land here because the menu does not exist until now.
- [X] T058 [US2] Implement caret/selection behaviour (FR-012a): right-click **inside** a selection **preserves** it; **outside** collapses it and moves the caret to the click point.
- [X] T059 [US2] With **no selection**, the menu's Cut/Copy act on the caret's **whole line** and set the **full-line** marker (FR-012b) — never disabled for want of a selection.
- [X] T060 [US2] E2E in `packages/ui/tests/e2e/editor-content-menu.e2e.ts`: mouse-only cut/copy/paste; selection preserved inside / collapsed outside; no-selection Copy → paste mid-line inserts a whole line **above**; the panel-**header** menu still shows Save/Revert and the two do not collide.

---

## Phase 7: User Story 3 — Ctrl+X cuts the current line (P2)

- [X] T061 [P] [US3] Unit test in `packages/core/tests/unit/cut-line.test.ts`: multi-cursor semantics (FR-016a) — each cursor with a selection cuts **exactly** that selection; each bare caret cuts its **whole line**; a partial selection is **never** expanded to a whole line; full-line marker set **only** when **every** cursor is bare; bare carets' lines joined in **document order** by a single newline.
- [X] T062 [US3] Implement `cut-line` as a CodeMirror command in `packages/ui/src/renderer/editor/commands.ts`, installed as a **`Prec.highest` keymap** (F3 — CM's `defaultKeymap` already owns `Shift-Alt-Arrow`, and a window-level listener would lose to CodeMirror).
- [X] T063 [US3] Implement full-line paste (FR-015a): a full-line entry inserts as a **whole line immediately above the caret's line**, leaving that line **unsplit**. Handle the **last line with no trailing newline** cleanly (FR-017).
- [X] T064 [US3] Normalise incoming pasted line endings to the **destination document's** effective ending (FR-023a) — a paste must never make a file mixed. Do **not** repair an already-mixed file (FR-023b).
- [X] T065 [US3] E2E in `packages/ui/tests/e2e/editor-cut-line.e2e.ts`: no-selection `Ctrl+X` cuts the line; paste mid-line inserts **above** without splitting; copying in **another app** invalidates the marker → verbatim paste; rebinding `cut-line` moves the whole behaviour and **`Ctrl+X` reverts to native cut**; and in the **File Explorer**, `Ctrl+X` still cuts a **file** (the scopes are disjoint — the headline proof that D6 works). **Also assert (G4/FR-015)**: the text throng writes to the OS clipboard carries a **trailing line break in the document's effective line ending** — a CRLF document puts CRLF on the clipboard, so pasting into another application yields the line correctly terminated (SC-009a).

---

## Phase 8: User Story 4 — Per-language indentation (P2)

- [X] T066 [P] [US4] Extend `EditorSettings` in `packages/core/src/config/app-settings.ts` with `indent`, `indentByLanguage`, `languageByExtension`, `persistUndoHistory`. Write **tolerant map parsers** on the `terminals.defaultParams` precedent (an explicit `{}` is **honoured**; a non-record falls back; bad entries are dropped **per-entry**), and make `structuredCloneSettings` **deep-clone** the two maps (it does a shallow `{...s.editor}` today — the frozen shipped record would otherwise leak shared references).
- [X] T067 [P] [US4] Add descriptors in `packages/core/src/config/settings-metadata.ts` for the two maps (`control: 'map'` + `columns`), the global `indent` profile, and the `persistUndoHistory` toggle. Declare **clearability honestly** (FR-022c): `languageByExtension` **IS** clearable (ships empty; falls back to the registry); `indentByLanguage` is **NOT** (ships non-empty; emptying it is a reset dressed as a clear).
- [X] T068 [US4] Unit test in `packages/core/tests/unit/settings-maps.test.ts`: completeness passes with the maps as **one leaf each**; `clearable` round-trips an empty value through the tolerant parser (`auditClearable`); resetting `editor.indentByLanguage` **restores the shipped set** (Go → tabs, Python → 4 spaces) while resetting `editor.languageByExtension` **clears** it (FR-022b).
- [X] T069 [US4] Build the generic keyed-table control in `packages/ui/src/renderer/preferences/map-control.tsx`: add/remove rows, a key column, typed value columns reusing existing controls. **Key validation from the descriptor** — keys unique, an extension key a valid dot-prefixed suffix, values constrained to the allowed set; an invalid/duplicate key is **rejected**, leaving the previous mapping standing.
- [X] T106 [US4] **Themeable icon controls (constitution, NON-NEGOTIABLE)**: the map control's **add-row / remove-row** affordances are *action controls*, so they MUST be **theme icon tokens with hover titles** — never text labels, inline SVG, or hardcoded colours. **REUSE the existing `add` and `destroy` icon tokens** — the theme already ships 41, including both. **Do NOT add new `rowAdd`/`rowRemove` tokens**: a third token set would contradict the spec's *"this feature's theme keys, in full — two sets, and only two"*, would need shipped values in all 15 bundled themes plus a place in 010's record (or 014's *Restore All* leaves the buttons **glyphless**), and buys nothing an existing token does not already give. Reuse over widening. While in `settings-tab.tsx` (T071), also fix its pre-existing **`ClearIcon` inline-SVG violation** — the constitution's own amendment says the known violations in `settings-tab.tsx` / `preferences-app.tsx` are *"remediated by the next change that touches those controls"*, and this feature is that change.
- [X] T070 [US4] Add `case 'map':` to the dispatch in `packages/ui/src/renderer/preferences/form-controls.tsx`. **Beware the `default:` arm** — an unhandled kind silently degrades to a text field, so a `map` descriptor without this case renders `[object Object]`.
- [X] T071 [US4] Fix `canClear` in `packages/ui/src/renderer/preferences/settings-tab.tsx` to handle a map (it tests `value !== ''` today, so it lights the clear button on an already-empty map — F6), and generalise the `options` prop so the language dropdown's values come from the registry.
- [X] T072 [US4] Implement `indent-lines` / `outdent-lines` commands in `packages/ui/src/renderer/editor/commands.ts` (`Prec.highest`): no selection → insert the **effective** indentation; with a selection → indent/outdent **every line the selection touches** (never replace it); outdent on a line with no leading whitespace is a **no-op**, not an error. With multiple cursors, each touched line is adjusted **exactly once**.
- [X] T073 [US4] Wire effective indentation into the editor (`indentUnit`, `tabSize`) in `use-editor.ts`: inferred style ?? language profile ?? global default. Changing a setting updates open editors **with no inferred style** without reopening; those **with** one keep it (FR-021). The tab display width **never rewrites existing content** and never dirties a document (it *is* the tab stop for FR-025c1's padding — see T079). **Own FR-020 explicitly (E3)**: **auto-indentation on Enter** must use the document's **effective** style. It is probably free from `indentUnit` for the Lezer grammars — but for the **10 `StreamLanguage`-backed** languages (C#, Kotlin, Swift, Dart, Ruby, Lua, PowerShell, Shell, TOML, INI) it may not be, and no other task owns it. Verify per-grammar and supply an `indentService` fallback where the grammar provides none; T075's E2E asserts it.
- [X] T074 [US4] Guard FR-018d in `packages/ui/tests/integration/indent-infer.integration.test.ts`: opening a document **never modifies an existing line** and **never marks it dirty**. This is the requirement most likely to be broken silently.
- [X] T113 **FR-023 regression guard — 006's fidelity must survive this feature.** Highlighting, indentation, the content menu and column editing must not compromise **encoding and line-ending fidelity on save**. In `packages/ui/tests/integration/editor-fidelity.integration.test.ts`: open → edit one line → save, and assert every **untouched** line is **byte-identical** and the encoding/BOM round-trips, for a UTF-8-BOM file, a CRLF file, and an **already-mixed** file (which must stay **exactly as mixed as it was** — FR-023b; auto-repair would corrupt the very fixtures 006's fidelity guarantee depends on).
- [X] T075 [US4] E2E in `packages/ui/tests/e2e/editor-indentation.e2e.ts`: tab-indented file → Tab inserts a tab even when the language says spaces; 4-space file whose language says 2 → 4 spaces; unindented Go → tab; selection + Tab/Shift+Tab indents/outdents every line; changing tab display width re-renders with **no content change and no dirty state**. **Also assert FR-020 (G6)**: pressing **Enter** inside an indented block auto-indents using the document's **effective** style (a tab in a tab-indented file) — SC-006 claims this and nothing currently asserts it. **And the other half of FR-021 (U2)**: changing a language's indentation setting updates open editors with **no inferred style**, while an editor **with** an inferred style **keeps it** — the E2E currently asserts only the tab-display-width half, leaving the "inferred style wins" rule (the whole point of FR-018c) unverified.
- [X] T076 [US4] E2E in `packages/ui/tests/e2e/preferences-map-control.e2e.ts`: both maps render in the keyed-table control; duplicate/invalid keys rejected; reset **clears** the extension map and **repopulates** the indentation map. **Also cover the third map (C2)**: `terminals.defaultParams` now has a descriptor (T019), so a **new control appears in the Settings editor** — a user-facing change that Principle V requires be exercised. **And the themeable-icon rule (CA1/G2)**: the add-row / remove-row affordances resolve their glyph from the existing **`add`/`destroy` theme icon tokens** and their colours from theme tokens, and carry **hover titles** — no text label, no inline SVG, no hardcoded colour. **Include the `clear` affordance** that T106 remediates from its pre-existing inline-SVG violation: it is a user-facing control change and Principle V does not exempt a fix from coverage. **And the headline journey (G3/SC-001a/US1 AS8)**: remap `.h` → **C** in the map control, and assert **already-open `.h` editors re-highlight as C without being reopened** — the compartment swap of T029 is implemented but never exercised end-to-end, and this is the journey the requirement actually promises.

---

## Phase 9: User Story 6 — Column (rectangular) selection (P3)

- [X] T077 [US6] Mount CodeMirror's `rectangularSelection()` + `crosshairCursor()` in `use-editor.ts` — **Alt+drag is provided by CM6 itself** (FR-025), so the mouse gesture is nearly free. It is **not** a command and must not appear in the Key Bindings editor.
- [X] T078 [P] [US6] Implement the four `column-select-*` commands in `packages/ui/src/renderer/editor/commands.ts`, defaults **`Shift+Alt+Arrow…`** (canonical order — F2), installed at `Prec.highest` so they beat CM's `defaultKeymap`, which binds `Shift-Alt-ArrowUp/Down` to `copyLine` (F3).
- [X] T079 [P] [US6] Unit test in `packages/core/tests/unit/rect-paste.test.ts`: column-wise paste (row *n* at the caret's column on the *n*-th successive line); extends past the last line; **padding uses the document's effective indentation character** — spaces, or **tabs to the last whole tab stop then spaces** (FR-025c1) — and pads **only** lines shorter than the paste column, never rewriting existing content. **The tab stop is the TAB DISPLAY WIDTH** (FR-018e, clarified) — assert this explicitly; it decides bytes on disk, and the indent width is the wrong answer. **Also assert (G5/FR-025f)**: rows falling on **short lines** that never reach the block's column range contribute **empty** content and raise **no error**, on copy, cut **and type-replace**. **And (G4/FR-025b)**: the text written to the OS clipboard joins rows with the **document's effective line ending** — a CRLF document yields CRLF-joined rows, not LF.
- [X] T080 [US6] Implement per-row semantics (FR-025g) **and the rectangular CUT path (C1/FR-025e)** — no other task owns the cut end-to-end: **cutting** a block removes **only the block's characters** (each row's fragment), closing each line up **horizontally**, and the entry is marked **rectangular** — never full-line — **whichever action performed it** (`cut-line`, the content menu, or the native binding: the *selection* decides the mode, FR-016b). Delete/Backspace do the same **without** writing to the clipboard (on a **zero-width** block, one char left/right of each caret); Enter and any typed char replace **every row** — each as **one atomic undo entry**.
- [X] T081 [US6] Implement paste-into-block by mode (FR-025h): a **rectangular** entry row-for-row; a **verbatim** entry whose line count **equals** the row count distributed **one line per row** (the **only** route for external column data to enter a block); a verbatim entry with a differing count replaces **every row** with its full content; a **full-line** entry collapses the block and inserts **above**.
- [X] T082 [US6] Extend 013's seed-from-selection (FR-025i) in `packages/ui/src/renderer/search/`: a **one-row** block seeds; a **multi-row** block, or a multi-cursor set with more than one non-empty selection, seeds **nothing**. Never pick an arbitrary "primary" selection. **Ship tests (C1 — Principle V is NON-NEGOTIABLE and this is a user-facing change to 013's find bar)**: a unit test for the seed rule in `packages/core/tests/unit/seed-selection.test.ts`, **plus** an E2E in the 013 find-bar suite asserting a one-row block seeds the input and a multi-row block leaves the last term. Seeding must not alter panel content (013 FR-003).
- [X] T083 [US6] E2E in `packages/ui/tests/e2e/editor-column-select.e2e.ts`: Alt+drag creates a block; copy → paste into another **panel** stays column-wise (the mode is app-global); type replaces every row; Delete clears without touching the clipboard; N external lines over an N-row block distribute one per row; padding in a tab-indented file uses tabs; one Undo reverts a ten-row paste. **Also assert the outbound direction (U3/FR-025d/US6 AS5)**: after copying a block, **read the OS clipboard back** and confirm it holds the rows as plain text separated by line breaks — i.e. what *another application* would receive. Panel→panel is covered above; throng→external is not, and it is half of what the requirement promises. (T065 does the equivalent for `cut-line`.)
- [X] T115 **M1 — FR-024's *positive* claim is untested.** FR-024 requires everything to work **identically for sub-workspace-owned editors and in sub-workspace windows**, and SC-011/SC-013a name them explicitly — but only the *negative* case is covered (T096 proves the commands **don't** fire in a background window). Add an E2E in `packages/ui/tests/e2e/editor-subworkspace.e2e.ts`: tear an Editor Panel into a **sub-workspace window**, then exercise **cut-line**, a **column paste** (the block was copied in the main window — the mode is app-global, FR-015c), and **override adoption** (the picker shows and applies the document's language). All must behave exactly as in the main window.

---

## Phase 10: Crash recovery (FR-027)

> **The undo *mechanism* moved to Phase 5b.** It is not here because every command in Phases 6–9 asserts
> *"one command = one Undo"*, and those assertions are worthless if they run against a `history()` that a
> later phase deletes.

- [X] T111 **G5 — "one document, one state" is only half-tested.** T087 proves the *undo stack* is shared and T045 proves the *language override* is adopted; nothing proves the rest. Add to `packages/ui/tests/integration/document-state.integration.test.ts`: the **effective indentation** is a single shared value across every view of a document (FR-028a — the requirement's whole point, since indentation decides which characters enter the shared buffer), while **view state stays per view** — cursor, selection, scroll and 012's per-panel zoom (FR-028c) — and a shared-buffer edit that invalidates another view's cursor **collapses it gracefully** rather than leaving it pointing at content that no longer exists.
- [X] T088 Make the recovery snapshot **structured** in `packages/ui/src/main/editor-recovery.ts`: JSON `{version, text, history?}`, **tolerant of the legacy plain-text form** (a file that does not parse as JSON is read as `{text: raw}`), so an in-flight snapshot from the previous build is not lost on upgrade.
- [X] T089 Persist the undo history alongside the snapshot on the **same cadence**, **bounded by total serialised size** (oldest dropped first), so a session of large edits can never bloat the snapshot or slow the debounced writes recovery depends on (FR-027a). **The cap is 1 MiB (1,048,576 bytes) of serialised history per document (U1)** — named here because FR-027a left it unstated, and an unnamed bound is a magic number. Rationale: the recovery snapshot is written on a **400 ms debounce** on every keystroke, so the write must stay cheap; 1 MiB is far larger than any realistic edit session's history yet small enough that serialising it cannot stall the debounce. It is **fixed, not user-configurable**, for the same reason as the 500-entry and 10,000-character bounds — exposing it would demand a descriptor, Settings exposure and completeness coverage (FR-022) for a knob with no user value. Recorded in the plan's Complexity Tracking alongside the other two.
- [X] T090 Implement `editor.persistUndoHistory` (FR-027c): defaults **enabled**; governs **persistence only** (the in-memory history is unaffected); turning it **off purges** what is already on disk. A crash with it off still recovers the document's **content** in full.
- [X] T112 **U1 — bound the exposure of removed text (FR-027b/SC-012b).** The persisted history contains text the user **cut or deleted** (an API key cut from a config file lives on in the stack after the file is clean). T090 covers only the toggle-off purge; the deletions that actually bound the exposure are untested. Assert in `packages/ui/tests/integration/recovery-history.integration.test.ts`: the persisted history is deleted on a **normal close** *and* on **discard after a successful recovery**, so its lifetime **never exceeds the snapshot's**; and it is written **only** to the snapshot's protected per-user location — **never** to logs, telemetry or diagnostics.
- [X] T091 Indentation inference on a **crash-recovery restore** must sample the **recovered content, not the stale disk copy** (FR-027) — otherwise a file converted to spaces before the crash keeps inserting tabs after it.
- [X] T092 E2E in `packages/ui/tests/e2e/editor-undo-recovery.e2e.ts`: one command = one Undo (ten-row column paste); undo past a save re-dirties; revert clears the history; kill the app mid-edit → content **and** history recovered; with the toggle off → content recovered, history empty.

---

## Phase 11: Polish & docs

> **The scope provider, the focus guard and 012's chord precedence (T093 / T094 / T109) MOVED to Phase 5c.**
> They are not polish — they are what make `Tab` safe to bind. See the note there.

- [X] T095 Show each command's **scope** in the Key Bindings editor (`packages/ui/src/renderer/preferences/keybindings-tab.tsx`), so a user seeing `Ctrl+X` twice understands why, and the conflict flow can tell a **real** clash from a scoped coexistence (FR-017b0).
- [X] T096 E2E in `packages/ui/tests/e2e/editor-command-scope.e2e.ts`: none of the seven fire when the active panel is a **Terminal** or the file tree, or in a background window; `Ctrl+X` in a Terminal Panel still reaches the **shell** (PTY passthrough, FR-017d); **Tab with the find bar focused does not indent**.
- [X] T110 **E2E for the Key Bindings editor scope column** (T095 is a user-facing UI change; Principle V forbids marking it done on unit evidence alone). In `packages/ui/tests/e2e/preferences-keybindings.e2e.ts`: each command's **scope** is rendered, and `cut-line` (`{editor}`) + `file.cut` (`{explorer}`) are shown **coexisting on `Ctrl+X`**, not flagged as a clash. **Also assert the conflict journey survives (M4/FR-017b2)**: a **real** clash — two commands whose scope sets *intersect* — still raises 007 FR-034's warn→**Reassign/Cancel** modal and never silently steals the chord. A scope-aware `findConflict` that wrongly returns "no conflict" would **silently reintroduce the last-writer-wins path FR-017b2 bans**, and only this journey catches it.
- [X] T097 Performance test in `packages/ui/tests/e2e/editor-highlight-perf.e2e.ts` asserting FR-008/SC-003 against the **largest permitted file** (the 006 threshold), not a typical one: first highlight **< 200 ms**; no main-thread task **> 50 ms**; typing adds **≤ 16 ms**.
- [X] T098 [P] Update `README.md` — current shipped state only, **no per-feature narration** (constitution: it is a truthful snapshot, not a changelog).
- [X] T099 [P] Update `ROADMAP.md`: mark rich code editors (Part 1) delivered; the deferred items already have issues (#69/#70/#71/#61/#26).
- [X] T100 [P] Update `CONTRIBUTING.md` / `docs/testing.md` if the toolchain or test bar changed.
- [X] T101 **VERIFY the FR-028d constitutional amendment landed and is honoured (#68).** *(Rewritten 2026-07-13 — this task previously said the amendment was a "separate governance change this feature does **not** perform". It has now been performed, on this branch: constitution **v3.15.0** adds "One document, one state" to **Principle XI**, closing #68. Left as written, T101 would be ticked for work it never did.)* Assert: `.specify/memory/constitution.md` is at **v3.15.0** with the rule under Principle XI; **#68 is closed** by this PR; every artifact citing the constitution cites **v3.15.0** (spec, plan, research, tasks, quickstart); and — the part that actually matters — the shipped code **satisfies** the rule it added, i.e. T124–T126 are green, there is exactly **one** document authority, and **no** peer-to-peer relay of document state survives anywhere (grep the removal of 006's `{text, dirty}` whole-document replace).
- [X] T102 Run the full gates once, unfiltered, output captured: lint, typecheck, unit, integration, contract, E2E.

---

## Dependencies

*(Regenerated over the full task list — **T001–T123, with T118 deliberately absent** (the "re-verify undo
afterwards" workaround, deleted when the undo foundation moved to Phase 5b). **T124–T127 added 2026-07-13** for FR-028f + SC-013b — the document authority (T125), its contract test (T124), the **constructed-race** test (T126) and the **mirrored-view E2E** that proves constitution XI to a user (T127). T087 was **moved** from Phase 10 into Phase 5b: it is the central proof of FR-026c and was landing five phases after the checkpoint that already claimed XI was satisfied. **126 tasks** — T001–T127, T118 deliberately absent.)*

```
Phase 1 (setup)  T001–T002
   └─> Phase 2 (FOUNDATIONAL) ─── BLOCKS EVERYTHING
         │   registry/detect/infer   T003–T009
         │   dispatch scope          T010–T015  ── T114 MUST land WITH T012 (else the
         │                                          keybinding completeness test goes red)
         │   platform-keyed record   T103–T105  ── T104 owns the ONE SHIPPED_DEFAULTS_VERSION
         │                                          bump (2→3); T023 must NOT bump again
         │   map metadata            T016–T019
         │
         ├─> Phase 3  US1 (P1) 🎯 MVP   T020–T033, T108, T122
         │        T021 ──> T024   (cannot re-measure distinctness before palettes exist)
         │        T020 ──> T025   (cannot add a pairing for a token that does not exist)
         │        T027 ──> T122   (T122 is the ONLY guard on SC-001 — the MVP's headline
         │                         criterion. A typo'd loader degrades SILENTLY to plain text
         │                         and every other test still passes.)
         │     └─> Phase 4  US5   T034–T046, T107, T119–T121, T123
         │              (P3, pulled early — the only way to SEE US1's result)
         │
         └─> Phase 5   clipboard seam    T047–T056
               └─> Phase 5b  DOC AUTHORITY + UNDO   T124–T126, T084–T086, T116, T117  ── BLOCKS Phases 6–9
                     │    T086 ──> T116  (removing history() KILLS undo until the trigger is re-wired)
                     │    T086 ──> T117  (013's replace-all rides the history T086 deletes)
                     └─> Phase 5c  FOCUS SCOPING  T093, T094, T109    ── BLOCKS Phases 6–9
                          │    T094 MUST precede T072: T015 frees `Tab` and T072 binds it, so
                          │    without the focus guard `Tab` indents the file while the FIND BAR
                          │    has focus — an editing command mutating the file mid-search.
                          │    T109 MUST precede T078: Prec.highest is how an editor swallows
                          │    012's move-focus chord (FR-024b).
                          └─┬─> Phase 6  US2 (P2)  T057–T060
                            ├─> Phase 7  US3 (P2)  T061–T065
                            ├─> Phase 8  US4 (P2)  T066–T076, T106, T113
                            │        (ALSO needs Phase 2's map metadata. It is under the undo chain
                            │         because T072's indent-lines/outdent-lines are named BY FR-026
                            │         and SC-012 as commands requiring one atomic undo entry.)
                            └─> Phase 9  US6 (P3)  T077–T083, T115
                                     T105 ──> T077  (the mouse modifier comes from the platform record;
                                                     CM's rectangularSelection() hardcodes Alt)
                          └─> Phase 10  crash recovery  T087–T092, T111, T112
                                   └─> Phase 11  polish & docs  T095–T102, T110
```

**Why Phase 5b sits where it does.** Phases 6–**9** — including **Phase 8** — assert *"one command = one
Undo"* (FR-026/SC-012). Run those assertions against CodeMirror's **local `history()`** and T086 later
deletes it: **every one of those green bars becomes meaningless**, and the work is done, invalidated, and
redone. The mechanism goes first, so each assertion is made **once, against the real thing**. (An earlier
draft carried a "re-verify afterwards" task instead — that was having it both ways, and it is gone.)

**Story independence**: US1 ships alone (MVP). US5 needs US1. **US2, US3, US4 and US6 all need the Phase 5
clipboard seam and the Phase 5b undo foundation** — US4 included, because indent/outdent are atomic-undo
commands.

## Parallel opportunities

- **Phase 2**: T003 ∥ T004 ∥ T005 ∥ T008 (independent test files). The keybinding track (T010–T015, T103–T105,
  T114) and the metadata track (T016–T019) touch different files and run concurrently.
- **Phase 3**: T020 ∥ T027 ∥ T028. **But T021 → T024 and T020 → T025 are hard orders.**
- **Phase 4**: the persistence track (T034–T041) ∥ the UI track (T042–T044, T107).
- **Phase 5**: T047 ∥ T048 ∥ T053.
- **Phase 11**: T098 ∥ T099 ∥ T100.

## MVP scope

**Phase 1 + Phase 2 + Phase 3 (US1)** — syntax highlighting with extension-based detection, legible on
every bundled theme. That is the feature's headline and the reason it exists; every other story is an
editing nicety the editor is usable without.

Add **Phase 4 (US5)** immediately after: without the status strip the user cannot *see* what was detected,
and without the override an undetectable file has no correction path.
