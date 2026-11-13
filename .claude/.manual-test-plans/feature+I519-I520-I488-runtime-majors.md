# Manual test plan: Electron 45, better-sqlite3 13, react-arborist 4

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Everyday use on Electron 45 | untested | | | |
| MT-02 | Projects and layout survive a restart | untested | | | |
| MT-03 | File Explorer, Find in Files and project list trees | untested | | | |

## MT-01: Everyday use on Electron 45

Covers: #519
Paths: `package.json`, `package-lock.json`

### Steps
1. Setup: close every dev-mode throng, then run `npm run start:ui` in `.claude/worktrees/I519-I520-I488-runtime-majors`. The window opens with your dev projects and layout restored, and no error notice.
2. Open a terminal panel and type `ls`. The output and the prompt draw cleanly, and the cursor sits at the end of the prompt.
3. Open a source file, type a line and save with Ctrl+S. The dirty mark clears.
4. Open a Markdown file with a Mermaid block in its preview. The text and the diagram both render.
5. Open Preferences from the cog. The window opens in your theme, and switching tabs works.
6. Drag a tab out of the window. It becomes a sub-workspace window that you can drag back.

### Negative cases
- No blank or white window at any point, and no "Failed to fetch dynamically imported module".
- Copy text from the editor and paste it into the terminal. It arrives intact.

## MT-02: Projects and layout survive a restart

Covers: #520
Paths: `package.json`, `package-lock.json`, `packages/persistence/package.json`, `packages/daemon/package.json`, `electron-builder.yml`

### Steps
1. Create a project, split its workspace into two panels and give the second a terminal.
2. Close throng and choose **Terminate all**, then start it again. The project, its split and the terminal panel all come back.
3. Run `sleep 300` in the terminal, close throng with **Leave running**, then start it again. The terminal comes back attached, with `sleep` still running.

### Negative cases
- No "could not open the database" or schema notice on any start.
- Projects created before this build are all still listed.

## MT-03: File Explorer, Find in Files and project list trees

Covers: #488
Paths: `package.json`, `package-lock.json`, `packages/ui/package.json`

### Steps
1. In the File Explorer, expand and collapse folders by click and by the arrow keys. The tree follows without jumping.
2. Drag a file onto a folder. A drop highlight follows the pointer without lag, and the file moves there.
3. Drag a file with the copy modifier held. A copy lands in the folder and the original stays put.
4. Drag a file from the tree onto an editor tab. It opens there.
5. Press F2 on a file, type a new name and press Enter. The row shows the new name.
6. Run Find in Files for a common word. The results tree lists files and lines, and clicking a line opens it.
7. In the project list, select projects and expand and collapse a category. It behaves as before.

### Negative cases
- Press Esc mid-drag. The drag cancels, and nothing moves.
- Drag a file out of the window onto your file manager. It hands over as before.
