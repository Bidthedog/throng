import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { runApp } from './harness.js';

/**
 * 018 / SC-004 — switching between ALL the bundled themes leaves no surface visually stale.
 *
 * A single sampled theme cannot prove a criterion that says "switching between all of them", so this
 * DISCOVERS the theme list from the running application rather than restating it. A list written by hand
 * is a list that goes stale the day someone adds a theme — which is this feature's own thesis, applied
 * to its own test.
 *
 * The defect it guards is specific and was real: `toCssVariables` MERGES each theme over the base theme
 * before emitting, so every theme emits the same complete set of properties — except the OPTIONAL ones,
 * whose whole meaning is their absence. Those were previously left behind on the document element when
 * you switched to a theme that does not set them, so a theme that says nothing about icon colour
 * silently inherited the last theme's.
 */

/** Every `--throng-*` custom property currently set on the document element. */
function emittedTokens(win: Page): Promise<Record<string, string>> {
  return win.evaluate(() => {
    const style = document.documentElement.style;
    const out: Record<string, string> = {};
    for (const name of Array.from(style)) {
      if (name.startsWith('--throng-')) out[name] = style.getPropertyValue(name).trim();
    }
    return out;
  });
}

async function activateTheme(win: Page, cfgRoot: string, name: string): Promise<void> {
  const file = join(cfgRoot, 'settings.json');
  const settings = JSON.parse(readFileSync(file, 'utf8')) as { appearance: { theme: string } };
  settings.appearance.theme = name;
  writeFileSync(file, JSON.stringify(settings, null, 2));
  // The theme applies by hot-reload, with no restart (007). Wait for it to actually LAND — asserting
  // against a theme that has not finished applying would measure the previous one.
  await expect(win.locator('html')).toHaveAttribute('data-theme', name, { timeout: 8000 });
}

test('every bundled theme repaints every surface; nothing is left stale (SC-004)', async () => {
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-'));
  try {
    await runApp(
      async (_app, win) => {
        await expect(win.getByTestId('projects-panel')).toBeVisible();

        // Ask the APPLICATION which themes it ships. Not a list in this file.
        const themes = await win.evaluate(async () => {
          const w = window as unknown as {
            throng?: { config?: { listThemes?: () => Promise<string[]> } };
          };
          return (await w.throng?.config?.listThemes?.()) ?? [];
        });
        expect(themes.length).toBeGreaterThanOrEqual(14);

        const maps: Record<string, Record<string, string>> = {};
        for (const name of themes) {
          await activateTheme(win, cfgRoot, name);
          const tokens = await emittedTokens(win);
          maps[name] = tokens;

          // The app is still painted — this theme resolved, it did not blank the surfaces.
          for (const required of [
            '--throng-colour-surface',
            '--throng-colour-menuSurface',
            '--throng-colour-scrollbarThumb',
            '--throng-colour-text',
            '--throng-colour-accent',
          ]) {
            expect(tokens[required], `${name} left ${required} unset`).toMatch(/^#|rgb|hsl/);
          }
        }

        // Every theme emits the SAME property set — because each is merged over the base theme before
        // being emitted. A theme carrying a property no other theme has is a property left behind by the
        // theme before it, which is exactly the staleness this criterion forbids.
        const OPTIONAL = ['--throng-colour-iconColour', '--throng-colour-menuItemHoverSurface'];
        const required = (name: string): string[] =>
          Object.keys(maps[name]!)
            .filter((k) => !OPTIONAL.includes(k))
            .sort();
        const baseline = required(themes[0]!);
        for (const name of themes) {
          expect(required(name), `${name} does not emit the same token set as ${themes[0]}`).toEqual(
            baseline,
          );
        }
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    rmSync(cfgRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('an OPTIONAL token set by one theme is GONE after switching to one that does not set it (SC-004)', async () => {
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-cfg-'));
  try {
    await runApp(
      async (_app, win) => {
        await expect(win.getByTestId('projects-panel')).toBeVisible();

        // A theme that DOES set the optional tokens. No bundled theme does — absence is their default,
        // and their meaning: unset icon colour means "each icon keeps its own colour", and unset menu
        // hover means "follow the active project's colour".
        const custom = join(cfgRoot, 'themes', 'Optional.json');
        writeFileSync(
          custom,
          JSON.stringify(
            {
              name: 'Optional',
              colours: { iconColour: '#ff00ff', menuItemHoverSurface: '#00ff00' },
            },
            null,
            2,
          ),
        );
        await activateTheme(win, cfgRoot, 'Optional');

        const withOptional = await emittedTokens(win);
        expect(withOptional['--throng-colour-iconColour']).toBe('#ff00ff');
        expect(withOptional['--throng-colour-menuItemHoverSurface']).toBe('#00ff00');

        // Now a theme that says nothing about either. The properties must be REMOVED from the document,
        // not merely overwritten — because "unset" is not a colour, it is a meaning, and the CSS
        // `var(--x, fallback)` that expresses it only fires when the property is genuinely absent.
        await activateTheme(win, cfgRoot, 'throng');
        const after = await emittedTokens(win);
        expect(after['--throng-colour-iconColour'], 'the previous theme’s icon colour is stuck').toBe(
          undefined,
        );
        expect(
          after['--throng-colour-menuItemHoverSurface'],
          'the previous theme’s menu hover is stuck',
        ).toBe(undefined);
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    rmSync(cfgRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
