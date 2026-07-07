# Feature Specification: Application Bootstrap & Landing Page

**Feature Branch**: `001-app-bootstrap`

**Created**: 2026-06-25

**Status**: Planned (plan + tasks complete)

**Input**: User description: "Create a new 001 spec for bootstrapping this application. No features should be implemented, just the framework and a landing 'hello world' page that we will iterate on." (Extended: bootstrap **all** artifacts — the background daemon service and the persistence store too — each with at least one test and documented run commands.)

## Overview

This feature stands up the full throng skeleton as a set of runnable, tested
components, with a placeholder "Hello World" landing page to iterate on. The
artifacts bootstrapped are:

- the **desktop UI application** (opens to the landing page),
- the **headless background daemon service** (the long-lived process that will
  later own terminals; in this iteration it only proves it runs and is reachable),
- a **shared platform-agnostic core** (domain/orchestration logic, free of OS- and
  process-specific concerns),
- an **embedded persistence store** (a local file database with a startup
  schema-initialisation mechanism), and
- the **inter-process channel** between the UI and the daemon, plus the
  **build / run / test tooling** to operate all of the above.

No product capabilities are implemented. Each component contains only the minimum
needed to prove it exists, builds, runs, communicates with its neighbours, and is
covered by a test. Projects, terminals, shell detection, persistence of real
domain data, layouts, change review, presets, and agent tooling are all out of
scope. The landing page is a throwaway placeholder that later specifications will
replace and expand.

## Clarifications

### Session 2026-06-25

- Q: Should the bootstrap establish all three test layers (unit/integration/E2E)?
  → A: Yes — scaffold the unit, integration, and E2E harnesses, each with a
  passing smoke test.
- Q: Is the daemon a separate background service, and should the bootstrap include
  it? → A: Yes — the daemon is a separate, headless, long-lived background process;
  the bootstrap stands it up (its own composition root, injected settings, and
  tests) with a UI↔daemon IPC "ping" round-trip. (This supersedes the earlier
  decision to run a single UI process and defer the daemon.)
- Q: Persistence store & developer environment? → A: An embedded file database
  (SQLite) with a startup migration/initialisation runner and a smoke test, with
  **no domain tables** in this iteration; **no Docker**; every component runs via
  documented npm scripts.
- Q: Test coverage across artifacts? → A: Every component (UI, daemon, shared core,
  persistence store) MUST have at least one automated test confirming it works.

## Components & Artifacts *(mandatory)*

- **Desktop UI application**: The user-facing desktop application. Renders the
  landing page; connects to the daemon.
- **Background daemon service**: A separate, headless, long-lived process with its
  own composition root and injected settings. In this iteration it exposes only a
  health/"ping" endpoint over the inter-process channel.
- **Shared core library**: Platform-agnostic domain and orchestration code shared
  by the UI and daemon; contains no OS-specific or process-specific calls.
- **Persistence store**: An embedded file database with a schema-initialisation /
  migration runner that runs on startup. No domain tables are defined yet.
- **Inter-process channel**: Local IPC between the UI and the daemon.
- **Build / run / test tooling**: Documented commands (npm scripts) to install,
  build, run each component individually, run everything together, and run tests.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Launch the application to a landing page (Priority: P1)

A person launches throng on Windows. The desktop UI window opens and displays a
simple landing page that identifies the application ("throng") with a placeholder
welcome message, confirming the application runs end-to-end. The window behaves
like a normal modern desktop window — movable, resizable, closable — and a default
visual theme is applied.

**Why this priority**: A running application that opens to a visible page is the
single most visible proof the skeleton works. It is the surface every later feature
iterates on.

**Independent Test**: Build and launch the application on Windows and confirm the
window opens to the "Hello World" landing page, can be resized, and closes cleanly.

**Acceptance Scenarios**:

1. **Given** the application is available, **When** it is launched, **Then** the UI
   window opens and displays the landing page identifying "throng" with a
   placeholder welcome message.
2. **Given** the window is open, **When** the user resizes or moves it, **Then** it
   responds like a standard desktop window and the landing content stays visible.
3. **Given** the application is running, **When** the user closes the window,
   **Then** the UI exits cleanly with no orphaned terminal processes (there are
   none in this iteration).
4. **Given** the landing page is shown, **When** a reviewer inspects it, **Then** it
   contains only placeholder content and exposes no product features.

---

### User Story 2 - Build, run, and test every component from documented commands (Priority: P1)

A developer can install, build, run, and test the whole skeleton — UI, daemon,
shared core, and persistence store — using documented commands (npm scripts). Each
component can be started individually and all components can be started together,
and the test suite (unit, integration, and E2E) runs green.

**Why this priority**: The bootstrap's real deliverable is a clean, verifiable,
multi-component starting point with a working build/run/test loop, so every later
feature can be added without restructuring.

