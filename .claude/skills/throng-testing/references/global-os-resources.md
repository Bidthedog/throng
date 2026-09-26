# The global OS resources a run must never write

Read before writing a spec that calls `electron.launch()` directly, or when a run touches the developer’s clipboard or shell history.

Part of the `throng-testing` skill; the contributor overview is [`docs/testing.md`](../../../../docs/testing.md).

## The global OS resources a run must never write

Temp files, config roots and user-data dirs are all isolated per launch, and the
[temp-files.md](temp-files.md) and [writing-e2e.md](writing-e2e.md) cover them. The harder cases are the resources that have exactly
**one** instance per user, where "isolate it" is not available and the only
answer is *do not write it at all*. Two exist, and both were bugs before they
were rules.

| Resource | Seam | Switch |
|---|---|---|
| The clipboard | `MemoryClipboard` replaces the Electron clipboard in-process | `THRONG_E2E_CLIPBOARD=memory` |
| Shell history | The launch spec asks each shell to persist nothing | `THRONG_TEST_SHELL_HISTORY=off` |

Both are set by `harness.ts` on every app it launches, so a spec that uses the
harness gets them for free.

**Shell history (#339) is the one that never announced itself.** The suite types
real commands into real PowerShell sessions, and PSReadLine defaults to
`SaveIncrementally` — flushing each command, as it is typed, into
`%APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt`. That
file is shared with every PowerShell the developer runs by hand and is capped at
`MaximumHistoryCount` (4096), so a run did not merely add noise to their history:
it **evicted their own commands**. Measured before the fix — 1,853 of 7,398 lines
were probes from these specs (`READYOK`, `SCROLLMARK118`, `LINKFENCE4`).

Note what that failure mode does to your feedback loop. A spec writing the
developer's history **never fails**. It passes, and the symptom surfaces hours
later in someone else's terminal as commands missing from Ctrl+R. Nothing in a
test run would ever point at it — which is why the protection is enforced by a
guard rather than left to care.

**`packages/ui/tests/unit/e2e-shell-history.test.ts` fails the build for any spec
that calls `electron.launch()` without the flag.** Around ten specs launch
directly, and such a spec opts out of every harness protection silently, by
omission. That has already cost this suite once: `terminal-clipboard.e2e.ts`
records in its own comments that its direct launch missed
`THRONG_E2E_CLIPBOARD`, so the tests pasted the developer's real clipboard and
failed 3/3 on a dev box while passing on CI, whose clipboard is empty.

So: **launch through `harness.ts`**, and if a spec genuinely needs its own
launch, copy both switches into its env.

`cmd` needs nothing — it keeps no persistent history, which is why the daemon's
integration tests, which launch `ComSpec`, never contributed to this.
