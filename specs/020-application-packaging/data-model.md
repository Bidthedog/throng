# Phase 1 Data Model: Application Packaging

**Feature**: 020-application-packaging | **Date**: 2026-07-18

These are the entities packaging introduces or formalises. Most are **value objects and build/CI
artifacts**, not persisted rows — packaging adds no table to the existing SQLite store. Fields, invariants,
and the requirement each traces to are listed so tasks and contracts derive from one source.

---

## Product Version

The single authoritative, ordered identifier for a build of throng.

| Field | Type | Notes |
|-------|------|-------|
| `value` | string | SemVer `MAJOR.MINOR.PATCH` (FR-002 — ordered, comparable). Source: root `package.json` `version`. |
| `isPlaceholder` | boolean (derived) | `true` when `value` is `0.0.0` or empty (FR-028 condition (a) — placeholder publish refusal). |

- **Invariants**: exactly ONE declaration (root `package.json`); every component derives from it, none
  declares its own (FR-001). Changing it is a single edit (FR-005). Distinct from `BUILD_ID` (FR-006).
- **Operations**: `getProductVersion()` (read the single source), `compare(a, b)` (ordered comparison for
  upgrade/downgrade detection, FR-002/016a).
- **Traces**: FR-001, FR-002, FR-004, FR-005, FR-006; SC-002.

## Build Identifier (existing — referenced, not changed)

The content-hash id (`scripts/stamp-build.mjs`) that detects a stale daemon. Retained unchanged; MUST stay
distinct from Product Version (FR-006). Two builds of the same product version remain distinguishable by it.

## Pipe Endpoint

The per-user IPC endpoint the UI client and daemon server rendezvous on.

| Field | Type | Notes |
|-------|------|-------|
| `userToken` | string | Stable per-user identity (account SID via the OS abstraction; sanitised username fallback). |
| `name` | string (derived) | `\\.\pipe\throng.<userToken>.daemon`. Overridable by `THRONG_PIPE_NAME` (tests). |

- **Invariants**: the daemon-side and UI-side derivations MUST produce the **same** name for one user and
  **different** names for different users (FR-013). One derivation source (DRY); flows through injected
  settings (Principle X).
- **Traces**: FR-013; SC-006; edge case "two installations on one machine".

## Installed Component Set

Everything an install places under the single install root.

| Element | Source | Notes |
|---------|--------|-------|
| Electron app (main, preload, renderer, asar) | `packages/ui/dist` | The shell. |
| Daemon dist + native `node_modules` | `packages/daemon/dist` + natives | Host-Node ABI (FR-009). |
| Bundled Node runtime (`node.exe`) | pinned Node ≥20 | Spawns the daemon in production (D1/FR-009). |
| Product icon | existing app icon | Applied to executable + shortcut (FR-014). |
| Bundled licence text | `LICENSE` (AGPL-3.0) | Read by the About dialog (FR-003a). |

- **Invariants**: all under one install root (FR-007); nothing written there at runtime (FR-008); nothing
  fetched at first run (FR-009). Removed entirely on uninstall (FR-020).
- **Traces**: FR-007, FR-008, FR-009, FR-014; SC-004.

## Distributable Package (Installer)

The single file a user downloads and runs.

| Field | Type | Notes |
|-------|------|-------|
| `fileName` | string | Carries the product version (FR-004). |
| `version` | Product Version | Equals the version inside the package (FR-033). |
| `perUser` | boolean | Always `true` (`perMachine:false`) — no admin (FR-012/040). |
| `sha256` | string | Computed from the exact published bytes, last (FR-042a). |

- **Invariants**: self-contained (FR-009); installs per-user (FR-040); refuses a downgrade in place
  (FR-016a); interrupted install leaves no launchable partial (FR-022).
- **Traces**: FR-004, FR-009, FR-012, FR-016a, FR-022, FR-033, FR-038, FR-040, FR-042a.

## Per-User Data (existing — referenced)

Projects, sub-workspaces, layouts, window state, settings, keybindings, custom themes, edit list, recovery.
Lives outside the install root; survives upgrade (FR-016); **retained by default** on uninstall, removed
only via the unticked "also delete my projects and settings" checkbox (FR-021). Traces: FR-016, FR-021;
SC-003.

## Verification Verdict

The recorded result of exercising a package's full install lifecycle on a clean environment.

| Field | Type | Notes |
|-------|------|-------|
| `version` | Product Version | The package tested. |
| `installerSha256` | string | Binds the verdict to the exact bytes. |
| `passed` | boolean | All steps (install, launch, version match, core journey, uninstall, no residue, checksum match) succeeded. |
| `failedStep` | string \| null | Names the first failed step (FR-025). |

- **Invariants**: bound to one exact package (FR-026); **absent = failed** (FR-027); a mismatched checksum
  fails it (FR-024a).
- **Traces**: FR-023–FR-027, FR-024a; SC-007.

## QA Sign-off

An explicit human act certifying a specific package is fit to release.

| Field | Type | Notes |
|-------|------|-------|
| `version` | Product Version | The package certified. |
| `approver` | string | The human who approved (GitHub Environment reviewer). |
| `bindsTo` | commit/artifact ref | Ties the sign-off to the exact build (FR-030). |

- **Invariants**: not satisfiable by automation, default, or elapsed time (FR-029); binds to the exact
  package (FR-030).
- **Traces**: FR-028 (c), FR-029, FR-030; SC-005.

## Published Release

A GitHub Release for one product version.

| Field | Type | Notes |
|-------|------|-------|
| `version` | Product Version | Equals the package's internal version (FR-033). |
| `installer` | Distributable Package | The downloadable artifact. |
| `checksum` | string | SHA-256 in the release notes beside the artifact (FR-032/042). |
| `sourceRevision` | commit SHA | The exact source built from (FR-035). |
| `immutable` | boolean | Re-publishing the same version is refused (FR-034). |

- **Invariants**: created only when version + verification verdict + QA sign-off all hold (FR-028); no
  manual artifact handling (FR-036); not publishable from an unreviewed place (FR-037).
- **Traces**: FR-028, FR-032–FR-037, FR-042; SC-001a, SC-002, SC-005, SC-008.

## About Dialog (UI surface, not persisted)

Presents the running copy's identity + licence. Fields shown: product version + `BUILD_ID` (selectable
text), copyright notice, licence link, full AGPL-3.0 text (read-only scrollable). Traces: FR-003, FR-003a;
US1 scenario 4.
