# Manual test plan: 050 cross-project clipboard

Spec: `specs/050-cross-project-clipboard/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Copy a file from one project into another | untested | | | |
| MT-02 | Move a file between projects with its editor open | untested | | | |
| MT-03 | Name clashes ask first | untested | | | |
| MT-04 | Progress, Cancel, queued pastes and quitting mid-paste | untested | | | |
| MT-05 | Undo a move between projects from either side | untested | | | |
| MT-06 | A paste that partly fails reports once | untested | | | |
| MT-07 | Left arrow on the root row | untested | | | |

## MT-01: Copy a file from one project into another

Covers: FR-001, FR-002, FR-003, FR-005, FR-010, FR-012, FR-025, FR-025a, FR-025b, SC-001
Paths: `packages/ui/src/renderer/explorer/**`, `packages/ui/src/main/file-clipboard.ts`, `packages/ui/src/main/transfer-service.ts`, `packages/ui/src/main/transfer-ipc.ts`, `packages/core/src/explorer/**`

### Steps
1. Create two projects, A and B, on two different folders. In A's File Explorer, right-click a file (say `config.json`) and choose **Copy**.
2. Switch to B. Right-click a folder. The menu reads **Paste "config.json" from A**.
3. Choose it. The file appears in that folder, the folder opens, and the new file is selected.
4. Switch back to A. `config.json` is still there, not greyed.
5. Select two files in A and **Copy**. In B, the menu reads **Paste 2 items from A**.
6. Hide the File Explorer pane and show it again, then switch project and back. Paste is still offered.

### Negative cases
- Press **Escape** in B's File Explorer, then right-click a folder: Paste is disabled.
- Copying in A again replaces what was on the clipboard; it does not add to it.

## MT-02: Move a file between projects with its editor open

Covers: FR-004, FR-006, FR-009, FR-014, FR-016, SC-002
Paths: `packages/ui/src/renderer/explorer/**`, `packages/ui/src/main/transfer-service.ts`, `packages/ui/src/main/file-clipboard.ts`, `packages/ui/src/main/in-app-moves.ts`, `packages/ui/src/main/files-service.ts`

### Steps
1. In A, open a file in an editor. Right-click it in the File Explorer and choose **Cut**. Its row greys.
2. Switch to B and back to A. The row is still greyed.
3. Switch to B, right-click a folder and **Paste**. The file appears in B and disappears from A.
4. Look at A's editor. Its header shows the file's new path in B, it is not marked unsaved, and no notice appeared.
5. Right-click any folder in B: Paste is disabled — the clipboard emptied because everything moved.
6. Cut a file in A, then rename it in A's tree before pasting. Paste in B: the renamed file is what moves.
7. If you have a second drive, cut a file from a project on one drive and paste it into a project on the other. It moves like any other move.

### Negative cases
- Cut a file in A, then delete it in A's tree. Paste in B is disabled.

## MT-03: Name clashes ask first

Covers: FR-017, FR-018, FR-018a, FR-018b, FR-018c, FR-018d, FR-018e, FR-018f, SC-006
Paths: `packages/ui/src/renderer/explorer/clash-prompt.tsx`, `packages/ui/src/main/transfer-service.ts`, `packages/core/src/explorer/transfer-plan.ts`, `packages/core/src/config/settings-metadata.ts`

### Steps
1. Put a `notes.txt` in both A and B. Copy A's, paste into B's folder holding `notes.txt`. A prompt names the file and folder, shows both sides' size and modified time, and marks the newer one.
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

Covers: FR-019, FR-019a, FR-019b, FR-019c, FR-019d, FR-019e, FR-019f, SC-007, SC-008
Paths: `packages/ui/src/renderer/explorer/paste-progress-notice.tsx`, `packages/ui/src/renderer/explorer/paste-quit-prompt.tsx`, `packages/ui/src/renderer/explorer/clash-prompt.tsx`, `packages/ui/src/renderer/common/notification.tsx`, `packages/ui/src/main/transfer-service.ts`, `packages/ui/src/main/transfer-quit-gate.ts`, `packages/ui/src/main/main.ts`

Setup: a project holding a large folder — the `node_modules` of any JavaScript project works.

### Steps
1. Copy the large folder and paste it into another project. Within a second a notice shows items done of total, the item in progress, and a Cancel button. It has no dismiss button while it runs.
2. Switch project while it runs. The notice stays.
3. Click **Cancel**, then **Keep finished**. What landed stays; the folder in progress is gone in full.
4. Repeat, Cancel, then **Roll back**. The target folder is back as it was.
5. Start a long paste, then immediately start a second paste. The second shows as queued; cancel it — it ends without asking anything.
6. Start a long paste and close the main window. A prompt offers **Wait** or **Cancel pastes**. Choose Wait: throng closes once it finishes.
7. Repeat and dismiss the prompt with Escape. The window stays open and the paste keeps running.

### Negative cases
- A small paste shows no progress notice.
- Dragging the large folder shows no progress and no Cancel.

## MT-05: Undo a move between projects from either side

Covers: FR-020, FR-021, FR-022, FR-023, SC-003
Paths: `packages/ui/src/renderer/explorer/use-explorer-data.ts`, `packages/ui/src/renderer/explorer/transfer-completion.tsx`, `packages/ui/src/main/transfer-service.ts`, `packages/core/src/fileop-undo/undo-stack.ts`

### Steps
1. With an editor open on a file in A, cut it and paste it into B (MT-02).
2. In A's File Explorer press **Ctrl+Z**. The file returns to A, and the editor's header shows its A path again.
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
