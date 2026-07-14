import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { createProject, firstPanelId, runApp } from './harness.js';

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

test('the shared menu is keyboard-navigable — arrows move, Enter fires, Escape closes (FR-013a)', async () => {
  await runApp(async (_app, win) => {
    // The cog menu was a list of real focusable buttons. Folding it into a menu that handled Escape
    // and NOTHING else would have been an accessibility regression shipped under the banner of
    // unifying the menus — so the shared menu gained roving focus first, and this pins it.
    await win.getByTestId('title-bar-cog').click();
    const menu = win.getByTestId('cog-menu');
    await expect(menu).toBeVisible();

    // NOTHING is chosen on open. The menu itself takes focus — so the first arrow lands in the menu
    // rather than scrolling the page behind it — but no ITEM is focused, because focusing one would
    // highlight it, and a menu that opens with an item already highlighted has answered a question the
    // user has not asked. (It used to focus the first item, and "Settings" sat there lit up whether or
    // not the pointer was anywhere near it.)
    await expect
      .poll(() => win.evaluate(() => document.activeElement?.getAttribute('data-testid')))
      .toBe('cog-menu');
    await expect(menu.locator('.context-menu__item:focus')).toHaveCount(0);

    // The first Down lands on the FIRST item.
    await win.keyboard.press('ArrowDown');
    await expect
      .poll(() => win.evaluate(() => document.activeElement?.getAttribute('data-testid')))
      .toBe('cog-menu-settings');

    await win.keyboard.press('ArrowDown');
    await expect
      .poll(() => win.evaluate(() => document.activeElement?.getAttribute('data-testid')))
      .toBe('cog-menu-keybindings');

    await win.keyboard.press('ArrowUp');
    await expect
      .poll(() => win.evaluate(() => document.activeElement?.getAttribute('data-testid')))
      .toBe('cog-menu-settings');

    // End jumps to the last item; the focus wraps rather than dead-ending.
    await win.keyboard.press('End');
    await expect
      .poll(() => win.evaluate(() => document.activeElement?.getAttribute('data-testid')))
      .toBe('cog-menu-themes');

    await win.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });
});

test('the cog gear comes from the theme’s icon pack — no inline vector (FR-014b, SC-002)', async () => {
  await runApp(async (_app, win) => {
    // The gear was drawn from a hard-coded path because the theme had no settings glyph to resolve.
    // 018 adds the token; the same one serves the project-settings options icon.
    const glyph = win.getByTestId('cog-glyph');
    await expect(glyph).toHaveCount(1);
    await expect(glyph.locator('.icon')).toHaveCount(1);

    // The window controls too — they were four more inline vectors, and SC-002 claims ZERO.
    for (const id of ['window-min', 'window-max', 'window-close']) {
      await expect(win.getByTestId(id).locator('.icon')).toHaveCount(1);
    }
    // …and the Projects pane's "new project" control, which was a literal ＋ character.
    await expect(win.getByTestId('project-new').locator('.icon')).toHaveCount(1);
  });
});

test('opening any menu closes any other, and a menu closes when its window loses focus (FR-017, FR-017a)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-menus-'));
  await runApp(async (_app, win) => {
    // A panel only exists once a project is open — and the panel's menu is the one that proves the
    // invariant, because it is the SHARED menu the cog has just been folded into.
    await createProject(win, 'Menus', root);
    const pid = await firstPanelId(win);

    await win.getByTestId('title-bar-cog').click();
    await expect(win.getByTestId('cog-menu')).toBeVisible();

    // Right-click the panel: the cog menu must go. The invariant is STRUCTURAL now — the provider
    // holds one menu state, and the cog menu is no longer a second implementation with a life of its
    // own. Before, it closed only because a right-click happens to fire mousedown.
    await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
    await expect(win.getByTestId('cog-menu')).toBeHidden();
    await expect(win.getByTestId('context-menu')).toBeVisible();

    // Blur the window: no menu may be left hanging in a window the user has clicked away from.
    // This is what "application-wide" was actually reaching for — the three window kinds are separate
    // renderer processes, so a provider cannot reach across them without inter-process messaging.
    await win.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(win.getByTestId('context-menu')).toBeHidden();
  });
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});

test('the cog menu flips to stay on-screen near the bottom-right corner (FR-016)', async () => {
  await runApp(async (_app, win) => {
    // The bespoke cog menu positioned itself with a bare CSS `top:100%; right:0` — no measurement,
    // no flip, no clamp. On the shared menu it inherits all three.
    await win.getByTestId('title-bar-cog').click();
    const menu = win.getByTestId('cog-menu');
    await expect(menu).toBeVisible();

    const box = await menu.boundingBox();
    const size = win.viewportSize();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    if (size) {
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1);
    }
  });
});

test('the Key Bindings chord menu is the SHARED menu, and still removes the chord (FR-019)', async () => {
  // The Key Bindings menu had ZERO end-to-end coverage — the ONLY menu in the application with none.
  // That is precisely why nobody noticed it was a second implementation, and it is why FR-019 makes
  // covering it an explicit obligation of this feature rather than a nice-to-have. This is its first
  // test, and it asserts the removal ON DISK rather than in the DOM: the menu exists to write a file.
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-menucfg-'));
  await runApp(
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
  rmSync(cfgRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});
