# Implementation Plan: Editor Status Bar Readouts and Gutter Visibility

**Branch**: `feature/S040-I256-editor-status-bar-and-gutter` | **Date**: 2026-08-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/040-editor-status-bar-and-gutter/spec.md`

## Summary

Give the editor status bar the four things a reader wants to know about the document without leaving
it — caret line and column, and selected / total character and total word counts — behind two
preference toggles, then file every status-bar setting under **Editor → Status Bar** and add a
preference that hides the line-number gutter.

The technical approach is deliberately unoriginal: every mechanism this feature needs already exists
in the codebase for a shaped-alike problem, and the plan's main job is to use those rather than
invent parallel ones. The readouts ride the editor's **existing** `updateListener`; the gutter uses
the **existing** CodeMirror compartment idiom that word wrap, indentation and language already use;
the numbers go through the **existing** `formatGrouped`. The one genuinely new mechanism is the
bar's ordered width degradation, and it is new because no existing surface has that requirement.

Full reasoning, with the code that justifies each choice, is in [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.x, ES modules throughout

**Primary Dependencies**: CodeMirror 6 (`@codemirror/view`, `@codemirror/state`), React 19, Electron,
InversifyJS for composition

**Storage**: user settings JSON via the existing config store (atomic write, hot reload); no database
change — this feature adds no persisted state beyond three boolean settings

**Testing**: Vitest projects — `unit`, `component` (jsdom), `integration`, `contract`; Playwright on
Electron for `e2e`

**Target Platform**: Windows desktop (Electron)

**Project Type**: desktop application, npm workspaces monorepo

**Performance Goals**: caret readouts computed **synchronously inside the update-listener invocation
that reports the caret move** (FR-008a — phrased this way rather than "the same frame", which has no
observable form a test can assert); document counts settle within **200 ms** of the last edit;
counting a **5 MB** document completes within an absolute **2 s** regression alarm. The "typing feels
no heavier with the counts on" claim is **verified by hand** (quickstart §6.1a) and deliberately not
automated — FR-008c says why. (FR-008a–c, SC-005)

**Constraints**: the status bar is exactly one line high at every panel width and the editor's height
must not change as segments appear or disappear (FR-020); no numeric readout may ever render
truncated (FR-022); the language indicator and wrap toggle are never hidden by width (FR-024, and
016 FR-010c requires it)

**Scale/Scope**: three new settings, one new descriptor field, five readouts, three preference tabs
touched, two editor call sites for the gutter

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against constitution **5.4.0** — which this branch itself amends, so the version matters.

| Gate | Verdict | Note |
|---|---|---|
| **II — Platform-Abstracted Core** | PASS | Counting rules and descriptors live in `@throng/core` and touch no OS API. Rendering stays in `@throng/ui`. |
| **V — Test-First Quality Discipline** | PASS | Every task is Red → Green. Layer chosen per behaviour ([research.md D8](./research.md)); E2E reserved for the real window and real keyboard. |
| **VI — Simple, Modern, Discoverable UX** | PASS | Two toggles, not five (FR-032). Readouts have accessible names (FR-015). |
| **VI — every panel action has a menu item** | **N/A, and deliberately so** | The rule is about *actions*; a readout performs nothing. Finding 2 in the spec argues this, FR-009 states it. This is the gate most likely to be mis-answered by a reviewer, so it is answered here explicitly rather than left blank. |
| **VI — action controls are themeable icons with hover titles** | PASS | No new action control. The language label and wrap toggle are unchanged. |
| **VIII — SOLID / DRY / YAGNI** | PASS, **with one debt paid** | Reuses four existing mechanisms rather than adding parallel ones; the one new mechanism (ordered width degradation) has no existing equivalent. **DRY needed work, not just a tick**: `groupDescriptors` is already duplicated verbatim between `settings-tab.tsx:46` and `keybindings-tab.tsx:49`, and FR-036 would have made that three near-copies of a rule that must stay identical. T029a extracts one shared helper first. |
| **VIII — the second sub-grouping convention** | **ACCEPTED DEBT, recorded** | FR-036 lands `subgroup` in two registries that already express sub-grouping as sibling strings. Not resolved here — migrating is not what #258 asks (Finding 4) — but stated in FR-037a/FR-037b with a follow-up, rather than left for the next reader to find. |
| **IX — DI & Composition Root** | PASS | No new injectable service. Settings reach the renderer through the existing config store client. |
| **X — Externalised Configuration** | PASS | Three descriptors added to the metadata registry; the completeness test (007 FR-047) enforces it. FR-050. |
| **XI — Dockable Workspace / only view state differs per panel** | PASS | Caret is view state → per panel (FR-006). Counts are document state → per document (FR-007). This distinction is designed in, not incidental — [research.md D5](./research.md). |
| **Digit grouping (5.4.0, NON-NEGOTIABLE)** | PASS | FR-027 via `formatGrouped`. This feature is the reason the rule's scope was widened. |
| **Disabled when unavailable, absent when meaningless (4.7.0)** | PASS | A readout switched off by preference or dropped by width is *absent*, and absent from the accessibility tree too (FR-017) — it is meaningless, not unavailable. |

**No violations.** One row is an *accepted, recorded debt* rather than a pass — the second
sub-grouping convention — and it is tracked by FR-037a/FR-037b and a follow-up issue rather than
justified away. Complexity Tracking stays empty because nothing here needs a complexity justification:
the debt is a scope decision, not added complexity.

## Project Structure

### Documentation (this feature)

```text
specs/040-editor-status-bar-and-gutter/
├── spec.md              # the requirements (committed)
├── checklists/
│   └── requirements.md  # spec quality checklist (committed)
├── plan.md              # this file
├── research.md          # Phase 0 — the eight decisions and their code evidence
├── data-model.md        # Phase 1 — settings, descriptor shape, store shapes
├── contracts/
│   ├── settings.md      # the three new setting keys as a contract
│   └── metadata.md      # the FieldDescriptor.subgroup contract
├── quickstart.md        # Phase 1 — how to validate the feature end to end
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/core/src/config/
├── app-settings.ts            # + editor.statusBar.showCursorPosition, .showCounts, editor.showGutter
├── settings-metadata.ts       # + three descriptors; showStatusBar description rewritten (FR-034);
│                              #   the three status-bar keys gain subgroup: 'Status Bar' (FR-037)
└── metadata.ts                # + FieldDescriptor.subgroup?: string  (FR-035)

