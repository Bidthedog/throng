# Research: v1.0.0 fixes and tweaks

Paths are repo-relative. Each entry is Decision / Rationale / Alternatives.

## R1 — #723 macOS launch-timeout test (US1)

- **Decision**: test defect. The test at
  `packages/daemon/tests/integration/pty-agent-launch-timeout.integration.test.ts:392` waits `SHORT_READY_MS * 3`
  (600 ms) for a lapse that, after `retryAfterLapse()` (`packages/daemon/src/pty-agent-host.ts:170-173, :435`), only
  fires on the third 200 ms connect attempt (~400 ms + timer slip). Raise the wait to the connect budget plus one
  retry interval plus grace, and wrap the body in `try/finally { host.dispose() }` so a failure cannot leak a live
  host into the next test (CI showed exactly that leak). Also clamp the retry delay to
  `Math.min(RETRY_MS, deadline - now)` at `pty-agent-host.ts:216`, so the lapse fires at its budget: this makes the
  product's lapse timing match its stated budget and removes the slack the test depended on.
- **Rationale**: CI log shows the second lapse line under the next test; nothing in product logic is wrong.
- **Alternatives**: retry the test (forbidden, FR-002); widen only the wait without the clamp (leaves the 200 ms
  overshoot that made the margin thin).

## R2 — #723 Linux cross-window E2E flake (US1)

- **Decision**: harness defect. `createProject` in `packages/ui/tests/e2e/harness.ts` runs an unbounded
  `.click()` inside `toPass`, and `launchApp` returns at `firstWindow()` (`harness.ts:756`) before the renderer can
  be clicked. Bound the inner click (`{ timeout: 2_000 }`) so `toPass` retries and its final error names the reason,
  and make `launchApp` wait for the renderer-ready marker (`project-new` visible) within a launch budget.
- **Rationale**: the 15 s timeout carried no inner assertion, so no attempt finished; the retry passed in 2.3 s.
- **Alternatives**: raise the 15 s timeout (masks it); add retries (forbidden).

## R3 — #728 wrong reason (US2, FR-010/FR-011)

- **Decision**: add a structured `unloadableReason` (the 018 refusal reason) beside `unloadableDetail` in
  `packages/ui/src/renderer/editor/editor-state.ts`, published wherever `unloadableDetail` is set
  (`use-editor.ts:1753, :2943`) and kept when an authority `unloadable` verdict arrives without a reason
  (`use-editor.ts:2599`). `MissingFileWatcher.report()` (`missing-file-watcher.tsx:109-127`) passes that reason to
  the existing `missingFileMessage(reason)` (`editor-missing-notice.ts:76-98`) and sets `causeKind: 'path-missing'`
  only when `isMissingReason(reason)` (`core/src/editor/refusal.ts:27-49`).
- **Rationale**: the wording helpers already exist; only the reason is dropped.

## R4 — #728 panels nobody can find (US2, FR-012/FR-012a)

- **Decision**: (a) Back/Forward onto a gone path: the renderer sets `fileMissingRef = true` at
  `use-editor.ts:1741-1759` while main deliberately keeps `fileMissing` false for the stand-in
  (`main/editor-coordinator.ts:786-796`, 044 FR-105). Align the renderer with main: a history stand-in is
  `unloadable` with reason `missing` but marked `historyStandIn`, and the scan skips it. (b) Visibility: the layout
  model has no stack slots (`core/src/workspace/model.ts:313-352`; background tabs are not mounted). "Hidden" in
  FR-012 therefore means **hidden by Focus Mode** (`workspace/maximise-store.ts:78 isPanelHidden`). The scan holds
  hidden panels in a pending set, subscribes to `subscribeMaximise`, and reports each once when it is shown
  (FR-012a). The spec's "inactive stack slot" wording is corrected to match.
- **Alternatives**: report hidden panels and make the notice reveal them (rejected in Q3).

## R5 — #728 settle window (US2, FR-013/FR-013a)

- **Decision**: one constant `EXTERNAL_DELETE_SETTLE_MS = 500` in a new `packages/ui/src/main/external-delete-settle.ts`
  with the FR-013a comment. Editors and parented previews: defer `markDeleted` in `EditorCoordinator.onDiskChange`'s
  `!res.ok` branch (`main/editor-coordinator.ts:2927-2934`); after the window re-check the stale and `movePending`
  guards, read again, and take the existing `res.ok` path if the file is back. `markDeleted` itself stays immediate
  (in-app delete at `main.ts:2512`, move brackets 019 FR-004). Standalone previews: the same deferral in
  `PreviewService.readAndApply`'s watch-driven `deleted` branch (`main/preview-service.ts:2074-2100`). Timers are
  cleared on dispose and replaced when a newer change arrives.
- **Rationale**: one place covers notice, banner and force-dirty, because all three flow from `markDeleted`.

## R6 — #730 tables after an off-screen redraw (US3)

- **Decision**: `applyTableLayout` (`renderer/preview/table-layout.ts:294-342`) skips measurement when the host has
  no box (`clientWidth === 0` or no client rects) and returns a "needs measure" result; `markdown-body.tsx` keeps a
  ref and, when its `ResizeObserver` (`markdown-body.tsx:1240-1257`) next sees a non-zero width, runs a full
  `applyTableLayout` instead of `relayoutTables`. Cached entries with `available === 0` are treated the same.
- **Rationale**: Principle XII: ordinary resizes still only re-share; the full measure happens once, on the real
  change (width 0 → W). The PR records the measurement on the 260-line fixture shape.

## R7 — #733 sync-scroll highlight (US4)

