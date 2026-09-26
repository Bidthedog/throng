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
import {
  COMMAND_SCOPES,
  DEFAULT_KEYBINDINGS,
  normalizeToken,
  sameBindingToken,
  scopesIntersect,
  splitStrokes,
  type ActionId,
  type Keybindings,
} from './keybindings.js';
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
//
// Bumped by 044 (7 → 8): four icon tokens (`preview`, `refresh`, `navigateBack`, `navigateForward`).
// The THEME tokens are the whole reason. The preview settings and key bindings the same release adds
// do not need it: `main.ts` reads both documents through `parseSettingsGuarded` / `parseKeybindings`
// on every startup, and those fill an absent key with its shipped default — the 043 "absence is not
// malformation" path. Theme files get no such read; they are merged shallowly and reach new tokens
// only through the additive upgrade this version gates.
//
// This is 015/016/018's case again and nothing more: every payload ARRIVES, no existing value moves,
// so there is no frozen version-7 record to guard a rewrite against. Without the bump an existing
// install's theme files never receive the tokens, and the preview button and the Back/Forward buttons
// render as empty boxes for exactly the users no fresh-install test represents.
//
// Bumped again by 044's 2026-09-16 iteration (8 → 9): one icon token, `syncScroll`, for the
// Synchronise Scrolling toggle on both status bars and in four menus (FR-122c). Version 8 has not
// shipped either, so no released install holds an 8 marker — this is 043's 6 → 7 case exactly, and the
// population it serves is the same one: every hand-testing build of this branch, whose theme files
// already carry an 8 and would otherwise never receive the new token. Additive only: no value moves,
// so there is no frozen version-8 record to guard against. The one new key binding the iteration adds
// needs no bump, for the reason given above — `parseKeybindings` fills an absent action on every read.
//
// Bumped by 045 (9 → 10): two colour tokens, `linkUnderline` and `linkUnderlineHover`, the underline
// that marks a link in both panel types (FR-138). The 044 case again: additive only, every payload
// arrives and no existing value moves, so there is no frozen version-9 record to guard against.
// Without the bump an existing install's theme files never receive the tokens. The settings the same
// release changes need none — `editor.links.existenceCheckTimeoutMs` is filled by the tolerant parse
// on every read, and the retired `editor.links.defaultAction` is dropped by it (FR-113).
//
// Bumped again by 045's round four (10 → 11): three colour tokens, `linkHintBackground`,
// `linkHintText` and `linkHintBorder` — the plain-click link hint's own surface, text and border
// (FR-165g). Additive only, the same shape as the bump above: without it an existing install's theme
// files never receive them and the hint would draw unstyled (`--throng-colour-linkHintBackground`
// etc. simply absent, since `toCssVariables` only emits what a theme's OWN record carries plus the
// built-in default, and an on-disk file frozen at version 10 carries neither).
//
// NOT bumped by 045's round five (#408), and the reason is worth recording, because the changes look
// like the bumps above and are not. Round five inverted `editor.links.knownFileExtensions` from a
// `{ added, removed }` delta into the one list a user edits, and retired `terminals.linkHoverDelayMs`
// — two SETTINGS, no theme tokens. A settings change reaches an existing install through the tolerant
// per-field parse on EVERY read, with no version gate: `knownFileExtensionsSetting` migrates the old
// shape the first time it sees one, and a stray `linkHoverDelayMs` is simply not copied into the
// rebuilt block. That is this file's own round-four ruling for `defaultAction` and
// `existenceCheckTimeoutMs`, and it applies unchanged here.
//
// A bump to 12 was written and then reverted (see below — the slot did not stay empty). It would
// have carried no payload — nothing waiting on a theme file, no frozen record to guard a rewrite
// against — so every install would have paid an upgrade pass to learn nothing. The version means
// "there is something here you have not got"; moving it when there is not is how it stops meaning
// that.
//
// Bumped by 046 (11 → 12): three icon tokens, `unload`, `category` and `projectList` — the Unload
// menu, the Projects pane's category header and the pane's own panel-type marker (FR-061, R11).
// Additive only, the same shape as every bump above: without it an existing install's theme files
// never receive the three glyphs and each renders as nothing (an icon token absent from a theme
// draws no fallback glyph of its own — see `icon-tokens-exist.test.ts`'s header comment). No colour
// token moves alongside it.
//
// `projectList` was ITSELF retired by 046 iterate round 2 (branch-review finding): its description
// named a cog-menu row FR-074/FR-107 had already retired before the description was written, and no
// call site ever drew it. No new SHIPPED_DEFAULTS_VERSION bump was needed to undo this — unlike the
// additive case above, dropping a token needs no version gate; `theme-ops.ts`'s `migrateTheme` sheds
// a stray `projectList` key unconditionally, on every load, the same way it already drops 021's
// removed colour tokens.
//
// The same bump also carries a VALUE that moves, on the keybindings side this time: `zoom.reset`
// gains Ctrl+Shift+0 (FR-025). This is the 043 R28 shape, not 015/016/018/044's additive one —
// `seed()` writes `zoom.reset`'s TWO-chord array into every install's `keybindings.json` at first
// run, so it is never MISSING the way a brand-new action would be, and `parseKeybindings`'s
// per-read fill (which only supplies an absent action) does nothing for it. Without a guarded
// rewrite here, an existing install's file stays frozen at the old two-chord array forever and
// Ctrl+Shift+0 does nothing for every user who has ever run the app before this release — exactly
// the population no fresh-install E2E can see, the same trap this comment has recorded five times
// over. `planKeybindingsUpgrade` guards it the {@link V6_SEARCH_IN_FILES_SETTINGS} way: a rewrite
// ONLY where the on-disk array is still set-identical to {@link V11_ZOOM_RESET_BINDING}, so a user
// who rebound `zoom.reset` keeps exactly what they set. It ALSO refuses the rewrite when another
// action already binds {@link COLLIDING_ZOOM_RESET_TOKENS} — a review finding: `resolveKeydown`
// tries the physical Ctrl+Shift+0 candidate first, so adding it here could otherwise steal that
// physical key from whatever already owned it, invisibly to Preferences.
//
// Bumped by 046 iterate round 1 (12 → 13): TWO PAYLOADS, one on each side this file's history has
// already seen separately.
//
// The THEME side is 015/016/018/044/045's additive case again: one colour token,
// `categoryHeaderBackground` (FR-072), the Projects pane's category header strip. Without the bump
// an existing install's theme files never receive it and the header draws on whatever the pane
// body already was.
//
// The KEYBINDINGS side is 046's OWN v11 → v12 case (this file, just above), arriving for FIFTEEN
// rows at once rather than one: every FR-102 *changes* row — the whole Ctrl+Shift+Alt navigation
// tier this round introduces, plus the panel-zoom gestures and the `editor.toggleWordWrap`
// two-stroke chord — is a value that MOVES on disk, not a key that simply appears. `seed()` wrote
// every one of these bindings into `keybindings.json` at first run, so none of them is ever
// MISSING and `parseKeybindings`'s per-read fill does nothing for any of them. `planKeybindingsUpgrade`
// is extended below with FR-108's guarded rows: each one moves only when the saved array is still
// set-identical to a NAMED earlier version's value (v11's, or — for the five actions v12 already
// touched — v12's too), using the same {@link sameBindingToken} collision guard `zoom.reset`'s v12
// rewrite introduced, so a new default is never applied on top of a chord the user already owns
// under its "same binding" spelling.
//
// Bumped by 046 iterate round 3 (13 → 14): a KEYBINDINGS payload only, no theme token. FR-117 moves
// five rows version 13 had just written — `focus.notice` to Ctrl+Shift+Alt+V, the pane toggles to J
// and K, `focus.projects` / `focus.explorer` to B and M — so that B / N / M focus the three surfaces
// left to right. It is the 12 → 13 case again, for five rows: `seed()` wrote every one of them, so
// none is ever missing and the per-read fill does nothing for any. {@link V13_KEYBINDINGS} joins
// FR-108's guard sources, and every row's target is still the LIVE shipped value, so an install at
// 11 or 12 lands on FR-117's chord in one pass and no version-13 chord is ever written by it.
//
// Version 13 is not edited to carry this instead, for 043's (6 → 7) and 044's (8 → 9) reason: the
// maintainer's development config and every hand-testing build of this branch already hold a 13
// marker, and `main.ts` runs the upgrade only when the saved marker differs from the shipped one — a
// change to 13 would never reach exactly the installs it exists for.
//
// The same bump carries one NEW-ACTION rule, and it is the first this file has needed. A brand-new
// command normally rides no bump at all (the per-read fill supplies it), but `focus.workspace` ships
// on Ctrl+Shift+Alt+N — the chord `view.toggleExplorer` held at 13. Where that row does not move (a
// customised array that kept N, or a move the collision guard refused), the fill would silently give
// the new command the user's own chord. So version 14 writes `focus.workspace: []` in exactly that
// case, which the Key Bindings editor then shows as unbound, and otherwise leaves the action absent.
//
// Bumped by 046 iterate round 5 (14 → 15): a KEYBINDINGS payload only. FR-124 writes a two-stroke
// chord as `Mods+K1,K2`, so `editor.toggleWordWrap` ships `Ctrl+E,W` where versions 13 and 14 wrote
// `Ctrl+E W`. `seed()` wrote that value, so it is present and the per-read fill never touches it;
// {@link V14_KEYBINDINGS} joins FR-108's guard sources and the row moves only while it is still
// exactly that default. Version 14 is not edited, for the reason version 13 was not.
//
// Bumped by 046 iterate round 7 (15 → 16): a KEYBINDINGS payload only. FR-127 gives
// `panel.zoomReset` the main-row `Ctrl+Alt+0` as a second keyboard chord. Every install holds
// version 15's `['Ctrl+Alt+Numpad0', 'Ctrl+MiddleClick']`, so the row is present and the per-read
// fill never touches it; {@link V15_KEYBINDINGS} joins FR-108's guard sources, the row moves only
// while it is still exactly that default, and a binding the user kept on `Ctrl+Alt+0` refuses it.
// Version 15 is not edited.
export const SHIPPED_DEFAULTS_VERSION = 16;

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

