# Contract: menus, commands and controls for 048

Section vocabulary is `packages/core/src/workspace/menu-sections.ts`. Every item is a `MenuAction` with a
required `section`; chords come from the command's current binding.

## The Split item (shared builder `workspace/split-menu.ts`)

| Item | Section | Children, in order | Action |
|---|---|---|---|
| Split | **create** | Split Down, Split Up, Split Right, Split Left — each showing its chord | `panel.splitDown` / `Up` / `Right` / `Left` on the menu's panel |

Placed in: the panel header menu (`workspace/panel-header-menu.ts`); the content menus of the editor
(`editor/content-menu.ts`), terminal (`terminal/terminal-content-menu.ts`), preview
(`preview/content-menu.ts`), Find in Files (`find-in-files/content-menu.ts`); and the untyped placeholder's
new content menu (`workspace/panel-body.tsx`), where it is the only item (so no divider).

## Removed rows

| Menu | Row | Was section |
|---|---|---|
| Panel header menu | Rename | content |
| Panel header menu | Reset Name | viewState |

`specs/033-open-and-navigate/contracts/menu-sections.md` is updated to match (FR-016, FR-043).

## The panel **+** button (`workspace/panel-placeholder.tsx`)

`IconButton` token `add`, title **"Split panel…"**, `aria-haspopup="menu"`, testid `panel-add-<id>`
(kept). Click / Enter / Space: make its own panel active (its own `tabId`), then open the split menu
anchored to the button, listing the four split items (no parent "Split" row). Dismiss (Escape, outside
click, a drag starting) changes nothing.

## Commands

| Id | Label | Default | Scope | Menu |
|---|---|---|---|---|
| `panel.splitDown` | Split Down | `Ctrl+Shift+Alt+End,ArrowDown` | any panel | Split submenu, **+** menu |
| `panel.splitUp` | Split Up | `Ctrl+Shift+Alt+End,ArrowUp` | any panel | same |
| `panel.splitRight` | Split Right | `Ctrl+Shift+Alt+End,ArrowRight` | any panel | same |
| `panel.splitLeft` | Split Left | `Ctrl+Shift+Alt+End,ArrowLeft` | any panel | same |
| `panel.rename` | — | removed | — | — |

Dispatched by the window dispatcher to the active panel (FR-003). From a menu, to the menu's panel.

## Split mode indication

- Pulse: `.panel-box__split-mode` overlay, `var(--accent)` border, opacity animation; reduced motion → a
  steady border.
- Text (panels with a shown status bar): `(Ctrl+Shift+Alt+End) was pressed. Waiting for the next key of the
  chord…` — the 046 `PendingChord` overlay.
- Unbound second key: `The key combination (Ctrl+Shift+Alt+End,X) is not bound.`

## Sub-workspace unavailable indication

`<Command label> is not available in a sub-workspace window.` — same overlay, `UNBOUND_NOTICE_MS`.

## Outer-edge drop zones (`workspace/outer-edge-zones.tsx`)

| Element | When | Test id |
|---|---|---|
| Band ×4 (`outer\|left` …) | a panel drag is in progress and the tab has ≥ 2 panels | `outer-edge-<edge>` |
| Preview | a band is under the pointer | `outer-edge-preview-<edge>` |

Band width 16px (`--outer-edge-band`). A band wins over any panel edge zone beneath it; at a corner,
**left/right win over top/bottom**. The preview covers the full edge at one third of the area and is
visibly distinct from `.edge-zone--over` (dashed outline).