- **Decision**:
  1. CSS (`renderer/preview/providers/markdown/markdown.css:163-184`): for `table`, `thead`, `tbody` and `tr` marks,
     no `position` and no `::before` on the part; the bar is drawn on the row's first cell
     (`tr.preview-sync-mark > :first-child`), the wash stays on the row.
  2. Mapping (`block-index.ts:197-250`): `shownElementFor` prefers the deepest element on the line; the delimiter
     line (table start + 1) maps to the header row.
  3. Blank lines: a shared pure helper `nonBlankSyncLine(lines, line)` (next non-blank, else previous non-blank, else
     none) in `@throng/core`, applied to the editor's centre line (`editor/editor-scroll-store.ts:201-208`) and the
     preview's centre line before `settleSyncMark` (`preview-panel.tsx:2087, :2200`); the preview resolves the next
     block at or after the line.
  4. Editor-led trigger: publish on a centre-line change, not only a top-line change (`preview-panel.tsx:2083`).
- **Rationale**: jsdom cannot measure geometry, so the geometry criterion is proved by a CSS assertion (no
  `::before`/`position` on table parts) at component level plus one E2E assertion in an existing Markdown preview
  spec measuring cell rects marked vs unmarked.

## R8 — #725 title-bar buttons (US5)

- **Decision**: a `PanelHeaderFileIcons` component beside `panel-header-save-icons.tsx`, mounted at the head of
  `panel-box__actions` (`panel-placeholder.tsx:1163`) for editors and every preview, followed by
  `panel-box__actions-separator`. Each calls the same handler the menu row calls (`panel-placeholder.tsx:868-897`).
  The menu rows today are **absent**, not disabled, when there is no file; the buttons draw **disabled** with the
  reason "Save the document first" in that case (Principle VI), and the menu rows change to drawn-disabled with the
  same reason so the two agree (FR-041). The default-program button follows `explorer.showOpenInOsDefaultProgram`
  exactly as the menu row does (hidden when the user turned the row off). Fit: a new threshold above Save As in
  `panel-header-fit.ts`. Icons: two new keys, `openInDefaultProgram` and `findInFileExplorer`, added to the icon set
  from the bundled glyph source (`default-set/SOURCES.json`) and regenerated.
- **Alternatives**: reuse `openInBrowser`/`folderOpen` (a lookalike icon, #127 forbids).

## R9 — #731 link menu Open In (US6)

- **Decision**: core `buildLinkMenu` (`core/src/links/menu.ts:96-187`) keeps deciding row **states** (pending,
  out-of-project, binary, folder) and stops emitting its own open-in rows; it emits one `openIn` descriptor carrying
  those states. The ui adapter (`renderer/links/link-menu.ts`) builds the submenu with a new shared
  `openInRows(target, ops)` extracted from `renderer/explorer/context-menu-items.ts:219-313`, the same function the
  File Explorer calls. Ops take absolute paths; the explorer passes its root-relative paths through a converter.
- **Rationale**: one builder, so a change to one menu reaches both (FR-050). Precedent: `describeOpenInTargets` and
  `previewOpenInRows` are already shared with Find in Files.

## R10 — #724 Follow the active preview (US7)

- **Decision**: `explorer.autoRevealActivePreview` (default true) in `app-settings.ts` and `settings-metadata.ts`
  after `autoRevealActiveFile`; `useActivePreviewFilePath()` beside `editor/active-editor-file.ts`, reading
  `usePreviewState(panelId).filePath`; `file-tree.tsx:267-299` follows whichever of the two is enabled for the
  active panel's kind. No `SHIPPED_DEFAULTS_VERSION` bump (absent keys are filled on read).

## R11 — #729 faded ignored entries (US8)

- **Decision**: a core abstraction `IgnoreOracle` (`ignored(root, relPaths) → Promise<Set<string>>`) with a
  platform-node implementation running `git -C <root> check-ignore -z --stdin` through the off-loop exec
  (`packages/platform-node/src/off-loop-exec.ts`). Exit 1 = none ignored; exit 128 or git missing = not a repo,
  logged once at debug (XIII) and answered empty. Main exposes `throng:files:ignored` (batched per listing). The
  renderer asks after each listing and on a `throng:files:changed` that names a `.gitignore`; a `.tree-row--ignored`
  modifier applies `opacity: var(--throng-explorer-ignored-opacity)`; descendants of an ignored folder inherit it.
  The opacity is a new numeric theme token (`sizes.ignoredEntryOpacity`-style leaf, default 0.6) with metadata, copy
  and CSS var. The 078 gate gains a pairing that blends faded text over the tree background and requires 3:1.
- **Rationale**: git answers its own rules (FR-070); no new recursive watch (FR-072).

## R12 — #732 CSV entry row (US9)

- **Decision**: the grid draws `records + 1` rows; the last is the entry row (`data-grid.tsx:489`, selection clamp
  `grid-selection.ts`). Writing into it calls `csvSetCells` with the row index = `records`, padded to `model.width`
  (`core/csv/csv-edit.ts:64-122` currently pads to maxCol; fix) and honouring `trailingLineEnding` (FR-081a). Row
  header: no number, muted (`textMuted`). Cut and Insert Row Above draw disabled on it. The row-header menu has no
  Delete Row today, so FR-083's list is corrected to the operations that exist.

## R13 — #727 Focus Mode strips (US10)

- **Decision**: `terminal-status-bar.tsx` adds `FOCUS_MODE_STRIP_CLASS` and `<FocusModeBadge>` via
  `usePanelInFocusMode`; the highlight rule in `editor.css:145-174` moves to a shared selector keyed on the modifier
  class alone (no second styling); `terminal.css` gets `position: relative` and a focus-mode override for the
  `.setting-toggle` colours. Audit: editor, text and binary previews, and the maximise layer already comply;
  terminal is the only gap; placeholders have no strip.
