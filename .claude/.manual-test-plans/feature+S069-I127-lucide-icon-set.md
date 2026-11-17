# Manual test plan: one default icon set and user icon sets (spec 069)

Spec: `specs/069-lucide-icon-set/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Icon mapping review page | signed off | 4e0952c993c6 | 2026-11-16 | |
| MT-02 | Icons in the File Explorer | needs retest | 4e0952c993c6 | 2026-11-16 | e672c636 touched packages/ui/src/renderer/explorer/drag-action-label.tsx |
| MT-03 | Icons on panels, tabs and panes | needs retest | 4e0952c993c6 | 2026-11-16 | fc68b332 touched packages/ui/src/renderer/panes/focus-mode-panes.tsx |
| MT-04 | Icons on the window controls and title bar | signed off | 4e0952c993c6 | 2026-11-16 | |
| MT-05 | Icons in context menus | signed off | 4e0952c993c6 | 2026-11-16 | |
| MT-06 | Icons in Find and Find in Files | signed off | 4e0952c993c6 | 2026-11-16 | |
| MT-07 | Icons in Preferences | needs retest | 4e0952c993c6 | 2026-11-16 | 1213c42a touched packages/ui/src/renderer/preferences/preferences-app.tsx |
| MT-08 | Icons in the Resource Monitor | needs retest | 3858e6604516 | 2026-11-16 | e672c636 touched packages/ui/src/renderer/resources/help-panel.tsx |
| MT-09 | Icons in editors, previews and diagrams | needs retest | 586d05c607b0 | 2026-11-16 | e672c636 touched packages/ui/src/renderer/editor/editor.css |
| MT-10 | Icons in notifications | needs retest | 586d05c607b0 | 2026-11-16 | e672c636 touched packages/ui/src/renderer/notifications/place-popover.tsx |
| MT-11 | The read-only icon grid | needs retest | 586d05c607b0 | 2026-11-16 | d637e3a0 touched packages/core/src/icons/icon-keys.ts |
| MT-12 | Create a set and override icons | needs retest | 586d05c607b0 | 2026-11-16 | d637e3a0 touched packages/ui/src/renderer/preferences/icon-section.tsx |
| MT-13 | Upgrade from an alpha16 configuration | needs retest | 586d05c607b0 | 2026-11-16 | d637e3a0 touched FR-037 in specs/069-lucide-icon-set/spec.md |
| MT-14 | Lucide licence and the icon sets README | needs retest | 586d05c607b0 | 2026-11-16 | d637e3a0 touched packages/core/src/icons/icon-sets-README.txt |
| MT-15 | Rename, delete and reset in Preferences | needs retest | 586d05c607b0 | 2026-11-16 | d637e3a0 touched packages/ui/src/renderer/preferences/icon-section.tsx |
| MT-16 | The Icon set row: order, toasts and the asterisk | needs retest | 586d05c607b0 | 2026-11-16 | d637e3a0 touched packages/ui/src/renderer/preferences/icon-section.tsx |
| MT-17 | The Preferences window: maximise, and folders above it | signed off | 586d05c607b0 | 2026-11-16 | |
| MT-18 | Themes tab: every action always shown, greyed when unusable | needs retest | 586d05c607b0 | 2026-11-16 | d637e3a0 touched packages/ui/src/renderer/preferences/icon-section.tsx |
| MT-19 | Toast controls: placement, spacing and hover | needs retest | 586d05c607b0 | 2026-11-16 | 95240bf6 touched packages/ui/src/renderer/common/command-line-notice.tsx |
| MT-20 | Notification hover delay | needs retest | 586d05c607b0 | 2026-11-16 | 95240bf6 touched packages/core/src/config/settings-metadata.ts |
| MT-21 | The project settings dialog | needs retest | 586d05c607b0 | 2026-11-16 | d637e3a0 touched packages/ui/src/renderer/preferences/settings-tab.tsx |
| MT-22 | One look for the secondary windows | needs retest | 586d05c607b0 | 2026-11-16 | 95240bf6 touched packages/ui/src/renderer/theme.css |
| MT-23 | The File Explorer's Delete as a rubbish bin | needs retest | 586d05c607b0 | 2026-11-16 | d637e3a0 touched packages/core/src/icons/icon-keys.ts |
| MT-24 | File and folder kinds in the tree | signed off | 586d05c607b0 | 2026-11-16 | |
| MT-25 | Language file icons | signed off | 586d05c607b0 | 2026-11-16 | |
| MT-26 | The Markdown mark | signed off | 586d05c607b0 | 2026-11-16 | |
| MT-27 | File Explorer row popover | needs retest | 586d05c607b0 | 2026-11-16 | 95240bf6 touched packages/core/src/config/settings-metadata.ts |
| MT-28 | Title bars apart from their windows | needs retest | 586d05c607b0 | 2026-11-16 | d637e3a0 touched packages/core/src/config/theme.ts |
| MT-29 | File icons coloured by category | needs retest | 586d05c607b0 | 2026-11-16 | 95240bf6 touched packages/ui/src/renderer/theme.css |
| MT-30 | Resource Monitor "?" helpers | needs retest | 4e0952c993c6 | 2026-11-16 | e672c636 touched packages/ui/src/renderer/resources/info-helper.tsx |
| MT-31 | Icon set and Icon colour row actions | untested | | | |
| MT-32 | The unknown file's own colour | untested | | | |
| MT-33 | Panel type icon first in the header | untested | | | |
| MT-34 | A diagram's Focus Mode | untested | | | |
| MT-35 | The File Manager category | untested | | | |
| MT-36 | Settings grouped under General, Editor and Search | untested | | | |
| MT-37 | About: the licence box's pointer, and Lucide's row | untested | | | |
| MT-38 | File icon colours change with the theme | untested | | | |

## MT-01: Icon mapping review page

Covers: FR-031, SC-003, FR-008, FR-009
Paths: `packages/core/src/icons/default-set/**`, `specs/069-lucide-icon-set/review/drafts/**`

### Steps
1. Open https://claude.ai/artifact/U2vMxfLyfnqe3jPx71jQWs. Every one of the 112 keys has a row with its art at 12, 16 and 24 px on a light and a dark background.
2. Read the "Pairs that must look different" strip. Every pair and family (Save/Save As, Zoom In/Out/Reset, Undo/Redo and the rest) is told apart at a glance at 16 px.
3. Read every row's art against "What it stands for". Each icon reads as that action or object.
4. Check the three drawn for throng (`saveAs`, `zoomReset`, `diagramZoomReset`). Each sits with the Lucide art around it in weight and style.

### Negative cases
- No two different actions share one icon; only the close group and the expand group share, as the Origin column says.
- No icon reads as a different action from the one its row names.

## MT-02: Icons in the File Explorer

Covers: FR-001, FR-005, FR-006, FR-007, US1
Paths: `packages/core/src/icons/default-set/**`, `packages/ui/src/renderer/explorer/**`

### Steps
1. Start throng on a fresh config root (`THRONG_CONFIG_ROOT` set to an empty folder) and open a project with folders, Markdown, JSON, image, code and text files, and a symlink.
2. Look at the tree at the default size. Closed and open folders, the twisty, each file type and the symlink badge are distinct line icons, crisp at 16 px.
3. Hover each File Explorer toolbar control (Expand All, Collapse All, New Folder, Quick Open, Find in Files, Project Settings). Each shows a line icon and a hover title naming its action.
4. Switch to the Light theme, then back to a dark one. Every icon follows the theme's colour.

### Negative cases
- No icon shows as a text character, a box, or a missing gap.
- No icon renders black on a dark theme.

## MT-03: Icons on panels, tabs and panes

Covers: FR-001, FR-007, FR-010, FR-040, US1
Paths: `packages/core/src/icons/default-set/**`, `packages/ui/src/renderer/workspace/**`, `packages/ui/src/renderer/sidebar/**`, `packages/ui/src/renderer/panes/**`, `packages/ui/src/renderer/common/rotated-icon.tsx`

### Steps
1. Open a terminal panel and an editor panel. Each header's type icon, Save, Maximise, Detach and Close are line icons with hover titles.
2. Fill the tab strip until it overflows. The left, right and list chevrons at its ends are line icons.
3. In the Projects pane, hover a project. The drag handle, edit (rename) and remove controls are icons, not characters, each with a hover title.
4. In the Sub-workspaces pane, check the same handle, rename, open and remove controls.
5. Close every panel in a tab. The placeholder's controls are icons.
6. Look at the Projects pane's hide button: an arrow points left into a line at the left edge. Hide the pane; the rail's show button is an arrow pointing right away from that line.
7. Do the same on the File Explorer pane: the hide arrow points right into a line at the right edge, and the show arrow points left away from it.
8. Minimise the Sub-workspaces and Notifications panels: the arrow points down into a line, and while minimised it points up away from it. The Minimise and Restore menu items show the same icons.

### Negative cases
- No grip shows as `⋮⋮`, no edit as `✎`, no remove as `✕` text.
- No pane or panel collapse control shows a plain chevron.

## MT-04: Icons on the window controls and title bar

Covers: FR-001, FR-007, US1
Paths: `packages/core/src/icons/default-set/**`, `packages/ui/src/renderer/title-bar/**`, `packages/ui/src/renderer/statusbar/**`

### Steps
1. Look at the title bar. The cog and the Minimise, Maximise and Close controls are line icons.
2. Maximise the window. The Maximise control becomes Restore, with a different icon.
3. Open the cog menu. Each row's icon matches its row (Key Bindings, Themes, About, Resource Monitor).
4. Look at the status bar: the daemon indicator and the resource figures each carry a line icon.

### Negative cases
- Maximise and Restore never show the same icon.

## MT-05: Icons in context menus

Covers: FR-001, FR-007, FR-010, US1
Paths: `packages/core/src/icons/default-set/**`, `packages/ui/src/renderer/workspace/context-menu.tsx`, `packages/ui/src/renderer/editor/content-menu.ts`, `packages/ui/src/renderer/preview/content-menu.ts`, `packages/ui/src/renderer/sidebar/category-menu.ts`, `packages/ui/src/renderer/notifications/notifications-menu.ts`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`

### Steps
1. Right-click in an editor. Cut, Copy, Paste, Select All, Undo, Redo and Language rows each carry an icon.
2. Turn Word Wrap on from that menu, then reopen it. The Word Wrap row shows a check mark after its label.
3. Right-click a project and open Move to Category. The current category's row shows the check mark.
4. Right-click a panel header. Zoom In, Zoom Out and Zoom Reset rows show three different icons; Zoom Reset is a magnifier with a reset arrow.
5. Right-click a tree entry. Hide, Copy, Cut and Paste rows each carry an icon.

### Negative cases
- No menu row starts with a `✓` character.
- An option that is off shows no check mark.

## MT-06: Icons in Find and Find in Files

Covers: FR-001, FR-007, FR-009, US1
Paths: `packages/core/src/icons/default-set/**`, `packages/ui/src/renderer/search/**`, `packages/ui/src/renderer/find-in-files/**`

### Steps
1. Open the find bar in an editor. Find Next and Find Previous show different icons; Match Case, Whole Word, Replace and Replace All each have their own.
2. Open Find in Files and run a search. The busy icon turns while it runs, and the scope, exclusion and folder-tree controls each carry an icon.

### Negative cases
- Find Next and Find Previous never look like Move Up and Move Down.

## MT-07: Icons in Preferences

Covers: FR-001, FR-007, US1
Paths: `packages/core/src/icons/default-set/**`, `packages/ui/src/renderer/preferences/**`

### Steps
1. Open Preferences. The toolbar's Expand All, Collapse All, Edit JSON and Revert controls are line icons with hover titles.
2. Change a setting. Its row's reset control is an icon.
3. Make a setting invalid, then fold its section. The section heading shows the warning icon.

### Negative cases
- Edit JSON and Edit Visual never look alike.

## MT-08: Icons in the Resource Monitor

Covers: FR-001, FR-007, US1
Paths: `packages/core/src/icons/default-set/**`, `packages/ui/src/renderer/resources/**`

### Steps
1. Open the Resource Monitor. The CPU, Memory, GPU, I/O and Network choices, Hide Idle, Hide Ended and Help each carry a distinct icon.
2. Hover a process row. End Process, End Process Tree and Go To each carry an icon with a hover title.

### Negative cases
- End Process and End Process Tree never show the same icon.

## MT-09: Icons in editors, previews and diagrams

Covers: FR-001, FR-007, FR-009, US1
Paths: `packages/core/src/icons/default-set/**`, `packages/ui/src/renderer/editor/**`, `packages/ui/src/renderer/preview/**`

### Steps
1. Open a Markdown file with headings and a mermaid diagram. The fold gutter's expanded and collapsed markers are line icons.
2. Open its preview. Back, Forward, Synchronise Scrolling and Refresh carry icons; the preview's fold triangles are icons.
3. On the diagram, Fit, Zoom 100% and Maximise carry three different icons.
4. On the editor status bar, the Whitespace and Preview toggles carry icons.

### Negative cases
- Back and Forward never point the same way.

## MT-10: Icons in notifications

Covers: FR-001, FR-007, US1
Paths: `packages/core/src/icons/default-set/**`, `packages/ui/src/renderer/notifications/**`, `packages/core/src/notice/entry-look.ts`

### Steps
1. Cause an error notice (open a file that no longer exists) and an information notice. Each entry's top-left icon matches its severity.
2. Open the Notifications panel. Dismiss All and Sort Order carry icons.

### Negative cases
- Error, attention, information and success entries never share an icon.

## MT-11: The read-only icon grid

Covers: FR-012, FR-024, FR-027, US2
Paths: `packages/ui/src/renderer/preferences/icon-section.tsx`, `packages/ui/src/renderer/preferences/themes-tab.tsx`, `packages/core/src/icons/icon-keys.ts`

### Steps
1. Open Preferences → Themes → Icons with the default set selected. Every row shows the icon, its key, `<key>.svg` and no status; hovering a row shows its description.
2. Beside the picker: New set from this set, Open folder and Reload the icon sets from disk, and no Rename or Delete. Open folder opens the `icon-packs` folder itself.
3. Type `save` into the Themes tab's search box. The icon grid narrows to the save rows.

### Negative cases
- No row offers a text box or a way to type a glyph.
- Override this icon and Reset this icon to the default are not offered on any row of the default set.

## MT-12: Create a set and override icons

Covers: FR-015, FR-016, FR-024, FR-025, FR-026, FR-028, FR-029, FR-030, FR-032, FR-033, US4
Paths: `packages/ui/src/renderer/preferences/icon-section.tsx`, `packages/ui/src/renderer/preferences/name-dialog.tsx`, `packages/ui/src/main/icon-set-service.ts`, `packages/ui/src/main/icon-sets-ipc.ts`, `packages/core/src/icons/resolve-icon.ts`, `packages/core/src/icons/icon-set-name.ts`

### Steps
1. In Preferences → Themes → Icons, press New set from this set and name it `mine`. The picker shows `mine *`, every row reads Default, and Rename and Delete appear to the left of the other controls.
2. Press Override this icon on `save`. The row reads Overridden.
3. Press Open folder. The file manager opens `mine`, holding `save.svg`.
4. Replace `save.svg` with any other SVG drawn in `currentColor`, then press Reload the icon sets from disk. The editor title bar's Save icon changes at once, in the theme's colour.
5. Press Override this icon on `save` again. throng asks before replacing it; choose Cancel. Your file is unchanged.
6. Copy a file named `copy.svg` straight into the folder, then press Override this icon on any other row and choose Cancel if asked. The `copy` row reads Overridden and the menus' Copy icon changes: any icon-set control reads the folders again.
7. With `mine` selected, press New set from this set and name it `mine2`. Its folder holds the same two files.
8. Close throng, delete `save.svg` from `mine`, and start throng. Save shows the default icon again.

### Negative cases
- New set named `throng`, `Mine` (any case of an existing name), `old.bak` or a name with `/`: refused with the reason beside the box; nothing is created.
- A file named `nope.svg` in the folder is listed as unrecognised and changes nothing.
- A broken `save.svg` (not SVG) leaves Save on the default icon and the row says why.

## MT-13: Upgrade from an alpha16 configuration

Covers: FR-017, FR-018, FR-019, FR-020, FR-036, FR-037, FR-038, SC-005, US3
Paths: `packages/ui/src/main/icon-set-upgrade.ts`, `packages/ui/src/main/shipped-defaults-service.ts`, `packages/ui/src/main/main.ts`, `packages/core/src/icons/icon-set-upgrade.ts`, `packages/core/src/icons/seeded-icon-history.generated.ts`, `packages/ui/src/renderer/common/icon-set-backup-notice.tsx`

### Steps
1. Setup (already done in `~/.config/throng-dev`; a copy of the folder from before is under `/tmp/claude-1000/sync069/`): shipped-defaults version 31, no `icon-sets-upgrade.json`, and in `icon-packs` alpha16's own untouched `throng` pack, its `throng-svg` pack with `about.svg` edited, a pack `my-pack`, a folder `my-pack.bak` already there, and a `README.md`. The `throng` theme names `throng-svg` and holds an `icons` map.
2. Run `npm start`. `icon-packs` holds `throng-svg.bak`, `my-pack.bak.2` and the old `my-pack.bak`, with no `throng` folder, no `README.md` and a new `README.txt`.
3. Every theme draws the default icons; `themes/throng.json` has no `iconPack` or `icons`; Preferences → Themes → Icons offers only `throng`, with no `.bak` folder listed.
4. One notice says the backups hold icons from before the upgrade and nothing was converted, with an Open folder action. Press it: the file manager opens `icon-packs`.
5. Restart throng. The notice appears again, once.
6. Move both `.bak` folders out of `icon-packs` and restart. No notice appears.

### Negative cases
- No file inside a `.bak` folder changed.
- A second start does not rename anything again or add a `.bak.2`.
- Naming a new set `my-pack.bak` is refused.

## MT-14: Lucide licence and the icon sets README

Covers: FR-022, FR-023, US5
Paths: `packages/ui/src/renderer/about/**`, `scripts/generate-licenses.mjs`, `packages/core/src/icons/icon-sets-README.txt`

### Steps
1. Open About. Lucide 1.66.0 is listed with ISC, like every other package, and its ISC link opens the licence (FR-069: no licence text control).
2. Open `icon-packs/README.txt` in a text editor. It reads as plain text, explains making a set, Override this icon, Open folder, Reload the icon sets from disk and the `.bak` backups, and lists every key with its file name and description.

### Negative cases
- The README shows no Markdown syntax (`#`, `**`, backticks).

## MT-15: Rename, delete and reset in Preferences

Covers: FR-030, FR-041, FR-042, FR-043, FR-044
Paths: `packages/ui/src/renderer/preferences/icon-section.tsx`, `packages/ui/src/main/icon-set-service.ts`, `packages/ui/src/main/icon-sets-ipc.ts`, `packages/ui/src/main/icon-set-themes.ts`, `packages/ui/src/preload/preload.cts`

### Steps
1. With a set `mine` that overrides `save` selected on the current theme, select it on a second theme too.
2. Press Rename this icon set and name it `ours`. The picker shows `ours *`; switch to the second theme: it also uses `ours`, and the Save icon is still the overridden one.
3. Rename `ours` to `Ours`. Accepted: a change of case alone is a rename.
4. On the `save` row, press Reset this icon to the default. The row reads Default, the Save icon is the default one everywhere, and `save.svg` is in the OS trash.
5. Press Delete this icon set; choose Cancel. Nothing changes. Press it again and choose Delete. The picker shows `throng`, both themes draw the default icons, and the `Ours` folder is in the OS trash.

### Negative cases
- Renaming to the name of another set, in any case, or to `throng`: refused with the reason beside the box; nothing is renamed.
- A row whose icon is not overridden shows Reset greyed out; pressing it does nothing, and its hover title says the icon already comes from the default set.

## MT-16: The Icon set row: order, toasts and the asterisk

Covers: FR-016, FR-029, FR-046, FR-047, FR-048
Paths: `packages/ui/src/renderer/preferences/icon-section.tsx`, `packages/ui/src/renderer/preferences/preferences.css`

### Steps
1. In Preferences → Themes → Icons, open the picker. `throng` has no mark; every set of yours ends in ` *`.
2. Switch between `throng` and one of your sets several times. No control on the row moves: the picker stays at the far right with New set, Open folder and Reload beside it, and Rename and Delete further left, greyed out while `throng` is picked and usable on your set.
3. Select one of your sets. A toast says its file changes show after your next icon-set action or a restart; nothing is added to the row.
4. Close throng, delete the selected set's folder outside throng, and start throng. A toast says the set could not be loaded and the default icons are shown; the row has no error text.

### Negative cases
- The toast for an unloadable set does not repeat on every click; it is raised once for that reason.

## MT-17: The Preferences window: maximise, and folders above it

Covers: FR-045, 007 FR-004
Paths: `packages/ui/src/main/window-maximise.ts`, `packages/ui/src/main/window-controls-ipc.ts`, `packages/ui/src/main/floating-window-layering.ts`, `packages/ui/src/main/preferences-window.ts`

### Steps
1. Open Preferences and press its Maximise button. It fills the screen and the button turns to Restore.
2. Press Restore. It returns to the size and place it had.
3. In Themes → Icons, press Open folder. The file manager window comes up above Preferences and throng.
4. Click back into Preferences. It is above throng's main window again.

### Negative cases
- With Preferences open, switching to another application puts that application above Preferences.

## MT-18: Themes tab: every action always shown, greyed when unusable

Covers: FR-049, FR-044, FR-047
Paths: `packages/ui/src/renderer/preferences/themes-tab.tsx`, `packages/ui/src/renderer/preferences/icon-section.tsx`, `packages/ui/src/renderer/preferences/preferences.css`

### Steps
1. Open Preferences → Themes with the built-in `throng` theme selected and nothing edited. The toolbar shows Revert, Restore, Clone, Rename, Delete and Restore all; Revert and Rename are greyed out, and hovering each says why.
2. Select a theme of your own. The toolbar keeps the same icons in the same places; Restore is now greyed out and Rename is usable.
3. Change any colour. Revert becomes usable.
4. The search box's clear (×) is greyed out while the box is empty, and usable once you type.
5. In Icons, with no icon colour set, the icon colour's Clear is greyed out; set a colour and it becomes usable.
6. With `throng` picked, every row shows Override and Reset greyed out, and Rename and Delete beside the picker are greyed out; hovering any of them says to select one of your own sets.

### Negative cases
- Pressing a greyed-out control does nothing and raises nothing.
- No control on the toolbar, the Icon set row or an icon row appears, disappears or moves as the selection or the edits change.

## MT-19: Toast controls: placement, spacing and hover

Covers: FR-050, FR-051
Paths: `packages/ui/src/renderer/common/notification.tsx`, `packages/ui/src/renderer/common/icon-set-backup-notice.tsx`, `packages/ui/src/renderer/common/installed-version-notice.tsx`, `packages/ui/src/renderer/common/command-line-notice.tsx`, `packages/ui/src/renderer/explorer/paste-progress-notice.tsx`, `packages/ui/src/renderer/theme.css`, `packages/ui/src/renderer/notifications/notifications.css`

### Steps
1. Start throng with an `icon-packs` folder holding a `.bak` folder (the MT-13 setup leaves some). The Icon set backups toast shows Open folder at its top-right, immediately left of Copy and Dismiss, not under the text.
2. Paste a large folder in the File Explorer so the progress toast appears. Cancel sits at the top-right, left of Copy; the progress bar and text fill the card below.
3. Point at each control on a toast in turn. Each lifts onto a shaded background as the pointer reaches it, and the controls have visible space between them.
4. Open the Notifications panel. Each entry's controls are spaced the same way and shade on hover.

### Negative cases
- No toast shows a button inside its text or below it.

## MT-20: Notification hover delay

Covers: FR-052
Paths: `packages/ui/src/renderer/common/use-hover-intent.ts`, `packages/ui/src/renderer/notifications/notifications-panel.tsx`, `packages/ui/src/renderer/common/notification.tsx`, `packages/core/src/notice/display-mode.ts`, `packages/core/src/config/settings-metadata.ts`

### Steps
1. Fill the Notifications panel with several notifications whose text is cut off. Sweep the pointer quickly up and down across them: none expands and nothing below them moves.
2. Rest the pointer on one entry. After a moment it expands to its whole text; move off it and it collapses at once.
3. Raise a toast whose text is cut to three lines. Pass the pointer across it: no popover. Rest on it: after a moment the popover shows the whole text.
4. In Preferences → Settings → Notifications, set Notification hover delay to 0. Pointing at an entry or a cut-off toast now reveals it at once; set it to 1,500 and it takes a second and a half.

### Negative cases
- Tabbing to an entry or a toast reveals its text at once, whatever the delay.

## MT-21: The project settings dialog

Covers: FR-053, FR-054
Paths: `packages/ui/src/renderer/project-settings/project-settings-dialog.tsx`, `packages/ui/src/renderer/project-settings/project-settings.css`, `packages/ui/src/renderer/preferences/settings-tab.tsx`

### Steps
1. Open a project's settings with a few hidden paths and search exclusions. Every button is a plain icon with no grey box behind it, its icon centred; pointing at one draws a border and a wash.
2. In each section, the Preferences shortcut, the add button and every row's remove button sit in one column on the right, one under another.
3. The two sections are each in a box of their own, with the heading at the top.
4. Under each section's list, the line about the global list is followed by the list itself on its own line, in smaller text.
5. Close Preferences, then in the File Explorer section press the Preferences shortcut. Preferences opens on Settings with File Explorer unfolded and Excluded globs in view. Do the same from the Find & Replace section: Search · Find in Files is unfolded and Excluded from search is in view.
6. In Preferences → Themes, set General › Buttons › Icon Button Background to a strong colour. Every icon button, in this dialog and in every window, sits on it.

### Negative cases
- Hiding, unhiding, the "also matched by a global exclusion" note and the invalid-pattern notice behave as before.

## MT-22: One look for the secondary windows

Covers: FR-054
Paths: `packages/ui/src/renderer/about/about.css`, `packages/ui/src/renderer/about/about-app.tsx`, `packages/ui/src/renderer/preferences/preferences.css`, `packages/ui/src/renderer/preferences/form-history-control.tsx`, `packages/ui/src/renderer/theme.css`, `packages/ui/src/renderer/resources/breakdown.tsx`, `packages/ui/src/renderer/resources/line-graph.tsx`

### Steps
1. Open About, Preferences and the Resource Monitor side by side. All three sit on the same background, the same colour as their title bars, and their title bars are the same height.
2. Section headings read alike in all three: small, uppercase and dim (About's Licence and Third-party packages, the Monitor's breakdown and Over time, Preferences' groups).
3. Point at icon buttons in each: the Monitor's toolbar, About's licence toggle, Preferences' toolbar. Each shows the same border and wash, and a disabled one is dimmed the same way.
4. About's Close looks like a dialog's Cancel button, the same as the buttons in Preferences' name prompts.
5. In Preferences → Settings → Terminal, the remembered-values row shows a themed drop-down and two icon buttons (clear this type, clear all) with hover titles, not grey text buttons.

### Negative cases
- Nothing in any window moves, disappears or stops working; only its look changes.

## MT-23: The File Explorer's Delete as a rubbish bin

Covers: FR-055
Paths: `packages/ui/src/renderer/explorer/toolbar.tsx`, `packages/ui/src/renderer/explorer/context-menu-items.ts`, `packages/core/src/icons/default-set/deleteFile.svg`, `packages/core/src/icons/icon-keys.ts`

### Steps
1. Select a file in the File Explorer. The toolbar's Delete shows a rubbish bin.
2. Right-click the file. The menu's Delete shows the same rubbish bin.
3. Close a tab, remove a project from the sidebar's menu: those still show the ✕.
4. In Preferences → Themes → Icons, the list has a `deleteFile` row with the bin and its description. In a set of your own, Override this icon on it, replace `deleteFile.svg` with another drawing and reload: only the File Explorer's Delete changes.

### Negative cases
- A set of your own made before this change, with no `deleteFile.svg`, still shows the shipped bin.

## MT-24: File and folder kinds in the tree

Covers: FR-056
Paths: `packages/ui/src/renderer/explorer/tree-icons.ts`, `packages/ui/src/renderer/explorer/tree-node.tsx`, `packages/core/src/icons/default-set/SOURCES.json`

### Steps
1. Open a project holding a zip, a shell script, a YAML file, a `.gitignore`, a CSV, a SQLite database, a patch, a `.pem`, an MP3, an MP4, a font, an STL and a `.deb`. Each shows its own icon in the File Explorer, and the same icon heads its group in Find in Files results.
2. Folders named `node_modules`, `.vscode` and `.git` (shown with hidden files on) each show their own folder icon, which does not change when you expand them; other folders still open and close.
3. A symbolic link to a folder carries a folder-shaped link badge; a link to a file keeps the file-shaped one.
4. Preferences → Themes → Icons lists all sixteen new keys with their descriptions.

### Negative cases
- A file with an extension the tree does not know still shows the plain file icon.

## MT-25: Language file icons

Covers: FR-057
Paths: `scripts/draw-file-label-icons.mjs`, `specs/069-lucide-icon-set/review/drafts/`, `packages/ui/src/renderer/explorer/tree-icons.ts`

### Steps
1. Open a project with files in C, C++, C#, Java, JavaScript, TypeScript, Python, Go, Rust, Ruby, R, Lua, Dart, Swift, Scala, Kotlin, PHP, SQL, HTML, CSS, Sass and PowerShell. Each shows a file icon with its label (C, C++, C#, JV, JS, TS, PY, GO, RS, RB, R, LUA, DA, SW, SC, KT, PHP, SQL, HTM, CSS, SAS, PS), drawn in the theme's icon colour.
2. Set Icon Size larger in the theme: the labels stay crisp and centred in the file.
3. A Vue or Haskell file shows the generic code-file icon.

### Negative cases
- A shell script keeps the terminal file icon, not a label.

## MT-26: The Markdown mark

Covers: FR-058
Paths: `packages/core/src/icons/default-set/fileMarkdown.svg`, `scripts/draw-file-label-icons.mjs`

### Steps
1. A `.md` file in the File Explorer shows a file with an M and a down arrow inside it.

### Negative cases
- The Markdown preview's own icon (the eye on the status bar and preview panel) is unchanged.

## MT-27: File Explorer row popover

Covers: FR-059
Paths: `packages/ui/src/renderer/explorer/path-popover.tsx`, `packages/ui/src/renderer/explorer/tree-node.tsx`, `packages/ui/src/renderer/theme.css`, `packages/core/src/config/settings-metadata.ts`

### Steps
1. Rest the pointer on a file in the File Explorer. After half a second a popover opens below the row: the file's icon at twice the size, with its project-relative path to its right, the two centred on each other.
2. Rest on a folder, then on the project root: the folder's icon and path, then the open folder and the project's name.
3. Sweep the pointer down the tree without stopping: no popover opens.
4. With the popover open, click the row, scroll the tree, or right-click: it closes and does not come back until you move off the row and back.
5. Rest on a row at the bottom of the window: the popover opens above the row instead.
6. Preferences → Settings → File Explorer → File Explorer popover delay: set 0 and the popover opens at once; set 1500 and it takes a second and a half.

### Negative cases
- Dragging a file never shows a popover over the drop target.
- Renaming a row shows no popover.

## MT-28: Title bars apart from their windows

Covers: FR-060
Paths: `packages/ui/src/renderer/title-bar/title-bar.css`, `packages/core/src/config/theme.ts`

### Steps
1. Maximise the main window. The title bar is a shade lighter than the window below it on a dark theme (throng), and a shade darker on a light theme (Light).
2. Open a sub-workspace, Preferences, About and the Resource Monitor: each title bar is the same shade apart from its window.
3. In Preferences → Themes → General, set Title Bar Background to a strong colour: every window's title bar takes it. Clear it and they go back to the shade.

### Negative cases
- The title, cog and window controls stay readable on the bar in every bundled theme.

## MT-29: File icons coloured by category

Covers: FR-061
Paths: `packages/core/src/config/file-icon-colours.ts`, `packages/ui/src/renderer/theme.css`, `packages/ui/src/renderer/explorer/tree-node.tsx`, `packages/ui/src/renderer/find-in-files/results-list.tsx`

### Steps
1. Open a project with code, HTML or CSS, JSON or YAML, Markdown, images, a zip and a shell script. In the File Explorer each kind is a different colour: code blue, markup red-orange, data teal, documents amber, media pink, archives violet, scripts green. Every folder keeps the normal icon colour; an unknown file is grey (MT-32).
2. Hover and select a row of each colour: every icon stays clearly readable on the hover and selection backgrounds.
3. Search in Find in Files: each file heading's icon has the same colour as in the tree, and so does the row popover's large icon.
4. Switch to the Light theme: the same kinds keep the same hues, darker, and still read clearly. Try two or three dark themes too.
5. Preferences → Themes → File Explorer → File Icons: change Code File Icons and every code file follows; clear it and code files take the Icon Colour.

### Negative cases
- A user icon set's art is coloured the same way.

## MT-30: Resource Monitor "?" helpers

Covers: FR-062
Paths: `packages/ui/src/renderer/theme.css`, `packages/ui/src/renderer/resources/info-helper.tsx`

### Steps
1. Open the Resource Monitor. Each "?" — after Order by, Hide idle, Hide ended, Capture every, above the columns, after Total and after Held folders — sits slightly raised at the top right of what it explains, with a small gap from it.
2. No "?" touches the control after it: the next button or label has moved along to make room.
3. The "?" after Total is whole, not cut off at the top.
4. Hover and click a "?": its explanation opens as before.

### Negative cases
- At 200% display scaling the same holds.

## MT-31: Icon set and Icon colour row actions

Covers: FR-063
Paths: `packages/ui/src/renderer/preferences/icon-section.tsx`, `packages/ui/src/renderer/preferences/themes-tab.tsx`

### Steps
1. Open Preferences → Themes on a bundled theme and unfold Icons. The Icon set and Icon colour rows each end in Revert, Reset and Clear, in the same column and order as the colour rows above, all greyed out, each saying why on hover.
2. Pick a different icon colour: its Revert, Reset and Clear light up. Revert puts back the colour the window opened with; Reset and Clear empty it.
3. Pick one of your own icon sets: the Icon set row's three light up. Revert goes back to the set the window opened with; Reset and Clear go back to the default set.
4. Clone the theme and open the clone: both rows show Revert and Clear but no Reset.

### Negative cases
- The old lone Clear button beside the icon colour is gone.

## MT-32: The unknown file's own colour

Covers: FR-064
Paths: `packages/core/src/config/file-icon-colours.ts`, `packages/ui/src/renderer/theme.css`

### Steps
1. Open a project with a file of a kind throng does not know (for example `notes.xyz`) beside some folders. The unknown file's icon is a neutral grey, different from the folders' colour and from every coloured file kind.
2. Switch through a dark theme and the Light theme: the grey changes with the theme, stays readable, and still differs from the folders.
3. Preferences → Themes → File Explorer → File Icons: Other File Icons is listed; change it and the unknown file follows; clear it and the file takes the Icon Colour, like the folders.

### Negative cases
- Folders do not change colour.

## MT-33: Panel type icon first in the header

Covers: FR-065
Paths: `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/theme.css`

### Steps
1. Open an editor panel: its header reads type icon, then Back and Forward, then the title.
2. Open a Markdown preview: the same order.
3. Open a terminal: the type icon is first, then the title.
4. Tear a panel out into a sub-workspace window: the order is the same there.

## MT-34: A diagram's Focus Mode

Covers: FR-066
Paths: `packages/ui/src/renderer/preview/diagram/diagram-frame.tsx`, `packages/ui/src/renderer/panes/focus-mode-panes.tsx`, `packages/ui/src/renderer/workspace/maximise-store.ts`

### Steps
1. Open a Markdown preview with a mermaid diagram, with both side panes showing. Hover the diagram's toolbar: the control reads Enter Focus Mode.
2. Click it: the diagram fills the middle and both side panes close, as with a panel's Focus Mode. The control now reads Exit Focus Mode.
3. Click Exit Focus Mode: the diagram goes back and both side panes return.
4. Hide one side pane first, then do the same: on exit only the pane that was showing comes back.
5. Right-click the diagram: the menu's Enter / Exit Focus Mode does the same.

## MT-35: The File Manager category

Covers: FR-067
Paths: `packages/ui/src/renderer/preferences/settings-tab.tsx`

### Steps
1. Open Preferences → Settings and unfold General: File Manager is its last sub-heading, with a fold chevron like the others.
2. Click it: it folds and unfolds the "Open as throng project" item.
3. Collapse All and Expand All fold and unfold it with the rest.
4. Search for "file manager": General appears with only File Manager in it, unfolded with its item.

## MT-36: Settings grouped under General, Editor and Search

Covers: FR-068
Paths: `packages/core/src/config/settings-metadata.ts`, `packages/ui/src/renderer/preferences/settings-tab.tsx`

### Steps
1. Open Preferences → Settings. The first heading is General; unfold it: Appearance, Window, Projects, Behaviour, Attention and File Manager are sub-headings inside it, each with its settings.
2. There is no separate Appearance, Window, Projects, Behaviour or Attention heading any more.
3. Unfold Editor: Status Bar, Previews, Links, Navigation, Indentation and Languages are sub-headings inside it. There is no "Editor · Navigation", "Editor · Indentation" or "Editor · Languages" heading.
4. Unfold Search: Find Bar and Find in Files are sub-headings inside it. There is no "Search · …" heading.
5. Search for "navigation", then "indentation", then "find in files": each shows its sub-heading's settings under its parent heading.
6. Change a setting in each regrouped section: it saves and takes effect as before.

## MT-37: About: the licence box's pointer, and Lucide's row

Covers: FR-069
Paths: `packages/ui/src/renderer/about/about.css`, `packages/ui/src/renderer/about/about-app.tsx`

### Steps
1. Open About and move the pointer over the licence box's scrollbar: it is the arrow, not the text cursor. Drag the scrollbar: the text scrolls.
2. Select some licence text with the mouse and copy it: it copies.
3. Scroll the third-party list to lucide: it shows its version and an ISC link, and no button to show its licence text, like the packages around it.

## MT-38: File icon colours change with the theme

Covers: FR-070
Paths: `packages/core/src/config/shipped-defaults.ts`, `packages/core/src/config/file-icon-colours.ts`

### Steps
1. Start throng on a configuration from an earlier build of this branch (your dev profile will do). Open a project whose File Explorer shows code files and a file throng has no icon for (e.g. `notes.xyz`).
2. Open Preferences → Themes → File Explorer → File Icons on Snake: every row, Other File Icons included, has a colour.
3. Switch to English Garden: the code and unknown files' icons in the tree change to English Garden's darker colours, and the rows show English Garden's values.
4. On English Garden, change Code File Icons to a bright red. Switch to Snake: code icons are Snake's blue, not red. Switch back to English Garden: they are red again.
5. Reset the row on English Garden: back to its own colour.