packages/core/src/editor/
└── document-metrics.ts        # NEW — the pure counting rules (FR-002a, FR-003a, FR-003b, FR-004a)

packages/ui/src/renderer/editor/
├── status-strip.tsx           # + the five readouts, two alignment groups (FR-012, FR-013)
├── status-strip-fit.ts        # NEW — the pure fit/drop ordering (FR-021 – FR-026)
├── caret-store.ts             # NEW — per-PANEL caret position (FR-006)
├── document-metrics-store.ts  # NEW — per-DOCUMENT counts, debounced (FR-007, FR-008b)
├── editor.css                 # justify-content flex-end -> space-between (FR-013); nowrap (FR-020)
├── use-editor.ts              # updateListener widened ABOVE its guard; gutterCompartment
├── standalone-editor.tsx      # gutterCompartment — the second call site FR-042 requires
└── commands.ts                # + gutterCompartment, beside wrapCompartment/indentCompartment

packages/ui/src/renderer/preferences/
├── settings-tab.tsx           # subsection rendering (FR-036, FR-036a–c)
├── keybindings-tab.tsx        # same, so one registry cannot render two ways
└── themes-tab.tsx             # same

packages/core/tests/unit/        # counting rules, descriptor completeness, counting perf ceiling
packages/ui/tests/unit/          # caret store, metrics store, THE FIT ORDERING, gutter scope
packages/ui/tests/component/     # bar rendering, a11y, declared CSS properties, subsection rendering
packages/ui/tests/e2e/           # every genuine MEASUREMENT; gutter live reconfigure; real input
```

**Structure Decision**: the existing monorepo layout, unchanged.

- **`document-metrics.ts` goes to `packages/core/src/editor/`** — it is domain logic (what a document
  contains), it is OS-agnostic, and the requirements that define it are testable with no DOM. It is
  filed under `editor/` rather than `config/` because it counts documents, not settings, and
  `config/` already holds **35 files** and a subdirectory, all of them genuinely configuration.
- **`status-strip-fit.ts` stays in `packages/ui/src/renderer/editor/`.** It is pure arithmetic, so it
  is unit-testable in the node project (`packages/**/tests/unit/**` covers `packages/ui`), but it is
  renderer-shaped — it exists to answer "what fits in this bar" and has no consumer outside the
  renderer. Putting it in core would export a layout decision from the platform-agnostic domain
  layer, which Principle II is specifically there to prevent.

Everything that renders stays in `packages/ui`.
Three new small modules rather than additions to existing large ones, because `use-editor.ts` is
already **1,317 lines** and `status-strip.tsx` should not grow a debounce and a measurement loop
inline.

## Implementation phases

Ordered so each phase leaves the tree green and the next phase has something to build on. The spec's
own ordering (#256 → #257 → #258 → #254) is preserved, with the pure rules pulled to the front
because everything else asserts against them.

| Phase | What | Depends on |
|---|---|---|
| **A** | **Foundational**: the pure **counting rules** in `@throng/core`, and **`subgroup` on `FieldDescriptor`** — both block work downstream | — |
| **B** | The **two `editor.statusBar.*` settings**: model, descriptors, defaults, completeness | **A** — their descriptors carry `subgroup: 'Status Bar'` (FR-037), which is A's field |
| **C** | Caret + metrics stores, `updateListener` widening | A |
| **D** | Status bar renders the readouts and their a11y names | **C only** — the readouts render at their defaults, so US1 does not wait on the toggles |
| **E** | The **fit ordering** in `@throng/ui` + width degradation wired to it | D |
| **F** | `showStatusBar` description rewrite (#257) | D — it may not promise readouts that do not exist |
| **G** | Subsection rendering in all three tabs, and the two toggles honoured (#258) | A (for `subgroup`), B, D |
| **H** | **`editor.showGutter` end to end** — its key, its descriptor, and `gutterCompartment` in both call sites (#254) | A only (genuinely independent) |

**This table is a narrative of the work, not the execution order** — `tasks.md`'s dependency graph is
the authority, and one task can discharge parts of several phases (T027 covers B, F and part of G).
Where the two disagree, the task graph wins and this table is the thing to fix.

Two dependencies are requirements rather than conveniences:

- **Phase F depends on D** — the spec's own acceptance criterion for #257: *"lands with, or after, the
  status-bar readouts issue; a description promising readouts that do not exist yet is worse than the
  one it replaces"*.
- **Phase H owns `editor.showGutter` outright, key and descriptor included.** An earlier draft of this
  table put all three settings in Phase B while Phase H claimed independence — which was false, since
  H's whole behaviour hangs off a key B created. US4 is only independently deliverable if the key
  travels with it.

## Risks, and what is done about them

1. **Widening the `updateListener` is the highest-risk edit in the feature** — one line in the
   editor's hottest path, where getting it wrong sends phantom edits to the document authority. The
   mitigation is structural: add the two new concerns *above* the existing early-return and leave that
   line untouched. **A test asserts that a selection-only update produces no `replica.record` call**;
   without it, the regression is silent and shows up as duplicated undo history days later.
2. **The E2E budget is a ratchet that fails both ways**, and it counts **declarations, not files** —
   its own `countingBasis` says so, so "+1 per spec file" would be wrong in both directions.
   `e2e-budget.json` currently declares **552 total / 36 core / @editor 111 / @prefs 88**.

   **Two spec files are added, carrying six declarations between them:**

   | Spec | Declarations | Significance tag | Why |
   |---|---|---|---|
   | `editor-status-bar.e2e.ts` (T014) | **2** | `@core` | The feature's central promise — the readouts tracking real input. Worth gating every push. |
   | `editor-gutter-visibility.e2e.ts` (T037) | **4** | `@extended` | Real behaviour, but the `@core` lane is capped at 50 and sits at 36; spending four of the remaining fourteen on one preference is not the best use of a push gate. |

   So the counters move: **`total` 552 → 558**, **`core` 36 → 38**, **`byCategory.@editor` 111 → 117**.
   If either file ends up with a different number of declarations, the deltas move with it — the
   number in the file must match what was written, not what was planned.
3. **A stale `packages/core/dist` makes E2E disagree with unit tests about a constant.** Documented
   in CLAUDE.md and it has already cost one gate run: vitest resolves `@throng/core` to source while
   the Electron app loads `dist`. This feature adds constants to core that the E2E tests read, so it
   is squarely in the blast radius. If an E2E contradicts a unit test, rebuild `dist` before
   debugging the code.
4. **`ResizeObserver` in jsdom** — **eight** existing component tests already stub it. Reuse that
   pattern; do not write a ninth.
5. **jsdom has no layout, so a width or height assertion cannot be written at the component tier.**
   `packages/ui/tests/component/setup.ts` says so outright, and the one CSS precedent
   (`notice-pointer-events.test.ts`) asserts declared keywords only, never resolved lengths — jsdom
   does not resolve `var()`. Anything in this feature that is genuinely a *measurement* (the bar's
   one-line height, the two groups not overlapping, the text's left edge after the gutter goes) is
   therefore an **E2E** assertion; the component tier asserts the declared properties that produce it.
   Getting this wrong is worse than not testing: a green component test that measured nothing reads as
   coverage.
6. **The component tier collects `*.test.ts` only.** `vitest.config.ts` includes
   `packages/**/tests/component/**/*.test.ts`, and **no `.test.tsx` file exists anywhere in the repo** —
   existing component tests render with `createElement`. A `.tsx` test is collected by nothing, runs
   nowhere, and reports "no test files found" while looking like a passing Red step.

## Complexity Tracking

No constitution violations. Section intentionally empty.
