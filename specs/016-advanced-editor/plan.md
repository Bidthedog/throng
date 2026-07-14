# Implementation Plan: Advanced Editor — Rich Code Editing (Part 1)

**Branch**: `016-advanced-editor` | **Date**: 2026-07-12, **revised 2026-07-13** (document authority, FR-028f) | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/016-advanced-editor/spec.md`

## Summary

Layer real code-editing capability onto the plain-text Editor Panel that feature 006 deliberately shipped
without it. The headline is **language-aware syntax highlighting**, but the load-bearing decision is
*how the editor decides*: it **detects the language first** — from the file's **extension only** — and
only then selects a **highlighter**, both behind an **extensible language registry** (one descriptor per
language). Bundled with it are the editing essentials that make the editor feel finished: a content-area
right-click menu, `Ctrl+X` = cut line, per-language tab/space indentation, and column (rectangular)
selection.

**Technical approach**: reuse CodeMirror 6's own language ecosystem rather than hand-writing highlighters.
`@codemirror/language` is *already* a declared dependency and imported nowhere, so `syntaxHighlighting`,
`HighlightStyle` and `StreamLanguage` cost zero new dependencies; only the `@codemirror/lang-*` grammars
are new, and they load **lazily** per language. Syntax colours become **theme tokens** whose values are
CSS variables (`var(--throng-colour-syntaxKeyword)`), so a theme change repaints code **live** with no
view rebuild — the property the rest of the editor already has.

Part 1 is *mostly* renderer-side, but not renderer-only. **Five** things sit outside the editor, each
surfaced by a later clarification rather than the original scoping: a **document authority in UI main**, a
**contract-tested clipboard OS seam**, a **dispatch-scope** on the shared keybinding model (without which
`Ctrl+X` resolves to the Explorer's `file.cut` inside an editor and `cut-line` never fires at all), a
**keyed-table control** in feature 007's Settings editor, and **two schema changes** — a structured recovery
snapshot carrying the undo history, and a **per-document-state SQLite table** reached by **new daemon RPC**.

The **document authority** (FR-028f, added 2026-07-13) is the most consequential of the five and the last
to be understood. Constitution **v3.15.0** made *"one document, one state"* Principle XI, and its test is
**authority, not mechanism**: one owner, one ordered change stream, no two originals. The shipped editor
fails it — mirrored views are two `EditorView`s, each its own source of truth, reconciling by
**whole-document replace**. So **UI main becomes the document's single authority**, holding the canonical
text and a **monotonic version**, and **rebasing** any change that was in flight against a version since
superseded. This is not a collaborative-editing engine: there is one history and one authority, and the
only thing rebased is an in-flight change against changes already ordered — a single `ChangeSet.map()`.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node ≥ 20, ES2022 modules

**Primary Dependencies**: Electron 43 · CodeMirror 6 (`@codemirror/{state,view,commands,language,search}`
already present; `@codemirror/lang-*` + `@codemirror/legacy-modes` **new**) · InversifyJS (DI) ·
better-sqlite3 · React 19

**Storage**: SQLite via the daemon (new `document_state` table, migration **v7**) · user-scoped JSON config
(`~/.throng/settings.json`) · recovery snapshots in `%APPDATA%/throng/recovery/`

**Testing**: Vitest — `unit` (parallel), `integration` (serial), `contract` (serial) · Playwright-Electron
for E2E (real on-screen windows; **no headless mode**)

**Target Platform**: Windows first. **No decision may foreclose macOS/Linux** (Principle II) — hence the
platform-keyed chord defaults and the clipboard seam.

**Project Type**: Desktop application — npm workspaces monorepo (`packages/{core,ui,daemon,persistence,
ipc-contract,platform-windows}`)

**Performance Goals** (FR-008, SC-003 — asserted against the **largest** permitted file, not a typical one):
first highlight **< 200 ms**; no main-thread task **> 50 ms**; typing adds **≤ 16 ms** (no dropped frame at
60 Hz). Cost tracks the **visible region**, not document size — so **every** file the editor opens is fully
highlighted, with exactly one exception, scoped to a **line**: a single line **> 10,000 chars** renders
unhighlighted (FR-008a).

**Constraints**: encoding + line-ending fidelity on save (006) must survive; untouched lines are **never**
rewritten; opening a file must never mark it dirty; terminal key handling stays **PTY passthrough** (005).

**Scale/Scope**: 31 language targets · 10 syntax theme tokens × 15 bundled themes · 7 new registered
commands + dispatch scopes for the 36 already shipped · 1 new settings control type · 1 new OS seam ·
**1 new main-process document authority** (canonical text + monotonic version + in-flight rebase) ·
**1 new view↔main IPC protocol** (the canonical change stream — `contracts/document-authority.md`) ·
1 SQLite migration + **4** new RPC methods (`document.getState` / `setState` / `movePath` / `pruneMissing`).

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design.*

| # | Principle | Verdict | How this design satisfies it |
|---|---|---|---|
| I | Project-First Context Isolation | **PASS** | `document_state` is keyed by **owner + project + project-relative path** — a file belongs to exactly one project. Deleting a project **cascades** its rows. |
| II | Platform-Abstracted Core | **PASS** | The clipboard becomes a **contract-tested seam** (`IClipboard`) the moment core needs to read the live clipboard to decide a paste mode. Chord defaults and the column-select mouse modifier are **platform-keyed**, so adding macOS is a change of **values, not shape**. Core stays DOM-free: the registry is pure; the *loader* lives in the renderer. |
| III | Detached, Tagged & Persistent Terminals | **PASS (untouched)** | Terminal Panels keep **PTY passthrough** (FR-017d); this feature never routes terminal input through the keybinding registry. The three unseamed `clipboard.*` calls in `terminal-ipc.ts` move behind the seam — behaviour-preserving. |
| IV | Native Terminal Support | **PASS (untouched)** | No terminal behaviour changes. |
| V | Test-First Quality Discipline | **PASS** | Every task is Red→Green→Refactor. The four real layers are used (**no invented component-test layer** — none exists). **Every UI change ships E2E coverage**: status strip, picker, content menu, column selection, keyed-table control. The clipboard seam carries **contract tests**. A suite is run **once, unfiltered, output captured**; only failures are re-run; a test that passes on re-run with no code change is **flaky, not fixed**. |
| VI | Simple, Modern, Discoverable UX | **PASS** | The language is visible **at all times** in the status strip, changeable in **≤ 2 clicks** from two entry points. |
| VII | Change Review & Approval | **PASS (untouched)** | No edit-list behaviour changes. |
| VIII | SOLID, DRY & YAGNI | **PASS** | The language registry is **open/closed** — a new language is a new descriptor, no editor change. The keyed-table control is **generic**, not bespoke (it serves both maps and the future `.editorconfig` cascade). `reservedByTerminal` — a hand-rolled, hard-coded terminal-scope table — is **deleted** and subsumed by `scope`, removing duplication rather than adding a parallel mechanism. `filenames?` is reserved but unused — a deliberate **shape reservation** required by FR-002b, not speculative generality. |
| IX | DI & Composition Root | **PASS** | `IClipboard` is constructor-injected and bound **once** in the UI-main container. No new container; no service locator. |
| X | Externalised Configuration | **PASS** | Indentation, the extension map and the persist-undo toggle are **injected settings**, not constants. The two fixed bounds (500 undo entries, the 10,000-char long-line guard) are deliberately **not** settings — see Complexity Tracking. |
| XI | Dockable Workspace — **One document, one state** | **PASS (and remediates)** | No pane/tab/panel *model* change: the status strip lives **inside** the Editor Panel body. But XI's **one-document-one-state** rule (v3.15.0) is the principle this feature most directly serves, and the shipped code **violates it twice**. XI has **two** clauses and they need **two** requirements: **(1) one shared undo history** → **FR-026c** (the stack moves out of the per-view `history()` and into the document's authority); **(2) one AUTHORITY, not two peers** → **FR-028f** (UI main owns the canonical text + a monotonic version; views are derived replicas; an in-flight change on a superseded version is **rebased**, never applied at the position it first named). Today a mirrored Panel is a **second `EditorView` that is its own source of truth**, reconciled by **whole-document replace** — textbook peer-to-peer reconciliation, which XI forbids by name. FR-026c alone would **not** satisfy XI: it fixes the history and leaves the two originals in place. The feature does not merely avoid breaking XI; it is the change that makes XI **true**. |

**Quality gates**: lint (ESLint, **zero errors**) · `tsc -b` · unit/integration/contract/E2E · docs currency
(README / CONTRIBUTING / ROADMAP) · **configuration-editor completeness** (every new setting, command and
theme token has a descriptor and is editable in a visual editor) · **themeable icon controls** (every new
action control is a theme-token icon with a hover title, no inline SVG, no hardcoded colours).

### Constitution risks this design explicitly closes

- **Configuration-editor completeness would have failed the build.** `leavesOf` recurses into plain
  objects, so a **non-empty** keyed map explodes into one required descriptor **per entry**. Map-ness
  becomes **declared** (`control: 'map'`), not inferred. This also closes a **pre-existing** violation:
  `terminals.defaultParams` ships today with **no descriptor** (an empty map yields zero leaves), i.e. a
  JSON-only setting of exactly the kind the rule forbids.
- **Theme-token completeness**: the 10 syntax + 3 status-strip tokens need hand-written copy avoiding
  `BANNED_ABBREVIATIONS` (notably `bg`/`fg`) and not equal to `mechanicalCopy(key)`.

## Project Structure

### Documentation (this feature)

```text
specs/016-advanced-editor/
├── plan.md              # This file
├── research.md          # Phase 0 — 8 findings where shipped code contradicts the spec, + 12 decisions
├── data-model.md        # Phase 1 — entities, settings, schema, tokens
├── quickstart.md        # Phase 1 — gates + 43 manual validation steps
├── contracts/
│   ├── clipboard.md          # IClipboard OS seam + contract suite
│   ├── document-authority.md # NEW — the view↔main canonical change stream (FR-028f)
│   └── document-state-rpc.md # document.* daemon RPC + v7 migration
├── checklists/requirements.md  # 16/16 passing
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source code

