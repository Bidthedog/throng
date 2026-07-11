# Contract: Commands, Default Chords & Theme Tokens

## New commands (`config/keybindings.ts`)

Added to the `ActionId` union and `DEFAULT_KEYBINDINGS`. All rebindable via the Key Bindings editor; the
zoom commands are **distinct** from the app-wide global `zoom.in`/`zoom.out`/`zoom.reset` (FR-014).

| ActionId | Default chord(s) | Routes to |
|---|---|---|
| `panel.zoomIn` | `Ctrl+Alt+=`, `Ctrl+Alt++` | `bumpZoom(layout, activeKind, +1)` |
| `panel.zoomOut` | `Ctrl+Alt+-` | `bumpZoom(layout, activeKind, -1)` |
| `panel.zoomReset` | `Ctrl+Alt+0` | `resetZoom(layout, activeKind)` |
| `focus.left` | `Ctrl+Alt+Left` | `moveFocus(root, activeId, 'left')` |
| `focus.right` | `Ctrl+Alt+Right` | `moveFocus(root, activeId, 'right')` |
| `focus.up` | `Ctrl+Alt+Up` | `moveFocus(root, activeId, 'up')` |
| `focus.down` | `Ctrl+Alt+Down` | `moveFocus(root, activeId, 'down')` |
| `focus.cycle` | ``Ctrl+` `` | `nextInCycle(cycleOrder(root), activeId, +1)` |
| `focus.cycleBack` | ``Ctrl+Shift+` `` | `nextInCycle(cycleOrder(root), activeId, -1)` |

## Metadata descriptors (`config/keybindings-metadata.ts`, hand-authored)

Each command gets `chord(actionId, 'Focus & Zoom', <label>, <description>)`. The keybindings completeness
test asserts every `ActionId` has exactly one descriptor — a missing one **fails the test** (v3.11.0).

## Theme tokens (`config/theme.ts` `THRONG_THEME.colours`, auto-exposed)

| Token | CSS var | Role |
|---|---|---|
| `activePanelBorder` | `--throng-colour-activePanelBorder` | active-panel indicator (window foreground) |
| `activePanelBorderInactive` | `--throng-colour-activePanelBorderInactive` | dimmed indicator (window background) |

- Auto-described by the **derived** `THEME_METADATA` and auto-emitted by `toCssVariables` → exposed in the
  Themes editor and covered by the theme completeness test with **no metadata edit** (FR-002).
- Consumed by `.panel-box--active` in `theme.css`: active token when the window is foreground, inactive
  token on window blur (via `use-window-focus.ts`).

## Assertions

1. Key Bindings editor lists all nine commands under **Focus & Zoom**, each rebindable (E2E, SC-007).
2. The nine defaults do not collide with the global `zoom.*` bindings (`Ctrl+=`/`-`/`0`) — different
   modifier family (`Ctrl+Alt+…`).
3. Themes editor shows both new colour tokens; editing one changes the indicator live (E2E, SC-001).
4. **No pointer action control** is added by this feature (FR-017 / v3.12.0): a review check confirms no new
   text-labelled or SVG control was introduced.
