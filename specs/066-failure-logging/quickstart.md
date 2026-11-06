# Quickstart: validating 066

Run from the worktree. Layers per `docs/testing.md`.

| Proves | Command | Expect |
|---|---|---|
| Levels, retention, repeat collapse, helpers (FR-009–009a, 015, 018–020) | `npx vitest run --project unit packages/core/tests/unit/diagnostics` | green |
| File logger against a real folder: roll-over, active-day pruning, total cap, trim record (SC-007, SC-008) | `npx vitest run --project integration packages/platform-node/tests/integration/node-file-log*` | green |
| A child that dies while loading, exits unasked, errors on spawn (SC-001) | `npx vitest run --project integration packages/platform-node/tests/integration/watch-child*` | each leaves its record |
| Agent host logs lapse, crash, error event (FR-005, FR-007) | `npx vitest run --project integration packages/daemon/tests/integration/pty-agent-launch-timeout.integration.test.ts` | green |
| Panel crash is fatal and reaches main (SC-006) | `npx vitest run --project component packages/ui/tests/component/panel-error-boundary*` | green |
| No silent catch, no unwatched child (SC-002, SC-003) | `npx vitest run --project unit packages/ui/tests/unit/failure-logging-guard.test.ts` | green; adding `try { x() } catch {}` to any src file makes it red naming the line |
| Docs and settings in step | `npx vitest run --project unit packages/ui/tests/unit/docs-currency.test.ts` | green |

By hand (installed or dev build): set a panel to throw (dev seam `THRONG_TEST_PANEL_THROW=1`), open the logs
folder from the cog menu, and find one `FATAL` line naming the panel.
