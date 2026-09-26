# Quickstart: Validating Side Panes and Project List

**Feature**: 046 | **Plan**: [plan.md](./plan.md)

This guide proves the feature by hand, in the dev build, after `npm run gate` has passed on the branch
(the gate is the evidence of done-ness; this guide is the human check behind it). Contracts:
[keybindings-and-focus](./contracts/keybindings-and-focus.md),
[project-categories](./contracts/project-categories.md), [unload](./contracts/unload.md),
[menus](./contracts/menus.md).

## Before you start

You need:

- the dev app running from this worktree, with a clean dev state (the `throng-clear-dev-state` skill);
- three projects, **A**, **B** and **C**, each with its own root folder, and B with a Git Bash
  terminal;
- a US keyboard layout. A second layout (German or US-International) is optional, for §3.

## 1. One name for the file tree (US1)

1. Read the right-hand pane header, collapse it to its rail, and hover the rail's show control.
   - **Expect**: "File Explorer" on the header and the rail, and *Show File Explorer* on the tooltip.
2. Open a file in an editor and open the panel header menu.
   - **Expect**: *Reveal File in File Explorer*.
3. Search the shipped sources and docs for the old name:
   `git grep -n -e "Files & Folders" -e "Files &amp; Folders" -e "Files and Folders" -- packages/*/src README.md CONTRIBUTING.md docs`.
   - **Expect**: no output. `file-explorer-name.test.ts` asserts the same thing.
4. Start the new build on a config directory written by the previous build.
   - **Expect**: no warning, and every binding and setting as before.

## 2. The chords, from a terminal (US2; FR-021 check)

1. Focus B's terminal and run `cat -v`. It echoes every byte it receives.
2. Press Ctrl+Alt+PageDown.
   - **Expect**: C becomes active in both the title bar and the status bar, and `cat -v` prints
     nothing.
3. Press Ctrl+Alt+PageDown again.
   - **Expect**: nothing happens and no notice appears (C is last, FR-011).
4. Press Ctrl+Alt+PageUp twice.
   - **Expect**: first B, then A.
5. Hide the Projects pane (Ctrl+Alt+B) and press Ctrl+Alt+PageDown.
   - **Expect**: the switch happens and the pane stays hidden.
6. From an editor, press **Ctrl+Alt+F**, then F2.
   - **Expect**: the File Explorer is outlined and rename starts on its selected entry.
7. With the Projects pane hidden, press Ctrl+Alt+P.
   - **Expect**: the pane is revealed and outlined, with focus on the active row.
   - Press ArrowDown twice, then Enter. The project two rows down becomes active.
   - Press F2 on a project row. **Expect**: nothing, and in particular **no file-rename box opens**
     in the File Explorer (research R3).
8. Open the title-bar cog.
   - **Expect**: a *Navigate* section with four items, each showing its chord. Next Project is
     disabled when the last project is active.
9. **FR-021, by hand (research O3).** In a Git Bash terminal, run `bind -p | grep -E '\\e\\C-(e|f|p)'`.
   - **Expect**: `"\e\C-e": shell-expand-line` is listed. `\e\C-f` and `\e\C-p` either do not appear
     or read `not bound`.

## 3. Reset zoom with Shift held (US3)

1. Zoom in twice with Ctrl+Shift+=, focus a terminal, and press Ctrl+Shift+0.
   - **Expect**: 100% zoom, and the shell receives nothing.
2. Repeat with focus in an editor, then in a find input.
   - **Expect**: zoom resets and no `)` is typed.
3. Open Preferences → Key Bindings → Reset Zoom.
   - **Expect**: Ctrl+0, Ctrl+Shift+0 and Ctrl+MiddleClick are listed.
   - Record a new chord by pressing Ctrl+Shift+0. **Expect**: it records as `Ctrl+Shift+0`.
4. *Optional, German layout*: in an editor, type AltGr+0 and AltGr+7.
   - **Expect**: `}` and `{` are typed, and neither the panel zoom nor anything else fires (research
     R2).

## 4. Project menu and Unload (US4)

1. Right-click B.
   - **Expect**: Edit, Rename, Remove, Move to Category ▸ and the three Unload rows, in the sections
     given in [menus.md](./contracts/menus.md) §1.
   - Press Escape. **Expect**: focus returns to B's row.
   - Press Shift+F10 on the focused row. **Expect**: the same menu.
2. In B's terminal run `ping -t localhost` (or `sleep 600`). Right-click B and choose **Unload**.
   - **Expect**: a dialog names the process and has *Keep running* focused.
   - Choose Keep running. **Expect**: B's row turns grey and italic. With B active, the workspace
     shows its no-project state.
3. Select B.
   - **Expect**: the same tabs and panels as before, and the ping still running with its scrollback.
4. Unload B again and choose **End terminals**.
   - **Expect**: a second confirmation. Confirm it, and the ping ends.
   - In Task Manager, **expect** no `conhost.exe` is left under the daemon for B.
