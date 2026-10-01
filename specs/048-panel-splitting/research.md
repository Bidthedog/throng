# Research: Panel Splitting and Content-Derived Panel Titles

Every decision below was taken by reading the code at `a9d84a5b` (alpha8). Paths are repository-relative;
`ui/` is `packages/ui/src/`, `core/` is `packages/core/src/`.

## R1 — The split operation is a core layout op beside `movePanelToEdge`

**Decision**: add `splitPanel(layout, tabId, targetPanelId, direction, title)` to
`core/workspace/operations.ts`. It builds a placeholder with `makePanel`, replaces the target leaf with a
two-child split through the existing private `insertAtEdge` (Down→`bottom`, Up→`top`, Right→`right`,
Left→`left`; `equalSizes(2)` gives the 50/50), sets the tab's `activePanelId` to the new panel, and
`finalize`s. The title is the store's existing `Panel ${totalPanels + 1}` formula (the one `addPanel` and
`addPanelBeside` already share), then claimed unique by `panel-name-sync.tsx` exactly as today.

**Rationale**: `insertAtEdge` already replaces only the target leaf, so FR-001's "no other panel changes"
is structural, not a measurement. `makePanel` sets no `zoom`, so the new panel starts at the default zoom
and the original keeps its own (FR-004). The minimum-size clamp lives in the renderer
(`ui/renderer/workspace/resize-math.ts:7` `clampAdjacent`, `split-tree.tsx:8` `MIN_CELL_PX`) and applies to
any two-child split, so a split of a very small panel is clamped exactly as an edge-drop split is.

**Alternatives rejected**: reusing `addPanelBeside` (044) — it takes an externally built panel and only
supports left/right; widening it would couple 044's Open-beside path to this one. Keeping `addPanel`
(append-to-root) — FR-013 retires that placement for the **+** path. `addPanel` itself stays: the File
Explorer / Open In paths still call it and are out of scope.

## R2 — The **+** button opens the existing context-menu component, anchored to the button

**Decision**: `panel-placeholder.tsx:1066-1072`'s `IconButton` opens the window's existing `ContextMenu`
(`ui/renderer/workspace/context-menu.tsx`) at the button's bounding rect, with the four split items from a
shared builder `splitMenuItems(panelId, keybindings)` (new, `ui/renderer/workspace/split-menu.ts`). The
click first calls `ws.setActivePanel(tabId, panel.id)` with the **header's own `tabId` prop** — the current
handler uses the layout's active tab (`:140`), which is the defect behind FR-011. Title "Split panel…"
(FR-014); `aria-haspopup="menu"`. Enter/Space come free from `IconButton` being a `<button>`; arrow
navigation is `ContextMenu`'s (FR-012).

After a split, focus goes to the new panel through `requestPanelFocus(newId)` (`panel-focus.ts:106`), which
parks until the panel mounts (FR-002).

**Rename-on-add is deleted** with the rest of rename (R6): `lastAddedPanelId`, `clearLastAddedPanel` and
their five callers (`file-tree.tsx:437`, `open-find-in-files.ts:226`, `open-preview.ts:210`,
`open-in-editor.ts:94`, `open-into-panel.ts:141`) go.

**Alternatives rejected**: a bespoke dropdown component — a second menu implementation would diverge from
the section, divider and keyboard rules `ContextMenu` already enforces.

## R3 — One **Split** submenu builder, in `create`, on every panel menu

**Decision**: `splitSubmenu(...)` returns one `MenuAction` with `section: 'create'` and four children
(Split Down, Split Up, Split Right, Split Left, each `shortcut: 'panel.split*'`). It is added to
`panelHeaderMenu` (`workspace/panel-header-menu.ts:325`) and to every content menu:
`editor/content-menu.ts:124`, `terminal/terminal-content-menu.ts:45`, `preview/content-menu.ts:121`,
`find-in-files/content-menu.ts:126`. The untyped placeholder gains its first content menu
(`workspace/panel-body.tsx`), holding Split alone (FR-015).

**Section**: Principle VI's vocabulary has no "layout" section; the nearest is **Create** — "makes
something new" — and a split's observable effect is a new panel. FR-016 names "the section the vocabulary
assigns to layout actions"; Create is that assignment, recorded in the menu contract. The header menu's
Zoom submenu is the precedent for a submenu row (`panel-header-menu.ts:414-443`).

