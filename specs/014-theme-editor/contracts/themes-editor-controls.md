# Contract: Themes Editor Controls (feature 014)

The surfaces feature 014 adds on top of feature 010's API and feature 007's editor. Three layers: pure
core model, a new UI-main service method + two IPC channels, and the renderer control contracts.

## Core (pure, `@throng/core`) — `packages/core/src/config/theme-editor-model.ts`

```ts
export type ThemeRowKind = 'built-in' | 'custom';

export interface ThemeRow {
  readonly name: string;
  readonly kind: ThemeRowKind;
}

/** Entries for the Themes-tab picker: the PRESENT themes only (a deleted built-in is not listed). */
export function classifyThemes(present: string[], reserved: string[]): ThemeRow[];

export interface ThemeNameValidation {
  ok: boolean;
  reason?: 'empty' | 'reserved' | 'duplicate';
}

/**
 * Validate a proposed Clone/rename name against the reserved built-in set and EVERY present theme.
 * Comparison is CASE-INSENSITIVE (FR-007a): a name becomes a file name, and `Throng.json` IS
 * `throng.json` on Windows, so a case-only difference would overwrite a built-in.
 */
export function validateThemeName(
  name: string,
  ctx: { reserved: string[]; existing: string[]; renamingFrom?: string },
): ThemeNameValidation;

/** Default Clone name: `${source} - Clone`. */
export function cloneName(source: string): string;
```

### Contract guarantees (core)

- `classifyThemes` is pure and stable: present names keep their input order and are tagged `built-in`
  iff `reserved.includes(name)`, else `custom`. A reserved name **absent** from `present` (a deleted
  built-in) yields **no entry at all** (FR-005a). No duplicates; deterministic across calls.
- `validateThemeName` trims first; precedence is `empty` → `reserved` → `duplicate` → `ok`. When
  `renamingFrom` is supplied, that name is excluded from the duplicate check (renaming a theme to its
  own name is allowed / a no-op). It never mutates its inputs.
- `cloneName(s)` === `` `${s} - Clone` ``.

## UI main — `ShippedDefaultsService` (edit, `packages/ui/src/main/shipped-defaults-service.ts`)

```ts
// existing: restoreAllThemes(): Promise<RestoreResult>
restoreTheme(name: string): Promise<RestoreResult>;   // NEW (014)
```

### Contract guarantees (service)

- `restoreTheme(name)` writes exactly one file, `themes/<name>.json`, with the shipped value
  `shipped.themes[name]`, via `FileConfigStore.writeFilesAtomic` — overwriting an edited built-in or
  **recreating** a deleted one, touching no other theme.
- If `name` is not a reserved built-in → returns `{ ok:false, failedPath:'', error:'not-reserved' }` and
  writes nothing.
- On a locked/unwritable file → `{ ok:false, failedPath:'themes/<name>.json', error }`, and the file is
  left byte-for-byte as before (atomic single-file write).
- Idempotent: calling it twice for the same present-and-shipped theme leaves the file unchanged the
  second time; recreating an already-recreated theme is a no-op-equivalent (same shipped bytes).
- It does **not** touch the applied-version marker and does **not** re-implement the shipped record or
  the atomic primitive (both owned by 010, FR-011).

## IPC channels (main handlers in `config-write-ipc.ts`, exposed via preload)

| Channel | Args | Returns | Handler |
|---------|------|---------|---------|
| `throng:config:restoreAllThemes` | — | `RestoreResult` | `ShippedDefaultsService.restoreAllThemes()` |
| `throng:config:restoreTheme` | `name: string` | `RestoreResult` | `ShippedDefaultsService.restoreTheme(name)` |

- Registered in `registerConfigManagementIpc(deps)`; `ConfigManagementDeps` gains a
  `shippedDefaults: ShippedDefaultsService` field, injected from the UI-main composition root (Principle
  IX). No new ambient state.
- The renderer's Restore All control **no longer** calls `throng:config:restoreDefaultThemes`
  (create-if-missing); that channel/store method is left only for any other existing caller.

### Preload bridge (edit, `packages/ui/src/preload/preload.cts`, `window.throng.config`)

```ts
restoreAllThemes(): Promise<RestoreResult>;          // → throng:config:restoreAllThemes
restoreTheme(name: string): Promise<RestoreResult>;  // → throng:config:restoreTheme
```

## Renderer control contracts (Themes tab + dialogs)

Stable `data-testid`s for E2E (extend `preferences-themes.e2e.ts`):

The picker is a **dropdown** plus **one** set of action icons acting on the currently selected theme
(FR-012), so the action test-ids carry no per-theme suffix.

> Note: `theme-row-<tokenKey>` is feature 007's id for the token-editing rows *below* the picker —
> not a theme row. The theme picker itself is `theme-select`.

| testid | Control | Behaviour |
|--------|---------|-----------|
| `theme-select` | The theme dropdown | One `<option>` per PRESENT theme (a deleted built-in is not listed — FR-005a). Selecting one **activates** it; the value follows the ACTIVE theme, never racing ahead of activation. |
| `theme-restore-all` | Restore All (themeable `restoreAll` icon — distinct from the per-theme restore — hover title; separated from the selection-scoped controls) | Opens `ConfirmDialog`; on confirm calls `config.restoreAllThemes()` and hot-applies. It is also the **only** way to bring back a deleted built-in. |
| `theme-restore` | Restore the selected built-in (themeable `retry` icon) | Shown only for a present built-in. Opens `ConfirmDialog`; on confirm calls `config.restoreTheme(selected)`. |
| `theme-clone` | Clone the selected theme (themeable `add` icon) | Opens `NameDialog` prefilled `cloneName(selected)` with "Clone" pre-selected. |
| `theme-rename` | Rename the selected theme (themeable `rename` icon) | Shown only for a custom theme. Opens `NameDialog` prefilled with the current name. |
| `theme-delete` | Delete the selected theme (themeable `destroy` icon) | Opens `ConfirmDialog` (`theme-delete-confirm`). |
| `theme-name-dialog` | The modal name dialog | `role="dialog"`; input `theme-name-input`; error `theme-name-error`; text-labelled `theme-name-confirm` / `theme-name-cancel` (confirm disabled while invalid). |
| `theme-confirm-dialog` | The modal confirm dialog | `role="dialog"`; text-labelled decision buttons `theme-confirm-yes` / `theme-confirm-no`; colours from theme tokens. |
| `theme-notice-error` | **Failure** feedback only | A success raises **no** banner (FR-003/SC-007). Carries a themeable dismiss icon (`theme-notice-dismiss`). |

Themeable-icon rule (v3.12.0): every control above except dialog decision buttons and the name field is
an `IconButton` whose glyph resolves through the theme's icon tokens and whose colours derive from theme
colour tokens (no hardcoded CSS colour, no inline SVG).