/**
 * `zoom.reset`'s binding as every install up to version 11 shipped it (010) — the value
 * {@link planKeybindingsUpgrade} guards on.
 *
 * A frozen COPY, for {@link V4_EXCLUDE_GLOBS}'s reason: `DEFAULT_KEYBINDINGS.bindings['zoom.reset']`
 * has moved on (046 FR-025 adds `Ctrl+Shift+0`), so this must not follow it. If it did, the guard
 * would compare the live default against itself, match every untouched install forever, and never
 * plan a rewrite — a migration that is silently inert.
 */
export const V11_ZOOM_RESET_BINDING: readonly string[] = Object.freeze(['Ctrl+0', 'Ctrl+MiddleClick']);

/**
 * FR-108's version-11 guard sources: every action whose binding {@link planKeybindingsUpgrade} may
 * move to its 046 iterate-round-1 value — frozen copies of what shipped-defaults version 11 wrote
 * into every install's `keybindings.json`, for {@link V4_EXCLUDE_GLOBS}'s reason: `DEFAULT_KEYBINDINGS`
 * has moved on, so a guard reading it live would compare the current default against itself and
 * match nothing, ever.
 *
 * `zoom.reset` is INCLUDED here (review finding, CRITICAL 1 on the first cut of this file) rather
 * than hand-rolled in a separate block: it has TWO possible guard sources — this v11 pair, and
 * {@link V12_KEYBINDINGS}'s v12 triple below — and both must go through the SAME generic,
 * scope-aware, same-binding-normalised collision check as every other row, or a v11 install with
 * something already bound to the real v13 target (`Ctrl+Shift+Alt+Numpad0`, 046 iterate round 2
 * FR-114) is never checked against it.
 */
