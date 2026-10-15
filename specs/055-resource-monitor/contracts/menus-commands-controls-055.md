# Contract: commands, menus, controls, settings and tokens (055)

## Command

| Id | Scope | Default chord | Label | Where |
|---|---|---|---|---|
| `view.resourceMonitor` | `EVERYWHERE` | `Ctrl+Shift+Alt+R` (Tier 1, physical key) | Resource Monitor | Key Bindings editor; cog menu; `WINDOW_HANDLED_ACTIONS` |

From a sub-workspace window it sends `throng:resources:open`; the main window opens the modal and is
focused.

## Cog menu (main window)

`application` section, after Open Logs Folder and before About: **Resource Monitor**, icon
`resourceMonitor`, testId `cog-resource-monitor`.

## Status-bar item

`StatusBar` right side, before `<DaemonIndicator/>`: one button, testId `status-resources`, holding up
to four figures in the order CPU, memory, GPU, I/O, each `icon + value`. Overflow drops GPU, then I/O,
then memory, then CPU (FR-045); with none left, the `resourceMonitor` icon alone. Hover: per-component
breakdown of all four. Click: open the modal.

## Modal controls (all themeable icon controls with hover titles — FR-055)

| Control | Icon token | Title |
|---|---|---|
| Close (top right) | `dismiss` (existing) | Close |
| Maximise / Restore | `panelMaximise` / `panelRestore` (existing) | Maximise / Restore |
| Minimise | `windowMinimise` (existing) | Minimise to the status bar |
| Capture interval | — (select) | Capture every … seconds |
| Metric choice | `resourceCpu` / `resourceMemory` / `resourceGpu` / `resourceIo` | Show by … |
| Hide idle | `resourceHideIdle` (new) | Hide idle processes |
| Filter clear | `dismiss` (existing) | Clear filter |

## Node actions (context menu on a node, and the detail pane's action row)

Menu rows use the shared section vocabulary: standard actions first, then a divider, then the kill rows.

| Row | Icon token | Confirmation |
|---|---|---|
| Unload Project / Unload Project (other terminal action) | `unload` (existing) | as 046 (`projects.unloadTerminalAction`) |
| Destroy Tab | `destroy` (existing) | `confirmations.destroyTab` |
| Destroy Panel | `destroy` (existing) | `confirmations.destroyPanel` |
| Kill Process | `resourceKill` (new) | `confirmations.killProcesses` |
| Kill All Below | `resourceKillBelow` (new) | `confirmations.killProcesses`, dialog lists the processes (FR-063b) |

## New icon tokens

`resourceMonitor`, `resourceCpu`, `resourceMemory`, `resourceGpu`, `resourceIo`, `resourceHideIdle`,
`resourceKill`, `resourceKillBelow` — eight, each with `theme-copy.ts` copy.
`EXPECTED_ICON_TOKEN_COUNT` 81 → 89; `SHIPPED_DEFAULTS_VERSION` 22 → 23 (additive). No new colour tokens:
bands use `warning` and `danger`.

## Settings

See research R11 for the table. Placement: a new **Resource Monitor** group in Preferences (capture
interval, history, the four thresholds); `confirmations.killProcesses` in the existing Confirmations group
as "Kill processes". The interval field shows a note when it was raised to the window's minimum (R11).
