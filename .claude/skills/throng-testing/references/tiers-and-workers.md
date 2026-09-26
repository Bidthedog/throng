# The two local tiers, worker counts, and their measurements

Read when choosing `THRONG_E2E_TIER` / `THRONG_E2E_WORKERS`, deciding whether a spec belongs in the serial tier, reading a red that appears only at six workers, or quoting a suite timing.

Part of the `throng-testing` skill; the contributor overview is [`docs/testing.md`](../../../../docs/testing.md).

## Two tiers: `THRONG_E2E_TIER`

`npm run test:e2e` runs the suite in **two passes** — the parallel tier at several
workers, then the serial tier at one. `THRONG_E2E_TIER=parallel|serial` selects a
tier by itself. (It used to compose with `THRONG_E2E_GROUP`, which went with sharding.)

**Every figure below names the measurement it came from and the suite size it was taken
at.** That is not ceremony. The numbers this section used to publish were taken at 214
spec files and never re-taken; by the time anyone checked, the suite was 235 files and
the real cost was nearly double what this page claimed. A timing figure with no
provenance goes stale silently, and a stale one is worse than none — people plan
around it.

**Measured 2026-08-15** on `origin/master` `d55054b`, 235 spec files / 782 tests, on a
10-core / 20-thread machine, non-elevated, with the developer's own tools running
(`specs/034-e2e-harness-integrity/baseline.md`):

| | files | tests | time |
| --- | --- | --- | --- |
| parallel tier, 6 workers | 115 | 311 | **14.9 min** |
| serial tier, 1 worker | 117 | 480 | 31.9 min |
| whole suite | 232 | 791 | **46.9 min** |

That table is the **pre-fix baseline**, taken on `origin/master` `d55054b` before spec 034 changed
anything.

**Measured 2026-08-20** on `feature/S035-e2e-layer-migration`, at the end of spec 035 —
**207 spec files / 548 declarations**, same machine, non-elevated, as the E2E stage of a green
`npm run gate` (all 8 stages, 22m 57s):

| | tests run | time |
| --- | --- | --- |
| parallel tier, 6 workers | 200 (+15 skipped) | **2.4 min** |
| serial tier, 1 worker | 347 | 15.7 min |
| whole suite | 547 | **18.2 min** |

The 15 skips are elevation-guarded (`skipIfElevated`), and a developer machine is not elevated —
they are not failures and not omissions.

**The serial tier is now 86% of the wall-clock**, up from 87% at the previous measurement and 68% at
the pre-034 baseline. That ratio is the useful number rather than the total: it says the remaining
cost is menus, preferences windows and real shells, which is the work that cannot move down a layer.
035 took 141 declarations out and 3 minutes with them, and almost all of the time came off the
serial tier — the parallel tier was already down to 2.4 minutes and had little left to give.

**Against the pre-034 baseline that is 46.9 → 18.2 minutes, a 61% cut.**

### The worker sweep (035 T065)

**Measured 2026-08-20**, retries OFF, on the PARALLEL tier — 200 tests, 15 elevation-guarded skips:

| workers | passed | failed | time |
| ---: | ---: | ---: | ---: |
| 6 | 200 | 0 | **2m 37s** |
| 3 | 200 | 0 | 3m 30s |
| 1 | 200 | 0 | 8m 56s |

The point of the sweep is the PASS RATE, not the clock. 034's finding was that some specs starve as
workers rise — which is why the serial tier exists at all — and with retries off a suite that
degrades reports it as failures rather than absorbing it. Nothing here degrades: 200/200 at every
width.

Wall-clock scales 2.5× from 1→3 workers and only 1.34× from 3→6, so this tier is near its floor —
most of what remains is per-test Electron startup, which more workers cannot amortise away.

Swept on the parallel tier only, and deliberately: `run-e2e-local.mjs` pins the serial tier to one
worker by construction, so sweeping "the suite" would run 347 of its 547 tests at one worker
whatever the flag said, at 15.7 minutes a pass.

### The 034 measurement, superseded and kept

**Measured 2026-08-18** on `feature/S034-I251-e2e-harness-integrity` `53ff359`, after the whole
suite had been examined — **229 spec files / 641 declarations**, same machine, non-elevated.

A dated measurement does not go stale — it is evidence of what was true on that date — so the
numbers below are left exactly as they were taken.

| | tests run | time |
| --- | --- | --- |
| parallel tier, 6 workers | 257 | **2.7 min** |
| serial tier, 1 worker | 432 | 18.5 min |
| whole suite | 689 | **21.2 min** |

`tests run` exceeds `declarations` because four spec files declare tests inside a module-level loop
over shell flavours, so one declaration becomes several executed tests. Both are given because they
answer different questions: declarations bound what people WRITE (the budget ratchet counts those),
executed tests bound what the machine DOES.

**Superseded, and kept so the drift is visible** — measured 2026-08-17 at `a7c3d6c`, 246 spec files
/ 804 declarations: parallel tier 302 tests / 3.8 min, serial 500 / 24.6 min, whole suite 802 /
~28.4 min.

