# Contract: Menus and the Rename

Covers FR-001 – FR-004, FR-019, FR-030, FR-031, FR-053 and FR-061. The reasoning is in
[research.md](../research.md) R11 and R12.

Every menu below is built as `MenuAction[]` for the shared `ContextMenu`
(`packages/ui/src/renderer/workspace/context-menu.tsx`). Each item sets `section` (a required field),
`icon` (a theme token) and `testId`. Dividers are derived by `groupBySection`, never written by hand.

## 1. Project row menu (`packages/ui/src/renderer/sidebar/project-menu.ts`, new)

| Section | Item | Icon | Behaviour |
|---|---|---|---|
| content | Edit | `editVisual` | Opens the same create/edit form as the inline ✎ (`projects-panel.tsx:396-441`) |
| content | Rename | `rename` | Starts the same inline rename as a double-click (`:499`, 002 FR-041) |
| destroy | Remove | `destroy` | Runs `confirmDelete`, with its unsaved guard and confirmation levels (`:233-272`) |
| viewState | Move to Category ▸ | `category` | Submenu: every category other than the project's own, then **New Category…** (`add`) |
| viewState | Unload | `unload` | [unload.md](./unload.md). Drawn but disabled when the project is not loaded |
| viewState | Unload and Keep Terminals Running | `unload` | the same, with a variant |
| viewState | Unload and End Terminals | `unload` | the same, with a variant |

- **Opened by** right-click on the row, or by Shift+F10 or the ContextMenu key on a focused row
  (through the `menu.open` redirect in `app.tsx:510-546`).
- **Escape** closes the menu and restores focus to the row (`closeAndRestore`).
- **The inline ✎ and ✕ controls stay** (FR-031).

## 2. Category header menu (`packages/ui/src/renderer/sidebar/category-menu.ts`, new)

| Section | Item | Non-default | Default |
|---|---|---|---|
| content | Rename Category (`rename`) | yes | yes (FR-050) |
| destroy | Delete Category (`destroy`) | yes | **not drawn** |
| viewState | Minimise Category, a checkable toggle (`collapse` / `expand`) | yes | **not drawn** |

Items for the default category are *absent*, not disabled, because no state of the application could
enable them (Principle VI). A category header menu for the default category is therefore a
single-section menu with no divider.

## 3. Cog menu (`packages/ui/src/renderer/title-bar/cog-menu-items.ts`)

The **navigate** section is added before the existing **application** section, and the menu gains
its first divider.

| Item | Icon | `shortcut` | Disabled when |
|---|---|---|---|
| Next Project | `moveDown` | the live chords for `project.next` | `stepProject(..., +1) === null` |
| Previous Project | `moveUp` | the live chords for `project.previous` | `stepProject(..., -1) === null` |
| Focus File Explorer | `folder` | the live chords for `focus.explorer` | never |
| Focus Projects | `projectList` | the live chords for `focus.projects` | never |

Each item dispatches through the same handler the chord uses, so there is one code path per command.

**Section pins**: `packages/ui/tests/unit/menu-sections.test.ts` gains `shapeOf` for the project menu,
both category menus, and the cog's new `[navigate, application]` shape.

## 4. New icon tokens

`unload`, `category` and `projectList`. Each one needs:

- a `THRONG_THEME.icons` glyph (`packages/core/src/config/theme.ts`);
- a label and description in `packages/core/src/config/theme-copy.ts`;
- an `SVG_SHAPES` entry (`packages/ui/src/main/icon-pack-service.ts:87`).

`SHIPPED_DEFAULTS_VERSION` moves from **11 to 12**. The `theme-copy`, `icon-tokens-exist` and
`menu-icon-tokens` tests go red first. No new colour token is added.

## 5. The rename (FR-001 – FR-004)

- **Copy only.** Every "Files & Folders", "Files &amp; Folders" and "Files and Folders" under
  `packages/*/src`, `README.md`, `CONTRIBUTING.md` and `docs/` becomes **File Explorer**, including
  in comments.
- **Surfaces a user reads**:
  - the pane header (`panes/file-explorer-pane.tsx:62`);
  - the rail and its Show/Hide tooltip (`app.tsx:1003,1012`);
  - *Reveal File in File Explorer* (`workspace/panel-header-menu.ts`);
  - the empty-editor placeholder (`panel-type/editor-inputs.tsx:17`);
  - the setting descriptions (`settings-metadata.ts:202,395`, `app-settings.ts:422`,
    `preview-settings.ts:196`);
  - the keybinding descriptions (`keybindings-metadata.ts:102,152`);
  - the theme copy (`theme-copy.ts:128,366`).
- **Guard**: `packages/ui/tests/unit/file-explorer-name.test.ts` scans those trees for the three
  spellings and fails on any match. It excludes `specs/`, the constitution and `CHANGELOG.md`
  (FR-004).
- **Identifiers are unchanged**: setting keys, command ids, CSS classes, `data-testid`s and
  persisted values (FR-003). A config directory from the previous build loads with no migration.

## 6. Iterate round 1 (checkpoint 2026-09-24; spec FR-074, FR-081, FR-083, FR-107)

**§1, project menu — two Unload rows (FR-081).**

| Preference `projects.unloadTerminalAction` | Row 1 | Row 2 |
|---|---|---|
| `keepRunning` (default) | **Unload Project** (keep) | **Unload Project and End Terminals** |
| `endTerminals` | **Unload Project** (end) | **Unload Project and Keep Terminals Running** |

Both rows sit in viewState, carry the `unload` icon, follow the preference on the next open, and
are drawn disabled on an unloaded project (FR-038). Neither row opens a dialog (FR-111).

**§2, category header menu (FR-083).** A non-default header's menu gains **Move Category Up** and
**Move Category Down** in a `navigate` section; Up is disabled on the first non-default category,
Down on the last. Neither is drawn on the default category's menu.

**§3, cog menu (FR-074, FR-107).** ~~The `navigate` section and its four items are removed. The menu
is `[viewState, application]`: a **Zoom** row in viewState with three themeable icon controls —
**Zoom Out**, **Reset Zoom**, **Zoom In** — dispatching `zoom.out` / `zoom.reset` / `zoom.in`
through the chord's own handler. Each has a hover title naming it and its live chord; the menu stays
open after a Zoom control; Left / Right move between the three and Enter / Space activate;
Zoom In is disabled at the maximum, Zoom Out at the minimum, Reset Zoom at 100%. The row MAY show
the current percentage. `menu-sections.test.ts` pins the `[viewState, application]` shape.
Whether a multi-control row is new to the shared `ContextMenu` is settled at implementation; if it
is, the row is added to `context-menu.tsx` as a generic item kind rather than a cog-only special
case.~~

*Superseded (Session 2026-09-25, FR-113): the maintainer's instruction, verbatim, "Remove the new
"Zoom" options from the menu." The `navigate` section and its four items are still removed
(FR-074), but no Zoom row is added. The cog menu is `[application]` only — the single Application
section, the 2026-09-09 audit shape. `menu-sections.test.ts` pins `[application]`, not
`[viewState, application]`. The window zoom's only routes are its keyboard chords: `zoom.in`
**Ctrl+Shift+Alt++**, `zoom.out` **Ctrl+Shift+Alt+-**, `zoom.reset` **Ctrl+Shift+Alt+Numpad0**
(FR-114). There is no mouse or menu route to the window zoom.*
