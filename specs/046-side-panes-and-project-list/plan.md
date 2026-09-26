# Implementation Plan: Side Panes and Project List

**Branch**: `feature/S046-I331-I332-I390-I411-I292-side-panes-and-project-list` | **Date**: 2026-09-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/046-side-panes-and-project-list/spec.md` (5 user stories,
49 requirement ids, 9 success criteria, 0 clarification markers; committed as `e582b775`). It closes
#331, #332, #390, #411 and #292.

**Iterate round 1 (2026-09-24).** The spec now runs to FR-112 and SC-016, with supersessions S4 – S23
and research R15 – R22, amended at `25fe6911` against constitution **v5.6.0** (`434400fb`). The
sections down to *Complexity Tracking* describe what shipped as T001 – T091 and are kept as the
record. The **current plan for the round** is the last section,
[*Iterate round 1: the agreed convention*](#iterate-round-1-the-agreed-convention-checkpoint-2026-09-24),
with its own Constitution Check against v5.6.0. The two round-1 subsections before it are superseded
where they differ from it.

*Extended (iterate round 3, 2026-09-25, spec FR-116 – FR-119, S27):* the last section is now
[*Iterate round 3: the B / N / M focus row and a route back to the workspace*](#iterate-round-3-the-b--n--m-focus-row-and-a-route-back-to-the-workspace-2026-09-25).
It supersedes every side-pane focus, pane-toggle and notice chord this plan names above, and adds
`focus.workspace` and shipped-defaults version 14. Nothing above is deleted.
*Extended (iterate round 4, 2026-09-26, spec FR-121 – FR-123, S28):* a further last section,
*Iterate round 4*, gates the workspace outline and the arrows on the active pane and lets Ctrl stay
held for Ctrl+E W. No chord or default changes.
*Extended (iterate round 5, 2026-09-26, spec FR-124, FR-125, S29):* a further last section,
*Iterate round 5*, supersedes round 4's second-stroke rule with `Mods+K1,K2` chords and brings
focus into every panel type.

## Summary

**Five issues, two surfaces, and one daemon RPC that was waiting for a caller.**

**#331, the rename, is copy only.** About 40 source files and four docs say "Files & Folders". The
fix is a text sweep plus a unit guard that scans shipped sources and docs for all three spellings.
No identifier changes (FR-003).

**#332, the keyboard layer.** Four new window commands follow the existing `view.toggle*` pattern.
They are dispatched in capture phase by `KeybindingsHandler` (`packages/ui/src/renderer/app.tsx:257`),
so no shell or editor ever sees them.

- **Ctrl+Alt+E failed FR-021.** Bash binds Meta-Ctrl-E to `shell-expand-line`, and Ctrl+Alt+E is
  AltGr+E (€, ę) across most of Europe. `focus.explorer` ships **Ctrl+Alt+F**, and spec.md records the
  replacement under FR-021.
- **The Projects pane needs a sixth dispatch scope.** Without it, the pane would inherit `explorer`,
  where F2 and Delete act on the File Explorer's selection ([research.md](./research.md) R3).

**#390, Ctrl+Shift+0.** A two-candidate matcher resolves the physical digit first, then the produced
character. Physical matching is restricted to the ten digit keys and to chords **without Alt**, so
that no AltGr layout loses `}` or `@` (R2).

**#411, Unload, is mostly composition.**

- The unsaved guard is Remove's own.
- The dialogs reuse `useChoose` and `useConfirm`, planned by a pure `planUnload` beside
  `planConfirmations`.
- The terminal half is `terminal.closeIdle`, which has existed in the daemon, documented as "used on
  project/app close", with **no caller anywhere in the UI**.
- Both it and `terminal.killAll` gain an optional `exceptPanelIds`, so that a sub-workspace's panels
  survive (FR-037).
- The menu offers the plain *Unload* and both named variants, as Principle VI's
  default-plus-variants rule requires.

**#292, categories.** Migration v9 adds `project_categories` and an additive `projects.category_id`,
healed at read time to the default category. It keeps `projects.position` as the one global order,
so drag reorder and its validation are reused unchanged.

## Technical Context

**Language/Version**: TypeScript 6 (`@typescript/typescript6`), Node ≥ 22.12 (CI on Node 24), and
Electron 44.

**Primary Dependencies**: React 19.3, `@dnd-kit/core` 6.3 (project drag, reused), `react-arborist`
3.16 (the File Explorer tree, reused), better-sqlite3 12, InversifyJS 8, `@xterm/xterm` (read for R1,
unchanged). **No new runtime dependency.**

**Storage**: SQLite, migration **v9**. That is a new `project_categories` table plus the additive
`projects.category_id`, registered in `schema-guard.ts`. `LATEST_VERSION` moves from 8 to 9. Settings
get two new leaves, with no `SHIPPED_DEFAULTS_VERSION` bump for settings. Three new icon tokens force
`SHIPPED_DEFAULTS_VERSION` from **11 to 12**. Pane visibility stays in localStorage.

**Testing**: Vitest 5 with four projects (`vitest.config.ts`): unit (node), component (jsdom),
integration and contract (serial forks). Playwright 1.63 on Electron runs under the two-way budget
ratchet (`packages/ui/tests/e2e/e2e-budget.json`), the tag guard (`e2e-tags.test.ts`) and the tier
plan (`parallel-plan.json`, `tier-plan.test.ts`). R13 has the layer map.

**Target Platform**: Windows 11 desktop. Keybindings are keyed by platform
(`SHIPPED_KEYBINDINGS_BY_PLATFORM`), so nothing here guesses a macOS or Linux chord.

**Project Type**: Desktop application. It is an npm-workspaces monorepo with three processes:
renderer, Electron main, and the detached daemon.

**Performance Goals**: none new. `listRows` is linear in the project count and recomputed per
render. Unload makes at most three daemon calls.

**Constraints**

- No chord may reach a shell (FR-010).
- No AltGr character may be swallowed (FR-021, R2).
- Unload must not touch a sub-workspace's panels (FR-037) or end a running process without the
  configured confirmations (SC-005a).
- The migration must be idempotent (Technology & Architecture Constraints).

**Scale/Scope**: 49 FRs across 5 stories. The change touches `core`, `persistence`, `daemon`,
`ipc-contract` and `ui`. `platform-windows` is untouched.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1.*

Constitution **v5.5.2**. Every principle and every workflow gate is assessed. None is skipped.

| Principle | Assessment |
|---|---|
| **I. Project-First Context Isolation** | **Engaged, satisfied.** Categories are presentation only (FR-060). They change no project's root, terminals or layout. Unload narrows what is loaded and never mixes projects. A switch made by a chord is the same `switchProject` a click makes, so the full swap of terminal set, folder view and colour is unchanged (FR-014). |
| **II. Platform-Abstracted Core** | **Engaged lightly, satisfied.** Every new pure rule lives in core with no OS knowledge: `project-list.ts`, `unload.ts` and `validateCategoryName`. `chordCandidates` reads `KeyboardEvent.code`, a W3C layout-independent name rather than an OS concept, and it lives in the renderer beside `chordKey`. No new port is needed. The default category's name is a core constant, not an OS value. |
| **III. Detached, Tagged & Persistent Terminals** | **Engaged squarely; this is the principle Unload is built on.** *Keep running* **is** the project-close rule: `closeIdle` closes idle shells and spares busy ones, with the daemon deciding at call time (R7). Reattach is the existing `attach {explicit:false}` path. *End terminals* is a user-commanded destroy like app close's option (B). Its views are detached **before** the kill (unload.md §2), satisfying "no orphaned terminal views". **Resource hygiene** requires a process-level E2E after **each** end path, and Unload is a new one, so a new `@reserve:process` declaration is added (R13). This is the one E2E the principle names explicitly. |
| **IV. Native Terminal Support & Auto-Detection** | **Engaged, and it changed a chord.** Ctrl+Alt+E failed the "any flavour" test on bash (`M-C-e`) and was replaced by Ctrl+Alt+F (R1, recorded in spec.md). None of the four chords is in the reserved or shadowable tier, and the recorded-exception list stays at four (FR-020), asserted in `keybindings.test.ts:132` and `terminal-reserved-keys.test.ts`. **One command, one chord across panel types**: each command is EVERYWHERE with one chord. **Parity across flavours**: no flavour-specific binding is added. Open item O1 records a pre-existing `Ctrl+Alt+M` vs `M-C-m` overlap and leaves it alone. |
| **V. Test-First Quality Discipline** | **Engaged, and satisfied as the text reads: the budget does not rise.** *(Superseded 2026-09-23, analysis C1: this row first read "satisfied with a +2 E2E rise". The principle says the budget "may fall and MUST NOT rise", and 044 ruled that "a recorded practice does not satisfy a NON-NEGOTIABLE MUST".)* Everything is test-first at the lowest layer (R13). Unit covers every pure rule; component covers the tree keyboard, menus, dialogs and focus commands; integration covers migration v9, drift heal, the version pin, category services and the daemon RPC filters. **E2E: +2 declarations, offset by −2 (573 → 573)**. The offsets come first. T048a removes `pane-shortcuts.e2e.ts:72`, an exact duplicate of `window-chord-resolution.e2e.ts:175`. T048b demotes `loaded-projects.e2e.ts:13` to a component test. Each offset's surviving test is observed failing against a broken implementation before the declaration goes (the 044 T163a – T163e pattern). Of the two added declarations, one is `@reserve:input`: Principle V's own example of what a synthesised event cannot prove is a layout-dependent chord, and Ctrl+Shift+0 on a real engine is exactly that. The other is `@reserve:process`: Principle III requires a process-level E2E per end path. Both are `@extended`, so the `@core` cap is untouched. The migration test includes the re-run assertion that the idempotency constraint requires. |
| **VI. Simple, Modern, Discoverable UX** | **Engaged heavily.** Assessed rule by rule below. |
| **VII. Change Review & Approval** | **Not engaged.** Nothing here writes a file or touches the edit list. Unload's discard path drops an unsaved buffer only after the same prompt Remove shows. |
| **VIII. SOLID, DRY & YAGNI** | **Engaged.** **DRY**: Remove's unsaved guard, the confirmation dialogs, `switchProject`, `closeIdle`/`killAll` and `reorder` are reused, not re-implemented; the cycle, the cog's disabled state and the tree rows come from one `listRows`/`stepProject`. **SRP**: `ProjectCategoryService` is separate from `ProjectService`; the unload orchestrator is one module with injected collaborators. **YAGNI**: no category position column, no category drag, no `projects.unload` RPC, no `sidebar` scope for the Sub-workspaces panel, no rebindable list-navigation commands. |
| **IX. Dependency Injection & Composition Root** | **Engaged, satisfied.** `ProjectCategoryRepository` and `ProjectCategoryService` are bound in the daemon's one composition root (`packages/daemon/src/composition-root.ts`) and injected into `ProjectIpcService` by constructor, as its four existing collaborators are (`project-service.ts:60-67`). The unload orchestrator takes its collaborators as parameters, following `confirmDelete`'s shape. |
| **X. Externalised Configuration** | **Engaged, satisfied.** The two unload settings are typed, injected and described. "In Progress" is `SHIPPED_DEFAULT_CATEGORY_NAME` in core, not a UI literal (FR-050). No timeout, limit or path is introduced. |
| **XI. Dockable Workspace** | **Engaged.** The Projects Panel becomes a focus target, as the File Explorer already is. *"A Panel whose original project no longer exists MUST be retained"*: Unload goes further, and leaves a sub-workspace's panels of a still-existing project untouched (FR-037, `exceptPanelIds`). *One document, one state* is unaffected: releasing a document removes its single authority entry (`disposeEditor`), and no second copy is ever created. Detached windows and the focus group are untouched. |

### Principle VI, rule by rule

| Rule | Assessment |
|---|---|
| **Common actions reachable without instruction** | **This is #332's reason for existing.** "Switch project" now has a chord and a menu route. |
| **Every panel action has a menu item** | **Satisfied.** Each of the four commands has a cog item (FR-019). Every project action has a row-menu item, and the inline controls remain accelerators (FR-031). Category minimise is both a header click and a menu toggle. |
| **One section vocabulary** | **Satisfied.** Every item declares a section ([menus.md](./contracts/menus.md)): Content, Destroy and View & state for rows and headers, and Navigate before Application in the cog, which gains its first real boundary. `menu-sections.test.ts` pins every new shape. |
| **Disabled when unavailable, absent when meaningless** | **Applied three times.** Unload on an unloaded project is **disabled**, because loading it would enable it (FR-038). Next and Previous at the ends are **disabled** (FR-019). Delete and Minimise on the default category are **absent**, because no state enables them (US5 scenario 4). |
| **One gesture follows a link** | **Not engaged.** No link surface is added. |
| **A preference picks the default; the menu offers every variant** | **Engaged, and it added two menu rows the spec did not name.** `projects.unloadTerminalAction` picks the variant, so the row menu carries the plain **Unload** plus **Unload and Keep Terminals Running** and **Unload and End Terminals** (R8). This is additive to FR-030 – FR-032, which say what the menu MUST offer and do not cap it. |

### Development Workflow & Quality Gates

| Gate | Assessment |
|---|---|
| **Incremental delivery** | **Not engaged.** Every story ships complete. There is no deferral and nothing goes to Complexity Tracking. |
| **Static analysis and linting** | Standing gate. `npm run gate` on a hosted runner is the only evidence of done-ness, reported with its run URL and SHA. |
| **Particular-scrutiny review** | **Engaged twice**: the **daemon/terminal process lifecycle** (Unload's `closeIdle` and `killAll`, and the new filter) and **persisted state** (migration v9). Review both against III and V. |
| **Documentation currency** | **Engaged** (FR-071). `README.md`: Highlights (categories, Unload) and Configuration (the two settings). `docs/quick-start.md`: §1 *Create a project* (menu, Unload, categories), the pane chord line at `:35`, and the *Keyboard reference* table at `:774-811` (four chords plus Ctrl+Shift+0). `CONTRIBUTING.md` and `docs/testing.md`: the rename, and the two new E2E declarations. `CHANGELOG.md` gets an entry. |
| **Configuration-editor completeness** | **Engaged.** Two settings descriptors, four keybinding descriptors and three icon-token copies. `settings-metadata.test.ts`, `keybindings-metadata.test.ts` and `theme-copy.test.ts` go red without them. |
| **Displayed quantities digit-grouped** | **Engaged once.** A category header's project count is a quantity and uses the shared formatter. The busy-process list in the unload dialog shows names, not counts. |
| **Themeable icon controls** | **Engaged.** The category toggle is an `IconButton` on the `chevron` token with a hover title (FR-061). Menu items carry theme icons, and three new tokens are added with descriptions and SVG art. Dialog buttons keep text labels (the stated exception). The inline ✎ and ✕ glyphs are pre-existing and not altered (spec Assumptions), so they stay out of scope. |

**Result: PASS.** No violation, nothing in Complexity Tracking, one chord replaced under FR-021, and
one constitutionally-required addition (the variant rows).

### Re-evaluation after Phase 1

Four findings changed the design. None changed the verdict.

- **III and XI together found the `exceptPanelIds` gap.** `closeIdle` and `killAll` filter on
  `projectId` only. A panel detached to a sub-workspace shares its origin project's id, so the first
  sketch would have closed a sub-workspace's terminals on Unload, in direct breach of FR-037 (R7).
- **VIII (DRY) plus the scope table found the F2 hazard.** Reusing `explorer` for the Projects pane,
  as the spec's Assumptions allowed, would have made F2 and Delete act on the File Explorer's
  selection. A sixth scope follows 043 R14 and 044 R16 (R3).
- **VI's variant rule added the two Unload variant rows.** Without them, a user at confirmations
  `none` could reach *End terminals* only through Settings (R8).
- **FR-026 read literally collides with FR-021.** Physical matching of `Ctrl+Alt+0` would swallow
  AltGr+0 (`}` German, `@` AZERTY). The Alt exclusion keeps both requirements true (R2, open item
  O2).

## Project Structure

### Documentation (this feature)

```text
specs/046-side-panes-and-project-list/
├── spec.md                          # FR-021 carries the recorded chord replacement
├── plan.md                          # this file
├── research.md                      # Phase 0 — R1–R14, open items O1–O3; round 1: R15–R22
├── data-model.md                    # Phase 1
├── quickstart.md                    # Phase 1
├── contracts/
│   ├── keybindings-and-focus.md     # FR-010–FR-027, FR-070
│   ├── project-categories.md        # FR-050–FR-061
│   ├── unload.md                    # FR-032–FR-038
│   └── menus.md                     # FR-001–FR-004, FR-019, FR-030/031, FR-053, FR-061
├── checklists/requirements.md
└── tasks.md                         # Phase 2 (/speckit-tasks)
```

### Source Code

Each block names the **owning area agent** (`.claude/agents/README.md`) so that tasks can be routed.

```text
packages/core/src/                                             ── throng-config-preferences
├── config/keybindings.ts          + 4 ActionIds, COMMAND_SCOPES, WINDOWS_BINDINGS (+Ctrl+Shift+0);
│                                    DispatchScope + 'projects'; EVERYWHERE, SCOPE_NAMES, SCOPE_ORDER
├── config/keybindings-metadata.ts + 4 descriptors (group 'View'); zoom.reset description
├── config/app-settings.ts         + confirmations.unloadProject, projects.unloadTerminalAction
│                                    (type, default, tolerant parse, clone); rename in description :422
├── config/settings-metadata.ts    + 2 descriptors (Confirmations); rename :202, :395
├── config/theme.ts, theme-copy.ts + icons unload / category / projectList; rename :128, :366, :422
├── config/shipped-defaults.ts     SHIPPED_DEFAULTS_VERSION 11 → 12
└── config/preview-settings.ts     rename :196
packages/core/src/                                             ── throng-core-architecture
├── projects/project-list.ts       NEW  listRows, reachableProjectIds, stepProject,
│                                        validateCategoryName, mergeIntoDefault
├── projects/categories.ts         NEW  ProjectCategory, SHIPPED_DEFAULT_CATEGORY_NAME,
│                                        ProjectCategoryService (+ store port)
├── projects/project.ts, project-service.ts   + categoryId; move()
├── workspace/unload.ts            NEW  planUnload
├── workspace/destroy.ts           + projectPanelIdsInSubWorkspaces
└── (comment-only renames)         explorer/exclude.ts, preview/registry.ts, terminal/drop-paths.ts,
                                   workspace/menu-sections.ts

