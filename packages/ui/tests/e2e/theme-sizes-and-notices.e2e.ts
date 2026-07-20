import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createProject, runApp, setSlider } from './harness.js';

/**
 * 018 follow-up — the measurements that had no home, and the error that had no presence.
 */

async function openPrefs(app: ElectronApplication, win: Page, tab: string): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId(`cog-menu-${tab}`).click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  return prefs;
}

const cfgRoots: string[] = [];
function freshCfg(): string {
  const d = mkdtempSync(join(tmpdir(), 'throng-cfg-'));
  cfgRoots.push(d);
  return d;
}
test.afterAll(() => {
  for (const d of cfgRoots.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 10 });
});

test('an ICON has its own size, independent of the font it sits beside', async () => {
  const cfg = freshCfg();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'themes');
      await expect(prefs.getByTestId('themes-tab')).toBeVisible();

      // Icons were sized in `em`, so they inherited the font size of whatever surface hosted them:
      // change the dialog font and the preferences window's icons changed with it. Two unrelated
      // things wired to one control, and no way to move either without moving the other.
      await setSlider(prefs.getByTestId('control-sizes.iconPx-slider'), '28');
      await expect
        .poll(() =>
          prefs.evaluate(() => {
            const icon = document.querySelector('.icon');
            return icon ? getComputedStyle(icon).width : '';
          }),
        )
        .toBe('28px');

      // …and the dialog TEXT is untouched by it.
      const fontSize = await prefs.evaluate(() => {
        const root = document.querySelector('.prefs-root');
        return root ? getComputedStyle(root).fontSize : '';
      });
      expect(fontSize).not.toBe('28px');
    },
    { env: { THRONG_CONFIG_ROOT: cfg } },
  );
});

test('a SCROLLBAR has a width, and it comes from the theme', async () => {
  const cfg = freshCfg();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'themes');
      await expect(prefs.getByTestId('themes-tab')).toBeVisible();

      // `scrollbar-width` accepts only auto | thin | none — the standard property cannot take a
      // measurement, so "thin" was the only answer the application could give, and it was too thin.
      await setSlider(prefs.getByTestId('control-sizes.scrollbarPx-slider'), '20');
      await expect
        .poll(() =>
          prefs.evaluate(() =>
            getComputedStyle(document.documentElement)
              .getPropertyValue('--throng-size-scrollbar')
              .trim(),
          ),
        )
        .toBe('20px');
    },
    { env: { THRONG_CONFIG_ROOT: cfg } },
  );
});

test('the base font size cannot be set large enough to destroy the application', async () => {
  const cfg = freshCfg();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'themes');
      await expect(prefs.getByTestId('themes-tab')).toBeVisible();

      // A slider that ran to 96px let you set the base font to 96 and break the window so thoroughly
      // that there was no longer a control small enough to click in order to undo it. A maximum here
      // is not a limitation; it is the difference between a setting and a trap.
      await expect(prefs.getByTestId('control-fonts.baseSizePx-slider')).toHaveAttribute('max', '20');

      // And a role caps at its own SHIPPED PROPORTION of that — a pane title stays a pane title.
      const paneTitleMax = await prefs
        .getByTestId('control-typography.paneTitle.sizePx-slider')
        .getAttribute('max');
      expect(Number(paneTitleMax)).toBeLessThan(20);
      expect(Number(paneTitleMax)).toBeGreaterThan(8);
    },
    { env: { THRONG_CONFIG_ROOT: cfg } },
  );
});

test('the TERMINAL offers only the two attributes xterm can honour', async () => {
  const cfg = freshCfg();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'themes');
      await expect(prefs.getByTestId('themes-tab')).toBeVisible();

      await expect(prefs.getByTestId('control-typography.terminal.family')).toHaveCount(1);
      await expect(prefs.getByTestId('control-typography.terminal.sizePx-slider')).toHaveCount(1);

      // xterm draws its glyphs onto a canvas. It cannot underline the whole terminal, or recase it, or
      // strike it through — and a control that cannot possibly do anything invites you to try.
      for (const gone of ['bold', 'case', 'italic', 'underline', 'strikethrough']) {
        await expect(
          prefs.getByTestId(`control-typography.terminal.${gone}`),
          `terminal.${gone} is offered but cannot work`,
        ).toHaveCount(0);
      }
    },
    { env: { THRONG_CONFIG_ROOT: cfg } },
  );
});

test('an ERROR notice has its own background, in every theme', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'throng-proj-'));
  const cfg = freshCfg();
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'Alpha', projectRoot);
        // A real, persistent error: a project on a root that is already taken.
        await win.getByTestId('project-new').click();
        await win.getByTestId('project-root-input').fill(projectRoot);
        await win.getByTestId('project-name-input').fill('Beta');
        await win.getByTestId('project-save').click();
        const notice = win.getByTestId('project-error');
        await expect(notice).toBeVisible();

        // It used to sit on the ordinary card colour — the same as every other card in the application —
        // with a three-pixel red edge as its only claim on your attention. On a dark theme that is a
        // hairline in the corner of a dark screen, which is not where "this failed" belongs. (021 folded
        // the old `dialogSurface` onto `surface`, so the ordinary card colour is now `surface`.)
        const measured = await win.evaluate(() => {
          const el = document.querySelector('[data-testid="project-error"]');
          const root = getComputedStyle(document.documentElement);
          return {
            background: el ? getComputedStyle(el).backgroundColor : '',
            card: root.getPropertyValue('--throng-colour-surface').trim(),
            errorSurface: root.getPropertyValue('--throng-colour-errorSurface').trim(),
          };
        });
        expect(measured.background).not.toBe('');
        expect(measured.card).not.toBe('');
        // NOT the ordinary card colour.
        expect(measured.background.replace(/\s/g, '')).not.toBe(measured.card.replace(/\s/g, ''));
        // Every bundled theme DERIVES one from its own danger colour and its own background, so none
        // of them is left with an error nobody can see.
        expect(measured.errorSurface).toMatch(/^#|rgb/);
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('ENTER confirms a box — it is the confirm key, in every box that takes typing', async () => {
  const cfg = freshCfg();
  await runApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'settings');
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();

      // The number beside a slider: type it, press Enter, and it is the value. Anyone who typed and
      // pressed Enter — as anyone would — and then watched nothing happen had to work out for
      // themselves that they were supposed to click somewhere else instead.
      const field = prefs.getByTestId('control-behaviour.tabHoverActivateMs');
      await field.fill('1234');
      await field.press('Enter');
      await expect
        .poll(() => {
          const s = JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8')) as {
            behaviour?: { tabHoverActivateMs?: number };
          };
          return s.behaviour?.tabHoverActivateMs;
        })
        .toBe(1234);

      // A LIST's boxes take Enter too — it commits and lets go of the field, rather than doing nothing.
      const glob = prefs.getByTestId('control-explorer.excludeGlobs-item-0');
      await glob.fill('**/.hidden');
      await glob.press('Enter');
      await expect
        .poll(() => {
          const s = JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8')) as {
            explorer?: { excludeGlobs?: string[] };
          };
          return s.explorer?.excludeGlobs?.[0];
        })
        .toBe('**/.hidden');
    },
    { env: { THRONG_CONFIG_ROOT: cfg } },
  );
});
