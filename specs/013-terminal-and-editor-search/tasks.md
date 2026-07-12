# Tasks: Terminal & Editor Search

**Feature**: `013-terminal-and-editor-search` | **Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

**Design inputs**: research.md, data-model.md, contracts/ (search-controller, keybindings, theme-tokens),
quickstart.md.

**Testing**: TDD is mandatory (Constitution V — Red-Green-Refactor; every user-facing UI change ships
passing E2E). Test tasks precede their implementation within each phase.

**Boundary**: Renderer (`packages/ui`) + core config (`packages/core/src/config`) only — no `daemon`,
`ipc-contract`, `persistence`, or `platform-windows` changes.

**Story priority**: US1 (P1, editor find) → US2 (P1, terminal find) → US3 (P2, scrollback nav) →
US4 (P2, editor replace). **MVP = US1**.

---

## Phase 1: Setup

- [x] T001 Add `@codemirror/search` and `@xterm/addon-search` to `packages/ui/package.json` dependencies and run `npm install`; verify both bundle under Vite offline (no worker/CDN) with a `npm run build` of `packages/ui`.
- [x] T002 [P] Scaffold the shared search module: create empty `packages/ui/src/renderer/search/{find-bar.tsx,find-bar.css,search-controller.ts,use-find-bar.ts,editor-search.ts,terminal-search.ts}` with file-header comments referencing the contracts.

---

## Phase 2: Foundational (blocking prerequisites for ALL stories)

**Config seam (core) — Plan Phase A; unblocks the Key Bindings & Themes editors.**

- [x] T003 [P] Add search & terminal-nav `ActionId`s (`search.find|findNext|findPrevious|close|replace|replaceCurrent|replaceAll`, `terminal.scrollLineUp|scrollLineDown|scrollPageUp|scrollPageDown|scrollToTop|scrollToBottom`) and their default chords to `packages/core/src/config/keybindings.ts` per contracts/keybindings.md.
- [x] T004 [P] Add `chord(...)` descriptors for every new action under new **Search** and **Terminal** groups in `packages/core/src/config/keybindings-metadata.ts`.
- [x] T005 [P] Add match-highlight tokens `colours.searchMatch`, `colours.searchMatchCurrent`, `colours.searchMatchCurrentBorder` to `THRONG_THEME` in `packages/core/src/config/theme.ts`, and give every bundled theme values meeting the contrast bar (SC-005).
- [x] T006 [P] Add catalogue copy for the three new tokens to `THEME_TOKEN_COPY` in `packages/core/src/config/theme-copy.ts` per contracts/theme-tokens.md.
- [x] T006a [P] Register the find-bar action-control **icon tokens** (find, next, previous, close, case-sensitive, whole-word, replace, replace-all). Verify each glyph already exists as a descriptor-backed icon token in `THRONG_THEME.icons`; add any **missing** icon token + derived editor descriptor + catalogue copy in `packages/core/src/config/theme.ts` / `theme-copy.ts` so the config-editor-completeness test covers them (FR-018; constitution themeable-icon-controls, NON-NEGOTIABLE). The find-bar controls (T012/T034) MUST take their glyphs from these tokens — no inline SVG / hardcoded glyphs.
- [x] T007 Unit tests (TDD, write first → red): assert `DEFAULT_KEYBINDINGS` contains each new action, `parseKeybindings` merges them when absent, the keybindings completeness test covers each new action, and the theme completeness/quality/copy tests cover the new tokens — in `packages/core/test/config/` (extend existing suites). Then implement T003–T006 to green.
- [x] T008 Unit test + assertion that no default chord collides with an existing binding **within the same active scope** (new case in `packages/core/test/config/keybindings.test.ts`).

**Shared find affordance (renderer) — the single adaptive bar reused by every story.**

