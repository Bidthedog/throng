# Manual test plan: 050 cross-project clipboard

Spec: `specs/050-cross-project-clipboard/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Copy a file from one project into another | signed off | 5afee2532f8e | 2026-10-04 |  |
| MT-02 | Move a file between projects with its editor open | signed off | 5afee2532f8e | 2026-10-04 |  |
| MT-03 | Name clashes ask first | signed off | 579194a758e4 | 2026-10-04 |  |
| MT-04 | Progress, Cancel, queued pastes and quitting mid-paste | signed off | 579194a758e4 | 2026-10-04 |  |
| MT-05 | Undo a move between projects from either side | signed off | 5afee2532f8e | 2026-10-04 |  |
| MT-06 | A paste that partly fails reports once | signed off | 579194a758e4 | 2026-10-04 |  |
| MT-07 | Left arrow on the root row | signed off | cf53f117a3f8 | 2026-10-04 |  |
| MT-08 | Items from different folders keep their structure | signed off | 5afee2532f8e | 2026-10-04 |  |
| MT-09 | No-entry cursor where a file drag cannot drop | signed off | a936c9e8f852 | 2026-10-04 |  |
| MT-10 | Copy on a notice copies what it shows | signed off | cf53f117a3f8 | 2026-10-04 |  |
| MT-11 | Drop a file on the + button | signed off | 579194a758e4 | 2026-10-04 |  |

## MT-01: Copy a file from one project into another

Covers: FR-001, FR-002, FR-003, FR-005, FR-010, FR-012, FR-025, FR-025a, FR-025b, SC-001
Paths: `packages/ui/src/renderer/explorer/**`, `packages/ui/src/main/file-clipboard.ts`, `packages/ui/src/main/transfer-service.ts`, `packages/ui/src/main/transfer-ipc.ts`, `packages/core/src/explorer/**`

### Steps
1. Create two projects, A and B, on two different folders. In A's File Explorer, right-click a file (say `config.json`) and choose **Copy**.
2. Switch to B. Right-click a folder. The menu reads **Paste "config.json" from A**.
3. Choose it. The file appears in that folder, the folder opens, and the new file is selected.
4. Switch back to A. `config.json` is still there, not greyed.
5. Ctrl+click two files in A, right-click one of them: both stay selected. Choose **Copy**. In B, the menu reads **Paste 2 items from A**.
6. Hide the File Explorer pane and show it again, then switch project and back. Paste is still offered.

### Negative cases
- Press **Escape** in B's File Explorer, then right-click a folder: Paste is disabled.
- Copying in A again replaces what was on the clipboard; it does not add to it.
- With two files selected, right-click a third file: only the third is selected, and Copy copies only it.

## MT-02: Move a file between projects with its editor open

Covers: FR-004, FR-006, FR-009, FR-014, FR-016, FR-035, FR-036, SC-002, SC-012
Paths: `packages/ui/src/renderer/explorer/**`, `packages/ui/src/main/transfer-service.ts`, `packages/ui/src/main/file-clipboard.ts`, `packages/ui/src/main/in-app-moves.ts`, `packages/ui/src/main/files-service.ts`, `packages/ui/src/main/editor-coordinator.ts`, `packages/ui/src/main/editor-service.ts`, `packages/ui/src/main/preview-service.ts`, `packages/ui/src/renderer/editor/**`, `packages/ui/src/renderer/preview/**`, `packages/ui/src/main/moved-layout-walk.ts`, `packages/ui/src/main/editor-ipc.ts`, `packages/ui/src/renderer/sidebar/unload-project.ts`, `packages/ui/src/renderer/sidebar/projects-panel.tsx`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/core/src/workspace/model.ts`, `packages/core/src/preview/wire-types.ts`

### Steps
1. In A, open a file in an editor. Right-click it in the File Explorer and choose **Cut**. Its row greys.
2. Switch to B and back to A. The row is still greyed.
3. Switch to B, right-click a folder and **Paste**. The file appears in B and disappears from A.
4. Look at A's editor. It shows the file's new path in its header, is not marked unsaved, cannot be typed in, and reads "This file moved to another project, at <new path>. You can no longer work on it in this project." No other notice appeared.
4a. Open a Markdown file in an editor and a preview in A, then cut it and paste it in B. Both of A's panels show the moved notice; neither says "could not be read".
4b. In B, open the moved file from the File Explorer. It opens in an editor in B at once.
5. Right-click any folder in B: Paste is disabled — the clipboard emptied because everything moved.
6. Cut a file in A, then rename it in A's tree before pasting. Paste in B: the renamed file is what moves.
7. If you have a second drive, cut a file from a project on one drive and paste it into a project on the other. It moves like any other move.
8. In A, open a file and type something without saving. Cut it and paste it in B. A's editor keeps your text and shows the moved notice. Save is unavailable. Choose **Save As**: the dialog opens in the file's new folder in B. Save there: the file is written in B, and A's panel stays read-only, no longer marked unsaved, its notice naming the saved path. Type in a second file the same way and close its editor: you are asked Save As, Discard or Cancel.
9. Open a file that sits inside a folder in an editor in A. Cut that folder in A, switch to B and paste it. Switch back to A: its editor shows the moved notice, and no "Couldn't open" toast appears.
10. Restart throng after step 9 and switch to A. Its editor still shows the moved notice, with no "Couldn't open" toast.

### Negative cases
- Cut a file in A, then delete it in A's tree. Paste in B is disabled.
- Move a file between two folders of the SAME project with its editor open. The editor follows it, stays editable, and shows no moved notice.
- In an editor showing the moved notice, Save As outside the project the file moved to is refused, as for any editor.

## MT-03: Name clashes ask first

Covers: FR-017, FR-018, FR-018a, FR-018b, FR-018c, FR-018d, FR-018e, FR-018f, FR-032, SC-006
Paths: `packages/ui/src/renderer/explorer/clash-prompt.tsx`, `packages/ui/src/renderer/theme.css`, `packages/ui/src/main/transfer-service.ts`, `packages/core/src/explorer/transfer-plan.ts`, `packages/core/src/config/settings-metadata.ts`

### Steps
1. Put a `notes.txt` in both A and B. Copy A's, paste into B's folder holding `notes.txt`. A prompt names the file and folder, shows both sides' size and modified time, and marks the newer one.
1a. In that prompt, the incoming file and the existing file each sit in their own box, with an arrow between them pointing from the incoming box to the existing one. The newer box is highlighted, not just labelled. There is clear space between the message, the boxes, the apply-to-all tick-box and the buttons.
2. Press **Enter**. B's `notes.txt` now has A's content; the old one is in the Recycle Bin.
3. Repeat and choose **Keep both**. B now has `notes copy.txt` beside `notes.txt`.
4. Repeat and choose **Skip**. Nothing changes, and Paste is still offered.
5. Copy three clashing files at once; on the first prompt tick **apply to all** and choose **Skip**. No further prompts appear.
6. Copy a folder whose name exists in B with different contents. The folders merge; only a clashing file inside asks.
7. Copy a file in A and paste it into its own folder. It lands as `name copy.ext` with no prompt.
8. In Preferences → File Explorer, set **When Paste replaces an item** to permanent. Repeat step 1: the Replace button says it cannot be undone.
9. Drag a file onto a folder already holding one of that name. The same prompt appears.

### Negative cases
- Press **Escape** on the prompt. The cancel choice appears (MT-04), and B's file is unchanged.
- A paste with no clash shows no prompt.

## MT-04: Progress, Cancel, queued pastes and quitting mid-paste

Covers: FR-019, FR-019a, FR-019b, FR-019c, FR-019d, FR-019e, FR-019f, FR-031, FR-039, SC-007, SC-008, SC-009, SC-014
Paths: `packages/ui/src/renderer/explorer/paste-progress-notice.tsx`, `packages/ui/src/renderer/explorer/paste-quit-prompt.tsx`, `packages/ui/src/renderer/explorer/clash-prompt.tsx`, `packages/ui/src/renderer/common/notification.tsx`, `packages/ui/src/main/transfer-service.ts`, `packages/ui/src/main/transfer-quit-gate.ts`, `packages/ui/src/main/main.ts`, `packages/core/src/explorer/transfer-contract.ts`, `packages/ui/src/renderer/theme.css`, `packages/ui/src/main/node-file-system.ts`, `packages/core/src/abstractions/file-system.ts`, `packages/core/src/config/theme.ts`

Setup: a project holding a large folder — the `node_modules` of any JavaScript project works.

### Steps
1. Copy the large folder and paste it into another project. Within a second a notice shows items done of total, the item in progress, and a Cancel button. It has no dismiss button while it runs.
2. Switch project while it runs. The notice stays.
3. Click **Cancel**, then **Keep finished**. What landed stays; the folder in progress is gone in full.
4. Repeat, Cancel, then **Roll back**. The target folder is back as it was.
5. Start a long paste, then immediately start a second paste. The second shows as queued; cancel it — it ends without asking anything.
6. Start a long paste and close the main window. A prompt offers **Wait** or **Cancel pastes**. Choose Wait: throng closes once it finishes.
7. Repeat and dismiss the prompt with Escape. The window stays open and the paste keeps running.

8. Copy a single file of more than 5 MB (a video or installer works) onto a folder that already holds its name. Answer the clash prompt with Replace. If the copy is still running after a second, its progress notice appears then — not while the prompt was open.
9. Paste the large folder again and watch the notice: a bar fills as the copy goes, beside "N of M files" and the size done of the total. Right at the start, before the total is known, the bar is animated without a fill.
10. Look at the notice's cancel control: a cancel icon on the right, clearly apart from the text and not the X used to dismiss notices. Hover it: the title reads "Cancel paste". Choose it: you are asked Keep finished or Roll back.

### Negative cases
- A small paste shows no progress notice.
- Copy a small file (under 5 MB) onto a folder holding its name, and leave the clash prompt open for several seconds before answering. Only the prompt appears; no progress notice shows at any point.
- Dragging the large folder shows no progress and no Cancel.

## MT-05: Undo a move between projects from either side

Covers: FR-020, FR-021, FR-022, FR-023, FR-035, SC-003, SC-012
Paths: `packages/ui/src/renderer/explorer/use-explorer-data.ts`, `packages/ui/src/renderer/explorer/transfer-completion.tsx`, `packages/ui/src/main/transfer-service.ts`, `packages/core/src/fileop-undo/undo-stack.ts`, `packages/ui/src/main/editor-coordinator.ts`, `packages/ui/src/main/preview-service.ts`, `packages/ui/src/main/moved-layout-walk.ts`, `packages/ui/src/renderer/editor/**`, `packages/ui/src/main/in-app-moves.ts`, `packages/ui/src/renderer/preview/**`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`

### Steps
1. With an editor open on a file in A, cut it and paste it into B (MT-02).
2. In A's File Explorer press **Ctrl+Z**. The file returns to A, and A's editor drops the moved notice, shows its A path again and can be typed in.
2a. Redo (Ctrl+Y), open the file in B's editor, then undo again. B's editor shows the moved notice, and opening the file in A opens it there at once.
2b. Open a Markdown file in an editor and a preview in A. Cut the file in A, switch to B and paste it, then switch back to A. The preview shows the moved notice, not the file, and its open-linked-editor actions (header menu, right-click menu, status bar) are unavailable.
3. Switch to B, right-click: Undo is disabled and Redo is enabled. Press **Ctrl+Y** in B. The file moves to B again.
4. Restart throng. In A, Ctrl+Z still undoes the move.
5. Replace a file by pasting over it (MT-03 step 2), then Ctrl+Z in B. The pasted file goes and the original comes back from the Recycle Bin.

### Negative cases
- A copy between projects that replaced nothing offers no Undo.
- Move the file back by hand in Windows Explorer, then Ctrl+Z: an error notice says why, and nothing changes.

## MT-06: A paste that partly fails reports once

Covers: FR-013, FR-015, SC-004
Paths: `packages/ui/src/renderer/explorer/paste-failure-notice.ts`, `packages/ui/src/renderer/explorer/paste-progress-notice.tsx`, `packages/ui/src/main/transfer-service.ts`

### Steps
1. In A, copy three files. In Windows Explorer, delete one of them.
2. Paste in B. Two files land, and exactly one notice names the missing file and why.

### Negative cases
- A paste where nothing fails raises no notice.

## MT-07: Left arrow on the root row

Covers: FR-030, SC-005
Paths: `packages/ui/src/renderer/explorer/file-tree.tsx`, `packages/ui/src/renderer/explorer/explorer-keybindings.ts`

### Steps
1. Click the root row of the File Explorer and press **Left** several times. The tree stays open, every child visible.

### Negative cases
- Left on an open sub-folder still collapses it.

## MT-08: Items from different folders keep their structure

Covers: FR-033, FR-018e, SC-010
Paths: `packages/ui/src/main/transfer-service.ts`, `packages/core/src/explorer/transfer-plan.ts`, `packages/core/src/fileop-undo/undo-stack.ts`, `packages/ui/src/renderer/explorer/use-explorer-data.ts`, `packages/ui/src/main/file-clipboard.ts`, `packages/ui/src/main/transfer-ipc.ts`

Setup: in project A, a file `test.md` at the root and a folder `test` holding another `test.md`. An empty folder `test2` in A and in B.

### Steps
1. Select `/test.md` and `/test/test.md` together and **Copy**. Paste on B's `test2`. B now has `test2/test.md` and `test2/test/test.md`.
2. Paste the same selection on A's `test2`. A now has `test2/test.md` and `test2/test/test.md`, and the originals are untouched.
3. Paste it on B's `test2` again. The folder `test2/test` is merged into rather than duplicated, and each file that now exists asks through the clash prompt.
4. Select the same two files, **Cut**, and paste on B's `test2` (emptied first). Both files move with the same structure; A's `test` folder stays, now empty.
5. Undo in either project (Ctrl+Z). Both files are back in A, and the `test2/test` folder the paste created is gone.
6. Drag the same two-file selection onto a folder in A. They land with the same structure as a paste.

### Negative cases
- Files selected from one folder still land directly in the target folder, with no extra folder.
- Selecting the folder `test` and the file inside it pastes the folder once; the file does not also land on its own.

## MT-09: No-entry cursor where a file drag cannot drop

Covers: FR-034, SC-011
Paths: `packages/ui/src/renderer/explorer/file-tree.tsx`, `packages/ui/src/renderer/composition-root.tsx`

### Steps
1. Drag a file from the File Explorer over a project in the Projects pane. The pointer shows the no-entry cursor. Release: nothing happens.
2. Drag it over the title bar, a panel header, a tab and the gaps between panels. Each shows the no-entry cursor, and releasing does nothing.
3. Drag it over an editor, a terminal, an empty panel and a folder in the tree. Each still shows the copy or move cursor, and the drop works as before.
4. Drag a file in from Windows Explorer over the Projects pane. The pointer shows the no-entry cursor.

### Negative cases
- No place where a release does nothing shows the copy (+) cursor.

## MT-10: Copy on a notice copies what it shows

Covers: FR-037, SC-013
Paths: `packages/ui/src/renderer/common/notice-text.ts`, `packages/ui/src/renderer/common/notification.tsx`, `packages/ui/src/renderer/common/panel-failure-banner.tsx`, `packages/ui/src/renderer/editor/editor-failure.ts`, `packages/ui/src/renderer/preview/preview-notice.tsx`

### Steps
1. Make an editor's file go missing: open a file in an editor, then delete it in Windows Explorer. The panel shows its banner with the note "What is shown here is not the file…". Press the banner's **Copy** and paste into an editor. Every line the banner shows is there, in the same order and words, including the note; then a blank line, `Details`, and the full Project — Tab — Panel name, the path and the system error.
2. Raise a toast that lists panels (for example, restart throng after deleting a file that was open). Press its **Copy** and paste. Every line shown — heading, message, tab and panel rows — is there in order, then `Details` with each row's path and reason.

### Negative cases
- Nothing on screen is missing from a copy, for any notice you can raise.

## MT-11: Drop a file on the + button

Covers: FR-038
Paths: `packages/ui/src/renderer/workspace/tab-group.tsx`, `packages/ui/src/renderer/explorer/tree-drag-store.ts`, `packages/ui/src/renderer/workspace/open-dropped-file.ts`, `packages/ui/src/renderer/workspace/panel-body.tsx`

### Steps
1. Drag a file from the File Explorer onto the tab strip's **+**. The pointer shows the copy cursor over it. Release: a new tab opens with the file in an editor, and no rename box appears.
2. Drag a file that is already open in an editor onto **+**. That editor is focused; no new tab is created.
3. In Preferences set Markdown's default open action to **Preview**. Drag a `.md` file onto **+**. The new tab holds exactly one panel, showing the file's preview.
4. Drag a `.txt` file onto **+**. The new tab holds exactly one panel: an editor on the file.

### Negative cases
- Drag a folder, or two files, over **+**: the no-entry cursor shows, and releasing does nothing.
