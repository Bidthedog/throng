# Implementation Plan: Notice-Model Integrity

**Branch**: `feature/S041-I278-I314-I327-I328-notice-consolidation` | **Date**: 2026-08-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/041-notice-model-integrity/spec.md`

---

## Summary

**One condition raises one notice, carrying one row per distinct casualty, and a repeat makes that
notice louder rather than adding another.** Three of the four issues (#278, #328, #314) are
conformance with requirements 029 and 030 already established; #327 and the keyboard route are the
only new ground.

The technical approach turns on one discovery, made while reading the code rather than the spec
([research.md](./research.md), Finding 1):

> **#327 and #328 share a root cause, and fixing #327 destroys #328's only de-duplication key.**
> `createDedicatedEditor` builds the panel *before* anything reads the file, so each refused open
> under `openTarget: 'new'` gets a fresh `panelId` — which is the duplicate row. Stop creating the
> panel and the casualty has no `panelId` at all, so `mergeAffected` (which keys on `panelId` alone)
> cannot de-duplicate it, and `useReportPanelFailure`'s `if (!place) return` drops the report
> entirely.

So the work is sequenced around a single widening: **the affected-panel list becomes a casualty list
whose panel is optional**, keyed on `(subject, reason)` plus the panel where there is one. Every row
that has an identity today keeps it, which makes the widening non-breaking. On top of that:

- a third **`OpenDecision` variant** answers "is this openable?" before a panel exists (#327);
- a **flash** replaces the two silent returns where the model already detects a repeat (#328);
- a **per-event upward absence check** decides removal suppression with no buffering (#278);
- **`focus.notice`** joins the existing `focus.*` family (#314).

---

## Technical Context

**Language/Version**: TypeScript 5.x, ES modules, Node 22 (daemon/main), Chromium (renderer)

**Primary Dependencies**: Electron, React 19, InversifyJS (DI), CodeMirror 6 (editor), xterm.js
(terminals). No new runtime dependency — the feature is additive within existing modules.

**Storage**: none. Nothing this feature adds is persisted. The notice model is in-memory and
per-window; the only durable output is the diagnostics log, which is unchanged in format.

**Testing**: Vitest projects `unit` / `component` / `integration` / `contract`; Playwright-on-Electron
for `e2e`. `npm run gate` runs all eight stages in CI's order.

**Target Platform**: Windows 11 desktop (Electron). Path handling is separator-agnostic through the
existing `toDisplayPath` helper.

**Project Type**: desktop application — npm workspaces monorepo, `@throng/core` (OS-agnostic domain)
+ `@throng/ui` (Electron main + React renderer) + daemon.

**Performance Goals**: no regression on the file-open path, and this is met by construction rather
than by discipline — the refusal is a **third variant of `OpenDecision`**, the value every open path
already awaits from `editor.openInto`. There is **no new IPC method** and no added round-trip. A
separate `probeOpenable` call was rejected for the arithmetic: it would make an *accepted* file cost
two round-trips in order to save a *refused* one a panel.

**Constraints**: the notice list is height-bounded (030 FR-032), so a new rendered field must go
through the existing per-part truncation. The pulse and its announcement must not move the list,
change its scroll position, or steal focus (FR-010).

**Scale/Scope**: four issues, five requirement groups, 30 numbered FRs with sub-parts. Roughly a dozen
files across `@throng/core` and `@throng/ui`; no new package, no new process.

---

## Constitution Check

*GATE: passed before Phase 0. Re-checked after Phase 1 design — see the second column.*

| Principle | Assessment | Post-design |
|---|---|---|
| **II. Platform-Abstracted Core** | The casualty identity, merge, ordering and suppression predicate are pure decisions and belong in `@throng/core/notice/`. The upward absence check needs a filesystem, so its **predicate** is core and its **probe** is injected. | PASS — no OS call enters core |
| **V. Test-First (NON-NEGOTIABLE)** | Every FR gets a failing test first. The layer is chosen by what the assertion needs: identity/merge/ordering/suppression are **unit**; pulse, announcement, focus and rendering are **component**; the zero-panels outcome is **integration**. | PASS — see the layer table below |
| **VI. Simple, Modern, Discoverable UX** | `focus.notice` gets **no menu item**. No `focus.*` command has one; the family is navigational keyboard input, which Principle VI exempts in as many words, and this is not a *panel* action at all. It is rebindable and documented via `keybindings-metadata.ts` (FR-027), which is what the exemption requires. | PASS — precedent verified in `context-menu.tsx` |
| **VIII. SOLID/DRY/YAGNI** | `NOT_A_MISSING_FILE` stays the single enumeration of a refusal. `DropRejection` and the load-result reason are **not** converged — FR-013c asks for one observable outcome, not one type, and merging two independently-tested types to satisfy a behavioural requirement is larger than the requirement. FR-030b forbids building a mutation harness. | PASS |
| **IX. DI & Composition Root** | The absence check is injected as a predicate, not imported — which is also what makes I2's permutation sweep possible without a filesystem. | PASS |
| **X. Externalised Configuration** | No new setting (spec Assumptions). The chord is a default in `keybindings.ts`, rebindable like every other. | PASS |
| **XI. Dockable Workspace** | Untouched. This feature changes whether a panel is **created**, never the layout model. | PASS |

**No violations. Complexity Tracking is empty.**

**Two corrections were parked for the analyze step and have since been applied to `spec.md`:**

- **FR-018b** instructed a factually wrong edit — it called a comment inaccurate that the render path
  proves correct ([research.md](./research.md), Finding 2). Rewritten; FR-018 stands.
- **FR-019** turned out to be **already honoured** in both panel types, with no task tracking it.
  It gains **FR-019a**: a guard under FR-028, not an implementation. This is the same shape as the
  three requirements the feature exists to restore — true, unasserted, and therefore one refactor
  away from being untrue.

Both are recorded in the spec's *Corrections from analysis* section rather than silently amended,
because a wrong requirement that is quietly fixed teaches nobody why it was wrong.

---

## Project Structure

### Documentation (this feature)

```text
specs/041-notice-model-integrity/
├── plan.md                      # this file
├── spec.md                      # 13 clarifications, 3 sessions
├── research.md                  # Phase 0 — six findings, all cited to source
├── data-model.md                # Phase 1 — the widening, stated as a delta
├── quickstart.md                # Phase 1 — manual validation, and what is proven by test instead
├── contracts/
│   └── notice-model.md          # Phase 1 — the model delta against 030's notice-api.md
├── checklists/
│   └── requirements.md          # 20/20
└── tasks.md                     # Phase 2 — NOT created by /speckit-plan
```

### Source code

```text
packages/core/src/
├── notice/
│   ├── affected.ts              # AffectedPanel → AffectedCasualty; key on casualtyKey()
│   ├── casualty.ts              # NEW — casualtyKey(), the identity both halves agree on
│   ├── ancestor-suppression.ts  # NEW — isSuppressedByAncestor(), pure, injected absence probe
│   ├── grouping.ts              # unchanged
│   └── index.ts                 # re-exports
└── editor/
    ├── drop.ts                  # unchanged (FR-013c — two types, one outcome)
    ├── refusal.ts               # NEW — NOT_A_MISSING_FILE, moved out of the renderer
    └── open-registry.ts         # OpenDecision gains a third variant: { action: 'refuse' }

