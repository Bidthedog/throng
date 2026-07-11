import { test, expect } from '@playwright/test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildShippedDefaults } from '@throng/core';
import { runApp } from './harness.js';

/**
 * Startup regression smoke tests for shipped-defaults (010). These exercise the
 * one seam the integration tests cannot reach: the REAL app boot in `main.ts`
 * that decides first-run `seed()` vs version-gated additive `upgrade()`, writing
 * into the user config root.
 *
 * Isolation: the app's user-profile config lives under `THRONG_CONFIG_ROOT` and
 * its Electron appdata under `--user-data-dir`; the harness overrides BOTH to
 * throwaway temp dirs, so nothing here touches the real `%USERPROFILE%\.throng`
 * or `%APPDATA%`. We own the config root (passed via `env`), so we pre-seed it
 * before launch, relaunch against it, and inspect it after the app has fully
 * closed — never racing the startup writes.
 *
 * Source of truth is the live in-process record, so these stay correct as the
 * theme/setting/binding definitions (and feature 009's palettes/tokens) evolve.
 */
const SHIPPED = buildShippedDefaults();
const THEME_NAMES = Object.keys(SHIPPED.themes).sort();
const A_BUILTIN = THEME_NAMES.find((n) => n !== 'throng') ?? 'throng';

/** The exact on-disk JSON form every config write uses (FileConfigStore.serialize). */
const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const settingsPath = (r: string): string => join(r, 'settings.json');
const keybindingsPath = (r: string): string => join(r, 'keybindings.json');
const markerPath = (r: string): string => join(r, 'defaults-state.json');
const themePath = (r: string, name: string): string => join(r, 'themes', `${name}.json`);
const themeFilesOnDisk = (r: string): string[] => {
  try {
    return readdirSync(join(r, 'themes'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length))
      .sort();
  } catch {
    return [];
  }
};

// Config roots we create (and therefore own the cleanup of — the harness leaves a
// caller-supplied THRONG_CONFIG_ROOT in place).
const roots: string[] = [];
function makeRoot(seed?: (root: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-sd-e2e-'));
  roots.push(root);
  seed?.(root);
  return root;
}
test.afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});

/** Boot the real app against `root`; resolve once the shell has rendered (startup
 *  seed/upgrade has completed by the time the app closes). */
async function boot(root: string): Promise<void> {
  await runApp(
    async (_app, win) => {
      await win.getByTestId('throng-shell').waitFor({ state: 'visible' });
    },
    { env: { THRONG_CONFIG_ROOT: root } },
  );
}

test('first run (empty config): seeds settings, keybindings, every built-in theme and the version marker from the record', async () => {
  const root = makeRoot(); // empty → true first run

  await boot(root);

  // Settings + keybindings written byte-for-byte from the record.
  expect(readFileSync(settingsPath(root), 'utf8')).toBe(serialize(SHIPPED.settings));
  expect(readFileSync(keybindingsPath(root), 'utf8')).toBe(serialize(SHIPPED.keybindings));
  // Version marker recorded.
  expect(JSON.parse(readFileSync(markerPath(root), 'utf8'))).toEqual({ version: SHIPPED.version });
  // Exactly the built-in theme set — nothing missing, nothing extra.
  expect(themeFilesOnDisk(root)).toEqual(THEME_NAMES);
  // Sampled theme files deep-equal the shipped values (throng keeps its icon pack).
  expect(JSON.parse(readFileSync(themePath(root, 'throng'), 'utf8'))).toEqual(SHIPPED.themes.throng);
  expect(JSON.parse(readFileSync(themePath(root, A_BUILTIN), 'utf8'))).toEqual(SHIPPED.themes[A_BUILTIN]);
});

test('relaunch is idempotent: a second start rewrites no config file', async () => {
  const root = makeRoot();
  await boot(root); // seed

  const before = {
    settings: readFileSync(settingsPath(root), 'utf8'),
    keybindings: readFileSync(keybindingsPath(root), 'utf8'),
    marker: readFileSync(markerPath(root), 'utf8'),
    throng: readFileSync(themePath(root, 'throng'), 'utf8'),
    themes: themeFilesOnDisk(root),
  };

  await boot(root); // second start — marker matches, nothing to do

  expect(readFileSync(settingsPath(root), 'utf8')).toBe(before.settings);
  expect(readFileSync(keybindingsPath(root), 'utf8')).toBe(before.keybindings);
  expect(readFileSync(markerPath(root), 'utf8')).toBe(before.marker);
  expect(readFileSync(themePath(root, 'throng'), 'utf8')).toBe(before.throng);
  expect(themeFilesOnDisk(root)).toEqual(before.themes);
});

