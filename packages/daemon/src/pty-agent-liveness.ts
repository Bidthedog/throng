/**
 * Liveness-probe interpretation for the de-elevated PTY agent (#94).
 *
 * A de-elevated (medium-integrity) agent watches whether its daemon is still alive by
 * probing the pid with `process.kill(daemonPid, 0)` — a signal-nothing poke that
 * throws when it can't be delivered. The throw carries two DIFFERENT error codes that
 * mean OPPOSITE things:
 *
 *   - `ESRCH`  — no such process. The daemon is genuinely GONE.
 *   - `EPERM`  — the process EXISTS, but this process may not signal it.
 *
 * `EPERM` is the *normal* result when a medium-integrity agent probes its ELEVATED
 * (high-integrity) daemon: Windows forbids a medium process from opening a handle to a
 * high-integrity one. Treating `EPERM` as death is exactly why a de-elevated terminal
 * self-terminated ~3 s after connecting (#94) — the heartbeat threw `EPERM` on its
 * first tick, every tick, and shut the agent down while the daemon was alive and well.
 *
 * So a probe error means the daemon is gone ONLY for `ESRCH`. Anything else — `EPERM`,
 * or an unexpected/absent code — is treated as "alive or uncertain": the agent keeps
 * running and relies on the pipe-close event, which is the real cross-integrity
 * liveness signal, to notice a genuine daemon death. (A hard-killed daemon frees its
 * pid, so a real death still surfaces as `ESRCH` here too — the backstop keeps working
 * for the case it exists for.)
 */
export function probeErrorMeansDaemonGone(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'ESRCH';
}
