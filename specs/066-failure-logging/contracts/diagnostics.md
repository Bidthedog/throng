# Contract: diagnostics logging

## `@throng/core` — `diagnostics/caught.ts`

```ts
logCaught(where: string, error: unknown): void                    // warn
logExpected(where: string, reason: string, error?: unknown): void // debug; reason must be non-empty
logFatal(component: string, error: unknown): void                 // fatal, always written
```

All three write through `console` (R1) and never throw. `logFatal` prefixes `[FATAL]`, which
`attachConsole` maps to the fatal level.

## `@throng/core` — `diagnostics/rotation.ts`

```ts
interface RetentionPolicy { keepDays: number; maxTotalBytes: number; maxFileBytes: number }
normaliseRetention(p: Partial<RetentionPolicy> | undefined): RetentionPolicy
retentionPlan(files: LogFileInfo[], policy: RetentionPolicy, today: string /* YYYYMMDD */): { delete: string[]; trimmedBytes: number }
sessionFileName(component: string, startedAt: Date, pid: number): string
```

## `@throng/platform-node`

```ts
createFileLog(options: FileLogOptions & { retention?: Partial<RetentionPolicy> }): DiagnosticLog
watchChild(child: ChildProcess, opts: { name: string; log: (level: LogLevel, msg: string) => void;
  longLived: boolean; expectedExit?: (code: number | null, signal: string | null) => string | undefined }): void
logChildFailure(name: string, error: unknown, stderr?: string): void
```

`watchChild` logs: spawn `error` (fatal if long-lived, else warn); an exit not marked expected (fatal if
long-lived, else warn) with the stderr tail ≤ 4 KB; an expected exit at debug with its reason.

## Preload → main

`window.throng.diagnostics.log(level: LogLevel, component: string, message: string)` → IPC
`throng:diagnostics:log` → `logAlways` for `fatal`, `log` (threshold-filtered) otherwise. Messages capped at
8 KB.

## PTY agent

`pty-agent-entry.js <pipeName> <logDir>` — passed explicitly because the de-elevated launch drops the
environment (FR-017). When the UI's logs folder lies under `%APPDATA%`, `logDir` is that path **relative to
`%APPDATA%`** with the prefix `appdata:` (`appdata:throng\logs`), and the agent resolves it against its own
`APPDATA` — so a de-elevated agent running as a different user writes to that user's throng log folder, and
the same user writes to the same folder. Otherwise `logDir` is absolute.

## Settings (`settings.json`)

| Key | Type | Default | Bounds |
|---|---|---|---|
| `diagnostics.logLevel` | `fatal\|error\|warn\|info\|debug` | `info` | — |
| `diagnostics.maxFileSizeKb` | number | 1024 | 64–4096 (hardMax 65536) |
| `diagnostics.keepDays` | number | 3 | 1–30 |
| `diagnostics.maxTotalMb` | number | 100 | 50–2000, step 50 (hardMax 65536) |

Removed: `diagnostics.keepFiles` (an existing value is ignored, not an error).

## Environment

Added `THRONG_LOG_KEEP_DAYS`, `THRONG_LOG_MAX_TOTAL_MB`; removed `THRONG_LOG_KEEP`.

## The logger's own failures

The file logger cannot log its own failure to itself. Each of its catches writes one line to
`process.stderr` (`throng log: <what failed>: <error>`), which the guard accepts as logging. For the daemon
that lands in `daemon-startup.log`; for UI main, on the developer console. FR-016 still holds: the write is
wrapped, and a failing stderr is the one case dropped without a trace.

## Source markers

- `// child-exempt: <reason>` on the line before a process start the parent deliberately does not watch.
