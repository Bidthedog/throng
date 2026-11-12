# Manual test plan: workspace and OS integration (067)

Spec: `specs/067-workspace-and-os-integration/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Paste files between throng and the file manager | signed off | 27cde44adc69 | 2026-11-10 | |
| MT-02 | Drag files in and out | signed off | ea1a1c6040ce | 2026-11-12 | |
| MT-03 | Open in OS Default Program | signed off | 3b0dcf952191 | 2026-11-12 | |
| MT-04 | Open a folder from a terminal | signed off | b7f0c7469cd6 | 2026-11-12 | |
| MT-05 | Installers on Windows | signed off | 27cde44adc69 | 2026-11-10 | |
| MT-06 | File-manager items on Linux | signed off | 27cde44adc69 | 2026-11-10 | |
| MT-07 | Cancel a shutdown | signed off | ea1a1c6040ce | 2026-11-12 | |
| MT-08 | Properties dialog | signed off | 3b0dcf952191 | 2026-11-12 | |
| MT-09 | Side panes per project | signed off | 27cde44adc69 | 2026-11-10 | |
| MT-10 | Terminal form history | signed off | d0e7b9fd80dc | 2026-11-12 | |
| MT-11 | Editor save icons | signed off | 27cde44adc69 | 2026-11-10 | |
| MT-12 | Rename a tab from the keyboard | signed off | 27cde44adc69 | 2026-11-10 | |
| MT-13 | Create a sub-workspace directly | signed off | 27cde44adc69 | 2026-11-10 | |
| MT-14 | Links in Markdown front matter | signed off | d0e7b9fd80dc | 2026-11-12 | |
| MT-15 | Total lines in the status strip | signed off | d0e7b9fd80dc | 2026-11-12 | |
| MT-16 | Resource popup hover delay | signed off | 3b0dcf952191 | 2026-11-12 | |
| MT-17 | Double-click a file throng cannot open | signed off | 3b0dcf952191 | 2026-11-12 | |
| MT-18 | Click the resource popup | signed off | 27cde44adc69 | 2026-11-10 | |
| MT-19 | Preferences and About stay on top | signed off | ea1a1c6040ce | 2026-11-12 | XWayland only; native Wayland is a documented limit (research D25, T140) |

## MT-01: Paste files between throng and the file manager

Covers: FR-001, FR-002, FR-003, FR-006, FR-007, FR-008, FR-009, FR-010, SC-001, SC-002
Paths: `packages/core/src/explorer/paste-source.ts`, `packages/core/src/abstractions/clipboard.ts`, `packages/platform-windows/src/windows-file-list-codec.ts`, `packages/platform-linux/src/linux-file-list-codec.ts`, `packages/ui/src/main/electron-clipboard.ts`, `packages/ui/src/main/file-clipboard.ts`, `packages/ui/src/main/transfer-*.ts`, `packages/ui/src/renderer/explorer/use-explorer-data.ts`

### Steps
1. In your file manager copy a file and a folder. Right-click a folder in throng's tree and choose **Paste**. Both appear in that folder.
2. Press **Undo** in the tree. Both disappear from the folder, and the originals are untouched. Redo brings them back.
3. Cut a file in your file manager and paste it in the tree. It leaves the source and appears in the tree.
4. Copy a file in the tree and paste in your file manager. A copy arrives and the tree still shows the original.
5. Cut a file in the tree and paste in your file manager. It arrives there and leaves the tree.
6. Repeat steps 1 to 5 on Windows and on Linux with each of Nemo, Dolphin and GNOME Files, on X11 and on Wayland.

### Negative cases
- Copy a file in throng, then copy different text in another program. **Paste** in the tree does not paste the old file.
- Paste a file over one of the same name. The existing replace prompt appears.
- A cut, copy and paste wholly inside throng behaves as it did.
- Copy another project's root folder in your file manager and paste it into a project. A copy arrives and the other project is untouched. Cut the same folder and paste. It is refused, naming that the project root cannot be moved.

## MT-02: Drag files in and out

Covers: FR-004, FR-005a, FR-011, FR-012, FR-013, FR-014, SC-001, FR-110, FR-111, FR-112, FR-113, FR-114, FR-115
Paths: `packages/core/src/explorer/inbound-drag.ts`, `packages/ui/src/renderer/common/os-drop-paths.ts`, `packages/ui/src/renderer/explorer/file-tree.tsx`, `packages/ui/src/renderer/explorer/tree-node.tsx`, `packages/ui/src/renderer/explorer/use-elevated-drop-notice.ts`, `packages/ui/src/renderer/editor/drop-target.tsx`, `packages/ui/src/renderer/explorer/tree-pointer-backend.ts`, `packages/ui/src/renderer/explorer/tree-node.tsx`, `packages/ui/src/renderer/explorer/explorer.css`, `packages/ui/src/main/os-drag.ts`

### Steps
Use throwaway files.
1. Inside the tree, drag a file onto a folder with no key held. The pointer shows a move, and the file moves.
2. Press **Ctrl**, then drag a file onto a folder. The pointer shows a copy, and the file is copied.
3. Press **Shift**, then drag a file onto a folder. The pointer shows a move, and the file moves.
4. Drag a file to a folder, pause, then press **Ctrl**. The pointer changes to a copy. Release **Ctrl** and it changes back. Press it again and drop: the file is copied.
5. Drag a file to a folder, pause, then press **Shift** and drop. The file moves.
6. Drag over something that cannot take a drop. The pointer shows not-allowed.
7. Start a drag and press **Esc**. It ends with nothing changed.
8. In a long tree, hold a drag near the top or bottom edge. The tree scrolls.
9. Select several rows and drag them onto a folder. All of them arrive.
10. Drag a file from the tree onto an editor panel, a terminal panel, an empty panel, a tab and the new-tab area. Each does what it did before.
11. Drag a row out of the window into your file manager. A real copy arrives and the original stays. Do the same with several rows selected.
12. Drag a file in from your file manager onto a folder in the tree. A label beside the pointer says **Copy** and it is copied in.

### Negative cases
- On Windows with throng elevated, the first file drag over the tree shows one notice saying Windows blocks drops from unelevated programs, once per session.
- Drop a file where no project is open. It is refused with one notice.

## MT-03: Open in OS Default Program

Covers: FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, SC-003
Paths: `packages/ui/src/main/files-service.ts`, `packages/ui/src/main/files-ipc.ts`, `packages/ui/src/renderer/explorer/context-menu-items.ts`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`

