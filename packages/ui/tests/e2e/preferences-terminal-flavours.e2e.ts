import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp } from './harness.js';

/**
 * The three terminal-flavour settings are HIDDEN from the Settings UI for v1.0.0 (#67 → vNext).
 *
 * #67 ("make flavour editing work through the visual editor") renders badly and does not work, so
 * the developer moved it to vNext and its controls must not ship. The keys are marked internal in
 * `SETTINGS_INTERNAL_KEYS` and their descriptors withheld from the rendered registry — a HIDE, not
 * a revert: the settings still parse and take effect from a hand-edited `settings.json`; only the
 * Settings UI controls are withheld, to be re-exposed in vNext.
 *
 * This spec is that guard. It used to assert the three controls rendered and worked; it now asserts
 * the opposite — that none of them appears in the Settings panel, EVEN when the underlying settings
 * hold data (a hidden setting with a value must still not surface a control). The rich
 * render-and-validate journeys it once carried belong to #67 and return with it.
 */

const cfgRoots: string[] = [];
function freshCfgRoot(seed?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-flav-'));
  cfgRoots.push(dir);
  if (seed !== undefined) {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(seed, null, 2), 'utf8');
  }
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

async function openPrefs(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId('cog-menu-settings').click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId('settings-tab')).toBeVisible();
  return prefs;
}

/** The control root test ids the three withheld settings would render under, if they were shown. */
const HIDDEN_CONTROL_TESTIDS = [
  'control-terminals.flavours',
  'control-terminals.disabledBuiltins',
  'control-terminals.defaultParams',
] as const;

test('the three terminal-flavour controls do NOT appear in the Settings panel (#67 hidden for v1.0.0)', async () => {
  // Seed every one of the three with a real value. A hidden setting that HOLDS data is the honest
  // case: if the controls leaked back in, populated data is exactly what would make them render, so
  // proving absence here proves absence for good — not merely that an empty setting drew no rows.
  const cfgRoot = freshCfgRoot({
    terminals: {
      flavours: [
        { id: 'my-wsl', label: 'WSL: Ubuntu', file: 'wsl.exe', args: ['-d', 'Ubuntu'], defaultParams: '--cd ~' },
      ],
      disabledBuiltins: ['cmd'],
      defaultParams: { pwsh: '-NoLogo' },
    },
  });
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win);

      // The Settings form has rendered (its own control is visible), so a control that is going to
      // appear has appeared — an absence check now is a real absence, not a not-yet-mounted race.
      await expect(prefs.getByTestId('control-appearance.theme')).toBeVisible();

      // None of the three control roots exists anywhere in the Settings panel…
      for (const testid of HIDDEN_CONTROL_TESTIDS) {
        await expect(prefs.getByTestId(testid)).toHaveCount(0);
      }

      // …and neither does the row that would frame them, nor the record-table affordances the
      // flavours control drew (add / new-id / a seeded row). If the descriptor is not rendered,
      // these cannot exist; asserting them too catches a control that leaks in under a stray id.
      await expect(prefs.getByTestId('setting-terminals.flavours')).toHaveCount(0);
      await expect(prefs.getByTestId('setting-terminals.disabledBuiltins')).toHaveCount(0);
      await expect(prefs.getByTestId('setting-terminals.defaultParams')).toHaveCount(0);
      await expect(prefs.getByTestId('flavour-add')).toHaveCount(0);
      await expect(prefs.getByTestId('flavour-new-id')).toHaveCount(0);
      await expect(prefs.getByTestId('flavour-row-my-wsl')).toHaveCount(0);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
