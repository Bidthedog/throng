# Tasks: Markdown preview extensions — callouts, maths and printing

**Input**: `specs/075-markdown-preview-extensions/` — spec.md, plan.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: required (Principle V, test-first). Each test task precedes the code it covers and must fail first.

## Phase 1: Setup

- [x] T001 Add `markdown-it-obsidian-callouts` 0.3.5 (pinned) and `katex` ^0.18.10 to `packages/ui/package.json`, and the root `overrides` entry `"markdown-it": "^15.0.3"` in `package.json`; refresh `package-lock.json`; confirm `npm run generate:licenses` lists both (FR-017, FR-051, FR-092; research R1, R13)

## Phase 2: Foundational

- [x] T002 [P] Unit test: callout registry — every entry has an icon key in `ICON_KEYS`, a role among the seven, unique ids and aliases; alias and case resolution; unknown → note; title rule of FR-002 — in `packages/core/tests/unit/callouts.test.ts` (FR-018, FR-019, FR-019a)
- [x] T003 Implement the registry, `resolveCalloutType`, `calloutTitle`, `CALLOUT_ROLES` in `packages/core/src/preview/callouts.ts`; export from `packages/core/src/index.ts`
- [x] T004 [P] Add the thirteen icon keys `calloutNote … calloutQuote` to `packages/core/src/icons/icon-keys.ts` with descriptions, the Lucide art under `packages/core/src/icons/default-set/`, `SOURCES.json` entries, `icon-sets-README.txt` lines; regenerate `default-icon-set.generated.ts` (`npm run generate:icons`) (FR-024)

## Phase 3: User Story 1 — Callouts read as what they are (P1)

**Goal**: typed, iconed, titled callouts. **Independent test**: fixture of every type and alias renders as its canonical type.

- [x] T005 [P] [US1] Unit test (node, spy sanitiser): parser pin for every FR-001 – FR-006 form against the shipped markdown-it, admonition fences stay `<pre><code data-lang="ad-note">`, the emitted markup of `contracts/callout-markup.md` (canonical id, fold, title-only has no body, source line), plain blockquotes unchanged, marker on the second line stays a blockquote — in `packages/ui/tests/unit/preview-callouts-pipeline.test.ts` (FR-013, FR-015, FR-016)
- [x] T006 [US1] Implement the callout rules in `packages/ui/src/renderer/preview/providers/markdown/callouts.ts` (`installCallouts(md)`: package parser, fence hold, token rewrite, title inline token, empty-paragraph drop, renderer rules) and register it from `pipeline.ts` (research R1)
- [x] T007 [P] [US1] Component test (jsdom DOMPurify): hostile types and titles, raw HTML carrying `data-callout*` without the nonce, an unknown `data-callout` value — none survives or executes; the sanitiser is in the path for callouts — in `packages/ui/tests/component/preview-callouts-sanitise.test.ts` (FR-014, SC-007)
- [x] T008 [US1] Admit and verify the callout attributes in `packages/ui/src/renderer/preview/providers/markdown/sanitise.ts` (contract `callout-markup.md` §Sanitiser)
- [x] T009 [P] [US1] Component test: the body draws each callout's icon from the resolver by `callout<Id>` and the title text; no `[!…]` text visible — in `packages/ui/tests/component/preview-callouts-dom.test.ts`
- [x] T010 [US1] Implement `packages/ui/src/renderer/preview/providers/markdown/callout-dom.ts` (icons) and call it from the draw effect in `markdown-body.tsx`; styles in `markdown.css` (FR-001 – FR-003, FR-020)

## Phase 4: User Story 2 — Callouts fold, nest and hold ordinary Markdown (P1)

**Goal**: fold by mouse and keyboard, nesting, bodies render as anywhere else. **Independent test**: three-deep fixture toggled by keyboard; scroll sync lands inside callouts.

