/**
 * Shipped defaults (feature 010). The single authoritative, immutable, versioned
 * record of what the application ships with — every built-in theme, the
 * application settings, and the key bindings — GENERATED from the existing core
 * definitions (never hand-copied), so a change to a theme/setting/binding
 * definition (e.g. feature 009's palette rewrites + new gutter tokens) flows
 * through automatically. Pure data + pure decision logic; no OS/DOM. The I/O that
 * applies these values atomically lives in the UI-main `ShippedDefaultsService`.
 */
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type FindInFilesSettings,
} from './app-settings.js';
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
//
// Bumped by 033 (4 → 5): `**/node_modules` joined `DEFAULT_EXCLUDE_GLOBS` (FR-070).
//
// This is the first bump that is NOT about themes, and it is the same trap 015, 016 and 018 each
// recorded at this line, arriving from the settings side. First-run `seed()` writes the MATERIALISED
// settings document, so every install that has ever started the app holds the old six-glob array
// literally and `parseAppSettings` honours a present array. Changing the constant alone therefore
// reaches FRESH installs only — which is the one population every E2E in this repository can see,
// and the only one that does not need the fix (FR-070a).
//
// The bump gates {@link planSettingsUpgrade} below, which rewrites exactly one leaf and only when
// the on-disk array still equals the v4 list. The version is a sequence, not a label.
//
// Bumped by 043 (5 → 6): the six `search.inFiles.*` settings, the two `search.*InFiles` key
// bindings, and the `findInFiles` / `searchScope` icon tokens.
//
// This bump is BOTH of the traps recorded above at once, which is why it is not optional in either
// direction. On the theme side it is 015/016/018's case verbatim: an existing install already holds
// `themes/Light.json` on disk, the reader merges it shallowly, and without the bump the additive
// upgrade never runs — so the explorer's Find in Files control and the results panel's scope control
// would render as EMPTY BUTTONS for every user who had the app before this release, with no error
// anywhere (`icon-tokens-exist.test.ts` explains why an unresolved icon token fails silently). On
// the settings side it is 033's: first-run `seed()` writes the MATERIALISED settings document, so an
// existing install holds a `search` section with one key in it and no `inFiles` at all.
//
// And, as every bump above says: no fresh-install E2E can see either gap, because every test run
// starts from an empty config root. The population at risk is exactly the one no test represents.
//
// Bumped by 043 round two (6 → 7): FOUR VALUE CHANGES, and this is the first bump whose payload is
// not a token, a key or a theme that ARRIVES — it is values that already exist on disk and have to
// move. `search.inFiles.trigger` → `asYouType` (FR-074), `search.inFiles.settleMs` → 500 (FR-075),
// the three search-match colours re-derived across all fifteen bundled themes (FR-067), and the
// `icons.findInFiles` glyph (FR-065).
//
// It is also the FIRST NON-ADDITIVE THEME UPGRADE in the project. Every bump before it relied on
// `fillMissingThemeProps`, which by construction never overwrites a key the user's file already
// has. So on the additive path alone the THEME changes reach FRESH INSTALLS ONLY: the three
// search-match colours pre-date 043 and are present in every `themes/*.json` a v5 install holds, so
// `fillMissingThemeProps` finds them already there and leaves them exactly as they are. The person
// who reported the collapsing highlight pair is, by definition, an existing install, and would not
// have received the change they asked for.
//
// ══ WHAT THE FIRST DRAFT OF THIS COMMENT GOT WRONG, AND IT MATTERS FOR THE SETTINGS HALF ══
//
// It said "version 6 materialised all four of these into every `themes/*.json` and every
// `settings.json` on disk". That is false twice, and an adversarial review caught it:
//
//   1. VERSION 6 HAS NEVER SHIPPED. `master` is still at 5; 6 and 7 were both written on this
//      branch, so they reach users in the SAME RELEASE and no released install will ever hold a v6
//      marker. Every real upgrade is 5 → 7 directly.
//   2. Even on this branch, v6 materialised nothing of `search.inFiles` into an existing
//      `settings.json` — its own comment three lines above says the opposite in as many words: "an
//      existing install holds a `search` section with one key in it and no `inFiles` at all".
//
// So {@link V6_SEARCH_IN_FILES_SETTINGS} cannot match any RELEASED install, and the settings half of
// the upgrade is a no-op for every end user. That is not a defect and it is not dead code, because
// absence is not malformation: `parseAppSettings` supplies the descriptor default for a key that is
// not there, so a v5 install with no `inFiles` section simply reads `asYouType`/500 and the change
// arrives anyway, by the ordinary path.
//
// The guard is kept, narrowly, for the one population that DOES hold a v6 marker with a materialised
// `search.inFiles` section: anyone running a build of this branch from between the two bumps —
// which is the maintainer hand-testing it, and is precisely who reported these defaults. For them
// `trigger: 'run'` and `settleMs: 250` are on disk as real values, and only this rewrite moves them.
// That is a smaller and stranger justification than the one written first, and it is the true one.
//
// {@link planThemeValueUpgrade} and the `search.inFiles` half of {@link planSettingsUpgrade} carry
// it, guarded against the frozen v6 records below — a rewrite ONLY where the on-disk value is still
// byte-identical to what version 6 shipped. That guard is the whole contract, and
// `shipped-defaults-service.ts`'s `upgrade()` doc comment states it in words (043 plan D1), because
// the promise it used to make — "NEVER changing a value the user already has" — is the one thing
// this bump makes untrue.
//
// The trap is the same one recorded four times above, arriving from its third direction: 015/016/018
// as a token that appears, 033 as a settings key that appears, and now as a value that MOVES. The
// version is a sequence, not a label.
export const SHIPPED_DEFAULTS_VERSION = 7;

