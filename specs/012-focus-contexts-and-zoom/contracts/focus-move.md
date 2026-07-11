# Contract: Move-Focus Geometry (`@throng/core` `workspace/focus-move.ts`)

Pure, deterministic, DOM-free. Given a Tab's split tree and the active panel id, compute directional and
cyclic focus targets.

## Surface

| Function | Signature | Behaviour |
|---|---|---|
| `panelRects` | `(root: LayoutNode) => Map<string, Rect>` | normalized `[0,1]²` rect per Panel; `row` split divides **x** by `sizes`, `column` split divides **y** |
| `moveFocus` | `(root, activeId, dir: Direction) => string \| null` | nearest Panel on the `dir` side overlapping the active on the perpendicular axis; `null` at the edge |
| `cycleOrder` | `(root: LayoutNode) => string[]` | in-order DFS leaf sequence = stable **layout order** |
| `nextInCycle` | `(order, activeId, step: 1\|-1) => string` | next/prev id in the ordered ring |

`Rect = { x, y, w, h }` (normalized). `Direction = 'left' | 'right' | 'up' | 'down'`.

## Behavioural assertions (unit)

1. **Partition**: for a single-panel tree, `panelRects` = `{id: {0,0,1,1}}`. For a 2-col `row` split with
   `sizes [0.5,0.5]`, the left panel is `{0,0,0.5,1}`, the right `{0.5,0,0.5,1}`.
2. **Directional hit**: in a 2-col row split, `moveFocus(root, left, 'right') === rightId`; `moveFocus(root,
   right, 'left') === leftId`.
3. **Stay-put at edge (FR-015/US3-2)**: `moveFocus(root, right, 'right') === null`; `moveFocus(root, left,
   'up') === null`. Caller keeps the current active panel — no wrap, no error.
4. **Perpendicular overlap**: in a nested layout, a directional move selects the neighbour that actually
   overlaps the active on the cross axis, not merely any panel on that side.
5. **Cycle order stable (SC-008a)**: `cycleOrder` is independent of `activePanelId`/focus history; for a
   row(A, column(B,C)) tree it is `[A,B,C]`. `nextInCycle(order, C, 1)` wraps to `A`; `nextInCycle(order, A,
   -1)` wraps to `C`; forward then the same count backward returns to the start.
6. Deterministic: same tree → same result across runs (no `Date`/random).

## Renderer use (effect, not part of the pure contract)

- Commands `focus.left/right/up/down` → `moveFocus(activeTab.root, activeId, dir)`; if non-null,
  `setActivePanel(layout, activeTabId, result)`; if `null`, no change (stay put).
- Commands `focus.cycle`/`focus.cycleBack` → `nextInCycle(cycleOrder(activeTab.root), activeId, ±1)` →
  `setActivePanel`.
- **Scope**: the active Tab's workspace split tree only (not the sidebar/File-Explorer pane) — see plan D4.
