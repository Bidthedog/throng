# Research: E2E Harness Integrity and Speed

**Feature**: [spec.md](./spec.md) · **Branch**: `feature/S034-I251-e2e-harness-integrity`
**Base**: `origin/master` @ `d55054b` · **Date**: 2026-08-15

Everything below is either a **measurement** (stated with the command that produced it) or a
**hypothesis** (labelled as one, with the observation that would confirm or kill it). Nothing here is
a root cause until a reproduction or a probe says so — Constitution, Definition of Done.

---

## 1. Measured baseline of the suite

Taken on this branch's base before any change, from `packages/ui/tests/e2e`:

| Measurement | Value |
| --- | --- |
| Spec files | 235 |
| Tests | 782 |
| `runApp()` call sites | 681 |
| `openApp()` call sites | 47, in 42 files |
| `waitForTimeout` call sites | 222, in 83 files |
| Hard-coded sleep, total | 322.8 s |
| Hard-coded sleep, excluding `terminal-claude-keys` (opt-in) | 233 s |
| Wall-clock budget assertions | 5, in 3 files |
| Serial-tier membership (`parallel-plan.json`) | 118 files |
| CI shard split (`shard-plan.json`) | 79 / 78 / 78 files |

The published figures in `docs/testing.md` (~21 min locally; 4.7 min parallel + 20.0 min serial;
115/99 file split) were taken at **214 files / 658 tests**. The suite has grown ~10% since, so those
figures are stale and every reduction target in the spec is against a baseline re-measured as part of
this work.

**Top sleep concentrations** (seconds of hard-coded wait per file):

```
33 sites  89.4s  terminal-claude-keys.e2e.ts     (opt-in: THRONG_CLAUDE_E2E)
10 sites  14.5s  terminate-all-drain.e2e.ts      (#245 lives here)
 4 sites  14.0s  editor-cross-project-restore.e2e.ts
 2 sites  13.0s  project-missing-root-wedge.e2e.ts
 6 sites  12.5s  notification-prefs.e2e.ts
 4 sites  10.0s  panel-auto-naming.e2e.ts
 2 sites   9.2s  terminal-launch-failure-config.e2e.ts
 1 site    9.0s  terminal-find.e2e.ts
 1 site    9.0s  terminal-refresh.e2e.ts
 3 sites   9.0s  terminal-start-failure-controls.e2e.ts   (#246 lives here)
```

Two of the ten heaviest sleep concentrations are the two files that produced reported issues. That is
the whole argument for User Story 2 in one line.

---

## 2. The known-failure register is larger than #251 says

`.claude/skills/throng-testing` records **seven** specs as failing on `master`:

```
editor-feedback3 · editor-move-repoint (AC6) · editor-undo-recovery · error-dismiss
terminal-persistence · terminal-reattach · titlebar-chrome
```

#251 tracks **two** of them. The other five — `editor-feedback3`, `editor-move-repoint`,
`editor-undo-recovery`, `error-dismiss`, `titlebar-chrome` — are known reds with **no issue at all**,
recorded only in a skill file that a developer is expected to consult before believing a failure.

This matters to FR-008 and SC-002. "The register names nothing" is a claim about all seven, not two,
and the five untracked ones are exactly the failures the spec describes real defects hiding behind.
The baseline run settles which of the seven still fail, at what tier, and on which attempt.

---

## 3. #245 — the guard is sound, its instrument is not

`terminate-all-drain.e2e.ts:554-558`.

**What the test actually claims** is the assertion after it: a panel added in a sub-workspace window
is in the store after the main window is closed, proving the cascade drains the child's pending
layout write.

**What the 400ms check is for** is validity, not the claim. The child window has its own 400 ms
deferred-write timer. If the child lives long enough for that timer to fire, the child saved the
write by itself and the drain was never exercised — the test would pass with the drain switched off.
The guard exists to stop the test being vacuous, and the file says so explicitly. It is a good guard
protecting a real trap the neighbouring Themes case fell into.

