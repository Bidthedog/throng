# Contract: Shipped Defaults API

The non-UI API that `014-theme-editor` and `015-preferences-and-settings` build their controls on.
Two layers: pure core functions (deterministic, no I/O) and a UI-main service (I/O + atomicity).

## Core (pure, `@throng/core`) — `packages/core/src/config/shipped-defaults.ts`

```ts
export const SHIPPED_DEFAULTS_VERSION: number; // starts at 1

export interface ShippedDefaults {
  readonly version: number;
  readonly themes: Readonly<Record<string, Theme>>; // includes 'throng' (iconPack:'throng')
  readonly settings: AppSettings;
  readonly keybindings: Keybindings;
}

/** Assemble the frozen authoritative record from the live core definitions. */
export function buildShippedDefaults(): ShippedDefaults;

/** Reserved (built-in) theme names — Object.keys(record.themes). */
export function reservedThemeNames(d?: ShippedDefaults): string[];
export function isReservedThemeName(name: string, d?: ShippedDefaults): boolean;

/** Reset one action to its shipped binding(s). Returns null if the action has no shipped default. */
export function resetBindingValue(
  current: Keybindings, action: string, d?: ShippedDefaults,
): Keybindings | null;

/** Reset one setting leaf (dotted path) to its shipped value. Null if the path has no shipped default. */
export function resetSettingValue(
  current: AppSettings, path: string, d?: ShippedDefaults,
): AppSettings | null;

/** Deep copy of `user` with keys ABSENT from `user` filled from `source`; present keys untouched. */
export function fillMissingThemeProps(user: Theme, source: Theme): Theme;

export interface ThemeUpgradePlan {
  addThemes: Array<{ name: string; theme: Theme }>;
  fillThemes: Array<{ name: string; theme: Theme }>;
}
/** Additive upgrade plan: reserved themes to create + present themes needing a property fill. */
export function planThemeUpgrade(args: {
  shipped: ShippedDefaults;
  present: Record<string, Theme>;
  throngBase: Theme; // = shipped.themes['throng']
}): ThemeUpgradePlan;
```

### Contract guarantees (core)

- `buildShippedDefaults()` is **pure and frozen**: repeated calls deep-equal; the returned object and
  its nested maps are frozen (mutating throws in strict mode / is a no-op).
- **Fidelity**: `.themes` deep-equals `{ ...ALL_DEFAULT_THEMES, throng: { ...THRONG_THEME, iconPack:'throng' } }`;
  `.settings` deep-equals `DEFAULT_APP_SETTINGS`; `.keybindings` deep-equals `DEFAULT_KEYBINDINGS`.
- `resetBindingValue` / `resetSettingValue` change **only** the named action / leaf; a returned object
  is a fresh value (no mutation of `current`); unknown action/path ⇒ `null`.
- `fillMissingThemeProps` **never** changes a value present in `user`; it only adds absent keys, deeply,
  for map-valued fields (`colours`, `icons`, `fonts.weights`, `typography`, `iconOverrides`).
- `planThemeUpgrade` lists a reserved theme in `addThemes` iff absent from `present`, and a present
  theme in `fillThemes` iff its deep-fill differs from its current form (so an already-complete config
  yields empty lists — idempotence).

## UI main — `packages/ui/src/main/shipped-defaults-service.ts`

```ts
export interface RestoreOk { ok: true; }
export interface RestoreFail { ok: false; failedPath: string; error: string; }
export type RestoreResult = RestoreOk | RestoreFail;

export interface UpgradeOk { ok: true; added: string[]; filled: string[]; }
export type UpgradeResult = UpgradeOk | RestoreFail;

export interface ResetOne { ok: boolean; reason?: 'no-default'; }

export class ShippedDefaultsService {
  constructor(store: FileConfigStore, shipped: ShippedDefaults);

  seed(): Promise<RestoreResult>;              // FR-015 first run
  upgrade(): Promise<UpgradeResult>;           // FR-015a additive, gated on version marker
  restoreAllThemes(): Promise<RestoreResult>;  // FR-008
  resetBinding(action: string): Promise<ResetOne>;   // FR-009
  resetSetting(path: string): Promise<ResetOne>;     // FR-010/011
  resetEverything(): Promise<RestoreResult>;   // FR-015
  readAppliedVersion(): Promise<number | null>;
}
```

### Contract guarantees (service)

- **restoreAllThemes** writes every reserved theme (overwriting an edited built-in, recreating a
  deleted one) and touches **no** custom theme; whole-operation atomic — on any write failure the
  previous configuration is left byte-for-byte intact and `failedPath` names the offending file
  (FR-008/012/012a).
- **resetBinding / resetSetting** rewrite exactly one document, changing only the one action / leaf;
  an unknown action/path returns `{ ok:false, reason:'no-default' }` and writes nothing (FR-016).
- **seed** produces a configuration byte-equal to the shipped artifacts and writes the version marker
  (FR-015). **resetEverything** likewise restores settings + keybindings + all reserved themes from the
  record.
- **upgrade** performs only the two additive operations; it never changes an existing user value on any
  theme; running it twice changes nothing on the second run; it records the current version
  (FR-013/014/015a).

## Transactional write — `FileConfigStore` (edit)

```ts
export interface WriteAllOk { ok: true; }
export interface WriteAllFail { ok: false; failedPath: string; error: string; }
export type WriteAllResult = WriteAllOk | WriteAllFail;

writeFilesAtomic(files: Array<{ path: string; content: string }>): Promise<WriteAllResult>;
```

- Snapshot → stage temps → commit renames → rollback committed writes on first failure (research D4).
- Guarantee: either every file ends at its new content, or every file is exactly as before, and on
  failure `failedPath` is the path that could not be written.

## Downstream consumers (out of scope here; named for design intent — FR-017)

- `014-theme-editor` → `ShippedDefaultsService.restoreAllThemes()` for "Restore All Themes to Default",
  and `isReservedThemeName` / `reservedThemeNames` to (a) render built-in vs custom and (b) enforce the
  Save-As name reservation.
- `015-preferences-and-settings` → `ShippedDefaultsService.resetBinding(action)` and
  `resetSetting(path)` for per-binding / per-setting reset controls.
