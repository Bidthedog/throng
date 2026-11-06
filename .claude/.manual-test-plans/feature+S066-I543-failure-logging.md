# Manual test plan: 066 — every failure leaves a trace in the diagnostic log

Spec: `specs/066-failure-logging/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | A crashed panel shows its banner and leaves a fatal record | signed off | 7f6c6f0097cc | 2026-11-06 | |
| MT-02 | Logging preferences | signed off | 7f6c6f0097cc | 2026-11-06 | |
| MT-03 | Every part of throng writes into the one logs folder | signed off | 7f6c6f0097cc | 2026-11-06 | |
| MT-04 | A de-elevated terminal's agent logs beside the app (Windows, elevated) | signed off | 7f6c6f0097cc | 2026-11-06 | |

## MT-01: A crashed panel shows its banner and leaves a fatal record

Covers: FR-009a, SC-006, US1
Paths: `packages/ui/src/renderer/workspace/panel-error-boundary.tsx`, `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, `packages/ui/src/renderer/workspace/test-panel-throw.tsx`, `packages/ui/src/renderer/error-hooks.ts`, `packages/ui/src/renderer/diagnostics-log.ts`, `packages/ui/src/main/diagnostics-ipc.ts`, `packages/ui/src/main/test-panel-throw-seam.ts`, `packages/ui/src/preload/preload.cts`

### Steps
1. In the worktree, start throng with `THRONG_TEST_PANEL_THROW=1 npm start`. Open a project with at least one panel that has a type (an editor or a terminal).
2. Every typed panel shows the red failure banner with a headline saying the panel failed; the title bar, the tabs and the other panes still work.
3. Cog menu → **Open Logs Folder**. Open `main.log`. Near the end there is one `FATAL [panel]` line per crashed panel, naming the project, tab and panel, with a stack.
4. On one crashed panel, click **Clear panel type**. The banner goes and the panel-type picker appears in its place.
5. Quit, start throng again with plain `npm start`, and open the same project. Every panel renders normally.

### Negative cases
- The banner never shows the raw error text of the crash (it is in the log only).
- Without `THRONG_TEST_PANEL_THROW`, no panel shows the banner and `main.log` gains no `FATAL [panel]` line.

## MT-02: Logging preferences

Covers: FR-019, FR-019a, FR-020
Paths: `packages/core/src/config/settings-metadata.ts`, `packages/core/src/config/app-settings.ts`, `packages/core/src/diagnostics/log-level.ts`, `docs/preferences.md`

### Steps
1. Open Preferences → Settings → **Logging**.
2. **Log detail** offers `fatal`, `error`, `warn`, `info`, `debug`.
3. **Days of logs kept** is a slider from 1 to 30, at 3.
4. **Log folder limit (MB)** is a slider from 50 to 2,000 in steps of 50, at 100.
5. Move each slider and close Preferences; reopen it — the values held.

### Negative cases
- There is no **Log files kept** setting.

## MT-03: Every part of throng writes into the one logs folder

Covers: FR-017, FR-018, FR-019, SC-001, US1
Paths: `packages/platform-node/src/node-file-log.ts`, `packages/platform-node/src/watch-child.ts`, `packages/daemon/src/pty-agent-log.ts`, `packages/daemon/src/pty-agent-entry.ts`, `packages/daemon/src/main.ts`, `packages/ui/src/collector/**`, `packages/ui/src/main/main.ts`, `packages/ui/src/main/daemon-lifecycle.ts`, `packages/core/src/diagnostics/rotation.ts`

### Steps
1. Start throng (`npm start`), open a terminal panel, and open the Resource Monitor.
2. Cog menu → **Open Logs Folder**. The folder holds `main.log`, `daemon.log`, `daemon-startup.log`, a `pty-agent-<date>-<time>-<pid>.log` and a `collector-<date>-<time>-<pid>.log`.
3. Open the `pty-agent-…` file: its lines carry a time, a level and `[pty-agent]`, like `main.log`'s.

### Negative cases
- No new `throng-agent-<pid>.log` appears in the temp folder (`/tmp` on Linux, `%TEMP%` on Windows) while throng runs.

## MT-04: A de-elevated terminal's agent logs beside the app (Windows, elevated)

Covers: FR-017
Paths: `packages/platform-windows/src/windows-de-elevated-launcher.ts`, `packages/daemon/src/pty-agent-log.ts`, `packages/daemon/src/composition-root.ts`

### Steps
1. On Windows, start throng elevated (`npm run start:admin`).
2. Open a terminal panel with **Run as administrator** unchecked. It reaches a prompt.
3. Cog menu → **Open Logs Folder**. A new `pty-agent-<date>-<time>-<pid>.log` is there, written by that terminal's agent.

### Negative cases
- No new `throng-agent-<pid>.log` appears in `%TEMP%` for that launch.
