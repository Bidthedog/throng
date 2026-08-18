# Implementation Plan: E2E Harness Integrity, Speed and Surface

**Branch**: `feature/S034-I251-e2e-harness-integrity` | **Date**: 2026-08-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/034-e2e-harness-integrity/spec.md`

**Measurements**: [baseline.md](./baseline.md) · **Findings**: [research.md](./research.md) ·
**Launch decisions**: [launch-assessment.md](./launch-assessment.md)

## Summary

Two problems, one feature, because the second cannot be solved while the first is true.

**Stories 1-5 make the suite trustworthy.** The tier boundary is redrawn from measurement, three
clock-dependent specs stop timing the machine, fixed waits are declared or removed, launches are
amortised, and every published figure names its measurement. Partly delivered already on this branch
(`b7411c0`, `2eba3a8`, `3278d0b`, `fe57073`).

**Stories 6-8 make it affordable.** 235 spec files and 46.9 measured minutes exist because
Constitution Principle V mandated an E2E per user-facing UI change with no ceiling and no deletion
rule. That mandate is gone (constitution v5.0.0, committed in `ccd1e15`). This feature now builds the
layer the work has to move to, moves it, puts a ceiling where there was none, and splits the layer
into a critical selection that gates CI and a full selection that runs at release.

The technical approach, in dependency order: **delete the shard machinery** (it is dead weight at
the sizes both selections will be, and it otherwise has to be maintained through the whole
migration), **add a `component` vitest project** (jsdom — the missing home for ~40% of the suite),
**tag and budget** (the enforcement that stops regrowth), then **nine migration batches** ordered by
the size of the win.

## Technical Context

**Language/Version**: TypeScript 5.x, ESM throughout, Node 20+

**Primary Dependencies**: Electron 43, React 19, Playwright 1.48+ (E2E), Vitest 4.1 (unit /
integration / contract, and the new component project), InversifyJS (DI), better-sqlite3,
node-pty/ConPTY, CodeMirror 6, xterm.js. **New**: `jsdom` and `@testing-library/react` +
`@testing-library/user-event` for the component layer.

**Storage**: SQLite via the daemon (`workspace_layout`, subworkspaces); JSON config files
(`settings.json`, `keybindings.json`, `themes/*.json`) under `THRONG_CONFIG_ROOT`.

**Testing**: five layers after this feature — `vitest --project unit` (250 files / 2281 tests),
`--project component` (**new**), `--project integration` (85 files), `--project contract` (19 files),
and Playwright-on-Electron E2E (235 spec files / ~791 tests at the baseline). `npm run gate` runs
them in CI's order, fail-fast.

**Target Platform**: Windows 11 / Windows Server 2022 (`windows-2022` runners). The E2E suite needs a
real interactive desktop and cannot run on Linux.

**Project Type**: Desktop application — Electron main + React renderer + detached daemon over a named
pipe, in an npm-workspaces monorepo.

**Performance Goals**: CI's E2E stage under 10 minutes of machine time on a push (SC-016), against
~36 runner-minutes across three shards at the baseline. Critical selection ≤50 tests (SC-018). Full
local suite ≥25% faster than the measured 46.9 minutes (SC-011).

**Constraints**: `failOnFlakyTests: true` — one flake reddens a run, so anything kept must be
genuinely deterministic. CI runners are elevated and cannot be de-elevated; `skipIfElevated()`
already skips 22-28 spec files there. Workers stay at 1 on CI: raising them was measured to
manufacture failures. jsdom has no compositing, no GPU and no OS focus.

**Scale/Scope**: 235 E2E spec files to classify; ~250 assertions expected to relocate; 3 workflow
files; 4 plan/budget JSONs; 6 instruction sources (already amended in `ccd1e15`).

## Constitution Check

*GATE: checked against constitution **v5.0.0** — amended by this feature in `ccd1e15`.*

| Principle | Gate | Verdict |
|---|---|---|
| **V. Test-First Quality Discipline** | Coverage at the lowest layer that can prove it; E2E reserved for what no lower layer can observe; budget enforced; one significance tag + one category tag per E2E test | **This feature implements the amended principle.** FR-044-FR-063 are its enforcement. The Red step applies to the migration itself: FR-046 requires each replacement observed failing before its E2E is deleted. |
| **V. Flaky is a bug** | `failOnFlakyTests` stays on; retries keep diagnostic value only | **Pass** — FR-031 preserves it verbatim. Untouched by the cut. |
| **V. Infrastructure-fault carve-out** | Retry once at shard level, gated on zero unexpected AND zero flaky, surfaced against a tracking issue | **Pass, but relocated.** The classification logic lives in `scripts/ci-e2e-shard.ps1`, which FR-057 removes the shard plumbing from. The classification MUST be extracted before that script changes, not deleted with it. |
| **V. Process lifecycle** | Spawn/detach/persist/reattach covered by automated tests | **Pass** — process-tree hygiene is explicitly on the E2E reservation list (FR-048). `terminal-no-orphans.e2e.ts` stays. |
| **V. Privilege-dependent behaviour** | Tagged `@admin`, elevation-gated, reminder emitted every run | **Pass** — FR-033/FR-034 preserve it; the `e2e-admin` CI job is untouched by the lane split. |
| **V. Temp-file cleanup** | A green bar leaves no orphaned artifacts | **Pass** — FR-038 preserves it. |
| **III. Terminal hygiene** | No-orphan rule verified by a process-level E2E | **Pass** — same test, now explicitly `@core`. |
| **Development Workflow & Quality Gates** (not a numbered principle — the constitution has eleven, I-XI) | Lint, type-check and every test layer run in CI on every PR | **Satisfied in its amended form.** The component layer joins the PR gate; the E2E layer gates PRs at `@core` and runs in full at release (constitution v5.0.0). |
| **VIII. SOLID / DRY / YAGNI** | No speculative machinery | **Pass, and net-negative.** The feature deletes more than it adds: `shard-plan.json`, the blob-report apparatus, `blob-report-naming.test.ts`, the shard env plumbing. The one addition — a component project — is required by FR-044 and is not speculative: ~40% of the suite has nowhere else to go. |
| **X. Externalised Configuration** | No hardcoded values | **Pass** — the budget lives in `e2e-budget.json`, not in a test body. |

**No violations to justify.** The one thing that would have been a violation — deleting E2E coverage
— is exactly what constitution v5.0.0 now governs, and FR-046/FR-047 are stricter than the rule they
replace: a replacement must be observed *failing* first, and a partial replacement does not count.

## Project Structure

### Documentation (this feature)

```text
specs/034-e2e-harness-integrity/
├── plan.md                 # This file
├── spec.md                 # Stories 1-8, FR-001..FR-063, SC-001..SC-023
├── research.md             # Phase 0 — Stories 1-5 findings, plus the Stories 6-8 appendix
├── baseline.md             # The 46.9-minute measurement everything reduces from
├── launch-assessment.md    # Per-file launch-sharing decisions (Story 4)
├── data-model.md           # Phase 1 — the tag vocabulary, the budget, the classification record
├── quickstart.md           # Phase 1 — how to verify each story by hand
├── contracts/              # Phase 1 — the build-enforced guards, stated as contracts
└── checklists/requirements.md
```

### Source Code (repository root)

```text
packages/
├── core/tests/{unit,contract}/                 # pure decisions; abstraction contracts
├── persistence/tests/integration/              # SQLite, migrations, layout persistence
├── daemon/tests/{unit,integration}/            # RPC, PTY, process lifecycle
├── platform-windows/tests/contract/            # Win32 FFI contracts
└── ui/
    ├── src/renderer/                           # React — the subject of the new component layer
    └── tests/
        ├── unit/                               # + the extended guards (tags, budget, tier)
        │   ├── shard-plan.test.ts              # shard assertions REMOVED; tier + tag guards ADDED
        │   ├── e2e-tags.test.ts                # NEW — significance + category, and the ≤50 cap
        │   ├── e2e-budget.test.ts              # NEW — the downward-only ratchet
        │   ├── sleep-budget.test.ts            # unchanged mechanism, edited data
        │   └── blob-report-naming.test.ts      # DELETED with the blob apparatus
        ├── component/                          # NEW — jsdom + React Testing Library
        ├── integration/                        # config writes, watchers, daemon lifecycle
        └── e2e/
            ├── *.e2e.ts                        # 235 → ~60-80 files, every test tagged
            ├── parallel-plan.json              # KEPT — worker contention, not machine splitting
            ├── shard-plan.json                 # DELETED (FR-057)
            ├── sleep-budget.json               # KEPT — edited as specs are deleted
            └── e2e-budget.json                 # NEW — the ceiling

vitest.config.ts                                # + the `component` project
playwright.config.ts                            # shard block removed; grep selection added
scripts/{gate,run-tests,run-e2e-local}.mjs      # + component stage, + lane selection
scripts/ci-e2e-shard.ps1                        # flake classification extracted, -Group removed
.github/workflows/ci.yml                        # matrix + merge-e2e removed; --grep @core
.github/workflows/release.yml                   # NEW e2e-full job gating build-installer
docs/testing.md, CLAUDE.md                      # rewritten around layers, lanes, tags, budget
```

**Structure Decision**: The monorepo layout is unchanged. One new test root
(`packages/ui/tests/component/`) mirrors the existing `unit`/`integration`/`e2e` convention so the
vitest project globs stay uniform (`packages/**/tests/component/**/*.test.ts`). Nothing moves
between packages.

## Phase 0: Research

`research.md` carries the Stories 1-5 findings, and its **Stories 6-8 appendix is written**. The
three questions it answers:

1. **Which DOM environment.** `jsdom` over `happy-dom`: Vitest's default, better React 19 support,
   and the assertions being relocated need `getComputedStyle` fidelity more than raw speed.
2. **How the significance selection is expressed.** Playwright tags plus `--grep`, not a fourth plan
   file. `playwright.config.ts:173` already composes `grepInvert` for `@admin`/`@quarantine`, and a
   CLI `--grep` does not clear a config `grepInvert` — so the two mechanisms coexist. A plan file
   would be a second hand-maintained enumeration of the thing tags already say in place.
3. **Whether the shard split still pays.** It does not, for either selection. Recorded with the
   arithmetic in the approved design, and confirmed against `ci.yml:159-163`, which states what the
   split buys (~12 min → ~4-5 min) and what it costs (3× runner-minutes) plus a ~3-4 min per-shard
   `npm ci` + build toll.

**One live finding from the baseline run**, which must be recorded because it constrains FR-044:
Vitest 4 removed `test.poolOptions`, and `vitest.config.ts` still uses it (`osSerial`). The new
component project must use the top-level form, and the deprecation should be fixed while the config
is being edited rather than left to warn on every run.

## Phase 1: Design

- **`data-model.md`** — the entities the build now enforces: the significance marking (exactly one
  of `@core` / `@extended`), the category marking (one or more), their relationship to the existing
  environment markings (`@admin`, `@quarantine`), the budget record and its ratchet direction, and
  the classification record that ties each deleted E2E to the replacement that carries its
  assertions.
- **`contracts/`** — this feature's "interfaces" are the build guards, and they are contracts in the
  meaningful sense: each states a property, what violates it, and the message a developer sees.
  **Five** of them — G1 tagging completeness, G2 the `@core` cap, G3 the budget ratchet, G4
  tier-plan correctness (the surviving half of what is today `shard-plan.test.ts`, renamed
  `tier-plan.test.ts` by T018), and G5 the closed category vocabulary — plus the two lane selections
  as command contracts.
- **`quickstart.md`** — the runnable validation for each story, ending in the manual steps the final
  report needs.

## Complexity Tracking

*No Constitution Check violations require justification.* One item is worth recording anyway,
because it looks like added complexity and is not:

| Item | Why it is not a violation |
|---|---|
| A fifth test layer | Constitution v5.0.0 names it. Without it, FR-045 is unsatisfiable for ~40% of the suite, and the alternative — deleting those assertions outright — loses coverage the replace-first rule forbids losing. |
| Two E2E lanes instead of one | The alternative is one lane that is either too slow to gate merges or too small to trust at release. The split is what lets each lane be right for its job. |
| A budget file | The failure this feature fixes was structural: no ceiling existed. A rule with no enforcement is what produced 235 spec files from a well-intentioned principle. |
