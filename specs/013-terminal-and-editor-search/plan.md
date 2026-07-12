# Implementation Plan: Terminal & Editor Search

**Branch**: `013-terminal-and-editor-search` | **Date**: 2026-07-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-terminal-and-editor-search/spec.md`

## Summary

Add three in-panel search capabilities, each routed to the **active panel** (the focus context from
feature 012): **find/replace in an editor**, **find in a terminal's scrollback**, and **keyboard
scrollback navigation**. There is **one shared find affordance** — a single `find` command and one find
bar — that adapts to the active panel type: read-only scrollback find for a terminal, find + replace for
an editor. Results surface as **in-content highlights plus a current/total count in the find bar**; there
is **no separate results-list panel**. Match highlight colours come from **theme tokens** exposed in the
Themes editor. All search and navigation commands are **rebindable** in the Key Bindings editor.

**Headline decision — this is a UI-main + renderer feature; the daemon, IPC contract, and persistence are
untouched.** Search is a view concern over content the renderer already holds: the editor's CodeMirror
buffer and the terminal's xterm.js scrollback. No PTY, no daemon service, no SQLite migration, no
`ipc-contract` change. This mirrors 006 (editor) — the OS/process seam stays out of the critical path.
The only `@throng/core` additions are **keybinding action-ids + their editor descriptors** and **theme
tokens + their descriptors** (both pure config, verified by the existing completeness tests).

**Engine decisions (research below):**
- **Editor find/replace → `@codemirror/search`** (`SearchQuery`, `search` extension, `RegExpCursor`/
  `SearchCursor`, replace commands). We already run CodeMirror 6 (`@codemirror/state`/`view`/`commands`);
  this is its first-party search module. We drive it with a **custom React find bar** (CodeMirror's
  built-in panel is not used) so the bar is themeable-icon compliant and shared with the terminal.
- **Terminal find → `@xterm/addon-search`** (`SearchAddon.findNext/findPrevious`, decoration-based match
  highlighting, `onDidChangeResults` → count). We already run `@xterm/xterm` + `@xterm/addon-fit`; the
  search addon is the same family and reads the retained scrollback without touching the PTY.
- **Scrollback navigation → xterm scroll APIs** (`scrollLines`, `scrollPages`, `scrollToTop`,
  `scrollToBottom`) plus a **find-scoped auto-follow suspend** coordinated with the existing
  `terminal/output-gate.ts`.

Delivery is **strictly phased, each phase independently visible and E2E-verified before the next**
(Incremental Delivery rule; Principle V "every user-facing UI change ships passing E2E"):

- **Phase A — Config seam: search commands + theme tokens** (FR-017, FR-018, FR-019, FR-020). Add the
  search/navigation `ActionId`s and `DEFAULT_KEYBINDINGS`, their **keybinding editor descriptors**, the
  **match-highlight colour tokens** + descriptors, and **any find-bar action-control icon tokens** not
  already present (find/next/previous/close/case/whole-word/replace/replace-all — FR-018), in `@throng/core`.
  Extends the completeness tests (a new action/colour/icon token without a descriptor fails). No UI yet —
  pure, unit-tested config. This unblocks the Key Bindings and Themes editors for the new entries.
- **Phase B — Shared find bar + editor find** (US1, FR-001–007, FR-009). A single themeable **find-bar**
  React component; open/close/next/prev wired to the active editor via `@codemirror/search`; **incremental
  as-you-type** highlighting; **case-sensitive / whole-word** toggles; **current/total count**; **seed from
  selection**; **no-results** state; wrap. Highlights use the Phase-A tokens. E2E: `editor-find.e2e.ts`.
- **Phase C — Terminal find + auto-follow freeze** (US2, FR-010–013, FR-012a). The same find bar adapts to
  a terminal via `@xterm/addon-search`; read-only (no keystroke to the program); highlights + count over
  retained scrollback; wrap; **suspend auto-follow while parked on a match** (coordinated with
  `output-gate.ts`); coherent under streaming output. E2E: `terminal-find.e2e.ts`.
- **Phase D — Scrollback keyboard navigation** (US3, FR-014–016). Page/line/top/bottom + next/prev-match,
  routed only when a terminal is the active panel; navigation keys never reach the program; typing at the
  live bottom passes through. E2E: `terminal-scrollback-nav.e2e.ts`.
- **Phase E — Editor replace** (US4, FR-008). Replace-current + replace-all in the same find bar,
  replace-all a **single undoable step**, preserving encoding & line endings (reusing 006's save/fidelity
  model). Replace controls appear only for an editor; disabled when the file is read-only (find still
  works). E2E: `editor-replace.e2e.ts`.

**Delivery order follows spec priority — both P1 stories (US1 editor find, US2 terminal find) precede the
P2 stories (US3 navigation, US4 replace)** — matching tasks.md. The shared find bar, its focus routing
(via 012's active-pane context), and the command scoping (FR-020) are established in Phase B and reused by
Phases C–E — no per-panel find bars.

## Technical Context

**Language/Version**: TypeScript 5.9 (project ceiling), Node.js (Electron 40+ main), React 18 renderer.

**Primary Dependencies**: Electron 40+, React 18, CodeMirror 6 (`@codemirror/state`/`view`/`commands`) +
**new** `@codemirror/search`; `@xterm/xterm` + `@xterm/addon-fit` + **new** `@xterm/addon-search`;
InversifyJS (DI); Vite 7 (renderer bundling, sandboxed, offline — no CDN/workers).

**Storage**: N/A for search state (ephemeral per-view). Keybindings & themes persist through the existing
user-scoped config files (007); no schema/migration change. No daemon SQLite change.

**Testing**: Vitest (unit + integration), Playwright + Electron (E2E). TDD Red-Green-Refactor. New E2E
specs per phase; `@throng/core` search/nav config covered by unit tests and the metadata completeness tests.

**Target Platform**: Windows first (Electron desktop); OS-agnostic core preserved (no OS calls added — the
feature is renderer-only view logic).

**Project Type**: Desktop application (Electron main + sandboxed renderer + detached daemon), npm
workspaces monorepo (`packages/core`, `daemon`, `ipc-contract`, `persistence`, `platform-windows`, `ui`).

**Performance Goals**: Find results (including the incremental as-you-type update) render **within 1000 ms
(≤ 1 s) of the last keystroke** on representative content — a typical file and a typical terminal
scrollback (SC-007). As-you-type search is **debounced** to stay within budget on large buffers.

**Constraints**: Renderer is **sandboxed and offline** — both new libraries must bundle under Vite with no
web worker or CDN (both are pure-JS and satisfy this, like CodeMirror already does). Terminal search is
**read-only** (never delivers a keystroke to the PTY). Editor replace **preserves encoding & line endings**
(reuses 006 fidelity). Highlight colours come **only** from theme tokens (Principle X / constitution v3.12).

**Scale/Scope**: ~5 renderer command surfaces (open/close find, next/prev, replace-current/all, page/line/
top/bottom nav, next/prev match), one shared find-bar component, two engine adapters (CodeMirror, xterm),
**13 new rebindable action-ids** (7 `search.*` + 6 `terminal.scroll*`), **3 new theme tokens**. No
cross-file/project-wide search (out of scope).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against all eleven principles (constitution v3.12.0):

- **I. Project-First Context Isolation** — PASS. Search acts on the active panel within the current
  project; no cross-project surface. Terminal search reads only the retained scrollback of a terminal that
  already belongs to a project.
- **II. Platform-Abstracted Core** — PASS. No OS calls added. Search is renderer view logic over
  in-memory content; the core gains only pure config (action-ids, tokens, descriptors). No new abstraction
  seam required.
- **III. Detached, Tagged & Persistent Terminals** — PASS. Terminal search is **read-only** and MUST NOT
  send keystrokes to the program (FR-010) or alter the character grid (FR-013); auto-follow suspend is a
  view-only scroll state (FR-012a). No PTY/daemon interaction.
- **IV. Native Terminal Support & Auto-Detection** — PASS. Unaffected; search sits above the shell.
- **V. Test-First Quality Discipline (NON-NEGOTIABLE)** — PASS. TDD across unit (core config + pure
  helpers) / integration (find-bar ↔ engine adapters) / E2E (one spec per phase; every user-facing UI
  change ships passing E2E). `@admin` not applicable (no elevation). Generated artifacts self-cleaned.
- **VI. Simple, Modern, Discoverable UX** — PASS. One discoverable `find` command and one bar; results are
  in-content highlights + a count. Layout/panels unchanged.
- **VII. Change Review & Approval** — PASS. Editor replace edits files already on disk via the normal
  editor save path; it is not a new mutation source outside the edit-list model (replace is user-driven,
  same as typing).
- **VIII. SOLID, DRY & YAGNI** — PASS. One shared find bar (DRY, not per-panel); engine adapters behind a
  small `SearchController` interface (find/replace/navigate) with CodeMirror and xterm implementations
  (dependency inversion). Regex and a results-list panel are **not** built (YAGNI — deferred/out of scope).
- **IX. Dependency Injection & Composition Root** — PASS. Renderer wiring follows existing patterns; the
  find bar receives its controller for the active panel, not a service locator. No new process boundary.
- **X. Externalised Configuration** — PASS. Keybinding chords and highlight colours are **not** hardcoded:
  chords come from `DEFAULT_KEYBINDINGS`/user config; colours from theme tokens. Debounce interval and any
  perf caps are injected settings, not magic values.
- **XI. Dockable Workspace: Panes, Tabs & Panels** — PASS. No change to panes/tabs/panels; the find bar is
  in-panel chrome scoped to the active panel and follows 012's focus model.

**Development Workflow & Quality Gates:**
- **Configuration-editor completeness (NON-NEGOTIABLE)** — every new action-id and theme token gets exactly
  one editor descriptor; the existing completeness tests fail otherwise (Phase A enforces this).
- **Themeable icon controls (NON-NEGOTIABLE)** — find-bar action controls (next, previous, close, and the
  case/whole-word toggles) are **themeable icons with hover titles** (FR-018), colours from theme tokens,
  no inline SVG / hardcoded CSS. Replace-current/all use icons too. (The bar has no dialog decision buttons,
  so the text-label exception does not apply.)
- **Documentation currency (NON-NEGOTIABLE)** — README (feature set), ROADMAP (regex + results-list marked
  as planned/deferred), and CONTRIBUTING (if toolchain changes) updated in the same change.

**Result: PASS — no violations. Complexity Tracking is empty.**

## Project Structure

### Documentation (this feature)

```text
specs/013-terminal-and-editor-search/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── search-controller.md   # renderer SearchController interface (editor + terminal adapters)
│   ├── keybindings.md         # new action-ids, default chords, editor descriptors
│   └── theme-tokens.md        # match-highlight tokens + Themes-editor descriptors
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
packages/core/src/config/
├── keybindings.ts            # + search/nav ActionIds & DEFAULT_KEYBINDINGS chords
├── keybindings-metadata.ts   # + editor descriptors for the new actions (completeness)
├── metadata.ts               # + any injected search setting (e.g. asYouTypeDebounceMs) descriptor
└── theme.ts + theme-copy.ts        # + colours.searchMatch / searchMatchCurrent / searchMatchCurrentBorder tokens & copy

