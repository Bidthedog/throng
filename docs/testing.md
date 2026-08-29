# Testing

throng has five test layers, run in order by `npm run test`:

| Script | Layer | Runner | Parallelism |
| --- | --- | --- | --- |
| `npm run test:unit` | unit | Vitest (`--project unit`) | parallel (Vitest default) |
| `npm run test:component` | component | Vitest (`--project component`, jsdom) | parallel (Vitest default) |
| `npm run test:integration` | integration | Vitest (`--project integration`) | **serial** (`fileParallelism: false`) |
| `npm run test:contract` | contract | Vitest (`--project contract`) | **serial** (`fileParallelism: false`) |
| `npm run test:e2e` | E2E | Playwright-Electron | configurable (see below) |

`npm run test` runs all five through `scripts/run-tests.mjs` (see *Temp files* below).

## Which layer a test belongs at

**The lowest one that can actually show the behaviour.** Constitution Principle V
(v5.0.0) makes that the rule rather than a preference, and spec 034 is where the
suite was brought back into line with it — the previous wording mandated an E2E test
for every user-visible change, which is how a suite ends up with more end-to-end
tests than a person can run.

Step down as far as the behaviour allows and no further:

| Layer | What it is for | The give-away |
| --- | --- | --- |
| unit | pure functions, reducers, validation, formatting, path handling | it takes values and returns values |
| component | a React component's rendered markup and its keyboard/pointer behaviour | it takes props and draws something |
| integration | two real subsystems meeting — the daemon, the database, the config store | it needs a real process or a real file |
| contract | a message shape crossing a boundary | it is about an interface, not a behaviour |
| E2E | what only a real window can show | see the reserve below |

### The E2E reserve

E2E is where you land when nothing cheaper can show it. The constitution enumerates
what qualifies (v5.2.0): **window lifecycle; focus and z-order; native menus; OS
drag-and-drop; PTY fidelity and process-tree hygiene; real keyboard and input
dispatch; and real layout and text rendering**.

Two of those are recent, and both were added because a real test had nowhere to go:

- **Real layout and text rendering** — anything whose truth depends on how the engine
  actually laid the text out: a caret’s position against a drawn gutter, what is
  scrolled into view, the height of a wrapped line, a measured rectangle.
- **Real keyboard and input dispatch** — what a real engine reports for a chord, and
  whether a real keystroke reaches the real handler. A synthesised `KeyboardEvent`
  asserts the shape the TEST chose; only a real one asserts what the browser decides,
  and that difference is where modifier handling and layout-dependent chords go wrong.

Read the list as a growing set of worked examples, not a closed set. Twice now a
legitimate test has classified under none of the entries, and each time the honest
move was to amend the enumeration rather than force the test down a layer where it
would assert its own premise.

Two traps worth naming, because both have happened here:

- **A cheap test that passes while the bug is real means the layer was wrong, not
  that the bug was.** Step down further, or find the seam you have not modelled.
- **A test that drives a real app to read an attribute is at the wrong layer**, even
  when the attribute is genuinely important. If the claim is about markup, the
  component layer makes it — and usually makes it better, because the questions stop
  costing an app launch each and the branches a single running window could never
  show at once become reachable.

### Replacing an E2E test rather than deleting it

FR-046: write the replacement FIRST, prove it goes red when the behaviour breaks,
and only then remove the E2E. The Red proof is not optional and it has a failure mode
of its own — **assert that the mutation actually applied before believing the
result.** A mutation that silently edited a comment, or that a resync effect
immediately overwrote, reports "not coupled" and proves nothing; that has happened
four times in this repo's own migration work.

FR-047: a partial replacement is not a replacement. If the component test covers four
of a test's five claims, the test is NARROWED to the fifth — it is not deleted.

## Two lanes: `@core` and `@extended`

Every E2E test carries a significance tag and a category tag, and
`packages/ui/tests/unit/e2e-tags.test.ts` fails the build for one that carries
neither.

| Tag | Where it runs | Cap |
| --- | --- | --- |
| `@core` | every CI push, and locally | **50** — a hard ceiling, guarded |
| `@extended` | the release lane, before an installer is built | none |

Category tags — `@boot @terminal @editor @explorer @prefs @window @persistence
@failure` — say what a test is about, so a failure names an area before anyone opens
the file. `@admin` and `@quarantine` are environment tags and are orthogonal to both.

Selection is by `--grep`, composed with `grepInvert` in `playwright.config.ts`, so a
test that somehow carries no significance tag runs in NEITHER lane — which is why the
guard exists rather than being a nicety.

`packages/ui/tests/e2e/e2e-budget.json` is a ratchet: it fails when the suite grows
past the budget **and** when it drops below it without the budget being re-seeded. The
second half is the one that does the work — it is what stops a migration quietly
banking a reduction and then spending it again.

