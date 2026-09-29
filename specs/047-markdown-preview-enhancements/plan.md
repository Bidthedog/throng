# Implementation Plan: Markdown Preview Enhancements

**Branch**: `feature/S047-markdown-preview-enhancements` | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/047-markdown-preview-enhancements/spec.md` (7 user
stories, ~70 FRs, one clarification session of 11 answers). Refs #405, #428, #420, #413, #424, #432.

## Summary

Seven reading capabilities on 044's Markdown preview, built on three shared pieces:

- **One heading model.** The pipeline already slugs every heading; it now also returns them as a
  `DocumentSymbol` list (core shape, #375-ready). The editor derives the same list from the Lezer tree
  with the **same** slug function, so a heading has one identity on both sides (R2).
- **One fold state per document**, a pure core reducer (`{base, flipped}`) held in main beside word
  wrap and relayed to every view — editor and parented preview alike — so linked folding is one
  authority, not two synchronised copies (R3, Principle XI). Editor folding is CodeMirror
  `codeFolding` with a heading-only gutter (R4); preview folding hides top-level blocks and draws
  arrows in a soft gutter that shifts the document right (R6).
- **One chord engine.** The two-stroke state machine is lifted out of the CodeMirror plugin so the
  preview can dispatch `Ctrl+M,x` too (R5).

On those: find reuses the find bar through a third search controller, painting with the CSS Custom
Highlight API (R1); Go to Heading is a pop-down over the preview (R7); Last Active reuse extends
`PreviewService.open`'s standalone branch with a renderer-chosen candidate from the visible tab (R8);
drops reuse the editor's drop components and confinement (R9); wikilinks are a markdown-it inline rule
resolved as paths by main (R12); tables get a water-filling width pass and drag handles (R13).

## Technical Context

**Language/Version**: TypeScript (repo toolchain: TS 7 / TS 6 alias, ES2022), Node 24, Electron 44

**Primary Dependencies**: React 18, CodeMirror 6 (`@codemirror/language` ^6.12.4 and
`@codemirror/lang-markdown` 6.5.2 — both already direct/installed), markdown-it ^15, DOMPurify ^3,
InversifyJS, Vitest, Playwright. **No new runtime dependency.** The CSS Custom Highlight API is a
Chromium platform feature.

**Storage**: Settings only — four new leaves in the settings document (data-model *Settings*). No
layout, history or SQLite change; fold state and hand-set column widths are deliberately
session-only. `SHIPPED_DEFAULTS_VERSION` 16 → 17 for four icon tokens.

**Testing**: unit (node), component (jsdom, `tests/component/helpers/mount-preview-panel.ts`),
integration (`tests/integration/helpers/preview-harness.ts`), contract
(`tests/contract/preview-ipc.contract.test.ts`). **No new E2E**; the budget is unchanged (R14).

**Target Platform**: Windows 11 desktop (Electron); nothing forecloses macOS/Linux.

**Project Type**: Desktop application, npm-workspaces monorepo (renderer, Electron main, daemon).

**Performance Goals**: SC-003 — a fold change reaches the other view within the preview update delay
(300 ms default); fold relay is one IPC message with a sorted slug list. Find over a 900-line spec
recomputes in one frame (the core matcher over one text string). The table pass measures each table
once per render and on resize, debounced to an animation frame.

**Constraints**: Untrusted content — throng-created elements (fold toggles, table handles) are
inserted **after** the sanitiser and never derive from document markup; wiki resolution is decided in
main against the run's own project root (Principle I). No per-panel copy of document fold state
(Principle XI).

**Scale/Scope**: Touches `packages/core` and `packages/ui` (renderer + main + preload). `daemon`,
`persistence`, `ipc-contract` and `platform-windows` are untouched.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1.*

| Principle | Assessment |
|---|---|
| **I. Project-First Context Isolation** | **Engaged, satisfied.** Last Active reuse never crosses a tab, window, project or sub-workspace (FR-015). Wiki targets resolve in main from `Panel.originProjectId`, never a renderer-supplied root; a rooted wikilink in a sub-workspace is unresolved (FR-052b). Drops reuse `resolveDrop`'s confinement unchanged (FR-022). |
| **II. Platform-Abstracted Core** | **Engaged, satisfied.** Fold reducer, symbol tree, fair widths, wiki parsing/candidates and scope sets are pure core. The only filesystem touch (wiki candidate `stat`) is in UI main through the existing `EditorService` read path. |
| **III. Detached, Tagged & Persistent Terminals** | **Not engaged.** |
| **IV. Native Terminal Support & Auto-Detection** | **Engaged, cleared.** `Ctrl+M` is a carriage return to a shell, but every new chord is scoped to editor/preview, never `terminal`, so `twoStrokeTerminalViolations` and `terminal-reserved-keys.test.ts` pass; 046 FR-021 passes by scope (the `Ctrl+G` precedent). |
| **V. Test-First (NON-NEGOTIABLE)** | **Engaged, satisfied.** Every task is test-first at the lowest layer (R14 table). No E2E is added; the budget does not rise. Three existing tests change *because the behaviour they pin changes by supersession*: `scope.test.ts:161-205` and `preview-read-only.test.ts:153-166` (find now live in a preview, FR-004), and the tier test's two-stroke exemption (R5). |
| **VI. Simple, Modern, Discoverable UX** | **Engaged; see the rules table.** |
| **VII. Change Review & Approval** | **Not engaged.** Nothing writes a file (SC-007). |
| **VIII. SOLID, DRY & YAGNI** | **Engaged, and it decided three shapes.** DRY: one heading model (R2), one chord engine (R5), one find bar (R1), one drop machinery (R9), one link path for wikilinks (R12). YAGNI: no fold persistence, no outline strip, no keyboard column resize — each explicitly out of scope. The gutter is a generic slot because the maintainer named a future use (FR-032a). |
| **IX. DI & Composition Root** | **Engaged lightly.** No new service. Fold state joins `EditorCoordinator` (already constructed in `main.ts`); wiki resolution joins `PreviewService`. Both keep constructor-injected collaborators. |
| **X. Externalised Configuration** | **Engaged.** Open target, gutter, heading-jump duration and sections-open are settings with descriptors. Two layout constants are *not* settings and are recorded in Complexity Tracking: the pop-down height and the `8ch` minimum column width. The 500-target and 2,000-slug bounds are security limits, not tunables (044's 1 KiB view-state precedent). |
| **XI. Dockable Workspace** | **Engaged — the high-risk row.** The workflow gate fires: a document presented in more than one panel gains new view state. Fold state is **one entry per document in main**, relayed, never copied per panel (R3). A standalone preview's state is one `panel:<id>` entry in the same map, so a panel viewed from two windows still has one original. The per-history-entry fold snapshot is per-panel navigation state (like scroll position), held in `PreviewService`, and overridden by the document's state whenever the preview is parented (FR-041d). |

### Principle VI — its named rules

| Rule | Assessment |
|---|---|
| **Every panel action has a menu item** | Satisfied. Find and Go to Heading are on the body and header menus; fold commands are on the body menus of both views; the status-bar toggle and gutter markers are accelerators over those items. Open In gains Last/New Preview Panel. |
| **One section vocabulary** | Satisfied — [contracts/menus-commands-controls.md](./contracts/menus-commands-controls.md). |
| **Disabled when unavailable, absent when meaningless** | Section items absent before the first heading and in non-Markdown editors; Collapse/Expand All disabled with no headings; Last Preview Panel disabled with no preview in the visible tab. |
| **Themeable icon controls (NON-NEGOTIABLE)** | Gutter markers, preview arrows and the status-bar toggle are theme icon tokens with hover titles; four new tokens (R10). Table resize handles are not action controls (a drag affordance, like a splitter) and are drawn from `border`/`accent`. |

### Development Workflow & Quality Gates

| Gate | Assessment |
|---|---|
| **Incremental delivery** | Not engaged — no constitutional capability is deferred. #375's other languages remain their own issue; this feature builds the fold machinery it will extend (FR-041c). |
| **Static analysis & linting** | Standing gate; `npm run gate` on the hosted runner is the evidence. |
| **Particular-scrutiny review** | Engaged: a document presented in more than one panel (XI above). |
| **Documentation currency** | Engaged. `docs/key-bindings.md` (seven actions), `docs/preferences.md` (four settings), `docs/quick-start.md` (preview reading: find, outline, folding), `README.md` (one Highlights line for Markdown reading), `CHANGELOG.md` (unreleased). `docs-currency.test.ts` enforces the first two. |
| **Configuration-editor completeness** | Engaged: four settings, seven actions, four icon tokens, each with one descriptor; `settings-metadata-040.test.ts` allow-list unchanged (no new subgroup); new `settings-inertness-047.test.ts`. |
| **Displayed quantities digit-grouped** | **Engaged — closes a listed gap.** The find bar's `N of M` gains a new surface (the preview), so it is grouped through the shared formatter now (constitution's known-gaps list, first entry). The heading-jump duration is a settings number field, already grouped by the editor's paired formatter/parser. |

**Result: PASS**, with two Principle X layout constants recorded below.

### Re-evaluation after Phase 1

Re-checked against research, data model and contracts. Two findings refined the design, neither
changed the verdict:

- **XI** put the standalone-preview fold state and the history snapshot **in main**: kept in
  `Panel.config` Sync to's shallow clone would fork them, and kept in renderer panel state each window
  viewing the panel would hold its own original. The standalone state is the fold map's `panel:<id>`
  entry; the snapshot is `PreviewService`'s, never persisted. The document's state always wins while
  parented. *(Analyze pass 1, C1.)*
- **VI** placed the editor fold markers inside the existing line-number gutter's visibility
  (`editor.showGutter`): a second, independently toggled gutter strip would be a new setting no
  requirement asks for. Folding stays reachable by chord and menu when the gutter is hidden. *[derived]*

## Project Structure

### Documentation (this feature)

```text
specs/047-markdown-preview-enhancements/
├── spec.md
├── plan.md
├── research.md          # R1–R14
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── preview-ipc-047.md
│   └── menus-commands-controls.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code