**Why it fails**: it infers "the child's timer did not fire" from "the child lived fewer than 400
wall-clock milliseconds". Under load, window teardown took 948 ms and 543 ms — so the guard fired on
a run where the drain may well have worked. It cannot distinguish a slow machine from a broken drain,
which is precisely FR-018.

**Two candidate fixes, both removing the clock** (the plan picks one):

- **A — observe the timer, not the elapsed time.** Record in main whether the child's own deferred
  save actually ran before the window died, and assert on that fact. Directly expresses what the
  guard means. Cost: needs an observation point for the write's origin.
- **B — make the child's timer unable to win.** If the deferred-write interval is settable for the
  test and set far beyond any teardown, the child *cannot* have saved the write, so the guard becomes
  structurally true rather than measured, and the drain must flush a pending write to pass — a
  strictly stronger test. Cost: needs a seam on the debounce interval, and a test-only seam in
  production code needs justifying.

Whichever is chosen, FR-011 requires the fixed test be observed failing against the defect it
defends — disable the drain, watch it go red — before the fix is accepted. Otherwise the guard has
been replaced with a different vacuous guard.

### Where the causal fact actually lives — and why it is not reachable yet

**Not fixed in this branch.** The mechanism was traced far enough to say what the fix has to be, and
far enough to say why it is not a small change.

`packages/ui/src/renderer/state/layout-saves.ts` already models the exact distinction the guard
wants. `settleLayoutSaves` has two halves: fire what is **armed** (a debounce timer that has not
gone off), then await what is **in flight**. And `flushSave`'s own comment states the discriminator
outright — *"by the time the timer has fired it has nothing pending left to tell anyone about"*.

So the question "did the DRAIN perform this write, or did the child's own 400 ms timer?" has a
precise answer: **was anything armed when the drain ran?** That is the causal fact, it is already
computed, and it needs no clock.

The obstacle is *where* it is known. It is known inside the child renderer at drain time, and the
test can only read it after that window has been destroyed — which is the same race that made the
original guard reach for elapsed milliseconds in the first place. Getting it out needs one of:

- **an env-injected debounce interval**, so the child's timer cannot win and the guard becomes
  structurally true. There is precedent for a test seam of exactly this shape —
  `THRONG_ATTACH_TIMEOUT_MS` and `THRONG_ATTACH_DELAY_MS` in `terminal-slow-start` — but those are
  read in main and the daemon, while `AUTOSAVE_DEBOUNCE_MS` is a renderer constant
  (`workspace-store.tsx:50`) with no route for an environment value to reach it;
- **or a new observability hook** that records, durably and before the window dies, whether the
  drain found anything armed.