## The third tag: which reserve entry makes this irreducible

Spec 035 added a third class of tag. A significance tag says which lane a test runs in
and a category says what area it covers; **neither can tell you whether a test still
needs the running application at all.** 035's census read all 229 spec files (the suite as it then stood) and found
that class repeatedly: `tree-drop-open.e2e.ts` justified all five of its tests by the OS
drag-and-drop reserve while dispatching a synthetic in-page `CustomEvent` that jsdom
reproduces identically, and `subtree-expand-collapse.e2e.ts` claimed the native-menu
reserve for an in-document React menu. Both claims were true when written and rotted in
silence, because nothing ever re-checked them.

So every E2E test names the constitutional reserve entry it relies on, from a closed
vocabulary:

| Tag | The entry it names |
| --- | --- |
| `@reserve:window` | real window lifecycle and multi-window behaviour |
| `@reserve:focus` | focus and z-order across windows |
| `@reserve:native` | native menus and dialogs |
| `@reserve:osdrag` | OS drag-and-drop |
| `@reserve:pty` | PTY/ConPTY keyboard and rendering fidelity |
| `@reserve:process` | process-tree hygiene |
| `@reserve:layout` | real layout and rendered appearance — geometry, colour, cascade |
| `@reserve:input` | real keyboard and input dispatch |
| `@reserve:runtime` | real application-runtime identity |

The identifier is stable and the constitution's prose is not — v5.3.0 reworded the layout
entry to cover colour and cascaded style without touching a single test, which is the
whole argument for a tag over a quoted sentence.

**`reserve-tag-debt.json` is the migration ratchet**, the same both-ways shape as the
budget. It records how many tests do not yet name an entry; the number may fall and must
never rise. Tags are added **by reading the test**, never inferred: a codemod over the
whole suite tagged 443 tests and put 205 under `@reserve:input`, because `.press(` and
`.type(` appear in nearly every spec here. Restricting it to unambiguous APIs did no
better — it read `process.execPath` out of a test's daemon *setup* and called the test a
runtime-identity claim. The evidence for a test's **claim** is not lexically
distinguishable from the evidence for its **setup**, so an automated tag is a
confident-looking false justification: the exact defect the tag exists to remove.

## The bridge parity guard

`packages/ui/tests/unit/ipc-bridge-parity.test.ts` checks that both ends of the
renderer↔main bridge name the same channels, for all ~98 of them, in milliseconds and
without launching anything.

It exists because "this proves the wiring is live" was the largest single reason 035's
census found for keeping a test at E2E — and the wiring decomposes into three spans, two
of which already had a home:

| Span | Layer that owns it |
| --- | --- |
| renderer action → bridge call | component, against a fake bridge |
| channel agrees across preload ↔ main | **this guard** — previously nothing |
| main handler → real effect | contract (`config-write-patch.contract.test.ts`) |

It scans channel **literals** per directory rather than `ipcMain.handle(...)` call sites.
A first attempt did the latter and reported 34 one-way gaps, every one false: channels
here are routinely registered through a named constant, a helper map, or a `send` inside
a switch, so the call site holds an identifier rather than a string. A constant's
definition is itself a literal in the same tree, so collecting literals needs no import
graph and no parser. Comments are stripped first, because this codebase deliberately
documents channels it has **removed** — and without stripping, those comments read as
live one-way channels.

It found one on the day it was written: `throng:terminal:flavourMissing` is forwarded to
the renderer by `daemon-events.ts` and has no preload listener, so it reaches nobody. All
five of its siblings are wired. `KNOWN_ONE_WAY` records it with the reason, and fails if
an entry there is ever fixed without being removed.

## `npm run gate` — the one command that says the work is done

```
npm run gate
```

Eight stages in CI's order, **fail-fast**: **lint → typecheck → build → unit → component →
integration → contract → e2e**. One line per stage, and it stops at the first failure rather than
reporting a tidy summary of a broken branch.

The order is the point. The cheap stages run first precisely so the expensive one is only ever
reached by code that has already earned it — a full E2E run behind an unverified typecheck spends
half an hour to be told something an eleven-second command already knew.

**Component sits fourth, not last among the cheap stages**, and its position is a decision rather
than an accident: it is the second-cheapest layer in the repo — jsdom, no app, no daemon, no shell —
and after spec 034 it carries assertions that each used to cost an Electron launch. Putting it after
the OS-heavy layers would spend minutes to learn something available in seconds, which is the same
argument the whole ordering rests on.

It also **clears the processes a run leaves behind** — app, daemon, pty-agent, Playwright — on
success, on failure, and on Ctrl+C. An interrupted run otherwise leaves workers holding cores, and
the next suite inherits a machine that is already busy.