/**
 * `explorer.excludeGlobs` as shipped-defaults version 4 wrote it — the VS Code `files.exclude`
 * list, and the value {@link planSettingsUpgrade} guards on.
 *
 * A frozen COPY rather than a reference to `DEFAULT_EXCLUDE_GLOBS`, which has moved on: this is a
 * record of what was written to users' disks, so it must not follow the live constant. If it ever
 * did, the guard would compare the current default against itself, match every untouched install
 * forever, and rewrite nothing — a migration that is silently inert.
 */
export const V4_EXCLUDE_GLOBS: readonly string[] = Object.freeze([
  '**/.git',
  '**/.svn',
  '**/.hg',
  '**/CVS',
  '**/.DS_Store',
  '**/Thumbs.db',
]);

/** The three search-match colours one theme carried at shipped-defaults version 6. */
export interface SearchMatchColours {
  readonly searchMatch: string;
  readonly searchMatchCurrent: string;
  readonly searchMatchCurrentBorder: string;
}

/**
 * `searchMatch` / `searchMatchCurrent` / `searchMatchCurrentBorder` as shipped-defaults version 6
 * wrote them into every `themes/*.json` on disk — the values {@link planThemeValueUpgrade} guards
 * on (043 R28, plan D4 step 1).
 *
 * ══ WHY A LITERAL COPY AND NOT A DERIVATION ══
 *
 * Exactly {@link V4_EXCLUDE_GLOBS}'s reasoning, and it bites harder here because fourteen of these
 * fifteen themes are DERIVED (`default-themes/index.ts:325-327` from `code.match` / `.current` /
 * `.border`). FR-067 re-derives them. A reference — or a re-derivation at call time — would compare
 * each install's on-disk colour against the value the re-derivation had just produced, match no
 * install ever, and rewrite nothing, while every test in this repository passed: a migration that
 * plans nothing looks identical to one that had nothing to do.
 *
 * `packages/core/tests/unit/fixtures/pre-refactor-theme-colours.json` held these same values, but it
 * cannot be the record: FR-067 re-seeds it, which is the whole point of plan D4 splitting its two
 * roles. `shipped-defaults-v6-record.test.ts` proves the copy is faithful today; after the
 * re-derivation lands, its successor proves the copy and the live values now DISAGREE.
 */
