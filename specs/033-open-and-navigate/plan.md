# Implementation Plan: Open and navigate — Quick Open, Go To Line, and menus you can read

**Branch**: `feature/S033-I219-open-and-navigate` | **Date**: 2026-08-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/033-open-and-navigate/spec.md`

**Issues**: [#219](https://github.com/Bidthedog/throng/issues/219) (Quick Open) · [#234](https://github.com/Bidthedog/throng/issues/234) (Go To Line) · [#88](https://github.com/Bidthedog/throng/issues/88) (Open In → Terminal) · [#185](https://github.com/Bidthedog/throng/issues/185) (Expand/Collapse All Children) · [#160](https://github.com/Bidthedog/throng/issues/160) (menu section groups) · [#244](https://github.com/Bidthedog/throng/issues/244) (the menu-keyboard guard that guards nothing)

## Summary

Six issues, one question — *how do I reach the thing I want without walking there?* — delivered in five
slices, three of which are seeding work over machinery that already shipped.

**Quick Open** is the only slice that needs something genuinely new: a **project file index**. Nothing
in this repository walks a directory tree recursively today — `IFileSystem.list()` is single-level and
every consumer of it reads one directory at a time. The index is therefore the largest decision in the
feature, and it is settled in [research.md R1](./research.md): it is **owned by the Electron main
process**, built over the existing `IFileSystem` abstraction, and pushed to a subscribing renderer as a
snapshot plus deltas. Everything above it is reuse — `packages/ui/src/renderer/common/picker.tsx` gains
an optional ranking hook, a row cap and a header slot, none of which the tab picker passes, so 031's
"the picker does not rank" rule holds for every caller that does not opt in.

**Go To Line** is a small modal over `getEditorView(panelId)`; the number the user types is the number
`doc.line(n)` and `lineNumbers()` agree on, so gutter accuracy is structural rather than arranged.

**Open In → Terminal** is a third submenu level under an item that already nests to arbitrary depth,
seeded from the one flavour catalogue (`useFlavours()`), launching through the sequence
`createDedicatedEditor` uses and the containment rule `resolveStartDirectory` already enforces.

**Expand / Collapse All Children** are two pure target functions beside `nextExpandTargets`, driven
through the same `ensureLoaded` → `api.open` → `persist` path a chevron click uses.

**The menu sections** are the reason the delivery order is not the priority order. FR-049 —
*a menu item with no section is a defect, not a default* — is implemented by making `section` a
**required** field on the menu-item type, so `tsc` refuses an item that does not declare one. Two of the
other stories add menu items, and neither can compile before the vocabulary exists. So US5's machinery
lands third, ahead of US3 and US4.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), ES modules, Node 24 toolchain

**Primary Dependencies**: Electron 43, React 19, CodeMirror 6, `picomatch` (existing, for the exclude
globs), InversifyJS, Vitest 4, Playwright-Electron. **No new runtime dependency** — the tree walk uses
the `IFileSystem` seam already in place, and the watch uses the `IFileWatcher` seam behind
`node:fs.watch({ recursive: true })`

**Storage**: Nothing new is persisted. Explorer open-state continues to live in `localStorage` under
`throng.explorer.tree.<projectId>`; the two new settings live in `settings.json` via `FileConfigStore`;
the file index is an in-memory cache of the filesystem in UI-main and a remembered modal value is
per-window session state (FR-062)

**Testing**: Vitest projects `unit` / `integration` / `contract` (root `vitest.config.ts`, globs
`packages/**/tests/<tier>/**/*.test.ts`); Playwright-Electron for E2E, two tiers locally and three
planned shards on CI. There is **no component-test tier** — the `unit` project runs
`environment: 'node'`, so nothing renders React. Every renderer behaviour is proved at E2E, and every
piece of logic worth a fast test is pure and lives in `@throng/core`

**Target Platform**: Windows 11 (the 1.0 platform); no OS-specific code added by this feature

**Project Type**: Desktop application — npm workspaces monorepo (`@throng/core` pure logic,
`@throng/ui` Electron main + renderer, `@throng/daemon`, `@throng/persistence`,
`@throng/platform-windows`, `@throng/ipc-contract`)

**Performance Goals**: 50,000 candidate paths filtered, ranked and capped in **under 100 ms** per
keystroke (SC-002), with **no filesystem call on the keystroke path**. The enumeration itself must not
block the UI (FR-015) — it runs in main, which is not painting. A change on disk reaches the candidate
set within **two seconds** (SC-005)

**Constraints**: The renderer never touches the filesystem — every path it holds arrived over IPC. The
candidate set is confined to exactly one project root and honours the explorer's own exclusion rules
rather than growing a second ignore mechanism (FR-005, FR-006). A find bar closes only when its user or
its editor closes it (FR-026a). No existing menu item's label, icon, action, intra-section order or
test identifier changes (FR-053)

**Scale/Scope**: 75 functional requirements, 16 success criteria, 6 user stories, 8 clarification
sessions; 5 delivery slices; ~9 new E2E spec files, all of which must be registered in
`packages/ui/tests/e2e/shard-plan.json` and — where they drive a context menu, open Preferences or
assert a wall-clock ceiling — in the `serial` list of `packages/ui/tests/e2e/parallel-plan.json`,
because `packages/ui/tests/unit/shard-plan.test.ts` fails the build otherwise

## Constitution Check

*GATE: passed before Phase 0, re-checked after Phase 1 design. Constitution **v4.7.0**.*

| Principle | Verdict | Basis |
|---|---|---|
| **I. Project-first context isolation** | PASS | The index is rooted at exactly one project root and every path in it is root-relative, so a path outside the root cannot be represented (FR-005). In a sub-workspace the root comes from the **active panel's `originProjectId`**, the rule `panel-body.tsx` already applies — never from the main window's active project (FR-017, R6) |
| **II. Platform-abstracted core** | PASS | The walk is `walkFiles(fs: IFileSystem, …)` in `packages/core/src/explorer/file-index.ts` — it names no OS and calls no `node:*` module. Matching (`compileQuery`), ranking (`rankFilePath`), the diff (`diffPaths`), the section vocabulary, the Go To Line clamp and the two subtree target functions are all pure core. The only new code that touches an OS is `packages/ui/src/main/project-file-index.ts`, which owns lifetime and wires the existing `NodeFileSystem` / `NodeFileWatcher`. Path reasoning reuses `isWithinRoot`, `joinRel`, `parentRel` and `samePath` rather than restating them |
| **III. Detached, tagged & persistent terminals** | PASS | US3 adds a new **source** for a start directory, not a new mechanism. The panel is created by the sequence `createDedicatedEditor` uses, attached over the existing `throng:terminal:attach` route, and the cwd is resolved by the shipped `resolveStartDirectory` — so containment (FR-032) and the fallback-with-a-reason (FR-034) are inherited, not re-implemented |
| **IV. Native terminal support / the keyboard** | **PASS, stated** | **`Ctrl+Shift+T`** (`navigate.quickOpen`, scope EVERYWHERE, so it *is* live in a terminal): not in the reserved tier (`Ctrl+C/D/Z/A/E/W/U/K/R/L/Q`), not in the shadowable tier (`Ctrl+B/F/N/P/H/S`), and bound by no shipped default — verified by grep over `packages/`, which returns no match for either new chord. No hosted flavour's **line editor** claims it: readline and PSReadLine read control characters, in which `Ctrl+Shift+T` and `Ctrl+T` are indistinguishable at the wire, and neither binds `Ctrl+T` in a way this displaces; `Ctrl+Shift+T` is a terminal **emulator** convention ("reopen tab"), and throng is the emulator. **No recorded exception is added and the v4.4.0 list is unchanged.** **`Ctrl+G`** (`navigate.gotoLine`) is **EDITOR_ONLY**, so it is never live in a terminal and the tier rule does not reach it — which is the honest defence, because readline *does* bind `Ctrl+G` to `abort`. FR-025 and SC-007 assert the terminal still receives `^G` |
| **V. Test-first quality (NON-NEGOTIABLE)** | PASS | Every slice is Red→Green→Refactor. Every user-visible behaviour ships E2E coverage; every new spec is registered in both plans (see Scale/Scope). #244 is closed two ways: the vacuous predicate at `menu-keyboard.e2e.ts:91` is replaced with the corrected form already in use at `menu-keyboard.e2e.ts:127` and `notice-stacking.e2e.ts:36-87`, and a new source-scanning unit test fails the build if the shape reappears anywhere in `tests/e2e/` (FR-053a). FR-053b's "demonstrated to fail" is a recorded mutation run, because a test asserting that another test fails cannot live in the suite — see [quickstart.md](./quickstart.md) |
| **VI. Simple, modern, discoverable UX** | **PASS, with two spec-internal tensions recorded** | *Every panel action has a menu item*: Go To Line acts on a panel's content and gets one (FR-027); Quick Open is window-level, so the rule does not reach it, and it gets a toolbar button anyway (FR-018a). *One section vocabulary*: implemented structurally — `section` is a **required** field, so an undeclared item is a compile error rather than a convention (FR-049). *Disabled when unavailable, absent when meaningless*: applied per control against the "would any future state enable it?" test — no project is temporary, so the toolbar button and the Terminal submenu are drawn and disabled (FR-018c, FR-035); a file can never acquire children, so the two subtree items are not drawn (FR-038). **The contradiction**: FR-052 requires the cog menu's three preferences destinations to be "separated from the diagnostic and About items", while FR-047 and the constitution place all five in one **Application** section and FR-050 forbids a divider anywhere but a section boundary. Recorded in Complexity Tracking; the constitution wins pending a spec amendment. **The second tension** is FR-052's Destroy placement, resolved by reading its third column as an inventory rather than an ordering — also in Complexity Tracking |
| **VII. Change review & approval** | PASS | Draft PR on this branch; adversarial review before it leaves draft |
| **VIII. SOLID / DRY / YAGNI** | **PASS — and it removes duplication** | One picker, extended rather than forked (FR-004). One flavour catalogue, read through the shipped `useFlavours()` (FR-030). One exclusion rule — `isExcluded` becomes a wrapper over a new `compileExcluder`, so the glob set is compiled once per walk instead of once per file (R4). One section vocabulary in core, consumed by all seven menu builders. `resolveStartDirectory` gains a caller, not a sibling. **Cost**: a second recursive watch on a root the explorer already watches — recorded in Complexity Tracking |
| **IX. DI & composition root** | PASS | `ProjectFileIndexService` receives `IFileSystem`, `IFileWatcher`, a settings reader and its tuning options by **constructor**, and is constructed only in `packages/ui/src/main/main.ts` beside `FilesService` — the UI-main boundary's single composition root. Nothing new is `new`-ed inside a component; the renderer reaches the index through the preload bridge, as it reaches every other main-process service |
| **X. Externalised configuration** | PASS | Two new settings, both with `FieldDescriptor`s, both shipping **off** (FR-058). The 200-row cap and the index's reconcile timings are **named constants in core** and **injected constructor options** respectively, never literals inside business logic — the pattern `NodeFileWatcher`'s `debounceMs` / `maxWaitMs` / `STORM_CHECK_EVERY` already establishes. Making them user settings was rejected as scope the spec did not authorise (R11) |
| **XI. Dockable workspace: panes, tabs & panels** | PASS | *One document, one state* is untouched and inherited: Quick Open opens through `openFileInTab` / `openFileInNewEditor`, so `window.throng.editor.openInto()` and the `OpenDocRegistry` authority decide focus-vs-open exactly as a tree click does (FR-008, SC-004). The remembered query is per-window view state, never persisted and never crossing a process boundary (FR-062) |
| **Configuration-editor completeness** (governance) | PASS | Both settings and both key bindings get descriptors; `settings-metadata.test.ts` and `keybindings-metadata.test.ts` enforce it. SC-014 additionally asserts each setting in **both** states, because a rendered setting nothing reads is the defect #108 exists to catch |
| **Themeable icon controls** (governance) | PASS | One new icon token, `quickOpen`, added to `THRONG_THEME.icons`, `THEME_TOKEN_COPY` and the icon-pack SVG set; the toolbar button is drawn with `<Icon token="quickOpen" />` and carries a hover title naming the action **and its current chord** (FR-018a, FR-018b). `icon-tokens-exist.test.ts` and `icon-call-sites.test.ts` are the gates |
| **Digit grouping** (governance) | N/A, stated | No numeric preference control is added — both new settings are toggles. Go To Line's input is a modal field, not a preference editor, and carries no grouping |
| **Static analysis & linting** (governance) | PASS | Lint and typecheck are gates on every commit here; making `section` required means `tsc` is also the FR-049 gate |
| **Documentation currency** (governance) | PASS | `docs/quick-start.md` gains both chords in its shortcut table (~L311), both explorer actions, and the two new preferences; `README.md` is checked against its finite-state claim; `docs/testing.md` needs no change |

**No violation committed. Two spec-internal tensions and four deferrals are recorded in Complexity
Tracking — one of them, the cog menu, is a requirement that cannot be satisfied as written and needs a
spec amendment before US5 can be marked done.**

## Project Structure

### Documentation (this feature)

```text
specs/033-open-and-navigate/
├── spec.md                     # 75 FRs, 16 SCs, 8 clarification sessions
├── checklists/
│   └── requirements.md         # 16/16
├── plan.md                     # this file
├── research.md                 # Phase 0 — R1..R12
├── data-model.md               # Phase 1
├── contracts/
│   ├── file-index.md           # enumeration, ownership, delta protocol, IPC
│   ├── picker-extensions.md    # the four new props and what they must not change
│   ├── menu-sections.md        # the vocabulary, and every menu's item-by-item adjudication
│   ├── navigation-modals.md    # Quick Open, Go To Line, the one-modal slot, remembering
│   └── explorer-actions.md     # Open In → Terminal, and the two subtree actions
├── quickstart.md               # Phase 1 — how to prove it works
└── tasks.md                    # /speckit-tasks output — NOT created here
```

### Source code

```text
packages/core/src/
├── explorer/
│   ├── exclude.ts              # + compileExcluder(globs); isExcluded becomes its wrapper (R4)
│   ├── file-index.ts           # NEW — walkFiles(fs, root, exclude, signal), diffPaths() (FR-005/006/013)
│   ├── subtree.ts              # NEW — descendantOpenFolders(), immediateChildFolders() (FR-039..FR-044)
│   └── index.ts                # barrel additions
├── picker/
│   ├── match.ts                # + compileQuery(); matches/matchSpans become wrappers (R3)
│   └── rank.ts                 # NEW — rankFilePath(), rankStable() (FR-007a, FR-007b)
├── editor/
│   └── goto-line.ts            # NEW — resolveGotoLine(raw, lineCount) (FR-021..FR-023)
├── workspace/
│   └── menu-sections.ts        # NEW — MenuSection, MENU_SECTION_ORDER, groupBySection() (FR-047..FR-050)
└── config/
    ├── app-settings.ts         # + editor.navigation.{rememberQuickOpenQuery,rememberGotoLineNumber}
    ├── settings-metadata.ts    # + 2 descriptors in a new "Editor · Navigation" group (FR-059)
    ├── keybindings.ts          # + navigate.quickOpen (EVERYWHERE, Ctrl+Shift+T), navigate.gotoLine (EDITOR_ONLY, Ctrl+G)
    ├── keybindings-metadata.ts # + 2 chord descriptors in a new "Navigate" group (FR-064)
    ├── theme.ts                # + icons.quickOpen token (FR-018b)
    └── theme-copy.ts           # + its label/description

