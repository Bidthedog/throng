# The two E2E tiers, and worker counts

Read when choosing `THRONG_E2E_TIER` / `THRONG_E2E_WORKERS`, deciding whether a spec belongs in the serial tier, or reading a red that appears only under load.

Part of the `throng-testing` skill; the contributor overview is [`docs/testing.md`](../../../../docs/testing.md).

## Two tiers: `THRONG_E2E_TIER`

`scripts/run-e2e-local.mjs` (behind `npm run test:e2e`, and the gate's E2E stage) runs the suite in
**two passes** — the parallel tier, then the serial tier at one worker. `THRONG_E2E_TIER=parallel|serial`
selects a tier by itself. The full suite runs on CI, never on the workstation — see *Where a test is
allowed to run* in [SKILL.md](../SKILL.md#where-a-test-is-allowed-to-run).

**The two tiers do not fail alike.** Contention breaks specs in the parallel tier that pass every
time in the serial one. If a red appears only under load, suspect a budget before you suspect the
product — see [budgets.md](budgets.md).

### What puts a spec in the serial tier

Three different mechanisms, all in `parallel-plan.json`:

- **Focus.** It opens the preferences window, or drives a context menu. throng
  deliberately closes menus and popups when its window loses focus
  (`context-menu.tsx`), so a second headed Electron app closes them underneath the
  test using them. The preferences window is a child window and takes focus too.
- **CPU.** It drives long-running real shells — a `ping`, a `findstr` loop — which
  starve at high worker counts and time out.
- **Timing.** It asserts a wall-clock ceiling that is *about the product*, so
  contention breaks it without anything having regressed. `daemon-status-bar`
  asserts SC-002's two seconds from killing the daemon to the notice appearing, and
  1200ms of that budget is the reconnect grace by design. A wall-clock assertion
  cannot tell contention from a regression, so it must not be asked the question
  under load.

Membership is the **mechanism** plus anything seen failing under parallel load —
deliberately not observed failures alone. Contention produces a *different* failure
set every run, so a few green runs cannot prove a menu-driving spec is safe. Drawing
the line from failures alone encodes luck.

`tier-plan.test.ts` guards the boundary, and the guard that matters fails the
build when a spec in the **parallel** tier grows a context menu or a preferences
window. Without it the boundary rots silently, and the symptom is some unrelated
test flaking because its menu closed.

### Why CI is arranged differently

CI runs **one worker, one job, no shards** — see *Two lanes* in `docs/testing.md` for what that job
actually runs, and `gate.yml`'s `THRONG_E2E_WORKERS` comment for why the gate pins one worker too.
Focus contention is per-desktop, so workers are the lever within a machine; raising them on a
runner reintroduces RPC-budget timeouts, launch-SLA misses and EPERM teardown races (see `ci.yml`),
which is the CPU mechanism above, not the focus one.

**Sharding is gone (spec 034).** Three shards pay the fixed `npm ci` + build toll three times, which
only pays when the work being split is large. The gating lane is capped at 50 tests, so the plan
file, the matrix, the blob reporter and the merge-report job were deleted together.

## `THRONG_E2E_WORKERS` — parallel workers

Sets Playwright's worker count for the E2E layer.

| Value | Behaviour |
| --- | --- |
| unset (**default `6`**) | Six spec **files** run in parallel. |
| `N` (e.g. `4`) | Up to N spec files run in parallel. |

A single spec run on the workstation passes `--workers=1`; that is the only E2E the workstation runs.

**Elevated runners are capped to 2 workers** (unless `THRONG_E2E_WORKERS` is set).
An elevated daemon routes terminals through the de-elevated agent (FR-025c), which
— with slower app/watcher teardown under contention — isn't robust at high
parallelism.

**CI is not the non-elevated case.** GitHub's Windows runners run as administrator,
so CI is an *elevated* run and pins `THRONG_E2E_WORKERS: 1` explicitly rather than
taking either default. Don't read a CI worker count or a CI green bar as evidence
about the non-elevated path — see [elevation.md](elevation.md) for what CI does and does not cover.

**It is CPU-bound, not RAM-bound.** Every worker runs a full Electron app + daemon (+ real shells for
terminal specs). Pushing workers toward the core count saturates the CPU and destabilises the run —
flaky terminal specs fail more often under load. Don't chase max workers; leave cores free.

Each spec is fully isolated — its own Electron app, daemon, SQLite DB, named pipe
(unique per process + timestamp), user-data dir, and config root — so files
parallelize safely.

**Dependencies between tests.** `fullyParallel: false` keeps the *file* as the
unit of parallelism: every test within a file runs in **one worker, in source
order**. So tests that build on each other must live in the **same file** (or a
`test.describe.serial(...)` block) — then they always share a worker, regardless
of `THRONG_E2E_WORKERS`. Do **not** set `fullyParallel: true`; it would scatter a
file's tests across workers and break any intra-file ordering. There are no
cross-file dependencies today (each spec sets up and tears down its own world).
