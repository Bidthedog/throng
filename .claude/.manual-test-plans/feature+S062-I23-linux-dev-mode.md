# Manual test plan: feature/S062-I23-linux-dev-mode

Spec: `specs/062-linux-dev-mode/spec.md`

Set up once on Ubuntu 26.04 with GNOME: `sudo scripts/linux/apparmor-profile.sh install`, `npm install`, then `npm start`.

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | First start on the reference desktop | signed off | 6170e60c18d1 | 2026-11-03 | |
| MT-02 | Linux shells in a terminal | signed off | 6170e60c18d1 | 2026-11-03 | |
| MT-03 | Files, Trash and links | signed off | 6170e60c18d1 | 2026-11-03 | |
| MT-04 | Key bindings on GNOME | signed off | a0aab315dd32 | 2026-11-03 | |
| MT-05 | Windows and display | signed off | 6170e60c18d1 | 2026-11-03 | |
| MT-06 | Resource Monitor | signed off | 6170e60c18d1 | 2026-11-03 | |

## MT-01: First start on the reference desktop

Covers: FR-002, FR-004, FR-005, FR-013, FR-019, SC-001
Paths: `scripts/preflight-start.mjs`, `scripts/preflight-start-lib.mjs`, `scripts/linux/apparmor-profile.sh`, `packages/platform-linux/src/linux-host.ts`, `packages/ui/src/main/main.ts`

### Steps

1. On a clean clone, before the profile step, run `npm start`. It prints the one `sudo` command to run, and no window crashes.
2. Run that command, then `npm start`. The throng window opens within a few minutes of starting from nothing.
3. Open a terminal in a panel, then close the window. It asks with Cancel, Terminate all and Leave running. Choose Terminate all and start it again. It opens with your project still listed.

### Negative cases

- With no terminal running, close the window. It closes without asking.
- Run `sudo npm run start:ui`. It refuses in plain words, telling you to start as your normal user.

## MT-02: Linux shells in a terminal

Covers: FR-010, FR-014, FR-015, FR-016, FR-017, FR-018
Paths: `packages/platform-linux/src/linux-pty-host.ts`, `packages/platform-linux/src/linux-shell-detection.ts`, `packages/platform-linux/src/linux-process-cwd.ts`, `packages/core/src/terminal/command-recipe.ts`, `packages/core/src/terminal/shell-history.ts`

### Steps

1. Make a panel a terminal. The flavour list starts with your login shell, and lists only shells this machine has.
2. Run `vim`, then quit it. The screen draws and restores correctly, and colours look right.
3. `cd` somewhere, then split the panel and open a terminal from it. The new terminal starts in that folder.
4. Close the window choosing to leave terminals running, and reopen it. The terminal is still there with its output.
5. Run `sleep 300 &`, then destroy the panel. In another terminal, `pgrep sleep` no longer lists it.

### Negative cases

- Type a bad command, then `exit 3`. The panel reports the exit rather than vanishing.

## MT-03: Files, Trash and links

Covers: FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-027
Paths: `packages/platform-linux/src/linux-trash.ts`, `packages/platform-linux/src/linux-path-forms.ts`, `packages/platform-linux/src/linux-volume-roots.ts`, `packages/ui/src/main/file-link-resolver.ts`, `packages/ui/src/main/config-store.ts`

### Steps

1. Create `README.md` and `readme.md` in a project. The tree shows two files, and each opens its own editor.
2. Delete a file. The dialog says Trash, and the file appears in the Files app's Trash.
3. Undo in the tree. The file comes back where it was.
4. In a terminal, run `ls /etc/hosts`, then Ctrl+click the path. It opens the file.
5. Open a project on the second disk (`/data/storage`), delete a file and undo. The file comes back.

### Negative cases

- Open a project with more folders than `fs.inotify.max_user_watches` allows. The notice names that setting.

## MT-04: Key bindings on GNOME

Covers: FR-033, FR-034, FR-035, SC-005
Paths: `packages/core/src/config/keybindings.ts`, `packages/ui/src/renderer/keybindings/window-dispatcher.tsx`, `docs/key-bindings.md`, `docs/linux.md`

### Steps

1. Walk every binding in [Key bindings](docs/key-bindings.md), using the Linux chords in [Linux](docs/linux.md#key-bindings). Each does its action, and none is taken by the desktop.
2. In a terminal, press `Ctrl+C`, `Ctrl+D` and `Ctrl+Z`. Each reaches the shell.

### Negative cases

- On a layout with AltGr, type `@` or `€` in a terminal and an editor. The character appears and no command runs.

## MT-05: Windows and display

Covers: FR-003, FR-028, FR-029, FR-030
Paths: `packages/platform/src/index.ts`, `packages/ui/src/main/ghost-window.ts`, `packages/ui/src/main/composition-root.ts`, `packages/core/src/config/settings-metadata.ts`

### Steps

1. Maximise, restore and minimise from the title bar, and drag the window by it. All behave as on any GNOME window.
2. Drag a tab out to make its own window, then drag it back. The ghost follows the pointer, and the tab returns.
3. Copy text from a terminal and paste it into the Files app's rename box, then copy from there and paste into an editor. Both arrive.
4. Turn on **Use native Wayland** in Preferences and restart. The window opens and is usable, and the tab tear-off limits are as `docs/linux.md` says.

### Negative cases

- Open Preferences on Windows. **Use native Wayland** is not there.

## MT-06: Resource Monitor

Covers: FR-037, FR-038
Paths: `packages/platform-linux/src/linux-process-metrics.ts`, `packages/platform-linux/src/linux-gpu.ts`, `packages/platform-linux/src/relevant-processes.ts`

### Steps

1. Open the Resource Monitor. CPU and memory appear for throng and its terminals, with friendly names. With nothing much open, throng's total memory reads about 0.5 GB, not over 1 GB.
2. Run `yes > /dev/null` in a terminal. Its CPU figure rises to about one core in the monitor.
3. Kill it from the monitor. The process ends and the row goes.
4. Run `sudo sleep 60` in a terminal. It appears under that terminal in the monitor.
5. Click into the main throng window. The monitor stays above it. Click another application. The monitor no longer floats above that application.

### Negative cases

- The network column says why it is unavailable, rather than showing zero.
