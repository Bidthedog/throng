# Quickstart: Theme Editor — Restore & Create Controls

Validation guide for feature 014. Proves the restore + creation controls work end-to-end on top of
feature 010's API. For the surfaces under test see [contracts/themes-editor-controls.md](./contracts/themes-editor-controls.md)
and [data-model.md](./data-model.md).

## Prerequisites

- Node ≥ 20, repo dependencies installed (`npm install` at repo root; in this worktree run `npm install`
  once so `@throng/*` workspace links resolve — junction links, no lockfile change).
- Windows (file-locking behaviour is real and tested); OS-agnostic core runs anywhere.

## Build & test commands (repo root)

```bash
npm run test:unit          # pure core: classifyThemes / validateThemeName / cloneName
npm run test:integration   # restoreTheme + restore-all/restore-theme IPC over a temp configRoot
npm run test:contract      # preload/IPC + service method surface
npm run test:e2e           # Playwright: preferences-themes.e2e.ts (runs a build first)
npm test                   # full suite in order (unit → integration → contract → e2e), fail-fast
```

> After rebasing onto `master` (before merge), also run `npm run lint` and `npm run typecheck` — both
> MUST report zero errors (constitution v3.13.0). They are not present in this worktree yet (see plan
> Complexity Tracking).

## Scenario 1 — Restore All (US1)

1. Launch the app; open Preferences → **Themes** (via the title-bar cog).
2. Edit two built-in themes (change a colour token) and **delete** a third built-in.
3. Create one custom theme (Clone, scenario 3) and edit a token in it.
4. Click **Restore All** (`theme-restore-all`) → confirm in `theme-confirm-dialog`.
5. **Expected**: every built-in returns to its shipped values; the deleted built-in reappears; the custom
   theme is unchanged; the active theme hot-applies; a success message shows.
   - Covered by E2E asserting on-disk `themes/*.json` match shipped values and the custom file is byte-unchanged.

## Scenario 2 — Locked-file atomicity (US1 / SC-002)

1. With built-ins edited, make one theme file unwritable (lock it), then invoke Restore All + confirm.
2. **Expected**: the operation fails as a whole with a clear message (`failedPath` named); **no** theme
   is partially changed. Verified at the integration layer against a temp `configRoot`.

## Scenario 3 — Create via Clone + reserved-name refusal (US3)

1. Select a theme close to what you want in the `theme-select` dropdown; click **Clone** (`theme-clone`).
2. **Expected**: `theme-name-dialog` opens, field prefilled `"<source> - Clone"` with the word **Clone**
   pre-selected; type a name and Confirm → a new **custom** theme (a copy of the source) appears and is
   editable with the existing pickers.
3. Clone again and try to name it after a built-in (including a **deleted** built-in), or leave it blank,
   or reuse another custom's name → **Expected**: the name is refused inline (`reserved` / `empty` /
   `duplicate`) and no theme is created.

## Scenario 4 — Per-theme restore; a deleted built-in leaves the list (US2)

1. Edit two built-in themes; select one in `theme-select` and click **Restore** (`theme-restore`) → confirm.
   **Expected**: only that theme returns to shipped values; the other built-in's edits and all customs are
   untouched. **No success banner appears** — the change is visible in the editor itself.
2. Delete a built-in → **Expected**: it **disappears from the `theme-select` dropdown entirely** (there is
   no per-theme recreate control). Invoke **Restore All** (`theme-restore-all`) → confirm →
   **Expected**: it reappears at its shipped values. Restore All is the only way back.
3. Visually: **Restore All** sits apart from the selection-scoped actions (behind a separator) and uses a
   different icon from the per-theme Restore.

## Scenario 5 — Rename via the modal dialog (US3)

1. Select a custom theme and click **Rename** (`theme-rename`) → `theme-name-dialog` prefilled with the
   current name.
2. Confirm a new valid name → the theme is renamed; a reserved/duplicate/empty name is refused inline.
   (Feature 007's in-place rename field is gone; this dialog replaces it.)

## Scenario 6 — Completeness & theming (SC-005 / SC-006)

1. `npm run test:unit` includes `theme-metadata.test.ts` — every shipped theme token (incl. feature 009's
   `editorGutterBg`/`editorGutterFg` and the `dismiss` icon) has a descriptor and is exposed/editable.
2. Visually confirm every new action control is a themeable icon with a hover title, legible on multiple
   bundled themes; only the dialog decision buttons and the name field are text.

## Expected outcomes (map to Success Criteria)

| Scenario | Success Criteria |
|----------|------------------|
| 1 | SC-001, SC-007 |
| 2 | SC-002 |
| 3 | SC-004 |
| 4 | SC-003 |
| 5 | (US3 rename) |
| 6 | SC-005, SC-006 |

## Scenario 7 — Each preferences tab keeps its own scroll position (FR-013)

1. Open Preferences → **Settings** and scroll well down the list.
2. Switch to **Themes** → **Expected**: it starts at *its own* top, not inherited from Settings' offset.
3. Scroll Themes somewhere, switch back to **Settings** → **Expected**: Settings is exactly where you
   left it; switching back to Themes likewise restores its own offset.
   - Covered by E2E `preferences-scroll.e2e.ts`.
