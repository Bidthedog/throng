# Implementation Plan: Terminal Reload, Reconnect and Defaults

**Branch**: `feature/S039-I293-terminal-reload-and-defaults` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/039-terminal-reload-and-defaults/spec.md`

## Summary

Four new settings in the `Terminal` preferences group, one new panel state (dormant), and one new
watch. The three user stories are genuinely independent and land in priority order: US1 (#223) is
settings plumbing plus a descriptor change; US2 (#293) adds a panel state and a placeholder; US3
(#237) adds a watch armed by a failed start.

The work is concentrated in two files that every story touches —
`packages/core/src/config/app-settings.ts` and `packages/core/src/config/settings-metadata.ts` — so
the settings for all four are added **once, in Phase 2**, rather than three times.

## Technical Context

**Language**: TypeScript 5.x, strict. **Runtime**: Electron (main + renderer), detached Node daemon.
**Test layers, cheapest first**: unit (vitest, resolves `@throng/core` to source), component (jsdom),
integration, contract, E2E (Playwright on Electron).
**Constraints**: the E2E suite is ~18 min and is shared with two concurrent sessions; every rung
below it must be exhausted first. `packages/core/dist` is what the Electron app loads while vitest
loads source — a stale `dist` makes E2E disagree with unit tests about a constant.

### The five touchpoints a new terminal setting needs

Established by tracing `terminals.showStatusBar` end to end. Missing any one of them yields a setting
that reads as its fallback, or one the settings editor cannot show.

| # | File | Site | What goes there |
|---|---|---|---|
| 1 | `packages/core/src/config/app-settings.ts` | `TerminalSettings`, `:61` | the field and its doc comment |
| 2 | `packages/core/src/config/app-settings.ts` | `DEFAULTS.terminals`, `:~409` | the shipped value |
| 3 | `packages/core/src/config/app-settings.ts` | `terminalSettings(v, fallback)`, `:622` | the parse, falling back per field |
| 4 | `packages/core/src/config/app-settings.ts` | `cloneTerminals(t)`, `:678` | the defensive copy |
| 5 | `packages/core/src/config/settings-metadata.ts` | the `group: 'Terminal'` block, `:558+` | the descriptor: label, description, control |

`settings-validity.ts` and the FR-047 completeness test enforce (5); a field absent from (4) is
silently dropped on a settings write, which is spec 032's territory and its test will catch it.

## Constitution Check

| Principle | Bearing | Verdict |
|---|---|---|
| I — project-first | FR-037: a path event in one project must not touch another's terminals | Satisfied by keying the watch to the owning project |
| III — working-directory tag mandatory | US3 restores a terminal to its configured directory | Unchanged; 025 FR-030's fallback still applies |
| X — externalised configuration | four new settings, each with a shipped default and a descriptor | FR-050; no JSON-only setting |
| XI — only view state may differ per Panel | dormancy is per Panel and is **not** view state — it is whether a shell exists | Persisted with the Panel (FR-027), consistent with the Panel owning its terminal |
| Every panel action has a menu item | FR-024 | Reload is registered as a command, not only a button |
| One condition, one notice | FR-029: dormancy is a state, not a failure | Dormant panels do not touch the notice surfaces |

**No violation requiring justification.** The one judgement call is FR-030's per-failure watch rather
than a shared signal; it is recorded as decision D-1 in the spec with the reasoning, and the shared
watch is filed as #306.

## Project Structure

### Documentation (this feature)

```
specs/039-terminal-reload-and-defaults/
├── spec.md          # complete
├── plan.md          # this file
├── data-model.md    # the settings and the dormant-panel state
└── tasks.md         # generated next
```

### Source Code

```
packages/core/src/
├── config/
│   ├── app-settings.ts          # (1)(2)(3)(4) — four new fields
│   └── settings-metadata.ts     # (5) — four descriptors, group 'Terminal'
└── terminal/
    └── panel-type.ts            # defaults() reads the preferences; readTerminalPanelConfig resolves absent → preference

packages/ui/src/
├── main/
│   └── (US3) the watch armed on a failed terminal start
└── renderer/
    ├── panel-type/terminal-inputs.tsx   # US1: the three checkboxes seed from preferences
    ├── terminal/terminal-panel.tsx      # US2: dormant state; US3: recovery re-entry via `attempt`
    ├── terminal/use-terminal.ts         # US3: the start that fails and arms the watch
    └── workspace/panel-placeholder.tsx  # US2: the dormant placeholder and its Reload affordance
```

## Implementation order and why

1. **Phase 2 (foundational)** — all four settings, all five touchpoints, in one pass. Blocking for
   every story; doing it per story would touch `app-settings.ts` three times and conflict with
   itself.
2. **US1 (#223)** — descriptor reads the preferences; `readTerminalPanelConfig` resolves an absent
   value to the preference (FR-005a). Smallest, and it is the one that changes existing behaviour, so
   it wants the most test attention.
3. **US2 (#293)** — the dormant state, its placeholder, its Reload command and menu item.
4. **US3 (#237)** — the watch. Last because FR-036 requires it to know about dormancy.

## Coordination

Spec 038 (#290 / #279 / #280) is the earlier branch and owns the terminal reload/project-switch path
this feature restructures. **Rebase onto 038 before opening the PR**, and message that session before
changing the reload path structurally. Expect conflicts in `settings-metadata.ts` (both add to the
`Terminal` group) and in the terminal panel lifecycle.

## Complexity Tracking

| Item | Why it is not simpler |
|---|---|
| Four settings landing at once in Phase 2 | They share four functions in one file; splitting them per story guarantees three-way conflicts in `app-settings.ts` |
| FR-005a's read-side resolution | The alternative — a migration that writes the resolved value back — would violate FR-006 and 025 FR-002e's "never rewrite eagerly" |
| A watch per failed terminal rather than one per project | Decision D-1; the shared watch is #306, deferred because it requires editing #161's code while spec 037 is live in it |
