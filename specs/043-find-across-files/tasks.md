# Tasks: Find / Replace in Files

**Input**: Design documents from `/specs/043-find-across-files/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Required. Constitution V is NON-NEGOTIABLE — every change ships with coverage at the
**lowest layer that can prove it**, written first and observed failing for the expected reason.

## Format: `[ID] [P?] [Story] Description`

- **[P]** — different files, nothing unfinished depended on. Two consecutive `[P]` tasks never name
  the same file.
- Layer is stated on every test task, because choosing it wrongly is the most common way this list
  goes wrong.

## Layer rules for this feature

| Layer | Use it for |
|---|---|
| `unit` | Anything pure: matching, ordering, snippets, grouping, skip decisions, digit grouping, registry/metadata completeness |
| `component` | Anything rendered: the bar, the results list, menus, the toolbar control. jsdom, no app |
| `integration` | The scan service and the commit, over a real temp tree. OS-serial, one worker |
| `contract` | The IPC channel shape and preload parity |
| `e2e` | **Only** sub-workspace syncing, real restart, and the two window chords. Budget must rise |

**The E2E budget is a ratchet.** Every E2E added here raises `e2e-budget.json` and must state, in that
file's `measuredFrom`, one sentence on what it asserts that no cheaper layer can.

---

## Phase 1: Setup

- [x] T001 Confirm the baseline is green and record it: `npm run lint`, `npm run typecheck`,
      `npm run build`, `npm run test:unit`, `npm run test:component`, `npm run test:integration`,
      `npm run test:contract`. **Do not start work on a red baseline.**

---

## Phase 2: Foundational (blocking — no user story starts until this is done)

**⚠️ Everything below is depended on by two or more stories.**

### The match model moves to core (R1)

- [x] T002 `unit` — move `packages/ui/tests/unit/search-model.test.ts` to
      `packages/core/tests/unit/match-model.test.ts`, importing from `@throng/core`. Run it; it MUST
      fail to resolve. That failure is the Red step.
- [x] T003 Create `packages/core/src/search/match-model.ts` with `MatchModes`, `Match`, `NO_MODES`,
      `SearchCount`, `editorMatches`, `indexFrom`, `stepIndex`, `countOf`, moved verbatim from
      `packages/ui/src/renderer/search/search-model.ts`. Add `@codemirror/state` and
      `@codemirror/search` to `packages/core/package.json`.
- [x] T004 Export the new module from `packages/core/src/index.ts`.
- [x] T005 Replace the body of `packages/ui/src/renderer/search/search-model.ts` with a re-export from
      `@throng/core`, so **no existing caller or test changes** (the `refusal.ts` precedent).
- [x] T006 Run `npm run test:unit` and `npm run test:component`. Every existing search test MUST still
      pass unchanged — that is the proof the move was behaviour-preserving.
- [x] T006a `unit` — assert the **shared** match vocabulary explicitly: a file search's modes are
      exactly case-sensitivity and whole word, taken from the moved model rather than a second
      definition (FR-039), and **no regex mode exists on either surface** (FR-040). Both are otherwise
      discharged only structurally by T002–T005, which is an argument rather than an assertion — and
      FR-040's whole point is that the two surfaces can never drift apart.

### The pure file-search model (data-model.md §2)

- [x] T007 [P] `unit` — `packages/core/tests/unit/file-search-order.test.ts`: FR-035 ordering, files
      before sub-directories, alphanumeric with digits before letters, at every level. Failing first.
- [x] T008 [P] `unit` — `packages/core/tests/unit/file-search-snippet.test.ts`: FR-036 snippet
      extraction to a word boundary each side, ellipsis **only** on a truncated side.
- [x] T009 [P] `unit` — `packages/core/tests/unit/file-search-grouping.test.ts`: FR-033 regrouping
      between the three groupings over one result set; FR-034a everything expanded.
- [x] T010 [P] `unit` — `packages/core/tests/unit/file-search-staleness.test.ts`: FR-045a marks per
      file; FR-045b changes no row's presence, order or actionability; FR-045c clears on rescan.
- [x] T011 Create `packages/core/src/search/file-search.ts` with `SearchScope`, `ResultRow`,
      `SnippetView`, `Grouping`, `ResultGroup`, `ScanStatus` and the five transforms. Make T007–T010
      pass.
- [x] T012 Export it from `packages/core/src/index.ts`.

### The panel type (R17)

- [x] T013 `unit` — extend `packages/core/tests/unit/editor-panel-type.test.ts` (or a sibling): a
      descriptor with `offered: false` is resolvable by `get()` and **present** in `list()` (which
      stays every registered type), but **absent** from `listOfferable()`. Failing first.
- [x] T014 Add `offered?: boolean` to `PanelTypeDescriptor` in
      `packages/core/src/panel-type/descriptor.ts`, defaulting to `true` so the two existing
      descriptors need no change.
- [x] T015 Add a filtered listing to `packages/core/src/panel-type/registry.ts` (`listOfferable()`),
      leaving `list()` and `get()` untouched.
- [x] T016 Create `packages/core/src/find-in-files/panel-type.ts` — `FIND_IN_FILES_KIND`, the
      descriptor with `offered: false`, `validate` gated on an open project.
- [x] T017 Register it in `packages/core/src/panel-type/default-registry.ts` and export from
      `packages/core/src/index.ts`.
- [x] T018 `unit` — `packages/ui/tests/unit/panel-type-form.test.ts`: the New Panel form's options come
      from `listOfferable()`, so Find in Files is **absent** (FR-017). Then point
      `panel-type-form.tsx:110` at `listOfferable()`.

### The persisted query (data-model.md §3)

- [x] T019 [P] Add `FindInFilesPanelConfig` to `packages/core/src/workspace/model.ts` beside
      `EditorPanelConfig`, every field optional.
- [x] T020 `integration` — `packages/persistence/tests/integration/no-find-migration.integration.test.ts`,
      modelled on `no-editor-migration.integration.test.ts`: a Find in Files panel round-trips through
      `workspace_layout` with **no schema change**, and `LATEST_VERSION` is unmoved.
      **Deferred to the Phase 7 wave, deliberately**: it is a proof rather than a blocker (nothing
      depends on it to compile or run), and it is the only integration-layer task in Phase 2, so
      running it alone would cost a whole wave and a test-baton handover to assert one thing. It
      batches with T103, which is the other persistence round-trip.

### The fourth dispatch scope (R14)

- [x] T021 `unit` — `packages/core/tests/unit/keybindings-scope.test.ts` (or extend the existing
      metadata test): a Find in Files panel kind maps to `'findInFiles'`, **not** `'explorer'`, and
      `EXPLORER_ONLY` actions are therefore not live over it. Failing first — this is the
      delete-a-file-by-accident guard.
- [x] T022 Widen `DispatchScope` in `packages/core/src/config/keybindings.ts:142` to include
      `'findInFiles'`. **Do NOT widen `PANELS`** — it carries `editor.save`, `editor.saveAs` and the six
      find-bar `search.*` chords, none of which mean anything over a results panel that holds neither a
      document nor a bar. Add a separate `ANY_PANEL` for the actions that genuinely belong to any panel
      whatever it holds (`panel.rename` — on the old set, F2 there renamed a *file*). `EVERYWHERE` must
      widen too, and that is not optional: `scopeNames` collapses to a single "Everywhere" pill by
      comparing `scopes.size` against `SCOPE_ORDER.length`, so leaving it at three turns every window
      command's one pill into a list — a silent regression two shipped tests assert against.
- [x] T023 Map the kind explicitly in `packages/ui/src/renderer/keybindings/scope.ts:62-66`.

### Settings, bindings and tokens (contracts/settings-and-bindings.md)

- [x] T024 [P] `unit` — `packages/core/tests/unit/settings-inertness-043.test.ts` naming all six new
      keys, copying `settings-inertness-040.test.ts`. It MUST fail now (no readers yet) and is
      re-checked at the end of every story that adds one.
- [x] T025 Add the six leaves to `SearchSettings` in `packages/core/src/config/app-settings.ts`, their
      defaults, and their tolerant parse in `searchSettings()`. **No hand-written clamps.**
- [x] T026 Add six descriptors to `packages/core/src/config/settings-metadata.ts`, `group: 'Search'`.
      `settings-metadata.test.ts` and `reset-completeness.test.ts` must go green.
- [x] T027 [P] Add `search.findInFiles` and `search.replaceInFiles` to the `ActionId` union,
      `COMMAND_SCOPES` (`EVERYWHERE`), and `WINDOWS_BINDINGS` (`Ctrl+Shift+F`, `Ctrl+Shift+H`) in
      `packages/core/src/config/keybindings.ts`.
- [x] T028 Add their two descriptors via `chord()` in
      `packages/core/src/config/keybindings-metadata.ts`.
- [x] T029 [P] Add the `findInFiles` and `searchScope` icon tokens to
      `packages/core/src/config/theme.ts`, their copy to `theme-copy.ts`, and a value in **every**
      bundled theme in `default-themes/index.ts`.
- [x] T030 The assertion at `packages/core/tests/unit/default-themes.test.ts:94` is the **colour**
      count, and it does **not** move — R15 adds no colour token. Record that at the constant so it
      does not read as an oversight. Separately: there is **no icon-token count assertion at all**
      (`ICON_TOKENS = Object.keys(THRONG_THEME.icons)` is self-referential, so a dropped token takes
      its own assertion with it and the suite stays green). Add one that counts **and names** the two
      new tokens — a count alone is satisfied by a rename, and a renamed icon token renders as nothing
      with no error anywhere.
- [x] T031 Bump `SHIPPED_DEFAULTS_VERSION` in `packages/core/src/config/shipped-defaults.ts:65`.
      **Without this an existing install never materialises any of the above.**

**Checkpoint**: `npm run test:unit` green. Foundation ready.

---

## Phase 3: User Story 1 — a find session belongs to its panel (P1) 🎯 MVP

**Goal**: Two editors hold independent find sessions; moving focus never destroys one.

**Independent test**: quickstart Scenario 1.

- [x] T032 `component` — `packages/ui/tests/component/find-session-per-panel.test.ts`: sessions for
      panels A and B coexist with different terms (FR-003); switching the shown panel preserves A's
      term, replacement, modes and current match (FR-002); `Escape` closes only the focused panel's
      (FR-005); destroying a panel discards only its own (FR-006). **Failing first.**
- [x] T033 Rewrite `packages/ui/src/renderer/search/search-store.ts`: `sessions: Map<panelId,
      FindSession>` plus `showingFor`, every action taking a `panelId`, `__resetFindState` preserved
      as the test seam.
- [x] T034 Change `closeFindIfNotOn` from `emit(CLOSED)` to **hide** — set `showingFor = null`,
      mutate no session (FR-002).
- [x] T035 Add the discard-on-destroy hook so `unregisterPanelSearch` also drops the session
      (FR-006); today it leaves the store holding a dead `panelId`.
- [x] T036 [P] Update `packages/ui/src/renderer/search/find-bar.tsx` to read its own panel's session.
- [x] T037 [P] Update `packages/ui/src/renderer/search/search-keybindings.tsx` — every chord resolves
      a `panelId` rather than reading "the current session".
- [x] T038 [P] Update `updateCount` call sites in `packages/ui/src/renderer/editor/use-editor.ts` and
      `packages/ui/src/renderer/terminal/terminal-panel.tsx` to a straight map write.
- [x] T039 `component` — a terminal session and an editor session coexist, and focusing the terminal
      hides the editor's bar without touching its session (FR-004, US1 scenario 4).
- [x] T039a `component` — **a session survives a move.** Detaching a panel into a sub-workspace and
      reattaching it MUST NOT discard its find session; only **destroying** the panel does (FR-025b,
      FR-006). This guards T035 directly: `unregisterPanelSearch` is on the path a move may also take,
      so the distinction between moved and destroyed has to be asserted rather than assumed.
- [x] T040 Run `npm run test:component` and the existing `editor-find`/`terminal-find` E2E specs.
      Nothing in 013's behaviour may change.

**Checkpoint**: US1 is independently shippable.

---

## Phase 4: User Story 2 — the find bar reads as a toolbar (P2)

**Goal**: replace is discoverable and can be put away; the bar reads as grouped controls.

- [x] T041 `component` — `packages/ui/tests/component/find-bar-disclosure.test.ts`: the arrow expands
      and collapses the replace row and renders its state (FR-008); `Ctrl+H` leaves the arrow showing
      expanded and the two routes never disagree (FR-009); a terminal bar has no replace row and no
      arrow (FR-013). **Failing first.**
- [x] T042 Add the disclosure control to `packages/ui/src/renderer/search/find-bar.tsx`, driven by the
      session's `replaceShown`.
- [x] T043 `component` — every action button has visible space between glyph and border, and the
      match-mode, navigation and replace groups are distinguishable (FR-010), asserted through
      `getComputedStyle`. **Also assert the bar keeps its existing anchoring within its panel**
      (FR-012) and that the **disclosure control** T042 adds is a themeable icon with a hover title
      naming its action and no hardcoded colour (FR-011 — which binds the find bar as well as the new
      panel). *Note on the Red step*: the spacing and FR-011 halves fail first as normal, but the
      **anchoring** half is a regression guard that must be green **before** T044 rewrites
      `find-bar.css` and green after. Write it, watch it pass, then change the CSS.
- [x] T044 Re-space the controls in `packages/ui/src/renderer/search/find-bar.css`.
- [x] T045 [P] `unit` — the `N of M` counter renders digit-grouped at four figures and above
      (FR-014). This closes the constitution's **named enumerated gap** for this surface.
- [x] T046 Apply `formatGrouped` to the counter in `find-bar.tsx`.
- [x] T047 [P] Add Find, Replace and Replace All to the owning panel's menu in
      `packages/ui/src/renderer/workspace/panel-header-menu.ts`, `section: 'content'`, each showing its
      chord via `firstBinding` (FR-015). This closes the enumerated `search.*` menu gap.
- [x] T048 Add the new builder to `packages/ui/tests/unit/menu-sections.test.ts`'s import list, or it
      is never checked.

**Checkpoint**: the control language the new panel inherits is settled.

---

## Phase 5: User Story 3 — find text across a project's files (P3)

**Goal**: a Find in Files panel lists every occurrence in scope, and a row opens its file at the match.

### The scan service

- [x] T049 `integration` — `packages/ui/tests/integration/file-search-scan.integration.test.ts` over a
      real temp tree: results stream in batches **before** the walk completes (FR-041); a second start
      supersedes rather than compounds (FR-043c); a cancelled walk yields nothing, not a truncated set
      (FR-043). **Failing first.**
- [x] T050 Create `packages/ui/src/main/file-search-service.ts`: one `ScanRun` per panel, a
      `generation` counter, a polled `cancelled()` thunk, reusing `walkFiles` and `compileExcluder`.
      **It owns the batch bound**: no update carries more than `MAX_ROWS_PER_BATCH` (250) rows, and a
      short batch is flushed at least every `BATCH_FLUSH_MS` (50 ms) so a slow filesystem still shows
      progress. Both constants live in `packages/core/src/search/file-search.ts`.
- [x] T051 `integration` — excluded, binary, over-size and unreadable files produce **no rows** and
      **one** skipped count for the whole scan (FR-045e, FR-045f).
- [x] T052 Apply the exclusion predicate, `isProbablyBinary`, the `editor.maxOpenFileBytes` guard and
      a read-failure skip in the scan service.
- [x] T053 `integration` — a sub-directory scope reads nothing above it (FR-030, US3 scenario 7); a
      missing scope directory yields `scopeMissing` and no rows (FR-030a).
- [x] T053a `integration` — **project isolation**: with a second project made active, a search reads
      only that project's files and nothing under the first project's root (FR-018, US3 scenario 8).
      This is the assertion plan.md's Principle I row names, so it must exist.
- [x] T053b `integration` — **SC-004's scan half**: over a generated corpus of **at least 5,000
      files** with a term matching far more than 250 times, the first batch arrives before the walk
      completes and **no batch exceeds `MAX_ROWS_PER_BATCH`**. Asserting the constant is what makes
      this falsifiable; "size-bounded" alone is a property no implementation can fail. This layer runs
      the scan service in UI main and has no renderer, so it asserts batch **production**.
- [x] T053c `component` — **SC-004's renderer half**, asserted **structurally, not by wall clock**:
      handling one maximum-size batch processes at most `MAX_ROWS_PER_BATCH` rows in a single
      synchronous turn and yields between batches, so a stream of them cannot monopolise the renderer.
      *A timing assertion was considered and rejected*: a 100 ms wall-clock budget in jsdom measures
      store CPU on whatever machine happens to run it, and this repo has a strict flaky-test gate. The
      100 ms in SC-004 is the **design budget** those bounds are chosen to respect and the thing the
      hands-on step in `quickstart.md` actually judges.

### The IPC channel

- [x] T054 `contract` — `packages/ui/tests/contract/file-search-ipc.contract.test.ts`: the four
      channels' shapes per [contracts/file-search-ipc.md](./contracts/file-search-ipc.md); an update
      from a superseded `generation` is dropped by the consumer.
- [x] T055 Create `packages/ui/src/main/file-search-ipc.ts` — subscribe/snapshot/delta to **one**
      `webContents`, the subscriber taken from `event.sender`, never payload-supplied.
- [x] T056 Add the four channels to `packages/ui/src/preload/preload.cts`.
      `ipc-bridge-parity.test.ts` fails the build if main and preload disagree.

### The panel

- [x] T057 `component` — `packages/ui/tests/component/find-in-files-results.test.ts`: one row per
      match, not one per file (FR-032); the match highlighted inside its snippet with ellipses
      (FR-036); groups **expanded** with all rows visible (FR-034a); a collapsed group persists showing
      its digit-grouped count (FR-034, FR-014). **Also assert the highlight resolves from the existing
      `searchMatch` / `searchMatchCurrent` theme tokens** — not a new token and not a hardcoded colour
      (FR-044). No shipped guard catches that: `icon-tokens-exist.test.ts` covers icons only.
      **Failing first.**
- [x] T058 [P] Create `packages/ui/src/renderer/find-in-files/find-in-files-store.ts` — panel-scoped
      state, subscribing to the update channel and discarding superseded generations.
- [x] T059 Create `packages/ui/src/renderer/find-in-files/results-list.tsx`, **virtualised** — nothing
      in the renderer is windowed today, and the spec's Assumptions decline a match ceiling, so this is
      new work rather than a copy of Quick Open's cap-at-200.
- [x] T060 Create `packages/ui/src/renderer/find-in-files/find-in-files-panel.tsx` with its own search
      input and match-mode controls (FR-031), and a `find-in-files.css`.
- [x] T061 Add the `panel.kind === 'findInFiles'` branch to
      `packages/ui/src/renderer/workspace/panel-body.tsx`.
- [x] T062 `component` — the four `ScanStatus` states render distinguishably: not run, running,
      complete-with-nothing, scope missing (FR-024, FR-042, FR-030a).
- [x] T063 [P] `component` — switching grouping regroups **without** re-running (FR-033); the default
      is per file (FR-033a); remembering reuses the project's last choice and a fresh project opens in
      the default (FR-033b, FR-033c).
- [x] T064 Wire the **two** grouping preferences (`defaultGrouping`, `rememberGrouping`) into the
      panel. `settings-inertness-043.test.ts` gains two readers.

### What starts a scan (FR-043a, FR-043b, FR-043c)

**This is the shipped default behaviour and it owns two of the six settings keys.**

- [x] T064a `component` — `packages/ui/tests/component/find-in-files-trigger.test.ts`: with the shipped
      default, editing the term, the match modes or the scope starts **no** scan and the listed results
      stay those of the last run (FR-043a, US3 scenario 26); `Enter` and the run command each start one.
      **Failing first.**
- [x] T064b `component` — with `trigger: 'asYouType'`, editing the term and pausing starts a scan, and a
      scan already running for that panel is **superseded, not compounded** (FR-043b, FR-043c, US3
      scenario 27).
- [x] T064c `component` — invoking find in files on a **reused** panel with no selection re-runs the
      panel's existing term rather than leaving stale results (FR-043a's final clause).
- [x] T064d Implement the trigger in the panel, reading `search.inFiles.trigger` and
      `search.inFiles.settleMs`. **Use a quiet period plus a forced ceiling**, not a plain timer — a
      pure quiet-period debounce never fires under sustained churn (#186; `ProjectFileIndexService`
      pairs `quietMs` with `reconcileMaxWaitMs` for exactly this).
      `settings-inertness-043.test.ts` gains two more readers (four of six; T097 and T101 add the rest).

### The scope control (FR-030, FR-030a)

- [x] T064e `component` — `packages/ui/tests/component/find-in-files-scope.test.ts`: the panel shows
      which scope its results came from and carries an **editable** control that retargets without
      starting again (FR-030); a missing scope is marked on that control while every listed row stays
      usable, and retargeting clears the condition (FR-030a, US3 scenario 30). **Failing first.**
- [x] T064f Build the scope control in `find-in-files-panel.tsx`, using the `searchScope` icon token
      added in T029 — an icon token with no call site would otherwise sit unused.

### Entry points

- [x] T065 `component` — `packages/ui/tests/component/explorer-toolbar.test.ts` extended: a Find in
      Files control sits beside Quick Open, **drawn and disabled** with no project (FR-029a, FR-029e),
      its title carrying the live chord while its `aria-label` does not.
- [x] T066 Add the control to `packages/ui/src/renderer/explorer/toolbar.tsx`, copying Quick Open's
      raw `<button>` shape rather than `IconButton`, and pass the enabled flag from both call sites
      (`file-tree.tsx`, `panes/file-explorer-pane.tsx`).
- [x] T067 [P] `unit` — the folder context menu offers Find in Files on a folder only, in the
      `navigate` section (FR-029b).
- [x] T068 Add the item to `packages/ui/src/renderer/explorer/context-menu-items.ts`, gated on
      `node.kind === 'folder'`.
- [x] T069 Register the two commands so the chords open or reuse a panel per FR-020/FR-021/FR-022, and
      seed the term from a single-line selection on the **chord routes only** (FR-031a, FR-031b).
- [x] T070 `component` — seeding: a chord with a selection pre-fills and selects the input; with no
      selection a reused panel keeps its term and a new one opens empty; the toolbar and context-menu
      routes never seed (US3 scenarios 21–23).
- [x] T070a `component` — **replace in files is the same command with replace pre-enabled**: it honours
      FR-021/FR-022 identically, turns the toggle **on** in a reused panel that had it off, and focuses
      the **replacement** input (FR-029d, FR-031c, US4 scenarios 16–17). It adds no second toolbar
      control and no second context-menu item.
- [x] T070b `component` — however a panel is opened or reused, an input receives focus **with its
      contents selected** — the search input for find, the replacement input for replace — including on
      the toolbar and context-menu routes, which seed nothing but still focus (FR-031c).
- [x] T070c `component` — **no project open**: **both chords are inert**; the toolbar control and the
      folder context-menu item are drawn and **disabled**; and **no notice is raised** (FR-029e, US3
      scenario 25). Replace in files has no visible surface of its own (FR-029d), so its chord being
      inert is all there is to assert for it. T065 covers only the toolbar control.
- [x] T071 Add both actions to `WINDOW_HANDLED_ACTIONS` in `packages/ui/src/renderer/app.tsx` and add
      their entries to `window-chord-resolution.e2e.ts`'s `COVERED` map — **`window-chord-manifest.test.ts`
      fails the build without them**, which is the `Ctrl+Shift+T` silent-inertness trap.

### Opening a result

- [x] T072 `component` — double-clicking a row opens through the "Open files in" preference, honouring
      the one-buffer, dirty-editor and dedicated-editor rules (FR-037); keyboard arrow + Enter does the
      same (Assumptions).
- [x] T073 Extend `openFileInTab` in `packages/ui/src/renderer/editor/editor-open.tsx` to accept an
      optional target range.
- [x] T074 Reveal the match **selected**, not merely scrolled to (FR-038), deferring until
      `getEditorView(panelId)` resolves — the open is async and the panel is created by a layout
      mutation.
- [x] T075 `component` — the panel's own menu carries run, cancel, toggle replace, grouping, scope,
      collapse/expand and each commit granularity, in the sections
      [contracts/settings-and-bindings.md](./contracts/settings-and-bindings.md) fixes (FR-025a).
- [x] T076 Create `packages/ui/src/renderer/find-in-files/content-menu.ts` and add it to
      `menu-sections.test.ts`'s import list.

### Staleness

- [x] T077 `integration` — a file that contributed results is modified; **that file's** group is marked
      stale and no other is (FR-045a, US3 scenario 14); re-running clears it (FR-045c).
- [x] T078 Add a consumer beside `ProjectFileIndexService` on the **existing** `throng:files:changed`
      watch that re-stats the held result files under the signalled directory. **Add no watcher**
      (FR-045d).
- [x] T079 `component` — a stale group disables, hides, greys and reorders **nothing**, and every row
      still opens (FR-045b, US3 scenario 15).

**Checkpoint**: US3 is independently shippable — finding works without replace.

---

## Phase 6: User Story 4 — preview and commit a replace (P4)

**Goal**: the user reads exactly what would change, then commits, and open files stay undoable.

### The preview

- [x] T080 `component` — toggling replace renders every row as struck-through match plus proposed
      replacement, and **no file changes** (FR-046, FR-047); an empty replacement renders as
      struck-through with nothing after it (FR-046a); editing the replacement, the term, the modes or
      toggling off still changes nothing (FR-048). **Failing first.**
- [x] T081 Add the replace toggle, the replacement input and the preview rendering to the panel.
- [x] T082 `component` — a committed row is visibly distinguishable from a pending one (FR-051).

### The commit — the highest-risk work in the feature

- [x] T083 `integration` — `packages/ui/tests/integration/replace-commit.integration.test.ts` with the
      **four-file fixture** from quickstart Scenario 4: an editor in the **active** tab, an editor in a
      **background** tab, one with unrelated unsaved edits, and one with no editor. **Failing first.**
- [x] T084 `integration` — **the background-tab file is changed.** This is the assertion that catches
      the defect research found: a renderer-driven commit would skip its buffer edit *and* decline its
      disk write, leaving it silently untouched (R7).
- [x] T085 Add a bulk-edit entry point to `packages/ui/src/main/editor-coordinator.ts` that builds the
      `ChangeSet` against `authority.version`, dispatches with a **synthetic view id** and
      `mergeClass: null`, and relays with `relaySync(-1, …)`.
- [x] T086 Create `packages/ui/src/main/replace-commit-service.ts`: partition open vs unopened from the
      registry, **in one main-side turn**.
- [x] T087 `integration` — every match is re-verified against current content immediately before its
      write, **unconditionally**, not only for stale files (FR-054, US4 scenario 10); a match edited
      away is refused for that match only and the rest is unaffected (FR-054a, US4 scenario 9).
- [x] T088 Implement the pre-write re-check, and re-check `isOpen` immediately before each
      `writeBytes` — following `EditorCoordinator.save`'s Save-As precedent (R8).
- [x] T089 `integration` — line endings and any BOM survive byte-for-byte in the unopened file
      (FR-056).
- [x] T090 Implement the direct write as `decode` → replace → `encode` with the **same**
      `{encoding, hasBom, lineEnding}`, plus confinement (FR-053, R9).
- [x] T091 `integration` — a commit saves **no** editor; affected buffers are left dirty; unrelated
      unsaved work never reaches disk (FR-053a, FR-053b, FR-053c, US4 scenarios 14–15).
- [x] T092 `integration` — undo in one affected editor reverts **only** that document, as a single step
      (FR-052, FR-057, US4 scenarios 6–7).
- [x] T093 [P] `component` — the three commit granularities are distinct deliberate actions (FR-049);
      stepping through committing some and skipping others leaves skipped rows pending (FR-050).
- [x] T094 Wire the three granularities from the panel to the commit service.
- [x] T095 [P] `component` — a commit touching any unopened file warns first with a **digit-grouped**
      file count and writes nothing until confirmed (FR-057b, FR-014); with every file open no warning
      appears (FR-057d); with the preference off it proceeds (FR-057c).
- [x] T096 Implement the confirmation, reusing the shipped confirmation model — its decision buttons
      keep text labels under the themeable-icon exception.
- [x] T097 Wire `search.inFiles.warnIrreversibleCommit`; `settings-inertness-043.test.ts` gains its
      reader.
- [x] T098 `integration` — a partially-failing commit reports which files changed and which did not,
      and why, **once** (FR-058). One notice carrying all four arrays, not four notices.
- [x] T099 Replacement text is never re-matched by the same operation (FR-055) — `unit`, over the pure
      model.

**Checkpoint**: US4 shippable. The feature is functionally complete.

---

## Phase 7: User Story 5 — panels behave like panels (P5)

- [x] T100 [P] `component` — a second search in a tab reuses the last active panel or opens a new one
      per the preference (FR-021, US5 scenarios 1–2); a tab with no Find in Files panel gets one
      **there** whatever the preference says (FR-022, US5 scenario 3). Extend to **three** panels held
      open at once, each returnable with its own results and without re-running (FR-019, SC-009).
      `packages/ui/tests/component/find-in-files-panels.test.ts`. The reuse and per-tab rules were
      already green from T070 (`find-in-files-entry.test.ts`); what this adds is the three-panel
      independence, asserted across an unmount and remount — which is what an inactive Tab does to a
      panel, and what would fail if results lived in a component rather than in the store.
- [x] T101 Wire `search.inFiles.openTarget`; `settings-inertness-043.test.ts` gains its reader.
      Already satisfied by `find-in-files-chrome.tsx`, which reads the `inFiles` section by name and
      passes `openTarget` to the opener; T111 had recorded all six keys as live.
- [x] T102 [P] `component` — closing a panel discards its results, and a panel opened afterwards starts
      with none (FR-023, US5 scenario 5). `packages/ui/tests/component/find-in-files-discard.test.ts`
      for the behaviour, plus `packages/ui/tests/unit/find-in-files-destroy-call-sites.test.ts` for the
      wiring: every renderer file that ends a panel's find session now also destroys its Find in Files
      state (`panel-placeholder.tsx`, `tab-group.tsx`, `panel-destroy-sync.tsx`).
- [x] T103 [P] `integration` — the panel round-trips through the layout blob with its term, match
      modes, scope, replace toggle and replacement, and **no results** (FR-027a, FR-027b, US5 scenario
      9); a pending preview does not survive (FR-027c).
      `packages/ui/tests/integration/find-in-files-persistence.integration.test.ts`.
- [x] T104 Implement config read/write via `updatePanelConfig`, and the restored "not yet run" state,
      following 039's dormant-terminal precedent.
      `packages/ui/src/renderer/find-in-files/panel-config.ts` holds the mapping both ways;
      `FindInFilesPanel` reads it once at creation and writes the whole query back through an
      `onConfigChange` prop that `PanelBody` fills with `updatePanelConfig`. The prop rather than
      `useWorkspace()` because the panel is mounted without a provider throughout the component suite.
- [x] T105 `e2e` `@explorer @extended` — a Find in Files panel synced into a sub-workspace shows the
      parent's results, closes when the parent is destroyed, and leaves the parent alone when the
      sub-workspace view closes (FR-025, FR-026, FR-027, US5 scenarios 6–8). **Irreducible**: real
      multi-window lifecycle. `packages/ui/tests/e2e/find-in-files-subworkspace.e2e.ts`.
      **SCENARIO 6 IS NOT COVERED, AND THE BEHAVIOUR DOES NOT EXIST.** `FileSearchService` delivers
      every update to exactly ONE `webContents` — its own words at `file-search-service.ts:186`,
      *"Never a broadcast — two panels, two projects (FR-018)"* — so a second window holding the same
      panel receives nothing and shows a panel that has not run. The spec was written and run with the
      mirroring assertion first, and it failed on that line; see the spec file's header. Closing the
      gap is a design decision with no task behind it: a window must be able to register interest in
      another window's scan, and something must answer what a window attaching AFTER a scan finished
      sees — main streams rows and discards them, and retaining them is the "retention store to size"
      this spec's Assumptions decline. What IS asserted: FR-025b (the query travels with the panel,
      via `Panel.config`), FR-026 and FR-027.
- [x] T106 `e2e` `@persistence @extended` — the panel and its query survive a real application restart
      with no results and no preview (US5 scenarios 9–10). **Irreducible**: real application-runtime
      identity across a restart. `packages/ui/tests/e2e/find-in-files-restart.e2e.ts`.
- [x] T107 `e2e` `@window @core` — `Ctrl+Shift+F` and `Ctrl+Shift+H` reach the resolver through the
      `keepShift` branch and open a panel. **Irreducible**: real keyboard and input dispatch. Added to
      `window-chord-resolution.e2e.ts`, which is where `window-chords.ts`'s `COVERED` map already
      claimed both actions were pressed.
- [x] T108 Raise `packages/ui/tests/e2e/e2e-budget.json` — total, `@core`, and each category touched —
      and add the one-sentence justification per test to `measuredFrom`, matching the six raises
      already recorded there. total 563→566, core 38→39, `@explorer` 39→40, `@window` 193→194, and a
      new `@persistence` entry at 1 (the tag was in the closed vocabulary with no test carrying it).

---

## Phase 8: Polish and documentation

- [x] T109 [P] Update `README.md` with the two chords and the Find in Files capability
      (documentation-currency NON-NEGOTIABLE — same change, not a follow-up).
- [x] T110 [P] Update `docs/testing.md` if the layer counts or budgets moved. **No change needed**:
      every count in that file is a dated measurement at a named SHA (035's 229-file census, the
      2026-08-20 run at 207 spec files / 548 declarations), it quotes no budget total and no
      per-layer test count that 043 moved, and its category-tag vocabulary already lists
      `@persistence`. Re-stating the E2E timings would need a full local run, which this feature
      does not authorise.
- [x] T111 Run `settings-inertness-043.test.ts`. All six keys must now have readers outside the config
      layer (FR-059a); any that does not is an inert setting and a defect.
- [x] T112 `unit` — every count this feature displays is digit-grouped at every magnitude (FR-014,
      SC-010): the bar's counter, the panel total, collapsed-group counts, the skipped count, and the
      warning's file count. `packages/ui/tests/unit/find-in-files-counts-grouped.test.ts` covers the
      warning's file count (magnitudes and locales) and the outcome notice's four figures, plus a
      source guard that every displayed count is interpolated through `formatGrouped` and never
      bare. The bar's counter is `tests/unit/find-count-label.test.ts`; the panel total, a collapsed
      group's count and the skipped count are `tests/component/find-in-files-results.test.ts` and
      `find-in-files-status.test.ts` — not duplicated here.
- [x] T112a `unit` — FR-014's **negative** half: a grouping character never reaches a stored value.
      Assert that a persisted `FindInFilesPanelConfig` and every `FileSearchUpdate` / `CommitRequest`
      payload carry **raw** numbers. Grouping is strictly a view concern, and this is the half a
      display-only test cannot see.
      `packages/ui/tests/unit/find-in-files-grouping-view-only.test.ts`.
- [x] T112b `component` — every action control the **panel** introduces — the replace toggle, the
      scope control, collapse/expand, and each commit granularity — is a themeable icon carrying a
      hover title that names its action, with colours from theme tokens and none hardcoded (FR-011).
      T065 asserts this only for the explorer toolbar control.
      `packages/ui/tests/component/find-in-files-panel-controls.test.ts`. The commit granularities
      and collapse/expand-all are offered only in the panel's menu, so they are asserted as drawn
      icon cells and labels there — `tests/unit/menu-icon-tokens.test.ts` does not read this
      builder, so nothing else in the repository would see an unresolved token in those rows. The
      scope control is a text FIELD, not an icon action control: its icon and accessible name are
      asserted, and its action is the menu's `Change scope` row.
- [x] T113 Local verification: lint, typecheck, unit, component, integration, contract. **Not E2E and
      not the gate** — those run on the gate runner, never here. This task originally said "then E2E
      once"; that was wrong and was corrected after a full local run was started and had to be killed.
      See `throng-testing`, *The commands that are never run locally*.
- [x] T114 Dispatch `npm run gate` on the branch and take the verdict from `gh run view`, not from
      `gh run watch`'s exit code.
      Green at `ff347e81`, 35m02s, all eight stages:
      <https://github.com/Bidthedog/throng/actions/runs/34375121724>. The watch's own exit code was
      taken as advisory only, per the rule this task states — the verdict is `completed/success` from
      `run view`. An earlier green at `aa04dc96`
      (<https://github.com/Bidthedog/throng/actions/runs/34367896205>, 36m00s) covered the feature
      but predates the #378 and #379 fixes, so it is superseded rather than cited.

---

## Dependencies

```
Phase 2 (foundational) ──┬── Phase 3 (US1)  ─── independently shippable
                         ├── Phase 4 (US2)  ─── independent of US1 in code
                         └── Phase 5 (US3) ── Phase 6 (US4) ── Phase 7 (US5)
                                                                    │
                                                              Phase 8 (polish)
