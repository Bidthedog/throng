# Manual test plan: Find in Files polish (spec 060, #513)

Spec: `specs/060-find-in-files-polish/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | A running search looks busy and stays usable | signed off | dee2391be54e | 2026-10-29 | |
| MT-02 | Cancel keeps what was found | signed off | dee2391be54e | 2026-10-29 | |
| MT-03 | Headings, tooltips and result rows read cleanly | signed off | dee2391be54e | 2026-10-29 | |
| MT-04 | Matches and icons in every theme | signed off | dee2391be54e | 2026-10-29 | |
| MT-05 | Folder structure grouping | signed off | dee2391be54e | 2026-10-29 | |
| MT-06 | Selecting results with mouse and keyboard | signed off | dee2391be54e | 2026-10-29 | |
| MT-07 | A shorter, narrower panel menu | signed off | dee2391be54e | 2026-10-29 | |
| MT-08 | One loading glyph and plain icons across the app | signed off | dee2391be54e | 2026-10-29 | |
| MT-09 | Search exclusions of Find in Files' own | signed off | dee2391be54e | 2026-10-29 | |
| MT-10 | Per-project search exclusions and the project settings dialog | signed off | dee2391be54e | 2026-10-29 | |
| MT-11 | A dev build on another checkout's daemon says so | signed off | dee2391be54e | 2026-10-29 | |
| MT-12 | The terminal find bar sits above link underlines | signed off | dee2391be54e | 2026-10-29 | |
| MT-13 | Show results collapsed or expanded | signed off | dee2391be54e | 2026-10-29 | |
| MT-14 | Open In offers Current Editor for a file already open | signed off | dee2391be54e | 2026-10-29 | |
| MT-15 | The grouping preference follows the panel | signed off | dee2391be54e | 2026-10-29 | |
| MT-16 | Markdown results in a preview | signed off | dee2391be54e | 2026-10-29 | |

## MT-01: A running search looks busy and stays usable

Covers: FR-001, FR-001a, FR-002, FR-003, SC-001, SC-008
Paths: `packages/ui/src/renderer/find-in-files/find-in-files-panel.tsx`, `packages/ui/src/renderer/find-in-files/results-list.tsx`, `packages/ui/src/renderer/find-in-files/find-in-files.css`, `packages/core/src/config/theme.ts`, `packages/ui/src/renderer/common/busy-glyph.tsx`, `packages/ui/src/renderer/common/busy-glyph.css`

Setup: open a large project (the throng repo itself works), press `Ctrl+Shift+F`, and search for `e` so the scan takes a few seconds.

### Steps
1. Watch the control to the right of the scope box while the scan runs. It shows ◜ in place of the search icon, turning in place around its own centre — it does not drift, wobble or resize the button.
2. Hover it. It shows ✕ and its tooltip reads "Cancel search". Move away: the turning glyph is back.
3. While rows are still arriving, double-click one. The file opens at the match, and the scan carries on.
4. While rows are still arriving, right-click a row. The menu opens; Open In works; Replace All, Replace in … and Replace Match in … are greyed out.
5. Let the scan finish. The turning glyph is replaced by the search icon at the moment the status line stops saying it is searching.
6. Start another search with the pointer resting on the cancel control's position. When it starts, the control shows the turning glyph, not a static ✕.
7. Turn on Windows' "Show animations" off setting (Settings › Accessibility › Visual effects › Animation effects off) and search again. The busy glyph is shown, not turning.

### Negative cases
- Rows arriving during the scan never move which row is highlighted as selected, and never move keyboard focus out of where you left it.
- Hover the cancel control, then switch to another window and back. Note whether the control is left showing ✕ — report it either way.

## MT-02: Cancel keeps what was found

Covers: FR-003a, FR-003b, FR-003c, FR-003d, SC-007
Paths: `packages/ui/src/renderer/find-in-files/find-in-files-store.ts`, `packages/ui/src/renderer/find-in-files/find-in-files-panel.tsx`

Setup: as MT-01 — a search for `e` in a large project.

### Steps
1. Click the cancel control part-way through the scan. The rows already listed stay, with their headings and counts. The status line says the search was cancelled and gives the count listed.
2. Read the notice bar under the form. It says the search was cancelled and the results are partial, and that Replace All acts only on the results listed below.
3. Wait a few seconds. No further rows appear after the cancel.
4. Turn Replace on, type a replacement, and right-click a row. Replace in … and Replace Match in … are available again.
5. Run the search again. The list starts over and the partial notice goes away.

### Negative cases
- Cancel immediately, before any row appears. The list is empty, reads cancelled, and no partial notice is shown.
- Search for something that hits the 20,000-match cap, then cancel. Only ONE notice says the list is partial.

## MT-03: Headings, tooltips and result rows read cleanly

Covers: FR-004, FR-005, FR-006, FR-007, FR-008, FR-013b, SC-004
Paths: `packages/ui/src/renderer/find-in-files/results-list.tsx`, `packages/ui/src/renderer/find-in-files/find-in-files.css`

Setup: search for a word that appears in files in several folders, including two files with the same name in different folders (e.g. `index.ts`).

### Steps
1. Group by file. Each file heading shows the file name in bold, followed by its folder in smaller, muted, non-bold text. The two same-named files are told apart by their folders.
2. Group by folder and file. File headings show only the file name; folder headings show their folder path.
3. In each grouping, hover a folder heading and a file heading. The tooltip shows the full project-relative path.
4. Read a result row. The matched text comes first, then the position in brackets, e.g. `… some matched text … (12:5)`.
5. Compare a row with its heading. The row is indented further than the heading's chevron, lining up under the heading's text. Rows are not bold; headings are.
6. Narrow the panel until headings run out of room. Under Group by file, the muted folder truncates before the file name does.
7. In each of the three groupings, read every heading's count. It is in brackets, e.g. `(3)`, matching the rows' `(12:5)`.

### Negative cases
- No file heading's bold name contains a `/` in any grouping.
- A file in the project root shows no folder text under Group by file.

## MT-04: Matches and icons in every theme

Covers: FR-009, FR-010, FR-011, FR-011a, SC-002, SC-009
Paths: `packages/ui/src/renderer/search/find-bar.css`, `packages/ui/src/renderer/find-in-files/find-in-files.css`, `packages/ui/src/renderer/find-in-files/results-list.tsx`, `packages/ui/src/renderer/explorer/tree-icons.ts`, `packages/core/src/config/theme.ts`

### Steps
1. Search for a word that also appears in a file you open in an editor. Press `Ctrl+F` in that editor and search the same word. A match in the results list and a match in the editor look the same: same fill, same outline — and the whole box, top and bottom border included, is visible in the result row.
2. Switch through every bundled theme (Preferences › Themes). In each, matches in the results are easy to see against the row.
3. Select a row. Its match takes the stronger "current match" look, like the editor's current match.
4. Compare file icons in the results with the same files in the File Explorer (a `.ts`, a `.json`, a `.md`, an image). Each shows the same icon in both places.
5. Under Group by folder and file, collapse a folder heading. Its icon changes from open folder to closed folder, as in the explorer.
6. In the default theme, look at every icon in the Find in Files toolbar, grouping controls and headings. Each is a plain single-colour glyph; none is a colour emoji.

### Negative cases
- With Replace on, the struck-through original still reads as faded and the replacement is clearly distinct from it.

## MT-05: Folder structure grouping

Covers: FR-011b, FR-012, FR-013, FR-013a, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, SC-003
Paths: `packages/core/src/search/file-search.ts`, `packages/ui/src/renderer/find-in-files/find-in-files-panel.tsx`, `packages/ui/src/renderer/find-in-files/results-list.tsx`, `packages/ui/src/renderer/find-in-files/content-menu.ts`, `packages/ui/src/renderer/find-in-files/find-in-files-store.ts`, `packages/ui/src/main/file-search-service.ts`, `packages/core/src/config/settings-metadata.ts`

Setup: search for a word with matches at several folder depths.

### Steps
1. Click the third grouping control (tooltip "Group by folder structure", icon ⋔). The results become a folder tree: one heading per folder level, files under their folders, matches under their files, everything expanded. No new search ran.
2. Compare the tree with the File Explorer. Folders come before files at each level, in the same order the explorer shows.
3. Find a folder that holds only one sub-folder. Both levels have their own heading; they are not merged into one row.
4. Read the counts on folder headings. Each is the total of matches beneath it.
5. Double-click a folder heading: it collapses; double-click again: it expands. Use the menu's Collapse all and Expand all: every level follows.
6. Right-click the list. The menu shows Group by folder structure ✓ beside the other two grouping items.
7. Change Preferences › File Explorer sort order to the other value. The tree's order follows it.
8. Scope the search to a sub-folder (type it in the scope box) and run. The tree starts at that folder's children, with no empty levels above.
9. Type an absolute path to a sub-folder in the scope box, run, and switch to Folder structure. The tree starts at that folder.
10. Edit a file listed in the results and save it. Its file heading is marked as changed; no folder heading is.
11. With a sub-folder-scoped search showing, tear its tab off into a sub-workspace and choose Folder structure there. The tree starts at the scoped folder, as in the main window.
12. Open Preferences › Search · Find in Files. "Find in Files groups results by" offers Folder structure; File is still the default. Choose it, close Preferences, open a new Find in Files panel and search: it opens in Folder structure.

### Negative cases
- Switching between the three groupings never changes the total match count.
- Editing the scope box without running does not reshape the tree.

## MT-06: Selecting results with mouse and keyboard

Covers: FR-015a, FR-020, FR-020a, FR-021, SC-006
Paths: `packages/ui/src/renderer/find-in-files/results-list.tsx`

### Steps
1. Single-click a result row. It becomes selected (highlighted) and no file opens.
2. Double-click it, or press `Enter`. The file opens at the match.
3. Single-click a heading's name. The heading becomes selected and stays expanded. Click its chevron: it collapses (and the click does not change the selection).
4. Click into the list with nothing selected and press `↓`. The first item is selected. Keep pressing `↓` past the bottom of the visible list: the list scrolls with the selection.
5. Select a row, then switch grouping. The same row is still selected and is scrolled into view.
6. Under Group by folder and file, select a folder heading, then switch to Group by file. The selection moves to the first row that was under that folder.

### Negative cases
- Ctrl-, Shift- or Alt-click on a row or heading does nothing.
- With nothing selected, pressing `Enter` opens nothing.

## MT-07: A shorter, narrower panel menu

Covers: FR-022, FR-023, FR-041, FR-042, SC-005
Paths: `packages/ui/src/renderer/find-in-files/content-menu.ts`, `packages/ui/src/renderer/find-in-files/find-in-files-panel.tsx`, `packages/core/src/search/path-label.ts`

### Steps
1. Right-click anywhere in a Find in Files panel, with and without a search running. The menu has no Run search, Cancel search or Change scope item, and no Replace toggle, Use search exclusions, Group by rows or Split.
2. Run, cancel and change scope still work from the panel itself: the search/cancel control, `Enter` in the search box, `Ctrl+Shift+F`, and the scope box.
3. With Replace on, right-click a result in a deeply nested file. Replace in … and Replace Match in … name the file as `…/folder/file.ext`, and the menu is no wider than for a file at the root.
4. The toolbar still switches Replace, the exclusions and the grouping, and the panel header's menu still offers Split.
5. In each grouping, right-click a file heading and choose Open In › Last Active Editor. The file opens at its first line, not at a match.

### Negative cases
- A file whose path is short appears in full, with no leading `…`.
- Over a folder heading, Open In is drawn but disabled.

## MT-08: One loading glyph and plain icons across the app

Covers: FR-001a, FR-001b, FR-002, FR-011a, FR-011c, SC-009
Paths: `packages/core/src/config/theme.ts`, `packages/core/src/config/shipped-defaults.ts`, `packages/ui/src/renderer/common/busy-glyph.tsx`, `packages/ui/src/renderer/common/busy-glyph.css`, `packages/ui/src/renderer/common/loading.tsx`, `packages/ui/src/renderer/common/loading.css`, `packages/ui/src/renderer/app-close-prompt.tsx`, `packages/ui/src/renderer/theme.css`, `packages/ui/src/main/icon-pack-service.ts`

### Steps
1. Start throng with a slow first load (a large project list). If a loading indicator shows, it is ◜ turning in place, the same as the Find in Files busy control.
2. Open a Markdown file with a Mermaid diagram and open its preview. While the diagram draws, the indicator is the same ◜, turning the same way.
3. Close throng with a terminal still running and confirm the close. The closing overlay shows the same ◜, turning in place.
4. Look at the File Explorer in the default theme. Folder, open-folder and file icons are plain single-colour glyphs, and match the icons on the Find in Files headings for the same files.
5. Press `Ctrl+F` in an editor. The find bar's search icon is the same plain glyph as Find in Files' search control.
6. Look at the File Explorer toolbar. Every control is a plain glyph at one visual weight; Find in Files ⧈, Quick Open ⊳ and the find bar's search ⌕ are three different glyphs.
7. On an install that already ran an earlier build of this branch, open the File Explorer after updating. Its icons show the new plain glyphs without resetting the theme.

### Negative cases
- With Windows animation effects off, none of the loading indicators turns, and each is still shown.
- A theme that sets its own glyph for a file or folder icon still shows that glyph.

## MT-09: Search exclusions of Find in Files' own

Covers: FR-025, FR-026, FR-027, FR-027a, FR-028, FR-029, FR-031, FR-032, FR-038, FR-039, SC-010, SC-011
Paths: `packages/core/src/search/search-exclude.ts`, `packages/core/src/config/app-settings.ts`, `packages/core/src/config/settings-metadata.ts`, `packages/ui/src/main/file-search-service.ts`, `packages/ui/src/main/file-search-ipc.ts`, `packages/ui/src/main/main.ts`, `packages/ui/src/renderer/find-in-files/find-in-files-panel.tsx`, `packages/ui/src/renderer/find-in-files/find-in-files-store.ts`, `packages/ui/src/renderer/find-in-files/panel-config.ts`, `packages/ui/src/renderer/find-in-files/content-menu.ts`, `packages/ui/src/renderer/find-in-files/find-in-files.css`

Setup: a project with the word `needle` in `src/a.ts`, `dist/b.js`, `node_modules/x/c.js` and `fixtures/d.txt`.

### Steps
1. Open Find in Files and search for `needle`. Only `src/a.ts` and `fixtures/d.txt` are listed; `dist` and `node_modules` still show in the File Explorer.
2. Hover the panel's exclusions toggle. It reads "Global search exclusions enabled. Edit 'Excluded from search' in Preferences to change." Click it. It shows as off, and its tooltip now reads "…disabled…". Search again: all four files are listed.
3. Right-click the panel. The menu offers the same toggle, showing the same state.
4. Turn the toggle back on. Type `**/fixtures` in the panel's exclusions box. `fixtures/d.txt` drops out of the results.
5. Turn the toggle off with the box still filled. `dist` and `node_modules` matches return; `fixtures/d.txt` stays out.
6. Restart throng. The restored panel still has the toggle off and `**/fixtures` in the box.
7. Open a new Find in Files panel. Its toggle is on and its box is empty.
8. Open Preferences › Search · Find in Files. The exclusion list shows the File Explorer's defaults followed by `**/dist`, `**/build`, …, `**/yarn.lock`. Remove `**/dist`, close Preferences, and search in a new panel: `dist/b.js` is listed.
9. In Preferences, turn the default for new panels off. A new panel opens with its toggle off.
10. In Preferences › File Explorer, remove `**/node_modules` from the excluded globs. `node_modules` appears in the tree; a search with the toggle on still leaves out `node_modules/x/c.js`.

### Negative cases
- Hiding `src` from the File Explorer (Hide in this project) does not remove `src/a.ts` from the results.
- Typing `[` in the exclusions box shows one inline notice naming it; the rest of the box still applies.
- Searching with the scope set to `dist/b.js` finds its match even with the toggle on.

## MT-10: Per-project search exclusions and the project settings dialog

Covers: FR-030, FR-033, FR-034, FR-035, FR-036, FR-037, FR-040, FR-044, SC-012
Paths: `packages/ui/src/renderer/project-settings/project-settings-dialog.tsx`, `packages/ui/src/renderer/project-settings/project-settings.css`, `packages/ui/src/renderer/panes/file-explorer-pane.tsx`, `packages/ui/src/renderer/explorer/context-menu-items.ts`, `packages/ui/src/renderer/explorer/file-tree.tsx`, `packages/ui/src/renderer/state/projects-store.tsx`, `packages/ui/src/renderer/state/projects-client.ts`, `packages/ui/src/renderer/find-in-files/content-menu.ts`, `packages/core/src/projects/project.ts`, `packages/daemon/src/project-service.ts`, `packages/persistence/src/project-repository.ts`, `packages/core/src/config/theme.ts`, `packages/ui/src/main/icon-pack-service.ts`

Setup: two projects, A and B, each with `needle` in `src/a.ts` and `generated/g.ts`.

### Steps
1. Look at the File Explorer toolbar. The project settings control shows ⌂; Preferences elsewhere still shows ⚙.
2. Click ⌂. The dialog keeps its "<project> — project settings" title and shows two sections: Hidden in File Explorer, then Hidden to Find & Replace, each with its own add box and a note naming the global list that also applies.
3. In Hidden to Find & Replace, add `**/generated`. Close the dialog. Search `needle` in project A with the panel's toggle off: `generated/g.ts` is not listed.
4. Switch to project B and search there. `generated/g.ts` is listed.
5. In project B's File Explorer, right-click `generated` and choose Exclude from Find in Files in this project. Search again: `generated/g.ts` is no longer listed, and the folder still shows in the tree.
6. In project B's results, right-click the `src/a.ts` heading and choose Exclude from Find in Files in this project. Run the search again: `src/a.ts` is gone.
7. Reopen the dialog. Both lists show their entries; remove one with its ✕ and the next search lists it again.
8. Add 30 entries to one list. That list scrolls on its own; the other section and the title row's ✕ stay in view.
9. In Hidden in File Explorer, type a project-relative path in the add box and add it. The entry hides from the tree, and a search still finds it.
10. Look at either list. Each row's remove ✕ sits directly under its section's add ＋. There is no Close button at the foot; the ✕ at the top right closes the dialog.
11. Click the ⚙ beside either section heading. The dialog closes and Preferences opens on its Settings tab.
12. Restart throng. Each project's Hidden to Find & Replace list is as you left it.

### Negative cases
- An entry in project A's list never affects project B's results.
- Turning the panel's toggle off never brings back a file excluded by the project's list.

## MT-11: A dev build on another checkout's daemon says so

Covers: #533
Paths: `packages/ui/src/main/daemon-lifecycle.ts`, `packages/ui/src/main/main.ts`, `packages/ui/src/preload/preload.cts`, `packages/ui/src/renderer/statusbar/daemon-indicator.tsx`

Setup: another checkout's dev daemon is on the dev pipe and on a different build — as now, the `S055-I5-I133-resource-monitor` worktree's.

### Steps
1. Start throng from this worktree (`npm start`). One warning notice says the window is running on another checkout's daemon and names `S055-I5-I133-resource-monitor`.
2. Look at the status bar. The daemon indicator shows; its hover title names the full path of that checkout and says clicking replaces it and ends its terminals.
3. Click the indicator. It reads "Restarting daemon…", then disappears.
4. Add a Find in Files exclusion from the explorer menu. It succeeds — no "Method not found".

### Negative cases
- With this build's own daemon serving (after step 4, or after restarting throng), no notice and no indicator appear.
- An installed throng's daemon is never replaced by this action.

## MT-12: The terminal find bar sits above link underlines

Covers: terminal find bar layering
Paths: `packages/ui/src/renderer/terminal/terminal.css`, `packages/ui/src/renderer/search/find-bar.css`

Setup: a terminal panel.

### Steps
1. In the terminal, print a few URLs on the top rows: `echo https://example.com/a https://example.com/b` several times, then `clear` and print them again so they sit on row one.
2. Press Ctrl+F. The find bar covers the top-right; no link underline shows through or over it.
3. Hover a link next to the bar. Its solid hover underline stays beneath the bar.
4. Scroll so the scrollbar shows. The bar stays on top of it.

### Negative cases
- Links outside the bar still show their dashed underline, and Ctrl+click still follows them.

## MT-13: Show results collapsed or expanded

Covers: FR-043
Paths: `packages/core/src/config/app-settings.ts`, `packages/core/src/config/settings-metadata.ts`, `packages/ui/src/renderer/find-in-files/find-in-files-panel.tsx`

Setup: a search that matches in several files; two Find in Files panels open.

### Steps
1. Open Preferences › Search · Find in Files. **Show results** reads Expanded. Results show with every heading open.
2. Click the panel's Show results toggle (beside the grouping controls). Every heading in both panels closes, the toggle shows pressed, and Preferences now reads Collapsed.
3. Open one heading by hand, then search for a different word. Its headings start closed; a heading you opened stays open if it appears again.
4. Use Expand all from the panel's menu, then Collapse all. Each does what it says.
5. Set Show results back to Expanded in Preferences. Every heading opens, including any closed by hand.

### Negative cases
- Toggling Show results never starts a new search.

## MT-14: Open In offers Current Editor for a file already open

Covers: FR-045
Paths: `packages/ui/src/renderer/editor/open-in-targets.ts`, `packages/ui/src/renderer/editor/open-in-perform.ts`, `packages/ui/src/renderer/find-in-files/result-open.ts`, `packages/ui/src/renderer/find-in-files/find-in-files-panel.tsx`, `packages/ui/src/renderer/explorer/file-tree.tsx`, `packages/ui/src/renderer/links/link-open-in.ts`, `packages/ui/src/renderer/links/link-menu.ts`, `packages/ui/src/renderer/links/file-link-menu.ts`

Setup: two tabs; a search for a word that matches several lines of `src/a.ts`; a terminal that has printed `src/a.ts:10`.

### Steps
1. With `src/a.ts` closed, right-click a result row › Open In. Last Active Editor, New Editor and Other Tab are offered and work as before.
2. Open `src/a.ts` in an editor, then move focus to another editor. Right-click a different result row in that file › Open In. One Current Editor row replaces Last Active Editor and New Editor; Other Tab's entries are drawn disabled.
3. Choose Current Editor. The editor holding `src/a.ts` takes focus and shows that row's match. Repeat on a third row: it jumps there too.
4. In the File Explorer, right-click `src/a.ts` › Open In. The same Current Editor row shows, and choosing it focuses that editor.
5. Ctrl+right-click the `src/a.ts:10` link in the terminal › Open In. Current Editor shows in place of New Editor and Active Editor, named editors are disabled, and choosing it focuses the editor at line 10.

### Negative cases
- No choice ever opens a second editor for `src/a.ts`, or moves it to another editor or tab.

## MT-15: The grouping preference follows the panel

Covers: FR-046
Paths: `packages/core/src/config/app-settings.ts`, `packages/core/src/config/settings-metadata.ts`, `packages/ui/src/renderer/find-in-files/find-in-files-panel.tsx`, `packages/ui/src/renderer/find-in-files/find-in-files-store.ts`, `packages/ui/src/renderer/find-in-files/find-in-files-chrome.tsx`

Setup: a search with results; two Find in Files panels open; Preferences open on Search · Find in Files.

### Steps
1. Preferences shows **Find in Files groups results by** and no "Keep the grouping you chose" row.
2. In one panel, click Folder structure. Both panels regroup, and Preferences now reads Folder structure.
3. In Preferences, set the grouping to Folder, then file. Both panels switch to it.
4. Open a new Find in Files panel. It opens in the grouping Preferences shows.

### Negative cases
- Switching the grouping never starts a new search.

## MT-16: Markdown results in a preview

Covers: FR-047, FR-048, FR-049
Paths: `packages/ui/src/renderer/preview/preview-search.ts`, `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/preview/preview-open-in.ts`, `packages/ui/src/renderer/explorer/file-tree.tsx`, `packages/ui/src/renderer/explorer/context-menu-items.ts`, `packages/ui/src/renderer/find-in-files/content-menu.ts`, `packages/ui/src/renderer/find-in-files/find-in-files-panel.tsx`, `packages/ui/src/renderer/find-in-files/find-in-files-chrome.tsx`, `packages/ui/src/renderer/find-in-files/result-open.ts`

Setup: a search that matches several lines of a `.md` file; Markdown's default open action set to Preview.

### Steps
1. Double-click a `.md` result. The preview scrolls to it, and the match has the same fill and bright 2 px frame as find's current match in an editor or a terminal.
2. Scroll the preview and resize the panel. The frame stays on the match.
3. Right-click a `.md` result row › Open In. Below the editor targets, divided from them, are Last Preview Panel (naming the preview it would reuse) and New Preview Panel, as in the File Explorer's Open In for that file.
4. Choose New Preview Panel. A new preview opens at that match, highlighted as in step 1.
5. Right-click the `.md` file heading › Open In › Last Preview Panel. The preview shows the file from its top.
6. Right-click a `.ts` result › Open In. No preview rows are offered.

### Negative cases
- With the file's preview already open, Open In shows one Current Preview row (result row, heading and File Explorer alike) in place of Last / New Preview Panel; choosing it on a result row focuses that preview at the match.
- Pressing Ctrl+F in the preview afterwards replaces the revealed match's frame with find's own matches.
