# Implementation Plan: Find / Replace in Files

**Branch**: `feature/S043-I220-I153-find-across-files` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/043-find-across-files/spec.md`

## Summary

Two capabilities, specced as one cycle because the second inherits the first's control language.

**A find session becomes per-panel.** Today one module-level `FindState` singleton serves the whole
renderer, and moving focus between editors destroys the previous panel's term, modes and position. It
becomes a map keyed by panel id, modelled on the controller registry that is already per-panel.

**A Find in Files panel searches files on disk.** A new workspace panel type, created only by a
command, walking a project root or a sub-directory, streaming results into a virtualised list, and
committing replacements through the editor's document authority where a file is open and directly to
disk where it is not.

The technical approach is almost entirely **composition of shipped parts**: the walk, the exclusion
predicate, the binary and size guards, the debounce, the cancellation idiom, the streaming IPC channel,
the panel-type registry and the persistence blob all exist. See [research.md](./research.md) — the
three-file template at `core/explorer/file-index.ts` + `main/project-file-index.ts` +
`main/file-index-ipc.ts` is the same seam, same excluder, same process, and is copied rather than
reinvented.

Three things are genuinely new: a **virtualised results list** (nothing in the renderer is windowed), a
**main-side bulk-edit entry point** on `EditorCoordinator`, and a **fourth keyboard dispatch scope**.

## Technical Context

**Language/Version**: TypeScript 5.x, ES2022 target, Node 22 / Electron 43

**Primary Dependencies**: React 19, CodeMirror 6 (`@codemirror/state`, `@codemirror/search`),
InversifyJS, `picomatch`, better-sqlite3 (untouched here), Playwright + Vitest

**Storage**: The panel's query rides `Panel.config` inside the existing `workspace_layout.layout_json`
blob. **No SQLite migration** — feature 006 set this precedent for the editor panel type and
`no-editor-migration.integration.test.ts` pins it.

**Testing**: Five layers — `unit` (node), `component` (jsdom), `integration` and `contract` (both
OS-serial, one worker), and Playwright-on-Electron E2E under a declared budget ratchet.

**Target Platform**: Windows 11 desktop (Electron)

**Project Type**: Desktop application, npm workspaces monorepo, three processes (renderer, Electron
main, detached daemon)

**Performance Goals**: SC-004 — a scan over ≥5,000 files begins showing results before the scan
completes, and the interface stays responsive throughout. No match ceiling (Assumptions), so the
results list streams and windows rather than truncating.

**Constraints**: The scan runs in **UI main**, never the renderer (sandboxed, single-threaded) and
never the daemon (walks nothing). `IFileSystem` has no partial read, so every candidate file is read
whole — `editor.maxOpenFileBytes` (10 MiB) is what keeps that bounded, which makes it load-bearing
rather than incidental.

**Scale/Scope**: ~90 functional requirements across 5 user stories. Touches `packages/core` and
`packages/ui` only.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1.*

Constitution **v5.4.0**. Every principle is assessed; none is skipped.

| Principle | Assessment |
|---|---|
| **I. Project-First Context Isolation** | **Engaged, satisfied.** FR-018 binds a panel to exactly one project and FR-030 confines scope to that project's root or a sub-directory beneath it. The scan takes its root from the active project and its exclusions from that project's own hidden set, so no path outside the bound root is ever read. US3 scenario 8 is the assertion. |
| **II. Platform-Abstracted Core** | **Engaged, satisfied.** All filesystem access goes through `IFileSystem` (`core/src/abstractions/file-system.ts`). The pure parts — walking, the exclusion predicate, binary detection, decode/encode, match finding — sit in `core` with no OS call. The scan **service** (lifetime, watch, debounce, cancellation) sits in `ui/src/main`, exactly where `ProjectFileIndexService` sits for the identical workload. **One thing to declare:** hoisting `editorMatches` into core adds `@codemirror/state` and `@codemirror/search` to a package that today depends only on `picomatch`. Both are pure JS with no DOM and no OS calls, so the principle holds — but it is a new engine dependency in the domain layer and is stated rather than slipped through (R1). |
| **III. Detached, Tagged & Persistent Terminals** | **Engaged only as a thing not to break.** FR-013 keeps terminal find read-only; the per-panel session rework touches `terminal-panel.tsx`'s count relay, so terminal find must keep working. No daemon or PTY code changes. |
| **IV. Native Terminal Support** | **Engaged, and cleared.** `Ctrl+Shift+F` and `Ctrl+Shift+H` are in neither the reserved nor the shadowable key tier, and the enforcing test matches exact normalised tokens — so **no constitutional exception is required** and the exhaustive-list assertion stays green (R13). Worth stating deliberately, as the principle asks: scoping these `EVERYWHERE` means a focused terminal never sees them, which is a departure from Windows Terminal's own `Ctrl+Shift+F`. That is accepted; neither is a line-editor chord. |
| **V. Test-First Quality Discipline (NON-NEGOTIABLE)** | **Engaged, and the hardest gate here.** Every task is written test-first at the **lowest layer that can prove it**. The layer map is in *Testing strategy* below. The E2E budget is a ratchet and **must rise** for this feature; the raise is justified per-test in `e2e-budget.json`'s own `measuredFrom` field, which records six prior raises in exactly that form. Each new E2E must name what no unit, component or integration test can assert — sub-workspace syncing (US5 6–8) and real focus/window behaviour are the honest candidates; result-row rendering, grouping, ordering, snippets and preview text are **not**, and go to `component`. |
| **VI. Simple, Modern, Discoverable UX** | **Engaged, heavily.** FR-029c is the principle restated: a capability reachable only by an unmemorised chord is one the user does not have, which is why the toolbar control and the folder context-menu item both ship. Layout persistence (FR-027a) is this principle's own requirement. Three named sub-rules are assessed separately below. |
| **VII. Change Review & Approval** | Engaged as process. A commit that writes to unopened files is irreversible in-app, so FR-057b requires explicit confirmation with a file count before it happens. |
| **VIII. SOLID, DRY & YAGNI** | **Engaged, and it decided the architecture.** DRY is why `editorMatches` is hoisted rather than reimplemented (FR-039), why the exclusion predicate and refusal guards are reused, and why the cancellation idiom is copied. YAGNI is why **no** new `IFileSystem` port method is added (no requirement needs a ranged read), why **no** new theme colour token is added (013's are the same idea on a third surface), why FR-033b's memory is in-memory rather than a v9 migration, and why no `FileSearchController` is forced into a union that cannot hold it. |
| **IX. Dependency Injection & Composition Root** | **Engaged, with a pre-existing shortfall to state honestly.** New services take their collaborators by constructor injection. But `IFileSystem` is bound by **no** container today — `NodeFileSystem` is `new`-ed directly in `main.ts:991` and passed to `FilesService`, `ProjectFileIndexService` and `EditorService`. The scan service follows that same shipped pattern. Introducing `UI_TYPES.FileSystem` for one new consumer while three existing ones keep the direct wiring would leave two conventions where there is one; that is recorded under Complexity Tracking rather than silently continued. |
| **X. Externalised Configuration** | **Engaged, satisfied.** Six preferences (FR-059), each a flat leaf on the `search` section that already exists, each with an editor descriptor. The settle interval for as-you-type is one of the six — a **setting**, not a constant, alongside the sibling `search.asYouTypeDebounceMs`. No timeout or limit is hardcoded in business logic. |
| **XI. Dockable Workspace: Panes, Tabs & Panels** | **Engaged, and it is the highest-risk row.** The workflow gate fires verbatim: *"a change that introduces a new panel type able to present an existing artefact MUST be checked for per-Panel copies of content-shaping state."* Assessed in full below. |
| **Documentation currency (NON-NEGOTIABLE)** | **Engaged.** This alters user-facing behaviour, adds settings and adds key bindings, so `README.md` and `docs/` are updated in the same change. There is no settings reference page in `docs/`, so nothing to update there; the issue tracker stays the only forward-looking list. |
| **Configuration-editor completeness (NON-NEGOTIABLE)** | **Engaged.** Six settings and two key bindings, each needing exactly one descriptor. `settings-metadata.test.ts` and `keybindings-metadata.test.ts` fail both ways, so this is enforced rather than remembered. `SHIPPED_DEFAULTS_VERSION` **must** be bumped or an existing install never materialises the new keys. |
| **Displayed quantities digit-grouped (NON-NEGOTIABLE)** | **Engaged, and this feature closes a named gap.** The find bar's `N of M` counter is the enumerated gap whose magnitude "routinely passes 1,000", to be closed before that surface's next **numeric** change — FR-014 makes this that change. The full set is enumerated in FR-014: the counter, the panel's total, a collapsed group's count, the skipped-file count, and the warning's file count. `formatGrouped` is the one implementation; grouping never reaches the persisted query or crosses IPC. |
| **Themeable icon controls (NON-NEGOTIABLE)** | **Engaged.** Every new action control is a themeable icon with a hover title naming the action (FR-011). Two new **icon** tokens (the toolbar action, the scope control); **no** new colour token (R15). The FR-057b confirmation's decision buttons keep text labels under the dialog exception. `icon-tokens-exist.test.ts` and `icon-call-sites.test.ts` enforce it. |
| **Static analysis & linting (NON-NEGOTIABLE)** | **Engaged as the standing gate.** `npm run gate` is the only thing that establishes done-ness. |
| **Every panel action has a menu item** (VI) | **Engaged.** FR-015 closes the enumerated `search.find`/`search.replace`/`search.replaceAll` gap; FR-025a puts every discrete command and toggle the new panel offers into its menu. Stepping through matches and closing the bar stay exempt as navigational input — the constitution names them explicitly. **One further absence is argued rather than exempt**: `search.replaceInFiles` has no menu item, because FR-029d makes it a chord that opens a panel with a toggle already on, and the panel-level action — that toggle — does carry one under FR-025a. A global command that configures a panel is not a second panel action. **The constitution's audit is stale here**: it still records the editor content menu and panel header menu as undivided, and 033 US5 sectioned both (R19). Reported, not worked around. |
| **One section vocabulary for every menu** (VI) | **Engaged, and it fits without amendment.** The full mapping is in R20. The apparent problem — that Run, Cancel and the commit granularities map to nothing — dissolves once "Content" is read as the *result row's* content, i.e. the file's text: replacing **is** a content action, running is a view-state one. `section` is a required field on `MenuAction`, so this is a compile error rather than a convention. |
| **Disabled when unavailable, absent when meaningless** (VI) | **Engaged.** FR-029a draws the toolbar control disabled with no project (never hidden), FR-029e does the same for both commands and their menu items, and FR-045b requires a stale marking to disable **nothing** — the rows' actions are not unavailable, so nothing is disabled. |
| **Incremental delivery** | **Engaged.** One deferral is recorded under Complexity Tracking. |

### Principle XI in full — the per-panel content-shaping state check

The gate asks whether this new panel type keeps per-Panel copies of content-shaping state. Worked
through:

- **A Find in Files panel presents no document.** It presents *results about* documents. It holds no
  content buffer, no dirty state, no undo history, no language and no indentation. So the "one
  document, one state" enumeration is not engaged by the panel itself.
- **The replace preview is view state, not document state.** It is a set of *proposed* edits that have
  not been applied to anything. Two panels holding previews over one file are not two originals of that
  file — neither has changed it. The spec resolves the collision without panel-to-panel coordination
  (FR-045a marks the file stale in the second panel, FR-054 refuses a match whose text has gone), and
  that resolution is correct precisely *because* a preview is not the document.
- **The commit is where XI actually binds, and it binds hard.** FR-052 must go through the single
  authority. The research found the trap: inactive tabs are unmounted, so a file open in a background
  tab has an authority and **no view and no replica**. A renderer-driven commit would skip its buffer
  edit *and* decline its disk write (because `isOpen()` says open), leaving the file silently
  unchanged. The plan's answer is a main-side `EditorCoordinator` entry point (R7) — which is also the
  only shape that satisfies "changed only by applying that authority's ordered change stream".
- **FR-053's direct write is the one place a second writer touches a file**, and it is permitted only
  where there is no document at all. The partition and the write are one main-side turn with an
  `isOpen` re-check immediately before `writeBytes` (R8), following the precedent
  `EditorCoordinator.save` already sets for Save-As.

**Result: PASS.** No principle is violated. Two items are recorded under Complexity Tracking: a
pre-existing DI shortfall this feature continues rather than fixes, and one deferral.

## Project Structure

### Documentation (this feature)

```text
specs/043-find-across-files/
├── plan.md              # This file
├── research.md          # Phase 0 — 22 grounded decisions
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/core/src/
├── search/                     # NEW - hoisted from renderer (R1)
│   ├── match-model.ts          #   MatchModes, Match, editorMatches
│   └── file-search.ts          #   pure result/group model, ordering, snippets
├── panel-type/
│   ├── descriptor.ts           #   + `offered` flag (FR-017, R17)
│   └── default-registry.ts     #   + register the new type
├── find-in-files/              # NEW
│   └── panel-type.ts           #   descriptor, FIND_IN_FILES_KIND
├── workspace/
│   └── model.ts                #   + FindInFilesPanelConfig
│                               #   (persisted-paths.ts is NOT touched: the scope is stored
│                               #    root-relative, and CONFIG_PATH_KEYS is for absolute paths)
├── config/
│   ├── app-settings.ts         #   + 6 leaves on SearchSettings
│   ├── settings-metadata.ts    #   + 6 descriptors
│   ├── keybindings.ts          #   + 2 action ids, scopes, chords, 4th DispatchScope
│   ├── keybindings-metadata.ts #   + 2 descriptors
│   └── theme.ts                #   + 2 icon tokens (no colour token)
└── explorer/                   #   reused unchanged: walkFiles, compileExcluder

