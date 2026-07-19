# Implementation Plan: Application Packaging

**Branch**: `worktree-21-app-packaging` | **Date**: 2026-07-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/020-application-packaging/spec.md`

## Summary

Give throng a real, single-sourced product version; package it into a self-contained per-user Windows
installer that ships a bundled Node runtime for the host-Node daemon; scope the daemon's IPC endpoint per
user; surface version + licence in an "About throng" dialog; and add an installer-verification job and a
gated GitHub-Releases publish pipeline (real version + passed verification + human QA sign-off) that
publishes a SHA-256 checksum instead of signing. The technical spine (from [research.md](./research.md)):
**bundle `node.exe`** so the daemon keeps its host-Node ABI natives (no electron-rebuild); **electron-builder
NSIS `perMachine:false`** for the no-admin per-user install; **derive the pipe name per user in one shared
`core` source**; **root `package.json` version** as the single source with a generated daemon constant and
a guard test; **a native app menu → About window** mirroring the preferences-window pattern; and
**two CI jobs** — clean-machine installer verification and an Environment-gated release.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node ≥20 (host-Node daemon runtime), targeting ES modules.

**Primary Dependencies**: Electron 43 (UI shell); `electron-builder` (NSIS per-user target — **new dev
dependency**); `better-sqlite3` 12 / `node-pty` 1 / `koffi` 3 (daemon native modules, host-Node ABI);
inversify (composition roots, Principle IX); Vite (renderer build); Playwright + vitest (tests).

**Storage**: Existing per-user SQLite + JSON config under `%APPDATA%\throng` / `%USERPROFILE%\.throng`.
No new store; packaging writes **nothing** to the install root at runtime (FR-008).

**Testing**: vitest projects `unit` / `integration` / `contract`; Playwright `e2e` (`_electron.launch`,
`packages/ui/tests/e2e/**/*.e2e.ts`). New logic (version/pipe/checksum/gate/residue) → unit+contract;
version surfacing → integration; About dialog → E2E. Installer build + clean-machine verification + real
publish run in **CI**, not locally (see Complexity Tracking).

**Target Platform**: Windows 11 (x64) — the only platform throng runs on today (FR-038). macOS/Linux gates
kept platform-neutral (FR-039); nothing packaged for them.

**Project Type**: Electron desktop application — multi-package npm workspace (UI main + renderer, detached
host-Node daemon, shared core/ipc/persistence/platform packages).

**Performance Goals**: Clean-machine "download → running throng with a live terminal" in **< 3 minutes**
(SC-001), including passing the unsigned-app warning using only the release-notes instructions.

**Constraints**: No administrator elevation (FR-012/040); no runtime prerequisites and nothing fetched at
first run (FR-009); no new network call added to the app (FR-041); daemon must not become a Windows service
and must keep terminals alive across UI close and across upgrade/uninstall prompts (FR-010/011/019,
Principle III).

**Scale/Scope**: One installer artifact per supported platform; ~6 workspace packages touched lightly
(core: pipe/version derivation; ui: About + runtime resolution; scripts + `.github/workflows`: packaging,
verification, publish). No change to the terminal/daemon data model.

## Constitution Check

*GATE: evaluated against all eleven principles of Constitution v4.0.0 before Phase 0 and re-checked after
Phase 1 design. Result: **PASS** (no violations requiring Complexity-Tracking justification; two
incremental-delivery boundaries recorded, which the constitution explicitly permits).*

| # | Principle | Assessment |
|---|-----------|------------|
| I | Project-First Context Isolation | **PASS** — no change to the project model; per-user install/pipe reinforce isolation across OS user accounts (FR-013). |
| II | Platform-Abstracted Core (OS-Agnostic) | **PASS** — per-user identity (SID) for the pipe, and any install-location/residue probing, sit behind the existing OS abstraction; Windows-only concretions, macOS/Linux gates kept open (FR-039). |
| III | Detached, Tagged & Persistent Terminals | **PASS (central)** — bundling a Node runtime *preserves* the host-Node daemon split; the daemon stays detached and per-user, never a service (FR-010/011). Upgrade/uninstall with live terminals uses the existing three-choice close warning and orphans nothing (FR-019/020, edge cases). |
| IV | Native Terminal Support & Auto-Detection | **PASS** — shell detection unchanged; the packaged app must still find installed shells (verification's core journey spawns a terminal). |
| V | Test-First Quality Discipline | **PASS** — every new unit of logic is test-first at its layer; the About dialog ships with E2E (UI-change rule); verification/publish gate logic is unit/contract-tested. Clean-machine install E2E and real publish run in CI (recorded). |
| VI | Simple, Modern, Discoverable UX | **PASS** — the About item is reachable from the application menu without instruction (FR-003); the uninstall data-retention checkbox is a plain, defaulted choice (FR-021). |
| VII | Change Review & Approval | **N/A to this feature** — no edit-list behaviour touched. |
| VIII | SOLID, DRY & YAGNI | **PASS (improves)** — collapses the duplicated pipe-name constant into one derived source (DRY); adds only what FR-scoped requirements need (YAGNI — no auto-update, no signing). |
| IX | Dependency Injection & Composition Root | **PASS** — the bundled runtime path and per-user pipe flow through each boundary's existing single composition root as injected settings; no new global container, no ambient singletons. |
| X | Externalised Configuration | **PASS** — pipe name, runtime path, log/version values remain injected typed settings (`IDaemonSettings`/`IUiSettings`); only defaults change from constants to derivations. Nothing new hardcoded. |
| XI | Dockable Workspace: Panes, Tabs & Panels | **PASS** — the About window is an app-modal dialog, not a Panel/Tab/Pane; it presents no document, so "one document, one state" does not apply. |

**Quality gates (Development Workflow):** lint + typecheck zero-error, the four test layers in CI, docs
currency (README/CONTRIBUTING/docs updated for the new install/build story), and — because the About
dialog adds an action control (the menu item / any About-window buttons) — the **themeable-icon-control**
and **configuration-editor-completeness** rules are checked at `/speckit-tasks` time. The About dialog adds
**no new configurable setting** (version/licence are not user configuration), so the editor-completeness
registry is unaffected; this is asserted, not assumed.

**Post-Phase-1 re-check: PASS** — the data model and contracts introduce no entity or interface that
violates a principle; the two CI-only execution boundaries (D6/D7) are incremental-delivery boundaries with
tracked follow-through, not principle violations.

## Project Structure

### Documentation (this feature)

```text
specs/020-application-packaging/
├── plan.md              # This file
├── research.md          # Phase 0 — the seven design decisions (D1–D7)
├── data-model.md        # Phase 1 — entities: Product Version, Pipe Endpoint, Verification Verdict, …
├── quickstart.md        # Phase 1 — how to build, install, verify, and (dry-run) publish
├── contracts/           # Phase 1 — version/pipe/checksum/verdict/publish-gate contracts
│   ├── product-version.md
│   ├── pipe-endpoint.md
│   ├── installer.md
│   ├── verification-verdict.md
│   └── publish-gate.md
└── tasks.md             # Phase 2 — /speckit-tasks (NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
packages/
├── core/
│   └── src/config/
│       ├── product-version.ts     # NEW — single-source version accessor + SemVer compare (FR-001/002/005)
│       └── pipe-endpoint.ts       # NEW — per-user pipe-name derivation, one source (FR-013); used by both boundaries
├── platform-windows/
│   └── src/                       # NEW — OS user-token/SID resolver behind the abstraction (injected into pipe derivation) (FR-013, Principle II)
├── daemon/
│   └── src/composition-root.ts    # EDIT — default pipe from injected core derivation, not the local constant
├── ui/
│   ├── src/main/
│   │   ├── ui-settings.ts         # EDIT — default pipe from core derivation, not the local constant
│   │   ├── app-menu.ts            # NEW — minimal application menu (Help → About throng) (FR-003)
│   │   ├── about-window.ts        # NEW — app-modal About window (preferences-window pattern) (FR-003/003a)
│   │   ├── daemon-lifecycle.ts    # EDIT — resolve nodePath to the bundled runtime in production (FR-009)
│   │   └── main.ts                # EDIT — build the app menu; wire the About IPC; version to renderer
│   ├── src/renderer/about/        # NEW — About surface: version+buildId (selectable), copyright, licence, full AGPL text
│   ├── tests/e2e/about.e2e.ts     # NEW — About dialog E2E (FR-003/003a, Principle V)
│   └── build/                     # NEW — electron-builder assets (licence text asset, NSIS uninstall-checkbox include)
├── */tests/{unit,contract}/       # NEW — product-version, pipe-endpoint, checksum, gate, residue tests
scripts/
├── generate-version.mjs           # NEW — stamp daemon product-version constant at build (mirrors stamp-build.mjs)
├── stage-runtime.mjs              # NEW — stage the exact-pinned bundled node.exe into build resources (FR-009)
├── checksum.mjs                   # NEW — SHA-256 of exact published bytes, last byte-reading step (FR-042/042a)
├── residue-scan.mjs               # NEW — no throng process / no install-root component (shared by US3 + verify)
├── verify-installer.mjs           # NEW — clean-machine install→launch→version→journey→uninstall→residue (US4)
└── publish-gates.mjs              # NEW — evaluate real-version / verified / signed-off; refuse re-publish (US5)
electron-builder.yml               # NEW — at REPO ROOT (packaging the whole workspace); NSIS per-user target,
                                   #       extraResources (node.exe + daemon), icon, Start-menu shortcut, ARP
