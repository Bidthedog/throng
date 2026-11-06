# Implementation Plan: Every failure leaves a trace in the diagnostic log

**Branch**: `feature/S066-I543-failure-logging` | **Date**: 2026-11-06 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/066-failure-logging/spec.md`

## Summary

Add the logging principle to the constitution and bring every process, child start and caught error into
line with it. `console` becomes the logging seam in every process (the agent, the collector and the
renderer join UI main and the daemon in capturing it), two helpers make a caught error's intent explicit,
`watchChild` records every child's failure, the renderer reports its own crashes with a per-panel boundary,
and logs gain a fatal level, repeat collapsing and retention by active day under a total cap. Unit-layer
guards keep it that way. Decisions in [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript 7, Node 24, Electron 44, React 19

**Primary Dependencies**: existing only — the TypeScript compiler API (already a dev dependency) for the guard

**Storage**: log files in the per-user logs folder; settings in `settings.json`

**Testing**: Vitest unit / component / integration; no new E2E (every outcome is observable lower)

**Target Platform**: Windows and Linux, together (Principle II)

**Project Type**: desktop app (Electron main, renderer, detached daemon, PTY agent, collector)

**Performance Goals**: logging stays synchronous-append and never blocks input; repeat collapsing bounds a
crash loop's write rate

**Constraints**: a logging failure can never crash or stall its process (FR-016); no raw error text in a
rendered notice (029 FR-018) — logs are not notices

**Scale/Scope**: ~365 swallowed-error sites and 21 child starts across seven packages (research baseline)

## Constitution Check

| Principle | How this holds |
|---|---|
| II Platform abstraction | helpers live in `core` and use `console` only; `watchChild` in `platform-node`; both OS halves change together |
| III Terminals | the agent host's failures are logged as well as shown; no process lifecycle changes |
| V Testing | each requirement proven at the lowest layer that shows it; guards in the unit layer; repros first for #542's shape (a child dying while loading) |
| VI UX / failure presentation | a panel crash still renders the shared failure banner; logs never replace a notice |
| IX DI | the agent host takes an injected `log`; the console seam needs no new container wiring |
| X Configuration | retention and cap are settings with descriptors, bounds and docs; `keepFiles` removed in the same change (FR-020) |
| XII Responsive UI | the panel boundary adds no render work on the input path |
| XIII (new) Every failure leaves a trace | this feature introduces it and meets it; the guard enforces it |

No violation needs justifying.

## Delivery order

1. **Core**: fatal level, helpers, retention plan, session file names, repeat collapse — pure, unit-tested.
2. **Logger**: `createFileLog` retention, total cap, trim record, repeat collapse, `[FATAL]` mapping.
3. **Processes**: `watchChild`; daemon spawn, collector fork, agent spawn and de-elevated launch watched;
   agent and collector adopt `createFileLog`; agent gets `logDir` as an argument; `PtyAgentHost` logs.
4. **Renderer**: root error callbacks, window listeners, `PanelErrorBoundary`, preload `diagnostics.log`,
   `console-message` backstop; Electron `unresponsive` / `preload-error` hooks in main.
5. **Settings and docs**: `keepDays`, `maxTotalMb` descriptors; `keepFiles` and `THRONG_LOG_KEEP` removed;
   `docs/preferences.md`, `docs/environment.md`, `docs/architecture.md` current.
6. **Audit**: every baseline site classified and fixed, recorded in `audit.md`, package by package.
7. **Guard**: `failure-logging-guard.test.ts` green on the audited tree, registered in `guards-are-live`.
8. **Constitution**: Principle XIII, version 6.3.0, plan template row, sync-impact report. It may land at
   any point after step 1 (tasks.md US3); it ships in the same PR as the rest, which is why the Constitution
   Check above already cites XIII.

## Project Structure

### Documentation (this feature)

```text
specs/066-failure-logging/
├── spec.md  plan.md  research.md  data-model.md  quickstart.md
├── contracts/diagnostics.md
├── audit.md          # written during implementation (SC-004)
└── tasks.md
```

### Source Code

```text
packages/core/src/diagnostics/        log-level.ts (fatal), rotation.ts (retention), caught.ts (new), log-format.ts
packages/core/src/config/             settings-metadata.ts (keepDays, maxTotalMb; keepFiles removed)
packages/platform-node/src/           node-file-log.ts (retention, repeats, fatal), watch-child.ts (new)
packages/daemon/src/                  main.ts, pty-agent-entry.ts, pty-agent-log.ts, pty-agent-host.ts, composition-root.ts
packages/platform-windows/src/        windows-de-elevated-launcher.ts (logDir arg) + audited sites
packages/platform-linux/src/          audited sites
packages/persistence/src/             audited sites
packages/ui/src/main/                 diagnostics.ts, main.ts, daemon-lifecycle.ts, resource-monitor-host.ts, diagnostics IPC
packages/ui/src/collector/            resource-collector-entry.ts (log + hooks)
packages/ui/src/preload/preload.cts   diagnostics.log
packages/ui/src/renderer/             main.tsx (root callbacks), workspace/panel-error-boundary.tsx (new) + audited sites
packages/ui/tests/unit/               failure-logging-guard.test.ts (new), guards-are-live.test.ts
.specify/memory/constitution.md       Principle XIII
.specify/templates/plan-template.md   Constitution Check row
```

**Structure Decision**: no new package; each change sits in the package that owns the behaviour.

## Complexity Tracking

None.
