import { describe, it, expect } from 'vitest';
import {
  V6_SEARCH_MATCH_COLOURS,
  V6_FIND_IN_FILES_ICON,
  V6_SEARCH_IN_FILES_SETTINGS,
  SEARCH_MATCH_TOKENS,
  buildShippedDefaults,
  planSettingsUpgrade,
  applySettingsUpgrade,
  planThemeValueUpgrade,
  type ShippedDefaults,
} from '../../src/config/shipped-defaults.js';
import type { Theme } from '../../src/config/theme.js';

/**
 * 043 R28 / plan D1 / plan D4 step 2 — the guarded **value** rewrite that carries FR-065, FR-067,
 * FR-074 and FR-075 to an installation that has already run the application.
 *
 * ══ WHY THESE TESTS PASS AN EXPLICIT `shipped` RECORD ══
 *
 * Every case below builds a `ShippedDefaults` whose new values differ from
 * {@link V6_SEARCH_IN_FILES_SETTINGS} / {@link V6_SEARCH_MATCH_COLOURS}, rather than leaning on the
 * live definitions. That is deliberate, and it is D4's ordering made mechanical: **at the moment
 * this file is written the live values still ARE the version-6 values**, because the re-derivation
 * (T137) and the two default changes (T169) have not landed yet. A test written against the live
 * record today would assert that a guard comparing X to X fires — which is true, useless, and would
 * quietly invert into a vacuous pass the day the derivation moves.
 *
 * The other half of that ordering is not this file's job and must not be simulated here: proving
 * that the frozen v6 record and the live values genuinely DISAGREE is what stops a future author
 * re-pointing the guard at whatever the current defaults happen to be, and it can only be asserted
 * once those changes have landed.
 */

/** A shipped record whose four guarded values differ from what version 6 shipped. */
function shippedV7(): ShippedDefaults {
  const d = structuredClone(buildShippedDefaults()) as {
    version: number;
    themes: Record<string, Theme>;
    settings: ReturnType<typeof buildShippedDefaults>['settings'];
    keybindings: ReturnType<typeof buildShippedDefaults>['keybindings'];
  };
  d.settings.search.inFiles.trigger = 'asYouType';
  d.settings.search.inFiles.settleMs = 500;
  for (const [name, theme] of Object.entries(d.themes)) {
    theme.colours.searchMatch = `${name}-match`;
    theme.colours.searchMatchCurrent = `${name}-current`;
    theme.colours.searchMatchCurrentBorder = `${name}-border`;
    theme.icons.findInFiles = '🔎';
  }
  return d as unknown as ShippedDefaults;
}

const D7 = shippedV7();

