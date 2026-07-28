# Research: Terminal Startup Commands & Command Memory (025)

All unknowns the spec deferred to planning, resolved against **this** codebase and, where the spec
demanded proof (FR-013), against the real shells on a Windows machine.

---

## R1. Per-flavour command recipes — PROVEN, not assumed

FR-013 requires each built-in's invocation be *determined and proven*, verifying that it (a) runs the
command, (b) leaves an interactive shell behind, and (c) survives spaces and quotes.

**Method.** A probe spawned each shell with an explicit **argv array** (what `node-pty` does) and closed
stdin, so a shell that genuinely stays interactive reaches EOF and exits. An earlier attempt invoking the
shells *from Git Bash* was discarded: MSYS argument conversion silently ate the switches (`cmd /C` printed
a banner, which it never does), which would have produced a confidently wrong answer.

| Flavour | Recipe | Result |
|---|---|---|
| `cmd` | `/K` + `<command>` | Command ran; prompt returned; exited on EOF ✔ |
| `windows-powershell` | `-NoExit -Command <command>` | Ran; quoting intact; prompt returned ✔ |
| `pwsh` | `-NoExit -Command <command>` | Ran; quoting intact; prompt returned ✔ |
| `git-bash` | `-c` + `<command>; exec bash -i` | Ran; handed over to an interactive bash that read stdin ✔ |

**Decision.** Recipe = an argv template per flavour with a `{command}` placeholder.

- `cmd` → `['/K', '{command}']`
- `windows-powershell`, `pwsh` → `['-NoExit', '-Command', '{command}']`
- `git-bash` → `['-c', '{command}; exec bash -i']`

**The `exec bash -i` is load-bearing.** The probe confirms `bash -i -l -c '<command>'` **exits
immediately** once the command finishes — which would violate FR-005 (the shell must remain at an
interactive prompt). The re-exec replaces the command shell with a fresh interactive one.

**Rationale for a template rather than per-flavour code**: FR-011 requires a *user-defined* flavour to
declare its own recipe through configuration, which a code-level switch cannot satisfy. One template
string, one placeholder, same mechanism for built-ins and user flavours.

**Alternative considered — always use the PTY-write fallback** (type the command at the first prompt).
Rejected as the primary path: it races the shell's startup, echoes the command into scrollback, and cannot
distinguish "the prompt is ready" from "a slow profile is still loading". Retained as the **fallback** for
flavours with no recipe (FR-012), where its weaknesses are preferable to not working at all.

### R1a. cmd.exe quoting is a genuine hazard

The probe showed `cmd` echoing `\"quoted a b\"` **literally**: Node's argv→command-line builder escapes
`"` as `\"`, and `cmd.exe` does not honour that convention — unlike every other shell tested.

**Decision.** The recipe substitutes the command into a **single argv element**, and quoting is the
shell's own business from there (FR-047: throng does not rewrite commands). A test pins a command
containing both spaces and quotes for every built-in, so a future change to the spawn layer cannot break
this silently.

---

## R2. Where the recipe is applied — `resolveLaunchSpec`

**Found**: the launch chain is renderer → `packages/ui/src/main/terminal-ipc.ts:119` →
`resolveLaunchSpec(flavour, params, cwd)` → daemon `terminal.attach` with a concrete `{file, args, cwd}`.
The daemon spawns exactly what it is handed and knows nothing about flavours.

**Decision.** Extend `resolveLaunchSpec` (pure, in `@throng/core`) to take the startup command and the
flavour's recipe, and to emit the composed argv. This keeps every decision in the pure domain, testable
without a PTY, and leaves the daemon untouched — matching how the feature's predecessors were built.

`LaunchSpec` gains an optional `writeOnReady` field carrying the command for the **fallback** path; when
a recipe exists it is absent, because the command is already in `args`.

---

## R3. Capturing the running command — extend the existing seam

**Found**: `IPtyHost.listChildPids(handle)` already reports descendant pids
(`packages/platform-windows/src/node-pty-host.ts:212`), and `isBusy()` in `core/src/terminal/lifecycle.ts`
already classifies busy/idle from that pid set. The Windows implementation already runs a
`Get-CimInstance Win32_Process` query — which **also exposes `CommandLine` and `CreationDate`**, the two
fields capture needs, at no additional query cost.

**Decision.** Add `IPtyHost.listChildProcesses(handle): ChildProcess[]` returning
`{ pid, ppid, commandLine, startedAt }`, and keep `listChildPids` as a thin derivation so no existing
caller changes. The pure selection rule (FR-022: most recently started **direct child** of the shell)
lives in `core/src/terminal/command-capture.ts` and takes plain data, so it is unit-testable with no OS.

**Alternative considered — shell integration (OSC 133 prompt marks).** Rejected: FR-022 explicitly forbids
depending on per-flavour cooperation, precisely so a user-defined flavour behaves identically. It would
also require injecting into each shell's profile.

**Pre-existing defect, filed not fixed**: that query is `execFileSync` — synchronous, whole-process-table,
on the daemon's event loop, called per terminal. Tracked as **#190**. This feature's *new* path must not
inherit it (FR-019b), so the new method is **async** and batched across all terminals; the existing
synchronous `listChildPids` call on the close path is left alone, which is exactly the boundary #190 owns.