- [x] T011 [P] [US2] Component test: `-`/`+`/none fold behaviour, click and Enter/Space toggle, `tabindex`/`role`/`aria-expanded`/hover, nested callouts, fold state kept across a re-render and reset when the sign changes, Collapse All leaves callouts alone, a task box inside a callout carries its source line — in `packages/ui/tests/component/preview-callouts-dom.test.ts` (FR-004 – FR-009, SC-003)
- [x] T012 [US2] Implement fold state, controls and keyboard in `callout-dom.ts` and `markdown-body.tsx` (research R3)
- [x] T013 [P] [US2] Component test: find matches title and body text, never the marker; reaching a match inside a collapsed callout expands it and its collapsed ancestors; copy plain text has no marker — in `packages/ui/tests/component/preview-callouts-dom.test.ts` (FR-010, FR-011, edge case Copy)
- [x] T014 [US2] Wire reveal into the body's reveal path and exclude callout furniture from find and copy in `markdown-body.tsx`, `preview/copy.ts`, `preview/preview-search.ts` (FR-010, FR-011)
- [x] T015 [P] [US2] Unit test: every block inside a callout, and the callout's own element, carries the same `data-source-line` it would in a plain blockquote — extend `preview-callouts-pipeline.test.ts` (FR-012, SC-004)

## Phase 5: User Story 3 — Callouts follow the theme and the icon set (P2)

**Goal**: seven role tokens per theme, editable, contrast-guarded. **Independent test**: every shipped theme passes the guards; editing a role recolours an open preview.

- [x] T016 [P] [US3] Unit tests: the seven tokens exist in every shipped theme, are in area `Markdown preview · Callouts` after Editor, have descriptions naming their types, and pass the contrast guards (title, body, icon) over the tinted background — in `packages/core/tests/unit/callout-theme-tokens.test.ts` (FR-021 – FR-023, SC-002)
- [x] T017 [US3] Add `calloutNeutral … calloutDanger` to `packages/core/src/config/theme.ts`, every theme in `default-themes/index.ts`, the area in `theme-metadata.ts` (`THEME_AREA_GROUPS` gains `Markdown preview`), descriptions, the contrast check in `theme-quality.ts`; bump `SHIPPED_DEFAULTS_VERSION` to 36 and append the leaves to `packages/core/tests/fixtures/theme-leaves-by-version.json` (R4; no static fallback is needed — `css-variables-defined.test.ts` reads every token the theme emits)
- [x] T018 [US3] Role colour rules in `markdown.css`, selected by the `data-callout-role` the pipeline writes from the registry (seven rules, never one per type, FR-019a); `preview-css-tokens.test.ts` holds callout rules to their own shape (FR-020)

## Phase 6: User Story 4 — Maths typesets (P2)

**Goal**: GitHub-compatible delimiters, KaTeX lazily, safe. **Independent test**: GitHub's cases fixture.

- [x] T019 [P] [US4] Unit test: `math-delimiters.ts` — opening/closing rules, `\$`, digits after close, `` $`…`$ ``, `$$` block across lines, unclosed `$$` — in `packages/core/tests/unit/math-delimiters.test.ts` (FR-040, FR-041, SC-005)
- [x] T020 [US4] Implement `packages/core/src/preview/math-delimiters.ts`
- [x] T021 [P] [US4] Unit test (spy sanitiser): the pipeline emits `contracts/math-markup.md` placeholders with source lines; nothing in code spans or fences; with `typesetMath: false` the output equals today's — in `packages/ui/tests/unit/preview-math-pipeline.test.ts` (FR-040, FR-042, FR-045)
- [x] T022 [US4] Implement `packages/ui/src/renderer/preview/providers/markdown/math.ts` (`installMath(md)`), register it from `pipeline.ts`, carry `typesetMath` in `RenderEnvironment`; admit `data-math`/`data-math-open` in `sanitise.ts`
- [x] T023 [US4] Add the `typesetMath` provider setting ("Typeset math", default on) to `packages/core/src/preview/providers/markdown.ts`; regenerate shipped defaults (FR-042, FR-090)
- [x] T024 [P] [US4] Component test: typeset output, error form with hover, `\href`/`\url`/`\includegraphics`/`\htmlClass`/`\htmlStyle` render as errors or text with no link or resource, the maths sanitiser is in the path, a pathological expansion and an oversized rule render as errors without hanging, a document without maths never imports the typesetter — in `packages/ui/tests/component/preview-math-typeset.test.ts` (FR-044, FR-046 – FR-048, SC-006, SC-007)
- [x] T025 [US4] Implement `packages/ui/src/renderer/preview/providers/markdown/math-typeset.ts` (KaTeX and its own sanitiser, its own lazy chunk in `vite.config.ts`) and `math-dom.ts`; call from `markdown-body.tsx` in yielding batches; styles from theme tokens in `markdown.css` (FR-043, FR-044)
- [x] T026 [P] [US4] Component test: find skips typeset equations and matches source when off; plain copy puts source with delimiters, rich copy keeps the equation — in `packages/ui/tests/component/preview-math-find-copy.test.ts` (FR-049, FR-050)
- [x] T027 [US4] Implement find exclusion and copy substitution in `preview-search.ts` / `preview-search-model.ts` and `copy.ts`; admit KaTeX's tags for the copied-equation shape in the export profile (`sanitise.ts`)