## R4 — Split mode is a window-scope `ChordEngine` host

**Decision**: the 046/047 `ChordEngine` (`ui/renderer/keybindings/chord-engine.ts`) gains its third host,
at window scope, inside the shared window dispatcher (R5). Four new actions `panel.splitDown/Up/Right/Left`
(`core/config/keybindings.ts`), scope `EVERYWHERE` (every panel type, including untyped placeholders and previews, and live from the side panes so the first stroke can pull focus to the active panel — FR-021, FR-024), defaults `Ctrl+Shift+Alt+End,ArrowDown` etc.

- `matchFirst`: the dispatcher's candidate tokens (`resolveKeydown` → `Ctrl+Shift+Alt+End`, physical, via
  `tier1PhysicalKey`) are compared with the **first strokes** of every window-scope multi-stroke binding
  live in the current scope. A match calls `engine.begin(...)` and starts split mode.
- `matchNext`: the second key is matched with the first stroke's modifiers **stripped** (FR-020a), so
  `ArrowDown` and `Ctrl+Shift+Alt+ArrowDown` both complete `panel.splitDown`.
- **Engine option** `modifierPolicy: 'carried' | 'released-ok'`. Today's editor/preview hosts keep
  `'carried'` (046 FR-124: releasing a first-stroke modifier ends the prefix). The window host passes
  `'released-ok'`: modifier release does not end the prefix, and `holdsCarried` is not consulted. This is
  the only engine change; timeout (`TWO_STROKE_TIMEOUT_MS` 4000), Escape consumption and the unbound
  report stay 046's (FR-024).
- The window listener runs in the capture phase and `consume`s every key the engine takes, so neither
  stroke reaches xterm (FR-023); the terminal's own `attachCustomKeyEventHandler` never sees them.
- Because the engine sees the key before `resolveKeydown`'s single-stroke resolution, a pending split mode
  wins over `focus.*` on `Ctrl+Shift+Alt+Arrow` (FR-020a).

**Split-mode state** is a module store `ui/renderer/workspace/split-mode.ts` (the `panel-flash.ts`
pattern: `startSplitMode(panelId)`, `endSplitMode()`, `useSplitMode(panelId)`). Entering it focuses the
active panel (`setActivePane('workspace')` + `focusPanel`, the `goToPanel` route, `app.tsx:325`); ending
by cancel leaves focus there (FR-021, FR-022). Endings wired to `engine.end()`: window `blur`, an
active-panel change, `ContextMenu` open (a new `onMenuOpen` subscription in `context-menu.tsx`), and the
dnd `onDragStart` (`tab-group.tsx:1045`). A second first stroke re-`begin`s, which re-arms the timeout
(FR-025).

**Pulse** (FR-021, FR-026): a `panel-box__split-mode` overlay in `panel-placeholder.tsx` next to
`panel-box__flash` (`:1094`), border `var(--accent)` like 047's flash (`theme.css:2135`), animating
**opacity only** (compositor-only), with a `prefers-reduced-motion` rule giving a steady border.