packages/ui/src/main/
├── project-file-index.ts       # NEW — the index service: walk, watch, rescan, reconcile, delta (R1, R5)
├── file-index-ipc.ts           # NEW — throng:fileIndex:{subscribe,unsubscribe,update} (R7)
└── main.ts                     # wiring only, beside FilesService / ExplorerWatcher

packages/ui/src/preload/
└── preload.cts                 # + the fileIndex bridge (subscribe / unsubscribe / onUpdate)

packages/ui/src/renderer/
├── navigate/                   # NEW folder, mirroring search/ — the Navigate namespace
│   ├── navigation-chrome.tsx   #   mounts both modals; added to BOTH composition roots
│   ├── navigation-store.ts     #   the one-modal slot + the two remembered values (FR-057..FR-063, FR-066)
│   ├── quick-open.tsx          #   seeds the picker from the index; routes the choice (FR-001..FR-018c)
│   ├── quick-open-target.tsx   #   the two-option control above the input (FR-010..FR-010b)
│   ├── goto-line.tsx           #   the modal (FR-019..FR-028)
│   └── use-file-index.ts       #   subscribes to this window's root
├── common/
│   └── picker.tsx              # + rank / maxRows / truncatedMessage / header / initialQuery (R2)
├── workspace/
│   ├── context-menu.tsx        # MenuAction gains a REQUIRED section; dividers become derived (FR-048..FR-051)
│   ├── tab-group.tsx           # tab menu items declare sections
│   └── panel-placeholder.tsx   # panel header menu items declare sections
├── explorer/
│   ├── context-menu-items.ts   # sections declared; hand-pushed separators removed
│   ├── file-tree.tsx           # Open In → Terminal (FR-029..FR-036); the two subtree items (FR-038)
│   ├── use-explorer-data.ts    # + expandChildren(relPath), collapseChildren(relPath) (FR-039..FR-045)
│   └── toolbar.tsx             # + the Quick Open button (FR-018a..FR-018c)
├── editor/
│   └── content-menu.ts         # + Go To Line in a Navigate section (FR-027)
├── terminal/
│   └── terminal-panel.tsx      # sections declared; hand-pushed separators removed
└── title-bar/
    └── cog-menu.tsx            # sections declared (see Complexity Tracking)