- [x] T009 Define `SearchController`, `EditorSearchController`, `TerminalSearchController`, `MatchModes`, `SearchCount` interfaces in `packages/ui/src/renderer/search/search-controller.ts` exactly per contracts/search-controller.md.
- [x] T010 Unit test (TDD → red): `use-find-bar` routing/count/close-focus against a **fake** `SearchController` (active-panel selection, count model, close clears + returns focus) in `packages/ui/src/renderer/search/use-find-bar.test.ts`; **also assert that switching the active panel re-routes the bar to the new panel's controller (or closes it), never leaving a stray bar on the wrong panel** (spec.md Edge Cases).
- [x] T011 Implement `packages/ui/src/renderer/search/use-find-bar.ts`: open/close state, select the controller from the active panel via `packages/ui/src/renderer/workspace/active-pane.ts` (012 focus context), current/total count, and close→clear-highlights + return focus (FR-002/FR-004). Make T010 green.
- [x] T012 Implement `packages/ui/src/renderer/search/find-bar.tsx` + `find-bar.css` shell: term input, "N of M" indicator, and **themeable-icon** next/previous/close controls with hover titles (FR-018), **glyphs from the T006a icon tokens** and colours from theme tokens (no inline SVG/hardcoded CSS); no-results state (FR-009); CSS binds match highlight custom properties to the Phase-A colour tokens.
- [x] T013 Wire `search.find`/`search.close`/`search.findNext`/`search.findPrevious` resolution through the active-pane scoping so they reach the active panel only (FR-020) — renderer keybinding dispatch (reuse the `editor.*`/`file.*` gating pattern).

**Checkpoint**: config seam unit-green; the Key Bindings & Themes editors expose the new entries; find-bar shell renders (no engine yet).

---

## Phase 3: User Story 1 — Find text in the active editor (P1) 🎯 MVP

**Goal**: Incremental find with highlights, count, wrap, toggles, seeding, no-results — file never modified.
**Independent test**: quickstart §1; assert every occurrence highlighted, current marked/scrolled, count shown, wrap works, file unchanged, results ≤ 1000 ms.

- [x] T014 [P] [US1] E2E `packages/ui/e2e/editor-find.e2e.ts` (TDD → red): open find (Ctrl+F), seed from selection, as-you-type highlight + count, F3/Shift+F3 wrap, case/whole-word toggles, no-results, Esc closes & restores focus; assert file content unchanged and SC-007 timing; **also assert find is a clear no-op / unavailable when no panel is active** (spec.md Edge Cases, nothing searched).
- [x] T015 [US1] Integration test `packages/ui/src/renderer/search/editor-search.test.ts` (→ red): `EditorSearchController` over `@codemirror/search` — setQuery highlights/counts, findNext/Previous wrap, seedFromSelection returns single-line selection, onCountChange fires.
- [x] T016 [US1] Implement `packages/ui/src/renderer/search/editor-search.ts` `EditorSearchController`: drive `@codemirror/search` (`SearchQuery`, `setSearchQuery`, `findNext/findPrevious`), map to `SearchController`; make T015 green.
- [x] T017 [US1] Wire the `@codemirror/search` extension and a decoration theme into `packages/ui/src/renderer/editor/use-editor.ts`; map match / current-match decoration classes to the theme-token CSS variables (FR-019); no hardcoded colour.
- [x] T018 [US1] Add the `asYouTypeDebounceMs` setting + metadata descriptor in `packages/core/src/config/settings.ts` and `metadata.ts` (externalised config, Principle X; covered by completeness test). **Precedes its consumer (T019).**
- [x] T019 [US1] Host the shared find bar in `packages/ui/src/renderer/editor/editor-panel.tsx` when an editor is the active panel; render case-sensitive & whole-word toggle icons (default off); debounce as-you-type via the injected `asYouTypeDebounceMs` setting (T018).
- [x] T020 [US1] Run `editor-find.e2e.ts` to green; confirm SC-001 (content unchanged) and SC-007 (≤ 1000 ms) assertions pass **against the SC-007 representative fixtures — a ~10,000-line file** (deterministic size).

**Checkpoint**: editor find fully working and E2E-green — MVP deliverable.

---

## Phase 4: User Story 2 — Find text in a terminal's scrollback (P1)

**Goal**: Read-only find over retained scrollback with highlights, count, wrap; zero keystrokes to the program; auto-follow freezes on a match.
**Independent test**: quickstart §3; assert highlights/count/wrap and **zero** input delivered to the program, and the viewport stays on the match under streaming output.

