# Contract: the notice log channel

The renderer→main bridge that makes FR-006 possible. New surface; nothing like it exists today
(verified: `preload.cts` exposes no logging API, and `packages/ui/src/main/diagnostics.ts` owns the
only sink).

## Preload surface

```ts
window.throng.notices.log(record: NoticeLogRecord): void
```

One-way, fire-and-forget. No reply, no promise, no error surfaced to the caller — a diagnostics
write that fails must never turn into a user-facing failure, which would be a notice that fails to
log by raising a notice.

## Record

```ts
interface NoticeLogRecord {
  level: LogLevel;          // 'error' | 'warn' | 'info' | 'debug' — derived in core
  severity: NoticeSeverity;
  message: string;
  subject: string;          // pre-formatted; main does not re-derive it
  causeKey?: string;
  affectedCount?: number;
  detail?: string;          // the raw system error (FR-034)
  affectedDetails?: readonly { panel: string; detail: string }[];   // per-panel errors (FR-048a)
}
```

The handler writes the record as one line, then **one further line per `affectedDetails` entry**,
each naming its panel. A log line is a line; embedding newlines in one record would break the format.

`level` is derived by core from `severity` (FR-006) so the mapping exists once and both sides agree:

| severity | level |
|---|---|
| `error` | `error` |
| `warning` | `warn` |
| `info` | `info` |
| `success` | `info` |

## The write path — a new one is required

**`UiDiagnostics.log` cannot carry this.** Verified in the code: every write in `createFileLog` opens
`if (!passesThreshold(threshold, level)) return;`
(`packages/platform-windows/src/node-file-log.ts:129`), and `DiagnosticLog` exposes only `setLevel` —
no bypass. Routing notice records through it would drop them under `diagnostics.logLevel: 'error'`,
which is the precise outcome FR-006b forbids, and it would do so silently.

So this feature adds one method:

```ts
// DiagnosticLog, packages/platform-windows/src/node-file-log.ts
/** Write regardless of the configured threshold — for records whose absence would break a
 *  guarantee made to the user (030 FR-006b). Rotation and formatting are unchanged. */
logAlways(level: LogLevel, message: string): void;
```

surfaced on `UiDiagnostics` and used by the handler below. It is the same `write` minus the threshold
check; rotation, formatting and the swallow-on-failure behaviour are untouched.

This is a cross-package change — `@throng/platform-windows`, which the plan's source tree names.

## Main handler

`packages/ui/src/main/notice-log.ts` registers the IPC handler and writes through
`UiDiagnostics.logAlways` with component `renderer-notice`. It applies no policy of its own:

- It does **not** re-derive the level — the renderer's `level` is authoritative.
- It does **not** filter, by severity or by level. Notice records **bypass** `diagnostics.logLevel`
  (FR-006b) — with `logLevel: 'error'` a silenced `warning` would otherwise reach nowhere at all,
  which is exactly what FR-008's confirmation promises cannot happen.
- It does **not** validate the message; it is already a rendered string.

## Line format

`formatLogLine` renders `<iso> <LEVEL> [<component>] <message>` — so **severity is not recoverable
from the level**: `info` and `success` both render `INFO`, and FR-007 requires the severity, while
T015 can only observe what is in the file. The subject needs the same treatment: appending it into
the prose makes it unfindable.

So the handler composes the message as a small set of labelled fields:

```
2026-08-11T14:08:07.188Z ERROR [renderer-notice] severity=error subject="Panel — Tab 1 — one.txt" cause=path-missing:test 1 affected=3 | Couldn't rename "PJ Replacement" — a file or folder with this name already exists.
2026-08-11T14:08:07.190Z ERROR [renderer-notice] detail | ENOENT: no such file or directory, realpath 'D:\git\throng_tests\test 1'
2026-08-11T14:08:07.191Z ERROR [renderer-notice] panel="Tab 1 — one.txt" detail | EPERM: operation not permitted, open
```

- `severity=` is always present; the level alone cannot carry it.
- `subject=` is present whenever the notice has one, quoted so a subject containing spaces stays one
  field.
- `cause=` and `affected=` appear when the notice has them.
- The message follows a `|` so the prose can contain anything without ambiguity.
- Each `affectedDetails` entry is its own line, naming its panel.

## What is guaranteed

| Requirement | Guarantee |
|---|---|
| FR-006 | One record per accepted notice, whatever its display mode |
| FR-006b | Written regardless of `diagnostics.logLevel` |
| FR-007 | The record carries severity, message and subject |
| FR-034 | The raw system error reaches the log, exactly once — the *only* route to it when the severity is silenced, since there is then no toast to copy from |
| FR-048a | Each affected panel's own raw error reaches the log, on its own line |
| SC-003 | A `never` notice appears in the log exactly as often as the same event does when displayed — raise and growths alike |

## What is not

- Ordering against main's own log lines is best-effort — IPC is asynchronous and the timestamp is
  taken in the renderer, not in main.
- Rotation and retention are the log's own policy; a record can age out of the retention window like
  any other line. What cannot happen is a record being dropped *at write time* by the level
  threshold (FR-006b).
