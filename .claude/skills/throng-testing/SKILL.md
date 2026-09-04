---
name: throng-testing
description: Run throng's tests and hands-on sessions without leaving processes behind. Use this EVERY time you are about to run E2E tests, launch the app to check something by hand, or drive a real terminal — and use it the moment something is "still running", a data folder will not delete, a port or pipe is taken, a test hangs on teardown, or a run behaves differently from the last one for no visible reason. Also use it when choosing WHICH layer to test at (unit vs integration vs E2E vs a real hands-on session), and when an E2E passes but the app still misbehaves for the user.
---

# Testing throng without leaving a mess

## Where a test is allowed to run

Two rules. The second is the one that gets broken, and it gets broken by someone who has read the
first and is being reasonable.

**The workstation runs only the tests under the red-green-refactor cursor.** A handful of files, at
the lowest layer that reproduces the behaviour — which is what *Choosing the layer* below already
argues for, now with a boundary attached. Running one spec, one project or one file while iterating
is exactly right and needs no justification.

**The full suite runs on the gate runner. Always.** Not "preferably", not "when the machine is
free". `npm run gate` locally pins every core for the better part of an hour, steals focus for the
whole duration, and — measured — exhausts the interactive desktop heap after a few hundred Electron
launches, at which point Windows refuses to start processes at all (`0xC0000142`, surfacing in
Playwright as *"Process failed to launch"*).

### The loop

Red-green-refactor happens **here**. The green bar that says the work is DONE happens **there**.
Those are different questions and they get different machines.

```bash
# 1. Iterate locally — one file, one project, seconds per cycle.
npx vitest run --project unit packages/core/tests/unit/<the-one>.test.ts

# 2. Push, then ask the runner for the verdict.
git push
gh workflow run gate.yml --ref "$(git branch --show-current)"

# 3. Wait on it. ONE blocking watch, never a poll loop of short turns.
sleep 10
RUN=$(gh run list --workflow=gate.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN" --exit-status
```

Say the expected cost in one line before starting the watch: *"Waiting on gate run `<id>`, expected
75-90 min."* `--exit-status` makes the command fail on a red gate, so it can be trusted as a gate
rather than read as a report.

### When one stage is red, run one stage

The gate is fail-fast, so re-running it to reach the stage that failed spends ~19 minutes re-proving
seven green ones. That was measured twice, learning one number each time.

```bash
gh workflow run gate.yml --ref "$(git branch --show-current)" -f only=test:contract
```

`only` takes `full gate`, `lint`, `typecheck`, `build`, or any `test:*` stage. Use it while fixing;
take the full gate once at the end, because that is the run that says done.

### What a green run does and does not prove

**It is triggered against a REF**, so it proves that *commit* — not a working tree that has moved on
since. Quote the run URL and the SHA when reporting done, not just the stage summary.

**Performance SLAs are not adjudicated there.** The runner is not reference hardware, so those five
ceilings are recorded rather than asserted — see *Where a performance SLA is measured* in
`docs/testing.md`. A green gate is not a statement about the product's speed.

The tempting thought is *"just this once, locally, it'll be quicker"*. It will not be quicker. It
will be ninety minutes during which nothing else on the machine works, which is the entire reason
the runner exists.

### Which lane runs where

| lane | machine | when |
|---|---|---|
| `ci.yml` — lint, tests, `@core` E2E | GitHub-hosted | Every push to master, every PR |
| `gate.yml` dispatch — the full gate | Self-hosted runner | On demand, the loop above |
| `gate.yml` nightly | GitHub-hosted | 01:00 UTC, master only |

The nightly is hosted deliberately: an unattended health check must not depend on one machine being
powered on and logged in, because a nightly that goes quiet looks exactly like one that keeps
passing.

## The thing that catches everyone

throng's daemon is **designed to outlive its window** (Principle III — terminals keep running when the
UI closes). So a finished E2E run, or an app you closed, routinely leaves behind:

- `node …/packages/daemon/dist/main.js` — the daemon
- `node …/packages/daemon/dist/pty-agent-entry.js` — its de-elevated helper
- the shells those terminals started, and a `conhost.exe` per shell