export const V6_SEARCH_MATCH_COLOURS: Readonly<Record<string, SearchMatchColours>> = deepFreeze({
  throng: {
    searchMatch: '#151e2d',
    searchMatchCurrent: '#213049',
    searchMatchCurrentBorder: '#6aa3ff',
  },
  Light: {
    searchMatch: '#ebf1fd',
    searchMatchCurrent: '#d3e0fb',
    searchMatchCurrentBorder: '#2563eb',
  },
  Snake: {
    searchMatch: '#222619',
    searchMatchCurrent: '#2b311f',
    searchMatchCurrentBorder: '#8a9a5b',
  },
  Gothic: {
    searchMatch: '#2f111c',
    searchMatchCurrent: '#4f1523',
    searchMatchCurrentBorder: '#aa606f',
  },
  'Windows Terminal': {
    searchMatch: '#10181f',
    searchMatchCurrent: '#152836',
    searchMatchCurrentBorder: '#3a96dd',
  },
  Bash: {
    searchMatch: '#030e10',
    searchMatchCurrent: '#062024',
    searchMatchCurrentBorder: '#2bd4ee',
  },
  SUBNET: {
    searchMatch: '#03253e',
    searchMatchCurrent: '#06323c',
    searchMatchCurrentBorder: '#39FF14',
  },
  VSCode: {
    searchMatch: '#1b2832',
    searchMatchCurrent: '#173549',
    searchMatchCurrentBorder: '#1583cd',
  },
  'VI-VIM': {
    searchMatch: '#222622',
    searchMatchCurrent: '#293129',
    searchMatchCurrentBorder: '#5f875f',
  },
  'English Garden': {
    searchMatch: '#e1e8d4',
    searchMatchCurrent: '#cfdabd',
    searchMatchCurrentBorder: '#648237',
  },
  Matrix: {
    searchMatch: '#001104',
    searchMatchCurrent: '#00260a',
    searchMatchCurrentBorder: '#00ff41',
  },
  Cyberpunk: {
    searchMatch: '#06100e',
    searchMatchCurrent: '#0d2320',
    searchMatchCurrentBorder: '#55ead4',
  },
  Claude: {
    searchMatch: '#2b1f19',
    searchMatchCurrent: '#402921',
    searchMatchCurrentBorder: '#d97757',
  },
  Debian: {
    searchMatch: '#381723',
    searchMatchCurrent: '#5c142e',
    searchMatchCurrentBorder: '#d44477',
  },
  Ubuntu: {
    searchMatch: '#3d081e',
    searchMatchCurrent: '#52111e',
    searchMatchCurrentBorder: '#e95420',
  },
});

/** The three tokens {@link V6_SEARCH_MATCH_COLOURS} records, in one place so the guard and its test agree. */
export const SEARCH_MATCH_TOKENS: readonly (keyof SearchMatchColours)[] = Object.freeze([
  'searchMatch',
  'searchMatchCurrent',
  'searchMatchCurrentBorder',
] as const);

/**
 * `icons.findInFiles` as shipped-defaults version 6 wrote it into every theme file on disk — a
 * frozen copy for {@link V6_SEARCH_MATCH_COLOURS}' reasons (043 R28, FR-065).
 */
export const V6_FIND_IN_FILES_ICON = '⌕';

