import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  SHIPPED_DEFAULTS_VERSION,
  V4_EXCLUDE_GLOBS,
  V6_FIND_IN_FILES_ICON,
  V6_SEARCH_IN_FILES_SETTINGS,
  V6_SEARCH_MATCH_COLOURS,
  buildShippedDefaults,
  reservedThemeNames,
  type ShippedDefaults,
  type Theme,
} from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { ShippedDefaultsService } from '../../src/main/shipped-defaults-service.js';

/** First-run seeding + additive upgrade (010, US6 / FR-015/015a). */
const tempDirs: string[] = [];
function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-seed-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SHIPPED = buildShippedDefaults();
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

describe('ShippedDefaultsService.seed (first run)', () => {
  it('writes settings + keybindings + all built-in themes + version marker, equal to the record', async () => {
    const root = freshRoot();
    const service = new ShippedDefaultsService(new FileConfigStore(root), SHIPPED);
    const res = await service.seed();
    expect(res.ok).toBe(true);

    expect(readJson(join(root, 'settings.json'))).toEqual(DEFAULT_APP_SETTINGS);
    expect(readJson(join(root, 'keybindings.json'))).toEqual(DEFAULT_KEYBINDINGS);
    for (const name of reservedThemeNames(SHIPPED)) {
      expect(readJson(join(root, 'themes', `${name}.json`)), name).toEqual(SHIPPED.themes[name]);
    }
    expect(readJson(join(root, 'defaults-state.json'))).toEqual({ version: SHIPPED_DEFAULTS_VERSION });
    expect(await service.readAppliedVersion()).toBe(SHIPPED_DEFAULTS_VERSION);
  });

  it('is non-destructive: preserves a document the user pre-placed (create-if-absent)', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    // A partial config: only keybindings.json exists (mirrors the e2e harness).
    await store.write({ kind: 'keybindings' }, { version: 1, bindings: { 'zoom.in': ['F8'] } });
    const kbBefore = readFileSync(join(root, 'keybindings.json'), 'utf8');

    const res = await new ShippedDefaultsService(store, SHIPPED).seed();
    expect(res.ok).toBe(true);
    // The pre-placed keybindings are untouched; the absent documents were written.
    expect(readFileSync(join(root, 'keybindings.json'), 'utf8')).toBe(kbBefore);
    expect(readJson(join(root, 'settings.json'))).toEqual(DEFAULT_APP_SETTINGS);
    expect(readJson(join(root, 'themes', 'Matrix.json'))).toEqual(SHIPPED.themes.Matrix);
  });
});