## Phase 7: User Story 6 — Print is part of the preview contract (P3, ahead of US5: US5 builds on it)

**Goal**: providers declare print; one command and menu item. **Independent test**: contract test with a non-printing and a pages-printing fake.

- [x] T028 [P] [US6] Unit tests: `preview.print` scope is `{preview}` only, ships `Ctrl+P` (Windows, Linux) / `Cmd+P` (macOS), collides with nothing in scope, has a descriptor — extend `packages/core/tests/unit/keybindings-scope.test.ts` and add `packages/core/tests/unit/preview-print-binding.test.ts` (FR-064)
- [x] T029 [US6] Add `preview.print` to `ActionId`, `COMMAND_SCOPES` (`PRINT_SURFACES = {preview}`), every platform's bindings and `keybindings-metadata.ts` in `packages/core/src/config/`
- [x] T030 [P] [US6] Contract test: a descriptor declaring `print` needs a view `printable`; a fake provider without `print` shows Print… disabled with the hover and the chord does nothing; a fake `pages` provider reaches `throng.print.open` with its pages — in `packages/ui/tests/contract/preview-print-provider.contract.test.ts` (FR-060 – FR-062, SC-011)
- [x] T031 [US6] Add `print?: 'document' | 'pages'` to `packages/core/src/preview/provider.ts`, `PrintableOutput`/`PrintJobRequest` types to `packages/core/src/preview/print.ts`, `printable?` to `packages/ui/src/renderer/preview/provider-view.ts`; declare `print: 'document'` on the Markdown and Mermaid descriptors
- [x] T032 [P] [US6] Component test: Print… in the header and body menus, enabled for Markdown, disabled with the hover for a non-printing provider; Ctrl+P in a focused preview calls `throng.print.open` once — in `packages/ui/tests/component/preview-print-command.test.tsx` (FR-062, FR-063)
- [x] T033 [US6] Implement the command handler and menu items in `preview-commands.tsx`, `content-menu.ts` and `preview-panel.tsx`; preload `throng.print.open` in `packages/ui/src/preload/preload.cts` and its renderer typing in `global.d.ts`

## Phase 8: User Story 5 — Print what a preview shows (P2)

**Goal**: Print Preview window, pagination, print with chosen settings, persisted settings. **Independent test**: controller over the recording engine; settings survive a restart.