```text
packages/core/src/
├── editor/
│   ├── languages.ts            # NEW — registry: 31 descriptors, pure
│   ├── language-detect.ts      # NEW — longest-suffix detection + precedence chain
│   ├── indent-infer.ts         # NEW — bounded sample (10%/100 lines/20 chars)
│   ├── clipboard-mode.ts       # NEW — mode decided by the SELECTION, not the command
│   └── open-registry.ts        # (unchanged — already enforces one buffer per file)
├── abstractions/clipboard.ts   # NEW — IClipboard seam (FR-013a)
├── testing/clipboard-contract.ts # NEW — runClipboardContract
└── config/
    ├── keybindings.ts          # CHANGED — DispatchScope, scope sets, scope-aware resolveAction
    ├── chord-capture.ts        # CHANGED — scope-aware findConflict; Tab/Shift+Tab leave EXCLUDED_KEYS
    ├── metadata.ts             # CHANGED — 'map' ControlKind; leavesOf stops at a map; map arms
    ├── settings-metadata.ts    # CHANGED — descriptors for the 2 maps, the toggle, + terminals.defaultParams
    ├── app-settings.ts         # CHANGED — EditorSettings + tolerant map parsers + DEEP clone
    ├── theme.ts                # CHANGED — 10 syntax + 3 status-strip tokens
    ├── theme-copy.ts           # CHANGED — hand-written copy per new token
    ├── theme-quality.ts        # CHANGED — 20 new pairings; recalibrated distinctness constant
    ├── shipped-defaults.ts     # CHANGED — SHIPPED_DEFAULTS_VERSION 2 → 3
    └── default-themes/index.ts # CHANGED — per-theme syntax Palette (NOT copy-pasted — see D4)

packages/ipc-contract/src/document.ts   # NEW — document.* DTOs
packages/persistence/src/migrations/v7-document-state.ts  # NEW
packages/persistence/src/document-state-repository.ts     # NEW
packages/daemon/src/document-service.ts                   # NEW — RPC registration

packages/ui/src/main/
├── electron-clipboard.ts       # NEW — ElectronClipboard (injects Electron's clipboard)
├── clipboard-service.ts        # NEW — app-global mode record + paste-mode decision
├── document-authority.ts       # NEW — THE single source of truth: canonical text, monotonic
│                               #       version, in-flight rebase (ChangeSet.map), ordered
│                               #       broadcast, derived dirty state (FR-028f, D7)
├── undo-service.ts             # NEW — document-level undo history, owned by the authority (D7)
├── editor-recovery.ts          # CHANGED — JSON snapshot + history, legacy-tolerant
├── editor-coordinator.ts       # CHANGED — drives the authority; the whole-doc-replace relay
│                               #           (006 FR-034) is REMOVED, not adapted
└── terminal-ipc.ts             # CHANGED — route its 3 clipboard calls through the seam

packages/ui/src/renderer/
├── editor/
│   ├── use-editor.ts           # CHANGED — highlighting, indent, rect-select, Prec.highest keymap
│   ├── language-loaders.ts     # NEW — id → () => import('@codemirror/lang-*')
│   ├── highlight-style.ts      # NEW — HighlightStyle over CSS vars
│   ├── status-strip.tsx        # NEW — language indicator (dims with 012's tokens)
│   ├── language-picker.tsx     # NEW — searchable
│   └── content-menu.ts         # NEW — editor content context menu
├── keybindings/scope.ts        # NEW — the single scope provider (lifted from 2 duplicated sites)
└── preferences/
    └── map-control.tsx         # NEW — the generic keyed-table control
```