**Pending text**: the existing `PendingChord` overlay (`editor/pending-chord.tsx`), portalled into the
panel's box. 046 draws it as an overlay, not through a status bar; FR-021 limits it to panels that have a
status bar, so the window host portals it only when the active panel's kind has one and it is shown
(editor, preview, terminal — `status-strip.tsx`, `preview-status-bar.tsx`, `terminal-status-bar.tsx`);
otherwise the pulse is shown alone. *[derived — placement follows 046's overlay]*

**Terminal-tier validation** (FR-024): `twoStrokeTerminalViolations` (`keybindings.ts:995`) and
`parseKeybindings` (`:720-722`) today reject **any** multi-stroke token on a terminal-live command. The
constitution only forbids a multi-stroke chord whose **first stroke is in the reserved tier** (Principle IV,
"Outside the tiers"). Both checks narrow to that rule, sharing one predicate; `Ctrl+Shift+Alt+End` is tier 1
and passes. `terminal-reserved-keys.test.ts` and the tier test gain the split rows.

**Tier-1 AltGr cost** (Principle IV): `End` and the arrows carry no AltGr character on the seven named
layouts; the chord is reachable on all of them. xterm would otherwise send a `1;8`-modified `End` for the
first stroke, which no default readline/PSReadLine binding uses (046 R22's reasoning, same key class).

## R5 — One window dispatcher, mounted in both windows (#275)

**Decision**: extract `KeybindingsHandler` (`ui/renderer/app.tsx:273-602`) into
`ui/renderer/keybindings/window-dispatcher.tsx`, parameterised by a `WindowCapabilities` object
(`{ kind: 'main' | 'sub-workspace', has(action): boolean }`). Mount it in `app.tsx` and
`subworkspace-app.tsx`; delete the sub-workspace `keydown` listener in
`navigate/navigation-chrome.tsx:245-304` (its Quick Open / Go To Line / Back-Forward handling moves into the
dispatcher's `switch`, unchanged in behaviour — FR-093). One normalisation (`resolveKeydown`), one Shift
rule (`windowProducedEvent`), one resolver (`resolveScoped`), one gate (`WINDOW_HANDLED_ACTIONS`) — FR-090.

**Unavailable commands** (FR-092): in a sub-workspace window `has(action)` is false for actions that act on
surfaces that window lacks: `project.next`, `project.previous`, `focus.projects`, `focus.explorer`,
`view.toggleProjects`, `view.toggleExplorer`, `file.undo`, `file.redo`, `search.findInFiles`,
`search.replaceInFiles`, `focus.notice` *(the set whose
handler reaches a side pane or the main-window-only stores)*. Such a chord is consumed and reports
"*Command* is not available in a sub-workspace window." through the `PendingChord` overlay store as a third
indicator kind, `unavailable`, with the unbound notice's lifetime (`UNBOUND_NOTICE_MS`) — one surface for
chord feedback (constitution: one condition, one notice).

`PanelFocusSync` (`app.tsx:672-711`) stays main-window-only; the dispatcher's `focus.*` and split paths use
the window's own `ws` store, which the sub-workspace already has.

**Alternative rejected**: teaching the sub-workspace listener split mode — FR-090 forbids a second path.

## R6 — Removing panel rename

**Decision**, by layer:

| Layer | Removed | Kept |
|---|---|---|
| core model (`workspace/model.ts:166,171`) | `titleIsCustom`, `defaultTitle` from `Panel` | `title` (automatic "Panel N" fallback) |
| core ops (`operations.ts:374-405,425,442`) | `renameInNode`, `resetNameInNode`, `renamePanel`, `resetPanelName` (+ `index.ts:815` export) | `retitlePanel` (automatic retitles, project-owned sync) |
| core `rename-commit.ts` | panel use; the module stays if tab rename uses it, else removed | — |
| core `panel-title.ts:159-174` | the custom-title branch of `resolveTitle`; `previewTitleParts`'s custom check (`:122`) | every derived branch |
| core keybindings | `panel.rename` from `ActionId`, `COMMAND_SCOPES`, `WINDOWS_BINDINGS` (`:124,306,461`), metadata (`keybindings-metadata.ts:151`) | `file.rename` F2 |
| core theme | `resetName` icon token (`theme.ts:522,554`, `theme-copy.ts:739`) | — |
| renderer | header edit mode, `NameLimitField` use, double-click, `beginRename`/`resetName` actions and menu rows, `workspace/panel-rename.ts`, `panel-rename-sync.tsx`'s rename half, `app.tsx`'s `panel.rename` case, `search-actions.ts` `ALWAYS_OURS` entry | tab/project/sub-workspace rename |
| preload/main | `throng:panel:rename` / `renamed` (`preload.cts:208-213`, `main.ts:2135-2144`, `global.d.ts:126-127`) | `throng:panel:retitle` / `retitled` |

**Migration** (FR-035): `dropCustomPanelTitles(layout)` in core, applied wherever a persisted layout is
normalised on load (`validateMainLayout`'s caller in `daemon/workspace-service.ts:72-94`, and the
sub-workspace / tear-off layout load in `core/workspace/sub-workspace.ts`). For each panel with
`titleIsCustom`: `title := defaultTitle ?? title`; then delete both fields. Idempotent by construction (a
panel with neither field is untouched). `LAYOUT_SCHEMA_VERSION` is **not** bumped: the fields are optional
in every earlier release, so a layout written now still loads there (downgrade edge case).

**A stale `panel.rename` override** in a user's `keybindings.json` is already inert: `parseKeybindings`
keeps unknown ids, `resolveAction` skips an id with no scope entry (`keybindings.ts:1078`), so F2 resolves
to `file.rename` in the File Explorer and to nothing (terminal passthrough) elsewhere (FR-037). A unit test
pins it. `SHIPPED_DEFAULTS_VERSION` moves only if `shipped-defaults.ts`'s own tests require an entry for the
added/removed defaults.

**Tests that die with the feature**: e2e `panel-rename-key`, `panel-reset-name`, `subworkspace-rename-sync`;
core `panel-reset-name`, `panel-custom-title-invariant`, `rename-commit` (panel cases); component
`name-limit-field` (panel cases). Tests that only used rename to add a panel switch to the new harness
helper (R10). The E2E budget ratchet is re-seeded in the same commit that removes specs.

## R7 — Outer-edge zones are four droppables inside `.tab-body`

**Decision**: `OuterEdgeZones` (new, `ui/renderer/workspace/outer-edge-zones.tsx`) renders four
`useDroppable` bands (`outer|left`, etc., built/parsed in `drag-state.ts`) absolutely positioned inside
`.tab-body` (`tab-group.tsx:1620`, which gains `position: relative`), only while a panel is dragged and the
tab holds more than one panel (FR-060). Band width: a CSS constant `--outer-edge-band: 16px`.

- **Priority** (FR-064): `DndContext`'s `collisionDetection` becomes a wrapper over `pointerWithin` that
  returns an outer-edge collision ahead of any panel edge zone. **Corner rule**: left/right beat top/bottom
  — the tall side column is the layout the story leads with. Documented in the quick-start and the contract.
- **Preview** (FR-065): a non-interactive overlay drawn by `OuterEdgeZones` while a band is `isOver`,
  covering the full edge at one third of the area — the size the drop will take — styled distinctly from
  `.edge-zone--over` (a dashed outline plus accent fill).
- **No per-move measurement** (FR-066): dnd-kit measures droppable rects at drag start; the bands add four
  rects. No `getBoundingClientRect` on pointermove.

**Core op** `movePanelToOuterEdge(layout, panelId, tabId, edge)`: remove the panel (existing
`removeFromNode` collapse), then —
- if the root is a split whose orientation matches the axis (row for left/right, column for top/bottom):
  insert the panel as the first/last child with size 1/3, scaling the others by 2/3 (FR-063);
- otherwise wrap the root: `split(axis, [panel, root])` sizes `[1/3, 2/3]` (or reversed) (FR-061, FR-062);
- **no-op** (layout returned unchanged, no save) when the panel is already the first/last child of a root
  split along that axis (FR-067);
- cross-tab: the panel may come from another tab (as `movePanelToEdge` allows); `finalize` drops an emptied
  source tab.

Persistence is the store's generic `apply` → save (`workspace-store.tsx:403`), per window (FR-068).

## R8 — Esc-cancelled drag (#458)

**Root cause (confirmed by reading)**: `DndContext` (`tab-group.tsx:1450-1456`) has no `onDragCancel`.
dnd-kit's `PointerSensor` cancels on Escape and fires only `onDragCancel`, so `reset()` (`:1119-1135`) —
the one place that sends `dragGhost.stop()`, removes the pointermove listeners, clears hover and
`draggingPanelId` — never runs. Main's ghost interval (`main/ghost-window.ts:206-220`) keeps the OS ghost
window at the cursor until the next `onDragEnd`.

**Decision**: `onDragCancel={reset}` plus an unmount cleanup that calls `reset()`. `reset()` never changes
the active tab, so a tab the drag switched to stays active (FR-081). `reset()` also ends split mode and
closes an open **+** menu (the Edge Cases' "Escape during a drag"). A component test drives dnd-kit's
cancel and asserts `ghost.stop`, cleared zones and an unchanged layout; the regression is also pinned by an
E2E (`drag-ghost.e2e.ts` gains the Escape case, since the ghost is a real window).

## R9 — A preview's own scroll place after a remount (#459)

**Facts**: inactive tabs' panels are **unmounted** (`tab-group.tsx:1620-1622`). On detach the preview
captures its place (source line + offset ratio, `scroll-anchor.ts`) into main's navigation history keyed by
**panel id** (`preview-panel.tsx:1446-1457`, `navigation-history-service.ts:161`); on re-attach main answers
with it (`preview-service.ts:1230,1330,1442`) tagged `'attach'`. Nothing applies another panel's scroll by
file path.

**Hypothesis (to be confirmed by a failing test before any fix)**: the attach place is applied before the
content's final layout. In a draw, `applyPlace` runs at `markdown-body.tsx:647`, the fold gutter hides
collapsed sections afterwards (`:663`), the fold state is re-seeded asynchronously on every mount
(`preview-panel.tsx:920-939`), and table layout is a debounced pass (`:338-344`); none re-anchors. Content
above the anchor then moves under a fixed `scrollTop`. A drag across tabs multiplies the
capture/restore cycles (hover-switch unmount, switch-back remount, possible move remount), and a capture
taken before the previous restore settled stores the shifted place permanently.

**Decision**:
1. A component test mounts a preview with collapsed sections and tables, scrolls it, unmounts/remounts it
   through the real attach path with fold state seeded late, and asserts the anchor line — failing first.
   A second test repeats the cycle 20 times (SC-011).
2. The restore becomes **settle-aware**: an attach place stays "pending" until the first draw whose fold
   state has been seeded and whose deferred table pass has run; each of those re-anchors to the pending
   place, then it clears. A detach capture while a restore is still pending re-stores the **pending**
   place, never the unsettled `scrollTop`.
3. **FR-084**: the attach policy (`preview-panel.tsx:1614-1622`, `attach` + syncing → `editorLine`) uses
   the preview's **own** captured place whenever history holds one for this panel; `editorLine` stays for
   an open or a restart restore, where there is none.
4. `autoScroll={false}` on `DndContext`: dnd-kit's default auto-scroll can scroll ancestors of the node
   under the pointer; nothing in throng relies on it. *[derived — defensive, one attribute]*

## R10 — Test layers and the E2E budget

| Layer | What it carries |
|---|---|
| core unit | `splitPanel`, `movePanelToOuterEdge` (+ no-op, root-axis, cross-tab), `dropCustomPanelTitles` (idempotent, ids untouched), keybinding defaults/tiers/validation for `panel.split*`, `panel.rename` gone and a stale override inert |
| ui unit | split-mode store, menu-section shapes (header, 5 content menus), window capabilities table, `ChordEngine` `released-ok` policy |
| component (jsdom) | **+** menu (open, keyboard, activates own panel, splits own tab), header/content Split submenu, window dispatcher split mode (enter, pulse class, pending text, arrow held/released, Escape, other key, timeout, blur, re-press), terminal gets no stroke, sub-workspace dispatcher parity + unavailable notice, drag cancel teardown, outer-edge collision priority/corner rule, preview remount place (#459) |
| integration | layout with custom titles loads through the daemon path and migrates once |
| E2E (`@extended`) | `panel-split.e2e.ts` (menu + chord in a real terminal, 2x2 invariance, restart persistence), `outer-edge-drop.e2e.ts` (2x2 + fifth panel, left and bottom, restart, sub-workspace), `drag-ghost.e2e.ts` + Escape case, `split-mode.e2e.ts` (chord split in a real shell, and in a sub-workspace window) |

`tests/e2e/harness.ts:1209` `addPanels` (clicks **+** then commits a rename) becomes "click **+**, choose
Split Right"; `commitPanelRename`/`commitInlineRename` go. The ~30 specs that call `addPanels` keep working
through the helper. Specs that open menus or drive a drag join `parallel-plan.json` (tier rule). The budget
file is re-seeded in the commit that adds/removes specs.

## R11 — Documentation and governance

- `docs/key-bindings.md`: four split rows, a split-mode paragraph, drop the Rename panel row and F2's panel
  meaning (`:52,87`). `docs/quick-start.md`: **+** menu, Split submenu, split mode, outer-edge drops; drop
  `:56`'s rename sentence. `CHANGELOG.md` unreleased. `docs-currency.test.ts` enforces bindings.
- FR-045: a PATCH constitution amendment through `/speckit-constitution` — drop `panel.rename` from
  Principle IV's F2 exception, replace Rename / Reset Name as Principle VI's section-vocabulary examples, and
  record `panel.split*` as a window-scope multi-stroke chord whose first stroke is tier 1 (no new exception
  needed: it is outside the tiers as a multi-stroke chord and its first stroke is not reserved).
- FR-046: one-line italic back-notes in 002, 024, 031, 033, 043, 044, 046 at each superseded requirement.
- `specs/033-open-and-navigate/contracts/menu-sections.md`: lose panel Rename / Reset Name, gain Split.

## R12 — Iterate round 1: Blank Panel, open-route ownership, two sub-workspace defects (2026-09-30)

**Blank Panel (FR-127).** A panel's stored `title` is its automatic fallback, shown only when nothing it
holds names it (`panelDisplayTitle`). So the change is the generated fallback, not the display rule.
- Decision: `unique-name.ts` owns the generated name. `nextDefaultPanelName` returns "Blank Panel" when
  free, else "Blank Panel <n>" from n = 2, taking the lowest free number. `isDefaultPanelName` recognises
  both the new shape (`^blank panel( \d+)?$`) and the legacy `^panel \d+$`, so a generated name of either
  shape rejoins the sequence and never takes a "(2)" suffix.
- Every creation site takes the fallback from that one function, not from a `Panel ${count + 1}`
  template: `core/src/workspace/operations.ts` (`:122`, `:154`, `:174`, `:438`) and
  `ui/src/renderer/state/workspace-store.tsx` (`:446`, `:458`), with the names already in the layout
  as `taken`. The daemon's claim (`panel-name-service.ts`) keeps application-wide uniqueness, as now.
- Rejected: keeping per-layout counting (`count + 1`). It never produces "Blank Panel" without a number,
  and it duplicates the rule `unique-name.ts` already states.

**Migration (FR-128).** Decision: a new pure core function, `renameLegacyDefaultTitles`, placed beside
`dropCustomPanelTitles`, maps every legacy `^Panel \d+$` title to "Blank Panel", and the daemon's
startup reconcile (`panel-name-service.ts` `reconcile`, which already runs every layout and sub-workspace
through `dropCustomPanelTitles`) then makes them unique through `reconcilePanelNames`. Ids, tree shape,
kinds and configs are untouched. Idempotent: a second pass finds no `Panel N` title and returns the
document by identity. The workspace load path (`daemon/src/workspace-service.ts`, wherever it applies
`dropCustomPanelTitles`) applies the same function, so a window never shows a legacy title before
reconcile runs. Until reconcile runs, several panels can read "Blank Panel" at once. The same brief
state already exists today, when a new panel is named within its layout before the daemon's claim
renumbers it application-wide.

**Open-route ownership (FR-129).** Cause: `openFileInTab` (`editor/editor-open.tsx:157`) creates the
editor through `createDedicatedEditor` / `openFileInNewEditor` (`editor/open-into-panel.ts:137`), which
call `ws.addPanel(tabId)` with no `originProjectId`. In a sub-workspace window that makes the panel
sub-workspace-owned, and 006 FR-036 then refuses the project's file. The last-active-editor branch has the
same exposure when that editor is sub-workspace-owned.
- Decision: `openFileInTab` takes an optional `ownerProjectId`. When it is set, a created editor is added
  with that `originProjectId`, and an existing target editor is reused only when its owner is that
  project; otherwise a dedicated editor owned by that project is created. Quick Open passes the id of the
  project whose root it listed (`navigate/navigation-chrome.tsx:77-79` already resolves it). Other callers
  that run in a sub-workspace window (terminal and preview link routes, Find in Files results) pass the
  owning project of the panel they came from. In the main window the parameter is absent or equal to the
  layout's project, and behaviour is unchanged.

**Defect D1: the tab picker is dimmed (FR-091).** Cause: `subworkspace-app.tsx:149` mounts
`<TransientScrim/>` outside `.throng-root`. `.throng-root` is `position: fixed`, so it is its own
stacking context, and the scrim (z 1999) paints over the picker (z 2000 inside that context). Decision:
mount the scrim inside `.throng-root`, as the main window mounts it inside `.throng-shell`
(`app.tsx:533`).

**Defect D2: Quick Open is silent (FR-092, SC-012).** Cause: `window-dispatcher.tsx:666-668` ignores
`requestQuickOpen()` returning `false`, which it does when the active panel is sub-workspace-owned and so
has no project root. Decision: in a sub-workspace window a `false` raises the same "not available in a
sub-workspace window" notice through the dispatcher's existing path. The main window keeps 033 FR-018's
silent swallow when no project is open.
