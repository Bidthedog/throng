# Manual test plan: Vault links, a notifications panel and agent session restore

Spec: `specs/068-vault-links-notifications-agent-restore/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Vault-root wikilinks in a Markdown preview | signed off | bee2c978f6f5 | 2026-11-14 | |
| MT-02 | Obsidian image embeds in a Markdown preview | signed off | bee2c978f6f5 | 2026-11-14 | |
| MT-03 | Toast lifetime, pause and close | signed off | bee2c978f6f5 | 2026-11-14 | |
| MT-04 | The Notifications panel | signed off | bee2c978f6f5 | 2026-11-14 | |
| MT-05 | Minimising the side panels and the pending badge | signed off | bee2c978f6f5 | 2026-11-14 | |
| MT-06 | Resuming a Claude Code session in a remembered terminal | signed off | bee2c978f6f5 | 2026-11-14 | |
| MT-07 | Anonymised diagnostic log and the project id hover | signed off | bee2c978f6f5 | 2026-11-14 | |
| MT-08 | Notification preferences | signed off | bee2c978f6f5 | 2026-11-14 | |

## MT-01: Vault-root wikilinks in a Markdown preview

Covers: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, SC-001, SC-002, #616
Paths: `packages/core/src/preview/**`, `packages/ui/src/renderer/preview/providers/markdown/**`, `packages/ui/src/main/preview-service.ts`, `packages/ui/src/main/preview-protocol.ts`, `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/preview/heading-hold.ts`

### Steps
1. In a project, create `Docs/Guide.md` with a heading `## Setup`, and `Notes/Today.md` containing `[[Docs/Guide]]`, `[[Docs/Guide#Setup|the setup]]` and `[[Missing/Page]]`. Open a preview of `Notes/Today.md`.
2. Hover `Docs/Guide`. The tooltip names `Docs/Guide.md` at the project root, not `Notes/Docs/Guide.md`.
3. Ctrl+click it. `Docs/Guide.md` opens.
4. Ctrl+click **the setup**. `Docs/Guide.md` opens at **Setup**.
5. Right-click `Docs/Guide`. Every menu entry names the root file; **Copy Path** copies its path.
6. Add `Notes/Docs/Guide.md` and reload the preview. `[[Docs/Guide]]` now goes to the note-folder file, as Obsidian does.

### Negative cases
- `[[Missing/Page]]` shows as an unresolved link and opens nothing outside the project.
- `[[../../outside]]` never opens a file outside the project.

## MT-02: Obsidian image embeds in a Markdown preview

Covers: FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-056, FR-057, FR-066, SC-003, #615
Paths: `packages/core/src/preview/embeds.ts`, `packages/ui/src/renderer/preview/providers/markdown/**`, `packages/ui/src/main/preview-service.ts`, `packages/ui/src/main/preview-protocol.ts`, `packages/ui/src/renderer/preview/providers/markdown/sanitise.ts`

### Steps
1. Put `images/diagram.png` in the project and `Notes/Today.md` containing `![[diagram.png]]`, `![[images/diagram.png|200]]` and `![[flow.mmd]]` (with `flow.mmd` at the project root). Open its preview.
2. The first image draws at its natural size; the second is 200 pixels wide, its proportions kept.
3. The Mermaid embed draws as a diagram, found at the project root.
4. Edit the PNG on disk. The preview shows the new image.
5. Add `![[images/diagram.png|200x100]]` and `![[images/diagram.png|Flow chart|200]]`. The first draws 200 by 100 pixels; the second 200 wide, and hovering it shows **Flow chart** with `images/diagram.png` below.
6. Add `![embedded image](images/diagram.png)` and hover the image. The hover shows **embedded image** and, on the next line, `images/diagram.png`.
7. Hover the `![[diagram.png]]` image. The hover shows only `diagram.png`, not the name twice.
8. Add `![embedded image](images/diagram.png|200)` and `![embedded image|200x100](images/diagram.png)`. The first draws 200 pixels wide, the second 200 by 100; hovering either shows **embedded image** and `images/diagram.png`, with no size in the path.

### Negative cases
- `![[nothing.png]]` shows a broken-embed marker, not an empty gap.
- An embed naming a file outside the project draws nothing.

## MT-03: Toast lifetime, pause and close

Covers: FR-020, FR-021, FR-021a, FR-021e, FR-022, FR-076, FR-077, FR-078, FR-079, FR-080, FR-081, SC-004, #618
Paths: `packages/ui/src/renderer/common/notification.tsx`, `packages/ui/src/renderer/common/toast-duration.ts`, `packages/ui/src/renderer/attention/**`, `packages/ui/src/renderer/explorer/paste-progress-notice.tsx`, `packages/ui/src/renderer/common/different-copy-notice.tsx`, `packages/ui/src/renderer/common/installed-version-notice.tsx`

### Steps
1. Raise an error, for example by creating a project at a folder that does not exist. A toast appears and leaves after about 3 seconds.
2. Raise it again and hold the pointer over the toast for 10 seconds. It stays; move away and it leaves about 3 seconds later.
3. Raise it again and Tab into the toast. It stays while focus is inside it.
4. Raise it again and click the toast's **X**. It closes at once.
5. Paste a large folder. The paste-progress card stays until the paste ends or you press **Cancel**.
6. Open Preferences › Notifications: **Toast width** shows 520 and accepts 300 to 800. Set 300 and raise a notice: the toast is 300 pixels wide. Set it back.
7. Raise a notice with a long message (for example a failure with a long path): the toast shows three lines and cuts the rest. Hover it: a popover shows the whole text, and the toast stays. A short toast shows no popover.
8. Open the Notifications panel: the same entry shows its whole text, and every entry shows the date and time it was raised. No toast shows a date or time.

### Negative cases
- No ordinary toast stays on screen longer than the toast duration once the pointer and focus have left.

## MT-04: The Notifications panel

Covers: FR-023, FR-024, FR-025, FR-026, FR-026a, FR-026b, FR-026c, FR-027, FR-028, FR-029, FR-030, FR-031, FR-031a, FR-031b, FR-031c, FR-031d, FR-031e, FR-031f, FR-031g, FR-061, FR-062, FR-063, FR-071, FR-072, FR-073, FR-074, FR-075, FR-083, FR-084, FR-085, FR-086, FR-087, FR-088, FR-089, SC-005, SC-005a, #618
Paths: `packages/ui/src/renderer/notifications/**`, `packages/ui/src/main/notification-store.ts`, `packages/ui/src/main/notifications-ipc.ts`, `packages/core/src/notice/notification-entries.ts`, `packages/ui/src/renderer/common/notification.tsx`, `packages/core/src/notice/place.ts`, `packages/core/src/notice/subject.ts`, `packages/ui/src/renderer/common/notice-text.ts`, `packages/ui/src/renderer/common/panel-subject.ts`, `packages/ui/src/renderer/attention/attention-toasts.tsx`, `packages/core/src/notice/display-mode.ts`

### Steps
1. Raise two errors and one warning. After their toasts leave, all three are in the **Notifications** panel at the bottom of the right pane, oldest first.
2. Close one error's toast with its **X** before it leaves. The entry is still in the panel.
3. Switch the order to **Newest first**, then **Priority, oldest first**. The list reorders; errors come before the warning.
4. Copy one entry. The clipboard holds its text.
5. Dismiss one entry with its **X**. It goes; the others stay.
6. Open Preferences and raise an error there (for example set an invalid value). The main window's panel gains the entry and flashes.
7. Restart throng. The remaining entries are still there.
8. Press **Dismiss all** and confirm. The panel empties and says it has nothing to show.
9. Set **Notifications panel limit** to 20 and raise 21 errors. The oldest is dropped and a warning toast says the panel is full, with a link that opens Preferences at Notifications. It does not leave on its own.
10. Dismiss the warning, raise more errors. It does not come back.
11. Make a terminal panel fail to start (give it a startup folder that does not exist), in a project and tab you can name. Its toast and its panel entry both read **Project › Tab › Panel** with those names, and Copy includes them.
12. Raise a notice about the whole app, for example a Preferences error. It names no project, tab or panel.
13. Switch to another project, then click the step 11 toast while it shows, anywhere except its buttons. throng switches to that project and tab and focuses the panel. Do the same with its panel entry. No **Go to panel** button is shown on either.
14. Click an entry's copy and X buttons. Each does only its own job and does not navigate.
15. Tab to an entry and press Enter. It goes to the panel, as a click does.
16. With the shipped defaults, raise an info notice (for example copy a path) and a success notice. Both toast, and both are kept in the panel.
17. Look at entries of several types: each has a soft, pale background in its type's colour and its type's icon before the title; there is no coloured strip down the left. Check a light and a dark theme.
18. Raise entries from two projects with different colours: each entry's border is its project's colour. An app-wide entry has the ordinary border.
19. Point at an entry that links to a panel: its border turns the project's highlight colour. Tab to it: the same. Point at an entry that is not a link: nothing changes.
20. Give a project, tab and panel long names and raise a notice there: the entry's path is cut off with an ellipsis.
21. Look at an entry with a title, a place and a long message: line 1 is its icon, date and time, repeat count and actions; then title, path and message, one line each, cut with an ellipsis where too long. Narrow the panel: line 1 drops the repeat count, then the date and time, then the icon; the actions stay.
22. Point at a cut-off entry: it expands in place to its whole text, wrapped, and the entries below move down; no popover. Tab to it: the same. Move the pointer slowly down across several entries: each expands as you reach it and nothing flickers or jumps back and forth.
23. Read a whole path or text anywhere (an expanded entry, a toast popover): no trailing ellipsis.
24. Point at a cut-off entry so it expands, right-click it and move the pointer through the context menu: the entry stays expanded. Click outside the menu and the entry to close it: the entry collapses. (Escape returns focus to the entry, so it stays expanded.)
25. Point at a short attention entry (nothing cut, no lists): nothing in it moves and its height does not change. Point at a cut-off entry: the spacing between its lines is the same expanded as at rest.
26. Point at a link entry of a coloured project: the border changes colour, never thickness.

### Negative cases
- **Dismiss all** does not clear any attention mark on a panel or tab.
- A notice whose type you set to **Toast** alone never appears in the panel.
- An app-wide notice, or one whose panel has been closed, does not act as a link.

## MT-05: Minimising the side panels and the pending badge

Covers: FR-035, FR-036, FR-037, FR-038, FR-039, FR-039a, FR-039b, FR-058, FR-059, FR-060, FR-067, FR-068, FR-069, FR-070, FR-082, #618, FR-093
Paths: `packages/ui/src/renderer/panes/**`, `packages/ui/src/renderer/notifications/**`, `packages/ui/src/renderer/app.tsx`, `packages/ui/src/renderer/sidebar/subworkspaces-panel.tsx`

### Steps
1. Minimise the Notifications panel. It collapses to its header bar; the panel above takes the space.
2. Raise a warning, then an error. The collapsed header shows a count of 2 in the error colour.
3. Minimise the Projects panel in the left pane. It collapses the same way.
4. Restart throng. Both panels are still minimised, and the sizes you dragged are kept.
5. Restore the Notifications panel. The count stays until you dismiss the entries.
6. The minimise control on the Notifications and Sub-workspaces panels is the same chevron as the side panes' hide control, pointing down while open and up while minimised, centred in its button.
7. With entries in the panel, the badge sits next to the **Notifications** title, both open and minimised, vertically centred with the title and at least one character away from it.
8. Hide the right pane. The collapsed strip reads **File Explorer & Notifications**, and the badge sits below that title, centred, with the same gap. The button that shows the pane carries no badge.
9. Minimise and restore the Notifications panel, hide and show the right pane, and narrow the window until the right pane auto-collapses, then widen it. The count never changes.
10. Dismiss entries one by one. The count drops with each; at zero the badge is gone from the title and the rail.
11. Minimise the Notifications panel, point at its header: the whole header highlights. Click anywhere on it: the panel restores. Do the same with the Sub-workspaces panel.
12. With either panel open, click its header and drag the resize handle beside it. It does not minimise; only its chevron button does.
13. Hide the left pane, point at its **Projects & Sub-workspaces** strip: the whole strip highlights; click it: the pane shows. Do the same with the right pane's **File Explorer & Notifications** strip.
14. In a project whose colour is not throng's highlight colour, point at a minimised panel header and at a collapsed strip: the highlight is throng's own colour, not the project's, and the text stays readable.
15. Click a panel's chevron to minimise it and keep the pointer still: the header does not flash the hover style. Move away and back: it highlights.
16. Collapse a side pane, then point at its strip and at its show (expand) button: either one highlights both together, and the button's icon turns the same contrasting colour as the strip's text.
17. Raise an error and an info notice, then look at the count badge beside the Notifications title and on the collapsed right rail: it is throng's highlight colour with readable text, the same colour it has with info entries alone.

### Negative cases
- Minimising never hides a panel's header, so it can always be restored.
- Restoring the panel or showing the right pane never clears the count.

## MT-06: Resuming a Claude Code session in a remembered terminal

Covers: FR-040, FR-041, FR-041a, FR-041b, FR-041c, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, SC-006, SC-007, #189
Paths: `packages/daemon/src/claude-session-resolver.ts`, `packages/daemon/src/terminal-service.ts`, `packages/core/src/terminal/claude-resume.ts`, `packages/core/src/terminal/command-line-args.ts`, `packages/platform-linux/src/proc-table.ts`, `packages/ui/src/renderer/terminal/**`

### Steps
1. Open a terminal panel with **Remember the last running command** ticked. Type `claude --model opus` and talk to it briefly.
2. Close throng, choosing to terminate terminals. Reopen it. The terminal runs `claude --model opus --resume <id>` and the earlier conversation is there.
3. In Claude Code, switch to another session with `/resume`. Close and reopen throng. The terminal resumes the session you switched to.
4. Repeat step 1 on Windows and on Linux.

### Negative cases
- In a panel without **Remember the last running command** ticked, nothing is run on reopening.
- Running `codex` or another CLI is remembered exactly as typed.
- `claude agents` is remembered as `claude agents`, and reopening shows the dashboard again.
- `claude "commit and push" --model opus` resumes with `--model opus` kept and the prompt NOT sent again.
- No notice appears at any point about resuming.

## MT-07: Anonymised diagnostic log and the project id hover

Covers: FR-034a, FR-034b, FR-034c, FR-034d, FR-034e, FR-034f, FR-064, SC-005b, #623
Paths: `packages/core/src/diagnostics/anonymise.ts`, `packages/platform-node/src/node-file-log.ts`, `packages/platform-node/src/machine-identity.ts`, `packages/ui/src/renderer/sidebar/projects-panel.tsx`, `packages/core/src/projects/project-service.ts`

### Steps
1. Hover a project's path in the Projects panel. The tooltip shows the path, then on the next line `(id: <id>)`.
2. Raise a few notices, then open the logs folder from the cog menu and read `main.log` and `daemon.log`.
3. Each notice is logged with `pending=<n>` and its project as `<project:ID>`, the same id the hover showed.

### Negative cases
- No log file contains your user name, machine name, home folder or a project's real path or name.

## MT-08: Notification preferences

Covers: FR-021b, FR-021c, FR-021d, FR-026c, FR-031d, FR-051, FR-052, FR-062, FR-065, FR-090, FR-091, FR-092
Paths: `packages/core/src/config/settings-metadata.ts`, `packages/ui/src/renderer/preferences/**`, `packages/ui/src/renderer/panel-type/terminal-inputs.tsx`, `packages/ui/src/renderer/explorer/use-elevated-drop-notice.ts`, `packages/core/src/resources/descriptions.ts`, `packages/platform-windows/src/windows-os-properties-dialog.ts`, `packages/platform-windows/src/windows-file-manager-registration.ts`, `packages/core/src/notice/display-mode.ts`, `packages/core/src/config/app-settings.ts`, `packages/core/src/config/metadata.ts`, `packages/ui/src/renderer/common/notification.tsx`

### Steps
1. Open Preferences › Notifications with a fresh configuration: every type toasts and keeps its notices in the panel (step 7 shows how).
2. **Toast duration** (1,000–30,000 ms), **Toast width** (300–800 px), **Confirm before dismissing all notifications** and **Notifications panel limit** (20–500) are listed with descriptions that match their behaviour.
3. Turn **Confirm before dismissing all notifications** off. **Dismiss all** in the panel clears it without asking.
4. Read the description of **Remember the last running command** on a terminal panel and in Preferences. It says Claude Code is resumed in the session that was running.
5. Read the OS notification descriptions in Preferences › Notifications and the switch that allows OS notifications. They say "OS", never "Windows". On Windows, drag a file into throng running as administrator: the notice says the OS blocks it, not Windows.
6. Drag **Toast width** and **Toast duration** to their lowest: they stop at 300 px and 1,000 ms. Raise a notice: its toast is 300 px wide and leaves after about a second.
7. Each type's row shows **Toast**, **Panel** and **OS Notify** checkboxes and no drop-down; on a fresh configuration **Toast** and **Panel** are ticked for every type.
8. Set info to **Panel** alone and raise an info notice: no toast shows, and the entry is in the Notifications panel. Set it to **Toast** alone: it toasts and adds no entry. Clear both: nothing shows.
9. Set errors to **Panel** alone, then clear **Panel**: throng asks before error notices stop showing. Cancel keeps it ticked.

### Negative cases
- No per-type duration setting is offered any more.