export const V11_KEYBINDINGS: Readonly<Record<string, readonly string[]>> = deepFreeze({
  'zoom.in': ['Ctrl+=', 'Ctrl++', 'Ctrl+WheelUp'],
  'zoom.out': ['Ctrl+-', 'Ctrl+WheelDown'],
  'zoom.reset': [...V11_ZOOM_RESET_BINDING],
  'focus.left': ['Ctrl+Alt+ArrowLeft'],
  'focus.right': ['Ctrl+Alt+ArrowRight'],
  'focus.up': ['Ctrl+Alt+ArrowUp'],
  'focus.down': ['Ctrl+Alt+ArrowDown'],
  'focus.notice': ['Ctrl+Alt+M'],
  'view.toggleProjects': ['Ctrl+Alt+B'],
  'view.toggleExplorer': ['Ctrl+Alt+N'],
  'tabs.openPicker': ['Ctrl+Alt+T'],
  'panel.zoomIn': ['Ctrl+Alt+=', 'Ctrl+Alt++'],
  'panel.zoomOut': ['Ctrl+Alt+-'],
  'panel.zoomReset': ['Ctrl+Alt+0'],
  'editor.toggleWordWrap': ['Ctrl+Alt+W'],
});

/**
 * FR-108's version-12 guard sources (046, unreleased): the value five actions held at
 * shipped-defaults version 12, the only population that ever materialised it — version 12 never
 * shipped to a released install, so this serves only a hand-tested build of this branch that ran
 * `seed()` between the two bumps. `zoom.reset`'s v11 source lives in {@link V11_KEYBINDINGS} above;
 * the other four are brand new at v12, so their ONLY possible guard source is this one.
 */
