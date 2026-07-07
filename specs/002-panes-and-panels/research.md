# Phase 0 Research: Panes & Panels Workspace

**Feature**: 002-panes-and-panels | **Date**: 2026-06-26 | **Constitution**: v3.0.0

This document resolves the design unknowns in the plan's Technical Context. Each decision is
stated with rationale and the alternatives weighed against it.

---

## D1 — The docking model is domain logic in `@throng/core`, not UI code

**Decision**: Model the entire workspace (Projects, the two Panes, Tabs, the recursive split
tree, Panels, and Sub-workspaces) and **all of its invariants and mutating operations** as pure
TypeScript in `@throng/core/workspace` and `@throng/core/projects`. The renderer holds a mirror
of this state and dispatches *commands*; every state change is produced by a core operation that
returns a new, invariant-valid layout.

**Rationale**:
- Principle II (no OS/DOM in core) + Principle V (test-first): the hard logic — split/collapse,
  move/group, tab reorder, "main workspace never mixes projects", "Panels reattach only to their
  original project", "always ≥1 Tab with ≥1 Panel" — becomes deterministic, fast **unit tests**
  with no Electron/DOM. This is the highest-value testing surface in the feature.
- Principle VIII (SRP/DIP): the renderer and the daemon both depend on the same domain
  abstractions; presentation and persistence never re-implement the rules.

**Alternatives considered**:
- *Logic embedded in React components / a docking library's internal state* — rejected: invariants
  become untestable without a DOM, and the unusual cross-project rules cannot be expressed.
- *Logic in the daemon* — rejected: the workspace is interactive UI state mutated at pointer speed;
  round-tripping every drag to the daemon is needless latency. The daemon persists snapshots, the
  core computes them, the renderer drives them.

---

## D2 — Renderer = React 18 + TypeScript, bundled with Vite

**Decision**: Grow the renderer from 001's plain-TS landing page into a **React 18 + TypeScript**
application, bundled with **Vite**. Build output replaces the current `tsc`+copy-assets path for
the renderer only (main/preload stay on `tsc`).

**Rationale**: A docking workspace (live tab groups, nested splits, drag ghosts, project switching,
multi-window) needs a component model with efficient re-render and mature DnD ecosystem. React +
Vite is the industry default, integrates cleanly with Electron, and is first-class for
Playwright-Electron E2E. Constitution encourages reusing OSS *components* (not forking an IDE).

**Alternatives considered**:
- *Plain TS (001 style)* — rejected: does not scale to this interactivity.
- *Preact / Lit / Svelte* — viable and lighter; React chosen for ecosystem (`@dnd-kit`), team
  familiarity, and testing maturity. Revisit only if bundle size becomes a real constraint (YAGNI).
- *Off-the-shelf docking library as the source of truth (golden-layout, rc-dock, Dockview)* —
  rejected as the model owner: none encode the cross-project main-workspace rule or
  merge-to-original-project. We may borrow presentation patterns, but the **model is ours** (D1).

---

## D3 — Drag-and-drop = pointer-based, `@dnd-kit` in-window; commands cross windows

**Decision**: In-window drag (move/group Panels, reorder Tabs, edge-split drops) uses
**`@dnd-kit/core`** (pointer sensors) with custom **edge drop-zones** that map a drop to a core
operation (`movePanel`, `splitPanel`, `reorderTab`). Cross-window operations (detach, reattach)
are **explicit commands over IPC/UI-main**, not literal cross-window HTML drag.

**Rationale**: HTML5 drag-and-drop cannot target nested split edges precisely and **cannot cross
OS windows**. Pointer-based DnD gives full control of drop feedback (NFR-001: 100 ms). Detach =
drag a Tab/Panel and drop on a "tear-off" zone (or drag beyond the window bounds, detected via
screen coords); reattach = drag within a sub-workspace onto a "return to project" affordance, or
drop onto the main window detected by the window manager. The renderer issues a command; the UI
main + core perform the move.

**Alternatives considered**:
- *Native HTML5 DnD* — rejected: poor nested-target control, no cross-window support.
- *Full custom DnD from scratch* — rejected for in-window (reinvents `@dnd-kit`); retained only for
  the cross-window handshake where no library helps.

---

## D4 — Persistence stays daemon-owned; access via new JSON-RPC methods

