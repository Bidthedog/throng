# Implementation Plan: No Inert Settings Guard

**Branch**: `feature/S071-I108-inert-settings-guard` | **Date**: 2026-11-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/071-inert-settings-guard/spec.md`

## Summary

One unit test builds a single TypeScript program over every package's source and follows each value from the
`AppSettings` root through property and element access, aliases, destructuring, call arguments and JSX props. It
then fails the build for any Settings descriptor that nothing outside the configuration layer reads (research
R1–R3). A fixture test proves each resolution rule in isolation. The ten per-feature text-matching reader checks
are removed, and the assertions in them that are not about readership are kept. The first run finds no inert
settings (research R6), so no user-visible behaviour changes.

## Technical Context

**Language/Version**: TypeScript 6.0 (the `typescript` package, through the repo's `@typescript/typescript6` alias) on Node 26

**Primary Dependencies**: `typescript` compiler API (already a root dev dependency, used by `failure-logging-scan.ts`); vitest

**Storage**: N/A

**Testing**: vitest `unit` project (`td run --runner unit`)

**Target Platform**: CI gate on GitHub-hosted runners (Windows, Linux, macOS lanes run the unit stage); developer workstations

**Project Type**: Test tooling in an npm-workspaces Electron monorepo

**Performance Goals**: the guard adds ≤ 60 s to a gate run (SC-005); measured 12 s to build the program (research R2)

**Constraints**: no text matching of setting names (FR-009); no new CI job; no production code change unless the first run finds an inert setting

**Scale/Scope**: 150 Settings descriptors; 1,102 production source files across 10 packages

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / gate | Assessment |
|---|---|
| I–IV, XI, XII (product architecture, terminals, docking, responsiveness) | Not touched. The guard is test tooling, and the first run changes no production code |
| V Test-first (NON-NEGOTIABLE) | ✅ The fixture test (`settings-readers-scan.test.ts`) is written first and fails before the scanner exists. The guard's negative cases (a new unread key, a removed reader) are fixtures, so they run on every build (SC-003) |
| VI Simple, discoverable UX | ✅ No UI change (FR-016). The guard's failure message says what to do and where (contract) |
| VII Change review | ✅ The configuration-layer list and the allowlist live in one module, so growing either is a reviewed diff (FR-007, FR-011) |
| VIII SOLID / DRY / YAGNI | ✅ One scanner replaces ten per-feature copies of a regex helper. No typed-accessor refactor (research R1) |
| IX DI & composition root | N/A: test tooling, no runtime services |
| X Externalised configuration | ✅ Strengthened. This makes 019 FR-022's "a control that governs nothing must not ship" mechanical (FR-015) |
| XIII Every failure leaves a trace | N/A: no runtime failure path |
| Lint + typecheck zero errors | ✅ New files are TypeScript under `packages/core/tests/unit/`, covered by `npm run lint` (type-aware), as are the other tests there. Core's tests have no tsconfig of their own |
| Configuration-editor completeness | ✅ Complementary. Completeness proves every key has a descriptor; this proves every descriptor has a reader. Neither test changes the other |
| Documentation currency | ✅ `docs/architecture.md` (configuration flow) and `.claude/skills/throng-config-preferences/SKILL.md` (rule 2) gain the reverse guarantee in the same change |
| Incremental delivery | ✅ One PR. The first run is clean, so there is no staged triage |

**Post-design re-check**: unchanged. The design adds two test-tooling modules and two test files, removes reader
assertions from ten test files, and adds two documentation sentences.

## Project Structure

### Documentation (this feature)

```text
specs/071-inert-settings-guard/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/settings-readers-scan.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/tests/unit/
├── settings-readers-scan.ts           # NEW  the scanner: buildRepoProgram, scanSettingReaders
├── inert-settings-policy.ts           # NEW  CONFIGURATION_LAYER, INERT_ALLOWLIST, allowlistProblems
├── settings-readers-scan.test.ts      # NEW  fixture test, one case per resolution rule (in-memory program)
├── no-inert-settings.test.ts          # NEW  the guard over the real repository
└── settings-inertness-0NN.test.ts     # EDIT ×10  reader checks and their regex helpers removed (FR-014)

docs/architecture.md                                   # EDIT  configuration flow: the reverse guarantee
.claude/skills/throng-config-preferences/SKILL.md      # EDIT  rule 2: a descriptor needs a reader
```

**Structure Decision**: The guard sits beside the per-feature inertness tests it supersedes, in
`packages/core/tests/unit/`, because the Settings registry it covers lives in core. The scanner and policy are
plain `.ts` modules in the test tree, not `*.test.ts`, following `packages/ui/tests/unit/failure-logging-scan.ts`.

### What happens to each per-feature file (FR-014)

| File | Reader checks removed | Kept |
|---|---|---|
| `-040` | "has production code reading every one of them", "names where each one is read", "leaves its neighbours … still being read", the regex helpers | "renders a control for all three keys" |
| `-043` | the reader `it`, the report, "leaves the find bar's own delay still being read" | "renders a control for all eight keys" |
| `-044` | the reader `it`, the report | "renders a control for all nine keys" |
| `-047` | the reader `it` | "renders a control for all four keys" |
| `-049` | "has production code reading it" | "renders a control for the key" |
| `-054` | the reader `it` | "describes every new leaf" |
| `-055` | "reads every resourceMonitor leaf in the resolver", "has UI main and the renderer both calling the resolver", "has the kill dialog reading confirmations.killProcesses" | "describes every new leaf" |
| `-057` | the reader `it` | "covers all nineteen keys", "describes every new key" |
| `-068` | "`$key` is read by production code" | "`$key` has a descriptor" |
| `-070` | "is read by production code" | the default, parse, round-trip and macOS-only-toggle tests |

A file left holding only descriptor assertions is renamed `settings-descriptors-0NN.test.ts`, so its name no
longer claims a guarantee it does not check. `-070`, which holds behaviour tests, becomes
`mac-option-is-meta-setting.test.ts`. Each file's header comment is updated to name 071 as the reader guard.

## Testing

- **Fixture test first** (`settings-readers-scan.test.ts`): it builds an in-memory program per case, so it runs in
  milliseconds and needs no repository. It covers every row of the contract's fixture table, including SC-003's two
  negative cases.
- **The guard** (`no-inert-settings.test.ts`): a 120 s `beforeAll` builds the repo program once, and each `it` is
  then milliseconds.
- **Supersession**: the edited per-feature files are run narrowly to show what they kept still passes.
- **No component, integration, contract or E2E tests.** There is no runtime behaviour, so the unit layer is the
  lowest that can prove it, and the only one.
- No manual test plan groups: the feature has no visual surface (FR-016).

## Complexity Tracking

No constitution violations.

| Item | Note |
|---|---|
| Depends on the TypeScript 6 JavaScript API | Shared with `typescript-eslint` and `failure-logging-scan.ts`. #435 (dropping the 6/7 alias) must keep `typescript` resolvable for these, or port them (research R8) |
