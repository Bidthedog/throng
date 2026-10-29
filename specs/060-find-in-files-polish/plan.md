# Implementation Plan: Find in Files Polish

**Branch**: `feature/S060-I513-find-in-files-polish` | **Date**: 2026-10-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/060-find-in-files-polish/spec.md`

## Summary

Spec 043's Find in Files panel is reworked in presentation and interaction, plus one new grouping.
Nothing about how a scan runs, what it finds, or how a commit writes changes.

The approach is almost entirely **renderer work over shipped parts**:

- **One new core function** — a third `groupRows` shape, `folderTree`, built from the rows a scan
  already produced, ordered by the explorer's own `sortNodes` (folders first, the user's
  `explorer.sortOrder`) rather than 043's FR-035 comparator, which stays on the two existing shapes.
- **One new value** on the shared grouping union, its preference descriptor and `docs/preferences.md`.
- **Selection becomes identity, not index.** `ResultsList` keeps the selected item's KEY rather than
  its position in the flattened list. That one change is what makes FR-003 (rows arriving under a
  stationary selection), FR-015a (selection surviving a regroup) and FR-020/020a (single-click
  selects) hold together; an index cannot survive any of the three.
- **The row lock is lifted** (043 FR-095 superseded) and **cancel keeps its rows** (043 FR-043's
  reading superseded) — both in `find-in-files-store.ts` and `results-list.tsx`, with the replace
  lock widened to the two narrow granularities.
- **Styling**: the find bar's `.throng-search-match` rule is widened so the results list's `<mark>`
  uses it; file icons come from `explorer/tree-icons.ts`; a new `busy` icon token animates the cancel
  control, and a new `groupFolderTree` token draws the third grouping control.
- **Menu**: three items leave (`Run search`, `Cancel search`, `Change scope`), one arrives
  (`Group by folder structure`), and the two narrow replace labels are left-truncated by a new core
  path helper.

See [research.md](./research.md) for each decision and the alternatives rejected.

## Technical Context

**Language/Version**: TypeScript (`tsc -b` project references + `tsconfig.renderer.json`), ES2022,
Node 24 / Electron 44

**Primary Dependencies**: React 19.3, Vite 8, Vitest, Playwright — no new dependency

**Storage**: N/A. The grouping value rides the existing `search.inFiles.defaultGrouping` setting and
the panel's in-memory remembered grouping (043 FR-033b, memory only). No migration: the new value is
additive and an older build reading it falls back to its default.

**Testing**: Vitest `unit` (core grouping, ordering, path truncation, settings), `component` (jsdom:
results list, panel, menu, notice bar); E2E only where an existing spec asserts behaviour this feature
changes (see *Test layers* below)

**Target Platform**: Windows 10/11 (primary); the renderer code is platform-neutral

**Project Type**: Desktop app — npm workspaces monorepo: `packages/core`, `packages/ui`

**Performance Goals**: Regrouping 20,000 rows (FR-094's cap) under Folder structure stays within the
existing regroup budget — one pass to bucket, one sort per level, no per-row collator construction
(043's measured trap, `file-search.ts:157`)

**Constraints**: Fixed-height windowed list (`results-list.tsx`) — every new row shape is exactly one
line; digit grouping on every displayed quantity; themeable icon controls; hover gated on
`body:not([data-window-blurred])`

**Scale/Scope**: ~8 renderer files, 3 core files, 1 doc; no main-process or daemon change

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.* Constitution **v6.0.0**.

| Principle / gate | Verdict | Note |
|---|---|---|
| I Project-first isolation | ✅ | No cross-project state; remembered grouping stays per project (043 FR-033c) |
| II Platform-abstracted core | ✅ | New core code is pure (grouping, truncation); no OS call |
| III/IV Terminals | ✅ n/a | Untouched |
| V Test-first (NON-NEGOTIABLE) | ✅ | Every FR gets a failing test first at the lowest layer that proves it — unit for core shapes, component for rendering and interaction |
| VI Every panel action is reachable (v6.0.0) | ✅ | FR-022's three removals each keep a mouse route in the panel (run/cancel button, scope input) and run keeps its chord. The new toggle gets a menu item and a toolbar control (FR-018) |
| VI One section vocabulary | ✅ | New menu item goes in `viewState` beside the two grouping toggles |
| VI Displayed quantities digit-grouped | ✅ | `(line:character)` and every heading count through `formatGrouped` |
| VI One gesture follows a link | ✅ n/a | Result rows are not links |
| VIII SOLID / DRY / YAGNI | ✅ | Explorer ordering and icon mapping are reused, not copied; one match-style rule shared, not duplicated |
| IX DI & composition root | ✅ n/a | No new service |
| X Externalised configuration | ✅ | New preference value exposed in the Preferences editor via its descriptor (configuration-editor completeness) |
| XI Dockable workspace | ✅ | No layout change; panel persistence unchanged (grouping is not persisted per panel) |
| Themeable icon controls | ✅ | New `busy` and `groupFolderTree` tokens, defined in `theme.ts` with a fallback chain; literal tokens at call sites so `icon-tokens-exist` checks them |
| Documentation currency | ✅ | `docs/preferences.md` row for the new value; `docs-currency.test.ts` guards it |

No violations. Complexity Tracking is empty. **Post-design re-check**: unchanged — Phase 1 introduced
no new principle surface.

## Project Structure

### Documentation (this feature)

```text
specs/060-find-in-files-polish/
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── results-list-ui.md   # the panel's observable UI contract (test ids, attributes, menu)
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/core/src/
├── search/file-search.ts          # Grouping += 'folderTree'; groupRows/orderGroups folder-tree branch
├── search/path-label.ts           # NEW — leftTruncatePath(relPath, maxChars)
├── explorer/node.ts               # sortNodes — reused, unchanged
├── config/app-settings.ts         # FindInFilesGrouping += 'folderTree'; FIND_IN_FILES_GROUPINGS
├── config/settings-metadata.ts    # optionLabels.folderTree = 'Folder structure'
└── config/theme.ts                # new icon tokens `busy` (→ `refresh`), `groupFolderTree` (→ `folderOpen`)

