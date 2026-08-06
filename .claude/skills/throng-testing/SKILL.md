---
name: throng-testing
description: Run throng's tests and hands-on sessions without leaving processes behind. Use this EVERY time you are about to run E2E tests, launch the app to check something by hand, or drive a real terminal — and use it the moment something is "still running", a data folder will not delete, a port or pipe is taken, a test hangs on teardown, or a run behaves differently from the last one for no visible reason. Also use it when choosing WHICH layer to test at (unit vs integration vs E2E vs a real hands-on session), and when an E2E passes but the app still misbehaves for the user.
---

# Testing throng without leaving a mess

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

Reach for the cheapest layer that can actually answer the question:

| Question | Layer | Why |
|---|---|---|
| Does this pure decision hold? | `vitest --project unit` (seconds) | No app, no daemon, no cleanup |
| Do two components agree? | `--project integration` / `--project contract` | Still no app |
| Does the user-visible behaviour hold? | Playwright E2E | Real app, real daemon, real cost |
| Does it work with a REAL program (claude, vim)? | E2E driving that program | The only layer that can answer it |

```bash
npx vitest run --project unit --project integration --project contract
npx playwright test packages/ui/tests/e2e/<spec>.e2e.ts --workers=1
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

Check a failure against `master` before assuming you caused it. These fail there too:
`editor-feedback3`, `editor-move-repoint` (AC6), `editor-undo-recovery`, `error-dismiss`,
`terminal-persistence`, `terminal-reattach`, `titlebar-chrome`. A green CI is also not proof for
`@admin` specs, which only verify when elevated.
