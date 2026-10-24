# Quickstart: validating the resource monitor (055)

Prerequisites: Windows 11, the worktree prepared (`npm install`), `npm run build`.

## Automated

```bash
npx vitest run --project unit packages/core/tests/unit/resources          # hierarchy, roll-up, lineage, idle, bands, settings
npx vitest run --project integration packages/platform-windows/tests/integration/process-metrics   # native readings vs independent reads (FR-012)
npx vitest run --project integration packages/daemon/tests/integration/resource-roster            # roster plumbing, no OS query
npx vitest run --project integration packages/ui/tests/integration/resource-collector             # tick, kill guard, self-exit, SC-004 benchmark
npx vitest run --project contract  -t resources                                                   # roster, collector protocol, IPC
npx vitest run --project component packages/ui/tests/component/resources                          # status bar, modal, keyboard, actions
```

E2E specs (`@extended` unless noted) run on CI through the gate: `resource-monitor.e2e.ts` (`@core`),
`resource-monitor-kill.e2e.ts`, `resource-estimates-calibration.e2e.ts`, and the collector case in
`terminal-no-orphans.e2e.ts`.

## By hand

1. Launch throng with two projects, each with a terminal. The status bar's right side shows CPU, memory,
   GPU and I/O figures, refreshing every 2 s; hovering splits them into UI, Daemon, Helpers and Projects.
2. In one terminal run a CPU-heavy command (`node -e "for(;;){}"`): within two refreshes the CPU figure
   rises and turns amber or red past the thresholds.
3. Click the figures. The modal opens at once and fills in; drill Projects → the project → its tab → the
   panel → `node.exe`. Every level's figure equals its children plus its own.
4. Right-click `node.exe` → Kill Process → confirm twice. It turns grey and struck through, its usage
   leaves the totals, and the shell above it keeps running.
5. Open a 20 MB file in an editor. Its panel shows a memory figure marked estimated, and CPU "not
   measured".
6. Press Minimise: the modal shrinks into the status-bar item. Reopen with `Ctrl+Shift+Alt+R`: it returns
   at the same place, with the same metric and filter.
7. Narrow the window: GPU drops first, then I/O, then memory, then CPU, leaving the icon.