5. Make an editor in A dirty, then unload A.
   - **Expect**: the unsaved prompt comes first. Cancel it, and A stays loaded and unchanged.
6. Open the menu on a project that is already unloaded.
   - **Expect**: all three Unload rows are drawn and disabled.
7. Set *Unload a project with running terminals* to **None**, then unload a project with a running
   process.
   - **Expect**: no dialog. The default terminal action applies, and the process keeps running.
8. Detach one of A's panels to a sub-workspace window, then unload A.
   - **Expect**: the sub-workspace's panel and its terminal are untouched.

## 5. Categories (US5)

1. Start from a database written by the previous build.
   - **Expect**: every project is under **In Progress**, in its old order.
2. Right-click C and choose Move to Category ▸ New Category…, then type "Parked".
   - **Expect**: C appears under Parked. Restart, and it is still there.
3. Minimise Parked.
   - **Expect**: one header row reading "Parked" and "1". C is not clickable, and Ctrl+Alt+PageDown
     skips it.
4. Make C active first, then minimise Parked.
   - **Expect**: C's row stays under the collapsed header. Switch to A, and C's row disappears.
5. Look for a minimise control or a Delete item on In Progress.
   - **Expect**: there is none, in the header and in its menu.
6. Drag A onto the gap between two projects in another category.
   - **Expect**: A moves there. Drop a project on the minimised Parked header, and it goes to the
     end of Parked.
7. Delete Parked.
   - **Expect**: its projects appear at the end of In Progress, unchanged.
8. Try to rename a category to "in progress".
   - **Expect**: refused inline.

## 5a. Iterate round 1 (checkpoint 2026-09-24, updated 2026-09-25)

Where this section and §2 – §5 disagree, this section wins (spec FR-072 – FR-115). §3's chords are
retired (S22), §4 steps 2, 4 and 7 describe dialogs that no longer exist (FR-111), and the cog
menu's Zoom row this section itself used to describe is retired too (FR-113, S24).

1. **Chords from a focused terminal** (FR-102, FR-104). With a Git Bash terminal focused, press
   Ctrl+Shift+Alt+PageDown / PageUp, +F, +P, +B, +N, +M, +T, and +ArrowLeft / Right.
   - **Expect**: each acts (next / previous project, focus File Explorer / Projects, toggle panes,
     focus the notice, the tab picker, move focus), and the shell receives nothing.
   - The old Ctrl+Alt chords, Ctrl+Shift+0 and plain Ctrl++ / Ctrl+- / Ctrl+0 do nothing.
2. **Window zoom** (FR-102, FR-113, FR-114). Ctrl+Shift+Alt++ twice, then Ctrl+Shift+Alt+Numpad0
   (the physical Numpad0 key, not the main-row 0); repeat zooming in with the keypad `+`.
   - **Expect**: the whole window zooms and resets to 100%; each panel's own zoom is unchanged.
   - Open the title-bar cog menu. **Expect**: no Zoom row and no Zoom section — the cog menu holds
     only the Application section. There is no mouse or menu route to the window zoom (FR-113).
3. **Panel zoom** (FR-105, FR-106, FR-114). Ctrl+Alt+`=` (no Shift) and keypad Ctrl+Alt++ both zoom
   the active panel. Ctrl+Alt+Numpad0 (the physical Numpad0 key, not the main-row 0) resets it.
   Ctrl+wheel over a **non-active** panel zooms that panel's type and scrolls nothing;
   Ctrl+middle-click resets it too. Ctrl+wheel over the title bar or a side pane does nothing.
4. **Word wrap** (FR-091, FR-092). In an editor press Ctrl+E, then W.
   - **Expect**: a pending indication after Ctrl+E, then word wrap toggles. Ctrl+E then Escape
     cancels; Ctrl+E then Q reports it unbound and types nothing. In a terminal, Ctrl+E reaches the
     shell as before.
5. **Key Bindings capture** (FR-104, FR-105). Record Ctrl+Shift+Alt+F, the keypad `+` with
   Ctrl+Alt, and Ctrl+E W.
   - **Expect**: `Ctrl+Shift+Alt+F`, `Ctrl+Alt++` and `Ctrl+E W`. Focus File Explorer and Focus
     Projects are listed under Focus & Zoom.
6. **Upgrade** (FR-108). Start the new build on a dev config whose `keybindings.json` holds the
   version-12 defaults plus one customised action.
   - **Expect**: every untouched default moves; the customised action is byte-identical.
7. **Projects pane** (FR-072, FR-073, FR-075, FR-082, FR-083). Headers are bold, uppercase, on a
   highlighted background. The side-pane active outline is 1px. Click project B's name.
   - **Expect**: B becomes active, the outline stays on the Projects pane without flashing, and
     ArrowDown still moves in the list.
   - Drag B by its name (not the grip) into another category; the Edit button does not start a
     drag. Drag a non-default category header, and use Move Category Up / Down; the default stays
     first. Restart: the order holds.