export const V12_KEYBINDINGS: Readonly<Record<string, readonly string[]>> = deepFreeze({
  'zoom.reset': ['Ctrl+0', 'Ctrl+Shift+0', 'Ctrl+MiddleClick'],
  'project.next': ['Ctrl+Alt+PageDown'],
  'project.previous': ['Ctrl+Alt+PageUp'],
  'focus.explorer': ['Ctrl+Alt+F'],
  'focus.projects': ['Ctrl+Alt+P'],
});

/**
 * FR-118's version-13 guard sources (046 iterate round 3, unreleased): what shipped-defaults version
 * 13 wrote for the five rows FR-117 moves — FR-102's tier-1 values. A frozen COPY, never a reference
 * to `DEFAULT_KEYBINDINGS`, for {@link V4_EXCLUDE_GLOBS}'s reason: the live constant has already
 * moved on, and a guard reading it would compare the current default against itself.
 */
export const V13_KEYBINDINGS: Readonly<Record<string, readonly string[]>> = deepFreeze({
  'focus.notice': ['Ctrl+Shift+Alt+M'],
  'view.toggleProjects': ['Ctrl+Shift+Alt+B'],
  'view.toggleExplorer': ['Ctrl+Shift+Alt+N'],
  'focus.explorer': ['Ctrl+Shift+Alt+F'],
  'focus.projects': ['Ctrl+Shift+Alt+P'],
});

/**
 * FR-124's version-14 guard source (046 iterate round 5, unreleased): the space-separated
 * two-stroke token versions 13 and 14 wrote for word wrap, before FR-124's `Mods+K1,K2` form. A
 * frozen COPY, for {@link V13_KEYBINDINGS}'s reason.
 */
