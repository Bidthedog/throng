# Implementation Plan: One default icon set, drawn from Lucide

**Branch**: `feature/S069-I127-lucide-icon-set` | **Date**: 2026-11-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/069-lucide-icon-set/spec.md`

## Summary

Replace the two seeded icon packs, and the per-theme glyph maps and overrides behind them, with one
default set of Lucide line icons compiled into core (151 keys: today's 110, less one retired, plus forty-two new). A user customises by
creating a set in Preferences, pressing Override this icon on the icons they want, replacing those
`<key>.svg` files outside throng, and pressing Reload the icon sets from disk. A one-time upgrade converts nothing: it
backs old folders up as `.bak`, deletes unedited seeded folders and the old README, and raises a notice
at every start until the backups are gone. The maintainer signs off a
review page of the token-to-art mapping before merge ([research](research.md) R4).

## Technical Context

**Language/Version**: TypeScript 6 (strict), Node 22.12+ (engines), Electron 45 runtime, React 19 renderer

**Primary Dependencies**: Electron 45, React 19, Vite (renderer only), `tsc -b` (core, main, preload).
Lucide 1.66.0 art is vendored as files; it is not a package dependency (R1, R2).

**Storage**: per-user config root (`~/.throng` on Windows, `$XDG_CONFIG_HOME/throng` on Linux, `~/Library/Application Support/throng` on macOS):
theme JSON, `icon-packs/<set>/<key>.svg`, `icon-packs/README.txt`, `icon-sets-upgrade.json`,
`defaults-state.json` (version 34)

**Testing**: vitest projects `unit`, `component` (jsdom), `integration` (real temp dirs) and
`contract`; Playwright E2E with the `@core` / `@extended` lanes, run on CI

**Target Platform**: Windows 11, Linux and macOS (Apple silicon, proved by CI), delivered together (Principle II, constitution 6.6.0)

**Project Type**: desktop application (npm-workspaces monorepo: core, ui, platform-*, daemon,
persistence, ipc-contract)

**Performance Goals**: an icon renders synchronously from memory, with no disk read at render (017
FR-006a/b). A set loads once per start, selection or reload. The upgrade's seeded-folder check hashes
about 112 small files, once.

**Constraints**: no renderer chunk over 500 kB (`vite.config.ts`). No loose default-set files in the
install (FR-021). Nothing watches set folders (FR-029). The upgrade converts and destroys nothing that
might be the user's (FR-018, FR-019, FR-036).

**Scale/Scope**: about 110 icon keys and about 150 render sites across 70 renderer files; a user set
holds anything from 0 to 110 files.

## Constitution Check

*Gate: before Phase 0 research, and again after Phase 1 design.* Constitution v6.5.0.

| Principle | How this holds |
|---|---|
| I Project-first | Icon sets are per-user configuration, not project state. No project data is read or written. |
| II Platform abstraction | Opening a folder goes through `IShellIntegration.openFolder`, which is de-elevation aware where elevation exists. Set-name validation applies Windows' folder rules, the strictest of the three, so a name valid there is valid on Linux and macOS; a clash is judged case-insensitively on every volume. `README.txt` takes the OS line ending. Nothing is OS-specific in core. |
| III Terminals | Untouched. |
| IV Keyboard tiers | No new chord. Every new control is a focusable `IconButton`. |
| V Testing | Failing test first at the lowest layer (R13). E2E is limited to the one window-level journey, US4, and replaces `icon-packs.e2e.ts`. Every test asserting the retired glyphs, packs and overrides is updated in the task that retires the behaviour. |
| VI UX | The Icons grid says what each icon is, which file overrides it and whether it is overridden. Reload the icon sets from disk carries the one-line hint. Text names the OS generically ("the file manager"). |
| VII Change review | Override this icon asks before replacing an existing file. The upgrade backs up rather than deletes anything that may be the user's. |
| VIII SOLID, DRY, YAGNI | One key registry, one resolver (`resolveIcon`), one set service. No icon editor, no folder watching, no pack management beyond Copy. |
| IX DI | `IconSetService` and `IconSetUpgrade` are built in main's composition root with injected `fs`, shell integration and logger. |
| X Configuration | The theme keeps one icon field, `iconPack`, edited by the picker. The two retired fields are removed from the type, the descriptors, the copy and the files, so none is left inert. |
| XI Workspace | Untouched. |
| XII Responsive | Set I/O and the upgrade run in main, asynchronously. The renderer resolves from memory. |
| XIII Failure trace | Every set load failure (`logExpected`), every I/O failure and every failed upgrade step (`logCaught`) is logged. A failed upgrade item is retried, never silently skipped. |
| Themeable icon controls | Copy, Override this icon, Reload the icon sets from disk and Open folder are `IconButton`s resolved through keys, with hover titles. The name and replace prompts keep text buttons, under the dialog exception. The glyph buttons in `projects-panel`, `subworkspaces-panel` and `panel-placeholder`, and the menu check marks, move onto keys (R3). |
| Configuration-editor completeness | No setting is added. The removed `icons.*` theme descriptors leave the Themes editor along with the fields. |
| Documentation currency | `docs/preferences.md` (icon sets), `README.txt`, `CHANGELOG.md` (FR-039) and the About licence entry are updated in this branch. |
| Incremental delivery | Phases below. The art sign-off (Phase 2) gates the merge. |

**Result: pass.** No violation, so Complexity Tracking is empty.

## Delivery

| Phase | Delivers | Gate |
|---|---|---|
| 1 Setup | The key registry with descriptions (R3), the dead key retired, `SOURCES.json` drafted, the review-page and vendoring scripts | none |
| 2 Art sign-off (FR-031) | The review page, published for the maintainer | **The maintainer signs off before merge** (moved from before Phase 3, 2026-11-15). |
| 3 Foundation | Vendored art, the generated module, `resolveIcon`, glyphs and overrides removed from `Theme`, every render site on `resolveIcon` | Phase 1 |
| 4 US1 | Every icon from the default set; untokened sites brought in; every key has a render site | Phase 3 |
| 5 US2 | The Icons grid shows key, file and description | Phase 3 |
| 6 US4 | User sets: service, IPC, Copy, Override, Open folder, Reload, hint, unrecognised files | Phase 3; lands in the same PR as US3 |
| 7 US3 | v34 theme step, folder step with backups, seeded history, the notice | Phase 3 |
| 8 US5 | `README.txt` and its key-list test, the About licence entry, `docs/preferences.md`, `CHANGELOG.md` | Phases 6 and 7 |
| 9 Polish | E2E, the budget re-seed, sweeping updates to the old tests | all |

## Project Structure

### Documentation (this feature)

```text
specs/069-lucide-icon-set/
├── spec.md
├── plan.md               # this file
├── research.md           # R1–R13
├── data-model.md
├── quickstart.md
├── contracts/
│   └── icon-sets-ipc.md
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/icons/                 # new
├── icon-keys.ts                         # ICON_KEYS, IconKey, ICON_KEY_DESCRIPTIONS (moved from theme-copy)
├── resolve-icon.ts                      # resolveIcon(theme, sets, key)
├── icon-set-name.ts                     # validateIconSetName
├── icon-set-upgrade.ts                  # planThemeIconSetUpgrade, classifySeededFolder, backupName
├── icon-sets-readme.ts                  # parse the README key list (FR-035)
├── icon-sets-README.txt                 # hand-written README (plain text)
├── default-set/<key>.svg, LICENSE, SOURCES.json
├── default-icon-set.generated.ts        # DEFAULT_ICON_SET, ICON_SETS_README
└── seeded-icon-history.generated.ts     # SEEDED_ICON_HISTORY (frozen)
packages/core/src/config/                # theme.ts, theme-ops.ts, theme-metadata.ts, theme-copy.ts,
                                         # shipped-defaults.ts (v34), default-themes/index.ts: glyphs out
