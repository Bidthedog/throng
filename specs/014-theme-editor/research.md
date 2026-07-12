# Phase 0 Research: Theme Editor — Restore & Create Controls

All NEEDS CLARIFICATION items were resolved in the spec across two `/speckit-clarify` sessions
(2026-07-11). This document records the design decisions that translate those clarifications into an
implementation, grounded in the actual codebase in this worktree.

## D1 — Wire "Restore All" to the real 010 service (not the weak store path)

**Decision**: Route the editor's Restore All to feature 010's
`ShippedDefaultsService.restoreAllThemes()` via a new IPC channel, and stop using
`FileConfigStore.restoreDefaultThemes()` for the button.

**Rationale**: `restoreAllThemes()` (010, FR-008) resets every edited built-in back to shipped values
**and** recreates deleted built-ins, atomically, leaving customs untouched — exactly the spec's US1.
The existing `config-store.ts` `restoreDefaultThemes()` is **create-if-missing only**: it never
overwrites an edited built-in back to shipped values, which is the precise "doesn't fully work" gap
issue #35 names. The service already exists and is DI-bound; it is simply not reachable from the
renderer.

**Alternatives considered**: (a) fix `restoreDefaultThemes()` in the store to overwrite — rejected: it
would duplicate 010's restore logic (FR-011 forbids re-implementing it) and bypass the atomic write; (b)
keep both — rejected: two restore paths with different semantics is a defect surface. The weak store
method is left in place only if other callers exist; the button no longer uses it.

## D2 — Add a single-theme restore operation to the 010 service (`restoreTheme(name)`)

**Decision**: Extend `ShippedDefaultsService` with `restoreTheme(name): Promise<RestoreResult>` that
writes the one reserved theme's shipped value (`shipped.themes[name]`) via
`FileConfigStore.writeFilesAtomic([...])` — overwriting an edited built-in or recreating a deleted one,
touching no other theme. It returns `{ ok:false, failedPath }` on a locked/unwritable file and
`{ ok:false, error:'not-reserved' }` for a non-built-in name.

**Rationale**: The spec requires per-theme restore (FR-005) and single-theme recreate (FR-005a), but
010 shipped only `restoreAllThemes` / `resetEverything` — there is **no** single-theme theme restore on
the service, and the record + atomic write it needs already live in 010. Adding one narrow method that
delegates to those primitives is "building a control on top" (FR-011), not re-implementing the record or
atomicity. It keeps I/O in UI-main (Principle II) and reuses the tested atomic write (Principle VIII/DRY).

