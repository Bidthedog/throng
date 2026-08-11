---
name: throng-terminal-pty
description: Use for terminals end to end — node-pty/ConPTY, the detached PTY agent, shell detection, elevation and de-elevation, conhost and orphan-process hygiene, the koffi Win32 FFI in platform-windows, and the xterm.js renderer surface including keyboard routing and the reserved-key tiers. Triggers include a terminal that will not spawn, "AttachConsole failed", a leaked conhost.exe or orphaned shell, run-as-admin behaviour, reattaching a terminal after restart, alt-screen or resize problems, xterm rendering and input fidelity, and any new keybinding that a shell might otherwise have seen.
---

# throng — terminals, PTY hosting and the Windows platform layer

Terminals are the reason throng exists, and they are the part most able to leave debris on the user's
machine. Assume every change here can orphan a process until you have proven otherwise.

## Where the code is

- `packages/platform-windows/src` — `node-pty-host.ts`, `windows-shell-detection.ts`,
  `windows-elevation.ts`, `windows-de-elevated-launcher.ts`, `windows-process-cwd.ts`,
  `windows-directory-lock.ts`, `windows-font-enumeration.ts`, `windows-platform-info.ts`,
  `holder-lookup.ts`, `node-file-log.ts`. koffi FFI and every Win32 call live here, behind the
  `core/src/abstractions` interfaces — nowhere else.
- `packages/daemon/src` — `terminal-service.ts`, `terminal-events.ts`, `terminal-lock-manager.ts`,
  `pty-agent-host.ts` / `pty-agent-entry.ts` / `pty-agent-protocol.ts` / `pty-agent-liveness.ts` /
  `pty-agent-log.ts`, `reap-orphans.ts`.
- `packages/ui/src/renderer/terminal/` — xterm.js 6 with the fit, search and web-links addons.
- `packages/core/src/terminal/` — flavour-agnostic terminal domain state.

## The hygiene rules (Principle III, NON-NEGOTIABLE)

- **No orphaned OS processes.** Every end path — user close, kill, panel destroy, project delete,
  app-close "terminate all", the shell exiting itself, daemon shutdown — must release every resource
  the terminal created, *including the per-terminal `conhost.exe`*. A host reaps its terminals before
  exiting; a detached helper self-terminates when the process it serves is gone.
- This must be proven by a **process-level E2E**, never by "the UI updated". Use
  `conhostChildren(pid)` and `expectNoOrphanConhosts(...)` from `packages/ui/tests/e2e/harness.ts`;
  see `terminal-no-orphans.e2e.ts`.
- **No orphaned windows or views** on a commanded destroy. A destroy the user ordered must complete —
  no lingering surface, no silent reappearance.
- Closing a terminal *deliberately* leaves its hosting Panel in place, empty and ready to reuse. A
  terminal's lifecycle never governs its Panel's lifecycle.
- An **unexpected** exit must surface the failure output and exit code, not vanish.

## Elevation

Terminal elevation follows the application: there is no elevation broker, so a run-as-admin terminal
requires throng itself to be elevated, and the de-elevation path exists to hand a *non*-elevated
child back to the user's own token. Relevant switches: `THRONG_IL`, `THRONG_FAKE_ELEVATED`,
`THRONG_DEELEVATE_FORCE`, `THRONG_E2E_IGNORE_ELEVATION_GUARD`, plus `scripts/run-deelevated.ps1`.

Privilege-dependent behaviour is tagged `@admin`, skipped when the process is not elevated, and only
verified under an elevated run. **A developer machine is normally not elevated; GitHub's runners
always are** — so this is one of the few areas where CI genuinely knows something local runs cannot.
Use `[ci-admin-only]` in the commit message to run just that lane.

## Windows traps this repo has already been bitten by

- `node-pty`'s console helpers fail with **AttachConsole** errors under concurrent load, which is why
  the integration and contract layers run single-fork. Do not parallelise them.
- Killing a probe shell by **pid**, not through node-pty, is what fixed the win32-input probe (#240).
- A blur broadcast reaching a destroyed window can kill the main process during shutdown — guard
  every broadcast against a disposed target (`blur-broadcast-destroyed.test.ts`).
- `THRONG_FORCE_PTY_AGENT` forces the detached-agent path that would otherwise only appear elevated.

## The keyboard belongs to the terminal (Principle IV)

Two tiers, and both are enforced at the Constitution Check gate:

- **Reserved — never bindable** in a scope live in a terminal: `Ctrl+C/D/Z/A/E/W/U/K/R/L/Q`.
- **Shadowable — only as a recorded exception** enumerated in the constitution. Three remain:
  `Ctrl+F` (`search.find`), `Ctrl+H` (`search.replace`), `Ctrl+S` (`editor.save`).

Also binding: one command, one chord across panel types; and parity across shell flavours — a new
binding may not widen the Git Bash / PowerShell gap. A chord throng consumes never reaches the shell,
so a prefix key silently removes that key from every shell behind every terminal. Check
`packages/core/src/config/keybindings.ts` and its `COMMAND_SCOPES` before proposing any chord, and if
a chord must be taken from the shadowable tier, the constitution needs amending in the same change.

## Not yours

Keybinding *registry and preferences plumbing* → `throng-config-preferences`. Daemon RPC shapes →
`throng-daemon-persistence`. Pane/tab/panel layout → `throng-renderer-ui`.
