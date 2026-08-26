# Tasks: Editor Status Bar Readouts and Gutter Visibility

**Feature**: 040 | **Branch**: `feature/S040-I256-editor-status-bar-and-gutter`
**Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md) | **Data model**: [data-model.md](./data-model.md)

**Organization**: tasks are grouped by user story so each story is an independently testable
increment.

**Tests are NOT optional here.** Constitution Principle V is NON-NEGOTIABLE test-first, so every
behaviour task is preceded by the test that fails for the reason the requirement names. A task that
writes a test and a task that makes it pass are separate tasks on purpose — the Red step has to be
observed, not assumed. **This applies to E2E specs too**: an E2E is written and shown RED before the
task that completes the behaviour it covers, never added afterwards as a victory lap.

**Layer discipline**: each test is written at the cheapest layer that can prove the behaviour
([research.md D8](./research.md)). E2E is reserved for the real window and real keyboard.

**The E2E budget is a ratchet that fails both ways, and it counts DECLARATIONS, not files** — its own
`countingBasis` says so, so "+1 per spec file" is wrong in both directions. Two spec files are added,
carrying **six declarations**: `editor-status-bar.e2e.ts` holds **2** and is `@core`;
`editor-gutter-visibility.e2e.ts` holds **4** and is `@extended` (the `@core` lane is capped at 50 and sits at
36 — four of the remaining fourteen is not the best use of a push gate for one preference).

Counters: **`total` 552 → 558**, **`core` 36 → 38**, **`byCategory.@editor` 111 → 117**. If a file
ends up with a different declaration count, the delta moves with it — the budget must match what was
written, not what was planned.

**THERE IS A THIRD TAG, AND MISSING IT FAILS THE UNIT STAGE.** Every E2E declaration must name a
**`@reserve:*`** entry — the reason it is irreducible to a cheaper layer (035 FR-016, constitution
Principle V). `packages/ui/tests/e2e/reserve-tag-debt.json` records `untagged: 121` and
`e2e-tags.test.ts` asserts that number **exactly, both ways**. Six new untagged declarations make it
127 and kill the **unit** stage — four stages before E2E ever runs, and long after the specs were
written. All six declarations here are tagged, so **`reserve-tag-debt.json` STAYS AT 121**: re-seeding
it would be the opposite error, banking debt that was never incurred.

**Three mechanical traps this task list exists to avoid, all verified against the repo:**

- **The component tier collects `*.test.ts` only.** No `.test.tsx` exists anywhere in this repo, and
  existing component tests render with `createElement`. A `.tsx` test is collected by nothing and
  reports "no test files found" while looking like a Red step that ran.
- **jsdom has no layout.** Any assertion that is genuinely a *measurement* is an E2E assertion; the
  component tier asserts only the declared properties that produce it.
- **Three separate ratchets guard the E2E suite** — `e2e-budget.json` (declarations),
  `reserve-tag-debt.json` (untagged count) and `parallel-plan.json` (focus-stealing specs). All three
  fail closed, and two of them fail at the *unit* stage.

**Five more traps, found by reading the code rather than the tasks. Each would have cost time or
produced a wrong result:**

- **`editor.persistUndoHistory` WILL visibly move, and that is correct.** It is declared at
  `settings-metadata.ts:710` with `group: 'Editor'`, *after* the Indentation and Languages blocks. Under
  FR-036b every non-subgroup Editor field renders first, then the Status Bar subsection — so
  `showStatusBar` ends up below `persistUndoHistory`, which today sits above it. FR-037's "no other
  Editor setting may move" means *no setting changes group*, not *no pixel shifts*. Do not "fix" this by
  reordering descriptors.
- ~~**`fieldHaystack` does not search `subgroup`**… No FR requires changing it.~~ **REVERSED during
  review, and the note is kept so the reasoning is visible.** The original call was to leave it: no FR
  demanded it, and it touches a shared core function all three tabs read. The adversarial review's
  rejoinder was decisive — **this feature created the hazard**. `SearchableField`'s own JSDoc states
  the invariant ("typing a group name returns the whole section"), and before 040 every visible
  heading was findable by name. "Status Bar" was findable only because `status` and `Bar` are
  substrings of the keys; the next subgroup would not be so lucky, and nothing pinned the accident.
  `subgroup` is now in the haystack, with its own test, and the fix is one identifier.
- **Nothing in `packages/ui/tests/` has ever mocked `@throng/core`.** T031/T032 need a *partial* mock
  (`importOriginal` spread), because both tabs import many symbols from the barrel. For Themes there is a
  second hazard: `THEME_TOKEN_FIELDS` is computed at **module scope** (`themes-tab.tsx:57-59`), so the mock
  must replace `THEME_METADATA`, not `THEME_TOKEN_FIELDS`. Settle this before writing either test.
- **`ThemesTab` takes no props at all** (`:118`), unlike the other two which accept `searchDebounceMs` — so
  the "test-only seam" escape hatch is a wider change there, and its search tests use real timers.
- **FR-034a's sweep must read descriptor `label`/`description` VALUES, not source text** — because
  the requirement governs what a *user reads*, not what the file contains. ~~*An earlier version of
  this note claimed `settings-metadata.ts` carried "18 other hits" in comments and JSDoc. That number
  was invented; the file contains one.*~~ Both halves of the original note were wrong in the other
  direction too: the **theme** registry ships three user-facing labels that still say "Status Strip"
  (`theme-copy.ts` — `Editor Status Strip Surface`, `… Text`, `… Hover Background`). FR-034a is
  scoped to copy *this feature* adds or rewrites, so those are out of scope and not a violation — but
  the app now says "status bar" in Settings and "Status Strip" in Themes, and that split is tracked
  rather than silently left.