/**
 * The whole `search.inFiles` section as shipped-defaults version 6 materialised it into every
 * `settings.json` on disk — the value {@link planSettingsUpgrade} guards FR-074 and FR-075 on
 * (043 R28, plan D1).
 *
 * ══ WHY THE WHOLE SECTION AND NOT THE TWO LEAVES THAT MOVE ══
 *
 * `V4_EXCLUDE_GLOBS` guards one leaf because a six-element glob array that still equals the shipped
 * list is strong evidence nobody touched it. `trigger: 'run'` is not that: it is both the value
 * version 6 shipped and a value a user might deliberately have chosen, byte-identical either way,
 * and the document cannot tell them apart. So the guard is WIDENED rather than weakened — a user
 * who changed nothing in the section is far more likely never to have opened it, and a user who
 * changed anything keeps everything. It is a proxy, and R28 states it as one.
 *
 * A frozen COPY of `DEFAULT_APP_SETTINGS.search.inFiles` rather than a reference, for the reason
 * {@link V4_EXCLUDE_GLOBS} records: FR-074 and FR-075 move `trigger` and `settleMs` in that live
 * object, and a reference would follow them and match nothing forever.
 *
 * ══ WHY IT IS A `Pick` AND NOT `FindInFilesSettings` (043 FR-082) ══
 *
 * It used to be typed as the whole live interface, and FR-082 is what proved that wrong: adding
 * `summaryNoticeMode`/`summaryNoticeTimeoutMs` to the model made this record fail to compile, and the
 * obvious repair — add the two leaves here as well — would have been a lie about history AND a live
 * defect. Version 6 wrote SIX leaves into `settings.json`; `sameFlatSection` matches a section holding
 * EXACTLY the keys of this record, so a seventh key here would match no install that version 6 ever
 * wrote, and the guard would silently plan nothing for the one population it exists to serve.
 *
 * The `Pick` states that in the type: these six leaves, with the model's own types so a leaf whose
 * TYPE changes is still caught here, and no obligation to grow when the live shape does. A record of
 * what was written to disk is pinned to a moment, not to the current interface — which is
 * {@link V4_EXCLUDE_GLOBS}' rule arriving from a direction it did not anticipate.
 */
type V6FindInFilesLeaves = Pick<
  FindInFilesSettings,
  'openTarget' | 'trigger' | 'settleMs' | 'defaultGrouping' | 'rememberGrouping' | 'warnIrreversibleCommit'
>;

export const V6_SEARCH_IN_FILES_SETTINGS: Readonly<V6FindInFilesLeaves> = deepFreeze({
  openTarget: 'lastActive',
  trigger: 'run',
  settleMs: 250,
  defaultGrouping: 'file',
  rememberGrouping: true,
  warnIrreversibleCommit: true,
} satisfies V6FindInFilesLeaves);

/** One leaf to rewrite, addressed by its dotted path. */
export interface SettingsLeafUpgrade {
  path: string;
  value: unknown;
}

function sameStringList(value: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  return value.every((entry, i) => entry === expected[i]);
}

/**
 * True iff `value` is a plain object holding EXACTLY the keys of `expected`, each `===` to its
 * counterpart. An extra key, a missing key or a differing value all read as a customisation.
 */
function sameFlatSection(value: unknown, expected: Readonly<Record<string, unknown>>): boolean {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(expected);
  if (Object.keys(value).length !== keys.length) return false;
  return keys.every(
    (k) => Object.prototype.hasOwnProperty.call(value, k) && value[k] === expected[k],
  );
}

