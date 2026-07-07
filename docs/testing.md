# Testing

throng has four test layers, run in order by `npm run test`:

| Script | Layer | Runner | Parallelism |
| --- | --- | --- | --- |
| `npm run test:unit` | unit | Vitest (`--project unit`) | parallel (Vitest default) |
| `npm run test:integration` | integration | Vitest (`--project integration`) | **serial** (`fileParallelism: false`) |
| `npm run test:contract` | contract | Vitest (`--project contract`) | **serial** (`fileParallelism: false`) |
| `npm run test:e2e` | E2E | Playwright-Electron | configurable (see below) |

`npm run test` runs all four through `scripts/run-tests.mjs` (see *Temp files* below).

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

## Flaky-under-load retries

E2E `retries` default to **2**. High worker counts can produce load-transient
failures — a slow Electron close briefly EPERM-locking its userData dir, a 15s
render just exceeded under contention, a ConPTY repaint stressed by many parallel
terminals. Retries absorb those (a genuinely flaky test is reported as `flaky`; a
real bug fails all attempts). Set `THRONG_E2E_RETRIES=0` to see raw first-run
results.

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
