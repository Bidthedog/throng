# Implementation Plan: Application Bootstrap & Landing Page

**Branch**: `001-app-bootstrap` | **Date**: 2026-06-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-app-bootstrap/spec.md`

## Summary

Stand up the full throng skeleton as runnable, tested components — an Electron + TypeScript
desktop UI opening to a throwaway "Hello World" landing page, a separate headless Node daemon
process, a shared platform-agnostic core, an embedded SQLite persistence store with a
startup migration runner, and a local IPC channel between UI and daemon — with documented
npm scripts and all three test layers (unit, integration, E2E) green. No product features are
implemented.

Technical approach: an **npm-workspaces monorepo** of small packages that encode the
constitution's boundaries directly — `core` holds platform-agnostic logic plus the OS and
settings **abstractions**; `platform-windows` holds the only OS-specific implementations and
is verified by **contract tests**; `persistence` wraps better-sqlite3 with a `user_version`
migration runner; `daemon` and `ui` are the two runnable processes, each with **its own single
InversifyJS composition root**. The UI↔daemon channel is newline-delimited JSON-RPC 2.0 over a
Windows named pipe, exercised by a `health.ping` round-trip.

This plan resolves the four gaps raised by the spec-vs-constitution validation:

- **[Gap A]** OS-abstraction **contract tests** (Principles II + V) — a contract-test suite that
  every OS implementation must pass, present from bootstrap even though the only abstraction
  exercised now is a trivial platform/path probe.
- **[Gap B]** Composition-root scope (Principle IX) — constitution **v1.5.1** states the rule
  directly: **one composition root per application boundary** (per runnable process). Bootstrap has
  exactly two processes (daemon, Electron main) → two composition-root files, each owning one
  container. This is now satisfied verbatim, not reinterpreted.
- **[Gap C]** **Typed settings abstractions** (Principle X) — configuration is exposed only through
  injected, typed settings interfaces; no ad-hoc `process.env` reads inside components.
- **[Gap D]** **Red-Green-Refactor ordering** (Principle V) — every task is authored test-first;
  `/speckit-tasks` will emit a failing test before its implementation task.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20 LTS (ESM)

**Primary Dependencies**: Electron (latest stable) for the UI; InversifyJS + reflect-metadata for
dependency injection; better-sqlite3 for the embedded store; Vitest for unit/integration tests;
Playwright (`@playwright/test`, Electron driver) for E2E. xterm.js and node-pty are pinned by the
constitution for terminals but are **out of scope here** (no terminals) and are not added yet (YAGNI).

**Storage**: Embedded SQLite (better-sqlite3), single local file under the per-user data directory;
startup migration runner keyed on the `user_version` PRAGMA. No domain tables in this iteration.

**Testing**: Vitest (unit + integration), Playwright-Electron (E2E), plus a Vitest **contract-test**
suite for OS abstractions. Red-Green-Refactor is mandatory (Principle V).

**Target Platform**: Windows 11 desktop (first supported target). macOS/Linux out of scope but the
abstraction boundary must not foreclose them.

**Project Type**: Desktop application (multi-process: Electron UI client + headless daemon),
delivered as an npm-workspaces monorepo.

**Performance Goals**: Landing page visible within 5 s of launch on a typical modern Windows machine
(NFR-001 / SC-001); UI↔daemon `health.ping` round-trip completes promptly (well under 1 s locally).

**Constraints**: No Docker; everything runs via documented npm scripts. Shared core contains zero
OS-specific or process-specific calls. Configuration is injected, never hardcoded. Single IoC
container per process composition root.

**Scale/Scope**: Single user, single machine, local-only. Bootstrap scope only: ~6 small packages,
one window, one IPC method, one baseline migration, one smoke test per component.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against all eleven principles of constitution **v1.5.1**.

| # | Principle | Verdict | How this plan satisfies it |
|---|-----------|---------|----------------------------|
| I | Project-First Context Isolation | ✅ PASS (deferred) | No terminals exist, so none exist outside a project. Project entity not built; deferred behind clearly-marked extension points (FR-007). |
| II | Platform-Abstracted Core | ✅ PASS | `core/abstractions` defines OS contracts as interfaces; `platform-windows` holds the only concrete OS calls; `core` has zero OS calls. Verified by **[Gap A]** contract tests. |
| III | Detached/Persistent Terminals | ✅ PASS (backbone) | Daemon runs as its own detached process with its own composition root; UI is a client over IPC. Terminal lifecycle behaviour deferred. |
| IV | Native Terminal Support | ✅ PASS (deferred) | No terminals/shell detection in bootstrap. |
| V | Test-First Quality Discipline | ✅ PASS | Unit (Vitest), integration (Vitest), E2E (Playwright-Electron), plus OS contract tests. Every component has ≥1 test. **[Gap D]** RGR enforced per task. |
| VI | Simple, Modern UX | ✅ PASS (deferred) | Single modern window + default theme (FR-004). Panel/Pane layout deferred to Principle XI features. |
| VII | Change Review & Approval | ✅ PASS (deferred) | Explicitly out of scope; not implemented. |
| VIII | SOLID/DRY/YAGNI | ✅ PASS | Package boundaries enforce SRP/DIP; no speculative generality (terminals, layouts, watchers all omitted). |
| IX | DI & Composition Root | ✅ PASS | InversifyJS; **[Gap B]** exactly one composition root per application boundary (v1.5.1) — `daemon/src/composition-root.ts` and `ui/src/main/composition-root.ts`, one container each. No service locator, no static singletons, constructor injection only. |
| X | Externalised Configuration | ✅ PASS | **[Gap C]** typed `Settings` interfaces in `core/config`, injected via constructor; defaults documented; overridable without code changes. |
| XI | Dockable Panel/Pane Workspace | ✅ PASS (deferred) | Single window now; docking/tear-off deferred behind extension points. |

**Technology & Architecture constraints**: daemon owns the future terminal layer (UI is an IPC
client) ✅; durable state lives outside host-process memory (SQLite file) ✅; Electron + TypeScript
baseline ✅; reuse-not-fork posture preserved ✅.

**Gate result: PASS — no violations.** Complexity Tracking is therefore empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-app-bootstrap/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── ipc-health-ping.md        # UI↔daemon JSON-RPC ping contract
│   └── os-platform-probe.md      # OS abstraction contract (drives [Gap A] tests)
├── checklists/
│   └── requirements.md  # Created by /speckit-specify
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

An npm-workspaces monorepo. Each package maps to a constitutional boundary; the two runnable
processes (`daemon`, `ui`) are the only DI composition roots.

```text
package.json                       # npm workspaces root + run/build/test scripts
tsconfig.base.json                 # shared compiler options (decorators, ESM, strict)
vitest.config.ts                   # unit + integration + contract projects
playwright.config.ts               # Electron E2E driver