**The `@core` lane, measured separately on 2026-08-17** at `f9534c7`, one worker, invoked the way
`scripts/ci-e2e-run.ps1` invokes it (`npm run test:e2e:raw -- --grep @core`) — which is what gates
every push:

| pass | tests | time | failed | flaky |
| --- | --- | --- | --- | --- |
| 1 | 35 | **2.1 min** | 0 | 0 |
| 2 | 35 | **2.1 min** | 0 | 0 |

Run TWICE deliberately: a lane that gates every push has to be trusted, and one green run cannot
distinguish a stable suite from a lucky one. Two passes 1 second apart in wall-clock, both clean.

That is the figure to compare against the ~36 runner-minutes the three-shard arrangement used to
spend on a push. The lane is measured locally on a 10-core machine and CI runners are slower, so
treat 2.1 minutes as a floor rather than a prediction — but the headroom against the ten-minute
ceiling is large enough that the conclusion survives the difference.

Two honest caveats on that run, because a figure without them is the kind this section exists to
stop. The serial tier excluded ONE test — `editor-missing-aggregate.e2e.ts` (declared at :221; the
line was cited as 155 before 035's migration moved it), which `origin/master` was also red on (CI
run 31956697834, 2026-08-16), so it was not 034's and its ~36 seconds × 3 retries are not in the
total. And 802 of 804 declarations ran; the remainder are elevation-guarded skips.

That exclusion no longer applies: #277 is fixed, the test is un-quarantined, and it now passes in
about six seconds — so a serial tier measured today runs it. The figures above are left as measured
rather than re-stated, because they are a record of that run.

**Against the pre-fix baseline that is 46.9 → 21.2 minutes, a 55% cut** — 28.4 at the previous
measurement, so a further 25% came out of the final pass alone. The parallel tier fell
furthest (14.9 → 3.8) because that is where the markup-only tests lived, and they are the ones the
component layer absorbed. The serial tier barely moved (31.9 → 24.6) and is now **87% of the
runtime** — it is menus, preferences windows and real shells, which is exactly the work that cannot
move down a layer. Further cuts have to come from there or not at all.

**Superseded, and kept so the drift is visible** — an intermediate figure of ~40 minutes was quoted
in this file and in `CLAUDE.md` at 235 spec files, measured 2026-08-16 between the baseline above
and 034's cut.

**Superseded, and kept so the drift is visible** — measured at 214 files / 658 tests:
parallel 4.7 min, serial 20.0 min, whole suite at one worker ~35 min.

**The serial tier holds more tests than the parallel one** and was ~68% of the runtime
at the 2026-08-15 baseline — **87% as of 2026-08-17**, because 034's cut came almost
entirely out of the parallel tier. Menu and preferences specs are test-dense, and they
are exactly the ones that cannot share a desktop.

**The two tiers do not fail alike.** In that same measurement the parallel tier
returned 10 failed and 8 flaky, and the serial tier returned 480 of 480 on the first
attempt. Same code, same build, minutes apart. If a red appears only at six workers,
suspect a budget before you suspect the product — see [budgets.md](budgets.md).

> **The table above is a MEASUREMENT, not a live count** — it is what this suite did on the day it
> was measured, and the file counts in it are the composition at that moment. As of **2026-08-16**
> the suite holds **247 spec files, 127 of them serial**, against the 214/99 measured here. The
> numbers are deliberately left as they were rather than being edited to match: the times beside them
> were measured against *that* composition, and a table mixing today's file counts with a year-ago
> stopwatch would read as current while being true of nothing. Re-measure and replace the whole row
> when the balance matters; do not patch one column.
>
> The **shape** of the finding is unaffected and is what the table is for — the serial tier still
> holds fewer files and more tests, for the same reason, and spec 033 added four more menu- and
> preferences-driving specs to it (`menu-sections`, `navigation-remember`, `open-in-terminal`,
> `subtree-expand-collapse`) against one to the parallel tier (`window-chord-resolution`, which
> drives no context menu and opens no preferences window). That is the mechanism working, not drift.

### What puts a spec in the serial tier

Three different mechanisms, all in `parallel-plan.json`:

- **Focus.** It opens the preferences window, or drives a context menu. throng
  deliberately closes menus and popups when its window loses focus
  (`context-menu.tsx`), so a second headed Electron app closes them underneath the
  test using them. The preferences window is a child window and takes focus too.
- **CPU.** It drives long-running real shells — a `ping`, a `findstr` loop — which
  starve at high worker counts and time out. `terminal-command-memory` timed out at
  30.6s in the parallel tier for this reason, not for focus.
- **Timing.** It asserts a wall-clock ceiling that is *about the product*, so
  contention breaks it without anything having regressed. `daemon-status-bar`
  asserts SC-002's two seconds from killing the daemon to the notice appearing, and
  1200ms of that budget is the reconnect grace by design — leaving 800ms for the
  socket, the broadcast and a paint. Measured at 2039ms with six workers. A
  wall-clock assertion cannot tell contention from a regression, so it must not be
  asked the question under load.