**Independent Test**: From a clean checkout, run the documented install, build,
run-all, and test commands; confirm every component builds and starts and the test
suite passes green.

**Acceptance Scenarios**:

1. **Given** a clean checkout, **When** the developer runs the documented install
   and build commands, **Then** all components build successfully.
2. **Given** a successful build, **When** the developer runs the "run all" command,
   **Then** the daemon starts and the UI launches to the landing page connected to
   it.
3. **Given** the skeleton, **When** the developer runs the documented test command,
   **Then** the unit, integration, and E2E layers all execute and pass.
4. **Given** the codebase, **When** a reviewer inspects its structure, **Then** the
   shared platform-agnostic core is separated from the UI, the daemon, and the
   OS-specific boundary, with no OS-specific calls leaking into the core.

---

### User Story 3 - The UI communicates with the background daemon (Priority: P1)

The headless daemon service runs as its own background process. The UI connects to
it over the inter-process channel and completes a health/"ping" round-trip,
proving the two processes are wired together — without any terminal functionality.

**Why this priority**: The daemon/client split is the architecture every later
feature depends on. Proving the channel works now de-risks the most novel part of
the system at the cheapest possible time.

**Independent Test**: Start the daemon and the UI, trigger the health/ping
exchange, and confirm the UI receives a successful response from the daemon.

**Acceptance Scenarios**:

1. **Given** the daemon is running, **When** the UI starts, **Then** the UI
   connects to the daemon over the inter-process channel.
2. **Given** a connection, **When** the UI issues a health/"ping" request, **Then**
   the daemon responds and the UI confirms a successful round-trip.
3. **Given** the daemon is not running, **When** the UI starts, **Then** the UI
   reports the daemon is unavailable rather than failing silently.

---

### User Story 4 - The persistence store is initialised (Priority: P2)

On startup, the embedded persistence store is opened and its schema-initialisation
/ migration runner brings it to the current (empty) baseline. No domain data is
stored yet; this proves the persistence layer is wired and migratable.

**Why this priority**: Establishing the database connection and migration mechanism
now means later features add tables via the existing path rather than retrofitting
persistence.

**Independent Test**: Start the relevant component against a fresh data directory
and confirm the database file is created, the baseline migration runs, and a trivial
read/write smoke check succeeds.

**Acceptance Scenarios**:

1. **Given** no existing database, **When** the component starts, **Then** the
   embedded database is created and brought to the baseline schema by the migration
   runner.
2. **Given** an existing baseline database, **When** the component starts again,
   **Then** the migration runner detects it is current and makes no changes.
3. **Given** the initialised store, **When** a smoke test performs a trivial
   read/write, **Then** it succeeds.

---

### Edge Cases

- **Missing runtime/dependencies**: A required runtime or dependency is absent — the
  failure is communicated clearly rather than failing silently.
- **Unsupported operating system**: Launched on a non-Windows OS — out of scope for
  this iteration and must not be presented as supported.
- **Build/test failure on a clean checkout**: The documented commands fail on a
  fresh checkout — treated as a defect, since a green build/run/test loop is the bar.
- **Daemon unavailable**: The UI starts while the daemon is not running — the UI
  reports the daemon is unavailable instead of hanging or crashing.
- **IPC channel address in use**: The inter-process channel address/name is already
  in use — the conflict is surfaced clearly.
- **Database initialisation failure**: The data directory is not writable or the
  database cannot be opened — the failure is surfaced rather than silently ignored.

## Requirements *(mandatory)*

### Functional Requirements

#### Application & landing page

- **FR-001**: The desktop UI application MUST launch on Windows and open a single
  main window.
- **FR-002**: The main window MUST display a landing "Hello World" page that
  identifies the application as "throng" and shows a placeholder welcome message
  intended to be iterated on.
- **FR-003**: This iteration MUST NOT implement any product features — including
  projects, terminals, shell detection, real domain persistence, layouts, change
  review, presets, file browsing, or agent tooling.
- **FR-004**: The main window MUST behave as a modern desktop window (movable,
  resizable, closable) with a default visual theme applied.
- **FR-005**: Closing the UI window MUST shut the UI down cleanly with no orphaned
  terminal processes (there are none in this iteration); the daemon's own lifecycle
  (start/stop) MUST be controllable via documented commands.

#### Components & architecture

- **FR-006**: The codebase MUST be organised into distinct components — UI, daemon,
  and a shared platform-agnostic core — with an explicit OS-specific boundary, and
  the shared core MUST NOT contain OS-specific or process-specific calls.
- **FR-007**: The skeleton MUST establish clearly marked extension points for the
  future feature layers (projects, terminals, layouts, change review, agents)
  without implementing them.

#### Background daemon & inter-process communication

- **FR-008**: The system MUST include a separate, headless, long-lived background
  daemon service that starts independently of the UI, with its own composition root
  and injected settings.