describe('the guarded `search.inFiles` section upgrade (FR-074, FR-075, R28)', () => {
  /** A settings document holding exactly what version 6 materialised, plus untouched siblings. */
  const docWith = (inFiles: unknown): Record<string, unknown> => ({
    editor: { autoSave: true },
    search: { asYouTypeDebounceMs: 120, inFiles },
  });

  it('the v6 record and the v7 shipped values differ, or every case below is vacuous', () => {
    expect(D7.settings.search.inFiles.trigger).not.toBe(V6_SEARCH_IN_FILES_SETTINGS.trigger);
    expect(D7.settings.search.inFiles.settleMs).not.toBe(V6_SEARCH_IN_FILES_SETTINGS.settleMs);
  });

  it('rewrites the two moved leaves when the WHOLE section still equals the v6 record', () => {
    const plan = planSettingsUpgrade(docWith({ ...V6_SEARCH_IN_FILES_SETTINGS }), D7);
    expect(plan).toEqual([
      { path: 'search.inFiles.trigger', value: 'asYouType' },
      { path: 'search.inFiles.settleMs', value: 500 },
    ]);
  });

  it.each([
    ['openTarget', 'new'],
    ['trigger', 'asYouType'],
    ['settleMs', 400],
    ['defaultGrouping', 'fileAndFolder'],
    ['rememberGrouping', false],
    ['warnIrreversibleCommit', false],
  ] as const)('plans nothing when `%s` differs — one changed leaf keeps the whole section', (leaf, value) => {
    const section = { ...V6_SEARCH_IN_FILES_SETTINGS, [leaf]: value };
    expect(planSettingsUpgrade(docWith(section), D7)).toEqual([]);
  });

  it('plans nothing when the section carries an extra key the schema does not model', () => {
    const section = { ...V6_SEARCH_IN_FILES_SETTINGS, somethingHandAdded: 1 };
    expect(planSettingsUpgrade(docWith(section), D7)).toEqual([]);
  });

  it('plans nothing when the section is absent, missing a leaf, or not an object', () => {
    const { settleMs: _drop, ...missingOne } = { ...V6_SEARCH_IN_FILES_SETTINGS };
    expect(planSettingsUpgrade({ search: { asYouTypeDebounceMs: 120 } }, D7)).toEqual([]);
    expect(planSettingsUpgrade({}, D7)).toEqual([]);
    expect(planSettingsUpgrade(docWith(missingOne), D7)).toEqual([]);
    expect(planSettingsUpgrade(docWith('run'), D7)).toEqual([]);
    expect(planSettingsUpgrade(docWith(null), D7)).toEqual([]);
  });

  it('a second run plans nothing — the rewritten section no longer equals the v6 record', () => {
    const once = applySettingsUpgrade(docWith({ ...V6_SEARCH_IN_FILES_SETTINGS }), D7);
    expect(planSettingsUpgrade(once, D7)).toEqual([]);
  });

  it('leaves every sibling exactly as it found it', () => {
    const before = docWith({ ...V6_SEARCH_IN_FILES_SETTINGS });
    const after = applySettingsUpgrade(before, D7) as Record<string, Record<string, unknown>>;
    expect(after.editor).toEqual({ autoSave: true });
    expect(after.search.asYouTypeDebounceMs).toBe(120);
    expect(after.search.inFiles).toEqual({
      ...V6_SEARCH_IN_FILES_SETTINGS,
      trigger: 'asYouType',
      settleMs: 500,
    });
    // `planSettingsUpgrade` is handed the RAW document and must not mutate it.
    expect(before.search).toEqual({ asYouTypeDebounceMs: 120, inFiles: { ...V6_SEARCH_IN_FILES_SETTINGS } });
  });

  it('still carries the 033 `explorer.excludeGlobs` leaf — the two guards are independent', () => {
    const doc = {
      explorer: { excludeGlobs: ['**/.git', '**/.svn', '**/.hg', '**/CVS', '**/.DS_Store', '**/Thumbs.db'] },
      search: { inFiles: { ...V6_SEARCH_IN_FILES_SETTINGS } },
    };
    const paths = planSettingsUpgrade(doc, D7).map((l) => l.path);
    expect(paths).toEqual([
      'explorer.excludeGlobs',
      'search.inFiles.trigger',
      'search.inFiles.settleMs',
    ]);
  });
});