export const V14_KEYBINDINGS: Readonly<Record<string, readonly string[]>> = deepFreeze({
  'editor.toggleWordWrap': ['Ctrl+E W'],
});

/**
 * FR-127's version-15 guard source (046 iterate round 7, unreleased): what versions 13 – 15 wrote for
 * the panel zoom reset, before it gained the main-row `Ctrl+Alt+0`. A frozen COPY, for
 * {@link V13_KEYBINDINGS}'s reason.
 */
export const V15_KEYBINDINGS: Readonly<Record<string, readonly string[]>> = deepFreeze({
  'panel.zoomReset': ['Ctrl+Alt+Numpad0', 'Ctrl+MiddleClick'],
});

/** The command FR-116 adds — the one FR-118's new-action fill rule guards. */
const FOCUS_WORKSPACE = 'focus.workspace';

/**
 * The two tokens a saved `Ctrl+Shift+Digit0` press can be recorded as, under the physical-first
 * resolver `resolveKeydown` (`packages/ui/src/renderer/config/chord-key.ts`) every renderer
 * resolver now uses: the PHYSICAL token, `Ctrl+Shift+0` — what a capture records on ANY layout
 * today, including a layout (e.g. AZERTY) whose "master capture" already recorded the physical
 * digit before this feature existed — and the PRODUCED token a US or UK layout typed for that same
 * physical press, `Ctrl+Shift+)`, which is what a pre-046 capture on those layouts recorded, since
 * only the produced character was matched then.
 *
 * `chordCandidates` tries the physical token FIRST. So if another action already owns either form,
 * adding `Ctrl+Shift+0` to `zoom.reset` would make every physical Ctrl+Shift+Digit0 press resolve to
 * `zoom.reset` regardless of which of the two tokens the other action holds — silently stealing the
 * key, invisibly to Preferences (the saved strings differ from `zoom.reset`'s own).
 *
 * ══ WHY ONLY THESE TWO, NOT EVERY LAYOUT'S SHIFT+0 SYMBOL ══
 *
 * Modelling every layout's produced character for Shift+0 is exactly the table `chordCandidates`
 * was built to avoid needing (German types `=`, and so on without end — see
 * `contracts/keybindings-and-focus.md` §2, whose own example table stops at US/UK's `)`). These two
 * are the forms provably in use: the physical token is what EVERY layout captures going forward, and
 * `)` is the one produced form this feature's own contract documents and tests. Widening this list
 * is a decision for a specific reported collision on a specific layout, not a preemptive guess — the
 * guard is conservative in the direction of SKIPPING the addition, so a collision this set misses
 * costs a user the NEW chord rather than costing them an EXISTING one.
 */
/** One key binding to rewrite, addressed by its `ActionId`. */
export interface KeybindingsLeafUpgrade {
  action: string;
  value: string[];
}

/**
 * True iff `value` is an array of exactly the strings in `expected` — same members, same count,
 * ORDER IGNORED. A binding array is a SET of alternative chords a command answers to, not a
 * sequence, so `['Ctrl+MiddleClick', 'Ctrl+0']` is the same customisation-evidence as
 * `['Ctrl+0', 'Ctrl+MiddleClick']` — unlike {@link sameStringList}, which `explorer.excludeGlobs`
 * uses and where order genuinely is part of the value.
 */
function sameStringSet(value: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  if (!value.every((entry): entry is string => typeof entry === 'string')) return false;
  const a = [...value].sort();
  const b = [...expected].sort();
  return a.every((entry, i) => entry === b[i]);
}

/**
 * True iff `shippedToken` and `otherToken` (both already run through `normalizeToken` then
 * `sameBindingToken`) are the SAME CHORD for FR-108's collision purposes — either literally equal,
 * or one is a two-stroke token whose FIRST STROKE equals the other's whole token (FR-092: pressing
 * that shared prefix is genuinely ambiguous between "fire the other command now" and "wait for the
 * second stroke", review finding IMPORTANT 3). Two two-stroke tokens merely sharing a first stroke
 * are NOT a match here — a shared prefix between two DIFFERENT two-stroke commands is legitimate,
 * the same distinction `chordCollisions` (keybindings.ts) draws for the live resolver.
 */
