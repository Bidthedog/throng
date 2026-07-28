# Contracts: Terminal Startup Commands & Command Memory (025)

Every seam this feature adds or changes. A change here is a change to something another layer depends on,
so each entry names its consumers.

---

## C1. `IPtyHost.listChildProcesses` (new method, OS seam)

`packages/core/src/abstractions/pty-host.ts`

```ts
/**
 * The live descendant processes of a terminal's shell, with their command lines.
 * Async and batched-friendly: MUST NOT block the caller (FR-019b).
 * A process whose command line cannot be read is returned with commandLine: ''.
 * Never throws; an unavailable snapshot resolves to [].
 */
listChildProcesses(handle: PtyHandle): Promise<ChildProcess[]>;
```

**Contract obligations** (proven by the shared suite in `core/src/testing/pty-host-contract.ts`, which
every implementation runs):

1. An idle shell reports no direct children.
2. A shell running a command reports at least one direct child whose `ppid` is the shell's pid.
3. That child's `commandLine` is non-empty and contains the command's executable name.
4. `startedAt` is a finite epoch-ms value, and a later-started child has a larger one.
5. Resolves — never rejects — when the handle is dead or the snapshot fails.

**Implementations**: `WindowsPtyHost` (`platform-windows`), `PtyAgentHost` (daemon, forwards over the
agent protocol), plus the in-memory fake used by tests.

**`listChildPids` is unchanged** and stays synchronous — the close decision keeps using it. Untangling
that is #190's job, not this feature's.

---

## C2. `terminal.command` notification (new IPC)

`packages/ipc-contract/src/terminal.ts`

```ts
export const TERMINAL_COMMAND_NOTIFICATION = 'terminal.command';

export interface TerminalCommandNotification {
  panelId: string;
  /** The foreground command line, or null when nothing is running. */
  command: string | null;
}
```

Mirrors `terminal.cwd` exactly — same producer (the daemon poll), same forwarding path
(`daemon-events.ts` → `throng:terminal:command`), same renderer store shape.

**Publishing rules**

- Emitted only when a panel's value **changes** (including → `null`), like `terminal.cwd`.
- Suspended when `sinkCount === 0`; the last value is retained, not cleared (FR-019f).
- One final publish before a session is dropped on an observable teardown (FR-019g).

---

## C3. Preload bridge (new)

`window.throng.terminal.onCommand(cb: (e: { panelId: string; command: string | null }) => void): () => void`

Consumed by `renderer/terminal/command-store.ts`, built as the twin of the existing `cwd-store.ts`.

---

## C4. `resolveLaunchSpec` (changed signature)

`packages/core/src/terminal/launch-spec.ts`

```ts
export function resolveLaunchSpec(
  flavour: LaunchFlavour,           // now also carries `commandRecipe?: readonly string[]`
  shellArguments: string,           // was `params`
  projectRoot: string | null,
  startupCommand?: string,
): LaunchSpec;
```

**Behaviour**

| startupCommand | recipe | Result |
|---|---|---|
| empty / absent | any | today's behaviour exactly — no extra args, no `writeOnReady` (FR-006) |
| present | present | recipe expanded into `args`; **no** `writeOnReady` |
| present | absent | `args` unchanged; `writeOnReady` = the command (FR-012) |

Args order is `flavour.args` → tokenised `shellArguments` → expanded recipe, so a recipe's terminator
(`/K`, `-Command`) is last and consumes the command as intended.

Still throws when `projectRoot` is null.

---

## C5. `expandCommandRecipe` (new pure function)

`packages/core/src/terminal/command-recipe.ts`

```ts
export function expandCommandRecipe(recipe: readonly string[], command: string): string[];
export function resolveCommandRecipe(
  id: string, source: 'builtin' | 'user',
  userEntry: TerminalFlavourConfig | undefined,
  settings: TerminalSettings,
): readonly string[] | undefined;
```

`{command}` is replaced **inside** whichever element contains it, leaving the element count unchanged, so
the command stays a single argv element regardless of its spaces or quotes (research R1a). A recipe with
no `{command}` placeholder is invalid and treated as absent.

---

## C6. `captureDecision` (new pure function)

`packages/core/src/terminal/command-capture.ts`

```ts
export function foregroundCommand(shellPid: number, children: readonly ChildProcess[]): string | null;
export function captureDecision(
  rememberCommand: boolean,
  saved: string | undefined,
  observed: string | null,
): { save: false } | { save: true; value: string };
export function isCapturableCommand(commandLine: string): boolean;
```

The whole memory rule, as pure data-in/data-out — this is what the six worked examples in the spec test
against, with no PTY and no UI.

- `foregroundCommand` — most recently started **direct** child (`ppid === shellPid`); `null` when none
  (FR-022, FR-022a).
- `isCapturableCommand` — single line, ≤ 2048 chars, no control characters (FR-023).
- `captureDecision` — `{save:false}` when memory is off, when `observed` is null, or when the command is
  not capturable; otherwise `{save:true}` (FR-016–FR-018).

---

## C7. Settings (changed)

`packages/core/src/config/app-settings.ts` + `settings-metadata.ts`

| Key | Type | Default | Control |
|---|---|---|---|
| `terminals.defaultShellArguments` | `Record<string,string>` | `{}` | (json) |
| `terminals.commandRecipes` | `Record<string,string[]>` | `{}` | (json) |
| `terminals.commandPollMs` | `number` | `1000` | number |

Parsers accept `defaultParams` when `defaultShellArguments` is absent (FR-002d). `settings-metadata`
gains entries for all three — including `flavours`, whose missing metadata assertion is part of why #67
shipped (noted in #113's body).

---

## C8. Workspace model (changed)

`packages/core/src/workspace/model.ts` — `Panel.terminalMemory?: TerminalMemory` (data-model §3).

`packages/core/src/panel-type/assignment.ts`:

```ts
setTerminalMemory(layout, panelId, memory: Partial<TerminalMemory>): WorkspaceLayout
```

and **`clearPanelType` preserves `terminalMemory`** while still deleting `kind` and `config`. That single
behavioural change is what makes FR-007a possible; it gets its own test asserting the memory survives.
