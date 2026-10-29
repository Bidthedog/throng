# Tasks: Native Encodings and Line-Ending Conversion

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/editor-encoding.md](./contracts/editor-encoding.md)

**Tests**: required. Constitution Principle V is test-first: every implementation task is preceded by
a failing test at the layer research R14 names.

**Boundaries**: **core** (`packages/core`), **main** (`packages/ui/src/main`, preload, `global.d.ts`),
**renderer** (`packages/ui/src/renderer`), **docs/e2e**.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Add byte-exact encoding fixtures (utf8, utf8-bom, utf16le-bom, utf16be-bom, utf16le-nobom, utf16be-nobom, cp1252 with `é £ €` and CRLF, cp1252 all-256-bytes, mixed endings, utf32le, utf32be, plus binary samples: PNG header, PE/EXE header, ZIP header, a compiled `.class`) as a generator module in packages/core/tests/fixtures/text-formats.ts (bytes built in code, no binary files committed)

---

## Phase 2: Foundational (blocks every story)

### Core formats (core)

- [x] T002 Write failing unit tests for `detectTextFormat` covering FR-002's precedence table (UTF-32 before UTF-16 BOM per FR-003, BOM rows, BOM-less UTF-16 LE/BE, binary, UTF-8, Windows-1252 fallback), determinism (FR-004), the SC-003 binary fixtures never classified as UTF-16, empty file → utf8 no BOM, BOM-only UTF-16 file, and that the UTF-16/binary pattern scan reads no byte past the 8,000-byte window (FR-005, asserted by placing a decisive byte beyond it) in packages/core/tests/unit/text-format-fixtures.test.ts
- [x] T003 Implement `detectTextFormat(bytes): TextFormatVerdict` per research R1/R2 (8,000-byte window, `zOdd ≥ 0.3×pairs && zEven ≤ 0.02×pairs` thresholds as named constants with their reason, lossless-decode confirmation) in packages/core/src/editor/text-fidelity.ts; widen `EncodingId` to `'utf8' | 'utf16le' | 'utf16be' | 'windows1252'` and add `isEncodingId` (rejecting `hasBom: true` with `windows1252`) in packages/core/src/workspace/model.ts
- [x] T004 Write failing unit tests for `decode(bytes, forced?)` / `encode(text, opts)` in all five formats: unedited round trip byte-identical incl. mixed endings (FR-011, SC-001), all 256 Windows-1252 bytes round-trip (FR-013, SC-002), forced decode refusal `not-decodable` for invalid UTF-8 / odd-length / unpaired-surrogate UTF-16 (FR-014), never emits `EF BF BD` absent from input (FR-020, SC-004) in packages/core/tests/unit/text-fidelity.test.ts
- [x] T005 Implement fatal platform decoders (R3) and hand-written encoders with the 1252 inverse table derived from the decoder at module load (R4); `decode` takes an optional forced encoding and returns the `not-decodable` refusal in packages/core/src/editor/text-fidelity.ts
- [x] T006 Write failing unit tests for `findUnrepresentable` (first 1252-unrepresentable code point with 1-based line/column; a lone surrogate in every encoding) and that `encode` throws `UnrepresentableTextError` rather than substituting (FR-021) in packages/core/tests/unit/text-fidelity.test.ts
- [x] T007 Implement `findUnrepresentable` and `UnrepresentableTextError` (R5) in packages/core/src/editor/text-fidelity.ts
- [x] T008 Write failing unit tests for `encodingLabel(encoding, hasBom)` (`UTF-8`, `UTF-8 with BOM`, `UTF-16 LE`, `UTF-16 BE`, `Windows-1252`), `lineEndingLabel(format)` (`LF`, `CRLF`, `CR`, `Mixed (<dominant>)`), and `refusalMessage(reason)` (UTF-32 text "This file is UTF-32, which throng does not open." per FR-006; binary keeps "That file is not text, so it cannot be opened in an editor." per FR-007; `not-decodable` names the encoding) in packages/core/tests/unit/text-format-labels.test.ts
- [x] T009 Implement `encodingLabel`, `lineEndingLabel`, `refusalMessage` and re-export everything new (the old `isProbablyBinary`/`isDecodableUtf8` exports stay until T040 retires them) in packages/core/src/editor/text-fidelity.ts, packages/core/src/editor/index.ts, packages/core/src/index.ts
- [x] T010 [P] Write a 5 MB timing test over the whole read path (`detectTextFormat` + `decode`, what `EditorService.load` runs) asserting every supported encoding completes within 1.5× the UTF-8 time of the same content (SC-005) in packages/core/tests/unit/text-fidelity-perf.test.ts
- [x] T045 Record the project-text reader inventory in research.md R13: `git grep` for `readBytes(`, `new TextDecoder`, `readFile(…'utf8')` over `packages/*/src` gives exactly editor-service.ts:94, file-search-service.ts:989, text-file-rewrite.ts:56 (project text, all tasked) and preview-protocol.ts:181 (serves bytes untouched, never decodes — out of FR-001's scope); every other hit is config/JSON, clipboard or terminal output

### Authority-owned line format (main)

- [x] T011 Write failing unit tests: `DocumentAuthority` holds `lineFormat` and `savedLineFormat`; `dirty` is true when only the line format differs; `convertLineEndings(target)` records ONE undo entry with empty change sets and `format {before, after}`, `mergeClass: null`, advances the version, returns `kind: 'edit'` with empty changes and `lineFormat`; undo restores `before` including a mixed per-line record and a clean state when nothing else changed (FR-035, FR-036, SC-007); converting to the current uniform ending returns `changed: false` and records nothing (FR-038); after conversion the mixed record is cleared (FR-037); a conversion, then a save, then an undo leaves the document dirty against `savedLineFormat` (edge case "Undo across a save") in packages/ui/tests/unit/document-authority-line-format.test.ts
- [x] T012 Implement `LineFormat`, `lineFormatEq`, `UndoEntry.format`, format-aware `dirty`/`markSaved`/`undo`/`redo`/`convertLineEndings`, and `CanonicalChangeMsg.lineFormat` per research R6 in packages/ui/src/main/document-authority.ts, packages/ui/src/main/undo-service.ts, packages/core/src/editor/document-sync.ts
- [x] T013 Write a failing unit test that a serialised history with a conversion entry restores its `format`, and an older history without the field restores unchanged, in packages/core/tests/unit/undo-persistence.test.ts; then serialise `format` optionally in packages/core/src/editor/undo-persistence.ts
- [x] T014 Write failing integration tests: the editor save path encodes with the AUTHORITY's line format, not the renderer payload; a mixed file opened, edited on one line without adding lines, and saved keeps every other line's ending (FR-011, 016 FR-023b) in packages/ui/tests/integration/editor-encoding.integration.test.ts
- [x] T015 Make load keep `mixedLineEndings` and hand the line format to the authority; make `save` ignore the payload `lineEnding` and encode from the authority format plus `CoordDoc` encoding/hasBom (R6 points 3–4) in packages/ui/src/main/editor-service.ts, packages/ui/src/main/editor-coordinator.ts
- [x] T016 Widen the IPC types per the contract: `toMeta` validates `encoding` with `isEncodingId` (no hard-coded `'utf8'`), `EditorLoadResult.encoding: EncodingId`, save payload loses `lineEnding`, meta relay carries `encoding`, `hasBom`, `encodingChosen`, `lineFormat {lineEnding, mixed}` in packages/ui/src/main/editor-ipc.ts, packages/ui/src/renderer/global.d.ts, the preload editor bridge; renderer stops sending `lineEnding` on save and treats `configRef` encoding/lineEnding as a display copy written from the relay in packages/ui/src/renderer/editor/use-editor.ts

**Checkpoint**: core speaks five formats; the authority owns the line format.

---

## Phase 3: User Story 1 — Edit a Windows-1252 file without destroying it (P1) 🎯 MVP

**Independent test**: open the cp1252 fixture, see `é £ €`, edit one ASCII line, save, only that line's bytes differ.

- [x] T017 [US1] Write failing integration tests: a cp1252 file loads with its characters and `encoding: 'windows1252'`; an edit-and-save changes only the edited bytes (FR-012); saving content holding an emoji writes nothing and returns `{reason: 'unrepresentable', encoding, char, line, column}` (FR-021); Save All saves the other documents and leaves this one dirty (FR-023); a brand-new document still saves as UTF-8 without BOM with `editor.defaultLineEnding` (FR-016) in packages/ui/tests/integration/editor-encoding.integration.test.ts
- [x] T018 [US1] Replace the `isProbablyBinary` + `decode` load path with `decode` over `detectTextFormat` (refusals carry their reason), and add `SaveReason 'unrepresentable'` caught from `UnrepresentableTextError` in packages/ui/src/main/editor-service.ts, packages/ui/src/main/editor-coordinator.ts
- [x] T019 [P] [US1] Write failing component tests for the save-refusal banner: one banner per document shown in every view, naming encoding, character and line; a second refused save flashes it and raises no second notice; its single action "Save as UTF-8" calls `saveWithEncoding({encoding:'utf8', hasBom:false})`; it clears on a successful save and when an edit removes the offending character; choosing Save in the dirty-close dialog for such a document leaves the panel open (FR-023); the modal `reportSaveError` is NOT used for this reason (FR-022, one condition one notice) in packages/ui/tests/component/encoding-save-banner.test.ts
- [x] T020 [US1] Implement the banner on `panel-failure-banner.tsx` with one `confirm` action, wire it from the save result in packages/ui/src/renderer/editor/encoding-save-banner.tsx, packages/ui/src/renderer/editor/use-editor.ts

**Checkpoint**: a Windows-1252 file can no longer be destroyed.

---

## Phase 4: User Story 2 — Open and save UTF-16 files (P1)

**Independent test**: each UTF-16 fixture opens, edits and saves back in its own byte order and BOM state.

- [x] T021 [US2] Write failing integration tests: UTF-16 LE/BE with and without BOM load as text and save in the same encoding and BOM state with only the edit changed; a UTF-32 file is refused with the UTF-32 message (FR-006); a PNG is refused with today's not-text message (FR-007) in packages/ui/tests/integration/editor-encoding.integration.test.ts
- [x] T022 [US2] Route every refusal message through core's `refusalMessage(reason)` (FR-053) in packages/ui/src/renderer/editor/editor-missing-notice.ts and packages/ui/src/renderer/preview/preview-notice.tsx; map the new `utf32` reason through packages/ui/src/main/preview-service.ts

**Checkpoint**: UTF-16 files open; refusals say what the file is.

---

## Phase 5: User Story 3 — See and change a document's encoding (P2)

**Independent test**: Save with Encoding → UTF-8 on a UTF-16 file; Reopen with Encoding → Windows-1252 on a misdetected file.

- [x] T023 [US3] Write failing integration tests per the contract: `reopenWithEncoding` resets the buffer from disk, clears undo, writes nothing and sets `encodingChosen` (FR-024); a not-decodable reopen changes nothing and returns `not-decodable` (FR-014); no file → `no-file` (FR-026); `saveWithEncoding` writes in the chosen encoding/BOM and sets `encodingChosen` (FR-027), refusing unrepresentable content; a chosen encoding survives an external-change reload and recovery but a fresh open after close re-detects (FR-028, clarification 3); a recovered unsaved buffer comes back with its encoding, BOM state and line format, and saving it writes that format (FR-015); an external change that can no longer be read in the current encoding re-detects, updates the relayed encoding and says why in the change notice (spec edge case "External change while open"); two docKeys' views both receive the relay (FR-034) in packages/ui/tests/integration/editor-encoding.integration.test.ts
- [x] T024 [US3] Implement `EditorService.load(path, forcedEncoding?)`, `CoordDoc.encodingChosen`, `coordinator.reopenWithEncoding`/`saveWithEncoding`, the recovery snapshot's optional `encoding`/`hasBom`/`encodingChosen`/`lineFormat` (FR-015, R7), `EditorPanelConfig.encodingChosen` (layout copy), and the two IPC channels with preload bridge calls in packages/ui/src/main/editor-service.ts, packages/ui/src/main/editor-coordinator.ts, packages/ui/src/main/editor-recovery.ts, packages/ui/src/main/editor-ipc.ts, packages/core/src/workspace/model.ts, packages/ui/src/renderer/global.d.ts
- [x] T025 [US3] Write failing unit tests that `editor.reopenWithEncoding` and `editor.saveWithEncoding` exist as `ActionId`s, scope `EDITOR_ONLY`, default unbound `[]`, with Key Bindings descriptors (FR-041) — extend packages/core/tests/unit/keybindings-metadata.test.ts and packages/core/tests/unit/keybindings-scope.test.ts
- [x] T026 [US3] Add the two `ActionId`s, scope and empty defaults in packages/core/src/config/keybindings.ts and their `chord(id,'Editor',label,desc)` descriptors in packages/core/src/config/keybindings-metadata.ts
- [x] T027 [P] [US3] Write failing component tests: the encoding indicator renders on every editor panel including UTF-8 without BOM (FR-030, clarification 1) with the FR-031 label and accessible name "encoding: <label>"; clicking it opens a popup with Reopen with Encoding… and Save with Encoding…; the encoding picker lists the five formats with the current one marked; a dirty document's Reopen asks to discard or cancel and cancel changes nothing (FR-025); Reopen is disabled for a document with no file (FR-026); the indicator is a named button, not a glyph (FR-031, no new #282 gap); reaching Save with Encoding takes two clicks from the indicator (SC-006) in packages/ui/tests/component/status-strip-encoding.test.ts
- [x] T028 [P] [US3] Write failing component tests that the content menu's `viewState` section carries "Reopen with Encoding…" and "Save with Encoding…" showing their chord once bound, and the encoding picker they open marks the current encoding (FR-040); the items exist with `editor.showStatusBar` false (FR-033, SC-006) in packages/ui/tests/component/content-menu-encoding.test.ts
- [x] T029 [US3] Implement the encoding indicator in the controls group, the popup, the encoding picker (modelled on the language picker), the two command handlers in `commandsFor()`, and the content-menu items in packages/ui/src/renderer/editor/status-strip.tsx, packages/ui/src/renderer/editor/encoding-picker.tsx, packages/ui/src/renderer/editor/use-editor.ts, packages/ui/src/renderer/editor/content-menu.ts

**Checkpoint**: encoding is visible and changeable.

---

## Phase 6: User Story 4 — See and convert a document's line endings (P2)

**Independent test**: convert a CRLF fixture to LF, save, every line LF; undo before saving returns it clean.

- [x] T030 [US4] Write failing integration tests: `convertLineEndings` via the coordinator broadcasts the canonical message to every view, the document turns dirty, save writes the target ending throughout; undo restores mixed per-line endings and clean state (FR-035, FR-036); converting the current ending returns `changed: false` (FR-038); nothing converts without the call (FR-039) in packages/ui/tests/integration/editor-encoding.integration.test.ts
- [x] T031 [US4] Implement `coordinator.convertLineEndings` and the `throng:editor:convertLineEndings` channel plus preload bridge call, and the replica's handling of `lineFormat` on canonical messages in packages/ui/src/main/editor-coordinator.ts, packages/ui/src/main/editor-ipc.ts, packages/ui/src/renderer/editor/document-replica.ts, packages/ui/src/renderer/global.d.ts
- [x] T032 [US4] Write failing unit tests for `editor.convertLineEndingsToLf` / `editor.convertLineEndingsToCrlf` ActionIds (EDITOR_ONLY, unbound, descriptors) — extend packages/core/tests/unit/keybindings-metadata.test.ts and packages/core/tests/unit/keybindings-scope.test.ts
- [x] T048 [US4] Add the two ActionIds, scope and empty defaults in packages/core/src/config/keybindings.ts and their descriptors in packages/core/src/config/keybindings-metadata.ts
- [x] T033 [P] [US4] Write failing component tests: the line-ending indicator renders `LF`/`CRLF`/`CR`/`Mixed (<dominant>)` with accessible name "line endings: <label>"; clicking it offers Convert to LF / Convert to CRLF with the current uniform ending marked current; both offered on a mixed document (FR-031, FR-033, FR-038); both indicators take the inactive-panel treatment of 016 FR-010g (FR-034); the content menu carries both items with checked state (FR-040) in packages/ui/tests/component/status-strip-line-ending.test.ts
- [x] T034 [US4] Implement the line-ending indicator, its popup, the two command handlers and content-menu items in packages/ui/src/renderer/editor/status-strip.tsx, packages/ui/src/renderer/editor/use-editor.ts, packages/ui/src/renderer/editor/content-menu.ts
- [x] T035 [US4] Write failing unit tests that `HIDE_ORDER` continues `… column → line → lineEnding → encoding` and terminates there; language label and wrap toggle are never hidden (FR-032, 040 FR-024) — extend packages/ui/tests/unit/status-strip-fit.test.ts and packages/ui/tests/component/status-strip-fit-wiring.test.ts
- [x] T036 [US4] Measure the two indicators as their own segments and extend `HIDE_ORDER` in packages/ui/src/renderer/editor/status-strip-fit.ts and packages/ui/src/renderer/editor/status-strip.tsx; indicators use the language label's status tokens and 016 FR-010g's inactive treatment (FR-034)

**Checkpoint**: line endings are visible and convertible.

---

## Phase 7: User Story 5 — Search, replace and toggle on these files (P3)

**Independent test**: Find in Files finds and replaces in UTF-16 LE and cp1252 fixtures, each rewritten in its own encoding.

- [x] T037 [US5] Write failing integration tests: Find in Files searches UTF-16 and 1252 files (FR-050); a replace commit writes each in its own encoding and BOM state with only the match changed (FR-051); a replacement introducing an unrepresentable character refuses that file with reason `'unrepresentable'`; the task toggle rewrites a UTF-16 Markdown file in UTF-16 (FR-052) in packages/ui/tests/integration/replace-commit-encoding.integration.test.ts
- [x] T038 [US5] Switch the binary skip to the detection verdict in packages/ui/src/main/file-search-service.ts; switch `text-file-rewrite.ts` to `detectTextFormat` refusals and own-encoding writes with the `'unrepresentable'` reason in packages/ui/src/main/text-file-rewrite.ts and packages/ui/src/main/replace-commit-service.ts
- [x] T046 [US5] Write a failing integration test that the preview reads a UTF-16 LE Markdown source and a cp1252 Markdown source through `EditorService.load` and renders their text (FR-052; no preview-service change expected, research R13) in packages/ui/tests/integration/replace-commit-encoding.integration.test.ts
- [x] T039 [US5] Update the replace report and toggle wording to core's `refusalMessage` and the new reason (FR-053) in packages/ui/src/renderer/find-in-files/commit-replace.ts and packages/ui/src/renderer/preview/task-toggle.ts

---

## Phase 8: Polish & cross-cutting

- [x] T040 Retire the public `isProbablyBinary`/`isDecodableUtf8` exports once no caller remains (FR-001); confirm with `git grep` that no `src` path runs its own detection in packages/core/src/editor/index.ts, packages/core/src/index.ts
- [x] T041 [P] Document the four commands as `*(unbound)*` rows in the Editor table of docs/key-bindings.md
- [x] T042 [P] Add the encoding and line-ending indicators to the Status Bar section of docs/preferences.md, and the detection function plus the authority-owned line format to "Editor and documents" in docs/architecture.md
- [x] T043 Write one E2E test (`@extended @editor`): open a UTF-16 LE fixture, the status bar reads `UTF-16 LE` and `CRLF`, Convert to LF from the content menu, save, the file on disk is UTF-16 LE with BOM and LF throughout in packages/ui/tests/e2e/editor-encoding.e2e.ts; re-seed packages/ui/tests/e2e/e2e-budget.json (`total` +1, `@editor` +1) with its justification, and add the spec to packages/ui/tests/e2e/parallel-plan.json because it drives a context menu (`tier-plan.test.ts` enforces this)
- [x] T047 Write one cross-path integration test (SC-004): every text fixture goes through editor save, Save with Encoding, Save All, Find in Files replace and the task toggle, and the output contains `EF BF BD` only where the input did, in packages/ui/tests/integration/no-replacement-bytes.integration.test.ts
- [x] T044 Run the `throng-docs` audit and fix what it reports; confirm `docs-currency.test.ts` passes

---

## Dependencies

- Phase 2 blocks everything. Inside it: T002→T003, T004→T005, T006→T007, T008→T009, T011→T012→T013, T014→T015→T016.
- US1 (T017–T020) and US2 (T021–T022) need Phase 2 only.
- US3 needs T016. US4 needs T012 and T016. T036 needs T029 and T034 (shared `status-strip.tsx`), and US3/US4 are not shippable separately: the indicators must not ship without their hide-order entries, so T029, T034 and T036 land together.
- US5 needs T005, T007, T009.
- Polish runs last. T040 needs T018 and T038.

## Parallel opportunities

- Renderer tests T019, T027, T028, T033 are separate files and can be written while main tasks proceed.
- T010 is independent of everything but T005.
- T041 and T042 touch different docs.

## Implementation strategy

MVP is Phase 2 + US1: it stops the data loss. US2 follows on the same detection. US3 and US4 share the
status strip, so they run back to back. US5 last.

---

## Phase 9: Iteration 2026-10-25 — group open failures by their error (FR-054)

- [x] T049 Write failing unit tests that `groupKey` with one operation gives two failures the same key only when they share a cause, or — with no cause — the same message; that a shared cause wins over differing messages (one missing root, two reporters); and that a failure with neither keeps today's key; rewriting the FR-029a test that asserted differing causes share a key, as superseded by FR-054, in packages/core/tests/unit/notice/grouping.test.ts
- [x] T050 Add `message` to `GroupInput` and fold the error into the operation branch of `groupKey` per research R16 in packages/core/src/notice/grouping.ts; pass it through `operationGroupKey(projectId, error)` in packages/ui/src/renderer/workspace/operation.ts
- [x] T051 Write failing component tests that `useReportSubjectFailure` and `useReportPanelFailure` raise different group keys for different messages and the same key for the same message within one operation, in packages/ui/tests/component/panel-failure-grouping.test.ts
- [x] T052 Pass each report's cause and message to `operationGroupKey` at both raise sites in packages/ui/src/renderer/workspace/panel-failure-notice.ts

---

## Phase 10: Iteration 2026-10-25, round 2 — change encoding, line endings, whitespace (FR-055 to FR-061)

- [x] T053 [P] Write failing unit tests for `mapLineEndings` (FR-061): an edit inside a line keeps the record; deleting a break drops its entry; inserting lines adds the inserting ending; multi-range change sets; a record of one ending collapses to uniform; a uniform document given a different inserted ending becomes mixed — in packages/core/tests/unit/line-ending-map.test.ts
- [x] T054 Implement `mapLineEndings` and `DocEncoding` in packages/core/src/editor/document-sync.ts, exported from packages/core/src/editor/index.ts and packages/core/src/index.ts; extend serialised entries with `encoding?` in packages/core/src/editor/undo-persistence.ts
- [x] T055 [P] Write failing core unit tests for the key bindings (FR-058, FR-059): `editor.changeEncoding` replaces `editor.saveWithEncoding`; `editor.convertLineEndingsToCr`, `editor.insertLineBreakLf`/`Cr`/`Crlf`, `editor.toggleWhitespace` are EDITOR_ONLY, unbound, described — in packages/core/tests/unit/keybindings-metadata.test.ts, keybindings-scope.test.ts, keybindings-tiers.test.ts
- [x] T056 Add the ActionIds in packages/core/src/config/keybindings.ts and packages/core/src/config/keybindings-metadata.ts
- [x] T057 [P] Write a failing test that `editor.defaultShowWhitespace` (boolean, default false) is a modelled, described setting in the Editor group, in packages/core/tests/unit/settings-metadata.test.ts; add `EditorPanelConfig.showWhitespace?` in packages/core/src/workspace/model.ts
- [x] T058 Add the setting to the schema, defaults and packages/core/src/config/settings-metadata.ts (FR-060)
- [x] T059 Write failing authority unit tests (FR-055, FR-061): changeEncoding is one undo step, dirty, clean again on undo, no-op on the current encoding; insertLineBreak inserts a break with that ending; an edit that changes the record stores format before/after and undo restores the exact record; typing runs merge keeping the first before; CR is a conversion target — in packages/ui/tests/unit/document-authority-line-format.test.ts
- [x] T060 Move the encoding into the authority, map the record through dispatch, add changeEncoding / insertLineBreak / CR conversion in packages/ui/src/main/document-authority.ts and `UndoEntry.encoding?` in packages/ui/src/main/undo-service.ts
- [x] T061 Write failing integration tests (FR-055, FR-057, FR-061): Change Encoding then save writes the new encoding, undo restores; convert to CR saves CR; insert CRLF in an LF file then add and delete lines elsewhere and save keeps every line's own ending; recovery carries the encoding — in packages/ui/tests/integration/editor-encoding.integration.test.ts
- [x] T062 Read the encoding from the authority throughout packages/ui/src/main/editor-coordinator.ts; add `changeEncoding`, `insertLineBreak`, CR conversion; the channels `throng:editor:changeEncoding` and `throng:editor:insertLineBreak` in packages/ui/src/main/editor-ipc.ts, packages/ui/src/preload/preload.cts and packages/ui/src/renderer/global.d.ts
- [x] T063 [P] [renderer] Write failing component tests: the encoding indicator menu lists every encoding (current marked) then Reopen with Encoding…, and choosing one calls changeEncoding; the line-ending list offers LF/CR/CRLF/Mixed with Mixed never selectable and marked current when mixed; the content menu's Encoding and Line Endings items carry the same lists plus Insert Line Break → LF/CR/CRLF — in packages/ui/tests/component/status-strip-encoding.test.ts, status-strip-line-ending.test.ts, content-menu-encoding.test.ts
- [x] T064 [renderer] Implement the menus and command handlers for changeEncoding, the three conversions, the three inserts in packages/ui/src/renderer/editor/content-menu.ts, status-strip.tsx, use-editor.ts; stop calling saveWithEncoding
- [x] T065 [P] [renderer] Write failing component tests for View Whitespace (FR-059, FR-060): the toggle beside wrap, off by default, default from the preference, per panel, persisted in panel config, never hidden by width; the extension marks spaces, tabs, each line's ending distinctly, VT/FF/ESC/C0/U+FEFF, and a BOM mark at offset 0 when hasBom; nothing enters the document — in packages/ui/tests/component/view-whitespace.test.ts and packages/ui/tests/unit/status-strip-fit.test.ts
- [x] T066 [renderer] Implement View Whitespace in packages/ui/src/renderer/editor/view-whitespace.ts (new), status-strip.tsx, status-strip-fit.ts, content-menu.ts, use-editor.ts, editor.css
- [x] T067 Remove `saveWithEncoding` from packages/ui/src/main/editor-coordinator.ts, editor-ipc.ts, preload.cts and global.d.ts once T064 lands; confirm with `git grep`
- [x] T068 Update docs: key-bindings (the renamed and new commands), preferences (`editor.defaultShowWhitespace`, View Whitespace in the Status Bar section), architecture (encoding in the authority, the per-line record), quick-start — docs/key-bindings.md, docs/preferences.md, docs/architecture.md, docs/quick-start.md; run the throng-docs audit
- [x] T069 Extend packages/ui/tests/e2e/editor-encoding.e2e.ts: choose CR from the line-ending indicator and UTF-8 from the encoding indicator before saving, and assert the bytes; no new declaration, so the budget is unchanged

## Phase 11: Convergence

- [x] T070 Add an integration test that a Change Encoding survives the recovery snapshot — restored dirty, in the chosen encoding, and saved in it — in packages/ui/tests/integration/editor-encoding.integration.test.ts per FR-055 (partial)

## Phase 12: Iteration 2026-10-25, round 3 — every invisible character, legibly (FR-062, FR-063)

- [x] T071 [renderer] Write failing tests: a pure `whitespaceLabel(code)` names every FR-062 character (Unicode abbreviation, else `U+XXXX`) and returns nothing for ordinary text; the extension marks each character of the whitespace-all set, line breaks read `LF`/`CR`/`CRLF` — in packages/ui/tests/unit/whitespace-labels.test.ts and packages/ui/tests/component/view-whitespace.test.ts
- [x] T072 [renderer] Implement the FR-062 set and labels in packages/ui/src/renderer/editor/whitespace-labels.ts (new) and packages/ui/src/renderer/editor/view-whitespace.ts
- [x] T073 [renderer] Restyle every mark per FR-063 — accent-tinted background, full editor foreground — in packages/ui/src/renderer/editor/editor.css; the css-variables guard stays green

## Phase 13: Iteration 2026-10-25, round 4 — one cell per marker, boxed (FR-064)

- [x] T074 [renderer] Write failing tests: every label carries ONE glyph; each named, line-break and BOM marker shows that glyph and names the character on hover; the stylesheet gives every boxed marker a width of exactly one cell and a contrasting fill — in packages/ui/tests/unit/whitespace-labels.test.ts, packages/ui/tests/component/view-whitespace.test.ts and packages/ui/tests/unit/view-whitespace-css.test.ts (new)
- [x] T075 [renderer] Implement the glyphs and hover names in packages/ui/src/renderer/editor/whitespace-labels.ts and packages/ui/src/renderer/editor/view-whitespace.ts, and the one-cell contrasting boxes in packages/ui/src/renderer/editor/editor.css

## Phase 14: Iteration 2026-10-25, round 5 — control pictures and a name on every marker (FR-065)

- [x] T076 [renderer] Write failing tests: line-break markers show `␊` `␍` `␍␊`; space and tab marks carry a hover title; every marker title names its abbreviation and Unicode name; no marker rule sets `pointer-events: none`, and the line-break box is not held to one cell — in packages/ui/tests/component/view-whitespace.test.ts and packages/ui/tests/unit/view-whitespace-css.test.ts
- [x] T077 [renderer] Implement the control pictures and titles in packages/ui/src/renderer/editor/view-whitespace.ts, and let markers receive the pointer in packages/ui/src/renderer/editor/editor.css

## Phase 15: Iteration 2026-10-25, round 6 — line breaks legible in every theme, help cursor (FR-066)

- [x] T078 [renderer] Write failing tests: line breaks read `LF` `CR` `CR LF`; the line-break box has room around a smaller label; boxed markers show the help cursor and spaces and tabs do not — in packages/ui/tests/component/view-whitespace.test.ts and packages/ui/tests/unit/view-whitespace-css.test.ts
- [x] T079 [renderer] Implement the text labels in packages/ui/src/renderer/editor/view-whitespace.ts and their style and the help cursor in packages/ui/src/renderer/editor/editor.css

## Phase 16: Iteration 2026-10-25, round 7 — hover-name popover and its preference (FR-067)

- [x] T080 [core] Write failing tests for `editor.whitespaceHoverNames` (default true, honour false, reject non-boolean; an Editor toggle) in packages/core/tests/unit/editor-settings.test.ts and packages/core/tests/unit/settings-metadata.test.ts, then add it to packages/core/src/config/app-settings.ts and packages/core/src/config/settings-metadata.ts
- [x] T081 [renderer] Write failing tests: markers carry their name as data and no `title`; a popover shows after 500 ms over a marker, not before, follows the pointer and closes on leave; with the preference off there is no popover and no help cursor — in packages/ui/tests/component/view-whitespace.test.ts and packages/ui/tests/unit/view-whitespace-css.test.ts
- [x] T082 [renderer] Implement the popover and the preference switch in packages/ui/src/renderer/editor/view-whitespace.ts, packages/ui/src/renderer/editor/use-editor.ts and packages/ui/src/renderer/editor/editor.css; document the preference in docs/preferences.md

## Phase 17: Iteration 2026-10-29, round 8 — tell the user how the document was read (FR-068)

- [x] T083 [core] Write failing tests for `misreadSuspect(text)` — flags a word mixing an ASCII letter with a letter in U+0250–U+07FF when every non-ASCII character is a two-byte UTF-8 one; not accented Latin, single-script Greek or Cyrillic, double-encoded `cafÃ©`, or any text holding a character from U+0800 up — in packages/core/tests/unit/misread-hint.test.ts, then implement packages/core/src/editor/misread-hint.ts and export it
- [x] T084 [main] Write failing tests: a suspect UTF-8 open relays a `suspect` read notice; a reopen relays `reopened` with its encoding; the notice survives an edit and a Change Encoding, goes on a save in another encoding or a dismiss, stays on a save in the read encoding; `getContent` carries it — in packages/ui/tests/integration/editor-encoding.integration.test.ts, then implement in packages/ui/src/main/editor-coordinator.ts, packages/ui/src/main/editor-ipc.ts, packages/ui/src/preload/preload.cts and packages/ui/src/renderer/global.d.ts
- [x] T085 [renderer] Write failing tests: the notice shows both wordings with their actions, Reopen as Windows-1252 reopens, Change Encoding… opens the picker in change mode, Dismiss asks main to clear it, and a refused save outranks it — in packages/ui/tests/component/read-notice-banner.test.ts, then implement packages/ui/src/renderer/editor/read-notice-store.ts, packages/ui/src/renderer/editor/read-notice-banner.tsx and its wiring in packages/ui/src/renderer/editor/editor-failure-banner.tsx and packages/ui/src/renderer/editor/use-editor.ts

## Phase 18: Iteration 2026-10-29, round 9 — Windows code pages, the fallback encoding, the misread warning (FR-069)

- [x] T086 [core] Write failing tests: each new code page round-trips every defined byte, refuses an undefined one on read and an unholdable character on write, is labelled for the status bar and the lists, and `ENCODING_CHOICES` groups Unicode then code pages; detection ends in a given fallback and drops to Windows-1252 on an undefined byte — in packages/core/tests/unit/text-fidelity-codepages.test.ts, then implement in packages/core/src/editor/text-fidelity.ts and packages/core/src/workspace/model.ts
- [x] T087 [core] Write failing tests for `looksMisreadAs(text, readAs)` and `codePageHint(bytes, text, readAs)` — a Greek, Cyrillic, Hebrew or Arabic file read as Windows-1252 is flagged with its code page; Polish read as Windows-1252 is flagged; French, German, Spanish, Danish, Portuguese and the legacy fixture are not; a Western file read as Windows-1253 is flagged — in packages/core/tests/unit/code-page-shape.test.ts and packages/ui/tests/unit/code-page-guess.test.ts, then implement packages/core/src/editor/misread-hint.ts and packages/ui/src/main/code-page-guess.ts (jschardet stays in main: the renderer imports core)
- [x] T088 [core] Write failing tests for `editor.fallbackEncoding` (default windows1252, honour each code page, reject anything else; an Editor list control) in packages/core/tests/unit/editor-settings.test.ts and packages/core/tests/unit/settings-metadata.test.ts, then add it to packages/core/src/config/app-settings.ts and packages/core/src/config/settings-metadata.ts
- [x] T089 [main] Write failing tests: the editor, Find in Files and the in-place rewrite read with the fallback; a suspect fallback read relays a notice carrying its `likely` code page; a UTF-8 suspect names the fallback — in packages/ui/tests/integration/editor-encoding.integration.test.ts and the Find in Files and rewrite integration suites, then implement in packages/ui/src/main/editor-service.ts, packages/ui/src/main/editor-coordinator.ts, packages/ui/src/main/file-search-service.ts and packages/ui/src/main/text-file-rewrite.ts
- [x] T090 [renderer] Write failing tests: the lists group Unicode then code pages with script names; the notice wordings and their Reopen as *G*, Reopen with Encoding… and Dismiss actions — in packages/ui/tests/component/status-strip-encoding.test.ts, packages/ui/tests/component/content-menu-encoding.test.ts and packages/ui/tests/component/read-notice-banner.test.ts, then implement in packages/ui/src/renderer/editor/encoding-picker.tsx, packages/ui/src/renderer/editor/status-strip.tsx, packages/ui/src/renderer/editor/content-menu.ts and packages/ui/src/renderer/editor/read-notice-banner.tsx
- [x] T091 [docs] Document `editor.fallbackEncoding` in docs/preferences.md, and the code pages and the warning in docs/quick-start.md and docs/architecture.md

## Phase 19: Iteration 2026-10-29, round 10 — grouped encoding lists (FR-070)

- [x] T092 [renderer] Write failing tests: the indicator's menu and the content menu's Encoding item show the four Unicode rows, then a Windows Code Pages submenu (ticked when the current encoding is inside) holding the nine code pages, then Reopen with Encoding…; the pickers show the rows under the headings Unicode and Windows Code Pages — in packages/ui/tests/component/status-strip-encoding.test.ts and packages/ui/tests/component/content-menu-encoding.test.ts, then implement in packages/ui/src/renderer/editor/content-menu.ts and packages/ui/src/renderer/editor/encoding-picker.tsx
- [x] T093 [docs] Describe the grouped encoding menu in docs/preferences.md (Status Bar) and docs/quick-start.md

## Phase 20: Iteration 2026-10-29, round 11 — the reopen remedies, undefined bytes (FR-071, FR-072)

- [x] T094 [core] Write failing tests: each undefined byte of 1253, 1255 and 1257 reads as U+F700 + byte and writes back as that byte; a file with one reads in that code page by Reopen and as the fallback — in packages/core/tests/unit/text-fidelity-codepages.test.ts, then implement in packages/core/src/editor/text-fidelity.ts
- [x] T095 [main] Write failing tests: the Greek fixture with an undefined byte is suggested as Windows-1253; a suggestion whose reading looks misread is dropped — in packages/ui/tests/unit/code-page-guess.test.ts, then implement in packages/ui/src/main/code-page-guess.ts
- [x] T096 [renderer] Write failing tests: a code-page reopen notice reads "To open it this way every time…" with Convert to UTF-8, Use E as Fallback Encoding and Dismiss; UTF-16 omits the fallback action; Convert changes the encoding to UTF-8; the fallback action patches `editor.fallbackEncoding` and dismisses — in packages/ui/tests/component/read-notice-banner.test.ts, then implement in packages/ui/src/renderer/editor/read-notice-banner.tsx
- [x] T097 [docs] Describe the remedies and kept undefined bytes in docs/quick-start.md and docs/architecture.md

## Phase 21: Iteration 2026-10-29, round 12 — the indicator names the script (FR-073)

- [x] T098 [renderer] Write a failing test that a Windows-1253 document's encoding indicator reads `Windows-1253 (Greek)` with the accessible name "encoding: Windows-1253 (Greek)" and a UTF-8 one `UTF-8`, in packages/ui/tests/component/status-strip-encoding.test.ts, then implement in packages/ui/src/renderer/editor/status-strip.tsx; update docs/preferences.md

## Phase 22: Iteration 2026-10-29, round 13 — no setting is written from the notice (FR-074)

- [x] T099 [renderer] Change the reopen-notice tests to expect Convert to UTF-8 and Dismiss only, with the sentence ending "in preferences.", in packages/ui/tests/component/read-notice-banner.test.ts, then remove the action in packages/ui/src/renderer/editor/read-notice-banner.tsx; update docs/quick-start.md
