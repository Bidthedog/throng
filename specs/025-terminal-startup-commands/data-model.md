# Data Model: Terminal Startup Commands & Command Memory (025)

Entities the feature adds or changes. Types are TypeScript-shaped because that is the repo's language;
the *decisions* are in [research.md](./research.md).

---

## 1. `TerminalPanelConfig` (changed) — `core/src/terminal/panel-type.ts`

Persisted in the layout blob under `Panel.config`. **Erased when the terminal ends** (see §3).

| Field | Type | Change | Notes |
|---|---|---|---|
| `flavourId` | `string` | — | |
| `flavourLabel` | `string?` | — | for the header |
| ~~`params`~~ → `shellArguments` | `string` | **renamed** (FR-002c) | arguments handed to the shell |
| `startupCommand` | `string?` | **new** | a command the shell runs (FR-001) |
| `rememberCommand` | `boolean?` | **new** | opt-in memory, default `false` (FR-015) |
| `runAsAdmin` | `boolean?` | — | |

**Read-side migration** (FR-002d): a persisted `params` with no `shellArguments` yields
`shellArguments`. Never written back eagerly.

---

## 2. `TerminalValues` (changed) — the form's string-keyed values

| Key | Change |
|---|---|
| `flavourId` | — |
| ~~`params`~~ → `shellArguments` | renamed |
| `startupCommand` | **new**, free text |
| `rememberCommand` | **new**, `'true'`/`'false'` (the form is string-keyed) |
| `runAsAdmin` | — |

The descriptor's `control` union gains `'checkbox'` alongside `'dropdown' | 'text'` — `runAsAdmin` is
already rendered as a checkbox by hand-written JSX, so this makes the existing reality declarable.

---

## 3. `Panel.terminalMemory` (new) — `core/src/workspace/model.ts`

**The load-bearing addition.** Survives `clearPanelType`, which deletes `kind` and `config` (research R5).

```ts
export interface TerminalMemory {
  flavourId?: string;
  shellArguments?: string;
  startupCommand?: string;
  rememberCommand?: boolean;
  /** Last working directory this panel's terminal was pointed at (FR-027). */
  lastCwd?: string;
}
```

| Rule | Requirement |
|---|---|
| Written on Confirm, and by capture while the terminal runs | FR-016, FR-027 |
| Read by the empty-panel form to pre-fill | FR-007a |
| Read by the launch path for the start directory | FR-028 |
| **Preserved** by `clearPanelType` | FR-007a |
| **Destroyed** with the Panel — it is a Panel field | FR-007d |
| Never copied to another Panel | FR-007d, FR-048 |

---

## 4. `FlavourCommandRecipe` (new) — `core/src/terminal/command-recipe.ts`

How a flavour is handed a command such that it runs *and* stays interactive (FR-010).

```ts
/** argv template; exactly one element must contain the {command} placeholder. */
export type FlavourCommandRecipe = readonly string[];
```

Built-in catalogue (proven in research R1):

| Flavour | Recipe |
|---|---|
| `cmd` | `['/K', '{command}']` |
| `windows-powershell` | `['-NoExit', '-Command', '{command}']` |
| `pwsh` | `['-NoExit', '-Command', '{command}']` |
| `git-bash` | `['-c', '{command}; exec bash -i']` |
| *(anything else)* | none → PTY-write fallback (FR-012) |

Resolution precedence mirrors `resolveDefaultParams`: `settings.terminals.commandRecipes[id]` →
the user flavour's own `commandRecipe` → built-in catalogue → none.

---

## 5. `LaunchSpec` (changed) — `core/src/terminal/launch-spec.ts`

```ts
export interface LaunchSpec {
  file: string;
  args: string[];
  cwd: string;
  /** Fallback only: write this to the PTY once the shell is ready (FR-012). */
  writeOnReady?: string;
}
```

Exactly one of "command already in `args`" (recipe present) or `writeOnReady` (no recipe) is used —
never both, or the command runs twice.

---

## 6. `ChildProcess` (new) — `core/src/abstractions/pty-host.ts`

```ts
export interface ChildProcess {
  pid: number;
  ppid: number;
  /** Full command line as the OS reports it; may be empty when unreadable. */
  commandLine: string;
  /** Epoch ms the process started; used to pick the most recent (FR-022). */
  startedAt: number;
}
```

`IPtyHost` gains `listChildProcesses(handle): Promise<ChildProcess[]>` — **async** so the new path cannot
inherit #190's synchronous stall (FR-019b). `listChildPids` stays, unchanged, for the close decision.

---

## 7. `TerminalSettings` (changed) — `core/src/config/app-settings.ts`

| Field | Change |
|---|---|
| ~~`defaultParams`~~ → `defaultShellArguments` | renamed (FR-002c), `Record<string,string>` |
| `commandRecipes` | **new**, `Record<string, string[]>` — per-flavour recipe override (FR-011) |
| `commandPollMs` | **new**, `number`, default `1000` — externalised interval (FR-019c) |
| `flavours[].defaultParams` → `.defaultShellArguments` | renamed |
| `flavours[].commandRecipe` | **new**, `string[]?` (FR-011) |

Each renamed key accepts the old spelling on read (FR-002d).

---

## 8. `ObservedCommand` (new, transient) — never persisted

```ts
export interface ObservedCommand {
  commandLine: string;
  pid: number;
  startedAt: number;
}
```

The daemon's per-panel last-observed value. Published as `terminal.command`; the renderer decides whether
to promote it into `terminalMemory` (FR-016/FR-017/FR-018).

---

## 9. State transitions — the memory rule

The entire feature turns on this. `saved` is `terminalMemory.startupCommand`.

| Memory | At terminal end | Result |
|---|---|---|
| off | anything | `saved` unchanged (FR-018) |
| on | a command is running | `saved` ← that command (FR-016) |
| on | nothing running | `saved` **unchanged** — never cleared (FR-017) |
| on | running command is invalid (multi-line, too long, control chars) | `saved` unchanged (FR-023) |
| on | observation unavailable | `saved` unchanged (FR-024) |

"Running" means: a **direct child** of the shell existed at the last observation (FR-022a — a grandchild
whose parent has exited does not count).
