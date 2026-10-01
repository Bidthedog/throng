# Data Model: 048

## Panel (`core/workspace/model.ts`)

| Field | Change |
|---|---|
| `id` | unchanged; never rewritten by the migration (FR-034) |
| `title` | unchanged meaning: the automatic fallback title ("Blank Panel", "Blank Panel 2", … kept unique internally — FR-127; always SHOWN as "Blank Panel" — FR-130; legacy "Panel N" retires on load, FR-128), retitled only by automatic naming |
| `titleIsCustom?` | **removed** |
| `defaultTitle?` | **removed** |
| `zoom?` | unchanged; a split's new panel has none (default zoom) |
| all others | unchanged |

**Migration `dropCustomPanelTitles(layout)`** — pure, idempotent, applied on load of every persisted layout
(main window, sub-workspace, tear-off):

```
for each panel p in every tab of the layout:
  if p.titleIsCustom: p.title := p.defaultTitle ?? p.title
  delete p.titleIsCustom; delete p.defaultTitle
```

Nothing else is read or written. `LAYOUT_SCHEMA_VERSION` is unchanged (both fields were optional in every
release, so a layout written by 048 loads in an earlier one).

**Displayed title**: `resolveTitle` (`core/workspace/panel-title.ts`) loses its custom-title branch. Order
is otherwise unchanged: terminal live title → flavour label → panel title; editor file name → panel title;
preview parts; uniqueness and the length limit (031 FR-037) as today.

## Layout tree operations (`core/workspace/operations.ts`)

| Operation | Input | Result |
|---|---|---|
| `splitPanel` (NEW) | layout, tabId, targetPanelId, direction `down｜up｜right｜left`, title | target leaf → 2-child split (column for down/up, row for right/left), new placeholder on the named side, sizes `[0.5, 0.5]`; tab `activePanelId` = new panel. Unknown tab/panel → layout unchanged |
| `movePanelToOuterEdge` (NEW) | layout, panelId, tabId, edge `left｜right｜top｜bottom` | panel removed from its position (collapse rules), then placed along the whole edge at 1/3: joins a root split of the matching axis as first/last child (others ×2/3), else wraps the root `[1/3, 2/3]`. **No-op** when it is already the first/last child of a matching-axis root. Source tab emptied → dropped by `finalize` |
| `renamePanel`, `resetPanelName` | — | **removed** |
| `dropCustomPanelTitles` (NEW) | layout | see migration |
| `addPanel` | — | unchanged (still used by Open In / explorer paths); the **+** button no longer calls it |

Axis mapping: left/right ↔ `row`; top/bottom ↔ `column`. Left/top put the new member first.

## Keybinding actions (`core/config/keybindings.ts`)

| Action | Scope | Windows default | Metadata group |
|---|---|---|---|
| `panel.splitDown` | `EVERYWHERE` | `Ctrl+Shift+Alt+End,ArrowDown` | panel commands (the group holding panel zoom) |
| `panel.splitUp` | `EVERYWHERE` | `Ctrl+Shift+Alt+End,ArrowUp` | panel commands (the group holding panel zoom) |
| `panel.splitRight` | `EVERYWHERE` | `Ctrl+Shift+Alt+End,ArrowRight` | panel commands (the group holding panel zoom) |
| `panel.splitLeft` | `EVERYWHERE` | `Ctrl+Shift+Alt+End,ArrowLeft` | panel commands (the group holding panel zoom) |
| `panel.rename` | — | **removed** | — |

*(The group follows the existing metadata group that holds panel zoom; the implementer uses whichever
group `keybindings-metadata.ts` gives panel-level commands.)*

**Validation**: a multi-stroke token is refused on a terminal-live command only when its **first stroke**
is in Principle IV's reserved tier (`twoStrokeTerminalViolations`, `parseKeybindings`).

## Split mode (renderer, transient)

```
Idle ──first stroke (Ctrl+Shift+Alt+End) on active panel P──▶ Pending(P)
Pending(P) ──first stroke again──▶ Pending(P) (timeout re-armed)
Pending(P) ──Arrow (any held first-stroke modifiers ignored)──▶ split(P, dir) ▶ Idle
Pending(P) ──Escape──▶ Idle (consumed; focus on P)
Pending(P) ──other key──▶ Unbound notice ▶ Idle (focus on P)
Pending(P) ──timeout 4000 ms｜window blur｜active panel changes｜menu opens｜drag starts──▶ Idle
```

Visible while `Pending(P)`: `panel-box__split-mode` pulse on P; the pending text on P when P's kind has a
shown status bar.

## Chord indicator (renderer, transient)

`ChordIndicator.kind` gains `'unavailable'` — a window-level chord whose command has nothing to act on in a
sub-workspace window; text "*Label* is not available in a sub-workspace window."; lifetime
`UNBOUND_NOTICE_MS`.

## Window capabilities (renderer)

`{ kind: 'main' | 'sub-workspace'; has(action: ActionId): boolean }` — the one place a window-specific
difference in chord handling is expressed (FR-091).

## Drag state (renderer, `tab-group.tsx`)

New droppable ids `outer|left｜right｜top｜bottom` (`drag-state.ts`). `reset()` is the single teardown for
drop, cancel and unmount.
