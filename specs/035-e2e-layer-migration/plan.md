# Implementation Plan: E2E Layer Migration

**Branch**: `feature/S035-e2e-layer-migration` | **Date**: 2026-08-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/035-e2e-layer-migration/spec.md`

## Summary

Apply an exhaustive per-test census of the E2E suite: settle the eleven items it left unresolved,
migrate every test a lower layer can prove, and build the destination layer that does not yet exist
so the largest "irreducible" bucket stops being irreducible. Three constitution amendments make the
result durable rather than a one-off tidy-up.

The order below is not arbitrary. **Governance first, because it changes what "done" means for every
migration that follows**; then the cheap static guard, because it is what makes a whole class of E2E
test redundant; then the migrations, largest-evidence-first; then the contract tests that unlock the
rest.

## Technical Context

**Language/Version**: TypeScript 5.x, ESM throughout, Node 22 host runtime

**Primary Dependencies**: Playwright (E2E on Electron), Vitest (unit/component/integration/contract),
React Testing Library + jsdom (component), Electron 43

**Storage**: N/A for this feature — it changes tests and guards, not persisted app state

**Testing**: five layers already exist — `test:unit`, `test:component`, `test:integration`,
`test:contract`, `test:e2e`, sequenced fail-fast by `npm run gate`

**Target Platform**: Windows 11 (the app is Windows-only)

**Project Type**: desktop application (Electron main + preload + renderer, plus a detached daemon)

**Performance Goals**: E2E stage falls ≥15% from the 034 baseline of ~21.2 min (SC-007); the new
bridge cross-check answers in under one second (SC-004)

**Constraints**: the E2E budget ratchet fails both ways, so every removal re-seeds it in the same
commit; `@core` stays ≤50; no new flakiness at 1, 3 or 6 workers (SC-009)

**Scale/Scope**: 229 E2E spec files, 687 tagged tests, 98 IPC channels, 7 existing contract tests

## Constitution Check

*GATE: must pass before implementation, re-checked after.*

| Principle | Bearing on this work | Status |
|---|---|---|
| **V — Test-First Quality Discipline** | This feature IS Principle V enforcement. Every migration must write the replacement, observe it fail, then delete the E2E (FR-002). | Compliant by construction; the risk is skipping the Red step, which the task list makes explicit per migration. |
| **V — E2E reserve** | Amended here: a ninth entry, a reworded layout entry, and a per-test reserve tag. | **Amendment required** — MINOR bump, additive. Recorded in spec's amendment section. |
| **V — budget ratchet** | Already exists; every file deletion re-seeds `e2e-budget.json` in the same commit. | Compliant; no new rule (deliberately — see spec). |
| **VIII — SOLID/DRY/YAGNI** | The bridge guard must discover channels rather than read a maintained list, or it becomes the thing it is checking. | Designed as a discovery guard, same idiom as `e2e-tags.test.ts`. |
| **IX — DI & Composition Root** | Contract tests drive real main-process handlers; they must not reach around the composition root to fake collaborators. | Follows `config-write-patch.contract.test.ts`, which already does this correctly. |

**No violation requiring justification.** The one amendment is additive and the spec argues it from
measured evidence rather than convenience.

## Project Structure

### Documentation (this feature)

```text
specs/035-e2e-layer-migration/
├── spec.md
├── plan.md              # this file
├── tasks.md             # produced by /speckit-tasks
└── checklists/
    └── requirements.md
