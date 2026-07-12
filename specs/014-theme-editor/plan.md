# Implementation Plan: Theme Editor — Restore & Create Controls

**Branch**: `014-theme-editor` | **Date**: 2026-07-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/014-theme-editor/spec.md`

## Summary

Add the Themes-editor UI controls that complete the restore and creation flows on top of feature
010's already-shipped restore API and feature 007's existing editor. Four control groups:

1. **Restore All Themes to Default** — wire the editor's restore action to feature 010's real
   `ShippedDefaultsService.restoreAllThemes()` (reset every edited built-in to shipped values +
   recreate deleted built-ins, custom themes untouched, whole-operation atomic), **replacing** the
   current weak `config-store.restoreDefaultThemes()` (create-if-missing only). Guarded by a
   confirmation dialog because it is destructive to the user's built-in edits.
2. **Per-theme restore & recreate** — restore a single built-in to shipped values (confirmed, because
   destructive to that theme's edits), and **recreate** a deleted built-in from a "deleted/restorable"
   row (purely additive, no confirmation). Backed by a new single-theme operation added to the 010
   service that reuses the shipped record + atomic write.
3. **Clone-only creation + modal name dialog** — the sole way to create a custom theme is **Clone**
   (duplicate the selected theme) which opens a modal name dialog prefilled `"<source> - Clone"` with
   "Clone" pre-selected; the **same** dialog replaces feature 007's in-place rename. Both enforce
   feature 010's reserved built-in-name set (including deleted built-ins) and reject empty/duplicate
   names. No "New Theme", no "Save As" (edits apply live).
4. **Themeable icon controls + completeness** — every new action control (Restore All, per-theme
   restore, recreate, Clone) is a themeable icon carrying a hover title (constitution v3.12.0); only
   the dialog decision buttons and the name field are text. Every shipped theme token (incl. feature
   009's `editorGutterBg`/`editorGutterFg` and the `dismiss` icon) stays exposed, backed by the
   existing completeness test.

**Technical approach**: pure decision logic — theme classification (built-in / custom /
deleted-restorable) and name validation against the reserved set + every present theme — lives in
`@throng/core` (`config/theme-editor-model.ts`), unit-tested there (the repo has no renderer
component-test project; renderer logic is extracted to core and covered by unit + E2E). The single
missing **single-theme restore** operation is added to feature 010's `ShippedDefaultsService`
(`restoreTheme(name)`), delegating to the existing shipped record and `FileConfigStore.writeFilesAtomic`
— it does **not** re-implement the record or the atomicity (FR-011). Two new IPC channels
(`throng:config:restoreAllThemes`, `throng:config:restoreTheme`) expose the service to the renderer via
the preload bridge. The renderer keeps the Themes tab's `<select>` theme picker and adds ONE set of
action icons beside it acting on the SELECTED theme (a deleted built-in stays in the dropdown marked "(deleted)" and is recreated from there). It adds a reusable themeable
`IconButton` (generalising the existing `DismissButton`), and adds a modal `NameDialog` (Clone/rename)
and `ConfirmDialog` (Restore All / per-theme restore) modelled on the existing `CaptureModal` overlay.

## Technical Context

**Language/Version**: TypeScript 5.9 (ESM, `"type":"module"`), Node >= 20, Electron 43. Renderer is
React 18.3 (`.tsx`, function components + hooks).

**Primary Dependencies**: none new. Reuses feature 010 (`@throng/core`
`config/shipped-defaults.ts` — `isReservedThemeName`, `reservedThemeNames`, `buildShippedDefaults`; UI-main
`ShippedDefaultsService` — `restoreAllThemes`, and `FileConfigStore.writeFilesAtomic`); feature 007 editor
(`packages/ui/src/renderer/preferences/*` — `themes-tab.tsx`, `pickers.tsx`, `icon-section.tsx`,
`apply-client.ts`); `THEME_METADATA` / `theme-metadata.ts` (completeness); `THRONG_THEME.icons` (icon tokens);
InversifyJS composition root; the preload bridge `window.throng.config.*` + `config-write-ipc.ts`.

**Storage**: user-writable JSON config under `%USERPROFILE%\.throng` (`configRoot`, overridable via
`THRONG_CONFIG_ROOT`): `themes/<name>.json` per theme. Restores go through feature 010's atomic
multi-file write. This feature adds **no** new persisted file.

**Testing**: Vitest projects — `unit` (pure core: list classification, name validation), `integration`
(the new `restoreTheme` service method + the two IPC handlers against a real `FileConfigStore` over a temp
`configRoot`), `contract` (preload/IPC surface + service method contract). **Playwright E2E** is mandatory
(this feature is a user-facing UI change, Principle V): extend `packages/ui/tests/e2e/preferences-themes.e2e.ts`.

**Target Platform**: Windows first (file-locking behaviour real and tested); OS-agnostic core.

**Project Type**: desktop-app (Electron), monorepo workspaces `packages/*`.

**Performance Goals**: restore/clone/rename are single user actions on a ≤~16-theme set; hot-apply must be
perceptibly immediate (reuse the existing debounced write + watcher rebroadcast). No throughput concern.

**Constraints**: Restore All is all-or-nothing with rollback (delegated to 010); per-theme restore rewrites
exactly one file; recreate is additive/idempotent; a custom theme may never occupy a reserved built-in name
(including a deleted built-in); every action control is a themeable icon with a hover title.

**Scale/Scope**: ~15 built-in themes + user customs; one preferences Themes tab; ~4 new action controls, 2
new IPC channels, 1 new service method, 2 new pure core helpers, 2–3 new renderer components.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design. Worktree constitution v3.12.0.*

- **I. Project-First Context Isolation** — N/A (no project/terminal/file surface). Pass.
- **II. Platform-Abstracted Core** — list classification + name validation are pure and OS-free in
  `@throng/core`; the single-theme restore I/O is in UI-main behind `ShippedDefaultsService` /
  `FileConfigStore.writeFilesAtomic`. No OS calls in renderer/core logic. Pass.
- **III. Detached/Persistent Terminals** — N/A. Pass.
- **IV. Native Terminal Support** — N/A. Pass.
- **V. Test-First Quality Discipline** — Red-Green-Refactor with unit (pure model) + integration
  (service + IPC over temp root) + contract (surface) + **E2E** (mandatory: this is a UI change). A
  locked-file per-theme-restore case is covered at the integration layer. Pass.
- **VI. Simple, Modern, Discoverable UX** — restore/clone/recreate reachable without instruction as
  titled icons; confirmation only where destructive; live hot-apply. Pass.
- **VII. Change Review & Approval** — N/A (no project edit-list surface). Pass.
- **VIII. SOLID/DRY/YAGNI** — reuses 010's record, `restoreAllThemes`, `isReservedThemeName`, and the
  atomic write; adds one narrow service method (`restoreTheme`) rather than duplicating restore logic;
  **generalises** the existing `DismissButton` into one reusable `IconButton` (DRY) instead of new bespoke
  buttons; **per-token restore is out of scope** (YAGNI — not backed by 010's API). Pass.
- **IX. Dependency Injection & Composition Root** — `ShippedDefaultsService` is already bound in the
  UI-main composition root; the IPC registrar receives it via injected `ConfigManagementDeps`, no ambient
  singletons. Pass.
- **X. Externalised Configuration** — every new control's glyph + colours come from theme icon/colour
  tokens; `configRoot` stays injected; nothing read ad hoc. Pass.
- **XI. Dockable Workspace** — N/A. Pass.
- **Configuration-editor completeness rule (v3.11.0)** — every shipped theme token stays exposed and
  editable; any icon token added for the new controls is a leaf of `THRONG_THEME.icons`, so it
  auto-registers in `THEME_METADATA`, is auto-exposed by `icon-section.tsx`, and is covered by the
  existing completeness test (`theme-metadata.test.ts`); each new token gets a `THEME_TOKEN_COPY` entry. Pass.
- **Themeable icon controls rule (v3.12.0)** — Restore All, per-theme restore, recreate, and Clone are
  themeable icons with hover titles taking icon+colours from theme tokens; the **only** text is the
  decision buttons in the ConfirmDialog and the name field/confirm button in the NameDialog (the stated
  dialog exception). This change also remediates the pre-existing text-labelled `.prefs-toolbtn` controls
  in `themes-tab.tsx` flagged at the v3.12.0 amendment. Pass.
- **Idempotent data migrations rule** — N/A (no schema migration; restore/recreate are idempotent by
  construction, inherited from 010). Pass.

**Result: PASS. No violations; Complexity Tracking not required beyond the tracked deferral below.**

> **Note (tracked, not a violation):** the worktree branched before the v3.13.0 static-analysis/linting
> gate and its ESLint config landed on `master`. This feature is rebased onto `master` before merge (per
> the 011 workflow), at which point `npm run lint` + `npm run typecheck` become active CI gates; all new
> code MUST pass both with zero errors at that point. Recorded in Complexity Tracking below.

## Project Structure

### Documentation (this feature)

```text
specs/014-theme-editor/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── themes-editor-controls.md   # IPC + service + component/model surface
├── checklists/
│   └── requirements.md  # spec quality checklist (16/16)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/core/src/config/
├── theme-editor-model.ts           # NEW — pure: classifyThemes(present, reserved) → rows
│                                   #        (built-in | custom | deleted-restorable);
│                                   #        validateThemeName(name, {reserved, existingCustom}) → ok|reason;
│                                   #        cloneName(source) → "<source> - Clone"
└── (reuses) shipped-defaults.ts (isReservedThemeName/reservedThemeNames),
             theme-metadata.ts, theme-copy.ts, theme.ts (THRONG_THEME.icons)

packages/core/src/index.ts          # EDIT — export the new pure surface

packages/ui/src/main/
├── shipped-defaults-service.ts     # EDIT — add restoreTheme(name): single-theme restore/recreate
│                                   #        (reuse shipped record + FileConfigStore.writeFilesAtomic)
├── config-write-ipc.ts             # EDIT — register throng:config:restoreAllThemes + :restoreTheme;
│                                   #        ConfigManagementDeps gains the ShippedDefaultsService ref
└── composition-root.ts             # EDIT (if needed) — pass ShippedDefaultsService into the IPC registrar

packages/ui/src/preload/preload.cts # EDIT — add config.restoreAllThemes(), config.restoreTheme(name)

packages/ui/src/renderer/common/
├── icon-button.tsx                 # NEW — reusable themeable IconButton({token,title,onClick,...})
└── dismiss-button.tsx              # EDIT — re-express in terms of IconButton (DRY; behaviour unchanged)

packages/ui/src/renderer/preferences/
├── themes-tab.tsx                  # EDIT — dropdown + one action bar (restore, recreate,
│                                   #        clone, rename-via-dialog, delete); Restore-All control;
│                                   #        deleted-restorable rows; wire new bridge calls
├── name-dialog.tsx                 # NEW — modal name entry (Clone + rename), prefill + validation
├── confirm-dialog.tsx              # NEW — modal confirm (Restore All + per-theme restore)
└── preferences.css                 # EDIT — toolbar + dialog styles (colours from theme tokens)

packages/core/src/config/theme.ts   # EDIT (only if new icon tokens needed for restore/recreate/clone)
packages/core/src/config/theme-copy.ts # EDIT (matching THEME_TOKEN_COPY entries for any new tokens)

packages/core/tests/unit/           # NEW — theme-editor-model.test.ts (classify + validate + cloneName)
packages/ui/tests/integration/      # NEW — restore-theme + restore-all/restore-theme IPC over temp root
packages/*/tests/contract/          # NEW — preload/IPC + service method contract
packages/ui/tests/e2e/preferences-themes.e2e.ts # EDIT — restore-all, per-theme restore, recreate, clone, rename
```

**Structure Decision**: pure decision logic in `@throng/core` (`config/theme-editor-model.ts`), the one
new I/O operation on 010's existing UI-main service (`restoreTheme`), IPC exposure through the existing
`config-write-ipc.ts` + preload bridge, and the controls in the existing preferences renderer. This mirrors
the 007/010 split (pure model in core, `FileConfigStore`/service for I/O) and reuses 010's atomic write
rather than re-implementing it.

## Complexity Tracking

> No Constitution violations. One tracked, non-blocking deferral is recorded below.

| Item | Why | Resolution |
|------|-----|------------|
| Linting/type-check gate (v3.13.0) not present in this worktree | Branch predates the ESLint config + `lint`/`typecheck` scripts that landed on `master` (constitution v3.13.0) | Rebase 014 onto `master` before merge (per the 011 workflow); the CI lint + type-check gates then run on the PR and all new code must pass with zero errors. No design change required. |
