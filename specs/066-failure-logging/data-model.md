# Data model: Every failure leaves a trace in the diagnostic log

## LogLevel

`fatal | error | warn | info | debug`, in that order of severity. A configured threshold filters `error`
and below; `fatal` always passes (FR-009a). `parseLogLevel` accepts `fatal` as a threshold too.

## Log record (one line)

`<ISO time> <LEVEL> [<component>] <message>` — the existing `formatLogLine`, with `FATAL` added.

| Message shape | Written by |
|---|---|
| `<where>: <error>` | `logCaught` (warn) |
| `<where>: expected — <reason>: <error>` | `logExpected` (debug) |
| `<component> crashed: <error or exit code/signal>` | `logFatal` |
| `<child> exited with code N / signal S: <stderr tail ≤ 4 KB>` | `watchChild` |
| `<previous message> (repeated N times in Ns)` | the logger's repeat collapse |
| `log retention trimmed N files (M MB) to stay under C MB` | retention |

## Log file

| Field | Rule |
|---|---|
| Name | `main.log` and `daemon.log` keep their names (users, tooling and E2E find them by name); the PTY agent and the collector, one file per process, use `<component>-<YYYYMMDD>-<HHMMSS>-<pid>.log`. Rolled: `….<n>.log` |
| Day | the file's last-modified date — so a live file is always today |
| Folder | the one logs folder the cog menu opens — every process, every user identity it runs as (FR-017) |
| Roll-over | at `diagnostics.maxFileSizeKb` (FR-018) |

## Retention policy

| Field | Default | Bounds | Source |
|---|---|---|---|
| `keepDays` | 3 | 1–30 | `diagnostics.keepDays` / `THRONG_LOG_KEEP_DAYS` |
| `maxTotalBytes` | 100 MB | 50–2000 MB, step 50 (hardMax 65536) | `diagnostics.maxTotalMb` / `THRONG_LOG_MAX_TOTAL_MB` |
| `maxFileBytes` | 1 MB | unchanged | `diagnostics.maxFileSizeKb` / `THRONG_LOG_MAX_KB` |

`retentionPlan(files, policy, today)` → `{ delete: string[], trimmedBytes: number }`:
1. Active days = distinct file days present, newest first; keep files whose day is within the first `keepDays`.
2. Of the kept, while the total exceeds `maxTotalBytes`, delete the oldest first.
3. Never delete an un-rotated file (`<component>-…-<pid>.log`, no `.n`) whose day is `today`: it may be any
   process's live file. Rolled files are always eligible.

Removed: `diagnostics.keepFiles`, `THRONG_LOG_KEEP`, `RotationPolicy.keep` (FR-020).

## Audit entry (`audit.md`)

| Field | Values |
|---|---|
| Site | `package/path:line` |
| Kind | empty catch / silent `.catch` / fallback catch / child start / dropped message / crash hook |
| Class | BUG / LATENT / HARDENING / NOT-A-BUG (finding-bugs) |
| Outcome | logs (level) / expected: reason / exempt: reason / issue #N |