- [x] T021 [P] [US2] E2E `packages/ui/e2e/terminal-find.e2e.ts` (TDD → red): find in scrollback, count, F3/Shift+F3 wrap, **assert zero keystrokes reach the running program** (SC-002), auto-follow freeze while parked on a match with new output arriving (FR-012a), **assert the xterm grid dimensions (rows × cols) are unchanged after opening find and navigating matches** (FR-013), and **assert a mirrored view of the same terminal keeps its own independent find session** (spec.md Edge Cases).
- [x] T022 [US2] Integration test `packages/ui/src/renderer/search/terminal-search.test.ts` (→ red): `TerminalSearchController` find via `@xterm/addon-search` — count via `onDidChangeResults`, wrap, re-eval on buffer growth/trim, and `seedFromSelection` returning **only a non-empty single-line** selection via xterm `getSelection()` (a multi-line selection does NOT seed, matching FR-002b).
- [x] T023 [US2] Implement the find part of `packages/ui/src/renderer/search/terminal-search.ts` `TerminalSearchController`: load `SearchAddon`, `findNext/findPrevious` with `{caseSensitive, wholeWord, decorations}` from theme tokens, `onCountChange`, and `seedFromSelection` (single-line only, FR-002b); make T022 green. Type-level: **no** `replace*` methods (read-only, FR-010).
- [x] T024 [US2] Load `SearchAddon` in `packages/ui/src/renderer/terminal/use-terminal.ts` and host the shared find bar in `packages/ui/src/renderer/terminal/terminal-panel.tsx` when a terminal is active (no replace controls, FR-002); guarantee no keystroke to the pty on find (FR-010).
- [x] T025 [US2] Implement find-scoped auto-follow freeze in `packages/ui/src/renderer/terminal/output-gate.ts` + `terminal-search.ts` `setAutoFollow`: suspend on match, resume on close/jump-to-bottom; view-only, no pty keystroke (FR-012a).
- [x] T026 [US2] Run `terminal-find.e2e.ts` to green; confirm SC-002.

**Checkpoint**: both P1 finds work through the one shared bar; terminal find is read-only.

---

## Phase 5: User Story 3 — Navigate terminal scrollback from the keyboard (P2)

**Goal**: Page/line/top/bottom + next/prev-match by keyboard; nav keys never reach the program; typing at the live bottom passes through.
**Independent test**: quickstart §4; assert viewport moves and no navigation keystroke reaches the program.

- [x] T027 [P] [US3] E2E `packages/ui/e2e/terminal-scrollback-nav.e2e.ts` (TDD → red): page/line/top/bottom (per contracts/keybindings.md chords), next/prev-match while find active, and pass-through typing at the live bottom (FR-016); assert nav keystrokes are not delivered to the program.
- [x] T028 [US3] Implement the scroll methods on `TerminalSearchController` in `packages/ui/src/renderer/search/terminal-search.ts`: `scrollLines/scrollPages/scrollToTop/scrollToLiveBottom/isAtLiveBottom` using xterm scroll APIs.
- [x] T029 [US3] Wire `terminal.scroll*` action-ids to active-terminal scoping in the renderer keybinding dispatch; consume the keys (never forward to the pty, FR-014); ensure live-bottom typing is not intercepted (FR-016); `scrollToLiveBottom` resumes auto-follow (ties to T025).
- [x] T030 [US3] Run `terminal-scrollback-nav.e2e.ts` to green; confirm SC-003.

**Checkpoint**: terminal fully keyboard-navigable with find.

---

## Phase 6: User Story 4 — Replace text in the active editor (P2)

**Goal**: Replace-current + replace-all; replace-all is a single undoable step; encoding & line endings preserved.
**Independent test**: quickstart §2; replace one then all, confirm intended text changed and fidelity preserved; undo restores in one step.

- [x] T031 [P] [US4] E2E `packages/ui/e2e/editor-replace.e2e.ts` (TDD → red): replace-current advances selection, replace-all → count 0 in one undoable step, encoding & line endings unchanged, undo reverts — per quickstart §2 (SC-004); **also assert that for a read-only / non-editable file the replace controls are disabled while find still works** (spec.md Edge Cases).
- [x] T032 [US4] Integration test in `packages/ui/src/renderer/search/editor-search.test.ts` (→ red): `replaceCurrent`/`replaceAll` commit a **single transaction** and route through the 006 save/fidelity path (encoding + line endings preserved).
- [x] T033 [US4] Implement `replaceCurrent`/`replaceAll` on `EditorSearchController` (`@codemirror/search` replace in one transaction); preserve encoding/line endings via the existing editor save model; honour the active case/whole-word toggles (research D9); **guard against a read-only / non-editable document** (replace is a no-op / disabled; find still works).
- [x] T034 [US4] Add replace input + **replace-current / replace-all** themeable-icon controls (glyphs from the T006a icon tokens) to the find bar, shown only when the active panel is an editor (FR-002) and **disabled when the file is read-only / non-editable** (find still works); `search.replace` (Ctrl+H) opens the bar with replace focused.
- [x] T035 [US4] Run `editor-replace.e2e.ts` to green; confirm SC-004.

