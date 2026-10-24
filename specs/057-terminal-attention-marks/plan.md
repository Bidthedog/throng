# Implementation Plan: Panel Attention Marks and Terminal Attention Signals

**Branch**: `feature/S057-I4-terminal-attention-marks` | **Date**: 2026-10-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/057-terminal-attention-marks/spec.md`

## Summary

Any panel can carry one attention mark, Attention or Failed. It shows on the panel header, its tab
chip, the tab strip's overflow control, its project row, a minimised category header and the taskbar
badge. It notifies in-app or through Windows, and clears when the user focuses the panel or dwells on
it. The first producer is the terminal: seven signals, recognised in the daemon so they work for
every terminal whether or not a window shows it.

The approach, from [research.md](./research.md):
- A byte scanner in core, run by the daemon (R1–R4), publishes `terminal.attention`.
- A pure mark model in core (R5, R6) is driven by a main-process `AttentionService`, which owns
  marks, notifications and the badge, and broadcasts the set to every window.
- Renderers report focus to main and derive their holders from the broadcast set.
- The daemon keeps a bounded ledger, so marks survive a closed window (R9).

## Technical Context

**Language/Version**: TypeScript (strict), React 19, Node 24

**Primary Dependencies**:
- Electron 44 (`Notification`, `BrowserWindow.setOverlayIcon`, `app.setAppUserModelId`), node-pty.
  No new npm dependency.
- Existing: `notify`/`update`/`dismiss` (`renderer/common/notification.tsx`), `IconButton`, `Icon`,
  `formatSubject`, `focusLocalPanel`, `switchProject`, `collectPanels`, `broadcastToWindows`,
  `scanWindowTitle` as the scanner template.

**Storage**: none persisted. The daemon holds an in-memory attention ledger (R9). Settings are in
`settings.json` through the existing config store.

**Testing**: Vitest projects `unit`, `component`, `integration` and `contract`, plus Playwright E2E
(one spec, `@extended @terminal`, serial tier). Layers are per research R16.

**Target Platform**: Windows 11 (Electron). The OS ports keep core platform-neutral.

**Project Type**: desktop app, npm workspaces monorepo: `packages/core`, `daemon`, `ipc-contract`,
`persistence`, `platform-windows`, `ui` (main / preload / renderer).

**Performance Goals**:
- SC-002: mark and notification within 1 s of a bell, notification, progress end or exit; within
  1 s plus one observation interval of a command finishing.
- SC-004: a 1,000/s bell storm for 10 s changes terminal output timing by no more than measurement
  noise, and raises one mark and one notification.
- Holder updates re-render only the holders whose derived state changed. Selectors compare by value
  (the `useDirtyProjectKey` pattern).

**Constraints**:
- Principle XII: no layout reads added on an input path. The tab-strip overflow mark reuses
  `syncStrip`'s existing measurement and adds none.
- The scanner never alters output (FR-067); no sound (FR-067).
- `notifications.*` settings stay at eight descriptors (R10).
- Every colour and icon comes from a theme token (FR-016).

**Scale/Scope**: up to tens of projects and hundreds of terminals; ledger bounded at 1,000; marks
are at most one per panel.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / gate | Verdict | Note |
|---|---|---|
| I Project-first | ✅ | Marks carry their `projectId` and aggregate per project. Nothing crosses project isolation; navigation switches project explicitly |
| II Platform-abstracted core | ✅ | The scanner and mark model are pure core. OS notifications and the badge are `ISystemNotifier` / `ITaskbarBadge` ports with no-ops, Electron implementations in `ui/main` (R13) |
| III Detached, persistent terminals | ✅ | Recognition is in the daemon. Signals arriving while no window is open are kept in the daemon ledger and restored without notifications (FR-066, FR-038) |
| IV Native terminal support | ✅ | No per-flavour cooperation. Command finished uses 025's process observation (025 FR-022 unchanged). OSC 133 is not adopted |
| V Test-first | ✅ | Every FR gets a failing test first at the lowest layer that proves it (R16). One E2E spec, for the cross-process path only |
| VI UX: simple, discoverable | ✅ | Go to Next Marked Panel has a chord, a Key Bindings entry and a cog-menu row that shows the chord and disables when nothing is marked. Marks have tooltips and accessible names (FR-015) |
| VII Change review | ✅ | Draft PR; manual test plan signed off before the heavy gate |
| VIII SOLID/DRY/YAGNI | ✅ | One scanner and one model. The mark mechanism is producer-agnostic (FR-001, FR-009) without speculative producers. The window-raise sequence is factored into one helper instead of a seventh inline copy |
| IX DI and composition root | ✅ | New ports bound in `ui/main/composition-root.ts`; `AttentionService` constructed there; fakes under E2E |
| X Externalised configuration | ✅ | 14 settings with descriptors, defaults, docs and an inertness test (`settings-inertness-057`). The rate limit (250 ms), activity gap (1 s) and ledger bound (1,000) are internal limits, not user tunables. They are named constants with their reason |
| XI Dockable workspace | ✅ | Marks belong to panels and move with them (edge case "panel moved"). Holders follow the existing chip, overflow, row and category components |
| XII Responsive UI | ✅ | No new layout reads. Holder selectors are value-compared. Focus reports are coalesced per frame. Measurement obligation: SC-004 throughput measurement in the daemon integration suite, and the overflow-mark recompute measured on a 200-tab strip in a component test |
| Gate: lint/typecheck zero errors | ✅ | Short gates before ready |
| Gate: configuration-editor completeness | ✅ | Every setting has a descriptor; the command has a Key Bindings entry; the new colour and icon tokens join the theme editor through `theme-copy.ts` and the area map |
| Gate: themeable icon controls | ✅ | The toast link and the cog row are icon controls with tokens and titles |
| Gate: documentation currency | ✅ | R17: preferences, key bindings, architecture, quick start, README |
| Gate: one condition, one notice (CLAUDE.md) | ✅ | A panel's mark is one state shown on several holders. A repeat raise updates the panel's single toast and single OS notification (FR-035). The badge is a count of that same state, not a second notice |

**Supersessions recorded in the spec**: 025 FR-019f (FR-062; already satisfied by the code, R9),
030's toast-has-no-link convention (FR-034 Extension). One test pin moves deliberately: the cog
menu's five-item shape (`menu-sections.test.ts`, R15).

Post-design re-check: unchanged. The design adds one daemon notification, three daemon requests, six
IPC channels, two OS ports, fourteen settings, one command, two colour tokens and three icon tokens.
Each is covered by a row above.

## Project Structure

### Documentation (this feature)

```text
specs/057-terminal-attention-marks/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── daemon-attention.md
│   └── app-attention.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code

