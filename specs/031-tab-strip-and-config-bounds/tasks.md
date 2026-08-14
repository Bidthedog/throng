# Tasks: Tab strip overflow, name limits, and bounded configuration

**Feature**: 031 | **Branch**: `feature/S031-I225-I226-I227-tab-strip-and-config-bounds` | **PR**: [#243](https://github.com/Bidthedog/throng/pull/243)

**Input**: [spec.md](./spec.md) · [plan.md](./plan.md) · [research.md](./research.md) · [data-model.md](./data-model.md) · [contracts/](./contracts/) · [quickstart.md](./quickstart.md)

## Test discipline

Tests are **not optional here**. Constitution Principle V is NON-NEGOTIABLE (test-first, and every
user-facing UI change ships E2E coverage), and spec FR-048 restates it. Every implementation task
below is preceded by the test that must fail first.

**The Red step is the point.** Write the test, *run it*, and confirm it fails **for the reason you
expect** — a test failing on a bad import proves nothing. Then make it pass.

**Layers available in this repo** (R10) — there is **no component-test stack**, so nothing below asks
for one:

| Layer | Command |
|---|---|
| unit | `npm run test:unit` |
| integration | `npm run test:integration` |
| contract | `npm run test:contract` — *unused by this feature; it adds no OS seam* |
| E2E | `npm run test:e2e` |

**Every new E2E spec file must be registered** in `packages/ui/tests/e2e/shard-plan.json`, and any
spec that opens preferences or drives a context menu must also go in `parallel-plan.json`'s serial
tier. `packages/ui/tests/unit/shard-plan.test.ts` fails the build otherwise — a spec in no group runs
nowhere, and does so silently.

---

## Phase 1: Setup

- [x] T001 Add a `seedTabs(win, names[])` E2E helper that creates tabs with given names and returns their testids, in `packages/ui/tests/e2e/helpers/tabs.ts` — shared by US1, US3 and US5, which all need an overflowing strip
- [x] T002 [P] Add a `stripGeometry(win)` E2E helper returning each tab's `getBoundingClientRect()`, the track's scroll metrics and whether a scrollbar is present, in `packages/ui/tests/e2e/helpers/tabs.ts` — geometry is what US1 asserts, and reading it in one place stops each spec inventing its own selectors

---

## Phase 2: Foundational

No blocking prerequisites. The five stories are independent slices; US3 and US4 depend on US2 only
because they add bounded settings, which is expressed by ordering rather than by shared scaffolding.

---

## Phase 3: User Story 1 — The tab strip stops mangling its own tabs (P1)

**Goal**: An overflowing strip looks exactly like a non-overflowing one. No scrollbar, no clipping,
`+` pinned, fades that displace nothing.

**Independent test**: Create tabs until the strip overflows; a tab's height and vertical position are
identical to before, no scrollbar is rendered, and `+` has not moved.

### Tests (write first, watch fail)

- [x] T003 [P] [US1] E2E: an overflowing strip renders **no** horizontal scrollbar, in `packages/ui/tests/e2e/tab-strip-overflow.e2e.ts` (L1)
- [x] T004 [P] [US1] E2E: a tab's `height` and `top` are identical before and after the strip overflows — the reported defect, asserted as **geometry**, not as a CSS class, in `packages/ui/tests/e2e/tab-strip-overflow.e2e.ts` (L2)
- [x] T005 [P] [US1] E2E: `+` is visible at 1 tab and at 30, pinned to the right edge, vertically centred, and square (width === height), in `packages/ui/tests/e2e/tab-strip-overflow.e2e.ts` (L3)
- [x] T006 [P] [US1] E2E: fades appear over the left-most tab's leading edge when tabs are hidden left and the right-most tab's trailing edge when hidden right, in `packages/ui/tests/e2e/tab-strip-overflow.e2e.ts` (L4)
- [x] T007 [P] [US1] E2E: every tab's `offsetLeft` is identical with and without a fade showing — the fade is an overlay, in `packages/ui/tests/e2e/tab-strip-overflow.e2e.ts` (L5)
- [x] T008 [P] [US1] E2E: dragging a tab to reorder from a **scrolled** position still reorders, with the insertion indicator on the boundary under the pointer, in `packages/ui/tests/e2e/tab-strip-overflow.e2e.ts` (L7)
- [x] T008a [P] [US1] E2E: widening the window until the tabs fit **while the strip is scrolled** returns it to the start, removes the tab-action controls and leaves no fade showing, in `packages/ui/tests/e2e/tab-strip-overflow.e2e.ts` (spec Edge Cases)
- [x] T008b [P] [US1] E2E: renaming a tab so it pushes the strip into overflow — and back out — behaves correctly while the rename field is still open, in `packages/ui/tests/e2e/tab-strip-overflow.e2e.ts` (spec Edge Cases)
- [x] T008c [P] [US1] E2E: the strip behaves identically in a **sub-workspace window** — no scrollbar, same geometry, controls appear on overflow, in `packages/ui/tests/e2e/tab-strip-overflow.e2e.ts` (spec Assumptions, Edge Cases)
- [x] T008d [P] [US1] E2E **asserting** L6 rather than inspecting for it: scroll the strip, trigger a layout save, reload the project, and assert the persisted layout carries no scroll offset and the strip starts at the beginning, in `packages/ui/tests/e2e/tab-strip-overflow.e2e.ts` (L6, FR-006)
- [x] T009 [US1] Register `tab-strip-overflow.e2e.ts` in `packages/ui/tests/e2e/shard-plan.json` **and in `parallel-plan.json`'s serial tier** — it drives drag-and-drop and a sub-workspace window, both of which steal focus

### Implementation

- [x] T010 [US1] Restructure `.tab-strip` in `packages/ui/src/renderer/theme.css`: outer non-scrolling flex row; inner `.tab-strip__track` with `overflow-x: hidden`; remove the `overflow-x: auto` that causes the defect (L1, L2)
- [x] T011 [US1] Pin `.tab-strip__add` outside the track, vertically centred and square, in `packages/ui/src/renderer/theme.css` (L3)
- [x] T012 [US1] Add `.tab-strip__fade--left` / `--right` as absolutely-positioned overlays on the track, gated by data attributes, in `packages/ui/src/renderer/theme.css` (L4, L5)
- [x] T013 [US1] Wrap the tab chips in the track element and keep the drag insertion indicator positioned against the track's scroll offset, in `packages/ui/src/renderer/workspace/tab-group.tsx` (L7)
- [x] T014 [US1] Set the fade data attributes from live overflow state in `packages/ui/src/renderer/workspace/tab-group.tsx` (L4)
- [x] T015 [US1] Hold scroll position in component state only, never in `ws.layout`, in `packages/ui/src/renderer/workspace/tab-group.tsx` (L6, FR-006)
- [x] T015b [US1] **After** the restructure lands, sweep the ~20 existing E2E specs that drive the tab strip for selectors it moves — the track wrapper, the pill replacing `[n]`, the reserved close-affordance space — and update them, in `packages/ui/tests/e2e/` (found by `/speckit-analyze` U1; otherwise only T115 catches it, after the fact)

  **Why this one is not in the Tests block**: it updates *existing* specs against selectors that do not move until T010–T014 land. Written first it would fail for a reason unrelated to its own assertion, which is exactly what the Red step is supposed to rule out. It is maintenance of the suite, not a new behaviour under test.

**Checkpoint**: US1 is independently shippable — the defect is fixed with no new settings.

---

## Phase 4: User Story 2 — A hand-edited setting can no longer break the app (P2)

**Goal**: Every declared bound enforced on read through one generic guard, corrected values written
back exactly once, by exactly one process.

**Independent test**: Put out-of-range values in `settings.json`, start the app, confirm each loads at
its bound and the file now says so; a clean file is not rewritten.

### Tests (write first, watch fail)

- [x] T016 [P] [US2] Unit: **enumerate `SETTINGS_METADATA`** and assert every descriptor carrying `min`/`max` clamps below-min to min and above-max to max — the test must *discover* the bounded set, not list it, in `packages/core/tests/unit/bounds-guard.test.ts` (G1, SC-004)
- [x] T017 [P] [US2] Unit: a `map`/`records` descriptor's **column** bounds are enforced per entry — `editor.indentByLanguage` with `indentWidth: 500` loads as 16, in `packages/core/tests/unit/bounds-guard.test.ts` (G2)
- [x] T018 [P] [US2] Unit: a malformed entry does not invalidate its table; the others load, in `packages/core/tests/unit/bounds-guard.test.ts` (G3)
- [x] T019 [P] [US2] Unit: a dropped entry is restored from the shipped default **for its own key**; an entry for a key the defaults lack is dropped; correct entries are untouched, in `packages/core/tests/unit/bounds-guard.test.ts` (G4)
- [x] T020 [P] [US2] Unit: every entry malformed → the table holds exactly the shipped defaults, never nothing, in `packages/core/tests/unit/bounds-guard.test.ts` (G4, FR-008d)
- [x] T021 [P] [US2] Unit: a **deliberately emptied clearable** table stays empty — absence is not malformation, in `packages/core/tests/unit/bounds-guard.test.ts` (G7, FR-008f)
- [x] T021a [P] [US2] Unit: a **scalar-valued map** — a column with no `key`, as `editor.languageByExtension` has — is corrected against the entry's value, not a property of it, in `packages/core/tests/unit/bounds-guard.test.ts` (G7a)
- [x] T021b [P] [US2] Unit: a `select` column declaring **no `allowedValues`** enforces nothing, so every user mapping in `editor.languageByExtension` survives. Without this the guard would find each value "outside the set" and wipe the one table FR-008f protects, in `packages/core/tests/unit/bounds-guard.test.ts` (G7b)
- [x] T021c [P] [US2] Unit: a `records` control (`terminals.flavours`) is corrected per entry against its columns, keyed by its identity field, in `packages/core/tests/unit/bounds-guard.test.ts` (G7c)
- [x] T021d [P] [US2] Integration: a **daemon-side** read of an out-of-range file corrects in memory and leaves the file's mtime untouched — the "exactly one writer" half of SC-004b, in `packages/ui/tests/integration/settings-bounds-writeback.test.ts` (W3, FR-013b, SC-004b)
- [x] T022 [P] [US2] Unit: wrong type / absent / `null` / non-finite → shipped default; bad enum and non-boolean → shipped default, in `packages/core/tests/unit/bounds-guard.test.ts` (G5, G6)
- [x] T023 [P] [US2] Unit: `corrected` is true iff a correction was recorded, and the guard is **idempotent** — a second pass records nothing, in `packages/core/tests/unit/bounds-guard.test.ts` (G8, G9)
- [x] T024 [P] [US2] Unit: never throws for a non-object, an array, a cyclic structure, or a degenerate `min === max` bound, in `packages/core/tests/unit/bounds-guard.test.ts` (G10, spec Edge Cases)
- [x] T025 [P] [US2] Unit: `terminals.linkHoverDelayMs` clamps to the **declared** 0–2000, not the old hand-written 0–5000, in `packages/core/tests/unit/bounds-guard.test.ts` (FR-015)
- [x] T026 [P] [US2] Integration: an out-of-range `settings.json` loads corrected **and the file is rewritten** to match, in `packages/ui/tests/integration/settings-bounds-writeback.test.ts` (W1)
- [x] T027 [P] [US2] Integration: a fully in-range `settings.json` is **not** rewritten — assert the file's mtime is unchanged, in `packages/ui/tests/integration/settings-bounds-writeback.test.ts` (W2)
- [x] T028 [P] [US2] Integration: re-reading a written-back document produces no further correction and no second write — the sequence settles after one, in `packages/ui/tests/integration/settings-bounds-writeback.test.ts` (W5)
- [x] T029 [P] [US2] Integration: a write-back that fails (read-only file) still starts the app on corrected values and does not retry in a loop, in `packages/ui/tests/integration/settings-bounds-writeback.test.ts` (W6, FR-018)
- [x] T029a [P] [US2] Integration: a **correction and a user save arriving together** neither interleave nor lose either write — the file ends up holding the user's save with the correction applied to it, in `packages/ui/tests/integration/settings-bounds-writeback.test.ts` (W4, FR-013c, SC-004b — the plan calls this a headline constraint and it had no test)
- [x] T029b [P] [US2] Integration: a value hand-edited out of range **while the app is running** is corrected on reload **and written back** — the reload half of "correct on every read", in `packages/ui/tests/integration/settings-bounds-writeback.test.ts` (W7, FR-013a, US2 scenario 12)
- [x] T029c [P] [US2] Integration: **resetting a setting to its shipped default** works with the guard live and causes no write-back churn, in `packages/ui/tests/integration/settings-bounds-writeback.test.ts` (G13, FR-017)
- [x] T029d [P] [US2] Unit: a table entry that is corrected, dropped or restored sets `corrected` — a file whose only fault is inside a table is still written back, in `packages/core/tests/unit/bounds-guard.test.ts` (G12, FR-008e)
- [x] T029e [P] [US2] Unit: the enforced bound is `hardMin ?? min` / `hardMax ?? max`; a descriptor declaring neither is unaffected; `diagnostics.maxFileSizeKb` with `hardMax: 65536` keeps a hand-set 64 MB cap while its slider still offers 64–4096, in `packages/core/tests/unit/bounds-guard.test.ts` (G0, G0a, FR-015a, FR-015b)
- [x] T029f [P] [US2] Unit: `terminals.linkHoverDelayMs`, `diagnostics.keepFiles` and `search.asYouTypeDebounceMs` clamp to their **declared** ranges (0–2000, 1–20, 0–1000), in `packages/core/tests/unit/bounds-guard.test.ts` (G1a, FR-015)

### Implementation

- [x] T030 [US2] Implement `applyDeclaredBounds(raw, registry, defaults) -> CorrectionOutcome<T>` per [contracts/bounds-guard.md](./contracts/bounds-guard.md), in `packages/core/src/config/bounds-guard.ts` (G1–G11)
- [x] T031 [US2] Export it from `packages/core/src/index.ts`
- [x] T032 [US2] Route the settings parse through the guard in `packages/core/src/config/app-settings.ts`, keeping `parseAppSettings`'s existing signature for callers that only want the value (FR-009)
- [x] T032a [US2] Add optional `hardMin` / `hardMax` to `FieldDescriptor` (and `MapColumn`), defaulting to `min`/`max` when absent so every existing descriptor is unaffected, in `packages/core/src/config/metadata.ts` (FR-015b)
- [x] T032b [US2] Declare `hardMax: 65536` on `diagnostics.maxFileSizeKb` and replace the comment that explained the gap in prose with the declaration the guard can read, in `packages/core/src/config/settings-metadata.ts` (FR-015a, FR-015c)
- [x] T033 [US2] **Remove** the hand-written clamps: `commandPollMs`, `linkHoverDelayMs`, and the range checks in `diagnosticsSettings` and `searchSettings`, in `packages/core/src/config/app-settings.ts`. Note this **narrows** `keepFiles` to 1–20 and `asYouTypeDebounceMs` to 0–1000 — deliberate per FR-015, unlike `maxFileSizeKb`, which keeps its wider bound via T032b (FR-016)
- [x] T034 [US2] Give `FileConfigStore.read()` a way for validation to report a correction, and write the corrected document back when it did, in `packages/ui/src/main/config-store.ts` (W1, W2, W4)
- [x] T035 [US2] Confirm the daemon's `readFileSync` settings path corrects in memory and **never** writes, in `packages/daemon/src/composition-root.ts` (W3, FR-013b)

**Checkpoint**: US2 is independently shippable and unblocks the new settings in US3 and US4.

---

## Phase 5: User Story 3 — Reaching a tab you cannot see (P3)

**Goal**: Tab-actions group with live counts, a typeahead picker (built general, for #219 to reuse),
a rebindable chord, and eased scrolling that honours reduce-motion.

**Independent test**: With more tabs than fit, walk the strip end to end with the step controls, then
jump to a far tab from the picker; the counts track the strip throughout.

### Tests — pure logic (write first, watch fail)

- [x] T036 [P] [US3] Unit: `stripCounts` counts only **fully** hidden tabs each side; a partly-visible tab is neither, in `packages/core/tests/unit/tab-strip.test.ts` (S1)
- [x] T037 [P] [US3] Unit: `stepTarget` moves exactly one tab and lands it flush with the left edge; returns `null` when nothing is hidden that way, in `packages/core/tests/unit/tab-strip.test.ts` (S3, S4)
- [x] T038 [P] [US3] Unit: `revealTarget` returns `null` for an already-fully-visible tab, in `packages/core/tests/unit/tab-strip.test.ts` (S5)
- [x] T039 [P] [US3] Unit: counts hold when one tab is wider than the whole viewport, in `packages/core/tests/unit/tab-strip.test.ts` (S6)
- [x] T040 [P] [US3] Unit: `ease` is monotonic over [0,1], `ease(0) === 0`, `ease(1) === 1`, and accelerates then decelerates, in `packages/core/tests/unit/tab-strip.test.ts` (A4, A5)
- [x] T041 [P] [US3] Unit: `matches('file find.txt', 'find file')`, `matches('find any file.md', 'find file')` and `matches('prefix file any find.pdf', 'find file')` are all **true** — the spec's three worked examples verbatim, in `packages/core/tests/unit/picker-match.test.ts` (K4)
- [x] T042 [P] [US3] Unit: matching is case-insensitive; an empty or whitespace-only query matches everything; a term matches across separators (`find file` matches `src/find/file.ts`), in `packages/core/tests/unit/picker-match.test.ts` (K5, K6, K7)
- [x] T043 [P] [US3] Unit: `matchSpans` returns a span per matched term, and none for an empty query, in `packages/core/tests/unit/picker-match.test.ts` (K10)
- [x] T043a [P] [US3] Unit: **verify** FR-032c rather than asserting it in prose — the shipped default for `tabs.openPicker` is `Ctrl+Alt+T`, and that chord appears in neither the constitution's reserved tier nor its enumerated shadowable exceptions, in `packages/core/tests/unit/keybindings.test.ts` (FR-032c, constitution IV)

### Tests — behaviour (write first, watch fail)

- [x] T044 [P] [US3] E2E: tab actions appear **only** when the strip overflows, inside the pane, between the tabs and `+`, in `packages/ui/tests/e2e/tab-actions.e2e.ts` (T1, T2)
- [x] T045 [P] [US3] E2E: the three counts match hidden-left / hidden-right / total, and update on scroll, add, destroy, reorder and resize, in `packages/ui/tests/e2e/tab-actions.e2e.ts` (T3, S2)
- [x] T046 [P] [US3] E2E: a step moves exactly one tab and the revealed tab is flush left; the control is unavailable when nothing is hidden that way, in `packages/ui/tests/e2e/tab-actions.e2e.ts` (S3, S4)
- [x] T047 [P] [US3] E2E: two rapid steps move **two** tabs and settle **once** — no queued second animation, no drift after the user stops, in `packages/ui/tests/e2e/tab-scroll.e2e.ts` (A6, A7, A8)
- [x] T048 [P] [US3] E2E: the active tab is brought into view when it changes by **every** route — created, clicked, chord, picker, dwell-activate during a panel drag, layout restore, in `packages/ui/tests/e2e/tab-scroll.e2e.ts` (A1)
- [x] T049 [P] [US3] E2E: an already-fully-visible active tab causes **no** movement, in `packages/ui/tests/e2e/tab-scroll.e2e.ts` (A2)
- [x] T050 [P] [US3] E2E: destroying the active tab brings its successor into view with no gap left behind, in `packages/ui/tests/e2e/tab-scroll.e2e.ts` (A3)
- [x] T051 [P] [US3] E2E: a tab destroyed mid-scroll leaves the strip at a valid position, not past the end, in `packages/ui/tests/e2e/tab-scroll.e2e.ts` (A9)
- [x] T052 [P] [US3] E2E: duration 0 scrolls instantly; `emulateMedia({ reducedMotion: 'reduce' })` also forces instant while leaving the configured value unchanged in Settings, in `packages/ui/tests/e2e/tab-scroll.e2e.ts` (A10, A11, A12)
- [x] T053 [P] [US3] E2E: reduce-motion applied **live** settles a scroll in flight immediately, and an instant scroll still updates position, active tab and counts, in `packages/ui/tests/e2e/tab-scroll.e2e.ts` (A13, A14)
- [x] T054 [P] [US3] E2E: the picker lists every tab in strip order with name, panel count and the active tab marked; typing narrows; arrows/Enter/Escape work; no match keeps it open and says so, in `packages/ui/tests/e2e/tab-picker.e2e.ts` (K1, K3, K9, K11, K12)
- [x] T055 [P] [US3] E2E: choosing an entry scrolls to that tab **and** activates it, in `packages/ui/tests/e2e/tab-picker.e2e.ts` (K2)
- [x] T056 [P] [US3] E2E: `Ctrl+Alt+T` opens the picker at any tab count **including when nothing overflows**; chord and click behave identically; Escape returns focus where it was, in `packages/ui/tests/e2e/tab-picker.e2e.ts` (T5, T7, T8)
- [x] T057 [P] [US3] E2E: the Tabs settings section exposes the **smooth-scroll duration** as 0–3000 defaulting to 300, and `tabs.openPicker` appears in the Key Bindings editor and can be rebound, in `packages/ui/tests/e2e/tab-settings.e2e.ts` (FR-030, FR-047, T6)

  **Scope note**: `tab-settings.e2e.ts` is one file completed **incrementally**, one assertion per story as each setting lands — US4 adds the name limit (T085a), US5 the arming delay (T104b). An earlier draft had this one task assert all three, which could not have gone green in US3 because two of the settings do not exist yet; it would have failed for a reason unrelated to its own Red step.
- [x] T057a [P] [US3] E2E: a window **resize during a scroll in flight** settles the strip at a valid position, with counts and overflow state recomputed against the new width, in `packages/ui/tests/e2e/tab-scroll.e2e.ts` (spec Edge Cases)
- [x] T057b [P] [US3] E2E: matched terms are **visibly marked** in each picker row, and the step / show-all controls render themed icons carrying hover titles that name their action, in `packages/ui/tests/e2e/tab-picker.e2e.ts` and `tab-actions.e2e.ts` (K10, T4 — governance: themeable icon controls)
- [x] T058 [US3] Register `tab-actions.e2e.ts`, `tab-scroll.e2e.ts`, `tab-picker.e2e.ts` and `tab-settings.e2e.ts` in `shard-plan.json`, and the picker + settings specs in `parallel-plan.json`'s serial tier (they steal focus)

### Implementation

- [x] T059 [P] [US3] Implement `stripCounts`, `stepTarget`, `revealTarget` and `ease` in `packages/core/src/workspace/tab-strip.ts` (S1–S6, A4, A5)
- [x] T060 [P] [US3] Implement `matches` and `matchSpans` in `packages/core/src/picker/match.ts` (K4–K7, K10)
- [x] T061 [US3] Export both modules from `packages/core/src/index.ts`
- [x] T062 [US3] Add `tabs.smoothScrollMs` (0–3000, **step 50**, default 300) with a `Tabs`-group slider descriptor, in `packages/core/src/config/app-settings.ts` and `settings-metadata.ts`. The step is not free: `slider-descriptors.test.ts` requires ≥1% of range, and 300 must stay reachable (FR-030, FR-047)
- [x] T063 [US3] Add `chevronLeft` / `chevronRight` / `chevronDown` icon tokens to `THRONG_THEME.icons` in `packages/core/src/config/theme.ts` — **not** reusing `collapse`/`expand`, which mean tree-node state (R9)
- [x] T064 [US3] Add `tabs.openPicker` to `COMMAND_SCOPES` (scope `EVERYWHERE`) and default it to `Ctrl+Alt+T` in `WINDOWS_BINDINGS`, in `packages/core/src/config/keybindings.ts` (T5)
- [x] T065 [US3] Add its descriptor to `KEYBINDINGS_METADATA` in `packages/core/src/config/keybindings-metadata.ts` (T6)
- [x] T066 [US3] Implement the single-rAF scroll loop with a replaceable target — supersede, never queue, no residue — in `packages/ui/src/renderer/workspace/tab-scroll.ts` (A6–A9)
- [x] T067 [US3] Honour `prefers-reduced-motion` live via `matchMedia`, forcing the instant path and settling any scroll in flight, in `packages/ui/src/renderer/workspace/tab-scroll.ts` (A11–A14)
- [x] T068 [US3] Build the **general** list-and-choose control — entries in, chosen entry out, nothing tab-specific inside — in `packages/ui/src/renderer/common/picker.tsx` (K8)
- [x] T069 [US3] Seed it with tabs — each entry's **searchable text is the tab's displayed name** — and wire choose → reveal + activate, in `packages/ui/src/renderer/workspace/tab-picker.tsx` (K1, K2, K9, FR-028d)
- [x] T070 [US3] Render the tab-actions group with themed chevron icons, live counts and hover titles, shown only on overflow, in `packages/ui/src/renderer/workspace/tab-group.tsx` (T1–T4)
- [x] T071 [US3] Bring the active tab into view whenever it changes by any route, and on tab creation, in `packages/ui/src/renderer/workspace/tab-group.tsx` (A1–A3)
- [x] T072 [US3] Wire the `tabs.openPicker` command to open the picker from anywhere, restoring focus on dismiss (T7, T8)

**Checkpoint**: US3 shippable. #219 can now be built by seeding `common/picker.tsx` (SC-012).

---

## Phase 6: User Story 4 — Names that cannot run away (P4)

**Goal**: One setting bounds tab and panel names, counted in grapheme clusters, with a counter that
explains the cap before it bites.

**Independent test**: Set the limit, try to exceed it in both rename fields, then load a layout
holding an over-long name and confirm it opens shortened.

### Tests (write first, watch fail)

- [x] T073 [P] [US4] Unit: `countGraphemes` counts ten emoji as ten; CJK, ZWJ families, skin-tone modifiers, regional-indicator flags and combining accents each count as the user sees them, in `packages/core/tests/unit/grapheme.test.ts` (N1)
- [x] T074 [P] [US4] Unit: `truncateGraphemes` never cuts inside a cluster — fixtures straddling the boundary for each of those classes, which is the only place this can fail, in `packages/core/tests/unit/grapheme.test.ts` (N2)
- [x] T075 [P] [US4] Unit: the result carries no ellipsis, and truncation is **idempotent** at a fixed limit, in `packages/core/tests/unit/grapheme.test.ts` (N4, N5)
- [x] T076 [P] [US4] Unit: `wasTruncated` is false for a name exactly at the limit; a limit of 0 or negative yields `''` without throwing, in `packages/core/tests/unit/grapheme.test.ts` (N6, N7)
- [x] T076a [P] [US4] Unit: a cut landing after a space **trims the trailing whitespace**, so two names differing only past the cut cannot render identically; leading whitespace is untouched, in `packages/core/tests/unit/grapheme.test.ts` (N9, FR-037e)
- [x] T076b [P] [US4] Unit: the rename counter's own count uses grapheme clusters, so what it reports and what the field permits can never disagree, in `packages/core/tests/unit/grapheme.test.ts` (C4, FR-035d)
- [x] T077 [P] [US4] Unit: `panelDisplayTitle` bounds its **result** for every source — user override, live shell title, flavour label, file path, in `packages/core/tests/unit/panel-display-title.test.ts` (N8)
- [x] T078 [P] [US4] E2E: the rename field stops at the limit; the counter appears within 10 of it, reads at-limit when full, and shows **no error styling**. Second fixture: at a limit of **10** the counter is visible from the first character — correct, not a bug, since the approach threshold is itself 10, in `packages/ui/tests/e2e/tab-name-limit.e2e.ts` (C1–C3, C6)
- [x] T079 [P] [US4] E2E: a paste longer than the remaining room inserts as much as fits and leaves the counter at-limit, in `packages/ui/tests/e2e/tab-name-limit.e2e.ts` (FR-036, C2)
- [x] T080 [P] [US4] E2E: panel renames behave identically — one setting, one counter, one behaviour, in `packages/ui/tests/e2e/tab-name-limit.e2e.ts` (FR-035g)
- [x] T081 [P] [US4] E2E: a rename field opened on a name **already longer** than the limit shows it in full, and committing applies the limit, in `packages/ui/tests/e2e/tab-name-limit.e2e.ts` (FR-035f)
- [x] T082 [P] [US4] E2E: lowering the limit mid-rename updates the counter's total immediately, in `packages/ui/tests/e2e/tab-name-limit.e2e.ts` (C5)
- [x] T083 [P] [US4] E2E: a seeded layout with a 300-character tab name opens successfully, shortened, with a render-time ellipsis, in `packages/ui/tests/e2e/tab-name-limit.e2e.ts` (NP4, N4)
- [x] T084 [P] [US4] E2E: lower then raise the limit with **nothing else changed** → full names return; lower, cause an unrelated layout save, raise → names stay short, in `packages/ui/tests/e2e/tab-name-limit.e2e.ts` (NP1, NP2, NP3)
- [x] T085 [US4] Register `tab-name-limit.e2e.ts` in `shard-plan.json`, and in `parallel-plan.json`'s serial tier (it drives preferences)
- [x] T085a [P] [US4] E2E: the Tabs settings section exposes the **name limit** as 10–128 defaulting to 64, in `packages/ui/tests/e2e/tab-settings.e2e.ts` (FR-034, FR-047, US4 scenario 9)

### Implementation

- [x] T086 [P] [US4] Implement `countGraphemes`, `truncateGraphemes` and `wasTruncated` using a module-scope `Intl.Segmenter` — constructed once, since the rename cap runs per keystroke (R4), in `packages/core/src/text/grapheme.ts` (N1–N7)
- [x] T087 [US4] Export them from `packages/core/src/index.ts`
- [x] T088 [US4] Add `tabs.maxNameLength` (10–128, **step 2**, default 64) with its descriptor, in `packages/core/src/config/app-settings.ts` and `settings-metadata.ts`. **Step 1 fails the shipped `slider-descriptors.test.ts`** — 1 across a range of 118 is 0.85%, under the 1% floor; step 2 is 1.69% and keeps 64 reachable (10 + 2×27) (FR-034, FR-041, FR-047)
- [x] T089 [US4] Bound `panelDisplayTitle`'s result on an optional limit argument, in `packages/core/src/workspace/panel-title.ts` (N8, R8)
- [x] T090 [US4] Cap input and render the approach counter in the tab rename field, in `packages/ui/src/renderer/workspace/tab-group.tsx` (C1–C5)
- [x] T091 [US4] Do the same for the panel rename field, in `packages/ui/src/renderer/workspace/panel-placeholder.tsx` (FR-035g)
- [x] T092 [US4] Apply the limit to tab names read from the layout and to the rename commit, so lowering the limit shortens longer names the next time they are read, in `packages/ui/src/renderer/workspace/tab-group.tsx` (FR-037, FR-035f, FR-039)
- [x] T093 [US4] Pass the configured limit into `panelDisplayTitle` at its **one** renderer call site, `packages/ui/src/renderer/workspace/panel-placeholder.tsx` (verified with `git grep -n panelDisplayTitle`: core's definition and re-export, and that single consumer — #218 left exactly one chokepoint, which is what makes N8 cheap) (N8)
- [x] T094 [US4] Render the truncation ellipsis at **display time only**, never in the stored value, in `packages/ui/src/renderer/theme.css` and the chip/header components (N4, FR-037c)
- [x] T094a [US4] Trim trailing whitespace left by a cut, in `packages/core/src/text/grapheme.ts` (N9, FR-037e)

**Checkpoint**: US4 shippable.

---

## Phase 7: User Story 5 — A tab says what is inside it (P5)

**Goal**: Pill count, a hover title listing the panels, and a close affordance that cannot be
triggered by a pointer passing over it.

**Independent test**: Hover a multi-panel tab and read its panel names; close a tab from the strip
and get the same confirmation as the context menu's Destroy Tab.

### Tests (write first, watch fail)

- [x] T095 [P] [US5] E2E: the panel count renders as a pill and no `[3]` square-bracket form remains anywhere in the strip, in `packages/ui/tests/e2e/tab-presentation.e2e.ts` (P1)
- [x] T096 [P] [US5] E2E: hovering a tab shows its name, panel count and each panel's name on its own line, in `packages/ui/tests/e2e/tab-presentation.e2e.ts` (P2)
- [x] T097 [P] [US5] E2E: only the **active** tab shows a close affordance with the pointer away; hovering an inactive tab reveals its own, in `packages/ui/tests/e2e/tab-presentation.e2e.ts` (P4)
- [x] T098 [P] [US5] E2E: revealing the affordance changes **no** tab's width and **no** label's position — the space is reserved, in `packages/ui/tests/e2e/tab-presentation.e2e.ts` (P5)
- [x] T099 [P] [US5] E2E: a click within the arming delay does nothing at all — not destroyed, not activated, no rename, and **nothing fires when the delay elapses**, in `packages/ui/tests/e2e/tab-presentation.e2e.ts` (P6, P7, P8)
- [x] T100 [P] [US5] E2E: after the delay the click runs Destroy Tab with its usual confirmation; leaving and re-entering re-arms from scratch, in `packages/ui/tests/e2e/tab-presentation.e2e.ts` (P3, P7)
- [x] T101 [P] [US5] E2E: the **active** tab's always-present affordance works immediately — no arming delay, in `packages/ui/tests/e2e/tab-presentation.e2e.ts` (P9)
- [x] T102 [P] [US5] E2E: sweeping the pointer across the whole strip without deliberate clicks destroys **no** tab, in `packages/ui/tests/e2e/tab-presentation.e2e.ts` (SC-007a)
- [x] T103 [P] [US5] E2E: an arming delay of 0 makes the affordance live immediately, in `packages/ui/tests/e2e/tab-presentation.e2e.ts` (FR-044h)
- [x] T104 [P] [US5] E2E: the main window's last tab, where Destroy Tab is disabled, has no usable close affordance, in `packages/ui/tests/e2e/tab-presentation.e2e.ts` (P10)
- [x] T104a [P] [US5] E2E: the affordance renders **subdued** during the arming window and normally after it, in `packages/ui/tests/e2e/tab-presentation.e2e.ts` (FR-044f)
- [x] T104b [P] [US5] E2E: the Tabs settings section exposes the **arming delay** as 0–2000 defaulting to 300, in `packages/ui/tests/e2e/tab-settings.e2e.ts` — the settings-exposure assertion lives here, not duplicated in `tab-presentation.e2e.ts` (FR-044h, FR-047)
- [x] T105 [US5] Register `tab-presentation.e2e.ts` in `shard-plan.json` and in `parallel-plan.json`'s serial tier (it drives the context menu and preferences)

### Implementation

- [x] T106 [US5] Add `tabs.closeArmingDelayMs` (0–2000, **step 50**, default 300) with its descriptor, in `packages/core/src/config/app-settings.ts` and `settings-metadata.ts` (FR-044h)
- [x] T107 [US5] Replace the `[n]` count with a pill in `packages/ui/src/renderer/workspace/tab-group.tsx` and `theme.css` (P1)
- [x] T108 [US5] Build the hover title from the tab's panels — name, count, one panel per line, in `packages/ui/src/renderer/workspace/tab-group.tsx` (P2)
- [x] T109 [US5] Add the close affordance with reserved space, shown on the active tab and on hover, in `packages/ui/src/renderer/workspace/tab-group.tsx` and `theme.css` (P4, P5)
- [x] T110 [US5] Implement the arming delay: restarts on each appearance, never accumulates, click inside it **ignored not queued**, and never applied to the active tab's persistent affordance, in `packages/ui/src/renderer/workspace/tab-group.tsx` (P6, P7, P9)
- [x] T110a [US5] Style the affordance **subdued while inert**, so a dead click is visibly explained rather than puzzling, in `packages/ui/src/renderer/theme.css` (FR-044f)
- [x] T111 [US5] Route the affordance to the existing `confirmCloseTab`, stopping propagation so it neither activates the tab nor starts a rename, and disable it wherever Destroy Tab is disabled, in `packages/ui/src/renderer/workspace/tab-group.tsx` (P3, P8, P10)

**Checkpoint**: US5 shippable. All five stories complete.

---

## Phase 8: Polish & cross-cutting

- [x] T112 [P] Update `docs/quick-start.md` with the Tabs settings and the `Ctrl+Alt+T` picker (FR-049, constitution documentation-currency)
- [x] T113 [P] Check `README.md` still describes the app's current finite state and correct it if the strip's behaviour makes any statement stale (FR-049)
- [x] T114 Run `npm run test:unit -- shard-plan` and confirm every new spec is in exactly one shard group and the focus-stealing ones are in the serial tier
- [x] T115 Run the full gate — `npm run lint`, `npm run typecheck`, `npm test` — capture the output once and read it (constitution Principle V, run-once discipline)
- [x] T116 Confirm no `[NEEDS CLARIFICATION]`, no `TODO` and no leftover test artifact was introduced by this feature (constitution Principle V, test-artifact cleanup)

---

## Dependencies

```text
Setup (T001–T002)
   ├─> US1 (T003–T015b)  — independent; the defect fix, ships alone
   └─> US2 (T016–T035)   — independent; no UI
          ├─> US3 (T036–T072)    — needs US2's guard for tabs.smoothScrollMs
          ├─> US4 (T073–T094a)   — needs US2's guard for tabs.maxNameLength
          └─> US5 (T095–T111)    — needs US2's guard for tabs.closeArmingDelayMs
                                 — AND US1's reserved-space layout (P5)
Polish (T112–T116) after all
```

US3 and US4 are independent of each other and of US5, and any of the three may be built in any
order once US2 lands. **US5 additionally requires US1**, because its reserved-space close affordance
(P5) only makes sense against the restructured strip — corrected after `/speckit-analyze` flagged the
earlier tree as drawing US5 as a sibling of US1 while the prose said otherwise.

## Parallel opportunities

**What `[P]` means here**: these tasks have **no dependency on one another** and can be worked in any
order, or written together in one pass. It does **not** mean "different files" — most `[P]` batches
below are deliberately several cases in *one* new test file, which is the natural way to write them.
Two tasks touching the same file are still marked `[P]` when neither blocks the other; only an
ordering dependency removes the marker.

- **T003–T008c** — nine E2E cases in one new file; write them together, then implement.
- **T016–T029f** — the guard's unit and integration cases; the unit batch shares one new file, the integration batch another.
- **T036–T043** — strip geometry and picker matching are separate pure modules with no shared state.
- **T059/T060**, **T086**, **T106** — genuinely different files, no dependencies between them.
- **T095–T104** — ten E2E cases in one new file.

## MVP scope

**User Story 1 alone** is a defensible release: it fixes the reported defect, needs no new settings,
and leaves the strip legible at any tab count. US2 is the natural second — invisible to users but the
thing that makes every later setting trustworthy.

## Phase 9: Convergence

Assessed after User Story 7, on a tree where 2481 unit/contract/integration tests and all 58 of the
feature's own E2E specs pass.

**No `missing` findings.** Every one of the spec's 133 functional requirements has an implementation
and a test.

An initial sweep reported nineteen requirements with no `FR-###` citation. **Fifteen of those were
an artifact of the sweep, not a real gap**: they are cited by *range* — `FR-029–FR-031d` at the head
of `tab-scroll.ts`, `FR-035–FR-036a`, `FR-044–FR-044g`, `FR-033a–c` and `FR-037a–e` — and an
exact-string search for `FR-030c` cannot see `FR-029–FR-031d`. Recorded here because the same sweep
will be run again by someone else, and it will lie to them the same way.

Four were genuine: **FR-008b, FR-008c, FR-008d and FR-008f**, the keyed-table correction rules. They
are now cited at the site that implements them in `bounds-guard.ts` — including FR-008f on the
`Object.entries(raw)` loop, since iterating the file's own entries is precisely what makes absence
uncorrectable.

The findings below are dominated by three maintainer decisions taken **after** US7 landed, which the
spec has not yet caught up with. They are recorded here rather than applied, because `spec.md` and
`data-model.md` are Spec Kit's to write.

- [x] T117 Amend FR-054a to record `tabs.chevronRepeatDelayMs`'s shipped default as **350**, not 500, per FR-054a (contradicts)
- [x] T118 Amend FR-058 to record `tabs.popoverDelayMs`'s shipped default as **500**, not 300, per FR-058 (contradicts)
- [x] T119 Correct `data-model.md` §1.1: its prose says "Nine settings in the `Tabs` group" while its own table lists seven `tabs.*` leaves, and the group now renders eight rows — update both the count and the two changed defaults per data-model §1.1 (contradicts)
- [x] T120 Record the relocation of `behaviour.tabHoverActivateMs` into the `Tabs` settings group, with its rewritten description: the key is deliberately unchanged so no existing `settings.json` loses its value, but no requirement currently calls for the move per plan: settings grouping (unrequested)
- [x] T121 Reconcile this file's tick state — no task is ticked although the work is complete, so the progress record cannot be relied on to say what remains per tasks.md (partial)
- [x] T122 Add `FR-###` citations to the four requirements genuinely lacking one — FR-008b/c/d/f, the keyed-table rules in `bounds-guard.ts`. The other fifteen the sweep flagged are cited by range and need nothing per spec traceability (partial)
