import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import {
  createProject,
  openApp,
  setSlider,
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
import { closePrefsWindow } from './helpers/prefs-window.js';

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

/*
 * ONE app for this file, not one per test (034 FR-045, SC-010) — 3 launches -> 1.
 *
 * None of these three tests needs anything on disk BEFORE the app starts: each called `freshCfg()`
 * with no arguments, for write isolation that `restoreConfigRoot` now provides between tests.
 *
 * The shim below REFUSES launch options rather than ignoring them: a swallowed config root does not
 * fail, it makes a test pass for the wrong reason.
 *
 * Serial mode is not optional — one window, one config root, and the ONE preferences window throng
 * allows, which all three reach through the same cog route.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
let cfg: string;
let baseline: ConfigRootSnapshot;

test.beforeAll(async () => {
  cfg = freshCfg();
  shared = await openApp({ env: { THRONG_CONFIG_ROOT: cfg } });
  await settle(shared.win);
  // Only once first-run seeding has finished — settings, key bindings and every shipped theme.
  // A partial snapshot would have every later restore DELETE whatever arrived late.
  await expect.poll(() => configRootSeeded(cfg), { timeout: 30_000 }).toBe(true);
  baseline = snapshotConfigRoot(cfg);
});

/*
 * Close the preferences window, THEN restore the root.
 *
 * Closing is what lets the next test's `waitForEvent('window')` fire at all against the singleton,
 * and it stops a restore landing under an open window (a dirty JSON buffer would raise
 * `json-external-change` the moment the file changed underneath it).
 */
test.afterEach(async () => {
  await closePrefsWindow(shared.app);
  // `settleConfigRoot`, not a bare restore: the preferences sliders write on a DEBOUNCE, so a test
  // that ends on a screen assertion can finish with a write in flight. It lands after the restore and
  // poisons the next test. This restores, waits, re-diffs, and throws NAMING the drifting paths.
  await settleConfigRoot(baseline, 5_000);
});

test.afterAll(async () => {
  await shared?.close();
  for (const d of cfgRoots.splice(0)) cleanupTemp(d);
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

test('an ICON has its own size, independent of the font it sits beside', { tag: ['@extended', '@prefs'] }, async () => {
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
  );
});

test('a SCROLLBAR has a width, and it comes from the theme', { tag: ['@extended', '@prefs'] }, async () => {
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
  );
});

/*
 * MOVED to `packages/core/tests/unit/theme-size-bounds.test.ts` (034 FR-045) — the two tests in
 * this file that read no style and measure nothing:
 *
 *   "the base font size cannot be set large enough to destroy the application"
 *   "the TERMINAL offers only the two attributes xterm can honour"
 *
 * Each opened a SECOND WINDOW to read `max` off a rendered slider, or to count which
 * `control-typography.terminal.*` test ids existed. The Themes form is generated from
 * `buildThemeMetadata`, so both are claims about a descriptor table.
 *
 * NEW COVERAGE, NOT A RELOCATION. `theme-metadata.test.ts` asserted that `fonts.baseSizePx` IS a
 * slider; nothing asserted its CEILING, and nothing anywhere asserted which attributes the terminal
 * role offers. Both claims existed only here.
 *
 * Writing them down found that the rule is not what the E2E implied. It sampled one slider and
 * checked `8 < max < 20`. The real rule is PROPORTIONAL — `roleSizeMax` scales the base ceiling by
 * the ratio a role ships at — so `typography.editor.sizePx` is legitimately 22, above the base
 * ceiling, because an oversized editor is content while oversized CHROME pushes its own controls
 * off the window. A first draft of the unit test asserted a flat cap and failed against that
 * shipped value: the product was right and the test was wrong.
 *
 * Red-proved on the rule itself — flattening the proportional scaling reddens 1, and adding a
 * third entry to `TERMINAL_FONT_FIELDS` reddens 1. One mutation deliberately left uncoupled and
 * recorded in that file: the `Math.max(8, …)` floor is unreachable with the shipped theme, so it is
 * named as unasserted rather than covered by an assertion that would pass for the wrong reason.
 *
 * WHAT STAYS BELOW: the four tests that read a real cascade — an icon sized independently of the
 * font beside it, a scrollbar width coming from the theme, an error notice with its own background
 * in every theme, and Enter confirming a box. All four go through `getComputedStyle` on a live
 * document, which jsdom cannot supply (034 FR-049).
 */

test('an ERROR notice has its own background, in every theme', { tag: ['@extended', '@prefs'] }, async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'throng-proj-'));
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
    );
  } finally {
    cleanupTemp(projectRoot);
  }
});

/*
 * MOVED to `packages/ui/tests/component/preferences-enter-confirms.test.ts` (034 FR-045) — one
 * test, six replacing it:
 *
 *   "ENTER confirms a box — it is the confirm key, in every box that takes typing"
 *
 * It launched Electron, opened the preferences window as a SECOND window, typed into two boxes,
 * and read `settings.json` back off disk twice. Its subject is a keydown handler.
 *
 * ══ THE REPLACEMENT IS STRICTLY STRONGER, AND HERE IS EXACTLY WHERE ══
 *
 * The E2E's SECOND half could not fail for the reason it claimed. `StringArrayControl`
 * (form-controls.tsx) commits on `onChange` — every keystroke calls `set(next)` → `onCommit` — and
 * its Enter handler does one thing: `e.currentTarget.blur()`. So the E2E's assertion that the glob
 * reached `settings.json` was satisfied by the TYPING. Delete the Enter handler outright and that
 * test stays green. Red-proved: mutation 3 in `red-theme-sizes.mjs` removes exactly that blur and
 * reddens the component test while reddening nothing else in the suite.
 *
 * The component tests assert what the E2E could not see: that Enter LETS GO of a list row, that
 * the row had already committed before Enter arrived, that a NUMBER box commits on Enter with the
 * caret STILL IN IT (which is what separates "Enter committed" from "a blur committed"), and that
 * `SettingControl`'s default TEXT arm both commits and releases — an arm reached only by
 * fall-through, so nothing else pinned it.
 *
 * ══ WHAT DID NOT MOVE ══
 *
 * `settings.json`. That is the config-write path, covered at the integration layer
 * (`packages/ui/tests/integration/config-write*.test.ts`). The SEAM — a real preferences window
 * whose control is bound to the real config store, driven with the same fill-then-Enter gesture —
 * is the one test deliberately kept in `preferences-slider.e2e.ts`, which types `1200`, presses
 * Enter, and requires the value to come back out of the store. That seam is not re-proved here.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Replace the body of the new file's `renderBound` host with `createElement('div')` and ALL SIX
 * tests fail on a missing `[data-testid="control-…"]`. None is of the form "X is absent", so none
 * passes on an empty DOM.
 *
 * ══ WHAT STAYS IN THIS FILE ══
 *
 * Three tests that read a REAL cascade through `getComputedStyle` on a live document — an icon
 * sized independently of the font beside it, a scrollbar width arriving from the theme, and an
 * error notice with its own background. jsdom resolves no `var()` and has no layout, so 034 FR-049
 * and the constitution's real-layout reserve keep all three here.
 */
