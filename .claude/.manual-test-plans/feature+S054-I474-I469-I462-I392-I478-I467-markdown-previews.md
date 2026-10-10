# Manual test plan: 054 Markdown previews, diagrams, task lists and maximise

Spec: `specs/054-markdown-previews/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Restored previews are reused by Last Active | untested | | | |
| MT-02 | Tick task-list checkboxes from a preview | untested | | | |
| MT-03 | Find in Files opens Markdown by the default open action | untested | | | |
| MT-04 | Mermaid diagrams in a Markdown preview | untested | | | |
| MT-05 | Standalone Mermaid previews and preview types | untested | | | |
| MT-06 | Outlining submenu and All Inside | untested | | | |
| MT-07 | Preview settings layout and migration | untested | | | |
| MT-08 | Maximise a panel or a diagram | untested | | | |

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

### Negative cases
- A `.ts` result always opens an editor.
- With Markdown previews disabled, a `.md` result opens an editor.

## MT-04: Mermaid diagrams in a Markdown preview

Covers: FR-040, FR-041, FR-042, FR-043, FR-044, FR-045, FR-046, FR-046a, FR-046b, FR-046c, FR-046d, FR-046e, FR-046g, FR-047, FR-048, FR-049, FR-049a, SC-004, SC-005
Paths: `packages/ui/src/renderer/preview/diagram/**`, `packages/ui/src/renderer/preview/blocks/**`, `packages/ui/src/renderer/preview/providers/markdown/**`, `packages/ui/src/renderer/preview/copy.ts`

### Steps
1. Preview a `.md` with a ```` ```mermaid ```` flowchart and a sequence diagram: both draw as diagrams in the theme's colours, shrunk to fit the panel width.
2. Use the controls at a diagram's top left — Fit, Full Size, Zoom In, Zoom Out — and drag with the middle mouse button: the controls stay put while the diagram zooms and pans. Full Size fills the panel; Fit puts it back.
3. In the editor, break the diagram's syntax: the last good diagram stays, dimmed, with one notice above naming the error. Fix it: the notice goes and the diagram is crisp again.
4. Switch to a light theme: the diagram redraws in the new colours.
5. Select across a diagram and copy, then paste into Word: the diagram arrives as a picture. Paste into Notepad: it arrives as the mermaid source in a fenced block.
6. Turn off **Markdown: Render Mermaid diagrams**: the block shows as highlighted code.

### Negative cases
- A diagram with a click handler, a `javascript:` link or script in a label runs nothing and loads nothing.
- Find in the preview never matches text inside a diagram.

## MT-05: Standalone Mermaid previews and preview types

Covers: FR-005, FR-006, FR-007, FR-008, FR-009, SC-006
Paths: `packages/core/src/preview/**`, `packages/ui/src/renderer/preview/providers/mermaid/**`, `packages/ui/src/main/preview-service.ts`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`

### Steps
1. Open a `.mmd` file and use the editor status bar's preview button: a panel headed **Mermaid Preview** shows the diagram with the same controls as MT-04, following your edits.
2. With a Markdown Preview open, open a `.mmd` file as a preview with Last Active: a new Mermaid Preview opens; the Markdown preview is untouched.
3. In a Markdown preview, click a link to a `.mmd` file: it opens as a Mermaid preview, not in the Markdown panel.
4. Hover a preview panel's type icon: it reads **Panel type: Markdown Preview** (or Mermaid Preview).

### Negative cases
- A layout saved before this build restores its previews as Markdown Previews, and restoring twice changes nothing.

## MT-06: Outlining submenu and All Inside

Covers: FR-010, FR-011, FR-012, FR-013, FR-014
Paths: `packages/ui/src/renderer/common/outlining-menu.ts`, `packages/ui/src/renderer/editor/content-menu.ts`, `packages/ui/src/renderer/preview/content-menu.ts`, `packages/ui/src/renderer/editor/markdown-fold.ts`, `packages/core/src/outline/fold-state.ts`

### Steps
1. Right-click a Markdown editor's body: one **Outlining** submenu holds the six fold rows, with their shortcuts; none appear at the top level.
2. Right-click a Markdown preview's body: the same submenu, in the same order.
3. With the caret under a level-2 heading that has sub-headings, choose **Collapse All Inside This Section**: that section and every one under it fold; other sections do not. **Expand All Inside This Section** reverses it, and the linked preview follows.

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

## MT-08: Maximise a panel or a diagram

Covers: FR-046f, FR-070, FR-071, FR-071a, FR-072, FR-073, FR-074, FR-075, FR-076, FR-077, SC-008
Paths: `packages/ui/src/renderer/workspace/**`, `packages/ui/src/renderer/keybindings/window-dispatcher.tsx`, `packages/ui/src/renderer/config/chord-key.ts`, `packages/ui/src/renderer/preview/diagram/diagram-frame.tsx`, `packages/ui/src/renderer/theme.css`

### Steps
1. In a tab with three panels, click a terminal's maximise button: it fills the tab, its output and scrollback intact. Click it again: the layout returns with the same sizes.
2. Focus an editor and press **Shift+Alt+Enter**: it maximises; press it again to restore. Do the same from the panel's title menu row.
3. While maximised: the header + is disabled with a hint, Split rows are disabled, drag zones do not appear, and Open In lists no hidden panels.
4. In a terminal, Shift+Enter still inserts a line break and Ctrl+Enter still reaches the program while Shift+Alt+Enter maximises.
5. Maximise a preview, then click **Full Pane** on one of its diagrams: the diagram fills the tab's middle. Esc returns to the maximised preview; Esc again restores the tab.
6. Switch to another tab and back: the maximised panel is still maximised. Quit and relaunch: nothing is maximised.

### Negative cases
- Esc inside a terminal or editor does not restore.
- Closing the maximised panel restores the tab instead of leaving it empty.