### Steps
1. Right-click a PDF in the tree and choose **Open in OS Default Program**. It opens in the program your OS uses for PDFs.
2. Open a file in an editor panel and choose the same item on the panel's title menu. It opens in the OS program.
3. In Preferences turn off **Show Open in OS Default Program**. Both menu items disappear.

### Negative cases
- A folder row does not offer the item.
- A file with no registered program shows one notice with the OS's reason.

## MT-04: Open a folder from a terminal

Covers: FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-035, SC-004
Paths: `packages/core/src/projects/launch-folder.ts`, `packages/core/src/projects/open-folder.ts`, `packages/core/src/config/instance-identity.ts`, `packages/ui/src/main/instance-guard.ts`, `packages/ui/src/main/open-folder-queue.ts`, `packages/ui/src/renderer/sidebar/open-folder-listener.tsx`

### Steps
1. With throng closed, type `throng .` in a folder that is not a project. Throng starts showing it as a project.
2. With throng running, type `throng ../other` from another terminal. No second throng starts, the window comes forward within 5 seconds and the project shows.
3. Open a folder whose path has spaces and non-ASCII characters. It opens correctly.
4. Open a folder inside an existing project. That project is selected and nothing is added.
5. Set **Folder opened from outside throng** to `load` and open another folder. It is added without switching to it.
6. Open a dialog in throng, then run the command. The project appears once you close the dialog.

### Negative cases
- Open a folder that contains a project. One notice names that project and nothing is added.
- Open a missing path, then a file. One notice names each and nothing is added.
- On Windows with throng running elevated, run the command from a normal terminal. You are told the path could not be opened.
- Run the command while throng is closing. It opens once the old window is gone.

## MT-05: Installers on Windows

Covers: FR-028, FR-029, FR-030, FR-031, FR-032, FR-034, FR-036
Paths: `packaging/installer.nsh`, `packages/core/src/config/msi-project.ts`, `packages/platform-windows/src/windows-file-manager-registration.ts`, `packages/ui/src/renderer/preferences/file-manager-item-control.tsx`