They hold the dev data folder open, so the next run either inherits stale state or fails to delete
it. This is not hypothetical: a defect chased for hours turned out to be a daemon left over from a
previous test run, and clearing it made the symptom vanish.

**After any run that launched the app, check.** It takes a second:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*<your-worktree>*' -and $_.CommandLine -match 'daemon|pty-agent|dist.main' } |
  Select-Object ProcessId, Name
```

To clear everything, use the sibling skill **throng-clear-dev-state**, which stops those processes in
the right order (children first, so nothing is orphaned) and removes the dev data folders.

## Closing the app properly

throng asks what to do about running terminals when it closes, and the answer matters:

- **Terminate all** — the clean choice when finishing a test. Nothing survives.
- **Leave running** — keeps the daemon and its terminals alive on purpose. Choose this only when you
  mean to reattach; otherwise it is exactly how orphans accumulate.

A Playwright run that kills the Electron process without that dialog leaves the daemon behind by
design. That is why teardown checking matters more here than in an ordinary web app.

## Choosing the layer

**The lowest layer that can prove the behaviour owes the assertion. This is a rule, not a
preference** — Constitution Principle V, and the build enforces the consequences.

| Question | Layer | Why |
|---|---|---|
| Does this pure decision hold? | `vitest --project unit` (milliseconds) | No app, no daemon, no cleanup |
| What does this component render, focus or announce? | `--project component` (jsdom) | A DOM, no window, no app |
| Do two components agree? Does it persist, reload, survive a restart? | `--project integration` / `--project contract` | Real files, real daemon, no window |
| Can ONLY a running application show it? | Playwright E2E | Real app, real daemon, **real cost** |
| Does it work with a REAL program (claude, vim)? | E2E driving that program | The only layer that can answer it |

**What qualifies for E2E**, and nothing else does: real window lifecycle and multiple windows, focus
and z-order, native menus and dialogs, OS drag-and-drop, PTY/ConPTY keyboard and rendering fidelity,
and process-tree hygiene. If your assertion is not in that list, it belongs lower down.

**Before you write an E2E, answer this in one sentence: what would a unit, component or integration
test be unable to see?** If you cannot answer it, you are writing the test at the wrong layer. Two
tells that you already are: the test drives the UI only to reach a value it then asserts on disk
(that is integration), and the test asserts a computed style, a class, an aria attribute or a focus
move inside one component (that is component).

**Every E2E test carries exactly one significance tag — `@core` or `@extended` — and at least one
category tag.** `@core` gates CI and is capped; `@extended` runs at release. The build fails on a
test that carries neither, and on a suite that exceeds its declared budget. Adding an E2E therefore
means deciding, out loud, whether breaking it would make the product unusable.

**Deleting an E2E is allowed, and it has one rule:** write the replacement at the lower layer, watch
it FAIL against a deliberately broken implementation, then delete. A replacement observed only
passing is not evidence, and a replacement covering part of what the E2E asserted is not a
replacement.

```bash
npx vitest run --project unit --project component --project integration --project contract
npx playwright test packages/ui/tests/e2e/<spec>.e2e.ts --workers=1
```

**Pass the full path, with the `.e2e.ts` — a bare stem runs all 207 files.** `npx playwright test
editor-status-bar` selects **573 tests in 207 files**; add the suffix and it selects 2. Nothing warns
you, because the command is valid and the run starts normally — the only symptom is eighteen minutes
of a suite you did not want, answering a question you did not ask. It has cost that once already.
Check any filter before a long run; `--list` launches nothing:

```bash
npx playwright test <your filter> --list | tail -1     # "Total: N tests in M files"
```

## When an E2E passes but the user says it is broken

This has happened repeatedly, and the reason is nearly always the same: **the harness is not the
app**. `runApp` overrides `THRONG_CONFIG_ROOT`, `THRONG_DATABASE_PATH` and `THRONG_PIPE_NAME`, so a
test never loads the real dev config, the real database, or the real daemon — and it starts from an
empty layout every time.

So when a test disagrees with the user, reproduce under `npm start` conditions instead: launch
`packages/ui/dist/main/main.js` with the environment **unmodified** and drive it with Playwright.
That difference is what finally reproduced a defect five passing tests had missed.

### The environment you launch from leaks into the terminal

If you drive throng from inside a Claude Code session, every `CLAUDE_CODE_*` variable reaches the
`claude` running in the terminal — and it behaves differently: it announces `inherited
CLAUDE_CODE_CHILD_SESSION marker`, and it takes the ALTERNATE SCREEN, which a user's claude does
not. A whole day was lost to this. Every measurement was of a claude in a mode the user is never in,
so a chord that was broken for them worked in every test, and the diagnostics disagreed on
`altBuffer` without either side being wrong.

Strip them before launching anything that will run claude:

```js
const env = { ...process.env };
for (const k of Object.keys(env)) if (/^CLAUDE|^ANTHROPIC/i.test(k)) delete env[k];
```

The tell is in the diagnostics: a real user's claude session shows `altBuffer: false` and NO `1049`
in the mode log. If your run shows `1049`, you are testing the wrong thing.

Other differences worth suspecting, in rough order of how often they have mattered:

1. **Environment** — the harness's `THRONG_*` overrides; env vars inherited from whatever launched
   the test that a user's shell would not have.
2. **A restored layout** — a real project has terminals already running from a previous session; a
   test starts empty.
3. **How a program was started** — a startup command runs before the shell edits a line; a user types
   the command at a prompt, which changes what the shell has negotiated with the terminal by then.
4. **Leftover processes** — see above.

## Measuring what actually reached the program

Assertions on rendered text are weak for terminal work: the screen keeps every earlier attempt, so a
later check can inherit an earlier one's verdict. Two habits fix it:

- **Use a unique token per attempt** (`kilo1z`, `kilo2z`, …) with a distinctive final character, so
  "nothing deleted", "one character deleted" and "the word deleted" are three different observations
  rather than one ambiguous one. Results that flip between runs are usually this, not real flakiness.
- **Read the diagnostics** rather than the screen where you can:

```js
window.__throngTerminalDiagnostics()
```

Per panel it gives reconciliation counts, input written/acked, and the last twenty keypresses with
what throng decided and the exact bytes it sent. In DevTools (F12 in a dev instance), `copy(...)`
puts it on the clipboard and returns `undefined` — that is the helper's return value, not a failure.

## The claude-driven tests

`packages/ui/tests/e2e/terminal-claude-keys.e2e.ts` drives the real `claude` binary. It needs a
logged-in claude and spends a little quota, so it is opt-in and never runs on CI:

```bash
THRONG_CLAUDE_E2E=1 npx playwright test packages/ui/tests/e2e/terminal-claude-keys.e2e.ts --workers=1
```

It pre-accepts claude's folder-trust dialog through `~/.claude.json` and removes the entry afterwards
— without that, every keystroke lands on a modal and the test measures nothing while looking like it
failed.

## Known-failing specs

**There are none. Do not add any.**

This list used to name seven: `editor-feedback3`, `editor-move-repoint` (AC6),
`editor-undo-recovery`, `error-dismiss`, `terminal-persistence`, `terminal-reattach` and
`titlebar-chrome`. Spec 034 measured the suite and all seven pass; the two that had an issue (#251)
were failing to resource starvation, and the other five had no issue at all — they existed only
here, in a file a developer was expected to consult before believing a red.

That is why the list is gone rather than merely corrected. **A register of reds you are supposed to
ignore is not documentation, it is a habit**, and the cost is not the seven specs — it is that a
real failure lands inside a bar people have learned to look past. The 034 baseline found 18 false
results in one run, so the register had never been the true list anyway.

**When a spec fails, it is a defect until measured otherwise.** The measurement is cheap and the
question is nearly always the same one: *does it fail because the machine is busy?*

```bash
# Fails at six workers, passes at one → contention, not a defect.
THRONG_E2E_RETRIES=0 npx playwright test <spec> --workers=1
THRONG_E2E_RETRIES=0 npx playwright test <spec> --workers=6
```

A pass rate that falls as workers rise is starvation; a defect fails the *same* test every time. If
it is starvation, the answer is a budget or a tier — **not** an entry here. See *Budgets* in
`docs/testing.md`, which records the five that were undersized and what each is derived from.

A green CI is still not proof for `@admin` specs, which only verify when elevated.