```

### Source (repository root)

```text
.specify/memory/constitution.md            # amended: Principle V, three changes
packages/ui/tests/unit/
├── e2e-tags.test.ts                       # EXTENDED: reserve tag vocabulary + per-test check
└── ipc-bridge-parity.test.ts              # NEW: static preload <-> main channel cross-check
packages/ui/tests/e2e/
├── e2e-budget.json                        # re-seeded per removal commit
├── parallel-plan.json                     # entries removed alongside deleted specs
└── *.e2e.ts                               # ~200 tests removed or narrowed; 7 files deleted
packages/ui/tests/component/               # migration targets (fake-bridge pattern)
packages/ui/tests/integration/             # migration targets
packages/ui/tests/contract/                # NEW contract tests for wiring-blocking channels
docs/testing.md                            # reserve tag vocabulary documented
```

## Phases

### Phase 0 — Settle the eleven (FR-020)

Before any migration. Each item is read on **both** sides — the E2E test and the lower-layer test
alleged to cover it — and its verdict recorded. This is first because SC-001's finish line is "every
verdict applied or declined", and eleven verdicts currently exist in neither state.

Expected output: eleven verdicts, appended to the census record. Some will resolve to KEEP; that is a
result, not a failure.

### Phase 1 — Governance (FR-016 to FR-019, amendments 1–3)

1. **Amend the constitution.** Ninth reserve entry (application-runtime identity); reword the layout
   entry to cover resolved colour and cascaded style; require a per-test reserve tag. MINOR bump,
   with a sync-report entry stating what changed and why, in the house style.
2. **Define the vocabulary** — nine stable identifiers, one per reserve entry:
   `@reserve:window` `@reserve:focus` `@reserve:native` `@reserve:osdrag` `@reserve:pty`
   `@reserve:process` `@reserve:layout` `@reserve:input` `@reserve:runtime`
3. **Extend `e2e-tags.test.ts`.** Its `declarations()` already discovers every test and its tags; the
   tag regex is `/'(@[a-z]+)'/g` and must widen to admit a colon, or every reserve tag is invisible to
   the guard that is supposed to enforce it. Add: exactly one reserve tag per test (FR-016b); no
   reserve value outside the vocabulary; and add the nine to the `known` set so the existing
   "no category outside the vocabulary" assertion does not reject them.
4. **Tag all 687 tests** by codemod, deriving the entry from each test's actual justification.

**Why governance precedes migration:** tagging forces every test to state why it is irreducible, and
that statement is what makes the drift class in User Story 2 visible. Migrating first would mean
tagging tests that are about to be deleted, and — worse — would lose the signal that identifies which
ones those are.

### Phase 2 — The bridge parity guard (FR-010 to FR-013)

One new unit test. It must **resolve named constants and helper maps**, not only string literals:
the census's own first attempt at this reported 34 false mismatches precisely because it read
literals only (`CONFIG_WRITE_PATCH_CHANNEL`, `window-controls-ipc.ts`'s map and `daemon-events.ts`'s
sends were all invisible to it). That failure is the specification for this guard.

Red step: introduce a deliberate one-sided channel and observe the guard fail naming it.

### Phase 3 — Migrations, evidence-strongest first (FR-001 to FR-009)

Ordered so the cheapest, best-evidenced work lands first and the discipline is proven before the
ambiguous cases:

1. **Confirmed duplicates** — ~24 spans where both sides were read. Delete, cite the covering test.
2. **Files that empty entirely** — 7 files. Delete file, re-seed budget, drop `parallel-plan.json`
   entry if present.
3. **The synthetic-event class** — `tree-drop-open` (5), `os-drop` (3), `subtree-expand-collapse` (3).
   Replacement written and observed failing first.
4. **MOVE-COMPONENT with a named existing seam** — largest group.
5. **SPLIT rows** — narrow the E2E, move the rest.
6. **Rows needing a seam extraction first** — production refactor, verified against the unmodified
   E2E before any test is removed (FR-006).

### Phase 4 — Contract tests for wiring-blocking channels (FR-014, FR-014a)

Derived from Phase 1's tagging: the channels behind tests whose reserve justification was wiring.
Follows `config-write-patch.contract.test.ts` — import the real handler, drive it against real
temp-dir state, assert the real effect. Then migrate the E2E tests those channels were propping up.

### Phase 5 — Verification (SC-007, SC-009)

Full gate, then the worker sweep at 1, 3 and 6 workers against 034's baseline. This is the only full
E2E run of the feature, and it is the last thing that happens.

## Complexity Tracking

*No constitutional violations requiring justification.*

One risk worth naming rather than tracking as complexity: **Phase 3 is ~200 independent edits, and
the failure mode is a replacement that passes without proving anything.** The guard against it is
FR-002's Red step, which is per-migration and cannot be batched. Tasks are therefore written one
migration per task rather than grouped by file, so a skipped Red step is visible as an unticked task
rather than hidden inside a bulk commit.