- [x] T034 [P] [US5] Unit tests: `parsePrintSettings` fallbacks (missing file, bad JSON, each bad field, vanished printer), page range never persisted, `toPdfOptions`/`toPrintOptions` mappings for every margin preset, orientation, scale, range and copies, `pickDefaultPrinter` — in `packages/core/tests/unit/print-settings.test.ts` (FR-068, FR-070)
- [x] T035 [US5] Implement `packages/core/src/preview/print.ts` (settings model, parse, mappings, page sizes) and `packages/core/src/abstractions/print-engine.ts`; `RecordingPrintEngine` in `packages/core/src/testing/recording-print-engine.ts`
- [x] T036 [P] [US5] Unit test: the print palette has a value for every colour token, is not the Light theme object (editing Light changes nothing), and its text, code and callout colours pass the contrast guards — in `packages/core/tests/unit/print-palette.test.ts` (FR-072, SC-013)
- [x] T037 [US5] Implement `packages/core/src/preview/print-palette.ts`
- [x] T038 [P] [US5] Integration test: `PrintSettingsStore` reads, writes atomically and survives a corrupt file — in `packages/ui/tests/integration/print-settings-store.test.ts` (FR-070)
- [x] T039 [US5] Implement `packages/ui/src/main/print-settings-store.ts`
- [x] T040 [P] [US5] Integration test (recording engine, fake window factory): open → job loaded, a second open focuses and changes nothing, render returns page count, print uses the window's settings with `silent`, print failure returns the cause and logs, close saves settings and removes temp files, `print` never runs for a job that was not shown — in `packages/ui/tests/integration/print-controller.test.ts` (FR-064, FR-068 – FR-071, FR-080, SC-012)
- [x] T041 [US5] Implement `packages/ui/src/main/print-controller.ts`, `print-ipc.ts`, and wire them in `main.ts`
- [x] T042 [US5] Implement `packages/ui/src/main/electron-print-engine.ts` (hidden print host with JavaScript off, printToPDF, silent print, printer list, request filter for the job's remote images) and `packages/ui/src/main/print-preview-window.ts` (single, modal to the requesting window, PDF page view) (research R8, R11)
- [x] T043 [P] [US5] Component test: the printable builder opens collapsed sections and callouts, strips fold toggles, diagram controls, link roles and notices (except a failed diagram's), resets diagram transforms, lists only loaded remote images, carries the print stylesheet (headings kept with what follows, no break inside code, table rows, callouts, diagrams, images or display equations), and leaves the live DOM untouched — in `packages/ui/tests/component/print-printable.test.ts` (FR-066, FR-074 – FR-079)
- [x] T044 [US5] Implement `packages/ui/src/renderer/preview/print/printable.ts` and `print-stylesheet.ts` (page breaks per FR-073, wrapping code, fitted tables and diagrams, `fit: 'page'` for a standalone diagram); implement `printable` in the Markdown and Mermaid views
- [x] T045 [P] [US5] Component test: Print Preview app — controls from the job, a change re-renders (debounced) with progress, no printer → message and Print disabled, Print sends the settings, a failure shows one inline notice, Escape cancels — in `packages/ui/tests/component/print-preview-app.test.tsx` (FR-068, FR-069, FR-071, FR-080, FR-081)
- [x] T046 [US5] Implement `packages/ui/src/renderer/print-preview/` (app, controls with themeable icons, page area reporting its bounds) and the `?printPreview=` route in `packages/ui/src/renderer/main.tsx`; preload `throng.print.job/render/setPageArea/print/close`
- [x] T047 [US5] E2E: Ctrl+P in a Markdown preview opens one modal Print Preview window, a second Ctrl+P opens no second window, pages render, closing saves settings and a relaunch starts from them — `packages/ui/tests/e2e/print-preview.e2e.ts` (`@extended @window`), entry in `parallel-plan.json`, re-seed `e2e-budget.json` (SC-012, SC-013)

## Phase 9: Polish

- [x] T048 Docs: `docs/key-bindings.md` (Print…), `docs/preferences.md` (Typeset math, Markdown preview · Callouts), the previews page (callouts, maths, printing) per `throng-docs` (FR-091)
- [x] T049 Branch review against spec, plan, contracts and the constitution; fix findings; lint and typecheck clean
- [x] T050 Manual test plan `.claude/.manual-test-plans/feature+S075-I672-markdown-preview-extensions.md` via `planning-manual-tests`

## Iteration 2026-11-19: one page at a time (FR-068a)

- [x] T051 [US5] Unit test and implement `printedPageNumber` / `toPagePdfOptions` in `packages/core/src/preview/print.ts` — the nth printed page's document page, honouring a range (`packages/core/tests/unit/print-settings.test.ts`)
- [x] T052 [US5] Integration test and implement `PrintController.render(…, page)` and `showPage` — the whole layout counts the pages, the page shown is laid out alone, kept to the pages there are, printing still sends the whole job (`packages/ui/tests/integration/print-controller.test.ts`); IPC `throng:print:showPage`, preload, `view=Fit`
- [x] T053 [US5] Component test and implement Back / Forward (`pagePrevious`, `pageNext` icon keys) and "Page n of N" in the Print Preview app (`packages/ui/tests/component/print-preview-app.test.ts`)
- [x] T055 [US5] Fix found by T054: the printable document carried the app's `html, body, #root { height: 100%; overflow: hidden }`, so every print stopped at page one (FR-073, "nothing is clipped"). The print stylesheet now releases both; component test in `packages/ui/tests/component/print-printable.test.ts`, and the E2E requires more than one page
- [x] T054 [US5] E2E: the real window steps Forward to page 2 (`packages/ui/tests/e2e/print-preview.e2e.ts`); docs (`docs/quick-start.md`, `docs/architecture.md`); MT-06 extended

## Iteration 2026-11-20: MT-04 and MT-06 feedback

- [x] T056 [US4] Component tests and implement: typeset every expression off the page and draw them in one go (one layout, not one per batch); cache each sanitiser's typeset expressions so a redraw typesets none again; keep the MathML out of layout and name each equation by its source (`packages/ui/tests/component/preview-math-typeset.test.ts`; SC-006). Measured on MT-04's 500 expressions: open to typeset 2.2 s → 1.1 s, long frames while loading 10 → 4, while scrolling 1 → 0
- [x] T057 [US5] Print Preview draws its own pages with PDF.js (`print-preview/print-pages.ts`, `pdfjs-dist` as 074 has it): main returns the laid-out PDF from `render`; `showPage`, `setPageArea`, the overlaid PDF view and its session are removed. A page shows only once drawn, with a spinner until the first; wheel, arrows, Page Up / Page Down, Home and End step (`packages/ui/tests/component/print-preview-app.test.ts`, `packages/ui/tests/integration/print-controller.test.ts`; FR-068a). Measured on MT-04: a page step 37 – 58 ms
- [x] T058 [US5] E2E: the real window draws page 1 on a canvas, and Forward, End, Home and the wheel step (`packages/ui/tests/e2e/print-preview.e2e.ts`); docs; MT-04 and MT-06 extended
- [x] T059 [US4] Component tests and implement the shared loading placeholder (`preview/loading-placeholder.ts`): pending equations (inline and block), pending Markdown images, and the diagram's loading block on the same class; copy, print and selection carry none of it (`packages/ui/tests/component/preview-loading.test.ts`; FR-043a)
- [x] T060 [US4] Component test and implement holding the body's width while its panel is dragged to a new size — a second width change within 150 ms; a one-off change reflows at once, so place-keeping on a notice or scrollbar is untouched (`preview/resize-freeze.ts`, `packages/ui/tests/component/preview-resize-freeze.test.ts`; SC-006). Measured on MT-04 over a 20-step resize: long frames 5 – 7 → 1 (the one reflow)
- [x] T061 [US4] Unit test and implement the preview body's drag behaviour — scrollbar hidden while a drag is held over a stable gutter, own compositor layer, contained; the hold moved to the panel so every provider gets it; the print stylesheet releases the containment (`preview.css`, `preview-panel.tsx`, `print-stylesheet.ts`; `packages/ui/tests/unit/preview-body-resize-css.test.ts`, `packages/ui/tests/component/print-printable.test.ts`; SC-006). Measured over one splitter drag beside MT-04: frames over 33 ms 76 → 1; paint 3.5 s → 0.2 s; plain text 0
- [x] T062 [US4] Integration test and implement Last Active reuse for a file open in an editor (`packages/ui/src/main/preview-service.ts`; `packages/ui/tests/integration/preview-service-open-target.integration.test.ts`; FR-093a); E2E helpers that assumed the Preview button always adds a panel find it by title
- [x] T064 [US5] Integration test and implement printing the pages shown: Print Preview draws each page at 300 dpi, the printer is sent those with no margin, scale or range of its own (`print-pages.ts`, `print-controller.ts`, `print-ipc.ts`, core `printSheetHtml` / `toPrintOptions`; `packages/ui/tests/integration/print-controller.test.ts`; FR-068d)
- [x] T065 [US5] Component tests and implement white paper in every theme and the dashed margin guide (`print-stylesheet.ts` `:root { color-scheme: light }`, `print-preview-app.tsx`; `packages/ui/tests/component/print-printable.test.ts`, `print-preview-app.test.ts`; FR-068c)
- [x] T066 [US5] Component tests and implement the controls of FR-068b — margins page, scale choices, free-text numbers checked after typing (`number-field.tsx`), live printer list (`throng:print:printers`), Close only; window minimum height 680 px so every control fits (`packages/ui/tests/component/print-preview-app.test.ts`, `packages/ui/tests/e2e/print-preview.e2e.ts`)
- [x] T067 [US5] Unit and component tests and implement `editor.print` (Ctrl+P, editor scope), the editor header menu's Print…, and a shared text printable any future text panel uses (`renderer/print/text-printable.ts`, `renderer/editor/editor-print.ts`; `packages/core/tests/unit/editor-print-binding.test.ts`, `packages/ui/tests/unit/editor-print-menu.test.ts`, `packages/ui/tests/component/text-printable.test.ts`, `packages/ui/tests/component/editor-print.test.ts`; FR-064a)
- [x] T063 [US5] E2E assertions and implement Print Preview kept above other windows (`alwaysOnTop`) and a settings pane that never scrolls — controls shrink to the pane, custom margins two to a row, minimum height 600 px, later 680 px (T066, T075) (`packages/ui/src/main/print-preview-window.ts`, `packages/ui/src/renderer/print-preview/print-preview.css`; `packages/ui/tests/e2e/print-preview.e2e.ts`; FR-069, FR-071)

## Dependencies

- T002–T004 before every story. US1 → US2 → US3 (shared callout modules). US4 independent of US1–US3.
- US6 (T028–T033) before US5 (T034–T047).
- Within a story: each test task before the implementation task that follows it.

## Parallel opportunities

- T002 ∥ T004; US4 (T019–T027) ∥ US1–US3; T034 ∥ T036 ∥ T038 ∥ T043.

## Implementation strategy

MVP = US1 + US2 (callouts usable). Then US3, US4, US6, US5 in that order, each a coherent commit.

## Phase 10: Convergence

- [x] T068 Open a collapsed callout, and every collapsed callout around it, when a heading inside it is the target of a `#fragment` link, a wikilink, Go to Heading or an outline jump: `scrollToHeading` in `packages/ui/src/renderer/preview/preview-panel.tsx` reveals only a hidden heading or a collapsed section; component test first, per FR-010 (partial)
- [x] T069 Leave the find match frames (`.preview-match-frames`) out of the printable copy in `packages/ui/src/renderer/preview/print/printable.ts`, with a case in `print-printable.test.ts`, per FR-076, US5 (partial)
- [x] T070 Raise one notice in the requesting panel or editor, and log it, when Print… cannot build its printable or main refuses the request (over the size cap, malformed): today `print-command.ts` and `text-printable.ts` only log and `print-ipc.ts` answers `{opened:false}` silently, per FR-080 (partial)
- [x] T071 Prove or fix the ready-made-pages print route: a `pages` printable is loaded as a PDF into a plugin-less window in `packages/ui/src/main/electron-print-engine.ts`, and the contract test stops at the IPC boundary; an integration test that a `pages` output reaches Print Preview with its pages, then whatever fix it needs, per FR-060, FR-061, US6/AS2, SC-011 (partial)
- [x] T072 Show the Print… chord on the Spreadsheet grid menu's Print… row (`gridPrintRow(undefined, …)` in `spreadsheet-body.tsx`), as the CSV grid does, per FR-075b, FR-063 (partial)
- [x] T073 Save Print Preview's current settings when the window is closed from its title bar, including a change made inside the 300 ms layout debounce or while the page range is invalid, per FR-070 (partial)
- [x] T074 Print a diagram that is still drawing as something other than a blank gap (wait for it, or print its source), per FR-043a edge case (partial)
- [x] T075 Amend the 2026-11-20 clarification and T063's note additively: Print Preview's minimum height is 680 px (T066 raised it so every control fits), superseding 600 px, per Clarifications/FR-069 (partial)
- [x] T076 Decide what a rich copy of a callout keeps (today `EXPORT_PROFILE` strips its type and role, leaving bare nested `div`s) and either emit it or amend the Copy edge case to the structure and text that survive, per edge case "Copy" (partial)
- [x] T077 Add the component test T011 claims: Collapse All and Expand All leave callouts' own fold state alone, per FR-009, T011 (partial)
- [x] T078 Add a pipeline test of a Mermaid block and a display equation inside a callout, per US2/AS4 (partial)