### Steps
1. Run the setup for **Only for me**. A page offers the File Explorer item and `PATH`, both ticked. Finish it.
2. Right-click a folder, then a folder's background, under **Show more options**. **Open as throng project** is offered and opens that folder.
3. Open a new terminal and type `throng`. Throng opens.
4. In Preferences turn the item off. It leaves File Explorer's menu. Turn it on. It returns.
5. Run the MSI for **Only for me** and check steps 2 and 3 again.
6. Uninstall each. The menu item and the `PATH` entry are gone.
7. Install for **Anyone who uses this computer**. In Preferences the control is disabled and says why.

### Negative cases
- Untick both in the setup. Nothing is added to the menu or `PATH`.
- A portable copy shows the control disabled with the reason, and adds nothing.

## MT-06: File-manager items on Linux

Covers: FR-033, FR-034, FR-036, FR-032
Paths: `packaging/linux/**`, `packages/platform-linux/src/linux-file-manager-registration.ts`, `packages/ui/src/renderer/preferences/file-manager-item-control.tsx`

### Steps
1. Install the `.deb`. In Nemo, right-click a folder. **Open as throng project** is offered and opens it.
2. Do the same in Dolphin.
3. In GNOME Files, right-click a folder and choose **Open With**. **Open as throng project** is listed and opens it. Note what GNOME actually shows.
4. Turn the item off in Preferences. It leaves Nemo and Dolphin, and the Open With list. No password is asked for.
5. Turn it on. It returns.
6. Repeat steps 1 to 5 on X11 and on Wayland, and with the `.rpm`.
7. Remove the package. The item is gone from each file manager.

### Negative cases
- The archive build shows the control disabled with the reason.

## MT-07: Cancel a shutdown

Covers: FR-037, FR-038, FR-039, FR-040, FR-041, FR-042, FR-043, FR-044, SC-005
Paths: `packages/core/src/workspace/shutdown-run.ts`, `packages/ui/src/main/shutdown-driver.ts`, `packages/ui/src/main/main.ts`, `packages/ui/src/renderer/app-close-prompt.tsx`, `packages/ui/src/renderer/terminal/app-terminating.ts`

### Steps
1. Open terminals in two projects, close throng and choose **Terminate all**. One block per project fills in order, the current one highlighted, with a remaining time.
2. Hover a block, then focus it with the keyboard. Each shows what that task is doing.
3. Close again and press **Cancel** during the blocks. The overlay goes within 6 seconds and throng is usable. Terminals not yet ended still work.
4. Close with no terminals open. The overlay finishes and throng closes.

### Negative cases
- The remaining time does not jump wildly.
- After Cancel, no panel is shown as open when its terminal has gone.
- After a finished Terminate all, no terminal process is left running.

## MT-08: Properties dialog

Covers: FR-045, FR-046, FR-047, FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, SC-006, SC-007, FR-119, FR-120, FR-121, FR-122, FR-128
Paths: `packages/ui/src/main/properties-service.ts`, `packages/platform-windows/src/windows-file-attributes.ts`, `packages/platform-windows/src/windows-os-properties-dialog.ts`, `packages/platform-linux/src/linux-file-attributes.ts`, `packages/ui/src/renderer/explorer/properties-dialog.tsx`, `packages/ui/src/renderer/explorer/properties-dialog.tsx`, `packages/platform-linux/src/linux-file-access-info.ts`, `packages/platform-windows/src/windows-file-access-info.ts`, `packages/ui/src/renderer/explorer/context-menu-items.ts`

### Steps
1. Right-click a file and choose **Properties**. The dialog appears at once with name, full path, type, size, attributes and three dates.
2. Copy the path from the dialog and paste it elsewhere. It is the full path.
3. Open it on a large folder. The figures fill in, labelled as still calculating, while the rest of throng stays smooth.
4. Select several items and open it. The size and counts are combined.
5. Use the reveal action. Your file manager opens with the item selected.
6. On Windows use the OS properties action. Windows' own dialog opens. On a junction, the type reads junction.
7. Click the X at the top right. The dialog closes. There is no Close button.
8. Open it again and click outside it, on the dimmed area. It closes.
9. Press the copy button beside any value and paste somewhere. That value arrives.
10. On Linux, open it for one file. Owner, group and permissions show, and there is no message about OS properties.
11. Right-click a file, then a folder. **Properties** is the last item of each menu.

