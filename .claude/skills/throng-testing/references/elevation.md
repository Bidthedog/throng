# Elevation: `@admin`, `skipIfElevated()` and non-elevated runs

Read when a spec depends on administrator rights or a normal-integrity daemon, when adding a `skipIfElevated()` call, or when a result differs between an elevated and a non-elevated run.

Part of the `throng-testing` skill; the contributor overview is [`docs/testing.md`](../../../../docs/testing.md).

## The `@admin` suite

The elevated `@admin` E2E (run-as-admin / de-elevation) are separate; run them
locally with `npm run test:e2e:admin` from an elevated shell. The normal suite
**excludes** `@admin` specs (config `grepInvert`), so an elevated dev machine doesn't
run them here; a runner sets `THRONG_E2E_INCLUDE_ADMIN` to opt back in.

**CI runs the `@admin` suite** in its own job (`E2E (@admin, elevated)`), which sets
`THRONG_E2E_INCLUDE_ADMIN=1` and calls `npx playwright test` directly — never
`npm run test:e2e:admin`, which exists to hop UAC from a non-elevated shell and is
both pointless and interactive where the process is already elevated. It is a job
rather than a step inside `e2e` because it needs an elevated runner and the `e2e`
job is not one — the two cannot share a process, whatever the suite is split into.
(The original reason was sharding: an `@admin` step inside a three-way split would
have run three times, or — if no `@admin` file landed on that shard — not at all.
That reason retired with the shards; the elevation one is why the job survives them.)
One job, one run, one signal. Until it existed, `@admin` specs were excluded from
the *only* runner capable of running them, and the gap read as covered because a
comment claimed a dedicated runner that did not exist.

## Run the suite non-elevated

The terminal E2E assume a **non-elevated (normal-integrity) daemon** — the common
case for a user, but **not** how CI runs (CI is elevated; see [tiers-and-workers.md](tiers-and-workers.md#throng_e2e_workers--parallel-workers)). A non-elevated
daemon runs each terminal directly, so its
`conhost.exe` is the daemon's own child, the "run as admin" control is disabled,
and re-typing a panel gets a fresh direct PTY. **If you run the suite from an
elevated shell**, the app respawns an elevated daemon (FR-025b) that routes every
terminal through the de-elevated agent (FR-025c) — a different, less parallel-robust
process tree those assertions don't hold for. Such specs call `skipIfElevated()`
(see `packages/ui/tests/e2e/admin.ts`) and **skip when elevated**, so an elevated
run stays green.

**A green CI bar is still not full coverage — but the gap is now small and deliberate.** CI is
elevated, so a guarded test does not run there; those assumptions are verified only by a developer
running the suite from a non-elevated shell, which is why a non-elevated run belongs in a PR's
evidence. **Prefer a non-elevated shell for the full E2E run.**

**Call it inside the test body, never at module scope.** `skipIfElevated()` at the top of a file
skips *every test in it*, which is how the gap below got so large: the guard was applied per FILE
while the assumption it encodes belongs to individual tests. All 25 remaining call sites are inside
a `test()`, and there are none at module scope — keep it that way.

**How big the gap is: 22 spec files, 25 of 634 tests.** It was `~85 files / 208 tests` — a third of
the suite, including almost the whole `editor-*` cluster (38 of its 41 files), none of which had any
reason for the guard.

That was settled by measurement, not by reading. `THRONG_E2E_IGNORE_ELEVATION_GUARD=1` is an audit
hatch that runs the guarded specs *anyway*; CI is the only elevated environment available, so one CI
run (`30979816073`) with the hatch open answered which specs genuinely depend on a normal-integrity
daemon. **71 files had no such dependency and passed elevated** — the guard came off them. What
remains are the specs whose subject *is* the process tree: conhost reaping, command observation, cwd
reading, run-as-admin, and reattach.

The hatch only ever makes MORE tests run, never fewer, so it cannot be used to turn a red suite
green. Every E2E run prints the remaining count, so the number stays visible instead of being
rediscovered.

### Why CI cannot simply drop privileges

This was attempted and does not work on GitHub-hosted runners. Both mechanisms were
measured failing (run `30947653266`):

| mechanism | result |
| --- | --- |
| `schtasks /RL LIMITED` | ran with `admin=True` — UAC is **disabled** on the runners, so there is no filtered token for "Limited" to fall back to |
| `runas /trustlevel:0x20000` | produced no result at all |
| the product's own `WindowsDeElevatedLauncher` | needs the interactive shell's token via `CreateProcessWithTokenW`; a runner has no interactive shell — the same limit `skipWithoutInteractiveDesktop()` documents |

Note what "de-elevated" has to mean here: `isElevated()` asks whether `net session`
succeeds, so it is a question about **administrator rights**, not integrity level.
Lowering integrity alone would leave every guarded spec still skipping.

`scripts/run-deelevated.ps1` is kept for a **machine with UAC enabled** — which now means a
developer workstation, the gate having moved back to hosted runners —
where it should work. It probes each strategy before use, so an environment that
cannot drop rights fails in about 30 seconds with a clear message rather than
consuming a full E2E run — and it never silently falls back to running elevated,
because a suite that looks like it ran while verifying nothing is the failure this
whole area exists to prevent. `THRONG_DEELEVATE_FORCE=1` exercises it from an
ordinary shell.
