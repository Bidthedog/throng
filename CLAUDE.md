<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at specs/032-settings-write-integrity/plan.md
<!-- SPECKIT END -->

## Verifying done-ness

**`npm run gate` is the only thing that establishes work is done.** Not a green unit run, not a
passing spec, not "the tests I changed pass" — those are progress, and reporting one as done-ness is
the specific mistake this rule exists to stop.

It runs the seven gating stages in CI's order, fail-fast: **lint → typecheck → build → unit →
integration → contract → e2e**. It prints one line per stage, stops at the first failure, and clears
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
- **Never bypass the E2E stage to make the gate finish sooner.** E2E is ~21 minutes locally and ~36
  runner-minutes on CI, and that expense is exactly why it is inside the gate rather than optional:
  the cheap stages run first precisely so the expensive one is only ever reached by code that has
  already earned it. Running the individual `npm run test:*` scripts while iterating is fine and
  expected — it is claiming *done* off the back of them that is not.
- **A green gate goes stale the moment you edit.** Quote the actual stage summary when reporting
  done, and re-run if anything changed after it.

## Before you add a requirement, find the one that already governs it

**A requirement that changes existing behaviour needs a search for the requirement that already
describes that behaviour — in `specs/*/spec.md` and in the tests — before it is written down.**

Not a general plea for care. Spec 032 added a rule that a settings write preserves keys the schema
does not model, reasoned from its own guarantee, and wrote a test asserting it. **007 FR-023 required
the exact opposite**, had shipped two releases earlier, and `preferences-settings.e2e.ts` asserted it
with the mechanism spelled out in its own comment. The contradiction surfaced a full serial-tier E2E
run later, and the fix was to revert the new rule, the production change behind it, and four tests
written to match.

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

**Run it locally before you push it.** The full E2E suite takes about 10 minutes locally
(`npx playwright test`) against roughly 12 minutes per shard on CI, three shards in parallel. Pushing
to find out whether something works spends other people's runner minutes to learn what one local
command would have told you — and CI is slower to answer, not faster.

There is exactly one thing local runs cannot tell you, and it is worth knowing precisely: **a
developer machine is normally NOT elevated, and GitHub's runners always are.** So anything whose
behaviour depends on administrator rights — the `skipIfElevated()` specs, the `@admin` suite, the
de-elevation path — behaves differently in the two places, and only CI can settle it. Everything
else must be green locally first.

### Testing something that only CI can answer

Put **`[ci-admin-only]`** anywhere in the commit message. The three E2E shards and the merged report
are skipped; lint, the unit layers and `E2E (@admin, elevated)` still run. That turns a ~36
runner-minute round trip into about 4.

```
git commit -m "fix(025): de-elevated agent keeps the panel's cwd [ci-admin-only]"
```

Skipping is opt-IN on purpose. Forgetting the marker costs runner minutes; forgetting to ask for the
full suite would let a branch merge unverified, which is the more expensive mistake.

**Run the full suite before merging** — drop the marker (or push any commit without it) so all three
shards run, and let them go green before the PR comes out of draft.

### Shards are planned, not sorted

CI does not use Playwright's `--shard`. That splits by test COUNT in file order, so the alphabet
chose the split and every `terminal-*` spec landed in one third — measured at 3.7, 8.3 and 36
minutes, the last killed by a job timeout. `packages/ui/tests/e2e/shard-plan.json` assigns files to
groups from measured durations instead (9.2 minutes each).

**Adding a spec file means adding it to that plan.** `packages/ui/tests/unit/shard-plan.test.ts`
fails if a spec is missing, duplicated or stale, because a spec in no group runs nowhere and does so
silently.

### Two tiers locally, three shards on CI

`npm run test:e2e` runs the parallel tier at several workers, then the serial tier
at one — about 21 minutes, against ~35 for the old single-worker arrangement.

**Adding a spec that opens the preferences window or drives a context menu means
adding it to `packages/ui/tests/e2e/parallel-plan.json`.** `shard-plan.test.ts`
fails the build if you don't: such a spec steals focus, and throng closes menus on
blur, so it would make some *unrelated* test flake. The same applies to a spec that
drives a long-running real shell, which starves at high worker counts.

CI is deliberately different — one worker per shard, no tiers. See `docs/testing.md`.

### A shared app per file, where the tests allow it

Every `runApp()` is an Electron launch, a daemon and often a real shell — around two seconds on CI.
Where a file's tests do not seed state *before* the app starts, share one app via `openApp()` in
`beforeAll`; see `docs/testing.md`. A test that needs a seeded config root or database keeps its own
app and says so with `runOwnApp`.