### Negative cases
- On Linux the OS properties action is disabled and says why.
- A folder you cannot read adds to a skipped count rather than an error.
- Nothing in the dialog offers to edit attributes.

## MT-09: Side panes per project

Covers: FR-056, FR-057, FR-058, FR-059, FR-060, SC-008
Paths: `packages/core/src/workspace/model.ts`, `packages/ui/src/renderer/app.tsx`, `packages/ui/src/renderer/state/workspace-store.tsx`

### Steps
1. In one project collapse the Projects pane, in another collapse the File Explorer pane. Switch between them. Each shows its own.
2. Restart throng. Each project still shows its own.
3. Make the window narrow until a pane collapses by itself, then widen it. Switch project and back. The stored state has not changed.

### Negative cases
- A project never toggled opens with both panes expanded.

## MT-10: Terminal form history

Covers: FR-061, FR-062, FR-063, FR-064, FR-064a, FR-064b, FR-065, FR-066, FR-067, FR-068, SC-009, FR-129, FR-130, FR-133, FR-135
Paths: `packages/core/src/terminal/form-history.ts`, `packages/ui/src/main/form-history-service.ts`, `packages/ui/src/renderer/panel-type/terminal-inputs.tsx`, `packages/ui/src/renderer/preferences/form-history-control.tsx`, `packages/ui/src/renderer/panel-type/history-input.tsx`, `packages/ui/src/renderer/panel-type/use-form-history.ts`, `packages/ui/src/renderer/preferences/settings-tab.tsx`, `packages/ui/src/preload/preload.cts`

### Steps
1. Start a terminal with a startup command. In a new terminal form type its first letters and pick it from the list, in three keystrokes and a selection. The field fills.
2. Restart throng. The value is still offered.
3. Press the clear button beside the field. Only that field's list for that terminal type empties.
4. In Preferences clear one terminal type, then clear all. Each removes just that.
5. Set the number remembered to 1. Only the newest is offered.
6. In an empty Startup Command field, press **Down**. The whole list for that terminal type shows. Type a letter and press **Down**. Only the matches show. **Esc** closes it.
7. Open Preferences at the Terminal section. The clear control sits beside the two form-history settings, not in a section of its own.
8. Leave a new terminal form open in a blank panel, clear all history in Preferences, then press **Down** in that form. Nothing is offered.
9. With at least three remembered values, press **Down**, highlight the middle one and press **Delete**. It leaves the list, the highlight moves to the next value, and the field's text is unchanged.
10. Open another terminal form, and restart throng and open one. The deleted value is not offered in either.
11. Delete values until the list is empty. The list closes.
12. Click into an empty Startup Command field, then into a Shell Arguments field that already holds text. Each shows its whole remembered list straight away.
13. Type a few letters. The list narrows to the matches. Pick one. It replaces what was in the field.

### Negative cases
- Turn the history off. Nothing is offered or recorded, and turning it on brings back what was stored.
- A very long value shows on one truncated line.
- With the list open and nothing highlighted, **Delete** edits the text in the field and removes no value.

## MT-11: Editor save icons

