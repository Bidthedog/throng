# Manual test plan: non-blocking process calls (051) and moves followed by unheld layouts (052)

Spec: `specs/051-nonblocking-process-calls/spec.md`

MT-06 – MT-10 test spec 052 (`specs/052-follow-moves-unheld-layouts/spec.md`). Their Covers ids carry an `S052-` prefix because a plan has one Spec line; their Paths still invalidate them on code changes. MT-11 – MT-13 test spec 053 (`specs/053-terminal-title-template/spec.md`), with an `S053-` prefix the same way.

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Switch project straight after unloading with End Terminals | signed off | 070561703731 | 2026-10-09 | |
| MT-02 | Other terminals keep flowing while terminals end and start | signed off | 070561703731 | 2026-10-09 | |
| MT-03 | Terminate all on close leaves nothing running | signed off | 070561703731 | 2026-10-09 | |
| MT-04 | Command memory remembers a command started through a launcher | signed off | 070561703731 | 2026-10-09 | |
| MT-05 | Ending a terminal ends a command its launcher left behind | signed off | 070561703731 | 2026-10-09 | |
| MT-06 | A rename reaches a closed sub-workspace and an unloaded project | signed off | 750756182653 | 2026-10-09 | |
| MT-07 | A tab not shown since launch follows a rename across a restart | signed off | 750756182653 | 2026-10-09 | |
| MT-08 | Replace onto a clean open file: both panels share it; undo restores both | signed off | 51fba5bcc4cc | 2026-10-09 | |
| MT-09 | Replace onto a dirty open file keeps the changes, with Save As and Discard | signed off | ae3618b3f9f9 | 2026-10-09 | |
| MT-10 | Replace onto an open file whose source is not open | signed off | 2faa7767f7ac | 2026-10-09 | |
| MT-11 | Every terminal names its running command, shell and directory | signed off | 070561703731 | 2026-10-09 | |
| MT-12 | A custom title template renames every terminal at once | signed off | 070561703731 | 2026-10-09 | |
| MT-13 | The title template is documented in Preferences | signed off | a9af5a96e7a1 | 2026-10-09 | |

## MT-01: Switch project straight after unloading with End Terminals

Covers: FR-001, FR-002, FR-004, FR-005, SC-001, #468
Paths: `packages/daemon/src/terminal-service.ts`, `packages/daemon/src/pty-agent-*.ts`, `packages/platform-windows/src/node-pty-host.ts`, `packages/platform-windows/src/windows-directory-lock.ts`, `packages/ui/src/renderer/sidebar/unload-project.ts`, `packages/ui/src/main/terminal-ipc.ts`

### Steps
1. Load two projects, A and B. In A, open four terminals and run `ping -n 120 127.0.0.1` in each.
2. In the projects panel, open A's menu and choose **Unload Project and End Terminals**, then click B at once. B opens straight away; nothing reverts to A and no error appears.
3. Repeat steps 1–2 twenty times in a row. Every switch succeeds.
4. Load A again. Its terminal panels start fresh shells; none shows the old ping still printing.

### Negative cases
- No "timed out" notice, no switch that snaps back, and no second notice about the same Unload.
- If an end fails (rare; e.g. an elevated process the shell started), exactly one notice reads "… N of its terminals could not be ended; they are still running and reattach when you open A again", and loading A shows those terminals still running.

## MT-02: Other terminals keep flowing while terminals end and start

Covers: FR-010, FR-021, SC-002, SC-003
Paths: `packages/daemon/src/terminal-service.ts`, `packages/platform-windows/src/node-pty-host.ts`, `packages/platform-windows/src/windows-process-cwd.ts`, `packages/platform-windows/src/windows-directory-lock.ts`

### Steps
1. In project B, open a terminal and run `ping -t 127.0.0.1` so it prints every second, and a second terminal you can type in.
2. In project A, open ten terminals each running `ping -n 120 127.0.0.1`, then Unload A with End Terminals.
3. While A unloads, watch B's ping and type `echo hello` in B's second terminal. The ping keeps printing without a visible pause, and each typed character appears as you type it.
4. Open five new terminals in B in quick succession. B's ping keeps printing and typing stays immediate.

### Negative cases
- No terminal in B freezes, stutters for a visible beat, or drops typed characters.

## MT-03: Terminate all on close leaves nothing running

Covers: FR-014, FR-015, FR-015a, SC-004, 005 US3
Paths: `packages/daemon/src/terminal-service.ts`, `packages/daemon/src/main.ts`, `packages/daemon/src/pty-agent-entry.ts`, `packages/platform-windows/src/node-pty-host.ts`, `packages/ui/src/main/main.ts`

