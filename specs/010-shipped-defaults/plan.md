# Implementation Plan: Shipped Defaults

**Branch**: `010-shipped-defaults` | **Date**: 2026-07-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/010-shipped-defaults/spec.md`

## Summary

Provide the single authoritative, immutable, versioned record of the application's shipped defaults
(built-in themes, application settings, key bindings), **generated from the existing `@throng/core`
definitions** rather than hand-copied, and the non-UI API every restore-to-default operation reads
from: restore-all-built-in-themes (reset edited built-ins, recreate deleted ones, custom themes
untouched), reset-single-key-binding, reset-single-setting (leaf by dotted path), reset-everything,
plus first-run seeding and additive-only upgrade. All restores are whole-operation atomic with
rollback. No UI ships in this feature; `014-theme-editor` and `015-preferences-and-settings` build the
controls on top of this API.

**Technical approach**: pure decision logic (record assembly, restore/reset/seed/upgrade write-plans,
additive theme-property fill, name reservation) lives in a new OS-agnostic core module
`packages/core/src/config/shipped-defaults.ts` (Principle II). The I/O — reading current on-disk state,
applying write-plans atomically with staging+rollback, and the applied-version marker — lives in a
UI-main `ShippedDefaultsService` plus a transactional multi-file write added to `FileConfigStore`
(Principle IX). The record is materialised as a JSON artifact at build time by
`scripts/generate-shipped-defaults.mjs` for distribution/inspection; runtime consumes the in-process
record so tests need no build and `009-theme-content`'s definition changes flow through automatically
(a fidelity test fails on any divergence between the record and the live definitions).

## Technical Context

**Language/Version**: TypeScript 5.9 (ESM, `"type":"module"`), Node >= 20, Electron 43.

**Primary Dependencies**: none new. Reuses `@throng/core` config definitions (`ALL_DEFAULT_THEMES`,
`DEFAULT_APP_SETTINGS`, `DEFAULT_KEYBINDINGS`, `THRONG_THEME`), path helpers (`getAtPath`/`setAtPath`
from `config/metadata.ts`), and `FileConfigStore` (UI main). InversifyJS composition root.

**Storage**: user-writable JSON config under `%USERPROFILE%\.throng` (`configRoot`, overridable via
`THRONG_CONFIG_ROOT`): `settings.json`, `keybindings.json`, `themes/<name>.json`, plus a new
bookkeeping file `defaults-state.json` (applied-defaults version marker). The shipped-defaults record
is code/build output, never written to the config root.

**Testing**: Vitest projects — `unit` (pure core logic), `integration` (service against a real
`FileConfigStore` over a temp `configRoot`), `contract` (record fidelity + config-store contract). No
Playwright E2E (this feature ships no UI — Constitution V requires E2E only for UI changes).

**Target Platform**: Windows first (file-locking behaviour is real and tested); OS-agnostic core.

**Project Type**: desktop-app (Electron), monorepo workspaces `packages/*`.

**Performance Goals**: startup seeding/upgrade must not perceptibly delay launch; upgrade is gated on a
version-marker mismatch so the common launch does no theme re-scan.

**Constraints**: restores atomic (all-or-nothing) with rollback on a locked/unwritable file; upgrade
purely additive (never overwrites an existing user value); all operations idempotent.

**Scale/Scope**: 15 built-in themes (throng + 14), one settings document (~40 leaves), 14 key-binding
actions. Small data; correctness- and safety-critical, not throughput-critical.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design. Constitution v3.12.0.*

- **I. Project-First Context Isolation** — N/A (no project/terminal surface touched). Pass.
- **II. Platform-Abstracted Core** — all decision logic is pure and OS-free in `@throng/core`; every
  filesystem call is in UI-main behind `FileConfigStore`/`ShippedDefaultsService`. Pass.
- **III. Detached/Persistent Terminals** — N/A. Pass.
- **IV. Native Terminal Support** — N/A. Pass.
- **V. Test-First Quality Discipline** — Red-Green-Refactor with unit + integration + contract layers.
  No UI so no E2E requirement (the rule is scoped to user-facing UI changes); recorded explicitly.
  Rollback and idempotence are covered by tests, including a locked/unwritable-file case. Pass.
- **VI. Simple, Modern, Discoverable UX** — N/A (no UI). Pass.
- **VII. Change Review & Approval** — N/A. Pass.
- **VIII. SOLID/DRY/YAGNI** — reuses existing definitions and path helpers; one pure module + one
  service + one transactional write method; no speculative version-transformation machinery
  (additive-only). Pass.
- **IX. Dependency Injection & Composition Root** — the record and the service are bound in the UI
  main composition root and injected; no ambient singletons. Pass.
- **X. Externalised Configuration** — defaults version is a documented constant; `configRoot` stays
  injected; nothing read ad hoc from the environment. Pass.
- **XI. Dockable Workspace** — N/A. Pass.
- **Configuration-editor completeness rule** — this feature adds **no** user-configurable setting, key
  binding, or theme token; the `defaults-state.json` version marker is internal bookkeeping (not a
  user-editable key), so the editor-metadata registry and its completeness test are unaffected. Pass.
- **Themeable icon controls rule** — no action controls added (no UI). Pass.
- **Idempotent data migrations rule** — the additive upgrade is idempotent by construction and tested
  for re-run convergence. Pass.

**Result: PASS. No violations; Complexity Tracking not required.**

## Project Structure

### Documentation (this feature)

```text
specs/010-shipped-defaults/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (the restore API surface)
│   └── shipped-defaults-api.md
├── checklists/
│   └── requirements.md  # spec quality checklist (16/16)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/core/src/config/
├── shipped-defaults.ts            # NEW — pure record + plans (OS-agnostic)
└── (reuses) app-settings.ts, keybindings.ts, theme.ts, default-themes/index.ts,
              metadata.ts (getAtPath/setAtPath)

packages/core/src/index.ts         # EDIT — export the new public surface

packages/ui/src/main/
├── config-store.ts                # EDIT — add transactional writeFilesAtomic (+ read helpers)
├── shipped-defaults-service.ts    # NEW — I/O applier: seed/upgrade/restore/reset + version marker
├── composition-root.ts            # EDIT — bind ShippedDefaults record + ShippedDefaultsService
└── main.ts                        # EDIT — startup seed(firstRun) / upgrade(else) via the service

scripts/
└── generate-shipped-defaults.mjs  # NEW — build-time JSON materialisation of the record

packages/core/tests/unit/          # NEW — pure logic (plans, fill, reset, reservation, fidelity)
packages/ui/tests/integration/     # NEW — service against a real FileConfigStore (temp root)
packages/*/tests/contract/         # NEW — record fidelity as a contract check
```

**Structure Decision**: pure logic in `@throng/core` (`config/shipped-defaults.ts`), I/O in
`packages/ui/src/main` (`shipped-defaults-service.ts` + `FileConfigStore` transactional write),
build-time materialisation in `scripts/`. This mirrors the existing 003/007 split (pure schema in core,
`FileConfigStore` for I/O) and keeps the record generated-from-definitions.

## Complexity Tracking

> No Constitution violations. Section intentionally empty.