```

- **US1 and US2 are independent of each other and of US3–US5.** Either can ship alone.
- **US4 depends on US3** — there is nothing to preview without results.
- **US5 depends on US3** for a panel to persist, and on US4 only for scenario 10.

## Parallel opportunities

- T007–T010 — four pure test files, no shared source.
- T019 and T020 — different packages.
- T024, T027, T029 — settings, keybindings and theme tokens are three separate core files.
- T036, T037, T038 — three distinct renderer consumers of the find store, after T033 lands.
- T093, T095, T100, T102, T103 — different test files across the last two stories.

**Never parallel**: anything touching `packages/core/src/index.ts` (T004, T012, T017), which every
export task appends to. Serialise those three.

## The test baton

`npm run test:*`, `lint`, `typecheck` and `build` are **one at a time across every agent** on this
machine. A dispatched agent either holds the baton and is told the exact command, or runs no test
command at all and reports what it needed.

---

## Phase 9: Convergence

**Assessed 2026-09-09** against `spec.md`, `plan.md` and `.specify/memory/constitution.md`, by
reading the code as it now stands. 92 functional requirements, 13 success criteria, 5 user stories
(88 acceptance scenarios), 16 plan decisions and 11 constitution principles were checked; three
findings. No constitution MUST principle is violated, and no CRITICAL was found.

- [x] T115 Raise the missing-scope condition when the scope directory goes, not only when the next
  scan is started, and keep the listed rows when it is raised, per FR-030a / US3 scenario 30
  (partial). Today `markFindInFilesScopeMissing` has exactly one caller — `runFindInFiles`'s
  `.then()` on a `scopeMissing` start result (`find-in-files-store.ts:499`) — so deleting a scoped
  sub-directory marks nothing until the user runs again. And when the run does raise it,
  `FileSearchService.start` has already called `supersede()` (`file-search-service.ts:230`) before
  the `exists` check at `:242`, so the `scopeMissing` update carries a NEW generation and
  `applyFileSearchUpdate` replaces `rows` with `[]` — the opposite of FR-030a's "results already
  listed MUST stay listed and fully usable". The existing `throng:files:changed` consumer
  (`noteDirectoryChanged`) is where the detection belongs, so this needs no new watcher (FR-045d).

- [x] T116 Show per-file staleness under the **per-folder** grouping as well, per FR-045a and SC-012
  (partial). `ResultGroup.stale` is only ever set on a `kind: 'file'` group
  (`packages/core/src/search/file-search.ts:289`), and `groupRows(rows, 'folder')` produces folder
  groups with no file
  children — so with Group by folder selected nothing on screen says which files changed since the
  scan. `results-list.tsx` already carries `stale` onto each `ResultListItem` row
  (`flattenGroups`, `:104`) and `renderRow` ignores it, which is the cheapest place to close this.
  `find-in-files-staleness.test.ts:103` covers `file` and `fileAndFolder` only.

- [x] T117 Remove or wire the two unused exports this feature added (unrequested):
  `clearStale` in `packages/core/src/search/file-search.ts:301`, exported from `core/src/index.ts`
  and called only by its own unit test — FR-045c is actually satisfied by the generation reset in
  `applyFileSearchUpdate`; and `NO_FIND_IN_FILES_QUERY` in
  `packages/ui/src/renderer/find-in-files/panel-config.ts:80`, which has no reference anywhere.

---

## Phase 10: Convergence

**Assessed 2026-09-09**, second pass, against `spec.md`, `plan.md`, `data-model.md`,
`contracts/file-search-ipc.md` and `.specify/memory/constitution.md`, by reading the code as it now
stands at `941ad671`. 92 functional requirements, 13 success criteria, 5 user stories, 16 plan
decisions and 11 constitution principles were re-checked, with the three Phase 9 fixes verified
against the findings they were raised for.

**Phase 9 closed.** T115: the `exists` check now precedes `supersede()`
(`file-search-service.ts:252`), a refusal re-emits at the run's **current** generation
(`reportScopeMissing`), `applyFileSearchUpdate` therefore appends rather than replaces, and the
condition is raised from the existing `throng:files:changed` consumer via `noteScopeMissingIfGone`
with no watcher added and three guards that keep it to at most one `exists` per run per tick.
T116: `flattenGroups` marks the ROW where no file heading exists and the heading where one does, so
all three groupings say it exactly once, as an attribute plus a child element with nothing greyed.
T117: no reference to `clearStale` or `NO_FIND_IN_FILES_QUERY` survives in any `src/` or test, and
FR-045c holds via `supersede`'s clear, the fold's new-generation reset and the panel's per-render
rebuild. Two findings remain, both LOW; no constitution MUST principle is violated.

- [x] T118 Keep the completed run's readout truthful when the missing scope is raised over it, per
  FR-042 / FR-030a and data-model §2's "five states, five readings" invariant (partial).
  `noteScopeMissingIfGone` overwrites a finished run's `status` with `scopeMissing`
  (`file-search-service.ts:466`) and emits the run's real `totalMatches`, `filesScanned` and
  `skipped` alongside it. `StatusLine` gates its counts on `status === 'running' || (status ===
  'complete' && totalMatches > 0)` (`find-in-files-panel.tsx:744`), so deleting the scoped folder
  makes "N matches in M files" vanish while the N rows stay listed, and the ungated `skipped > 0`
  branch can leave "Scope not found · 3 skipped" — a skip count from a scan the same line says did
  not happen. Newly reachable: before T115 a `scopeMissing` update carried a superseded run's reset
  counters and no rows. FR-030a names the **scope control** as the surface for this condition and it
  already carries it (`fif-scope-missing-*`); the run's status describing the run is the cheaper fix.

- [x] T119 Reconcile `data-model.md` §2's transform table with the model that now exists, per
  `plan: data model` (contradicts). It still lists
  `| clearStale(groups, rescanned): ResultGroup[] | FR-045c |` (`data-model.md:105`), which T117
  removed as unreachable — so the design artifact declares a public transform for FR-045c that
  `packages/core/src/search/file-search.ts` deliberately does not have, and both the source and
  `file-search-staleness.test.ts` carry comments explaining why. Record FR-045c against the three
  mechanisms that do satisfy it rather than against a function. `spec.md` and `plan.md` are not to
  be touched.

**Phase 10 closed.** T118: the first of the two options — the run's status goes on describing the run,
and the condition stays on the scope control FR-030a names for it, so it is said once. The fold is
where that is decided: `applyFileSearchUpdate` takes a `scopeMissing` status only when the update is
FRESH (a search refused before it started, superseded into a new generation with every counter zeroed)
and keeps the state's own status when it arrives at the current generation (the watcher noticing the
directory has gone from under a finished run). `receive` reads `update.status` separately, so the
control still marks. "Scope not found · N skipped" is additionally ungrammatical by gate rather than
only by reachability — `StatusLine` renders no skip count under `scopeMissing`. The rows, the
generation and the single-watcher constraint T115 fixed are untouched; the two integration assertions
that read the fold's status now assert `complete`, which is the same fix stated at that tier.
T119: the `clearStale` row is gone from `data-model.md` §2 and FR-045c is recorded against the three
mechanisms that satisfy it, with a second `ScanStatus` invariant recording T118's distinction.

---

## Phase 11: Round two — post-testing changes

**Added 2026-09-09.** Round one shipped and is gated green at `ff347e81`. This phase implements
FR-060 – FR-078a, research **R23–R30**, and the six decisions recorded in `plan.md` as **D1–D6**.
Nothing above this line is re-opened.

**Order is deliberate and is not a preference.** The migration comes first because it is the only
work this round that can **fail silently and green** — a guard pointed at the wrong record plans
nothing, rewrites nothing, and passes every test. Cross-window delivery comes second because it is the
largest behaviour change and spans main, the contract and the store. The cosmetics come last.

**Three items are defect-shaped**, not new features, and each opens with a test that proves the
violation before anything is fixed. Two are defects against requirements that **already existed**:

- **021 FR-049** — *"Pane Text MUST reach the body text of every pane and panel"*. **T158**.
- **Constitution VI**, disabled-versus-absent — three permanently inert zoom commands. **T170**.

The third is a defect against a requirement written **in this round**, and the distinction is not
pedantry — it is the correction of a process error worth seeing:

- **FR-079** — an icon control's box hardcoded from `sizes.iconPx`'s default. **T165a/T165b**,
  **T182a/T182b**. It was first authorised under FR-065, which says *"The remedy is the glyph"* and
  therefore covers no such thing; rather than relabel the work, FR-079 was written for it. Work with
  no requirement behind it is how a spec stops being the thing that decides what ships.

---

**A default is carried by PROSE as well as by code, and no gate reads prose.**

This has now surfaced three times in one round, and it will surface again, so it is stated here as a
rule rather than re-derived each time. The completeness tests check that every key **is described**;
nothing checks that the **description is true**. So a change of default is not done when the constant
moves — it is done when **every place that ASSERTS the old value has moved**, and those places are
found by *reading*, not by grepping for the constant, because most of them never mention it.

The **nine** carriers of `search.inFiles`'s defaults, as the worked example:

| # | Carrier | Kind | Moved by |
|---|---|---|---|
| 1 | `app-settings.ts` `DEFAULT_APP_SETTINGS` | the constant | T169 |
| 2 | `settings-metadata.ts` descriptor (`allowedValues`, `optionLabels`) | the schema | T169 |
| 3 | `shipped-defaults.ts` + the materialised document on disk | the migration | T120–T125 |
| 4 | `spec.md` FR-059's table | prose | done, round-two amendment |
| 5 | `contracts/settings-and-bindings.md` "Ships as" column | prose | T169 (confirm) |
| 6 | `app-settings.ts:624-627` — the comment **arguing for** explicit run, citing FR-043a | **prose, beside the constant** | T169 |
| 7 | `settings-metadata.ts:852-858` — the comment explaining why **250 ms** is right | **prose, beside the schema** | T169 |
| 8 | `app-settings.ts:628-631` — *"deliberately about **twice** `asYouTypeDebounceMs`"*; at 500 the figure **and the relation** are both false | **prose, beside the constant** | T169 |
| 9 | `settings-metadata.ts:811-820` — the section comment arguing the six leaves belong in the **same** Search section as the find bar's delay, which is exactly what FR-076 splits | **prose, beside the schema** | T169 |

Carriers 6–9 are the instructive ones: they sit *in the same files as* carriers 1 and 2, a few lines
away, and a diff that changes the value without them leaves the file arguing against its own contents.
Nothing in the suite can fail on that.

**What the count itself demonstrates, which is a better argument than the rule.** It went
**4 → 5 → 7 → 9** across three analysis passes of the same feature. Every increase was found by
**reading the files the change touches** — never by grepping, because six of the nine never mention
the value's name, and two of them argue a *relation* (twice the find bar's debounce; the same section
as the find bar's delay) that no search for `250` or `'run'` would surface. The rule stated on its own
sounds like diligence; the progression shows that three careful passes each still left carriers
standing. **Nine, for one feature's six settings** — that is the number worth carrying into the next
default change.

**A third item, F2, is already applied** and has no task by design: `data-model.md` §6 documented four
`FailedCommit` reasons where `replace-commit-service.ts:81` ships seven, and the correction landed
with the round-two plan amendment rather than as implementation work — no code changes, and
`contracts/file-search-ipc.md` already agreed with the code. It is stated here anyway, because "it was
fixed in a document so it needs no line in the list" is the same reasoning that left F1 living only in
a test file's header comment.

**Two clusters must NOT be parallelised**, and no `[P]` appears inside either:

- **Cluster A** (**T148–T157**, eleven tasks — **T153a** included) — FR-068/069/070/072 all rewrite
  `find-in-files-panel.tsx`'s toolbar (`:509-610`) and `ScopeControl` (`:678-721`). They land as
  **one commit**; test-first is what makes them eleven list entries.
- **Cluster B** (**T158–T165**, ten tasks — **T165a/T165b** included) — every **fix** in it edits
  `find-in-files.css`, and FR-064 changes the base the others are tuned against. (T159 also edits
  `theme.css`, and the tests live in their own files, so this is region overlap rather than exclusive
  file ownership.) They land as **one commit**.

**Ratchets this phase moves.** `e2e-budget.json` fails **both** over and under budget and is re-seeded
in the same task that adds or removes a test. `parallel-plan.json` must name any spec that opens
preferences or drives a context menu, or `tier-plan.test.ts` fails the build.
`settings-inertness-043.test.ts` requires each `search.inFiles.*` reader to name both the leaf and
`inFiles` in one file. `formatGrouped` is mandatory for any new figure and **forbidden** in the seven
modules `find-in-files-grouping-view-only.test.ts:353-361` names — `content-menu.ts` among them, which
FR-073 edits.

---

### 11.1 The migration first (R28, D1, D4 steps 1–2) — the only silently-green failure mode

**D4's ordering is a hard constraint**: the v6 values must be copied out and the guard written against
them **before** the derivation moves in 11.3. A guard written afterwards compares the new values
against themselves, matches no installed file, rewrites nothing, and passes — which is
`shipped-defaults.ts:85-98`'s *"silently inert"* migration arriving from the theme side.

- [x] T120 `unit` — **D4 step 1, and it can only be written now.**
      `packages/core/tests/unit/shipped-defaults-v6-record.test.ts`: the frozen v6 records equal what
      version 6 actually ships **today** — `searchMatch` / `searchMatchCurrent` /
      `searchMatchCurrentBorder` for all 15 themes in `ALL_DEFAULT_THEMES`, `icons.findInFiles`, and
      all six `search.inFiles` leaves. **Failing first** (the records do not exist). This is the last
      moment the live values still *are* the v6 values; after T137 they are not.
- [x] T121 Add `V6_SEARCH_MATCH_COLOURS`, `V6_FIND_IN_FILES_ICON` and `V6_SEARCH_IN_FILES_SETTINGS` to
      `packages/core/src/config/shipped-defaults.ts` as **frozen copies, never references** to the
      live theme or settings objects — the reasoning `V4_EXCLUDE_GLOBS` records at `:85-98`, which is
      that a reference makes the guard compare the current default against itself forever.
- [x] T122 `unit` — **D4 step 2.** `packages/core/tests/unit/shipped-defaults-upgrade-v7.test.ts`:
      the settings guard plans a rewrite when the **whole** `search.inFiles` section still equals the
      v6 record and plans **nothing** when any one leaf differs; the theme guard rewrites a built-in
      whose three search-match colours still equal v6 and leaves alone a custom theme, a built-in the
      user recoloured, and a theme missing the tokens entirely; `icons.findInFiles` behaves the same;
      and a **second run plans nothing** (idempotent, because the rewritten value no longer equals the
      v6 record). **Failing first.**
- [x] T123 Implement the guarded value rewrite in `packages/core/src/config/shipped-defaults.ts` —
      extend `planSettingsUpgrade` for the two leaves FR-074/FR-075 move, and add `planThemeValueUpgrade`
      beside `planThemeUpgrade` for the four theme tokens — then wire both into
      `ShippedDefaultsService.upgrade()` (`packages/ui/src/main/shipped-defaults-service.ts`).
- [x] T124 Bump `SHIPPED_DEFAULTS_VERSION` **6 → 7** with the comment every prior bump carries: what
      is in the payload, and that this is the **first non-additive theme upgrade** in the project.
      Without this bump, FR-065, FR-067, FR-074 and FR-075 reach fresh installs only — a population
      no test in this repository represents (`shipped-defaults.ts:78-79`).
- [x] T125 **D1's explicit task.** Rewrite `upgrade()`'s doc comment at
      `packages/ui/src/main/shipped-defaults-service.ts:309-313`, which currently promises
      *"additive-only … NEVER changing a value the user already has"*. State the narrowed contract in
      words: **additive for tokens and themes the install does not have; and, for an enumerated,
      frozen set of leaves and tokens, a rewrite where the on-disk value is still byte-identical to
      what a named earlier version shipped. The guard is the contract.** A doc comment that goes on
      promising what the code no longer does is worse than none.

### 11.2 Cross-window delivery (R23, FR-078, FR-078a) — closes #380

- [x] T126 `contract` — `packages/ui/tests/contract/file-search-attach.contract.test.ts`: the
      `throng:fileSearch:attach` channel's shape; the subscriber is `event.sender` and never
      payload-supplied; `ipc-bridge-parity.test.ts` sees it in both `src/main` and `src/preload`; an
      `update` carrying `snapshot: true` is distinguishable from a delta. **Failing first.**
- [x] T127 `integration` — `packages/ui/tests/integration/file-search-viewers.integration.test.ts`:
      two viewers over **one** run both receive deltas; a viewer attaching **after** the scan
      completed receives a snapshot carrying every row, the totals and the cumulative `staleFiles`;
      one viewer dropping leaves the other's stream intact; the **last** drop releases the run; a
      search started from either viewer supersedes for both; a window that never attached receives
      nothing. **Failing first** — this is US5 scenario 6 and #380 at the cheapest layer that can see
      them.
- [x] T128 Rework `packages/ui/src/main/file-search-service.ts` per data-model §R2: key the run by
      `panelId` alone, add `viewers: Set<number>`, retain `rows` for the life of the run, and make
      `drop` and `release` **detach one viewer** with release on the last. The two failures the
      composite key was introduced for are re-solved here, not re-introduced — reference counting for
      one, and per-panel supersession for the other.
- [x] T129 Add the `attach` channel to `packages/ui/src/main/file-search-ipc.ts` and
      `packages/ui/src/preload/preload.cts`, and push every update to the run's viewer set.
      **`broadcastToWindows` is not used and `getAllWindows()` is never asked** — a scan update
      carries one project's paths and match text, and a sub-workspace window may hold another project
      (plan, Principle I).
- [x] T130 `component` — `packages/ui/tests/component/find-in-files-snapshot.test.ts`: a snapshot
      **replaces** the store's rows while a delta **appends**; an update from a superseded generation
      is dropped either way; a panel mounted in a second window attaches once and detaches on destroy.
      **Failing first.**
- [x] T131 Apply the snapshot/delta distinction in
      `packages/ui/src/renderer/find-in-files/find-in-files-store.ts`, and call `attach` from the
      panel's mount effect beside the existing `ensureFindInFilesPanel` call
      (`find-in-files-panel.tsx:188-195`, whose comment already anticipates *"a panel remounted in
      another window"*).
- [x] T132 `e2e` — add the results assertion to
      `packages/ui/tests/e2e/find-in-files-subworkspace.e2e.ts`: a panel synced into a sub-workspace
      shows the parent's results and follows them as they change (US5 scenario 6). **A second real
      window is what is under test**, which is the only reason this is E2E. **Replace the file's
      header comment at `:13-27`** — it confesses the gap as unfixable-without-a-design-decision, and
      that decision is R23. Tag it `@extended @window`.
- [x] T133 Re-seed `packages/ui/tests/e2e/e2e-budget.json` for T132 in the **same commit**, with one
      sentence in `measuredFrom` on what it asserts that no cheaper layer can. Confirm
      `find-in-files-subworkspace.e2e.ts` is already named in
      `packages/ui/tests/e2e/parallel-plan.json` — it drives the panel's context menu to sync, so
      `tier-plan.test.ts` fails if it is not.

### 11.3 The theme distinctness rule and re-derivation (R24, FR-067, M1, D5, D4 steps 3–4)

- [x] T134 `unit` — `packages/core/tests/unit/theme-match-distinctness.test.ts`: no theme in
      **`ALL_DEFAULT_THEMES`** renders `searchMatch` and `searchMatchCurrent` indistinguishably from
      each other, or either indistinguishably from `editorBg`. **Failing first, and it must name the
      themes it fails on** — SUBNET is `(3, 10, −2)` from its own page and Matrix's two fills differ
      by `(0, 21, 6)`. `ALL_DEFAULT_THEMES`, not `DEFAULT_THEMES`, because `throng` is hand-authored
      and is exactly what a derivation-only gate would miss (D5).
- [x] T135 Add the mutual-distinctness gate to `packages/core/src/config/theme-quality.ts`, **reusing
      `ciede2000` / `rgbToLab`** — the same machinery `themePairDistance` and `assertDistinct` already
      use for theme-vs-theme. A WCAG contrast ratio is the wrong instrument here and is rejected in
      R24: it is blind to hue and chroma. Declare the floor as a named constant; **its value comes
      from T139, not from this task.**
- [x] T136 Replace the fixed `strongest * 0.45` in
      `packages/core/src/config/default-themes/index.ts:119-122` with the two-axis derivation: the
      current match stays on the accent ray at `strongest`, and the ordinary match moves to the
      neutral `mixToward(editorBg, editorFg, t)` axis with `t` searched downward under the same
      syntax-readability walk. On dark themes the accent ray is shorter than two gaps, which is why
      one axis cannot carry this.
- [x] T137 **D5.** Hand-set `THRONG_THEME.colours.searchMatch` and `.searchMatchCurrent` in
      `packages/core/src/config/theme.ts:264-266` so the built-in default clears T134's gate, and add
      the comment recording **why it will drift**: `throng` is hand-authored and is not run through
      `makeTheme`, so a future change to `searchHighlights` moves fourteen themes and silently leaves
      this one behind. The gate running over `ALL_DEFAULT_THEMES` is what catches it.
- [x] T138 **M1 — a measurement, not a choice. Run it; do not infer it.** After T136 and T137, measure
      the **smallest** of the three ΔE00 gaps across every theme, then set T135's floor **below** it
      and record the headroom in the constant's own comment, exactly as `DISTINCTNESS_THRESHOLD` does
      (`theme-quality.ts:216-219`, *"Value confirmed by the distinctness test"*).
      `npm run test:unit -- packages/core/tests/unit/theme-quality.test.ts`
      **If the re-derivation cannot clear a perceptually meaningful floor on the darkest themes, that
      is a finding to report, not a number to lower.** A floor chosen to be whatever the themes happen
      to pass is a ratchet, not a rule.
- [x] T139 **D4 step 3.** Re-seed `packages/core/tests/unit/fixtures/pre-refactor-theme-colours.json`
      for the three search-match tokens across all 15 themes. The fixture records what is shipped, so
      re-seeding it is the act of shipping something else — not of silencing
      `default-themes.test.ts:125-139`.
- [x] T140 **M2.** `npm run test:unit -- packages/core/tests/unit/default-themes.test.ts` — confirms
      the re-seed and, more importantly, that **nothing else drifted**: the non-drift test compares
      every surviving token in all 15 themes.
- [x] T141 `unit` — **D4 step 4**, in `shipped-defaults-v6-record.test.ts`: the v6 record and the
      **current** derived values now **disagree** for at least the themes T136 moved. Without this, a
      future author who re-seeds the fixture can silently re-point the guard at it, and the migration
      becomes inert with every test green.

### 11.4 Removing per-folder grouping (FR-073, R25, D3)

- [x] T142 `unit` — `packages/core/tests/unit/settings-grouping-retired.test.ts`: a settings document
      holding `search.inFiles.defaultGrouping: 'folder'` **reads as `'file'`** through
      `parseSettingsGuarded`, emitting a `default-substituted` correction rather than being rejected
      (FR-033c); `FIND_IN_FILES_GROUPINGS` holds exactly two values; the descriptor's `optionLabels`
      names no value the guard rejects. **Failing first.** *(D3: the JSON editor will separately
      report `must be one of: file, fileAndFolder` for such a document until the next ordinary write.
      That is accurate, transient and **deliberately not fixed** — assert it rather than suppress it,
      so nobody later reads it as a bug.)*
- [x] T143 Delete `'folder'` from `FIND_IN_FILES_GROUPINGS` and the `FindInFilesGrouping` union
      (`packages/core/src/config/app-settings.ts:470-477`), from `Grouping`
      (`packages/core/src/search/file-search.ts:50`), and from `optionLabels`
      (`settings-metadata.ts:870-879`). **That is the whole migration** — `bounds-guard.ts:142-148`'s
      `correctScalar` already substitutes the default for anything outside `allowedValues`, which is
      why no coercion is hand-written (R25).
- [x] T144 `unit` — `groupRows` has no folder-only branch and `orderGroups` is unchanged for the two
      remaining groupings; the cases naming three values go from
      `packages/core/tests/unit/file-search-grouping.test.ts`.
- [x] T145 Narrow `groupRows` in `packages/core/src/search/file-search.ts` and remove the third item
      from `packages/ui/src/renderer/find-in-files/content-menu.ts`. **No `formatGrouped` may arrive
      in that file** — it is one of the seven `find-in-files-grouping-view-only.test.ts:353-361`
      forbids it in, and removing a menu item is exactly the kind of edit that would slip one past.
- [x] T146 `component` — the **per-row** staleness marking is gone and the **file heading** still
      carries it. It existed only because folder grouping produced no file heading to hold the flag
      (FR-073's own note), so its reason for existing goes with the grouping. **Failing first.**
- [x] T147 Remove the row-level staleness marking from `results-list.tsx`, `find-in-files.css`
      (`.fif-row__stale`, `:218`/`:231`) and `flattenGroups`; keep `.fif-group__stale`. **Re-seed
      `e2e-budget.json` in this same task** if any E2E goes with it — the budget fails under as well
      as over.

### 11.5 Cluster A — the toolbar and ScopeControl (FR-068, FR-069, FR-070, FR-072)

**Sequenced, never `[P]`.** All **eleven** tasks (T148–T157, including **T153a**) rewrite
`find-in-files-panel.tsx` `:509-610` and `:678-721`, and their component tests share one file.
**They land as one commit.** Two hard ordering dependencies: FR-068 (T150/T151) comes after FR-069
(T148/T149), because it is positioned relative to a control FR-069 has not yet moved; and **T153a
comes after T153**, because a discovery guard cannot fail on controls that do not exist yet.

**Cluster A is not confined to one file**, and the one-commit argument does not rest on pretending
otherwise: T157 also deletes `.fif-scope__ran` from `find-in-files.css`, which Cluster B then owns.
What holds the cluster together is a **contiguous region whose edits overlap**, not exclusive
ownership of a file — and A landing before B is what keeps the shared stylesheet from contending.

- [x] T148 `component` — FR-069: the run control renders to the **right of the scope control**, not
      inside `.fif-controls--field`, and cancel still replaces it **in place** while a scan runs.
      **Failing first.**
- [x] T149 Move the run/cancel block from `find-in-files-panel.tsx:525-545` to after the
      `ScopeControl` call at `:635`. It keeps its icon token and its hover title through the move —
      a relocated control is the third one this cluster touches, and T153a is what stops a move
      quietly dropping either.
- [x] T150 `component` — FR-068: a Replace All control sits to the **right of the relocated run
      control** and invokes the **same commit entry point** the FR-025a menu item calls, so FR-057b's
      confirmation and FR-058's single notice cannot be bypassed by a second route (plan, Principle
      VII). Assert the shared call site, not just the button's presence. **Failing first.**
      *(FR-011 for this control is asserted by **T153a** and deliberately not here — see the note in
      that task.)*
- [x] T151 Add the Replace All control, reusing `icons.replaceAll` (`theme.ts:424`) — the same
      action, so **no new icon token** (D6) — with a hover title naming the action.
- [x] T152 `component` — FR-070: the chooser writes a chosen sub-directory into the scope box as a
      **root-relative** path; a directory **outside** the project is refused, the refusal shows on the
      scope control, and **nothing is written to the box**; **the project root itself is accepted** and
      maps to `''`. That last case is the trap — `relPathUnderRoot` returns `null` for the root
      (`path-rules.ts:24-26`), so an unguarded call tells the user their own project is outside their
      project. **Failing first.** *(FR-011 for this control is asserted by **T153a** and deliberately
      not here — see the note in that task.)*
- [x] T153 Add the chooser to `ScopeControl` (`:688-720`), reusing `icons.folderOpen`
      (`folder-picker.tsx:92` is the shipped call site for that exact action) and validating in the
      **renderer** with `relPathUnderRoot` — one call answers containment and relativisation. Do
      **not** modify `packages/ui/src/main/pick-folder.ts`: it is shared with the project form and the
      preferences start-folder control, neither of which has a root (R27). Add **no third containment
      primitive** — typed scope text keeps going to main and keeps being refused by `isUnderPath`.
- [x] T153a `component` — **make the FR-011 guard DISCOVER its controls instead of listing them.**
      Round one's T112b enumerates the panel's action controls by hand
      (`packages/ui/tests/component/find-in-files-panel-controls.test.ts`), so it is structurally
      incapable of covering anything added after it was written — this round's Replace All and folder
      chooser, and whatever the next round adds.

      **Placed after T153, not before T151**, and the earlier placement was wrong: a discovery guard
      cannot fail on controls that do not exist yet, so running it before the two new controls are
      built would have made it pass on the old set and prove nothing. It runs **once both exist**, and
      it fails on them.

      **State the predicate structurally**, not as a list: *every `<button>` in the panel's rendered
      subtree that contains an element carrying the `icon` class*. For each one assert an icon token
      that resolves against `THRONG_THEME.icons`, a non-empty `title` naming the action, and no inline
      colour. A predicate over the rendered tree cannot be out-of-date, which is the entire point —
      a **renamed** control stays covered, and a **new** one is covered the moment it is added.

      **Express the carve-outs as properties, not names.** The scope control is exempt because it is
      an `<input>`, not a button — which the structural predicate already excludes, so it needs no
      carve-out at all; its icon and accessible name keep their own named assertions from T112b.
      **One carve-out cannot be made a property and is left named, with the admission**: the commit
      granularities and collapse/expand-all are **menu-only**, so they are not in the panel's rendered
      subtree and no query over it can reach them. They stay asserted where they are drawn — as icon
      cells and labels in the menu — and this task states that the panel-subtree predicate is
      deliberately **not** the whole of FR-011 for this panel. Naming the boundary is honest; pretending
      one query covers both surfaces would not be.

      **Failing first**, on the Replace All button (T151) and the folder chooser (T153) — and this
      task is the **only** thing asserting FR-011 for either of them.

      **Why T150 and T152 do not also assert it, stated here so it is not "restored" later.** They
      did, and the redundancy made this guard unable to fail: with the token and the title already
      demanded by the two tests that precede it, T153a would have been written against controls that
      already satisfied it and would have gone green on the day it was added. **A guard nobody watched
      go red is decoration** — it proves the assertion compiles, not that anything depends on it. So
      the FR-011 clauses were deliberately **moved out** of T150 and T152 rather than lost, and this
      is their single home. If a later reader spots T150/T152 asserting position and behaviour but not
      token-and-title and reads that as missing coverage, restoring it here would silently re-break
      exactly this property.
- [x] T154 `component` — the scope control shows **one** notice at a time: `scopeMissing` generalises
      to `scopeNotice: 'missing' | 'outsideProject' | null` with **most-recent-wins** precedence, one
      span, one `data-scope-notice` attribute. FR-030a's marking still appears and still disables
      nothing. **Failing first.** *(One condition, one notice — a second marking on one control for
      two alternative conditions is the shape spec 032 produced.)*
- [x] T155 Apply `scopeNotice` in `find-in-files-store.ts` and `ScopeControl`; `setFindInFilesScope`
      keeps clearing it on any edit (`:514-520`).
- [x] T156 `component` — FR-072: the panel shows **no** "Results from …" readout under any state.
      **Failing first**, by deleting the assertion that pins the current behaviour rather than
      adjusting it — the clarification says deleted, not adjusted.
- [x] T157 Delete the `ranScope` block (`find-in-files-panel.tsx:714-718`), `.fif-scope__ran`
      (`find-in-files.css:150-157`) and the `ranScope` state and plumbing in `find-in-files-store.ts`.
      **Delete the E2E that pins the readout and re-seed `e2e-budget.json` in this same task** — the
      budget fails under as well as over.

### 11.6 Cluster B — the panel's stylesheet (FR-064, FR-063, FR-066)

**Sequenced, never `[P]`.** **Ten** tasks, T158–T165 including T165a/T165b. The four **fixes**
(T159, T161, T163, T165, plus T165b) all edit `find-in-files.css`, and FR-064 changes the base the
other requirements are tuned against — that shared file is why they are sequenced. The tests live in
their own component files, and **T159 additionally edits `theme.css`** to add the panel to
`paneText`'s selector list, so "all ten edit one stylesheet" would be false; what is true, and what
the sequencing rests on, is that **every fix in this cluster edits `find-in-files.css` and several
edit the same rules**. **They land as one commit.**

The sheet may name **no colour literal**, not even as a `var()` fallback —
`find-in-files-results.test.ts:253-262` fails on any.

T165a/T165b are the odd pair here and are stated as such: they are **FR-079**, not FR-064 — a
**Principle X** defect (a token resolved by hand and frozen) that happens to live in the same file.
Folding them into the typography role would misdescribe both. They sit **last** in the cluster so
FR-064's base change lands before anything else touches the sheet's metrics.

- [x] T158 `component` — **the 021 FR-049 defect, proved before it is fixed.** In
      `packages/ui/tests/component/find-in-files-typography.test.ts`: the panel's body text resolves
      the `paneText` role's family, size and weight. **This fails today** because
      `find-in-files.css` carries none of the selectors listed at `theme.css:2138-2150` — the panel
      inherits `body` and was built without the role. Assert the violation first; this is a bug fix,
      not a feature.
- [x] T159 Add the panel's body-text selectors to `paneText`'s rule in
      `packages/ui/src/renderer/theme.css:2138-2150`.
- [x] T160 `component` — the code snippet keeps the **`editor` role's family only** and takes its
      **size and weight from `paneText`**. Assert both halves. *(R29's sub-decision, which FR-064
      requires be stated wherever it is made: the editor role's size is independently user-configurable,
      and a row height that depends on two settings is one the windowing arithmetic cannot predict.)*
- [x] T161 Keep `--throng-font-editor-family` on `.fif-row__snippet` (`find-in-files.css:239`) and
      take nothing else from that role. **Three** `0.85em` metadata rules **stay**, now relative to the
      correct base — and by the time this task runs they cover **five** selectors, not seven, because
      two earlier tasks have already deleted from this sheet:

      | Rule | Selectors when T161 runs |
      |---|---|
      | `.fif-scope__missing` (`:146`) | 1 |
      | `.fif-status` (`:166`) | 1 |
      | the metadata group (`:223`) | 3 — `.fif-group__count`, `.fif-group__stale`, `.fif-row__pos` |

      **`.fif-scope__ran` (`:153`) was deleted by T157** (FR-072) and **`.fif-row__stale` was deleted
      by T147** (FR-073), both of which always precede this task. *(The FR-064 defect as measured on
      **2026-09-09** was **four rules over seven selectors**; that is the figure the spec's
      Clarifications correction and the plan record, and it is the state of the sheet **before this
      phase edits it**. Dated, because a count of a file this phase is actively deleting from is true
      at a moment and not thereafter — the same class of error as the prose carriers in the preamble.)*
- [x] T162 `component` — FR-063: a group heading naming a file is visually distinct from its rows and
      takes its weight from a **theme token**, not a literal. **Failing first.**
- [x] T163 Set `.fif-group__key` (`:212`) to `var(--throng-font-weight-bold)` — the base bold token
      (`theme.ts:668-672`), because the heading wants to be bolder than the rows and a role weight
      would give it whatever the rows already have.
- [x] T164 `component` — FR-066: in the replace preview the struck original is **receded** relative to
      its replacement and the replacement carries a highlight distinct from both the original and the
      surrounding row, **with no colour literal in the sheet**. **Failing first.**
- [x] T165 Apply the recession (opacity or a token) to `.fif-match--struck` (`:269`) and strengthen
      `.fif-replacement` (`:277`).
- [x] T165a `component` — **FR-079. A Principle X defect, and it is the BOX, not the font size.** In
      `packages/ui/tests/component/find-in-files-results.test.ts`, beside the existing CSS-literal
      guard: `.fif-btn` (`find-in-files.css:78-96`) declares **no absolute pixel box metric**, and its
      size derives from `--throng-size-icon`. **Failing first.**

      *What is actually wrong, having read it rather than assumed it.* The rule hardcodes
      `width: 22px; height: 22px; padding: 3px` with `overflow: hidden`, and 22 is exactly
      16 + 3 + 3 — the box is hand-computed from the **default** of `sizes.iconPx`
      (`theme.ts:329`, emitted as `--throng-size-icon` at `:664`). A user who raises that value in the
      Themes editor gets a larger glyph, because `.icon` sizes itself from the token
      (`theme.css:2377-2379`), inside a box that does not move — and `overflow: hidden` **clips it**,
      with nothing to say why. That is user-reachable through a shipped control, which is what makes
      it a defect rather than hardening.

      *And `font-size: 12px` (`:88`) is **inert**, which is a separate and smaller problem.* It cannot
      size the glyph: `.icon` sets its own `font-size` from the token, and `theme.css:2374-2377`
      records why in as many words — *"an icon has its OWN size … Every icon was sized in `em`, so it
      inherited the font size of whatever surface it happened to sit on"* (018 follow-up). These
      buttons contain nothing but an `Icon`, so the declaration governs nothing. It goes because it is
      **dead and misleading** — it is the line a future author would edit when trying to fix icon
      size, and it would do nothing — not because it is doing harm. **This is not part of FR-064**: it
      sizes a glyph, not body text, so calling it a 021 FR-049 violation would be overreach.

      *Why this layer and not a computed-size assertion.* jsdom does not resolve `var()` inside the
      cascade, and these tests read the stylesheet as **text** through the file's existing `css()`
      helper rather than attaching it to a document — so there is no computed pixel value to assert
      at any layer cheaper than a real browser. The literal guard is the honest instrument here, and
      it is the same one `find-in-files-results.test.ts:253-262` already uses for colours. **This
      reasoning covers T182a too and is not repeated there.**

      *The tell, worth naming because it generalises.* **`16 + 3 + 3 = 22`.** A magic number that
      happens to equal a token's default plus its own padding is a **token dependency written in
      arithmetic** — and grepping for `--throng-size-icon` will never find it, because the token's
      name appears nowhere in the rule. It is a token that was *resolved by hand at authoring time*
      and then frozen.

      *Which rule this breaks, stated precisely because it explains why nothing caught it.* **Not the
      themeable-icon NON-NEGOTIABLE — `.fif-btn` passes that in full**: it renders an `Icon` from a
      token, its buttons carry titles, and the sheet holds no colour literal. Those audits look for a
      *missing token* and a *hardcoded colour*, and this is neither. What is hardcoded is a **metric**,
      equal to the resolved value of a token referenced correctly everywhere else. That makes it
      **Principle X** — externalised configuration: `sizes.iconPx` is a shipped control in the Themes
      editor, and a control whose box ignores it is a setting that governs less than it claims, which
      is the class the `settings-inertness` guards exist for. Filing it under the icon rule would have
      pointed it at the audits that already passed. See research **R31**.
- [x] T165b Size `.fif-btn` from `--throng-size-icon` — the box and its padding as a `calc()` over the
      token, keeping the shipped 22×22 appearance at the default 16 — and delete the inert
      `font-size: 12px` at `:88`. **Note for the maintainer, deliberately not fixed here**: the
      explorer toolbar's controls carry the identical hardcoded 22×22 box (the spec's own FR-065
      clarification measured them as *"byte-identical 22×22 boxes with 16px icons"*), so the same clip
      is reachable there. It is a different stylesheet, outside Cluster B, and outside this feature's
      panel — reported rather than swept in.
- [x] T165c `component` + fix — **the sixth instance, found by fixing the first.**
      `.fif-field__icon` (`find-in-files.css:68-73`) is `width: 16px` with no padding and no
      `overflow`: the icon token's default copied bare, so there is no `16 + 3 + 3` to notice. It is
      **R31's other symptom** — nothing clips, so a raised `sizes.iconPx` lets each of the three field
      glyphs OVERFLOW onto the input it labels. **Failing first**, in
      `find-in-files-results.test.ts` beside T165a's guard, which is generalised to take a selector so
      both controls are held to one assertion. **Taken rather than recorded, and the distinction is
      the point**: FR-079a's other four are an inherited repository-wide pattern in stylesheets this
      feature does not own, while this one is in a file **043 wrote**. Fixing the frozen box in two
      controls while shipping a third inside the panel being fixed is the incoherence FR-062a is
      about. **FR-079a is widened to three controls in `spec.md` and F3 is corrected from five to
      six in `plan.md` in this same task** — the code must not run ahead of the requirement, and a
      count that is wrong in the tracker is the failure F3 exists to prevent.

### 11.7 The remaining single-file items

- [x] T166 `[P]` `unit` — FR-060, in `packages/core/tests/unit/panel-title.test.ts`: a `findInFiles`
      panel is titled for what it is and carries its term once there is one; a long term is bounded by
      `tabs.maxNameLength` through the same `truncateGraphemes` path every other source takes.
      **Failing first.** Files: `packages/core/tests/unit/panel-title.test.ts`.
- [x] T167 Add the `findInFiles` branch to `packages/core/src/workspace/panel-title.ts:64-83`, reading
      the term from `panel.config` — **no new `PanelTitleSources` field**, because the editor branch
      already sets the precedent of reading `panel.config` as a backstop (`:78`). Files:
      `packages/core/src/workspace/panel-title.ts`.
- [x] T168 `[P]` `unit` — FR-074, FR-075, FR-076: `search.inFiles.trigger` ships `asYouType` and
      `settleMs` ships **500**; the descriptors sit in `Search · Find in Files` and the find bar's one
      key in `Search · Find Bar`, following the shipped `Editor · Indentation` convention; every key
      still passes `settings-inertness-043.test.ts`, which requires a reader naming both the leaf and
      `inFiles` in one file. **Failing first.** Files:
      `packages/core/tests/unit/settings-metadata.test.ts`,
      `packages/core/tests/unit/settings-inertness-043.test.ts`.
- [x] T169 Change the two defaults in `packages/core/src/config/app-settings.ts` and re-group the
      seven descriptors in `packages/core/src/config/settings-metadata.ts`. **The defaults reach an
      installed build only through T123/T124** — on their own they change nothing for anyone who has
      run the application.

      **Move the two PROSE carriers that live in these same two files** — see the rule in the phase
      preamble. Both currently argue *for* the values being replaced, and no gate can fail on either:

      - **`app-settings.ts:624-627`** — the comment beside `trigger: 'run'` says *"Explicit Run, not
        as-you-type … so the default is the one that costs nothing until asked (FR-043a). As-you-type
        is a preference, not a surprise."* Afterwards it must say the opposite and say why: as-you-type
        is the default under **FR-074**, the settle interval plus the forced ceiling at four times it
        is what keeps a tree walk affordable, and **explicit run is now the preference**. Keep the
        cost argument — it is the case against this change, and it lost rather than being wrong, which
        the spec preserves deliberately.
      - **`app-settings.ts:628-631`** — the comment beside `settleMs: 250` says *"250 ms, and
        deliberately about **twice** `asYouTypeDebounceMs`"*. At 500 against the find bar's unchanged
        120 ms, **both halves are false**: the figure and the relation. It becomes about **four**
        times, so the sentence is **rewritten, not renumbered** — and the rewrite should say why the
        multiple grew, which is that this interval now gates the *shipped* path rather than an opt-in.
      - **`settings-metadata.ts:811-820`** — the section comment argues the six leaves belong *"in the
        same Search section as the find bar's delay above, because a user looking for 'how do I make
        searching behave' should find both in one place — the difference between them is one buffer
        against the whole project, and the labels say so rather than the grouping."* **FR-076 decides
        the opposite**, and on the same question: separate sections, and a setting appears in both
        only if it genuinely governs both. Left as it is, the file ships arguing against its own
        grouping. Rewrite it to state the split and the reason — the second paragraph, about
        `allowedValues` being the constant and never a retyped literal, is untouched and still true.
      - **`settings-metadata.ts:852-858`** — the comment on the slider says *"the shipped 250 sits
        exactly on a stop so a drag can always return to it."* Afterwards it must name **500**, and
        **500 must be checked against the same property**: the range is 0–2000 in steps of 50, so 500
        is on a stop — state it, because the sentence's whole purpose is that the shipped value is
        reachable by dragging, and a shipped value that is not on a stop breaks it silently.

      **Confirm — do not redo — the contract file.**
      `specs/043-find-across-files/contracts/settings-and-bindings.md`'s settings table was already
      amended with the round-two values and a dated marker during planning. This task **verifies** it
      still matches what lands, exactly as F2 was handled: work that is already done is confirmed, not
      re-instructed, or the next person does it twice and the diff says nothing.

      Files: `packages/core/src/config/app-settings.ts`,
      `packages/core/src/config/settings-metadata.ts`,
      `specs/043-find-across-files/contracts/settings-and-bindings.md` (confirm only).
- [x] T170 `[P]` `component` — **the Constitution VI defect, proved before it is fixed.** In
      `packages/ui/tests/component/panel-header-zoom-menu.test.ts`: the header menu offers Zoom In /
      Out / Reset on a panel that implements no zoom. **This fails today for two kinds** — the Find in
      Files panel and the **untyped placeholder** — because the submenu is built unconditionally at
      `panel-header-menu.ts:122-150`, before the first `panel.kind` branch at `:153`. Files:
      `packages/ui/tests/component/panel-header-zoom-menu.test.ts`.
- [x] T171 **D2.** Gate the Zoom submenu in
      `packages/ui/src/renderer/workspace/panel-header-menu.ts` on the set of panel kinds that consume
      zoom. This covers the **untyped placeholder** as well as this panel, and it is **in scope by
      FR-062a**, whose wording is general on purpose — citing that rule to fix one panel while leaving
      the identical violation beside it would make it mean "this panel". ~3 lines. Files:
      `packages/ui/src/renderer/workspace/panel-header-menu.ts`.
- [x] T172 `component` — FR-061: `Rename` and `Reset Name` are **absent** from a Find in Files panel's
      header menu rather than present and disabled, and `menu-sections.test.ts` still passes — a
      section losing its last item must not leave a dangling divider. **Failing first.** Sequenced
      after T171: same file.
- [x] T173 Omit the two items for this kind in `panel-header-menu.ts:103-121`, and **do not register a
      rename starter** for it in `panel-placeholder.tsx:203-206`. `requestPanelRename` already returns
      a no-op for an unregistered panel (`panel-rename.ts:30-38`), so the chord needs **no branch in
      `app.tsx`** and no new state — which is why FR-061 needs no E2E.
- [x] T174 `unit` — FR-062's arithmetic half, in
      `packages/ui/tests/unit/find-in-files-results-window.test.ts`: `visibleRange`, the sizer height
      and the `translateY` offset all agree at a non-zero zoom level, and the row height they use is
      the **same rounded integer** published as `--fif-row-height`. **Failing first.**
- [x] T175 Thread `rowHeightPx = Math.round(RESULT_ROW_HEIGHT_PX * zoomFactor(level))` through
      `results-list.tsx`'s five arithmetic sites (`:132-143`, `:254`, `:349-353`, `:371`, `:375`) and
      publish it at `:356-366`. **The rounding happens once, in JavaScript; CSS is told the answer and
      never asked to compute it** — `calc()` there gives the browser a fractional pixel to round by its
      own rules, and the sizer multiplies the disagreement by row index (R26).
      `RESULT_ROW_HEIGHT_PX` stays exported as the unzoomed base.
- [x] T176 `component` — FR-062's text half: the panel's text scales with the panel's own zoom level.
      **Failing first.**
- [x] T177 Publish the zoom factor as a custom property on `.fif-panel` in `find-in-files-panel.tsx`
      and multiply with it in `find-in-files.css`, following `editor-panel.tsx:42-47` +
      `editor.css:29`. Sequenced after Cluster A and Cluster B: same two files.
- [x] T178 `component` — FR-071: double-clicking a group heading toggles it; a double-click on the
      heading's own collapse control does **not** toggle it twice; a double-click carrying a modifier
      does **not** toggle it at all. **Both traps asserted**, following the explorer tree's shipped
      resolution rather than reinventing it. **Failing first.** Sequenced after T175: same file.
- [x] T179 Add the `dblclick` handler and the propagation guard to the group heading in
      `results-list.tsx`. **No menu item is owed** — per-group toggling and collapse-all are already
      in the panel's menu and this is an accelerator over them.
- [x] T180 `component` — FR-077: invoking **find in files** leaves a reused panel with replace
      **off**, mirroring FR-029d's on-direction, and focus goes to the **search** input. The
      replacement text survives in the store. **Failing first.** Sequenced after Cluster A: touches
      `find-in-files-panel.tsx` / `open-find-in-files.ts`.
- [x] T181 Make the two chords symmetric in
      `packages/ui/src/renderer/find-in-files/open-find-in-files.ts`, replacing the comment that
      declines the off-direction.
- [x] T182 FR-065: replace `icons.findInFiles`'s glyph in `packages/core/src/config/theme.ts:417` so
      the explorer toolbar control reads at the same visual weight as Quick Open beside it, keeping
      the **three searches distinguishable** (`:402-416` records why they are held apart).
      `EXPECTED_ICON_TOKEN_COUNT` stays **65** — this is a value change, not a token (D6) — and it
      reaches an installed build only through T121/T123/T124. Sequenced after T137: same file.
- [x] T182a `component` — **FR-079 again: the same hardcoded-box defect as T165a, on the control
      FR-065 is about.**
      In `packages/ui/tests/component/explorer-toolbar.test.ts`: `.explorer-toolbar__btn`
      (`explorer.css:21-32`) declares **no absolute pixel box metric** and derives its size from
      `--throng-size-icon`. **Failing first.**

      *Why it is ORDERED with FR-065 although it is FR-079's.* FR-065 exists because the maintainer
      reported the Find in Files toolbar icon as **dwarfed by Quick Open beside it** and asked for it
      to read at the same weight. The most natural next thing a user does after meeting that fix is
      reach for `sizes.iconPx` in the Themes editor to make the toolbar icons bigger — and this
      22×22 box is exactly what punishes them for it: `.icon` grows from the token
      (`theme.css:2377-2379`) while the box does not, so the glyph overspills its own control and
      collides with its neighbour. Shipping "make this icon more prominent" beside the mechanism that
      penalises making icons more prominent is the same incoherence as fixing the zoom menu on one
      panel and leaving it broken on the next (D2).

      *One honest difference from T165a, because the failure mode is not identical.*
      `.explorer-toolbar__btn` has **no `overflow: hidden`** and `padding: 0`, so a larger glyph
      **overflows** rather than being clipped — it spills over its neighbours instead of being cut
      off. Still a defect, still user-reachable, and the same fix; but the symptom a user reports
      would be "the icons overlap", not "the icon is cut in half", and a task claiming otherwise
      would send whoever picks it up looking for the wrong thing.
- [x] T182b Size `.explorer-toolbar__btn` from `--throng-size-icon` — the box as a `calc()` over the
      token, keeping the shipped 22×22 appearance at the default 16. **Sequenced immediately after
      T182a**, its own failing test — T182 is the glyph change that this pair is *ordered beside*, not
      the test it makes pass. **This and T165b are the only two boxes this round takes** (FR-079a);
      the rest is recorded as **F3** in the plan and filed as an issue by **T185a**.

### 11.8 Documentation and close-out

- [x] T183 `[P]` Documentation currency (NON-NEGOTIABLE): `README.md`, `docs/` and `CONTRIBUTING.md`
      in the **same change**. Sweep specifically for: **three grouping values** — FR-073 leaves two,
      and the grouping is described as three wherever it is described; the **shipped defaults**, now
      as-you-type at 500 ms; and the **preferences section name** — FR-076 splits `Search` into
      `Search · Find Bar` and `Search · Find in Files`, so any prose telling a user to look under a
      *"Search section"* names a group that no longer exists on its own. A settings section is
      navigation, and stale navigation is worse than stale prose: the reader follows it and finds
      nothing. Files: `README.md`, `docs/**`, `CONTRIBUTING.md`.
- [x] T184 `[P]` `quickstart.md` — **sweep before adding.** Step 5 (`:149`) reads *"Switch grouping to
      per folder and back"*, which FR-073 makes **unperformable**: a hands-on script that instructs a
      gesture the application no longer offers fails at the first person who follows it, and it is a
      manual document so nothing in the suite will ever say so. Rewrite it for the two remaining
      groupings.

      **Sweep the WHOLE file, not only that step** — the grouping is named in more than one place and
      the layer notes are one of them: `:80` says *"regrouping between the **three** groupings without
      re-running"*, which is a statement about what the unit tests cover and will be false the moment
      T144 lands. Also sweep for the old shipped defaults: anything telling the reader to press
      `Enter` to run is now describing the non-default trigger (FR-074). **Then** add the
      steps this round makes checkable by hand: sync a panel into a sub-workspace and watch results
      follow; pick a folder outside the project and see the refusal; zoom a results panel and confirm
      rows neither overlap nor gap; confirm the header names the panel and its term. Files:
      `specs/043-find-across-files/quickstart.md`.
- [x] T185 Close **#380** with the commit that lands T128–T133, and confirm the Complexity Tracking F1
      row's reference resolves. The issue records the **process** failure — a scenario that was unmet,
      known, and released with every check green — so it closes against the fix, not against the
      comment that used to be its only record.
- [x] T185a **File the F3 issue**, via the `github-issues` skill — *icon control boxes are hardcoded
      from `sizes.iconPx`'s default, so raising the token clips or overspills them*. Type `bug`, area
      `area:ui-shell`, milestone v1.0.0. Carry into the body: the **five-row table** from the plan's
      F3 entry, the **`16 + 3 + 3`** tell, the note that **no grep for `--throng-size-icon` finds any
      of them**, and the two distinct symptoms (clipped where `overflow: hidden`, overlapping where
      not). Name the reproduction plainly and **with the arithmetic checked**, because it is what
      makes this reportable: **raise `sizes.iconPx` from 16 to 19** in the Themes editor and the find
      bar's own buttons begin cutting their glyphs — `.find-bar-btn` is 24 px with 3 px of padding, so
      it holds 18 px of content and has **3 px of headroom over the 16 px default**. `sizes.iconPx`
      has **step 1**, so that is three steps, not one. `.fif-btn` (22 px, 3 px padding, 16 px content)
      clips at **17** — the very next step — and it is `.find-bar-btn`'s twin.

      *State the setting exactly, and do not round it.* The bug gate turns on a reproduction being
      performable **at the frequency and setting stated**; a repro that shows nothing at the value it
      names does not read as an imprecise report, it reads as a **false** one, and the issue is
      dismissed rather than corrected.

      **Why this task exists at all, and it is uncomfortable.** F1 records the rule that *a gap a test
      author finds and cannot fix belongs in Complexity Tracking **and an issue**, not only in a
      comment* — and this round then wrote the icon-box sweep into an appendix and a Complexity
      Tracking row and stopped there. **An appendix is not a tracker.** A table inside a feature's
      task list is read by whoever is implementing that feature and by nobody afterwards, which is the
      same invisibility as the header comment F1 exists to condemn, one document up. Recording the
      rule and then reproducing its shape in the same round is worth naming rather than quietly
      fixing.
- [x] T186 `npm run gate`, dispatched to a hosted runner against the branch, and report the run URL
      **and the SHA**. A green gate is evidence about a commit, not about the working tree.

### 11.8 FR-078b — found by the adversarial review, after the phase was otherwise closed

These are appended rather than slotted in, because the order they were discovered in is part of what
they say: **FR-078 created this defect and no task in this phase could have predicted it.** The
review was the first reader to ask what a synced panel's search BOX says once its list stopped being
empty.

- [x] T187 `[P]` `integration` — FR-078b, in
      `packages/ui/tests/integration/file-search-viewers.integration.test.ts`: a window attaching to
      a finished run is told the query that produced the rows; the run's **originator** is told
      nothing; and retargeting from the OTHER window moves ownership, so the parent becomes the
      follower. **Failing first** — two of the three went red; the originator clause passed
      vacuously until the field existed, which is stated in the test rather than hidden.
- [x] T188 Carry the query on the wire: `ScanRun.originator`, set on create and reassigned in
      `supersede`, and a `queryFor` helper SPREAD into both delivery paths so `adoptQuery` is
      genuinely **absent** for the originator rather than present-and-undefined. `deliver` builds one
      payload per recipient now; the contract test that pinned its one-line `for` loop was widened to
      assert the two properties it actually cares about — iteration over `run.viewers`, and `push` as
      the only exit — rather than the punctuation between them.
- [x] T189 `component` — the user-visible half, in `find-in-files-snapshot.test.ts`: the term box
      follows the rows that arrive, follows again on a re-run, and is **left alone** when no query
      comes with the update. Proved non-vacuous by disabling the adoption and watching exactly the
      two adopting tests go red while the originator's stayed green.
- [x] T190 Adopt in `find-in-files-store.ts`'s `receive`, including the `queryMoved` clause in the
      early-return: a re-run of the same search over an unchanged tree delivers rows identical to
      what the window already holds, and without that clause the update would return having changed
      the term nowhere — leaving the box stale for exactly the case the requirement is about.
      `replacement` is deliberately not adopted.
- [x] T191 Declare it on the wire — `global.d.ts`, `contracts/file-search-ipc.md`, and the field list
      in `file-search-ipc.contract.test.ts`. **That guard's technique had to change, not just its
      list**: it measured the distance in characters from `fileSearch?:` to each field, so adding a
      doc comment pushed two fields past the budget and reddened a wire-shape assertion for prose
      that changed no wire shape. It slices the member by balancing braces now, with a vacuity check
      that the slice stops before its neighbour — which caught the first attempt, an indent rule that
      ran straight past the end.

---

## Phase 12: Round three — six more from hand-testing

FR-080 … FR-086b. **Two of the six were not the change they looked like**, and both were settled with
the maintainer before a line was written — that conversation is in `spec.md`'s 2026-09-10
clarifications and is not repeated here.

Ordered cheapest-first on purpose. 12.1 and 12.2 touch nothing else; 12.3 reaches an app-wide
contract; 12.4 is the round's real work and reaches main; 12.5 reverses a clarification.

### 12.1 The two that touch nothing else

- [x] T192 `[P]` `component` — FR-085, in `packages/ui/tests/component/find-in-files-results.test.ts`:
      every group heading **and** every result row carries `cursor: pointer` and a hover fill of
      `--throng-colour-hoverSurface`, and the hover rule is guarded by
      `:where(body:not([data-window-blurred]))`. Assert `--throng-colour-surfaceActive` appears
      nowhere in the sheet: it is reserved for selected/active, and the explorer's own twisty comment
      says so in as many words. **Failing first.**
- [x] T193 Two rules in `find-in-files.css`, mirroring `.tree-row` (`explorer.css:119-134`) rather
      than inventing a second vocabulary. **Headings are ONE element** differing only by
      `data-group-kind`, so scoping to folders would leave file headings with a working double-click
      and no affordance — worse than today, because the inconsistency would then be inside one list.
      Rows already have the fill and gain only the cursor.
- [x] T194 `[P]` `unit` — FR-081, in `packages/core/tests/unit/panel-display-title.test.ts`: the
      title is `Find in Files` with replace hidden and `Find & Replace in Files` with it disclosed,
      each still taking the `: <term>` suffix once there is a term. **Failing first.**
- [x] T195 One branch in `packages/core/src/workspace/panel-title.ts:100-104` reading
      `panel.config?.replaceShown` — **no new `PanelTitleSources` field**, because that value is
      already persisted (`model.ts:93-94`, written `panel-config.ts:74`, read back `:56`), and the
      comment at `panel-title.ts:91-94` already argues against a second live copy free to disagree.
      `findInFilesPanelType.label` MUST NOT move: it is also the New Panel label and the icon
      descriptor's, so the composed string belongs here.

### 12.2 A Clear on each of the three inputs

- [x] T196 `[P]` `component` — FR-080/080a/080b/080c: each of the term, replacement and scope inputs
      offers a clear **only while it has content** (never a disabled ghost); the control's box
      derives from `--throng-size-icon` and its **content** box still holds the glyph once border and
      padding come out; clearing discards no listed rows and starts no scan. **Failing first.**
- [x] T197 Reuse the shipped vocabulary rather than a second one — `IconButton token="dismiss"`, a
      `title` naming the field, a `…-clear-<panelId>` testid, rendered conditionally. Three existing
      instances to copy: `settings-tab.tsx:371-390`, `keybindings-tab.tsx:144-163`,
      `themes-tab.tsx:618-636`.

      **DO NOT COPY ITS BOX.** `.settings-search__clear` is `width: 20px; height: 20px` — the frozen
      figure FR-079/FR-079c exist to remove, arriving one round after the fix, from the very pattern
      being reused. Derive it, or reuse `.fif-btn` outright.

      The scope row already has a browse button (FR-070) and a refusal notice sharing its right edge,
      so the clear goes inside a relative wrapper around the **input**; the browse stays its sibling.
- [x] T198 Widen the F3 tracker in `plan.md` from three taken controls to four, for the same reason
      it was widened from two last round: a control this feature writes cannot be outside the line
      this feature drew.

### 12.3 The notice's own display preference — and an app-wide contract

- [x] T199 `[P]` `unit` — FR-082, in `packages/core/tests/unit/settings-metadata.test.ts`: two new
      descriptors in the **existing** `Search · Find in Files` group, defaulting to `dismiss` /
      5000 ms, using `DISPLAY_MODES` / `DISPLAY_MODE_LABELS` and the shipped `TIMEOUT_MIN_MS` …
      `TIMEOUT_MAX_MS` bounds at step 500. **Re-derive that 5000 sits on a stop rather than
      trusting it.** **Failing first.**
- [x] T200 Add the descriptors and defaults. **FR-059's "six" and FR-076's "six" both become eight**
      — the spec markers are placed, and the contract table in
      `contracts/settings-and-bindings.md` must move with them or the feature asserts a count its own
      table contradicts.
- [x] T201 `[P]` `component` — FR-082a: a notice may carry its own display override, and the provider
      honours it in preference to the severity-keyed global. **Failing first.**
- [x] T202 Widen `NoticeInput`/`Notice` with the optional override and branch at
      `notification.tsx:855` and `:888`. This reaches **spec 030's notice contract**; update
      `contracts/notice-api.md` in the same change.
- [x] T203 `[P]` `component` — FR-082b, and this is the SAFETY one: `settings-tab.tsx` has **two**
      hardcoded `^notifications\.` regexes. `:77` greys out an inert timeout; `:78` gates the consent
      030 FR-008 requires before *Never display* may silence a **failure** report. FR-082 offers
      `never` on a notice that reports commit failures, so generalising only the first would let a
      user silence failure reporting with none of that consent. Assert **both** behaviours for the
      new keys. **Failing first.**
- [x] T204 Generalise both gates. The file's own comment at `:70-75` asks for exactly this — "a
      second feature adding a third dependency should lift both of these into `FieldDescriptor`
      rather than add a third regular expression" — so lift them rather than widening two regexes.
- [x] T205 Have `commit-replace.ts`'s notice carry the override. **It governs all three outcomes**
      (FR-082, the maintainer's decision): the severity is still computed per outcome, but the
      display no longer comes from `notifications.*` for this notice.

### 12.4 What the list shows after a commit, and what the button does next

- [x] T206 `[P]` `unit` — FR-083b: the commit result carries a re-derived snippet for every line it
      changed, computed from the **new** file text, on both the buffer path and the disk path. The
      case that forces this: two matches on ONE line each carry the other's old text as context, so
      a renderer-side swap of `matched` alone leaves each row correct about itself and stale about
      its neighbour. **Failing first.**
- [x] T207 Implement in `replace-commit-service.ts`, which already holds the whole new text at `:308`.
      **A size bound is owed** — a large commit could otherwise return a great deal of text — and it
      belongs beside `MAX_ROWS_PER_BATCH` as a named constant with its reason, not as a figure.
      Extend `contracts/file-search-ipc.md`.
- [x] T208 `[P]` `component` — FR-083/FR-083a: a **committed** row renders the post-commit text
      plainly; a **pending** row still renders FR-047's struck preview; a **skipped** row is pending
      and therefore still a preview (FR-050). **Failing first.**
- [x] T209 Implement in `results-list.tsx:507-580`. Note what the ledger does NOT hold: `CommittedEdits`
      stores only the shift, so rendering `state.replacement` would lie the moment the user edits the
      replacement box after committing. Widen the per-offset value to carry the replacement that was
      actually written.
- [x] T210 `[P]` `integration` — FR-083c: a file changed **by this panel's own commit** is not marked
      stale by it. Staleness is derived from watcher ticks, which see a file change and not who
      changed it. **Failing first.**
- [x] T211 Implement. This is derived rather than requested, and it exists because FR-083 creates the
      problem: the badge would claim the list disagrees with a disk the list is now correct about, in
      one panel, at one moment.
- [x] T212 `[P]` `component` — FR-084/FR-084a: Replace All is disabled — toolbar **and** the menu
      items FR-025a owes — whenever nothing is pending, and re-enabled by a new scan **or** by a term
      differing from the one the results came from. **Failing first.**
- [x] T213 Implement. **This fixes a live Constitution VI violation**: `pendingRows()` already returns
      `[]` after a full commit, so the control today clicks and does nothing. A new scan re-enables by
      construction (a new generation clears `committed`); the term clause matters only under the
      non-default explicit-Run trigger, and needs the panel to remember the term its results came
      from. FR-045b governs ROWS, not panel controls, so it is not in tension.

### 12.5 Saving what was clean

- [x] T214 `[P]` `integration` — FR-086/FR-086a, in `replace-commit.integration.test.ts`: a document
      **clean** before the commit is saved immediately after and ends clean; a document **already
      dirty** is not saved and keeps its pending replacement. **Failing first**, and the second half
      is the anti-vacuity guard — a fix that saved everything would pass the first assertion alone.
- [x] T215 Implement via `EditorCoordinator.save`, keeping the authority the only writer. FR-053b
      stands word for word: nothing the user left unsaved is written, which is exactly why the dirty
      case is excluded rather than merely deprioritised.

### 12.6 Close-out

- [x] T216 Documentation currency (NON-NEGOTIABLE): `README.md` and `docs/**` for the two new
      preferences and the eight-key section, and for the panel's two possible titles.
- [x] T217 `quickstart.md` — add the hand-checkable steps this round creates: clear each field and
      watch the rows stand; toggle replace and watch the header change; commit and watch the rows
      become plain text while Replace All greys; commit with a clean editor open and watch it end
      clean; hover a folder heading.
- [x] T218 `npm run gate`, dispatched to a hosted runner, reported with the run URL **and** the SHA.
      GREEN at <https://github.com/Bidthedog/throng/actions/runs/34528059120>, SHA `3beef774`, 37m26s,
      all eight stages, zero failed and zero flaky. The SHA is quoted because a remote gate is
      triggered against a REF and is only ever evidence about that commit — round four's commits
      land on top of it and are NOT covered by it.

---

### The hardcoded-icon-box sweep — result, and what this round deliberately leaves

Run while writing T165a/T182a, over every stylesheet in `packages/ui/src/renderer`. Recorded here
rather than filed as tasks, because past two or three instances this stops being a defect and becomes
a repo-wide pattern that belongs in its own change.

**Two rules clip** — a fixed square box, `overflow: hidden`, hosting an `Icon`. They are twins, down
to the same inert `font-size` declaration:

| Rule | Box | Content at the default | Status |
|---|---|---|---|
| `.fif-btn` (`find-in-files.css:78-96`) | 22×22, `padding: 3px`, `border: 1px`, `overflow: hidden`, `font-size: 12px` | **14 px for a 16 px glyph — clipping today** | **Taken — T165a/T165b**, corrected by FR-079c |
| `.find-bar-btn` (`find-bar.css:88-104`) | 24×24, `padding: 3px`, `border: 1px`, `overflow: hidden`, `font-size: 12px` | 16 px — exactly the glyph, zero headroom | **Not taken.** Reported |

**Every arithmetic in this table omitted the border until it was measured.** `theme.css:51` sets
`* { box-sizing: border-box }` globally, so a declared box spends itself on border and padding before
content. `.fif-btn` therefore holds **14 px** and clips a 16 px glyph at the **default** icon size —
and `calc(token + pad * 2)`, the first correction, reproduced that exactly while satisfying FR-079.
`.find-bar-btn` clips at **17**, the very next step, not 19: it has zero headroom, not three. It is
013's surface, not this feature's, which is the only reason it is not taken. See FR-079c.

**Four more hold a fixed box that does not follow the token, but overflow rather than clip:**

| Rule | Box | Note |
|---|---|---|
| `.fif-field__icon` (`find-in-files.css:68-73`) | `width: 16px`, no padding, no `overflow` | **Taken — Cluster B**, alongside T165b. **The one the original audit missed**, one rule below a rule it had open: the token's default copied bare, so there is no `16 + 3 + 3` to notice |
| `.explorer-toolbar__btn` (`explorer.css:21-32`) | 22×22, `padding: 0` | **Taken — T182a/T182b**, because FR-065 is about this control |
| `.pane-collapse` (`panes.css:77-91`) | 22×22, `border: 1px`, no padding — 20 px of content, overflows at **21** | **Not taken, and needs care**: its own comment says the size is what keeps the control identical whether the pane is expanded or collapsed, so it is load-bearing for the collapsed rail's geometry. Not a copy-paste fix |
| `.terminal-panel__retry` (`terminal.css:133-146`) | `min-width: 22px`, `height: 22px`, `padding: 0 6px`, no border — 22 px of content, overflows at **23** | **Not taken.** Grows horizontally but not vertically; carries a third inert `font-size` |

Unaudited: `preferences.css` and `theme.css` hold further fixed 20/24/26 px boxes that may or may not
host icons. They were not opened, because the count had already passed the threshold.

**This table said five until Cluster B was implemented, and the sixth was found by fixing the
first.** Treat six as a floor: the count has only ever gone up when somebody looked, because the
defect is invisible to the only search anyone would run for it.

**Filed by T185a** as one issue for the pattern — *icon control boxes are hardcoded from
`sizes.iconPx`'s default, so raising the token clips or overspills them* — carrying this table, the
`16 + 3 + 3` tell, the checked arithmetic, and the note that no grep for the token name finds any of
them. `github-issues`, type `bug`, `area:ui-shell`. 043 **fixes** the three its own requirements
reach (FR-079a) and **files** the rest; this appendix is the working note, and `plan.md`'s **F3**
Complexity Tracking entry is the record.

---

## Phase 13: Round four — opening a result where the user chooses

FR-087 … FR-089. One request: *"a context menu option that lets us open the file that the results are
found in, in either the last active editor, or a new editor, or in another tab — the same options
that are available in the file explorer."*

**"The same options" is the whole task, and it is a constraint on the CODE, not just on the labels.**
Two menus offering the same three commands while each computes its own labels and its own disabled
conditions is two implementations, and the copy is the one that drifts. So the round extracts the
explorer's targets into one shared description and draws both menus from it — which is why 13.1 and
13.2 come before the panel is touched at all.

Ordered so the risk is front-loaded: 13.1 is new and pure; 13.2 rewires a surface that already has a
dedicated test suite pinning it, so a regression is caught by tests that exist rather than by tests
this round writes; only then does 13.3 add the new surface.

**Two corrections are folded in because the round cannot honestly leave them.** `result-open.ts`
carries a written argument AGAINST this feature (FR-088), and 041 FR-013d's call-site gate is
premised on a fact 13.2 removes (FR-089).

### 13.1 One description, drawn twice

- [x] T219 `[P]` `unit` — `packages/ui/tests/unit/open-in-targets.test.ts`, against
      `describeOpenInTargets` and `openInMenuActions`, which are pure and need no DOM: the
      last-active label composes to `Last Active Editor (<title>)` and falls back to the bare form
      with no panel to name; **Last Active Editor** disabled when that editor already holds the file
      and enabled when it holds a different one (006 FR-082); **New Editor** and every **Other Tab**
      entry disabled when the file is open anywhere (006 FR-011a) while Last Active Editor stays
      enabled — the two flags are independent and that is the assertion most likely to rot; every
      target disabled with no active tab; **Other Tab absent, not disabled, when there is no other
      tab**; and every row declaring `section: 'navigate'` so the flyout derives no divider.
      **Failing first.**
- [x] T220 `packages/ui/src/renderer/editor/open-in-targets.ts` — `OpenInFacts` (plain data),
      `describeOpenInTargets` and `openInMenuActions` (pure), plus `readOpenInFacts` and
      `performOpenIn`, which are the two halves that touch the stores and are kept apart from the
      pure core **on purpose**: the Find in Files panel deliberately holds no workspace store, so it
      cannot call a function that takes one. It receives the plain data across its own registration
      boundary instead.
      > **No `testId` override on the two editor rows**, against this codebase's usual rule that an
      > id comes from the action rather than the label. The default `menu-item-<label>` id is already
      > load-bearing: live E2E specs use `menu-item-New Editor` as their route to a second panel, and
      > the component suite asserts `menu-item-Last Active Editor (Scratch)` to prove the suffix is
      > composed rather than constant. Renaming would turn an extraction into a test migration.

### 13.2 The explorer, rewired onto it

- [x] T221 `packages/ui/src/renderer/explorer/file-tree.tsx` — replace the inline `openIn` block in
      `onContextMenu` with `readOpenInFacts` → `describeOpenInTargets` → `openInMenuActions`, and
      delete the hand-rolled `openInto` / refuse / focus / `openFileInNewEditor` dance with it
      (FR-089). Labels, order, icons and both disabled conditions MUST come out unchanged — the
      measure of success is that `explorer-open-in-target.test.ts` passes untouched.
- [x] T222 Run the suites that pin the explorer's menu and fix what the extraction genuinely broke,
      never by loosening an assertion: `component/explorer-open-in-target.test.ts` (the dedicated
      suite — panel-title suffix, both disabled conditions, `normaliseFolder` path comparison),
      `component/file-tree.test.ts`, `component/explorer-root-menu.test.ts` (a folder's flyout stays
      exactly `OS File Explorer` + `Terminal`), and the fixture-driven `unit/menu-sections.test.ts`
      and `component/menu-section-rendering.test.ts`.
- [x] T223 Correct the **stale line-number citations** the extraction invalidates:
      `explorer-open-in-target.test.ts` cites `file-tree.tsx:390` in two comments, and several E2E
      tombstone comments cite the block by line. Cite the module by NAME, not by line — a line number
      in a comment is a citation that rots silently.

### 13.3 The panel's own Open In

- [x] T224 `packages/ui/src/renderer/find-in-files/result-open.ts` — **correct the FR-020 comment
      first** (FR-088). It claims "FR-020 already confines a search to the current tab, so there is
      no second tab this could mean"; FR-020 confines the **panel**, says nothing about search scope,
      and would not constrain the destination of an open even if it did. Then widen
      `ResultOpenRequest` with an optional chosen target, and add the target-describing registration
      beside the opener that is already there.
- [x] T225 `find-in-files-chrome.tsx` registers the target query in the same effect as the opener —
      both need the workspace store and the project root, and registering them apart would let one
      outlive the other.
- [x] T226 `find-in-files/content-menu.ts` — the **Open In** submenu, `section: 'navigate'`.
      > **Why `navigate` and not `contextual`.** Section 0's test is *"would this item be absent if
      > the pointer were elsewhere?"*, and an Open In on a result row would be. It still goes in
      > `navigate`, because the vocabulary table names "Open In" in that row explicitly, the
      > explorer's items have declared `navigate` since 033, and this menu already settles the same
      > shape the same way — its row-scoped commit granularities sit in `content`, named after the
      > file they target, rather than in `contextual`. Recorded because the next reader will ask.
- [x] T227 The panel's `onContextMenu` becomes async to await the target query, capturing the click
      coordinates and the originating row **before** the await rather than reading them after it.
      Drawn and disabled when no row is named (FR-087d), which is what the three commit
      granularities already do and for the same reason.
- [x] T228 `[P]` `component` — `packages/ui/tests/component/find-in-files-open-in.test.ts`: the
      submenu appears on a row right-click and is **drawn disabled** over the toolbar, a group
      heading and the empty space below the last row; each target opens the row's file at its match;
      and the panel still mounts **without a workspace provider**, which is the property that made
      the registration necessary and the one a future refactor would quietly cost.
- [x] T229 `[P]` **Other Tab has zero test coverage at any layer today** — not in the explorer, not
      anywhere. It is the one target of the three whose behaviour nothing pins, and this round is
      what makes it reachable from a second surface. Cover it: the list is the current project's
      tabs minus the active one, each entry disabled when the file is open anywhere, and the parent
      absent with one tab open.

### 13.4 Close-out

- [x] T230 Documentation currency (NON-NEGOTIABLE): `README.md` and `docs/**` for the panel's new
      menu group. Record what the sweep finds EMPTY as well as what it finds wrong — the two are
      different findings and only running the sweep tells them apart.
- [x] T231 `quickstart.md` — the hand-checkable steps this round creates, in the file's existing
      style with nothing renumbered: right-click a result row and open it into a named editor, into
      a new one, and into another tab; watch the match arrive selected in each; watch New Editor grey
      once the file is open; right-click the toolbar and watch Open In draw greyed.
- [x] T232 `npm run gate`, dispatched to a hosted runner, reported with the run URL **and** the SHA.
      Round three's green at `3beef774` is evidence about that commit only and does not cover this
      round.

---

## Phase 14: Convergence

**Assessed 2026-09-11** at `dbf3aeff` (all 232 tasks ticked, gate green at `efd1ad45`) against
`spec.md` through FR-089, `plan.md` (both rounds, F1–F3, D1–D6), `data-model.md`,
`contracts/*.md` and `.specify/memory/constitution.md`, by reading the code only. Nothing was run.
This is the **baseline taken before round five amends the spec**, so everything below is drift that
already existed, not round-five work. Superseded clauses were read as satisfied by their
superseding FR. Where a finding is traced by reading rather than reproduced, its task starts with the
failing test that proves it. CRITICAL here means only what the converge rubric means by it: a
constitution MUST is breached. It is not a judgement that the effect is large.

- [x] T233 CRITICAL — Draw **Replace in File** and **Replace Match** disabled when the row the menu
  was opened on has nothing pending, exactly as FR-084 already does for Replace All, per
  Constitution VI (disabled when unavailable), FR-049, FR-050 and FR-084 (contradicts).
  `find-in-files-panel.tsx:679-684` wires both handlers whenever a row is pointed at, and
  `content-menu.ts:179` disables a commit row only when replace is off or no handler exists. So
  Replace in File on a file whose rows are all committed sends `pendingRows(relPath) === []`, and
  `commit-replace.ts:219` returns without doing or saying anything. That is an inert live control,
  the defect FR-084 was written to remove. Replace Match on an already-committed row is worse. It is
  NOT filtered to pending rows, so it re-sends the committed offset. When the replacement contains
  the term (`foo` → `fooBar`, default modes), `replace-model.ts:164-166` finds the offset still
  "holds" and writes a second time (`fooBarBar`). `find-in-files-store.ts:644-651` then keeps the
  first write's shift, so the ledger no longer matches the file for every later row. This was traced
  by reading. Write the failing component test first, in the `find-in-files-commit-target.test.ts`
  style: commit a row, right-click it again, and assert both narrow rows are `aria-disabled`.
- [x] T234 CRITICAL — Bring `docs/quick-start.md` up to the shipped capability set per Constitution
  (Documentation currency, NON-NEGOTIABLE: "`docs/` … each describes its subject's current state")
  (partial). The user guide never mentions Find in Files. §5 *Find things* (`:295-348`) describes
  only the find bar. The folder context-menu list (`:350-359`, "Right-click a folder and you get")
  omits **Find in Files**. The keyboard table (`:441-458`) has neither `Ctrl+Shift+F` nor
  `Ctrl+Shift+H`. The per-panel zoom sentence below it names only terminals and editors, but FR-062
  added this panel. Only `README.md:58-75,172-189` describes the feature. T183, T216 and T230 swept
  for **stale** claims and found none, which is true: the guide never described the feature at all.
- [x] T235 HIGH — Stop a following window from re-running a query it merely ADOPTED, per FR-078b
  ("the window that is driving the search keeps its own box … the query travels one way") and
  FR-043c (contradicts). `find-in-files-store.ts:472-484` writes `adoptQuery` into `term`/`modes`.
  `find-in-files-panel.tsx:350-358,379-390` cannot tell that write from typing: it changes
  `queryKey`, and under FR-074's shipped as-you-type default the follower calls `scheduleScan()`.
  Once the settle interval passes, the follower starts the scan itself, and
  `file-search-service.ts:735` makes it the originator. The parent then receives `adoptQuery`
  carrying its own older term. That overwrites whatever the user typed after pausing for ≥500 ms,
  and it restarts the parent's scan on every search. The re-run also uses the follower's own
  un-adopted scope. `quickstart.md:201` ("Neither window's box should ever fight you") is the
  hand-check this breaks. This was traced by reading. The failing component test renders the panel
  at the default trigger, delivers an update carrying `adoptQuery`, advances past `settleMs`, and
  asserts that no `fileSearch.start` was called.
- [x] T236 HIGH — Make result rows openable in a sub-workspace window, per FR-037, FR-038, FR-087 and
  FR-087c for a panel synced under FR-025 (partial). `find-in-files-chrome.tsx:54-55` resolves one
  window-level project from `ws.layout.projectId`, which in a sub-workspace is the synthetic
  `subworkspace:<id>` (`subworkspace-window-client.ts:33-35,86`). No project matches it, so
  `projectRoot` is `null`, and `:73-78` registers **no** result opener and **no** target lister.
  In that window, double-click and Enter on a row do nothing (`result-open.ts:126-129`), and Open
  In is always drawn disabled (`result-open.ts:163-165`, `content-menu.ts:154`). The panel itself
  knows its own project root (`panel-body.tsx:36,48,153`), and a sub-workspace may hold panels from
  several projects, so the fix is to resolve each request against **the panel's** root rather than
  the window's. This was traced by reading. `find-in-files-subworkspace.e2e.ts` never opens a row.
- [x] T237 HIGH — Report every commit's own file list, never an earlier one's, per FR-058 and SC-008
  (partial). The notice provider's duplicate rule (`notification.tsx:802-819`) compares severity,
  message, title, action, testId and subject, but not `details`. The commit headline
  (`commit-replace.ts:429-433`) is built from counts alone. So a second commit with the same counts
  (step through Replace Match on `a.ts`, then `b.ts`: "1 of 1 files changed …" both times) only
  pulses the first card. The second commit's file list is never shown or logged (`fileRecord` is
  skipped at `:818-819`). Under FR-082's shipped `dismiss` default the first card is still up, so
  this is the ordinary path.
- [x] T238 HIGH — Make the explorer toolbar's Find in Files control search the whole project even when
  it reuses a panel that was scoped to a folder, per FR-029a ("starts a search over the whole
  project") and US3 scenario 12 ("a search opens scoped to the project root") (partial).
  `toolbar.tsx:126` sends `{ route: 'toolbar', replace: false }` with no scope, and
  `open-find-in-files.ts:138` retargets only when `scopeSubPath !== undefined`. So after
  right-clicking `src` → Find in Files, pressing the toolbar control reuses that panel (FR-021's
  default) and keeps searching `src`, and nothing on screen says the scope was not reset. A new
  panel is unaffected because it opens at the root. *Found while this phase was being assessed: an
  uncommitted test in the working tree
  (`packages/ui/tests/component/explorer-toolbar.test.ts:304-325`, labelled "043 round five")
  already asserts it. The gap is in the code at `dbf3aeff`, so it is baseline drift and not
  round-five work, whatever that test calls it.*
- [x] T239 MEDIUM — Have a repeated notice's timer honour that notice's own `display`, per FR-082 ("for
  this one notice the global `notifications.*` settings MUST NOT be consulted at all") and FR-082a
  (partial). `flash()` re-arms at `notification.tsx:574-582` from
  `displaySettings.current[severity].timeoutMs`, which is the global. `notify()` resolves the
  override correctly at `:670-673`. With the replace summary set to *Display for* 30 s, a second
  identical summary within 30 s shortens it to the global success timeout.
  `specs/030-failure-presentation/contracts/notice-api.md:45-47` claims every consulting point
  honours the override.
- [x] T240 LOW — Reconcile `data-model.md` §6 and `contracts/file-search-ipc.md` with the shipped
  commit result, per `plan: data model` (contradicts). `data-model.md:296` still says "**A commit
  saves nothing** (FR-053a). `changedInBuffer` files are left dirty". That is superseded by FR-086
  and false of the code. Its `CommitOutcome` (`:244-250`) lacks `notSaved`, `saved` and the per-edit
  `snippet` (FR-083b). The contract's round-three `CommitOutcome` (`file-search-ipc.md:399-411`)
  lacks `saved`, which the summary counts (`commit-replace.ts:390`), and types
  `notSaved[].reason` as `SaveReason` where the code carries `string`
  (`replace-commit-service.ts:92-95`). This is the Phase 10 T119 precedent: the design artifacts
  and the code disagree while every test passes.
- [x] T241 LOW — Record FR-082a's widened notice contract in spec 030's own requirements, not only
  its contract file, per FR-082a ("MUST be recorded there as well as here") (partial).
  `specs/030-failure-presentation/contracts/notice-api.md:16-58` carries it. But
  `specs/030-failure-presentation/spec.md:947` ("There are no per-notice or per-call-site
  overrides") and `:997` (Out of Scope: "Per-notice or per-call-site persistence overrides") still
  state the opposite with no supersession marker. Add the marker the way this spec's own
  supersessions are written. Nothing is rewritten.
- [x] T242 LOW — Correct the code comments that still describe behaviour this feature has since
  replaced, per FR-074, FR-073 and the Phase 11 preamble's rule that a default is carried by prose
  (contradicts). The instances:
  - `find-in-files-panel.tsx:11-13` says "By default: an explicit run". FR-074 made as-you-type the
    default.
  - `find-in-files-panel.tsx:809-813` says the preview and the commit are "043's next increment".
  - `content-menu.ts:30-33` and `:51-52` say the same of the commit rows.
  - `results-list.tsx:242-245` says opening a row is "043's later work".
  - `find-in-files-store.ts:102`, `:277` and `:699` speak of "all three shapes" and "Group by
    folder". FR-073 left two.

  Not found by a grep for the constant. Found by reading, which is the rule.

---

## Phase 15: Round five — searching from the tree, and a file as a scope

FR-090 … FR-092c. One request: *Open In → Search → Find* and *Find & Replace* on files and folders,
both opening or refreshing the current tab's panel into a cleared state with the scope filled; and a
scope box that accepts a file's full path.

**Phase 14 is the baseline, not this round's work.** It was appended by a converge run taken BEFORE
the spec was amended, and which of its findings ride along is the maintainer's call. The one
exception is T238 — the toolbar keeping an old folder scope — because it sits in the entry routes
this round rewrites and was independently reproduced while reading them; T253 closes it and ticks it.

Ordered so each layer is proven before the one above depends on it: the pure reading of a typed
scope first, then main's scan and clear, then the renderer that drives both, then the menu that
drives the renderer.

### 15.1 What a typed scope means

- [x] T243 `[P]` `unit` — `packages/core/tests/unit/scope-input.test.ts`, against a pure
      `readScopeInput(projectRoot, text)`: `''` and whitespace are the whole project; a root-relative
      path is itself; `\` reads as `/`; a leading `./` and any trailing separator are ignored, so
      `src/` is `src` and can no longer produce `src//a.ts`; an ABSOLUTE path inside the project reads
      as its root-relative form, case- and separator-insensitively on Windows; the project root
      itself, absolute, is `''`; an absolute path OUTSIDE the project is `outside`; and a relative
      path climbing out with `..` is `outside` rather than silently clamped. **Failing first.**
- [x] T244 `packages/core/src/search/scope-input.ts`, exported from the core barrel, built on the
      containment and relativisation rules `path-rules.ts` already ships (FR-070's own primitives)
      rather than a second copy of them.

### 15.2 Main: a file scope, and a clear every window hears

- [x] T245 `[P]` `integration` — in `file-search-scan.integration.test.ts`: a scope naming a FILE
      searches that file and no other, even with siblings holding the term; its rows carry the
      ROOT-relative path; a binary or over-limit file scoped by name is one file skipped, not read;
      an excluded file scoped by name IS searched (FR-092); and deleting the scoped file after the
      scan marks the scope missing with the rows kept (FR-092a). The first assertion is the defect
      today — the walk reads the file as a directory and reports no matches. **Failing first.**
- [x] T246 `file-search-service.ts` — `scan` asks `stat(base).kind` once and, for a file, visits
      exactly `{ relPath: subPath, abs: base }` with no walk and no excluder; for a folder, walks as
      it does today. The per-file size, read and binary rules run for both, from one loop, so a file
      scope cannot acquire rules of its own by accident.
- [x] T247 `[P]` `integration` — `clear(viewer, panelId)`: every window viewing the run is told
      `notRun` under a new generation with no rows; a scan still walking stops and its remaining
      batches are dropped; `held` and `staleFiles` are released so a later watcher tick re-stats
      nothing; a window NOT viewing the panel cannot clear it (the `cancel` rule); the clearing
      window becomes the query's originator (FR-078b); and a panel with no run is a no-op. **Failing
      first.**
- [x] T248 `FileSearchService.clear`, the `throng:fileSearch:clear` channel, its preload binding
      and `global.d.ts` entry, and `contracts/file-search-ipc.md` plus its contract test. Fire and
      forget, like `cancel` and `drop`.

### 15.3 The renderer

- [x] T249 `[P]` `component` — `find-in-files-scope.test.ts`: a typed absolute path inside the
      project searches the root-relative scope; one outside is refused with the `outsideProject`
      notice and starts nothing (FR-092b, FR-070); a trailing slash and backslashes reach main
      normalised; and the box keeps exactly what was typed. **Failing first.**
- [x] T250 `find-in-files-store.ts` — `runFindInFiles` reads the scope through `readScopeInput`;
      `resetFindInFilesPanel(panelId, { scopeSubPath, replace })` empties the term and the
      replacement, clears the rows to `notRun`, drops the committed and stale markings and the scope
      notice, sets the scope and the disclosure, moves the caret to the SEARCH input, and asks main
      to clear (FR-091, FR-091a).
- [x] T251 `[P]` `component` — `find-in-files-entry.test.ts`: the tree route leaves a REUSED panel
      and a NEW panel in the same state; runs nothing under either trigger; focuses the search input
      for Find & Replace as well as Find; hides replace for Find and shows it for Find & Replace; and
      honours `openTarget: new`. The two shipped assertions that the context-menu route re-runs the
      existing term are **amended with FR-091 named**, not deleted — the chord still re-runs, and
      that half moves to a chord test. **Failing first.**
- [x] T252 `open-find-in-files.ts` — the `contextMenu` route resets instead of invoking. The chord
      and the toolbar keep `invokeFindInFiles` exactly as they are.
- [x] T253 `explorer/toolbar.tsx` — the toolbar asks for the whole project (`scopeSubPath: ''`),
      turning the round's first test green. Ticks **T238**, which is the same defect found by the
      baseline.

### 15.4 The tree's menu

- [x] T254 `[P]` `unit` — `explorer-find-in-files-menu.test.ts`, rewritten around FR-090 with the
      supersession of FR-029b named in its header: *Open In → Search* holds exactly **Find** and
      **Find & Replace**, on a file, a folder and the root; every row is `navigate`; each hands the
      right-clicked node's path and its disclosure to the op; and the old folder-level **Find in
      Files** row is **gone** — asserted as an absence, because a moved row that is also left behind
      is the duplication 006 FR-030 forbids. **Failing first.**
- [x] T255 `context-menu-items.ts` and `file-tree.tsx` — `ContextMenuOps.findInFiles(relPath,
      replace)`, the Search submenu appended after Terminal inside Open In, and the folder row
      removed with its comment rewritten: its reason for excluding files was the directory premise
      FR-092 withdraws.
- [x] T256 Amend every shipped assertion that pins the old shape, each with FR-090 named rather than
      loosened: `explorer-subtree-menu.test.ts` (folder Navigate no longer ends in Find in Files),
      `menu-sections.test.ts` (root and folder shapes), `explorer-root-menu.test.ts` (root flyout
      gains Search), `explorer-terminal-menu.test.ts` and `menu-section-rendering.test.ts` (flyout
      contents). `explorer.e2e.ts:370` — the first flyout row is still the OS reveal — must NOT need
      changing, and that is checked rather than assumed.

### 15.5 Close-out

- [x] T257 Documentation currency (NON-NEGOTIABLE): `README.md` (the tree's route and file scopes),
      `data-model.md` (a scope may name a file; the `clear` channel), `contracts/file-search-ipc.md`
      (T248), and `quickstart.md` steps in the file's existing style — right-click a file and a
      folder and open each item; watch a reused panel empty; scope a file by typing its absolute
      path; type an outside path and watch it refused.
- [x] T258 Closing converge, read against Phase 14's baseline: a finding already in Phase 14 is not
      this round's, and anything new is.
- [x] T259 `npm run gate`, dispatched to a hosted runner, reported with the run URL **and** the SHA.
      GREEN at <https://github.com/Bidthedog/throng/actions/runs/34578357681>, SHA `2a6143b4`,
      34m20s, all eight stages, E2E 175 parallel + 345 serial, zero failed and zero flaky. Serial is
      two up on round four's 343 because of `master`'s two #382 tests, the same two the budget merge
      counted. That SHA is the whole branch consolidated to nine commits and rebased
      onto `master` at `87753b03`, with T260–T263 in it, so it covers rounds four and five together.
      The commit that ticks this box is markdown-only and lands on top of it, so the gate does not
      cover that one commit.

---

## Phase 16: Convergence

**Assessed 2026-09-11** at `87be3357` (T243–T257 ticked, T259's gate still running) against
`spec.md` through FR-092c, `plan.md`, `data-model.md`, `contracts/*.md` and
`.specify/memory/constitution.md`. It was done by reading the code only, and nothing was run.
**It was read against Phase 14's baseline.** Outside round five's 26-file diff from `dbf3aeff`, the
code is byte-identical to what that baseline assessed. So FR-001 … FR-089 were checked for their
status against T233–T242 rather than re-derived. T238 is closed by T253. T233–T237 and T239–T242
are still open and are not restated here. Nothing below is in Phase 14. Superseded clauses were
read as satisfied by their superseding FR. Every finding was traced by reading, so each task starts
with the failing test that proves it. Each task says where the gap came from, because two of these
predate round five and the baseline missed them.

- [x] T260 MEDIUM — Make an invocation that CHANGES a reused panel's query start exactly one scan,
  per FR-043a ("Invoking find or replace in files is itself an explicit run") under FR-074's shipped
  as-you-type default (partial). `open-find-in-files.ts:165,181-183` writes the scope and, on the
  chord, the seed (through `invokeFindInFiles`, `find-in-files-store.ts:820-834`). It then starts
  the scan at once. The mounted panel's query effect (`find-in-files-panel.tsx:350-390`) cannot tell
  that write from typing, so it schedules a second, identical `start` `settleMs` later. Main
  supersedes the first scan (`file-search-service.ts:775-810`). The list then drops back to the
  second run's first batch and streams again, and on a large project the first walk's work is
  thrown away. Two routes reach it:
  - The toolbar, on a panel scoped to a folder. This is new in round five, because T253's
    `scopeSubPath: ''` is a scope change.
  - The chord, with a selection that differs from the panel's term. This dates from FR-074 in round
    two.

  `find-in-files-trigger.test.ts:302-311` passes only because it never advances the clock after
  invoking. The tree route is unaffected: its term is empty, so the second run refuses. This was
  traced by reading. The failing component test is that same test at the default trigger, with
  `tick(SETTLE_MS * 10)` after the invocation, asserting `startedTerms()` is `['haystack']`. Add a
  toolbar twin: scope a mounted panel to `src`, invoke with `scopeSubPath: ''`, advance past
  `settleMs`, and assert one `start`.
- [x] T261 LOW — Refuse every typed absolute path outside the project as OUTSIDE rather than as a
  missing scope, per FR-092b and `contracts/file-search-ipc.md:522` ("Absolute-outside-the-project,
  or any `..`, is FR-070's refusal") (partial). Two spellings still read as *Scope missing*, which
  is the wrong condition FR-070's round-five marker names:
  - **An absolute path with a `..` segment** (`D:\proj\..\other`). The `..` refusal at
    `scope-input.ts:48-49` runs only on the relative branch, and `isWithinRoot`
    (`path-rules.ts:10-15`) is a string-prefix test. So `scope-input.ts:45` hands main `../other`,
    and `isUnderPath` refuses it at `file-search-service.ts:337` as `scopeMissing`.
  - **A bare drive root** (`C:\`). The trailing-separator strip at `scope-input.ts:37` leaves `C:`.
    That does not match `ABSOLUTE` (`:31`), so it is joined to the root as a sub-directory named
    `C:`.

  Nothing outside the project is searched either way, because main's guard holds. So this is about
  the notice, not about Principle I. This was traced by reading. The failing unit test goes beside
  the absolute cases in `scope-input.test.ts:74-101`: `scope('D:/proj/../other')` and
  `scope('C:\\')` are both `'outside'`.
- [x] T262 LOW — Open the scope control's folder chooser at the READ scope, not at the box's raw
  text, per FR-092b ("the reading happens where the scope is used") (partial).
  `find-in-files-panel.tsx:974-976` joins `state.scopeSubPath` onto the root verbatim. Since round
  five that text may be an absolute path, so a box reading `D:\proj\src` hands the dialog
  `D:\proj/D:\proj\src`. That names no folder, so the dialog does not open at `src`. Build
  `defaultPath` from `readScopeInput`, using the root for `outside`. This is new in round five.
  Where the Windows dialog actually lands for a malformed `defaultPath` has not been checked, so
  that part is a hypothesis. The failing component test stubs `pickFolder`, types an absolute path
  inside the project, clicks browse, and asserts `defaultPath` is the absolute form of the read
  scope.
- [x] T263 LOW — Mark a changed file stale when its scope was typed in a different case from the
  disk, per FR-045a and SC-012 (partial). A typed scope keeps the user's spelling
  (`scope-input.ts:45,50`). `scope-input.test.ts:69-71,83-87` pins that, on the stated belief that
  the typed spelling is the real one. `file-search-service.ts:899-904` then prefixes every row's
  path, and every `held` key, with that spelling. The watcher reports the directory as the disk
  spells it (`explorer-watcher.ts:59-61`), and the staleness filter compares case-sensitively
  (`file-search-service.ts:510-512`). So on Windows, with scope `SRC` over `src/a.ts`: the file is
  edited, `noteDirectoryChanged(root, 'src')` finds no held path under `src/`, and the group is
  never marked stale. The missing-scope check makes the same comparison (`:766-767`). So a scope
  `SRC/deep` is not marked missing when `src/deep` is deleted. A top-level scope is still marked,
  because its deletion is reported against the root. This predates round five for a typed relative
  scope, and round five's absolute reading carries the same spelling through. This was traced by
  reading. The failing integration test goes in `file-search-scan.integration.test.ts`: scan with
  `scopeSubPath: 'SRC'` over a tree holding `src/a.ts`, rewrite the file, call
  `noteDirectoryChanged(root, 'src')`, and assert `staleFiles` names it. Skip it where the
  filesystem is case-sensitive, because there is no `SRC` there.