### Steps
1. Open ten terminals across your projects, each running `ping -n 120 127.0.0.1`.
2. Open Task Manager's **Details** tab, sorted by name, and note the `cmd.exe`, `PING.EXE` and `conhost.exe` entries.
3. Close throng and choose **Terminate all**. throng closes within a few seconds.
4. In Task Manager, none of the ten terminals' `cmd.exe`, `PING.EXE` or `conhost.exe` entries remain.
5. Start throng again and open each project. Every terminal panel starts a fresh shell on its own; none is an empty type picker.

### Negative cases
- throng does not hang on close, and no window or console flashes up while it closes.
- No "Terminal exited" notice appears while throng closes (005 US3).

## MT-04: Command memory remembers a command started through a launcher

Covers: FR-040, FR-041, FR-042, FR-043, FR-044, FR-046, SC-007, #193
Paths: `packages/core/src/terminal/command-capture.ts`, `packages/platform-windows/src/attached-processes.ts`, `packages/platform-windows/src/node-pty-host.ts`, `packages/daemon/src/terminal-service.ts`, `packages/daemon/src/pty-agent-attached.ts`

### Steps
throng shows no running-command indicator; the remembered command is seen by what a terminal runs when it starts again, and in the panel's Startup Command setting. Every terminal below has **Remember the last running command** on.

1. With Docker running, open a Git Bash terminal and run `docker run --rm --init alpine sleep 600`. Wait three seconds.
2. Unload the project with End Terminals and open it again. The Git Bash terminal starts `docker run --rm --init alpine sleep 600` on its own.
3. Press Ctrl+C, wait three seconds, Unload with End Terminals and open the project again. The terminal starts at a bare prompt, and the panel's Startup Command is empty (FR-042, FR-046).
4. In a cmd terminal run `ping -t localhost`, wait three seconds, Unload with End Terminals and open the project again. The ping runs again on its own (FR-044).
5. In a cmd terminal run `npm run` with any long-running script that starts node, wait three seconds, Unload with End Terminals and open the project again. It starts the `npm run …` you typed, not the node process under it.

### Negative cases
- No console window flashes on screen while a command runs (the observation runs hidden every second).
- The shell itself (`bash.exe`, `cmd.exe`) is never shown as the running command.

## MT-05: Ending a terminal ends a command its launcher left behind

Covers: FR-014
Paths: `packages/platform-windows/src/node-pty-host.ts`, `packages/platform-windows/src/attached-processes.ts`

### Steps
1. Open a cmd terminal and run `cmd /c start /b ping -n 120 127.0.0.9`. The ping prints in the terminal.
2. Close the terminal (end it from the panel). In Task Manager's **Details** tab, no `PING.EXE` for `127.0.0.9` remains.

### Negative cases
- The ping does not keep running, invisibly, after its terminal has gone.

## MT-06: A rename reaches a closed sub-workspace and an unloaded project

Covers: S052-FR-001, S052-FR-002, S052-FR-003, S052-FR-008, S052-SC-001, S052-SC-002, #397
Paths: `packages/daemon/src/workspace-service.ts`, `packages/persistence/src/workspace-repository.ts`, `packages/core/src/workspace/moved-paths.ts`, `packages/ui/src/main/in-app-moves.ts`, `packages/ui/src/main/moved-layout-walk.ts`, `packages/ui/src/main/main.ts`, `packages/ui/src/renderer/state/subworkspace-window-client.ts`, `packages/ui/src/renderer/workspace/detach-context.tsx`

### Steps
1. In project P, open `a.md` in an editor and sync that panel to a new sub-workspace. Close the sub-workspace window.
2. In the main window's File Explorer, rename `a.md` to `b.md`.
3. Reopen the sub-workspace from the sidebar. Its editor shows `b.md`, clean, with no notice.
4. In project Q, open a preview of `docs/x.md`. Cut `docs/x.md` in Q's File Explorer, switch to project P (Q stays loaded but inactive), and paste into P. Switch back to Q: the preview says its file moved to P (050's moved-out notice) rather than "could not be read".
5. In a sub-workspace with `a.md` open, close it, rename `a.md` → `b.md`, then `b.md` → `c.md`. Reopen it and use Back (Alt+Left) in that panel: no entry leads to `a.md` or `b.md`.
6. Undo the rename (Ctrl+Z in the File Explorer), reopen the sub-workspace: it shows the restored name.

### Negative cases
- No "Couldn't open … (missing)" toast and no could-not-read banner for a file that was renamed in-app.
- A sub-workspace you edited while another was closed keeps your edits after the rename (no layout snaps back).

## MT-07: A tab not shown since launch follows a rename across a restart

Covers: S052-FR-007, S052-FR-005
Paths: `packages/ui/src/renderer/editor/moved-path-sync.tsx`, `packages/ui/src/renderer/state/workspace-store.tsx`, `packages/ui/src/renderer/state/layout-saves.ts`