packages/persistence/src/                                      ── throng-daemon-persistence
├── migrations/v9-project-categories.ts   NEW
├── migration-runner.ts            + v9
├── schema-guard.ts                + projects.category_id in ADDITIVE_COLUMNS
├── project-category-repository.ts NEW  (ensureDefault, list, create, rename, delete-merge, setMinimised)
└── project-repository.ts          + category_id read/heal, move()

packages/ipc-contract/src/                                     ── throng-daemon-persistence
├── projects.ts                    + ProjectDto.categoryId, ProjectCategoryDto, 6 methods
└── terminal.ts                    + exceptPanelIds on closeIdle / killAll params

packages/daemon/src/                                           ── throng-daemon-persistence
├── project-service.ts             + category and move handlers
├── terminal-service.ts            closeIdle / killAll: exceptPanelIds + rootless skip   ── throng-terminal-pty
└── composition-root.ts            bind the category repository and service

packages/ui/src/renderer/                                      ── throng-renderer-ui
├── app.tsx                        dispatch the 4 commands; chordCandidates; menu.open redirect for
│                                  project rows and headers; revealLeft/revealRight; rename :1003, :1012
├── config/chord-key.ts            + chordCandidates                                  (R2)
├── keybindings/scope.ts           'projects' scope; isPanelScoped exact matches
├── workspace/active-pane.ts       + 'projects'
├── panes/file-explorer-pane.tsx   header copy; focusin → setActivePane('files')
├── panes/panes.css                outline selector also covers the Projects pane body
├── sidebar/projects-panel.tsx     tree rows, category headers, keyboard, context menus, drag across
├── sidebar/project-menu.ts        NEW
├── sidebar/category-menu.ts       NEW
├── sidebar/unload-project.ts      NEW  orchestrator                                   ── throng-failure-notices (dialog copy)
├── state/projects-store.tsx       categories, unloadProject, moveProject, category actions
├── state/projects-client.ts       + 6 RPC wrappers
├── title-bar/cog-menu-items.ts    + Navigate section
├── title-bar/cog-menu.tsx         passes the dispatch callback and step state (T042)
├── explorer/file-tree.tsx         focusSelectedOrFirst() handle, if not already present (T039)
├── confirm-dialog.tsx             useChoose initial focus, only if missing (T073)
├── global.d.ts                    types for the terminal IPC additions (T070)
├── preferences/capture-modal.tsx  records chordCandidates[0]                         ── throng-config-preferences
└── (rename)                       workspace/panel-header-menu.ts, panel-type/editor-inputs.tsx and the
                                   remaining files listed in research.md R12
