# Tasks: v1.0.0 fixes and tweaks

**Input**: `specs/081-v1-fixes-and-tweaks/` (spec, plan, research R1–R13, data-model, contracts)

**Tests**: required. Principle V and FR-100: every bug story starts from a failing test; every tweak gets its test
first at the lowest layer that proves it. Component tests are jsdom; E2E runs on CI only.

Format: `- [ ] T### [P?] [US#] description — path`

## Phase 1: Setup

- [ ] T001 Confirm the fast baseline is green (lint, typecheck, unit, component) before any change — no file

## Phase 2: Foundational

None. The stories share no prerequisite; each phase stands alone.

## Phase 3: US1 — A green nightly pipeline (P1, #723)

- [ ] T002 [US1] Reproduce the lapse-wait race: run the "does not attribute a previous launch attempt's reason"
      test in a 50-round loop under CPU load, and record the failure rate — `packages/daemon/tests/integration/pty-agent-launch-timeout.integration.test.ts`
- [ ] T003 [US1] [derived] The local loop does not reproduce the CI margin; reproduce deterministically instead by
      shrinking the test's wait to the nominal lapse (450 ms) and observing the CI assertion fail, then restore — `packages/daemon/tests/integration/pty-agent-launch-timeout.integration.test.ts`
- [ ] T004 [US1] Clamp the connect retry delay to `Math.min(RETRY_MS, deadline - now)` — `packages/daemon/src/pty-agent-host.ts`
- [ ] T005 [US1] Wait the connect budget + one retry interval + grace for the lapse, and dispose the host in
      `finally` in the tests that build a live server — `packages/daemon/tests/integration/pty-agent-launch-timeout.integration.test.ts`
- [ ] T006 [US1] Bound the inner `project-new` click inside `createProject`'s `toPass` with `{ timeout: 2_000 }`,
      and wait for `project-new` to be visible on its own budget before the first click (R2) [derived: in `createProject`, not `launchApp`, since some specs launch without a projects pane] — `packages/ui/tests/e2e/harness.ts`