**Structure Decision**: existing npm-workspaces monorepo. Pure logic (registry, detection, inference,
clipboard-mode, scope) goes in `@throng/core` and is unit-tested there; anything touching the DOM,
Electron or CodeMirror stays in `packages/ui`; the schema and RPC go in `persistence` / `ipc-contract` /
`daemon`. This keeps the Principle II boundary honest.

## Phasing

Priority-ordered by the spec's own user stories, so each phase is an independently valuable, shippable
slice. **Foundations first** — not because they are interesting, but because `cut-line` provably cannot
work without the scope resolver (F4), and the settings maps provably cannot pass the completeness test
without the metadata change (F5).

| Phase | Delivers | Stories |
|---|---|---|
| **A — Foundations** | Language registry + detection + inference (pure core, no UI); dispatch scope + scope-aware resolver + scopes for all 36 shipped commands; platform-keyed chord record; metadata `map` kind + the 4 map-blind helpers | — |
| **B — Highlighting (P1)** | Grammars, lazy loaders, `HighlightStyle` over CSS vars, 13 theme tokens × 15 themes, copy, contrast pairings, distinctness recalibration, long-line guard | **US1** |
| **C — Status strip & override (P3, pulled early)** | Status strip, language picker, `document_state` v7 migration + RPC, retire both version pins | **US5** |
| **D — Clipboard seam** | `IClipboard` + contract tests, app-global mode record, absorb the 3 unseamed calls | — |
| **E — Document authority & undo foundation** ⚠️ | **The single document authority in UI main** (canonical text, monotonic version, in-flight rebase, derived dirty state), document-level undo owned by it, **re-wire the undo trigger**, re-base 013's replace-all | **FR-028f**, FR-026 |
| **F — Editing essentials (P2)** | Content menu, `cut-line`, indent/outdent, indentation settings + keyed-table control | **US2, US3, US4** |
| **G — Column selection (P3)** | Rectangular selection, 4 commands, per-row semantics, column paste + padding | **US6** |
| **H — Crash recovery** | Structured recovery snapshot, persisted history, persist toggle | FR-027 |
| **I — Docs & convergence** | README / CONTRIBUTING / ROADMAP currency; `/speckit-converge` | — |

