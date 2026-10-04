# Manual test plan: 048 panel splitting and content-derived panel titles

Spec: `specs/048-panel-splitting/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Split from the + button | signed off | 97b70a4c2777 | 2026-10-01 | |
| MT-02 | Split from the right-click menus | signed off | 97b70a4c2777 | 2026-10-01 | |
| MT-03 | Split mode from the keyboard | signed off | 97b70a4c2777 | 2026-10-01 | |
| MT-04 | Drop a panel along a whole edge | signed off | 2f64793fae99 | 2026-09-30 | |
| MT-05 | Panels are named by what they hold | signed off | 97b70a4c2777 | 2026-10-01 | |
| MT-06 | Cancelling a drag with Esc | signed off | 491da28c8698 | 2026-09-30 | |
| MT-07 | A preview keeps its place across tabs | signed off | 491da28c8698 | 2026-09-30 | |
| MT-08 | Keyboard in a sub-workspace window | signed off | 97b70a4c2777 | 2026-10-01 | |
| MT-09 | Destroy Panel from the keyboard | signed off | 635e05703cea | 2026-10-01 | |
| MT-10 | Keyboard focus into a confirmed editor and between panels | signed off | 635e05703cea | 2026-10-01 | |

## MT-01: Split from the + button

Covers: FR-001, FR-002, FR-004, FR-010, FR-011, FR-012, FR-013, FR-014, SC-001, SC-002
Paths: `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/workspace/split-menu.ts`, `packages/ui/src/renderer/workspace/split-panel.ts`, `packages/ui/src/renderer/state/workspace-store.tsx`, `packages/core/src/workspace/operations.ts`

### Steps
1. Build a 2x2 layout (four panels in quadrants). Hover the bottom-left panel's **+**: its tooltip reads "Split panel…".
2. Click that **+**. A menu opens listing Split Down, Split Up, Split Right, Split Left, each with its chord. No panel has been added yet.
3. Choose **Split Right**. The bottom-left quadrant is divided left/right; the original keeps the left half, a new empty panel takes the right half and has keyboard focus. The other three panels have not moved or resized. No name box appears.
4. Undo the change by closing the new panel, then repeat with **Split Left**, **Split Down** and **Split Up**: the new panel lands on the named side each time, inside the quadrant.
5. Zoom one panel's text (Ctrl+Alt++), then split it. The original keeps its zoom; the new panel is at the default size.
6. Tab to a **+** button and press Enter: the menu opens; arrow keys move through the four items and Enter splits.
7. Click the **+** of a panel that is not the active one: that panel becomes active as the menu opens, and the split happens beside it.

### Negative cases
- Open the **+** menu and press Esc, or click elsewhere: the menu closes and the layout is unchanged.
- Open the **+** menu and start dragging a panel header: the menu closes.

## MT-02: Split from the right-click menus

Covers: FR-015, FR-016, US2
Paths: `packages/ui/src/renderer/workspace/panel-header-menu.ts`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/context-menu-provider.tsx`, `packages/ui/src/renderer/editor/content-menu.ts`, `packages/ui/src/renderer/terminal/terminal-content-menu.ts`, `packages/ui/src/renderer/preview/content-menu.ts`, `packages/ui/src/renderer/find-in-files/content-menu.ts`, `packages/ui/src/renderer/workspace/split-menu.ts`

### Steps
1. Right-click a panel header. A **Split ▸** item sits in its own group; its submenu lists the four directions with chords. Choose one: the result matches the **+** menu's.
2. Right-click inside an editor, a terminal, a Markdown preview, a Find in Files panel, an empty (untyped) panel and a dormant (stopped) terminal in turn. Each menu has **Split ▸** with the same four items.
5. With a File Explorer right-click menu open, click a panel's **+** once: the split menu opens on that first click.
3. Focus a panel and press Shift+F10, open **Split** with the arrow keys and choose a direction with Enter. The split happens.
4. In Key Bindings, rebind Split Down to another chord. Reopen either menu: Split Down shows the new chord.