**Alternatives considered**: (a) do single-theme reset in the renderer via `@throng/core`
`resetCurrentTheme(name)` (today's path for the reset-current control) — rejected: that computes from a
core reset helper and writes through the ordinary config write, not the atomic all-or-nothing primitive,
and would not recreate a *deleted* built-in; (b) a pure-core `planSingleThemeRestore` — unnecessary
indirection (YAGNI): the shipped value is simply `shipped.themes[name]`, so the operation is pure I/O.

## D3 — Theme picker: a dropdown + one action bar (REVISED 2026-07-12)

**Decision (current)**: Keep the Themes tab's single `<select data-testid="theme-select">` **dropdown**,
and put **one set of action icons beside it that act on the currently selected theme** (Restore, Clone,
Rename, Delete), then a **separator** and **Restore All**, which acts on every built-in rather than the
selection and therefore carries its **own icon token** (`restoreAll`, not `retry`).

A **deleted built-in is simply not listed** — it is recovered only by Restore All, so there is no
per-theme recreate control and no `(deleted)` entry. Its name nonetheless stays reserved (FR-007).

Actions raise **no success banner** — a restore/clone/rename is immediately visible in the editor below,
so announcing it is noise. Failures are always surfaced (SC-007).

**Rationale**: a per-theme row list (the original decision, below) worked but consumed far too much
vertical space above the token editor. A dropdown carries the same information in one line.

**Critical detail**: the dropdown's value is bound to the **ACTIVE** theme, not to the click. Activation
round-trips through the config watcher, and the token editor below edits the *active* theme — a dropdown
that jumped ahead of activation would display "Matrix" while the controls beneath it were still showing
and editing the previous theme. The sole exception is a parked deleted pick, which can never be active.

**Superseded decision (2026-07-11)**: replace the dropdown with a row list, one row per theme with per-row
action icons — chosen because a dropdown "cannot show a greyed deleted entry with an inline recreate
affordance". That proved false: a labelled `(deleted)` option plus a selection-scoped toolbar does it in a
fraction of the space. Reversed after UX review.

**Alternatives considered**: a separate "deleted built-ins" menu — rejected (a second surface for one rare
action).

## D4 — Classifying rows (built-in / custom / deleted-restorable)

**Decision**: A pure `classifyThemes(present: string[], reserved: string[]): ThemeRow[]` in
`@throng/core` produces the ordered rows: each present theme tagged `built-in` (name ∈ reserved) or
`custom` (otherwise), plus one `deleted-restorable` row for every reserved name **not** present.
`reserved` comes from 010's `reservedThemeNames()`; `present` from `config.listThemes()`.

**Rationale**: This is deterministic decision logic with no I/O — it belongs in core and is unit-tested
there (the repo has no renderer component-test project; §D10). It makes "which built-ins are deleted"
a tested pure function rather than ad-hoc renderer branching.

## D5 — Themeable icons for the new controls (reuse existing tokens)

**Decision**: Render every new action control through a reusable themeable `IconButton` and **reuse
existing `THRONG_THEME.icons` tokens**: `retry` for Restore All / per-theme restore / recreate (a
"reset to shipped" glyph), `add` for Clone (a create action), the existing `rename` (✎) for rename, and
`destroy` for delete. No new icon token is added.

**Rationale**: Reusing tokens satisfies the themeable-icon rule (v3.12.0) with **zero** churn to
`theme.ts`, `theme-copy.ts`, every built-in theme file, or the completeness test — the glyphs already
exist and are themeable; hover titles disambiguate same-glyph actions (Restore All vs recreate). This is
the DRY/YAGNI choice. Adding dedicated `restore`/`clone` icon tokens is a possible later enhancement
(each would follow the token → `THEME_TOKEN_COPY` → additive fill path and auto-flow through the
completeness test); it is **not** taken now.

**Reusable button**: generalise the existing `DismissButton` (hardwired to the `dismiss` token) into
`IconButton({ token, title, onClick, testId, disabled, className })`, then re-express `DismissButton` on
top of it. One themeable-icon implementation, many controls (Principle VIII).

## D6 — Modal dialogs modelled on `CaptureModal`

**Decision**: Two new renderer components, styled on the existing
`packages/ui/src/renderer/preferences/capture-modal.tsx` overlay (`role="dialog"`, `aria-modal`):
- `NameDialog` — used by **both** Clone and rename. Prefills its text field with the given value and
  **pre-selects a substring** (for Clone: the trailing word "Clone" in `"<source> - Clone"`, via the
  input's `setSelectionRange`), validates live, and has text-labelled Confirm/Cancel buttons.
- `ConfirmDialog` — used by **both** Restore All and per-theme restore; text-labelled decision buttons.

**Rationale**: `CaptureModal` is the established modal pattern; reusing its structure keeps the dialogs
consistent and avoids a new overlay primitive. Decision buttons and the name field stay text-labelled —
the constitution v3.12.0 dialog exception (their label *is* the consequence being consented to).

## D7 — Pure name validation

**Decision**: `validateThemeName(name, { reserved, existingCustom }): { ok: true } | { ok:false, reason:
'empty' | 'reserved' | 'duplicate' }` in `@throng/core`, trimming whitespace, rejecting empty, rejecting
`reserved` (built-in names incl. deleted built-ins), and rejecting a name already used by another custom
theme. Also `cloneName(source): string` → `"<source> - Clone"`.

**Rationale**: One authoritative validation used by both the Clone and rename dialogs and testable in
isolation. `reserved` is 010's `reservedThemeNames()` so a deleted built-in's name is still refused
(FR-007). The existing store-side `checkRename`/`isSafeThemeName` collision + path-safety guards remain
the last line of defence at write time; the pure helper drives the dialog's inline feedback.

## D8 — Confirmation semantics

**Decision**: Restore All → `ConfirmDialog` (FR-004). Per-theme restore-to-shipped → `ConfirmDialog`
(destructive to that built-in's edits). Recreate of a deleted built-in → **no** confirmation (purely
additive; nothing is lost). Clone/rename → the `NameDialog` (its own confirm), no separate confirmation.

**Rationale**: Directly from the two clarification sessions; confirmation is applied exactly where an
action destroys user edits and nowhere else, minimising friction.

## D9 — Completeness stays green automatically

**Decision**: 014 exposes every shipped theme token through the existing editor; it introduces no new
*configurable* theme token. Feature 009's `editorGutterBg`/`editorGutterFg` and the `dismiss` icon are
already leaves of `THRONG_THEME` and thus already in `THEME_METADATA`, already rendered by the token
groups / `icon-section.tsx`, and already asserted by `theme-metadata.test.ts`. No registry edit needed.

**Rationale**: The completeness rule (v3.11.0) is satisfied by construction; because D5 adds no icon
token, there is nothing new to register.

## D10 — Test strategy (no renderer component-test project)

**Decision**: Cover the pure model (`classifyThemes`, `validateThemeName`, `cloneName`) with **unit**
tests in `@throng/core`; cover `restoreTheme` + the two IPC handlers with **integration** tests against a
real `FileConfigStore` over a temp `configRoot` (including a locked-file per-theme-restore case and an
idempotent double-recreate); cover the preload/IPC + service surface with **contract** tests; cover the
user journeys (Restore All + confirm, per-theme restore + confirm, deleted-restorable row + recreate,
Clone prefilled name + reserved-name refusal, rename via dialog) with **Playwright E2E** by extending
`preferences-themes.e2e.ts`.

**Rationale**: The repo has no jsdom/`.test.tsx` renderer project; the established pattern is to extract
renderer decision logic into `@throng/core` pure functions (unit-tested) and verify the wired UI through
E2E — which Principle V mandates for any user-facing UI change regardless.
