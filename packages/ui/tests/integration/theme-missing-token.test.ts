import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildShippedDefaults, toCssVariables, THRONG_THEME, type Theme } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { readConfigPayload } from '../../src/main/config-watcher.js';
import { ShippedDefaultsService } from '../../src/main/shipped-defaults-service.js';

/**
 * #643 — a theme file missing a token draws that THEME's value for it, never another theme's
 * (constitution X, *Every theme setting belongs to its theme*; 069 FR-071).
 *
 * The Themes JSON tab writes whatever the user leaves in the document, so deleting a colour there
 * leaves the theme's file without it. Every window paints the theme `readConfigPayload` hands it, and
 * that read used to spread the file over THRONG_THEME — so English Garden, missing its Code File Icons
 * colour, drew throng's dark-theme blue on its light tree, and so did every other theme missing it.
 *
 * Layer: integration — real files read the way main reads them for every window.
 */

const SHIPPED = buildShippedDefaults();
const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A seeded configuration whose active theme's file has `token` deleted, as the JSON tab leaves it. */
async function activeThemeWithout(themeName: string, token: string, file?: Theme): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'throng-theme-missing-'));
  temps.push(root);
  const store = new FileConfigStore(root);
  await new ShippedDefaultsService(store, SHIPPED).seed();
  const settingsPath = join(root, 'settings.json');
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  writeFileSync(settingsPath, JSON.stringify({ ...settings, appearance: { ...settings.appearance, theme: themeName } }));
  const themePath = join(root, 'themes', `${themeName}.json`);
  const theme = (file ?? JSON.parse(readFileSync(themePath, 'utf8'))) as Theme;
  const colours = { ...theme.colours } as Record<string, string>;
  delete colours[token];
  writeFileSync(themePath, JSON.stringify({ ...theme, colours }));
  return root;
}

const painted = async (root: string, token: string): Promise<string | undefined> =>
  toCssVariables((await readConfigPayload(new FileConfigStore(root))).theme)[`--throng-colour-${token}`];

describe('a built-in theme missing a token draws its own value for it (#643)', () => {
  it('English Garden without Code File Icons draws English Garden\'s colour, not throng\'s', async () => {
    const own = SHIPPED.themes['English Garden']!.colours.fileIconCode;
    // Precondition: the two differ, so drawing throng's would be visible.
    expect(own).not.toBe(THRONG_THEME.colours.fileIconCode);

    const root = await activeThemeWithout('English Garden', 'fileIconCode');

    expect(await painted(root, 'fileIconCode')).toBe(own);
  });

  it('two themes missing the same token still draw different colours for it', async () => {
    const garden = await painted(await activeThemeWithout('English Garden', 'appBg'), 'appBg');
    const snake = await painted(await activeThemeWithout('Snake', 'appBg'), 'appBg');

    expect(garden).toBe(SHIPPED.themes['English Garden']!.colours.appBg);
    expect(snake).toBe(SHIPPED.themes.Snake!.colours.appBg);
  });

  it('leaves every value the file does hold as it is', async () => {
    const edited = { ...SHIPPED.themes['English Garden']!, colours: { ...SHIPPED.themes['English Garden']!.colours, accent: '#123456' } };
    const root = await activeThemeWithout('English Garden', 'fileIconCode', edited);

    expect(await painted(root, 'accent')).toBe('#123456');
  });
});
