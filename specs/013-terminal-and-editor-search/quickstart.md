# Quickstart & Validation: Terminal & Editor Search

A run/validation guide proving the feature works end-to-end. Implementation detail lives in `tasks.md`;
interfaces in `contracts/`.

## Prerequisites

- Repo built: `npm install` (adds `@codemirror/search`, `@xterm/addon-search`), then `npm run build`.
- Run the app: `npm run dev` (or the project's Electron dev command).
- A project open with a text file and a terminal panel (feature 012's active-panel routing available).

## Validation scenarios

Run each against the built app; each maps to a user story / success criterion and to its E2E spec.

### 1. Editor find (US1, SC-001) — `editor-find.e2e.ts`
1. Open a file with several occurrences of a word; make an editor the active panel.
2. Press **Ctrl+F**. Expect the shared find bar; if a word is selected it pre-fills the input (FR-002b).
3. Type a term → **matches highlight incrementally as you type**, the first match from the caret is marked
   current and scrolled into view, and the bar shows a count (e.g. "3 of 12").
4. **F3 / Shift+F3** step forward/back and **wrap** at the ends; the file is never modified.
5. Toggle **case-sensitive** and **whole-word** → counts/highlights update live.
6. Type a term with no matches → clear **no-results** state; file unchanged.
7. **Esc** closes the bar, clears highlights, returns focus to the content at the current match.

**Expected**: file content unchanged in all trials; results render within **≤ 1000 ms** of the last
keystroke (SC-007).

### 2. Editor replace (US4, SC-004) — `editor-replace.e2e.ts`
1. With matches shown, press **Ctrl+H** (or reveal replace) → replace input + replace icons appear (editor
   only).
2. Enter a replacement, **Replace match** (Alt+Enter) → only the current match changes; selection advances.
3. **Replace all** (Ctrl+Alt+Enter) → every match replaced; count → 0.
4. Inspect the saved file: **encoding and line endings unchanged**; only the intended text differs.
5. **Undo** once → replace-all fully reverts (single undoable step).

### 3. Terminal find (US2, SC-002) — `terminal-find.e2e.ts`
1. Produce a terminal with long scrollback containing a known term several times; make it the active panel.
2. **Ctrl+F**, type the term → matches highlight in the retained scrollback, nearest match scrolled into
   view, count shown. **Zero keystrokes reach the running program.**
3. **F3 / Shift+F3** step + wrap; still no input delivered to the program.
4. While parked on a match, generate new output at the bottom → **viewport stays on the match**
   (auto-follow suspended, FR-012a); matches remain coherent.
5. **Esc** closes find; typing now goes to the program; highlights cleared; auto-follow resumes.

### 4. Scrollback keyboard navigation (US3, SC-003) — `terminal-scrollback-nav.e2e.ts`
1. With a long scrollback and a terminal active, use only the keyboard:
   **Ctrl+Shift+Up/Down** (line), **Shift+PageUp/PageDown** (page), **Ctrl+Home** (top), **Ctrl+End**
   (live bottom). Viewport moves as intended; **no navigation keystroke reaches the program**.
2. With find active, next/previous-match (F3 / Shift+F3) moves the viewport to the match.
3. At the live bottom, type → input reaches the program normally (nav does not intercept, FR-016).

### 5. Rebinding & theming (SC-005, SC-006)
1. Open **Preferences → Key Bindings** → every search & terminal-nav command appears under **Search** /
   **Terminal** and is rebindable (completeness test passes, SC-006).
2. Open **Preferences → Themes** → **Search match / Current search match / Current match outline** tokens
   are present and editable; switch across bundled themes and confirm highlights stay legible (SC-005).

## Automated verification

- Unit: `@throng/core` keybinding/theme additions + completeness tests; pure helpers (seed, count, wrap).
- Integration: find bar ↔ `SearchController` adapters (editor & terminal), count re-eval on streaming.
- E2E (per phase, all must pass before the phase is done — Principle V): the four specs above.
- Docs: README feature list, ROADMAP (regex + results-list marked planned/deferred) updated in the same PR.