Three things worth knowing:

- **Fail-fast means stop, fix, re-run** — not read on. Use the individual `npm run test:*` scripts
  while iterating; it is claiming *done* off the back of one of them that the gate exists to prevent.
- **A green gate goes stale the moment you edit.** Quote the stage summary when you report done, and
  re-run if anything changed after it.
- **The E2E stage is the expensive one** (**~18 minutes** locally — measured 2026-08-20 at 207 spec
  files / 548 declarations, at the end of spec 035; the figures and their provenance are below).
  Never skip it to make the gate finish sooner — that expense is exactly why it is inside the gate
  rather than optional.

  The gap that stood here is closed. Two earlier gate runs at the end of 035 stopped inside a tier
  under fail-fast and timed nothing, and this file said so rather than restating a stale figure; the
  third ran green end to end and is where the number above comes from.

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
- **The cost is launch, not paint.** A run performs **382 Electron launches** — measured 2026-08-18
  at 229 spec files / 640 declarations by `node scripts/count-e2e-launches.mjs`, down from 592 on
  the pre-034 baseline `d55054b` — against a ~5s launch budget (001 SC-001, asserted by
  `performance.e2e.ts`); the worker benchmark below concludes the constraint is
  per-worker Electron + daemon **processes**, and CI's floor is a ~3–4 min `npm ci` + build toll
  *before a test runs* (#103 — paid three times, once per shard, until spec 034 deleted sharding and
  made it one). **Nothing in this repo measures compositing cost at all** — so hiding windows targets
  a cost that has never been shown to exist.

The trade being refused is therefore: **maintain a second harness, plus a production `show: false`
branch that only test runs take, to speed up a minority slice of a suite whose cost is process
startup — and never again be able to answer "does the hidden path test the same thing the headed one
does?" without running both.**

This was reasoned through on **#75** (answered "don't", 2026-07-16) and is out of scope on **#103**.
Both are worth reading before re-opening it — but note that neither ever *measured* anything, and
#103's "51% of specs drive terminals" is not reproducible (25% is; the figure appears to come from a
case-insensitive `pty` grep also matching "empty"). **#117 re-opens the question empirically**, and is
where the evidence should land.

## `THRONG_TEST_SHELL_HISTORY` — the shells a run opens keep no history

Set to `off` by `harness.ts` for every app it launches, so a run never writes the developer's own
shell history. It has a section of its own because the reasoning is about a shared OS resource
rather than about a knob: see *The global OS resources a run must never write* below, which covers
what it does per shell and why the clipboard sits beside it.

Unset everywhere else. A real terminal records history exactly as it always did — that is what
recall and Ctrl+R are for — and `packages/platform-windows/tests/integration/shell-history.integration.test.ts`
pins that direction as well as the suppressed one.

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
suspect a budget before you suspect the product — see *Budgets* below.

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

CI runs **one worker, one job, no tiers and no shards** — see *Two lanes* at the top
of this file for what that job actually runs. Focus contention is per-desktop, so workers are the
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

`scripts/run-deelevated.ps1` is kept for a **self-hosted runner with UAC enabled**,
where it should work. It probes each strategy before use, so an environment that
cannot drop rights fails in about 30 seconds with a clear message rather than
consuming a full E2E run — and it never silently falls back to running elevated,
because a suite that looks like it ran while verifying nothing is the failure this
whole area exists to prevent. `THRONG_DEELEVATE_FORCE=1` exercises it from an
ordinary shell.

## Writing a running app's config root

**A test that writes into the config root of an already-running app MUST use the shared atomic
helper.** There is exactly one, `packages/ui/tests/e2e/helpers/config-write.ts`, and
`packages/ui/tests/unit/config-write-helper-single.test.ts` fails the build if a spec writes any
other way.

```ts
import { writeSettingsAtomic, writeConfigRawAtomic } from './helpers/config-write.js';

writeSettingsAtomic(cfgRoot, { appearance: { theme: 'Matrix' } });   // a JSON value
writeConfigRawAtomic(cfgRoot, 'settings.json', '{ deliberately broken');  // raw text, on purpose
```

### Why, precisely

`writeFileSync` **truncates the target and then fills it**. Against a file nobody is watching that is
invisible. Against a running throng it is a race the app can lose: the config watcher is debounced
but not synchronised with the test, so it can wake while the file is empty, read unparseable JSON,
and broadcast the shipped defaults as though they were the settings the test just wrote.

The change is then **lost, not late** — which is why a longer timeout never helped, and why the
failure reads as a product defect that does not exist. It surfaced as *"the rename field never
started enforcing a limit of 64"* (#243) and as three more sites in #253.