**Decision**: The **daemon remains the single owner/writer of the SQLite store** (as in 001). The
UI reads/writes projects and per-project layouts through **new JSON-RPC methods** added to the
named-pipe channel: `projects.list/create/update/delete/setActive` and `workspace.load/save`
(plus sub-workspace persistence). The renderer reaches them via preload → UI main `daemon-client`.

**Rationale**: better-sqlite3 is a single-process synchronous library; two writers (UI + daemon) to
one file invites locking/corruption. The daemon is the established owner, and **future terminals
(daemon-owned) will reference projects** — keeping projects in the daemon avoids a later migration
of ownership. This also exercises the daemon/client architecture for real, beyond `health.ping`.

**Alternatives considered**:
- *UI main opens the DB directly* — rejected: dual writers, split ownership, divergence from the
  daemon/client model.
- *A second DB owned by the UI* — rejected: two stores to back up/import/export, and project↔terminal
  references would straddle stores.

**Trade-off accepted**: layout *snapshots* travel over IPC. Mitigation — the renderer mutates its
local mirror instantly (no IPC in the drag loop); `workspace.save` is **debounced** (a typed
setting) and sends the whole per-project layout document, which is small (tens of KB).

---

## D5 — Layout stored as a JSON document per project; projects normalized

**Decision**: Migration **v2** adds three tables, all carrying `owner_user`:
- `projects` — normalized row per project: `id`, `owner_user`, `name`, `colour`, `root_folder`,
  `created_at`, `updated_at`, plus an `is_active` marker (one active project per user).
- `workspace_layout` — one row per (`owner_user`, `project_id`) with a `layout_json` column holding
  the **recursive Tab/split/Panel tree** (+ active tab, sizes, tab order) and a `schema_version`.
- `sub_workspaces` — detached-window records: `id`, `owner_user`, `bounds_json` (x/y/w/h + display
  id), and the contained Tabs/Panels as a JSON document (may reference multiple projects).

**Rationale**: The layout tree is a document we **never query into** — we load/save it whole per
project. A JSON document is the simplest, fastest, most testable representation (YAGNI). Projects
*are* queried/listed/filtered, so they are normalized rows. `owner_user` everywhere satisfies the
constitution's per-user storage constraint and pre-shapes for future multi-user + import/export.

**Alternatives considered**:
- *Fully normalized tree (tables for tabs, split-nodes, panels with parent FKs)* — rejected: recursive
  joins, ordering columns, and write amplification for zero query benefit (YAGNI).
- *One JSON blob for everything incl. projects* — rejected: projects need listing/uniqueness/active-flag
  queries; keep them relational.

---

## D6 — User identity = OS user as owner key; no auth; local profile

**Decision**: No in-app login. A new `IUserContext` abstraction exposes the **current OS user**
(`userId`/`userName` via `os.userInfo()`); its value is stored as `owner_user` on every row. The
data directory remains the existing per-user `%APPDATA%/throng` location (001). Import/export of
project setup data is **designed for** (owner key + self-contained JSON documents) but **not built**.

**Rationale**: Matches the clarification (no login; logged-in OS user; local profile; future
import/export) and the constitution's per-user storage constraint. `os.userInfo()` is cross-platform
Node, so the impl is not strictly OS-specific, but it is injected through an abstraction for testability.

**Alternatives considered**: app accounts / sign-in (rejected — out of scope, large security
surface); a single implicit global user (rejected — drops the user-specific requirement and
blocks future multi-user/import-export).

---

## D7 — Sub-workspaces (US4): Electron windows + propagated focus group (HIGH RISK)

**Decision**: Each sub-workspace is an Electron `BrowserWindow` created by a UI-main
**`window-manager`** from layout data. The **single focus/stacking group** is implemented by
listening for `focus` on any group window and raising the others (`moveTop`/`show`, and/or
`setParentWindow` relationships), so the group travels together. Window bounds are persisted; on
restore, the manager validates each saved bound against `IDisplayInfo` (Electron `screen`) and
**clamps to a visible display**. Cross-window reattach is the command handshake from D3.

**Rationale**: Electron has **no native shared Z-order or cross-window DnD**, so both must be built;
this is the feature's riskiest area and crosses into OS window management. Confining it to
`window-manager` + the `IDisplayInfo` seam keeps the rest of the system clean.

**Alternatives considered**:
- *`setParentWindow` parent/child only* — partial: child windows follow the parent but the
  "focus any → raise all" symmetry needs explicit focus propagation; combine both.
- *Single window with simulated panes (no real OS windows)* — rejected: the spec/constitution require
  real detached OS windows across monitors.