packages/ui/src/
├── main/
│   └── editor-coordinator.ts    # openInto() returns 'refuse' — the pre-creation decision
├── renderer/
│   ├── common/
│   │   ├── notification.tsx     # flash() at the two silent returns; panel-less row render;
│   │   │                        #   focus.notice target; announcement, one per pulse
│   │   └── notification.css     # NEW — the pulse (precedent: loading.css, panel-failure-banner.css)
│   ├── editor/
│   │   ├── editor-open.tsx      # handle OpenDecision.refuse before createDedicatedEditor
│   │   ├── editor-missing-notice.ts   # comment left ACCURATE; displayPath added
│   │   └── use-editor.ts        # maybeWarn → panel-less report where there is no panel
│   ├── explorer/
│   │   └── use-explorer-data.ts # suppression at the raise site; errno to detail, not message
│   └── workspace/
│       └── panel-failure-notice.ts    # a report path that does not require locate() to succeed
└── ...

packages/core/src/config/
├── keybindings.ts               # 'focus.notice': EVERYWHERE, ['Ctrl+Alt+M']
└── keybindings-metadata.ts      # its Preferences entry (FR-027)
```

**Structure Decision**: the existing three-package layout is unchanged. Pure decisions land in
`@throng/core/src/notice/`; rendering, focus and IPC land in `@throng/ui`. Two new core modules
(`casualty.ts`, `ancestor-suppression.ts`) rather than growing `affected.ts`, because both are things a unit
test should be able to reach without importing the merge machinery.

---

## Test layer allocation

Constitution V requires the **lowest layer that can prove it**. Chosen by what each assertion needs:

| Requirement | Layer | Why not lower / higher |
|---|---|---|
| FR-003c, FR-003d — suppression, order-independence | **unit** | a pure predicate over paths + an injected absence probe. The permutation sweep (SC-006f) is only affordable here |
| FR-003 — the renderer ASKS, and one cause is one notice | **component** | added by T062. The row above proves the RULE; nothing proved the renderer consults it, and it did not — see `explorer-storm-suppression.test.ts`. A notice count needs a React tree and a notification provider, and nothing more |
| FR-007, FR-007b–d — identity, merge, ordering | **unit** | pure; `affected.ts`'s existing suite is already at this layer |
| FR-005a, FR-005b — the log keeps every casualty | **unit** | the log record is a pure projection |
| FR-004, FR-018, FR-018a — what a row renders | **component** | needs a DOM to prove *absence* of raw error text and presence of a truncated path |
| FR-008a–e — the pulse and the timer | **component** | a transient class and a timer restart are DOM-observable; no app needed |
| FR-011a–c — one announcement per pulse | **component** | counting utterances against pulses needs the live region, not an app |
| FR-020, FR-020d, FR-020e, FR-022–FR-026 — focus | **component** | focus movement *within* the notification surface. Constitution V names this case explicitly |
| FR-013, FR-013a, FR-013d, FR-017 — zero panels created | **component** | the assertion is a panel count in the workspace store and crosses nothing. `packages/ui/tests/component/editor-open-routing.test.ts` already stubs `openInto` and asserts panel absence — its header says it exists precisely so these claims need no Electron |
| FR-015 — what `openInto` returns for each reason | **integration** | this one genuinely crosses renderer → IPC → main |
| FR-020a — the chord survives a focused terminal | **e2e** | only a real shell can prove it never received the chord |

**E2E is one test.** It asserts **one thing**: that a real shell does not swallow `Ctrl+Alt+M`. That
focus *arrives* at the notice is a component assertion and belongs to the Group 4 component tests;
splitting them is not tidiness but what `packages/ui/tests/unit/e2e-tags.test.ts` enforces, since it
fails a test that appears to need two reserve entries (035 FR-016b).

**Its home changed during T062, and the reason is worth keeping.** The plan put it in
`packages/ui/tests/e2e/window-chord-resolution.e2e.ts`, which holds this exact family — *"the tab
picker still resolves — `Ctrl+Alt+T`"*, an `EVERYWHERE` chord in the same `Ctrl+Alt` group. That file's
shared app has an editor and **no terminal**, and the assertion needs a notice to move focus TO, so
what got written there was a press over a focused *editor* against an *empty* notice stack — which an
inert binding passes identically. The family was the right neighbourhood and the wrong fixture.

It now lives in `packages/ui/tests/e2e/notice-focus-chord.e2e.ts`, which builds the `cmd` and the
missing-file notice it needs, and `window-chords.ts`'s `COVERED_ELSEWHERE` points the manifest guard at
it — the mechanism `menu.open` already uses for the same reason. Tags are unchanged:
`['@extended', '@window', '@reserve:input']`, and so is the budget.

**The two tags come from two separate decisions**, and keeping them separate matters: `@reserve:input`
(real keyboard and input dispatch, *not* `@reserve:pty`) follows from what the test claims — where a
chord is **routed**, not terminal rendering fidelity. The **significance** tag is its own call, and
`@extended` is the answer: `@core` is capped at 50, stands at 38 and gates every push, while chord
routing does not change per-commit. Everything about `focus.notice` that could regress on a push is
covered at the component layer.

**Joining a file rather than creating one removes a whole class of obligation.** A new spec would have
needed a `parallel-plan.json` serial entry carrying a mechanism from a closed set
(`FOCUS`/`CPU`/`TIMING`/`UNATTRIBUTED`), whose `UNATTRIBUTED` count `tier-plan.test.ts` asserts by
**equality** at 14 — so adding one reddens the build. An existing serial file already has its
placement.

Two ratchets still apply:

- **`reserve-tag-debt.json`** (`untagged: 121`) may fall and must never rise. A newly-tagged test
  leaves it at 121; an *un*tagged one would raise it and fail the build.
- **`e2e-budget.json`** is re-seeded in the **same commit**: `total` 558 → 559 and
  `byCategory["@window"]` 191 → 192 — `@window`, because that is the tag the test carries. **`core`
  stays at 38**, the test being `@extended`. Include the one-sentence justification its own note
  demands.

---

## Delivery order

Sequenced by dependency, not by issue number. Each step is test-first and lands green.

1. **The widening** — `casualtyKey`, `AffectedCasualty`, merge keyed on identity. Nothing observable
   changes; every existing test must still pass. This is the foundation the other three sit on.
2. **The flash** (#328) — replace the two silent returns; pulse, timer restart, absorption,
   one-announcement-per-pulse. Now observable, and now testable without a panel.
3. **The refusal** (#327) — `OpenDecision`'s `refuse` variant, handled at every panel-creating entry
   point, plus the panel-less report path. **This is the highest-risk step**, for two reasons that
   compound: getting the report path wrong turns "no panel is created" into "no panel and no
   notification"; and `openFileInNewEditor` never asks `openInto` at all, so the compile-time
   enforcement the rest of the design leans on does not reach the explorer's own *Open In → New
   Editor* — the surface #327 was reported from.
4. **The suppression** (#278) — the upward absence check, plus moving the errno off the message and
   on to `detail`.
5. **The keyboard route** (#314) — `focus.notice`, the focus-origin stack, the affordance.
6. **The guards** (Group 5) — each restored requirement's guard, each proven once by reverting its
   fix and observing that guard fail, recorded in the PR (FR-030a). **No mutation harness ships**
   (FR-030b).

Steps 3 and 4 are independent of each other and both depend on 1. Step 5 depends on nothing but is
last because it is the only item that adds a capability rather than restoring one.

---

## Risks

| Risk | Mitigation |
|---|---|
| **A missing file classified as a refusal** destroys 018's recovery path (a panel holding a recovered buffer, saved back) | `openInto` returns `{ action: 'open' }` for a missing file, asserted directly (T039); quickstart §3.7 checks it by hand |
| **The panel-less report is dropped** by `useReportPanelFailure`'s `if (!place) return` | the guard stays for a destroyed panel; a refusal takes a different path. Component test T041 asserts a notification appears with zero panels |
| **Workspace restore stops creating panels** (FR-017) | the refusal gates the *open-a-file action*, never panel creation. Quickstart §3.8 |
| **The refusal check adds a round-trip to a hot path** | it is a variant of `OpenDecision`, which every open path already awaits — there is no second call to add |
| **A future entry point forgets the refusal** | the `refuse` variant makes an unhandled case a **compile** error, not a convention |
| **`NOT_A_MISSING_FILE` is unreachable from main** | it moves to `@throng/core`, re-exported from its current home so no caller changes |
| **The relative path breaks the height bound** | `displayPath` goes through the same per-part truncation as every other rendered name; SC-005b measures a >100-character path |
| **The announcement floods a screen reader** | bound to the pulse, not to a duration (FR-011c). SC-006e counts utterances against pulses |
| **A stale `packages/core/dist`** makes E2E disagree with unit tests about a constant | `rm packages/core/tsconfig.tsbuildinfo && rm -rf packages/core/dist`, rebuild — vitest resolves core to source, the app loads `dist` |

---

## Complexity Tracking

*No Constitution Check violations. This section is intentionally empty.*