---

## Phase 1: Setup

- [x] T001 Confirm the baseline is green and record it: `npm run lint`, `npm run typecheck`, `npm run build`, then the four non-E2E vitest projects. Do not start Phase 2 on a red tree.

---

## Phase 2: Foundational (blocks all user stories)

- [x] T002 [P] Write failing unit tests for the counting rules in `packages/core/tests/unit/document-metrics.test.ts` — characters INCLUDE line breaks at one each (`"ab\r\ncd\r\nef"` → 8; ten empty lines → 9; the LF and CRLF forms of one text are **equal** — FR-003a as reversed on 2026-08-25), words are maximal non-whitespace runs (`const foo_bar = "hello-world";` → 4), caret column counts a tab as 1 (`"\t\tfoo"` at offset 2 → line 1 column 3), `selectedCharacters` sums ranges and returns null for bare carets, and a whole-document selection reports the **same figure as the total** (FR-004a). Run them; show them RED.
- [x] T003 Implement `countCharacters`, `countWords`, `caretPosition` and `selectedCharacters` in `packages/core/src/editor/document-metrics.ts` to turn T002 green (**FR-002** — the first line is line 1 and the first column is column 1, which T002's `"\t\tfoo"` case asserts but should be named rather than left implicit — plus FR-002a, FR-003a, FR-003b, FR-004, FR-004a, FR-005).
- [x] T004 Export the document-metrics API from `packages/core/src/index.ts` so the renderer can import it from `@throng/core`.
- [x] T005 [P] Write a failing unit test in `packages/core/tests/unit/metadata-subgroup.test.ts` asserting a `FieldDescriptor` may carry an optional `subgroup`, that descriptors without one are unchanged, and that `subgroup` adds **no new `ControlKind`** (so 007 FR-028's control vocabulary is untouched and #79 is unaffected). Show it RED.
- [x] T006 Add `subgroup?: string` to `FieldDescriptor` in `packages/core/src/config/metadata.ts` to turn T005 green (FR-035). JSDoc it as one level only, and note that a descriptor without one renders exactly as before.

**Checkpoint**: the pure rules and the descriptor shape exist and are proven.

---

## Phase 3: User Story 1 — Know where the caret is and how big the document is (P1, #256)

**Goal**: the bar reports caret line and column, selected characters, total characters and total words.

**Independent test**: open a file, move the caret by click and by arrow key, select one range then
several, and type — every figure follows, and typing does not feel heavier.

- [x] T007 [P] [US1] Write a failing unit test in `packages/ui/tests/unit/caret-store.test.ts` asserting the caret store is keyed by **panel id**, so two panels on one document hold independent positions (FR-006). Show it RED.
- [x] T008 [US1] Implement the per-panel caret store in `packages/ui/src/renderer/editor/caret-store.ts` to turn T007 green.
- [x] T009 [P] [US1] Write a failing unit test in `packages/ui/tests/unit/document-metrics-store.test.ts`: the store is keyed by **document** so every panel showing it agrees (FR-007); writes are debounced and settle within 200 ms of the last edit (FR-008b); and **a replica reload invalidates the debounced value** so an external file change cannot leave a stale count standing (FR-003, AS7). Show it RED.
- [x] T010 [US1] Implement the per-document, 200 ms-debounced metrics store with reload invalidation in `packages/ui/src/renderer/editor/document-metrics-store.ts` to turn T009 green.
- [x] T011 [US1] **The regression test that protects the riskiest edit in this feature** — in `packages/ui/tests/component/editor-update-listener.test.ts`, assert that a **selection-only** update (`selectionSet` true, `docChanged` false) produces **no** `replica.record` call and starts **no** auto-save timer, and that the caret figures are **computed inside that same listener invocation rather than deferred** (FR-008a). Show it RED against a naively-widened guard, so the test is proven to detect the mistake it exists to catch.
- [x] T012 [US1] Widen the update listener in `packages/ui/src/renderer/editor/use-editor.ts` by adding caret publication and count scheduling **ABOVE** the existing `if (!update.docChanged) return;` line, leaving that line and everything below it byte-identical (FR-008, FR-008a). T011 must go green without the existing body changing.
- [x] T012a [US1] **Change `selectedCharacters` to take an iterable of CHUNKS rather than each range's whole text**, and update the caller. Raised by the wave-1 adversarial review, deferred so it would not collide with T012 being written. The defect is real and it sits on the path FR-008a pins to *synchronous*: taking range text means Ctrl+A then `Shift+Down` in a 5 MB document slices, allocates and discards a ~5 MB string **on every selection change** — and on every mouse-move of a shift-drag. CodeMirror's `Text` can be iterated in chunks (`doc.iterRange(from, to)`) with no concatenation, and the per-character line-ending rule is identical either way, so the JSDoc's defence ("that is what lets the line-ending rule be the very same code") is a false dichotomy. Keep one rule; drop the allocation. Re-run the counting unit tests and the caret-store tests after.
- [x] T013 [P] [US1] Write failing component tests in `packages/ui/tests/component/status-strip-readouts.test.ts`: presentation as `Ln 412` / `Col 7` / `63 selected` / `1,204 chars` / `208 words` (FR-012); the selected segment **absent** with no selection rather than `0` (FR-005); figures digit-grouped via `formatGrouped` at every magnitude (FR-027); and **a `.`-grouping locale renders `1.048.576`** (AS8 — `formatGrouped` takes a locale, so this is cheap). Show them RED.
- [x] T014 [US1] *(deliberately NOT `[P]`, for the same reason as T037: it edits `e2e-budget.json`, and a `[P]` marker claims a task is safe beside any other.)* Write the E2E in `packages/ui/tests/e2e/editor-status-bar.e2e.ts` — **exactly 2 declarations**, tagged `@core @editor`, **each additionally naming its `@reserve:*` entry**: declaration (1) `@reserve:input`, declaration (2) `@reserve:layout`. (1) The readouts follow a **real pointer click, real arrow keys and a real undo** through a live CodeMirror view (FR-001), and **survive a language change unchanged** (AS2a). (2) **The measurements jsdom cannot make**: the bar is one line high and the editor's text height is unchanged across a wide→narrow→wide resize (FR-020, SC-002), and the two alignment groups never overlap (FR-014). Raise `e2e-budget.json` by **deltas, not absolutes** — `total` **+2**, `core` **+2**, `@editor` **+2** — for the same reason T037 does: the two phases may land in either order, so any absolute endpoint is wrong half the time. (Combined end state once both land: `total` 558, `core` 38, `@editor` 117.) Show it RED.
- [x] T015 [US1] Render the five readouts in `packages/ui/src/renderer/editor/status-strip.tsx` to turn T013 and T014 green. **Two existing component tests already render today's bar** — `packages/ui/tests/component/editor-language-strip.test.ts` and `packages/ui/tests/component/status-strip-picker-dismissal.test.ts`. Re-run both and update their queries: restructuring the component they exercise will ordinarily break a text or role query, and a broken query in a test you did not know existed reads as a regression you caused.
- [x] T016 [P] [US1] Write failing component tests in `packages/ui/tests/component/status-strip-a11y.test.ts`: each readout's accessible name says what the figure is (`"line 412"`, never `"Ln 412"` or `"412"`, FR-015); the readouts are **not** a live region (FR-016); a readout hidden by width or preference is **absent from the accessibility tree** (FR-017); and **every control and readout this feature adds arrives with a correct accessible name, adding nothing to #282's known status-bar gaps** (FR-018 — a negative requirement, and negatives are what a later feature quietly breaks). Show them RED.
- [x] T017 [US1] Give the readouts correct accessible names and keep them out of any live region in `packages/ui/src/renderer/editor/status-strip.tsx` to turn T016 green.
- [x] T018 [P] [US1] Assert the negative in `packages/ui/tests/component/status-strip-no-menu-items.test.ts`: this feature adds **no content-menu items** for the readouts (FR-009), because a readout is not an action. Negative requirements are what a later feature quietly breaks.

**Checkpoint**: the readouts work, are correct, are accessible, and add no menu items.

---

## Phase 4: User Story 2 — Reclaim the width the bar is spending (P1, #256)

**Goal**: the bar degrades in a fixed order, stays one line high, and never renders a truncated number.

- [x] T019 [P] [US2] Write failing unit tests in `packages/ui/tests/unit/status-strip-fit.test.ts`: labels shorten through the **declared forms** — `selected`→`sel`, `chars`→`ch`, `words`→`w`, while `Ln` and `Col` never shorten (FR-022a) — before any segment is dropped (FR-021); segments drop **words → chars → selected → column → line** (FR-023); the order **terminates after line** (FR-024); a figure is hidden whole, never truncated (FR-022); the result is deterministic for a given width (FR-025). Show them RED.
- [x] T020 [US2] Implement the pure fit ordering in `packages/ui/src/renderer/editor/status-strip-fit.ts` to turn T019 green. Input: available width and measured segment widths. Output: which segments render and which label form each uses. No DOM.
- [x] T021 [P] [US2] Write failing component tests in `packages/ui/tests/component/status-strip-fit-wiring.test.ts`. **Assert wiring, never geometry — jsdom has no layout.** With a `ResizeObserver` stub feeding widths (reuse the pattern from the **eight** component tests that already have one): the bar applies the fit result it is given; readouts render in the left group and language + wrap in the right (FR-013 — assert group membership, not pixel positions); widening restores every hidden segment with caret and selection unchanged (FR-026); at the narrowest width the language label is still present with its truncating class (FR-022b). **The overlap and one-line-height measurements belong to T014's E2E**, not here. Show them RED.
- [x] T022 [US2] Wire the fit ordering and the two alignment groups into `packages/ui/src/renderer/editor/status-strip.tsx` to turn T021 green. **The readout group's container MUST render unconditionally — empty or not.** `justify-content: space-between` with a single child puts that child on the *left*, so if the left group vanishes when both toggles are off (AS5) or every readout is dropped at minimum width (AS4), the language label moves to the wrong edge and **016 FR-010c's right-aligned label is silently broken** — the shipped requirement Finding 1 exists to protect. An empty flex child costs nothing and is what keeps the right group right.
- [x] T023 [P] [US2] Write a failing component test in `packages/ui/tests/component/status-strip-declared-css.test.ts` asserting the **declared properties** on `.editor-status-strip` (FR-013, FR-020): `white-space: nowrap`, and `justify-content: space-between` rather than the shipped `flex-end`. Follow `notice-pointer-events.test.ts`, which asserts declared keywords only because **jsdom does not resolve `var()`**. **Do not assert a height** — the rule already declares `min-height: 20px`, so a height assertion would be green on arrival and prove nothing; the measured one-line claim is T014's E2E. Show it RED.
- [x] T024 [US2] In **`packages/ui/src/renderer/editor/editor.css`**, where `.editor-status-strip` already lives (~line 92): change **`justify-content: flex-end` → `space-between`** for the two alignment groups (FR-013), correct its now-stale `/* right-aligned (FR-010) */` comment, and add `white-space: nowrap` (FR-020). **Keep `min-height: 20px` as it is** — the comment beside it explains that the language picker pops *upward* out of a 20px bar and must not be clipped, so replacing it with a fixed `height` would be an unrequested behaviour change to a rule that exists for a stated reason. **Do not create a new `status-strip.css`**: splitting the bar's styles across two files with no import is how a rule silently never applies. Without this task FR-013 is unimplemented and nothing below E2E would catch it, because jsdom has no layout and T021's group-membership assertions pass either way.

**Checkpoint**: the bar degrades correctly and never lies about a figure.

---

## Phase 5: User Story 3 — Decide what the bar shows, and find those settings in one place (P2, #256/#257/#258)

**Goal**: two readout toggles, an honest `showStatusBar` description, and every status-bar setting
under **Editor → Status Bar**.

*(`editor.showGutter` is deliberately NOT here — it belongs to US4 and lives in Phase 6, so that story
is genuinely independently deliverable.)*

- [x] T025 [P] [US3] Write failing unit tests in `packages/core/tests/unit/settings-metadata-040.test.ts`: `editor.statusBar.showCursorPosition` and `editor.statusBar.showCounts` exist, boolean, default `true`; `editor.showStatusBar`'s description names the language control, wrap toggle, caret position and counts and says hiding overrides the rest (FR-034); all user-facing copy says "status bar" and never "status strip" (FR-034a); the three status-bar keys carry `subgroup: 'Status Bar'` (FR-037); `terminals.showStatusBar` does **not** (FR-038); there are **exactly two** readout toggles, not one per figure (FR-032); **the three shipped `Editor · …` sibling group strings are unchanged** (FR-037a — a MUST that otherwise nothing asserts, discharged only by a follow-up issue); and no key, default or control type changed (FR-039). Show them RED.
- [x] T026 [US3] Add the two `editor.statusBar.*` keys to `packages/core/src/config/app-settings.ts`. **`editor.statusBar` is a NESTED object, not two flat keys — this is FIVE edits, not one**, and `editor.navigation` (033) is the template to copy at every step:
  1. a new `EditorStatusBarSettings` interface, placed like `EditorNavigationSettings` just above `EditorSettings`;
  2. the member on `EditorSettings` (scalar example at `:229`, nested at `:231`);
  3. the shipped default inside the `editor:` block at `:455-486` (`navigation: {…}` at `:481-485`);
  4. a tolerant sub-parser in the `navigationSettings()` mould (`:860-879`), wired in beside `navigation:` at `:828`;
  5. **`cloneEditor` at `:849-857`** — and this one is a trap the task list would otherwise have missed. It re-clones exactly four object-valued members under a `...e` spread, and **`packages/core/tests/unit/editor-settings.test.ts:297-309` sweeps `Object.entries(editor)` for ANY object-valued member identical to the shipped default** — its comment says outright that "a FIFTH object-valued member added to `EditorSettings` later compiles fine". Add `statusBar: { ...e.statusBar }` in the same edit, or a neighbouring test file turns red for a reason that reads like an unrelated regression.
- [x] T027 [US3] Add the two descriptors, rewrite the `editor.showStatusBar` description and apply `subgroup: 'Status Bar'` in `packages/core/src/config/settings-metadata.ts` to turn T025 green (FR-030, FR-031, FR-034, FR-034a, FR-037, FR-050).
- [x] T028 [US3] Regenerate the shipped defaults (`npm run generate:defaults`).
- [x] T029 [P] [US3] Write failing component tests in `packages/ui/tests/component/settings-tab-subgroups.test.ts`: a subgroup renders as a subsection inside its group's section in declaration order (FR-036a); **no collapse control** (FR-036a); fields with no subgroup render **above** every subsection (FR-036b); a search filtering out every field in a subgroup removes **the heading too** (FR-036c); the subsection carries the test id **`settings-subgroup-Editor-Status Bar`** — **unslugified, space and all**, because every shipped id is the raw group string (`settings-group-Editor · Navigation`, `settings-group-File Explorer`), so slugifying only the new one would make it the single id in the registry that does not match its group; and **each new toggle actually renders as an editable control in the right subsection** (FR-053 — completeness proves a descriptor exists, not that a row appears). Show them RED.
- [x] T029a [US3] **Extract the grouping-with-subsections logic into one shared helper** at `packages/ui/src/renderer/preferences/group-descriptors.ts`, before any tab implements it. `groupDescriptors` is **byte-identical** between `settings-tab.tsx:46-60` and `keybindings-tab.tsx:49-63` (verified by diff); adding subsection handling to three call sites would make that three near-copies of a rule FR-036 requires to be identical — Principle VIII, and the exact reason "one registry cannot render two ways" exists. Signature:

  ```ts
  export interface DescriptorSubgroup { subgroup: string; items: FieldDescriptor[] }
  export interface DescriptorGroup {
    group: string;
    items: FieldDescriptor[];        // no subgroup, declaration order, rendered FIRST (FR-036b)
    subgroups: DescriptorSubgroup[]; // declaration order (FR-036a)
  }
  export function groupDescriptors(items: readonly FieldDescriptor[]): DescriptorGroup[];
  ```

  **No options parameter.** The themes tab composes rather than configures — `groupDescriptors(matches.filter((d) => !RENDERED_ELSEWHERE.has(d.key)))` — which keeps a predicate hook out of a helper only one caller would use. Keep the exported name `groupDescriptors` so the two identical call sites change only their import.

  **Create every bucket lazily inside the loop** (`if (!bySubgroup.has(d.subgroup))`), never seeded from the unfiltered registry or a static list of subgroup names. Do that and **FR-036c is free**: grouping already runs over the *filtered* list (`settings-tab.tsx:164-168` groups `matches`), so a bucket with no surviving descriptor is never constructed and therefore cannot render. Seed it eagerly and you invent the empty-heading bug the requirement forbids.
- [x] T030 [US3] Use the shared helper in `packages/ui/src/renderer/preferences/settings-tab.tsx` to turn T029 green.
- [x] T031 [P] [US3] Write a failing component test in `packages/ui/tests/component/keybindings-tab-subgroups.test.ts`. Two halves, and **settle the injection mechanism before writing it**: (a) with a **synthetic descriptor carrying a `subgroup`** — injected by mocking the registry module, since the tab takes no descriptor prop today — the tab renders a subsection with id `keybindings-subgroup-${group}-${subgroup}`; (b) against the **real** registry, which declares no subgroups, its output is unchanged. If (a) cannot be injected cleanly, write (b) only and say so in the test — an assertion that silently tests nothing is worse than a missing one. Show it RED.
- [x] T031a [US3] Implement subsection rendering in `packages/ui/src/renderer/preferences/keybindings-tab.tsx` to turn T031 green (FR-036).
- [x] T032 [P] [US3] Write a failing component test in `packages/ui/tests/component/themes-tab-subgroups.test.ts`: the same two halves as T031, with the same injection caveat. **Its grouper is `groupNonIconDescriptors` (line 87), not `groupDescriptors` — but the name is misleading and an earlier draft of this task repeated the mistake.** It does **not** filter icon *controls*: that happens earlier and elsewhere, at module scope (`themes-tab.tsx:57-59` builds `THEME_TOKEN_FIELDS` by filtering `control !== 'icon'`). What the grouper excludes is **one key, `colours.iconColour`** (`RENDERED_ELSEWHERE` at `:85`) — a *colour* token that survives the icon filter and is rendered beside the icon-pack selector. Do not go looking for an icon-control check inside it. Otherwise it is character-for-character `groupDescriptors` plus that single `continue`.

**`THEME_AREA_GROUPS` ordering is not this tab's to preserve** — it is baked into the registry by `buildThemeMetadata` (`packages/core/src/config/theme-metadata.ts:451-465`), which sorts before the tab ever sees a descriptor. The helper only has to keep first-appearance order, which its `order[]` array already does. Note also that this registry **already carries five sibling sub-group strings** (`Editor · Syntax`, `General · Buttons`, and three two-level `General · Buttons · …` strings) which FR-037a says must not move — and they are **derived** by `areaForToken`, not declared per descriptor — so the unchanged-output half is the more important of the two here. Name the subsection id **`themes-subgroup-${group}-${subgroup}`**: this tab already emits `settings-group-${group}` for its groups (`themes-tab.tsx:646`), the same prefix the Settings tab uses — so the collision exists already, and reusing `settings-subgroup-` here would **extend** it into the ids this feature adds rather than merely inheriting it. Show it RED.
- [x] T032a [US3] Implement subsection rendering in `packages/ui/src/renderer/preferences/themes-tab.tsx` to turn T032 green (FR-036), preserving the icon-token filtering and the `THEME_AREA_GROUPS` ordering the tab depends on.
- [x] T033 [P] [US3] Write failing component tests in `packages/ui/tests/component/status-strip-settings.test.ts`. **Render `EditorPanel`, not `StatusStrip`, for the whole-bar assertions**: `editor.showStatusBar` is read at `editor-panel.tsx:49` and gates the bar at `:79` — `status-strip.tsx` never reads it (it reads only `editor.defaultWordWrap`). And `:79` is `{(showStatusBar || revealedForPicker) && …}`, so the bar is deliberately revealed when the language picker is opened from the content menu **even with the setting off** (`picker-request.ts:38`); a test asserting "hidden regardless" must not trip that path. Assertions: `showCursorPosition = false` removes line and column and leaves the counts; `showCounts = false` removes all three counts and leaves line and column; both false still leaves language and wrap **and the language label is still in the RIGHT group** (FR-013 — with the left group empty this is where `space-between` would move it to the left, breaking 016 FR-010c); `editor.showStatusBar = false` hides the whole bar regardless (FR-030, FR-031, FR-033); **and hiding the bar does not disable the wrap command or its `Ctrl+Alt+W` chord** (FR-033 second half, 024). **That last assertion already exists at E2E** — `packages/ui/tests/e2e/status-bar-visibility.e2e.ts:90` (`@extended @window`, from #152). Re-asserting it at the component tier is right, and **the E2E stays**: the budget ratchet fails downward too, so deleting it would need its own re-seed and would lose a real-window check for a cheaper one. Show them RED.
- [x] T034 [US3] Make the readouts honour the two toggles in `packages/ui/src/renderer/editor/status-strip.tsx` to turn T033 green.

**Checkpoint**: the settings work, are grouped, and the description is honest.

---

## Phase 6: User Story 4 — Reclaim the width the gutter is spending (P2, #254)

**Goal**: one preference hides the line-number gutter, in every editor surface, live.

**Self-contained by design**: this phase owns `editor.showGutter` end to end — model, descriptor and
behaviour — so US4 really is independently deliverable, as the dependency graph claims.

- [x] T035 [P] [US4] Write a failing unit test in `packages/core/tests/unit/settings-gutter-040.test.ts`: `editor.showGutter` exists, boolean, defaults `true`, sits in group `Editor` with **no subgroup** (it is not a status-bar setting), and has a hand-written label and description (FR-040, FR-050). Show it RED. **Descriptor facts only — no render assertion here**: the `unit` project is `environment: 'node'` and does not load the component setup file, so a render assertion in this file would run in no project at all. Its FR-053 half is T035a.
- [x] T035a [P] [US4] Write a failing **component** test in `packages/ui/tests/component/gutter-setting-row.test.ts` asserting `editor.showGutter` **renders as an editable toggle row in the Editor section** (FR-053). FR-053 covers all three new settings and T029 reaches only the two `editor.statusBar.*` ones; a descriptor existing is not a row appearing, which is the distinction T029 itself draws. Show it RED.
- [x] T036 [P] [US4] Write a failing component test in `packages/ui/tests/component/gutter-compartment.test.ts` asserting **what jsdom can actually prove**: `lineNumbers` reaches the view **through the compartment** rather than as an unconditional extension, and a settings change **dispatches a reconfigure effect** for it. It does **not** assert that the gutter disappears — the rendered *effect* of a reconfigure is not observable without layout, which is T037's job. Show it RED.

  **The first half is provable today; the second half needs the harness extending first.** `gutterCompartment.get(harness.view().state)` plus `mountEditor({ settings: { editor: { showGutter: false } } })` works now, because `opts.settings` is already threaded into the fake `config.get`. But `mount-editor.ts`'s fake bridge has `onChange: () => () => {}` — it returns an unsubscribe and **stores nothing**, so no settings change can ever be pushed to a mounted editor. Extend the helper with an emitter, mirroring the existing `pushSync`, before asserting the reconfigure half. Do not quietly drop that half instead.
- [x] T037 [US4] *(deliberately NOT `[P]`: it edits `e2e-budget.json`, which T014 also edits. Different phases, so they would not share a wave — but a `[P]` marker is a claim that a task is safe to run beside any other, and two agents editing one ratchet file is exactly what that marker must never permit.)* Write the E2E in **`packages/ui/tests/e2e/editor-gutter-visibility.e2e.ts`** — a NEW file. **`editor-gutter.e2e.ts` ALREADY EXISTS**: 112 lines, two shipped declarations from spec **009** about gutter theme tokens, tagged `@extended @editor @reserve:layout`. Writing "the E2E in editor-gutter.e2e.ts" would have destroyed them. A separate file is cleaner than appending, too: 009's file is not in `parallel-plan.json`, and adding a `FOCUS` entry for it would drag those two shipped tests out of the parallel tier for a reason that has nothing to do with them. Cover what only a real window can show: toggling `editor.showGutter` removes and restores the gutter in an **already-open** panel with no reopen (FR-043); **the text's measured left edge moves to the panel's left padding** when it is hidden (FR-041 — the reclaimed width must actually reach the text, which is exactly what research.md D3 rejects the CSS approach for); the **top visible line is unchanged** and the selection is unchanged (FR-044 — assert a document anchor, **never `scrollDOM.scrollTop`**: hiding the gutter widens the text column, which re-wraps a wrapped document, so the pixel offset provably moves); and the **standalone editor in the preferences window agrees** (FR-042).

  **FR-042 cannot be demonstrated the obvious way, and this is the trap that would have cost the most.** `preferences-app.tsx` holds a single window-wide `mode` state: `StandaloneEditor` exists **only** in JSON mode, and the `editor.showGutter` toggle row exists **only** in UI mode. They are mutually exclusive in one window, so flipping the toggle *unmounts the editor you were measuring* and "already open, no reopen" cannot be shown that way. **Toggle it from the MAIN window and assert in the already-open preferences window** — which is also the more honest cross-realm proof FR-042 is actually asking for. It costs an extra window in the test.

  **Own the config root** (`runOwnApp` or a seeded `THRONG_CONFIG_ROOT`, as `editor-gutter.e2e.ts` already does). Six assertions across `goto-line.e2e.ts` and `goto-line-keybinding.e2e.ts` read the **rendered gutter number** as the definition of which line the caret is on; a leaked `showGutter: false` fails them with *"no gutter element beside the caret"* — a message that sends the reader to the goto-line code for a defect entirely about a preference. `goto-line-keybinding.e2e.ts:94-95` records that exact misattribution happening once already.

  **Use `expect(locator).toHaveCount(0)` for absence**, not the `document.querySelector('.cm-gutters')!` helper style that `editor-gutter.e2e.ts:31-34` establishes — with the gutter hidden that bare non-null assertion throws a `TypeError` inside `page.evaluate`, whose stack points at the helper rather than the assertion.

  **The parenthetical absolute budget numbers in this file are STALE** — wave 2 already applied its +2/+2/+2, so the live `e2e-budget.json` now reads `total: 558`, `core: 38`, `@editor: 117` — both waves have landed. Apply the **deltas** and ignore the absolutes. **Exactly 4 declarations**, tagged **`@extended @editor`** — not `@core`: the lane is capped at 50 and sits at 36, and four of the remaining fourteen is not the best use of a push gate for one preference. **Each declaration also names its `@reserve:*` entry**: the three geometry ones (`@reserve:layout`) and the standalone-editor-in-preferences one (`@reserve:window`). Raise `e2e-budget.json` by **deltas, not absolutes** — `total` **+4**, `@editor` **+4**, `core` **+0** — because US4 is independently deliverable and may land before or after T014, which makes any absolute endpoint wrong half the time. **AND register the spec in `packages/ui/tests/e2e/parallel-plan.json` as `"editor-gutter-visibility.e2e.ts": "FOCUS"`, in the same commit** — it opens the preferences window for FR-042, and `tier-plan.test.ts`'s `FOCUS_STEALING` guard fails the **unit** stage for any parallel-tier spec matching `/openPrefs|cog-menu-|…/`. Its sibling check also requires every name in the plan to exist on disk, so the entry and the file land together. Show it RED.
- [x] T038 [US4] Add `editor.showGutter` to `packages/core/src/config/app-settings.ts` and its descriptor to `packages/core/src/config/settings-metadata.ts` to turn **T035 and T035a** green — the descriptor existing is what makes the row render, so one change discharges both — then regenerate shipped defaults.

  **`app-settings.ts` needs FOUR edits, and there are two decoys.** The interface member (near `:229`, beside the *editor's* `showStatusBar`), the defaults object (near `:477`), the validator local (near `:808`), **and the explicit hand-listed return object literal that follows the validator** — a field added to the interface and the local but not the literal is a silently-dropped setting. The decoys: there are **two** `showStatusBar` fields in this file (`:87` terminal, `:229` editor) and **two** validators (`:705`, `:808`); the editor is the second of each. Grep and edit the first hit and you put the gutter setting on terminals.

  **Do both halves in ONE edit, never split across commits.** `settings-metadata.test.ts:21-51`'s completeness guard walks every leaf of `AppSettings` and demands a descriptor, so adding the key before the descriptor leaves an unrelated pre-existing test red — which reads exactly like a regression somebody else caused.

  **Then rebuild before any E2E.** `shipped-defaults.json` is generated from `packages/core/dist`, so a stale `dist` gives you a green component stage and a red E2E on the same constant — every cheap tier agreeing that `editor.showGutter` defaults to `true` while the running app has never heard of the key. If that happens: `rm packages/core/tsconfig.tsbuildinfo && rm -rf packages/core/dist`, then rebuild.
- [x] T039 [US4] Declare a `gutterCompartment` in `packages/ui/src/renderer/editor/commands.ts`, beside the existing `wrapCompartment` and `indentCompartment`.
- [x] T040 [US4] Replace the unconditional `lineNumbers()` in `packages/ui/src/renderer/editor/use-editor.ts` with the compartment and reconfigure it on the setting change, in the same shape as the existing word-wrap effect (FR-041, FR-043).
- [x] T041 [US4] Replace the unconditional `lineNumbers()` in `packages/ui/src/renderer/editor/standalone-editor.tsx` with the same compartment (FR-042). **This is the call site the issue warns is easy to miss** — without it the preferences JSON editor keeps its gutter while every panel loses theirs. T036 and T037 go green here.
- [x] T042 [P] [US4] Write a component test in `packages/ui/tests/component/gutter-tokens-live.test.ts` asserting the gutter theme tokens remain declared and editable with the gutter hidden (FR-045) — hiding it must not make 009's tokens inert.
- [x] T043 [P] [US4] Assert the negative in `packages/ui/tests/unit/gutter-scope-040.test.ts`: no per-document or per-language gutter override exists, and no other gutter content (fold markers, diagnostics) is introduced (FR-046).

**Checkpoint**: the gutter toggles live, in both surfaces, without disturbing the view.

---

## Phase 7: Polish & cross-cutting

- [x] T044 [P] Write the performance test for **FR-008c / SC-005** in `packages/core/tests/unit/document-metrics-perf.test.ts`: generate a ~5 MB string, count it, and assert it completes within **2 seconds** with `performance.now()` — an absolute regression alarm, not a target (FR-008c). Follow `config-broadcast-latency.test.ts`, which uses a wide absolute bound and warns that *"a latency assertion tuned to the median is a flake generator"* — so **do not** write a relative counts-on-vs-counts-off comparison. Unit tier, because the counting rules are pure and the `integration` project is `environment: 'node'` with no DOM while the app-level comparison would measure the harness rather than the app. The end-to-end "typing feels no heavier" claim is a **manual quickstart step** by design (FR-008c), and the keystroke-path guarantee is already asserted by T009's debounce test and T011's listener test.
- [x] T044a [P] **Close the one loose thread wave 3 flagged against itself.** `BAR_GAP = 6` in `status-strip.tsx` duplicates `gap: 6px` in `editor.css`: the fit arithmetic needs a number, and reading it back through `getComputedStyle` would cost a cascade query per resize for a value unchanged since 016 — so the duplication is the right call, but it is currently unguarded. Change the CSS gap without the constant and the bar's arithmetic goes quietly wrong with **every test still green**. Add an assertion to `packages/ui/tests/component/status-strip-declared-css.test.ts` — which already parses that stylesheet — that the declared `gap` on `.editor-status-strip` equals `BAR_GAP`. A guard, not a refactor.
- [x] T045 [P] Assert the negative in `packages/core/tests/unit/grouping-view-only-040.test.ts`: no grouping separator reaches a stored value, and the readouts are display-only and never parsed back (FR-028, FR-028a).
- [x] T046 [P] Assert each of the three new settings has an observable effect in `packages/core/tests/unit/settings-inertness-040.test.ts` (FR-052), so #108's forthcoming guard has nothing new to find.
- [x] T047 [P] Assert a pre-existing `settings.json` loads with every value intact and the three new keys take their defaults, in `packages/core/tests/unit/settings-compat-040.test.ts` (FR-051).
- [x] T048 File the follow-up issue **FR-037a / FR-037b** require, covering **both registries** and stating honestly what is and is not migratable. Settings registry: three declared strings (`Editor · Navigation`, `Editor · Indentation`, `Editor · Languages`) — straightforwardly migratable. Theme registry: **five** strings, **derived** by `areaForToken` rather than declared — `Editor · Syntax` and `General · Buttons` are migratable, but **`General · Buttons · Cancel` / `· Confirm` / `· Destroy` are TWO levels deep and `subgroup` gives only one (FR-035)**, so the issue must ask for a decision about a second nesting level before it can ask for a migration. Note that `BUTTON_GROUP_ORDER` and `THEME_AREA_GROUPS` depend on those strings. **DONE — filed as #319** (vNext, `area:preferences` + `area:themes`), stating the two-level button problem and asking for the decision rather than the migration. The vocabulary split is #320.
- [x] T049 Update `README.md` and `docs/` where this feature changes what a user can do. Document what exists, not what is planned.
- [x] T050 Run the full gate (`npm run gate`) and quote the stage summary. This is the only thing that establishes done-ness.

---

## Dependencies

```text
Phase 1 (T001)
  └─> Phase 2 (T002-T006)              pure rules + descriptor field
        ├─> Phase 3 (T007-T018)  US1   readouts            [needs T003, T004]
        │     └─> Phase 4 (T019-T024)  US2 width           [needs the readouts to exist]
        ├─> Phase 5 (T025-T034)  US3   settings + grouping [needs T006 for subgroup]
        │     └─ T027's description rewrite MUST NOT land before Phase 3
        └─> Phase 6 (T035-T043)  US4   gutter              [needs T006 only]

  Phase 7 (T044-T050) follows the phases it polishes — T044 needs Phase 2's counting
  rules, T045-T047 need Phase 5/6's settings, and T050 (the gate) is last of all.
```

**Three ordering constraints are requirements, not conveniences:**

1. **T027 must not merge ahead of Phase 3.** It rewrites `editor.showStatusBar`'s description to name
   the readouts, and #257's own acceptance criterion says it must land *with or after* them — "a
   description promising readouts that do not exist yet is worse than the one it replaces".
2. **Phase 6 owns `editor.showGutter` outright.** An earlier draft created the key in Phase 5 while
   Phase 6 claimed to be independent — which was false, and would have made US4 undeliverable on its
   own. Moving the key into Phase 6 restores the independence the story claims.
3. **T033 and T034 depend on Phase 3, not just on Phase 2.** T034 edits `status-strip.tsx` to make
   the readouts honour the two toggles, and T033 asserts those readouts present and absent — neither
   is meaningful before the readouts exist. The graph above branches Phase 5 off Phase 2 because most
   of it (T025–T032a: descriptors, grouping, the three tabs) genuinely needs only `subgroup`; these
   two tasks are the exception, and an exception nobody writes down is one somebody schedules wrongly.

## Parallel opportunities

`[P]` tasks touch different files and depend on nothing unfinished. **No two `[P]` tasks name the same
file** — verified mechanically, not by eye.

| Wave | Tasks |
|---|---|
| Foundational tests | T002, T005 |
| US1 stores | T007, T009 |
| US1 render + a11y + negative | T013, T016, T018 *(T014 is sequential — it and T037 both edit `e2e-budget.json`)* |
| US2 fit | T019, T021, T023 |
| US3 descriptors + tab Red tests | T025, T029, T031, T032 *(the impls T031a / T032a are sequential — different files, but each must follow its own Red step)* |
| US4 Red set | T035, T035a, T036 *(T037 is sequential — it shares `e2e-budget.json` with T014)* |
| US4 extras | T042, T043 |
| Polish | T044, T045, T046, T047 |

**Not parallel, deliberately**: T015, T017, T022 and T034 all edit `status-strip.tsx`, and T038's two
core files are edited together. Four agents in one file is the failure `[P]` exists to prevent.

## Implementation strategy

**MVP is Phase 2 + Phase 3** — the readouts at their defaults, which is what #256 asks for.

Then Phase 4 (the width rules that make Phase 3 safe to ship), Phase 5 (settings and grouping),
Phase 6 (the gutter, independently deliverable), Phase 7 (polish and the gate).

**Only one agent runs a test command at a time.** Every dispatch either carries the test baton with an
exact command, or says to run no test, lint, typecheck or build command and to report what was needed.
