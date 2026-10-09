# Implementation Plan: Terminal panel titles from a template

**Branch**: `feature/S051-S052-I468-I190-I193-I397-I111-nonblocking-calls-follow-moves` | **Date**: 2026-10-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/053-terminal-title-template/spec.md` (3 user stories, FR-001 – FR-016,
SC-001 – SC-004, one clarification session). Refs #476. Shares a branch and PR (#475) with specs 051 and 052.

## Summary

A terminal panel's name is rendered from a template the user can edit, in every place the panel is named.

- **A pure template language in core** (R1): scanner, parser and evaluator for placeholders, groups, `??` and
  doubled-bracket literals, with errors carrying an offset.
- **Values from what throng already observes** (R2): the command-memory observation gives `{command}` and `{app}`
  in every shell; the cwd and title stores, the flavour, the project and elevation give the rest. Only `{arch}` is
  new data, read by the daemon from the running program's executable.
- **One title rule** (R2): `panelDisplayTitle` renders the template for terminal panels, so the header, tab strip,
  menus and notices all agree (048 FR-032). The separate cwd field in the header goes (FR-010).
- **Three settings** (R4) with a generic `validate` hook shared by the settings check and the text control.

## Technical Context

**Language/Version**: TypeScript (repo toolchain), Node 24, Electron 44

**Primary Dependencies**: React 19 renderer, xterm.js 6, Vitest. **No new dependency.**

**Storage**: settings JSON (`terminals.*`), no schema version bump: new leaves default when absent.

**Testing**:
- unit: the template language (its whole truth table lives here), `commandDisplay`, path shortening, the settings
  descriptors and validator, `panelDisplayTitle` for terminals;
- unit (platform-windows): the PE machine-field reader against fixture bytes;
- unit (daemon): `terminal.command` carries `arch` for the chosen process;
- component: the header name for a terminal across its sources, the text control refusing an invalid template;
- E2E: none new; five existing specs re-pointed from the removed cwd span to the title (R5).

**Target Platform**: Windows 11.

**Project Type**: desktop application, npm-workspaces monorepo.

**Performance Goals**: rendering a template is a pure string walk over a tree compiled once per setting change;
the only new I/O is one cached header read per distinct executable a terminal runs (R2).

**Constraints**:
- 048 FR-032 (one title everywhere) and 031 FR-037 (`tabs.maxNameLength`) stand.
- 023 FR-033 and 012's cwd-beside-title are superseded for terminals (spec, *Supersession*).
- 025 FR-019 / 051 FR-040: the observation is reused, not re-implemented; FR-019f's retained value is not shown
  for a new terminal (FR-016).
- One condition, one notice: an invalid template is one message, at the control.

**Scale/Scope**:
- `packages/core`: `terminal/title-template.ts` (new), `terminal/command-capture.ts` (`commandDisplay`),
  `text/path-shorten.ts` (new), `workspace/panel-title.ts`, `config/metadata.ts` (`validate`),
  `config/settings-metadata.ts`, `config/app-settings.ts`, `config/settings-validity.ts`,
  `abstractions/pty-host.ts`.
- `packages/platform-windows`: `node-pty-host.ts` (`ExecutablePath`, `executableArch`), `executable-arch.ts` (new).
- `packages/ipc-contract`: `terminal.ts` (`arch` on the command notification).
- `packages/daemon`: `terminal-service.ts`, `terminal-events.ts`.
- `packages/ui` renderer: `terminal/command-store.ts`, `terminal/cwd-store.ts`, `terminal/title-context.ts` (new),
  `workspace/use-panel-display-names.ts`, `workspace/panel-placeholder.tsx`, `preferences/form-controls.tsx`,
  `global.d.ts`, `preload.cts`.
- `docs/preferences.md`.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1.*

| Principle | Assessment |
|---|---|
| **I. Project-First Context Isolation** | **Engaged, satisfied.** `{project}` names the panel's own project; no cross-project read. |
| **II. Platform-Abstracted Core** | **Engaged, satisfied.** The language, `commandDisplay` and path shortening are pure core; the PE read is platform-windows behind an optional `IPtyHost` method. |
| **III. Detached, Tagged & Persistent Terminals** | **Not engaged.** Naming only. |
| **IV. Native Terminal Support** | **Engaged, satisfied.** Every flavour, user-defined included, names its command from the same observation; no binding added. |
| **V. Test-First (NON-NEGOTIABLE)** | **Engaged.** Each task starts with a failing test at the lowest layer: the language's truth table at unit, the header at component. |
| **VI. Simple, Modern, Discoverable UX** | **Engaged, satisfied.** The default needs no configuration; the template is documented beside its setting (FR-015). |
| **VII. Change Review & Approval** | **Not engaged.** |
| **VIII. SOLID, DRY & YAGNI** | **Engaged.** One title rule for every surface; one `validate` hook for control and settings check. |
| **IX. DI & Composition Root** | **Engaged, satisfied.** `executableArch` is an optional host method, injected like the rest of `IPtyHost`. |
| **X. Externalised Configuration** | **Engaged, satisfied.** Template and both limits are settings with documented defaults. |
| **XI. Dockable Workspace** | **Engaged, satisfied.** A sub-workspace window renders the same name from the same stores. |
| **XII. Responsive UI (NON-NEGOTIABLE)** | **Engaged, satisfied.** The template is compiled once per settings change; the arch read is async and cached. |

*Post-design re-check (after Phase 1)*: unchanged.

### Development Workflow & Quality Gates

- Test-first per task. `npm run gate` on CI is the done-ness check, after manual sign-off.
- `docs/preferences.md` gains the three settings and the template's syntax (throng-docs owns the wording);
  `docs-currency.test.ts` requires the three keys.
- E2E budget unchanged: no new E2E.

## Project Structure

### Documentation (this feature)

```text
specs/053-terminal-title-template/
├── plan.md              # This file
├── research.md          # Phase 0 — R1–R5
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── title-template.md        # the language, its errors, its evaluation
│   └── command-notification.md  # `arch` on terminal.command
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/core/src/terminal/title-template.ts       # parse, evaluate, DEFAULT_TERMINAL_TITLE_TEMPLATE
packages/core/src/terminal/command-capture.ts      # commandDisplay
packages/core/src/text/path-shorten.ts             # shortenPath (root … last folder)
packages/core/src/workspace/panel-title.ts         # terminal branch renders the template
packages/core/src/config/{metadata,settings-metadata,app-settings,settings-validity}.ts
packages/core/src/abstractions/pty-host.ts         # executablePath?, executableArch?
packages/platform-windows/src/executable-arch.ts   # PE machine field → x64 | x86 | arm64
packages/platform-windows/src/node-pty-host.ts     # ExecutablePath in the snapshot; executableArch
packages/ipc-contract/src/terminal.ts              # arch on TerminalCommandNotification
packages/daemon/src/{terminal-service,terminal-events}.ts
packages/ui/src/renderer/terminal/{command-store,cwd-store,title-context}.ts
packages/ui/src/renderer/workspace/{use-panel-display-names.ts,panel-placeholder.tsx}
packages/ui/src/renderer/preferences/form-controls.tsx   # TextControl validate
docs/preferences.md

tests (new or extended):
packages/core/tests/unit/title-template.test.ts
packages/core/tests/unit/command-display.test.ts
packages/core/tests/unit/path-shorten.test.ts
packages/core/tests/unit/panel-display-title.test.ts
packages/core/tests/unit/terminal-title-settings.test.ts
packages/platform-windows/tests/unit/executable-arch.test.ts
packages/daemon/tests/unit/terminal-command-poll.test.ts
packages/ui/tests/component/terminal-panel-title.test.ts
packages/ui/tests/component/preferences-text-validate.test.ts
packages/ui/tests/e2e/{open-in-terminal,terminal-command-memory,terminal-directory-memory,terminal-reload-mode}.e2e.ts
packages/ui/tests/unit/e2e-elevation-guards.test.ts
```

**Structure Decision**: existing packages only; each new module sits beside the code it serves.

## Complexity Tracking

None.
