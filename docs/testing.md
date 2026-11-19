[throng](../README.md) › [Docs](README.md) › Testing

# Testing

throng has five test layers. This page says which one a test belongs at, how to run each, and what
establishes that work is done. How to run tests *in practice* — without leaving processes behind,
without saturating the machine, and how to diagnose a flake — lives in the
[`throng-testing` skill](../.claude/skills/throng-testing/SKILL.md) and its
[references](#where-the-detail-lives).

| Script | Layer | Runner | Parallelism |
| --- | --- | --- | --- |
| `npm run test:unit` | unit | Vitest (`--project unit`, `--project unit-isolated`) | parallel; `unit` shares one module registry per worker |
| `npm run test:component` | component | Vitest (`--project component`, jsdom) | parallel (`vmThreads`: one VM context per file) |
| `npm run test:integration` | integration | Vitest (`--project integration`) | **serial** (`fileParallelism: false`) |
| `npm run test:contract` | contract | Vitest (`--project contract`) | **serial** (`fileParallelism: false`) |
| `npm run test:e2e` | E2E | Playwright-Electron | two tiers; runs on CI, not a workstation |

`npm run test` runs all five through `scripts/run-tests.mjs`, scratching everything under one
temporary folder per run ([temp files](../.claude/skills/throng-testing/references/temp-files.md)).

A unit file that mocks a module, stubs a global or spies on an export runs in `unit-isolated`, with
its own module registry; `vitest.config.ts` finds those files by reading them, so nothing is listed
by hand. Every other unit file shares its worker's registry with the files before it, so a unit test
must leave module state and globals as it found them.

Tests tagged `regression` mark soaks, repeated rounds and performance budgets; tag one with
`{ tags: ['regression'] }` on the `it` or `describe`. Integration files tagged `critical-path` are the
subset pull-request CI runs (at most 15, guarded by `integration-subset.test.ts`).

The integration and contract layers spawn real OS processes (node-pty shells, directory-lock
holders) and **can only run one file at a time** — concurrent spawning hits the Windows
"AttachConsole failed" limit under load. That is why they set `fileParallelism: false`; do not
parallelise them.

## Which layer a test belongs at

**The lowest one that can actually show the behaviour.** Constitution Principle V makes that a rule
rather than a preference.

| Layer | What it is for | The give-away |
| --- | --- | --- |
| unit | pure functions, reducers, validation, formatting, path handling | it takes values and returns values |
| component | a React component's rendered markup and its keyboard/pointer behaviour | it takes props and draws something |
| integration | two real subsystems meeting — the daemon, the database, the config store | it needs a real process or a real file |
| contract | a message shape crossing a boundary | it is about an interface, not a behaviour |
| E2E | what only a real window can show | it is in the reserve below |

**E2E is reserved** for what no lower layer can observe: window lifecycle; focus and z-order; native
menus; OS drag-and-drop; PTY fidelity and process-tree hygiene; real keyboard and input dispatch; and
real layout and text rendering. Before adding an E2E, answer in one sentence what a lower layer would
be unable to see. Replacing or deleting an E2E has its own rule — the lower-layer replacement is
written first and observed failing — and each E2E names its reserve entry with a `@reserve:*` tag;
both are in [the E2E reserve and its tags](../.claude/skills/throng-testing/references/e2e-reserve-and-tags.md).

## Running tests

While iterating, run the tests under your cursor — one file, one project:

```bash
npm run test:unit -- packages/core/tests/unit/<the-one>.test.ts
```

**E2E runs on CI, in the full pipeline** (`pipeline.yml`): nightly, on dispatch, and inside every release.
No E2E runs on a pull request. Do not run the E2E suite, a tier or a batch of specs locally before pushing. At most,
run the one spec covering your change, at one worker, when a lower layer cannot show the failure:

```bash
npx playwright test packages/ui/tests/e2e/<spec>.e2e.ts --workers=1
```

Pass an E2E spec by its full path **with** the `.e2e.ts` suffix: a bare stem silently selects the
whole suite. `npx playwright test <filter> --list | tail -1` checks a filter without launching
anything.

E2E runs open **real, on-screen windows** — there is no headless mode
([why](../.claude/skills/throng-testing/references/no-headless.md)).

The full suites — `npm run gate`, `npm run test:e2e` and a `vitest run --project <p>` with no path —
are not run on a workstation: they pin every core for most of an hour. Where each kind of run is
allowed to happen, and the loop that goes with it, is *Where a test is allowed to run* in the
[`throng-testing` skill](../.claude/skills/throng-testing/SKILL.md#where-a-test-is-allowed-to-run).
The environment variables that tune a run (tier, workers, retries, opt-in suites) are listed in
[`environment.md`](environment.md).

## The three pipelines

| Workflow | Runs on | What it runs | Fails fast |
| --- | --- | --- | --- |
| `ci.yml` | every push to a pull request, drafts included | lint and type-check, unit, component, contract and the `critical-path` integration subset, on Linux, in parallel; one `CI verdict` check. A pull request that changes only files no job reads (the list is in `scripts/ci-changes.mjs`) skips them, and its verdict passes | no: every job runs to completion |
| `pipeline.yml` | nightly on master, and on dispatch | every layer on Windows, Linux and macOS, every E2E test sharded per platform, `@admin`, calibration, and every artifact built and verified; publishes nothing | dispatch: yes; nightly: no, it reports every failure on one issue |
| `release.yml` | a pushed `v*` tag only | the full pipeline, then signing, publishing and the package repositories | yes |

Nothing runs on a push to master. A change that is Windows- or macOS-specific gets a `pipeline.yml`
dispatch for that platform before it merges, because pull-request CI cannot see it.

## The full pipeline — what says the work is done

A green full `pipeline.yml` run on the commit is what establishes done-ness. Dispatch it against a
pushed ref:

```bash
gh workflow run pipeline.yml --ref <branch>
gh run watch <run-id> --exit-status       # one blocking watch
gh run view <run-id> --json status,conclusion --jq '"\(.status)/\(.conclusion)"'
```

Take the verdict from `gh run view`, not from the watch's exit code, and quote the run URL and the SHA
when reporting done. A failed dispatch concludes `cancelled`: its first failing job dispatches `fail-fast.yml`,
which cancels the rest once that job has finished, so the failed job is the one whose own conclusion is `failure`. Its inputs select what runs — `stages`, `platforms`, `e2e_filter`,
`test_filter`, `shards`, `stress_spec` / `stress_grep` / `stress_rounds` to repeat one test with
retries off, and `run_to_completion` to let every job and test finish, as the nightly does, so one run shows every
failure — and the run's name says whether it was `pipeline (full)` or partial. The inputs and what
each guarantees are in [the gate in detail](../.claude/skills/throng-testing/references/gate.md).

`npm run gate` is the same stages in one process, **fail-fast**: **lint → typecheck → build → unit →
component → integration → contract → e2e**. It pins every core for most of an hour, so it is not run
on a workstation.

## On Linux

The full pipeline runs every layer on Ubuntu 24.04 too. E2E there runs on a real X display with a
window manager (`scripts/ci-linux-display.sh`). A test asserting one platform's behaviour says so
with `skipUnlessWindows(reason)` or `skipUnlessLinux(reason)` from `@throng/core/testing`, and the
reason is required. Pull-request CI runs on Linux.

## On macOS

The full pipeline runs every layer on hosted Apple silicon runners too, on the current and the
previous macOS release named in `.github/macos-runners.json`, and `skipUnlessMacos(reason)` marks a
test about macOS itself. These runs are the whole of throng's macOS testing; no step needs a Mac by
hand ([macOS](macos.md#not-checked-by-the-automated-tests) lists what they cannot show). Typing latency
is the one SLA asserted on CI, on macOS only: the pipeline's typing-latency job runs the terminal load
measurement with `THRONG_MEASURE_ASSERT_P95_MS=100`.

## Significance: `@core` and `@extended`

Every E2E test carries exactly one significance tag and at least one category tag, and
`packages/ui/tests/unit/e2e-tags.test.ts` fails the build for one that carries neither.

| Tag | Means |
| --- | --- |
| `@core` | a critical journey: `e2e_filter=@core` on a dispatch runs these alone |
| `@extended` | a regression check |

Both run in every full pipeline run; neither runs on a pull request.

Category tags — `@boot @terminal @editor @explorer @prefs @window @persistence @failure` — say what a
test is about, so a failure names an area before anyone opens the file. `@admin` (needs elevation)
and `@quarantine` (excluded, coverage lost) are environment tags and orthogonal to both. Selection is
by `--grep` composed with `grepInvert` in `playwright.config.ts`; the guard keeps every test
classified.

`npm run test:e2e` — the E2E stage of the gate and of each pipeline shard — runs the suite in two tiers: a parallel tier, then a
serial tier at one worker for specs that steal focus, drive real shells or assert wall-clock
ceilings. A spec in that class is registered in `packages/ui/tests/e2e/parallel-plan.json`, and
`tier-plan.test.ts` fails the build if it is not. The tiers and worker counts are in
[tiers and workers](../.claude/skills/throng-testing/references/tiers-and-workers.md).

## The budget ratchet

`packages/ui/tests/e2e/e2e-budget.json` records how many E2E declarations the suite holds, in total,
per category and in `@core`. It fails when the suite grows past the budget **and** when it drops
below it without the budget being re-seeded — so re-seed it in the same commit that removes a test.
The second half does the work: it stops a migration quietly banking a reduction and then spending
it again. `reserve-tag-debt.json` is the same both-ways ratchet for tests that do not yet name a
reserve entry. How a new declaration is paid for is *Paying for a new declaration* in
[the E2E reserve and its tags](../.claude/skills/throng-testing/references/e2e-reserve-and-tags.md).

## Where a performance SLA is measured

A wall-clock SLA is asserted only on reference hardware — one worker, not CI, and
`THRONG_NON_REFERENCE_HARDWARE` unset — and is otherwise recorded as an `sla-not-measured` annotation,
never relaxed. The helper is `expectWithinSla` (`packages/ui/tests/e2e/helpers/sla.ts`); the rule, the
SLAs under it, and how to take a reading deliberately are in
[performance SLAs](../.claude/skills/throng-testing/references/performance-sla.md).

What a window pays for terminals it is not showing is measured, not asserted, by
`packages/ui/tests/measure/terminal-load.measure.ts`. It sits outside the E2E lanes and has its own config:
`npx playwright test -c packages/ui/tests/measure/playwright.measure.config.ts`. Its options are the
`THRONG_MEASURE_*` entries in [environment variables](environment.md#testing).

## Writing an E2E

- **Share one app per file** with `openApp()` in `beforeAll` and serial mode; keep a test's own
  launch (`runOwnApp`) only where it seeds state before the app starts — a config root, a database,
  `skipDaemon`.
- **Write a running app's config root through the atomic helper**, `helpers/config-write.ts`.
- **Wait on a real condition**, never a sleep, and use the harness helpers (`settle`, `geom`,
  `focusEditor`, `splitPanelViaMenu`) that close the race classes most flakes came from.
- **A flaky test fails the run.** `failOnFlakyTests` is on, so a test that passes only on retry turns
  the run red; a flake is a bug to reproduce and fix, never to retry away.

The detail behind each is in [writing an E2E](../.claude/skills/throng-testing/references/writing-e2e.md),
[the flaky-test gate](../.claude/skills/throng-testing/references/flakes.md) and
[flake case studies](../.claude/skills/throng-testing/references/flake-case-studies.md).

## Where the detail lives

The [`throng-testing` skill](../.claude/skills/throng-testing/SKILL.md) is how tests are run in
practice. Its references hold the rest, one topic each:

| Topic | Reference |
| --- | --- |
| The E2E reserve, replacing an E2E, `@reserve:*` tags | [e2e-reserve-and-tags.md](../.claude/skills/throng-testing/references/e2e-reserve-and-tags.md) |
| Bridge parity guard, renderer typecheck | [build-guards.md](../.claude/skills/throng-testing/references/build-guards.md) |
| The gate in detail | [gate.md](../.claude/skills/throng-testing/references/gate.md) |
| Performance SLAs | [performance-sla.md](../.claude/skills/throng-testing/references/performance-sla.md) |
| No headless mode | [no-headless.md](../.claude/skills/throng-testing/references/no-headless.md) |
| Test environment variables | [environment-variables.md](../.claude/skills/throng-testing/references/environment-variables.md) |
| E2E tiers, worker counts | [tiers-and-workers.md](../.claude/skills/throng-testing/references/tiers-and-workers.md) |
| Elevation, `@admin`, `skipIfElevated()` | [elevation.md](../.claude/skills/throng-testing/references/elevation.md) |
| Writing an E2E: config writes, one app per file, helpers | [writing-e2e.md](../.claude/skills/throng-testing/references/writing-e2e.md) |
| The flaky-test gate, reproducing a flake | [flakes.md](../.claude/skills/throng-testing/references/flakes.md) |
| Flake case studies | [flake-case-studies.md](../.claude/skills/throng-testing/references/flake-case-studies.md) |
| Budgets — the six clocks | [budgets.md](../.claude/skills/throng-testing/references/budgets.md) |
| Per-file durations, safe filters | [measuring-durations.md](../.claude/skills/throng-testing/references/measuring-durations.md) |
| Quarantine | [quarantine.md](../.claude/skills/throng-testing/references/quarantine.md) |
| Global OS resources (clipboard, shell history) | [global-os-resources.md](../.claude/skills/throng-testing/references/global-os-resources.md) |
| Temp files | [temp-files.md](../.claude/skills/throng-testing/references/temp-files.md) |
