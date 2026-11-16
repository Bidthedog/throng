# Manual test plan: Focus Mode side panes and preview status bar

Spec: `specs/044-file-previews/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Focus Mode folds both side panes away | signed off | 4312142ce58f | 2026-11-16 | |
| MT-02 | Preview status bar counts and selection | signed off | 1c5794e9539e | 2026-11-16 | |
| MT-03 | Copy confirmation everywhere | retired → none | | | the Copied popover was dropped at this hand test (044 FR-118d, FR-118e withdrawn) |
| MT-04 | One popup style, and the app's own tooltips | signed off | 194f4597d7cc | 2026-11-16 | |

## MT-01: Focus Mode folds both side panes away

Covers: #635
Paths: `packages/ui/src/renderer/app.tsx`, `packages/ui/src/renderer/panes/focus-mode-panes.tsx`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`

### Steps
1. Open a project with both side panes expanded and two panels in a tab. Click **⤢** (Enter Focus Mode) in one panel's header. The panel fills the middle and both side panes collapse to their rails.
2. Press **Esc**. The panel goes back to its place and both side panes expand again.
3. Collapse the File Explorer pane. Enter Focus Mode with **Shift+Alt+Enter**. Both panes are rails. Leave with the header's Exit Focus Mode control. Projects expands again; File Explorer stays collapsed.
4. Enter Focus Mode, then click the Projects rail's show button. Projects opens over the Focus Mode layout. Leave Focus Mode. Projects is as it was before you entered.
5. Enter Focus Mode, then switch to another tab with nothing maximised. The side panes show as they were. Switch back. They collapse again.
6. Enter Focus Mode, switch to another project and back. The panes collapse again on returning, and the other project showed its own panes.
7. With a screen reader, focus the Exit Focus Mode control in a maximised panel's header. It is announced as a button, not as unavailable.

### Negative cases
- Quit throng while a panel is in Focus Mode, then start it again. Both side panes come back as they were before Focus Mode, not collapsed.
- Maximise a diagram inside a Markdown preview with its **Maximise** control, with no panel in Focus Mode. The side panes do not move.
- Make the window narrow enough that File Explorer auto-collapses, enter and leave Focus Mode. File Explorer is still auto-collapsed afterwards, not forced open.

## MT-02: Preview status bar counts and selection

Covers: FR-118a, FR-118b, FR-118c
Paths: `packages/ui/src/renderer/preview/preview-status-bar.tsx`, `packages/ui/src/renderer/preview/preview-readouts.ts`, `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/preview/preview-selection.ts`, `packages/ui/src/renderer/editor/status-strip-measure.ts`, `packages/ui/src/renderer/editor/status-strip.tsx`

### Steps
1. Open a Markdown file in an editor and its preview beside it. The preview's status bar shows `N Lines.`, `N Chars.` and `N Words.` with the same figures as the editor's bar.
2. Type a few words in the editor. The preview's figures update to match the editor's within a moment.
3. In the preview, select a few words inside one paragraph. The bar adds `Ln <line>.` (the source line of that paragraph) and `<count> selected.`.
4. Select from a heading down into a list. The bar shows `Ln <first>-<last>.` for the source lines it spans.
5. Click in the preview without dragging to clear the selection. The line and selected readouts disappear; the counts stay.
6. Hover a link in the preview. Its target appears after the counts, and the scroll-sync and editor buttons stay where they were.
7. Narrow the preview panel slowly. The labels shorten (`Lns.`, `Ch.`, `W.`) before any readout disappears, then Words goes first, then Chars, then Lines. The two buttons never disappear.
8. In Preferences, turn off **Show character and word counts**. The counts and the selected count leave the preview's bar. Turn off **Show cursor position**. The selection's line readout leaves too.
9. In Preferences › Editor › Status Bar, the first setting reads **Show panel status bar**, described as the bar along the bottom of editor and preview panels, with terminals having their own. Each of the three descriptions is one short sentence. Turn **Show panel status bar** off: both the editor's and the preview's bars go.

### Negative cases
- Select text inside a rendered Mermaid diagram's labels. The bar shows the selected count alone, with no `Ln` readout.
- An empty Markdown file shows `1 Line.`, `0 Chars.`, `0 Words.`, never a blank or a stale figure from another file.

## MT-04: One popup style, and the app's own tooltips

Covers: constitution v6.7.0 "One popup style"
Paths: `packages/ui/src/renderer/theme.css`, `packages/ui/src/renderer/common/title-tooltips.tsx`, `packages/ui/src/renderer/common/window-popups.tsx`, `packages/ui/src/renderer/main.tsx`, `packages/ui/src/renderer/links/link-hint.css`, `packages/ui/src/renderer/editor/editor.css`, `packages/ui/src/renderer/explorer/explorer.css`, `packages/core/src/config/theme-copy.ts`

### Steps
1. Rest the pointer on a toolbar button, a panel header icon and a status bar item in turn. After about half a second a tooltip fades in below the pointer. Each looks the same: the same background, border, rounded corners, padding, text size and shadow. No second, system-drawn tooltip appears.
2. Move off the control. The tooltip goes at once.
3. Rest on a button, then click it. The tooltip goes, and does not come back while the pointer stays on it.
4. Hover a tab chip, a project's attention mark, the status bar's CPU figure and a cut-off notification's text. Each popover has the same look as the tooltips in step 1 (only its size differs).
5. Plain-click a link in an editor (the hint saying Ctrl+click opens it), zoom a panel with **Ctrl+Alt++** (the zoom percentage), press **Ctrl+M** in a Markdown editor and wait (the pending-chord label) and drag a file in File Explorer (the action label). Each label has the same look.
6. Hover a whitespace marker with View Whitespace on. Its name shows in the same style.
7. Rest on a control in the Preferences window, the About window, the Resource Monitor and a sub-workspace window. Each draws the same tooltip.
8. In Preferences › Themes, change **Popup Background**. Every tooltip, popover and label above takes the new colour.
9. Hover a terminal link. The tooltip naming its target appears in the same style.
10. In Preferences › Themes, find the tokens for the bar along the bottom of editor and preview panels. They read **Panel Status Bar Surface**, **Panel Status Bar Text** and **Panel Status Bar Hover Background**; no token anywhere says "Status Strip" (#320).

### Negative cases
- A tooltip never covers the pointer or blocks a click on what is under it.
- Near the bottom or right edge of the window, the tooltip stays fully on screen (it flips above the pointer at the bottom).
- Pressing a key or scrolling while a tooltip is up hides it.
- Hover a project's path in the Projects list, then a panel header's type icon, then its Back and Forward buttons (an editor or preview panel). Each shows exactly ONE tooltip, its own — never a second, system-drawn "Double-click to rename", panel name or path beside it.
- Click a control and leave the pointer on it. No system-drawn tooltip appears afterwards.
