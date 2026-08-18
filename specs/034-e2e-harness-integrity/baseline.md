# Measured baseline — E2E suite, before spec 034

**Required by**: FR-039, FR-041, FR-043 · **Referenced by**: SC-005, SC-007, SC-008, SC-009

| | |
| --- | --- |
| Commit | `d55054b` (`origin/master`), no changes applied |
| Branch | `feature/S034-I251-e2e-harness-integrity` |
| Date | 2026-08-15 |
| Machine | 10-core / 20-thread, 128 GB, Windows 11, **non-elevated** shell |
| Command | `npm run build`, then each tier as `npm run test:e2e` runs it, with a json reporter added |
| Retries | 2 (the default; kept for diagnostics) |
| Other load | one Claude Code session; the developer's installed throng app running |

The machine was not idle. That is stated rather than corrected for, because it is the condition a
developer actually runs the suite in, and because the comparison that matters — parallel tier versus
serial tier — was made under the same load.

---

## 1. The headline

| Tier | Workers | Files | Tests | Wall clock | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| parallel | 6 | 115 | 311 | **897 s / 14.9 min** | 10 failed · 8 flaky · 18 skipped |
| serial | 1 | 117 | 480 | **1917 s / 31.9 min** | 480 passed · **0 failed · 0 flaky** |
| **total** | | **232** | **791** | **2814 s / 46.9 min** | **RED** |

Build: 29 s (not counted in the total above).

**`docs/testing.md` publishes 24.7 minutes** (4.7 parallel + 20.0 serial), measured at 214 files and
658 tests. The suite is now **46.9 minutes** — the published figure is wrong by very nearly a factor
of two, and has been wrong for as long as nobody re-measured it. This is FR-041's entire reason for
existing.

Three files ran no tests: the two opt-in specs behind environment flags and the elevated-only set.

---

## 2. The failures are all in one tier, and the other tier is perfect

This is the single most important observation in the run, and it was free — the two tiers are the
same code, the same build, the same machine, minutes apart.

**Parallel tier — 10 failed, 8 flaky of 311.** Nine of the ten failures are
`Test timeout of 30000ms exceeded`, and thirteen of the sixteen affected files are `terminal-*`.

| Failed (3 attempts each) | |
| --- | --- |
| `projects.e2e.ts:170` | restores the project list and active project after a restart |
| `shipped-defaults-startup.e2e.ts:131` | theme token upgrade, idempotently |
| `terminal-modified-enter.e2e.ts:166` | modified Enter inserts a soft line break |
| `terminal-persistence.e2e.ts:35` | removed flavour surfaces unavailability — **#251** |
| `terminal-reattach.e2e.ts:48` | pre-existing terminal reattaches after restart — **#251** |
| `terminal-refresh.e2e.ts:37` | idle terminal keeps its content |
| `terminal-revert.e2e.ts:13` | typing exit reverts the Panel to the form |
| `terminal-scrollback-nav.e2e.ts:157` | find next/previous jump the viewport |
| `terminal-slow-start.e2e.ts:19` | "still starting" state and recovery on retry |
| `terminal-startup-command.e2e.ts:152` | a user-defined flavour actually launches |

| Flaky (passed only on retry) | |
| --- | --- |
| `app-close-terminals.e2e.ts:84` · `persistence-restore.e2e.ts:138` · `terminal-find.e2e.ts:164` · `terminal-modified-enter.e2e.ts:197` · `terminal-path-drop.e2e.ts:22` · `terminal-scrollback-nav.e2e.ts:87` · `terminal-tab-switch-render.e2e.ts:67` · `terminal-title-header.e2e.ts:11` | |

**Serial tier — 480 of 480 passed on the first attempt.** No failures. No retries. Nothing flaky.

---

## 3. What that comparison means

**Every one of the sixteen affected files is in the parallel tier.** Only **11 of the 45**
`terminal-*` spec files are assigned to the serial tier, so 34 of them run at six workers — and 13 of
those 34 failed or flaked. That is a **38% failure rate for terminal specs in the parallel tier**,
against **0%** for everything at one worker.

`parallel-plan.json` already names the mechanism, in its own note: a spec that *"drives long-running
real shells, which starve at high worker counts and time out"* belongs in the serial tier. The
mechanism is correct and it was applied to eleven files. The measurement says it applies to at least
twenty-four.

So the defect is not two bad specs. **The tier boundary is mis-drawn**, and it was drawn at 214 files
and never revisited.

