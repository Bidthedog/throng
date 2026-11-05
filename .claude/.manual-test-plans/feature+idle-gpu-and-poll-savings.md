# Manual test plan: GPU and polling savings, with the Linux fixes and install docs merged beneath them

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Attention marks blink without loading the GPU | untested | | | |
| MT-02 | Terminal cursor blink | untested | | | |
| MT-03 | Command tracking in a quiet terminal | untested | | | |
| MT-04 | A remembered command survives a restart on Linux | untested | | | |
| MT-05 | Keypad split chords with NumLock on and off | untested | | | |
| MT-06 | A terminal grows again after throng crashes | untested | | | |
| MT-07 | A .asar file in a project | untested | | | |
| MT-08 | Install guide split by system | untested | | | |
| MT-09 | Switching tabs types nothing at the prompt | untested | | | |
| MT-10 | A mirrored panel types nothing at the prompt | untested | | | |
| MT-11 | Resource monitor in a packaged build | untested | | | |

## MT-01: Attention marks blink without loading the GPU

Covers: FR-093, FR-093a
Paths: `packages/ui/src/renderer/attention/**`, `packages/ui/src/renderer/theme.css`

### Steps
1. Open a project and split a tab into two Bash terminals. In the right one type `sleep 4; printf '\a'`, press Enter, and click the left one straight away. After 4 seconds a mark appears on the right panel, the tab and the project row.
2. Watch the marks. They switch between full and dim once a second, with no fade, all together.
3. With a mark showing, watch the RTX 4090 in Mission Center for a minute. It stays about as quiet as with no mark.
4. Click into the right panel. The marks clear.

### Negative cases
- A mark that fades smoothly, or marks out of step with each other, means the old animation is back.
- Turn on Reduce Animation in GNOME's accessibility settings and raise a mark. It stays still at full opacity.

## MT-02: Terminal cursor blink

Paths: `packages/ui/src/renderer/terminal/cursor-blink.ts`, `packages/ui/src/renderer/terminal/terminal.css`, `packages/ui/src/renderer/terminal/use-terminal.ts`

### Steps
1. Click into a Bash terminal and type `echo hello` without pressing Enter. Press the left arrow three times, so the cursor sits on a letter.
2. Watch it. The block turns on and off every half second, and the letter stays readable in the off half.
3. Type quickly. The cursor stays solid while you type and starts blinking when you stop.
4. Run `printf '\e[4 q'`. The cursor is an underline and blinks. Run `printf '\e[6 q'`. It is a bar and blinks. Run `printf '\e[2 q'` to get the block back.
5. Click a different window. The cursor becomes a still outline. Click back. It blinks again.

### Negative cases
- A cursor that disappears for good, sticks in the off half when you click away, or hides the letter under it is a failure.

## MT-03: Command tracking in a quiet terminal

Covers: 025 FR-019i
Paths: `packages/daemon/src/terminal-service.ts`

### Steps
1. Leave a Bash terminal untouched for 30 seconds. Type `sleep 15` and press Enter. The panel's title shows the command within about a second.
2. Wait for it to finish. The title drops the command within about a second of the prompt returning.
3. Run `npm --version` or another quick command, then `top`. The title follows each one with the same speed as before.

### Negative cases
- A title that takes several seconds to change after you press Enter is a failure.

## MT-04: A remembered command survives a restart on Linux

Covers: #559
Paths: `packages/daemon/src/terminal-service.ts`, `packages/platform-linux/src/linux-pty-host.ts`

### Steps
1. Create a Bash terminal panel with **Remember the last running command** ticked, and run `top`.
2. Close throng and choose to terminate its terminals. Start throng again.
3. The panel runs `top` again, and its title names it.

### Negative cases
- The terminal coming back at a bare prompt is the bug this fixed.

## MT-05: Keypad split chords with NumLock on and off

Covers: #560
Paths: `docs/key-bindings.md`, `packages/core/src/config/keybindings.ts`

### Steps
1. With NumLock on, hold Ctrl+Shift+Alt and press keypad 1, then keypad 6. The panel splits to the right.
2. Repeat with keypad 2, 8 and 4 as the second key. It splits down, up and left.
3. Turn NumLock off and repeat one of them. It splits the same way.