**Recommendation**: Treat US4 as a **separable follow-up (002b)**. It is P3, depends only on the
core `detach`/`reattach` operations (which are cheap to unit-test now) and the `window-manager`, so
deferring it removes the most schedule risk without reworking US1–US3. `/speckit-tasks` should phase
US4 last.

---

## D8 — New OS abstractions: `IUserContext`, `IDisplayInfo` (with contract tests)

**Decision**: Add two interfaces to `@throng/core/abstractions`:
- `IUserContext` → `currentUser(): { userId: string; userName: string }`. Impl `NodeUserContext`
  in `platform-windows` (uses `os.userInfo()`); contract test asserts stable, non-empty identity.
- `IDisplayInfo` → `listDisplays()`, `isPointVisible(bounds)`, `clampToVisible(bounds)`. Impl
  `ElectronDisplayInfo` in **UI main** (uses Electron `screen` — only available in the main
  process). Contract test asserts ≥1 display, clamp keeps bounds within some display.

**Rationale**: Principle II — all OS-specific behaviour behind contracts with OS-specific impls.
`screen` is Electron-main-only, so its impl lives in UI main (allowed to use Electron), not in the
Node-only `platform-windows`. Contract tests (Principle V, extends 001 [Gap A]) verify any impl.

**Alternatives considered**: calling `os`/`screen` directly in business logic — rejected (violates
II/V/X). Putting the display impl in `platform-windows` — rejected (`screen` is not available there).

---

## D9 — Renderer composition root (the third root)

**Decision**: The renderer gets **one composition root** (`renderer/composition-root.tsx`) that
wires renderer-side services: the layout **store** (mirror of core state), a **command dispatcher**
(calls core operations, then persists via the bridge), and a **WorkspaceClient** (preload bridge to
`projects.*`/`workspace.*`). React components receive these via a context provider, not by importing
singletons.

**Rationale**: The renderer runs in a separate Electron process that cannot share the main
container; Principle IX's "one composition root per independently-runnable process" therefore yields
exactly one renderer root. This is the principle applied, not bent (see Complexity Tracking). DI keeps
components testable (Vitest) by injecting fakes for the store/client.

**Alternatives considered**: container-free renderer (001) — rejected for a full app (D2, Complexity
Tracking); sharing the main container — impossible across processes.

---

## D10 — IPC contract expansion (`projects.*`, `workspace.*`)

**Decision**: Extend `@throng/ipc-contract` with typed request/result shapes for the new methods,
keeping `health.ping` untouched and backward-compatible. Methods (full shapes in `contracts/`):
- `projects.list` → Project[]; `projects.create` → Project; `projects.update`; `projects.delete`;
  `projects.setActive`.
- `workspace.load(projectId)` → WorkspaceLayout document; `workspace.save(projectId, layout)`;
  `workspace.persistSubWorkspaces(records)` / `workspace.loadSubWorkspaces()`.
All over the existing newline-delimited JSON-RPC 2.0 named-pipe transport; unknown methods still
return `-32601`. The 1 MB line guard is kept (layout documents are far smaller).

**Rationale**: Reuses the proven 001 transport; one schema source shared by daemon + UI; renderer
never sees raw JSON-RPC (it calls typed bridge methods). Contract tests pin the wire shapes.

**Alternatives considered**: a second transport (HTTP/socket) — rejected (YAGNI; the pipe works);
ad-hoc untyped messages — rejected (Principle VIII; lose compile-time safety and contract tests).

---

## Resolved unknowns summary

| Unknown (Technical Context) | Resolved by |
|-----------------------------|-------------|
| Where docking logic lives | D1 — pure `@throng/core` domain |
| Renderer framework + build | D2 — React 18 + Vite |
| Drag-and-drop mechanism | D3 — `@dnd-kit` in-window; command handshake cross-window |
| Who owns persistence | D4 — daemon (single SQLite writer), via IPC |
| Layout storage shape | D5 — JSON document per project; projects normalized; migration v2 |
| User identity / storage scope | D6 — `IUserContext` (OS user) owner key; local profile; no auth |
| Multi-window detach + focus group | D7 — Electron windows + propagated focus; **US4 = separable 002b** |
| New OS abstractions | D8 — `IUserContext`, `IDisplayInfo` + contract tests |
| Renderer DI | D9 — third composition root (one per process) |
| IPC surface | D10 — `projects.*` / `workspace.*` typed contracts |

**No `NEEDS CLARIFICATION` markers remain.** Proceed to Phase 1.
