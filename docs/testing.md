# Testing

throng has four test layers, run in order by `npm run test`:

| Script | Layer | Runner | Parallelism |
| --- | --- | --- | --- |
| `npm run test:unit` | unit | Vitest (`--project unit`) | parallel (Vitest default) |
| `npm run test:integration` | integration | Vitest (`--project integration`) | **serial** (`fileParallelism: false`) |
| `npm run test:contract` | contract | Vitest (`--project contract`) | **serial** (`fileParallelism: false`) |
| `npm run test:e2e` | E2E | Playwright-Electron | configurable (see below) |

`npm run test` runs all four through `scripts/run-tests.mjs` (see *Temp files* below).

## Type-checking covers the renderer too

`npm run typecheck` runs **two** checks: `tsc -b` for the main/preload/core reference graph, then
`npm run typecheck:renderer` (`tsc -p packages/ui/tsconfig.renderer.json`) for the renderer —
`packages/ui/src/renderer`, every `.tsx`, the whole editor and preferences UI. The renderer is
*built* by Vite (which strips types without checking them), so it needs its own `tsc` pass; the gate
now runs it, and CI's "Lint & type-check" job runs `npm run typecheck`, so a renderer type error
fails locally and on CI.

This was once a hole (issue #82): `tsc -b` walks `packages/ui/tsconfig.json`, which includes only
`src/main`/`src/preload`, so the renderer was never checked — a type error there compiled, shipped,
and failed at runtime with a green `typecheck`. It had bitten: a call passing the wrong argument
shape left the editor's keymap rebuilt with an undefined dependency, so Tab and Shift+Tab threw from
the moment the user changed any key binding. A guard now keeps the gate honest —
`packages/ui/tests/unit/renderer-typecheck-gate.test.ts` fails if the renderer check is ever unwired
from `npm run typecheck`.

You can still run just the renderer's check while iterating:

```
npm run typecheck:renderer
```

The integration and contract layers spawn real OS processes (node-pty shells,
directory-lock holders) and **can only run one file at a time** — concurrent
spawning hits the Windows "AttachConsole failed" limit under load. That is why
they set `fileParallelism: false`; do not parallelize them.

## No headless mode

The E2E app runs with **real, on-screen windows** — there is no headless mode, and no
`show: false` seam exists to make one. Runs still work unattended on CI (the runner has a virtual
desktop) and locally; expect windows to appear while a run is in progress.

**Terminals are the reason usually given, and they are the weakest one.** The inline **xterm.js
terminals only mount and drive their ConPTY in a genuinely visible, painting window** — a hidden
(`show: false`), off-screen, or transparent (`opacity: 0`) window blanks them, so the terminal never
spawns its PTY and the spec fails. True, but it only covers the specs that drive a terminal: **36 of
145 spec files (25%)** as of 2026-07-17. On its own it invites the obvious question — *why not run
the other 75% hidden?* — so here are the reasons that actually carry the weight:

- **The terminal-free set is not paint-free.** 23 spec files call `boundingBox()`, 13 drive
  `page.mouse.*`, one takes a screenshot, one uses `geom()`. Hidden-mode eligibility is a property of
  **what a spec asserts**, not of which file it lives in — so it cannot be derived, only hand-tagged.
- **A hand-applied tag rots silently.** The first `boundingBox()` added to a "hidden-safe" spec breaks
  it, and because `failOnFlakyTests` is armed (below), that rot arrives as a **red run**.
- **The drag ghost is a real OS window.** `drag-ghost.e2e.ts` asserts `w.isVisible()` on it and reads
  its painted style, and `ghost-window.ts` positions it off the **real cursor** via
  `screen.getCursorScreenPoint()` — which Playwright's synthetic mouse never moves.
- **The cost is launch, not paint.** A run performs roughly 424 Electron launches against a ~5s
  launch budget (`performance.e2e.ts`), the worker benchmark below concludes the constraint is
  per-worker Electron + daemon **processes**, and CI's floor is a ~3–4 min `npm ci` + build toll *per
  shard, before a test runs* (#103). **Nothing in this repo measures compositing cost at all** — so
  hiding windows targets a cost that has never been shown to exist.

The trade being refused is therefore: **maintain a second harness, plus a production `show: false`
branch that only test runs take, to speed up a minority slice of a suite whose cost is process
startup — and never again be able to answer "does the hidden path test the same thing the headed one
does?" without running both.**

This was reasoned through on **#75** (answered "don't", 2026-07-16) and is out of scope on **#103**.
Both are worth reading before re-opening it — but note that neither ever *measured* anything, and
#103's "51% of specs drive terminals" is not reproducible (25% is; the figure appears to come from a
case-insensitive `pty` grep also matching "empty"). **#117 re-opens the question empirically**, and is
where the evidence should land.

## `THRONG_E2E_STEP_MS` — watch a run happen

Pauses between the steps of a spec that opts in, so a run can be followed by eye. Zero by default,
which makes every pause a no-op: a suite must not get slower because somebody once needed to see it.

```bash
THRONG_E2E_STEP_MS=2000 npx playwright test <spec> --headed --retries=0
```

An Electron run already puts a real window on screen, so time between the actions is the only thing
missing when a defect has to be watched rather than asserted.

## `THRONG_CLAUDE_E2E` — the specs that drive real Claude Code

Terminal key handling has defects that only appear against the actual program: five stand-in
fixtures failed to reproduce what a user reproduced every time. Those specs therefore drive the real
`claude` binary, which needs it installed and logged in and spends a little quota — so they are
opt-in and never run on CI.

```bash
THRONG_CLAUDE_E2E=1 npx playwright test packages/ui/tests/e2e/terminal-claude-keys.e2e.ts --workers=1
```

## `THRONG_CLAUDE_E2E_ROOT` — a project with real sessions in it

Points those specs at an existing project instead of a fresh temp directory. Claude's agents view is
a list of the project's previous sessions, so in an empty project there is nothing to open and the
test presses keys at a state no user is ever in.

```bash
THRONG_CLAUDE_E2E=1 THRONG_CLAUDE_E2E_ROOT="D:\path\to\a\real\project"   npx playwright test packages/ui/tests/e2e/terminal-claude-keys.e2e.ts --workers=1
```

The project is never deleted: cleanup refuses to remove anything outside the temp area.

## `THRONG_INPUT_SOAK` — the keystroke soak

A dropped keystroke is a race, and a race that survives one attempt is not fixed — it is unobserved.
`terminal-input-idle.e2e.ts` proves the mechanism in one press, which is what a fence run on every
push should cost; the soak asks the other question, whether it holds fifty times in a row in every
shell. Fifty click-and-type rounds across four shells takes minutes, so it is opt-in.

```bash
THRONG_INPUT_SOAK=1 npx playwright test packages/ui/tests/e2e/terminal-input-soak.e2e.ts
THRONG_INPUT_SOAK=1 THRONG_INPUT_SOAK_REPS=10 …     # a shorter run while iterating
```

`THRONG_INPUT_SOAK_REPS` defaults to 50. The run prints its repetition count and flavours, so a green
tick cannot be mistaken for a soak that silently did nothing.

## Two tiers: `THRONG_E2E_TIER`

`npm run test:e2e` runs the suite in **two passes** — the parallel tier at several
workers, then the serial tier at one. `THRONG_E2E_TIER=parallel|serial` selects a
tier by itself, and composes with `THRONG_E2E_GROUP`.

Measured on this suite (214 spec files, 658 tests):

| | files | tests | time |
| --- | --- | --- | --- |
| parallel tier, 6 workers | 115 | 296 | **4.7 min** |
| serial tier, 1 worker | 99 | 362 | 20.0 min |
| whole suite, 1 worker (previous arrangement) | 214 | 658 | ~35 min |

**The serial tier holds more tests than the parallel one**, which is why the total
lands around 21 minutes rather than something dramatic. Menu and preferences specs
are test-dense, and they are exactly the ones that cannot share a desktop.

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

`shard-plan.test.ts` guards the boundary, and the guard that matters fails the
build when a spec in the **parallel** tier grows a context menu or a preferences
window. Without it the boundary rots silently, and the symptom is some unrelated
test flaking because its menu closed.

### Why CI is arranged differently

CI keeps **one worker per shard** and does not use tiers. Focus contention is
per-desktop, so workers are the lever within a machine and shards are the lever
across machines — and CI already has three machines. Raising workers there was
measured reintroducing RPC-budget timeouts, launch-SLA misses and EPERM teardown
races on a 4-vCPU runner (see `ci.yml`), which is the CPU mechanism above, not the
focus one. Tiers only help if you run more than one worker, so they buy CI nothing
that would not cost it that. The CI lever is the fixed per-shard `npm ci` + build
toll instead — issue #103.

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
default (`npm run test` runs unit → integration → contract → e2e in order).

**Elevated runners are capped to 2 workers** (unless `THRONG_E2E_WORKERS` is set).
An elevated daemon routes terminals through the de-elevated agent (FR-025c), which
— with slower app/watcher teardown under contention — isn't robust at high
parallelism, so 6 elevated workers flake. A normal (non-elevated) shell keeps the
full 6. Force a count with `THRONG_E2E_WORKERS=6` (accepting elevated flakiness),
or — better — **run the suite from a non-elevated shell** for full-speed, stable runs.

**CI is not the non-elevated case.** GitHub's Windows runners run as administrator,
so CI is an *elevated* run and pins `THRONG_E2E_WORKERS: 1` explicitly rather than
taking either default. Don't read a CI worker count or a CI green bar as evidence
about the non-elevated path — see below for what CI does and does not cover.

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

The elevated `@admin` E2E (run-as-admin / de-elevation) are separate; run them
locally with `npm run test:e2e:admin` from an elevated shell. The normal suite
**excludes** `@admin` specs (config `grepInvert`), so an elevated dev machine doesn't
run them here; a runner sets `THRONG_E2E_INCLUDE_ADMIN` to opt back in.

**CI runs the `@admin` suite** in its own job (`E2E (@admin, elevated)`), which sets
`THRONG_E2E_INCLUDE_ADMIN=1` and calls `npx playwright test` directly — never
`npm run test:e2e:admin`, which exists to hop UAC from a non-elevated shell and is
both pointless and interactive where the process is already elevated. It is a job
rather than a step inside `e2e` because the shards split the suite by file: an
`@admin` step there would run three times, or — if no `@admin` file landed on that
shard — not at all. One job, one run, one signal. Until that job
existed, `@admin` specs were excluded from the *only* runner capable of running
them, and the gap read as covered because a comment claimed a dedicated runner that
did not exist.

## Run the suite non-elevated

The terminal E2E assume a **non-elevated (normal-integrity) daemon** — the common
case for a user, but **not** how CI runs (CI is elevated; see above). A non-elevated
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
green. Every E2E shard prints the remaining count on each run, so the number stays visible instead
of being rediscovered.

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

`scripts/run-deelevated.ps1` is kept for a **self-hosted runner with UAC enabled**,
where it should work. It probes each strategy before use, so an environment that
cannot drop rights fails in about 30 seconds with a clear message rather than
consuming a full E2E run — and it never silently falls back to running elevated,
because a suite that looks like it ran while verifying nothing is the failure this
whole area exists to prevent. `THRONG_DEELEVATE_FORCE=1` exercises it from an
ordinary shell.

## One app per file, not one per test

Every `runApp()` is an Electron launch, a daemon and (for terminal specs) a real shell — about two
seconds on CI, and the suite once paid it 604 times for 634 tests. Most of that bought nothing.

A launch is only genuinely needed when a test **seeds state before the app starts**: a config root
with themes in it, a pre-populated database, `skipDaemon`. Those keep their own app. Everything else
can share one:

```ts
import { openApp, runApp as runOwnApp, type OpenApp } from './harness.js';

test.describe.configure({ mode: 'serial' });
let shared: OpenApp;
test.beforeAll(async () => { shared = await openApp(); });
test.afterAll(async () => { await shared?.close(); });
```

Serial mode is not optional: the tests share a window and a database, so they must not interleave,
and a failure should skip the rest rather than run them against whatever it left behind.

Two rules learned the hard way:

- **Never let a shared-app shim accept launch options.** Dropping a seeded config root does not fail
  a test, it makes it pass for the wrong reason — measured once, where a swallowed
  `editor.openOnClick: 'double'` let a single click open the file and the assertion saw 2 opens where
  it expected 0. A test needing options calls `runOwnApp`.
- **Give shared projects unique names.** Projects accumulate in a shared app, and fifteen called
  "Demo" make `.project-item` ambiguous.

Not every file can do this, and that is fine. Of 54 candidates, 34 converted and 20 were reverted
because their assertions genuinely depend on a pristine app — panels and projects accumulate, and
"the panel shows its new title" then finds the previous test's panel. **Convert one file at a time
and run it**; that is the only way to tell which kind you have. `explorer.e2e.ts` went from 46s to
12.8s this way.

## A flaky test FAILS the run

**A green run means every test passed on its FIRST attempt.** `failOnFlakyTests` is set in
`playwright.config.ts`, so a test that fails and then passes on retry turns the run **red**.

`retries` still default to **2** — but for their *diagnostic* value, not their absolving value. A
retry captures the first failure's assertion, diff and trace, which is genuinely useful. What it may
never do is convert a failure into a pass.

This reverses the old policy, which said retries should *absorb* load-transient failures. That policy
was measurably wrong: a run with retries disabled found **ten** tests failing on their first attempt
and being reported green. A suite that retries until it passes does not produce a green suite — it
produces a green *run*, of a suite that is still broken, and somebody will trust that bar.

The constitution (Principle V, v3.14.0) already said so: a test that fails and then passes with no
code change is *"flaky, not fixed"* and must never be *"absorbed into a green bar by repetition"*.
Nothing enforced it until feature 017.

The accepted cost: a genuinely transient infrastructure fault now fails a run. The remedy is to fix
the test or quarantine it — never to relax the gate.

Set `THRONG_E2E_RETRIES=0` to see raw first-run results with no diagnostic retry at all.

### Writing a test that does not flake

Two helpers in `packages/ui/tests/e2e/harness.ts` exist to close the race class that produced most of
the flakes we found. Use them:

- **`settle(win, root?)`** — a POSITIVE assertion that the window has rendered. Make it the first
  statement of any test that later reads raw state. A *negative* opening assertion
  (`await expect(x).toHaveCount(0)`) is satisfied vacuously by a DOM that has not rendered anything:
  it looks like a wait and settles nothing. (The Preferences window's root is `.prefs-root`.)
- **`geom(locator)`** — element geometry, polled until the element **stops moving**. Never reach
  through `page.evaluate` to `querySelector(...).getBoundingClientRect()`: that read does not wait
  for the element to exist *or* to stop animating, and both failures look like flakiness rather than
  like the broken read they are.
- **`viewport(win)`** — window dimensions, for measuring a control against the window edge.

Prefer an assertion on a real condition (`toBeVisible`, `toHaveCount`, `expect.poll`) over
`waitForTimeout(n)`. A sleep asserts that *n* milliseconds is always enough; a condition asserts that
the thing you are about to measure has actually happened.

## Quarantine

A test that genuinely cannot be made deterministic is tagged **`@quarantine`** and excluded from the
default run. It is **not** deleted and **not** `test.skip`-ped, because lost coverage must stay
*visible* — you have to be able to answer "what are we not testing?" with a command:

```bash
THRONG_E2E_INCLUDE_QUARANTINE=1 npx playwright test --grep @quarantine --list
```

(A bare `--grep @quarantine` lists nothing: a CLI `--grep` does not clear a config `grepInvert`.)

Every quarantined test carries a written justification in
`specs/017-icon-tooltip-flake-fixes/e2e-audit.md`.

**A quarantine is not an environment guard.** `@admin` / `skipIfElevated()` skip a test because the
environment *cannot run it*, and its coverage lives elsewhere — a dedicated elevated runner verifies
it for real. Quarantine means the coverage lives **nowhere**. One routes coverage; the other admits
defeat. Only the second needs counting.

## Temp files

Every test scratches to `os.tmpdir()`. For a run, all of that is consolidated
under a single folder:

```
%TEMP%/throng_e2e_<runhash>/
   throng-e2e-XXXXXX/     (one per app launch)
   throng-ud-XXXXXX/      (per-launch Electron user-data)
   throng-cfg-XXXXXX/     (per-launch config root)
   throng-<layer>-XXXXXX/ (integration/contract scratch)
   ...
```

`scripts/run-tests.mjs` generates one `<runhash>` at the start of `npm run test`
and points `TEMP`/`TMP`/`TMPDIR` at the folder, so **all four layers and all
their workers** land in the *same* parent. Running a single layer directly (e.g.
`npm run test:e2e`) falls back to a per-invocation folder via the runner's
globalSetup, so the one-parent invariant always holds.

**Lifecycle.** Per-test cleanup is unchanged — the E2E harness / helpers still
remove each sub-dir as its test finishes (Constitution Principle V). When the run
finishes normally and the folder is empty, the owner removes the parent too, so a
clean run leaves nothing behind. If a test **crashes or hangs** before its own
cleanup runs, the owner's teardown is skipped (or finds the folder non-empty) and
the parent is **kept**, with its path printed — so you can inspect exactly what
the failing run left behind.