packages/ui/src/main/                                          ── throng-renderer-ui
├── icon-pack-service.ts           SVG_SHAPES for the 3 tokens
├── terminal-ipc.ts                closeIdle / killAll handlers, includeBusy on list (T070)
├── ../preload/preload.cts         exposes them (T070)
└── (comment-only renames)         editor-coordinator.ts:1786, node-file-watcher.ts:4, preview-service.ts:567

packages/ui/tests/e2e/                                         ── throng-e2e-harness
├── window-chord-resolution.e2e.ts + 1 declaration (@extended @window @reserve:input)
├── terminal-no-orphans.e2e.ts     + 1 declaration (@extended @terminal @reserve:process)
├── e2e-budget.json                573 → 573 (@window 196, @terminal 109), with reasons
├── pane-shortcuts.e2e.ts          − 1 duplicate declaration (T048a)
├── loaded-projects.e2e.ts         DELETED, demoted to component (T048b)
├── launch-sharing.md              two rows updated
├── parallel-plan.json             unchanged: both specs are already in the serial tier
└── (locator renames)              the ~25 specs that find the pane by its old accessible name

README.md, CONTRIBUTING.md, docs/quick-start.md, docs/testing.md, CHANGELOG.md   ── throng-spec-governance
```

**Structure Decision**: the existing monorepo layout, with no new package. The pure rules go to core,
the storage goes to persistence behind the daemon, and UI composition goes to the renderer, which is
where every earlier sidebar feature put its equivalents.

## Delivery order

The stories are independent in the spec. The order below minimises rework.

1. **US1, the rename.** Test locators change once, before later stories add new ones.
2. **The shared keyboard groundwork**: the `projects` scope, `ActivePane`, and `chordCandidates`.
   Both US2 and US3 need it.
3. **US3, Ctrl+Shift+0.** It is small and proves the matcher.
4. **US5's persistence (migration v9, RPCs) and US2.** US2's cycle depends on `listRows`, which
   needs categories to be meaningful, but it works with only the default category, so the two can
   proceed in parallel after the migration.
5. **US4, Unload**, last. It depends on the Projects pane's context menu, which US5 also extends.

Each story is releasable when its tests are green. None needs a deferral.
*(T153, 2026-09-25: still true of the stories. One pre-existing gap is recorded in Complexity
Tracking below — constitution III's idle-shell rule at app close, which no 046 story built and no
earlier feature delivered. It is a known violation tracked as an end-state requirement, not a
deferral of 046 scope.)*

## Complexity Tracking

~~No violations. The table is intentionally empty.~~ *(Analyze, 2026-09-24: pending T153. If T124
finds no app-close idle-shell close, T153 adds a row here for constitution III's idle-shell rule.)*
*(T153, 2026-09-25: T124 found none, so the row below is added. It is a **known violation that
predates 046**, recorded as an end-state requirement under Incremental Delivery.)*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **Constitution III / 005 FR-015b, idle-shell rule at app close — known violation, pre-existing.** No production path closes an idle shell when the application closes. The app-close prompt (`packages/ui/src/main/main.ts`, ~1925-1973) is raised for any live session, idle ones included; *Leave running* sends nothing, so every session survives, idle shells included, and reattaches on the next start instead of being re-created; *Terminate all* sends `terminal.killAll {}`. The daemon only registers the `terminal.closeIdle` handler (`terminal-service.ts:332`) and `terminal-ipc.ts:496` forwards it; nothing sweeps idle sessions at shutdown. `closeIdle`'s only production caller was 046's own Unload (`unload-project.ts`), removed by T128 (`ee8688bd`, `fc4c4fd2`) as FR-086 requires, so the RPC now has **no caller at all**. No app-close path has ever called it. **End-state requirement**: at app close, a session with no running process is closed and re-created in a fresh process on the next start (III, 005 FR-015b); 046 FR-086's app-close clause restates it for kept shells. **Expected to complete it**: a dedicated terminal-lifecycle fix, tracked as: not filed — unreproduced; recorded in PR #440's description for the maintainer to reproduce and file; no spec owns it yet, and it takes the next free spec number if one is written once a fix is scoped. | 046 does not need the violation; it inherits it. Building the app-close idle sweep is outside 046's scope (US4 is Unload, not app close), and the daemon side (which sessions are idle at shutdown, and the prompt's trigger) belongs to the terminal lifecycle, not to the Projects pane. | Building it inside 046 was rejected: it changes the app-close prompt's trigger and the daemon's shutdown path, which no 046 story, test or supersession covers, and would widen a round already carrying the keybinding convention. Recording it as compliant was rejected because the source shows otherwise (T124). |

## Iterate round 1 (Session 2026-09-23, after hand-testing)

> **Superseded in part (2026-09-24).** This section and its two subsections were written against the
> "modifier families" and then the second-review tiers. Their chord rows (FR-076 – FR-080,
> FR-089 – FR-100), the End Terminals confirmation (FR-085) and the "no layer change in main"
> assumption no longer hold. The last section of this file is the current plan. What still stands
> here: FR-072 – FR-075 and FR-081 – FR-087 as layer notes, migration v10, and "E2E flat at 573".

The maintainer hand-tested the feature and asked for changes. Spec FR-072 – FR-088 carry them. The
constitution moved to **v5.6.0** in the same round (III Unload exception, IV modifier families plus
the `Ctrl+Shift+-` exception, VI chords without menu items). The Constitution Check above was
written against v5.5.2. Re-read against v5.6.0 it still passes: the only non-compliant items are
this round's own targets, the eleven chords IV lists and the branch's Keep running closing idle
shells. `/speckit-tasks` owns the task list, so this section says what changes per layer and at
which test layer. It does not enumerate tasks.

| Layer | What changes | Lowest test layer |
|---|---|---|
| `@throng/core` config | FR-077's remap in `WINDOWS_BINDINGS`. A panel-or-global classification per `ActionId` with a guard (FR-076). `focus.explorer` / `focus.projects` move to Focus & Zoom (FR-087). Shipped-defaults **version 13**: the guarded keybinding rewrite (v11 or v12 value only, collision-refused, idempotent) and the new category-header background token (FR-072, FR-079) | unit: `keybindings.test.ts`, a new convention guard, `terminal-reserved-keys.test.ts` (exception list four → five), `shipped-defaults` upgrade tests with the re-run assertion |
| renderer keyboard | `chordCandidates` gains physical Equal/Minus with Ctrl+Shift and no Alt (FR-078). The window listener keeps dispatching `zoom.reset` to the window zoom and `panel.zoomReset` to the store (FR-080) | unit: `chord-key` candidates. Component: the window listener dispatches the right command per chord, and `zoom.reset` never touches the per-panel store |
| main process | None expected: `resetZoom` is already `setZoomLevel(0)`. If R16's probe shows otherwise, that is the fix site | integration: the IPC handler resets the sender's zoom level |
| title bar | The cog menu drops its `navigate` section and returns to Application only (FR-074) | unit: `menu-sections.test.ts` pins the single section again |
| sidebar | Two Unload rows driven by the preference (FR-081). `unload-project.ts` loses the choose dialog: keep never prompts, end confirms per level only while a process runs (FR-085). Keep running stops calling `closeIdle` (FR-086). A list click or Enter keeps the Projects pane active, and `PanelFocusSync` stops claiming the workspace for list-initiated switches while chord switches leave the pane alone (FR-082). Whole-row drag start excluding interactive controls (FR-075). Category header style (FR-072). Header drag and Move Category Up / Down (FR-083) | component: project menu rows per preference value; the unload flow with a stub terminal RPC (no dialog on keep; confirmation count per level on end; none with idle-only); active pane after click and after Enter; drag start from the name vs from Edit; header menu enable/disable/absent |
| panes CSS | Side-pane active outline 1px, the pane's default border width (FR-073) | component can only read the class. The painted width is layout, so it rides on an existing `@reserve:layout` declaration if one covers the pane, and is otherwise claimed at class level only |
| persistence / daemon | Migration **v10**: a category position column seeded from creation order, a reorder RPC, and append-on-create (FR-084). v9 untouched | integration: v10 on a v9 store, re-run idempotency, schema-drift guard heal, reorder persistence across a reopened database |
| daemon terminals | Unload-keep stops reaping idle shells. The kept sessions reattach on load (FR-086) | integration: the session survives, and attach returns the same session id |
| docs | FR-088 | — |

**E2E budget stays flat at 573** (Principle V: the ratchet MUST NOT rise). No new declaration is
added. Two existing ones change their assertions in place:

- `window-chord-resolution.e2e.ts` (T049, `@reserve:input`): its real presses become Ctrl+Alt+0
  (app-wide reset), Ctrl+Shift+0 (panel reset) and Ctrl+Alt+D (focus explorer), still from a focused
  real terminal whose write log must stay empty. The `@core` declaration that proves Ctrl+Shift+F /
  Ctrl+Shift+H reach the resolver through the keepShift **letter** branch loses its subject when both
  move to Ctrl+Alt. Its assertion moves to a Ctrl+Shift+letter window chord that still exists, or,
  if none does, the declaration is rewritten to press Ctrl+Alt+F / Ctrl+Alt+H and the letter branch
  is pinned at unit level. This decision is for `/speckit-tasks`, and the budget is unchanged either
  way.
- `terminal-no-orphans.e2e.ts` (T065, `@reserve:process`): the Keep running half now asserts that
  the idle shell **survives** and reattaches as the same process (FR-086), instead of asserting that
  the conhost count returns to baseline. The End Terminals half keeps its reaping assertion.

Everything else in the round is unit, component or integration.

**Delivery order for the round**: the core remap and the upgrade first, since every chord test reads
them. Then the renderer keyboard (FR-078/FR-080). Then the sidebar and unload flow (FR-081,
FR-085, FR-086, FR-082). Then v10 and category reordering (FR-083/FR-084). Then the style changes
(FR-072/FR-073/FR-075). Docs last (FR-088).

**Deferrals**: none. Every item lands in this round.

### After the maintainer's review of the remap (FR-089 – FR-093)

- **Fewer rows move.** Quick Open, Find / Replace in Files, Save All, Save As and `focus.explorer`
  keep their chords (FR-089). The convention guard carries those five as its exhaustive exception
  list. `window-chord-resolution.e2e.ts`'s Ctrl+Shift+F / H letter-branch declaration therefore
  keeps its subject unchanged, and its presses of Ctrl+Alt+F for `focus.explorer` stay.
- **Keypad** (FR-090): the renderer keyboard gains a keypad physical candidate that keeps Shift,
  and the capture modal records keypad tokens. Tested at unit level (`chordCandidates`) and component
  level (the window listener dispatches Ctrl+Shift+Num + to `panel.zoomIn`; the capture modal
  records the keypad token).
- **Two-stroke chords** (FR-091/FR-092), a new capability owned by core config and the editor:
  - two-stroke token parse, format and normalise, the collision rule for a first stroke, the
    no-terminal-scope guard, and the Ctrl+Alt+W → Ctrl+E W upgrade (unit);
  - `toCodeMirrorKey` bridging to CodeMirror's native prefix keymap (unit);
  - the pending indication, Escape cancel, and consumption of an unbound second stroke in a
    mounted editor (component);
  - the capture modal recording a second stroke (component).
- **Replace All** (FR-093): the defect report is reproduced first by a component test through
  `SearchKeybindings` (replicating-bugs), with focus in the find field, the replace field and the
  document. It steps up to E2E (`@reserve:input`) only if that passes while the maintainer still sees
  the defect.
- **E2E budget still flat at 573.** Nothing here needs a new declaration.

### After the maintainer's second review: three modifier tiers (FR-094 – FR-100)

The Ctrl+Shift-panel / Ctrl+Alt-global convention is replaced by three tiers, and constitution 5.6.0
IV is revised before publication.

**What this undoes**:
- The window zoom and the panel zoom keep their master chords. `zoom.reset` loses Ctrl+Shift+0.
- There are no keypad tokens and no Equal/Minus physical rule, so FR-078 and FR-090's mechanism are
  withdrawn.
- Replace All stays on Ctrl+Alt+Enter.
- The `Ctrl+Shift+-` terminal exception is gone.

**What this adds**:
- Navigation moves to Ctrl+Shift (FR-095), with the matcher changes of FR-097 (keep Shift for
  PageUp, PageDown and Tab; physical brackets).
- One Shift rule for `+` / `-` across every resolver and the capture modal (FR-098).
- A tier guard with an exhaustive exception list (FR-094 / FR-096).
- Version 13's rows (FR-100).

**Test layers**:
- unit: the tier guard, the collision check, `chordCandidates` for PageUp/PageDown/Tab and the
  brackets, `captureToken` for main-row vs keypad `+`, and the v13 upgrade with its re-run;
- component: the window listener dispatching each new navigation chord from a terminal-scoped and an
  editor-scoped focus, and the capture modal recording both `+` keys the same.

**E2E, flat at 573**: `window-chord-resolution.e2e.ts` (T049, `@reserve:input`) changes its presses
in place:
- Ctrl+0 for the window reset;
- Ctrl+Alt+0 for the panel reset;
- Ctrl+Shift+E for the File Explorer;
- Ctrl+Shift+] for the next project;
- its focus-cycling declaration presses Ctrl+Shift+PageDown / PageUp;
- its pane-toggle declaration presses Ctrl+Shift+B / N;
- the `@core` Ctrl+Shift+F / H letter-branch declaration is unchanged.

The declaration pressing Ctrl+Shift+0 from a real terminal is rewritten to press Ctrl+Alt+0, which
is still a layout-dependent digit chord a real engine must report. Its reserve entry stands.

*Superseded by the next section (checkpoint 2026-09-24). None of the second-review chords ships.*

## Iterate round 1: the agreed convention (checkpoint 2026-09-24)

**This is the current plan for the round.** It covers spec FR-072 – FR-075, FR-080 – FR-087 and
FR-091 – FR-093 where they still stand, and FR-101 – FR-112. It also covers SC-010's upgrade clause,
SC-011, SC-012 and SC-014 – SC-016. It plans nothing for the superseded FR-076 – FR-079 rows,
FR-085's End Terminals bullet, FR-089, FR-090 or FR-094 – FR-100, except where a superseding FR
needs shipped code undone (`zoom.reset`'s `Ctrl+Shift+0`, the unload dialogs,
`confirmations.unloadProject`).

### Where the code stands (audited 2026-09-24 at `25fe6911`)

Read from the code, not inferred from the specs:

- **Nothing in the round is built yet except `3b04ec33`**, which adds `tabs.openPicker` to
  `isPanelScoped` with a unit test. Every other commit since `327e870c` is spec or constitution.
- **Keybindings.** `WINDOWS_BINDINGS` (`keybindings.ts:373-533`) still holds the pre-round Ctrl+Alt
  set, plus `zoom.reset`'s `Ctrl+Shift+0`. `SHIPPED_DEFAULTS_VERSION` is 12
  (`shipped-defaults.ts:204`), and the only keybinding upgrade is v12's `zoom.reset` row
  (`planKeybindingsUpgrade`, `:609-626`). No test classifies `ActionId`s by tier.
- **Matching.** `chordCandidates` matches `Digit0`–`Digit9` physically only with Ctrl held and Alt
  not held (`chord-key.ts:51`). It has no tier-1 rule, no keypad mapping and no `metaKey` field. The
  capture modal records `chordCandidates(e)[0]`. Every renderer resolver already goes through
  `resolveKeydown`, so one change in `chord-key.ts` reaches all of them.
- **Two-stroke chords.** No support anywhere. `toCodeMirrorKey` is at `editor/commands.ts:612`.
- **Gestures.** `registerMouseZoom` (`renderer/main.tsx:44-61`) hard-codes Ctrl+wheel and
  Ctrl+middle-click to the **window** zoom, and never reads the keybindings. So the `Ctrl+WheelUp`
  and `Ctrl+MiddleClick` tokens are decorative today. That is a Principle X gap as well as FR-106's
  target.
- **Scope.** `isPanelScoped` (`keybindings/scope.ts:176-223`) exempts `zoom.`, `panel.`, `focus.`
  and `view.` by prefix, and six exact ids. `menu.open` is EVERYWHERE and not exempt. `scope.test.ts`
  has no loop over every EVERYWHERE command.
- **Cog menu.** It still has the Navigate section (`cog-menu-items.ts:42-74`) and no Zoom row. The
  icon tokens `zoomIn`, `zoomOut` and `zoomReset` already exist (`theme.ts:400-402`).
  *Superseded (Session 2026-09-25, FR-113): the round never adds a Zoom row. The maintainer withdrew
  it mid-build ("Remove the new "Zoom" options from the menu."), so this gap-analysis line's "no
  Zoom row" stays true after the round too — Navigate is still removed (FR-074), but nothing
  replaces it. The cog menu ends at `[application]` only.*
- **Unload.**
  - `unload-project.ts:158-195` still shows the choose dialog and the `confirmEnd` step.
  - Keep running still calls `terminal.closeIdle` (`:224`).
  - `confirmations.unloadProject` is still a setting (`app-settings.ts:434`,
    `settings-metadata.ts:175`).
  - The project menu has three Unload rows (`project-menu.ts:61-79`).
- **Projects pane.**
  - Category headers are already bold and uppercase (`theme.css:527-538`), but have no background
    token.
  - The active outline is 2px (`panes.css:47-55`).
  - Drag starts from the grip only (`projects-panel.tsx:68-86`).
  - `PanelFocusSync` calls `setActivePane('workspace')` on every active-tab change (`app.tsx:652-677`).
  - Focus File Explorer and Focus Projects are in the Key Bindings editor's `View` group
    (`keybindings-metadata.ts:106-129`).
- **Categories.** Migrations stop at v9. There is no category position column, no reorder RPC, no
  Move Up/Down, and headers are not draggable.
- **E2E.** The budget is 573 (`@core` 39). Literal presses of moved defaults are in:
  - `window-chord-resolution.e2e.ts` (`:77`, `:87`, `:523`);
  - `notice-focus-chord.e2e.ts`, `tab-picker.e2e.ts`, `transient-overlays.e2e.ts` and
    `tab-scroll.e2e.ts`;
  - `pane-shortcuts.e2e.ts:118`, `editor-word-wrap.e2e.ts`, `move-focus.e2e.ts` and
    `status-bar-visibility.e2e.ts`.

  The rest press `chordFor(action)`, which follows the defaults.

**Already implemented this round**: FR-110's `tabs.openPicker` fix (`3b04ec33`), and FR-072's bold
and uppercase half. **Not implemented**: everything else in the round.

### Technical Context, deltas

- **Storage**: migration **v10** (`project_categories.position`, additive, seeded, idempotent;
  `LATEST_VERSION` 9 → 10). `SHIPPED_DEFAULTS_VERSION` **12 → 13**: FR-108's guarded keybinding
  rewrite plus the additive `categoryHeaderBackground` colour token (FR-072). One settings leaf is
  withdrawn (`confirmations.unloadProject`). A withdrawn leaf needs no version bump: the write path
  keeps an unmodelled key.
- **No new runtime dependency.** Two-stroke chords reuse CodeMirror's native prefix keymap
  (research R19), and the pending indication is renderer UI.
- **Main process.** It gains at most one read of the window zoom level for the cog row's disabled
  states. It already has `throng:zoomBy` / `throng:zoomReset` (`main.ts:273-296`).

### Constitution Check (v5.6.0), for this round

*GATE: evaluated before the round's design and re-evaluated after it. Every principle and gate is
assessed.*

| Principle | Assessment |
|---|---|
| **I. Project-First Context Isolation** | **Engaged lightly, satisfied.** Keep Terminals Running keeps a project's own sessions for that project's next load. It never reattaches them to another project. Category order is presentation only (FR-060). |
| **II. Platform-Abstracted Core** | **Satisfied.** The pure rules live in core with no OS knowledge: two-stroke parse, format and normalise, tier classification, the FR-105 same-binding normaliser, v13 and category reorder. `KeyboardEvent.code` is a W3C name, and it stays in the renderer's `chord-key.ts`. |
| **III. Detached, Tagged & Persistent Terminals** | **Engaged squarely.** Keep Terminals Running keeping idle shells is v5.6.0 III's **stated exception** (FR-086, S10), and it is scoped to Unload: app close and project close keep FR-015b. *Corrected at analyze, 2026-09-24: whether app close closes an idle shell at all is an open question. No production path calls `closeIdle` at app close, so T124 records the answer and T153 lands it; if it is a gap, it is a pre-existing one against III, recorded in Complexity Tracking and an issue rather than claimed as compliance.* *T153, 2026-09-25: it is a gap. No production path closes an idle shell at app close, and after T128 `closeIdle` has no caller. Recorded as a pre-existing known violation in [Complexity Tracking](#complexity-tracking), tracked as: not filed — unreproduced; recorded in PR #440's description for the maintainer to reproduce and file; 046 does not satisfy FR-086's app-close clause and does not claim to.* End Terminals still detaches the views before `killAll`. **Resource hygiene**: the process-level E2E for Unload (`terminal-no-orphans.e2e.ts`, T065) stays one declaration per end path. Its keep half now asserts that the idle shell **survives as the same process**, and its end half still asserts reaping. The kept shells still end on project delete and under "terminate all" on app close. |
| **IV. Native Terminal Support & Auto-Detection** | **Engaged squarely. This is the round's main subject.** **Tiers**: a new unit guard gives every `ActionId` a tier and holds FR-103's exhaustive exception list (FR-101). **Tier-1 physical matching**: one rule in `chordCandidates`, used by every resolver and by the capture modal (FR-104). **One chord per command, plus one gesture**, with `menu.open` the only exception. The keypad `+`, `-` and `0` are the same binding, and no `Numpad…` token exists (FR-105). **Group consistency**: each zoom trio shares its modifiers. **Multi-stroke**: `Ctrl+E` is reserved, so `Ctrl+E W` is EDITOR_ONLY, and a guard refuses a two-stroke binding on any terminal scope (FR-092). **Terminal tiers**: no tier-1 default is reserved or shadowable, and the exception list stays at four (FR-109). **AltGr disclosure duty**: R22 names Polish `Ń` on N, but the fourth-level check for B, F, M, P and T on the seven layouts is marked *owed*, so a task completes it before the docs ship. **FR-021's line-editor check** of tier 1's `CSI 1;8` arrows is also owed. It is a live `bind -p` / `Get-PSReadLineKeyHandler` hand check, as O3 was. **The `AltGraph` decline** stays a hypothesis. No decline is coded until a probe settles it. The probe (T149) gates the gate (T150): if AltGraph holds, T151 / T152 add the decline first; if it does not, the disclosure is the whole answer, as the constitution's follow-up TODO allows *(corrected at analyze, 2026-09-24)*. **Known violations**: FR-102 resolves the whole list IV enumerates. |
| **V. Test-First Quality Discipline** | **Engaged. Satisfied, with the budget flat at 573.** Every GREEN task follows the RED task that proves it, at the lowest layer: unit for the guards, matching, parse, planner and v13; component for the resolvers, capture modal, editor prefix, gestures, cog row, menus, unload flow and Projects pane; integration for v10, reorder persistence, the seed upgrade and a kept session's reattach. The three reported defects get a **repro test first**, shown failing before any production change (replicating-bugs): the project-click flash, the Keep Terminals Running prompt, and Keep Terminals Running closing terminals. So does FR-093's Replace All finding. **No E2E declaration is added or removed.** `terminal-no-orphans.e2e.ts` and `window-chord-resolution.e2e.ts` change their assertions in place, and the other literal presses are re-pointed. v10 and v13 each carry the re-run assertion. |
| **VI. Simple, Modern, Discoverable UX** | **Engaged.** *A chord MAY stand without a menu item*: the cog loses Navigate (FR-074). *Every panel action has a menu item*: panel zoom keeps its panel-header items, and the gestures are accelerators. *Disabled when unavailable, absent when meaningless*: the Zoom row's controls at their bounds and at 100%; Move Category Up / Down at the ends, absent on the default category; both Unload rows disabled when unloaded. *A preference picks the default; the menu offers every variant*: the plain Unload row applies the preference, and the second row is the other variant, so both remain reachable (FR-081). *One section vocabulary*: `menu-sections.test.ts` pins the cog's `[viewState, application]`, the project menu and the category menu's `navigate` section. *Superseded (Session 2026-09-25, FR-113): there is no Zoom row, so its disabled-at-bounds clause does not apply — the window zoom has no menu or mouse route at all, only its keyboard chords. `menu-sections.test.ts` pins the cog's `[application]`, not `[viewState, application]`. The rest of this row is unaffected.* |
| **VII. Change Review & Approval** | **Not engaged.** |
| **VIII. SOLID, DRY & YAGNI** | **Engaged.** Withdrawing `confirmations.unloadProject` removes a preference that changes nothing (FR-111). The tier-1 rule is written once in `chord-key.ts`. The gestures resolve through the keybindings rather than a second hard-coded path. ~~The Zoom row dispatches through the chord handlers.~~ *Superseded (Session 2026-09-25, FR-113): there is no Zoom row; the window zoom's chord handlers dispatch from the keyboard only, with no menu-side caller to be DRY about.* **YAGNI**: sequences longer than two strokes, local-key labels (`getLayoutMap`) and a category position for the default are all out. |
| **IX. Dependency Injection & Composition Root** | **Satisfied.** Reorder is a method on the already-bound `ProjectCategoryService` and repository, so no new binding is needed. The unload orchestrator keeps its injected collaborators, with fewer of them. |
| **X. Externalised Configuration** | **Engaged.** The gestures become real, editable bindings (003 FR-033, FR-106), which closes the hard-coded `registerMouseZoom` gap. The header background is a theme token with a description, shipped by v13. Every new default goes through v13's guarded rewrite, and user rebinds stay byte-identical (FR-108). |
| **XI. Dockable Workspace** | **Engaged.** A gesture zooms **the panel under the pointer** by its panel type (012 FR-008). FR-082 keeps the Projects pane active after a list switch, and the workspace activates only on its existing routes. |

| Gate | Assessment |
|---|---|
| **Incremental delivery** | **Nothing is deferred**, pending T153 (the app-close idle-shell question, III row). *T153, 2026-09-25: nothing of 046's scope is deferred. One pre-existing known violation is recorded under this rule: III's idle-shell rule at app close, an end-state requirement in [Complexity Tracking](#complexity-tracking) with the completing work named there; not filed — unreproduced; recorded in PR #440's description for the maintainer to reproduce and file.* Two items are hand checks for the maintainer rather than deferrals: the `AltGraph` probe and the `CSI 1;8` line-editor check (T149). *Corrected at analyze, 2026-09-24:* both gate T150. FR-104 requires the `AltGraph` answer before tier 1 ships, so if it holds, T151 / T152 add the decline first; if it does not, the disclosure is the whole answer. FR-102 requires the line-editor check for the tier-1 arrow chords, and a bound `1;8` arrow means FR-021's replacement lands before the gate. |
| **Static analysis and linting** | Standing gate. `npm run gate` on a hosted runner, with its run URL and SHA. |
| **Particular-scrutiny review** | **Persisted state** (v10, v13) and **the terminal lifecycle** (Keep no longer calls `closeIdle`). |
| **Documentation currency** | **Engaged** (FR-112). `README.md`, `docs/quick-start.md` (the keyboard reference first), `CONTRIBUTING.md`, `docs/testing.md` and `CHANGELOG.md`. |
| **Configuration-editor completeness** | **Engaged.** The new colour token's descriptor and copy. The `confirmations.unloadProject` descriptor leaves together with its leaf, so the completeness test agrees. The Focus & Zoom group (FR-087). |
| **Displayed quantities digit-grouped** | Not engaged. A zoom percentage stays below 1,000. |
| **Themeable icon controls** | **Engaged.** ~~The Zoom row's three controls are `IconButton`s on the existing `zoomOut`, `zoomReset` and `zoomIn` tokens, with hover titles.~~ *Superseded (Session 2026-09-25, FR-113): there is no Zoom row, so no icon controls are added for it; the `zoomIn` / `zoomOut` / `zoomReset` tokens stay unused by this round.* The capture modal's two-stroke control (T108, derived) is an `IconButton` on the existing `add` token, hover title *Add a second stroke*. No new icon token. |

**Result: PASS.** Nothing goes in Complexity Tracking, pending T153. *(T153, 2026-09-25: PASS
with one recorded known violation. Complexity Tracking carries III's idle-shell rule at app close,
pre-existing; not filed — unreproduced; recorded in PR #440's description for the maintainer to reproduce and file. Nothing 046 builds adds to it.)* The one item the round must finish before
docs ship is R22's AltGr+Shift fourth-level check (IV's disclosure duty). *Corrected at analyze,
2026-09-24:* before the gate, the round must also have T149's two probes and, if AltGraph holds,
T151 / T152.

**Re-evaluation after the design.** Three findings came from auditing the code.

- **X found the decorative gesture tokens.** Moving the gestures to the panel is not a rebind: the
  renderer never read them. FR-106 needs a keybinding-driven resolver in place of
  `registerMouseZoom`.
- **IV's one-chord rule and FR-108's collision guard need one normaliser.** It compares tokens the
  way FR-104 / FR-105 resolve them (`Ctrl+Alt+=` ≡ `Ctrl+Alt++`, gestures included). It lives in
  core beside `chordCollisions`, so the guard, the upgrade and the capture modal's warning share it.
- ~~**VI's disabled-at-bounds rule for the Zoom row needs the window zoom level in the renderer.**
  Today it lives only in main. The plan adds one read, and nothing else in main.~~ *Superseded
  (Session 2026-09-25, FR-113): there is no Zoom row, so no disabled-at-bounds state is ever
  computed for it, and the renderer needs no read of the window zoom level. Main's
  `throng:zoomBy` / `throng:zoomReset` are unchanged, but nothing new reads them.*

### Layers, and the lowest test for each

| Area | Change | Lowest test layer |
|---|---|---|
| core keybindings | Two-stroke tokens: parse, format and normalise; first-stroke collision; the no-terminal-scope rule (FR-092). The FR-102 remap. The FR-087 groups. The tier guard and the one-chord / no-Numpad guard (FR-101, FR-103, FR-105). The same-binding normaliser in `chordCollisions` | unit(core): a new `keybindings-two-stroke.test.ts` and `keybindings-tiers.test.ts`, the extended `keybindings-collision.test.ts` and `terminal-reserved-keys.test.ts`, and the re-pinned `keybindings.test.ts`, `keybindings-focus-notice.test.ts` and `keybindings-metadata.test.ts` |
| core shipped defaults | v13: FR-108's rows from v11 or v12 values, a collision refusal on normalised tokens including gestures, idempotence, and the `categoryHeaderBackground` token | unit(core): a new v13 upgrade test and `theme-link-tokens.test.ts` (12 → 13). integration(ui): `shipped-defaults-seed-upgrade.test.ts` |
| renderer matching | The tier-1 physical rule with the `metaKey` decline. `+`, `-` and `0` as the same binding in every resolver. The capture modal records physical tier-1 tokens, keypad presses the same as the main row, and a second stroke | unit(ui): `chord-candidates.test.ts`, `renderer-chord-resolvers.test.ts`, `window-chord-manifest.test.ts` and `window-chords-parser.test.ts`. component: `physical-key-chords-every-resolver.test.ts` and `preferences-capture-modal.test.ts` |
| editor | `toCodeMirrorKey` for two strokes; the pending indication, Escape, the unbound second stroke and the 4 s timeout | unit(ui): `commands.test.ts`. component: a new editor two-stroke test |
| gestures | A keybinding-driven resolver: the panel under the pointer, consumed, nothing over the title bar or side panes | component: a new mouse-zoom test |
| zoom routing (FR-080) | `zoom.reset` goes to the window, `panel.zoomReset` to the store, from terminal and editor focus | component: `window-zoom-reset-shift.test.ts`, rewritten in place for `Ctrl+Shift+Alt+Numpad0` *(superseded, FR-114: was `Ctrl+Shift+Alt+0`)* |
| scope (FR-110) | Every EVERYWHERE command is exempt or on an explicit panel-scoped list. `menu.open` is classified | unit(ui): `scope.test.ts` |
| cog menu | ~~Navigate removed. The Zoom row (FR-107) and the window zoom level exposed to the renderer~~ *Superseded (Session 2026-09-25, FR-113): Navigate removed, no Zoom row added, no window zoom level exposed to the renderer* | unit(ui): `menu-sections.test.ts`. ~~component: a new cog Zoom-row test and `title-bar.test.ts`~~ *(no Zoom-row test; `title-bar.test.ts` covers only the unaffected surfaces)* |
| unload | Two rows; no dialogs; Keep never calls `closeIdle`; the setting withdrawn; the planner reduced | unit(core): `unload-plan.test.ts`, `app-settings-unload.test.ts` and `settings-metadata.test.ts`. component: `unload-project.test.ts`, a new keep-terminals test, `projects-panel-menu.test.ts` and `preferences-unload-settings.test.ts`. integration(daemon): a kept idle session reattaches as the same session. E2E in place: `terminal-no-orphans.e2e.ts` |
| Projects pane | The list-initiated switch keeps `projects` (FR-082). Whole-row drag (FR-075). The header background (FR-072). Header drag plus Move Up / Down (FR-083). The 1px outline (FR-073) | component: `project-switch-active-pane.test.ts`, `projects-panel-drag-categories.test.ts`, `projects-panel-categories.test.ts`, `projects-panel-category-menu.test.ts` and a new header-reorder test. unit(ui): a CSS-source test for `panes.css` (CRLF-tolerant) |
| persistence / daemon / ipc | v10, `projects.categories.reorder` and append-on-create | integration(persistence): a new `migration-v10-category-position.integration.test.ts`, plus the version pin, the drift repair and the repository test. unit(core): `project-category-service.test.ts` |
| Replace All (FR-093 finding) | A repro at component level through `SearchKeybindings`, with focus in each of the three places | component |
| E2E | Literal presses re-pointed. `window-chord-resolution.e2e.ts` presses tier-1 chords from a real terminal, including `Ctrl+Shift+Alt+Numpad0` for `zoom.reset` *(superseded, FR-114: was `Ctrl+Shift+Alt+0` under the tier-1 `@reserve:input` digit case; `Numpad0` is its own physical token, not folded into the digit rule, per T164)* | the named declarations only, `--workers=1` |
| docs | FR-112 and R22's disclosure | — |

**E2E budget: flat at 573, `@core` 39.** No declaration is added or removed, and `e2e-budget.json` and
`parallel-plan.json` are untouched. Playwright presses the physical key for a tier-1 chord
(`Control+Shift+Alt+Equal`, not `+`), and the shared `window-chords.ts` helper translates
`Ctrl+E W` into two presses.

### Delivery order for the round

1. The core keybinding model: two-stroke tokens, then the remap and guards, then v13. Every
   renderer test reads them.
2. Persistence v10 and the reorder RPC, in parallel with step 1 (disjoint files).
3. Renderer matching and the capture modal, then scope. The two-stroke editor and the gestures
   follow.
4. The cog menu, the Unload flow, then the Projects pane (FR-082 first, because its repro is a
   reported defect). Then category reorder UI, the header style and the outline.
5. Replace All repro. Then E2E re-pointing, run one named declaration at a time.
6. Docs, R22's disclosure, the maintainer's hand checks (and T151 / T152 if the `AltGraph` probe
   holds), then the gate.

**Deferrals**: none. Complexity Tracking stays empty, pending T153. *(T153, 2026-09-25: no 046
deferral. Complexity Tracking carries one pre-existing known violation, III's idle-shell rule at
app close; not filed — unreproduced; recorded in PR #440's description for the maintainer to reproduce and file.)*

## Iterate round 3: the B / N / M focus row and a route back to the workspace (2026-09-25)

**This is the current plan for the chords it names.** It covers spec FR-116 – FR-119, SC-018 and
supersession S27, and is built as tasks.md Phase 13 (T172 – T188). FR-120 (the Numpad0 reset
defect) is kept separate from it and is not planned here.

**What it supersedes, in this file.** Every chord below is a record of an earlier round and is left
as written:
- *Summary*, #332: "`focus.explorer` ships **Ctrl+Alt+F**". It became `Ctrl+Shift+Alt+F` at round 1
  (FR-102) and is now **Ctrl+Shift+Alt+M**. `focus.projects` is now **Ctrl+Shift+Alt+B**.
- The first Constitution Check's IV row (Ctrl+Alt+F, and O1's `Ctrl+Alt+M` overlap). `focus.notice`
  is now **Ctrl+Shift+Alt+V**, so O1's `Ctrl+Alt+M` question no longer concerns any shipped default.
- *Iterate round 1 (Session 2026-09-23)* and its remap subsection: the Ctrl+Alt+F presses kept for
  `focus.explorer`. The E2E declaration now presses `Ctrl+Shift+Alt+M` through `chordFor()`.
- *Where the code stands*: Focus File Explorer / Focus Projects are in **Focus & Zoom** (FR-087),
  and so is the new Focus Workspace.
- *Technical Context, deltas*: `SHIPPED_DEFAULTS_VERSION` is now **14**, not 13.

**The change** (FR-117, all tier 1, physical key):

| Command | v13 | Now |
|---|---|---|
| `focus.projects` | Ctrl+Shift+Alt+P | Ctrl+Shift+Alt+B |
| `focus.workspace` (new, FR-116) | — | Ctrl+Shift+Alt+N |
| `focus.explorer` | Ctrl+Shift+Alt+F | Ctrl+Shift+Alt+M |
| `view.toggleProjects` | Ctrl+Shift+Alt+B | Ctrl+Shift+Alt+J |
| `view.toggleExplorer` | Ctrl+Shift+Alt+N | Ctrl+Shift+Alt+K |
| `focus.notice` | Ctrl+Shift+Alt+M | Ctrl+Shift+Alt+V |

`Ctrl+Shift+Alt+F` and `Ctrl+Shift+Alt+P` are unbound. The design detail is in
[data-model.md](./data-model.md) §4 and [contracts/keybindings-and-focus.md](./contracts/keybindings-and-focus.md) §5.

- **core** (`keybindings.ts`, `keybindings-metadata.ts`): `focus.workspace` joins `ActionId`,
  EVERYWHERE, tier 1, Focus & Zoom, label *Focus Workspace*, with a description that names no chord.
- **core** (`shipped-defaults.ts`, FR-118): version **14**, a keybindings payload only. A frozen
  `V13_KEYBINDINGS` copy joins `planFR108Rows`' guard sources; targets stay the live defaults; the
  fixed-point collision guard is unchanged; and `focus.workspace: []` is written where it is absent
  and `Ctrl+Shift+Alt+N` collides with a binding that is not moving. Version 13 is not edited,
  because the maintainer's config already holds a 13 marker.
- **renderer** (`app.tsx`): `focus.workspace` takes `activeFocus()` and calls `goToPanel`
  unconditionally, doing nothing when it is null. `keybindings/scope.ts` is unchanged; the `focus.`
  prefix already exempts it.

**Constitution Check (v5.6.0), deltas only.** Every other row above stands.
- **IV**: the three focus chords and the two toggles are each a group on one modifier set. J, K and
  V are in neither terminal tier, collide with no default, and cost no AltGr+Shift character on the
  seven layouts; N keeps Polish `Ń`, now for `focus.workspace`, and unbinding P returns
  US-International `Ö` (research R22's iterate-round-3 check). **Satisfied.**
- **V**: test-first at the lowest layer. unit(core) for the defaults, tiers, metadata and the v14
  planner with its idempotent re-run; integration(ui) for the v13 → v14 seed upgrade over the real
  file store and its re-run; component for `focus.workspace` through the real `KeybindingsHandler`
  (`side-pane-focus-commands.test.ts`). **No E2E declaration is added or removed**: two titles, one
  literal press and some comments change in place, so the budget stays **573** (`@core` 39).
  **Satisfied.**
- **VI**: `focus.workspace` is keyboard-only under "a chord MAY stand without a menu item", and the
  Key Bindings editor is its discoverable home. **Satisfied.**
- **X**: every new default goes through the version-14 guarded rewrite; customised rows stay
  byte-identical. **Satisfied.**
- **Documentation currency** (FR-119): `README.md`, `docs/quick-start.md` (keyboard reference, pane
  chord lines, AZERTY note, AltGr disclosure), `docs/testing.md` and `CHANGELOG.md`.
  `CONTRIBUTING.md` states no chord and is unchanged.
- **Particular-scrutiny review**: persisted state (version 14).

**Result: PASS.** **Deferrals**: none from this round. Complexity Tracking gains nothing.

## Iterate round 4: the active pane gates the outline and the arrows; Ctrl held for Ctrl+E W (2026-09-26)

**This is the current plan for what it names.** It covers spec FR-121 – FR-123, SC-019 and
supersession S28, and is built as tasks.md Phase 14. It changes no chord, no shipped default and no
persisted state, so there is no shipped-defaults version and no migration. Nothing above is
superseded except where S28 qualifies 012 FR-002's "the indicator persists".

**Where the code stands** (read 2026-09-26 at `b8c33114`):
- The panel frame's active class comes from the tab's active panel id alone
  (`packages/ui/src/renderer/workspace/panel-placeholder.tsx:173`, `isActive`; `:179`
  `isActiveDimmed`). The active pane lives in `workspace/active-pane.ts` (`useActivePane()`,
  `getActivePane()`; `'files' | 'workspace' | 'projects'`, default `'workspace'`, so a torn-off
  window, which never sets it, stays `'workspace'`).
- `dispatchMove` in `app.tsx` reads `activeFocus()` (the tab's active panel) and never the active
  pane, so from a side pane a directional chord moves the workspace's selection and `goToPanel`
  takes focus there.
- The editor's two-stroke engine (`editor/commands.ts`, `twoStrokeChords` / `TwoStrokeEngine`)
  matches the second stroke with `runScopeHandlers(view, e, secondStrokeScope(group))` on the raw
  event, so Ctrl still held reads as `Ctrl-w` and misses the `w` binding. The capture modal
  (`preferences/capture-modal.tsx`) builds the second stroke from `fromDomEvent(e)` on its keyup,
  with the same result.

**The change**:
- **renderer, FR-121** (`panel-placeholder.tsx`): the frame's active and dimmed classes also require
  `useActivePane() === 'workspace'`. The active panel id is untouched, so every route back lights the
  same panel. `status-strip.tsx` already derives its dimming from those classes and needs nothing.
- **renderer, FR-122** (`app.tsx`): `dispatchMove` returns before `activeFocus()` unless
  `getActivePane() === 'workspace'`. The window listener already consumes a resolved window chord,
  so nothing reaches the tree or the list. `dispatchCycle` is unchanged.
- **renderer, FR-123** (`config/chord-key.ts`, one shared rule; `editor/commands.ts`;
  `preferences/capture-modal.tsx`): the modifiers held at the first stroke are remembered as
  *carried*; a modifier's keyup while pending drops it from the carried set; the second stroke is
  matched with the carried modifiers cleared from it, and only that way (FR-123's MUST; corrected
  during T199 from "raw first, then cleared", which let a held Ctrl reach `Ctrl+E Ctrl+W`). With
  nothing carried the cleared stroke is the raw one, so a saved `Ctrl+E Ctrl+W` (Ctrl released and
  re-pressed) still matches. The
  "not bound" label is built from the carried-cleared stroke. The capture modal applies the same
  rule to the second stroke it records.

**Constitution Check (v5.6.0), deltas only.** Every other row above stands.
- **IV**: no chord changes; Ctrl+E W stays the recorded multi-stroke exception. **Satisfied.**
- **V**: test-first at the lowest layer. component for the panel frame beside the side panes
  (FR-121) and for the directional chord through the real window listener with each active pane
  (FR-122); unit for the carried-modifier rule, component for the editor's engine and the capture
  modal (FR-123). **No E2E declaration is added or removed**: `move-focus.e2e.ts`,
  `focus-context.e2e.ts` and `focus-zoom-layout.e2e.ts` are checked for an assertion that the new
  rules contradict and re-pinned in place if so; budget stays **573**. **Satisfied.**
- **VI**: no command gains or loses a menu item. **Satisfied.**
- **Documentation currency**: `docs/quick-start.md` (the arrows act from a workspace panel; Ctrl may
  stay held for Ctrl+E W) and `CHANGELOG.md` Unreleased. `README.md` and `CONTRIBUTING.md` state
  neither and are unchanged.

**Result: PASS.** **Deferrals**: none. Complexity Tracking gains nothing.


## Iterate round 5: focus into every panel; `Mods+K1,K2` chords; Enter keeps the list (2026-09-26)

**This is the current plan for what it names.** It covers spec FR-124, FR-125, the FR-082 defect,
SC-020, supersession S29 and constitution v5.6.0 Principle XI "Focus follows the active Panel"
(seventh revision), and is built as tasks.md Phase 15. It supersedes round 4's FR-123 section above
for the second stroke; its FR-121 and FR-122 parts stand.

**Where the code stands** (read 2026-09-26 at `c7e5fd84`):
- `workspace/panel-focus.ts` registers focus callbacks for the editor (`use-editor.ts:1623`), the
  terminal (`terminal-panel.tsx:977`) and the preview (`preview-panel.tsx:502`) only. An untyped panel
  and Find in Files register none, so `goToPanel`'s `focusPanel(target)` is a no-op for them and DOM
  focus stays in the panel left behind (repro `move-focus-dom-focus.test.ts`).
- `use-editor.ts:1881` focuses a restored editor on mount whenever it is the active panel, and
  `use-editor.ts:2026` saves view state on every unmount, so any second visit to a project steals
  focus from the Projects list, whatever FR-082's mark says (repro
  `project-switch-restored-editor-focus.test.ts`). `terminal/use-terminal.ts:1098` / `:1652`
  (`focusIfActive`) is the same route for a terminal, read from the code.
- Two-stroke tokens are space-separated in core (`normalizeToken`, `parseTwoStroke` in
  `config/keybindings.ts`; `chord-capture.ts`'s two-stroke paths; `shipped-defaults.ts`' collision
  helper). The editor engine (`editor/commands.ts`, `TwoStrokeEngine`) carries round 4's
  carried-modifier clearing. The capture box (`preferences/capture-modal.tsx`) records on the first
  non-modifier keyup and has a `capture-two-stroke` control.

**The change**:
- **core, FR-124** (`config/keybindings.ts`, `config/chord-capture.ts`): the canonical two-stroke
  token is `Mods+K1,K2`. The comma separates strokes except where it is a stroke's own key (the
  `Ctrl++` precedent). A stored token is parsed into the two strokes as physically pressed: the
  first `Mods+K1`, the second `Mods+K2` (the first's modifiers, plus any the second adds). A legacy
  space-separated token normalises to the comma form. Formatting for display and saving writes the
  comma form.
- **core, FR-124** (`config/shipped-defaults.ts`): `editor.toggleWordWrap` ships `Ctrl+E,W`;
  `SHIPPED_DEFAULTS_VERSION` becomes **15**, with a frozen `V14_KEYBINDINGS` joining the FR-108 guard
  sources as round 3 did with `V13_KEYBINDINGS`. Version 14 is not edited.
- **renderer, FR-124** (`editor/commands.ts`, `config/chord-key.ts`): the engine matches the second
  stroke against the RAW event (exactly as pressed), using the expanded second stroke; a keyup of any
  first-stroke modifier while pending ends the prefix silently. Round 4's `withoutCarried` /
  carried-clearing is removed from matching (the carried set remains only to detect that release).
- **renderer, FR-124** (`preferences/capture-modal.tsx`): nothing is recorded until every key is up;
  a second non-modifier key under the same held modifiers makes it `Mods+K1,K2`; a third is refused
  inline; the `capture-two-stroke` control and its state are removed.
- **renderer, FR-125** (`workspace/panel-focus.ts` and the untyped / Find in Files panel bodies): each
  panel records the last control inside it that took focus (`focusin`), and registers a focus
  callback that restores it while it is still connected, else focuses the first focusable control
  (the type picker; the search box). A panel with no focusable control makes its container
  focusable (`tabIndex=-1`).
- **renderer, FR-082 defect** (`editor/use-editor.ts`, `terminal/use-terminal.ts`): the mount/attach
  self-focus also requires `getActivePane() === 'workspace'`, so a list-initiated switch
  (active pane `projects`) never moves focus; the workspace route (#144) still does.

**Constitution Check (v5.6.0, seventh revision), deltas only.**
- **IV**: word wrap's recorded multi-stroke exception is now `Ctrl+E,W`; no chord tier changes.
  **Satisfied.**
- **V**: the three RED repros are committed first (`c7e5fd84`, maintainer-confirmed); unit for the
  parser, formatter and the v15 planner; component for the engine, capture box and focus targets.
  E2E declarations that press `Ctrl+E W` (`editor-word-wrap.e2e.ts`, `status-bar-visibility.e2e.ts`,
  any other found by grep) are re-pinned in place through `chordFor()` / the shipped token; budget
  stays **573**. **Satisfied.**
- **VI**: the capture control is removed; the Key Bindings row stays the discoverable home.
  **Satisfied.**
- **X**: the version-15 rewrite moves only an untouched default. **Satisfied.**
- **XI**: FR-125 brings the untyped panel and Find in Files into line with the new rule; the
  editor, terminal and preview already meet it. **Satisfied once T211 lands.**
- **Documentation currency**: `docs/quick-start.md` (Ctrl+E,W; recording a two-key chord; focus on
  moving into any panel), `CHANGELOG.md` Unreleased, `README.md` only if it names the chord.
- **Particular-scrutiny review**: persisted state (version 15, token format).

**Result: PASS.** **Deferrals**: none. Complexity Tracking gains nothing.


## Iterate round 6: three keys, and a refusal that does not stick (2026-09-26)

**This is the current plan for what it names.** Spec FR-126, SC-021, S30; tasks.md Phase 16. It
extends round 5's `Mods+K1,K2` to `Mods+K1,K2,K3`; everything else in round 5 stands.

- **core** (`config/keybindings.ts`, `config/chord-capture.ts`, `config/shipped-defaults.ts`'s
  collision helper): `splitStrokes` / `parseTwoStroke`'s successor parse up to three keys, each
  expanded with the held modifiers; `formatTwoStroke`'s successor writes up to three; collisions
  treat any shorter chord that is a prefix of a longer one in an intersecting scope as a collision.
  No shipped default is three keys, so no shipped-defaults version.
- **renderer** (`editor/commands.ts`): the pending engine accepts a prefix of one or two keys; the
  indication names the keys so far; the same release rule ends it. `toCodeMirrorKey` emits up to
  three strokes.
- **renderer** (`preferences/capture-modal.tsx`): up to three keys; a fourth is refused inline and
  dropped; releasing every key records the chord as it stood and clears the notice.
- **Gate**: the heavy gate waits for the maintainer's manual sign-off (their instruction,
  2026-09-26); short gates run locally.

**Constitution Check (v5.6.0), deltas only.** IV: a three-key chord is still one binding on one
modifier set; no shipped chord changes. V: test-first, unit and component. **PASS.**