/**
 * The settings counterpart of {@link planThemeUpgrade} — guarded leaf rewrites, and the ONLY place
 * a settings value the user already has is allowed to move (033 FR-070a/FR-070b; 043 FR-074/FR-075).
 *
 * ══ WHY A LEAF PLAN AND NOT A DOCUMENT ══
 *
 * It is handed the RAW parsed settings JSON, not a typed `AppSettings`, and it names the leaves to
 * rewrite rather than returning a new document. Both follow from the same requirement: the caller
 * must be able to change one value and leave every other byte of the user's file as it found it. A
 * parse round-trip at startup would additionally strip any key the schema does not model — which is
 * shipped, tested behaviour for an ordinary WRITE (007 FR-023), and would be a surprise for an
 * upgrade the user never asked for.
 *
 * ══ WHAT THE `explorer.excludeGlobs` GUARD BUYS (033) ══
 *
 * FR-070b: a user who has customised the list keeps EXACTLY what they set. So the one condition is
 * deep equality with the v4 list. An explicit `[]` is a customisation (FR-022c's precedent — the
 * user chose to exclude nothing), an extra entry is a customisation, and a reordering is a
 * customisation, because none of the three is the value that was shipped.
 *
 * The guard is also what makes this idempotent: after the rewrite the array equals the v5 list,
 * which does not equal the v4 list, so a second run plans nothing.
 *
 * ══ WHY THE `search.inFiles` GUARD IS THE WHOLE SECTION (043 R28, plan D1) ══
 *
 * The same idiom, deliberately WIDENED. A six-element glob array that still equals the shipped list
 * is strong evidence nobody touched it; `trigger: 'run'` is not, because it is simultaneously the
 * value version 6 shipped and a value a user might have chosen on purpose, byte-identical either
 * way. So the condition is that ALL SIX leaves still equal {@link V6_SEARCH_IN_FILES_SETTINGS} —
 * a user who changed nothing in the section is far more likely never to have opened it, and a user
 * who changed anything keeps everything. It is a proxy, R28 states it as one, and the asymmetry is
 * the argument: a false positive costs one preference the user restores in a click, while
 * fresh-install-only reach costs the person who ASKED for the new default the whole change.
 *
 * A hand-added extra key inside the section also refuses the rewrite. That is the same reading —
 * somebody has been in this section — and it keeps the guard exact rather than "the six I know
 * about are unchanged".
 *
 * Idempotent for the v4 leaf's reason: after the rewrite the section no longer equals the v6
 * record, so a second run plans nothing.
 */
export function planSettingsUpgrade(
  document: unknown,
  d: ShippedDefaults = buildShippedDefaults(),
): SettingsLeafUpgrade[] {
  const leaves: SettingsLeafUpgrade[] = [];

  const globsPath = 'explorer.excludeGlobs';
  if (sameStringList(ownAtPath(document, globsPath), V4_EXCLUDE_GLOBS)) {
    leaves.push({ path: globsPath, value: [...d.settings.explorer.excludeGlobs] });
  }

  if (sameFlatSection(ownAtPath(document, 'search.inFiles'), V6_SEARCH_IN_FILES_SETTINGS)) {
    const shipped = d.settings.search.inFiles;
    // Only the leaves FR-074 and FR-075 move. The other four are named in the GUARD because they
    // are evidence about whether the user has been here, not because they are being rewritten.
    //
    // The inner comparison keeps this from planning a no-op: a leaf whose shipped value still IS
    // the v6 value has nothing to carry, and a rewrite that changes nothing is indistinguishable —
    // to the config watcher, and to anyone reading the mtime — from one that did.
    for (const leaf of ['trigger', 'settleMs'] as const) {
      if (shipped[leaf] !== V6_SEARCH_IN_FILES_SETTINGS[leaf]) {
        leaves.push({ path: `search.inFiles.${leaf}`, value: shipped[leaf] });
      }
    }
  }

  return leaves;
}

/**
 * Apply {@link planSettingsUpgrade} to a raw settings document, returning a fresh object.
 *
 * Returns the input unchanged (by value) when nothing is owed, so a caller can compare and skip the
 * write entirely — an upgrade that rewrites a file it did not change is indistinguishable from one
 * that did, to anything watching the file.
 */
export function applySettingsUpgrade(
  document: unknown,
  d: ShippedDefaults = buildShippedDefaults(),
): unknown {
  let next = document;
  for (const leaf of planSettingsUpgrade(document, d)) {
    next = setAtPath(next as Record<string, unknown>, leaf.path, leaf.value);
  }
  return next;
}

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

