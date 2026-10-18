# Manual test plan: title bar panel name, project list, natural sort

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Title bar names the active panel | signed off | f7ac5cf02164 | 2026-10-18 | |
| MT-02 | Natural sort in File Explorer | signed off | f7ac5cf02164 | 2026-10-18 | |
| MT-03 | Loaded projects in a minimised category | signed off | f7ac5cf02164 | 2026-10-18 | |
| MT-04 | Selected project row filled with its colour | signed off | f7ac5cf02164 | 2026-10-18 | |

## MT-01: Title bar names the active panel

Covers: #504
Paths: `packages/ui/src/renderer/app.tsx`, `packages/ui/src/renderer/workspace/use-panel-display-names.ts`, `packages/core/src/workspace/operations.ts`

### Steps
1. Open a project. Split the panel so a tab holds two panels, and open a file (say `notes.md`) in the second one from File Explorer. The title bar reads `<project> · <tab> · notes — throng`, the same name the panel header shows.
2. Hover the taskbar entry or press Alt+Tab. The window title reads the same.
3. In another panel, open a terminal and focus it. The title bar shows the terminal's name as its header shows it, and follows it when the shell changes its title (run `title hello` in cmd, or `$Host.UI.RawUI.WindowTitle = 'hello'` in PowerShell).
4. Click back into the editor panel. The title bar goes back to `notes`.

### Negative cases
- No step shows `Blank Panel 2` (or any numbered `Blank Panel N`) in the title bar or the taskbar.

## MT-02: Natural sort in File Explorer

Covers: #470
Paths: `packages/core/src/explorer/node.ts`, `packages/ui/src/renderer/explorer/use-explorer-data.ts`, `packages/core/src/config/settings-metadata.ts`, `packages/core/src/config/app-settings.ts`

### Steps
1. In a project folder, create files `test 1.md`, `test 2.md`, `test 3.md`, `test 9.md`, `test 10.md`, `test 11.md`, `test 19.md`, `test 20.md`, `test 21.md`. File Explorer lists them 1, 2, 3, 9, 10, 11, 19, 20, 21.
2. Expand a sub-folder too. Open Preferences → Settings → File Explorer. *Sort names* reads **Numbers by value (1, 2, … 10)**.
3. Switch it to **Character by character (1, 10, 2)**. Without closing Preferences, both open folders re-sort at once to 1, 10, 11, 19, 2, 20, 21, 3, 9, and stay expanded.
4. Switch it back. The order returns to 1, 2, 3 … 21.
5. Restart throng. The setting and the order are kept.

### Negative cases
- Folders still list before files in both orders, and mixed-case names (`apple`, `Zed`) still sort A–Z ignoring case.
- Changing the setting does not collapse folders or lose the selection.

## MT-03: Loaded projects in a minimised category

Covers: #489
Paths: `packages/core/src/projects/project-list.ts`, `packages/ui/src/renderer/sidebar/projects-panel.tsx`, `packages/ui/src/renderer/workspace/side-pane-actions.ts`

### Steps
1. Put three projects A, B and C in a category other than In Progress. Click A, then B (both are now loaded), then a project in In Progress.
2. Minimise the category. Its header now looks minimised — a dashed line under it, its name italic and muted — and its count reads **2 of 3**; hovering the count reads "2 shown, 1 hidden". A and B stay listed under it in their usual order; C is hidden.
3. Click A under the minimised header. It switches as usual, and B stays listed.
4. Press Next Project / Previous Project (Ctrl+Shift+Alt+PageDown / PageUp) from the In Progress project. They step into A and B, and skip C.
5. Right-click B → **Unload**. B's row disappears under the minimised header.
6. Expand the category, click C, minimise it again. C now stays listed, and with nothing hidden the count reads plain **3** while the header keeps its minimised look.
7. Expand it. The dashed line and italic name go, and the count reads **3**.

### Negative cases
- In Progress still cannot be minimised; minimise/expand still works by click and with Enter on the header; the minimised state survives a restart.

## MT-04: Selected project row filled with its colour

Covers: #489
Paths: `packages/ui/src/renderer/theme.css`, `packages/ui/src/renderer/sidebar/projects-panel.tsx`, `packages/core/src/config/theme-quality.ts`

### Steps
1. Select a project. Its whole row, edge to edge, is filled with the project's colour, and it reads clearly differently from the category header rows.
2. Edit a project's colour to a very light one (e.g. `#f5f5dc`) and select it. Its name, path, counts, loaded dot and Edit/Remove icons are drawn in black and easy to read.
3. Edit it to a very dark one (e.g. `#101018`). They switch to white and stay readable.
4. Hover the selected row. The grip and Edit/Remove controls show in the same readable colour.
5. Switch theme (light and dark built-ins). The selected row keeps the project colour; headers keep the theme's header background.

### Negative cases
- Unselected rows are unchanged: no fill, only their colour dot.
- The small colour dot on the selected row is still visible against the fill (it has an outline).