packages/
├── core/                          # Principle II/VIII/X — platform- & process-agnostic
│   ├── src/
│   │   ├── abstractions/          #   OS contracts as interfaces (Principle II)
│   │   │   └── platform-info.ts   #     IPlatformInfo (probe: os name, path separator)
│   │   ├── config/                #   typed settings abstractions (Principle X, [Gap C])
│   │   │   └── settings.ts        #     IDaemonSettings, IUiSettings, IPersistenceSettings
│   │   └── index.ts
│   └── tests/unit/                #   core smoke test (Principle V)
│
├── platform-windows/              # Principle II — the only OS-specific implementations
│   ├── src/windows-platform-info.ts
│   └── tests/contract/            #   [Gap A] runs the shared OS contract suite vs Windows impl
│
├── persistence/                   # embedded store + migration runner (durable state)
│   ├── src/
│   │   ├── database.ts            #   better-sqlite3 open/connect
│   │   └── migration-runner.ts    #   user_version-based baseline runner (no domain tables)
│   └── tests/integration/         #   create→baseline→idempotent re-run→read/write smoke
│
├── ipc-contract/                  # shared JSON-RPC message/types for health.ping
│   └── src/health-ping.ts
│
├── daemon/                        # COMPOSITION ROOT #1 (Principle IX, [Gap B])
│   ├── src/
│   │   ├── composition-root.ts    #   the daemon's single InversifyJS container
│   │   ├── ipc-server.ts          #   named-pipe JSON-RPC server, health.ping handler
│   │   └── main.ts                #   entrypoint: bind settings, open store, listen
│   ├── tests/unit/
│   └── tests/integration/         #   ping round-trip + store init against real impls
│
└── ui/                            # COMPOSITION ROOT #2 (Principle IX, [Gap B])
    ├── src/
    │   ├── main/
    │   │   ├── composition-root.ts#   the UI main process's single InversifyJS container
    │   │   ├── daemon-client.ts   #   named-pipe JSON-RPC client (health.ping)
    │   │   └── main.ts            #   Electron main: create window, wire IPC bridge
    │   ├── preload/preload.ts     #   contextBridge: expose ping result to renderer
    │   └── renderer/              #   "Hello World" landing page (single default theme)
    │       ├── index.html
    │       └── landing.ts
    ├── tests/unit/
    └── tests/e2e/                 #   Playwright-Electron: window opens to landing page
```

**Structure Decision**: npm-workspaces monorepo (no Docker; all components run via npm scripts per
the spec's assumptions). The package split is the physical embodiment of Principles II, VIII, IX,
and X: `core` cannot import OS or process APIs; `platform-windows` is the single OS seam guarded by
contract tests **[Gap A]**; `daemon` and `ui` are the only two DI composition roots — one per
application boundary per Principle IX (v1.5.1) **[Gap B]**; all
configuration flows through `core/config` typed settings **[Gap C]**. The renderer is deliberately
thin (no DI container) — it receives the ping result through the preload `contextBridge`, keeping
Electron's sandbox boundary clean.

## Complexity Tracking

> No Constitution Check violations. No entries required.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(none)_  | —          | —                                   |
