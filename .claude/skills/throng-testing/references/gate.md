# `npm run gate` in detail

Read when you need the reasoning behind the gate — its stage order, why it runs hosted, why the self-hosted VM was retired, and what it clears. The dispatch-and-watch loop itself is in SKILL.md.

Part of the `throng-testing` skill; the contributor overview is [`docs/testing.md`](../../../../docs/testing.md).

## `npm run gate` — the one command that says the work is done

**It runs on the gate runner, not on a workstation.** Dispatch it against a ref and wait:

```bash
gh workflow run gate.yml --ref <branch>
gh run watch <run-id> --exit-status        # one blocking watch, expect ~35 min
```

A workstation runs only the tests under the red-green-refactor cursor — one spec, one file, one
project layer. The full gate locally pins every core for the better part of an hour, steals focus
throughout, and eventually exhausts the interactive desktop heap, at which point Windows refuses to
start processes at all. It is not a faster route to the same answer.

**While fixing one red stage, run one stage.** The gate is fail-fast, so re-running it to reach the
stage that failed spends ~19 minutes re-proving seven green ones:

```bash
gh workflow run gate.yml --ref <branch> -f only=test:contract
```

`only` takes `full gate`, `lint`, `typecheck`, `build`, or any `test:*` stage. The full gate is what
says done; `only` is for getting there.

**Three lanes, two kinds of machine:**

| lane | machine | when |
|---|---|---|
| `ci.yml` — lint, tests, `@core` E2E | GitHub-hosted | Every non-draft PR to master, and dispatch |
| `gate.yml` dispatch — the full gate | GitHub-hosted | On demand |
| `gate.yml` nightly | GitHub-hosted | 01:00 UTC, master only |

**A self-hosted Windows VM was tried for the dispatch lane and retired.** Measured against hosted
over nineteen runs: the CPU-parallel stages were identical (unit 62s both; component 140s vs 144s),
and every single-threaded one was 2.2-3.2x slower (lint 46s vs 16s, typecheck 41s vs 13s, contract
91s vs 33s), for a full gate of ~62 min against ~32. Two of the nineteen runs died mid-job leaving
no log. The one thing it could do that a hosted runner cannot is run the 41 `skipIfElevated()`
sites, because a hosted `windows-2022` runner is an administrator with **UAC disabled** — there is
no filtered token to drop to, so `schtasks /RL LIMITED` has nothing to fall back on and
`runas /trustlevel` produces nothing. That capability did not pay for the other three.

Because the workflow is dispatched against a **ref**, a green run is evidence about that *commit* and
not about a working tree that has moved on since — so quote the run URL and the SHA when reporting
done. The timings throughout this document remain the reference figures, and they are still what a
comparison is measured against; what they no longer describe is the normal route to a verdict.

The runner is reached only by `workflow_dispatch` and `schedule`, neither of which a fork can trigger
— see `.github/workflows/gate.yml`, which explains why that exclusion is structural rather than a
condition someone could weaken.

What the command itself does, wherever it runs:

```
npm run gate
```

Eight stages in CI's order, **fail-fast**: **lint → typecheck → build → unit → component →
integration → contract → e2e**. One line per stage, and it stops at the first failure rather than
reporting a tidy summary of a broken branch.

The order is the point. The cheap stages run first precisely so the expensive one is only ever
reached by code that has already earned it — a full E2E run behind an unverified typecheck spends
half an hour to be told something an eleven-second command already knew.

**Component sits fifth, not last among the cheap stages**, and its position is a decision rather
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
  files / 548 declarations, at the end of spec 035; the figures and their provenance are in [tiers-and-workers.md](tiers-and-workers.md)).
  Never skip it to make the gate finish sooner — that expense is exactly why it is inside the gate
  rather than optional.

  The gap that stood here is closed. Two earlier gate runs at the end of 035 stopped inside a tier
  under fail-fast and timed nothing, and this file said so rather than restating a stale figure; the
  third ran green end to end and is where the number above comes from.