```text
packages/core/src/
├── outline/document-symbol.ts        # NEW  DocumentSymbol, HeadingRecord, buildSymbolTree
├── outline/fold-state.ts             # NEW  FoldState reducer
├── preview/wiki-links.ts             # NEW  parseWikilink, wikiCandidates
├── preview/table-widths.ts           # NEW  fairColumnWidths
├── preview/links.ts                  # classifyPreviewLink: wiki case
├── preview/wire-types.ts             # open target, navigated answer, open/drop intents
├── preview/providers/markdown.ts     # gutter, headingJumpMs leaves
├── preview/settings-types.ts, config/preview-settings.ts   # openTarget
├── config/app-settings.ts, config/settings-metadata.ts      # markdownSectionsOpen
├── config/keybindings.ts, config/keybindings-metadata.ts    # 7 actions, FIND_SURFACES, MARKDOWN_SURFACES
├── config/theme.ts, config/theme-copy.ts, config/shipped-defaults.ts  # 4 icon tokens, v17
packages/core/tests/unit/             # fold-state, document-symbol, table-widths, wiki-links, keybindings-*, settings-*

packages/ui/src/main/
├── editor-coordinator.ts, editor-ipc.ts   # fold-state map + channels (word-wrap pattern)
├── preview-service.ts, preview-ipc.ts     # open target / navigated, open+drop intents, resolveWikiTargets
packages/ui/src/preload/preload.cts, renderer/global.d.ts

packages/ui/src/renderer/
├── keybindings/chord-engine.ts            # NEW  extracted two-stroke state machine
├── editor/commands.ts, editor/use-editor.ts, editor/content-menu.ts
├── editor/markdown-fold.ts                # NEW  heading gutter, fold derivation, commands
├── editor/fold-state-store.ts             # NEW  renderer cache of document fold state (word-wrap-store pattern)
├── search/search-controller.ts, search-store.ts, search-keybindings.tsx, find-bar.tsx(.css)
├── preview/preview-search.ts              # NEW  PreviewSearchController + HighlightPainter
├── preview/heading-outline.tsx(.css)      # NEW  Go to Heading pop-down
├── preview/last-active-preview.ts         # NEW
├── preview/table-layout.ts                # NEW  measure + apply + resize handles
├── preview/preview-panel.tsx, preview-status-bar.tsx, content-menu.ts, preview-commands.tsx, open-preview.ts, copy.ts
├── preview/providers/markdown/pipeline.ts, markdown-body.tsx, markdown.css
├── preview/providers/markdown/fold-gutter.ts   # NEW  toggles + block hiding
├── preview/providers/markdown/wikilinks.ts     # NEW  markdown-it inline rule
├── editor/open-router.ts, navigate/quick-open.tsx, explorer/context-menu-items.ts, editor/open-in-*.ts
└── workspace/panel-header-menu.ts
packages/ui/tests/{unit,component,integration,contract}/

docs/key-bindings.md, docs/preferences.md, docs/quick-start.md, README.md, CHANGELOG.md
scripts/dev/table-fit-survey.mjs            # NEW, dev-only, not in the gate (SC-006a)
```

