# Manual test plan: Resource Monitor (055)

Spec: `specs/055-resource-monitor/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Status bar usage figures | untested | | | |
| MT-02 | Opening, closing and resizing the monitor | retired → MT-08 | | | |
| MT-03 | Drilling into the breakdown | needs retest | | | failed: Panel titles should update as they change in the application - they seem to stay static, or refer to the terminal that is loaded. Use the panel title instead of the terminal title. |
| MT-04 | Graphs, filter and idle hiding | needs retest | | | failed: The drop-down does not make sense as a UX component (Everything, components, all the projects) - remove it. 'Size by' should be 'Order By'. |
| MT-05 | Unload, destroy and kill from the monitor | untested | | | |
| MT-06 | Held folders | untested | | | |
| MT-07 | Resource Monitor preferences | untested | | | |
| MT-08 | The monitor window | needs retest | | | failed: UI seems really slow; feedback lacking - can't tell what can be clicked, what is active, what is refreshing; not sure how to use it |
| MT-09 | Finding your way around the monitor | retired → MT-10 | | | |
| MT-10 | Finding your way around the two-column monitor | needs retest | | | failed: Selecting a component or a project should highlight that line - hover when selected does not need its own style. When clicking on something in the right pane, the left pane should not change. The drill-down elements should show all 4 stats at all times. |
| MT-11 | Selecting, ordering and reading the left list | untested | | | |
| MT-12 | The right column and Activate | untested | | | |
| MT-13 | The monitor's layout: full-width header and movable divider | untested | | | |
| MT-14 | Network figures | untested | | | |

## MT-01: Status bar usage figures

Covers: FR-040, FR-041, FR-042, FR-044, FR-045, FR-046
Paths: `packages/ui/src/renderer/resources/status-resources.tsx`, `packages/ui/src/renderer/resources/figures.ts`, `packages/ui/src/renderer/theme.css`, `packages/ui/src/main/resource-monitor-host.ts`, `packages/ui/src/collector/**`, `packages/core/src/resources/**`

### Steps
1. Start throng with a project open. Within a few seconds the right of the status bar shows CPU, RAM, GPU and I/O figures, beside the daemon indicator, which has not moved.
2. Hover the figures. A tooltip breaks each total down by UI, Daemon, Helpers and Projects.
3. In a terminal run `node -e "for(;;){}"`. Within two captures the CPU figure rises; once it passes 50% of the machine it takes the warning colour, and past 80% the critical colour. Ctrl+C returns it to normal.
4. Narrow the window gradually. GPU disappears first, then I/O, then RAM; CPU stays to the last.
5. Switch theme. The figures and their band colours follow the theme.

### Negative cases
- No figure ever reads 0 while it is loading or unavailable; it shows a loading or unavailable state instead.
- A sub-workspace window has no usage figures in its own status bar.

## MT-03: Drilling into the breakdown

Covers: FR-020, FR-021, FR-022, FR-023, FR-024, FR-030, FR-032, FR-060, FR-068, FR-080
Paths: `packages/ui/src/renderer/resources/breakdown.tsx`, `packages/ui/src/renderer/resources/share-bars.tsx`, `packages/ui/src/renderer/resources/breadcrumb.tsx`, `packages/ui/src/renderer/resources/detail-pane.tsx`, `packages/ui/src/renderer/resources/use-breakdown-keys.ts`, `packages/core/src/resources/**`

### Steps
1. With two projects loaded and one unloaded, open the monitor. The top level shows UI, Daemon, Helpers and Projects, each with its rolled-up figure.
2. Open Projects. Every project is listed, active and loaded first; the unloaded one is grey and italic.
3. Double-click a project, a tab, then a terminal panel on the left. Each panel is named as its own header names it — not the shell's name — and its shell appears with a friendly name (PowerShell, Git Bash…), with anything running in it — e.g. `node`, `git`, `claude` — beneath it. The breadcrumb names each level.
3a. With the monitor open, `cd` into another folder in that terminal, or run a command that sets the terminal's title. The panel's name in the monitor changes to match its header at the next capture.
4. Each level's figure equals the sum of its children plus its own (check one level by eye).
5. Open an editor panel with a large file. Its memory reads like "~12.4 MB" (estimated); its CPU reads "-".
6. With focus in the breakdown, Up/Down move the selection; Right or Enter drills in; Left or Backspace goes back up.
7. Open Helpers. Console hosts, folder locks and the resource collector are listed by name.

### Negative cases
- Nothing outside throng (your browser, Explorer) appears anywhere in the hierarchy.
- Numbers are digit-grouped with readable units (KB, MB, GB).

## MT-04: Graphs, filter and idle hiding

Covers: FR-031, FR-033, FR-061, FR-065
Paths: `packages/ui/src/renderer/resources/line-graph.tsx`, `packages/ui/src/renderer/resources/sparkline.tsx`, `packages/ui/src/renderer/resources/toolbar.tsx`, `packages/ui/src/renderer/resources/monitor-model.ts`, `packages/core/src/resources/**`

### Steps
1. Open the monitor, select a row and wait a minute. Its line graphs on the right fill in from empty and grow over the history window.
2. Switch **Order by** between CPU, Memory, GPU and I/O. The left list and the right column's bars re-rank for that figure.
3. Type a process name into the filter. Only matching nodes and their parents remain; clearing the filter restores everything. Filter by a pid and by part of a command line — both match.
4. Toggle **Hide idle**. Processes using under 0.1% CPU with no I/O disappear.
5. Change the capture interval in the toolbar. The graphs and figures update at the new rate.
6. Turn **Hide ended processes** off. Start `node -e "setTimeout(()=>{},20000)"` in a terminal, find it in the monitor, and wait for it to exit. It stays in place, greyed and struck through, with its history. Close and reopen the monitor: it is gone, and the graphs start empty.

### Negative cases
- A process at or above the memory warning level is never hidden by **Hide idle**.
- There is no drop-down to narrow the monitor to a component or a project.

## MT-05: Unload, destroy and kill from the monitor

Covers: FR-062, FR-063, FR-064, FR-065, FR-066
Paths: `packages/ui/src/renderer/resources/node-actions.tsx`, `packages/ui/src/renderer/resources/kill-confirm.tsx`, `packages/ui/src/renderer/resources/kill-cause.ts`, `packages/ui/src/renderer/resources/monitor-notice.tsx`, `packages/ui/src/renderer/workspace/tab-destroy.ts`, `packages/ui/src/renderer/workspace/panel-destroy.ts`, `packages/ui/src/renderer/sidebar/use-unload-project.ts`, `packages/ui/src/collector/collector.ts`, `packages/core/src/resources/**`

### Steps
1. In a terminal run `node -e "require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1e3)'],{stdio:'inherit'});setInterval(()=>{},1e3)"`. In the monitor, right-click the child `node`: **Kill Process** only. Confirm twice (the default). The child ends; its parent stays.
2. Right-click the parent `node`: **Kill Process** and **Kill All Below**. Choose **Kill All Below** and confirm. The parent and anything under it end; the shell and the panel stay, back at a prompt.
3. Right-click the terminal panel node. **Destroy Panel** and **Kill All Below** are offered. **Kill All Below** ends everything running in it; the panel stays, showing the shell has exited, as any shell exit would.
4. Right-click a tab node: **Destroy Tab** uses the usual tab confirmations and destroys it.
5. Right-click a project: **Unload Project** rows match the project list's own; choose one and the project unloads (grey, italic).
6. Move a tab into a sub-workspace, then use **Destroy Tab** on it from the monitor. It is destroyed in the sub-workspace window.
7. Set **Kill processes** to `none` in Preferences → Confirmations. Kill Process now acts without asking.

### Negative cases
- Nodes under UI, Daemon or Helpers offer no actions at all.
- A kill that cannot complete (e.g. an elevated process) raises one inline notice in the monitor that says why in plain words; a second failure replaces it rather than stacking another.

## MT-06: Held folders

Covers: FR-070, FR-071, FR-072
Paths: `packages/ui/src/renderer/resources/held-folders.tsx`, `packages/daemon/src/resource-roster-service.ts`, `packages/core/src/resources/**`

### Steps
1. With a terminal open in a project, open the monitor's **Held folders** section. The project's folder is listed with its project and each terminal holding it, by tab and panel name.
2. Click a terminal named there. The breakdown jumps to that panel.
3. Close every terminal in that project. At the next capture the folder leaves the list.

### Negative cases
- A project with no terminals open lists no held folder.

## MT-07: Resource Monitor preferences

Covers: FR-004, FR-046
Paths: `packages/ui/src/renderer/preferences/form-controls.tsx`, `packages/ui/src/renderer/preferences/settings-tab.tsx`, `packages/core/src/config/settings-metadata.ts`, `packages/core/src/resources/settings-resolution.ts`

### Steps
1. Open Preferences → Settings → **Resource Monitor**. Six sliders: capture interval, history window, CPU warning/critical, memory warning/critical.
2. Set history to 12 minutes and the interval to 2 s. A note beside the interval reads "Raised to 15 s: the minimum for a 12-minute history".
3. Lower the CPU warning to 5%. The status-bar CPU figure takes the warning colour at once.
4. Preferences → Key Bindings lists **Resource Monitor** at `Ctrl+Shift+Alt+R`.

### Negative cases
- History cannot be set above 30 minutes or below 1; the interval cannot go below 2 s.

## MT-08: The monitor window

Covers: FR-043, FR-051, FR-052, FR-055, FR-056, FR-057, FR-081, FR-082, FR-083, FR-084, FR-085, FR-086, FR-087, FR-050, FR-053, FR-054
Paths: `packages/ui/src/renderer/resources/monitor-app.tsx`, `packages/ui/src/renderer/resources/monitor-session.ts`, `packages/ui/src/renderer/resources/monitor-store.ts`, `packages/ui/src/renderer/resources/node-actions.tsx`, `packages/ui/src/renderer/resources/use-estimates-reporter.ts`, `packages/ui/src/renderer/title-bar/**`, `packages/ui/src/renderer/title-bar/cog-menu-items.ts`, `packages/ui/src/renderer/keybindings/window-dispatcher.tsx`, `packages/ui/src/renderer/theme.css`, `packages/ui/src/main/resource-monitor-window.ts`, `packages/ui/src/main/floating-window-layering.ts`, `packages/ui/src/main/preferences-window.ts`, `packages/ui/src/main/resources-ipc.ts`, `packages/ui/src/main/main.ts`, `packages/ui/src/preload/preload.cts`

### Steps
1. Click the status-bar figures. The Resource Monitor opens at once as its own window over throng, looking like the Preferences window — same title bar, chrome and theme — with a Minimise control as well; a loading state shows where data is not yet in.
2. Drag the monitor's title bar. The window moves.
3. With the monitor open, click into a terminal behind it and run `node -e "setInterval(()=>{},1e3)"`. Throng responds normally, the monitor stays above it, and the new `node` process appears under that panel in the monitor at its next capture.
4. Open a new tab, then unload a project, from throng's own window. Both changes appear in the monitor without reopening it: the tab under its project, the project greyed and italic.
5. Switch to another application. The monitor goes behind it with the rest of throng; click back into throng and the monitor is above throng's windows again.
6. Click **Maximise**: it fills the screen. Click **Restore**: it returns to its previous size and place.
7. Click **Minimise**. It shrinks down into the main window's status-bar figures with an animation and closes.
8. Move and resize the monitor, drill two levels into a project, change the metric, then close it with **Esc**. Reopen it with `Ctrl+Shift+Alt+R`: it opens where you left it, at that size, on the same metric and node.
9. From a sub-workspace window, choose **Resource Monitor** from the cog. The same monitor window comes forward; no second one opens.
10. Close it with the X at the top right. Tab through it when open: every control is reachable and shows a focus ring.
11. With a tab in a sub-workspace, use **Destroy Tab** on it from the monitor. The sub-workspace window comes forward and asks its usual confirmation there.
12. Use **Unload Project** on a project from the monitor. The main window comes forward and the project unloads exactly as from the project list; the monitor shows it greyed at its next capture.
13. Tab to a node in the breakdown and press `Shift+F10`. Its menu opens. Choose **Kill Process**, then press **Esc** at the confirmation: the confirmation closes and the monitor stays open.
14. Open Preferences while the monitor is open. Both float above throng; clicking either brings it in front of the other.

### Negative cases
- The monitor never stays above another application's window.
- Typing in a terminal does not stall or stutter while the monitor is open or after it closes.
- Minimising throng's main window takes the monitor with it; closing the main window closes it.
- Reopening after the node you were on has ended lands on its nearest surviving parent, not an empty view.

## MT-10: Finding your way around the two-column monitor

Covers: FR-095, FR-096, FR-097, FR-088, FR-089, FR-090, FR-091, FR-092, FR-093, FR-094, SC-010, FR-060
Paths: `packages/ui/src/renderer/resources/**`, `packages/ui/src/renderer/theme.css`, `packages/core/src/config/number-format.ts`, `packages/core/src/resources/bands.ts`, `packages/core/src/config/theme.ts`, `packages/core/src/config/theme-copy.ts`

### Steps
1. Open the monitor with a few terminals running. It has two columns under a full-width header (filter, toolbar, breadcrumb with Back greyed at the top): the components listed on the left with their column headers, and the right column describing the level shown. There are no stacked area charts and no treemap.
2. Double-click Projects, then single-click a project row. It is marked with an accent edge, and the right column shows that project: its name and actions, its tabs as ranked share bars each with all its figures, its stats, and a small line graph each for CPU, Memory, GPU, I/O and Network.
3. Click a bar on the right. Nothing changes in either column.
4. Double-click a row on the left. The left column drills into it and the breadcrumb updates; Back returns. No row has a ▸ button. A process with no children does not drill.
5. Rest the pointer on a row for several captures. The left list's order and figures stay still, and the row's hover title stays up without flickering. The right column keeps updating. Move the pointer off the list: it catches up.
6. Run `node -e "for(;;){}"` in a terminal and select its panel. On the right, the busy process's bar is drawn in the high colour and idle ones in the low colour, with a key showing the scale. Switch Order by to Memory: the bars re-rank and recolour.
7. Watch "Updated <time> · every 2 s": it pulses at each capture. A just-opened line graph says it is building its history.
8. Click "?". It explains the two columns, click and double-click, the keys and the colours. Esc closes it.
9. Type a process name in the filter quickly. The text keeps up, a match count shows, and each process appears once; nonsense shows "No process matches '…'".
10. Tab through the window. Every control shows a clear focus ring. Right-click a row (or Shift+F10): its actions menu opens.

### Negative cases
- No selection detail appears anywhere but the right column.
- No hover title anywhere changes while the pointer rests on it.
- The monitor does not stutter at each capture, with or without a filter typed.

## MT-11: Selecting, ordering and reading the left list

Covers: FR-098, FR-099, FR-100, FR-101, FR-102, FR-103, FR-104, FR-105, FR-106, FR-107
Paths: `packages/ui/src/renderer/resources/breakdown.tsx`, `packages/ui/src/renderer/resources/toolbar.tsx`, `packages/ui/src/renderer/resources/monitor-model.ts`, `packages/ui/src/renderer/resources/monitor-session.ts`, `packages/ui/src/renderer/resources/format.ts`, `packages/ui/src/renderer/resources/use-breakdown-keys.ts`, `packages/ui/src/renderer/resources/help-panel.tsx`, `packages/ui/src/renderer/theme.css`, `packages/core/src/resources/**`

### Steps
1. Open the monitor. The left column lists UI, Daemon, Helpers and Projects only, with a **Total** row at the bottom showing each column's figure for throng.
2. Rest the pointer on each component. Its title says in a sentence or two why it exists and what it does (e.g. Daemon keeps terminals running when throng's windows close). Do the same on a Helpers child such as a console host.
3. Click Projects. Its row is highlighted; move the pointer over it — it keeps the same highlight, with no extra hover look. Click another row: only that one is highlighted. Click it again: nothing is highlighted.
4. Press Down and Up with focus in the list. The highlight moves, and the right column follows it.
5. Click the **Memory** column header. The list re-orders by memory, the Memory header is marked, the header line reads "Ordered by Memory", and the toolbar's **Order by** shows Memory. Click **CPU**: back to CPU.
6. Double-click Projects. Your projects are listed, with their own Total row at the bottom.
7. Type a filter that hides some rows. The Total row's figures do not change, and it says how many rows it counts that are hidden.
8. Open an editor panel and find it in the list. Its memory reads like "~12.4 MB"; its CPU, GPU and I/O read "-". Each one's hover title says why (estimated, not measured).
9. Start `node -e "setTimeout(()=>{},10000)"` in a terminal and watch it in the monitor. When it exits it leaves the list at the next capture (**Hide ended processes** is on). Turn **Hide ended processes** off and repeat: the ended process stays, greyed and struck through, and no total includes it.
10. Narrow the window, or drag the divider left, until the list is tight. Columns drop off the right edge one at a time and a marker appears at the right of the header, naming the hidden columns on hover. The name column stays. Widen it again: the columns return.

### Negative cases
- No horizontal scrollbar ever appears under the left list, at any width.
- There is no drop-down to narrow the view to a component or project, and no block of the highlighted row's figures in the left column.
- The Total row cannot be selected and has no actions.
- No figure anywhere reads "not measured", "unavailable" or "estimated" as a word.

## MT-12: The right column and Activate

Covers: FR-108, FR-109, FR-110
Paths: `packages/ui/src/renderer/resources/detail-pane.tsx`, `packages/ui/src/renderer/resources/share-bars.tsx`, `packages/ui/src/renderer/resources/node-actions.tsx`, `packages/ui/src/renderer/resources/route-action.ts`, `packages/ui/src/renderer/resources/use-subject.ts`, `packages/ui/src/main/resources-ipc.ts`, `packages/ui/src/preload/preload.cts`, `packages/ui/src/renderer/app.tsx`, `packages/ui/src/renderer/subworkspace-app.tsx`

### Steps
1. Select a project on the left. The right column lists its tabs; each shows CPU, Memory, GPU, I/O and Network figures, with a bar sized by the Order by metric. Change Order by: the bars re-rank, and every figure stays shown.
2. Click a tab in the right column. Nothing changes: the left column keeps the project selected and the right column still shows the project.
3. In the right column's header, beside the project's name, find its actions: **Unload Project**, **Kill All Below** and **Activate**. Each has a hover title.
4. Switch throng to a different project, then click **Activate** on the first project in the monitor. throng switches to that project; the monitor stays open and above throng's window.
5. Select a terminal panel in another tab and click **Activate**. That panel's tab is shown and the panel has focus, and the monitor stays above. Select a process inside a terminal and click **Activate**: it goes to that terminal's panel.
6. Move a tab into a sub-workspace and **Activate** one of its panels from the monitor. The sub-workspace window comes forward with the panel focused.
7. Right-click a project, tab, panel or process row on the left. Its menu has **Activate** too.

### Negative cases
- UI, Daemon and Helpers rows offer no Activate, in the header or their menu.
- A tab of a project that is not active, which no window holds, shows Activate disabled with its reason on hover.
- Nothing in the right column drills further or selects anything.

## MT-13: The monitor's layout: full-width header and movable divider

Covers: FR-111, FR-112
Paths: `packages/ui/src/renderer/resources/monitor-body.tsx`, `packages/ui/src/renderer/resources/monitor-app.tsx`, `packages/ui/src/renderer/resources/toolbar.tsx`, `packages/ui/src/renderer/resources/breadcrumb.tsx`, `packages/ui/src/renderer/theme.css`, `packages/ui/src/main/resource-monitor-window.ts`

### Steps
1. Open the monitor. The filter, the toolbar (Order by, Hide idle, Hide ended processes, Capture every, the Updated line, ?) and the breadcrumb with Back run across the full width of the window, above both columns, with a rule beneath them.
2. Drill into a project with many processes and scroll the left list down. The header stays put at the top.
3. Drag the divider between the columns left and right. Both columns resize, each stopping at a minimum width.
4. Tab to the divider and use the arrow keys. It moves.
5. Close the monitor and reopen it. The divider is where you left it.
6. Tab through the window from the filter. Focus goes filter → toolbar controls → breadcrumb → left list → divider → right column.

### Negative cases
- The breadcrumb and toolbar never scroll out of view with the list.
- Dragging the divider never produces a horizontal scrollbar in either column.

## MT-14: Network figures

Covers: FR-113, SC-011
Paths: `packages/platform-windows/src/**`, `packages/ui/src/collector/**`, `packages/core/src/resources/**`, `packages/ipc-contract/src/resources.ts`, `packages/ui/src/renderer/resources/breakdown.tsx`, `packages/ui/src/renderer/resources/detail-pane.tsx`, `packages/ui/src/renderer/resources/line-graph.tsx`, `packages/ui/src/renderer/resources/format.ts`

### Steps
1. Run throng normally (not as administrator) and open the monitor. Every row has a **Network** column reading "-", and hovering one says "Elevate to show". Network in Order by is disabled with the same reason.
2. Close throng and run it as administrator. In a terminal, download something large (e.g. `curl -o NUL https://speed.hetzner.de/100MB.bin`).
3. In the monitor, find that terminal's `curl`. Its Network figure shows the transfer rate, and the figure rolls up to its panel, tab, project and Projects.
4. Open Windows Resource Monitor's Network tab beside it. throng's figure for `curl` is within about 10% of Resource Monitor's.
5. Order by Network. The list re-orders with `curl` at the top, and its row's Network line graph on the right shows the transfer.

### Negative cases
- The status bar shows no network figure.
- Unelevated, no Network figure shows a number, not even 0.
