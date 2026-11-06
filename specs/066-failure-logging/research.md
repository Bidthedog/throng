# Research: Every failure leaves a trace in the diagnostic log

Baseline measured 2026-11-06 on `661a08e2` (`packages/*/src` only).

## Where things stand

| Area | Today |
|---|---|
| Levels | `error \| warn \| info \| debug` (`core/src/diagnostics/log-level.ts`); no fatal |
| Rotation | size-based, keep N files per process (`rotation.ts`, applied only in `platform-node/src/node-file-log.ts`); settings `diagnostics.maxFileSizeKb`, `diagnostics.keepFiles` |
| UI main | `main.log` in `<userData>/logs`; console captured by `attachConsole`; crash hooks in `diagnostics.ts` |
| Daemon | `daemon.log` via `THRONG_LOG_DIR`; no log at all when it is unset; its spawn has no `error`/`exit` listener in UI main |
| PTY agent | `throng-agent-<pid>.log`, unlevelled, unrotated, never pruned; `THRONG_LOG_DIR \|\| tmpdir()` — the de-elevated launch passes no environment, so it lands in the desktop user's `%TEMP%` |
| PTY agent host | launch reasons, connect lapse, agent crash and agent `error` events reach the panel only; nothing in `daemon.log` |
| Resource collector | stderr tail logged at warn on `close` (#542); no process hooks of its own |
| Renderer | no `window.onerror`/`unhandledrejection`, no React root error callbacks, one error boundary (file tree, console only); renderer `console.*` reaches no file |
| Swallowed errors | 85 empty or comment-only `catch {}`, ~90 silent `.catch(() => …)`, ~190 catches that return a fallback without logging |
| Child processes | 21 start sites; 9 record nothing on failure |
| Guards | source-scanning unit tests exist (`no-os-imports`, `no-inline-artwork`, `notice-models`), registered in `guards-are-live.test.ts` |

## Decisions

### R1 — `console` is the logging seam in every process
- **Decision**: every process routes its `console.*` into its log file: UI main and the daemon already do
  (`attachConsole`); the PTY agent and the collector adopt `createFileLog` + `attachConsole`; the renderer's
  console reaches `main.log` through `webContents`' `console-message` event. A catch then logs with one call
  that works in every package, including `core`, `persistence` and the platform packages, which own no logger.
- **Rationale**: those packages cannot take a logger dependency without threading one through dozens of
  constructors (Principle IX would require it for a new service, not for diagnostics already captured
  process-wide). `console` is not an OS call, so `core` stays OS-agnostic (Principle II).
- **Alternatives**: an injected `IDiagnosticLog` everywhere — rejected, ~365 sites across seven packages
  for no behaviour a console sink lacks; a renderer IPC logger only — rejected, misses third-party errors
  that already go to the console.

### R2 — Two helpers make a caught error's intent explicit
- **Decision**: `core/src/diagnostics/caught.ts` exports `logCaught(where, error)` (warn) and
  `logExpected(where, reason, error)` (debug, reason required, non-empty), plus `logFatal(component, error)`.
  Each renders one line: `<where>: <reason?> — <error message>`; the stack only at debug.
- **Rationale**: the guard (R6) can recognise a logging catch by name, and a reviewer reads the intent at
  the site. FR-009's "stated reason" is the `reason` argument, so it cannot be omitted.

### R3 — A fatal level above error
- **Decision**: `LogLevel` gains `fatal`, ordered above `error`; `passesThreshold` always passes fatal (FR-009a).
  Console has no `fatal`, so fatal records go through `logFatal`, which calls the process's `logAlways` where
  one exists and `console.error('[FATAL] …')` elsewhere; `attachConsole` maps the `[FATAL]` prefix to fatal.
- **What is fatal**: a process crash (`uncaughtException`, an unasked-for non-zero exit, a signal), a window
  crash (`render-process-gone`, `unresponsive` past its timeout, a failed first load), a panel crash (a render
  error caught by the per-panel boundary, R5).

### R4 — Every child process is watched by its parent
- **Decision**: one shared wrapper, `watchChild(child, { name, log, expectedExit? })` in `platform-node`,
  attaches `error`, `exit` and a bounded stderr tail (last 4 KB) and logs a failure — fatal for long-lived
  processes, warn for helper commands, debug when the caller marks the outcome expected. `execFile` sites use
  `logChildFailure(name, error, stderr)` in their callback. A start site that cannot be watched carries
  `// child-exempt: <reason>` (FR-013).
- **The agent**: `PtyAgentHost` takes an injected `log`; launch reasons, connect lapses, agent crashes and
  agent `error` events are logged, not only shown in the panel.
- **The de-elevated agent's folder (FR-017)**: the log directory is passed as an argument
  (`pty-agent-entry.js <pipe> <logDir>`), not through the environment the token launch drops.

### R5 — The renderer reports its own failures
- **Decision**: `createRoot(…, { onUncaughtError, onCaughtError, onRecoverableError })`, `window` `error`
  and `unhandledrejection` listeners, and a `PanelErrorBoundary` around every panel body, which renders the
  existing failure banner and logs fatal with the panel's subject. All of them reach `main.log` through the
  preload's `diagnostics.log(level, message)` channel (fatal included, unthrottled by the level threshold).
- **A panel torn down by a failure** (FR-009a) is one whose body React unmounts because a render, an
  effect or a lifecycle method threw — exactly what the per-panel boundary catches. A throw from an event
  handler does not tear a panel down (React keeps it mounted); it reaches the window `error` listener and is
  logged at error.
- **Alternatives**: `console-message` only — kept as the backstop for console output, but it cannot carry
  the fatal level or a panel's identity.

### R6 — Guards are source-scanning unit tests
- **Decision**: `packages/ui/tests/unit/failure-logging-guard.test.ts` walks `packages/*/src`, parses each
  file with the TypeScript compiler API (already a dependency), and fails, naming file:line, on:
  - a `catch` clause or `.catch(cb)` whose body calls none of `logCaught`, `logExpected`, `logFatal`,
    `console.*`, an injected `log*`, and does not `throw` or `reject`;
  - a `spawn`/`fork`/`execFile` call not passed to `watchChild` / `logChildFailure` and not preceded by
    `// child-exempt: <reason>`.
  Registered in `guards-are-live.test.ts`. Strings that contain the word `catch` (PowerShell, worker
  sources) are not parsed as code, so they cannot trip it.
- **Alternatives**: an ESLint rule — rejected for now: the repo has no custom rule plugin, and a unit test
  matches the existing guard pattern.

### R7 — Repeats are collapsed in the logger
- **Decision**: `createFileLog` collapses a line identical to the previous one (same level, component and
  message) within 60 s into a counter, written as `… (repeated N times in Ns)` when a different line arrives,
  the window ends, or the process exits (FR-015).

### R8 — Retention by active day, with a total cap
- **Decision**: file names carry the session start: `<component>-YYYYMMDD-HHMMSS-<pid>.log`, rotated as
  `….1.log`. A file's **day is its last-modified date**, not its session start: the daemon runs for days, and
  dating it by start would prune its live file. On start, each writer prunes the whole folder with a pure
  `retentionPlan(files, { keepDays, maxTotalBytes }, today)` in `core/src/diagnostics/rotation.ts`: keep every
  file whose day is among the last `keepDays` distinct days present, then delete oldest-first until the folder
  is under `maxTotalBytes` — **never an un-rotated file modified today**, which may be another process's live
  file (on Linux an unlinked live file keeps swallowing writes) — and log the trim (FR-019/019a). Rolled
  `….n.log` files are closed and always eligible. The daily check repeats on the first write after midnight so a daemon
  running for a week still prunes.
- **Settings**: `diagnostics.keepDays` (3, 1–30) and `diagnostics.maxTotalMb` (100, 50–2000 in steps of 50, hardMax 65536)
  replace `diagnostics.keepFiles` (FR-020). `maxFileSizeKb` stays: it is the roll-over size (FR-018).
- **Environment**: `THRONG_LOG_KEEP_DAYS` and `THRONG_LOG_MAX_TOTAL_MB` replace `THRONG_LOG_KEEP`.
- **Existing files**: old unprefixed names (`main.log`, `throng-agent-123.log`) are dated by mtime, so the
  first run of the new build prunes them by the same rule.

### R9 — The constitution amendment
- **Decision**: new Principle **XIII. Every Failure Leaves a Trace**, wording from FR-001–FR-003 and the
  clarified levels; version **6.2.0 → 6.3.0** (MINOR: a principle added, no guarantee withdrawn; the
  codebase falls short of it on day one, which precedent treats as MINOR). Plan template's Constitution
  Check gains the row.

### R10 — The audit record
- **Decision**: `specs/066-failure-logging/audit.md` lists every site from the baseline table, its
  finding-bugs class (BUG / LATENT / HARDENING / NOT-A-BUG) and the outcome (logs at level X / expected:
  reason / exempt: reason). The guard proves completeness; the audit records the judgement (SC-004).