function sameChordOrAmbiguousPrefix(shippedToken: string, otherToken: string): boolean {
  if (shippedToken === otherToken) return true;
  // Strokes as written in the comma form (FR-124) — never a split on ' ' or ',', since `Ctrl+,`
  // is one stroke. Either token being a PROPER prefix of the other is ambiguous (FR-092's
  // first-stroke rule, widened to any shorter chord by FR-126).
  const shippedStrokes = splitStrokes(shippedToken);
  const otherStrokes = splitStrokes(otherToken);
  if (!shippedStrokes || !otherStrokes || shippedStrokes.length === otherStrokes.length) return false;
  const [shorter, longer] =
    shippedStrokes.length < otherStrokes.length ? [shippedStrokes, otherStrokes] : [otherStrokes, shippedStrokes];
  return shorter.every((s, i) => longer[i] === s);
}

/**
 * True iff some action OTHER than `except`, and not itself in `moving`, already binds a token that
 * collides with one of `shippedTokens` under {@link sameChordOrAmbiguousPrefix} — and only when the
 * two actions' scopes actually INTERSECT (review finding IMPORTANT 10: FR-108 says "any action
 * whose saved array is not being rewritten", scoped to where both commands are actually live,
 * mirroring the scope-aware rule `chordCollisions` already applies to the live resolver).
 *
 * `moving` is what makes this safe to call inside a BATCH of guarded rewrites rather than one at a
 * time: FR-108's own words are "any action whose saved array is not being rewritten", and a whole
 * FAMILY of actions is being rewritten here in one pass — `zoom.in`'s v11 default happens to include
 * `Ctrl+WheelUp`, the exact gesture `panel.zoomIn`'s v13 value is ABOUT TO GAIN, and without this
 * exclusion `panel.zoomIn`'s own move would be refused for colliding with a value `zoom.in` is
 * simultaneously giving up. `moving` MUST be the FIXED POINT of "rows that actually end up moving"
 * ({@link planFR108Rows} computes it that way) — review finding CRITICAL 2: a row that matches a
 * source but is ITSELF refused never loses its old tokens, and a one-shot "saved matches source"
 * set wrongly exempted it anyway, which is how two commands both ended up bound to
 * `Ctrl+MiddleClick`.
 */
function collidesWithAnotherAction(
  bindings: Record<string, unknown>,
  shippedTokens: readonly string[],
  except: string,
  moving: ReadonlySet<string>,
): boolean {
  const exceptScopes = COMMAND_SCOPES[except as ActionId];
  const targets = shippedTokens.map((t) => sameBindingToken(normalizeToken(t)));
  if (targets.length === 0) return false;
  for (const [action, value] of Object.entries(bindings)) {
    if (action === except || moving.has(action) || !Array.isArray(value)) continue;
    if (!scopesIntersect(exceptScopes, COMMAND_SCOPES[action as ActionId])) continue;
    for (const raw of value) {
      if (typeof raw !== 'string') continue;
      const otherToken = sameBindingToken(normalizeToken(raw));
      if (targets.some((t) => sameChordOrAmbiguousPrefix(t, otherToken))) return true;
    }
  }
  return false;
}