packages/ui/tests/
├── unit/
│   ├── focus-guards.test.ts    # NEW — fails on the #244 predicate shape anywhere in tests/e2e (FR-053a)
│   └── menu-sections.test.ts   # NEW — every builder's output is section-complete and divider-correct
├── integration/
│   └── project-file-index.integration.test.ts   # NEW — the main service over a real temp tree + watcher
└── e2e/
    ├── quick-open*.e2e.ts, goto-line.e2e.ts, open-in-terminal.e2e.ts,
    ├── subtree-expand-collapse.e2e.ts, menu-sections.e2e.ts, navigation-modals.e2e.ts
    └── shard-plan.json, parallel-plan.json      # EVERY new spec registered in both, per its tier
```

**Structure Decision**: The monorepo split is kept and leaned on harder than usual, because the one
thing this feature adds that the repository has never had — a recursive walk — is also the thing most at
risk of becoming untestable. Expressing it as `walkFiles(fs: IFileSystem, …)` puts it in
`@throng/core` with a fake filesystem in the unit tier, and leaves the main process holding only
lifetime, scheduling and IPC. The same split decides everything else: the ranking, the diff, the line
clamp, the subtree targets and the section vocabulary are pure and fast; the renderer holds what
genuinely needs a DOM. This is what keeps the E2E layer for behaviour rather than for arithmetic —
which matters here, because the E2E layer is the only place a React component can be tested at all.

## Delivery order

The stories are dependency-ordered rather than priority-ordered, and the reason is stated rather than
implied: **US5's machinery must precede US3 and US4**, because FR-049 is implemented by making a menu
item's section a required field, and neither of those stories' new items can compile until the
vocabulary exists. Each slice remains independently shippable.

1. **US1 — Quick Open** (P1). The index, the picker's four new props, the chord, the toolbar button.
   Touches no menu, so it is genuinely first.
2. **US2 — Go To Line** (P2), minus its content-menu item, which needs the vocabulary. Ships the modal,
   the chord, the pure clamp and the find-bar rule.
3. **US5 — menu sections** (P5, delivered third). The `section` field, the derived dividers, all seven
   builders reordered, and Go To Line's menu item lands here as the first item written under the new
   rule. The #244 guard is fixed in this slice, because it is the slice that restructures the menus its
   tests drive.
4. **US3 — Open In → Terminal** (P3). Three-level submenu, flavour seeding, panel creation, focus.
5. **US4 — Expand / Collapse All Children** (P4). Two pure target functions and two menu items.

## Complexity Tracking

| Item | Why it is here | What was rejected, and why |
|---|---|---|
| **FR-052's cog-menu row contradicts FR-047, FR-050 and Principle VI** | FR-052 requires the cog menu's three preferences destinations to be separated from Open Logs Folder and About. All five are **Application** items in the constitution's own table, which FR-047 reproduces verbatim, and FR-050 forbids a divider anywhere but a section boundary. The requirement cannot be met without either a divider inside a section or a section that does not exist. **The plan implements the constitution**: the cog menu carries five Application items and **no divider**, and the contradiction is raised for `/speckit-analyze` or a spec amendment before US5 is marked done | *Reading Open Logs Folder as **Navigate*** (it reveals a folder, like Reveal) would satisfy the divider but reorder the menu so logs came **first** and About sat with Settings — the opposite of what AS-5 describes. *A new "Diagnostics" section* is a constitutional amendment this feature has no mandate to make |
| **FR-052 puts Destroy last for two menus; FR-047 fixes it third** | FR-052's third column reads "Content / Navigate / View & state / Destroy" for the panel header and "Content / Navigate / Destroy" for the tab menu. FR-047 says the order is fixed and puts **Destroy third**, ahead of Navigate and View & state, as does the constitution. **The plan reads FR-052's third column as an inventory of which sections a menu contains, not an ordering** — the reading that survives, because FR-047 says "fixed", because the constitution agrees with it, and because the Files & Folders menu that Assumption 7 names as the vocabulary's *source* already ships Delete before Open In. AS-3 and AS-4 ask only that destructive items be separated, which says nothing about position | *Ordering by FR-052 instead* — it would make the one menu the vocabulary was derived from the only menu that violates it, and would put two different Destroy positions in one release |
| **A second recursive watch on the active project's root** | The index takes its own `IFileWatcher.watch(root)` rather than sharing `ExplorerWatcher`'s. It must, because the index serves roots the explorer does not watch (FR-017) and because `ExplorerWatcher` is single-root and its debounce/storm behaviour was hard-won by 026/#186. **Deferral**: consolidating both consumers onto one multi-root watch is owed to a tracked issue, to be filed before this branch merges | *Refactoring `ExplorerWatcher` into a registry now* — a change to shipped live-sync behaviour, inside a feature that already touches every menu in the app |
| **`FilesService` and `ExplorerWatcher` stay single-root** | Both hold one process-wide root set by whichever renderer last sent `throng:files:setRoot`. The index is keyed by root instead, so FR-017 is met without touching them. **Deferral**: a sub-workspace whose panels belong to a project other than the active one still reads the wrong root for ordinary `files.*` calls — a pre-existing defect this feature neither creates nor fixes; owed to a tracked issue | *Fixing it here.* It is not in this feature's scope and would put a second window's file operations at risk in a release that is already five issues wide |
| **SC-011 cannot hold literally** | "The existing menu-driving end-to-end specs pass unmodified" is true of the grouping pass but not of the feature: `context-menu-sections.e2e.ts:49` asserts the folder's Open In submenu holds **exactly one** item, and US3 adds Terminal to it by design. That assertion is updated. No label, icon, action, intra-section order or test identifier changes, so **FR-053 holds in full** | Nothing — this is a defect in SC-011's wording, recorded so the change is not mistaken for a regression |
| **SC-002's 50,000-file budget is measured at the unit layer** | Creating 50,000 real files, walking them and launching Electron around them costs minutes per run and would be a wall-clock assertion under exactly the contention `failOnFlakyTests` punishes. The 100 ms is spent in `compileQuery` → filter → rank → cap, all pure, so it is measured there over a synthetic 50,000-path corpus. The E2E asserts the *architectural* half — that typing issues **no** `throng:files:*` call — plus an in-page latency measurement on a realistic project, in the style of `editor-highlight-perf.e2e.ts` | *A 50k-file E2E fixture* — minutes of setup per run for a number the pure layer measures more precisely. *Trusting the unit test alone* — it would not catch a keystroke that reached the filesystem, which is the half of FR-013 that actually bites |