.github/workflows/
├── ci.yml                         # EDIT — add a build:installer step / artifact where cheap
└── release.yml                    # NEW — verify job + Environment-gated publish + checksum (US4/US5, FR-023..037)
```

**Structure Decision**: Extend the existing workspace in place. Shared, testable logic (version, pipe,
checksum, gate, residue) lives in `packages/core` and `scripts/` so it is unit/contract-testable without
building an installer. The Electron-app-specific surfaces (About window/menu, runtime resolution) live in
`packages/ui`. Packaging/verification/publish orchestration lives in `electron-builder.yml` +
`.github/workflows/` where it actually runs. This keeps the OS/packaging concretions at the edges and the
decision logic in the tested core (Principles II, VIII, IX).

## Complexity Tracking

No Constitution violations require justification. Two **incremental-delivery boundaries** are recorded here
per the Development Workflow rule (they are sequenced execution, not weakened requirements):

| Boundary | What is delivered in this feature | What executes only in CI / on a real install | End-state requirement (never weakened) |
|----------|-----------------------------------|----------------------------------------------|----------------------------------------|
| **Clean-machine installer verification (D6/US4)** | The `verify-installer.mjs` harness + its unit-tested residue/version/checksum logic + the `release.yml` verify job wiring. | The *actual* NSIS build + silent install + launch + uninstall on a fresh `windows-latest` runner. Cannot run inside this session (no clean VM here). | FR-023–FR-027, FR-024a — verification runs automatically on a clean env and its verdict gates publish. |
| **Gated GitHub-Releases publish (D7/US5)** | The `release.yml` workflow, the Environment/reviewer gate config, `publish-gates.mjs` + `checksum.mjs` with unit tests. | The *actual* release publish against a real tag with a human approver, and the SmartScreen behaviour on a real download. | FR-028–FR-037, FR-042/042a/043 — publish is refused unless version+verified+signed-off; checksum published; source recorded; no re-publish. |
| **Reproducible rebuild (SC-008)** | Recording the exact source revision (T041) and the exact bundled-runtime version (T002); the rebuild-from-revision assertion (T041b). | The *actual* checkout-and-rebuild of a published revision on a clean runner, comparing the installed component set. | SC-008 — a release's artifacts are rebuildable from the recorded source revision, producing the same installed component set (same components, not a byte-for-byte determinism promise). |

Both boundaries are surfaced honestly in the final report and remain tracked by #21 until a real release
exercises them. Nothing about the requirements is softened; only the *first real execution* of the
installer build and the release publish happens on CI/real hardware rather than in the authoring session.