```text
packages/core/src/
├── terminal/attention-scan.ts            # R2 scanner (beside window-title.ts)
├── attention/attention-model.ts          # R5/R6 mark state machine, holders, badge count, next-marked order
├── attention/attention-types.ts          # AttentionSignal, AttentionMark, FocusReport, ledger entry
├── abstractions/system-notifier.ts       # ISystemNotifier + NoSystemNotifier
├── abstractions/taskbar-badge.ts         # ITaskbarBadge + NoTaskbarBadge
├── config/app-settings.ts                # attention.* slice, terminals.attention.*
├── config/settings-metadata.ts           # descriptors
├── config/keybindings.ts / keybindings-metadata.ts   # focus.nextMarkedPanel
├── config/theme.ts, default-themes/index.ts, theme-copy.ts, theme-metadata.ts, shipped-defaults.ts
packages/ipc-contract/src/terminal.ts     # terminal.attention + 3 requests
packages/daemon/src/terminal-service.ts   # scanner hook, heuristics, startup tag, exit/command signals, ledger, config
packages/daemon/src/ipc-server.ts         # RPC registration
packages/ui/src/main/
├── attention-service.ts                  # owns marks, focus reports, toasts routing, OS notifications, badge, goTo
├── electron-system-notifier.ts, electron-taskbar-badge.ts
├── window-raise.ts                       # one restore/show/focus helper
├── daemon-events.ts, main.ts, composition-root.ts, tokens.ts
packages/ui/src/preload/preload.cts       # attention namespace
packages/ui/src/renderer/
├── attention/attention-store.ts          # module store fed by throng:attention:changed
├── attention/use-attention.ts            # value-compared selectors per holder
├── attention/attention-mark.tsx          # the icon + tooltip control
├── attention/attention-toasts.tsx        # one toast per mark
├── attention/focus-reporter.tsx          # FocusReport per frame
├── attention/badge-renderer.ts           # 16×16 canvas → data URL
├── workspace/panel-placeholder.tsx, tab-group.tsx, tab-picker.tsx
├── sidebar/projects-panel.tsx
├── keybindings/window-dispatcher.tsx, title-bar/cog-menu-items.ts
packages/*/tests/...                      # per research R16
docs/preferences.md, docs/key-bindings.md, docs/architecture.md, docs/quick-start.md, README.md
```