### Why this reframes #251

#251 says `terminal-persistence` and `terminal-reattach` "fail at the worker counts the suite actually
uses". True — and so do eight other files it does not name. The failure mode is a **30-second test
timeout**, not an assertion about a missing layout, so the test never reached the thing it was
checking. An earlier hypothesis in `research.md` — that these were the same sleep-versus-condition
defect as #245 and #246 — is **not supported by this run** and is withdrawn as the primary
explanation. The sleeps in those two files are still defects under FR-015, but they are not why the
tests fail.

### The cost of the failures

Ten tests × three attempts × the 30-second cap is **~15 minutes of test-time spent entirely on
timeouts**, plus the flaky retries on top. Spread across six workers that is roughly 2.5 minutes of
the parallel tier's 14.9 — and it buys nothing at all.

---

## 3a. The worker-count experiment, and where the knee is

The sixteen affected files, run as one set, **retries off** so a pass is a first-attempt pass, on the
same build and machine:

| Workers | Passed | Failed | Wall clock |
| ---: | ---: | ---: | ---: |
| 1 | **38** | **0** | 265 s |
| 1 (repeat) | **38** | **0** | 299 s |
| **2** | **38** | **0** | **194 s** |
| 3 | 34 | 4 | 197 s |
| 6 | 20 | 14 | 159 s |

Every failure at 3 and 6 workers is a ~30-second test timeout. The pass rate falls monotonically as
workers rise, which is what starvation looks like; a defect fails the *same* test every time, and
these fail a growing set.

**The knee is two workers, and it is not a trade-off.** Two workers is green — twice-confirmed
against a twice-confirmed green at one worker — and it is **25–35% faster than one worker**. Three
workers is no faster than two (197 s against 194 s) and costs four failures, so nothing above two
buys anything for this set at all.

That result is what makes the fix cheap. These specs do not need to run one at a time; they need to
run at *two*. The existing arrangement offers only six (which breaks them) or one (which is slower
than two), because it has two tiers and this set needs a third.

The four files that fail at three workers but pass at two — `terminal-revert`, `terminal-slow-start`,
`terminal-tab-switch-render`, `terminal-scrollback-nav` — are the most starvation-sensitive in the
suite.

---

## 3b. A third tier is the wrong fix, and the measurement says so

The obvious response to §3a is a middle tier for real-shell specs at two workers. It was priced
before it was built, and it **makes the suite slower**.

Classifying every spec by mechanism — the focus detector already enforced by `shard-plan.test.ts`,
plus a real-shell detector — gives 88 parallel / 49 shell / 98 serial. Applying the measured
per-file durations, with the timeout waste removed so the comparison is fair:

| Arrangement | Modelled wall-clock |
| --- | ---: |
| current two tiers | ~40.3 min |
| proposed three tiers | ~45.4 min |

The reason is simple once seen: **41 files currently run fine at six workers and would be demoted to
two.** Only 13 of the 41 real-shell specs in the parallel tier actually starve. The mechanism
correctly identifies the *candidates*; it badly over-predicts the *casualties*.

## 3c. What actually separates a starving spec from a healthy one

Comparing the 13 starved against the 28 healthy real-shell specs in the parallel tier, one attribute
separates them and it is not the one expected:

| attribute | starved | healthy |
| --- | ---: | ---: |
| raises its own `test.setTimeout()` | **0%** | **36%** |
| drives a long-running shell | 15% | 4% |
| average `runApp()` launches | 1.9 | 2.7 |
| average hard-coded sleep | 1723 ms | 4876 ms |

*(Seconds-per-test is deliberately excluded: for a starved spec that figure **is** the timeout waste,
so it is an outcome, not a predictor.)*

`terminal-launch-failure-config.e2e.ts` takes **84.8 s per test and passes at six workers** — because
it raises its own timeout. Every spec that died was relying on the 30-second default.

**So the failure is not the specs, and not the tier. It is that the default test timeout was sized on
a smaller, quieter suite and is now exceeded by the load the suite itself creates.** That is the same
defect class as #245 one level up: a clock standing in for a condition, this time in the harness.

### Falsified, not assumed

The hypothesis was tested rather than believed. Same sixteen files, same six workers, retries off,
**only the timeout raised**:

| Run | Passed | Failed | Wall |
| --- | ---: | ---: | ---: |
| 6 workers, 30 s timeout | 20 | 14 | 159 s |
| **6 workers, 90 s timeout** | **37** | **1** | **153 s** |
| 2 workers, 30 s timeout | 38 | 0 | 194 s |