### Negative cases
- A digit typed into the terminal, or nothing happening, is a failure.

## MT-06: A terminal grows again after throng crashes

Covers: #561
Paths: `packages/daemon/src/terminal-service.ts`

### Steps
1. Un-maximise the throng window and make it small, with a Bash terminal showing.
2. From a terminal outside this throng, run `pkill -9 -f 'idle-gpu-and-poll-savings.*dist/main/main.js'`. The window vanishes.
3. Start throng again and maximise it. The terminal comes back and fills the panel.
4. Run `tput cols`. The number matches the wide panel, not the small window.

### Negative cases
- Text stuck in the narrow width after maximising is the bug this fixed.

## MT-07: A .asar file in a project

Covers: #562
Paths: `packages/ui/src/main/main.ts`

### Steps
1. Open a project with the file explorer showing, and open a terminal in its folder.
2. Run `touch demo.asar`. It appears in the explorer as a plain file.
3. Run `rm demo.asar`. It leaves the explorer, and throng stays open.

### Negative cases
- throng's window closing or a crash notice when the file is deleted is the bug this fixed.

## MT-08: Install guide split by system

Covers: 064
Paths: `docs/installation.md`, `docs/install-linux.md`, `docs/install-windows.md`, `README.md`

### Steps
1. Open https://github.com/Bidthedog/throng/blob/master/docs/installation.md. It sends you to a Windows page and a Linux page, and keeps running from source.
2. Open each of those pages. Each starts with a quick start and shows only that system's steps.
3. Read the README's install line. It reads well and its links open the right pages.

### Negative cases
- The apt and dnf commands on the Linux page return 404 until the next release publishes an index, so don't count that as a failure here.

## MT-09: Switching tabs types nothing at the prompt

Covers: 008 FR-006a
Paths: `packages/ui/src/renderer/terminal/use-terminal.ts`

### Steps
1. In a Bash terminal, run `claude --version`, then start `claude` and quit it with `/exit`, so its queries are in the scrollback.
2. Add a second tab. Switch to it and back several times. The prompt stays empty.
3. Switch to another project and back. The prompt stays empty.
4. Close throng, leaving the terminals running, and start it again. The prompt stays empty.
5. Run `vim`, quit it, and switch tabs again. The prompt stays empty.

### Negative cases
- Any `11;rgb:…` or `…;1R` text at the prompt is the bug this fixed.
- Text you type during the switch still arrives.

## MT-10: A mirrored panel types nothing at the prompt

Covers: 008 FR-006b
Paths: `packages/daemon/src/terminal-service.ts`, `packages/ui/src/renderer/terminal/use-terminal.ts`

### Steps
1. Open a sub-workspace window, then right-click a Bash terminal's panel handle and use **Sync to** to put it in that sub-workspace, so the terminal shows in both windows.
2. In either window, start `claude` and quit it with `/exit`. The prompt stays empty in both windows.
3. Type in each window in turn. Each keystroke appears once, in both windows.
4. Switch the main window to another tab, so only the sub-workspace window shows the terminal. In that window, start `vim` and quit it. It starts normally and the prompt stays empty.
5. Switch the main window back. The prompt stays empty.

### Negative cases
- Any `…;1R` or `11;rgb:…` text at the prompt is the bug this fixed.
- Run `cat`, press Shift+F3 in the second window, and press Ctrl+C. It shows `^[[1;2R`, the key is not lost.

## MT-11: Resource monitor in a packaged build

Covers: 055 FR-044a, #542
Paths: `packages/ui/src/collector/**`, `packages/ui/src/main/resource-monitor-host.ts`, `packages/ui/src/renderer/resources/liveness.tsx`, `scripts/collector-probe.mjs`

### Steps
1. Install the build this branch's release pipeline produces, on Linux, and start it. Within a few seconds the status bar's right side shows CPU, memory, GPU and I/O figures.
2. Open the resource monitor from that item. It shows throng's processes and "Updated …" counting up, not "Collecting the first reading…".
3. Repeat steps 1 and 2 on Windows.

### Negative cases
- "Collecting the first reading…" that never changes, or no status bar item, is the bug this fixed.
