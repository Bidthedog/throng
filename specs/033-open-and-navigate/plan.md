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

**Scale/Scope**: 75 functional requirements, 16 success criteria, 5 user stories, 9 clarifications
in one session; 5 delivery slices; ten new E2E spec files, all of which must be registered in
`packages/ui/tests/e2e/shard-plan.json` and — where they drive a context menu, open Preferences or
assert a wall-clock ceiling — in the `serial` list of `packages/ui/tests/e2e/parallel-plan.json`,
because `packages/ui/tests/unit/shard-plan.test.ts` fails the build otherwise

> **Amended 2026-08-15 (post-delivery feedback on US1).** The spec gained a second clarifications
> session, **FR-068 – FR-075** and **SC-017 – SC-022**, taking it to **22 success criteria** and a
> **sixth delivery slice**. Four of the new requirements arrive from hand-testing the delivered US1
> and four fold in baseline `/speckit-converge` findings. The design increment they need is
> [§ Post-delivery design increment](#post-delivery-design-increment-2026-08-15) below; nothing above
> that section is withdrawn.

## Constitution Check

*GATE: passed before Phase 0, re-checked after Phase 1 design. Constitution **v4.7.0**.*

| Principle | Verdict | Basis |
|---|---|---|
| **I. Project-first context isolation** | PASS | The index is rooted at exactly one project root and every path in it is root-relative, so a path outside the root cannot be represented (FR-005). In a sub-workspace the root comes from the **active panel's `originProjectId`**, the rule `panel-body.tsx` already applies — never from the main window's active project (FR-017, R6) |
| **II. Platform-abstracted core** | PASS | The walk is `walkFiles(fs: IFileSystem, …)` in `packages/core/src/explorer/file-index.ts` — it names no OS and calls no `node:*` module. Matching (`compileQuery`), ranking (`rankFilePath`), the diff (`diffPaths`), the section vocabulary, the Go To Line clamp and the two subtree target functions are all pure core. The only new code that touches an OS is `packages/ui/src/main/project-file-index.ts`, which owns lifetime and wires the existing `NodeFileSystem` / `NodeFileWatcher`. Path reasoning reuses `isWithinRoot`, `joinRel`, `parentRel` and `samePath` rather than restating them |
| **III. Detached, tagged & persistent terminals** | PASS | US3 adds a new **source** for a start directory, not a new mechanism. The panel is created by the sequence `createDedicatedEditor` uses, attached over the existing `throng:terminal:attach` route, and the cwd is resolved by the shipped `resolveStartDirectory` — so containment (FR-032) and the fallback-with-a-reason (FR-034) are inherited, not re-implemented |
| **IV. Native terminal support / the keyboard** | **PASS, stated** | **`Ctrl+Shift+T`** (`navigate.quickOpen`, scope EVERYWHERE, so it *is* live in a terminal): not in the reserved tier (`Ctrl+C/D/Z/A/E/W/U/K/R/L/Q`), not in the shadowable tier (`Ctrl+B/F/N/P/H/S`), and bound by no shipped default — verified by grep over `packages/`, which returns no match for either new chord. No hosted flavour's **line editor** claims it: readline and PSReadLine read control characters, in which `Ctrl+Shift+T` and `Ctrl+T` are indistinguishable at the wire, and neither binds `Ctrl+T` in a way this displaces; `Ctrl+Shift+T` is a terminal **emulator** convention ("reopen tab"), and throng is the emulator. **No recorded exception is added and the v4.4.0 list is unchanged.** **`Ctrl+G`** (`navigate.gotoLine`) is **EDITOR_ONLY**, so it is never live in a terminal and the tier rule does not reach it — which is the honest defence, because readline *does* bind `Ctrl+G` to `abort`. FR-025 and SC-007 assert the terminal still receives `^G` |
| **V. Test-first quality (NON-NEGOTIABLE)** | PASS | Every slice is Red→Green→Refactor. Every user-visible behaviour ships E2E coverage; every new spec is registered in both plans (see Scale/Scope). #244 is closed two ways: the vacuous predicate at `menu-keyboard.e2e.ts:91` is replaced with the corrected form already in use at `menu-keyboard.e2e.ts:127` and `notice-stacking.e2e.ts:36-87`, and a new source-scanning unit test fails the build if the shape reappears anywhere in `tests/e2e/` (FR-053a). FR-053b's "demonstrated to fail" is a recorded mutation run, because a test asserting that another test fails cannot live in the suite — see [quickstart.md](./quickstart.md) |
| **VI. Simple, modern, discoverable UX** | **PASS, with two spec-internal tensions recorded** | *Every panel action has a menu item*: Go To Line acts on a panel's content and gets one (FR-027); Quick Open is window-level, so the rule does not reach it, and it gets a toolbar button anyway (FR-018a). *One section vocabulary*: implemented structurally — `section` is a **required** field, so an undeclared item is a compile error rather than a convention (FR-049). *Disabled when unavailable, absent when meaningless*: applied per control against the "would any future state enable it?" test — no project is temporary, so the toolbar button and the Terminal submenu are drawn and disabled (FR-018c, FR-035); a file can never acquire children, so the two subtree items are not drawn (FR-038). **The contradiction (resolved)**: FR-052 *used to require* the cog menu's three preferences destinations to be split from the diagnostic and About items, while FR-047 and the constitution place all five in one **Application** section and FR-050 forbids a divider anywhere but a section boundary. Recorded in Complexity Tracking; **resolved 2026-08-15** — FR-052 and US5's AS-5 were both corrected in spec.md, so the constitution's single Application section is now what the spec says too. **The second tension** is FR-052's Destroy placement, resolved by reading its third column as an inventory rather than an ordering — also in Complexity Tracking |
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
Tracking — one of them, the cog menu, is a requirement that could not be satisfied as written, and was corrected on 2026-08-15, and needs a
spec amendment before US5 can be marked done. RESOLVED 2026-08-15 — the amendment landed in spec.md (FR-052 and AS-5); nothing here blocks US5.**

### Constitution re-check — the 2026-08-15 amendment (FR-068 – FR-075)

Re-run against the same v4.7.0 constitution. Only the principles the increment actually moves are
listed; every other verdict above stands unchanged.

| Principle | Verdict | Basis |
|---|---|---|
| **I. Project-first context isolation** | PASS | D3 strengthens it. The hidden set is read per project and applied per root, and the id→root map is total because no two projects may share a root. A window still lists exactly one project's files, and now honours **both** of that project's hiding mechanisms rather than one (FR-069a) |
| **II. Platform-abstracted core** | PASS | The new pure code is `hiddenPathGlobs()` beside `compileExcluder` in `@throng/core` — no OS, no `node:*`. The daemon read (D3) and the version-gated settings migration (D4) live in UI-main, the boundary that already owns lifetime and I/O. `transient-overlay.ts` is renderer-only and names no platform |
| **V. Test-first quality (NON-NEGOTIABLE)** | PASS | Every new behaviour is Red→Green. Two of the new requirements are **structural** and get structural tests rather than E2E theatre: FR-071a by an import scan, and D4's migration by an idempotent re-run assertion. SC-021 closes the gap F6 names — the `keepShift` widening changed chord resolution for every command in the `HANDLED` set and nothing asserted the others still resolve |
| **VI. Simple, modern, discoverable UX** | **PASS, with the icon rule read on its rationale — recorded** | FR-068 requires a control that states its destination in words. The themeable-icon-control rule is NON-NEGOTIABLE and its exception is written for dialog decision buttons **on the ground that the label is the statement of the consequence being consented to**. That rationale reaches this control exactly, and D5 applies it on the rationale rather than on the literal Confirm/Cancel list; icon and colours still come from theme tokens. The exclusion toggle beside it takes no text and stays a themeable icon with a hover title, because no requirement asks for one. *Every panel action has a menu item*: neither new control is a panel action — both are modal chrome — so the rule does not reach them |
| **VIII. SOLID / DRY / YAGNI** | **PASS — and it removes duplication twice** | One excluder: the hidden set becomes globs and joins the same `compileExcluder`, so FR-069c cannot be violated because there is nothing to violate it with. One projects reader: `registerEditorIpc`'s `listProjects` closure is re-pointed at the cache D3 introduces instead of making its own `projects.list` call. One overlay registry rather than each feature learning about the others (FR-071a). **Cost**: a second short-lived index and watch on a root while the toggle is flipped — Complexity Tracking |
| **IX. DI & composition root** | PASS | `hiddenPaths(root)` is a fifth **constructor** dependency on `ProjectFileIndexService`, in the shape of the fourth, injected only in `main.ts`. Nothing reaches for `daemonClient` inside the service. `transient-overlay.ts` is module state in the renderer, in the shape of the three registries already there — not a service, and not something a container would own |
| **X. Externalised configuration** | PASS | One new setting, `editor.navigation.quickOpenExcludeHidden`, shipping **on**, with a `FieldDescriptor` in the `Editor · Navigation` group. FR-070 changes a shipped default and therefore bumps `SHIPPED_DEFAULTS_VERSION`, which is the mechanism that makes the change reach existing installs at all (D4) |
| **XI. Dockable workspace** | PASS | Untouched. FR-071 governs overlays, which are window chrome, not panes, tabs or panels — and D1 explicitly refuses to reach into the inline panel rename, which *is* panel chrome |
| **Configuration-editor completeness** (governance) | PASS | The new setting carries a descriptor and is asserted in **both** states, per SC-014's standing rule that a rendered setting nothing reads is the defect #108 exists to catch |
| **Themeable icon controls** (governance) | **PASS, on the exception's rationale — see VI** | One new icon token for the exclusion toggle; both header controls draw through `<Icon>` and take their colours from theme tokens. D5 additionally fixes a shipped defect the gates could not see: `.icon-button` is defined only in `preferences.css`, which the main window never loads, so the delivered target control renders unstyled |
| **Documentation currency** (governance) | PASS | FR-070 changes what every user's file tree shows, so it is a user-facing capability change: `docs/quick-start.md` gains the exclusion toggle and the new preference beside the two the feature already adds, and the `node_modules` default is stated where the explorer is described. `README.md` is re-checked against its capability claims |

## Project Structure

### Documentation (this feature)

```text
specs/033-open-and-navigate/
├── spec.md                     # 75 FRs, 16 SCs, 9 clarifications in one session
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
│   │                           # 2026-08-15: + '**/node_modules' in DEFAULT_EXCLUDE_GLOBS (FR-070, D4)
│   │                           # 2026-08-15: + hiddenPathGlobs(paths) — p and p/**, metachars escaped (FR-069a, D3)
│   ├── expand.ts               # 2026-08-15 (F9): findNode / childFolders EXPORTED for subtree.ts,
│   │                           #   deliberately NOT on either barrel. Listed here because the map said untouched
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
    ├── theme.ts                # + icons.quickOpen token (FR-018b); 2026-08-15 + icons.hidden (FR-069, D2)
    ├── theme-copy.ts           # + its label/description
    └── shipped-defaults.ts     # 2026-08-15: SHIPPED_DEFAULTS_VERSION 4 → 5 + the one-leaf settings
                                #   default migration for explorer.excludeGlobs (FR-070, D4)

packages/ui/src/main/
├── project-file-index.ts       # NEW — the index service: walk, watch, rescan, reconcile, delta (R1, R5)
│                               # 2026-08-15: index keyed by (root, includeHidden) (FR-069, D2);
│                               #   + hiddenPaths(root) constructor dep; re-walk on globs/hidden change (D3)
├── file-index-ipc.ts           # NEW — throng:fileIndex:{subscribe,unsubscribe,update} (R7)
│                               # 2026-08-15: subscribe/unsubscribe carry { root, includeHidden } (D2)
├── shipped-defaults-service.ts # 2026-08-15: upgrade() gains the settings default migration (D4)
└── main.ts                     # wiring only, beside FilesService / ExplorerWatcher
                                # 2026-08-15: + the daemon-backed projects cache feeding hiddenPaths(root),
                                #   re-pointing registerEditorIpc's listProjects at the same reader (D3)

packages/ui/src/preload/
└── preload.cts                 # + the fileIndex bridge (subscribe / unsubscribe / onUpdate)

packages/ui/src/renderer/
├── navigate/                   # NEW folder, mirroring search/ — the Navigate namespace
│   ├── navigation-chrome.tsx   #   mounts both modals; added to BOTH composition roots
│   │                           #   2026-08-15: claims the overlay slot (D1); owns the standing +
│   │                           #     flipped index subscriptions and the includeHidden reset (D2)
│   │                           #   F7: also carries the sub-workspace-only keydown dispatcher — the
│   │                           #     THIRD dispatch site, kept and recorded rather than consolidated
│   ├── navigation-store.ts     #   the one-modal slot + the two remembered values (FR-057..FR-063, FR-066)
│   ├── quick-open.tsx          #   seeds the picker from the index; routes the choice (FR-001..FR-018c)
│   │                           #   2026-08-15: header slot is ALWAYS rendered — it carries the exclusion
│   │                           #     toggle whether or not the target control is drawn (FR-069, D2/D5)
│   ├── quick-open-target.tsx   #   the two-option control above the input (FR-010..FR-010b)
│   │                           #   2026-08-15: becomes an icon+text button naming the panel (FR-068, D5)
│   ├── quick-open-hidden.tsx   # NEW 2026-08-15 — the exclusion toggle, the target's sibling (FR-069, D2)
│   ├── goto-line.tsx           #   the modal (FR-019..FR-028)
│   └── use-file-index.ts       #   subscribes to this window's root
│                               #   2026-08-15: keyed by (root, includeHidden); clears held paths on a
│                               #     non-`ready` push (FR-075, D2)
├── common/
│   ├── picker.tsx              # + rank / maxRows / truncatedMessage / header / initialQuery (R2)
│   │                           # F8: + emptyMessage widened string → ReactNode — the SIXTH change
│   └── transient-overlay.ts    # NEW 2026-08-15 — the one-overlay-per-window claim registry (FR-071/071a, D1)
├── workspace/
│   ├── context-menu.tsx        # MenuAction gains a REQUIRED section; dividers become derived (FR-048..FR-051)
│   ├── tab-group.tsx           # tab menu items declare sections
│   │                           # 2026-08-15: the tab picker claims the overlay slot (D1) — its open
│   │                           #   state STAYS local; nothing is lifted into a store
│   ├── panel-header-menu.ts    # NEW — extracted from panel-placeholder.tsx so SC-010 is provable below E2E (N6)
│   └── panel-placeholder.tsx   # panel header menu items declare sections
├── explorer/
│   ├── context-menu-items.ts   # sections declared; hand-pushed separators removed
│   ├── file-tree.tsx           # Open In → Terminal (FR-029..FR-036); the two subtree items (FR-038)
│   ├── use-explorer-data.ts    # + expandChildren(relPath), collapseChildren(relPath) (FR-039..FR-045)
│   └── toolbar.tsx             # + the Quick Open button (FR-018a..FR-018c)
├── editor/
│   ├── content-menu.ts         # + Go To Line in a Navigate section (FR-027)
│   └── status-strip.tsx        # 2026-08-15: the language picker claims the overlay slot (D1)
├── terminal/
│   ├── terminal-content-menu.ts # NEW — extracted from terminal-panel.tsx, same reason (N6)
│   └── terminal-panel.tsx      # sections declared; hand-pushed separators removed
└── title-bar/
    └── cog-menu.tsx            # sections declared (see Complexity Tracking)

packages/ui/tests/
├── unit/
│   ├── focus-guards.test.ts    # NEW — fails on the #244 predicate shape anywhere in tests/e2e (FR-053a)
│   ├── menu-sections.test.ts   # NEW — every builder's output is section-complete and divider-correct
│   ├── transient-overlay.test.ts        # NEW 2026-08-15 — the registry's claim/release/token rules (D1)
│   └── overlay-feature-isolation.test.ts # NEW 2026-08-15 — navigate/ and workspace/ import neither
│                                         #   way round; FR-071a proved structurally, not by discipline
├── integration/
│   └── project-file-index.integration.test.ts   # NEW — the main service over a real temp tree + watcher
└── e2e/
    ├── quick-open*.e2e.ts, goto-line.e2e.ts, open-in-terminal.e2e.ts,
    ├── subtree-expand-collapse.e2e.ts, menu-sections.e2e.ts, navigation-remember.e2e.ts
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

### Performance goals, and where each is measured

| Budget | Value | Measured | Why there |
|---|---|---|---|
| Keystroke → ranked, capped list (pure) | **one RegExp per query term and one scoring per candidate**, at any corpus size — SC-002's algorithmic content | unit, T008, synthetic 50,000-path corpus, **counted, not timed** | the pipeline is pure, so this is the property that is actually about the algorithm, and it is exactly what a per-entry regression destroys. A count also says the same thing on a starved machine as on an idle one, which no wall-clock assertion in this tier managed to do (see the rejected alternatives below) |
| Keystroke → rendered list (in-app) | **250 ms** on a realistic project | E2E, T026 | **the only tier where SC-002 is asserted as a duration**, because it is the only one where the app is real and contention is controlled. Deliberately looser than SC-002's 100 ms: it additionally pays for Electron IPC, React render and paint. Stated here so it can be argued with when it fails — a task-local threshold that appears in no artifact is one nobody can challenge |
| A filesystem change reaching the candidate set | **2 s** (SC-005) | integration T014, E2E T020 | the integration layer proves the service, the E2E proves the renderer half it cannot see |

## Delivery order

The stories are dependency-ordered rather than priority-ordered, and the reason is stated rather than
implied: **US5's machinery must precede US3 and US4**, because FR-049 is implemented by making a menu
item's section a required field, and neither of those stories' new items can compile until the
vocabulary exists. Each slice remains independently shippable.

1. **US1 — Quick Open** (P1). The index, the picker's **six** new props, the chord, the toolbar
   button. Touches no menu, so it is genuinely first. *(Five when written; `emptyMessage` was
   additionally widened from `string` to `ReactNode` so FR-015's "still listing" state could carry
   its own test id. Corrected 2026-08-15 — baseline finding F8, and see D6 below.)*
2. **US2 — Go To Line** (P2), minus its content-menu item, which needs the vocabulary. Ships the modal,
   the chord, the pure clamp and the find-bar rule.
3. **US5 — menu sections** (P5, delivered third). The `section` field, the derived dividers, all seven
   builders reordered, and Go To Line's menu item lands here as the first item written under the new
   rule. The #244 guard is fixed in this slice, because it is the slice that restructures the menus its
   tests drive.
4. **US3 — Open In → Terminal** (P3). Three-level submenu, flavour seeding, panel creation, focus.
5. **US4 — Expand / Collapse All Children** (P4). Two pure target functions and two menu items.
6. **Post-delivery feedback on US1** (added 2026-08-15, FR-068 – FR-075). Delivered **last** and not
   with US1, because three of its four decisions reach outside this feature — one shipped default
   that governs every project's tree (FR-070), one rule that binds every overlay in the window
   (FR-071), and one exclusion mechanism owned by another spec's data (FR-069a). Each is independently
   shippable, and the order within the slice is D1 → D4 → D3 → D2 → D5, because D2's toggle is the
   only thing that needs all three of the others to exist first.

## Post-delivery design increment (2026-08-15)

The user hand-tested the delivered US1 and raised four items; the spec absorbed them additively as
**FR-068 – FR-071a**, and folded four baseline `/speckit-converge` findings in as **FR-072 – FR-075**.
Four decisions were deliberately left to this plan. They are D1 – D4 below; D5 and D6 record the
design and documentation half of the remaining findings (F6 – F9).

**Nothing above this section is withdrawn.** Where an earlier decision is superseded — the plan's
"the tab picker keeps its own state" is the only one — it is marked at the point of supersession
rather than deleted, so the reasoning that produced it stays readable.

### D1 — One transient overlay per window (FR-071, FR-071a)

**The situation, exactly.** Three overlays, three owners, none of which can see the others:

| Overlay | Where its open state lives |
|---|---|
| Quick Open / Go To Line | `renderer/navigate/navigation-store.ts` — the one-slot `NavigationModal` (FR-066) |
| Tab picker | `renderer/workspace/tab-group.tsx` L705, local `useState`; opened via `registerTabPicker` (L891), dismissed at L1299 and L1509 |
| Editor language picker | `renderer/editor/status-strip.tsx` L49, local `useState`; opened via `registerPickerOpener` (L80) |

FR-066's slot was scoped to the two new modals on purpose, and the plan recorded "the tab picker
keeps its own state" as a deliberate decision. **That decision is superseded by FR-071**: hand-testing
`Ctrl+Alt+T` then `Ctrl+Shift+T` put two focus-trapped modals on screen at once, which is what the
decision actually bought. FR-071a then forbids the obvious repair — neither feature may import the
other's store.

**Decision: a claim registry, in a new file `packages/ui/src/renderer/common/transient-overlay.ts`.**

```ts
let current: { token: object; dismiss: () => void } | null = null;

/** Claim the window's one overlay slot. Returns the release to call when this overlay closes. */
export function claimTransientOverlay(dismiss: () => void): () => void {
  const token = {};
  const incumbent = current;
  current = { token, dismiss };          // claim FIRST — see the ordering note below
  if (incumbent) {
    try { incumbent.dismiss(); } catch { /* an overlay tearing down must not block the new one */ }
  }
  return () => { if (current?.token === token) current = null; };
}

/** The React seam every overlay uses: one line at the call site, no state moved. */
export function useTransientOverlay(open: boolean, dismiss: () => void): void;
```

**Why a registry of dismiss callbacks, and not a shared store of "which overlay is open".**

- **It inverts the dependency, which is the whole of FR-071a.** An overlay declares exactly two
  things about itself — *I am open now*, and *here is how to close me* — and learns nothing about any
  other overlay. Neither feature imports the other, and that is provable **below E2E**: a
  source-scanning unit test asserts that no file under `renderer/navigate/` imports
  `workspace/tab-picker` or `workspace/tab-group`, and no file under `renderer/workspace/` imports
  `renderer/navigate/`. FR-071a is a structural requirement, so it gets a structural test, in the
  shape `icon-call-sites.test.ts` and `focus-guards.test.ts` already established here.
- **A shared state store would have to be adopted by each overlay**, which means lifting the tab
  picker's flag out of `tab-group.tsx` into a global. That is a change to shipped 031 behaviour with
  no user-visible gain, and the flag is genuinely local — nothing outside that component has any
  business knowing whether the strip is showing a list. VIII (YAGNI) and FR-053's spirit agree.
- **The repository already reads this shape three times** — `workspace/panel-rename.ts`,
  `tab-picker.ts`'s opener and `navigation-store.ts`'s `registerQuickOpen`. A fourth module-level
  registry is the idiom here, not a novelty, and the next overlay added costs one line.

**Claim before dismiss, and identity on release — the part that is easy to get wrong.** An
incumbent's `dismiss` is almost always a `setState(false)`, whose effect cleanup then calls the
`release` it was handed. A `release` that cleared the slot unconditionally would clear *the new
claimant's* entry, so the next overlay would find an empty slot and dismiss nothing — a bug that
appears only on the second overlay in a chain and looks exactly like the one being fixed. Two things
prevent it, and both are needed: `release` is checked against a per-claim token, and the claim is
written **before** the incumbent is dismissed, so a synchronous re-entrant release is already a no-op
by the time it runs.

**On unmount.** `useTransientOverlay`'s effect cleanup runs `release()`, so an overlay whose component
goes away — window closed, tab group unmounted, panel destroyed — leaves no callback behind. Because
release is ownership-checked it is idempotent, and a *late* unmount (React mounts the new tree before
cleaning up the old) cannot dismiss the newer overlay — which a plain `current = null` would.

**Scope: one realm, one slot.** The registry is module state, so it is per renderer realm — which is
precisely FR-071's "in a window". A sub-workspace window is a separate realm with its own React root
and gets its own slot, for the same reason `navigation-store.ts` is module-level.

**Registrations — four call sites, one line each:**

| Overlay | File | Call |
|---|---|---|
| Quick Open **and** Go To Line | `renderer/navigate/navigation-chrome.tsx` | `useTransientOverlay(modal !== null, closeNavigationModal)` — one call covers both, because `setNavigationModal` replaces *within* the slot and the boolean never flickers, so no self-dismissal loop is possible |
| Tab picker | `renderer/workspace/tab-group.tsx` | `useTransientOverlay(pickerOpen, () => setPickerOpen(false))` |
| Editor language picker | `renderer/editor/status-strip.tsx` | `useTransientOverlay(pickerOpen, () => setPickerOpen(false))` |

**`workspace/panel-rename.ts` is out of scope, deliberately.** It is not an overlay. It swaps a panel
header's title text for an inline `<input>` **in place** — no scrim, no focus trap over the window,
nothing occluded — so none of the three harms FR-071 names can arise from it. And dismissing it would
be worse than leaving it: a rename box that vanished because the user pressed a chord would silently
discard typed text, making it a data-loss behaviour rather than a tidiness one. The test FR-071
implies, and the one this plan applies: **a transient overlay is a surface drawn OVER the window that
can be dismissed without consequence.** An inline editor is neither half of that.

**Context menus are also out**, and this one is a judgement rather than a definition. They *are*
overlays by the test above, but they already dismiss on any outside pointer or focus change, and
FR-071 names three things. Recorded as a deferral in Complexity Tracking with a tracked issue rather
than folded in silently.

**SC-017's six orderings** are asserted for the three overlays the criterion names. The editor's
language picker gets a **single** directional assertion (opening Quick Open dismisses it) rather than
joining the matrix: with four overlays the matrix is twelve pairs, and the extra six prove nothing
about the mechanism the first six do not — there is one registry, and six orderings already exercise
every branch of it.

### D2 — The exclusion toggle (FR-069 – FR-069d)

**Decision: the exclusion state is part of the SUBSCRIPTION KEY.** `ProjectFileIndexService` keys its
per-root index by `(root, includeHidden)` instead of by `root`; the renderer says which one it wants
when it subscribes; main walks with or without the exclusions accordingly.

This is the smallest change that keeps every rule the index already has. The service's guarantees —
refcounted subscribe, dispose on the last unsubscribe (S9), the snapshot-then-delta protocol (I2, S7,
S8), the settings read at walk time (S10), the watch-failure path (S11) — are all stated *per index*,
and widening the key adds an index rather than changing what one is. Nothing in `subscribe`
(`project-file-index.ts:138`), `publish` (:259), `drop` (:194) or `teardown` (:201) learns a new
concept; `normaliseForCompare(root)` at :140 gains a suffix.

**FR-069c falls out by construction, and that is the point.** There is exactly **one** excluder in the
system — `compileExcluder`, over the same two inputs the tree obeys (D3 supplies the second) — and the
flag chooses whether to build it or to build the empty one, which `compileExcluder([])` already
returns as `() => false`. There is no second rule set to drift from the first, because there is no
second rule set. "Show hidden" therefore means *everything the project hides*, `.git` and (after D4)
`node_modules` included; stated explicitly because it is the sort of thing that surprises at review,
and because FR-006's whole claim is that there is one answer to "is this file hidden?".

**The standing subscription is never given up.** `NavigationChrome` subscribes for the window's
lifetime today, which is what makes a keystroke free (R5). If the toggle simply re-pointed that one
subscription, flipping it would dispose the default index (S9 drops a root on its last unsubscribe),
and the *next* invocation would re-walk the whole project before it could answer — the stall FR-013
exists to forbid, arriving as a side effect of a toggle. So:

```ts
const defaultIncludeHidden = !settings.editor.navigation.quickOpenExcludeHidden;   // FR-069b
const [includeHidden, setIncludeHidden] = useState(defaultIncludeHidden);          // reset on each open
const standing = useFileIndex(root, root !== null, defaultIncludeHidden);          // window lifetime
const flipped  = useFileIndex(root, includeHidden !== defaultIncludeHidden, !defaultIncludeHidden);
const index    = includeHidden === defaultIncludeHidden ? standing : flipped;
```

The second subscription exists only while the toggle differs from the setting, and dies with the
modal. The common case pays nothing; the uncommon case pays a walk, once, visibly.

**FR-069d needs no new mechanism.** A fresh subscription answers `{ status: 'building' }` with no
paths (`file-index-ipc.ts:48`), and **FR-075**'s rule — the renderer discards what it holds on a
non-`ready` push — turns that into FR-015's "Still listing this project's files…" state, already
built and already asserted (`quick-open-perf.e2e.ts:399`). The toggle's wait state is FR-075 doing its
job a second time, not a second implementation of it. Sequencing follows: **FR-075 lands before the
toggle**, or the toggle's first flip serves a stale list.

**FR-069b's reset.** "The toggle changes the current modal; the setting decides where every modal
starts" is implemented by resetting `includeHidden` to `defaultIncludeHidden` on the transition into
`modal.kind === 'quickOpen'` — not by remounting `<QuickOpen>` on a `key`, which would also discard
the query the user has typed if the modal is ever re-rendered for another reason.

**Rejected alternatives.**

| Rejected | Why |
|---|---|
| **Index everything once, filter in the renderer** | It makes the common case pay the uncommon one's cost, permanently. Main would walk and recursively watch `node_modules` for every project always, ship every path in the snapshot, and turn an `npm install` into a delta storm the user pays for while doing nothing. SC-002's 50,000-candidate budget is over *candidates*, and this multiplies them by whatever `node_modules` holds. It also puts the exclusion decision in two places — main's walk and the renderer's filter — which is FR-069c's second rule set arriving through the back door |
| **Maintain both sets in main** | Same walk and same watch cost as above, minus the IPC. It still holds every `node_modules` path in main's memory for a toggle most users never touch, and it adds a second reconcile path to the delta protocol, which is already this feature's most intricate piece (`drainRescans`, `scheduleReconcile`, `runReconcile`) |
| **Re-walk one index in place — `setIncludeHidden(root, flag)`** | A root's index is refcounted and **shared by every subscriber of that root** (S9), so one window's toggle would silently change another window's candidate set, and the flag would have no owner. Widening the key leaves the refcount rule exactly as it is |
| **Subscribe at both flags for the window's lifetime** | Always pays the rare cost. The whole argument for excluding at walk time is not to walk or watch `node_modules`, and this reinstates it permanently |

### D3 — The per-project hidden set, and how UI-main gets it (FR-069a, baseline F1)

**This is the crux the requirement names, and the shipped state is worse than "renderer-only".** The
hidden set is not renderer state at all: it is **`projects.hidden_paths`**, a JSON string array in the
daemon's SQLite database (migration v6, `packages/persistence/src/migrations/v6-project-hidden.ts`;
mapped in `project-repository.ts` L16–24 / L123). It reaches the renderer as an ordinary field on the
`projects.list` DTO, through `state/projects-store.tsx` → `panes/file-explorer-pane.tsx:89` →
`explorer/file-tree.tsx` → `explorer/use-explorer-data.ts:425`, where it becomes `hiddenSet` and is
applied as a **display filter over already-fetched children**. The globs, by contrast, are applied a
stage earlier, during the fetch. Two mechanisms, two stages — which is exactly how one of them came to
be enforced in main and the other nowhere near it.

**Decision: UI-main becomes the authority, reading the hidden set from the same place the renderer
reads it — the daemon.** `daemonClient` is already in scope at `main.ts:997`, three lines above where
`ProjectFileIndexService` is constructed, and `main.ts:1143` already calls `projects.list` for its own
purposes and **discards `hiddenPaths` from the result**. So the data is one field away from where it
is needed.

1. **The service gains a fifth constructor dependency**, symmetrical with the fourth:
   `hiddenPaths: (root: string) => readonly string[]`, read lazily at walk time exactly as
   `excludeGlobs` is (S10, at :239, :300 and :377). The service learns no new lifecycle.
2. **One reader, not two.** The composition root grows a small root-keyed projects cache fed by
   `daemonClient.call('projects.list')`, and `registerEditorIpc`'s existing `listProjects` closure is
   re-pointed at it rather than making its own call (VIII, DRY).
3. **Root-keying is legitimate here.** Hidden paths are keyed by project **id**; the index is keyed by
   **root**. `projects.list` returns both on every DTO, and the project root-exclusivity constraint
   means no two projects share a root — so the id→root map is total and unambiguous. Stated because
   "the two keyings do not line up" is the objection this answers.
4. **Path forms already agree.** Hidden paths are root-relative POSIX with no leading slash, built by
   `joinRel`; the index's paths are the same form (`project-file-index.ts:332`). No conversion.
5. **The hidden set is applied THROUGH `compileExcluder`, not beside it.** Each hidden path becomes two
   patterns — `p` and `p/**` — appended to the glob list, and one predicate is compiled from the
   union. This is what makes FR-069c true structurally: there is one predicate, so there cannot be two
   answers. It also **fixes a defect the naive reading would ship**: the tree hides a folder by
   removing its node, so its descendants disappear implicitly; a flat path index doing
   `hidden.has(rel)` would hide `docs` and still list `docs/guide.md`. **Glob metacharacters in a
   literal path must be escaped** before this conversion — a file the user hid that is genuinely named
   `a[1].ts` would otherwise become a character class and hide the wrong files.
6. **Freshness, without a new channel.** Nothing pushes to main when `projects.setHidden` lands; the
   only signal is the renderer→renderer `throng:projects:changed` poke, **which main already relays**
   (`preload.cts:181-189`). The relay gains a main-side listener: re-list from the daemon, and for any
   root whose hidden set actually changed, ask the index to re-walk that root.
7. **And the same must be done for the globs.** Today an `explorer.excludeGlobs` change re-walks the
   index only *opportunistically* — there are exactly two `onSettingsChanged` subscribers in `main.ts`
   (L719, L1125) and neither is the index, so a quiescent project serves the stale candidate set
   indefinitely, while the tree re-walks immediately (`use-explorer-data.ts:423`, `globsKey` in the
   dependency array). Leaving that asymmetric would make FR-069c false at exactly the moment a user
   edits their globs: one input live, the other stale. The index subscribes to `onSettingsChanged` and
   re-walks affected roots on a glob change. Small, and required for the claim being made.

**Rejected alternatives.**

| Rejected | Why |
|---|---|
| **The renderer passes the hidden set in on `subscribe`** | It makes the renderer the authority on a rule main enforces, and a root's index is **shared** across windows — two windows subscribing with different hidden sets would make the index's contents depend on subscription order. It also duplicates the rule's source, which is FR-069c |
| **Filter hidden paths in `quick-open.tsx`** (offered by T109) | This is literally "two mechanisms, two answers" moved one layer up: globs enforced in main, hidden paths in the renderer. FR-006 and FR-069c both forbid it, and it ships hidden paths over IPC only to drop them |
| **Move hidden paths into `settings.json`** | They are project data owned by the daemon's `projects` table since 004, keyed by project id and reachable by the project-settings dialog and the daemon's own DTO. Relocating them is a persistence-contract change far larger than the defect warrants |

### D4 — `**/node_modules` in `DEFAULT_EXCLUDE_GLOBS` (FR-070)

Six lines of change and the widest blast radius in the increment, because the constant governs the
Files & Folders tree for every project on the shipped default.

**What must move.**

| Artifact | What happens |
|---|---|
| `packages/core/src/explorer/exclude.ts:9-16` | `'**/node_modules'` joins the list. This is the whole code change |
| `packages/ui/tests/e2e/helpers/deep-tree.ts:96-99, 141-152, 175-187` | The **tripwire fires**: `assertShippedDefaultsUnchanged()` throws at fixture construction — *by design*, it exists to catch exactly this — and kills every spec that builds the fixture. `EXCLUDABLE_FOLDERS`' `node_modules: { hiddenByDefaults: false }`, `excludedByDefaults`, `listedByDefaults`, `NODE_MODULES_GLOB` and `globsExcludingNodeModules` all invert; the L16-36 header comment becomes untrue |
| `packages/ui/tests/e2e/quick-open.e2e.ts:576-604` | Asserts a `node_modules` file **is** the one row returned. It inverts to zero rows and the comment at :586 inverts with it |
| `specs/033-open-and-navigate/spec.md:422-429` | The FR-006 block quote states in terms that `node_modules` is not excluded and that "**this feature does not change a shipped default**". FR-070 now does. It must be marked **superseded by FR-070**, not deleted |
| `packages/core/src/config/shipped-defaults.ts:53` | **`SHIPPED_DEFAULTS_VERSION` 4 → 5.** See below — this one is load-bearing |

**Self-updating and therefore safe** (verified, not assumed): `explorer-exclude.test.ts`,
`explorer-exclude-compiled.test.ts`, `app-settings.explorer.test.ts`, `shipped-defaults-reset.test.ts`
and `shipped-defaults-fidelity.contract.test.ts` all compare against the constant or a generated
record, and no row in any of them flips. `packages/ui/dist/main/shipped-defaults.json` is build output,
regenerated by `scripts/generate-shipped-defaults.mjs`, and is not committed. `docs/` names the exclude
globs nowhere, so no documentation change falls out of the constant itself.

**The version bump is the difference between FR-070 working and FR-070 reaching nobody.** First-run
`seed()` writes the **materialised** settings document to disk (`shipped-defaults-service.ts:238-266`),
so every existing install already holds `explorer.excludeGlobs: [".git", ".svn", ...]` literally, and
`parseAppSettings` honours a present array. Adding the glob to the constant therefore changes the
default for **fresh installs only**, while FR-070 promises that "a user who has customised keeps their
own list; only a user still on the shipped default sees the change" — a promise about *existing*
users, which is the population no fresh-install E2E can ever see. This is the same trap 015, 016 and
018 each recorded at this line, and 018's note is explicit that the version is a sequence, not a label.

The existing `upgrade()` is **themes-only** (`planThemeUpgrade`, FR-015a), so it does not reach this.
The increment therefore adds the narrowest possible settings counterpart: **one entry, one leaf** —
`explorer.excludeGlobs` is rewritten to the v5 list **only when the on-disk array deep-equals the v4
list**. That is FR-070's own sentence mechanised: equal to the old default means untouched by the
user; anything else is a customisation and is left alone. It is idempotent by construction — after the
rewrite the array equals the v5 list and no longer matches the guard — and it carries the
idempotent-re-run assertion the project requires of a migration.

### D5 — The target button, and a styling defect found while designing it (FR-068)

FR-068 requires **one button carrying an icon and its explanation together**, reading "Will open in a
**new editor**" or "Will open in the **active editor** (*panel name*)". Three things follow.

**It cannot be `IconButton`.** `common/icon-button.tsx` takes no `children` and no `label`; its one
text-ish slot, `badge`, is documented as "an optional COUNT … **never a label**", and `dataAttrs` is
narrowed so a second class or handler cannot be smuggled through. So the control becomes its own
component with its own class, following the **context-menu item's** vocabulary — the only icon+text
shape in the renderer — an `aria-hidden` icon span beside a label span (`workspace/context-menu.tsx:305-353`).

**The constitutional reading, stated rather than assumed.** The themeable-icon-control rule is
NON-NEGOTIABLE and its exception is written for *dialog decision buttons*, on the ground that "their
label **is** the statement of the consequence being consented to; replacing it with an icon would
remove the very information the dialog exists to convey". FR-068 exists because that is precisely what
happened here: the icon states the current value and never the choice, and states neither to a user
who does not hover. **The exception's rationale reaches this control, and the plan applies it on that
rationale rather than on the literal Confirm/Cancel list** — a control inside a dialog whose label is
the statement of the consequence. Its icon is still a theme token and its colours still derive from
theme tokens, which is the rest of the rule in full. The narrow reading is recorded as the rejected
alternative: an icon-only control that satisfies the letter and defeats the requirement.

**The exclusion toggle (D2) stays an icon with a hover title.** No requirement asks for text on it,
and widening a NON-NEGOTIABLE rule's exception to a control that does not need it would be the wrong
direction. FR-069's "drawn as its sibling" is satisfied structurally — same header row, same control
family, and `.picker__header` is already `display: flex; gap: 8px` (`theme.css:2606-2612`), so no
layout work falls out. The asymmetry is deliberate and is recorded in Complexity Tracking.

**A defect found while checking the gates, which no finding names.** `.icon-button` is defined in
`preferences/preferences.css:629-655`, and `preferences.css` is imported **only** by
`preferences/preferences-app.tsx`. The main window loads `theme.css` alone. So the shipped
`QuickOpenTarget`, which passes `className="icon-button"`, renders in the main window with **no
styling at all beyond the user-agent default** — every other main-window `IconButton` call site passes
its own class. Both header controls therefore need rules in `theme.css`, not `preferences.css`.

**Gates that bind the new CSS** (checked, so the tasks can be written to pass first time):
`css-variables-defined.test.ts` (every `var()` defined; `--throng-colour-iconColour` needs a fallback),
`no-inline-artwork.test.ts` (no colour literal in a value position), `surface-token-roles.test.ts`
(the pane token is not available to anything under `.picker`; `:hover` takes `hoverSurface`, never
`surfaceActive`), and `hover-suppression-coverage.test.ts` (any `hoverSurface` `:hover` rule must be
gated on `body:not([data-window-blurred])`). Two that do **not** bind, and it is worth knowing why:
`button-token-exclusion.test.ts` keys on a closed literal list of selectors and a new class is in
neither set; `button-typography-coverage.test.ts` forbids a bare `button { … }` element rule, so the
new control must be class-scoped — which it is.

### D6 — Baseline findings that are design or documentation (F7, F8, F9)

**F7 — the second window-level keydown dispatcher.** `renderer/navigate/navigation-chrome.tsx:119-138`
installs a capture-phase `window` keydown listener, live only in sub-workspace windows. It is
**necessary**: `subworkspace-app.tsx` mounts no `KeybindingsHandler`, and Assumption 6 rejects a chord
that works in one window and silently does nothing in the other. It is **kept**, and named here as the
third dispatch site the plan did not list, because the two paths do not resolve alike and the
difference is invisible until it bites:

| | `app.tsx:240-278` | `navigation-chrome.tsx:121-135` |
|---|---|---|
| Key | `chordKey(e)` (backtick normalised from the physical key) | raw `e.key` |
| Shift | conditional — `keepShift` for backtick, F-keys and letters | unconditional |
| Resolver | `resolveScoped` + `scopeInput()` | `resolveAction` + `scopeFromKind(activeKind)`, bypassing `isPanelScoped` |
| Gate | the `HANDLED` set | `action !== QUICK_OPEN` |

The two agree for `Ctrl+Shift+T` and would diverge for a backtick or function-key chord. **Deferral**:
giving the sub-workspace shell the shared dispatcher is owed to a tracked issue, filed before this
branch merges. Fixing it here would put a second window's entire chord surface at risk inside a
feature that already touches every menu in the app.

**F8 — the picker's sixth change.** `PickerProps.emptyMessage` was widened from `string` to
`ReactNode` so FR-015's "still listing" state could carry its own test id (`picker.tsx:65-69`). It is
inert for a caller passing a string, so SC-013 holds and the tab picker is untouched — but the
contract and this plan both say five. `contracts/picker-extensions.md` §3's heading and block gain the
sixth entry, and the plan's file map and Delivery order are corrected above. While the contract is
open: §5's post-hoc registry says "three more test identifiers" and then lists two
(`quickopen-target`, `quickopen-building`); `quickopen-truncated` is the third and is named only in P4.

**F9 — `expand.ts` is not untouched.** `findNode` and `childFolders` were exported for `subtree.ts`
(US4) and deliberately kept off both barrels — `explorer/index.ts` exports only `ExpandNode` and
`nextExpandTargets`. The file map lists `subtree.ts` as new and `expand.ts` not at all; corrected
above.

**F6 — `keepShift`** is a code change with a plan entry owed to it and a missing assertion, not a
design decision; it is recorded in Complexity Tracking and covered by SC-021.

## Complexity Tracking

| Item | Why it is here | What was rejected, and why |
|---|---|---|
| **FR-052's cog-menu row contradicted FR-047, FR-050 and Principle VI — RESOLVED 2026-08-15** | FR-052 *used to require* the cog menu's three preferences destinations to be split from Open Logs Folder and About. All five are **Application** items in the constitution's own table, which FR-047 reproduces verbatim, and FR-050 forbids a divider anywhere but a section boundary. The requirement cannot be met without either a divider inside a section or a section that does not exist. **The plan implements the constitution**: the cog menu carries five Application items and **no divider**, and the contradiction was raised and **resolved on 2026-08-15**: FR-052 and US5's AS-5 now both say the cog menu takes no divider | *Reading Open Logs Folder as **Navigate*** (it reveals a folder, like Reveal) would satisfy the divider but reorder the menu so logs came **first** and About sat with Settings — the opposite of what AS-5 describes. *A new "Diagnostics" section* is a constitutional amendment this feature has no mandate to make |
| **FR-052 puts Destroy last for two menus; FR-047 fixes it third** | FR-052's third column reads "Content / Navigate / View & state / Destroy" for the panel header and "Content / Navigate / Destroy" for the tab menu. FR-047 says the order is fixed and puts **Destroy third**, ahead of Navigate and View & state, as does the constitution. **The plan reads FR-052's third column as an inventory of which sections a menu contains, not an ordering** — the reading that survives, because FR-047 says "fixed", because the constitution agrees with it, and because the Files & Folders menu that Assumption 7 names as the vocabulary's *source* already ships Delete before Open In. AS-3 and AS-4 ask only that destructive items be separated, which says nothing about position | *Ordering by FR-052 instead* — it would make the one menu the vocabulary was derived from the only menu that violates it, and would put two different Destroy positions in one release |
| **A second recursive watch on the active project's root** | The index takes its own `IFileWatcher.watch(root)` rather than sharing `ExplorerWatcher`'s. It must, because the index serves roots the explorer does not watch (FR-017) and because `ExplorerWatcher` is single-root and its debounce/storm behaviour was hard-won by 026/#186. **Deferral**: consolidating both consumers onto one multi-root watch is owed to a tracked issue, to be filed before this branch merges | *Refactoring `ExplorerWatcher` into a registry now* — a change to shipped live-sync behaviour, inside a feature that already touches every menu in the app |
| **`FilesService` and `ExplorerWatcher` stay single-root** | Both hold one process-wide root set by whichever renderer last sent `throng:files:setRoot`. The index is keyed by root instead, so FR-017 is met without touching them. **Deferral**: a sub-workspace whose panels belong to a project other than the active one still reads the wrong root for ordinary `files.*` calls — a pre-existing defect this feature neither creates nor fixes; owed to a tracked issue | *Fixing it here.* It is not in this feature's scope and would put a second window's file operations at risk in a release that is already six issues wide |
| **SC-011 cannot hold literally** | "The existing menu-driving end-to-end specs pass unmodified" is true of the grouping pass but not of the feature: **two** existing specs change, and SC-011 now names both: `context-menu-sections.e2e.ts:49` asserts the folder's Open In submenu holds **exactly one** item and US3 adds Terminal to it by design, and `menu-keyboard.e2e.ts` is modified because **FR-053a requires exactly that** (the vacuous guard) plus the FR-051 divider-skip assertion. No label, icon, action, intra-section order or test identifier changes, so **FR-053 holds in full** | Nothing — this is a defect in SC-011's wording, recorded so the change is not mistaken for a regression |
| **SC-002's 50,000-file budget is proved at the unit layer, but not as a wall-clock number** | Creating 50,000 real files, walking them and launching Electron around them costs minutes per run and would be a wall-clock assertion under exactly the contention `failOnFlakyTests` punishes. The work is spent in `compileQuery` → filter → rank → cap, all pure, so it is measured there over a synthetic 50,000-path corpus. **The same objection applies to the unit tier itself, and was measured doing so**: the unit project runs ~160 files in parallel, and a hard 100 ms line produced 102.5, 105.1, 105.3 and 147.0 ms in four full-suite runs against 45 ms in isolation, with no code change between them — failing MORE often when neighbouring files were excluded, which is the signature of contention. So T008 asserts what a starved machine cannot perturb: the *work* a keystroke does — one RegExp per query term and one scoring per candidate, over the full 50,000-path corpus. The E2E asserts the *architectural* half — that typing issues **no** `throng:files:*` call — plus the in-page duration on a realistic project, in the style of `editor-highlight-perf.e2e.ts` | *A 50k-file E2E fixture* — minutes of setup per run for a property the pure layer establishes more precisely. *Trusting the unit test alone* — it would not catch a keystroke that reached the filesystem, which is the half of FR-013 that actually bites. *Raising the 100 ms* — the pipeline is not the thing that got slower, so a bigger number would only move the coin toss. *Best-of-N instead of worst-of-N* — the best sample of the widest query still moved from 38 ms to 66 ms under an ordinary full run. *A calibrated ratio against a reference workload timed in the same run* — the strongest of the alternatives, stable at 3.7–4.0 alone and under a normal full run where the absolute figure drifted 70%, and still rejected on measurement: stressed with eight CPU burners against a 20-worker run on a 20-core box it failed three runs of four, once on the empty query whose ordinary ratio is 0.2. Starve a worker badly enough and both halves of the ratio are perturbed independently, so no ceiling that still catches a regression survives |
| **A THIRD recursive watch on the same root while the exclusion toggle is flipped** *(2026-08-15, D2)* | Keying the index by `(root, includeHidden)` means a flipped toggle builds a second index of the same root — a second walk and a second `IFileWatcher.watch`, this one covering `node_modules`. It is bounded by the modal's lifetime and paid only by a user who asked to see hidden files, and FR-069d requires the wait to be visible rather than hidden. It compounds the deferral two rows above: consolidating every consumer onto one multi-root watch now has three consumers to consolidate | *Filtering in the renderer* and *maintaining both sets in main* both remove the second watch by making **every** user walk and watch `node_modules` permanently — trading a bounded cost most users never pay for an unbounded one all of them do. Fully argued in D2 |
| **FR-070 reaches no existing install without a `SHIPPED_DEFAULTS_VERSION` bump** *(2026-08-15, D4)* | First-run `seed()` materialises the whole settings document, so every existing install holds the old six-glob array literally on disk and `parseAppSettings` honours it. Adding the glob to the constant would change the default for **fresh installs only**, while FR-070's sentence is about existing users — the population no fresh-install E2E can see. The bump plus a one-leaf settings migration (rewrite `explorer.excludeGlobs` only when it deep-equals the v4 list) is FR-070's own rule mechanised, and it is idempotent by construction. **This is the same trap 015, 016 and 018 each recorded at that line** | *Adding the glob and stopping there* — it would pass every test in the suite and reach nobody who already has the app. *A blanket additive settings upgrade in the shape of `planThemeUpgrade`* — "fill what is missing" is meaningless for an array whose old value is present and complete; the only honest test is equality with the previous shipped list, and that is what is built |
| **The exclusion toggle and the target button are not styled alike** *(2026-08-15, D5)* | FR-068 requires text on the target button; nothing requires it on the toggle. The plan gives the toggle a themeable icon and a hover title and gives the target button icon-plus-text, so a NON-NEGOTIABLE rule's exception is widened to exactly the one control whose requirement forces it and no further. Two sibling controls in one header will therefore not look symmetrical | *Giving both text* — it widens the exception to a control that does not need it, on aesthetic grounds, against a rule marked NON-NEGOTIABLE. *Giving both icons only* — it is the delivered behaviour FR-068 exists to replace. If the asymmetry proves unacceptable in use it is a spec question, not an implementation one |
| **Context menus are transient overlays and are not registered** *(2026-08-15, D1)* | By D1's own test — a surface drawn over the window, dismissible without consequence — a context menu qualifies. It is left out because it already dismisses on any outside pointer or focus change and because FR-071 names three overlays. **Deferral**: owed to a tracked issue filed before this branch merges, so the omission is a decision on the record rather than an oversight | *Registering them now* — every menu in the app is being restructured by US5 in the same branch, and adding a dismissal path to that surface mid-restructure is how a menu ends up closing under its own submenu |
| **Two window-level chord dispatchers, resolving differently** *(2026-08-15, F7)* | `app.tsx` and `navigation-chrome.tsx` both listen on `window` in the capture phase; the second is live only in sub-workspace windows and is **necessary**, because `subworkspace-app.tsx` mounts no `KeybindingsHandler` and Assumption 6 rejects a chord that works in one window and silently dies in the other. They agree for `Ctrl+Shift+T` and would diverge for a backtick or function-key chord — the table in D6 is the difference. **Deferral**: give the sub-workspace shell the shared dispatcher, owed to a tracked issue | *Consolidating here* — it would put a second window's entire chord surface at risk inside a feature that already touches every menu in the app, to fix a divergence no shipped chord currently reaches |
| **`.icon-button` has no rule in the main window's stylesheet** *(2026-08-15, D5)* | `preferences.css` is imported only by the preferences window; the main window loads `theme.css` alone, which defines `.icon-button__badge` and no `.icon-button`. The delivered `QuickOpenTarget` passes `className="icon-button"` and therefore renders with nothing but user-agent styling. Found while checking which gates bind the new control — **no baseline finding names it**, because no gate can see it: every structural test reads selectors, and the defect is a selector that is never loaded | *Adding `.icon-button` to `theme.css`* as a general fix — it would restyle nothing else (every other main-window call site passes its own class) and would put a rule in the `ICON_EXCLUSION` set for one caller's benefit. The two header controls get their own class-scoped rules instead |