packages/ui/src/renderer/
├── search/                    # NEW — shared find affordance
│   ├── find-bar.tsx           # single themeable find/replace bar (adapts to active panel)
│   ├── find-bar.css
│   ├── search-controller.ts   # SearchController interface + selection-seed + count model
│   ├── use-find-bar.ts        # open/close/route-to-active-panel state (uses 012 active-pane)
│   ├── editor-search.ts       # CodeMirror @codemirror/search adapter
│   └── terminal-search.ts     # @xterm/addon-search adapter + scrollback nav + auto-follow freeze
├── editor/
│   ├── use-editor.ts          # wire @codemirror/search extension into the editor state
│   └── editor-panel.tsx       # host the find bar when an editor is active
├── terminal/
│   ├── use-terminal.ts        # load SearchAddon; expose scroll/nav; coordinate output-gate freeze
│   ├── output-gate.ts         # + find-scoped auto-follow suspend
│   └── terminal-panel.tsx     # host the find bar when a terminal is active
└── workspace/active-pane.ts   # active-panel routing consumed by use-find-bar (from 012)

packages/ui/e2e/
├── editor-find.e2e.ts         # Phase B
├── editor-replace.e2e.ts      # Phase C
├── terminal-find.e2e.ts       # Phase D
└── terminal-scrollback-nav.e2e.ts  # Phase E
```

**Structure Decision**: Reuse the established monorepo layout. A new `renderer/search/` module owns the
shared find bar and the two engine adapters behind one `SearchController` interface; `@throng/core/config`
gains only pure config (action-ids, tokens, descriptors) covered by the completeness tests. No `daemon`,
`ipc-contract`, `persistence`, or `platform-windows` changes — the feature is renderer + core-config only.

## Complexity Tracking

> No Constitution Check violations. This section is intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(none)_  | —          | —                                    |