packages/ui/src/main/
├── file-search-service.ts      # NEW - scan lifetime, streaming, cancellation
├── file-search-ipc.ts          # NEW - subscribe/snapshot/delta channel
├── editor-coordinator.ts       #   + bulk-edit entry point (R7)
└── replace-commit-service.ts   # NEW - partition, re-check, write (R8, R9)

packages/ui/src/preload/preload.cts   # + the new channels (parity test)

packages/ui/src/renderer/
├── find-in-files/              # NEW - the panel
│   ├── find-in-files-panel.tsx
│   ├── results-list.tsx        #   virtualised (R18)
│   ├── find-in-files-store.ts
│   ├── content-menu.ts
│   └── find-in-files.css
├── search/                     #   #220 rework
│   ├── search-store.ts         #   singleton -> Map<panelId, FindSession>
│   ├── find-bar.tsx            #   disclosure arrow, spacing, grouped count
│   └── search-model.ts         #   re-export from core (no caller changes)
├── explorer/
│   ├── toolbar.tsx             #   + Find in Files control (R21)
│   └── context-menu-items.ts   #   + folder item (R22)
└── keybindings/scope.ts        #   + the new kind -> new scope
```

**Structure Decision**: `packages/core` and `packages/ui` only. Nothing in `daemon`, `persistence`,
`ipc-contract` or `platform-windows` — the scan never crosses the daemon boundary (R2) and the query
needs no schema change (R11).

## Testing strategy

Constitution V requires the lowest layer that can prove each thing. Where things land:

| Layer | What proves itself here |
|---|---|
| **unit** (core) | Match semantics; result ordering (FR-035); snippet extraction and ellipsis (FR-036); grouping transforms (FR-033); the exclusion/binary/size skip decisions (FR-045e); digit grouping (FR-014); the settings-inertness guard for all six keys (FR-059a); keybinding and settings metadata completeness |
| **component** (jsdom) | The find bar's disclosure arrow, control spacing and retained anchoring (FR-008, FR-010, FR-012); the results list rendering, expanded-by-default state (FR-034a), collapsed counts, match-highlight tokens (FR-044), staleness marking (FR-045a/b), the replace preview's struck-through rows including the empty-replacement case (FR-046a, FR-047); **what starts a scan under both trigger settings (FR-043a–c)**; **the editable scope control and the missing-scope marking (FR-030, FR-030a)**; **the entry-point routes — seeding, focus target, replace-pre-enabled and the no-project case (FR-029d, FR-029e, FR-031a–c)**; SC-004's renderer half; menu section derivation for the new builders; the toolbar control's disabled state and title/aria split |
| **integration** (OS-serial) | The scan service end to end over a real temp tree — streaming, cancellation, supersession (FR-041, FR-043); the commit partition, the pre-write re-check and encoding/line-ending preservation (FR-053, FR-054, FR-056) |
| **contract** | The new IPC channel's shape and the preload parity |
| **E2E** (budget rises) | Only what no lower layer can observe: sub-workspace syncing of a Find in Files panel (US5 6–8), the two new window chords reaching the resolver through the `keepShift` branch, and layout persistence across a real restart (US5 9) |

**The `window-chord-manifest` trap** (R13) is a task in its own right: both new chords are
`Ctrl+Shift+<letter>` and land in the branch that silently made `Ctrl+Shift+T` inert before it was
widened, and the guard requires each to be covered in `window-chord-resolution.e2e.ts`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **`IFileSystem` remains outside the DI container** (Principle IX) | The scan service follows the shipped pattern: `NodeFileSystem` is `new`-ed in `main.ts:991` and constructor-injected into `FilesService`, `ProjectFileIndexService` and `EditorService`. | Adding `UI_TYPES.FileSystem` for one new consumer while three existing ones keep direct wiring would leave **two** conventions where there is currently one, inside a feature that is not about DI. Fixing it properly means moving all four, which is its own change. Recorded here so it is a known continuation, not an oversight. |

### Deferral — a fleet-wide inert-settings guard (#108)

Recorded as the incremental-delivery rule requires.

| | |
|---|---|
| **End-state requirement** | Every configurable setting in the application is proved to have a reader outside the config layer, by one guard, rather than by a per-feature test naming its own keys. |
| **Why not here** | #108 is the issue that exists to build it. 043 writes `settings-inertness-043.test.ts` naming its six keys, following the shipped `settings-inertness-040.test.ts` pattern — which satisfies FR-059a for this feature's keys without pretending to solve the class. |
| **Tracked as** | **#108** — open, `enhancement`, `area:preferences`, milestone v1.0.0. |
| **Expected to complete it** | The spec written for #108. |
| **Is the requirement weakened?** | No. FR-059a is satisfied in full for all six keys; only the *generalisation* is deferred, and 039 and 040 both discharged it the same way. |

### Reported to the maintainer, not worked around

**The constitution's menu audit is stale.** `.specify/memory/constitution.md:1531-1535` records the
editor content menu and the panel header menu as drawing items "in one undivided run, and MUST be
closed by tracked work". 033 US5 sectioned both, and `menu-sections.test.ts` pins them. The
constitution should be corrected by amendment; this feature does not depend on the outcome, since
FR-015 adds items to an already-sectioned menu either way.

> **Discharged 2026-09-09.** Constitution **v5.4.1** (PATCH) makes exactly that correction, verifying
> the four menus against the code rather than against the 033 spec, and records this plan as where the
> discrepancy was found. Nothing in 043 changes as a result. The round-two Constitution Check below is
> evaluated against **v5.4.1**.

---

# Round two — post-testing changes (Session 2026-09-09)

**Date**: 2026-09-09 | **Constitution**: v5.4.1 | **Research**: [research.md](./research.md) R23–R30

Round one shipped, was gated green at `ff347e81`, and was tested by hand. This section plans the
sixteen change requests and three convergence findings that came back, as
[spec.md](./spec.md) records them in FR-060 – FR-078a. **Nothing above is rewritten.** Where a
round-two decision changes a round-one one, it names it, exactly as the spec's supersession markers
do.

**Two of these are defects, not new work**, and the plan says so rather than letting them read as
features:

- **FR-064 is a violation of 021 FR-049**, which already requires *"Pane Text MUST reach the body text
  of every pane and panel"*. The panel subscribes to no typography role — `find-in-files.css` carries
  none of the selectors listed at `theme.css:2138-2150` — and then shrinks four classes to `0.85em`
  on top of an inherited `body`. FR-064 records the correction; **it creates no new rule**, and the
  work is a failing test at the component tier plus a fix, not a new requirement being satisfied.
- **The header menu's Zoom In / Out / Reset on a panel that cannot zoom is a Constitution VI defect**
  — the *disabled-versus-absent* rule, offered inert rather than drawn disabled or left out. The
  submenu is built unconditionally at `panel-header-menu.ts:122-150`, before the first `panel.kind`
  branch at `:153`. **Implementing FR-062 dissolves it for this panel**; it is not separate work and
  must not be planned or tasked as such. It does *not* dissolve for the untyped placeholder panel,
  which has no zoom consumer either — **D2 takes that in scope by FR-062a**, in the same edit to the
  same block.

## Technical Context — deltas only

Everything in round one's Technical Context still holds. What moves:

| Field | Round-two delta |
|---|---|
| **Storage** | Still **no SQLite migration** — nothing round two adds reaches `persistence`. But it introduces a **config-document migration**: `SHIPPED_DEFAULTS_VERSION` **6 → 7**, carrying a *guarded value rewrite* of two settings leaves and four theme tokens across fifteen themes. This is the first **non-additive** theme upgrade, and R28 explains why nothing else reaches an installed build. |
| **Primary Dependencies** | Unchanged. No new package; `ciede2000` and the CIELAB conversions FR-067 needs already live in `theme-quality.ts`. |
| **Constraints** | One new hard constraint: **the results list's row height must be a single rounded integer computed in JavaScript**, because the windowing arithmetic and the stylesheet must agree exactly (R26). CSS may consume it, never compute it. |
| **Scale/Scope** | +19 requirements (FR-060 – FR-078a). Still `packages/core` and `packages/ui` only — plus, newly, `packages/core/src/config/shipped-defaults.ts` and `packages/ui/src/main/shipped-defaults-service.ts`, which round one did not touch beyond the version constant. |
| **Performance Goals** | SC-004's 5,000-file corpus now meets **as-you-type by default** (FR-074), which is the argument that lost rather than the argument that was wrong (the spec keeps that parenthetical deliberately). The 500 ms settle (FR-075) and the shipped forced ceiling at four times it are what bound it. |
| **Testing** | Unchanged five layers. One E2E is **added** (FR-078's sub-workspace results), one is **deleted** (FR-072's `ranScope` readout — deleted rather than adjusted, per the clarification), and `e2e-budget.json` moves in both directions with the raise justified per-test in its own `measuredFrom` field. |

### Source-code delta

```text
packages/core/src/
├── config/
│   ├── theme-quality.ts        # + mutual-distinctness gate over 3 token pairs (R24)
│   ├── default-themes/index.ts # ordinary-match derivation: fixed 0.45 -> searched, 2nd axis (R24)
│   ├── theme.ts                # THRONG_THEME's two hand-authored match literals (R24);
│   │                           #   icons.findInFiles glyph (FR-065). NO new token either kind
│   ├── app-settings.ts         # FIND_IN_FILES_GROUPINGS loses 'folder' (R25);
│   │                           #   trigger + settleMs defaults (FR-074, FR-075)
│   ├── settings-metadata.ts    # optionLabels.folder removed; group 'Search' splits (FR-076)
│   └── shipped-defaults.ts     # VERSION 6->7; frozen V6 records; guarded value rewrite (R28)
├── search/file-search.ts       # Grouping narrows; groupRows loses a branch (R25)
└── workspace/panel-title.ts    # + findInFiles branch, reading panel.config.term (R30)

