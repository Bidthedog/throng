---
name: throng-e2e-harness
description: Use for the Playwright-on-Electron E2E suite and the test infrastructure around it — the harness helpers, the shard and parallel plans, the two local tiers, the strict flaky-test gate, @admin and quarantine, temp-file lifecycle, and diagnosing a flake. Triggers include writing or converting an E2E spec, a test that passes on retry, a hung teardown or wedged app, "which layer should this be tested at", a spec that steals focus or drives a real shell, orphaned processes after a run, and CI shard timing or blob-report problems.
---

# throng — E2E suite, harness and flake diagnosis

**Load the `throng-testing` skill before running anything, and `running-tests` before any push.** They
own execution and the no-red-CI rule. This agent owns how the suite is *built* and how a flake is
*diagnosed*.

Reference: `docs/testing.md` (479 lines, read it), `packages/ui/tests/e2e/harness.ts`,
`playwright.config.ts`, `scripts/run-e2e-local.mjs`, `scripts/ci-e2e-shard.ps1`.

## The gate

**A green run means every test passed on its FIRST attempt.** `failOnFlakyTests` is on: a test that
fails then passes turns the run red. Retries default to 2 for their *diagnostic* value only —
disabling them once revealed ten tests failing first-attempt and being reported green.
`THRONG_E2E_RETRIES=0` shows raw first-run results.

A flake is a bug. Stress the one test until it fails on demand, find the actual race, fix it, then
stress it the same number of times again. Never re-run hoping for a different answer.

The constitution distinguishes a **test flake** from an **infrastructure fault** (a worker/global
teardown crash, a wedged app blowing the teardown budget — zero failed, zero flaky, non-zero exit).
Only the infra class has a bounded, evidenced retry path in CI; the test gate never loosens.

## Adding a spec file — three registrations, all enforced

1. `packages/ui/tests/e2e/shard-plan.json` — CI splits by measured duration, not by `--shard`. A spec
   in no group runs nowhere, silently.
2. `packages/ui/tests/e2e/parallel-plan.json` — required if the spec **opens the preferences window,
   drives a context menu, or runs a long-lived real shell**. throng closes menus on blur, so a
   focus-stealing spec makes some *unrelated* test flake; a real-shell spec starves at high worker
   counts.
3. `packages/ui/tests/unit/shard-plan.test.ts` fails the build if a spec is missing, duplicated or
   stale in either plan.

## Writing a spec that does not flake

- Share one app per file with `openApp()` in `beforeAll` + `test.describe.configure({ mode: 'serial'
  })`. Keep `runApp` (imported as `runOwnApp`) only where the test **seeds state before launch** — a
  config root, a pre-populated database, `skipDaemon`. **Never let a shared-app shim accept launch
  options**: a swallowed option makes a test pass for the wrong reason. Give shared projects unique
  names.
- `settle(win, root?)` as the first statement of any test that later reads raw state — a *negative*
  opening assertion is satisfied vacuously by an unrendered DOM. The preferences root is
  `.prefs-root`.
- `geom(locator)` for geometry (polls until the element stops moving); never
  `page.evaluate(() => querySelector(...).getBoundingClientRect())`.
- `focusEditor(win, panelId)` before typing into an editor — CodeMirror adds `.cm-focused` a beat
  after the click lands.
- `commitPanelRename(win)` / `commitTabRename(win)` instead of a bare `Enter`.
- **Never send a key at a control you have not asserted is there.** A blind `Enter` goes to whatever
  holds focus — typically inserting a newline into the fixture — and the test then dies on an
  assertion that names the feature under test. That failure is a lie and will cost you an hour in the
  wrong file.
- Prefer `toBeVisible` / `toHaveCount` / `expect.poll` over `waitForTimeout`.
- Process-level assertions for terminal work: `conhostChildren`, `expectNoOrphanConhosts`,
  `daemonPid`, `killAppSpawnedDaemon`, `forceKillProcessTree`, `shutdownApp`.

## Environment switches

`THRONG_E2E_TIER` (parallel/serial locally), `THRONG_E2E_WORKERS`, `THRONG_E2E_GROUP` +
`THRONG_E2E_SHARDS` (CI), `THRONG_E2E_RETRIES`, `THRONG_E2E_STEP_MS` (watch a run happen),
`THRONG_E2E_INCLUDE_ADMIN`, `THRONG_E2E_INCLUDE_QUARANTINE`, `THRONG_E2E_CLIPBOARD` (**set it, or a
spec pastes the developer's real clipboard**), `THRONG_INPUT_SOAK` / `_REPS`, `THRONG_CLAUDE_E2E` /
`_ROOT`, `THRONG_E2E_JSON_OUT` / `_BLOB_OUT`.

There is **no headless mode** — Electron specs open real windows.

## @admin vs @quarantine

`@admin` and `skipIfElevated()` mean the environment cannot run it here; the coverage lives elsewhere
(the elevated CI lane). `@quarantine` means the coverage lives **nowhere** — excluded from the default
run, never deleted, never `test.skip`-ped, with a written justification in
`specs/017-icon-tooltip-flake-fixes/e2e-audit.md`. Only quarantine counts as lost coverage.

## Temp files

Everything scratches under one `%TEMP%/throng_e2e_<runhash>/`. A clean run leaves nothing; a crash
keeps the folder and prints its path. Tests self-clean (Principle V) — a green bar must not leave
orphaned artifacts. `cleanupTemp` and `scripts/residue-scan.mjs` exist for this.

## Choosing a layer

E2E is the most expensive answer to any question. Unit for pure logic, integration for real processes
and files (the ~40 `*.integration.test.ts` are the right home for daemon and editor semantics),
contract for "does this implementation satisfy the interface", E2E for what the user sees — and it is
**mandatory** for any user-facing UI change (Principle V).

## Not yours

CI workflow shape, runner setup and release gates → `throng-build-release`. Product fixes the tests
reveal → the owning area agent.
