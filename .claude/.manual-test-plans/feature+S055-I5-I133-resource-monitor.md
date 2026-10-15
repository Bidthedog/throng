# Manual test plan: Resource Monitor (055)

Spec: `specs/055-resource-monitor/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Status bar usage figures | untested | | | |
| MT-02 | Opening, closing and resizing the monitor | retired → MT-08 | | | |
| MT-03 | Drilling into the breakdown | untested | | | |
| MT-04 | Charts, filter and idle hiding | untested | | | |
| MT-05 | Unload, destroy and kill from the monitor | untested | | | |
| MT-06 | Held folders | untested | | | |
| MT-07 | Resource Monitor preferences | untested | | | |
| MT-08 | The monitor window | untested | | | |

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
Paths: `packages/ui/src/renderer/resources/breakdown.tsx`, `packages/ui/src/renderer/resources/treemap.tsx`, `packages/ui/src/renderer/resources/breadcrumb.tsx`, `packages/ui/src/renderer/resources/detail-pane.tsx`, `packages/ui/src/renderer/resources/use-breakdown-keys.ts`, `packages/core/src/resources/**`

### Steps
1. With two projects loaded and one unloaded, open the monitor. The top level shows UI, Daemon, Helpers and Projects, each with its rolled-up figure.
2. Open Projects. Every project is listed, active and loaded first; the unloaded one is grey and italic.
3. Click into a project, a tab, then a terminal panel. Its shell appears with a friendly name (PowerShell, Git Bash…), and anything running in it — e.g. `node`, `git`, `claude` — beneath it. The breadcrumb names each level.
4. Each level's figure equals the sum of its children plus its own (check one level by eye).
5. Open an editor panel with a large file. It shows memory marked as estimated; CPU reads "not measured".
6. With focus in the breakdown, Up/Down move the selection; Right or Enter drills in; Left or Backspace goes back up.
7. Open Helpers. Console hosts, folder locks and the resource collector are listed by name.

### Negative cases
- Nothing outside throng (your browser, Explorer) appears anywhere in the hierarchy.
- Numbers are digit-grouped with readable units (KB, MB, GB).

## MT-04: Charts, filter and idle hiding

Covers: FR-031, FR-033, FR-061, FR-065
Paths: `packages/ui/src/renderer/resources/charts/**`, `packages/ui/src/renderer/resources/sparkline.tsx`, `packages/ui/src/renderer/resources/toolbar.tsx`, `packages/ui/src/renderer/resources/monitor-model.ts`, `packages/core/src/resources/**`

### Steps
1. Open the monitor and wait a minute. Each node's chart fills in from empty; the time series grows over the history window.
2. Switch the metric between CPU, memory, GPU and I/O. The treemap and charts redraw for that metric.
3. Type a process name into the filter. Only matching nodes and their parents remain; clearing the filter restores everything. Filter by a pid and by part of a command line — both match.
4. Toggle **Hide idle**. Processes using under 0.1% CPU with no I/O disappear.
5. Change the capture interval in the toolbar. The charts update at the new rate.
6. Start `node -e "setTimeout(()=>{},20000)"` in a terminal, find it in the monitor, and wait for it to exit. It stays in place, greyed and struck through, with its history. Close and reopen the monitor: it is gone, and the charts start empty.

### Negative cases
- A process at or above the memory warning level is never hidden by **Hide idle**.

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
