<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at specs/040-editor-status-bar-and-gutter/plan.md
<!-- SPECKIT END -->

## Verifying done-ness

**`npm run gate` is the only thing that establishes work is done.** Not a green unit run, not a
passing spec, not "the tests I changed pass" — those are progress, and reporting one as done-ness is
the specific mistake this rule exists to stop.

It runs the eight gating stages in CI's order, fail-fast: **lint → typecheck → build → unit →
component → integration → contract → e2e**. Component sits fifth, immediately after unit and
before the OS-heavy layers, on purpose — it is the
second-cheapest layer (jsdom, no app, no daemon, no shell) and it now carries assertions that used to
cost an Electron launch each, so running it after the OS-heavy layers would spend minutes to learn
something available in seconds. It prints one line per stage, stops at the first failure, and clears
the app/daemon/pty-agent/Playwright processes a run leaves behind — on success, on failure, and on
Ctrl+C.

```
npm run gate
```

Three rules about using it:

- **Fail-fast means stop, fix, re-run — not read on.** When a stage fails the gate cancels the run.
  Fix that failure before anything else, using the **running-tests** skill to re-run only what failed
  and **throng-testing** when the failure is an E2E flake rather than a defect. Do not queue up more
  work on top of a red gate.
- **Never bypass the E2E stage to make the gate finish sooner.** E2E is ~18 minutes locally (measured
  2026-08-20 at 207 spec files / 548 declarations; see `docs/testing.md`), and that expense is
  exactly why it is inside the gate rather than optional:
  the cheap stages run first precisely so the expensive one is only ever reached by code that has
  already earned it. Running the individual `npm run test:*` scripts while iterating is fine and
  expected — it is claiming *done* off the back of them that is not.
- **A green gate goes stale the moment you edit.** Quote the actual stage summary when reporting
  done, and re-run if anything changed after it.

## Formatting is ESLint's job — never run Prettier here

**This repo has no Prettier configuration, and `prettier --write` must not be run in it.** The only
formatter is `npm run lint` (`eslint .`); there is no `format` script and no `.prettierrc`.

That absence is exactly what makes the mistake expensive rather than harmless. With no config to
read, Prettier applies *its own* defaults — which include double quotes, where this codebase uses
single — so a single `prettier --write` over a glob rewrites every string delimiter in every file it
touches, in a diff that looks deliberate and reviews as noise. Measured once: **~230 files
reformatted** from one command aimed at four, which then had to be reverted with
`git checkout --` and the real edits re-applied by hand.

The pull towards it is real and worth naming: a scripted edit lands with awkward wrapping, and
reaching for a formatter to tidy it is the obvious next move. Re-indent the lines you actually
changed, or let ESLint do it.

## Before you add a requirement, find the one that already governs it

**A requirement that changes existing behaviour needs a search for the requirement that already
describes that behaviour — in `specs/*/spec.md` and in the tests — before it is written down.**

Not a general plea for care. Spec 032 added a rule that a settings write preserves keys the schema
does not model, reasoned from its own guarantee, and wrote a test asserting it. **019 FR-023 required
the opposite for a RETIRED key**, had shipped two releases earlier, and
`preferences-settings.e2e.ts:299` asserts it with the mechanism spelled out in its own comment. The
contradiction surfaced a full serial-tier E2E run later, and the fix was to revert the new rule, the
production change behind it, and four tests written to match.

Two details in that account were wrong for a year, and both are the mistake this section is about.
**It is 019, not 007** — 007 FR-023 is the "Reset to Defaults" control, and 007 states no rule about
unmodelled keys at all. And **019 FR-023 is narrow**: a persisted `explorer.openMode` is dropped
rather than migrated, because the key was retired and never had any effect, so dropping preserves the
behaviour the user has today while migrating would change it. It does not govern hand-added keys in
general, and `packages/core/tests/unit/settings-validity.test.ts:57` says the opposite of those in as
many words — *"A hand-added key is legitimate — the write path preserves it."*

So the two rules never contradicted each other in general; they collided on one retired key. Which
makes the lesson sharper rather than weaker: a citation is part of the claim, and one that is off by
a spec number sends the next reader to a requirement that says something else entirely — which is
exactly how the wrong rule got written in the first place.

The search is cheap and the failure is not:

```sh
grep -rn "<the behaviour, in the repo's words>" specs/*/spec.md
git grep -n "<the observable>" -- packages/*/tests
```

Two things make this specific mistake likely, so treat both as the trigger to search:

- **The behaviour looks like an oversight rather than a decision.** Unmodelled keys being dropped
  reads as carelessness until you find the requirement that asked for it.
- **You are reasoning from a guarantee you just wrote.** A new FR is the newest thing in the room and
  the easiest to over-apply; the older requirement is the one with shipped code behind it.