describe('ShippedDefaultsService.upgrade (additive, plus the 043 guarded value rewrites)', () => {
  it('adds a newly-shipped theme without touching existing values', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    // A "previous version" record that lacks the Ubuntu theme.
    const prevThemes = { ...SHIPPED.themes };
    delete (prevThemes as Record<string, Theme>).Ubuntu;
    const prev: ShippedDefaults = { ...SHIPPED, themes: prevThemes };
    await new ShippedDefaultsService(store, prev).seed();
    // The user edits a built-in; it must survive the upgrade.
    await store.write({ kind: 'theme', name: 'Matrix' }, { ...SHIPPED.themes.Matrix, colours: { ...SHIPPED.themes.Matrix.colours, accent: '#123456' } });
    const matrixBefore = readFileSync(join(root, 'themes', 'Matrix.json'), 'utf8');

    // Upgrade to the current record (which adds Ubuntu).
    const res = await new ShippedDefaultsService(store, SHIPPED).upgrade();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.added).toContain('Ubuntu');
    expect(readJson(join(root, 'themes', 'Ubuntu.json'))).toEqual(SHIPPED.themes.Ubuntu);
    // The user's edited Matrix is byte-identical (upgrade never overwrites a value).
    expect(readFileSync(join(root, 'themes', 'Matrix.json'), 'utf8')).toBe(matrixBefore);
  });

  it('materialises a newly-added property into a built-in AND a custom theme, without changing existing values', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    await new ShippedDefaultsService(store, SHIPPED).seed();

    // Simulate "the theme shape gained a new colour token" by STRIPPING an existing
    // token from a built-in and a custom theme (as an old-version config would lack it).
    const matrixNoAppBg = { ...SHIPPED.themes.Matrix, colours: { ...SHIPPED.themes.Matrix.colours } };
    delete (matrixNoAppBg.colours as Record<string, string>).appBg;
    await store.write({ kind: 'theme', name: 'Matrix' }, matrixNoAppBg);

    const custom: Theme = { name: 'Mine', colours: { accent: '#mine0' }, fonts: SHIPPED.themes.throng.fonts, icons: {} };
    await store.write({ kind: 'theme', name: 'Mine' }, custom);

    const res = await new ShippedDefaultsService(store, SHIPPED).upgrade();
    expect(res.ok).toBe(true);

    const matrix = readJson(join(root, 'themes', 'Matrix.json')) as Theme;
    // The stripped token is materialised from Matrix's OWN shipped value; accent (present) unchanged.
    expect(matrix.colours.appBg).toBe(SHIPPED.themes.Matrix.colours.appBg);
    expect(matrix.colours.accent).toBe(SHIPPED.themes.Matrix.colours.accent);

    const mine = readJson(join(root, 'themes', 'Mine.json')) as Theme;
    // The custom theme gains missing tokens from the THRONG base; its own accent is kept.
    expect(mine.colours.accent).toBe('#mine0');
    expect(mine.colours.appBg).toBe(SHIPPED.themes.throng.colours.appBg);
  });

  it('is idempotent: a second upgrade changes nothing and records the version', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    await new ShippedDefaultsService(store, SHIPPED).seed();
    const service = new ShippedDefaultsService(store, SHIPPED);

    const first = await service.upgrade();
    expect(first.ok).toBe(true);
    const snapshot = reservedThemeNames(SHIPPED).map((n) => readFileSync(join(root, 'themes', `${n}.json`), 'utf8'));

    const second = await service.upgrade();
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.added).toEqual([]);
      expect(second.filled).toEqual([]);
    }
    reservedThemeNames(SHIPPED).forEach((n, i) => {
      expect(readFileSync(join(root, 'themes', `${n}.json`), 'utf8'), n).toBe(snapshot[i]);
    });
    expect(await service.readAppliedVersion()).toBe(SHIPPED_DEFAULTS_VERSION);
  });

  /*
   * 033 FR-070a — the SETTINGS half of the upgrade, and the only population it exists for.
   *
   * `planSettingsUpgrade`'s own unit tests prove the guard; these prove the WIRING, against a config
   * root shaped like an existing installation rather than a fresh one. That distinction is the whole
   * requirement: first-run `seed()` materialises the entire settings document, so an install that
   * has ever started the app holds the previous glob array literally, and no fresh-install test in
   * this repository can observe it — which is how three earlier features each lost a version bump at
   * exactly this line.
   */
  describe('the guarded settings leaf (033, FR-070a / FR-070b)', () => {
    /** A config root as an installation on shipped-defaults v4 would have left it. */
    function existingInstall(globs: string[]): { root: string; store: FileConfigStore } {
      const root = freshRoot();
      const store = new FileConfigStore(root);
      writeFileSync(
        join(root, 'settings.json'),
        `${JSON.stringify({ ...DEFAULT_APP_SETTINGS, explorer: { ...DEFAULT_APP_SETTINGS.explorer, excludeGlobs: globs } }, null, 2)}\n`,
        'utf8',
      );
      return { root, store };
    }
    const globsOnDisk = (root: string): string[] =>
      (readJson(join(root, 'settings.json')) as { explorer: { excludeGlobs: string[] } }).explorer
        .excludeGlobs;

    it('moves an install still on the v4 list to the shipped list', async () => {
      const { root, store } = existingInstall([...V4_EXCLUDE_GLOBS]);
      expect(await new ShippedDefaultsService(store, SHIPPED).upgrade()).toMatchObject({ ok: true });
      expect(globsOnDisk(root)).toEqual([...DEFAULT_APP_SETTINGS.explorer.excludeGlobs]);
      expect(globsOnDisk(root), 'the point of the whole exercise').toContain('**/node_modules');
    });

    it('leaves every OTHER setting in that document exactly as it found it', async () => {
      const { root, store } = existingInstall([...V4_EXCLUDE_GLOBS]);
      const before = readJson(join(root, 'settings.json')) as Record<string, unknown>;
      await new ShippedDefaultsService(store, SHIPPED).upgrade();
      const after = readJson(join(root, 'settings.json')) as Record<string, unknown>;
      expect(Object.keys(after)).toEqual(Object.keys(before));
      for (const key of Object.keys(before)) {
        if (key === 'explorer') continue;
        expect(after[key], key).toEqual(before[key]);
      }
      expect((after.explorer as Record<string, unknown>).deleteMode).toEqual(
        (before.explorer as Record<string, unknown>).deleteMode,
      );
    });

    it('leaves a CUSTOMISED list exactly as the user set it (FR-070b)', async () => {
      const custom = [...V4_EXCLUDE_GLOBS, '**/dist'];
      const { root, store } = existingInstall(custom);
      await new ShippedDefaultsService(store, SHIPPED).upgrade();
      expect(globsOnDisk(root)).toEqual(custom);
    });

    it('leaves an explicitly EMPTIED list alone (FR-070b)', async () => {
      const { root, store } = existingInstall([]);
      await new ShippedDefaultsService(store, SHIPPED).upgrade();
      expect(globsOnDisk(root)).toEqual([]);
    });

    it('is idempotent — a second upgrade rewrites nothing', async () => {
      const { root, store } = existingInstall([...V4_EXCLUDE_GLOBS]);
      const service = new ShippedDefaultsService(store, SHIPPED);
      await service.upgrade();
      const afterFirst = readFileSync(join(root, 'settings.json'), 'utf8');
      await service.upgrade();
      expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe(afterFirst);
    });

    it('refuses to touch a settings document it cannot parse', async () => {
      // The rule `resetLeaf` established, and it binds harder here: this runs unattended at startup,
      // so guessing at a document it cannot read would replace choices the user can still repair.
      const root = freshRoot();
      const store = new FileConfigStore(root);
      writeFileSync(join(root, 'settings.json'), '{ not json', 'utf8');
      expect(await new ShippedDefaultsService(store, SHIPPED).upgrade()).toMatchObject({ ok: true });
      expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe('{ not json');
    });
  });

  /*
   * 043 R28 / plan D1 — the guarded VALUE rewrite, and the first time `upgrade()` changes something
   * an install already has in a THEME file.
   *
   * `planSettingsUpgrade` and `planThemeValueUpgrade` have their own unit tests; these prove the
   * WIRING, and one thing only unit tests cannot see: a theme owed BOTH an additive fill and a value
   * rewrite must come out of `upgrade()` as ONE file with both applied. Two entries for one path in
   * a single atomic write is a defect the plan functions cannot express.
   *
   * The service is handed a synthetic v7 record rather than the live one because, on the branch
   * where this was written, the live values still ARE the version-6 values (D4's ordering: the
   * re-derivation and the two default changes land later). A test built on the live record would
   * assert that a guard comparing X to X fires — true, useless, and vacuous the moment X moves.
   */
  describe('the guarded theme + settings VALUE rewrite (043 R28, FR-065/067/074/075)', () => {
    /** The shipped record as version 7 will present it: four guarded values moved off their v6 form. */
    function shippedV7(): ShippedDefaults {
      const d = structuredClone(SHIPPED) as {
        version: number;
        themes: Record<string, Theme>;
        settings: typeof DEFAULT_APP_SETTINGS;
        keybindings: typeof DEFAULT_KEYBINDINGS;
      };
      /*
       * SYNTHETIC values, and they must not coincide with the live ones — which `settleMs` now would
       * if it kept saying 500. The whole point of a synthetic v7 record is that the guard is watched
       * moving a value from a known before to a known after; a fixture that happens to equal the
       * live default makes "did the upgrade write it?" and "was it already there?" the same
       * observation. `trigger` is a closed set of two, so it takes the other member and gets its
       * distinctness from the v6 record instead.
       */
      d.settings.search.inFiles.trigger = 'asYouType';
      d.settings.search.inFiles.settleMs = 750;
      for (const [name, theme] of Object.entries(d.themes)) {
        theme.colours.searchMatch = `${name}-match`;
        theme.colours.searchMatchCurrent = `${name}-current`;
        theme.colours.searchMatchCurrentBorder = `${name}-border`;
        theme.icons.findInFiles = '🔎';
      }
      return d as unknown as ShippedDefaults;
    }
    const V7 = shippedV7();

    /**
     * The shipped record as version **6** wrote it — the LIVE record with the three search-match
     * colours put back to what version 6 actually materialised onto disks.
     *
     * This used to be the live record itself, and the comment above records why that was legitimate
     * at the time: none of the four guarded values had moved, so the live values still WERE the v6
     * values. **All four have now moved** — FR-067's re-derivation, then FR-065's glyph and
     * FR-074/FR-075's two settings leaves — so seeding from the live record produces a config root
     * already holding version SEVEN's values, against which the guard correctly plans nothing and
     * every case below goes quietly vacuous. That is not a hypothetical: two of these tests went red
     * the moment FR-065 and FR-074/075 landed, which is the good outcome and the reason the three
     * `V6_*` records exist at all — the v6 state is RECONSTRUCTED here rather than assumed.
     */
    function shippedV6(): ShippedDefaults {
      const d = structuredClone(SHIPPED) as {
        themes: Record<string, Theme>;
        settings: typeof DEFAULT_APP_SETTINGS;
      };
      for (const [name, theme] of Object.entries(d.themes)) {
        Object.assign(theme.colours, V6_SEARCH_MATCH_COLOURS[name]);
        theme.icons.findInFiles = V6_FIND_IN_FILES_ICON;
      }
      d.settings.search.inFiles = { ...V6_SEARCH_IN_FILES_SETTINGS };
      return d as unknown as ShippedDefaults;
    }
    const V6 = shippedV6();

    /** A config root as an installation on shipped-defaults v6 would have left it. */
    function v6Install(): { root: string; store: FileConfigStore } {
      const root = freshRoot();
      const store = new FileConfigStore(root);
      // The v6 SETTINGS document, not the live one: version 6 wrote `run` and 250, and an install
      // holding today's defaults is an install the guard has nothing to do to.
      writeFileSync(
        join(root, 'settings.json'),
        `${JSON.stringify(V6.settings, null, 2)}\n`,
        'utf8',
      );
      return { root, store };
    }
    const themeOnDisk = (root: string, name: string): Theme =>
      readJson(join(root, 'themes', `${name}.json`)) as Theme;
    const inFilesOnDisk = (root: string): Record<string, unknown> =>
      (readJson(join(root, 'settings.json')) as { search: { inFiles: Record<string, unknown> } }).search
        .inFiles;

    it('the three records disagree, or every case below is vacuous', () => {
      /*
       * V6 → V7 is what the guard is watched doing, so the two must differ on every value it is
       * asked to move — and V6 must differ from the LIVE record, or seeding from it would leave
       * today's values on disk and the guard would correctly plan nothing.
       *
       * Compared against V6 rather than against `DEFAULT_APP_SETTINGS`, which is what this used to
       * do and what stopped working: FR-074 moved the live default onto the same value the synthetic
       * v7 record uses, so "v7 differs from live" became false while nothing about the guard had
       * changed. The live record is not one of the two ends of this migration.
       */
      expect(V7.settings.search.inFiles.trigger).not.toBe(V6.settings.search.inFiles.trigger);
      expect(V7.settings.search.inFiles.settleMs).not.toBe(V6.settings.search.inFiles.settleMs);
      expect(V7.themes.Light.icons.findInFiles).not.toBe(V6.themes.Light.icons.findInFiles);
      expect(V7.themes.Light.colours.searchMatch).not.toBe(SHIPPED.themes.Light.colours.searchMatch);

      // …and all four guarded values in V6 are genuinely the version-6 ones rather than today's.
      expect(V6.themes.Light.colours.searchMatch).not.toBe(SHIPPED.themes.Light.colours.searchMatch);
      expect(V6.themes.Light.icons.findInFiles).not.toBe(SHIPPED.themes.Light.icons.findInFiles);
      expect(V6.settings.search.inFiles.trigger).not.toBe(
        DEFAULT_APP_SETTINGS.search.inFiles.trigger,
      );
      expect(V6.settings.search.inFiles.settleMs).not.toBe(
        DEFAULT_APP_SETTINGS.search.inFiles.settleMs,
      );

      // Everything the guard is NOT asked to move is the live record, untouched.
      expect(V6.themes.Light.colours.accent).toBe(SHIPPED.themes.Light.colours.accent);
      expect(V6.settings.search.inFiles.openTarget).toBe(
        DEFAULT_APP_SETTINGS.search.inFiles.openTarget,
      );
    });

    it('rewrites the four guarded values in a built-in theme the user never touched', async () => {
      const { root, store } = v6Install();
      await new ShippedDefaultsService(store, V6).seed();
      expect(await new ShippedDefaultsService(store, V7).upgrade()).toMatchObject({ ok: true });

      const light = themeOnDisk(root, 'Light');
      expect(light.colours.searchMatch).toBe('Light-match');
      expect(light.colours.searchMatchCurrent).toBe('Light-current');
      expect(light.colours.searchMatchCurrentBorder).toBe('Light-border');
      expect(light.icons.findInFiles).toBe('🔎');
      // Every other colour is the user's file as it was found.
      expect(light.colours.accent).toBe(SHIPPED.themes.Light.colours.accent);
    });

    it('leaves a built-in the user recoloured, and every custom theme, exactly as found', async () => {
      const { root, store } = v6Install();
      await new ShippedDefaultsService(store, V6).seed();
      const matrix = { ...V6.themes.Matrix, colours: { ...V6.themes.Matrix.colours, searchMatch: '#mine' } };
      writeFileSync(join(root, 'themes', 'Matrix.json'), `${JSON.stringify(matrix, null, 2)}\n`, 'utf8');
      const custom = { ...SHIPPED.themes.throng, name: 'Mine' };
      writeFileSync(join(root, 'themes', 'Mine.json'), `${JSON.stringify(custom, null, 2)}\n`, 'utf8');

      await new ShippedDefaultsService(store, V7).upgrade();

      expect(themeOnDisk(root, 'Matrix').colours.searchMatch, 'a recoloured token is the user’s').toBe('#mine');
      expect(themeOnDisk(root, 'Matrix').colours.searchMatchCurrent, 'its untouched siblings still move').toBe(
        'Matrix-current',
      );
      expect(themeOnDisk(root, 'Mine').colours.searchMatch).toBe(SHIPPED.themes.throng.colours.searchMatch);
      expect(themeOnDisk(root, 'Mine').icons.findInFiles).toBe(SHIPPED.themes.throng.icons.findInFiles);
    });

    it('applies a value rewrite and an additive fill to ONE theme as a single file', async () => {
      const { root, store } = v6Install();
      await new ShippedDefaultsService(store, V6).seed();
      // Strip a token so the theme is owed an additive fill as well as a value rewrite.
      const light = themeOnDisk(root, 'Light');
      delete (light.colours as Record<string, unknown>).accentText;
      writeFileSync(join(root, 'themes', 'Light.json'), `${JSON.stringify(light, null, 2)}\n`, 'utf8');

      expect(await new ShippedDefaultsService(store, V7).upgrade()).toMatchObject({ ok: true });

      const after = themeOnDisk(root, 'Light');
      expect(after.colours.accentText, 'the additive fill survived').toBe(SHIPPED.themes.Light.colours.accentText);
      expect(after.colours.searchMatch, 'and so did the value rewrite').toBe('Light-match');
    });

    it('moves `search.inFiles.trigger` and `settleMs` on an install holding the v6 section', async () => {
      const { root, store } = v6Install();
      expect(await new ShippedDefaultsService(store, V7).upgrade()).toMatchObject({ ok: true });
      expect(inFilesOnDisk(root)).toEqual({
        ...V6_SEARCH_IN_FILES_SETTINGS,
        trigger: V7.settings.search.inFiles.trigger,
        settleMs: V7.settings.search.inFiles.settleMs,
      });
    });

    it('leaves the whole section alone when the user changed any one leaf of it', async () => {
      const root = freshRoot();
      const store = new FileConfigStore(root);
      // Built from the V6 section, so "the user changed one leaf" is a statement about the document
      // the guard is actually comparing against rather than about today's defaults.
      const mine = { ...V6_SEARCH_IN_FILES_SETTINGS, openTarget: 'new' };
      writeFileSync(
        join(root, 'settings.json'),
        `${JSON.stringify({ ...DEFAULT_APP_SETTINGS, search: { ...DEFAULT_APP_SETTINGS.search, inFiles: mine } }, null, 2)}\n`,
        'utf8',
      );
      await new ShippedDefaultsService(store, V7).upgrade();
      expect(inFilesOnDisk(root)).toEqual(mine);
    });

    it('is idempotent — a second upgrade rewrites nothing at all', async () => {
      const { root, store } = v6Install();
      await new ShippedDefaultsService(store, SHIPPED).seed();
      const service = new ShippedDefaultsService(store, V7);
      await service.upgrade();
      const settingsAfterFirst = readFileSync(join(root, 'settings.json'), 'utf8');
      const themesAfterFirst = reservedThemeNames(V7).map((n) =>
        readFileSync(join(root, 'themes', `${n}.json`), 'utf8'),
      );

      await service.upgrade();

      expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe(settingsAfterFirst);
      reservedThemeNames(V7).forEach((n, i) => {
        expect(readFileSync(join(root, 'themes', `${n}.json`), 'utf8'), n).toBe(themesAfterFirst[i]);
      });
    });
  });
});
