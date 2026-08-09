# Quickstart: Validating Failure-Path Integrity

**Feature**: 029 | **Date**: 2026-08-07

How to prove 029 works, in the order that gets you a signal fastest. The four E2E specs already exist
and already fail — they are the acceptance criteria, not something to write later.

## Prerequisites

```bash
npm ci          # once
npm run build   # the daemon dist + BUILD_ID the daemon-spawning layers need
```

Run non-elevated. All four specs call `skipIfElevated()` — an elevated daemon routes terminals
through the de-elevated agent, a different process tree from the one these assertions describe.

## The fast loop (seconds)

Pure logic first — classification, message wording, suppression keys and the daemon state machine are
all pure and need no app:

```bash
npx vitest run --project unit packages/core/tests/unit/failure-cause.test.ts
npx vitest run --project unit packages/core/tests/unit/daemon-state.test.ts
```

## The layers CI gates on (minutes)

```bash
npm run test:unit          # baseline: 207 files / 1688 tests
npm run test:integration   # baseline: 70 files / 371 tests
npm run test:contract      # baseline: 17 files / 62 tests
```

## The acceptance criteria (about 4 minutes for these four)

```bash
npx playwright test \
  packages/ui/tests/e2e/terminal-launch-failure-config.e2e.ts \
  packages/ui/tests/e2e/project-missing-root-wedge.e2e.ts \
  packages/ui/tests/e2e/fileop-lock-cause.e2e.ts \
  packages/ui/tests/e2e/daemon-death-notice.e2e.ts \
  --workers=1 --retries=0
```

**Before 029: 5 failures, every one on a `RED`-labelled assertion. After 029: 5 passes.**

SC-007 is the criterion that matters here — they must pass **without their assertions being
weakened**. Check `git diff` on those four files: the only legitimate edits are removing a `.soft`
(once a suite is expected green, a soft assertion hides a regression) and the `[MEASURE-*]` logging.
An edit that loosens a matcher is a fix declared rather than made.

## The neighbours that must not break

029 changes revert-on-failure behaviour, so these four are the regression fence:

```bash
npx playwright test \
  packages/ui/tests/e2e/terminal-revert.e2e.ts \
  packages/ui/tests/e2e/terminal-slow-start.e2e.ts \
  packages/ui/tests/e2e/terminal-persistence.e2e.ts \
  packages/ui/tests/e2e/notice-stacking.e2e.ts \
  --workers=1 --retries=0
```

`terminal-persistence.e2e.ts:81` is the sharp one: it asserts the OPPOSITE of #204 for a missing
*flavour*, deliberately. If it goes red, FR-003's distinction was not drawn — the fix generalised
where it should have discriminated.

`notice-stacking.e2e.ts` is the other: it proves two *different* failures are two notices. If it goes
red, FR-019's suppression is keyed on something too coarse.

## The whole suite, before pushing

```bash
npm run test:e2e      # two tiers, ~21 minutes
```

Nothing is pushed until this is green — three CI shards cost ~36 runner-minutes to tell you what one
local command already knows.

## Checking it by hand

The failure paths are all reachable without special tooling:

| Scenario | Setup |
|---|---|
| Terminal keeps its config | Configure a terminal, quit throng, rename the project folder, launch, quit, rename it back, launch |
| Blocked rename, third-party holder | Open a folder inside the project in OS Explorer, then rename that folder from the tree |
| Blocked rename, throng's own holder | In a terminal panel, `cd` into a subfolder, then rename that subfolder from the tree |
| Missing project root | Quit throng, rename a project's folder away, launch, enter that project |
| Dead daemon | With throng running and a terminal open, end the daemon process in Task Manager |
