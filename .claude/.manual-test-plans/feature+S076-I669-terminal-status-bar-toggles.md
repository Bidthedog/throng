# Manual test plan: terminal status-bar toggles (076)

Spec: `specs/076-terminal-status-bar-toggles/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Remember command and reopen directory from the status bar | signed off | efd22b9ea010 | 2026-11-19 | |
| MT-02 | Silence one terminal's notifications | signed off | efd22b9ea010 | 2026-11-19 | |
| MT-03 | Terminal notifications by default | signed off | efd22b9ea010 | 2026-11-19 | |
| MT-04 | The toggle row's look, keyboard and width | signed off | efd22b9ea010 | 2026-11-19 | |
| MT-05 | The toggles with the status bar hidden, and as commands | signed off | efd22b9ea010 | 2026-11-19 | |

## MT-01: Remember command and reopen directory from the status bar

Covers: FR-001, FR-003, FR-004, FR-010, FR-011, FR-012, SC-001, SC-002
Paths: `packages/ui/src/renderer/terminal/**`, `packages/ui/src/renderer/state/workspace-store.tsx`, `packages/ui/src/renderer/panel-type/**`, `packages/core/src/terminal/panel-toggles.ts`, `packages/core/src/terminal/panel-type.ts`

### Steps
1. Open a terminal panel. At the bottom right of its status bar are three icon toggles. Hover the first: its title
   reads "Remember the last running command: disabled", and its icon is muted with a diagonal line through it.
2. Click it. It shows pressed and bright with no line, and its title now reads "Remember the last running command:
   enabled".
3. Run `ping -t localhost` (Windows) or `ping localhost` (Linux, macOS). Close throng and choose **Terminate all**.
   Reopen throng. The terminal starts and runs the ping again.
4. Stop the ping. Click the first toggle off. Run `ping localhost` again, close with **Terminate all** and reopen.
   The ping is not run again. The toggle still shows off.
5. `cd` into a subfolder of the project. Hover the second toggle: "Reopen in the last directory: enabled". Click it
   off.
   Type `exit`. The setup form shows **Reopen in the last directory** unticked and **Remember the last running
   command** unticked.
6. Start the terminal from the form. It opens at the project root, not the subfolder.

### Negative cases
- Flipping a toggle never restarts the terminal. Any running command keeps running.
- Flipping a toggle on one terminal leaves the other terminals' toggles as they were.
- The setting itself in Preferences, Terminal, does not change when a toggle is flipped.

## MT-02: Silence one terminal's notifications

Covers: FR-020, FR-021, FR-022, FR-023, FR-024, FR-026, SC-003, SC-004
Paths: `packages/daemon/src/terminal-attention.ts`, `packages/daemon/src/composition-root.ts`, `packages/daemon/src/terminal-service.ts`, `packages/ui/src/main/attention-service.ts`, `packages/ui/src/main/main.ts`, `packages/ui/src/preload/preload.cts`, `packages/ui/src/renderer/terminal/terminal-panel.tsx`, `packages/core/src/attention/**`

### Steps
1. Open two terminals side by side in one tab. In each, the third toggle (a bell) shows pressed and bright, titled
   "Terminal notifications: enabled". In the first, click it. It turns muted with a line through the bell, and its
   title reads "Terminal notifications: disabled".
2. Click into an editor or another panel. In each terminal, run `sleep 3; printf '\a'` (Git Bash, Linux, macOS) or
   `Start-Sleep 3; [char]7` (PowerShell). Only the second terminal's panel, its tab and its project are marked,
   and only it raises a pop-up.
3. Turn the first terminal's Terminal notifications back on. Ring the bell in it again from another panel. It is
   marked as normal.
4. With the first terminal marked, turn its Terminal notifications off. The mark goes from the panel, the tab and the
   project at once. Its pop-up and its desktop notification go too.
5. Right-click the silenced terminal's header and choose **Flag**. The panel is flagged.
6. In the silenced terminal, run `exit 3`. The panel shows the exit and its code as usual. No Failed mark appears.

### Negative cases
- No attention mark, pop-up, Notifications-panel entry, desktop notification or taskbar count ever comes from a
  terminal whose notifications are off.
- Nothing on the panel header shows that a terminal is silenced. Only the struck-through toggle and its unticked menu
  item do.
- Turning Terminal notifications back on does not replay anything that happened while they were off.
- In the silenced terminal, run `sleep 20; printf '\a'`. Close throng at once with **Leave running**, wait 30
  seconds, and reopen. No mark is restored for that terminal.

## MT-03: Terminal notifications by default

Covers: FR-003, FR-022, FR-025, US2 scenario 7, US2 scenario 8
Paths: `packages/core/src/config/app-settings.ts`, `packages/core/src/config/settings-metadata.ts`, `packages/ui/src/main/attention-service.ts`, `packages/daemon/src/terminal-attention.ts`, `packages/ui/src/renderer/panel-type/**`

### Steps
1. Open Preferences, Terminal. **Terminal notifications by default** is there, directly after **Reopen in the last
   directory by default** (not under Attention), on, with a description beginning "Tick “Terminal notifications” on
   new terminal panels…". It stays editable while **Mark terminals that need you** is off.
2. Make a new terminal panel. The setup form shows **Terminal notifications** ticked.
3. Have a terminal whose Terminal notifications toggle you have never clicked hold an attention mark. Turn the
   preference off. The terminal's toggle shows off (muted, struck through), and its mark goes.
4. Make a new terminal panel. The setup form shows **Terminal notifications** unticked.
5. Turn the preference back on. The terminal from step 3 shows its toggle on again. A terminal whose toggle you
   clicked keeps its own value.

### Negative cases
- A terminal whose own toggle was set keeps that value whichever way the preference is switched.

## MT-04: The toggle row's look, keyboard and width

Covers: FR-001, FR-002, FR-007, SC-006, US3
Paths: `packages/ui/src/renderer/terminal/terminal-status-bar.tsx`, `packages/ui/src/renderer/terminal/terminal.css`, `packages/core/src/icons/**`

### Steps
1. The status bar shows the shell name at the left and, from left to right at the right, a clock-arrow icon, a
   folder-with-clock icon and a plain bell icon. Each toggle that is on is drawn bright on a pressed background; each
   that is off is muted with a diagonal line through it. Hovering one reads "<setting>: enabled" or "<setting>:
   disabled".
2. Press Tab into the terminal's status bar. Each toggle takes focus in that order. Space and Enter each flip the
   focused toggle.
3. Narrow the panel until the bar is crowded, then hover a long path in the terminal. The link readout is cut short
   with an ellipsis, then the shell name. All three toggles stay whole and on one line.
4. Switch to another theme in Preferences. The toggles redraw in the new theme's colours: on ones in its full-contrast
   text colour on its pressed background, off ones in its muted text colour with the line still through them.

### Negative cases
- The status bar never grows to a second line.
- No word-wrap toggle appears.

## MT-05: The toggles with the status bar hidden, and as commands

Covers: FR-005, FR-006, SC-005
Paths: `packages/ui/src/renderer/terminal/terminal-content-menu.ts`, `packages/ui/src/renderer/keybindings/window-dispatcher.tsx`, `packages/ui/src/renderer/terminal/terminal-toggle-registry.ts`, `packages/core/src/config/keybindings.ts`, `packages/core/src/config/keybindings-metadata.ts`

### Steps
1. Turn **Show terminal status bar** off in Preferences, Terminal. Right-click inside a terminal. Under the redraw
   item are **Remember the last running command**, **Reopen in the last directory** and **Terminal notifications**,
   each ticked as the panel holds it.
2. Choose one. Right-click again: its tick has changed.
3. Open Preferences, Key Bindings. The three commands are listed under Terminal, unbound. Bind **Terminal
   notifications** to `Ctrl+Shift+Alt+I`.
4. Click into a terminal and press `Ctrl+Shift+Alt+I`. Its Terminal notifications flips (the menu tick changes).
   Nothing is typed into the shell. Turn the status bar back on and hover the bell: its title ends
   " (Ctrl+Shift+Alt+I)".
5. Click into an editor and press the chord. Nothing happens to any terminal.

### Negative cases
- Binding one of the commands to a reserved terminal key such as `Ctrl+C` is refused.
- With the status bar shown again, the toggles agree with the menu ticks.
