# Phase 1 Data Model: Shipped Defaults

Pure types live in `@throng/core`; the I/O applier lives in UI main. No persisted schema changes to
existing documents; one new bookkeeping file is added.

## Entities

### ShippedDefaults (core, in-process record)

| Field | Type | Notes |
|-------|------|-------|
| `version` | `number` | `SHIPPED_DEFAULTS_VERSION` (starts at `1`). |
| `themes` | `Record<string, Theme>` | Keyed by theme name; includes `throng` (carrying `iconPack:'throng'`). Assembled from `ALL_DEFAULT_THEMES`. |
| `settings` | `AppSettings` | `DEFAULT_APP_SETTINGS`. |
| `keybindings` | `Keybindings` | `DEFAULT_KEYBINDINGS`. |

- Deep-frozen (immutable). Produced by `buildShippedDefaults()`; never mutated by callers.
- The set of built-in / reserved theme names is exactly `Object.keys(themes)`.

### Applied-defaults version marker (user config, new file)

- File: `<configRoot>/defaults-state.json`, shape `{ "version": number }`.
- Written on first-run seed and on upgrade; read on startup to decide whether upgrade runs.
- Absent ⇒ treat a non-first-run launch as "upgrade needed".

### Theme (existing, `@throng/core/config/theme.ts`) — unchanged

- Consumed read-only. The upgrade's deep-fill-absent operates over its `colours`, `icons`, `fonts`,
  `typography`, `iconPack`, `iconOverrides` maps, adding only absent keys.

### AppSettings / Keybindings (existing) — unchanged

- Reset-single-setting addresses a **leaf by dotted path** (via `getAtPath`/`setAtPath`).
- Reset-single-binding replaces one `bindings[action]` array.

## Pure operations (core, no I/O) — return plans/values, never touch disk

| Function | Signature (conceptual) | Purpose |
|----------|------------------------|---------|
| `buildShippedDefaults()` | `() => ShippedDefaults` | Assemble the frozen record from the definitions. |
| `reservedThemeNames(d)` | `(d) => string[]` | Built-in/reserved names (`Object.keys(d.themes)`). |
| `isReservedThemeName(name, d)` | `(name, d) => boolean` | Name-based built-in test. |
| `resetBindingValue(current, action, d)` | `(Keybindings, string, d) => Keybindings \| null` | New keybindings with `action` restored; `null` if no shipped default for `action`. |
| `resetSettingValue(current, path, d)` | `(AppSettings, string, d) => AppSettings \| null` | New settings with the leaf at `path` restored; `null` if `path` has no shipped default. |
| `fillMissingThemeProps(user, source)` | `(Theme, Theme) => Theme` | Deep copy of `user` with keys absent from `user` filled from `source`; never overwrites a present key. |
| `planThemeUpgrade(args)` | see below | Additive upgrade plan (themes to add + themes to fill). |

`planThemeUpgrade(args)` where `args = { shipped: ShippedDefaults; present: Record<string, Theme>; throngBase: Theme }` returns:

```text
{
  addThemes:  Array<{ name: string; theme: Theme }>,   // reserved names with no present theme
  fillThemes: Array<{ name: string; theme: Theme }>,   // present themes whose deep-fill differs
}
```

- For each `present[name]`: `source = shipped.themes[name]` if reserved, else `throngBase`;
  `filled = fillMissingThemeProps(present[name], source)`; include in `fillThemes` only if `filled`
  deep-differs from `present[name]`.

## I/O applier (UI main): `ShippedDefaultsService`

Constructed with a `FileConfigStore` and the `ShippedDefaults` record (both injected). Reads current
on-disk state via the store, computes plans via the core functions, and applies them through the
store's transactional `writeFilesAtomic`.

| Method | Returns | Maps to |
|--------|---------|---------|
| `seed()` | `RestoreResult` | FR-015 first-run: write settings + keybindings + all themes + marker (one txn). |
| `upgrade()` | `UpgradeResult` | FR-015a additive: add missing themes + fill missing props + marker; gated on version. |
| `restoreAllThemes()` | `RestoreResult` | FR-008: write every reserved theme (reset edited, recreate deleted); custom untouched. |
| `resetBinding(action)` | `{ ok; reason? }` | FR-009: rewrite keybindings with the one action reset; `reason:'no-default'` if unknown. |
| `resetSetting(path)` | `{ ok; reason? }` | FR-010/011: rewrite settings with the one leaf reset; `reason:'no-default'` if unknown path. |
| `resetEverything()` | `RestoreResult` | FR-015: settings + keybindings + all themes from the record (one txn). |
| `readAppliedVersion()` | `number \| null` | Read the marker. |

`RestoreResult` / `UpgradeResult` = `{ ok: true; ...counts } | { ok: false; failedPath: string; error: string }`
(the failure form is produced by a rollback in `writeFilesAtomic`). `UpgradeResult` also reports
`{ added: string[]; filled: string[] }`.

## Transactional write (UI main): `FileConfigStore.writeFilesAtomic`

`writeFilesAtomic(files: Array<{ path: string; content: string }>) => Promise<{ ok: true } | { ok: false; failedPath: string; error: string }>`

- Snapshot originals → stage temps → commit renames → rollback on first failure (research D4).
- `content` is the exact serialised document (`JSON.stringify(value, null, 2) + "\n"`, matching the
  existing `write`).

## State transitions

```text
fresh configRoot ──seed()──> settings+keybindings+15 themes + defaults-state{version:N}
existing (marker<N or absent) ──upgrade()──> +missing themes, +absent theme props, marker:=N   (idempotent)
existing (marker==N) ──> no-op on startup
any ──restoreAllThemes()──> every reserved theme == shipped; custom untouched
any ──resetBinding(a)/resetSetting(p)──> that one leaf/action == shipped; rest untouched
any ──resetEverything()──> settings+keybindings+all reserved themes == shipped
```
