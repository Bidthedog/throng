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

## Adding a spec file — two registrations, both enforced

1. **Tag every test in it.** Exactly one significance tag (`@core`, which gates CI and is capped at
   50, or `@extended`, which runs at release) and at least one category tag. A test with neither
   runs in no lane and would disappear silently — the property the deleted shard plan used to guard,
   now checked per test rather than per file.
2. `packages/ui/tests/e2e/parallel-plan.json` — required if the spec **opens the preferences window,
   drives a context menu, or runs a long-lived real shell**. throng closes menus on blur, so a
   focus-stealing spec makes some *unrelated* test flake; a real-shell spec starves at high worker
   counts.

`packages/ui/tests/unit/tier-plan.test.ts` (formerly `shard-plan.test.ts`) fails the build on a stale
or duplicated tier entry, and on a focus-stealing spec left in the parallel tier. There is no shard
plan to register in: 034 FR-057 removed it, and the tier filter now reads the spec universe from disk.

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

**The lowest layer that can prove the behaviour owes the assertion (Principle V).** Unit for pure
logic; component (jsdom) for what one component renders, focuses or announces; integration for real
processes and files (the `*.integration.test.ts` are the right home for daemon and editor
semantics); contract for "does this implementation satisfy the interface".

**E2E is reserved for what NO lower layer can observe** — real window lifecycle and multiple
windows, focus and z-order, native menus and dialogs, OS drag-and-drop, PTY/ConPTY keyboard and
rendering fidelity, and process-tree hygiene. It is not the layer for "what the user sees" in
general: a rendered output, a class, an aria attribute or a focus move inside one component is a
component test, and a value that ends up on disk is an integration test.

There is no longer any rule requiring an E2E for a UI change. The old one — *"mandatory for any
user-facing UI change"* — was removed at constitution v5.0.0, because it was a one-way ratchet that
produced 235 spec files and 46.9 measured minutes. Before adding an E2E, answer in one sentence what
a lower layer would be unable to see.

Every E2E test carries exactly one significance tag (`@core`, which gates CI and is capped, or
`@extended`, which runs at release) and at least one category tag; the build fails otherwise, and
fails again if the suite exceeds its declared budget. Deleting an E2E is allowed and has one rule:
the lower-layer replacement is written and observed **failing** against a broken implementation
first.

## Not yours

CI workflow shape, runner setup and release gates → `throng-build-release`. Product fixes the tests
reveal → the owning area agent.
