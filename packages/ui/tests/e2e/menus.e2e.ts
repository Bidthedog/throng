import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { runApp as runOwnApp, cleanupTemp } from './harness.js';

/*
 * No shared app: the only test left seeds a config root BEFORE launch, so it owns its app (`runOwnApp`).
 */

/** Open the preferences window on a tab, through the cog — the same route every prefs suite uses. */
async function openPrefs(app: ElectronApplication, win: Page, tab: string): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([
    app.waitForEvent('window'),
    win.getByTestId(`cog-menu-${tab}`).click(),
  ]);
  await prefs.waitForLoadState('domcontentloaded');
  return prefs;
}

/**
 * 018 / US2 — every menu in the application obeys the theme, and there is only one of them.
 *
 * Before this, three bespoke menus existed alongside the shared one: the cog drop-down, the Key
 * Bindings chord menu, and the font typeahead list. Each had its own markup, its own click-away, no
 * edge flip, and no share in the one-menu-at-a-time invariant. The cog's gear was a hard-coded
 * inline vector — the constitution prohibits that outright, and it is the whole of issue #56.
 */

/*
 * MOVED to `packages/ui/tests/component/context-menu-lifecycle.test.ts` (034 FR-045) — two tests.
 *
 * The keyboard one asserted `document.activeElement` inside a single component over a real
 * keyboard: the menu takes focus on open with NO item chosen (the pre-023 defect was "Settings"
 * sitting lit up whether or not the pointer was near it), arrows move, End jumps to the last, Enter
 * fires the row AND closes, Escape closes. All of it is focus within one rendered tree.
 *
 * The blur one is the plainest case in this whole migration: it synthesised `new Event('blur')`
 * itself and dispatched it. Electron contributed nothing but start-up cost.
 *
 * WHAT STAYS BELOW: the cog gear coming from the theme’s icon pack with no inline vector; the
 * flip near the bottom-right corner, which reads `boundingBox()` and is real layout; and the Key
 * Bindings chord menu, which removes a chord from the file on disk.
 */

/*
 * ── ONE REMOVED, SPLIT ACROSS TWO COMPONENT FILES (035 T055) ──
 *
 * `:93` "the cog gear comes from the theme's icon pack — no inline vector (FR-014b, SC-002)" →
 *   `packages/ui/tests/component/title-bar.test.ts`          the cog and the three window controls
 *   `packages/ui/tests/component/projects-panel-form.test.ts` the Projects pane's new-project control
 *
 * ── THE NEGATIVE WAS ALREADY PROVEN, REPO-WIDE ──
 *
 * SC-002's ban on inline artwork is `packages/ui/tests/unit/no-inline-artwork.test.ts:60` — "no
 * component draws an inline <svg>, except the brand mark" — which sweeps EVERY component rather than
 * the five this test happened to name, and is one of the guards `guards-are-live.test.ts` keeps
 * un-skipped. So what this test uniquely carried was the POSITIVE: that each control actually draws
 * something. A control that stopped drawing anything at all satisfies "no inline vector" perfectly.
 *
 * ── AND ONE THING THE MIGRATION HAD TO GET RIGHT ──
 *
 * The first draft of the new-project test asserted the control contained no ＋ character. It failed:
 * the shipped pack's `add` token IS a ＋. A character supplied BY the pack is themed and swappable,
 * which is the whole point; the literal 018 removed was a ＋ written into the JSX, outside the
 * theming system — and the two are indistinguishable in `textContent`.
 *
 * So the assertion became about WHERE the glyph lives: the control's text is entirely accounted for
 * by its icon, with nothing left over. That catches the icon-PLUS-stray-literal case, which is the
 * shape of a half-finished migration and the one a bare `.icon` count cannot see. Red-proven as
 * `new-project-icon-plus-literal`.
 *
 * ── WHAT STAYS ──
 *
 * The flip near the bottom-right corner, which reads `boundingBox()` and is real layout, and the Key
 * Bindings chord menu, which removes a chord from the file on disk.
 */
// MOVED DOWN: "the cog menu flips to stay on-screen near the bottom-right corner (FR-016)" -
// unit/clamp-to-viewport.test.ts (flips on both axes, bottom-right corner; point anchor for the context
// menu) and unit/floating-surfaces.test.ts (the .context-menu is registered as measuring and flipping).

test('the Key Bindings chord menu is the SHARED menu, and still removes the chord (FR-019)', { tag: ['@extended', '@window'] }, async () => {
  // The Key Bindings menu had ZERO end-to-end coverage — the ONLY menu in the application with none.
  // That is precisely why nobody noticed it was a second implementation, and it is why FR-019 makes
  // covering it an explicit obligation of this feature rather than a nice-to-have. This is its first
  // test, and it asserts the removal ON DISK rather than in the DOM: the menu exists to write a file.
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-menucfg-'));
  await runOwnApp(
    async (app, win) => {
      const prefs = await openPrefs(app, win, 'keybindings');

      const pill = prefs.getByTestId('binding-view.toggleProjects-pill-0');
      await expect(pill).toBeVisible();

      await pill.click({ button: 'right' });

      // It IS the shared menu now — same component, same class — and it kept its own identifier, so
      // no test had to be migrated to unify it.
      const menu = prefs.getByTestId('binding-context-menu');
      await expect(menu).toBeVisible();
      await expect(menu).toHaveClass(/context-menu/);

      // It carries an icon, which the bespoke one never did.
      await expect(menu.locator('.icon')).toHaveCount(1);

      await prefs.getByTestId('binding-context-remove').click();

      // The behaviour the menu exists for still works: the chord is gone from the file.
      await expect
        .poll(() => {
          const file = join(cfgRoot, 'keybindings.json');
          if (!existsSync(file)) return undefined;
          const doc = JSON.parse(readFileSync(file, 'utf8')) as {
            bindings: Record<string, string[]>;
          };
          return doc.bindings['view.toggleProjects'];
        })
        .toEqual([]);
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
  cleanupTemp(cfgRoot);
});