### Negative cases
- No panel menu offers Rename or Reset Name.

## MT-03: Split mode from the keyboard

Covers: FR-020, FR-020a, FR-021, FR-022, FR-023, FR-025, FR-026, SC-003, SC-004
Paths: `packages/ui/src/renderer/keybindings/window-dispatcher.tsx`, `packages/ui/src/renderer/preferences/capture-modal.tsx`, `packages/core/src/config/keybindings.ts`, `packages/ui/src/renderer/keybindings/chord-engine.ts`, `packages/ui/src/renderer/workspace/split-mode.ts`, `packages/ui/src/renderer/editor/pending-chord.tsx`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/theme.css`

### Steps
1. Focus a terminal panel and type a word without pressing Enter. Hold Ctrl+Shift+Alt, press and release End. The panel's border pulses and its status bar reads "(Ctrl+Shift+Alt+End) was pressed. Waiting for the next key of the chord…".
2. Still holding Ctrl+Shift+Alt, press ↓. A new empty panel appears below, focused; the pulse and text are gone.
3. Go back to the terminal: the typed word is still there and nothing else was typed.
4. Press Ctrl+Shift+Alt+End, release all keys, then press →. The panel splits to the right.
5. Press Ctrl+Shift+Alt+End, then Esc. Nothing splits, the pulse stops, focus stays on the panel, and the terminal received nothing.
6. Press Ctrl+Shift+Alt+End, then Q. Nothing splits; a notice reads "The key combination (Ctrl+Shift+Alt+End,Q) is not bound."
7. Press Ctrl+Shift+Alt+End and wait: split mode ends by itself after a few seconds.
8. With focus in File Explorer, press Ctrl+Shift+Alt+End: focus jumps to the active panel, which pulses.
9. With Windows' "Show animations" turned off, enter split mode: the border is highlighted steadily instead of pulsing.
10. In Key Bindings, rebind Split Right to a single chord (for example Ctrl+Alt+F9). With a terminal focused, press it: the panel splits right and the terminal receives nothing.
11. In Key Bindings, rebind Zoom panel type in to Ctrl+Shift+Alt+Home, then Z. With a terminal focused, press it: the terminal's text grows and the terminal receives neither key. Try binding it to Ctrl+E, then Z: the capture box says the first key is reserved for the terminal.

### Negative cases
- During split mode, Ctrl+Shift+Alt+← never moves focus to another panel; it splits left.
- Esc in split mode does not close an open find bar.

## MT-04: Drop a panel along a whole edge

Covers: FR-060, FR-061, FR-062, FR-063, FR-064, FR-065, FR-067, FR-068, SC-005, SC-006, SC-009
Paths: `packages/ui/src/renderer/workspace/outer-edge-zones.tsx`, `packages/ui/src/renderer/workspace/tab-group.tsx`, `packages/ui/src/renderer/workspace/drag-state.ts`, `packages/ui/src/renderer/theme.css`, `packages/core/src/workspace/operations.ts`

### Steps
1. Build a 2x2 layout plus a fifth panel. Drag the fifth panel's header toward the far left of the panel area. A narrow band lights up and a preview shows a full-height column, about a third of the width, looking different from a single panel's edge highlight.
2. Release. The fifth panel is a full-height column on the left, a third of the width, beside the untouched 2x2 block.
3. Drag it to the bottom band instead: it becomes a full-width row along the bottom, a third of the height.
4. Drag the pointer into a corner where the left and bottom bands meet: only the left band lights, and the drop does what the preview showed.
5. Restart throng: the layout comes back the same.
6. Do the same drop in a sub-workspace window: only that window changes.

### Negative cases
- A tab with only one panel shows no outer bands when another tab's panel is dragged over it.
- Releasing over a panel's own edge zone, away from the outer band, splits just that panel as before.
- Dropping the full-height left column back on the left band changes nothing.

## MT-05: Panels are named by what they hold

Covers: FR-030, FR-031, FR-032, FR-035, FR-036, FR-037, FR-038, FR-127, FR-128, SC-007, SC-008
Paths: `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`, `packages/core/src/workspace/panel-title.ts`, `packages/core/src/workspace/panel-title-migration.ts`, `packages/daemon/src/workspace-service.ts`, `packages/core/src/workspace/unique-name.ts`, `packages/core/src/workspace/operations.ts`, `packages/ui/src/renderer/state/workspace-store.tsx`, `packages/daemon/src/panel-name-service.ts`

### Steps
1. Before updating, in alpha8, rename two panels (F2) to custom names and close throng. Start this build: the layout loads without error, and each renamed panel shows its content's name (file name, shell and folder), or "Blank Panel …" for an empty one.
2. Double-click a panel's title: no text box appears.
3. Focus a terminal and press F2: the program in the terminal receives it (for example, a shell prints nothing or its own F2 behaviour); the panel is not renamed.
4. In File Explorer, select a file and press F2: the file rename box opens as before.
5. Open Key Bindings and search "rename panel": nothing is listed.
6. Rename a tab, a project and a sub-workspace: each works as before.
7. Split a panel with the **+** menu several times: every new empty panel is called exactly "Blank Panel", with no number — in its header, the tab popover, the status bar and the window title. Give one a terminal: it shows the terminal's name instead.
8. Add a new tab, and create a second project: their empty panels are "Blank Panel" too.
9. A layout saved by an earlier build with empty panels called "Panel 1", "Panel 2" loads with each shown as "Blank Panel".

### Negative cases
- No panel header menu has Rename or Reset Name.

## MT-06: Cancelling a drag with Esc

Covers: FR-080, FR-081, FR-082, SC-010, #458
Paths: `packages/ui/src/renderer/workspace/tab-group.tsx`, `packages/ui/src/main/ghost-window.ts`

### Steps
1. Drag a panel by its header until the drag image appears, press Esc while still holding the button, then release. The drag image and every highlight disappear at once; the layout is unchanged.
1a. Do the same with a terminal panel that is running a program (for example Claude Code): the drag cancels and the program does not react to an Esc.
2. Do the same with a tab dragged along the tab strip.
3. Drag a panel over another tab until that tab shows, then press Esc: that tab stays showing.
4. Start another drag: exactly one drag image appears and it behaves normally.

### Negative cases
- After an Esc-cancelled drag no drag image remains floating over the window.

## MT-07: A preview keeps its place across tabs

Covers: FR-083, FR-084, SC-011, #459
Paths: `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx`, `packages/ui/src/renderer/preview/preview-store.ts`

### Steps
1. Open a long Markdown preview with tables in tab A, collapse two sections near the top, and scroll to the middle. In tab B open another preview with collapsed sections, scrolled past them.
2. Drag tab A's preview header onto tab B, move across several of tab B's drop zones, return to tab A and release where it started. The preview is exactly where you left it.
3. Repeat, pressing Esc instead of releasing: same result.
4. Switch between tab A and tab B a dozen times: tab A's preview stays at its place each time.
5. With the preview's editor open and scroll sync on, hide and show its tab: the preview returns to its own place, and the editor to its own.

### Negative cases
- The preview never comes back at the top, or at tab B's position.

## MT-08: Keyboard in a sub-workspace window

Covers: FR-090, FR-091, FR-092, FR-093, FR-129, SC-012, #275
Paths: `packages/ui/src/renderer/keybindings/window-dispatcher.tsx`, `packages/ui/src/renderer/subworkspace-app.tsx`, `packages/ui/src/renderer/navigate/navigation-chrome.tsx`, `packages/ui/src/renderer/editor/editor-open.tsx`, `packages/ui/src/renderer/editor/open-into-panel.ts`, `packages/ui/src/renderer/editor/open-router.ts`

### Steps
1. Sync a panel to a new sub-workspace window and put two panels in it. Ctrl+Shift+Alt+Arrows move focus between them.
2. Split mode (Ctrl+Shift+Alt+End, then an arrow) splits a panel in that window; the main window is unchanged.
3. Quick Open, Go To Line and Back/Forward work there as before.
4. Press Ctrl+Shift+Alt+PageDown (next project) in the sub-workspace window: a notice says the command is not available in a sub-workspace window.
5. Repeat with an empty (untyped) panel active, which has no status bar: the same notice still appears on the panel.
6. Press Ctrl+Shift+Alt+T in the sub-workspace window: the Go to Tab picker appears bright above a dimmed window, exactly as in the main window.
7. Focus an editor created inside the sub-workspace (not synced from a project) and press Ctrl+Shift+T: a notice says Quick Open is not available in a sub-workspace window.
8. Focus a terminal synced from a project, press Ctrl+Shift+T and pick a file: it opens in an editor in the sub-workspace window, with no error. Pick another file: it opens too.

### Negative cases
- In a sub-workspace terminal, a chord that is not available there never types into the shell.

## MT-09: Destroy Panel from the keyboard

Covers: FR-131, #461
Paths: `packages/core/src/config/keybindings.ts`, `packages/core/src/config/keybindings-metadata.ts`, `packages/ui/src/renderer/keybindings/window-dispatcher.tsx`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/workspace/panel-header-menu.ts`