Covers: FR-069, FR-070, FR-071, FR-072, FR-073, FR-074, SC-010, FR-118
Paths: `packages/ui/src/renderer/workspace/panel-header-save-icons.tsx`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/core/src/config/theme.ts`, `packages/core/src/config/shipped-defaults.ts`

### Steps
1. Edit a file. Click the save icon in the panel header. It saves and the dirty mark clears.
2. Click the save-as icon. The save-as dialog opens.
3. Hover each. The tip names the action.
4. Look at the Save and Save As buttons on an editor panel. Both are disk icons, and you can tell them apart.
5. Compare them with the other header icons. They are single-colour like the rest, not colour pictures, and switching theme recolours them.
6. Open the cog menu, an editor's right-click menu, the File Explorer toolbar and Preferences. Every icon is a plain single-colour glyph; none is a colour picture.

### Negative cases
- A panel that is not an editor shows neither.

## MT-12: Rename a tab from the keyboard

Covers: FR-075, FR-076, FR-077, FR-078, FR-079, SC-010
Paths: `packages/core/src/config/keybindings.ts`, `packages/ui/src/renderer/keybindings/window-dispatcher.tsx`, `packages/ui/src/renderer/workspace/tab-group.tsx`, `packages/ui/src/renderer/terminal/use-terminal.ts`

### Steps
1. With focus in a terminal press **Ctrl+Shift+Alt+F2**. The active tab starts renaming. Type a name and press **Enter**. Focus returns to the terminal.
2. Do it again and press **Esc**. The name is unchanged and focus returns.
3. Open the tab's menu. **Rename** shows the chord.

### Negative cases
- A full-screen program in a terminal receives nothing for the chord.
- **F2** in the File Explorer still renames the selected file.

## MT-13: Create a sub-workspace directly

Covers: FR-082, FR-083, FR-084, FR-085, FR-086, SC-011, FR-124
Paths: `packages/daemon/src/subworkspace-service.ts`, `packages/ui/src/renderer/sidebar/subworkspaces-panel.tsx`, `packages/ui/src/renderer/state/subworkspaces-store.tsx`

### Steps
1. Click the **+** in the Sub-workspaces panel header. One appears in the list with a default name and colour, and no window opens.
2. Open it. It has one empty panel.
3. Rename, recolour, reorder and delete one. Each works.
4. Restart throng. The ones you kept are still listed.
5. Press the create button. The new row is ready to rename with its default name selected.
6. Type a name and press **Enter**. It takes that name and opens.
7. Create another and press **Esc**. It keeps the default name and does not open.
8. Create another and click away. It keeps what was typed and does not open.

## MT-14: Links in Markdown front matter

Covers: FR-087, FR-088, FR-089, FR-090, SC-012, FR-123, FR-131, FR-132, SC-015
Paths: `packages/ui/src/renderer/preview/providers/markdown/pipeline.ts`, `packages/ui/src/renderer/editor/editor-open.tsx`, `packages/ui/src/renderer/preview/providers/markdown/sanitise.ts`, `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx`, `packages/ui/src/renderer/preview/link-dom.ts`, `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/core/src/preview/links.ts`, `packages/ui/src/renderer/links/link-actions.ts`, `packages/ui/src/renderer/links/open-unsupported-in-os.ts`, `packages/ui/src/renderer/editor/use-editor.ts`, `packages/ui/src/renderer/terminal/terminal-panel.tsx`

### Steps
1. Preview a Markdown file whose front matter holds a web URL, a Markdown link, a wikilink and a GitHub URL. Each shows as a link in the table.
2. **Ctrl+click** each. Each goes where the same link in the body would go.
3. Give a front matter value a Markdown link to a file relative to the document, and another value a bare relative path to a file. Both render as links and follow on **Ctrl**+click.
4. Preview `/data/storage/git/throng_tests/UPPER TEST/link-types.md` with Show front matter on. Every value except `embed` is a link.
5. **Ctrl**+click `relative_parent`, `rooted_project`, `home_relative`, `absolute` and `file_uri`. Each opens its file.
6. **Ctrl**+click `path_line`, `path_line_column`, `path_line_range` and `path_paren_position`. `test.ts` opens at line 3, then line 3 column 5, `research.md` at lines 10 to 20, then `test.ts` at line 3 column 5.
7. **Ctrl**+click `heading_anchor`. The preview goes to **Local links**.
8. **Ctrl**+click `tel` and `slack`. Each goes to its OS handler, as in the editor.
9. With **Open unsupported files in the OS** on, **Ctrl**+click `office` (a `.docx`) in the table, in the body, in the editor, and the same path printed in a terminal. Each opens in its OS program.
10. Turn that preference off and repeat one of them. The "cannot open" message appears.

### Negative cases
- A plain click follows nothing.
- A front matter value that is a sentence with a path inside it stays text.
- The body preview's `tel:` and `slack://open` lines stay text.

## MT-15: Total lines in the status strip