**Structure Decision**: The feature follows the established split. Pure logic goes in core; terminal
I/O stays in the daemon; window and OS concerns go in ui/main; presentation goes in the renderer.
That gives four implementation boundaries (core+daemon, main+preload, renderer, docs/config).

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| Main-process mark authority plus renderer focus reports | Marks must agree across windows, drive OS notifications and the badge, and exist for unmounted panels | Per-window renderer stores (the unsaved-dot model) cannot see terminals no window hosts, and cannot drive one taskbar badge |
| Daemon ledger (in memory) | FR-066 and FR-091 need marks across a window close, when main quits | Persisting marks in SQLite outlives the daemon's terminals, which die with it, so it would restore marks for terminals that no longer exist |
| Badge image drawn in a renderer | FR-016 needs theme colours; main has no canvas | Pre-rendered PNG assets cannot follow the theme |
| Went-quiet range 10–600 s, not 2–600 | The slider rules need an even step | A typed-only maximum, which hides 600 from the slider |
| *(round 12)* Manual flags in SQLite (`attention_flag`, migration v11), apart from the ledger | FR-128: a flag on an editor or preview panel survives a reboot, and its panel is in a saved layout that does too | The in-memory ledger dies with the daemon, and its restore reinstates every entry as a terminal mark (R19) |

## Round 12 addendum (2026-10-24)

Iterate round 12 (spec Session 2026-10-24): FR-124 – FR-134. Design in research R18 – R22; contracts
amended in `contracts/app-attention.md` and `contracts/daemon-attention.md`.

- **core** — `AttentionMark.producer` widens to `'terminal' | 'user'`, with `heldSinceRaise: boolean`
  (FR-127). `AttentionModel` gains `flag(panel)` and `restoreFlags(entries)`; `settle()` gives a held
  mark no dwell until its panel stops being attended, then clears the hold. `withdraw('terminal')`
  already spares user marks. `ledgerEntries()` returns terminal marks only. Holder state gains `count`
  (FR-131) in `attention-holders.ts`.
- **persistence + daemon + ipc-contract** — migration v11 `attention_flag(panel_id PK, project_id,
  panel_title, tab_title, project_name, raised_at)`; an `AttentionFlagRepository`; RPCs
  `attention.flagList`, `attention.flagSet`, `attention.flagClear`; project deletion drops a project's
  rows, as `forgetProject` drops ledger entries.
- **main** — `AttentionService.flag(panelId, …)` raises via the model, persists via `flagSet`, never
  announces (FR-126); every clear of a user mark calls `flagClear`; on connect `flagList` restores them
  (FR-128). FR-134: announce only when the raise **created** the mark — the `announced` set goes.
- **renderer** — Flag in `panel-header-menu.ts` (every panel type); the toast card body is the link
  and the go-to control goes (FR-124); numbered flags on project rows, tab chips and minimised
  category headers, the category total pill, the tab panel-count pill, a paler minimised header, all
  in reserved space (FR-129 – FR-133), in `holder-marks.tsx`, `attention-mark.tsx`, `tab-group.tsx`,
  `projects-panel.tsx` and `theme.css`.
- **Boundaries** — core + main; persistence + daemon + ipc-contract; renderer.
