# Manual test plan: 054 Markdown previews, diagrams, task lists and maximise

Spec: `specs/054-markdown-previews/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Restored previews are reused by Last Active | signed off | e1fa49bec68b | 2026-10-12 | |
| MT-02 | Tick task-list checkboxes from a preview | signed off | 5137d056b167 | 2026-10-13 | |
| MT-03 | Find in Files opens Markdown by the default open action | signed off | 5137d056b167 | 2026-10-13 | |
| MT-04 | Mermaid diagrams in a Markdown preview | signed off | 7cd0f9f0ef51 | 2026-10-14 | |
| MT-05 | Standalone Mermaid previews and preview types | signed off | 7cd0f9f0ef51 | 2026-10-14 | |
| MT-06 | Outlining submenu and All Inside | signed off | f6f685377d15 | 2026-10-13 | |
| MT-07 | Preview settings layout and migration | signed off | 2d1150949427 | 2026-10-11 | |
| MT-08 | Maximise a panel or a diagram | signed off | 5137d056b167 | 2026-10-13 | |
| MT-09 | File Explorer Open In sections | signed off | e1fa49bec68b | 2026-10-12 | |
| MT-10 | Zoom percentage indicator | signed off | 5137d056b167 | 2026-10-13 | |

## MT-01: Restored previews are reused by Last Active

Covers: FR-001, FR-002, FR-003, FR-004, SC-001
Paths: `packages/ui/src/renderer/preview/last-active-preview.ts`, `packages/ui/src/renderer/preview/open-preview.ts`, `packages/ui/src/renderer/state/workspace-store.tsx`, `packages/core/src/workspace/preview-recency.ts`

### Steps
1. In Preferences, set **Markdown: Default open action** to Preview and **Markdown: Open previews in** to Last Active. Open `README.md` from File Explorer: a Markdown Preview opens.
2. Quit and relaunch throng. Click another `.md` file in File Explorer: the restored preview shows it; no new panel appears.
3. Open a second preview with **Open In › New Preview Panel**, click into the first preview, quit and relaunch. Click a `.md` file: the preview you last used shows it.
4. With a file already previewed in a background tab, click it in File Explorer: throng switches to that tab and focuses its preview.

### Negative cases
- With **Open previews in** set to New Preview Panel, after a relaunch each click opens a new preview.
- A preview in a tab you are not looking at is never reused for a different file.

## MT-02: Tick task-list checkboxes from a preview

Covers: FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, SC-002
Paths: `packages/ui/src/renderer/preview/task-toggle.ts`, `packages/ui/src/renderer/preview/providers/markdown/**`, `packages/ui/src/main/task-toggle-service.ts`, `packages/ui/src/main/text-file-rewrite.ts`, `packages/core/src/preview/task-toggle.ts`

### Steps
1. Make a `.md` file with `- [ ] one`, `* [x] two`, `1. [ ] three` and `> - [ ] quoted`, nested items included, and preview it standalone (no editor open). Click each box: it flips and the preview keeps its scroll position.
2. Open the file in an editor beside the preview. Click a box: the editor shows the change at once and the tab is not marked unsaved. Ctrl+Z in the editor removes the tick and marks it unsaved.
3. Type something in the editor without saving, then click a box in the preview: the tick appears in the editor beside your typing and the file stays unsaved.
4. Tab to a checkbox in the preview and press Space: it toggles.
5. Open a CRLF file with a BOM (e.g. saved from Notepad) and tick a box: the file keeps its line endings and BOM (the editor status bar still says CRLF).

### Negative cases
- Make the file read-only in Windows, click a box: one notice on the preview says the file is read-only, and the box keeps its state.
- Click a box only after duplicating that item's text above it in the editor: one notice says it could not be found unambiguously; no line changes.
- No other key or paste in a preview changes the file.

## MT-03: Find in Files opens Markdown by the default open action

Covers: FR-030, FR-031, FR-032, SC-003
Paths: `packages/ui/src/renderer/find-in-files/**`, `packages/ui/src/renderer/preview/open-preview.ts`, `packages/ui/src/renderer/preview/reveal-match.ts`, `packages/ui/src/renderer/preview/preview-panel-handles.ts`

### Steps
1. Set **Markdown: Default open action** to Preview. Search a word that appears deep in a `.md` file and double-click the result: a Markdown Preview opens (or the Last Active one is reused), scrolled to the match with it highlighted.
2. Double-click a result in a file that already has a preview: that preview is focused and scrolls to the new match.
3. Set the default open action back to Editor and double-click the same result: an editor opens at the match.
4. With Markdown on Preview, search `test.mmd` and double-click a result on a `![[test.mmd]]` line, then one on a `![Flow](test.mmd)` line, then one inside a ```` ```mermaid ```` fence: each opens only the `.md` preview, scrolled to that diagram, which is briefly outlined in the find colour. No editor opens.
5. Double-click any result inside a `.mmd` file: only its Mermaid preview opens (or is focused), the diagram briefly outlined. No editor opens.

### Negative cases
- A match in hidden front matter still opens an editor at the match, and no preview.
- A `.ts` result always opens an editor.
- With Markdown previews disabled, a `.md` result opens an editor.

## MT-04: Mermaid diagrams in a Markdown preview

Covers: FR-040, FR-041, FR-042, FR-043, FR-044, FR-045, FR-046, FR-049b, FR-046a, FR-046b, FR-046c, FR-046d, FR-046e, FR-046g, FR-046l, FR-046m, FR-047, FR-048, FR-049, FR-049a, SC-004, SC-005
Paths: `packages/ui/src/renderer/preview/diagram/**`, `packages/ui/src/renderer/preview/blocks/**`, `packages/ui/src/renderer/preview/providers/markdown/**`, `packages/ui/src/renderer/preview/copy.ts`, `packages/ui/src/renderer/workspace/mouse-zoom.ts`

### Steps
1. Preview a `.md` with a ```` ```mermaid ```` flowchart and a sequence diagram: both draw as diagrams in the theme's colours, shrunk to fit the panel width.
2. Use the controls at a diagram's top left — Fit, Zoom In, Zoom 100%, Zoom Out, Maximise — and drag with the middle mouse button: the controls stay put while the diagram zooms and pans. A diagram opens centred; Fit fits both its width and height with no scrollbar; Zoom 100% shows it at actual size. Click inside the diagram, then use the panel zoom keys or Ctrl+wheel: only the diagram zooms.
3. In the editor, break the diagram's syntax: the last good diagram stays, dimmed, with one notice above naming the error. Fix it: the notice goes and the diagram is crisp again.
4. Switch to a light theme: the diagram redraws in the new colours.
5. Select across a diagram and copy, then paste into Word: the diagram arrives as a picture. Paste into Notepad: it arrives as the mermaid source in a fenced block.
6. Turn off **Markdown: Render Mermaid diagrams**: the block shows as highlighted code.
7. Collapse the heading above a diagram: the diagram folds away with the rest of that section.
8. Put `![[flow.mmd]]` and `![Flow](flow.mmd)` in a Markdown file next to a `flow.mmd`: both draw the diagram inline. Edit and save `flow.mmd`, then edit the Markdown: the new diagram shows. `[x](flow.mmd)` and `[[flow.mmd]]` stay links, and `![[missing.mmd]]` shows "Embedded diagram not found: missing.mmd".
9. Drag a panel divider across a preview with a large diagram: no lag; the diagram re-fits when you stop. Tick a task box in a preview with links and tables: nothing else flashes, and no dirty marker appears anywhere.
10. Look at a diagram's Zoom 100% button: "1:1" sits on one line inside its box. Click the diagram, Tab to it, or click one of its buttons: its whole box is outlined until focus leaves it.
11. Hold the middle mouse button and drag over a diagram — in place, in a `.mmd` preview and in Focus Mode: the pointer is the move cursor for the whole drag, and returns to normal on release.
12. A Markdown preview's status bar has no Collapse All / Expand All button. Its scroll-sync and editor buttons are clearly visible, active or not.
13. Open a `.mmd` preview and a Markdown preview with diagrams, switch to another tab and back, and maximise and restore a diagram: each diagram is back at once. A diagram drawn for the first time shows a **Drawing diagram…** spinner until it appears.
14. Right-click an inline diagram, then a `.mmd` preview's diagram, and choose **Copy Diagram as Image**: paste into Word and into Paint — the diagram appears as a picture in both.
15. Click into a diagram, point at a node near its bottom right and Ctrl+wheel up several times — inline, in a `.mmd` preview and in Focus Mode: the diagram grows around that node, which stays under the pointer; the view does not jump to the centre. Ctrl+wheel down shrinks it about the pointer the same way.
16. Pan a zoomed diagram off-centre, then press Zoom In / Zoom Out on its toolbar, or Ctrl+Alt+= / Ctrl+Alt+-: it zooms about the middle of its box, keeping what is there in the middle.
17. Zoom a diagram in until its nodes reach the edges, then pan a node across an edge — in a `.mmd` preview, in Focus Mode and inline: the focus border stays drawn over the node on every side, never under it.
18. Ctrl+middle-click a zoomed diagram, inline and in a `.mmd` preview: it returns to Fit, and the pointer never turns into the move cursor. Ctrl+Alt+0 on a focused diagram returns it to Fit too; the toolbar's Zoom 100% still shows 1:1.
19. Zoom an inline diagram in and out, and press Zoom 100%: its box in the document keeps the same height throughout; the text below it never moves.
20. Write ```` ```mermaid height=300 ```` above a diagram, and `![[flow.mmd|300]]` for an embed: each box is 300px tall, the whole diagram fitted and centred inside it. `![[flow.mmd|Order flow]]` keeps its own height and shows "Order flow" as its tooltip.
21. Give the project a colour, focus an inline diagram and maximise it to Focus Mode: its border there is the project's colour, the same as the panel's.
22. Click a `.mmd` preview's panel: only the panel is bordered, never the diagram inside it. With the panel active, Ctrl+Alt++ / Ctrl+wheel / Ctrl+middle-click zoom the diagram without clicking into it. Click its title, then its diagram: the border looks the same both times, with no second border inside it.
23. Make an editor, a Markdown preview and a `.mmd` preview active in turn: the active border is the same thickness beside the body as beside the title. A Find in Files panel's is unchanged.

### Negative cases
- With the pointer outside the focused diagram, Ctrl+wheel zooms it about the middle of its box.
- A diagram with a click handler, a `javascript:` link or script in a label runs nothing and loads nothing.
- Find in the preview never matches text inside a diagram.

## MT-05: Standalone Mermaid previews and preview types

Covers: FR-005, FR-005a, FR-006, FR-007, FR-008, FR-009, FR-046a, FR-046i, SC-006
Paths: `packages/core/src/workspace/panel-title.ts`, `packages/core/src/editor/path-display.ts`, `packages/ui/src/renderer/preview/diagram/diagram.css`, `packages/core/src/preview/**`, `packages/ui/src/renderer/preview/providers/mermaid/**`, `packages/ui/src/main/preview-service.ts`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`, `packages/ui/src/renderer/preview/content-menu.ts`, `packages/ui/src/renderer/preview/preview-status-bar.tsx`, `packages/ui/src/renderer/editor/status-strip.tsx`, `packages/ui/src/renderer/editor/content-menu.ts`

### Steps
1. Open a `.mmd` file and use the editor status bar's preview button: a panel headed **Mermaid Preview** shows the diagram with the same controls as MT-04, following your edits.
2. With a Markdown Preview open, open a `.mmd` file as a preview with Last Active: a new Mermaid Preview opens; the Markdown preview is untouched.
3. In a Markdown preview, click a link to a `.mmd` file: it opens as a Mermaid preview, not in the Markdown panel.
4. Hover a preview panel's type icon: it reads **Panel type: Markdown Preview** (or Mermaid Preview).
5. Right-click a Mermaid preview and open its title menu: no Select All, Go to Heading or Synchronise Scrolling, and Ctrl+A does nothing; Go to Editor / Open in Editor is there. The `.mmd` editor's status bar has the preview button but no scroll-sync toggle, and its menus have no Synchronise Scrolling.
6. Open a tall `.mmd` (a long top-down flowchart) and a wide one as previews: each diagram fills its panel, the whole of it in view and centred, with no vertical or horizontal scrollbar. Zoom in past the panel: still no scrollbar; the middle mouse button pans. Resize the panel: it re-fits, still without a scrollbar.
7. Preview `notes.md` and `flow.mmd`, standalone and from their editors: the panels are titled **notes.md - Preview** and **flow.mmd - Preview**, also after renaming the editor. Hover each title: the tooltip is the file's full path.

### Negative cases
- A layout saved before this build restores its previews as Markdown Previews, and restoring twice changes nothing.
- A `.mmd` preview's diagram has no Maximise button of its own; the panel header's Maximise is the route.

## MT-06: Outlining submenu and All Inside

Covers: FR-010, FR-011, FR-012, FR-013, FR-014
Paths: `packages/ui/src/renderer/common/outlining-menu.ts`, `packages/ui/src/renderer/editor/content-menu.ts`, `packages/ui/src/renderer/preview/content-menu.ts`, `packages/ui/src/renderer/editor/markdown-fold.ts`, `packages/core/src/outline/fold-state.ts`

### Steps
1. Right-click a Markdown editor's body: one **Outlining** submenu holds the six fold rows, with their shortcuts; none appear at the top level.
2. Right-click a Markdown preview's body: the same submenu, in the same order.
3. With the caret under a level-2 heading that has sub-headings, choose **Collapse All Inside This H2**: every section under it folds, but the H2 itself stays open; other sections do not change. **Expand All Inside This H2** reverses it, and the linked preview follows.
4. Collapse that H2 with its fold arrow, then choose **Expand All Inside This H2**: the H2 opens too, with everything under it.
5. The Outlining submenu is divided into three groups: Collapse / Expand This H2, then the two All Inside rows, then Collapse All / Expand All. With everything under the H2 collapsed, **Collapse All Inside** is greyed; with the H2 and everything under it expanded, **Expand All Inside** is greyed; with any other mixture, both are offered.

### Negative cases
- A non-Markdown editor has no Outlining submenu.
- Above the first heading, the two All Inside rows are absent.

## MT-07: Preview settings layout and migration

Covers: FR-050, FR-050a, FR-051, FR-052, FR-053, FR-054, FR-055, SC-007
Paths: `packages/core/src/config/preview-settings.ts`, `packages/core/src/config/settings-metadata.ts`, `packages/ui/src/renderer/preferences/**`

### Steps
1. Open Preferences › Settings › Editor › Previews: update delay, maximum wait, synchronise scrolling and copy format sit under Previews, followed by a **Markdown** subsection and a **Mermaid** subsection.
2. Markdown holds Enabled, Default open action, Open previews in, Render Mermaid diagrams, Load remote images, Show front matter, Preview gutter, Heading jump scroll duration, and Markdown sections open — each labelled with "Markdown:" except the last.
3. Search "open previews": both **Markdown: Open previews in** and **Mermaid: Open previews in** appear, and nothing else from Previews.
4. Before launching this build, set `"openTarget": "new"` under `editor.previews` in `settings.json`. Launch: both Open previews in rows read New Preview Panel, and after the next settings save the old key is gone from the file.

### Negative cases
- Turning Markdown off greys its rows but not Markdown sections open.

## MT-08: Focus Mode — maximise a panel or a diagram

Covers: FR-046f, FR-070, FR-071, FR-071a, FR-072, FR-073, FR-074, FR-075, FR-076, FR-077, FR-078, SC-008
Paths: `packages/ui/src/renderer/workspace/**`, `packages/ui/src/renderer/keybindings/window-dispatcher.tsx`, `packages/ui/src/renderer/config/chord-key.ts`, `packages/ui/src/renderer/preview/diagram/diagram-frame.tsx`, `packages/ui/src/renderer/theme.css`, `packages/ui/src/renderer/statusbar/**`, `packages/ui/src/renderer/state/workspace-store.tsx`, `packages/ui/src/renderer/preview/content-menu.ts`, `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/preview/preview-commands.tsx`, `packages/ui/src/renderer/search/search-keybindings.tsx`

### Steps
1. In a tab with three panels, click a terminal's maximise button: it fills the tab, its output and scrollback intact. Click it again: the layout returns with the same sizes.
2. Focus an editor and press **Shift+Alt+Enter**: it maximises; press it again to restore. Do the same from the panel's title menu row, which reads **Enter Focus Mode**, then **Exit Focus Mode**.
3. While maximised: the panel's own status bar is filled with the panel border colour and shows **Focus Mode** centred, naming Esc and Shift+Alt+Enter; the window status bar shows nothing for it. The header + and ✕ are greyed with a hint and show no hover; the title menu's Split, Send to Tab, Sync to and Destroy rows are disabled; the split and destroy keys do nothing; drag zones do not appear; Open In lists no hidden panels. Hover the maximise button: its tooltip reads **Exit Focus Mode (Shift+Alt+Enter)**, and **Enter Focus Mode (Shift+Alt+Enter)** when not maximised.
4. In a terminal, Shift+Enter still inserts a line break and Ctrl+Enter still reaches the program while Shift+Alt+Enter maximises.
5. Maximise a preview, then click **Maximise** on one of its diagrams: the whole diagram fills the tab's middle, centred, over the preview's find bar and status bar. Esc returns to the maximised preview; Esc again restores the tab.
6. Maximise an inline diagram, then right-click it: Find, Go to Heading, Copy, Select All, Synchronise Scrolling, Outlining and Split are disabled, and Ctrl+F, Ctrl+A and Ctrl+G do nothing.
7. Switch to another tab and back, and to another project and back: the maximised panel is still maximised. Unload the project, or quit and relaunch: nothing is maximised.
8. Maximise an editor, then click another file in the File Explorer: it opens in the maximised editor and Focus Mode stays on. Maximise a terminal instead and click a file: the tab restores and the file opens in its editor.
9. Maximise a Markdown preview and right-click its text: Select All, Find, Go to Heading, Copy and Outlining all work as they do unmaximised.
10. Maximise an inline diagram: a status bar in the panel border colour sits under it, showing **Focus Mode** centred. On any maximised panel's coloured status bar, the scroll-sync and editor icons are clearly legible, pressed or not.
11. Maximise a Markdown preview, then maximise one of its diagrams. Press **Shift+Alt+Enter**: only the diagram leaves Focus Mode and the preview stays maximised. Press it again: the tab is restored.
12. Right-click an inline diagram: it is outlined as focused, and the menu leads with **Copy Diagram as Image** and **Enter Focus Mode**. Choose Enter Focus Mode: the diagram fills the middle section and has focus (Ctrl+= zooms it at once). Right-click it again: the row reads **Exit Focus Mode**.
13. Right-click a `.mmd` preview's diagram and choose **Enter Focus Mode**: the whole panel enters Focus Mode, with its shortcut shown on the row.
14. Enter Focus Mode on an editor or terminal from its header button: the caret is in it, ready to type.

### Negative cases
- Esc inside a terminal or editor does not restore.
- Closing the maximised panel restores the tab instead of leaving it empty.

## MT-09: File Explorer Open In sections

Covers: #483
Paths: `packages/ui/src/renderer/explorer/context-menu-items.ts`, `packages/ui/src/renderer/workspace/menu-dividers.ts`, `packages/ui/src/renderer/workspace/context-menu.tsx`

### Steps
1. Right-click a Markdown file in the File Explorer and open **Open In**: OS File Explorer alone, a divider, the editor targets ending with Other Tab, a divider, Last Preview Panel and New Preview Panel, a divider, Terminal, a divider, Search.
2. Right-click a folder and open **Open In**: OS File Explorer, Terminal and Search, one divider between each.

### Negative cases
- No divider is doubled, and none starts or ends the submenu.
- Every row still works and keeps its order; other menus' dividers are unchanged.

## MT-10: Zoom percentage indicator

Covers: FR-046n, #486
Paths: `packages/ui/src/renderer/workspace/zoom-indicator.tsx`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/theme.css`

### Steps
1. In an editor, press Ctrl+Alt++ three times quickly: a percentage appears in the editor's top-right corner, just under the header, fading in; it updates on each press, stays up between presses, then fades out slowly about a second after the last.
2. Ctrl+wheel down over a Markdown preview, then Ctrl+middle-click it: the preview's corner shows each new figure, ending at 100%.
3. Do the same over an active `.mmd` preview's panel, without clicking the diagram: the diagram zooms (about the pointer for the wheel; Ctrl+middle-click returns it to Fit) and its figure shows in the panel's top-right corner.
4. Click an inline diagram, then use Ctrl+wheel, its Zoom in / Zoom out / Zoom 100% / Fit buttons and Ctrl+middle-click: the figure shows in the top-right of that diagram's box, not the panel's.
5. Repeat step 4 with the diagram maximised in Focus Mode: the figure shows at the top right of the maximised diagram.

### Negative cases
- Opening or restoring a zoomed editor or preview shows no figure; nor does resizing a panel holding a fitted diagram.
- The figure has no buttons, the pointer passes through it (click or drag beneath it works), and focus never moves to it.
- Nothing in the panel or the document shifts while it shows.
- A terminal or Find in Files panel's zoom shows no figure.
