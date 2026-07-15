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

The E2E app runs with **real, on-screen windows** — there is no headless mode.
Electron has no usable headless renderer on Windows, and this app specifically
can't fake one: the inline **xterm.js terminals only mount and drive their ConPTY
in a genuinely visible, painting window**. A hidden (`show: false`), off-screen, or
transparent (`opacity: 0`) window blanks them — the terminal never spawns its PTY
and every terminal spec fails. So windows are shown during E2E. Runs still work
unattended on CI (the runner has a virtual desktop) and locally; expect windows to
appear while a run is in progress.

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
parallelism, so 6 elevated workers flake. CI and a normal (non-elevated) shell keep
the full 6. Force a count with `THRONG_E2E_WORKERS=6` (accepting elevated flakiness),
or — better — **run the suite from a non-elevated shell** for full-speed, stable runs.

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
with `npm run test:e2e:admin` from an elevated shell. The normal suite **excludes**
`@admin` specs (config `grepInvert`), so an elevated dev machine doesn't run them
here; the admin runner sets `THRONG_E2E_INCLUDE_ADMIN` to opt back in.

## Run the suite non-elevated

The terminal E2E assume a **non-elevated (normal-integrity) daemon** — the common
case (and how CI runs). A non-elevated daemon runs each terminal directly, so its
`conhost.exe` is the daemon's own child, the "run as admin" control is disabled,
and re-typing a panel gets a fresh direct PTY. **If you run the suite from an
elevated shell**, the app respawns an elevated daemon (FR-025b) that routes every
terminal through the de-elevated agent (FR-025c) — a different, less parallel-robust
process tree those assertions don't hold for. Such specs call `skipIfElevated()`
(see `packages/ui/tests/e2e/admin.ts`) and **skip when elevated**, so an elevated
run stays green; they still execute on CI / a normal shell. **Prefer a non-elevated
shell for the full E2E run.**

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