---

## R4. The shared observation — join the existing cwd poller

**Found**: `terminal-service.ts` already runs a poll loop (`CWD_POLL_MS = 1000`) that reads every live
terminal's cwd in **one batched call** (`IProcessCwd.read(pids)`) and publishes per-panel `terminal.cwd`
notifications. It is `unref()`ed, and it **skips entirely when `events.sinkCount === 0`**.

That is precisely the shape FR-019a/b demand, and precisely the suspend-when-unobserved behaviour
FR-019f now specifies for commands.

**Decision.** Extend that same loop to also read child processes and publish a `terminal.command`
notification when a panel's foreground command changes. One timer, one snapshot, both signals. Cost does
not scale with terminal count (FR-019a); it never runs on a path a user waits on (FR-019b); it is already
suspended when unobserved (FR-019f) — the existing `sinkCount` guard *is* the requirement.

The interval becomes an externalised setting (FR-019c) rather than the current module constant.

**FR-019g (final read on an observable teardown)** is satisfied by taking one last observation in the
detach/close path before the session is dropped.

---

## R5. Where the memory lives — and the trap that nearly broke it

**Found, and this is the decisive constraint**: `clearPanelType()`
(`packages/core/src/panel-type/assignment.ts:88`) **deletes `kind` and `config` outright** when a
terminal's content ends. Principle III requires the panel to survive its terminal, and today it survives
*empty*. So storing the startup command in `Panel.config` alone would have it **erased at the exact moment
the terminal ends** — the moment memory must write to it, and before the pre-filled form (FR-007a) could
ever read it.

**Decision.** Add an optional `Panel.terminalMemory` that `clearPanelType` deliberately **preserves**:

```
terminalMemory?: {
  flavourId?, shellArguments?, startupCommand?, rememberCommand?, lastCwd?
}
```

- Written on Confirm, and by the capture path while the terminal runs.
- Read by the empty-panel form to pre-fill (FR-007a) and by the launch path for the start directory.
- Lives **on the Panel**, so destroying the Panel destroys it — FR-007d for free, with no cleanup code and
  no way for a new panel in the same position to inherit it.

`updatePanelConfig()` already exists for merging partial config into a live panel (added in 006 for the
editor); the memory writer follows that precedent rather than inventing a second mechanism.

**Alternative considered — persist to settings keyed by panel id.** Rejected: it outlives the panel,
violating FR-007d, and would need explicit garbage collection.

---

## R6. The rename, and its migration

FR-002c requires the rename reach persisted keys. Two stores are affected, and they are **not** the same
kind of data:

| Where | Old | New | Migration |
|---|---|---|---|
| `TerminalPanelConfig.params` (layout blob) | `params` | `shellArguments` | Read-side fallback |
| `TerminalSettings.defaultParams` (settings JSON) | `defaultParams` | `defaultShellArguments` | Read-side fallback |
| `TerminalFlavourConfig.defaultParams` | `defaultParams` | `defaultShellArguments` | Read-side fallback |

**Decision — migrate on read, not by rewriting files.** Every parser accepts the old key when the new one
is absent and yields the new shape. This satisfies FR-002d (transparent, no user action, no data loss),
FR-002e (nothing to half-write, because nothing is rewritten eagerly — a failed config write cannot lose
the original) and is **idempotent by construction** (FR-002e), because reading already-migrated data never
sees the old key.

**Rationale.** throng's config layer already has a documented hazard here — a failed config write is
invisible (**#102**), and #75 was a real data-loss incident in this exact area. An eager rewrite-on-startup
migration would put every user's terminal settings through that path for no benefit. Read-side migration
touches nothing until the user next saves, and then writes only the new shape.

FR-002f (tests start from real pre-feature persisted data) is met by fixtures containing the **old** keys
verbatim.

---

## R7. Test layers available in this repo

Checked before writing tasks, so no task calls for a stack that does not exist:

| Layer | Runner | Where |
|---|---|---|
| unit | `vitest --project unit` | `packages/*/tests/unit` — 1482 passing |
| integration | `vitest --project integration` | 360 passing |
| contract | `vitest --project contract` | 60 passing |
| E2E | `playwright test` | `packages/ui/tests/e2e` |

There is **no component-test stack** (no Testing Library). Renderer behaviour is proven by E2E, and pure
logic is pushed into `@throng/core` where it is unit-testable — which is the existing convention and the
reason the domain is arranged the way it is. Tasks are shaped to these four layers only.

`packages/core/src/testing/pty-host-contract.ts` holds a shared contract suite every `IPtyHost`
implementation must satisfy — the natural home for proving `listChildProcesses` (FR-042's sibling).

---

## R8. Proving a user-defined flavour launches (#113 / FR-042)

**Found**: `terminal-flavours.e2e.ts:10` says in its own header *"No terminal launches yet (that is Phase
C)"* — Phase C never added one.

**Decision.** The E2E defines a user flavour in `settings.json` pointing at a **real** executable already
guaranteed present (`cmd.exe`) under a distinct id, then launches it and asserts output. This needs no new
fixture binary and no machine-specific assumption. A second case launches it **with a startup command**
(FR-043), which is the path this feature adds.
