# Phase 0 Research: Application Bootstrap

All Technical Context unknowns are resolved below. The constitution already pins the high-level
stack (Electron + TypeScript, daemon/client, embedded SQLite); this phase pins the concrete
bootstrap-level choices and records why each was selected over the alternatives.

## D1. Monorepo & build tooling

- **Decision**: npm **workspaces** monorepo; per-package `tsc` builds against a shared
  `tsconfig.base.json`; root npm scripts orchestrate install/build/run/test.
- **Rationale**: The spec mandates "documented npm scripts" and "no Docker". npm workspaces ship
  with Node 20 (no extra tool), give one `npm install` for the whole tree, and let each component
  be built/run individually or together — satisfying FR-014 and FR-016 with zero new infrastructure
  (YAGNI, Principle VIII).
- **Alternatives considered**: pnpm/Yarn (extra toolchain, not justified for a single-user local
  project); Nx/Turborepo (build-graph orchestration is speculative generality at bootstrap scale).

## D2. Dependency-injection container

- **Decision**: **InversifyJS** (+ `reflect-metadata`), with **one `Container` instance per process**,
  each constructed in a single `composition-root.ts` file (**[Gap B]**).
- **Rationale**: Principle IX (constitution v1.5.1) requires *one composition root per application
  boundary* — a single IoC container configured in one file per runnable process — plus constructor
  injection and abstractions over concretions. Inversify makes the container an **explicit object you
  `new` once per process** — unlike a global/ambient registry — which is exactly the "no ambient
  singletons / no service locator" posture. Two runnable processes ⇒ two composition roots, each
  owning one container; the rest of each process's code stays container-unaware.
- **Alternatives considered**: tsyringe (relies on a global ambient `container` singleton — conflicts
  with Principle IX's prohibition on ambient singletons); hand-rolled factory wiring (re-implements
  DI and erodes consistency as the app grows, against DRY).

## D3. UI↔daemon inter-process channel

- **Decision**: A **Windows named pipe** (`\\.\pipe\throng.daemon`) carrying **newline-delimited
  JSON-RPC 2.0**. One method in this iteration: `health.ping` → `health.pong`.
- **Rationale**: The constitution requires the daemon to own future terminals with the UI as a
  client over local IPC ("e.g. a named pipe on Windows"). A named pipe is the constitution's own
  example, needs no port allocation, and is local-only. JSON-RPC 2.0 is a tiny, well-understood
  envelope that already models request/response, errors, and future methods without redesign.
- **Alternatives considered**: TCP loopback socket (needs port management and surfaces a network
  surface area we don't want); Electron `utilityProcess`/`MessagePort` (couples the daemon's
  lifecycle to Electron — violates Principle III's detachment requirement); gRPC (heavyweight codegen,
  YAGNI for one ping).
- **Pipe-name note**: The pipe name is **injected configuration** (Principle X / **[Gap C]**), not a
  literal in business logic. Address-in-use is surfaced explicitly (spec Edge Case).

## D4. Embedded persistence store & migration runner

- **Decision**: **better-sqlite3**; a migration runner keyed on SQLite's **`user_version`** PRAGMA.
  Baseline = `user_version` 0 → 1 with **no domain tables** (only the version bump, optionally a
  `_meta` marker row). Re-running against a store already at the target version is a **no-op**.
- **Rationale**: better-sqlite3 is synchronous, fast, widely used, and ships Windows prebuilds (no
  Docker, simple `npm install`). `user_version` is the lightest correct way to make migrations
  idempotent (FR-012 / SC-005) without inventing a migrations table before any domain data exists
  (YAGNI). The DB path comes from injected `IPersistenceSettings` (**[Gap C]**).
- **Alternatives considered**: a hand-rolled `migrations` table (more machinery than one ping-level
  baseline needs); Knex/Drizzle/Prisma (ORM/query-builder weight unjustified with zero domain tables);
  sql.js / in-memory only (fails the "durable state outside host process" constraint).

## D5. Test stack & the three layers (Principle V)

- **Decision**:
  - **Unit + integration** → **Vitest** (TS-native, fast, ESM-friendly), split into Vitest
    *projects*: `unit`, `integration`, `contract`.
  - **End-to-end** → **Playwright** with its **Electron** driver (`_electron.launch`), asserting the
    window opens to the "Hello World" landing page (US1, SC-002).
  - **OS contract tests (`contract`)** → a **shared contract suite** exported from `core` (or a
    `core` test helper) that takes any `IPlatformInfo` implementation and asserts the contract;
    `platform-windows` runs it against `WindowsPlatformInfo` (**[Gap A]**).
- **Rationale**: One runner (Vitest) for unit/integration/contract keeps tooling DRY; Playwright is
  the mature, well-supported Electron E2E driver and satisfies the constitution's "appropriate
  automated E2E tool, pinned in the plan". The contract suite is what keeps the OS seam honest as
  macOS/Linux implementations are added later (Principle II + V).
- **Red-Green-Refactor (**[Gap D]**)**: every implementation task in `/speckit-tasks` is preceded by a
  test task that must be observed **failing first**; success is never claimed without passing output
  (Principle V is NON-NEGOTIABLE).
- **Alternatives considered**: Jest (slower TS/ESM story than Vitest); Spectron (deprecated for
  Electron E2E); WebdriverIO-Electron (heavier than Playwright for a single smoke journey).

## D6. Electron process & security shape

- **Decision**: Electron **main** process is composition root #2; the **renderer is sandboxed**
  (`contextIsolation: true`, `nodeIntegration: false`) and receives the daemon ping result via a
  **preload `contextBridge`** API. The renderer holds **no DI container** and makes no direct IPC or
  Node calls.
- **Rationale**: Keeps the Electron sandbox boundary clean (modern Electron security default) and
  keeps the renderer a thin view (SRP, Principle VIII). The cross-process DI/wiring lives in main,
  where the daemon client and window lifecycle are owned.
- **Alternatives considered**: `nodeIntegration: true` in the renderer (insecure, and would smear the
  composition root across the sandbox); a third DI container in the renderer (no services to wire —
  YAGNI).

## D7. Configuration source & typed settings (Principle X / [Gap C])

- **Decision**: Typed settings **interfaces** live in `core/config` (`IDaemonSettings`,
  `IUiSettings`, `IPersistenceSettings`). Each process binds a concrete settings object in its
  composition root from documented defaults, overridable via environment without code changes; values
  (pipe name, DB path, window size, startup timeout) are **only** read through these injected
  interfaces — never via ad-hoc `process.env` deep inside components.
- **Rationale**: Directly implements Principle X and closes **[Gap C]**: configuration is separated
  from code, typed, injected (Principle IX), with documented sensible defaults.
- **Alternatives considered**: scattered `process.env` reads (the exact anti-pattern Principle X
  forbids); a config file format/loader (more than bootstrap needs — add when real config arrives).

## Resolved unknowns summary

| Unknown (Technical Context) | Resolution |
|-----------------------------|------------|
| DI container choice | InversifyJS, one container per process (D2) |
| IPC mechanism & protocol | Named pipe + newline-delimited JSON-RPC 2.0 (D3) |
| SQLite library & migration approach | better-sqlite3 + `user_version` baseline runner (D4) |
| E2E tool | Playwright-Electron (D5) |
| OS contract-test approach | Shared `IPlatformInfo` contract suite (D5, [Gap A]) |
| Config mechanism | Injected typed settings in `core/config` (D7, [Gap C]) |

No `NEEDS CLARIFICATION` markers remain.