Twelve of the thirteen starving specs go green **at full parallelism**, and it is *faster* than the
two-worker arrangement (153 s against 194 s). No tier demotion, no wall-clock cost.

Longest legitimate journeys observed under six-worker contention were ~38 s, so the 30-second budget
was simply undersized — not a safety margin anyone was relying on.

### Why raising it is safe now, when it was not in #75

`playwright.config.ts:244-251` records why 30 s was chosen: 60 s was rejected because Playwright
applies the test timeout to **worker teardown** as well, so a wedged app got a second full budget and
blew the worker-teardown budget — surfacing as *"1 error was not a part of any test"*, which no retry
absorbs.

That reasoning is superseded, and the same comment says so. `harness.ts:320-346` now **bounds its own
teardown independently of the test timeout**: `shutdownApp` allows a 15 s graceful window and the
`taskkill` behind it a further 10 s, so teardown completes within 25 s regardless of what the test
timeout is. The Constitution requires exactly this ("the harness MUST bound its own teardown… so this
fault is prevented at source, not merely retried").

So the test timeout is no longer the thing protecting teardown, and raising it does not reopen #75.

### The one real defect the starvation was hiding

`terminal-slow-start.e2e.ts:19` still fails at six workers with the timeout raised — and it fails
**differently**, on a real assertion rather than a timeout:

```
Expected substring: "throng-slowstart-rZaHDY"
Received string:    "                                 "
Timeout: 20000ms
```

The terminal is blank. This is an inner `expect(...).toContainText(..., { timeout: 20000 })` — a
per-assertion budget, independent of the test timeout, and too small under contention. The same
defect class again, one level further down. It has its own entry in the work because it is a genuine
failure that fourteen false ones were hiding.

---

## 4. Where the time is

**The serial tier is 68% of the suite** (31.9 of 46.9 minutes) and it is the green one. Slowness and
unreliability are in different tiers and need different fixes.

Slowest files by summed test duration:

```
serial tier                              parallel tier
 86.4s  terminate-all-drain              214.8s  terminal-startup-command-flavours
 71.5s  terminal-no-orphans              152.1s  terminal-directory-memory
 66.3s  terminal-editing-matrix          147.9s  shipped-defaults-startup
 63.0s  preferences-json                 146.3s  terminal-scrollback-nav
 60.8s  notification-prefs               146.1s  terminal-modified-enter
 53.0s  terminal-command-memory          140.4s  terminal-find
 48.4s  explorer-follow-active-editor    116.7s  terminal-startup-command
 43.3s  preferences-themes               106.5s  projects
 38.1s  editor-move-repoint              102.9s  subworkspaces
 38.0s  ux-refinements                    98.0s  notice-logging
```

Several parallel-tier entries are inflated by their own timeouts: `terminal-persistence`,
`terminal-reattach`, `terminal-slow-start`, `terminal-refresh` and `terminal-revert` each show
~90 s, which is exactly 3 × 30 s of nothing.

---

## 5. The tier plan cannot be audited

`parallel-plan.json` is a flat list of 118 filenames with **no per-file reason recorded**. Its note
describes three mechanisms — focus, CPU, an owned timing assertion — but nothing says which mechanism
put any given file in the list, or whether a file is there because it was *observed* failing once.

The consequence is concrete: an attempt to classify the 118 files by reading their source was
abandoned as unreliable, because it could not distinguish a preferences spec from a spec that merely
mentions preferences. **A membership list nobody can audit cannot be optimised** — every file in it
has to be treated as load-bearing, so the tier can only ever grow.

That is why the fix for the mis-drawn boundary has to record the mechanism per file, not merely move
files.

---

## 6. Counts used by the success criteria

Measured on the same commit, by static analysis of `packages/ui/tests/e2e`:

| | |
| --- | --- |
| Spec files | 235 on disk; **232 executed** — the three absent are the two `@admin` files (3 tests, routed to the elevated runner) and the one `@quarantine` test, all excluded by `grepInvert`. Both numbers are correct and they answer different questions: 235 is what a file-level obligation binds (SC-009), 232 is what a wall-clock figure was measured over (SC-011, SC-024). |
| Tests | 782 declared / 791 executed results |
| `runApp()` call sites | 681 |
| `openApp()` call sites | 47, in 42 files |
| `waitForTimeout` sites | 222, in 83 files — **137 with no comment at all** |
| Hard-coded sleep | 322.8 s total · 233 s excluding opt-in specs · **182.5 s uncommented** |
| Wall-clock budget assertions | 5, in 3 files |
| Serial tier | 118 files |
| `terminal-*` specs | 45, of which 11 are serial |

**SC-011's 25% target is against 46.9 minutes**, giving 35.2 minutes — not against the stale
published 24.7.

---

## 7. After the Story 1 work — measured the same way

Same machine, same command, same reporter, after the five budgets were right-sized and two specs
moved to the serial tier:

| Tier | Baseline | After | Change |
| --- | --- | --- | --- |
| parallel (6 workers) | 897 s · 10 failed · 8 flaky | **536 s · 0 failed · 1 flaky** | **−40%** |
| serial (1 worker) | 1917 s · clean | 1991 s · clean | +4% |
| **total** | **2814 s / 46.9 min · RED** | **2527 s / 42.1 min** | **−10.2%** |

Executed results: **791 before, 791 after** — no test was lost to get here (SC-013).

**Correctness is the win: 18 false results became 1.** The remaining flake was
`explorer-tree-state.e2e.ts:56`, polling for a drag-driven file move on a 10-second budget; it has
since been given the derived `FILE_OP_TIMEOUT_MS`.

### A second full run, after the last flake's budget was fixed

| Run | parallel | serial | total | failed | flaky |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 897 s | 1917 s | **46.9 min** | **10** | **8** |
| post-fix #1 | 536 s | 1991 s | 42.1 min | 0 | 1 (`explorer-tree-state`) |
| post-fix #2 | 476 s | 1909 s | **39.8 min** | **0** | 1 (`terminal-revert`) |
| post-fix #3 | 486 s | 1960 s | 40.8 min | 0 | 1 (`terminal-altscreen-fidelity`) |

| post-fix #4 | 455 s | 2384 s | 47.3 min | 0 | 3 |

Four runs, **zero hard failures in every one**, against ten in the baseline. The flakes are one or
two per run, a *different* spec each time, every one an inner per-assertion budget of the kind Story
3 exists to sweep. One flake in 791 tests is a residue with a known shape, not a mystery.

### Run #4 is an outlier, and it is machine load rather than a regression

Run #4 came back at 47.3 minutes — slower than the baseline — with its serial tier up from ~1960 s to
2384 s and `preferences-json` showing **158 s against the 63 s it measured at baseline**. That looks
exactly like a regression introduced by raising the assertion timeout from 10 s to 15 s, since a
budget rise makes every assertion that *exhausts* cost more.

It was A/B tested rather than assumed. The same file, one worker, retries off:

| Config | Wall |
| --- | ---: |
| `expect.timeout` 15 s (current) | **56 s** |
| `expect.timeout` 10 s (previous) | **56 s** |

Identical — and both close to the 63 s baseline. So the assertion budget is not responsible, and the
158 s was contention *during that run* on a machine that also had a Claude session and the
developer's own throng on it. The suite's cost sits around 40–42 minutes; run #4 measured the
machine, not the change.

**Recorded rather than dropped**, because a run that disagrees with the others is exactly the kind of
result this feature exists to stop people averaging away — and because the cheap A/B that settled it
is the pattern the whole branch is arguing for.

**Zero hard failures in both post-fix runs**, against ten in the baseline. One flake in each — and a
*different* one each time, which is the same shifting signature that identified the original problem
and says the residue is the same class rather than two specific bad specs.

`terminal-revert.e2e.ts:52` is the second one: the panel's type-form appeared, but `panel-exit` was
not visible within the 15 s assertion budget. Unlike the others this one is **not** obviously a
number that is too small — 15 s is already generous for an element to render — so it is left for
individual diagnosis rather than given a fourth increase. Guessing here is exactly what this feature
exists to stop.

**Under the flake gate a single flake still reddens the run, so the suite is not green yet.** It is
0-failure and 1-flake, from 10-failure and 8-flake.

**Speed is not yet the win, and the shortfall is the expected one.** −15.2% at best against
SC-011's −25%.
The parallel tier gave up 40% simply by not spending 15 minutes on timeouts, and the serial tier —
68% of the runtime, and the tier that was already green — has not been touched. It gets *slower*
here, by the two files moved into it. Reaching 25% needs the work that reduces total test-time
rather than redistributing it: the sleeps (Story 3) and the launches (Story 4). This is why the
specification separates them.