### Steps
1. Split a panel a few times so a tab holds several panels. Click into an empty panel and press Ctrl+Shift+Alt+F4: that panel is destroyed, with no confirmation.
2. Open a file in an editor, type a change without saving, and press Ctrl+Shift+Alt+F4 with the editor focused: the same unsaved-changes prompt as the panel menu's Destroy appears.
3. Start a terminal running a program (for example `ping -t localhost`), focus it and press Ctrl+Shift+Alt+F4: the same running-terminal confirmation as the menu's Destroy appears, and the program sees no keypress.
4. Focus a Markdown preview and press Ctrl+Shift+Alt+F4: the preview closes.
5. Focus a Find in Files panel and press Ctrl+Shift+Alt+F4: it is destroyed.
6. In a sub-workspace window, focus a panel and press Ctrl+Shift+Alt+F4: it behaves as the menu's Destroy/Close item does there.
7. Open a panel's menu: the Destroy (or Close) item shows Ctrl+Shift+Alt+F4. Open Preferences › Key Bindings, search "Destroy Panel", rebind it, and the new chord works instead.

### Negative cases
- Ctrl+Shift+Alt+F4 never closes the throng window itself (Windows must not read it as Alt+F4) — in the main window or a sub-workspace window.
- With the File Explorer or Projects pane focused, Ctrl+Shift+Alt+F4 destroys nothing.
- Destroying a tab's last panel behaves exactly as the menu's Destroy does on it.

## MT-10: Keyboard focus into a confirmed editor and between panels

Covers: FR-132, FR-133
Paths: `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/keybindings/window-dispatcher.tsx`

### Steps
1. On an empty panel, choose Editor in "Choose a type", Tab to **Confirm** and press Enter: the new editor has the caret, and typing goes straight into it.
2. Do the same, clicking **Confirm** with the mouse: the editor has the caret.
3. Do the same choosing Terminal: the terminal has focus, as before.
4. On an empty panel, expand "Choose a type", then press Ctrl+Shift+Alt+Arrow to move to another panel: the drop-down closes and focus is in the other panel.
5. Open a panel's menu, then move to another panel with Ctrl+Shift+Alt+Arrow: the menu closes.
6. Open an editor's find bar, move to another panel with Ctrl+Shift+Alt+Arrow and back: the find bar is still open with its text.

### Negative cases
- Switching tabs or projects does not move the caret into an editor that was not focused before.