describe('the guarded theme value upgrade (FR-065, FR-067, R28) — the first non-additive theme upgrade', () => {
  /** A built-in theme file as version 6 left it on disk. */
  const v6Theme = (name: string): Theme =>
    ({
      name,
      colours: { accent: '#123', ...V6_SEARCH_MATCH_COLOURS[name] },
      fonts: { family: 'x', baseSizePx: 13, weights: { normal: 400, bold: 600 } },
      icons: { destroy: '×', findInFiles: V6_FIND_IN_FILES_ICON },
    }) as unknown as Theme;

  it('the v6 record and the v7 shipped values differ, or every case below is vacuous', () => {
    for (const token of SEARCH_MATCH_TOKENS) {
      expect(D7.themes.Light.colours[token]).not.toBe(V6_SEARCH_MATCH_COLOURS.Light[token]);
    }
    expect(D7.themes.Light.icons.findInFiles).not.toBe(V6_FIND_IN_FILES_ICON);
  });

  it('rewrites a built-in whose four guarded values are still the v6 ones', () => {
    const plan = planThemeValueUpgrade({ shipped: D7, present: { Light: v6Theme('Light') } });
    expect(plan).toEqual([
      {
        name: 'Light',
        leaves: [
          { path: 'colours.searchMatch', value: 'Light-match' },
          { path: 'colours.searchMatchCurrent', value: 'Light-current' },
          { path: 'colours.searchMatchCurrentBorder', value: 'Light-border' },
          { path: 'icons.findInFiles', value: '🔎' },
        ],
      },
    ]);
  });

  it('is guarded per token — a recoloured token keeps the user’s colour, its siblings still move', () => {
    const theme = v6Theme('Light');
    theme.colours.searchMatchCurrent = '#feedme';
    const plan = planThemeValueUpgrade({ shipped: D7, present: { Light: theme } });
    expect(plan[0].leaves.map((l) => l.path)).toEqual([
      'colours.searchMatch',
      'colours.searchMatchCurrentBorder',
      'icons.findInFiles',
    ]);
  });

  it('leaves a built-in the user recoloured entirely alone when no token still matches', () => {
    const theme = v6Theme('Light');
    theme.colours.searchMatch = '#aaa';
    theme.colours.searchMatchCurrent = '#bbb';
    theme.colours.searchMatchCurrentBorder = '#ccc';
    theme.icons.findInFiles = '★';
    expect(planThemeValueUpgrade({ shipped: D7, present: { Light: theme } })).toEqual([]);
  });

  it('never touches a CUSTOM theme, even one holding the v6 values byte-for-byte', () => {
    // A custom theme's search-match colours were filled from the throng base by the ADDITIVE
    // upgrade, so they can be byte-identical to a built-in's. It is still the user's theme, and a
    // rewrite of a value in a document the user created is not what this guard is for.
    const custom = v6Theme('throng');
    custom.name = 'My Theme';
    expect(planThemeValueUpgrade({ shipped: D7, present: { 'My Theme': custom } })).toEqual([]);
  });

  it('leaves a theme missing the tokens entirely alone — that is the additive upgrade’s job', () => {
    const bare = { name: 'Light', colours: { accent: '#123' }, icons: {} } as unknown as Theme;
    expect(planThemeValueUpgrade({ shipped: D7, present: { Light: bare } })).toEqual([]);
  });

  it('leaves a built-in with no v6 record alone (a theme added after version 6)', () => {
    const later = v6Theme('throng');
    later.name = 'Later';
    const shipped = structuredClone(D7) as unknown as { themes: Record<string, Theme> };
    shipped.themes.Later = structuredClone(D7.themes.throng) as Theme;
    expect(
      planThemeValueUpgrade({ shipped: shipped as unknown as ShippedDefaults, present: { Later: later } }),
    ).toEqual([]);
  });

  it('a second run plans nothing — the rewritten values no longer equal the v6 record', () => {
    const present = { Light: v6Theme('Light') };
    const first = planThemeValueUpgrade({ shipped: D7, present });
    expect(first).toHaveLength(1);
    const applied = structuredClone(present.Light) as Theme;
    applied.colours.searchMatch = 'Light-match';
    applied.colours.searchMatchCurrent = 'Light-current';
    applied.colours.searchMatchCurrentBorder = 'Light-border';
    applied.icons.findInFiles = '🔎';
    expect(planThemeValueUpgrade({ shipped: D7, present: { Light: applied } })).toEqual([]);
  });

  it('does not mutate the themes it was handed', () => {
    const present = { Light: v6Theme('Light') };
    const before = JSON.stringify(present);
    planThemeValueUpgrade({ shipped: D7, present });
    expect(JSON.stringify(present)).toBe(before);
  });
});
