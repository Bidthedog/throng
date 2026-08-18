import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildShippedDefaults } from '@throng/core';
import { runApp, cleanupTemp} from './harness.js';

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
  for (const r of roots.splice(0)) cleanupTemp(r);
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

test('first run (empty config): seeds settings, keybindings, every built-in theme and the version marker from the record', { tag: ['@extended', '@prefs'] }, async () => {
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

test('relaunch is idempotent: a second start rewrites no config file', { tag: ['@extended', '@prefs'] }, async () => {
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

/*
 * DELETED (034 FR-045) — the three UPGRADE-CONTENT tests, each of which booted the whole
 * application to check what a service writes into a directory.
 *
 * `packages/ui/tests/integration/shipped-defaults-seed-upgrade.test.ts` runs that service against
 * a real filesystem, eleven cases deep, and covers all three:
 *   - the pre-010 additive upgrade → "adds a newly-shipped theme without touching existing
 *     values" + "is non-destructive: preserves a document the user pre-placed (create-if-absent)"
 *     + "is idempotent: a second upgrade changes nothing and records the version"
 *   - the missing colour token → "materialises a newly-added property into a built-in AND a
 *     custom theme, without changing existing values" — the custom-theme half is a case this
 *     file never had
 *   - the absent keybindings.json → "is non-destructive: preserves a document the user pre-placed
 *     (create-if-absent)", which is that claim by name
 *
 * WHAT STAYS, and why it is TWO tests rather than one: the only thing this layer can add is that
 * `main.ts` makes the seed-or-upgrade DECISION at a real boot. The first run proves it seeds an
 * empty root; the relaunch proves a second real boot consults the marker and rewrites nothing.
 * One without the other would leave half the decision untested.
 */
