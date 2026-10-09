# Research: The Terminal Service Never Stops Answering

**Feature**: 051 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Every path below is repo-relative. Line numbers are as of `3f78c901` and are for orientation only.

## Starting point: where the service stops today

The daemon serves every terminal and every RPC on one event loop. These calls stop it while serving:

| Call | Where | Used for | When |
|---|---|---|---|
| `execFileSync('taskkill' /T /F)`, 5 s | `platform-windows/src/node-pty-host.ts` `taskkill()` | ending a shell tree, then its conhost | every `kill`, every self-exit (conhost reap), `dispose` |
| `execFileSync powershell Get-CimInstance` | `node-pty-host.ts` `conhostChildren()` | conhost attribution | **every `start()`** (~0.5–0.7 s), `dispose` sweep |
| `execFileSync powershell` process table | `node-pty-host.ts` `descendantPids()` → `listChildPids()` | busy check | only as `TerminalService.isBusy` fallback — unreachable in production, but on the interface |
| `Atomics.wait` busy-sleep, `renameSync` loop up to 3 s | `platform-windows/src/windows-directory-lock.ts` | releasing the root lock | first attach, every last end |
| synchronous koffi `OpenProcess` / `NtQueryInformationProcess` / `ReadProcessMemory` | `platform-windows/src/windows-process-cwd.ts` | cwd of a shell | every 1 s per terminal, and `terminal.list {refreshCwd}` |
| the same `taskkill`s inside the de-elevated agent | `daemon/src/pty-agent-entry.ts` | agent-hosted terminals | the agent stops instead of the daemon |

Startup-only (FR-017 candidates): `daemon/src/reap-orphans.ts` (`snapshotProcesses`, per-orphan `taskkill`, before `server.start()`), `platform-windows/src/windows-elevation.ts` `probeElevated()` (cached, first call during daemon composition). `windows-shell-detection.ts` `reg query` runs only in UI main, which is not the terminal service (spec Assumptions).

**#468's mechanism.** Unload calls `terminal.killAll` (10 s RPC timeout), and the daemon runs two synchronous `taskkill`s per terminal in series. The switch that follows calls `projects.setActive` through `invokeDaemon`, which uses the 2 s ping timeout (`ui/src/main/ui-settings.ts`, `DEFAULT_PING_TIMEOUT_MS`). Four terminals × two kills easily exceeds 2 s, the RPC times out, and `switchProject` reverts.

**Already non-blocking (the pattern to reuse).** 025's command observation and 046's busy probe use `promisify(execFile)` with a shared in-flight snapshot (`processSnapshot()` / `pidTableSnapshot()`, 250 ms reuse window), and the agent answers `childprocs` / `childpids` asynchronously with a `reqId`.

---

## R1 — Asking without waiting: async child processes, not threads