/**
 * FR-108's whole guarded batch, computed as a FIXED POINT (review finding CRITICAL 2).
 *
 * `zoom.reset` has TWO possible guard sources — {@link V11_KEYBINDINGS}'s v11 pair and
 * {@link V12_KEYBINDINGS}'s v12 triple — because 046's own earlier keybindings version already
 * touched it once (unreleased); every other action has exactly one. Each row's CANDIDATE status is
 * decided first: its saved array is set-identical to a named source, and the shipped v13 value
 * differs from it. The candidate set then SHRINKS to a fixed point: a candidate is dropped when it
 * would collide with something not itself moving ({@link collidesWithAnotherAction}), and dropping
 * one candidate can re-expose its old tokens to a DIFFERENT candidate's check — so the pass repeats
 * until nothing changes. What survives is exactly what actually moves; what {@link
 * applyKeybindingsUpgrade} writes is each surviving action's shipped value.
 *
 * 046 iterate round 3 (FR-118) adds {@link V13_KEYBINDINGS} as a third source, so five actions now
 * have two or three — the `candidates.has(action)` skip already takes the first match. After the
 * fixed point it also plans `focus.workspace: []` where that brand-new action's shipped chord would
 * collide with a binding that is not moving, and the saved file does not already name the action.
 */
function planFR108Rows(
  bindings: Record<string, unknown>,
  d: ShippedDefaults,
): KeybindingsLeafUpgrade[] {
  const guardedRows: Array<[string, readonly string[]]> = [
    ...Object.entries(V11_KEYBINDINGS),
    ...Object.entries(V12_KEYBINDINGS),
    ...Object.entries(V13_KEYBINDINGS),
    ...Object.entries(V14_KEYBINDINGS),
    ...Object.entries(V15_KEYBINDINGS),
  ];
  const shippedBindings = d.keybindings.bindings as Record<string, string[]>;

  const candidates = new Map<string, string[]>();
  for (const [action, source] of guardedRows) {
    if (candidates.has(action)) continue; // zoom.reset matches at most one of its two sources
    if (!sameStringSet(bindings[action], source)) continue;
    const shipped = shippedBindings[action] ?? [];
    if (sameStringSet(bindings[action], shipped)) continue; // already at the shipped value
    candidates.set(action, shipped);
  }

  const moving = new Set(candidates.keys());
  let changed = true;
  while (changed) {
    changed = false;
    for (const action of [...moving]) {
      if (collidesWithAnotherAction(bindings, candidates.get(action)!, action, moving)) {
        moving.delete(action);
        changed = true;
      }
    }
  }

  const plan = [...moving].map((action) => ({ action, value: [...candidates.get(action)!] }));

  // FR-118's new-action fill rule, evaluated only once the fixed point has settled: `moving` is
  // final, so "a binding that is not moving" means exactly what stays on disk after this pass.
  const workspace = shippedBindings[FOCUS_WORKSPACE] ?? [];
  if (
    !Object.prototype.hasOwnProperty.call(bindings, FOCUS_WORKSPACE) &&
    collidesWithAnotherAction(bindings, workspace, FOCUS_WORKSPACE, moving)
  ) {
    plan.push({ action: FOCUS_WORKSPACE, value: [] });
  }
  return plan;
}