packages/core/src/config/icon-pack.ts    # removed
packages/core/src/notice/notification-entries.ts   # + openIconSetsFolder action
packages/ui/src/main/
├── icon-set-service.ts                  # replaces icon-pack-service.ts
├── icon-set-upgrade.ts                  # folder step + icon-sets-upgrade.json
├── icon-sets-ipc.ts                     # create / override / reload / openFolder / backups
├── config-watcher.ts                    # serves cached sets; no set re-read
├── shipped-defaults-service.ts, main.ts, notifications-ipc.ts
packages/ui/src/preload/preload.cts, packages/ui/src/renderer/global.d.ts
packages/ui/src/renderer/
├── common/icon.tsx, icon-button.tsx     # resolveIcon
├── common/icon-set-backup-notice.tsx    # new
├── config/config-store.tsx              # useIconSets
├── preferences/icon-section.tsx, themes-tab.tsx, name-dialog.tsx
├── editor/markdown-fold.ts, preview/providers/markdown/fold-gutter.ts
├── panes/projects-panel.tsx, subworkspaces-panel.tsx, workspace/panel-placeholder.tsx, menus (R3)
├── notifications/use-notification-actions.ts, notifications-menu.ts
└── about/about-app.tsx                  # licenceText
scripts/
├── vendor-lucide-icons.mjs, generate-default-icon-set.mjs, icon-review-page.mjs
├── generate-seeded-icon-history.mjs
└── generate-licenses.mjs                # + VENDORED
docs/preferences.md, CHANGELOG.md
```

**Structure Decision**: The icon domain moves out of `config/` into `packages/core/src/icons/`. Keys,
art, resolution, name rules, upgrade planning and the README are one cohesive area that `config/`
consumes rather than owns. Main keeps the I/O, and the renderer keeps the UI.

## Test impact (existing tests to update)

Updated in the task that retires the behaviour each asserts (from the research inventory):

- **core unit**: icon-pack, svg-sanitise, theme, default-themes, theme-plain-glyphs, theme-icons-047,
  icon-tokens-067/068, theme-icon-upgrade-060/067, theme-054/060/060-exclusions, theme-attention-tokens,
  theme-link-tokens, theme-copy, theme-metadata, theme-migration, theme-sweep, metadata, overridden,
  notice/entry-look, preview-panel-type, search-config, shipped-defaults-upgrade(-v7),
  shipped-defaults-v6-record, single-source-of-defaults, no-os-imports
- **core contract**: shipped-defaults-fidelity
- **ui unit**: icon-pack-service, icon-pack-seeding, icon-tokens-exist, icon-call-sites,
  menu-icon-tokens, no-inline-artwork, preferences-icons, icon-control-box, busy-glyph-css,
  css-variables-defined, preview-surfaces-name-no-provider, config-write-helper-single
- **ui component**: icon, icon-button, busy-glyph, preferences-themes-tab, themes-tab-folding,
  themes-tab-subgroups, preferences-app, preferences-on-entry-snapshot, preferences-fold-heading,
  config-store-adoption, theme-provider, fold-gutter, status-strip-preview-button,
  panel-header-save-icons, notification-entry-look, file-explorer-pane, explorer-toolbar, find-bar-toolbar,
  find-in-files-*, back-forward-buttons, preview-status-bar, tab-popover, projects-panel-form,
  title-bar, resources/*
- **ui integration**: config-watcher-partial-read, reset-ipc, shipped-defaults-seed-upgrade,
  shipped-defaults-restore, restore-theme, restore-default-themes
- **ui e2e**: icon-packs (replaced by icon-sets), icon-colour, helpers/config-snapshot,
  preferences-themes, preferences-reset, theme-fonts; `e2e-budget.json` and `parallel-plan.json`

## Complexity Tracking

None.