### Steps
1. In project P, open `a.md` in an editor in tab T2, switch to tab T1, and restart throng (T1 shows at launch).
2. Without visiting T2, rename `a.md` to `b.md` in the File Explorer.
3. Restart throng again, then open T2. Its editor shows `b.md`, clean.

### Negative cases
- T2 never shows a could-not-read banner for `a.md`.

## MT-08: Replace onto a clean open file: both panels share it; undo restores both

Covers: S052-FR-010, S052-FR-011, S052-FR-013, S052-SC-004, #111
Paths: `packages/ui/src/main/editor-coordinator.ts`, `packages/ui/src/main/document-authority.ts`, `packages/ui/src/renderer/editor/use-editor.ts`, `packages/ui/src/renderer/editor/moved-path-sync.tsx`

### Steps
1. Open `a.md` and `b.md` (both saved, different text) in two editor panels side by side.
2. Cut `a.md` in the File Explorer, paste it into `b.md`'s folder and choose **Replace**.
3. Both panels now show `a.md`'s text under the name `b.md`. Type in one: the text appears in the other at once.
4. Undo the paste (Ctrl+Z in the File Explorer). One panel shows `a.md` with its text, the other `b.md` with its ORIGINAL text.
5. Repeat steps 1–3, then restart throng: both panels still show the same one document.
6. Repeat steps 1–3, then rename `b.md` to `c.md`: both panels follow to `c.md` and still type into each other.
7. Repeat steps 1–3, then close the panel that showed `a.md`: the other keeps the text, including anything typed and not saved.

### Negative cases
- No panel ever shows "Couldn't open" during or after these steps.
- Saving in either panel never makes the other show stale text.

## MT-09: Replace onto a dirty open file keeps the changes, with Save As and Discard

Covers: S052-FR-012, S052-FR-013
Paths: `packages/ui/src/main/editor-coordinator.ts`, `packages/ui/src/renderer/editor/replaced-notice.tsx`, `packages/ui/src/renderer/editor/editor-failure-banner.tsx`, `packages/ui/src/renderer/editor/use-editor.ts`, `packages/ui/src/renderer/editor/moved-out-save.ts`, `packages/ui/src/renderer/common/panel-failure-banner.tsx`

### Steps
1. Open `a.md` and `b.md`; type in `b.md` without saving.
2. Cut `a.md`, paste onto `b.md`, choose **Replace**. `b.md`'s panel keeps your typed text and shows ONE inline notice: "b.md was replaced by a moved file. Your unsaved changes are kept here." with **Save As…** and **Discard**.
3. Press Ctrl+S in that panel: the same notice flashes; nothing is written and no dialog appears.
4. Click **Save As…** and save as `mine.md`: the notice goes and the panel is an ordinary editor on `mine.md`.
5. Repeat 1–2 and click **Discard**: the panel shows the moved file, shared with `a.md`'s panel (as MT-08).
6. Repeat 1–2, then unload the project and choose **Save**: you are asked where to save the replaced file's changes; nothing is lost silently.
7. Repeat 1–2, then undo the paste: `b.md` comes back and the panel shows your unsaved text against it, still unsaved.

### Negative cases
- Never two notices for the one condition; never a "Cannot save" dialog.

## MT-10: Replace onto an open file whose source is not open

Covers: S052-FR-011, S052-FR-012
Paths: `packages/ui/src/main/editor-coordinator.ts`, `packages/ui/src/main/transfer-service.ts`

### Steps
1. Open only `b.md` (saved). Cut `a.md` (not open) and paste onto `b.md` with **Replace**. `b.md`'s panel shows `a.md`'s text, clean, with no notice.
2. Open only `b.md` and type without saving. Replace `a.md` onto it: the panel keeps your text and shows the replaced notice (as MT-09 step 2); Ctrl+S does not write.

### Negative cases
- In step 1 the panel is not left marked unsaved or "file missing" after the paste finishes.

## MT-11: Every terminal names its running command, shell and directory

