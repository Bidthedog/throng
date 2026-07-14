/**
 * Shipped defaults (feature 010). The single authoritative, immutable, versioned
 * record of what the application ships with — every built-in theme, the
 * application settings, and the key bindings — GENERATED from the existing core
 * definitions (never hand-copied), so a change to a theme/setting/binding
 * definition (e.g. feature 009's palette rewrites + new gutter tokens) flows
 * through automatically. Pure data + pure decision logic; no OS/DOM. The I/O that
 * applies these values atomically lives in the UI-main `ShippedDefaultsService`.
 */
import { DEFAULT_APP_SETTINGS, type AppSettings } from './app-settings.js';
import { DEFAULT_KEYBINDINGS, type Keybindings } from './keybindings.js';
import { ALL_DEFAULT_THEMES } from './default-themes/index.js';
import { THRONG_THEME, type Theme } from './theme.js';
import { setAtPath } from './metadata.js';

/**
 * Version of the shipped-defaults set. Bumped when the shape or content shipped
 * to users changes in a way that a later app version must detect (drives the
 * additive upgrade migration in `ShippedDefaultsService.upgrade`).
 */
// Bumped by 015: four icon tokens entered the record (editJson, editVisual, moveUp, moveDown).
// The additive upgrade is gated on this version, so without the bump an existing install's theme
// files would never materialise them — the on-disk record silently drifting from the shipped one,
// which is the exact drift SC-009 exists to end.
//
// Bumped by 016 (2 → 3): ~150 new shipped theme colour values (10 syntax tokens + 3 editor
// status-strip tokens, across every bundled theme) and the platform-keyed keybinding record. The
// bump is required by the THEME tokens alone, whatever shape the bindings take: without it an
// existing install never materialises them and code renders unstyled.
//
// Bumped by 018 (3 → 4): ten colour tokens (the split surface roles, the scrollbar trio,
// `accentText` and the optional icon colour), the error-notice pair (`errorSurface`/`errorText`),
// the two size tokens, the typography roles, and five icon tokens (settings + the four window
// controls).
//
// This bump is NOT bookkeeping — it is the difference between the feature working and shipping a
// visible defect to every existing user. A fresh install seeds its theme files from the shipped
// record, so it gets the new tokens and every test passes. An EXISTING install already has
// `themes/Light.json` on disk, and the config reader merges it shallowly: without the bump the
// additive upgrade never runs, the new tokens never materialise, and `toCssVariables` falls through
// to throng's DARK defaults for them. A Light-theme user would get a near-black scrollbar trough
// with a navy thumb on every scrollable surface — and no fresh-install E2E could ever see it,
// because every test run starts from an empty config root.
//
// It is also why 018 could NOT simply inherit 016's `3`. Both features were written against a
// record at 2 and both, independently, called their own bump "3". Rebased, that collides: an
// install that has already run 016 holds `3` on disk, the gate is `applied !== shipped`, and 018's
// tokens would be silently skipped for exactly the users who already had the app — the population
// no fresh-install test can see. The version is a sequence, not a label.
//
// The split tokens are saved by their FR-008 parent chain; `scrollbarTrack`, `scrollbarThumb`,
// `accentText` has no parent, so nothing else would catch this.
export const SHIPPED_DEFAULTS_VERSION = 4;