Covers: FR-091, FR-092, FR-093, FR-094, FR-095, FR-096, FR-097, FR-098, SC-013, FR-125, FR-126, FR-134, FR-136
Paths: `packages/ui/src/renderer/editor/status-strip.tsx`, `packages/ui/src/renderer/editor/status-strip-fit.ts`, `packages/ui/src/renderer/editor/document-metrics-store.ts`, `packages/ui/src/renderer/editor/caret-store.ts`, `packages/ui/src/renderer/editor/use-editor.ts`

### Steps
1. Open a file. The status strip shows its total lines, digit-grouped.
2. Add a line. The figure goes up.
3. Open a 100,000-line file and type. Typing feels no slower.
4. Put the caret on a line. The status bar reads like `Ln 10, Col 45`, then `440 Lines.` `8,000 Chars.` `43 Words.`
5. Select text on one line. The position reads like `Ln 10, Cols 45-56`.
6. Put the caret on a line. The position ends in a full stop: `Ln 10, Col 45.`
7. Select 2 characters on one line of a 25-line file. The bar reads like `Cols 9-15. 2 selected. 25 Lines.`
8. Select from the middle of line 3 to somewhere on line 5, then the same lines from bottom to top. Both read like `Ln 3-5, Col 4.`, the column being where the selection starts.

### Negative cases
- In a narrow panel the readout gives way with the others rather than wrapping.

## MT-16: Resource popup hover delay

Covers: `resourceMonitor.popoverDelayMs`
Paths: `packages/ui/src/renderer/resources/status-resources.tsx`, `packages/core/src/config/settings-metadata.ts`, `packages/core/src/resources/settings-resolution.ts`

### Steps
1. Rest the pointer on the usage figures in the status bar. The popup opens after about half a second.
2. In Preferences, under Resource Monitor, set **Popup delay** to 2,000. Rest the pointer on the figures. The popup opens after about two seconds.
3. Set it to 0. The popup opens as soon as the pointer arrives.
4. Move the pointer from the figures onto the open popup and back. It stays open and does not wait again.

### Negative cases
- With the delay at 2,000, pass the pointer across the figures without stopping. No popup opens.
- Tab to the figures with the keyboard. The popup opens at once, whatever the delay.

## MT-17: Double-click a file throng cannot open

Covers: FR-116, FR-117
Paths: `packages/ui/src/renderer/explorer/tree-node.tsx`, `packages/ui/src/renderer/explorer/use-explorer-data.ts`, `packages/core/src/config/settings-metadata.ts`, `packages/ui/src/renderer/editor/editor-open.tsx`, `packages/ui/src/renderer/explorer/file-tree.tsx`, `packages/core/src/config/app-settings.ts`

### Steps
1. Double-click a binary file, such as a zip, in the tree. It opens in your OS program, or the OS says it cannot.
2. With click-to-open set to a single click, click that file once. No notice appears. Double-click it. It opens in the OS.

### Negative cases
- Turn the preference off and double-click the file. Throng's existing "cannot open" message appears.

## MT-18: Click the resource popup

Covers: FR-127
Paths: `packages/ui/src/renderer/resources/status-popover.tsx`, `packages/ui/src/renderer/resources/status-resources.tsx`, `packages/core/src/config/theme.ts`, `packages/core/src/config/shipped-defaults.ts`

### Steps
1. Rest on the status bar figures until the popup opens, then click the popup. It closes and the Resource Monitor does not open.
2. Click the status bar figures. The Resource Monitor opens.
3. Look at the icons in the status bar figures, the cog menu's Resource Monitor row, and the Resource Monitor toolbar (CPU, memory, GPU, I/O, network, hide idle, hide ended). Every one is single-colour like the rest of throng's icons, not a colour picture.

## MT-19: Preferences and About stay on top

Covers: 007 FR-013, 021
Paths: `packages/ui/src/main/preferences-window.ts`, `packages/ui/src/main/floating-window-layering.ts`

### Steps
1. On Linux, open Preferences and click the main window. Preferences stays above it.
2. Do the same with About.
3. Turn off **Native Wayland** in Preferences, restart throng, and repeat steps 1 and 2. Say which of the two modes kept the windows on top.

### Negative cases
- Switch to another application. Throng's windows, Preferences included, go behind it.
