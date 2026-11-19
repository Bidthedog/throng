# Implementation Plan: Terminal Status-Bar Toggles

**Branch**: `feature/S076-I669-terminal-status-bar-toggles` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/076-terminal-status-bar-toggles/spec.md`

## Summary

Each terminal panel gains three toggles at the right of its status bar, plus a checkable content-menu item and an
unbound command for each:
- Remember the last running command
- Reopen in the last directory
- Terminal notifications

One table in core declares the three toggles (research R1). Each stores an explicit boolean in the panel's config, and
an absent value resolves to a global preference (039 FR-005a). The new preference
`terminals.defaultNotifications` (shipped on) applies to every panel holding no value, old panels included
(Clarifications Q4).

A flip writes through a new `commitPanelConfig`, which saves the layout at once and reports failure (R4). The daemon
drops the signals of a panel whose notifications resolve off at the one point every signal is published, so a signal
raised with no window open obeys it too (R3). Main withdraws the panel's terminal-producer mark when its notifications
turn off, by the toggle or by the preference (R5).

## Technical Context

**Language/Version**: TypeScript 6 (ESM), Node 26 (daemon), Electron renderer (React 19.3)

**Primary Dependencies**: existing only. xterm.js, React, the throng core/daemon/ipc-contract packages. Lucide art
is vendored by hand into `packages/core/src/icons/default-set/`

**Storage**: the saved workspace layout (`Panel.config`) through the daemon's workspace store; `settings.json` for the
preference

**Testing**: vitest projects `unit`, `component`, `integration`; no E2E (tasks.md, T031 note)

**Target Platform**: Windows, Linux, macOS. Nothing per-OS

**Project Type**: Electron desktop app, npm-workspaces monorepo

**Performance Goals**: a flip is reflected in the same frame and saved within one IPC round trip. The silencing gate adds
no layout read per raised signal beyond the one `resolveNames` already makes per published signal

**Constraints**: Principle IV (no reserved terminal key); Principle XII (no blocking work on the renderer thread — the
save is async)

**Scale/Scope**: 3 toggles, 1 setting, 3 commands, 3 icon keys, 1 new daemon method, 1 new IPC channel

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / gate | Assessment |
|---|---|
| I Project-first isolation | ✅ Per-panel values live in the panel's own layout, and nothing crosses projects |
| II Platform-abstracted core | ✅ No OS code. The toggle table and resolution are in core |
| III Detached, tagged terminals | ✅ A flip never restarts the terminal (FR-011). Notifications off never hides an unexpected exit (FR-024) |
| IV Native terminal & reserved keys | ✅ No default chord. Commands are window-handled, so a user's chord never reaches the shell, and the editor keeps refusing reserved keys |
| V Test-first | ✅ Each task lands its failing test first, at the lowest layer (research R10). No E2E: nothing left needs a real window (tasks.md, T031 note) |
| VI Simple, discoverable UX; every panel action reachable | ✅ Every toggle has a checkable menu item, present with the status bar hidden (FR-005). No new indicator (FR-026) |
| VIII SOLID / DRY / YAGNI | ✅ One toggle table, one resolver, one commit path. No index or cache in the daemon (R3 alternative b) |
| IX DI & composition root | ✅ `storedNotifications` is injected into `TerminalAttention` from the daemon composition root |
| X Externalised configuration; editor completeness | ✅ New setting with descriptor, default and visual control. New key bindings with descriptors |
| XI Dockable workspace | ✅ Works the same in a sub-workspace window: same store, same client save |
| XII Responsive UI | ✅ Async save. The toggle shows the new value at once and reverts only on a failed write |
| XIII Every failure leaves a trace | ✅ A failed write raises a notice naming the setting (FR-004). Daemon lookup failures are `logCaught` and fall back to the preference |
| Themeable icon controls | ✅ `IconButton` with three new icon keys in the default set. No hardcoded colour |
| Documentation currency | ✅ `docs/preferences.md`, `docs/key-bindings.md` and the terminal docs in the same branch (FR-050) |
| Incremental delivery | ✅ US1, US2 and US3 each land as working increments |

No violations. Post-design re-check: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/076-terminal-status-bar-toggles/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── attention-ignore.md
│   └── status-bar-and-menu.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/core/src/
├── terminal/panel-toggles.ts            # NEW — the toggle table, resolution, titles
├── terminal/panel-type.ts               # notifications: read, seed, form input, build
├── panel-type/descriptor.ts             # TerminalPanelDefaults.notifications
├── config/app-settings.ts               # terminals.defaultNotifications
├── config/settings-metadata.ts          # its descriptor
├── config/keybindings.ts                # three action ids, scopes, empty defaults, WINDOW_HANDLED_ACTIONS
├── config/keybindings-metadata.ts       # their descriptors
├── attention/attention-types.ts         # AttentionProducerConfig.notifyByDefault
├── attention/attention-model.ts         # withdrawPanel
└── icons/                               # three keys, art, SOURCES.json, README, generated module

packages/ipc-contract/src/terminal.ts    # TERMINAL_ATTENTION_IGNORED_METHOD + types

packages/daemon/src/
├── terminal-attention.ts                # publish gate, ledger filter, ignoredOf(), merge of notifyByDefault
├── terminal-service.ts                  # registers terminal.attentionIgnored
└── composition-root.ts                  # storedNotifications from the saved layouts

packages/ui/src/
├── main/attention-service.ts            # panelIgnored(), default-off withdrawal, pushes notifyByDefault
├── main/main.ts                         # throng:attention:panelIgnored
├── preload/preload.cts                  # attention.panelIgnored
└── renderer/
    ├── state/workspace-store.tsx        # commitPanelConfig
    ├── terminal/terminal-status-bar.tsx # the toggle group
    ├── terminal/terminal.css            # layout and truncation
    ├── terminal/terminal-content-menu.ts# the three checkable items
    ├── terminal/terminal-toggle-registry.ts # NEW — per-panel flip registry for the commands
    ├── terminal/terminal-panel.tsx      # wiring: resolve, flip, commit, notify, register
    ├── panel-type/panel-type-form.tsx   # seed notifications
    └── keybindings/window-dispatcher.tsx# runAction for the three commands

packages/*/tests/…                       # see tasks.md
docs/preferences.md, docs/key-bindings.md, docs/quick-start.md (terminal section)
```

**Structure Decision**: The existing monorepo layout. No new package or folder; two new modules
(`panel-toggles.ts`, `terminal-toggle-registry.ts`).

## Complexity Tracking

None.
