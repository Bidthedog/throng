# Data Model: Terminal Reload, Reconnect and Defaults

## 1. `TerminalSettings` — four new fields

`packages/core/src/config/app-settings.ts`, interface at `:61`, shipped values in `DEFAULTS.terminals`
at `:~409`, parsed in `terminalSettings()` at `:622`, copied in `cloneTerminals()` at `:678`.

| Field | Type | Shipped | FR | Notes |
|---|---|---|---|---|
| `defaultRememberCommand` | `boolean` | **`false`** | FR-001, FR-002 | Restores 025 FR-015. Seeds the New Panel checkbox and resolves an absent per-Panel value (FR-005a). |
| `defaultRememberDirectory` | `boolean` | `true` | FR-001, FR-002 | Matches 025 FR-027b, which is unchanged. |
| `defaultRunAsAdmin` | `boolean` | `false` | FR-001, FR-002 | Seeds only. `canRunAsAdmin()` remains the sole elevation gate (FR-008). |
| `reloadMode` | `'automatic' \| 'manual'` | `'automatic'` | FR-020 | Read when a project is opened. Global; never per project or per Panel. |

Descriptors for all four go in the `group: 'Terminal'` block of
`packages/core/src/config/settings-metadata.ts` (`:558+`), `control: 'toggle'` for the three
booleans and `control: 'select', allowedValues: ['automatic', 'manual']` for `reloadMode` (spec D-4 —
a select names both states, and it is the established pattern in that file).

**Naming.** `default*` prefixes deliberately: these seed a Panel, they do not describe one. The Panel's
own `rememberCommand` / `rememberDirectory` / `runAsAdmin` keep their names, so a reader can tell at
the call site whether they are looking at the preference or the Panel's own value.

## 2. Terminal Panel configuration — unchanged shape, changed resolution

`TerminalPanelConfig` gains **no new field**. What changes is how an **absent** value resolves, in
`readTerminalPanelConfig()` (`packages/core/src/terminal/panel-type.ts:66`).

| Persisted value | Today | After FR-005a |
|---|---|---|
| `rememberCommand: true` | `true` | `true` — unchanged |
| `rememberCommand: false` | `false` | `false` — unchanged |
| *absent* | **`true`** (`raw?.rememberCommand !== false`) | **the preference** (ships `false`) |
| `rememberDirectory` absent | `true` | the preference (ships `true`) — no observable change |
| `runAsAdmin` absent | `false` | the preference (ships `false`) — no observable change |

Only `rememberCommand`'s absent case changes observable behaviour, because only its shipped default
moves. This is the one upgrade-visible change in the feature (SC-009).

**Consequence for the function's signature.** `readTerminalPanelConfig(raw)` currently resolves
absent values against literals, so it needs the preferences. It becomes
`readTerminalPanelConfig(raw, defaults)` — a pure function still, with the resolution rule in one
place rather than duplicated at each call site. Every call site must pass the current settings; a
call site that cannot reach them is a sign the value is being read somewhere it should not be.

## 3. Dormant terminal state

A Panel of terminal type that has not started a shell because the reload mode is Manual (FR-022).

| Property | Value |
|---|---|
| Holds a PTY / shell / conhost | **No** (FR-026) |
| Keeps name, type, layout position | **Yes**, across restart (FR-027) |
| Presents | a placeholder naming the panel, with a **Reload** action (FR-023) |
| Reachable from a menu item | **Yes** (FR-024) |
| Is a failure | **No** — never routed through banners or notices (FR-029) |
| Woken by a path-availability event | **No** (FR-036) |
| Woken by a project switch away and back | **No** (FR-028) |

**Distinct from `failed`**, which holds a failure banner and a ↻ Retry, and **from `starting`**.
Dormancy is persisted with the Panel rather than held in memory, because FR-027 requires it to
survive a restart.

## 4. Path-availability watch

Armed when a terminal's start fails **because its working directory could not be resolved** — and only
then (FR-035).

| Property | Value |
|---|---|
| Target | the unresolvable working directory, or its nearest existing ancestor |
| Armed by | the **start failing** — not by the panel rendering, which is what lets a never-rendered tab recover (FR-032) |
| Fires | at most **one** retry (FR-030) |
| Disposed on | the terminal starting by any route, the Panel being destroyed, or the project closing (FR-042) |
| Scope | the owning project only (FR-037) |
| Raises a notice on success | **No** (FR-033) |

Mirrors `editor-coordinator.ts`'s per-document `fileWatcher.watch(dirname(target), …)` at `:1110`.
It is **not** a shared signal and this feature does not add one — see spec Finding 2 and #306.
