# Manual test plan: 049 Match and Selection Highlighting

Spec: `specs/049-match-and-selection-highlighting/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Find survives a tab switch and a move | signed off | 19ccfdd0cd28 | 2026-10-02 | |
| MT-02 | Find opens collapsed sections and folds | signed off | 19ccfdd0cd28 | 2026-10-02 | |
| MT-03 | Replace All with folded matches | signed off | b6236c3a0da0 | 2026-10-02 | |
| MT-04 | Search colours on every theme | signed off | 19ccfdd0cd28 | 2026-10-02 | |
| MT-05 | Other occurrences of the selection | signed off | 19ccfdd0cd28 | 2026-10-02 | |
| MT-06 | Selection kept after focus moves away | signed off | 19ccfdd0cd28 | 2026-10-02 | |
| MT-07 | A panel sent to another window keeps its place | signed off | b6236c3a0da0 | 2026-10-02 | |

## MT-01: Find survives a tab switch and a move

Covers: FR-000, FR-000b, FR-001, FR-002, FR-003, SC-001, #456
Paths: `packages/ui/src/renderer/search/**`, `packages/ui/src/renderer/preview/preview-search.ts`, `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/preview/highlight-registry.ts`, `packages/ui/src/renderer/editor/use-editor.ts`, `packages/ui/src/renderer/workspace/panel-state-capture.ts`, `packages/ui/src/renderer/workspace/panel-focus.ts`, `packages/ui/src/renderer/workspace/tab-group.tsx`, `packages/ui/src/renderer/terminal/terminal-panel.tsx`

### Steps
1. Open a Markdown preview of a file where a word occurs five times. Press Ctrl+F, type the word, press Enter once. The bar reads `2 of 5`; all five are highlighted, the second marked current.
2. Switch to another tab and back. The bar still reads `2 of 5` and all five highlights are there, the second current.
3. Press Enter. The bar reads `3 of 5` and the third match is current.
4. Repeat steps 1–3 in an editor panel. Same result.
5. With the preview's find bar at `2 of 5`, drag the panel into a split in another tab. In its new place the bar reads `2 of 5` with the highlights shown; press Enter and it reads `3 of 5`.
6. Open two previews side by side in one tab, search a different word in each. Both keep their own highlights; switching tabs and back keeps both.
7. With an editor's find bar at `2 of 5`, drag the editor to another position in the same tab, then into another tab. After each drop the bar reads `2 of 5` with the highlights shown, and Enter reads `3 of 5`.
8. Drag an editor, a preview and a terminal, one at a time, into another tab. Each time that tab shows, the dropped panel has the active-panel border, and typing (or Ctrl+F) goes to the dropped panel.

### Negative cases
- At no point does the bar read "No results" while the word is visibly in the document.
- A closed find bar stays closed after a tab switch.
- Edit the file in an editor while the preview's tab is hidden, removing two occurrences; on return the bar counts three.

## MT-02: Find opens collapsed sections and folds

Covers: FR-004, FR-005, FR-006, FR-007, SC-002, #455
Paths: `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/preview/preview-search.ts`, `packages/ui/src/renderer/editor/editor-fold-reveal.ts`, `packages/ui/src/renderer/search/editor-search.ts`, `packages/ui/src/renderer/editor/markdown-fold.ts`, `packages/ui/src/renderer/editor/use-editor.ts`

### Steps
1. In a Markdown preview, collapse a section. Press Ctrl+F and type a word that occurs only inside it. The section expands and the match is shown and marked current.
2. Collapse a section and, inside it, a sub-section holding the only match. Search for it. Both expand.
3. Collapse two sections, each holding a match. Search. Only the first expands; press Enter and the second expands when its match becomes current.
4. Move on to a match elsewhere. The sections opened by find stay open.
5. In a Markdown editor, fold a section and search for a word inside it. The fold opens and the match is visible; the preview of the same file shows the section open too.
6. In the editor, with the replace row open, fold a section holding a match, make that match current and press Replace. The fold opens before the text changes.

### Negative cases
- Find never collapses a section.
- In a Markdown editor whose document has one H1, run Collapse All (Ctrl+M, A). Every heading marker, the H1's included, shows `+`; the preview beside it shows only the H1, collapsed.
- A section holding no current match is not opened.

## MT-03: Replace All with folded matches

Covers: FR-007a
Paths: `packages/ui/src/renderer/search/replace-all-prompt.tsx`, `packages/ui/src/renderer/search/search-store.ts`, `packages/ui/src/renderer/search/editor-search.ts`, `packages/ui/src/renderer/editor/editor-fold-reveal.ts`

### Steps
1. In a Markdown editor, fold a section holding two of five matches. Open find with replace, type a replacement, press Replace All. A dialog titled "Replace in folded sections" reads "2 of 5 matches are inside folded sections." with Cancel, Replace and keep folded, and Replace and unfold, the last focused.
2. Press Escape. Nothing is replaced and the section stays folded.
3. Press Replace All again and choose **Replace and keep folded**. All five are replaced; the section is still folded. Ctrl+Z undoes all five at once.
4. Press Replace All again with the section folded and choose **Replace and unfold**. All are replaced and the section opens.
5. Use only the keyboard in the dialog: Tab moves between the three buttons; Enter activates the focused one.

### Negative cases
- With no match inside a folded section, Replace All replaces at once with no dialog.

## MT-04: Search colours on every theme

Covers: FR-008, FR-009, FR-009a, FR-009b, FR-010, FR-011, FR-012, FR-013, SC-003, SC-003a, SC-004, #325
Paths: `packages/core/src/config/default-themes/index.ts`, `packages/core/src/config/theme.ts`, `packages/core/src/config/theme-copy.ts`, `packages/core/src/config/theme-quality.ts`, `packages/core/src/config/shipped-defaults.ts`, `packages/ui/src/renderer/search/find-bar.css`, `packages/ui/src/renderer/preview/match-frames.css`, `packages/ui/src/renderer/preview/preview-search.ts`, `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/preview/preview.css`

### Steps
1. On the throng theme, search a word that occurs several times in an editor. The current match stands apart from the other matches at a glance, by its fill and by a 2 px outline.
2. Repeat on English Garden, Matrix, Snake and VI-VIM, then VSCode, Claude, Cyberpunk and Debian. On every one the current match is as easy to pick out as on the good four; on those four it looks as it did before.
3. Repeat step 2 in a Markdown preview. Same result, outline included.
4. In a long Markdown preview, search a common word and scroll quickly with the wheel and by dragging the scrollbar. Every outline stays on its word throughout; none trails behind or jumps after the scroll stops.
3. Open Preferences → Themes. In the Search area, **Selection Occurrence Highlight** and **Inactive Selection Occurrence Highlight** are listed with colour pickers; in the Editor area, **Editor Inactive Selection**.
4. Change **Selection Occurrence Highlight** to a vivid colour. Selecting a word in an editor shows its other occurrences in that colour at once.
5. With a search for `id` active, select another `id` in the editor. The search matches keep their search colours; no occurrence tint is layered on them.

### Negative cases
- Syntax colours stay readable through every match and occurrence tint on every theme you try.

## MT-05: Other occurrences of the selection

Covers: FR-014, FR-014a, FR-014b, FR-015, FR-016, FR-017, FR-018, FR-018a, FR-019, FR-020, SC-005, #324
Paths: `packages/core/src/search/occurrence-model.ts`, `packages/ui/src/renderer/editor/occurrence-highlight.ts`, `packages/ui/src/renderer/editor/use-editor.ts`, `packages/ui/src/renderer/preview/preview-occurrences.ts`, `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/search/find-bar.css`, `packages/core/src/config/settings-metadata.ts`

### Steps
1. In an editor, double-click `id` in a line like `x = -id; some-id-word; width; valid; id.`. `-id`, `some-id-word`'s `id` and `id.` are tinted; `width` and `valid` are not.
2. The tint is softer than the selection, and keyword colours show through it.
3. Click elsewhere to clear the selection. The tints disappear at once. Select another word; its occurrences are tinted instead.
4. Select `idt` inside a word. Every literal `idt` is tinted, inside words too.
5. In a Markdown preview, select a word that appears several times, including once with part of it in bold. All rendered occurrences are tinted, the bold one included, in the same colour as the editor.
6. Open the same file in an editor and a preview side by side. Selecting in one tints nothing in the other.
7. Click into a terminal. The editor's tints stay but turn weaker; click back into the editor and they return to full strength.
8. Turn off **Highlight other occurrences of the selection** in Preferences. Tints disappear in every open editor and preview without a reload; turning it on brings them back.
9. In a 10,000-line file, select a common word. Tints on screen appear with no visible delay; typing feels the same with the setting on and off.
10. Still in that file, with the word selected and find open, scroll quickly through the whole document. Scrolling is as smooth as with nothing selected and find closed, and the tints move with their text.

### Negative cases
- No tint for a single character, a whitespace-only selection, or a selection across two lines.
- Typing or Delete with a selection changes only the selected text, never a tinted occurrence.

## MT-06: Selection kept after focus moves away

Covers: FR-021, FR-022, FR-023, FR-024, FR-025, FR-025a, FR-026, SC-003a, SC-006, #457
Paths: `packages/ui/src/renderer/editor/editor.css`, `packages/ui/src/renderer/preview/preview-selection.ts`, `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/core/src/config/default-themes/index.ts`, `packages/core/src/config/theme.ts`, `packages/core/src/config/shipped-defaults.ts`

### Steps
1. Select a word in a preview, then click into a terminal. The word stays highlighted in a quieter colour.
2. Click the preview's tab header (not its text). The selection is active again; press Ctrl+C and paste into the terminal: exactly that word.
3. Select text in an editor, then click a terminal. The editor's selection turns the quieter colour.
4. With selections in an editor and a preview, click between them. Only the one with focus shows the full selection colour.
5. Select in a preview, then select text in an editor. The preview's quieter selection is still shown.
6. Select in a preview, switch tabs and back. The same text is selected, quiet until you click into the preview.
7. Open the editor's own find bar. The editor's selection turns quiet while the find bar has focus.
8. Repeat step 1 on English Garden, Bash, Windows Terminal and Light. On each, the quieter selection is still plainly visible against the page.

### Negative cases
- Clicking inside the preview's text replaces the kept selection with the new caret or selection.
- Edit the previewed file so the selected word changes; the preview never shows the old highlight over different text.

## MT-07: A panel sent to another window keeps its place

Covers: FR-000a, SC-007
Paths: `packages/ui/src/main/panel-state-handoff.ts`, `packages/ui/src/main/panel-state-handoff-ipc.ts`, `packages/ui/src/preload/preload.cts`, `packages/ui/src/renderer/workspace/panel-state-capture.ts`, `packages/ui/src/renderer/workspace/detach-context.tsx`, `packages/ui/src/renderer/subworkspace-app.tsx`, `packages/ui/src/renderer/editor/editor-view-state.ts`, `packages/ui/src/renderer/terminal/terminal-view-state.ts`, `packages/ui/src/renderer/terminal/use-terminal.ts`

### Steps
1. Scroll an editor to about line 500 and select a few lines. Send the panel to a new sub-workspace window. It opens at line 500 with the same caret and selection.
2. Run a command in a terminal with long output, scroll back, select some text. Send it to a sub-workspace window. It shows the same output at the same scroll position with the same text selected.
3. Sync a second panel into the same sub-workspace window. The first panel there keeps its place.

### Negative cases
- Output that arrives while the terminal moves is not lost, and does not pull the scrolled-back terminal to the end.
