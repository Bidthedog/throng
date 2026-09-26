# Test environment variables

Read when a run needs a knob turned — a tier, a worker count, retries off, an opt-in suite — or when
a spec's behaviour depends on a `THRONG_*` variable the harness sets. The public list, one line each,
is `docs/environment.md`; this file holds the detail.

Part of the `throng-testing` skill; the contributor overview is [`docs/testing.md`](../../../../docs/testing.md).

## The catalogue

Where a variable has its own section below or in another reference, that is its home.

| Variable | What it does | Detail |
|---|---|---|
| `THRONG_E2E_TIER` | `parallel` or `serial`: run one local tier on its own | [tiers-and-workers.md](tiers-and-workers.md) |
| `THRONG_E2E_WORKERS` | Playwright worker count for the E2E layer (default 6; 2 when elevated) | [tiers-and-workers.md](tiers-and-workers.md#throng_e2e_workers--parallel-workers) |
| `THRONG_E2E_RETRIES` | Retry count (default 2, diagnostic only); `0` shows raw first-attempt results | [flakes.md](flakes.md) |
| `THRONG_E2E_FAIL_FAST` | `1` stops `run-e2e-local.mjs` at the first failing test; `npm run gate` sets it | `scripts/run-e2e-local.mjs` |
| `THRONG_E2E_INCLUDE_ADMIN` | Opts the `@admin` specs back in (the config otherwise `grepInvert`s them) | [elevation.md](elevation.md) |
| `THRONG_E2E_INCLUDE_QUARANTINE` | Opts the `@quarantine` specs back in | [quarantine.md](quarantine.md) |
| `THRONG_E2E_IGNORE_ELEVATION_GUARD` | `1` runs `skipIfElevated()` tests anyway — an audit hatch that only ever adds tests | [elevation.md](elevation.md) |
| `THRONG_DEELEVATE_FORCE` | `1` exercises `scripts/run-deelevated.ps1` from an ordinary shell | [elevation.md](elevation.md) |
| `THRONG_E2E_JSON_OUT` | Path for Playwright's JSON report, alongside the live log; feeds `scripts/e2e-durations.mjs` | [measuring-durations.md](measuring-durations.md) |
| `THRONG_E2E_TRACE` | Records a Playwright trace per test; off by default, set by the release lane | `packages/ui/tests/e2e/harness.ts` |
| `THRONG_E2E_STEP_MS` | Pause between the steps of an opted-in spec, to watch a run | below |
| `THRONG_E2E_CLIPBOARD` | `memory` swaps in an in-process clipboard; set by the harness, and also its "this is a test run" marker | [global-os-resources.md](global-os-resources.md) |
| `THRONG_TEST_SHELL_HISTORY` | `off` asks each shell a run opens to persist no history; set by the harness | below, and [global-os-resources.md](global-os-resources.md) |
| `THRONG_E2E_FOREGROUND_HANDOFF` | `1` re-enables the foreground-window hand-off the harness otherwise turns off (#199) | `packages/ui/src/main/composition-root.ts` |
| `THRONG_NO_ORPHAN_REAP` | `1` stops a test daemon sweeping sibling test daemons' trees; set by the harness | `packages/daemon/src/reap-orphans.ts` |
| `THRONG_FAKE_ELEVATED` | `1` makes main report itself elevated, for the run-as-admin UI | `packages/ui/src/main/terminal-ipc.ts` |
| `THRONG_NON_REFERENCE_HARDWARE` | `1` records SLA ceilings instead of asserting them on this machine | [performance-sla.md](performance-sla.md) |
| `THRONG_CLAUDE_E2E` | `1` opts in the specs that drive the real `claude` binary | below |
| `THRONG_CLAUDE_E2E_ROOT` | An existing project for those specs to open instead of a fresh temp directory | below |
| `THRONG_CLAUDE_PROJECT` | The real project (with Claude sessions) `terminal-claude-keys.e2e.ts`'s tab-switch case borrows; defaults to `D:\git\throng` | `packages/ui/tests/e2e/terminal-claude-keys.e2e.ts` |
| `THRONG_INPUT_SOAK` / `THRONG_INPUT_SOAK_REPS` | `1` opts in the keystroke soak; repetitions default to 50 | below |
| `THRONG_TEST_RUN_DIR` | The per-run scratch parent every layer writes under | [temp-files.md](temp-files.md) |
| `THRONG_TEST_RUN_OWNED_DIR` | Set by Playwright's global setup when it created that parent, so teardown removes it | [temp-files.md](temp-files.md) |

The harness also sets the app's own `THRONG_CONFIG_ROOT`, `THRONG_DATABASE_PATH` and
`THRONG_PIPE_NAME` for every launch; those are app variables, documented in `docs/environment.md`.

`THRONG_E2E_GROUP`, `THRONG_E2E_SHARDS` and `THRONG_E2E_BLOB_OUT` no longer exist — they went with
sharding (spec 034; see the comment in `playwright.config.ts`).

## `THRONG_TEST_SHELL_HISTORY` — the shells a run opens keep no history

Set to `off` by `harness.ts` for every app it launches, so a run never writes the developer's own
shell history. It has a section of its own because the reasoning is about a shared OS resource
rather than about a knob: see [The global OS resources a run must never write](global-os-resources.md),
which covers what it does per shell and why the clipboard sits beside it.

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