Both are production changes to the renderer for a test's benefit, and both deserve a deliberate
decision rather than being slipped in. **Two attempts in this branch to fix a test from a plausible
mechanism without measuring first produced regressions** — the first `typeAndEcho` (#252) and the
fence attempt (#246) — and both were caught only by measuring the before state. That is the reason
this one stops at analysis instead of guessing at a third.

---

## 4. #246 — proving a negative by sleeping past it

`terminal-start-failure-controls.e2e.ts:489` and `:511`.

```ts
await win.waitForTimeout(3000); // let any erroneous revert be written before reading
const layout = layoutJson(dataDir, 'DaemonGone');
expect(layout, 'the persisted layout stopped describing a terminal').toContain('"kind":"terminal"');
```

The test wants to prove an erroneous revert was **not** persisted. It sleeps for a duration chosen to
outlast the revert, then reads. Two failure modes, and the reported one is the second:

1. The revert happens **later** than 3000 ms under load — the test passes, wrongly.
2. The layout has not been written **at all** yet — the read returns `""`, and the assertion fails
   naming a defect that does not exist. This is what was observed: `Received string: ""`.

Mode 2 is the more damaging: the failure message says "the persisted layout stopped describing a
terminal", which sends the reader into the product looking for a revert bug, when the true state is
"nothing has been written yet". FR-013 exists for exactly this.

**The fix shape** (FR-012, FR-016): establish that the moment for the erroneous write has passed by
observing a **later** event that could only occur after it. The same file already demonstrates the
technique at line 167, polling `layoutJson(...).includes('"kind":"terminal"')` rather than sleeping —
so the file contains both the bug and its own cure. The generalisation FR-016 asks for is a named,
shared mechanism so each test does not re-derive it, and FR-017 requires it to fail when the fence
event never arrives rather than passing by default.

---

## 5. #251 — hypothesis: the same defect, not contention

> **WITHDRAWN — the measurement killed this.** The hypothesis below was recorded before the baseline
> ran, and the baseline does not support it. See [baseline.md](./baseline.md) §3.
>
> The failure mode is a **30-second test timeout**, so the test never reaches the assertion the
> layout-autosave theory is about. A worker-count experiment over the sixteen affected files, with
> retries off, produced **38/38 passing at one worker, 34/38 at three, and 20/34 at six** — monotonic
> in load, which is starvation, not a race a sleep length could explain. The cause is a mis-drawn
> tier boundary affecting thirteen `terminal-*` files, not two bad specs.
>
> The reasoning below is kept rather than deleted, because it is why the experiment was run, and
> because the sleeps it identifies **are** still defects under FR-015 — they are simply not why these
> tests fail. Fixing them would have produced a green run and the wrong conclusion.

**This was a hypothesis, not a root cause.** It was recorded so the baseline run could confirm or
kill it, and it was not treated as established. It was killed.

The issue frames #251 as a parallelism problem: both specs pass 11/11 at `--workers=1` and fail at
the six workers the local parallel tier uses. Reading them suggests something simpler.

`terminal-reattach.e2e.ts`:

```
:81   await win1.waitForTimeout(1500); // let the layout autosave
:82   expect(await daemonSessionCount(pipe)).toBe(1);      <-- does NOT retry
:88   await win1.waitForTimeout(800);
:96   expect(await daemonSessionCount(pipe)).toBe(1);      <-- does NOT retry
:105  expect(await daemonSessionCount(pipe)).toBe(1);      <-- does NOT retry
```

`terminal-persistence.e2e.ts`:

```
:53   await win1.waitForTimeout(900); // layout save debounce (400ms) + slack
```

Both sleep for a fixed period standing in for the layout autosave, then assert with a **non-retrying**
`expect`. The test's real dependency is that the layout is on disk before the app closes, because the
second launch restores from it. At one worker, 1500 ms comfortably covers a 400 ms debounce plus the
write. At six workers it need not, and then launch 2 restores a layout with no terminal in it and
fails at `:104`.

If that is right, #251 is not a parallelism defect and not a product defect — it is the same class as
#245 and #246, and it is fixed the same way: poll the persisted layout for the terminal, and make the
session-count assertions retry.

**What would confirm it**: replacing the sleeps with a poll on the persisted state, then passing
repeatedly at six workers with retries off. **What would kill it**: still failing at six workers with
the sleeps replaced, which would point at the product's persistence or reattach path and put FR-007
in play.

Note this changes what "fixed" means for FR-001. If the hypothesis holds, moving the two specs to the
serial tier would be the **wrong** answer — it would hide a test defect behind a tier boundary and
leave the same bug in every other spec that sleeps for the autosave.

---

## 6. #252 — the keystroke outruns the shell

`terminal-editing-matrix.e2e.ts:183-195`.

```ts
await win.keyboard.type(full.slice(1), { delay: 25 });   // the line, minus its first character
await win.keyboard.press('Home');                        // <-- sent as soon as typing is DISPATCHED
await win.keyboard.type(full[0], { delay: 25 });
await win.keyboard.press('End');
```

`type()` resolves when the keystrokes have been dispatched, not when the shell has assembled the line
from them. `Home` arriving mid-assembly moves the cursor within a line that is not yet what the test
believes it is, the repair character lands in the wrong place, and `LINEOK` never prints. Only
`git-bash` was observed flaking, which is consistent with a different line-editor doing its assembly
on a different schedule rather than with git-bash being broken.

The same shape is present in the preceding step, which types and then immediately presses
`Control+Backspace`, so a fix confined to the Home/End step would leave the class in the file.

**The file already knows the answer.** `openShell()` refuses to trust a painted prompt and instead
runs a real command, requiring `READYOK` to print, because "that the shell echoed, edited and printed
READYOK is the only evidence that the next keystroke will be seen". The fix is that same principle
applied per step: send a chord only after observing the shell has echoed the text the chord operates
on. FR-014a forbids the cheaper route of dropping the git-bash flavour.

---

## 7. Launch amortisation — where the 681 launches are

Top files by `runApp()` count:

```
19  terminate-all-drain      17  explorer            17  preferences-json
12  preferences-themes       11  preferences-reset   10  notice-logging
10  preferences-row-actions  10  preferences-settings 9  editor-move-repoint
 9  os-drop                   9  preferences-keybindings  9  terminal-claude-keys
```

The preferences cluster alone accounts for ~60 launches and sits entirely in the serial tier, where a
launch costs full wall-clock rather than one-sixth of it. That makes the serial tier the place where
conversion pays most, and it is also where conversion is hardest — `docs/testing.md` records that
preferences and menu specs are the test-dense ones.

`docs/testing.md` records the prior attempt honestly: 54 files assessed, 34 converted, **20 reverted**
because their assertions genuinely need a pristine application, and `explorer.e2e.ts` measured 46s →
12.8s. The 40% reduction target in SC-007 assumes roughly that same two-in-three rate across the 181
files never assessed.

The two traps the same document records, both of which FR-024 to FR-027 encode:

- a shared-app shim that accepts launch options silently drops a seeded config root, and the test then
  passes for the wrong reason — measured once, where a swallowed `editor.openOnClick: 'double'` let a
  single click open a file and the assertion saw 2 opens where it expected 0;
- shared projects need unique names, because fifteen called "Demo" make `.project-item` ambiguous.

---

## 8. What must not move

Recorded so the plan does not have to rediscover it:

- `failOnFlakyTests` armed; `retries: 2` kept for diagnostics only (FR-031).
- `fullyParallel: false` — the file is the unit of parallelism (FR-032).
- Elevation guards inside test bodies, never at module scope; 22 files / 25 tests currently skip when
  elevated, and the count prints every run (FR-033).
- `THRONG_E2E_IGNORE_ELEVATION_GUARD` only ever makes more tests run, never fewer.
- `packages/ui/tests/unit/shard-plan.test.ts` fails the build if a spec is missing, duplicated or
  stale across the two plan files (FR-036) — so any file split lands there in the same commit.
- `packages/ui/tests/unit/config-write-helper-single.test.ts` enforces the single atomic
  config-write helper (FR-037).
- The local runner uses **two Playwright processes**, one per tier, deliberately: a single long-lived
  process was measured at 633 passed / 2 failed over 33 minutes where those two passed 5/5 alone and
  56/56 in a short run. Something accumulates across hundreds of launches. Worth remembering if
  conversion changes launch counts dramatically.

---

## 9. Precedent for the guard FR-020 asks for

Two guards in this repo already do the job FR-020 describes — fail the build when a spec adopts a
forbidden pattern — and both are unit tests over the E2E tree rather than lint rules:

- `config-write-helper-single.test.ts` — a spec writing a running app's config any other way fails
  the build.
- `shard-plan.test.ts` — a spec missing, duplicated or stale in the plans fails the build.

The declared-sleep register should follow that precedent rather than introduce a new mechanism.

---

# Appendix: Stories 6-8 (the surface cut), 2026-08-16

Everything above investigated why the suite is *unreliable*. This appendix investigates why it is
*large*, which turned out to be a different question with a different answer.

## A1. The size is mandated, and the mandate had no ceiling

**Decision**: amend Constitution Principle V rather than work around it.

**Rationale**: seven instruction sources pushed work up to the E2E layer and three pushed it down,
none of the latter enforced.

| Source | What it said |
|---|---|
| Constitution V | *"Every user-facing UI change MUST ship with E2E test coverage"* + uncovered UI *"MUST have that coverage backfilled"* |
| Constitution III / V | Process-lifecycle and orphan hygiene MUST be proven by a process-level E2E |
| Constitution V | Privilege-dependent behaviour MUST be `@admin`-tagged E2E |
| `running-tests` skill + `~/.claude/CLAUDE.md` | *"A reported bug starts with a failing E2E"* — one permanent E2E per reported bug |
| `throng-e2e-harness` agent | E2E *"**mandatory** for any user-facing UI change"* |
| `throng-renderer-ui` agent | *"Every UI change ships with passing E2E coverage… Never claim a UI change works on a unit test"* |
| `throng-spec-governance` agent | *"A UI story carries an E2E task"* — injected at `/speckit-tasks` time |

Against those: three advisory lines (`throng-testing`'s cheapest-layer table,
`throng-editor-documents`, `throng-explorer-fileops`), none of which the build enforces.

**Nothing anywhere stated a budget, a cap, a ratio, or a rule permitting deletion.** The only
removal-adjacent rule is `@quarantine`, which explicitly forbids deletion so that lost coverage stays
visible.

**Alternatives considered**: leave the constitution alone and cut anyway — rejected, because
`/speckit-tasks` would keep injecting E2E tasks and the suite regrows within a dozen features. Tune
the rule rather than remove it — rejected, because the rule's failure is that it has no ceiling, and
a mandate with a ceiling is two rules, not a tuned one.

## A2. Roughly three quarters of the suite is at the wrong layer

**Method**: 47 spec files read and classified (~250 tests), spread across every filename cluster.

| Verdict | Share | What it looks like |
|---|---|---|
| Could be unit or component | ~40% | Layout maths, descriptors, path/confinement rules, indent inference, language precedence, chord validation, grapheme truncation, aria attributes, CSS token assertions |
| Could be integration | ~33% | `settings.json` / `keybindings.json` / theme writes and hot-reload, SQLite `workspace_layout`, `main.log` records, the fs watcher, daemon RPC |
| Genuinely E2E | ~21% | Real PTY, xterm rendering and resize, focus after remount, conhost reaping, multiple windows, restart-restore, a real DOM drop |
| Redundant or harness self-tests | ~6% | Perf budgets tuned to the machine, `harness-shutdown.e2e.ts`, scaffolding leftovers |

**Thirteen files assert rules an existing unit test already covers** — `os-drop.e2e.ts` against
`drop-confinement.test.ts`, `editor-indentation` against `indent-infer`, `preferences-slider` against
`slider-descriptors`/`number-format`/`bounds-guard`, and ten more. Those are deletable with a named
existing replacement rather than a new one.

**Three files admit it in their own comments**: `harness-shutdown.e2e.ts` (*"Unit-level coverage for
the harness's bounded force-kill"* — it launches no Electron at all), `performance.e2e.ts` (*"the
spec's name overstates what it measures"*), and `settings-write-integrity.e2e.ts`, whose header names
`config-write-concurrency.test.ts` as where the deterministic proof lives.

**One file is not what its name says**: `os-drop.e2e.ts` dispatches a synthetic
`CustomEvent('throng:os-drop')` and its own header states that real OS drag-and-drop cannot be
exercised. `os-drop-defects.e2e.ts` uses a real `DragEvent` and is the one that must stay.

## A3. There was nowhere for 40% of it to go

**Decision**: add a fourth vitest project, `component`, on **jsdom** with
`@testing-library/react` + `@testing-library/user-event`.

**Rationale**: every existing vitest project is `environment: 'node'`. There is no jsdom, no
happy-dom and no React render anywhere, and the codebase already works around the absence rather
than treating it as a gap:

- `packages/ui/tests/unit/icon-call-sites.test.ts:9` — *"There is no jsdom/component-test layer in
  this repo, so a React component's rendered output…"*, and the test is a source-text guard instead.
- `packages/ui/tests/unit/panel-identity-key.test.ts:17` — the same, in its own words.
- `notice-suppression.ts:5` and `clipboard-copy.ts:21` are factored specifically so they are
  *"unit-testable without a DOM"*.

So "push it down a layer" was not available for rendered output, focus within a component, or
accessibility attributes. It is now.

**jsdom over happy-dom**: Vitest's default, better React 19 support, and the relocated assertions
need `getComputedStyle` fidelity more than raw speed. happy-dom is faster and would win if the
workload were volume; here the workload is correctness of computed style.

**Constraint that must be respected, not designed around**: jsdom has no compositing, no GPU and no
operating-system focus. An assertion that looks like markup but is really about what a user can *see*
stays at E2E (FR-049).

**Live blocker found during the baseline run**: Vitest 4 removed `test.poolOptions`, and
`vitest.config.ts` still uses it in the `osSerial` block — it warns on every integration and contract
run today. The component project must use the top-level form, and the existing usage should be
migrated in the same edit rather than left warning.

## A4. The split across machines no longer pays

**Decision**: delete sharding entirely; both lanes run as one job.

**Rationale**: `ci.yml:159-163` records exactly what the split buys and costs — three parallel
single-worker shards on separate 4-vCPU runners, because *"raising `THRONG_E2E_WORKERS` reintroduces
the exact CPU contention that now turns into red runs"*. It converts ~12 minutes into ~4-5 **at three
times the runner-minutes**, and each shard pays a ~3-4 minute `npm ci` + build toll before a test
runs (#103).

| Lane | Tests | Unsharded | Three shards |
|---|---:|---|---|
| Critical (every push) | ≤50 | ~8-11 min wall, ~10 runner-min | ~7-8 min wall, **~30 runner-min** |
| Full (release only) | ~120-160 | ~15-17 min wall, ~17 runner-min | ~9 min wall, **~27 runner-min** |

The critical lane would spend ~12 runner-minutes of pure toll to save two or three minutes on the
critical path; the release lane is on nobody's critical path, so trading ~7 minutes of wall-clock for
~10 runner-minutes is straightforwardly right.

**What goes with it**: `shard-plan.json`, three assertions plus the hand-kept `['1','2','3']` group
check in `shard-plan.test.ts`, the `THRONG_E2E_SHARDS`/`THRONG_E2E_GROUP` block in
`playwright.config.ts:59-103`, the `merge-e2e` job, the blob reporter branch,
`THRONG_E2E_BLOB_OUT`, and `blob-report-naming.test.ts` — the last four being the entire apparatus
built to fix #216, which existed only because three shards wrote one filename.

**What must be extracted before it goes**: `scripts/ci-e2e-shard.ps1` also carries the
constitutional infra-fault classification (retry once, gated on zero unexpected AND zero flaky,
surfaced against a tracking issue). That is Principle V and must survive the script's `-Group`
plumbing being removed.

**One coupling must be cut first**: `playwright.config.ts:134` enumerates the universe of spec files
from `shard-plan.json` in order to compute the *tier* filter. It must read the directory instead.

**Alternatives considered**: keep shards for the release lane only — rejected, it costs more
runner-minutes than it saves on a lane where wall-clock does not matter. Switch to Playwright's
native `--shard` — rejected now, retained as the fallback if release wall-clock ever becomes a
complaint, because the reason it was originally rejected (the alphabet putting every `terminal-*`
spec in one third, giving 3.7 / 8.3 / 36-minute shards) is an artefact of a 235-file suite.

## A5. Tags, not a fourth plan file

**Decision**: express significance and category as Playwright tags, selected with `--grep`.

**Rationale**: `playwright.config.ts:173` already composes `grepInvert` for `@admin` and
`@quarantine`, and a CLI `--grep` does not clear a config `grepInvert` — the comment at `:171`
records exactly that. So the lane selection is a one-line change to a command, and it coexists with
the exclusions rather than fighting them.

**Alternatives considered**: a `core-plan.json` alongside the other two — rejected. The repo already
has two hand-maintained enumerations of the same 235 filenames and a guard whose job is to notice
when they drift; a third would be a third thing to drift. A tag lives on the test it describes and
cannot get out of step with it.

**Retained**: `parallel-plan.json`. Tier membership answers a different question — can this spec
share a machine — and only the machine-splitting mechanism is being removed.