**Structure Decision**: the existing two-package layout. Pure decisions in `packages/core`; the
Electron boundary in `packages/ui/src/main`; views in `packages/ui/src/renderer`. No new package, no
new service.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **Principle X: pop-down height is a CSS constant** | FR-042b asks for a fixed height; it is layout, sized to the panel chrome, like 044's menu widths | A setting for it adds a preference nobody asked for (YAGNI) |
| **Principle X: `8ch` minimum legible column width is a constant** | FR-061 needs *a* stated minimum; it is a typographic floor, not a behaviour a user tunes | A setting would let the automatic layout be configured into the failure FR-061 forbids |
| **Editor fold markers follow `editor.showGutter`** *[derived]* | The markers live in the gutter; a separate toggle would be a fifth setting | Always drawing them would force a gutter on users who turned it off |
| **Principle X: the 40% long-word limit is a constant** (FR-073) | It is the user's chosen threshold for when a word may break, a typographic rule like `8ch` | A setting would let tables be configured back into mid-word breaks, which FR-073 forbids |

## Amendment 2026-09-29 (FR-072 – FR-079, manual-test round 2)

The maintainer's second round of manual tests (MT-01 – MT-05, MT-07) produced one defect and eight new
requirements. Research: R15 – R20.

| FR | What changes | Where | Research |
|---|---|---|---|
| FR-060/061 (defect), FR-072, FR-073 | Measure inside the table's own host; no mid-word breaks; hyphenated tokens kept whole below the 40% limit | `renderer/preview/table-layout.ts`, `providers/markdown/markdown.css` | R15 |
| FR-074 | Ordinary find matches outlined, editors and previews | `core/config/default-themes/index.ts`, `core/config/theme.ts`, `search/find-bar.css`, `preview/preview-search.ts` + a match-frame overlay | R16 |
| FR-075, FR-076 | Open In loses Preview; Last Preview Panel names its panel | `renderer/explorer/context-menu-items.ts`, `explorer/file-tree.tsx` | R17 |
| FR-077 | Empty-panel drop follows the default open action | `renderer/workspace/panel-body.tsx` | R18 |
| FR-078 | First editor adopts the preview's fold state | `main/preview-service.ts`, `main/editor-coordinator.ts` | R19 |
| FR-079 | Pop-down surface distinct from its scrollbar | `renderer/preview/heading-outline.css`, theme quality test | R20 |

### Constitution check (amendment)

| Principle | Assessment |
|---|---|
| **V. Test-First** | Satisfied: every item is test-first at the lowest layer; no E2E added, the budget does not rise. FR-074's "every shipped theme" is a `theme-quality` unit assertion; table measurement is proven in the running app by the survey (R13) plus component tests of the DOM it builds. |
| **VI. UX** | Satisfied: FR-075 removes a duplicate menu item (one route per action); FR-076 names the target, as 045's Open In names its editor. |
| **X. Configuration** | The 40% limit is a recorded constant (Complexity Tracking). `searchMatchBorder` is a derived theme token with a descriptor, like its three siblings. |
| **XI. Dockable Workspace** | Engaged by FR-078: still one fold entry per document in main. The preview's `panel:` state is copied into the absent `file:` entry once, at parenting, then dropped — never two originals. |
| All others | Not engaged by the amendment. |

**Result: PASS.**