packages/ui/src/main/
├── file-search-service.ts      # key -> panelId; viewers set; rows retained; release/drop (R23)
├── file-search-ipc.ts          # + attach channel; update goes to the viewer set (R23)
└── shipped-defaults-service.ts # the non-additive theme value rewrite (R28)

packages/ui/src/preload/preload.cts   # + fileSearch.attach (parity test)

packages/ui/src/renderer/
├── find-in-files/
│   ├── find-in-files-panel.tsx # CLUSTER A: toolbar + ScopeControl (FR-068/069/070/072)
│   │                           #   + zoom factor, + attach on mount (R23, R26)
│   ├── results-list.tsx        # rowHeightPx threaded through the windowing arithmetic (R26)
│   ├── find-in-files-store.ts  # ranScope removed; scopeNotice; snapshot vs delta; attach
│   ├── content-menu.ts         # one grouping item removed (FR-073)
│   └── find-in-files.css       # CLUSTER B: FR-063 + FR-066 + FR-064
└── workspace/
    ├── panel-header-menu.ts    # Rename / Reset Name absent for this kind (FR-061);
    │                           #   Zoom submenu gated on the kinds that zoom (FR-062a, D2)
    └── panel-placeholder.tsx   # no rename starter registered for this kind (R30)
```

## Constitution Check — re-evaluated for round two

*GATE: re-evaluated against **v5.4.1**. Every principle is assessed; none is skipped. Round one's
verdicts stand except where a row says otherwise.*

| Principle | Round-two assessment |
|---|---|
| **I. Project-First Context Isolation** | **Engaged, and it decides FR-078's design.** A scan update carries one project's root-relative paths and the text around every match. The house style for one object seen by many windows is `broadcastToWindows(getAllWindows(), …)` with each window filtering by id — `main.ts:1551` states it outright. **Rejected here**: a sub-workspace window may hold a *different* project, and a broadcast would deliver that payload into it and filter afterwards. FR-018 and this principle both read at the **delivery** layer, not the rendering layer. The viewer set (R23) is what keeps that true. **Satisfied.** |
| **II. Platform-Abstracted Core** | **Engaged, satisfied, and the split holds under the new work.** The distinctness rule, the re-derivation, the containment predicates and the migration *plan* are all pure functions in `packages/core` with no OS call; the only OS work is the file write in `shipped-defaults-service.ts`, which is where it already is. `pickFolder` — the one OS dialog — is **not modified**: FR-070's rule lives in the renderer with a pure core predicate (R27), rather than teaching a shared primitive about projects. No new dependency in core. |
| **III. Detached, Tagged & Persistent Terminals** | **Engaged only as a thing not to break, and it is easy to miss.** FR-067 changes `searchMatch` / `searchMatchCurrent` / `searchMatchCurrentBorder`, which the **terminal** consumes at `terminal-panel.tsx:209-211` and `use-terminal.ts:819-821`. Terminal search must stay legible after the re-derivation, and the syntax-on-match contrast walk is what guarantees it. No daemon, PTY or shell code changes. |
| **IV. Native Terminal Support & Auto-Detection** | **Not engaged.** Round two adds no key binding and changes no chord. `Ctrl+Shift+F` / `Ctrl+Shift+H` are unchanged; FR-077 changes what the *existing* find-in-files chord does to a reused panel, not what key it is. The `window-chord-manifest` guard is untouched. |
| **V. Test-First Quality Discipline (NON-NEGOTIABLE)** | **Engaged, and two items are explicitly defect-shaped.** FR-064 and the inert-zoom-menu item each start with a **failing test that reproduces the defect** before any production edit — that is the repo's bug rule, not a preference. The layer map is below; the two things that genuinely need E2E are named there and everything else is pushed down. FR-067's floor is a **measurement**, which means a task that runs a command and records a number, not a number chosen at planning time. |
| **VI. Simple, Modern, Discoverable UX** | **Engaged, heavily, and assessed in four separate rows below.** Round two is largely this principle: a panel that could not say what it was searching for, a menu offering three inert commands, a Replace All reachable only by right-click, and a control at the wrong visual weight beside its neighbour. |
| **VII. Change Review & Approval** | **Engaged, and FR-068 is where it binds.** A toolbar Replace All is a second route to an irreversible write. It **must invoke the same commit path** as the menu item, so FR-057b's confirmation and FR-058's single notice cannot be bypassed by reaching the command a different way — the requirement says so, and the plan makes it a shared call site rather than two callers of the IPC channel. |
| **VIII. SOLID, DRY & YAGNI** | **Engaged, and it decided four of the six designs.** DRY: FR-067 reuses `ciede2000`/`rgbToLab` rather than inventing a second notion of "different enough" (R24); FR-073 reuses `bounds-guard`'s `correctScalar` rather than hand-writing a coercion (R25); FR-070 reuses `relPathUnderRoot`, which answers containment and relativisation in one call, and **adds no third containment primitive** beside the two that already exist (R27); FR-062 reuses `Panel.zoom` and the editor's CSS-variable precedent (R26). YAGNI: **no new theme token of either kind** — FR-068 reuses `icons.replaceAll` (`theme.ts:424`) and FR-070 reuses `icons.folderOpen`, both already shipping for exactly these actions; and no retention store with a policy (R23). |
| **IX. Dependency Injection & Composition Root** | **Engaged; the round-one shortfall is carried unchanged and nothing new is added to it.** `FileSearchService` keeps taking its collaborators by constructor injection, including the `push` callback that is what makes the viewer set testable without Electron. No new service is introduced by any of FR-060 – FR-078a. The `IFileSystem` row in Complexity Tracking stands as written. |
| **X. Externalised Configuration** | **Engaged, satisfied, and one line needs arguing.** FR-074 and FR-075 change *defaults*, not mechanisms — both keys already exist, both already have descriptors, and R28 is what makes the change reach an installed build. FR-076 re-sections the descriptors. **FR-067's distinctness floor is a constant, not a setting**, and the argument is the one `theme-quality.ts` already makes for `DISTINCTNESS_THRESHOLD`: it is a *measurement* that gates the build, not a value a deployment or a user has any reason to change — the same reasoning `MAX_ROWS_PER_BATCH` carries in this feature's own contract. |
| **XI. Dockable Workspace: Panes, Tabs & Panels** | **Engaged, and re-run because FR-078 changes the answer.** Round one's check concluded a Find in Files panel keeps no per-Panel copy of content-shaping state because it presents no document. That still holds — but FR-078 makes its **results** shared across windows, so the gate's real question applies to them: *is there one authority?* There is, and it is main: the run is keyed by `panelId`, both windows are viewers of one generation, and neither window can hold a divergent result set because neither produces one. A mirror is not a second original. **Two panels over one file are still uncoordinated** (staleness plus the pre-write re-check), which is unchanged and correct — FR-078 is about one panel in two windows, never two panels. FR-060/061 are the docking model's naming rules, assessed in their own row. |
| **Documentation currency (NON-NEGOTIABLE)** | **Engaged.** Round two changes shipped defaults (as-you-type on, 500 ms), removes a grouping the docs describe, changes every theme's rendered match colours, and adds a toolbar control and a folder chooser. `README.md`, `docs/` and `CONTRIBUTING.md` are updated in the **same** change; the grouping removal in particular must be swept for, since it is described as three values wherever it is described at all. |
| **Configuration-editor completeness (NON-NEGOTIABLE)** | **Engaged.** No preference is added or removed — the six stand. What moves: `FIND_IN_FILES_GROUPINGS` loses a value and `optionLabels.folder` must go with it, or the descriptor advertises a value the guard rejects; and FR-076 splits `group: 'Search'` into `Search · Find Bar` (one key) and `Search · Find in Files` (six), following the shipped `Editor · Indentation / Languages / Navigation` convention exactly. `settings-metadata.test.ts` fails both ways. **`SHIPPED_DEFAULTS_VERSION` must be bumped again** (6 → 7) — see R28; without it, four of this round's requirements change nothing for anyone who has already run the application. |
| **Displayed quantities digit-grouped (NON-NEGOTIABLE)** | **Engaged, and satisfied by adding nothing.** Round two introduces **no new displayed figure**: FR-072 removes a text readout, FR-073 removes a menu item, FR-078's snapshot carries the same totals the deltas already did. Every existing figure keeps `formatGrouped`. The guard in `find-in-files-grouping-view-only.test.ts` still binds in both directions — no call from `packages/ui/src/main/` (the sweep at `:336`), and none from the seven modules listed at `:353-361`, **`content-menu.ts` included**, which FR-073 edits. Removing a menu item must not be the moment a formatter arrives in that file. |
| **Themeable icon controls (NON-NEGOTIABLE)** | **Engaged, and it costs no token.** FR-068's Replace All reuses `icons.replaceAll` and FR-070's chooser reuses `icons.folderOpen` (`folder-picker.tsx:92` is the shipped call site for that exact action) — both are the **same action**, so reuse is the rule rather than an exception to it. Each new control is a themeable icon with a hover title naming the action. **FR-065 changes a token's VALUE, not the token set**, so `EXPECTED_ICON_TOKEN_COUNT` (65, `default-themes.test.ts:30`) does not move and its assertion at `:117-124` stays green; but the new glyph must keep the three searches distinguishable (`theme.ts:402-416` records why they are held apart — *"There are now THREE searches in this application and they answer different questions"*, `:406`), and R28 is what carries the new value to an installed build. |
| **Static analysis & linting (NON-NEGOTIABLE)** | **Engaged as the standing gate.** `npm run gate` remains the only thing that establishes done-ness, dispatched to a hosted runner. |
| **Every panel action has a menu item** (VI) | **Engaged, and satisfied without a new item.** FR-068 (Replace All) and FR-071 (double-click to collapse) are both **accelerators over items that already exist** — Replace All is in the panel's content menu under FR-025a, and per-group toggling plus collapse-all are in it too. The constitution asks that every panel action be *reachable* from a menu, not that every gesture mint a new one. FR-070's folder chooser is a control **on** the scope control, in the same relationship a text field's browse button has to the field — it configures an input rather than performing a panel action, which is why `folder-picker.tsx`'s two existing consumers carry no menu item either. |
| **One section vocabulary for every menu** (VI) | **Engaged, and unchanged.** R20's mapping stands; FR-073 removes one `viewState` item and adds none. FR-061 removes `Rename` (`content`) and `Reset Name` (`viewState`) **for this panel kind only** — a section losing its last item must not leave a dangling divider, which `menu-sections.test.ts` is what pins. |
| **Disabled when unavailable, absent when meaningless** (VI) | **Engaged, and this is the round's headline row.** Three separate calls, made deliberately: **(a)** FR-061's Rename / Reset Name are **absent**, not disabled — renaming is never meaningful for a panel whose identity is its query, which is the "absent when meaningless" half verbatim. **(b)** FR-062a's zoom commands were **inert**, which is neither — the defect this rule exists to prevent. FR-062 dissolves it for this panel by making them work, and **D2** dissolves it for the untyped placeholder by making the submenu conditional on the kinds that consume zoom, so the round leaves no known instance of it standing. **(c)** FR-070's out-of-project refusal is *shown*, not silently ignored — a control that accepts a value and does nothing with it is the same defect wearing different clothes. |
| **One condition, one notice** (repo convention, CLAUDE.md) | **Engaged by FR-070.** The scope control already owns one condition (FR-030a's missing scope) with one surface. The refusal takes **that same slot** rather than a second one, with a stated precedence — most recent wins — because a second marking on one control for two alternative conditions is exactly the shape spec 032 produced and this convention exists to stop (R27). |
| **Incremental delivery** | **Engaged.** One new deferral is recorded below (F1's issue), and #108 stands unchanged. |

**Result: PASS.** No principle is violated. Four items go to Complexity Tracking, and two are reported
to the maintainer rather than worked around.

## Sequencing — two clusters that must each be ONE change

This is a planning constraint, not advice. Four requirements rewrite the same region of one file and
three rewrite the same stylesheet. Planned as parallel tasks they produce conflicting diffs over
identical lines that then have to be hand-merged — which is how a superseded readout survives a
supersession, or a font rule lands twice.

**The argument is REGION ownership, not file ownership**, and the distinction matters because the
files are not cleanly separated: Cluster A also deletes `.fif-scope__ran` from `find-in-files.css`
(FR-072), and Cluster B also adds selectors to `theme.css` (FR-064). So neither cluster owns a file
outright. What each owns is a **contiguous region whose edits overlap** — the toolbar and
`ScopeControl` for A, the panel's own type and metric rules for B — and that is what cannot be split
across commits. The two clusters share `find-in-files.css` and are therefore **sequenced**, A before
B, which is why they never contend: A's single deletion lands before B rewrites the sheet around it.

### Cluster A — the panel's toolbar and `ScopeControl`

**FR-068, FR-069, FR-070, FR-072. One commit.**

*(One **commit**, not one task. Test-first splits this into **eleven** tasks — a failing test and a
fix per requirement, plus the scope-notice pair and the FR-011 discovery guard — and that is correct:
the granularity that matters here is what lands together, not how many list entries describe it.
`tasks.md` §11.5, T148–T157 including T153a. **The count lives in `tasks.md`; this is a summary of
it, and a summary that disagrees with its source is worse than no summary** — which is why it is
quoted with its range rather than stated as a bare number.)*

All four rewrite `packages/ui/src/renderer/find-in-files/find-in-files-panel.tsx` in the region
**`:509-610`** (the `.fif-toolbar` block) and **`:678-721`** (`ScopeControl`), plus the `ScopeControl`
call site at `:635`:

| Requirement | What moves |
|---|---|
| **FR-069** | The run/cancel control at `:525-545` leaves `.fif-controls--field` (`:510-546`) and lands to the **right of the scope control** — i.e. after `:635`. Cancel keeps replacing run in place. |
| **FR-068** | Replace All is added **to the right of the relocated run control**, so it cannot be placed until FR-069 has moved it. It calls the same commit entry point the menu item calls (Principle VII). |
| **FR-070** | The chooser button is added **inside** `ScopeControl` (`:688-720`), and its refusal renders in the notice slot at `:708-713`. |
| **FR-072** | The `ranScope` block at `:714-718` is **deleted**, with `.fif-scope__ran` (`find-in-files.css:150-157`) and the `ranScope` state in `find-in-files-store.ts`. |

FR-070 and FR-072 both edit `ScopeControl`'s body, and FR-070 reworks the very state slot FR-072's
neighbour occupies. FR-068 has a hard ordering dependency on FR-069. There is no split of these four
that does not touch the same lines twice.

### Cluster B — `find-in-files.css`

**FR-063, FR-066, FR-064. One commit.**

*(One **commit**, not one task — **ten** under test-first, `tasks.md` §11.6, T158–T165 including
T165a/T165b, which are FR-079's half rather than FR-064's.)*

| Requirement | What moves |
|---|---|
| **FR-064** | The panel joins `paneText`'s selector list in `theme.css:2138-2150`; the sheet's inherited base changes underneath **every** rule in it. |
| **FR-063** | `.fif-group__key` (`:212`) takes `var(--throng-font-weight-bold)` — a weight that is only meaningful relative to the base FR-064 just changed. |
| **FR-066** | `.fif-match--struck` (`:269`) recedes and `.fif-replacement` (`:277`) strengthens — and the sheet may name **no colour literal**, not even as a `var()` fallback, which `find-in-files-results.test.ts:253-262` fails on. Recession is opacity or a token. |

FR-064 changes what FR-063's "bolder" and FR-066's "receded" are relative to. Landing them separately
means tuning each against a base that is about to move.

### Everything else is independent

FR-060/061 (title and rename), FR-062 (zoom), FR-065 (glyph), FR-067 (theme rule and derivation),
FR-071 (double-click), FR-073 (grouping), FR-074/075 (defaults), FR-076 (sections), FR-077 (symmetry)
and FR-078/078a (cross-window) touch disjoint files and may be sequenced freely — **except** that
**R28's single `SHIPPED_DEFAULTS_VERSION` bump carries the payloads of FR-065, FR-067, FR-074 and
FR-075**, so the bump lands once, after all four values are settled, and not four times.

## Testing strategy — round two

| Layer | What proves itself here |
|---|---|
| **unit** (core) | The distinctness gate itself, and every bundled theme passing it (FR-067); the re-derivation's output pinned by the re-seeded fixture; `Grouping` narrowing and `groupRows` losing a branch (FR-073); a stored `'folder'` reading as `'file'` through `bounds-guard` (FR-033c/FR-073); `panelDisplayTitle`'s new branch, including the truncation path (FR-060); the guarded value rewrite planning nothing when a value was customised and being idempotent on a second run (R28); `visibleRange` at a zoom factor (FR-062); settings-metadata completeness after the group split (FR-076) |
| **component** (jsdom) | FR-064's failing test **first**, then the fix; FR-063's weight and FR-066's fade/highlight as rendered output; the relocated run control, Replace All's presence and its call target (FR-068/069); the chooser's refusal appearing on the scope control and writing nothing to the box (FR-070); the double-click pairing including both traps — the chevron and the modifier (FR-071); FR-077's replace-off symmetry; the absence of Rename / Reset Name from this kind's header menu (FR-061); the zoom submenu's items being live (FR-062a) |
| **integration** (OS-serial) | `FileSearchService` with two viewers over one run: both receive deltas, a late attach receives a snapshot, one viewer dropping leaves the other's stream intact, the last drop releases (FR-078, FR-078a) |
| **contract** | The `attach` channel's shape and preload parity; snapshot-vs-delta semantics on `update` |
| **E2E** (budget moves both ways) | **Added**: a panel synced into a sub-workspace showing the parent's results and following them (US5 scenario 6 — the gap F1 records). **Deleted**: the spec that pins the `ranScope` readout, deleted rather than adjusted per the clarification, with `e2e-budget.json` re-seeded in the same commit. |

**What deliberately does not go to E2E**: the theme re-derivation (a pure function over fifteen
palettes), the row-height arithmetic (a pure function), the title rule (a pure function in core), the
settings coercion (a pure parse), and every visual change in Cluster B. Round one's rule holds — an
E2E must name what no lower layer can observe, and *"a real window is what is under test"* is true of
exactly one thing this round.

**The rename chord needs no E2E either.** FR-061 is satisfied by *not registering a starter*
(`panel-rename.ts:30-38` already returns a no-op for an unregistered panel), so the assertion is that
the registry has no entry — a component-tier fact, not a keystroke.

## Complexity Tracking — round two

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **F1 — the sub-workspace results gap had no paper trail** (Principle V, and the incremental-delivery record) | Recorded below in full. The gap is being fixed this round; the omission is the thing tracked. | — |
| **F2 — `data-model.md` §6 documented four `FailedCommit` reasons where seven shipped** | Corrected in this round's change, in `data-model.md` itself. | Nothing to reject: the code and `contracts/file-search-ipc.md` already agreed, and only the data model was stale. Recorded because three artefacts disagreed for a whole round and a convergence pass, not a review, is what found it. |
| **F3 — icon control boxes hardcoded from `sizes.iconPx`'s default** (FR-079a) | **Seven** rules found, **four** controls now carry the derived box. Recorded in full below, because the pattern is repository-wide and this feature is the wrong vehicle for it. | Sweeping all seven was rejected: it means one commit touching the explorer, the find bar, the panes rail, the terminal and all three preferences editors, none of which this feature otherwise enters, and one of which is load-bearing geometry. Leaving them all was rejected because four of the controls are this round's own surfaces — two that its requirements reach, and two it wrote. |
| **The first NON-ADDITIVE theme upgrade** (Principle X's migration surface) | **Decided 2026-09-09: taken (D1)**, and `upgrade()`'s contract is narrowed in words rather than broken in silence. R28. `upgrade()` is additive-only *"NEVER changing a value the user already has"* (`shipped-defaults-service.ts:309-313`), so FR-067's re-derivation and FR-065's glyph would reach fresh installs only — including not reaching the maintainer who reported both. A guarded value rewrite is the only mechanism that reaches an installed build without overwriting a customisation. | Changing the constants alone was rejected because the fix would be invisible to everyone who has run the app. Rewriting unconditionally was rejected because it destroys a recoloured theme. A one-off startup script was rejected because it is a second migration mechanism beside the versioned one, with its own idempotence to get right. |
| **The section guard for `search.inFiles` is a proxy, not a proof** (Principle VII, honesty about a behaviour change) | R28. `trigger: 'run'` — the value's actual spelling, `app-settings.ts:626`, not the descriptor's `'When you press Run'` label — is *both* what version 6 shipped and a value a user may deliberately have chosen; the document cannot tell them apart, unlike `explorer.excludeGlobs` where a customisation differs from the shipped list. The guard is widened to "the whole `search.inFiles` section still equals what v6 shipped" so a user who touched anything keeps everything. **Decided 2026-09-09: take the rewrite** — see *Decisions taken* below. | A per-leaf guard was rejected as too weak — it would flip a deliberate choice on a single-key match. Doing nothing was rejected under R28: the fix would never reach the person who asked for it. Being wrong costs one preference the user changes back in a click; being timid costs the whole change. |
| **`IFileSystem` remains outside the DI container** (Principle IX) | Carried unchanged from round one. Round two adds no new consumer of it. | As recorded above. |

### F1 — a gap that lived only in a test file's header

Recorded as the incremental-delivery rule requires, and following the #108 entry's shape.

| | |
|---|---|
| **What was omitted** | US5 scenario 6 — a Find in Files panel synced into a sub-workspace shows the parent's results — was **unmet on a shipped, gate-green feature**, and the only record of it anywhere was a fifteen-line header comment in `packages/ui/tests/e2e/find-in-files-subworkspace.e2e.ts:13-27`. No task in `tasks.md`, no GitHub issue, no Complexity Tracking row, no line in this plan. |
| **Why it happened, honestly** | The test author found the gap while writing the spec that would have asserted it, judged correctly that inventing the design inside a test file was wrong — their own words: *"inventing an answer inside a test file is how an unreviewed architecture ships"* — and then recorded the judgement in the only place they were already editing. The reasoning was right and the destination was wrong. |
| **Why a comment is not enough** | A comment is invisible to every process that decides what ships. `tasks.md` did not list it, so `/speckit-implement` never saw it; `/speckit-analyze` compares spec to plan to tasks, and it was in none of the three; the gate is green because the suite asserts what it contains. A scenario can therefore be **unmet, known, and released** with every check passing. That is the failure mode, and it is not specific to this scenario. |
| **The rule worth stating** | **A gap a test author finds and cannot fix belongs in Complexity Tracking and an open issue, not only in a comment.** The comment is still right and stays where it is; it is the *second* record, not the only one. |
| **Fixed** | This round — FR-078 and FR-078a, designed in R23, contracted in `contracts/file-search-ipc.md`. |
| **Tracked as** | **#380** — *"[Bug] A Find in Files panel synced into a sub-workspace shows no results"*, `bug`, `area:ui-shell`, milestone v1.0.0. Open at the time of writing; closed by this round's FR-078 work. Recorded here the way **#108** is recorded above, so the gap has an identifier outside this document. |
| **Is the requirement weakened?** | No. Scenario 6 is met in full this round, and it gains the E2E it never had. |

### F3 — the icon-box pattern: seven rules found, four controls taken

Recorded here, and **not only here** — an appendix is not a tracker, which is the rule F1 exists to
state and which this entry came within one review of breaking again. **Tracked as
[#381](https://github.com/Bidthedog/throng/issues/381)** — *"[Bug] Icon control boxes are hardcoded
from `sizes.iconPx`'s default, so raising it clips or overlaps them"*, `bug`, `area:ui-shell`,
milestone v1.0.0, filed by T185a. The issue carries the measured table below, the corrected
arithmetic, and the instruction to treat six as a floor.

**THE COUNT WENT UP AGAIN, AND AGAIN BY BEING LOOKED AT.** Six rules became **seven** when the panel
gained a Clear on each of its three text inputs (FR-080): the markup being reused comes from the
settings, keybindings and themes search boxes, and **all three call sites share ONE rule** —
`.settings-search__clear`, `width: 20px; height: 20px`. It is recorded below and **not** taken, under
this requirement's own reasoning: an inherited pattern this feature neither wrote nor was already
opening. *(Worth stating precisely, because FR-080a speaks of "the three existing clear controls" and
a reader could take that for three rules to fix: three controls, one rule, one fix — which is what
makes the whole-repository sweep cheaper than this table makes it look, and is an argument for
[#381](https://github.com/Bidthedog/throng/issues/381) rather than against it.)*

The **fourth taken** control is `.fif-btn--clear`, and it is inside the line by the third of the two
reasons FR-079a states — *this feature is writing it*. It is not one of the seven found: it did not
exist to be audited, which is exactly why it needed a requirement rather than a review. Fixing the
frozen box in three controls and then adding a fourth control carrying it, in the same panel, one
round later, is incoherent in precisely the way FR-062a is about — and it is the single most likely
way this defect comes back, because the control being copied still has it.

**This table said FIVE until Cluster B was implemented**, and the sixth was found by fixing the
first: `.fif-field__icon` sits one rule below `.fif-btn` in the file the audit had open, and the
audit still missed it. That is the argument for the issue rather than a footnote about it. **The
count has only ever gone up when somebody looked**, and it will keep doing so, because the defect is
*invisible to the only search anyone would run for it* — every instance is the token's resolved
value written as a number, so the token's name appears in none of them and no grep for
`--throng-size-icon` reaches any. Whoever takes T185a's issue should treat six as a floor, search
for the **arithmetic** rather than the token, and open the two stylesheets left unaudited below.

**Two rules clip** — a fixed square box, `overflow: hidden`, hosting an `Icon`. They are twins, down
to the same inert `font-size`:

| Rule | Box | Content at the default | |
|---|---|---|---|
| `.fif-btn` (`find-in-files.css:78-96`) | 22×22, `padding: 3px`, `border: 1px`, `overflow: hidden`, `font-size: 12px` | **14 px for a 16 px glyph — clipping TODAY** | **Taken** — T165a/T165b, corrected by FR-079c |
| `.find-bar-btn` (`find-bar.css:88-104`) | 24×24, `padding: 3px`, `border: 1px`, `overflow: hidden`, `font-size: 12px` | 16 px — exactly the glyph, **zero headroom** | **Not taken.** Reported |

**THE `16 + 3 + 3` TELL IS ITSELF AN INCOMPLETE SUM, and it took the whole round to notice.**
`theme.css:51` sets `* { box-sizing: border-box }` globally, so every one of these boxes spends its
declared size on **border and padding before content** — and every arithmetic in the first two
versions of this table omitted the border. Corrected by measurement in headless Chromium against the
exact declarations, not by re-reading the box model:

- **`.fif-btn` clips at the DEFAULT.** 22 − 2 (border) − 6 (padding) = **14 px of content for a 16 px
  glyph**, cut 1 px on every side with nothing changed in the Themes editor. It is not a latent
  defect awaiting a raised token; it is what the control has always looked like. **The first
  correction did not fix it** — `calc(token + pad * 2)` is the same incomplete sum in `calc()` form,
  so it satisfied FR-079, passed every test written for it, and clipped by 1 px at *every* icon size.
  FR-079c is the requirement that catches that, and the box now resolves to **24 at the default**.
- **`.find-bar-btn` clips at 17, the very next step** — not 19. 24 − 2 − 6 = 16, exactly the default
  glyph, so it has **zero** headroom rather than three. It is `.fif-btn`'s twin, and the 2 px by
  which the two boxes disagreed was never a design decision: it was one of them remembering the
  border. It is 013's surface, which is the only reason it is not taken.

This row has now been wrong **twice**, in opposite directions — first "two pixels, one step", then
"three px of headroom, three steps" — and both were on their way into a filed issue whose bug gate
turns on the reproduction being performable at the value it names. That is the argument for
measuring rather than deriving, and every figure in the table below is measured.

**Four hold a fixed box that ignores the token but overflow rather than clip:**

| Rule | Box | Note |
|---|---|---|
| `.fif-field__icon` (`find-in-files.css:68-73`) | `width: 16px`, no padding, no `overflow` | **Taken** — Cluster B, alongside T165b. The bare case: the token's default copied with nothing around it, so there is no `16 + 3 + 3` to notice. Three of them, labelling the term, replacement and scope fields — the glyph overflows onto the input it labels. **This is the one the original audit missed**, one rule below a rule it had open |
| `.explorer-toolbar__btn` (`explorer.css:21-32`) | 22×22, `padding: 0` | **Taken** — T182a/T182b, because FR-065 is about this control |
| `.pane-collapse` (`panes.css:77-91`) | 22×22, `border: 1px`, no padding — **20 px of content**, overflows at **21** | **Not taken, and not a copy-paste fix**: its own comment says the fixed size is what keeps the control identical whether the pane is expanded or collapsed, so it is load-bearing for the collapsed rail's geometry |
| `.terminal-panel__retry` (`terminal.css:133-146`) | `min-width: 22px`, `height: 22px`, `padding: 0 6px`, no border — **22 px of content**, overflows at **23** | **Not taken.** Grows horizontally, not vertically; carries a third inert `font-size` |

**One more, found by REUSING it** — the clear-inside-an-input control FR-080 copies its markup from,
worn by all three of the preferences search boxes:

| Rule | Box | Note |
|---|---|---|
| `.settings-search__clear` (`preferences.css:247-261`) | `width: 20px`, `height: 20px`, `padding: 0`, `border: none` — **20 px of content**, overflows at **21** | **Not taken.** Inherited pattern, 016's surface, and one rule for three call sites (`settings-tab.tsx:371-390`, `keybindings-tab.tsx:144-163`, `themes-tab.tsx:618-636`). It is the rule FR-080a names by hand, because the control being added is a copy of this one |

The **fourth taken** control, `.fif-btn--clear` (`find-in-files.css`), is in neither table: it is
written by this round rather than found by the audit, and it declares **no box at all** — `.fif-btn`'s
derived box is the whole of its geometry, and this rule adds position and nothing else. A `width`
here of any spelling would be a second box free to disagree with the first, which is exactly the
failure recorded above for `.find-bar-btn` and `.fif-btn` disagreeing by 2 px.

**Partly audited now**: `preferences.css`'s clear control is the row above; the file holds further
fixed 20/24/26 px boxes that may or may not host icons, and `theme.css` is still unopened. Not swept —
the count had already passed the threshold at which this stops being a defect and becomes a pattern,
and **every pass over it has raised the number**.

**The tell, restated because it is what makes the rest findable — and restated CORRECTLY, which is
the second lesson**: the pattern is a magic number equal to a token's default plus the box's own
padding **and border**. `16 + 3 + 3 = 22` is how it looks to a reader and how it looked to this
plan twice; `16 + 3 + 3 + 1 + 1 = 24` is what `border-box` actually spends. **No grep for
`--throng-size-icon` finds any of these**, because the token's name is in none of them. Whoever
takes the issue should search for the *arithmetic*, not the token; should expect the two distinct
symptoms R31 tabulates; and should **measure each box in a browser rather than reading the
declarations**, because a rule that names the token and still starves the glyph looks correct in
every text-level check written for it.

## Decisions taken (2026-09-09)

Six items were put to the maintainer during planning. All six are answered, and the answers are
recorded here rather than in a message, because each one changes what gets built.

### D1. Take the guarded value rewrite (R28)

**Decision: ship the 6 → 7 bump**, rewriting the four defaults when the **whole `search.inFiles`
section** still equals what version 6 shipped.

The reasoning, recorded so it is not re-litigated: these defaults were **asked for explicitly** — the
change requests are what created FR-074 and FR-075. The guard fires only on a section nobody has
touched. And every value it rewrites is a **preference the user changes back in one click**. So the
cost of the guard being wrong is one setting; the cost of fresh-install-only reach is that the person
who requested the change never receives it. Those are not comparable, and the asymmetry is the whole
argument.

**The additive-only contract is being narrowed, deliberately, and this paragraph is the narrowing.**
`shipped-defaults-service.ts:309-313` describes `upgrade()` as *"additive-only … NEVER changing a
value the user already has"*. After this change the contract reads: **additive for tokens and themes
the install does not have; and, for an enumerated, frozen set of leaves and tokens, a rewrite where
the on-disk value is still byte-identical to what a named earlier version shipped.** It is not
"additive-only plus an exception" and it is not a free hand to overwrite — the guard is the contract.
This is the **first non-additive theme upgrade** in the project, and the doc comment on `upgrade()`
must be rewritten to say so, or the next author reads a promise the code no longer keeps.

### D2. Close the Zoom submenu on the untyped placeholder too — **in scope by FR-062a**

**Decision: guard the submenu on the set of panel kinds that consume zoom**, which removes it from
the untyped placeholder as well as making it meaningful on this panel.

This is **in scope by FR-062a as written**, not scope creep. The requirement says the zoom commands
*"MUST NOT be offered on a panel that does not implement zoom"* — general wording, on purpose. Citing
that rule to justify fixing one panel while knowingly leaving the identical violation on the panel
beside it is incoherent: it makes the rule mean "this panel", which is not what it says and not why
it was written. `panel-header-menu.ts:122-150` builds the submenu before the first `panel.kind`
branch at `:153`; only `editor-panel.tsx` and `terminal-panel.tsx` consume `panelZoomLevel`, and after
FR-062 the Find in Files panel joins them. **Roughly three lines**, and it belongs in the same task as
FR-062 because it is the same edit to the same block.

### D3. Accept the transient JSON-editor complaint about a stored `'folder'` (R25)

**Decision: no special case. Leave it.**

`settings-validity.ts:131-136` will report `must be one of: file, fileAndFolder` for a document that
still holds `'folder'`, until the next ordinary write clears it. **This is not a bug and must not be
"fixed" later by someone reading it as one.** Three reasons, in order:

- **It is accurate.** The document does contain a value the schema no longer models. A validation
  checker that stayed quiet about it would be lying about the file it is checking.
- **It is self-clearing.** `writeConfigPatch`'s `parseSettingsGuarded` round-trip persists the coerced
  `'file'` on the first ordinary form write, which is the same lifecycle the retired
  `explorer.openMode` key has.
- **The alternative is worse.** Making it silent means teaching the editor's validation about a
  retired value — a permanent carve-out in a general checker, for one value, that every future reader
  of `settings-validity.ts` has to understand before they can trust the rest of it.

The user still gets the right behaviour throughout: `bounds-guard`'s `correctScalar` reads it as
`'file'` on every read (R25), so nothing is broken while the complaint stands.

### D4. Split `pre-refactor-theme-colours.json`'s two roles — an ORDERED step, not a note

**Decision: separate the two roles in the same change, in this order.** The failure mode is named
because nothing in the suite can see it.

`packages/core/tests/unit/fixtures/pre-refactor-theme-colours.json` is currently asked to be two
things at once: the **non-drift fixture** FR-067 must re-seed
(`default-themes.test.ts:125-139`), and the **frozen record of what version 6 shipped** that D1's
theme guard compares an installed file against. If it stays one file, the guard is handed the *new*
values, compares each theme's on-disk colour against the value the re-derivation just produced, finds
no match on any install, and **rewrites nothing** — while every test passes, because a migration that
plans nothing is indistinguishable from one that had nothing to do. This is exactly what
`shipped-defaults.ts:85-98` warns about for `V4_EXCLUDE_GLOBS` (*"the guard would compare the current
default against itself, match every untouched install forever, and rewrite nothing — a migration that
is silently inert"*), arriving from the theme side.

The order matters, and steps 1 and 2 must both land **before** step 3:

1. **Copy the current search-match values out**, before touching the derivation, into a frozen
   `V6_SEARCH_MATCH_COLOURS` record in `shipped-defaults.ts` — a copy, never a reference to the live
   theme set, for the reason `V4_EXCLUDE_GLOBS` records at `:85-98`.
2. **Write the guard against that record**, and a test proving it plans a rewrite for a theme file
   holding the v6 value and plans **nothing** for one holding anything else.
3. **Then** change the derivation and re-seed `pre-refactor-theme-colours.json`.
4. **Assert the two are different**, so a future author who re-seeds the fixture cannot silently
   re-point the guard at it: a test that the v6 record and the current derived values disagree for at
   least the themes the re-derivation moves.

### D5. Hand-set `throng`'s two literals, and record why it will drift

**Decision: hand-set `THRONG_THEME.colours.searchMatch` and `.searchMatchCurrent`** so the built-in
default clears FR-067's gate exactly as the derived fourteen do.

`throng` is **hand-authored** (`theme.ts:264-266`) and is not run through `makeTheme`; only the
fourteen in `DEFAULT_THEMES` are derived. So the gate applies to all fifteen while only fourteen are
*maintained* by the derivation. **That asymmetry is what makes this easy to miss**: a future change to
`searchHighlights` will re-derive fourteen themes and leave the fifteenth exactly where it was, and
the only thing that will notice is the gate — which is why the gate must run over
`ALL_DEFAULT_THEMES` and not over `DEFAULT_THEMES`. A comment at `theme.ts:264-266` must say that
these two literals are hand-maintained against a rule the other themes satisfy automatically, or the
next author to move the derivation will assume they moved with it.

### D6. Zero new icon tokens

Noted, nothing to decide. FR-068 reuses `icons.replaceAll` (`theme.ts:424`) and FR-070 reuses
`icons.folderOpen` (`folder-picker.tsx:92` is the shipped call site for that exact action).
`EXPECTED_ICON_TOKEN_COUNT` stays **65** (`default-themes.test.ts:30`). FR-065 changes a token's
*value*, which is D1's payload, not the token set.

## Two measurements that need a command run

Neither number can be chosen at planning time, and neither is guessable. Both belong to whoever holds
the test baton, and both must be **run**, not inferred. Named here with their commands so nobody
substitutes a plausible constant.

**M1 — the ΔE00 floor for FR-067.** After the fifteen themes are re-derived (D5 included), measure the
**smallest** of the three gaps — `searchMatch` ↔ `searchMatchCurrent`, and each against `editorBg` —
across every theme in `ALL_DEFAULT_THEMES`, then set the floor **below** it and record the headroom.
This follows `CLOSEST_LEGITIMATE_PAIR_DELTA` / `DISTINCTNESS_THRESHOLD` exactly, including
`theme-quality.ts`'s own rule that *"the constant follows the measurement, never the other way
round"* — so the measurement is taken **after** the re-derivation and the constant is written from it.
The measurement rides the gate's own test, the way the distinctness constant does (*"Value confirmed
by the distinctness test"*, `theme-quality.ts:216-219`):

```bash
npm run test:unit -- packages/core/tests/unit/theme-quality.test.ts
```

**If the re-derivation cannot clear a floor that is perceptually meaningful on the darkest themes,
that is a finding to report, not a number to lower.** A floor chosen to be whatever the themes happen
to pass is a ratchet, not a rule.

**M2 — the re-seeded non-drift fixture.** After D4's steps 1–3, the fixture's new contents are
confirmed by the test that consumes it, which is also what proves nothing *else* drifted:

```bash
npm run test:unit -- packages/core/tests/unit/default-themes.test.ts
```

Both are cheap unit runs and neither is a substitute for the gate. `npm run gate`, dispatched to a
hosted runner, remains the only thing that establishes done-ness.