packages/ui/src/renderer/
├── find-in-files/results-list.tsx       # key-based selection; single-click select; headings; row layout; icons; lock lifted
├── find-in-files/find-in-files-panel.tsx# third grouping control; busy cancel; scope root for folderTree; replace lock while running
├── find-in-files/find-in-files-store.ts # cancel keeps rows; `cancelledPartial`
├── find-in-files/content-menu.ts        # −Run/Cancel/Change scope; +Group by folder structure; truncated replace labels
├── find-in-files/find-in-files.css      # indent, weights, muted folder, busy animation, unused rules deleted
├── search/find-bar.css                  # `.throng-search-match` widened to the results list
└── explorer/tree-icons.ts               # fileIconToken — reused, unchanged

docs/preferences.md                      # the new `folderTree` value

packages/core/tests/unit/                # grouping, ordering, truncation, settings
packages/ui/tests/component/             # results list, panel, menu, notices
packages/ui/tests/unit/                  # menu shape (find-in-files-menu.test.ts), CSS guards
packages/ui/tests/e2e/                   # only existing specs whose assertions this feature changes
```

**Structure Decision**: The existing two-package layout. Core gains pure functions only; all
behaviour lives in the renderer's `find-in-files/` folder, where 043 put it.

### Test layers

| Claim | Layer |
|---|---|
| Folder-structure shape, ordering, counts, scope root | unit (`packages/core/tests/unit`) |
| Left-truncated path label | unit |
| New preference value parses, validates, has a label | unit (existing settings tests extended) |
| Heading text, tooltips, muted folder, row order `text (l:c)`, weights, icons, indent | component |
| Single-click select, heading click, double-click / Enter, chevron | component |
| Selection kept across regroup; kept while rows arrive | component |
| Rows live while running; replace items disabled while running | component |
| Cancel keeps rows; partial notice; re-run clears it | component (store + notice bar) |
| Busy state on, off, reduced motion, `aria-busy` | component |
| Menu shape (removed / added items, truncated labels) | unit (`find-in-files-menu.test.ts`) + component |
| Match style shared with the find bar | unit CSS guard (selector present, no `.fif-match` background) |
| "Row scrolled into view" after regroup | component — the list computes its own scroll offset and window transform from the selected index and `rowHeightPx`, so jsdom can assert them without layout |

E2E specs that assert the superseded behaviour (locked rows, cancel clearing, the removed menu items)
are updated in the task that changes the behaviour — `tasks.md` names them.

## Complexity Tracking

> Empty — no Constitution Check violation.