- **Decision**: every process request made while serving becomes an awaited `execFile` (or koffi's `.async` form for FFI, R6), never a `*Sync` call or a busy-wait. The service stays single-threaded.
- **Rationale**: the stall is waiting on other programs, not computation (spec Assumptions, Session 2026-10-05). `execFile` already runs the wait off the event loop; 025 and 046 proved it here.
- **Alternatives**: worker threads (rejected by clarification — shared terminal state across threads buys nothing); a native helper executable (a new artefact to build and sign, for no gain over `execFile`).

## R2 — Ending a terminal: `IPtyHost.kill` becomes `end(): Promise<EndOutcome>`

- **Decision**: replace `kill(handle): void` with `end(handle, timeoutMs): Promise<void>` that resolves once the shell tree and its conhost have been told to end **and** the shell's exit has been observed, and rejects on a `taskkill` failure or when `timeoutMs` passes first. `taskkill` runs through async `execFile` with `timeout: timeoutMs`. Exit code 128 ("process not found") counts as success — the process is already gone (edge case: ending a terminal that is already exiting).
- **The service's view**: `TerminalService` marks the session **ending** (`data-model.md`), starts `end()`, and returns from the RPC at once (FR-003). The outcome is applied when the promise settles (R4).
- **Rationale**: one primitive serves kill, closeIdle, killAll, killForProject, terminate and shutdown, and gives each a definite outcome to act on (FR-005, FR-015a). Waiting for the observed exit, not just the `taskkill` return, is what makes "ended" true rather than requested.
- **Alternatives**: keep `kill(): void` and fire-and-forget the `taskkill` — no outcome, so FR-005 and FR-015a cannot be met.

## R3 — The time limit: one constant, injected

- **Decision**: `TERMINAL_END_TIMEOUT_MS = 5000` is declared once in `packages/core/src/config/` and reaches the daemon as a field of the terminal service's injected settings (`endTimeoutMs`), which every `end()` call and the shutdown wait read (FR-013a). It is not a user preference and has no environment variable.
- **Rationale**: the clarification asked for a single place to change it. Principle IX/X want configuration injected rather than read deep in logic; a constant feeding the injected settings satisfies both without inventing an inert user setting. Listed in Complexity Tracking.
- **Other limits** (FR-013): the process-table snapshot keeps its 5 s `execFile` timeout; the agent's request timers keep 5 s. Both now come from the same constant so one edit moves every limit together.

## R4 — Outcomes of an end, outside shutdown (FR-002–FR-005)

- **Success**: the observed exit is published as user-initiated (005 FR-017), exactly as today.
- **Failure or timeout**: the session stops being **ending**; `userKilled` is reset so a later genuine exit is reported as unexpected again; it stays in the session map and reattaches on the next load (FR-005).
- **Superseded while ending** (US1 scenario 3): an attach for a panel whose session is **ending** does not reattach it (FR-004). The ending session is moved out of the panel map into the service's `ending` set, and a fresh session starts under the panel id. The old session's exit is not published (its panel already has a new terminal), and its lock release still happens. **If that superseded end then fails**, no panel can ever reattach it, so it is escalated exactly as at shutdown (R8). Leaving it running would orphan a process no surface can reach (Principle III). *Derived from FR-004 + Principle III; no new FR.*
- **killAll reports outcomes**: `terminal.killAll` acknowledges nothing early — its result is the outcome, so Unload's single notice can say which terminals are still running (FR-002, FR-005). It now resolves `{ killed, failed: [{ panelId, reason }] }` after every end in it has settled (bounded by one time limit, the ends run concurrently). The daemon keeps serving while it waits, which is the whole of FR-001. FR-003's "acknowledged without waiting" governs `terminal.kill`, which still returns `{ ok: true }` immediately.
- **Renderer**: `unload-project.ts` already collects problems into one notice. A non-empty `failed` adds *"N of its terminals could not be ended; they are still running and reattach when you open X again"*. The `killAll` IPC timeout (`UNLOAD_RPC_TIMEOUT_MS = 10_000`) stays, and is asserted to exceed the end limit plus margin.

## R5 — Conhost attribution without a synchronous scan (FR-010, FR-014)

- **Decision**: `start()` no longer scans. It records the session as `conhostPid: pending` and queues an attribution pass on the async process table (`readProcessTable`, the 025 snapshot source). Passes run one at a time, and **a pass always takes a fresh snapshot started after the spawn it serves**: a snapshot reused from before the spawn cannot contain the new conhost. The pure assignment rule (newest N unclaimed conhost/OpenConsole children of the daemon, in spawn order) is unchanged and moves to a testable function.
- **End before attribution** (FR-014): `end()` awaits the session's attribution promise, bounded by the time limit, before ending the conhost. Today's "lingers until the dispose sweep" window disappears.
- **Self-exit**: `onExit` reaps the conhost the same way, after the attribution resolves.
- **Alternatives**: attribute lazily at end time — the edge case "an end within moments of a start" is then fine but a self-exit leaks until shutdown; rejected.

## R6 — The cwd read: koffi `.async`

- **Decision**: `windows-process-cwd.ts` calls its four Win32 functions through koffi's `fn.async(..., cb)`, which runs each call on koffi's worker pool, and awaits them. The per-pid sequence (open → query → read → close) is unchanged.
- **Rationale**: FR-010 names every process request, and this runs every second per terminal. Each call is cheap, but a slow `OpenProcess` on a contended machine stops every terminal.
- **Alternatives**: move cwd to the shared PowerShell snapshot — Win32_Process carries no cwd.

## R7 — The root lock without a busy-wait

- **Decision**: `windows-directory-lock.ts` drops `sleepSync`/`Atomics.wait`; `acquire` and `release` become async and retry with `setTimeout` on the same schedule (30 ms settle, 15 ms × up to 3 s). `TerminalLockManager.acquire/release` become async; `handleExit` publishes the exit after the release settles, preserving today's order (lock released, then UI told).
- **Rationale**: the release runs on every last end, so a contended rename stops the service for up to 3 s.

## R8 — Shutdown (FR-015, FR-015a)

- **Decision**: `TerminalService.shutdown()` becomes async. It ends every running and ending session concurrently with `end(endTimeoutMs)`. A session whose end fails or times out is **escalated**: `IPtyHost.forceEnd(handle, timeoutMs)` reads one fresh process table, collects the shell's whole descendant tree (by ppid chain) plus its conhost, and `taskkill /F`s each pid individually, concurrently, waiting at most one further limit. Whatever is still alive in a final snapshot is written to the daemon log by pid and image name (`console.warn`, which the daemon routes to its rotating log). FR-005's reattach never applies here.
- **Callers**: daemon `main.ts` awaits `terminals.shutdown()` before `server.stop()`/`exit`. The agent's own shutdown (`pty-agent-entry.ts`) does the same for its terminals. `NodePtyHost.dispose()` becomes async and keeps its final conhost sweep, now async.
- **App-close "Terminate all"** is treated as shutdown for FR-015a: SC-004 requires nothing left behind, which FR-005's reattach would contradict. `terminal.killAll` gains `{ escalate: true }`, which UI main passes for Terminate all, and main's call uses the killAll timeout (R4), not the 2 s ping default, because the outcome now takes up to two limits.
- **Rationale**: escalation by individual pid survives a broken tree (`taskkill /T` follows ppid, which breaks when an intermediate exits).

## R9 — Busy decisions ask once (FR-011, FR-012)

- **Decision**: remove the synchronous `listChildPids` from `IPtyHost` (and `descendantPids` with it), make `probeChildPids` required, and delete `TerminalService.isBusy`'s fallback. Every busy decision goes through `probeBusy`, awaited together, so the local host serves N terminals from one shared snapshot (already true) and the agent from one shared `pidTableSnapshot` (already true agent-side). A test pins "one OS call for N terminals" for both hosts (SC-005).
- **Fail-safe** unchanged: a rejected probe counts as busy (046, FR-012).

## R10 — The build-failing ban (FR-020, SC-006)

- **Decision**: an `eslint.config.js` block for `packages/daemon/src/**` and `packages/platform-windows/src/**`:
  - `no-restricted-imports` naming `execSync`, `execFileSync`, `spawnSync` from `child_process` / `node:child_process`;
  - `no-restricted-syntax` banning `Atomics.wait` and `*.execFileSync`/`*.execSync`/`*.spawnSync` member calls (catches `cp.execFileSync`).
  - FR-017 exceptions (`reap-orphans.ts`, `windows-elevation.ts`) are marked at the call: `// eslint-disable-next-line … -- FR-017: startup only, before the service serves (<reason>)`. `windows-shell-detection.ts` is UI-main-only and is excluded by `ignores` with a comment saying so.
- **Proof the ban is live**: a unit test lints a fixture string through the ESLint API (`lintText` with a `filePath` under each banned package) and asserts the error — so deleting the block fails the build, not just a later review (SC-006).
- **Limit**: lint cannot see a synchronous koffi call. The only process-related FFI in scope is `windows-process-cwd.ts` (R6); a source-scan unit test asserts its calls go through `.async`.
- **Alternatives**: a source-scan test only — weaker (string matching), and lint already runs in the gate.

## R11 — The responsiveness guards (FR-021, FR-022)

- **FR-021**: a daemon **integration** test with the real `NodePtyHost`: start five shells running a long command, call `killAll`, start three more, run `list {includeBusy}`, and throughout send an unrelated RPC every 20 ms, recording each round trip. Fails if any exceeds 100 ms, or 500 ms when `CI` is set. Integration is the lowest layer with a real process to wait on.
- **FR-022 (#468)**: a daemon **integration** test, written first and observed failing on today's code: a real terminal service and project service behind one router, four running terminals in project A, `killAll {projectId: A}` not awaited, then `projects.setActive(B)` immediately — fails if it errors or takes over 1 s. Both are integration (`osSerial`), not E2E: the defect is the daemon's event loop, which a lower layer than the app can observe.
- **E2E**: none added. `terminal-no-orphans.e2e.ts` already covers process hygiene for panel destroy, project delete, Unload + End Terminals and Terminate all (SC-004), and must stay green.

## R12 — User Story 4: attached processes (#193, conditional)

- **Measurement first (FR-045, 2 h)**: can the OS name every process attached to a terminal's pseudoconsole? Candidates, in order:
  1. a short-lived helper (hidden `powershell` with an inline `kernel32` P/Invoke, or a `node` script with koffi) that `FreeConsole`s, then for each shell pid `AttachConsole(pid)` → `GetConsoleProcessList` → `FreeConsole`, printing JSON — one helper run per observation covering every terminal (FR-041);
  2. node-pty's own console-list agent, if it can be run hidden.
  The measurement passes if `docker run` in Git Bash is listed in 10/10 samples while running and absent after Ctrl+C, and no console window flashes.
- **If it passes**: `IPtyHost.listAttachedProcesses(handles)` on the abstraction; the pure core rule (`foregroundCommand`) takes the attached set with the shell's direct children as the fallback (FR-040), excludes the shell, conhost and throng's helpers (FR-043), and keeps 025's tie-break. Runs on the existing observation timer, async, one helper per pass.
- **If it fails**: the phase is withdrawn and the measurement is posted on #193 (FR-045).

### R12 addendum — the measurement (2026-10-06, ~15 min of the 2 h)

- **Method**: candidate 1, as a `node` helper with koffi run hidden (`windowsHide`) per observation:
  `FreeConsole` → for each shell pid `AttachConsole(pid)` → `GetConsoleProcessList` → `FreeConsole`, printing
  JSON. Subject: Git Bash (`E:/tools/Git/bin/bash.exe --login -i`) in a node-pty ConPTY running
  `docker run --rm --init alpine sleep 600`; Docker Desktop 29.8.0.
- **Samples**: `docker.exe` listed in **10/10** samples while running, **absent** 4 s after Ctrl+C. The shell
  pid's only direct child was the re-exec'd `bash.exe`, so the direct-children rule cannot see `docker.exe`;
  the attached set can. Each helper run took 75–110 ms of wall clock, none of it on the caller's event loop.
- **What the list holds besides the command**: the shell, its re-exec, Git Bash's `sh.exe` helpers and the
  helper itself (already exited by the time the table is read). FR-043's exclusions must cover the helper.
- **A trap found on the way**: without `--init`, `alpine sleep` is PID 1 in its container and ignores SIGINT,
  so `docker run` really did keep running after Ctrl+C. The attached list was right to keep listing it.
- **Window flash**: not observable by automation. The helper is spawned hidden and attaches to an existing
  pseudoconsole, which creates no window; confirmed by eye in the manual test plan.
- **Verdict**: **pass**. T029–T033 proceed.

## R13 — 025 FR-019g is not implemented in the daemon

- **Finding**: no daemon end path takes a final observation before a terminal ends. Promotion happens in the renderer from the last published value. FR-016's "MUST still be preceded" therefore preserves nothing. This feature keeps the end paths' observable order exactly as today and does not add the observation — doing so would put an observation on the end path, which 025 FR-024 forbids delaying. **Deferred** as a finding outside this spec.

## R14 — What does not change

- `projects.setActive`, `switchProject` and the 2 s ping timeout are untouched: with the daemon answering, the switch needs nothing (Assumptions, "No wait indicator").
- Panel destroy's busy check stays renderer-only (no OS call). The app-close prompt's count stays `list` without `includeBusy`.
- No persistence, schema or migration change.