/** The authoritative shipped-defaults record (immutable/frozen once built). */
export interface ShippedDefaults {
  readonly version: number;
  /** Built-in themes keyed by name (includes `throng`, carrying its default icon pack). */
  readonly themes: Readonly<Record<string, Theme>>;
  readonly settings: AppSettings;
  readonly keybindings: Keybindings;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Assemble the frozen authoritative record from the live definitions. The
 * `throng` theme is wrapped with `iconPack: 'throng'` so a seeded/restored
 * `throng` selects the bundled glyph pack out of the box (matching prior startup
 * behaviour) WITHOUT editing `theme.ts`. Returns a fresh, deep-frozen object each
 * call (repeated calls deep-equal).
 */
export function buildShippedDefaults(): ShippedDefaults {
  const themes: Record<string, Theme> = {};
  for (const [name, theme] of Object.entries(ALL_DEFAULT_THEMES)) {
    themes[name] = clone(theme);
  }
  // throng carries its bundled icon pack in the shipped record.
  themes[THRONG_THEME.name] = { ...clone(THRONG_THEME), iconPack: 'throng' };
  return deepFreeze({
    version: SHIPPED_DEFAULTS_VERSION,
    themes,
    settings: clone(DEFAULT_APP_SETTINGS),
    keybindings: clone(DEFAULT_KEYBINDINGS),
  });
}

/** Serialise the record to the on-disk JSON form (build-time materialisation). */
export function serializeShippedDefaults(d: ShippedDefaults = buildShippedDefaults()): string {
  return `${JSON.stringify(d, null, 2)}\n`;
}

/**
 * Reserved (built-in) theme names — the durable memory of which built-ins exist,
 * derived from the record and independent of what is currently present in the
 * user's configuration (so a deleted built-in's name stays reserved). Feature
 * `014-theme-editor` enforces the reservation at theme creation.
 */
export function reservedThemeNames(d: ShippedDefaults = buildShippedDefaults()): string[] {
  return Object.keys(d.themes);
}

/** True iff `name` is a built-in (reserved) theme name. */
export function isReservedThemeName(name: string, d: ShippedDefaults = buildShippedDefaults()): boolean {
  return Object.prototype.hasOwnProperty.call(d.themes, name);
}

/**
 * Resolve a dotted path against OWN properties only. Plain bracket access resolves keys
 * inherited from `Object.prototype` — so `__proto__`, `constructor` and `toString` would
 * otherwise look like real configuration carrying real shipped defaults, and a reset of
 * `constructor` would sail past the "no shipped default" guard and then throw deep inside the
 * write path. The IPC layer accepts an arbitrary string, so the guard belongs here (015).
 */
export function ownAtPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * Reset one action to its shipped binding tokens, leaving every other action
 * untouched. Returns a fresh Keybindings, or `null` when the action has no
 * shipped default (FR-009/016). `current` is never mutated.
 */
export function resetBindingValue(
  current: Keybindings,
  action: string,
  d: ShippedDefaults = buildShippedDefaults(),
): Keybindings | null {
  if (!Object.prototype.hasOwnProperty.call(d.keybindings.bindings, action)) return null;
  const shipped = d.keybindings.bindings[action];
  if (shipped === undefined) return null;
  return {
    version: current.version,
    bindings: { ...current.bindings, [action]: [...shipped] },
  };
}

/**
 * Reset one setting leaf (addressed by its full dotted path) to its shipped
 * value, leaving every sibling untouched. Returns a fresh AppSettings, or `null`
 * when the path has no shipped default (FR-010/011/016). `current` is never
 * mutated.
 */
export function resetSettingValue(
  current: AppSettings,
  path: string,
  d: ShippedDefaults = buildShippedDefaults(),
): AppSettings | null {
  const shipped = ownAtPath(d.settings, path);
  if (shipped === undefined) return null;
  return setAtPath(current, path, clone(shipped));
}

/**
 * Deep copy of `user` with keys ABSENT from `user` filled from `source`; a key
 * present in `user` is never overwritten. Recurses into plain-object maps
 * (colours, icons, fonts, typography, ...) so a newly-added nested property is
 * materialised while existing values stay put (FR-015a additive fill).
 */
export function fillMissingThemeProps(user: Theme, source: Theme): Theme {
  return fillMissing(user, source) as Theme;
}

function fillMissing(user: unknown, source: unknown): unknown {
  if (!isPlainObject(user) || !isPlainObject(source)) return clone(user);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(user)) result[k] = clone(v);
  for (const [k, sv] of Object.entries(source)) {
    if (!(k in user)) {
      result[k] = clone(sv);
    } else if (isPlainObject(user[k]) && isPlainObject(sv)) {
      result[k] = fillMissing(user[k], sv);
    }
    // else: keep the user's existing value (already cloned above).
  }
  return result;
}

export interface ThemeUpgradePlan {
  /** Reserved (built-in) themes absent from the user's config — to be created. */
  addThemes: Array<{ name: string; theme: Theme }>;
  /** Present themes whose deep-fill differs from their current form — to be rewritten. */
  fillThemes: Array<{ name: string; theme: Theme }>;
}

/**
 * Additive upgrade plan (FR-015a): reserved themes to create + present themes
 * needing a property fill. A present built-in fills from its shipped value; a
 * present custom theme (no shipped counterpart) fills from the base `throng`
 * default. An already-complete configuration yields empty lists (idempotence).
 */
export function planThemeUpgrade(args: {
  shipped: ShippedDefaults;
  present: Record<string, Theme>;
  throngBase: Theme;
}): ThemeUpgradePlan {
  const { shipped, present, throngBase } = args;
  const addThemes: ThemeUpgradePlan['addThemes'] = [];
  for (const name of reservedThemeNames(shipped)) {
    if (!(name in present)) addThemes.push({ name, theme: clone(shipped.themes[name]) });
  }
  const fillThemes: ThemeUpgradePlan['fillThemes'] = [];
  for (const [name, theme] of Object.entries(present)) {
    const source = isReservedThemeName(name, shipped) ? shipped.themes[name] : throngBase;
    const filled = fillMissingThemeProps(theme, source);
    if (JSON.stringify(filled) !== JSON.stringify(theme)) fillThemes.push({ name, theme: filled });
  }
  return { addThemes, fillThemes };
}