test('existing config without a marker (pre-010): additive upgrade adds the marker and missing default themes, leaving user settings untouched', async () => {
  // Simulate a user who is already running throng (so it is NOT a first run) but
  // predates the shipped-defaults marker: a customised, PARTIAL settings.json, and
  // only a couple of theme files present.
  const present = ['throng', A_BUILTIN];
  const root = makeRoot((r) => {
    mkdirSync(join(r, 'themes'), { recursive: true });
    writeFileSync(settingsPath(r), serialize({ confirmations: { destroyPanel: 'none' } }));
    writeFileSync(keybindingsPath(r), serialize(SHIPPED.keybindings));
    for (const n of present) writeFileSync(themePath(r, n), serialize(SHIPPED.themes[n]));
  });
  const settingsBefore = readFileSync(settingsPath(root), 'utf8');
  expect(existsSync(markerPath(root))).toBe(false);

  await boot(root);

  // Marker now recorded (upgrade ran) and every reserved theme was materialised.
  expect(JSON.parse(readFileSync(markerPath(root), 'utf8'))).toEqual({ version: SHIPPED.version });
  expect(themeFilesOnDisk(root)).toEqual(THEME_NAMES);
  // The user's partial/customised settings file was NOT rewritten (never overwrite).
  expect(readFileSync(settingsPath(root), 'utf8')).toBe(settingsBefore);
});

test('existing theme missing a colour token: upgrade materialises the missing token from the record without overwriting an edited value, idempotently', async () => {
  // A built-in theme file that is missing one shipped colour token (a newly-added
  // property) and has another token edited to a user value.
  const shippedTheme = SHIPPED.themes[A_BUILTIN];
  const colourKeys = Object.keys(shippedTheme.colours ?? {});
  expect(colourKeys.length).toBeGreaterThanOrEqual(2); // guard the fixture
  const editedKey = colourKeys[0];
  const missingKey = colourKeys[1];
  const userValue = '#010203';

  const partial = JSON.parse(JSON.stringify(shippedTheme)) as { colours: Record<string, string> };
  partial.colours[editedKey] = userValue; // user edited this token
  delete partial.colours[missingKey]; // this token is absent on disk (missing key)

  const root = makeRoot((r) => {
    mkdirSync(join(r, 'themes'), { recursive: true });
    // settings.json present so the launch is an upgrade, not a first-run seed.
    writeFileSync(settingsPath(r), serialize({ editor: { autoSave: false } }));
    writeFileSync(themePath(r, A_BUILTIN), serialize(partial));
  });

  await boot(root);

  const filled = JSON.parse(readFileSync(themePath(root, A_BUILTIN), 'utf8')) as {
    colours: Record<string, string>;
  };
  expect(filled.colours[missingKey]).toBe(shippedTheme.colours?.[missingKey]); // absent token materialised
  expect(filled.colours[editedKey]).toBe(userValue); // edited value preserved
  const afterFirst = readFileSync(themePath(root, A_BUILTIN), 'utf8');

  await boot(root); // relaunch — marker now current, upgrade gated off

  expect(readFileSync(themePath(root, A_BUILTIN), 'utf8')).toBe(afterFirst); // idempotent
});

test('existing config missing keybindings.json: the missing user-profile file is created from the record while settings are preserved', async () => {
  // settings.json present (customised) but keybindings.json absent and no marker.
  const root = makeRoot((r) => {
    writeFileSync(settingsPath(r), serialize({ confirmations: { destroyPanel: 'none' } }));
  });
  const settingsBefore = readFileSync(settingsPath(root), 'utf8');
  expect(existsSync(keybindingsPath(root))).toBe(false);

  await boot(root);

  // The absent user-profile file was created from the record...
  expect(readFileSync(keybindingsPath(root), 'utf8')).toBe(serialize(SHIPPED.keybindings));
  // ...the pre-existing settings file was left exactly as it was...
  expect(readFileSync(settingsPath(root), 'utf8')).toBe(settingsBefore);
  // ...and the upgrade recorded the version marker.
  expect(JSON.parse(readFileSync(markerPath(root), 'utf8'))).toEqual({ version: SHIPPED.version });
});