Covers: S053-FR-001, S053-FR-002, S053-FR-004, S053-FR-009, S053-FR-010, S053-FR-011, S053-FR-012, S053-FR-016, S053-SC-001, S053-SC-002
Paths: `packages/core/src/terminal/title-template.ts`, `packages/core/src/workspace/panel-title.ts`, `packages/core/src/text/path-shorten.ts`, `packages/core/src/terminal/command-capture.ts`, `packages/ui/src/renderer/terminal/title-context.ts`, `packages/ui/src/renderer/terminal/command-store.ts`, `packages/ui/src/renderer/terminal/cwd-store.ts`, `packages/ui/src/renderer/terminal/title-store.ts`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/workspace/use-panel-display-names.ts`, `packages/daemon/src/terminal-service.ts`, `packages/platform-windows/src/executable-arch.ts`

### Steps
1. In one project, open a Command Prompt, a PowerShell 7, a Windows PowerShell and a Git Bash terminal. Each header reads `<shell> (<project folder>)` beside the terminal icon, with no separate directory text after it.
2. Run `ping localhost -t` in each. Within about two seconds every header reads `ping localhost -t | <shell> (<folder>)`; the tab strip's panel list and the panel menu show the same names.
3. Stop each ping with Ctrl+C. Each name returns to `<shell> (<folder>)`.
4. In Git Bash, `cd` into a folder at least five levels deep. The name keeps the drive and the last folder and shows `…` for the middle; hovering the header shows the full directory.
5. Run a command longer than 40 characters, e.g. `ping localhost -t -l 100 -w 2000 -i 64 -4`. Its name ends in `…` after about 40 characters.
6. Start `ping localhost -t` in one terminal, then unload the project and load it again. The reloaded panel does not name the old ping before its new shell has run anything.
7. Run `claude` in a PowerShell 7 terminal and give it a task, so it titles itself. The name reads `claude: <its title> | PowerShell 7 (<folder>)`; when claude exits it returns to `PowerShell 7 (<folder>)`.
8. With claude running and titled, and **Remember the last running command** ticked on its panel: switch to another project and back. The name still reads `claude: <its title> | PowerShell 7 (<folder>)`.
9. Unload the project with End Terminals and load it again, then repeat after closing and reopening throng. Each time the restored claude panel reads `claude: <its title> | PowerShell 7 (<folder>)` once claude is up — not `claude | PowerShell 7 (<folder>)`.

### Negative cases
- No terminal name ever shows `C:\Windows\system32\PING.EXE` or any other executable's full path.
- No header shows the directory twice.
- A shell's own title never shows: Git Bash's `MINGW64:/…` and cmd's `cmd - ping …` do not appear in any name under the default template.

## MT-12: A custom title template renames every terminal at once

Covers: S053-FR-003, S053-FR-005, S053-FR-006, S053-FR-007, S053-FR-008, S053-FR-013, S053-FR-014, S053-SC-003, S053-SC-004
Paths: `packages/core/src/terminal/title-template.ts`, `packages/core/src/workspace/panel-title.ts`, `packages/core/src/text/path-shorten.ts`, `packages/core/src/terminal/command-capture.ts`, `packages/ui/src/renderer/terminal/title-context.ts`, `packages/ui/src/renderer/terminal/command-store.ts`, `packages/ui/src/renderer/terminal/cwd-store.ts`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/workspace/use-panel-display-names.ts`, `packages/daemon/src/terminal-service.ts`, `packages/platform-windows/src/executable-arch.ts`, `packages/ui/src/renderer/preferences/form-controls.tsx`, `packages/ui/src/renderer/preferences/settings-tab.tsx`, `packages/ui/src/renderer/preferences/preferences.css`, `packages/core/src/config/settings-metadata.ts`, `packages/core/src/config/app-settings.ts`

### Steps
1. With two terminals open, one running `ping localhost -t`, open Preferences → Terminal and set **Terminal title template** to `({title} ?? {app}) | {shell}`. Both terminals rename at once: the pinging one to `ping | <shell>`.
2. Set it to `{shell} (({folder}))`. Names read `<shell> (<folder>)`, with the brackets shown.
3. Set it to `{app} {arch}` while ping runs. The name reads `ping x64`.
4. Detach a terminal to a sub-workspace window, change the template again, and check the detached terminal renames too.
5. Lower **Longest directory in a terminal title** to 10. Every directory in a name shortens at once.
6. Set the template to `{shell} {title} ? "WOOP" : "WAAP"`. A terminal at a prompt reads `<shell> WAAP`; one running claude reads `<shell> WOOP`.
7. Set it to `"WOOP" {shell}`. Names read `"WOOP" <shell>`, quotes shown.
8. Check the template field: it sits on its own line under the description, as wide as the row, one line, in the editor font.

### Negative cases
- Enter `({shell}` and press Enter: the field shows `Unclosed bracket at 0`, and no terminal's name changes.
- Enter `{nope}`: the message names `{nope}` and lists the placeholders that exist.
- Enter `({app} || {title})`: the message says `"||" gives true or false — use it before "?" at 7`.

## MT-13: The title template is documented in Preferences

Covers: S053-FR-015
Paths: `packages/core/src/config/settings-metadata.ts`, `docs/preferences.md`

### Steps
1. In Preferences → Terminal, read the **Terminal title template** description. It names all nine placeholders with a meaning each, says text shows as typed and how an expression is written (C# strings and operators), and shows what the default renders.
2. Open `docs/preferences.md` → Terminal. The three new settings have rows, and *Terminal title templates* says the same as Preferences.
