---

description: "Task list for 071 — No Inert Settings Guard"
---

# Tasks: No Inert Settings Guard

**Input**: Design documents from `specs/071-inert-settings-guard/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/settings-readers-scan.md, quickstart.md

**Tests**: Test-first (constitution Principle V). Every rule gets its failing fixture before the code that satisfies
it. All tests are **unit** tests (plan, *Testing*). There is no component, integration, contract or E2E layer for
this feature.

**Organization**: Grouped by user story. US1, US2 and US3 are all P1. US3's resolution rules are what make US1's
guard sound, so they share the scanner file and run in sequence, not in parallel.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US5 from spec.md

Paths are repository-relative. `SCAN` = `packages/core/tests/unit/settings-readers-scan.ts`, `FIX` =
`packages/core/tests/unit/settings-readers-scan.test.ts`, `POLICY` =
`packages/core/tests/unit/inert-settings-policy.ts`, `GUARD` = `packages/core/tests/unit/no-inert-settings.test.ts`.

---

## Phase 1: Setup

**Purpose**: None needed. `typescript` (6.0.3, through the `@typescript/typescript6` alias) is already a root dev
dependency (research R8), and vitest's `unit` project already includes `packages/core/tests/unit/**/*.test.ts`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The in-memory fixture harness and the scanner's skeleton, which every story builds on.

- [x] T001 Write the fixture harness in FIX: a helper that builds a `ts.Program` from a map of virtual file names to
  source text, through a `ts.CompilerHost` whose `fileExists`/`readFile`/`getSourceFile` serve the map and fall
  back to the real default library. Also write a shared fixture settings module (`settings.ts`, declaring
  `interface Settings` with a nested section, a shared-shape pair, a literal-keyed section and a
  `Record<string, P>` map). Add one failing case ("a key read by a direct property access is read") that imports
  `scanSettingReaders` from SCAN, which does not exist yet.
- [x] T002 Create SCAN with the contract's exports (`buildRepoProgram`, `ScanInput`, `scanSettingReaders`). Build
  the settings tree (data-model *SettingsTree*: `known` paths with `*` for index signatures, and `pathsOfType` for
  object types) and record direct `root.a.b` property-access reads only, so T001's case passes.

**Checkpoint**: `td run --runner unit --scope file --target packages/core/tests/unit/settings-readers-scan.test.ts`
is green on the one case.

---

## Phase 3: User Story 1 — A new setting nobody reads fails the build (P1) 🎯 MVP

**Goal**: An unread descriptor fails the build, naming it. Configuration-layer and test mentions never count.

**Independent Test**: The fixture test's "new key with no reader" case fails before the scanner reports
unreadness, then passes. The guard over the repository is green.

- [x] T003 [US1] Add failing cases to FIX: (a) a key with no reader is reported with `readers: []`; (b) several
  unread keys are all reported, not only the first; (c) a key read only in a file matching a `configLayer`
  prefix is unread; (d) a key read only in a file `isProduction` rejects (a test file) is unread (FR-008); (e) a
  write `root.a.b = 1` is not a read.
- [x] T004 [US1] Make T003 pass in SCAN: apply `configLayer` and `isProduction` to every candidate file, skip
  assignment targets, and return one entry per input key in input order with its readers sorted (contract
  *Guarantees*). Decide readership from the AST and the checker only, never from source text (FR-009).
- [x] T005 [P] [US1] Create POLICY with `CONFIGURATION_LAYER` holding every row of research R5's table, each as
  `{ prefix, why }` with that row's reason (FR-007), and `INERT_ALLOWLIST` empty.
- [x] T006 [US1] Create GUARD. Its `beforeAll` (120 s hook timeout, stated with research R7's reason) builds
  `buildRepoProgram(repoRoot)` and scans with the keys of `SETTINGS_METADATA`, the `AppSettings` interface from
  `packages/core/src/config/app-settings.ts` as root, `CONFIGURATION_LAYER`'s prefixes, and `isProduction` =
  `packages/*/src/**` minus `.d.ts`. Its case "every Settings descriptor has a reader outside the configuration
  layer" fails with the contract's message shape, listing **every** finding (FR-010). Derive `relPath` from the
  source file's `fileName`, which TypeScript always writes with `/` (so prefix matching is the same on the Windows
  lane). GUARD is red until T007 implements `buildRepoProgram`.
- [x] T007 [US1] Implement `buildRepoProgram` in SCAN per research R2: one program over every
  `packages/*/src/**/*.{ts,tsx}` (excluding `dist`, `tests`, `node_modules`), with the renderer's compiler options
  from `packages/ui/tsconfig.renderer.json`, `noEmit`, and `paths` mapping each `@throng/<pkg>` (and
  `@throng/core/testing`) to its `src` entry. Run GUARD and record the result: it is expected red here until US3's
  rules land.

**Checkpoint**: The fixture cases for US1 are green. GUARD runs, and its findings are the reads that US3 resolves.

---

## Phase 4: User Story 2 — Removing the last reader fails the build (P1)

**Goal**: Deleting a setting's only reader fails the build. Deleting one of two does not.

**Independent Test**: The two fixture cases below.

- [x] T008 [US2] Add cases to FIX: a fixture with exactly one reader of `a.b`, scanned with that reader file
  present (read) and with it removed from the virtual file map (unread). Then the same with two readers and one
  removed (still read). These pin SC-003's second half. Expected to pass on T004's code. If either fails, fix SCAN
  before continuing.

---

## Phase 5: User Story 3 — No false alarms from the ways settings are really read (P1)

**Goal**: Every read shape in research R3 resolves to the right key path and to no other.

**Independent Test**: Each fixture below fails before its rule exists and passes after. GUARD is green over the
repository with an empty allowlist.

- [x] T009 [US3] Add failing cases to FIX, one per contract fixture row: alias `const s = root.a; s.b`;
  destructure `const { b } = root.a` (nested patterns too); a section passed to a function whose parameter has a
  separately declared mirror type; a section passed as a JSX prop and destructured in the component (`.tsx`
  fixture with `jsx: react-jsx` and a minimal JSX namespace); a `Pick<>` parameter; `root.n[sev].t` with `sev` a
  literal union (each member's `t` read, no other member); `root.m[id].x` on a `Record<string, P>` (the `*` path
  matches each concrete descriptor `m.<id>.x`); two keys of one shared shape with only one read by its own path
  (the other stays unread, FR-006); a `number` variable passed to a function that reads nothing (never a read,
  research R3 rule 5).
- [x] T010 [US3] Make T009 pass in SCAN: path computation per research R3 rules 1–5 (root by type, property and
  element access extending by name or literal union or `*`, alias and destructuring following, argument-to-
  parameter and JSX-attribute binding to a fixpoint from non-configuration-layer call sites, and an
  object-types-only type fallback). Add descriptor matching with `*` segments per data-model *KeyPath*.
  [derived: a parameter that no resolved call binds falls back to every path of its type, which is FR-006's
  "every path the calls supply" when the calls cannot be resolved (research R3, *Known limits*).]
- [x] T011 [US3] Add to GUARD the case "the aliased-read set resolves" (SC-002): each of
  `explorer.dragCopyModifier`, `explorer.dragMoveModifier` (aliased section), `confirmations.destroyPanel` (mirror
  parameter type), `newProject.overridePath` (`Pick<>` parameter), `resourceMonitor.cpuWarningPercent` (resolver)
  and `editor.previews.providers.markdown.gutter` (map) has at least one reader, and none of those readers is
  in `CONFIGURATION_LAYER`. [derived: the 019 scan's eleven misfires were not recorded by key, so the shapes
  research R3 met on real code stand in for them.]
- [x] T012 [US3] Run GUARD over the repository and confirm it is green with an empty allowlist. Then confirm the
  mutation from research R5: scan with `packages/ui/src/renderer/explorer/file-tree.tsx` and
  `packages/core/src/workspace/destroy.ts` added to the configuration layer (in a throwaway local run, not
  committed), and check that exactly the ten keys R5 lists come back unread.

**Checkpoint**: US1–US3 are complete. The build fails on an inert setting, and only on one.

---

## Phase 6: User Story 4 — Today's inert settings are found and resolved (P2)

**Goal**: The first run's findings are recorded, and the allowlist's rules are enforced.

**Independent Test**: The spec's *First-run findings* section is filled in, and `allowlistProblems` rejects each
bad entry shape.

- [x] T013 [US4] Add failing cases to FIX (or a sibling block in the same file) for POLICY's
  `allowlistProblems`: an entry with an empty reason; one with a placeholder reason (`TODO`, `TBD`, `-`, `n/a`, or
  under 20 characters); one whose key has a reader (stale); one whose key is not a descriptor. Each yields a
  problem naming the key, and a clean list yields none (FR-011, data-model *AllowlistEntry*).
- [x] T014 [US4] Implement `allowlistProblems` in POLICY. In GUARD, exclude allowlisted keys from the findings and
  add the case "the allowlist is valid" asserting `allowlistProblems(INERT_ALLOWLIST, report)` is empty.
- [x] T015 [US4] Record the first full run in `specs/071-inert-settings-guard/spec.md` under *First-run findings*:
  the run's commit, the number of descriptors scanned, and that none was unread (research R6). Keep it additive,
  replacing only the placeholder paragraph. If the run does find any unread setting, give each one its own row
  with its outcome per FR-012, and add the wiring or removal task it needs to this phase before continuing.

---

## Phase 7: User Story 5 — Contributors can see where a setting is read (P3)

**Goal**: A report of every key and its readers.

**Independent Test**: The quickstart's report command prints `explorer.dragCopyModifier` with `file-tree.tsx`.

- [x] T016 [US5] Add GUARD's case "report": when `process.env.SETTINGS_READERS_REPORT === '1'`, print one line per
  key, `<key> ← <reader>, <reader>` (or `← (allowlisted: <reason>)`), and assert nothing else. Without the
  variable, it asserts that the report has one entry per descriptor and prints nothing.

---

## Phase 8: Supersession of the per-feature reader checks (FR-014)

**Purpose**: Remove the ten text-matching reader checks and keep their other assertions, per the plan's table
*What happens to each per-feature file*. Each task edits one file, so they are parallel. Each ends by running its
file narrowly with `td run --runner unit --scope file`.

- [x] T017 [P] Edit `packages/core/tests/unit/settings-inertness-040.test.ts`: remove the two reader `it`s, the
  "leaves its neighbours … still being read" block, `productionSources`, `readersOf`, `CONFIG_LAYER`, `NEIGHBOURS`
  and the imports only they used. Keep "renders a control for all three keys". Rewrite the header to say the
  reader guarantee is 071's `no-inert-settings.test.ts`. Rename the file to `settings-descriptors-040.test.ts`.
- [x] T018 [P] Same for `packages/core/tests/unit/settings-inertness-043.test.ts` → `settings-descriptors-043.test.ts`,
  keeping "renders a control for all eight keys".
- [x] T019 [P] Same for `packages/core/tests/unit/settings-inertness-044.test.ts` → `settings-descriptors-044.test.ts`,
  keeping "renders a control for all nine keys".
- [x] T020 [P] Same for `packages/core/tests/unit/settings-inertness-047.test.ts` → `settings-descriptors-047.test.ts`,
  keeping "renders a control for all four keys".
- [x] T021 [P] Same for `packages/core/tests/unit/settings-inertness-049.test.ts` → `settings-descriptors-049.test.ts`,
  keeping "renders a control for the key".
- [x] T022 [P] Same for `packages/core/tests/unit/settings-inertness-054.test.ts` → `settings-descriptors-054.test.ts`,
  keeping "describes every new leaf".
- [x] T023 [P] Same for `packages/core/tests/unit/settings-inertness-055.test.ts` → `settings-descriptors-055.test.ts`,
  removing its three text-matching reader cases and keeping "describes every new leaf".
- [x] T024 [P] Same for `packages/core/tests/unit/settings-inertness-057.test.ts` → `settings-descriptors-057.test.ts`,
  keeping "covers all nineteen keys" and "describes every new key".
- [x] T025 [P] Same for `packages/core/tests/unit/settings-inertness-068.test.ts` → `settings-descriptors-068.test.ts`,
  keeping "`$key` has a descriptor".
- [x] T026 [P] Edit `packages/core/tests/unit/settings-inertness-070.test.ts` → `mac-option-is-meta-setting.test.ts`:
  remove "is read by production code" and its helpers, and keep the default, parse, round-trip and macOS-only
  toggle tests.
- [x] T027 Search the repository for references to the old file names (`git grep -n "settings-inertness-0"`
  outside `specs/`, which is history) and update every live reference: comments in tests and source, skills
  and docs. Also reword production comments that justify code shape by the old text matchers ("read by NAME so the
  test can see it", for example in `packages/core/src/preview/providers/markdown.ts`,
  `packages/ui/src/main/replace-commit-service.ts` and the `find-in-files-*` modules) to point at 071's guard.
  These are comment-only edits in production files, so FR-016 holds.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [x] T028 [P] Edit `docs/architecture.md`, configuration *Flow* paragraph: after "completeness tests fail the
  build on a key without one", add that `no-inert-settings.test.ts` fails it on a Settings descriptor nothing
  outside the configuration layer reads.
- [x] T029 [P] Edit `.claude/skills/throng-config-preferences/SKILL.md`, rule 2: add the reverse guarantee (a
  descriptor with no reader fails the build) and point at POLICY for the configuration-layer list and the
  allowlist.
- [x] T030 Run `npm run lint` and the narrow unit runs of FIX, GUARD and the ten edited files. Then time GUARD's
  `beforeAll` and record it in research R7 if it differs from 12 s by more than half (SC-005: under 60 s). Once the
  PR's first CI run has finished, read GUARD's duration on the Windows, Linux and macOS unit lanes from its logs.

---

## Dependencies & Execution Order

- **Phase 2** blocks everything.
- **US1** (T003–T007) → **US2** (T008) → **US3** (T009–T012). All three edit SCAN and FIX, so they run in sequence.
  T005 (POLICY) is parallel with T003–T004.
- **US4** (T013–T015) needs US3's green GUARD. **US5** (T016) needs GUARD.
- **Phase 8** needs GUARD green (T012), so the guarantee exists before the per-feature checks go. T017–T026 are
  parallel, and T027 follows them.
- **Phase 9** comes last. T028 and T029 are parallel.

## Parallel Example

```text
T005  POLICY                      ∥  T003–T004  FIX + SCAN
T017 … T026  ten per-feature files, all parallel
T028  docs/architecture.md        ∥  T029  throng-config-preferences skill
```

## Implementation Strategy

MVP is US1 + US3: a guard that fails on an unread setting and is sound against real code. US2 is a property of
the same code, pinned by fixtures. US4 records the clean first run and enforces the allowlist. US5 is the report.
The supersession (Phase 8) lands only after the guard is green, so no commit leaves the repository with neither
guard.

## Phase 10: Convergence

- [x] T031 Exclude test helpers under `packages/*/src/testing/` (exported as `@throng/core/testing`) from GUARD's
  `isProduction`, with a fixture or guard case showing a key read only there is unread, per FR-008 (partial)
- [x] T032 Add `--silent=false` to the report command in `specs/071-inert-settings-guard/quickstart.md` and GUARD's
  header, since vitest 5 hides a passing test's console output, per FR-013 (partial)