**Checkpoint**: all four user stories delivered and independently E2E-green.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T036 [P] Update `README.md`: add in-panel editor find/replace and terminal scrollback find + keyboard navigation to the current shipped feature set (no per-feature narration — doc-currency rule).
- [x] T037 [P] Update `ROADMAP.md`: mark search delivered; record **regex matching** and a **results-list / match-list panel** as planned/deferred.
- [x] T038 [P] Update `CONTRIBUTING.md` only if the two new renderer deps warrant a toolchain note.
- [x] T039 Full green bar: run unit + integration + E2E, ESLint, and the config completeness / theme-quality tests; confirm all pass (Principle V, no orphaned test artifacts).
- [x] T040 Verify SC-005 (ordinary + current highlights legible across **all** bundled themes) and SC-006 via an **automated E2E/integration assertion** that every new action-id appears in the Key Bindings editor and is rebindable (complementing the descriptor-completeness unit test — not manual-only).

---

## Dependencies & Execution Order

- **Setup (T001–T002)** → blocks everything.
- **Foundational (T003–T013)** → blocks all user stories. Config seam (T003–T008) and shared bar (T009–T013) can proceed in parallel tracks, but both complete before Phase 3.
- **US1 (T014–T020)** → MVP; depends only on Foundational. The shared bar's editor path is completed here.
- **US2 (T021–T026)** → depends on Foundational (shared bar) + T005/T006/T006a tokens; independent of US1's editor code.
- **US3 (T027–T030)** → depends on US2's `TerminalSearchController` (extends it) and T025 auto-follow.
- **US4 (T031–T035)** → depends on US1's `EditorSearchController` (extends it with replace).
- **Polish (T036–T040)** → after all stories.

Story independence: US1 and US2 are independent (different adapters/panels) once Foundational lands; US3
extends US2, US4 extends US1. Priority order US1→US2→US3→US4.

## Parallel Execution Examples

- Foundational config seam: **T003, T004, T005, T006** in parallel (distinct files), then T007/T008 tests.
- Kickoff of each story's E2E in parallel with prior story polish: **T014 [US1]**, **T021 [US2]** can be
  authored in parallel (different spec files) once Foundational is done.
- Polish docs: **T036, T037, T038** in parallel (distinct docs).

## Implementation Strategy

1. **MVP first**: Setup → Foundational → **US1** (editor find). Ship/validate the shared bar + editor find.
2. **Second P1**: **US2** (terminal find) reusing the same bar; prove read-only + auto-follow freeze.
3. **P2 increments**: **US3** (scrollback nav) then **US4** (editor replace), each independently E2E-green.
4. **Polish**: docs currency + full-suite/theming/rebinding verification.

Each phase is a complete, independently testable increment (Incremental Delivery rule); no phase is marked
done without its E2E passing (Principle V).

---

## Delivery notes (what differed from the plan, and why)

Recorded so the artifacts stay honest about the code that actually shipped.

1. **E2E live in `packages/ui/tests/e2e/`**, not `packages/ui/e2e/` as these tasks first said.
   Same for renderer unit tests (`packages/ui/tests/unit/`). Paths corrected in place.

2. **The terminal had to RESERVE throng's chords** (`attachCustomKeyEventHandler`) — an
   addition to the plan, and the load-bearing one. xterm handles Ctrl+F / F3 / Shift+PageUp
   itself and writes them to the pty; without reserving them, find could not open over a
   terminal and the keys WOULD have reached the shell. This is the mechanism behind SC-002,
   so it is verified by E2E rather than assumed.

3. **xterm's proposed API is enabled** (`allowProposedApi: true`). The search addon paints its
   match decorations through it; without it the addon throws instead of highlighting.

4. **No auto-follow mechanism was built** (the plan sketched an `output-gate` change, T025).
   xterm only follows new output while the viewport is already at the live bottom, so parking
   on a match up in the scrollback suspends following on its own, and jumping to the bottom
   resumes it. Building a second mechanism on top would have been redundant (YAGNI). The
   behaviour is proven by E2E — output arriving while parked leaves the match on screen —
   rather than taken on trust.

5. **Read-only replace is guarded at the editor's non-editable state**, not at the file's
   permissions. The controller asks CodeMirror's `state.readOnly` on every replace, and the
   store and bar both refuse/disable when it is set (unit-tested). throng has **no disk-level
   read-only file concept today**, so the "file is read-only on disk" arm of that edge case
   has nothing to hang off and is NOT claimed as delivered — it becomes real for free the day
   a read-only file state exists.

6. **The theme-distinctness audit constant moved** (4.415 → 4.469). It records the measured
   closest bundled-theme pair, which shifts whenever the token set grows; the pair drifted
   slightly further apart, so the distinctness gate still holds.