- **FR-009**: The UI MUST connect to the daemon over a local inter-process channel
  and complete a health/"ping" round-trip, proving connectivity; no terminal or
  other product behaviour is implemented over the channel in this iteration.
- **FR-010**: When the daemon is unavailable, the UI MUST report the daemon as
  unavailable rather than hanging or failing silently.

#### Persistence store

- **FR-011**: The system MUST establish an embedded file-based persistence store
  with a schema-initialisation / migration runner that runs on startup and brings
  the store to a baseline. No domain tables are defined in this iteration.
- **FR-012**: Re-running against an already-baselined store MUST be a no-op (the
  migration runner detects the current state and makes no changes).

#### Configuration, DI, tooling, and tests

- **FR-013**: Each runnable process (UI and daemon) MUST compose its object graph
  through constructor dependency injection using a single IoC container configured
  at that process's composition root, and MUST source configuration from injected
  settings rather than hardcoded values.
- **FR-014**: The project MUST provide documented commands (npm scripts) to install,
  build, run each component individually, run all components together, and run the
  test suite.
- **FR-015**: The skeleton MUST stand up all three automated test layers — unit,
  integration, and end-to-end (E2E) — each with at least one passing smoke test, and
  **every component** (UI, daemon, shared core, persistence store) MUST be covered by
  at least one automated test confirming it builds and works. (OS-abstraction
  contract tests are organised as a dedicated runner sub-suite **within the
  integration layer**; they are not a fourth conceptual layer.)
- **FR-016**: A new contributor MUST be able to go from a clean checkout to all
  components running (UI on its landing page, connected to the daemon, with the
  persistence store initialised) by following the documented steps.

### Non-Functional Requirements

- **NFR-001**: The application MUST open to the landing page within 5 seconds of
  launch on a typical modern Windows machine. (Measured by SC-001; verified
  automatically by the E2E timing assertion — tasks T012/T036.)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Launching the application opens the landing page in under 5 seconds on
  a typical Windows machine. (Measurable form of NFR-001.)
- **SC-002**: From a clean checkout, a developer can build, launch, and run the test
  suite using the documented commands, and all three test layers (unit, integration,
  and E2E) pass (green).
- **SC-003**: Every component (UI, daemon, shared core, persistence store) has at
  least one passing automated test.
- **SC-004**: A single documented "run all" command starts the daemon and the UI,
  and the UI's health/"ping" round-trip to the daemon succeeds.
- **SC-005**: On a fresh data directory, the persistence store is created and brought
  to its baseline schema by the migration runner, and a trivial read/write smoke
  check succeeds.
- **SC-006**: The landing page clearly identifies the application as "throng" and
  presents only placeholder content.
- **SC-007**: A reviewer confirms zero product features are present (no project,
  terminal, or agent functionality of any kind).
- **SC-008**: The application window can be resized and a default theme is visibly
  applied.
- **SC-009**: A new contributor can go from cloned repository to all components
  running by following the documented steps in under 20 minutes.
- **SC-010**: A structural review confirms the shared platform-agnostic core is
  separated from the UI, daemon, and OS-specific boundary, with no OS-specific calls
  in the core.

## Assumptions

- **Platform**: This iteration targets Windows. The structure is established so that
  macOS and Linux implementations can be added later, but they are out of scope here.
- **Single user / single machine**: throng is a local desktop application for one
  user on one machine; the persistence store is a single embedded file database
  (SQLite) requiring no server and no container.
- **No Docker**: Because the app is a desktop UI plus a local background process and
  an embedded database, no containerised dev environment is used; all components run
  via npm scripts (`clone → install → run`).
- **Placeholder landing page**: The "Hello World" page is a deliberately minimal,
  throwaway placeholder; no final visual design or branding is expected.
- **Technology baseline**: The concrete technology choices recorded in the project
  constitution (Electron + TypeScript UI, a Node daemon, embedded SQLite) are pinned
  during planning; functional requirements stay outcome-focused.
- **Daemon in the bootstrap**: The daemon is included as a runnable, reachable
  skeleton only; its terminal-hosting and persistence-across-restart behaviour is
  exercised in the later terminal-persistence feature, not here.

## Out of Scope (this feature)

- All product capabilities: projects, terminals, installed-shell detection, terminal
  persistence and reattachment, tabbed/tiled layouts, change review & approval,
  terminal presets, the project file explorer / Markdown preview, and agent tooling.
- Any **domain database schema/tables** — only the persistence store infrastructure
  and its migration mechanism are established (no real data model yet).
- Real behaviour over the inter-process channel beyond the health/"ping" round-trip.
- A containerised (Docker) development environment.
- Operating systems other than Windows.
- Final visual design, branding, and theming beyond a single default theme.
- Packaging, installers, auto-update, and distribution.
