# Manual test plan: one watch per root (#482, #272)

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | A busy project stays responsive | signed off | b8ac23368249 | 2026-10-17 | |
| MT-02 | File Explorer follows changes made outside throng | signed off | b8ac23368249 | 2026-10-17 | |
| MT-03 | Quick Open follows changes made outside throng | signed off | b8ac23368249 | 2026-10-17 | |
| MT-04 | Open editors, previews and Find in Files follow their own files | signed off | b8ac23368249 | 2026-10-17 | |

## MT-01: A busy project stays responsive

Covers: #482
Paths: `packages/ui/src/main/node-file-watcher.ts`, `packages/ui/src/main/project-file-index.ts`, `packages/ui/src/main/explorer-watcher.ts`, `packages/ui/src/main/shared-file-watcher.ts`, `packages/ui/src/main/main.ts`, `packages/ui/src/renderer/explorer/use-explorer-data.ts`

### Steps
1. Open a large project (this repo works) and expand a handful of folders in File Explorer.
2. In a terminal panel at the project root, type `while true; do date >> churn.txt; sleep 1; done` and press Enter.
3. Open Task Manager → Details and find the `throng.exe` with the highest memory (the main process). Its CPU stays in low single digits while the loop runs.
4. Type in an editor panel and switch between two projects. Keystrokes appear at once and the switch is immediate, with no lag in bursts every few seconds.
5. `churn.txt` appears in File Explorer at the root.

### Negative cases
- No "projects.setActive timed out" or "projects.list timed out" notice appears.

## MT-02: File Explorer follows changes made outside throng

Covers: #482
Paths: `packages/ui/src/renderer/explorer/use-explorer-data.ts`, `packages/ui/src/main/explorer-watcher.ts`, `packages/ui/src/main/node-file-watcher.ts`, `packages/ui/src/main/shared-file-watcher.ts`

### Steps
1. With a folder expanded in File Explorer, create a file in it from Windows Explorer. It appears in the tree within a second or two.
2. Create a new folder with a file inside it from Windows Explorer, inside an expanded folder. The folder appears, and expanding it shows the file.
3. Rename a file from Windows Explorer. The tree shows the new name and not the old one.
4. Expand a folder, then delete it from Windows Explorer. It leaves the tree and exactly one notice says it could not be found.
5. Expand a folder, collapse it, then delete it from Windows Explorer. It leaves the tree with no notice.
6. Under `.claude/worktrees/`, expand a worktree folder and browse into it. It is listed and browsable as before.

### Negative cases
- No folder that nobody touched flickers or loses its expansion when a file changes elsewhere.

## MT-03: Quick Open follows changes made outside throng

Covers: #482, #272
Paths: `packages/ui/src/main/project-file-index.ts`, `packages/core/src/explorer/file-index.ts`, `packages/ui/src/main/shared-file-watcher.ts`

### Steps
1. Open Quick Open and search for a file name that does not exist yet. Nothing matches.
2. From Windows Explorer, create a new folder containing a file with that name. Reopen Quick Open and search again. The file is listed.
3. Rename the folder from Windows Explorer. Quick Open lists the file under the new folder name, and not the old one.
4. Delete the folder from Windows Explorer. Quick Open no longer lists the file.

### Negative cases
- Files under `node_modules` never appear in Quick Open while hidden files are excluded.

## MT-04: Open editors, previews and Find in Files follow their own files

Covers: #482
Paths: `packages/ui/src/main/editor-coordinator.ts`, `packages/ui/src/main/preview-service.ts`, `packages/ui/src/main/file-search-service.ts`, `packages/ui/src/main/shared-file-watcher.ts`

### Steps
1. Open a Markdown file at the project root in an editor and in a preview. Change and save it in another program. Both show the new content.
2. With the editor dirty, change the file in another program. The "changed on disk" notice appears once and the edit survives.
3. Run a Find in Files search with results in two files. Edit one of those files in another program. Its results are marked stale and the other file's are not.

### Negative cases
- While the MT-01 loop is appending to `churn.txt`, the open editor and preview do not flicker or reload.