Membership is the **mechanism** plus anything measured failing at six workers —
deliberately not observed failures alone. Contention produces a *different* failure
set every run (0, 5, 1, 3, 4 and 6 flaky across six runs when this was first
measured), so three green runs cannot prove a menu-driving spec is safe. Drawing
the line from failures alone would have said 37 files serial; the mechanism says
94. The extra 57 are the price of not encoding luck.

`tier-plan.test.ts` guards the boundary, and the guard that matters fails the
build when a spec in the **parallel** tier grows a context menu or a preferences
window. Without it the boundary rots silently, and the symptom is some unrelated
test flaking because its menu closed.

> It was `shard-plan.test.ts` until spec 034 deleted sharding; the shard assertions
> went with it and the tier assertions stayed, which is the whole of the rename.

### Why CI is arranged differently

CI runs **one worker, one job, no tiers and no shards** — see *Two lanes* in
`docs/testing.md` for what that job actually runs. Focus contention is per-desktop, so workers are the
lever within a machine; raising them on a runner was measured reintroducing
RPC-budget timeouts, launch-SLA misses and EPERM teardown races on a 4-vCPU runner
(see `ci.yml`), which is the CPU mechanism above, not the focus one. Tiers only help
if you run more than one worker, so they buy CI nothing that would not cost it that.

**Sharding is gone (spec 034).** CI used to split the suite across three runners by
a measured plan in `shard-plan.json`, because the whole suite ran on every push.
Three shards means paying the fixed `npm ci` + build toll three times — the thing
issue #103 was about — and that only pays when the work being split is large. It no
longer is: the gating lane is capped at 50 tests, and splitting a lane that size
across three machines costs three tolls to save nothing. The plan file, the matrix,
the blob reporter and the merge-report job were deleted together.

## `THRONG_E2E_WORKERS` — parallel workers

Sets Playwright's worker count for the E2E layer.

| Value | Behaviour |
| --- | --- |
| unset (**default `6`**) | Six spec **files** run in parallel — the benchmarked knee (below). |
| `N` (e.g. `4`) | Up to N spec files run in parallel; use a smaller N for a calmer machine. |

```bash
THRONG_E2E_WORKERS=4 npm run test:e2e     # PowerShell: $env:THRONG_E2E_WORKERS=4; npm run test:e2e
```

Every `npm run test` / `npm run test:e2e` now runs the E2E layer at 6 workers by
default (`npm run test` runs unit → component → integration → contract → e2e in order).

**Elevated runners are capped to 2 workers** (unless `THRONG_E2E_WORKERS` is set).
An elevated daemon routes terminals through the de-elevated agent (FR-025c), which
— with slower app/watcher teardown under contention — isn't robust at high
parallelism, so 6 elevated workers flake. A normal (non-elevated) shell keeps the
full 6. Force a count with `THRONG_E2E_WORKERS=6` (accepting elevated flakiness),
or — better — **run the suite from a non-elevated shell** for full-speed, stable runs.

**CI is not the non-elevated case.** GitHub's Windows runners run as administrator,
so CI is an *elevated* run and pins `THRONG_E2E_WORKERS: 1` explicitly rather than
taking either default. Don't read a CI worker count or a CI green bar as evidence
about the non-elevated path — see [elevation.md](elevation.md) for what CI does and does not cover.

Each spec is fully isolated — its own Electron app, daemon, SQLite DB, named pipe
(unique per process + timestamp), user-data dir, and config root — so files
parallelize safely.

**Benchmark** (30 spec files, headed, on a 10-core / 20-thread, 128 GB machine):

| workers | wall time | speedup | peak CPU | peak Electron procs |
| ------: | --------: | ------: | -------: | ------------------: |
|       1 |      439s |    1.0× |      60% |                   5 |
|       2 |      242s |    1.8× |      69% |                   8 |
|       4 |      159s |    2.8× |      87% |                  16 |
|   **6** |  **137s** | **3.2×** |  **96%** |              **25** |
|       8 |      130s |    3.4× |     100% |                  33 |

The knee is **~6 workers**: 1→6 is a 3.2× win, but 6→8 buys only ~5% more while
the CPU pegs at 100%. So **6 is the default** (fastest before improvements flatten,
still off the 100% ceiling); drop to **4** via `THRONG_E2E_WORKERS` if you want
more foreground headroom (2.8×, ~87% peak).

**It's CPU-bound, not RAM-bound.** Free RAM never dropped below ~100 GB at any
level — RAM is a non-issue. CPU is the whole constraint: every worker runs a full
Electron app + daemon (+ real shells for terminal specs). Pushing workers toward
the logical-core count saturates the CPU **and destabilises the run** — flaky
terminal specs fail more often under load (failures rose from 10 at 1 worker to 16
at 8). Don't chase max workers; leave cores free.

**Dependencies between tests.** `fullyParallel: false` keeps the *file* as the
unit of parallelism: every test within a file runs in **one worker, in source
order**. So tests that build on each other must live in the **same file** (or a
`test.describe.serial(...)` block) — then they always share a worker, regardless
of `THRONG_E2E_WORKERS`. Do **not** set `fullyParallel: true`; it would scatter a
file's tests across workers and break any intra-file ordering. There are no
cross-file dependencies today (each spec sets up and tears down its own world).
