# Manual test plan: 046 side panes and project list

Every change on the branch, grouped by feature. Sign a group off by its ID ("MT-03 signed off").
A group whose paths change after sign-off flips back to **needs retest**. The heavy CI gate runs
only once every group is signed off (the maintainer's rule, 2026-09-26).

**Setup for every group.** Build and start the dev app from this branch (`npm run build`, then the
dev launcher). Have three projects **A**, **B**, **C** with their own folders; B has a Git Bash
terminal. US keyboard, physical keypad for MT-05 and MT-07.

## Status

| ID | Group | Status | Signed off at | Date | Note |
|---|---|---|---|---|---|
| MT-01 | File Explorer name | untested | | | |
| MT-02 | Getting around: project and pane chords | untested | | | |
| MT-03 | Focus in the workspace: outline, arrows, caret | untested | | | |
| MT-04 | Choosing a project from the list | untested | | | |
| MT-05 | Zoom | untested | | | |
| MT-06 | Multi-key chords in the editor | untested | | | |
| MT-07 | Key Bindings capture box | untested | | | |
| MT-08 | Saved key bindings upgrade | untested | | | |
| MT-09 | Project menu and Unload | untested | | | |
| MT-10 | Project categories | untested | | | |
| MT-11 | Find bar Replace | untested | | | |
| MT-12 | Keyboard probes (maintainer hardware) | untested | | | |

---

## MT-01 File Explorer name

FR-001 – FR-004 · paths: `packages/ui/src/renderer/panes/**`, `packages/ui/src/renderer/workspace/panel-header*`, `docs/**`

1. Read the right-hand pane's header, collapse it to its rail, hover the rail's show control. You
   see "File Explorer" on the header and rail, and *Show File Explorer* on the tooltip.
2. Open a file in an editor and open its panel header menu. It reads *Reveal File in File Explorer*.
3. Preferences: settings and key bindings say File Explorer, never "Files & Folders".

## MT-02 Getting around: project and pane chords

FR-010 – FR-018, FR-074, FR-102, FR-110, FR-116, FR-117 · paths: `packages/core/src/config/keybindings*.ts`, `packages/ui/src/renderer/app.tsx`, `packages/ui/src/renderer/keybindings/**`, `packages/ui/src/renderer/sidebar/**`

With B's terminal focused and running `cat -v`:
1. Ctrl+Shift+Alt+PageDown, then PageUp. The next, then previous, project becomes active; `cat -v`
   prints nothing. At the last project, PageDown does nothing and shows no notice.
2. Ctrl+Shift+Alt+B, N, M. Focus goes to the Projects pane, the centre panel, the File Explorer,
   left to right. After N, typing goes into the centre panel.
3. Ctrl+Shift+Alt+J twice, then K twice. The left pane hides and shows, then the right.
4. With a notice on screen, Ctrl+Shift+Alt+V. Focus goes to the notice; Esc returns it.
5. Ctrl+Shift+Alt+T opens the tab picker, also from a terminal and from a find bar.
6. Ctrl+Shift+Alt+F and Ctrl+Shift+Alt+P do nothing, anywhere; the old Ctrl+Alt chords do nothing.
7. With no project, or no tab, press Ctrl+Shift+Alt+N from the Projects pane: nothing, no notice.
8. The title-bar cog has only the Application items: no Navigate, no Zoom.

## MT-03 Focus in the workspace: outline, arrows, caret

FR-024, FR-121, FR-122, FR-125, S28, constitution XI · paths: `packages/ui/src/renderer/workspace/**`, `packages/ui/src/renderer/app.tsx`, `packages/ui/src/renderer/panel-type/**`, `packages/ui/src/renderer/find-in-files/find-in-files-panel.tsx`

1. Click a centre panel: it is outlined. Ctrl+Shift+Alt+B: only the Projects pane is outlined, no
   centre panel. Ctrl+Shift+Alt+N: the same centre panel is outlined again.
2. Split a tab into an editor and an empty panel side by side. From the editor,
   Ctrl+Shift+Alt+ArrowRight: the empty panel is outlined and its type drop-down has focus; typing
   does not reach the editor. Every arrow direction behaves the same.
3. Make the other panel Find in Files. Move onto it: its search box has focus. Click its replace
   box, move away, move back: the replace box has focus.
4. From the Projects pane or File Explorer, Ctrl+Shift+Alt+Arrows: nothing moves, focus stays.
5. Open a file from the File Explorer: the editor and its status strip look dimmed until you click
   into the editor.
6. Click + for a new tab: its name box opens with focus; type a name, Enter. The name sticks and
   focus lands in the new tab's panel (its type drop-down).

## MT-04 Choosing a project from the list

FR-082, SC-012 · paths: `packages/ui/src/renderer/sidebar/projects-panel.tsx`, `packages/ui/src/renderer/state/projects-store.tsx`, `packages/ui/src/renderer/editor/use-editor.ts`, `packages/ui/src/renderer/terminal/use-terminal.ts`, `packages/ui/src/renderer/app.tsx`

1. Give A an editor with a file open, B a terminal. Visit each once.
2. In the Projects list, ArrowUp/Down to A, Enter. A becomes active; the Projects pane keeps its
   outline and the row keeps focus; typing does not reach A's editor.
3. The same to B (terminal): typing does not reach the shell.
4. Click a row instead of Enter: the same.
5. Now click into A's editor: it takes the outline and the caret.

## MT-05 Zoom

FR-105, FR-106, FR-113, FR-114, FR-120, FR-127 · paths: `packages/core/src/config/keybindings.ts`, `packages/ui/src/renderer/config/chord-key.ts`, `packages/core/src/config/chord-capture.ts`, `packages/ui/src/renderer/workspace/mouse-zoom*`, `packages/ui/src/main/**zoom*`

1. Ctrl+Shift+Alt++ twice: the whole window zooms. Ctrl+Shift+Alt+Numpad0 with NumLock ON, then
   again with NumLock OFF: the window resets both times; panel zoom is untouched.
2. Ctrl+Alt+= and keypad Ctrl+Alt++ zoom the active panel; Ctrl+Alt+Numpad0 (NumLock on and off)
   resets only that panel.
3. Ctrl+Wheel over a non-active panel zooms that panel; Ctrl+MiddleClick resets it. Over the title
   bar or a side pane, nothing.
4. Ctrl+Alt+0 on the main row resets the active panel, never the window; Ctrl+Shift+Alt+0 on the
   main row does nothing (FR-127). On a German layout, AltGr+0 in an editor still types `}`.

## MT-06 Multi-key chords in the editor

FR-091, FR-092, FR-124, FR-126, S29, S30 · paths: `packages/ui/src/renderer/editor/commands.ts`, `packages/ui/src/renderer/config/chord-key.ts`, `packages/core/src/config/keybindings.ts`

1. In an editor, hold Ctrl, press E, then W: word wrap toggles. A pending indication shows after E.
2. Hold Ctrl, press E, let go of Ctrl, press W: no toggle; a `w` is typed; no "not bound" notice.
3. Ctrl+E then Escape: cancels. Ctrl+E then Q (Ctrl held): "not bound", nothing typed.
4. In a terminal, Ctrl+E reaches the shell as always.
5. Bind a command to a three-key chord (MT-07) and press it the same way: it runs.

## MT-07 Key Bindings capture box

FR-104, FR-105, FR-120, FR-124, FR-126 · paths: `packages/ui/src/renderer/preferences/capture-modal.tsx`, `packages/core/src/config/chord-capture.ts`, `packages/core/src/config/keybindings.ts`

1. Record Ctrl+Shift+Alt+N: it records `Ctrl+Shift+Alt+N` on release, not before.
2. Record Ctrl+Alt with the keypad +: `Ctrl+Alt++`. Record Ctrl+Shift+Alt+Numpad0 with NumLock
   ON: `Ctrl+Shift+Alt+Numpad0`.
3. For Toggle Word Wrap, hold Ctrl, press E, then W, let go: `Ctrl+E,W`. Nothing records before
   every key is up. There is no two-stroke button.
4. Hold Ctrl, press E, W, Q, let go: `Ctrl+E,W,Q`.
5. Hold Ctrl, press E, W, Q, R: "Only three keys can follow the modifiers." Let go: it records
   `Ctrl+E,W,Q` and the box closes.
6. For a command that also works in a terminal (e.g. Toggle File Explorer), try a two-key chord: it
   is refused inline, nothing saved.
7. A first key that is already another command's whole chord: the conflict warning shows.

## MT-08 Saved key bindings upgrade

FR-108, FR-118, FR-124 · paths: `packages/core/src/config/shipped-defaults.ts`, `packages/ui/src/main/main.ts`

1. Start the build on your existing dev config without clearing it.
2. Preferences → Key Bindings: Focus Projects / Workspace / File Explorer on Ctrl+Shift+Alt+B / N /
   M, the pane toggles on J / K, Focus Notice on V, Toggle Word Wrap on `Ctrl+E,W`, Reset Panel
   Zoom on `Ctrl+Alt+Numpad0`, `Ctrl+Alt+0` and `Ctrl+MiddleClick`.
3. Anything you customised earlier is exactly as you left it.

## MT-09 Project menu and Unload

FR-030 – FR-038, FR-081, FR-086, FR-111 · paths: `packages/ui/src/renderer/sidebar/project-*`, `packages/ui/src/renderer/sidebar/projects-panel.tsx`, `packages/daemon/src/**unload*`

1. Right-click B: Edit, Rename, Remove, Move to Category ▸, **Unload Project** and **Unload Project
   and End Terminals**. Escape returns focus to the row; Shift+F10 and the Menu key open it too.
2. With `ping -t localhost` and an idle shell in B, Unload Project: no dialog; B's row greys. Select
   B: both shells are the same, with scrollback.
3. Unload Project and End Terminals: both end, no dialog.
4. A dirty editor in A, then unload A: the unsaved prompt comes first; Cancel keeps A loaded.
5. On an unloaded project, the Unload rows are disabled.

## MT-10 Project categories

FR-050 – FR-061, FR-072, FR-075, FR-083 · paths: `packages/ui/src/renderer/sidebar/**categor*`, `packages/ui/src/renderer/sidebar/projects-panel.tsx`, `packages/daemon/src/**migration*`

1. Existing projects all sit under **In Progress**, first, bold uppercase on a highlighted header.
2. Right-click C → Move to Category ▸ New Category… "Parked": C moves; survives a restart.
3. Minimise Parked: one header row with its count; Ctrl+Shift+Alt+PageDown skips C.
4. Drag a whole project row (not just the grip) into another category; drag a category header, and
   use Move Category Up / Down; In Progress stays first; the order survives a restart.
5. Delete Parked: its projects go to the end of In Progress. Renaming a category to "in progress" is
   refused inline. In Progress has no minimise and no Delete.

## MT-11 Find bar Replace

FR-093 and the replace-row gating · paths: `packages/ui/src/renderer/editor/find*`, `packages/ui/src/renderer/search/**`

1. In an editor's find bar with the replace row hidden, Alt+Enter and Ctrl+Alt+Enter do nothing.
2. Show the replace row: Alt+Enter replaces the current match, Ctrl+Alt+Enter replaces all.

## MT-12 Keyboard probes (maintainer hardware)

FR-104, FR-021 · T149 (c) · no code paths; re-offered only if MT-05 or MT-07 change

1. AltGraph: on a layout with AltGr (German), type AltGr+0 and AltGr+7 in an editor: `}` and `{`
   are typed; no zoom or other command fires.
2. In a Git Bash terminal, `bind -p | grep -E '\\e\\C-(e|f|p)'`: record the output in the PR.
