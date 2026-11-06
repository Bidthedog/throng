# Audit: every silent failure site (066 FR-010, SC-004)

Baseline: `packages/ui/tests/unit/failure-logging-guard.test.ts` run against `661a08e2` plus 066's Phase 2 —
454 sites. Each row is classified (finding-bugs: **BUG** reachable and user-visible, **LATENT** reachable
but harmless today, **HARDENING** not reachable in practice, **NOT-A-BUG** an anticipated failure) and given
an outcome: **logs (level)**, **expected: reason** (`logExpected`), **exempt: reason** (child starts only),
or **issue #N** where the underlying failure is itself a reachable defect (the site still logs).

Line numbers are the baseline's; the code has moved since.

## core (26)

| Site | Kind | Class | Outcome |
|---|---|---|---|
| `core/src/config/instance-identity.ts:80` | catch | NOT-A-BUG | expected: a non-JSON line on the instance pipe is not a launch message |
| `core/src/config/revert-plan.ts:83` | catch | NOT-A-BUG | expected: captured hand-edited settings need not parse; nothing to revert to |
| `core/src/config/settings-validity.ts:195` | catch | NOT-A-BUG | expected: settings mid-edit need not parse; the editor shows the error |
| `core/src/diagnostics/caught.ts:30` | catch | NOT-A-BUG | expected: a circular or throwing error value is logged by its type (console.debug; helpers cannot call themselves) |
| `core/src/editor/text-fidelity.ts:272` | catch | NOT-A-BUG | expected: detection tries encodings that do not fit the file |
| `core/src/explorer/file-index.ts:64` | catch | NOT-A-BUG | expected: a directory gone after its parent was listed (W6) |
| `core/src/fileop-undo/undo-stack.ts:237` | catch | HARDENING | expected: a corrupt stored stack degrades to empty (FR-010a) |
| `core/src/links/resource-class.ts:71` | catch | NOT-A-BUG | expected: http-looking text that does not parse is not a link |
| `core/src/links/sanitise.ts:99` | catch | NOT-A-BUG | expected: a scheme the URL parser rejects is refused as malformed |
| `core/src/navigation/history.ts:83` | catch | NOT-A-BUG | expected: an unserialisable view state is not kept |
| `core/src/preview/links.ts:96` | catch | NOT-A-BUG | expected: a document link with a malformed percent escape |
| `core/src/preview/request-policy.ts:58` | catch | NOT-A-BUG | expected: a file: URL with a malformed escape names no path |
| `core/src/search/search-exclude.ts:59` | catch | NOT-A-BUG | expected: a typed exclude glob may not compile; it is refused |
| `core/src/terminal/attention-scan.ts:126` | catch | NOT-A-BUG | expected: a program may send an OSC 99 payload with bad base64 |
| `core/src/testing/clipboard-contract.ts:87` | catch | NOT-A-BUG | logs (warn), then fails the contract |
| `core/src/testing/directory-lock-contract.ts:67` | catch | NOT-A-BUG | expected: the contract requires this acquire to reject |
| `core/src/testing/executable-extensions-contract.ts:119` | catch | NOT-A-BUG | logs (warn), then fails the contract |
| `core/src/testing/file-system-contract.ts:185` | catch | NOT-A-BUG | expected: Windows may refuse symlinks; the check is skipped |
| `core/src/testing/file-watcher-contract.ts:167` | .catch | NOT-A-BUG | expected: an unbatched watcher may let the wait lapse |
| `core/src/testing/file-watcher-contract.ts:98` | .catch | NOT-A-BUG | expected: a churn tick can land after cleanup |
| `core/src/testing/path-forms-contract.ts:261` | catch | NOT-A-BUG | logs (warn), then fails the contract |
| `core/src/testing/path-forms-contract.ts:404` | catch | NOT-A-BUG | logs (warn), then fails the contract |
| `core/src/testing/platform-seams-contract.ts:45` | catch | NOT-A-BUG | expected: the contract requires this restore to reject |
| `core/src/testing/platform-seams-contract.ts:54` | catch | NOT-A-BUG | expected: the contract requires this restore to reject |
| `core/src/testing/pty-host-contract.ts:184` | .catch | NOT-A-BUG | logs (warn), then fails the contract |
| `core/src/testing/pty-host-contract.ts:202` | .catch | NOT-A-BUG | expected: teardown end of a terminal the body normally ended |

## daemon (34)