- [ ] T007 [US1] Re-run T002's loop green, then dispatch `pipeline.yml` stress runs (`-f stress_spec=… -f
      stress_rounds=20`) for the integration test on macOS and the FR-000a E2E on Linux (SC-001) — no file

## Phase 4: US2 — Couldn't-open notices that are true (P1, #728)

- [ ] T008 [P] [US2] Failing component test: an editor restored onto an existing folder raises a notice whose text
      and detail say "folder", with no `path-missing` cause — `packages/ui/tests/component/missing-file-watcher-reason.test.ts`
- [ ] T009 [P] [US2] Failing component test: a Back/Forward step onto a gone path, then a tab switch, raises no
      notice — `packages/ui/tests/component/missing-file-watcher-history.test.ts`
- [ ] T010 [P] [US2] Failing component test: a panel hidden by Focus Mode whose file is missing raises no notice
      until Focus Mode ends, then exactly one (FR-012a) — `packages/ui/tests/component/missing-file-watcher-hidden.test.ts`
- [ ] T011 [P] [US2] Failing integration test: an external delete then re-create within 200 ms produces no
      `deleted` relay, no force-dirty and a reload; a delete not re-created produces one `markDeleted` after
      `EXTERNAL_DELETE_SETTLE_MS`; `beginMove` still needs no timer; the re-create case loops 20 times (SC-002). Each
      US2 test names in its title which #728 candidate cause it covers (FR-015) — `packages/ui/tests/integration/editor-external-delete-settle.integration.test.ts`
- [ ] T012 [P] [US2] Failing integration test: the same two cases for a standalone Markdown preview — `packages/ui/tests/integration/preview-external-delete-settle.integration.test.ts`
- [ ] T013 [US2] Add `unloadableReason` and `historyStandIn` to the editor UI state ("Set with `unloadableDetail`;
      kept when an authority `unloadable` verdict carries no reason; cleared with `unloadable`") — `packages/ui/src/renderer/editor/editor-state.ts`
- [ ] T014 [US2] Publish `unloadableReason` wherever `unloadableDetail` is set, keep it across a reason-less verdict,
      and mark the Back/Forward stand-in as `historyStandIn` without setting `fileMissing` (match main, 044 FR-105) — `packages/ui/src/renderer/editor/use-editor.ts`
- [ ] T015 [US2] Report the real reason through `missingFileMessage(reason)`, set `causeKind: 'path-missing'` only
      for a missing reason, skip `historyStandIn` panels, and hold Focus-Mode-hidden panels in a pending map reported
      once on show via `subscribeMaximise` — `packages/ui/src/renderer/editor/missing-file-watcher.tsx`
- [ ] T016 [US2] Add `EXTERNAL_DELETE_SETTLE_MS = 500` with the FR-013a comment — `packages/ui/src/main/external-delete-settle.ts`
- [ ] T017 [US2] Defer `markDeleted` in `onDiskChange`'s failed-read branch behind the settle timer per the
      settle-window contract (restart on a newer change, clear on dispose and `beginMove`, re-read on fire) — `packages/ui/src/main/editor-coordinator.ts`
- [ ] T018 [US2] Apply the same deferral to watch-driven `deleted` reads of standalone previews — `packages/ui/src/main/preview-service.ts`
- [ ] T019 [US2] Update existing tests that assert an immediate `deleted` relay or a `missing` reason for a folder
      (search `fileMissing`, `markDeleted`, `(missing)` across `packages/ui/tests/**`) and run them narrowly — `packages/ui/tests/**`

## Phase 5: US3 — Tables survive a background reload (P1, #730)

- [ ] T020 [US3] Failing component test: `applyTableLayout` on a zero-width host, then a width of 800 and
      `relayoutTables`, gives the widths a fresh layout at 800 gives, each within 1 px (SC-004) — `packages/ui/tests/component/preview-table-layout.test.ts`
- [ ] T021 [US3] Failing component test: a Markdown body redrawn while `clientWidth` is 0 runs a full measure when
      its ResizeObserver next reports a width, and a resize-handle drag afterwards starts from the measured width (FR-021) — `packages/ui/tests/component/markdown-body-table-layout.test.ts`
- [ ] T022 [US3] Skip measurement on a box-less host and return a needs-measure result; treat cached
      `available === 0` the same — `packages/ui/src/renderer/preview/table-layout.ts`
- [ ] T023 [US3] Track needs-measure in a ref and run `applyTableLayout` instead of `relayoutTables` on the 0 → W
      change only (XII) — `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx`
- [ ] T024 [US3] Record the forced-layout count for the re-measure on a 14-table, 182-row fixture in the PR
      (XII "Measured, not assumed") via a component cost test — `packages/ui/tests/component/markdown-body-table-layout.test.ts`

## Phase 6: US4 — A sync-scroll highlight on every stop (P1, #733)

- [ ] T025 [P] [US4] Failing unit test for `nonBlankSyncLine` (next non-blank; previous at document end; none for an
      all-blank document) — `packages/core/tests/unit/sync-line.test.ts`
- [ ] T026 [P] [US4] Failing component test: each table line of the #733 fixture (empty header and normal header)
      marks its own row; header and delimiter lines mark the header row — `packages/ui/tests/component/preview-sync-mark-table.test.ts`
- [ ] T027 [P] [US4] Failing component test: a stop on a blank line marks the next non-blank block in both
      directions; an editor scroll that moves the centre but not the top publishes — `packages/ui/tests/component/preview-sync-mark-blank.test.ts`
- [ ] T028 [P] [US4] Failing CSS test: no `position` and no `::before` on `table`, `thead`, `tbody` or `tr` sync
      marks; the bar sits on the row's first cell — `packages/ui/tests/component/preview-css-tokens.test.ts`
- [ ] T029 [US4] Add `nonBlankSyncLine` — `packages/core/src/editor/sync-line.ts`
- [ ] T030 [US4] Prefer the deepest element on a line and map the delimiter line to the header row — `packages/ui/src/renderer/preview/providers/markdown/block-index.ts`
- [ ] T031 [US4] Move the table-part bar to the first cell and drop `position` on table parts — `packages/ui/src/renderer/preview/providers/markdown/markdown.css`
- [ ] T032 [US4] Resolve the editor's centre line through `nonBlankSyncLine` — `packages/ui/src/renderer/editor/editor-scroll-store.ts`
- [ ] T033 [US4] Resolve the preview's centre line through `nonBlankSyncLine` and publish on centre-line changes —
      `packages/ui/src/renderer/preview/preview-panel.tsx`
- [ ] T034 [US4] E2E: a highlighted table row's cell rects equal its unhighlighted rects (`@extended @editor`),
      added to the existing preview scroll spec, e2e budget re-seeded — `packages/ui/tests/e2e/preview-scroll.e2e.ts`, `packages/ui/tests/e2e/e2e-budget.json`
- [ ] T035 [US4] Supersession note on 073 FR-033e pointing to 081 FR-032 — `specs/073-csv-spreadsheet-previews/spec.md`

## Phase 7: US5 — One-click Open and Find on title bars (P2, #725)

- [ ] T036 [US5] Failing component test: editor and preview headers show the pair then a separator at the head;
      disabled with reason when there is no file; the default-program button follows
      `explorer.showOpenInOsDefaultProgram`; the pair hides before Save/Save As — `packages/ui/tests/component/panel-header-file-icons.test.ts`
- [ ] T037 [US5] Add icon keys `openInDefaultProgram` and `findInFileExplorer` from the bundled glyph source and
      regenerate the default set — `packages/core/src/icons/icon-keys.ts`, `packages/core/src/icons/default-set/SOURCES.json`
- [ ] T038 [US5] Add the file-icons threshold above Save As — `packages/ui/src/renderer/workspace/panel-header-fit.ts`
- [ ] T039 [US5] Draw the menu rows disabled with the reason instead of absent, rename Reveal File in File Explorer
      to Find in File Explorer, and give both rows the new icons — `packages/ui/src/renderer/workspace/panel-header-menu.ts`
- [ ] T040 [US5] Add `PanelHeaderFileIcons` and mount it at the head of the actions for editors and every preview,
      calling the same handlers as the menu rows — `packages/ui/src/renderer/workspace/panel-header-file-icons.tsx`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`
- [ ] T041 [US5] Update every test asserting the old label or counting header controls
      (`preview-header-actions`, `menu-sections`, `panel-header-save-icons`, `panel-header-menu-open-default`,
      `explorer-follow-active-editor.e2e`, `panel-header-narrow.e2e`); no E2E test is added or removed, so `e2e-budget.json` is unchanged — `packages/ui/tests/**`
- [ ] T042 [US5] Supersession note on 046's menu label pointing to 081 FR-044 — `specs/046-side-panes-and-project-list/spec.md`

## Phase 8: US6 — The same Open In menu on a link (P2, #731)

- [ ] T043 [US6] Failing unit test: for an in-project text file, a folder, an out-of-project file and a binary file,
      the link menu's Open In rows equal `openInRows` for the same target, and no row appears twice — `packages/ui/tests/unit/link-menu-open-in.test.ts`
- [ ] T044 [US6] Extract `openInRows(target, ops)` from the File Explorer's builder per the open-in-rows contract,
      and call it from the File Explorer — `packages/ui/src/renderer/explorer/open-in-rows.ts`, `packages/ui/src/renderer/explorer/context-menu-items.ts`
- [ ] T045 [US6] Make core `buildLinkMenu` return the target state instead of its own Open In, OS and Open Preview
      rows — `packages/core/src/links/menu.ts`
- [ ] T046 [US6] Build the link menu's Open In submenu from `openInRows` with absolute-path ops — `packages/ui/src/renderer/links/link-menu.ts`, `packages/ui/src/renderer/links/file-link-menu.ts`
- [ ] T047 [US6] Update the link and explorer menu tests for the moved rows (`core link-menu`, `link-*`,
      `terminal-file-link-menu`, `preview-link-menu`, `editor-content-menu`, `explorer-open-in-*`) — `packages/core/tests/**`, `packages/ui/tests/**`
- [ ] T048 [US6] Supersession note on 045's top-level link rows pointing to 081 FR-053 — `specs/045-clickable-file-links/spec.md`

## Phase 9: US7 — Follow the active preview (P2, #724)

- [ ] T049 [US7] Failing unit test: `explorer.autoRevealActivePreview` parses, defaults to true, and sits after
      `autoRevealActiveFile` in metadata — `packages/core/tests/unit/app-settings.explorer.test.ts`
- [ ] T050 [US7] Failing component test: activating a preview reveals its source with focus kept; off → unchanged;
      outside the root → unchanged; the editor setting does not affect it — `packages/ui/tests/component/explorer-follow-active-preview.test.ts`
- [ ] T051 [US7] Add the setting (type, default, parse, clone, metadata, copy) — `packages/core/src/config/app-settings.ts`, `packages/core/src/config/settings-metadata.ts`
- [ ] T052 [US7] Add `useActivePreviewFilePath` and follow it in the tree — `packages/ui/src/renderer/preview/active-preview-file.ts`, `packages/ui/src/renderer/explorer/file-tree.tsx`
- [ ] T053 [US7] Regenerate the shipped defaults and document the key — `scripts/generate-shipped-defaults.mjs` output, `docs/preferences.md`

## Phase 10: US8 — Ignored entries read as secondary (P2, #729)

- [ ] T054 [P] [US8] Failing integration test for the git oracle against a fixture repo: ignored file, ignored
      folder with a trailing `/`, a tracked sibling, a path matched only by `.git/info/exclude`, a nested repository answering its own rules, a non-repo root (empty, one log line however many calls), empty input (no spawn) — `packages/platform-node/tests/integration/git-ignore-oracle.integration.test.ts`
- [ ] T055 [P] [US8] Failing component test: ignored rows carry the modifier, descendants of an ignored folder
      inherit it, the answer arriving late fades in, a `.gitignore` change re-asks — `packages/ui/tests/component/explorer-ignored-fade.test.ts`
- [ ] T056 [P] [US8] Failing unit test: the 078 gate blends faded tree text at the default opacity over the tree
      background and requires 3:1 in every bundled theme — `packages/core/tests/unit/theme-quality.test.ts`
- [ ] T057 [US8] Add the `IgnoreOracle` interface — `packages/core/src/abstractions/ignore-oracle.ts`
- [ ] T058 [US8] Implement it over `git check-ignore -z --stdin` off-loop — `packages/platform-node/src/git-ignore-oracle.ts`
- [ ] T059 [US8] Wire the oracle in main's composition root and expose `throng:files:ignored` — `packages/ui/src/main/main.ts`, `packages/ui/src/main/files-ipc.ts`, `packages/ui/src/main/files-service.ts`, preload/IPC contract
- [ ] T060 [US8] Add the ignored-entry opacity token ("number, 0.2–1, step 0.05, default 0.6"; if a bundled theme fails T056 at 0.6, the default rises in 0.05 steps until every theme passes, and the value is recorded in research R11) with metadata,
      copy and CSS var, and the gate pairing — `packages/core/src/config/theme.ts`, `theme-metadata.ts`, `theme-copy.ts`, `theme-quality.ts`
- [ ] T061 [US8] Ask after each listing and on a `.gitignore` change; add `.tree-row--ignored` — `packages/ui/src/renderer/explorer/use-explorer-data.ts`, `tree-node.tsx`, `explorer.css`

## Phase 11: US9 — A row to type into after the last CSV row (P2, #732)

- [ ] T062 [P] [US9] Failing unit test: writing a value at row `records` pads to `model.width`, keeps the line
      ending, and keeps the trailing-line-ending state (FR-081a both ways) — `packages/core/tests/unit/csv-edit.test.ts`
- [ ] T063 [P] [US9] Failing component test: the grid shows an entry row with no number; typing writes one line and
      shows a new entry row; one undo removes it; Cut and Insert Row Above are disabled on it; selecting writes nothing; a multi-row paste writes every row and leaves one entry row; a CSV with no rows shows only the entry row — `packages/ui/tests/component/csv-entry-row.test.ts`
- [ ] T064 [US9] Pad appended records to `model.width` — `packages/core/src/csv/csv-edit.ts`
- [ ] T065 [US9] Draw `records + 1` rows with the entry row muted and unnumbered, and let selection reach it — `packages/ui/src/renderer/grid/data-grid.tsx`, `packages/ui/src/renderer/grid/grid-selection.ts`
- [ ] T066 [US9] Route entry-row edits and pastes through `setCells`, and disable Cut and Insert Row Above on it — `packages/ui/src/renderer/preview/providers/csv/csv-body.tsx`
- [ ] T067 [US9] Note on 073 FR-038, FR-037c and FR-037f pointing to 081 FR-083 — `specs/073-csv-spreadsheet-previews/spec.md`

## Phase 12: US10 — Focus Mode looks the same on every panel (P3, #727)

- [ ] T068 [US10] Failing component test: a terminal status bar in Focus Mode carries the strip class and badge;
      outside Focus Mode it does not; with the bar hidden nothing renders; the 078 gate pairs the toggle and flavour-label colours with the highlight background in every bundled theme (FR-091) — `packages/ui/tests/component/focus-mode-indicator.test.ts`
- [ ] T069 [US10] Move the highlight rule to a selector on the modifier class alone — `packages/ui/src/renderer/editor/editor.css`
- [ ] T070 [US10] Add the class and badge to the terminal status bar, `position: relative`, and the toggle colour
      override — `packages/ui/src/renderer/terminal/terminal-status-bar.tsx`, `packages/ui/src/renderer/terminal/terminal.css`
- [ ] T074 [US10] Audit every panel type with a status strip (editor, text and binary previews, maximise layer,
      terminal, placeholder) and record the checked list for the PR body (FR-093) — `specs/081-v1-fixes-and-tweaks/research.md`

## Phase 13: Polish

- [ ] T071 Run the `throng-docs` audit and update `docs/preferences.md`, the user guide pages under `site/guide/`
      and `GUIDE_MAP` for the new setting, buttons, link menu, fade and entry row — `docs/`, `site/guide/`, `packages/core/src/help/guide-map.ts`
- [ ] T072 Add a `## Unreleased` changelog entry per issue — `CHANGELOG.md`
- [ ] T073 Run lint, per-package typecheck, unit, component, and the integration and contract files this branch
      touched — no file

## Dependencies

- Stories are independent. Shared files: `panel-placeholder.tsx` (US5 only), `file-tree.tsx` (US6 builder call, US7
  follow), `menu-sections.test.ts` (US5, US6), `icon-keys.ts` (US5). US6 and US7 run in one agent; US8 runs after US7
  in the explorer files it shares.
- Polish after every story.

## Parallel examples

- US2: T008–T012 together; then T013 → T014 → T015 and T016 → T017 → T018.
- US4: T025–T028 together.
- Across stories: US1, US2, US3+US4, US5–US7, US9+US10 in five agents.

## Implementation strategy

P1 stories first (US1 unblocks the release preflight). Each phase commits on its own.