**C is pulled ahead** of the editing work because the status strip is the *only* way to observe US1's result,
and the override is what makes an undetectable file usable.

**⚠ E precedes F and G deliberately, and this is the plan's one non-obvious ordering.** Every command in F and
G asserts *"one command = one Undo"* (FR-026/SC-012) — including `indent-lines`/`outdent-lines`. If those
assertions are made against CodeMirror's **local `history()`**, the undo phase later **deletes it**, and every
one of those green bars becomes meaningless: the work would be done, invalidated, and redone. Build the
mechanism first, assert against it once. (An earlier draft ordered undo last and carried a "re-verify
afterwards" task; that was having it both ways, and it is gone.)

**A second, identical hazard sits alongside it**: the **focus guard** (FR-017f) must land before `Tab` is bound
to `indent-lines`, or `Tab` indents the document while 013's find bar has focus. It rides with E.

**Phase mapping — `plan.md` (letters) → `tasks.md` (numbers)**, since the two group differently:

| Plan | Tasks |
|---|---|
| A — Foundations | Phases 1–2 (T001–T019, T103–T105, T114) |
| B — Highlighting | Phase 3 (T020–T033, T108, T122) |
| C — Status strip & override | Phase 4 (T034–T046, T107, T119–T121, T123) |
| D — Clipboard seam | Phase 5 (T047–T056) |
| **E — Document authority + undo foundation + focus scoping** | **Phases 5b + 5c** (T084–T086, **T124–T126**, T116–T117; T093–T094, T109) |
| F — Editing essentials | Phases 6, 7, 8 (T057–T076, T106, T113) |
| G — Column selection | Phase 9 (T077–T083, T115) |
| H — Crash recovery | Phase 10 (T087–T092, T111–T112) |
| I — Docs & convergence | Phase 11 (T095–T102, T110) |

## Complexity Tracking

Deviations and accepted costs, each with the simpler alternative that was rejected and why.

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| **Dispatch scope on the shared keybinding model** (touches all 36 commands) | `resolveAction` returns the **first** match in map order and `file.*` precedes `editor.*`, so `Ctrl+X` resolves to `file.cut` **inside an editor** and `cut-line` would never fire. Confirmed in source (F4). | *Move `cut-line` to a free chord*: sacrifices the feature's headline binding to a test's convenience, contradicting FR-017a/US3. *A flat uniqueness rule*: forbids context-scoped chords the app **already** relies on (Ctrl+C copies a file in the Explorer and is SIGINT in a terminal). |
| **New `map` control type in 007's Settings editor** | Two settings are keyed maps; **no** existing control renders one, and the constitution forbids JSON-only configuration. | *Two bespoke panels*: more code, and they bypass the metadata registry the completeness test depends on. *Flatten to ~93 per-language descriptors*: unusable. |
| **SQLite migration + new daemon RPC** (reverses 006's "no editor migration") | The override is **document** state and must be found by a panel opening the file **later** (FR-028b). | *Ride `workspace_layout.layout_json`*: needs no migration and no RPC — and that cheapness is its **only** argument. A schemaless blob gives it no key, no foreign key, no pruning, and no protection from a layout rebuild, while inviting every future per-file value in. Retiring 006's guard is an **explicit, reviewed** change, not a quiet deletion. |
| **A single document authority in UI main** — canonical text + **monotonic version** + **in-flight rebase** (FR-028f, D7) | Constitution **XI (v3.15.0)** tests **authority, not mechanism**: one owner, one ordered change stream, **no two originals**. Today mirrored views are **two `EditorView`s, each its own source of truth**, reconciled by **whole-document replace** — peer-to-peer reconciliation, forbidden by name. Merely swapping that relay for a `ChangeSet` relay is **worse**, not better: a change that was **in flight** against a since-superseded version lands **at the position it originally named**, silently corrupting text, where whole-doc replace was at least internally consistent. The rebase is what closes that. | *Reject-stale-and-resync*: safe, but the view has **already shown the user their keystroke**, so rejecting means **visibly reverting input the user watched themselves type**. *An edit lock (only the focused view dispatches)*: does **not** close the race (focus can change while a change is in flight) and forbids programmatic edits from an unfocused view, **breaking 013's replace-all**. *Accept the race*: ships precisely the corruption XI was amended to forbid. *Operational transforms*: genuinely rejected — but that rejection is about **undo** (rebasing a **divergent history**, needing consensus). This is strictly smaller: **one** history, **one** authority, and the only thing rebased is an in-flight change against changes **already ordered** — one `ChangeSet.map()`, not a protocol. |
| **Document-level undo owned by that authority** (D7) | CM6's `history()` is **per `EditorView`**, so mirrored views have **separate undo stacks today** — FR-026c is violated in the shipped code, and a per-view stack **cannot** be made correct (FR-026e). | *Per-view history*: undo in view B cannot revert view A's edit. *Keep `history()` and mark remote changes*: view B's stack still cannot describe view A's edit. |
| **10 syntax tokens × 15 themes, per-theme palettes** | A copy-pasted palette **provably fails the build**: identical tokens contribute ΔE00 = 0, dragging the distinctness mean to `4.469 × 33/43 ≈ 3.43 < 4.3`. | *One built-in theme-aware highlight style*: **unachievable** — no single palette is legible on both Matrix (green-on-black) and Light (dark-on-white). |
| **Fixed bounds, deliberately NOT settings** — 500 undo entries (FR-026d), 10,000-char long-line guard (FR-008a), **1 MiB persisted-history cap** (FR-027a, named during analysis — it had been left unstated) | Exposing any of them would require a descriptor, Settings-editor exposure and completeness coverage (FR-022) for a knob with no real user value. The 1 MiB cap is sized against the **400 ms debounced** snapshot write: large enough for any realistic session's history, small enough that serialising it cannot stall the write recovery depends on. | Recorded as a **deliberate** Principle X exception (the rule targets *magic values scattered through business logic*; these are three named constants with a stated rationale and a single definition site). |
| **`Tab` / `Shift+Tab` removed from `EXCLUDED_KEYS`** | The spec makes `Tab` `indent-lines`' default **and** requires all seven commands rebindable — impossible while the capture modal rejects `Tab` (F1). | *A different default for `indent-lines`*: every code editor uses Tab; the constraint exists for focus-traversal, which FR-017f's focus scoping already preserves. |

### Deferred (tracked, not dropped)

| Deferred | Tracked as |
|---|---|
| IntelliSense, Go to Definition, Find References, Symbol Rename | **#9** (this is Part 1) |
| ~~Making "one document, one state" a constitutional constraint (FR-028d)~~ | ✅ **DONE 2026-07-13 — no longer deferred.** Constitution **v3.15.0** adds it to **Principle XI**, closing **#68**. It is now a live gate this feature is measured against (see the Constitution Check row for XI), not a follow-up it promises. Doing it *changed the feature*: XI's "one authority, not two peers" clause is what forced **FR-028f**, which no artifact had planned for. |
| `.editorconfig` cascade | **#69** |
| Exact-filename descriptors (`Dockerfile`, `.gitignore`) — shape reserved by `filenames?` | **#70** |
| Explicit line-ending conversion | **#71** |
| Theme accessibility (WCAG gating + picker marking) | **#61** |
| Keyboard-only operation of the new controls | **#26** (app-wide pass) |

### Spec amendments this plan required — ✅ **ALL APPLIED**

> **Resolved.** These were raised by Phase 0 against the **shipped code** and have since been folded into
> the spec as **Clarifications → Session 2026-07-12 (b)**, together with the 015-merged correction. They are
> listed here only as the record of *why* the spec changed. **Do not re-apply them** — the spec is already
> correct.

1. **FR-017b/FR-019** — `Tab` is currently unbindable (F1). Resolve by removing it from `EXCLUDED_KEYS`
   under a focus guard.
2. **FR-025a/FR-017e** — the chord must be written **`Shift+Alt+Arrow`** (canonical order), not
   `Alt+Shift+Arrow`, or it never matches (F2).
3. **FR-028a** — its justifying hazard (two panels, one file, two indentation styles) is **not
   constructible**: `open-registry` focuses the existing panel. The real violation is **mirrored views with
   separate undo stacks**. Restate the hazard; the requirement stands (F8).
4. **FR-028e** — names one version guard; there are **two** (F7).
5. **FR-022a** — asserts 007's control vocabulary is "exhaustive" at six; it is already **thirteen**. The
   spec anticipates this staleness and asks that whichever feature lands second correct it.
