import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  openApp,
  settle,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';
import {
  configRootSeeded,
  settleConfigRoot,
  snapshotConfigRoot,
  type ConfigRootSnapshot,
} from './helpers/config-snapshot.js';

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

/*
 * ONE app for this file, not one per test (034 FR-045, SC-010) — 2 launches -> 1.
 *
 * Nothing is seeded before launch: both tests write settings.json THROUGH the running app and
 * wait on `data-theme` to land (:41), which is the hot-reload path the tests are about.
 *
 * Left behind: `appearance.theme` on whichever theme the sweep ended on, and — from test 2 —
 * `themes/Optional.json`, a theme the shipped set does not have. The restore rewrites settings.json
 * and THEN deletes Optional.json, and that ordering is the whole reason this is safe rather than
 * merely ordered: test 1 enumerates `listThemes()` and compares every theme's emitted token set
 * against `themes[0]`'s. Optional.json surviving into that sweep would shift `themes[0]` itself.
 *
 * The shim below REFUSES launch options rather than ignoring them: a swallowed config root does not
 * fail, it makes a test pass for the wrong reason.
 *
 * Serial mode is not optional — one window and one config root.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
let sharedCfg: string;
let baseline: ConfigRootSnapshot;

test.beforeAll(async () => {
  sharedCfg = mkdtempSync(join(tmpdir(), 'throng-cfg-'));
  shared = await openApp({ env: { THRONG_CONFIG_ROOT: sharedCfg } });
  await settle(shared.win);
  // Only once first-run seeding has finished — settings, key bindings and every shipped theme. A
  // snapshot taken mid-seed photographs a partial root, and every restore after it would DELETE
  // whatever arrived late.
  await expect.poll(() => configRootSeeded(sharedCfg), { timeout: 30_000 }).toBe(true);
  baseline = snapshotConfigRoot(sharedCfg);
});

test.afterEach(async () => {
  // Restore, wait, re-diff, restore again — and throw NAMING the paths if it will not converge,
  // rather than handing a poisoned root to the next test.
  await settleConfigRoot(baseline, 5_000);
});

test.afterAll(async () => {
  await shared?.close();
  cleanupTemp(sharedCfg);
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win);
};

test('every bundled theme repaints every surface; nothing is left stale (SC-004)', { tag: ['@extended', '@prefs'] }, async () => {
  const cfgRoot = sharedCfg;
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
          // 021 / FR-023 folded the menu/dropdown card onto `surfaceActive` (`menuSurface` is gone).
          '--throng-colour-surfaceActive',
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
  );
});

test('an OPTIONAL token set by one theme is GONE after switching to one that does not set it (SC-004)', { tag: ['@extended', '@prefs'] }, async () => {
  const cfgRoot = sharedCfg;
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
  );
});