| Site | Kind | Class | Outcome |
|---|---|---|---|
| `daemon/src/composition-root.ts:133` | catch | NOT-A-BUG | expected: settings.json may be absent or hand-edited into invalid JSON; the default poll interval applies |
| `daemon/src/composition-root.ts:242` | child start | LATENT | logs (`watchChild`, long-lived: fatal on an exit the daemon did not ask for) — US1 |
| `daemon/src/health-service.ts:12` | catch | NOT-A-BUG | expected: an unstamped partial build answers `dev` |
| `daemon/src/ipc-server.ts:114` | catch | HARDENING | logs (warn) — only UI main writes the socket, so a non-JSON line is a client defect |
| `daemon/src/main.ts:60` | catch | NOT-A-BUG | expected: an unstamped build names its crash reports `unknown` |
| `daemon/src/pty-agent-entry.ts:54` | catch | NOT-A-BUG | expected: a chunk that cannot be read as text is still written to the stream — US1 |
| `daemon/src/pty-agent-host.ts:280` | catch | HARDENING | logs (warn) — a malformed agent line is a protocol fault — US1 |
| `daemon/src/pty-agent-host.ts:592` | catch | NOT-A-BUG | expected: the agent pipe may already be closed at shutdown — US1 |
| `daemon/src/pty-agent-log.ts:38` | catch | NOT-A-BUG | removed — the agent log is now `openAgentLog` on `createFileLog` (US1) |
| `daemon/src/pty-agent-log.ts:46` | catch | NOT-A-BUG | removed — the agent log is now `openAgentLog` on `createFileLog` (US1) |
| `daemon/src/reap-orphans.ts:84` | catch | LATENT | logs (warn) — a failed snapshot leaves this start's orphans running |
| `daemon/src/reap-orphans.ts:91` | catch | NOT-A-BUG | expected: an orphan may exit between snapshot and kill, or belong to another account |
| `daemon/src/rpc-router.ts:58` | catch | NOT-A-BUG | expected for a typed refusal (answered as a JSON-RPC error the caller presents); logs (warn) for any other handler throw |
| `daemon/src/terminal-attention.ts:245` | catch | HARDENING | logs (warn) — name resolver threw; the signal still goes out with default names |
| `daemon/src/terminal-attention.ts:255` | catch | HARDENING | logs (warn) — live-title reader threw; the signal still goes out |
| `daemon/src/terminal-attention.ts:263` | catch | HARDENING | logs (warn) — doing describer threw; the signal still goes out |
| `daemon/src/terminal-events.ts:101` | catch | NOT-A-BUG | expected: a UI main that has gone leaves a dead socket, which drops out |
| `daemon/src/terminal-lock-manager.ts:69` | .catch | NOT-A-BUG | expected: a lock that could not be taken was reported to the terminal that asked; nothing to release |
| `daemon/src/terminal-service.ts:1008` | catch | NOT-A-BUG | expected: resize of a shell that has already exited (exit reported on its own path) |
| `daemon/src/terminal-service.ts:1074` | catch | NOT-A-BUG | expected: repaint nudge of a shell that has already exited |
| `daemon/src/terminal-service.ts:1095` | catch | NOT-A-BUG | expected: repaint restore of a shell that has already exited |
| `daemon/src/terminal-service.ts:1157` | catch | HARDENING | logs (warn) — a session listener's disposer threw on terminate |
| `daemon/src/terminal-service.ts:1181` | catch | HARDENING | logs (warn) — a session listener's disposer threw on exit |
| `daemon/src/terminal-service.ts:1197` | .catch | LATENT | logs (warn) — folder lock release failed on exit; the exit is still published |
| `daemon/src/terminal-service.ts:1332` | catch | LATENT | logs (warn) — busy probe failed; counted busy (046 FR-012) |
| `daemon/src/terminal-service.ts:393` | catch | LATENT | logs (warn) — cwd poll failed; last cwd kept |
| `daemon/src/terminal-service.ts:445` | .catch | LATENT | logs (warn) — attached-process request failed; last command kept (051 FR-042) |
| `daemon/src/terminal-service.ts:466` | catch | LATENT | logs (warn) — command observation failed; last value kept (025 FR-019e) |
| `daemon/src/terminal-service.ts:516` | .catch | NOT-A-BUG | expected: a command image the daemon may not open (another account's, or deleted) has no arch |
| `daemon/src/terminal-service.ts:588` | catch | NOT-A-BUG | expected: a PTY refusing the focus report is ending; exit reported on its own path |
| `daemon/src/terminal-service.ts:659` | catch | LATENT | logs (warn) — a PTY host that fails to dispose at shutdown may leave its processes |
| `daemon/src/terminal-service.ts:946` | catch | LATENT | logs (warn) — startup command write failed; also shown in the terminal (FR-026b). `classifyAndLog` now also logs an unclassified launch failure (`terminal-launch-failure-log.test.ts`) |
| `daemon/src/workspace-service.ts:213` | catch | LATENT | logs (warn) — a project layout that could not be rewritten is skipped; an unreadable one is logged by the repository and recorded here at debug |
| `daemon/src/workspace-service.ts:228` | catch | LATENT | logs (warn) — a sub-workspace that could not be rewritten is skipped |

## persistence (5)

| Site | Kind | Class | Outcome |
|---|---|---|---|
| `persistence/src/project-repository.ts:23` | catch | HARDENING | logs (warn) |
| `persistence/src/subworkspace-repository.ts:27` | catch | HARDENING | logs (warn) |
| `persistence/src/subworkspace-repository.ts:79` | catch | HARDENING | logs (warn) |
| `persistence/src/workspace-repository.ts:111` | catch | HARDENING | logs (warn); onCorrupt is optional and most callers omit it |
| `persistence/src/workspace-repository.ts:194` | catch | HARDENING | logs (warn) |

## platform-linux (32)

| Site | Kind | Class | Outcome |
|---|---|---|---|
| `platform-linux/src/linux-gpu.ts:62` | catch | NOT-A-BUG | expected: the process may have exited |
| `platform-linux/src/linux-gpu.ts:70` | catch | NOT-A-BUG | expected: a descriptor can close mid-read |
| `platform-linux/src/linux-gpu.ts:85` | catch | NOT-A-BUG | expected: a process can exit between listing and read |
| `platform-linux/src/linux-installed-version.ts:27` | catch | HARDENING | logs (warn) |
| `platform-linux/src/linux-path-forms.ts:59` | catch | NOT-A-BUG | expected: a pasted or linked file: URL may be malformed |
| `platform-linux/src/linux-process-cwd.ts:14` | catch | NOT-A-BUG | expected: an exited or another user's process has no cwd |
| `platform-linux/src/linux-process-metrics.ts:121` | catch | NOT-A-BUG | expected for ESRCH/EPERM; logs (warn) otherwise |
| `platform-linux/src/linux-process-metrics.ts:34` | catch | NOT-A-BUG | expected: only the owner may read /proc/<pid>/io |
| `platform-linux/src/linux-process-metrics.ts:49` | catch | NOT-A-BUG | expected: a process gone since the table was read |
| `platform-linux/src/linux-pty-host.ts:136` | catch | NOT-A-BUG | expected: the shell can exit before the resize |
| `platform-linux/src/linux-pty-host.ts:214` | .catch | HARDENING | logs (warn) |
| `platform-linux/src/linux-pty-host.ts:268` | .catch | HARDENING | logs (warn) |
| `platform-linux/src/linux-pty-host.ts:98` | child start | NOT-A-BUG | exempt: node-pty's shell; its exit is tracked through onExit |
| `platform-linux/src/linux-shell-detection.ts:50` | .catch | NOT-A-BUG | expected: a minimal system may have no /etc/shells |
| `platform-linux/src/linux-shell-detection.ts:65` | .catch | HARDENING | logs (warn) |
| `platform-linux/src/linux-shell-detection.ts:70` | .catch | NOT-A-BUG | expected: $SHELL may name an uninstalled shell |
| `platform-linux/src/linux-simple-services.ts:65` | .catch | NOT-A-BUG | expected: a missing folder is refused with ENOENT just below |
| `platform-linux/src/linux-simple-services.ts:87` | child start | NOT-A-BUG | logs (logChildFailure fc-list) |
| `platform-linux/src/linux-trash.ts:112` | .catch | NOT-A-BUG | expected: ancestors of a deleted item may be gone |
| `platform-linux/src/linux-trash.ts:127` | .catch | NOT-A-BUG | expected: a volume may have no trash folder |
| `platform-linux/src/linux-trash.ts:133` | .catch | NOT-A-BUG | expected: another program may remove the entry mid-read |
| `platform-linux/src/linux-trash.ts:22` | catch | NOT-A-BUG | expected: any program writes the trash; a malformed path is skipped |
| `platform-linux/src/linux-trash.ts:64` | .catch | NOT-A-BUG | expected: the parent folder may itself be gone |
| `platform-linux/src/linux-volume-roots.ts:62` | catch | HARDENING | logs (warn) |
| `platform-linux/src/linux-volume-roots.ts:86` | .catch | HARDENING | logs (warn) |
| `platform-linux/src/proc-table.ts:105` | catch | NOT-A-BUG | expected: a process can exit before its cmdline is read |
| `platform-linux/src/proc-table.ts:113` | catch | NOT-A-BUG | expected: an exited or another user's process has no exe link |
| `platform-linux/src/proc-table.ts:126` | catch | NOT-A-BUG | expected: an exited or another user's process keeps its kernel name |
| `platform-linux/src/proc-table.ts:139` | catch | NOT-A-BUG | expected: the process may be gone or foreign; the caller acts on false |
| `platform-linux/src/proc-table.ts:30` | child start | NOT-A-BUG | logs (logChildFailure getconf) |
| `platform-linux/src/proc-table.ts:87` | catch | NOT-A-BUG | expected: a process can exit between listing and read |
| `platform-linux/src/relevant-processes.ts:72` | catch | NOT-A-BUG | expected: a process can exit between listing and read |

## platform-node (7)

| Site | Kind | Class | Outcome |
|---|---|---|---|
| `platform-node/src/node-file-log.ts:121` | catch | NOT-A-BUG | logs to stderr (the console renderer cannot log through itself) |
| `platform-node/src/node-file-log.ts:135` | catch | NOT-A-BUG | last-resort: stderr itself failed — FR-013 exception |
| `platform-node/src/node-file-log.ts:323` | catch | HARDENING | logs to stderr: crash report could not be written |
| `platform-node/src/off-loop-exec.ts:88` | catch | HARDENING | logs (warn); falls back to execFile on the caller thread |
| `platform-node/src/off-loop-exec.ts:98` | child start | NOT-A-BUG | exempt: pass-through runner; the caller's callback gets error and stderr |
| `platform-node/src/stale-socket.ts:12` | .catch | NOT-A-BUG | expected: no socket file after a clean exit |
| `platform-node/src/stale-socket.ts:23` | .catch | NOT-A-BUG | expected: a racing second start may have removed it |

## platform-windows (58)

| Site | Kind | Class | Outcome |
|---|---|---|---|
| `platform-windows/src/node-pty-host.ts:198` | child start | NOT-A-BUG | exempt: node-pty's shell is not a ChildProcess; a failed spawn throws to the terminal service and its exit reaches the terminal's exit path through onExit |
| `platform-windows/src/node-pty-host.ts:299` | .catch | HARDENING | logs (warn) — the attribution queue it waits on already catches, so a rejection here is unexpected |
| `platform-windows/src/node-pty-host.ts:316` | .catch | NOT-A-BUG | expected: taskkill() already logged the refusal with its stderr (console host reap) |
| `platform-windows/src/node-pty-host.ts:326` | .catch | NOT-A-BUG | logs (warn) — the only record of a failed attribution pass (table read timed out or failed); the next pass retries |
| `platform-windows/src/node-pty-host.ts:366` | .catch | NOT-A-BUG | expected: the same rejection reaches the caller through the returned promise; this copy only keeps the kill queue moving |
| `platform-windows/src/node-pty-host.ts:376` | child start | NOT-A-BUG | logs (warn) — `logChildFailure` with stderr in the taskkill callback; exit 128 (already gone) still resolves silently as success |
| `platform-windows/src/node-pty-host.ts:396` | catch | NOT-A-BUG | expected: a resize already on its way to a pty whose shell has just exited |
| `platform-windows/src/node-pty-host.ts:433` | .catch | NOT-A-BUG | expected: taskkill() already logged the refusal with its stderr; the refusal is thrown if the shell outlives the deadline |
| `platform-windows/src/node-pty-host.ts:440` | .catch | NOT-A-BUG | expected: taskkill() already logged the refusal with its stderr (attached process) |
| `platform-windows/src/node-pty-host.ts:473` | .catch | NOT-A-BUG | expected: taskkill() already logged the refusal with its stderr; survivors are reported next (logSurvivors) |
| `platform-windows/src/node-pty-host.ts:476` | .catch | HARDENING | logs (warn) — every inner kill is caught, so a rejection here is unexpected |
| `platform-windows/src/node-pty-host.ts:490` | catch | NOT-A-BUG | logs (warn) — shutdown end failed, escalating to a forced end |
| `platform-windows/src/node-pty-host.ts:498` | .catch | NOT-A-BUG | expected: taskkill() already logged the refusal with its stderr (unattributed host at shutdown) |
| `platform-windows/src/node-pty-host.ts:577` | .catch | NOT-A-BUG | logs (warn) — the end goes ahead and ends less (helper or its JSON failed) |
| `platform-windows/src/node-pty-host.ts:593` | child start | NOT-A-BUG | logs (warn) — `logChildFailure` with stderr (attached-process helper) |
| `platform-windows/src/node-pty-host.ts:616` | child start | NOT-A-BUG | logs (warn) — `logChildFailure` with stderr in `run()` |
| `platform-windows/src/node-pty-host.ts:650` | catch | NOT-A-BUG | expected: run() already logged why powershell failed; attribution retries on the next pass |
| `platform-windows/src/node-pty-host.ts:747` | child start | NOT-A-BUG | logs (warn) — `logChildFailure` with stderr (pid table snapshot) |
| `platform-windows/src/node-pty-host.ts:812` | child start | NOT-A-BUG | logs (warn) — `logChildFailure` with stderr (process table) |
| `platform-windows/src/node-pty-host.ts:874` | .catch | NOT-A-BUG | logs (warn) — also the only record of a table that ran but did not parse |
| `platform-windows/src/windows-de-elevated-launcher.ts:53` | child start | NOT-A-BUG | exempt: watched by hand — `error` and a non-zero exit with stderr go to `report`, which PtyAgentHost logs at error |
| `platform-windows/src/windows-directory-lock.ts:54` | child start | NOT-A-BUG | logs (warn) — `watchChild`; an exit `release` asked for is debug |
| `platform-windows/src/windows-directory-lock.ts:81` | catch | NOT-A-BUG | expected: the holder exits by itself once its daemon is gone, so it may already be dead |
| `platform-windows/src/windows-directory-lock.ts:96` | catch | NOT-A-BUG | expected: Windows keeps the cwd handle briefly after the holder dies; a warn is added if it is still held at 3 s |
| `platform-windows/src/windows-elevation.ts:34` | child start | HARDENING | logs (warn) — `logChildFailure` in the catch (whoami.exe ships with Windows) |
| `platform-windows/src/windows-elevation.ts:40` | catch | HARDENING | logs (warn) — `logChildFailure`, then not-elevated as before |
| `platform-windows/src/windows-font-enumeration.ts:39` | catch | NOT-A-BUG | logs (warn) — `logChildFailure` with stderr; picker falls back to the curated list |
| `platform-windows/src/windows-foreground-handoff.ts:74` | catch | HARDENING | logs (warn) — koffi/user32 failing to load is a broken install |
| `platform-windows/src/windows-foreground-handoff.ts:86` | catch | HARDENING | logs (warn) — a refused grant returns false; only an FFI throw lands here |
| `platform-windows/src/windows-gpu-counters.ts:134` | catch | HARDENING | logs (warn) — PDH answers with status codes; a throw is the FFI failing |
| `platform-windows/src/windows-gpu-counters.ts:55` | catch | HARDENING | logs (warn) — koffi/pdh.dll failing to load is a broken install |
| `platform-windows/src/windows-network-trace.ts:266` | catch | HARDENING | logs (warn) — koffi/advapi32 failing to load is a broken install |
| `platform-windows/src/windows-network-trace.ts:293` | catch | NOT-A-BUG | expected: a stale session's owner has usually exited — finding that is the probe's job |
| `platform-windows/src/windows-network-trace.ts:453` | .catch | NOT-A-BUG | logs (warn) — stale-session cleanup failed; the start goes on |
| `platform-windows/src/windows-network-trace.ts:470` | catch | HARDENING | logs (warn) — trace calls answer with status codes; a throw is the FFI or worker start failing |
| `platform-windows/src/windows-network-trace.ts:471` | .catch | HARDENING | logs (warn) |
| `platform-windows/src/windows-network-trace.ts:479` | .catch | NOT-A-BUG | logs (warn) — stale-session cleanup failed |
| `platform-windows/src/windows-network-trace.ts:517` | .catch | HARDENING | logs (warn) |
| `platform-windows/src/windows-network-trace.ts:521` | .catch | HARDENING | logs (warn) |
| `platform-windows/src/windows-path-forms.ts:152` | catch | NOT-A-BUG | expected: text from terminal output or a pasted link may not be a well-formed URL |
| `platform-windows/src/windows-path-forms.ts:157` | catch | NOT-A-BUG | expected: a link may carry a stray % that is not a valid escape |
| `platform-windows/src/windows-path-forms.ts:194` | catch | HARDENING | logs (warn) — the lazy Git-root resolver throwing |
| `platform-windows/src/windows-path-forms.ts:211` | catch | NOT-A-BUG | expected: Git for Windows has etc\fstab only when customised |
| `platform-windows/src/windows-process-cwd.ts:153` | catch | HARDENING | logs (warn) — a gone/denied process is a null handle or false read; only an FFI throw lands here |
| `platform-windows/src/windows-process-cwd.ts:157` | .catch | HARDENING | logs (warn) |
| `platform-windows/src/windows-process-cwd.ts:81` | catch | HARDENING | logs (warn) — koffi/kernel32/ntdll failing to load is a broken install |
| `platform-windows/src/windows-process-metrics.ts:122` | catch | HARDENING | logs (warn) — koffi/kernel32/ntdll failing to load is a broken install |
| `platform-windows/src/windows-process-metrics.ts:164` | .catch | NOT-A-BUG | expected: the same rejection reaches the snapshot() caller; this copy only keeps the queue moving |
| `platform-windows/src/windows-process-metrics.ts:171` | .catch | HARDENING | logs (warn) — falls back to reading the whole machine |
| `platform-windows/src/windows-process-metrics.ts:236` | catch | HARDENING | logs (warn) — only an FFI throw lands here |
| `platform-windows/src/windows-process-metrics.ts:239` | .catch | HARDENING | logs (warn) |
| `platform-windows/src/windows-process-metrics.ts:254` | catch | HARDENING | logs (warn) — answered terminateFailed as before |
| `platform-windows/src/windows-process-metrics.ts:257` | .catch | HARDENING | logs (warn) |
| `platform-windows/src/windows-process-metrics.ts:269` | catch | HARDENING | logs (warn) — a gone/denied process is a null handle, not a throw |
| `platform-windows/src/windows-seams.ts:56` | child start | NOT-A-BUG | logs (warn) — `watchChild`; stderr now piped so the line carries PowerShell's words; still rejects to the sweep |
| `platform-windows/src/windows-seams.ts:78` | child start | NOT-A-BUG | logs (warn) — `logChildFailure` with stderr in the callback |
| `platform-windows/src/windows-shell-detection.ts:172` | child start | NOT-A-BUG | expected: `reg query` exit 1 = key/value absent (not installed via this key); any other failure logs (warn) via `logChildFailure` |
| `platform-windows/src/windows-shell-detection.ts:183` | catch | NOT-A-BUG | expected (exit 1) / logs (warn) otherwise — as :172 |

## ui/main (178)

| Site | Kind | Class | Outcome |
|---|---|---|---|
| `ui/src/main/broadcast.ts:44` | catch | NOT-A-BUG | expected: a window closed between the destroyed check and the send |
| `ui/src/main/broadcast.ts:55` | catch | NOT-A-BUG | expected: the sending window was destroyed while its message was in flight |
| `ui/src/main/composition-root.ts:164` | catch | HARDENING | logs (warn): the E2E attention-OS log could not be appended |
| `ui/src/main/config-store.ts:103` | .catch | NOT-A-BUG | expected: a first write has no target yet (ENOENT); anything else logs (warn) |
| `ui/src/main/config-store.ts:113` | .catch | NOT-A-BUG | expected: a first write has no mode to keep (ENOENT); anything else logs (warn) |
| `ui/src/main/config-store.ts:186` | .catch | NOT-A-BUG | expected: a prior write's rejection is reported to its own caller |
| `ui/src/main/config-store.ts:217` | catch | NOT-A-BUG | expected: a document absent on first run (ENOENT); anything else logs (warn) |
| `ui/src/main/config-store.ts:229` | catch | NOT-A-BUG | expected: a hand-edited document may be malformed; defaults are used |
| `ui/src/main/config-store.ts:263` | catch | NOT-A-BUG | expected: the document was removed before its write-back (ENOENT); anything else logs (warn) |
| `ui/src/main/config-store.ts:287` | .catch | HARDENING | logs (warn): a staged temp could not be removed |
| `ui/src/main/config-store.ts:303` | catch | NOT-A-BUG | expected: a document not yet written has no raw text (ENOENT); anything else logs (warn) |
| `ui/src/main/config-store.ts:330` | catch | NOT-A-BUG | expected: no themes folder until a theme is written (ENOENT); anything else logs (warn) |
| `ui/src/main/config-store.ts:371` | catch | NOT-A-BUG | expected: a deleted default theme is what restoring re-creates (ENOENT); anything else logs (warn) |
| `ui/src/main/config-store.ts:425` | catch | NOT-A-BUG | expected: a file the write creates did not exist (ENOENT); anything else logs (warn) and is returned |
| `ui/src/main/config-store.ts:440` | catch | NOT-A-BUG | logs (warn), then returned to the caller that reports it |
| `ui/src/main/config-store.ts:462` | catch | NOT-A-BUG | logs (warn), then rolled back and returned to the caller that reports it |
| `ui/src/main/config-store.ts:473` | .catch | HARDENING | logs (warn): a staging file could not be removed |
| `ui/src/main/config-store.ts:553` | catch | NOT-A-BUG | expected: the destination of a failed first write does not exist (ENOENT); anything else logs (warn) |
| `ui/src/main/config-watcher.ts:151` | catch | NOT-A-BUG | expected: settings.json mid-write or hand-edited into invalid JSON |
| `ui/src/main/config-write-ipc.ts:135` | catch | NOT-A-BUG | expected: a malformed hand-edited settings.json refuses the patch |
| `ui/src/main/config-write-ipc.ts:81` | catch | NOT-A-BUG | expected: unfinished JSON-tab text is refused as invalid |
| `ui/src/main/config-write-lock.ts:104` | .catch | NOT-A-BUG | expected: a prior section's rejection is reported to its own caller |
| `ui/src/main/daemon-client.ts:156` | catch | HARDENING | logs (warn): an unparseable health reply; socket errors are the disconnect the supervisor logs |
| `ui/src/main/daemon-events.ts:100` | catch | HARDENING | logs (warn); unknown methods log (warn); socket errors expected, the supervisor logs each state change once |
| `ui/src/main/daemon-lifecycle.ts:126` | catch | HARDENING | logs (warn): daemon-startup.log could not be opened |
| `ui/src/main/daemon-lifecycle.ts` readStartupTail (post-baseline, US1) | catch | NOT-A-BUG | expected: no usable log folder, so no daemon-startup.log |
| `ui/src/main/daemon-lifecycle.ts:163` | catch | HARDENING | logs (warn): an unparseable health reply |
| `ui/src/main/daemon-lifecycle.ts:180` | catch | NOT-A-BUG | expected: an unstamped build has no BUILD_ID |
| `ui/src/main/daemon-lifecycle.ts:295` | catch | NOT-A-BUG | expected: the retired daemon exited before the kill (logged at debug through the lifecycle's log) |
| `ui/src/main/daemon-lifecycle.ts:320` | child start | NOT-A-BUG | logs: watchChild at the spawn site (US1 options, startup-log tail) |
| `ui/src/main/daemon-supervisor.ts:111` | catch | NOT-A-BUG | logs (warn); every daemon state change logs once (info, warn for stopped) |
| `ui/src/main/document-authority.ts:486` | catch | HARDENING | logs (warn): a stored undo history that would not restore |
| `ui/src/main/editor-coordinator.ts:1895` | .catch | NOT-A-BUG | expected: an open file deleted or unreachable; the panel is marked unloadable |
| `ui/src/main/editor-coordinator.ts:538` | catch | NOT-A-BUG | expected: a dropped file vanished before the drop; refused with a reason |
| `ui/src/main/editor-ipc.ts:127` | catch | NOT-A-BUG | expected: daemon unreachable; the supervisor logs the disconnect, this fails closed |
| `ui/src/main/editor-recovery.ts:147` | catch | NOT-A-BUG | expected: a torn snapshot is refused |
| `ui/src/main/editor-recovery.ts:208` | .catch | NOT-A-BUG | expected: a prior write's failure is reported to its own caller |
| `ui/src/main/editor-recovery.ts:213` | .catch | NOT-A-BUG | expected: this write's failure is rethrown to its caller |
| `ui/src/main/editor-recovery.ts:253` | .catch | HARDENING | logs (warn): a failed snapshot temp could not be removed |
| `ui/src/main/editor-recovery.ts:275` | catch | NOT-A-BUG | expected: no recovery folder yet (ENOENT); anything else logs (warn) |
| `ui/src/main/editor-recovery.ts:284` | catch | NOT-A-BUG | expected: a snapshot removed after listing (ENOENT); anything else logs (warn) |
| `ui/src/main/editor-recovery.ts:295` | catch | NOT-A-BUG | expected: no recovery folder yet (ENOENT); anything else logs (warn) |
| `ui/src/main/editor-recovery.ts:306` | catch | NOT-A-BUG | expected: a snapshot removed after listing (ENOENT); anything else logs (warn) |
| `ui/src/main/editor-recovery.ts:317` | catch | NOT-A-BUG | expected: a panel with no unsaved edits has no snapshot (ENOENT); anything else logs (warn) |
| `ui/src/main/editor-recovery.ts:78` | catch | NOT-A-BUG | expected: a stray file in the recovery folder is not an encoded panel id |
| `ui/src/main/editor-service.ts:184` | catch | NOT-A-BUG | logs (warn), then returned as an io failure the panel reports |
| `ui/src/main/editor-service.ts:250` | catch | NOT-A-BUG | expected for unrepresentable text (the user is asked); an io failure logs (warn) |
| `ui/src/main/electron-clipboard.ts:60` | catch | HARDENING | logs (warn): the OS clipboard could not be read |
| `ui/src/main/electron-shell-integration.ts:103` | catch | NOT-A-BUG | logs (warn), then the OS reason goes to the notice |
| `ui/src/main/electron-shell-integration.ts:69` | catch | NOT-A-BUG | expected: a path deleted on disk (ENOENT); anything else logs (warn) |
| `ui/src/main/electron-taskbar-badge.ts:53` | catch | NOT-A-BUG | expected: a window closed between the destroyed check and the call |
| `ui/src/main/electron-taskbar-badge.ts:62` | catch | NOT-A-BUG | expected: a window closed between the destroyed check and the call |
| `ui/src/main/file-link-resolver.ts:303` | catch | NOT-A-BUG | logs (warn), then refused with the OS reason |
| `ui/src/main/file-search-service.ts:1043` | catch | NOT-A-BUG | expected: a file gone or unreadable since the walk is counted as skipped |
| `ui/src/main/file-search-service.ts:394` | .catch | NOT-A-BUG | logs (warn), then the scan reports cancelled |
| `ui/src/main/file-search-service.ts:607` | catch | NOT-A-BUG | expected: a result file deleted or renamed; its rows are marked stale |
| `ui/src/main/file-search-service.ts:665` | catch | NOT-A-BUG | expected: a file vanished after being written; the watcher marks it |
| `ui/src/main/files-service.ts:178` | catch | NOT-A-BUG | expected: the holder exited before the lookup; reported as not identified |
| `ui/src/main/files-service.ts:227` | catch | NOT-A-BUG | expected: failed() logs every result (cause via the diagnostic seam, else warn) |
| `ui/src/main/files-service.ts:287` | catch | NOT-A-BUG | expected: failed() logs every result (cause via the diagnostic seam, else warn) |
| `ui/src/main/files-service.ts:347` | catch | NOT-A-BUG | expected: failed() logs every result (cause via the diagnostic seam, else warn) |
| `ui/src/main/files-service.ts:373` | catch | NOT-A-BUG | expected: failed() logs every result (cause via the diagnostic seam, else warn) |
| `ui/src/main/files-service.ts:404` | catch | NOT-A-BUG | logs (warn) per item; the aggregate message names only the items |
| `ui/src/main/files-service.ts:430` | catch | NOT-A-BUG | expected: a path removed between the existence check and resolving it |
| `ui/src/main/files-service.ts:460` | catch | NOT-A-BUG | logs (warn), then the refusal is reported |
| `ui/src/main/files-service.ts:476` | catch | NOT-A-BUG | expected: failed() logs every result (cause via the diagnostic seam, else warn) |
| `ui/src/main/files-service.ts:492` | catch | NOT-A-BUG | expected: failed() logs every result (cause via the diagnostic seam, else warn) |
| `ui/src/main/files-service.ts:538` | catch | NOT-A-BUG | expected: failed() logs every result (cause via the diagnostic seam, else warn) |
| `ui/src/main/files-service.ts:564` | catch | NOT-A-BUG | expected: failed() logs every result (cause via the diagnostic seam, else warn) |
| `ui/src/main/files-service.ts:581` | .catch | NOT-A-BUG | expected: a rejected operation is reported to its own caller |
| `ui/src/main/font-cache.ts:29` | catch | HARDENING | logs (warn): enumeration failed; the picker uses its fallback list |
| `ui/src/main/font-cache.ts:42` | catch | NOT-A-BUG | expected: no cache before the first populate (ENOENT); anything else logs (warn) |
| `ui/src/main/ghost-window.ts:123` | .catch | NOT-A-BUG | expected: a ghost destroyed or closing mid-load rejects its load |
| `ui/src/main/ghost-window.ts:144` | .catch | NOT-A-BUG | expected: ghost shell not ready or window gone |
| `ui/src/main/ghost-window.ts:168` | .catch | NOT-A-BUG | expected: ghost shell not ready or window gone |
| `ui/src/main/ghost-window.ts:242` | .catch | NOT-A-BUG | expected: ghost mid-reload or closing when a hint arrives |
| `ui/src/main/icon-pack-service.ts:201` | catch | NOT-A-BUG | expected: a pack not yet seeded has no pack.json |
| `ui/src/main/icon-pack-service.ts:209` | catch | HARDENING | logs (warn) |
| `ui/src/main/icon-pack-service.ts:224` | catch | NOT-A-BUG | expected: README absent until first seeded |
| `ui/src/main/icon-pack-service.ts:230` | catch | HARDENING | logs (warn) |
| `ui/src/main/icon-pack-service.ts:258` | catch | NOT-A-BUG | expected: a hand-authored pack may name a file it lacks; icon falls back |
| `ui/src/main/icon-pack-service.ts:274` | catch | NOT-A-BUG | expected: icon-packs folder absent until seeded |
| `ui/src/main/icon-pack-service.ts:286` | catch | NOT-A-BUG | expected: hand-authored pack.json missing or malformed; pack listed with the error |
| `ui/src/main/link-ipc.ts:101` | catch | HARDENING | logs (warn); the renderer also raises the failed outcome |
| `ui/src/main/link-ipc.ts:115` | catch | HARDENING | logs (warn) |
| `ui/src/main/link-ipc.ts:86` | catch | HARDENING | logs (warn) |
| `ui/src/main/main.ts:1452` | catch | HARDENING | logs (warn); previous hidden-path cache kept |
| `ui/src/main/main.ts:1659` | .catch | HARDENING | logs (warn) |
| `ui/src/main/main.ts:183` | catch | HARDENING | logs (warn); envelope forwarded to the renderer |
| `ui/src/main/main.ts:202` | catch | NOT-A-BUG | expected: a partial tsc-only build is not stamped |
| `ui/src/main/main.ts:2072` | catch | NOT-A-BUG | expected: probes a terminal folder that has gone missing |
| `ui/src/main/main.ts:217` | catch | NOT-A-BUG | expected: only one of the dev/packaged licence locations exists |
| `ui/src/main/main.ts:2356` | child start | NOT-A-BUG | exempt: ResourceMonitorHost watches the collector it forks (watchChild) |
| `ui/src/main/main.ts:257` | catch | NOT-A-BUG | expected: only one of the dev/packaged manifest locations exists |
| `ui/src/main/main.ts:2667` | catch | HARDENING | logs (warn); the close still proceeds |
| `ui/src/main/main.ts:2708` | catch | HARDENING | logs (warn) |
| `ui/src/main/main.ts:2729` | .catch | HARDENING | logs (warn) |
| `ui/src/main/main.ts:282` | catch | NOT-A-BUG | expected: only one of the dev/packaged manifest locations exists |
| `ui/src/main/main.ts:298` | catch | NOT-A-BUG | expected: settings.json absent on first run |
| `ui/src/main/main.ts:665` | catch | NOT-A-BUG | expected: settings.json absent on first run or malformed by hand; defaults apply |
| `ui/src/main/main.ts:681` | catch | NOT-A-BUG | expected: settings.json absent on first run or malformed by hand; default applies |
| `ui/src/main/node-file-system.ts:136` | .catch | HARDENING | logs (warn); the copy error is rethrown |
| `ui/src/main/node-file-system.ts:158` | catch | NOT-A-BUG | expected: an existence probe answers false |
| `ui/src/main/node-file-system.ts:194` | catch | NOT-A-BUG | expected: a broken symlink has no target to stat |
| `ui/src/main/node-file-system.ts:209` | catch | NOT-A-BUG | expected: a folder may be unreadable or gone between list and probe |
| `ui/src/main/node-file-watcher.ts:252` | catch | NOT-A-BUG | expected: the ancestor may vanish too; scheduleRetry retries and warns |
| `ui/src/main/node-file-watcher.ts:295` | catch | NOT-A-BUG | expected: a missing folder is waited for; other failures retried and warned by scheduleRetry |
| `ui/src/main/notice-log.ts:175` | catch | HARDENING | logs to stderr (`throng log:`): the notice log's own failure |
| `ui/src/main/pick-folder.ts:65` | catch | NOT-A-BUG | expected: a candidate may sit on a disconnected drive; the next is tried |
| `ui/src/main/preferences-window.ts:80` | catch | NOT-A-BUG | expected: a window destroyed between the check and the send |
| `ui/src/main/preview-ipc.ts:231` | catch | HARDENING | logs (warn) |
| `ui/src/main/preview-ipc.ts:272` | catch | HARDENING | logs (warn) |
| `ui/src/main/preview-ipc.ts:282` | catch | HARDENING | logs (warn) |
| `ui/src/main/preview-ipc.ts:292` | catch | HARDENING | logs (warn) |
| `ui/src/main/preview-ipc.ts:306` | catch | HARDENING | logs (warn) |
| `ui/src/main/preview-ipc.ts:322` | catch | HARDENING | logs (warn) |
| `ui/src/main/preview-ipc.ts:368` | catch | NOT-A-BUG | expected: a window destroyed between the guard and the send is a decline |
| `ui/src/main/preview-protocol.ts:118` | catch | NOT-A-BUG | expected: a document link may carry a malformed percent escape |
| `ui/src/main/preview-protocol.ts:134` | catch | NOT-A-BUG | expected: a referenced asset may be missing or unreadable; 404 |
| `ui/src/main/preview-protocol.ts:96` | catch | NOT-A-BUG | expected: a request URL that does not parse names no route |
| `ui/src/main/preview-service.ts:1295` | catch | NOT-A-BUG | expected: a previewed or linked file may not exist |
| `ui/src/main/preview-service.ts:1305` | catch | NOT-A-BUG | expected: a file can vanish between its stat and its realpath |
| `ui/src/main/preview-service.ts:1718` | catch | HARDENING | logs (warn); shown as unreadable |
| `ui/src/main/preview-service.ts:1736` | .catch | HARDENING | logs (warn) |
| `ui/src/main/preview-service.ts:411` | catch | NOT-A-BUG | expected: a stray % is part of the name as written |
| `ui/src/main/preview-service.ts:586` | .catch | NOT-A-BUG | expected: the first attach reports its own failure; this one only waits |
| `ui/src/main/preview-service.ts:872` | .catch | HARDENING | logs (warn) |
| `ui/src/main/project-file-index.ts:304` | .catch | NOT-A-BUG | expected: a read can fail while files churn; the next reconcile settles it |
| `ui/src/main/project-file-index.ts:456` | catch | NOT-A-BUG | expected: the folder has gone since the signal |
| `ui/src/main/recycle-bin-restore.ts:97` | child start | NOT-A-BUG | watched (watchChild, one-shot): failed start or non-zero exit logs warn with stderr |
| `ui/src/main/renderer-debug-log.ts:36` | catch | HARDENING | logs to stderr (`throng log:`): the debug log's own failure |
| `ui/src/main/replace-commit-service.ts:514` | catch | HARDENING | logs (warn); failure returned to the find panel |
| `ui/src/main/resource-monitor-host.ts:275` | child start | NOT-A-BUG | watched (watchChild, US1 T021) |
| `ui/src/main/resource-monitor-host.ts:403` | catch | HARDENING | logs (warn); last good roster kept, figures marked stale |
| `ui/src/main/settings-subscribers.ts:23` | catch | HARDENING | logs (error) — the injected logger renamed `log` so the guard reads it |
| `ui/src/main/shipped-defaults-service.ts:226` | catch | NOT-A-BUG | expected: a hand-edited config file may not parse; reset refused |
| `ui/src/main/shipped-defaults-service.ts:302` | catch | NOT-A-BUG | expected: a hand-edited settings.json may not parse; left alone |
| `ui/src/main/shipped-defaults-service.ts:330` | catch | NOT-A-BUG | expected: a hand-edited keybindings.json may not parse; left alone |
| `ui/src/main/shipped-defaults-service.ts:459` | catch | NOT-A-BUG | expected: marker absent before the first seed |
| `ui/src/main/shipped-defaults-service.ts:472` | catch | NOT-A-BUG | expected: a hand-edited theme may not parse |
| `ui/src/main/shipped-defaults-service.ts:56` | catch | NOT-A-BUG | expected: an existence probe answers false |
| `ui/src/main/subworkspace-open.ts:107` | catch | NOT-A-BUG | expected: the failed outcome is logged at error by the main.ts IPC handler |
| `ui/src/main/subworkspace-open.ts:89` | catch | HARDENING | logs (warn) |
| `ui/src/main/terminal-ipc.ts:193` | .catch | HARDENING | logs (warn) |
| `ui/src/main/terminal-ipc.ts:267` | catch | NOT-A-BUG | expected: a remembered folder may be gone; falls back to the project root |
| `ui/src/main/terminal-ipc.ts:387` | catch | NOT-A-BUG | expected: timeout (still starting); logs (warn) otherwise |
| `ui/src/main/terminal-ipc.ts:461` | .catch | HARDENING | logs (warn) |
| `ui/src/main/terminal-ipc.ts:467` | .catch | HARDENING | logs (warn) |
| `ui/src/main/terminal-ipc.ts:474` | .catch | HARDENING | logs (warn) |
| `ui/src/main/terminal-ipc.ts:480` | .catch | HARDENING | logs (warn) |
| `ui/src/main/terminal-ipc.ts:484` | .catch | HARDENING | logs (warn) |
| `ui/src/main/terminal-ipc.ts:494` | .catch | HARDENING | logs (warn) |
| `ui/src/main/terminal-ipc.ts:518` | .catch | HARDENING | logs (warn) |
| `ui/src/main/terminal-reconnect.ts:103` | catch | HARDENING | logs (warn) |
| `ui/src/main/terminal-reconnect.ts:115` | catch | HARDENING | logs (warn) |
| `ui/src/main/terminal-reconnect.ts:164` | catch | HARDENING | logs (warn) |
| `ui/src/main/terminal-reconnect.ts:193` | catch | HARDENING | logs (warn) |
| `ui/src/main/terminal-reconnect.ts:209` | catch | NOT-A-BUG | expected: broadcasting to a window being destroyed can throw |
| `ui/src/main/terminal-reconnect.ts:220` | catch | HARDENING | logs (warn) |
| `ui/src/main/text-file-rewrite.ts:102` | catch | HARDENING | logs (warn); failure returned to the caller |
| `ui/src/main/text-file-rewrite.ts:73` | catch | HARDENING | logs (warn); failure returned to the caller |
| `ui/src/main/transfer-service.ts:1095` | catch | NOT-A-BUG | logs (warn); item failure reported per item |
| `ui/src/main/transfer-service.ts:1101` | catch | NOT-A-BUG | logs (warn); item failure reported per item |
| `ui/src/main/transfer-service.ts:1102` | .catch | HARDENING | logs (warn) |
| `ui/src/main/transfer-service.ts:1120` | .catch | HARDENING | logs (warn); the copy error is rethrown |
| `ui/src/main/transfer-service.ts:435` | catch | NOT-A-BUG | logs (warn); undo failure returned to the caller |
| `ui/src/main/transfer-service.ts:473` | catch | NOT-A-BUG | expected: a project whose root is gone confines nothing |
| `ui/src/main/transfer-service.ts:492` | catch | NOT-A-BUG | expected: a path not created yet is judged by its nearest ancestor |
| `ui/src/main/transfer-service.ts:670` | catch | NOT-A-BUG | logs (warn); rollback failure reported per item |
| `ui/src/main/transfer-service.ts:705` | .catch | HARDENING | logs (warn); the copy error is rethrown |
| `ui/src/main/transfer-service.ts:728` | catch | NOT-A-BUG | expected: a project whose root is gone confines nothing |
| `ui/src/main/transfer-service.ts:739` | catch | NOT-A-BUG | expected: the paste target can be deleted before the paste starts |
| `ui/src/main/transfer-service.ts:765` | catch | NOT-A-BUG | expected: an unreadable item is reported when placed |
| `ui/src/main/transfer-service.ts:838` | catch | NOT-A-BUG | logs (warn); item failure reported per item |
| `ui/src/main/transfer-service.ts:840` | .catch | HARDENING | logs (warn) |
| `ui/src/main/transfer-service.ts:858` | catch | NOT-A-BUG | expected: a source deleted since it was copied fails when placed |
| `ui/src/main/transfer-service.ts:877` | catch | NOT-A-BUG | expected: a landing folder not created yet |
| `ui/src/main/window-state.ts:25` | catch | NOT-A-BUG | expected: absent until the window first closes; defaults apply |
| `ui/src/main/window-state.ts:36` | catch | HARDENING | logs (warn) |

## ui/preload (2)

| Site | Kind | Class | Outcome |
|---|---|---|---|
| `ui/src/preload/preload.cts:152` | catch | HARDENING | logs (warn) via console |
| `ui/src/preload/preload.cts:27` | catch | NOT-A-BUG | expected (console.debug): main may not be ready; the renderer themes itself on mount |

## ui/renderer (107)

| Site | Kind | Class | Outcome |
|---|---|---|---|
| `ui/src/renderer/attention/attention-store.ts:46` | .catch | NOT-A-BUG | expected: main gone or window closing; next broadcast delivers the set |
| `ui/src/renderer/attention/holder-marks.tsx:141` | catch | NOT-A-BUG | expected: engine without `:focus-visible` (jsdom) |
| `ui/src/renderer/common/clipboard-copy.ts:59` | catch | NOT-A-BUG | expected: reported as the "Couldn't copy" notice, whose log record carries the error |
| `ui/src/renderer/common/panel-retry.ts:61` | catch | NOT-A-BUG | expected: reported as the "Couldn't retry" notice, whose log record carries the error |
| `ui/src/renderer/common/transient-overlay.ts:131` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/config/config-store.tsx:124` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/config/write-config.ts:109` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/config/write-config.ts:174` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/config/write-config.ts:304` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/config/write-config.ts:309` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/config/write-config.ts:32` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/diagnostics-log.ts:24` | catch | NOT-A-BUG | expected: a value JSON cannot serialise is described by String() |
| `ui/src/renderer/editor/drop-target.tsx:118` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/editor/use-editor.ts:2790` | .catch | NOT-A-BUG | expected: window tearing down; main no longer answers |
| `ui/src/renderer/editor/use-editor.ts:467` | .catch | NOT-A-BUG | expected: window tearing down; main no longer answers |
| `ui/src/renderer/editor/use-editor.ts:521` | .catch | NOT-A-BUG | expected: window tearing down; main no longer answers |
| `ui/src/renderer/explorer/file-clipboard-store.ts:48` | .catch | NOT-A-BUG | expected: window tearing down; main no longer answers |
| `ui/src/renderer/explorer/transfer-completion.tsx:107` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/explorer/transfer-completion.tsx:118` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/explorer/transfer-completion.tsx:81` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/explorer/use-explorer-data.ts:1479` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/explorer/use-explorer-data.ts:1608` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/explorer/use-explorer-data.ts:1724` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/explorer/use-explorer-data.ts:174` | catch | NOT-A-BUG | expected: localStorage unavailable, full or corrupt |
| `ui/src/renderer/explorer/use-explorer-data.ts:216` | catch | NOT-A-BUG | expected: localStorage unavailable, full or corrupt |
| `ui/src/renderer/explorer/use-explorer-data.ts:276` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/explorer/use-explorer-data.ts:334` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/explorer/use-explorer-data.ts:403` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/explorer/use-explorer-data.ts:591` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/find-in-files/commit-replace.ts:240` | catch | NOT-A-BUG | expected: reported as the "Replace in files" notice, whose log record carries the error |
| `ui/src/renderer/find-in-files/commit-replace.ts:260` | catch | NOT-A-BUG | expected: reported as the "Replace in files" notice, whose log record carries the error |
| `ui/src/renderer/find-in-files/find-in-files-store.ts:887` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/keybindings/window-dispatcher.tsx:255` | catch | NOT-A-BUG | expected: a focus offset the node cannot take |
| `ui/src/renderer/keybindings/window-dispatcher.tsx:263` | catch | NOT-A-BUG | expected: a Range with no layout engine (test env) |
| `ui/src/renderer/links/file-link-menu.ts:193` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/links/link-actions.ts:392` | catch | NOT-A-BUG | expected: reported as the link-failure notice, whose log record carries the error |
| `ui/src/renderer/links/link-actions.ts:408` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/links/path-by-name.ts:62` | catch | NOT-A-BUG | expected: user text with a malformed percent-escape |
| `ui/src/renderer/main.tsx:38` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/panes/use-persisted-bool.ts:16` | catch | NOT-A-BUG | expected: localStorage unavailable, full or corrupt |
| `ui/src/renderer/panes/use-persisted-bool.ts:23` | catch | NOT-A-BUG | expected: localStorage unavailable, full or corrupt |
| `ui/src/renderer/panes/vertical-panel-stack.tsx:128` | catch | NOT-A-BUG | expected: localStorage unavailable, full or corrupt |
| `ui/src/renderer/panes/vertical-panel-stack.tsx:62` | catch | NOT-A-BUG | expected: localStorage unavailable, full or corrupt |
| `ui/src/renderer/preferences/form-controls.tsx:669` | catch | NOT-A-BUG | expected: user typed something that is not a JSON array; field marked invalid |
| `ui/src/renderer/preferences/json-tab.tsx:182` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/preferences/json-tab.tsx:96` | catch | NOT-A-BUG | expected: user mid-edit or invalid JSON; shown as a problem in the tab |
| `ui/src/renderer/preferences/preferences-folds.ts:53` | catch | NOT-A-BUG | expected: localStorage unavailable, full or corrupt |
| `ui/src/renderer/preferences/preferences-folds.ts:74` | catch | NOT-A-BUG | expected: localStorage unavailable, full or corrupt |
| `ui/src/renderer/preferences/preferences-folds.ts:89` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/preferences/settings-tab.tsx:200` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/preferences/settings-tab.tsx:222` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/preferences/themes-tab.tsx:294` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/preferences/themes-tab.tsx:298` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/preferences/themes-tab.tsx:478` | catch | NOT-A-BUG | expected: hand-edited theme file may be malformed; shown in the tab's error line |
| `ui/src/renderer/preview/copy.ts:105` | catch | NOT-A-BUG | expected: an undrawn diagram is copied as its source text |
| `ui/src/renderer/preview/diagram/diagram-frame.tsx:372` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/preview/link-dom.ts:131` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/preview/open-preview.ts:481` | catch | NOT-A-BUG | expected: user text with a malformed percent-escape |
| `ui/src/renderer/preview/preview-panel.tsx:1103` | .catch | NOT-A-BUG | expected: window tearing down; main no longer answers |
| `ui/src/renderer/preview/preview-panel.tsx:503` | catch | NOT-A-BUG | expected: reported as the panel failure banner (via `settleAttach`), whose log record carries the error |
| `ui/src/renderer/preview/preview-panel.tsx:631` | catch | NOT-A-BUG | expected: reported as the panel failure banner, whose log record carries the error |
| `ui/src/renderer/preview/preview-panel.tsx:836` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/preview/providers/markdown/embeds.ts:68` | catch | NOT-A-BUG | expected: user text with a malformed percent-escape |
| `ui/src/renderer/preview/providers/markdown/embeds.ts:83` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/preview/providers/markdown/highlight.ts:110` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/preview/providers/markdown/markdown-body.tsx:942` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/preview/providers/markdown/markdown-body.tsx:961` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/preview/providers/markdown/markdown-body.tsx:977` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/preview/providers/markdown/markdown-body.tsx:982` | .catch | NOT-A-BUG | expected: reported as the panel failure banner, whose log record carries the error |
| `ui/src/renderer/preview/providers/markdown/pipeline.ts:250` | catch | NOT-A-BUG | expected: pathological front matter throws the YAML parser; shown as code |
| `ui/src/renderer/preview/providers/markdown/sanitise.ts:136` | catch | NOT-A-BUG | expected: user text with a malformed percent-escape |
| `ui/src/renderer/preview/providers/markdown/wikilinks.ts:70` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/resources/status-resources.tsx:62` | catch | NOT-A-BUG | expected: engine without `:focus-visible` (jsdom) |
| `ui/src/renderer/sidebar/unload-project.ts:129` | catch | NOT-A-BUG | expected: reported as the one unload notice, whose log record carries the error |
| `ui/src/renderer/sidebar/unload-project.ts:151` | catch | NOT-A-BUG | expected: reported as the one unload notice, whose log record carries the error |
| `ui/src/renderer/state/fileop-undo-client.ts:26` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/state/fileop-undo-client.ts:37` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/state/fileop-undo-client.ts:52` | catch | NOT-A-BUG | expected: stack from an older build or corrupt; history starts empty |
| `ui/src/renderer/state/panel-name-client.ts:28` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/state/panel-name-client.ts:36` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/state/projects-store.tsx:273` | catch | NOT-A-BUG | expected: reported as the project error notice, whose log record carries the error |
| `ui/src/renderer/state/projects-store.tsx:330` | catch | NOT-A-BUG | expected: reported as the project error notice, whose log record carries the error |
| `ui/src/renderer/state/projects-store.tsx:436` | catch | NOT-A-BUG | expected: reported as the project error notice, whose log record carries the error |
| `ui/src/renderer/state/subworkspaces-store.tsx:98` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/state/workspace-store.tsx:332` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/state/workspace-store.tsx:488` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/subworkspace-app.tsx:102` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/terminal/debug-log.ts:29` | catch | NOT-A-BUG | expected: a circular/BigInt field cannot be JSON-serialised |
| `ui/src/renderer/terminal/debug-log.ts:49` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/terminal/osc52.ts:24` | catch | NOT-A-BUG | expected: the program sent invalid base64 or non-UTF-8 text |
| `ui/src/renderer/terminal/use-terminal.ts:1296` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/terminal/use-terminal.ts:1340` | catch | NOT-A-BUG | expected: container not laid out yet on mount |
| `ui/src/renderer/terminal/use-terminal.ts:1451` | catch | NOT-A-BUG | expected: view not measurable yet (hidden or mounting) |
| `ui/src/renderer/terminal/use-terminal.ts:1472` | catch | NOT-A-BUG | expected: view not measurable yet (hidden or mounting) |
| `ui/src/renderer/terminal/use-terminal.ts:1567` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/terminal/use-terminal.ts:1765` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/terminal/use-terminal.ts:930` | .catch | HARDENING | logs (warn) |
| `ui/src/renderer/util/use-resize.ts:15` | catch | NOT-A-BUG | expected: localStorage unavailable, full or corrupt |
| `ui/src/renderer/util/use-resize.ts:52` | catch | NOT-A-BUG | expected: localStorage unavailable, full or corrupt |
| `ui/src/renderer/workspace/detach-context.tsx:110` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/workspace/detach-context.tsx:164` | catch | NOT-A-BUG | expected: reported as the sub-workspace error notice, whose log record carries the error |
| `ui/src/renderer/workspace/detach-context.tsx:213` | catch | NOT-A-BUG | expected: reported as the sub-workspace error notice, whose log record carries the error |
| `ui/src/renderer/workspace/detach-context.tsx:253` | catch | NOT-A-BUG | expected: reported as the sub-workspace error notice, whose log record carries the error |
| `ui/src/renderer/workspace/panel-focus.ts:203` | catch | NOT-A-BUG | expected: view tearing down when focus is asked of it |
| `ui/src/renderer/workspace/panel-focus.ts:86` | catch | NOT-A-BUG | expected: view tearing down as it registers |
| `ui/src/renderer/workspace/panel-state-capture.ts:101` | catch | HARDENING | logs (warn) |
| `ui/src/renderer/workspace/panel-state-capture.ts:80` | catch | HARDENING | logs (warn) |

## ui/collector (5)

| Site | Kind | Class | Outcome |
|---|---|---|---|
| `ui/src/collector/collector.ts:181` | catch | HARDENING | logs (warn); previous figures marked stale |
| `ui/src/collector/collector.ts:210` | .catch | HARDENING | logs (warn) |
| `ui/src/collector/collector.ts:214` | .catch | HARDENING | logs (warn) |
| `ui/src/collector/collector.ts:288` | .catch | HARDENING | logs (warn) |
| `ui/src/collector/collector.ts:329` | .catch | HARDENING | logs (warn); reported as a failed kill |