The helper stages a temp file **in the same directory** as the target — a rename is only atomic
within a volume, so staging in the OS temp directory and renaming across would silently degrade to
copy-then-delete — then replaces, retrying EPERM/EACCES/EBUSY on a **1000 ms budget at 20 ms
intervals**. Those numbers deliberately mirror the product's own `renameWithRetry`
(`packages/ui/src/main/config-store.ts`): a helper that gave up sooner would report failures the
product would have survived, and one that persisted longer would hide contention the product cannot
tolerate.

### A pre-launch seed is NOT this

Writing `settings.json` **before** `runApp` is fine with a plain `writeFileSync`: no app is running,
no watcher exists, and nothing can race. Of 36 config-document writes in the E2E tree, 32 are
pre-launch seeds. #253 named one of them as a defect and it is not one — the classification is by
brace depth relative to the enclosing `runApp`/`openApp`, not by eye.

### And do not wait on the clock afterwards

A settings write is picked up asynchronously, so the honest sync point is the **condition** the test
is about — the counter that reads the new limit, the option that appears in the dropdown, the
accelerator that starts firing. A `waitForTimeout` guesses a duration on one machine; the poll is
both correct and usually faster. Where the stimulus itself can be lost (a keypress delivered before a
rebind is installed is simply discarded), repeat the **stimulus** inside the poll, not just the
assertion.

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

Several helpers in `packages/ui/tests/e2e/harness.ts` exist to close the race classes that produced
most of the flakes we found. Use them:

- **`settle(win, root?)`** — a POSITIVE assertion that the window has rendered. Make it the first
  statement of any test that later reads raw state. A *negative* opening assertion
  (`await expect(x).toHaveCount(0)`) is satisfied vacuously by a DOM that has not rendered anything:
  it looks like a wait and settles nothing. (The Preferences window's root is `.prefs-root`.)
- **`geom(locator)`** — element geometry, polled until the element **stops moving**. Never reach
  through `page.evaluate` to `querySelector(...).getBoundingClientRect()`: that read does not wait
  for the element to exist *or* to stop animating, and both failures look like flakiness rather than
  like the broken read they are.
- **`viewport(win)`** — window dimensions, for measuring a control against the window edge.
- **`commitPanelRename(win)` / `commitTabRename(win)`** — commit the inline rename that `panel-add`
  and `tab-add` open the new panel/tab in. They wait for the input, assert it holds focus, press
  Enter and return only once it is gone.
- **`focusEditor(win, panelId)`** — click into a panel's editor and wait until it *actually* has
  focus. A click resolves when the event is dispatched; CodeMirror adds `.cm-focused` a beat later,
  and keys sent in that gap go nowhere.

Prefer an assertion on a real condition (`toBeVisible`, `toHaveCount`, `expect.poll`) over
`waitForTimeout(n)`. A sleep asserts that *n* milliseconds is always enough; a condition asserts that
the thing you are about to measure has actually happened.

**Never send a key at a control you have not asserted is there.** This is the same rule, but it fails
differently and much more expensively: an unsynchronised *read* returns the wrong value, while an
unsynchronised *keystroke* goes to whatever holds focus instead — and that surface may well act on
it. A bare `await win.keyboard.press('Enter')` to commit a new panel's rename does nothing visibly
wrong when the input has not mounted yet; the Enter reaches the editor that had focus, which inserts
a **newline into the document**.

Nothing fails there. The test carries on against a fixture that is now one line longer than the file
on disk, and dies later on an assertion that names the feature under test:

```
Expected: "CCCCZ"
Received: "BBBB"
```

That failure is a lie — the caret never moved, the *text* did — and it sends you into the product
code for as long as you believe it. Hence the helpers above: they are not shorthand for the raw
call, they are the difference between a key that lands where you meant it and one that quietly edits
your fixture.

**The thing you waited for may not be the thing you are about to read.** Everything above is about
waiting rather than sleeping; this is the case where you waited on a real condition, correctly, and
still read too early — because the observable you chose happens *before* the effect you are
asserting. A wait is only a synchronisation if it is downstream of the write.

`navigation-remember.e2e.ts` lost that one for months (#321). Accepting a Quick Open query ends with
the modal gone, so the helper waited for `quickopen` to reach count 0 — an honest condition, and the
wrong one. `quick-open.tsx`'s `choose` calls `onDismiss()` **synchronously** and then does the real
work in an async IIFE:

```ts
onDismiss();                                          // the modal disappears HERE
…
const opened = await openFileInTab(ws, tabId, absPath, target);
if (!opened) return;
if (remember) rememberQuickOpenQuery(query, root);    // …and the query is recorded HERE
```

That ordering is deliberate and required by 033's FR-061 — "accepted" means a file actually opened,
so a route the user cancels at the unsaved-changes prompt must record nothing. The helper returned
between the two, and the caller then read the remembered value with a plain, non-retrying `expect`.

It failed about once in 705 serial executions on a warm machine and **four times in twenty** on a
cold worktree, where opening the file is slow enough to lose the race reliably. The fix was to wait
for the file to be on screen — the record's actual precondition — not for the modal to go.

Two things make this class hard to spot, and both are worth checking for by hand:

- **The symptom names the wrong thing.** `Expected: "guide" / Received: ""` reads as "the feature
  did not remember", so you go looking at the store. The store was fine; nothing had asked it to
  remember yet.
- **Instrumenting it can hide it.** A probe that reads state over IPC *before* the assertion adds a
  round trip, which is enough to let the pending write land: the same spec went 10/10 green with an
  eager probe in place and 7/10 without it. If a diagnostic makes a flake disappear, that is
  evidence about the timing, not an exoneration — capture into a global and read it in the failure
  path only.

So when a value comes back empty rather than wrong, ask what wrote it and *when*, and check that the
condition you waited on is downstream of that write rather than merely near it.

**…and it may be downstream of a different channel entirely.** The variant above is one write with a
wait placed too early in it. This one is two writes that never had an ordering, and it is not an E2E
problem — #335 was a **component** test, which is worth saying out loud, because "flake" reads as
"Electron, six workers, a real shell" and this needed none of that.

`mount-editor.ts` feeds a mounted editor from two independent promises: the document through
`editor.getContent()`, and the settings through `config.get()`, which `ConfigProvider` awaits in its
own effect. Nothing sequences them. `editor-update-listener.test.ts` mounted with
`autoSave: true`, waited for the document text — the obvious "it is ready" signal, and the one every
other test in the file needs — and then asserted on a timer that only exists if the *settings* have
landed:

```ts
if (metaRef.current.settings.autoSave && configRef.current.filePath) {
  autoSaveTimer.current = setTimeout(…, metaRef.current.settings.autoSaveDebounceMs);
}
```

The shipped default for `editor.autoSave` is `false`, so losing that race arms nothing at all and the
assertion sees an empty array rather than a wrong number — the same misleading symptom as #321.

Three things generalise from it:

- **Two channels with no barrier are a race even when both promises are already resolved.** Under
  vitest they settle within a few microtasks of each other, which is why this passed locally,
  through a full `npm run gate`, and on most CI runs. It failed on a loaded GitHub runner and passed
  on a re-run of the same commit.
- **A default that is `false` turns a stale read into an absence.** Had the default been a different
  *number*, the filter would have found a timer with the wrong delay and said so. Prefer asserting
  the precondition directly — `mounted()` now also checks `h.settings()` — so a green result cannot
  come from the defaults.
- **The fix is a precondition, not a longer wait.** `mountEditor` exposes `settingsLoaded()` from a
  witness component rendered under the provider, and `configDelayTicks` pushes `config.get()` behind
  the document deliberately, so the race is lost on *every* run rather than one in a few hundred.
  A regression test that cannot lose the race is not a regression test.

The general form: **when a test mounts something with configuration, "the subject appeared" is not
"the configuration arrived".** Wait for the observable that setting produces, or for the setting
itself.

**…and the signal you waited on may have been written OPTIMISTICALLY.** The third sibling, #290. The
two above are about picking a signal that is upstream of the write, or on the wrong channel. This one
is about a signal that is genuinely on the right channel, genuinely means what it says — and is set
*before the work happens*, on purpose, because the UI would otherwise feel slow.

Opening a project is optimistic on the sidebar's side and awaited on the workspace's side:

```ts
// projects-store.tsx — synchronous, before any await
setOpenedId(id);                                   // .project-item[data-active] flips HERE
const opened = await run('open', …, () => client.setActive(id));
```

```ts
// workspace-store.tsx — and this deliberately does NOT clear `layout` first
void client.load(activeProjectId).then((result) => setLayout(applyReloadMode(result.layout, …)));
```

Not clearing `layout` is the right call — blanking the pane on every switch was a visible flash — but
it means there is a window, one RPC long, in which **the sidebar names the new project while the DOM
still holds the old project's `<TabGroup/>`**. A test that clicks a project row, waits for
`data-active`, and then reads a panel id gets a panel belonging to the project it just left. Nothing
recovers from that: `terminal-<that id>` can never exist, so the next locator waits out its entire
budget and fails with `element(s) not found` — which reads as a slow app, or as the panel failing to
restore, and is neither.

What makes this one worth its own entry:

- **The right signal already existed and was one attribute away.** `app.tsx` stamps
  `data-project={layout.projectId}` on `workspace-pane`, from the very state whose arrival mounts the
  new panels — same commit, so when it reads the project you asked for, the panels on screen are that
  project's *by construction*. `switchProject()` in the harness waits on it; every caller that clicks
  a project row and then reads panel state should use it.
- **Auto-waiting does not save you, because the wrong answer is already on screen.** `firstPanelId()`
  uses `.evaluate()`, which auto-waits for a `.panel-box` — and one is already there. Playwright's
  auto-waiting resolves "not yet rendered"; it cannot resolve "rendered, but stale".
- **Measure the window, not the flake rate.** A probe that switched back and forth 150 times and read
  the pane id and the panel id in one pass found the window open on 3 trips and the *wrong panel id
  actually returned* on 2 — while the same read behind the `data-project` wait was wrong 0 times.
  That is a far better artifact than "1 failure in 6 runs", because it names the mechanism instead of
  sampling its consequences, and it costs 20 seconds instead of six full spec runs.
- **The gap between 3 and 2 is the lesson about diagnostics.** On the third trip the window was open,
  yet the id came back correct — `firstPanelId` does its own round trip, and that was enough for the
  layout to land. Every extra hop between the click and the read shrinks the failure rate without
  closing anything, which is exactly why the flake presented as rare and load-dependent.

The general form, across all three: **ask what writes the thing you are about to read, and wait on
something that cannot be true before that write has happened.** "Near it", "usually after it", and
"set when the work was requested" are all the same bug.

### When waiting correctly is not enough, because the app is telling the renderer something untrue

The three above are all the test's fault: it read something before the thing that writes it had run.
The two below are **not**, and the distinction is worth holding onto, because the first instinct on
meeting them is to add another wait — and no wait fixes either. The test waited correctly and was
told a lie.

Both surfaced in `preferences-reset.e2e.ts` chasing [#341](https://github.com/Bidthedog/throng/issues/341),
and both turned out to be product defects that cost a user real work rather than harness problems.

- **A broadcast can be older than the write it lands after.** A watcher read is not instantaneous —
  it opens three documents and enumerates the icon-pack directory, and 032 FR-008 makes it retry for
  up to ~100 ms when it catches a partial write. A config write can commit inside that window, so the
  payload describes a file that has stopped saying it, and it reaches the renderer *after* the
  renderer adopted the write that superseded it. The renderer cannot defend itself: `onChange`
  replaces the whole state because a broadcast is supposed to *be* the truth, and nothing in the
  payload ever said which moment it was the truth at.

  The damage is not a stale render. The preferences tabs compose their next edit from what they were
  last told, so the next whole-document write puts the reverted value **back on disk**. Remove a
  chord from `zoom.in`, get reverted, remove one from `zoom.out`, and that second write restores
  `zoom.in` to its shipped value. The Reset control then correctly reports the row as un-overridden,
  which is why the failure presents as a click that never becomes actionable rather than as a wrong
  value. `ConfigPayload.generation` now carries the store's commit count as at the read's *start*,
  and a read the counter has outrun is never broadcast.

- **A window that is interactive before it has loaded cannot honour "revert".** The preferences
  editors rendered from the shipped defaults while `config.get()` was in flight. An edit made in that
  gap is already in the payload that resolves the load, so the on-entry snapshot — captured on the
  render where `loaded` first turns true — records the *edited* value, and "revert every editor to
  its state when this window opened" restores the very thing the user was discarding. Retrying the
  read cannot help: a re-read returns fresher content, never the state the window opened with.

  The worse half never reached the tracker on its own: the Key Bindings tab composes **whole
  documents** from what it currently holds, so one edit in that gap writes the default keybindings
  over the user's real ones. The editors now wait for `loaded`; the toolbar does not.

Measured, `preferences-reset.e2e.ts` alone, idle machine, one worker, retries off: **5 failed / 14**
before, **1 / 14** after the first fix, **0 / 16** after the second — then a full `npm run gate` at
560 E2E, 0 flaky.

The general form of *these* two: **ask whether the thing telling you is entitled to be believed.**
A payload with no notion of when it was true, and a window with no notion of what it opened with,
are both saying "this is the state" while holding no evidence for it.

### Reproducing a flake: separate invocations, never `--repeat-each`

The rule above says stress the one test until it fails on demand. **How you stress it decides whether
the answer means anything**, and the obvious tool is the wrong one.

`--repeat-each=N` replays a test N times **inside one worker, against whatever state the previous
repeat left**. The suite never does that: it runs each test once, with its own app and its own config
root. So for any spec about state that persists — `preferences-reset.e2e.ts` most of all, which is a
file about config writes landing — `--repeat-each` manufactures failures that do not exist.

Measured, 2026-08-27, chasing the flakes in [#341](https://github.com/Bidthedog/throng/issues/341):

- With `--repeat-each=5`, `preferences-reset.e2e.ts:265` failed waiting for `binding-reset-zoom.in`
  to become enabled. The button was **disabled**, titled *"Zoom in is already at its default value"* —
  the previous repeat's *reset-all* still in effect. A perfect-looking reproduction of a defect that
  was not there, and it sent the investigation at the diff rather than at the harness.
- Re-run as separate invocations, that test passed **4 of 4** rounds, and the real flake surfaced
  somewhere else entirely: `theme-flash.e2e.ts:199`, `Error: no new window was created`.

So: **one round is one `npx playwright test <spec> --workers=1 --retries=0` process**, repeated by a
loop *outside* Playwright, with the pass/fail of each round recorded. It is slower per sample, and it
is the only sampling that shares the suite's conditions.

**And run the same rounds on `origin/master` before attributing anything.** The same session's
measurements — branch 1 failure in 4 rounds, master **2 in 6** — are what turned "my branch broke the
preferences specs" into "this family flakes on master too", and the two sides failed *different*
tests, which no single-sided run could have shown.

## Budgets — the six clocks, and why each is where it is

A test suite that runs six Electron apps at once creates its own load, and every
timeout in it is really a claim about how slow things are allowed to get under that
load. Spec 034 found **five** such budgets, each sized when the suite was smaller and
quieter, and each only visible once the one above it was fixed.

| Budget | Was | Is | Derived from |
| --- | ---: | ---: | --- |
| test timeout (`playwright.config.ts`) | 30 s | **60 s** | longest legitimate journey observed at six workers ~38 s |
| assertion timeout (`expect.timeout`) | 10 s | **15 s** | the failures that remained after the test timeout moved were 10.0 s exactly |
| app close (`APP_CLOSE_TIMEOUT_MS`) | 10–20 s | **30 s** | `shutdownApp`'s own allowance: 15 s graceful + 10 s `taskkill` = ~25 s, plus margin |
| daemon ready (`DAEMON_READY_TIMEOUT_MS`) | 10 s | **30 s** | a cold Node start + pipe bind + SQLite open on a saturated box |
| terminal output (`TERMINAL_OUTPUT_TIMEOUT_MS`) | 20 s | **30 s** | a 200-iteration `cmd` loop painting through a ConPTY under contention |
| new window (`NEW_WINDOW_TIMEOUT_MS`) | 15 s | **30 s** | a whole second Electron window — renderer, preload and first paint — on a box that has been busy for a quarter of an hour |

Two rules keep this from becoming a habit of enlarging numbers:

- **A timeout here is a HANG DETECTOR, not a performance assertion.** If a test means
  to measure how fast something is, it says so and names the requirement it defends —
  that is what `performance.e2e.ts` is for. A test that fails because the machine was
  busy was never measuring the product.
- **If a spec needs more than these, it is doing too much work for a parallel worker,
  and the tier mechanism applies to it.** Raise the tier, not the number. That is
  exactly how `terminal-find` and `terminal-scrollback-nav` ended up in the serial
  tier: they still failed at a 30 s terminal-output budget, so they stopped running at
  six workers instead of earning a fourth increase.

**The measured effect**, on the sixteen files that were failing, at six workers with
retries off: **20 passed / 14 failed** before, **38 / 0** after.

### The filesystem-poll sweep FILE_OP_TIMEOUT_MS asked for (spec 035)

`FILE_OP_TIMEOUT_MS`'s own docblock deferred a sweep and predicted its consequence:

> roughly a dozen other spec files poll for a filesystem effect on the same 10s budget. They did not
> flake in this run, which is not the same as being right.

One of them then flaked. **32 polls across 13 spec files** now pass `{ timeout: FILE_OP_TIMEOUT_MS }`
instead of inheriting the 15 s assertion budget. Only polls whose predicate calls a `read*(…)` helper
were touched — a poll on a locator or on in-memory state is a different question and was left alone.

**It fixes nothing on its own, and that is stated rather than discovered later.** The spec that
prompted it, `preferences-reset.e2e.ts:187`, is issue #284, and the measurement there is what
matters: it passes in **~760 ms** or exhausts the whole budget. A poll that is bimodal is not waiting
on a slow disk, so the budget was never its problem — raising it changed the failure from 15 s to
30 s and nothing else.

The sweep is kept because it is right for the case the budget exists for — a real `rename` on a real
disk with a watcher waking up behind it — not because it made a red go green.

### The sixth clock, and the route the first five did not cover (spec 035)

034 sized its five against **concurrency** — six Electron apps at once. The sixth was found by a
different failure: `theme-flash.e2e.ts:92` failed a full-gate SERIAL tier, at one worker, on
`app.waitForEvent('window', { timeout: 15_000 })`, and passed on retry.

Measured with retries off, in isolation: **0 failures in 6 runs at one worker, and 0 in 6 at six.**
It does not fail on a quiet box at any worker count. It failed once, seventeen minutes into a serial
tier, on a machine that had already run the parallel tier — so the load that broke it was not
concurrent, it was *cumulative*.

The number itself had no derivation. Sixty-eight `waitForEvent('window')` calls in this suite pass
no timeout and inherit the config's; **eight** pass one, and all eight pin 15 seconds — making them
stricter than the suite's own default, and stricter than its 15 s assertion budget, for the single
most expensive thing a test can ask for. A round number, copied across three files.

Thirty seconds is the same answer `DAEMON_READY_TIMEOUT_MS` gives to the same question, and it is a
hang detector on the same terms: a window that never opens still fails, still inside the 60 s test
budget, and still says "no window appeared".

### Mechanism identifies candidates; measurement decides which need the tier

Worth stating because the obvious inference from the above is wrong and was tried.
Classifying every spec by mechanism gives 88 parallel / 49 real-shell / 98 focus, and
moving all 49 real-shell specs to a two-worker tier was **modelled at ~45.4 minutes
against ~40.3** for the current arrangement — slower, because 28 of the 41 real-shell
specs in the parallel tier run perfectly well at six workers. Only 13 ever failed, and
right-sizing the budgets fixed 11 of those.

This is the other half of the rule already stated above about not drawing the line
from observed failures alone. The mechanism tells you which specs *could* need the
tier. Only measurement tells you which ones *do*.

### Getting the measurement: per-file durations

Every claim on this page about what a spec file costs comes from one command, and it is the same
command whether you are re-drawing the tier boundary, deciding whether a file is worth sharing an
app, or checking that a published figure is still true:

```sh
THRONG_E2E_JSON_OUT=e2e-report.json npm run test:e2e
node scripts/e2e-durations.mjs e2e-report.json
```

The first line is the run you were doing anyway — `THRONG_E2E_JSON_OUT` only asks Playwright to
write its JSON report alongside the usual live log, so the measurement costs nothing extra. The
second prints one row per spec file, most expensive first, with a running share of the total. The
shape, with the numbers left out deliberately — they are whatever your run measured, and quoting
someone else's here is how the figures on this page drifted to half the truth in the first place:

```
<n> spec files, <n> tests, <n> retried
<n> minutes of test time (retries included)

    mins   tests  share  file
    ....       ..    ..%  packages/ui/tests/e2e/<the dearest file>.e2e.ts
    ....       ..    ..%  packages/ui/tests/e2e/<the next one>.e2e.ts
    …
```

Three things about the numbers, because each has misled someone:

- **Retries are included.** A file that passes on its second attempt cost the suite both attempts.
  Reporting only the winning attempt would make the flakiest files look like the cheapest, which is
  exactly backwards for a number used to decide tier assignment.
- **The share column is cumulative**, so it answers "how few files do I have to fix to matter?"
  directly. In this suite the answer has consistently been "about fifteen".
- **It measures test time, not wall-clock.** At six workers the wall-clock is far lower than the
  total; the two tiers run at different worker counts, so only a whole-run stopwatch gives the
  figure quoted at the top of this page.

It works on a partial run too — `npx playwright test some-spec.e2e.ts` with the same env var — which
is the cheap way to check whether one file got faster without paying for the suite.

### Keep the `.e2e.ts` on the filter, or you run all 207 files

**A positional filter that drops the suffix silently selects the ENTIRE suite.** Measured on
2026-08-26 with `--list`, so nothing had to be run to find it:

| Command | Selects |
|---|---|
| `npx playwright test editor-status-bar` | **573 tests in 207 files** — the whole suite |
| `npx playwright test editor-status-bar.e2e.ts` | 2 tests in 1 file |
| `npx playwright test packages/ui/tests/e2e/editor-status-bar.e2e.ts` | 2 tests in 1 file |

The failure is quiet in the worst way: the command is accepted, the run starts, and the only symptom
is that it takes eighteen minutes instead of twenty seconds. It cost a full 25.8-minute run in the
session that found it — a run whose *result* was meaningless, because it was answering a question
nobody had asked.

**So always pass the suffix, and prefer the full path.** `--list` settles it in seconds and launches
nothing, which makes it the cheap habit worth having before any long run:

```bash
npx playwright test <your filter> --list | tail -1     # "Total: N tests in M files"
```

If that line says 207 files, the filter did not do what you think.

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

## The global OS resources a run must never write

Temp files, config roots and user-data dirs are all isolated per launch, and the
sections above cover them. The harder cases are the resources that have exactly
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