An older requirement that genuinely should change is a **supersession** — stated as one, in the new
spec, naming what it replaces and why (021 FR-042 over 007's modality is the worked example). What is
never acceptable is contradicting it silently and finding out from a red suite.

## One condition, one notice

**A single condition raises a single notice, and the actions that resolve it live on that notice.**

Spec 032 shipped an invalid JSON document as three: an inline banner, a toast when a tab switch was
refused, and a strip at the top of the window when a close was refused. One state, three wordings, in
three places — and two of them told the user they could not leave while a *Discard* button sat a few
pixels away making that untrue.

The rules that fell out of it, in the order they matter:

- **One surface per condition.** If a second caller wants to report the same state, it makes the first
  one louder — flash it, do not raise another.
- **The report belongs to whatever OWNS the state**, not to whichever caller happened to bounce off
  it. That is the structural half: with each caller reporting for itself, every exit added later
  raises one more notice.
- **Say what is wrong, not what the user may not do.** "You cannot leave" is a claim about the user's
  options, and it is false the moment an escape exists.
- **Inline, not a toast, for anything with an action attached.** A toast cannot carry a button here,
  and a message that names a remedy the user cannot reach from it is worse than no message.

## Specialist agents

`.claude/agents/` holds eleven repo-local subagents, one per area of this codebase — core/DI, daemon
and persistence, terminals and PTY, renderer, editor, config and preferences, explorer and file ops,
failure presentation, E2E harness, spec governance, build and release. Each carries that area's file
map, the constitutional rules that bind it, and the traps it has already produced. Delegate to the
owning agent rather than re-deriving an area from scratch; see `.claude/agents/README.md` for the
routing table and how they defer to skills.

## E2E on CI

**Run it locally before you push it.** The full local suite is about **18 minutes**
(`npm run test:e2e`; measured 2026-08-20 at 207 spec files / 548 declarations, at the end of 035 —
parallel tier 2.4 min at 6 workers, serial tier 15.7 min at 1). Against the pre-034 baseline of 46.9
minutes that is a **61% cut**. The serial tier is **86% of the runtime** and is menus, preferences
windows and real shells, which is the work that cannot move down a layer — so that ratio, rather than
the total, is the number worth watching. Every timing here names its measurement; see
`docs/testing.md`. Pushing to find out whether something works spends other people's runner minutes
to learn what one local command would have told you — and CI is slower to answer, not faster.

**One thing that measurement cost, and it is worth knowing the machine can do it.** The gate run
before the green one failed on a scope column reading `Everywhere` where the source says
`EDITOR_ONLY` — a STALE `packages/core/dist`, which `tsc -b`'s incremental buildinfo believed was
current. It is invisible to every cheap rung by construction: **vitest resolves `@throng/core` to
source, the Electron app loads `dist`**, so unit and component tests all agreed while every E2E ran
against an app that did not. If an E2E disagrees with a unit test about a constant, check the emitted
file before the code: `rm packages/core/tsconfig.tsbuildinfo`, `rm -rf packages/core/dist`, rebuild.

CI does not run the full suite on a push. It runs the **`@core` lane** — capped at 50 tests, one
job, one worker. The rest runs in the release lane before an installer is built. See *Two lanes* in
`docs/testing.md`.

There is exactly one thing local runs cannot tell you, and it is worth knowing precisely: **a
developer machine is normally NOT elevated, and GitHub's runners always are.** So anything whose
behaviour depends on administrator rights — the `skipIfElevated()` specs, the `@admin` suite, the
de-elevation path — behaves differently in the two places, and only CI can settle it. Everything
else must be green locally first.

### Testing something that only CI can answer

Just push. Every job runs on every push, and `E2E (@core)` is four to five minutes.

**There used to be a `[ci-admin-only]` marker** that skipped the E2E lane so an elevated-path change
did not pay for it. It is gone, and the arithmetic is why: it existed to avoid spending
~36 runner-minutes on three 12-minute shards, and FR-057 deleted the shards. What it would skip now
is one short job — while making the gating lane something a commit message can switch off. A
required check that a commit message can disable is not a check.

### Every E2E test carries two tags

A significance tag — **`@core`** (gates every push, capped at **50**) or **`@extended`** (the release
lane) — and a category tag: `@boot @terminal @editor @explorer @prefs @window @persistence
@failure`. `packages/ui/tests/unit/e2e-tags.test.ts` fails the build for a test carrying neither,
because selection is by `--grep` composed with `grepInvert`: an untagged test runs in NEITHER lane,
silently.

`packages/ui/tests/e2e/e2e-budget.json` is a ratchet and fails **both** ways — over budget, and under
it without the budget being re-seeded. Re-seed it in the same commit that removes a test.

**Sharding is gone (spec 034).** CI used to split the suite across three runners from a measured
plan; three shards means paying the fixed `npm ci` + build toll three times, which only pays when the
work being split is large. A lane capped at 50 tests is not. `shard-plan.json` and its guard are
deleted; `tier-plan.test.ts` is what survived, and it guards the local tiers.

### Two tiers locally, one job on CI

`npm run test:e2e` runs the parallel tier at several workers, then the serial tier
at one. The serial tier is roughly two-thirds of the wall-clock and is the reliable
half; see the Budgets section of `docs/testing.md` before assuming a red at six
workers is a defect.

**Adding a spec that opens the preferences window or drives a context menu means
adding it to `packages/ui/tests/e2e/parallel-plan.json`.** `tier-plan.test.ts`
fails the build if you don't: such a spec steals focus, and throng closes menus on
blur, so it would make some *unrelated* test flake. The same applies to a spec that
drives a long-running real shell, which starves at high worker counts.

CI is deliberately different — one worker, one job, no tiers. See `docs/testing.md`.

### A shared app per file, where the tests allow it

Every `runApp()` is an Electron launch, a daemon and often a real shell — around two seconds on CI.
Where a file's tests do not seed state *before* the app starts, share one app via `openApp()` in
`beforeAll`; see `docs/testing.md`. A test that needs a seeded config root or database keeps its own
app and says so with `runOwnApp`.