8. **Unload** (FR-081, FR-086, FR-111). With a running `ping -t localhost` in B, right-click B.
   - **Expect**: exactly two rows, **Unload Project** and **Unload Project and End Terminals**.
     Neither shows a dialog. Unload Project, then select B: the ping and an idle second shell are
     the same processes with their scrollback. Unload Project and End Terminals: both end, no
     dialog. Preferences has no *Unload a project with running terminals* setting.
9. **Cog menu** (FR-074, FR-113). **Expect**: no Next / Previous Project or Focus entries, no Zoom
   row and no Zoom section — the Application items only.
10. **NumLock probe — maintainer only** (FR-113, FR-114; T149). Uses a physical keyboard, with the
    window and one panel already zoomed in from step 2 above.
    a. With NumLock **ON**, press Ctrl+Shift+Alt+Numpad0.
       - **Expect**: the WINDOW zoom resets to 100%, and the panel's zoom is unchanged. Record what
         actually happens: the hypothesis is that Windows synthesises a Shift key-up when NumLock is
         on and Shift is held on the keypad, which may make the press arrive as Ctrl+Alt+Numpad0
         instead and reset the panel rather than the window. Record which one actually reset.
    b. With NumLock **OFF**, repeat the same press (window and panel zoomed again if either reset in
       (a)) and record which one resets.
    c. The AltGraph probe (FR-104 hypothesis, research R22, also part of T149): whether Chromium
       reports `getModifierState('AltGraph')` for the right-hand AltGr key and not for left
       Ctrl+Alt. Run once; its result is shared between here and research R22.

    Record (a), (b) and (c) in research R22 and the PR description.
    *Result for (a) and (b) (maintainer, 2026-09-25):* NumLock ON resets the **panel**, not the
    window. NumLock OFF resets nothing. Recorded in research R22 and as spec FR-120, an open defect
    (tasks T189 / T190). (c) is still owed.

## 5b. Iterate round 3 (2026-09-25)

Where this section and §2 or §5a disagree, this section wins (spec FR-116 – FR-120, S27). In
particular, §2's and §5a step 1's F / P / B / N / M presses, and §5a step 5's recorded
`Ctrl+Shift+Alt+F`, describe chords that have moved.

1. **Upgrade on the existing dev config** (FR-118). Start the new build on the dev config that
   already ran version 13 (its `defaults-state.json` reads `13`), without clearing it.
   - **Expect**: `defaults-state.json` reads `14`. In `keybindings.json`, `focus.projects`,
     `focus.explorer`, `view.toggleProjects`, `view.toggleExplorer` and `focus.notice` hold
     `Ctrl+Shift+Alt+B`, `M`, `J`, `K` and `V`. Any binding you customised is byte-identical.
   - Preferences → Key Bindings → Focus & Zoom lists **Focus Workspace** on Ctrl+Shift+Alt+N, or
     unbound if you had customised the File Explorer toggle to keep N.
2. **Left to right** (FR-116, FR-117). With a tab holding an editor and a terminal, the editor
   active:
   - Ctrl+Shift+Alt+B. **Expect**: the Projects pane is outlined, with focus on the active row.
   - Ctrl+Shift+Alt+N. **Expect**: the workspace is outlined on the editor, and typing goes into it.
   - Ctrl+Shift+Alt+M. **Expect**: the File Explorer is outlined, and F2 renames its selection.
   - Ctrl+Shift+Alt+N again. **Expect**: back in the editor. Make the terminal active, go to a side
     pane, and press N. **Expect**: the terminal takes the input, and `cat -v` shows nothing from
     the chord.
3. **Nothing to focus** (FR-116). Close every tab, or select no project, go to the Projects pane,
   and press Ctrl+Shift+Alt+N.
   - **Expect**: nothing changes, and no notice appears.
4. **Collapse and expand** (FR-117). Ctrl+Shift+Alt+J, twice.
   - **Expect**: the left pane hides, then shows. Ctrl+Shift+Alt+K does the same for the right pane.
5. **Notices** (FR-117). With any notice on screen, press Ctrl+Shift+Alt+V.
   - **Expect**: focus goes to the notice, and Esc returns it.
6. **Retired chords** (FR-117). Press Ctrl+Shift+Alt+F and Ctrl+Shift+Alt+P from an editor and from
   a terminal.
   - **Expect**: nothing happens anywhere. In the terminal, `cat -v` shows nothing.
7. **Key Bindings capture** (FR-104). Record Ctrl+Shift+Alt+N on any command.
   - **Expect**: it records as `Ctrl+Shift+Alt+N`, whatever the layout produces.

## 6. Automated evidence to quote

- `npm run gate`: the run URL and its SHA (see the repo `CLAUDE.md`).
- The migration and chord tests named in [research.md](./research.md) R13 are part of that run. They
  need no separate invocation.