/**
 * The keybindings counterpart of {@link planSettingsUpgrade} — a guarded rewrite of FR-108's
 * fifteen rows and the four 046 commands v12 introduced, which FR-118 extends with a version-13
 * source for five of them plus one `focus.workspace: []` fill, and the ONLY place a saved keybinding
 * is allowed to move (046 FR-025, FR-023, FR-108, FR-118).
 *
 * ══ WHY THIS EXISTS AT ALL, WHEN `parseKeybindings` ALREADY FILLS ABSENT ACTIONS ══
 *
 * That fill (`shipped-defaults.ts`'s own version-bump history cites it repeatedly) only helps an
 * action MISSING from the saved file — a brand-new command an old install never had. Every FR-108
 * row is not that: `seed()` wrote each one's array into every install's `keybindings.json` at first
 * run, so it is always PRESENT, and a present value is never touched by the tolerant per-read fill.
 * Without this, the whole Ctrl+Shift+Alt navigation tier would reach fresh installs only.
 *
 * ══ WHY THIS IS 043's PRECEDENT AND NOT 026 FR-030's ══
 *
 * 026 FR-030 moved the pane-toggle chords (`Ctrl+B` → `Ctrl+Alt+B`) by leaving every existing
 * install's file untouched, permanently — a saved single value is indistinguishable between "never
 * touched" and "chosen on purpose", so it erred toward never guessing. Every FR-108 row is an
 * ADDITION or a REPLACEMENT of a value that is still EXACTLY a NAMED earlier version's array
 * (order-insensitive) — the same strength of evidence `planSettingsUpgrade`'s `search.inFiles`
 * guard already relies on: byte-identical to what a named earlier version shipped is far more
 * likely "never opened this" than "deliberately reconstructed the default". Any other saved value
 * is left exactly as the user set it.
 *
 * Idempotent for {@link V4_EXCLUDE_GLOBS}'s reason: after a row moves its array equals the shipped
 * value, which set-equals none of its guard sources, so a second run plans nothing for it. A written
 * `focus.workspace: []` makes the action PRESENT, and the fill rule only ever fires for an absent one.
 *
 * ══ THE COLLISION GUARD, AND WHY IT IS ONE PATH FOR EVERY ROW (review findings CRITICAL 1/2,
 * IMPORTANT 3/10) ══
 *
 * `zoom.reset` used to be hand-rolled separately from the other FR-108 rows, guarded by a literal
 * check for two specific tokens (`Ctrl+Shift+0` / `Ctrl+Shift+)`) that were only ever the RIGHT
 * thing to check while the intended target was `Ctrl+Shift+0` itself. Once the round's own
 * FR-102/FR-107 changes moved the real v13 target to `Ctrl+Shift+Alt+0` (and 046 iterate round 2's
 * FR-114 moved it again, to `Ctrl+Shift+Alt+Numpad0`), that literal check was silently checking the
 * WRONG tokens — a v11 install with something already bound to the real target was never examined,
 * and a v12 install with something bound to the now-retired `Ctrl+Shift+0` was refused a value that
 * no longer contains it, staying stuck on the retired `Ctrl+0`. Routing `zoom.reset` through
 * {@link planFR108Rows} like every other row fixes that: the
 * collision check is against the REAL shipped value, is scope-aware, treats a two-stroke shipped
 * chord's first stroke as colliding with a plain chord it would swallow, and computes which rows
 * actually move as a fixed point rather than trusting "matches a source" alone.
 */
export function planKeybindingsUpgrade(
  document: unknown,
  d: ShippedDefaults = buildShippedDefaults(),
): KeybindingsLeafUpgrade[] {
  const bindings = isPlainObject(document) ? document.bindings : undefined;
  if (!isPlainObject(bindings)) return [];
  return planFR108Rows(bindings, d);
}

/**
 * Apply {@link planKeybindingsUpgrade} to a raw keybindings document, returning a fresh object.
 *
 * Reads and rewrites the RAW document rather than a parsed `Keybindings`, for {@link
 * planSettingsUpgrade}'s reason: a parse round-trip would go through `parseKeybindings`, which
 * fills every OTHER action from the shipped defaults too — rewriting far more of the file than the
 * one leaf this upgrade owes, and doing so unattended at startup (FR-023). Every sibling binding,
 * and any key the schema does not model, survives untouched.
 *
 * Returns the input unchanged (by value) when nothing is owed, so a caller can compare and skip the
 * write entirely — the same contract {@link applySettingsUpgrade} makes.
 */
export function applyKeybindingsUpgrade(
  document: unknown,
  d: ShippedDefaults = buildShippedDefaults(),
): unknown {
  const leaves = planKeybindingsUpgrade(document, d);
  if (leaves.length === 0) return document;
  const base = isPlainObject(document) ? document : {};
  const bindings = isPlainObject(base.bindings) ? { ...base.bindings } : {};
  for (const leaf of leaves) bindings[leaf.action] = leaf.value;
  return { ...base, bindings };
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