/** One theme's guarded value rewrites, addressed by dotted path within the theme document. */
export interface ThemeValueUpgrade {
  name: string;
  leaves: SettingsLeafUpgrade[];
}

/**
 * The **first non-additive theme upgrade** in the project (043 R28, plan D1/D4): four values a
 * built-in theme file already holds are rewritten — `colours.searchMatch`,
 * `colours.searchMatchCurrent`, `colours.searchMatchCurrentBorder` (FR-067) and `icons.findInFiles`
 * (FR-065) — and only where the on-disk value is still byte-identical to what version 6 shipped for
 * that theme.
 *
 * ══ WHY IT CANNOT BE {@link planThemeUpgrade} ══
 *
 * That function is additive by construction: `fillMissingThemeProps` never overwrites a key the
 * user's file already has. Version 6 materialised all four of these into every `themes/*.json` on
 * disk — its own bump comment says so and gives the reason — so on the additive path a re-derived
 * colour and a new glyph reach FRESH INSTALLS ONLY, which is the one population every E2E in this
 * repository can see and the only one that does not need the change.
 *
 * ══ THE GUARD IS THE CONTRACT ══
 *
 * Three conditions, and all three are refusals rather than permissions:
 *
 * - **Built-ins only.** A custom theme is the user's document; it is never rewritten, even when its
 *   search-match colours are byte-identical to a built-in's (the additive upgrade filled them from
 *   the `throng` base, so they often are).
 * - **Per token.** Each of the four is compared on its own, so a user who recoloured one keeps that
 *   one and still receives the other three.
 * - **Against a frozen record, never the live definitions.** {@link V6_SEARCH_MATCH_COLOURS} and
 *   {@link V6_FIND_IN_FILES_ICON} are literal copies for the reason {@link V4_EXCLUDE_GLOBS}
 *   records: FR-067 RE-DERIVES fourteen of these fifteen themes, so a guard reading the live value
 *   would compare the new colour against itself, match no install ever, rewrite nothing, and pass
 *   every test — a migration that plans nothing looks exactly like one that had nothing to do.
 *
 * A theme absent from the v6 record (added after version 6) and a theme missing the tokens entirely
 * are both left alone; the latter is {@link planThemeUpgrade}'s job, not this one's.
 *
 * Idempotent: after the rewrite the value no longer equals the v6 record. Nothing is mutated —
 * the caller applies the leaves.
 */
export function planThemeValueUpgrade(args: {
  shipped: ShippedDefaults;
  present: Record<string, Theme>;
}): ThemeValueUpgrade[] {
  const { shipped, present } = args;
  const plans: ThemeValueUpgrade[] = [];
  for (const [name, theme] of Object.entries(present)) {
    // A custom theme is never touched. `isReservedThemeName` keys off the shipped record rather
    // than the file's own `name` field, which the user can edit.
    if (!isReservedThemeName(name, shipped)) continue;
    const v6 = V6_SEARCH_MATCH_COLOURS[name];
    const shippedTheme = shipped.themes[name];
    if (!v6 || !shippedTheme) continue;

    const leaves: SettingsLeafUpgrade[] = [];
    for (const token of SEARCH_MATCH_TOKENS) {
      const current = ownAtPath(theme, `colours.${token}`);
      const next = shippedTheme.colours[token];
      if (current === v6[token] && next !== undefined && next !== current) {
        leaves.push({ path: `colours.${token}`, value: next });
      }
    }
    const icon = ownAtPath(theme, 'icons.findInFiles');
    const nextIcon = shippedTheme.icons.findInFiles;
    if (icon === V6_FIND_IN_FILES_ICON && nextIcon !== undefined && nextIcon !== icon) {
      leaves.push({ path: 'icons.findInFiles', value: nextIcon });
    }

    if (leaves.length > 0) plans.push({ name, leaves });
  }
  return plans;
}
