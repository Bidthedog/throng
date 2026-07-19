import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { runApp } from './harness.js';

/**
 * 021 / US7, FR-027–030 — the three-type button model, proven in the running app.
 *
 * Distinct hex values are written into each of the 18 button tokens, then real dialog buttons are
 * read back: a Confirm button (the name dialog's primary), a Cancel button (its dismiss AND the
 * confirmation's plain button), and a Destroy button (the delete confirmation's danger button). Each
 * must paint its rest AND hover background/text/border from ONLY its own type's six tokens. An
 * IconButton is checked to use none of them — it keeps the neutral `hoverSurface`.
 */

const V = {
  confirmButtonBg: '#101010',
  confirmButtonHoverBg: '#202020',
  confirmButtonBorder: '#303030',
  confirmButtonHoverBorder: '#404040',
  confirmButtonText: '#505050',
  confirmButtonHoverText: '#606060',
  cancelButtonBg: '#114411',
  cancelButtonHoverBg: '#224422',
  cancelButtonBorder: '#334433',
  cancelButtonHoverBorder: '#445544',
  cancelButtonText: '#556655',
  cancelButtonHoverText: '#667766',
  destroyButtonBg: '#441111',
  destroyButtonHoverBg: '#552222',
  destroyButtonBorder: '#663333',
  destroyButtonHoverBorder: '#774444',
  destroyButtonText: '#885555',
  destroyButtonHoverText: '#996666',
  hoverSurface: '#0a0b0c',
};
const rgb = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

const cfgRoots: string[] = [];
function freshCfgRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-cfg-buttons-'));
  cfgRoots.push(dir);
  mkdirSync(join(dir, 'themes'), { recursive: true });
  writeFileSync(join(dir, 'themes', 'throng.json'), JSON.stringify({ name: 'throng', colours: { ...V } }, null, 2), 'utf8');
  return dir;
}
test.afterAll(() => {
  for (const dir of cfgRoots.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});

const rootVar = (page: Page, name: string): Promise<string> =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

interface Style {
  bg: string;
  color: string;
  border: string;
}
const styleOf = (el: Locator): Promise<Style> =>
  el.evaluate((node) => {
    const s = getComputedStyle(node);
    return { bg: s.backgroundColor, color: s.color, border: s.borderTopColor };
  });

/** Read a button's rest style, then its style while hovered. */
async function restAndHover(page: Page, el: Locator): Promise<{ rest: Style; hover: Style }> {
  const rest = await styleOf(el);
  await el.hover();
  // Let the :hover repaint settle before reading.
  await page.waitForTimeout(60);
  const hover = await styleOf(el);
  return { rest, hover };
}

async function openThemes(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([app.waitForEvent('window'), win.getByTestId('cog-menu-themes').click()]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId('themes-tab')).toBeVisible();
  return prefs;
}

test('each button type paints only its own six tokens; an IconButton uses none', async () => {
  const cfgRoot = freshCfgRoot();
  await runApp(
    async (app, win) => {
      const prefs = await openThemes(app, win);
      await expect.poll(() => rootVar(prefs, '--throng-colour-confirmButtonBg'), { timeout: 8000 }).toBe(V.confirmButtonBg);

      // --- IconButton exclusion: a toolbar IconButton uses hoverSurface, none of the button tokens. ---
      const iconBtn = prefs.getByTestId('theme-restore-all');
      const iconRest = await styleOf(iconBtn);
      const buttonBgs = [V.confirmButtonBg, V.cancelButtonBg, V.destroyButtonBg, V.confirmButtonHoverBg, V.cancelButtonHoverBg, V.destroyButtonHoverBg].map(rgb);
      expect(buttonBgs).not.toContain(iconRest.bg); // rest is transparent, not any button surface
      await iconBtn.hover();
      await prefs.waitForTimeout(60);
      expect(await iconBtn.evaluate((n) => getComputedStyle(n).backgroundColor)).toBe(rgb(V.hoverSurface));

      // --- Confirm + Cancel: the name dialog's primary and dismiss buttons. ---
      await prefs.getByTestId('theme-clone').click();
      await expect(prefs.getByTestId('theme-name-dialog')).toBeVisible();

      const confirm = await restAndHover(prefs, prefs.getByTestId('theme-name-confirm'));
      expect(confirm.rest).toEqual({ bg: rgb(V.confirmButtonBg), color: rgb(V.confirmButtonText), border: rgb(V.confirmButtonBorder) });
      expect(confirm.hover).toEqual({ bg: rgb(V.confirmButtonHoverBg), color: rgb(V.confirmButtonHoverText), border: rgb(V.confirmButtonHoverBorder) });

      const cancel = await restAndHover(prefs, prefs.getByTestId('theme-name-cancel'));
      expect(cancel.rest).toEqual({ bg: rgb(V.cancelButtonBg), color: rgb(V.cancelButtonText), border: rgb(V.cancelButtonBorder) });
      expect(cancel.hover).toEqual({ bg: rgb(V.cancelButtonHoverBg), color: rgb(V.cancelButtonHoverText), border: rgb(V.cancelButtonHoverBorder) });

      await prefs.getByTestId('theme-name-cancel').click();
      await expect(prefs.getByTestId('theme-name-dialog')).toBeHidden();

      // --- Destroy + Cancel: the delete confirmation's danger and plain buttons. ---
      await prefs.getByTestId('theme-delete').click();
      await expect(prefs.getByTestId('theme-delete-confirm')).toBeVisible();

      const destroy = await restAndHover(prefs, prefs.getByTestId('theme-confirm-yes'));
      expect(destroy.rest).toEqual({ bg: rgb(V.destroyButtonBg), color: rgb(V.destroyButtonText), border: rgb(V.destroyButtonBorder) });
      expect(destroy.hover).toEqual({ bg: rgb(V.destroyButtonHoverBg), color: rgb(V.destroyButtonHoverText), border: rgb(V.destroyButtonHoverBorder) });

      const cancel2 = await restAndHover(prefs, prefs.getByTestId('theme-confirm-no'));
      expect(cancel2.rest).toEqual({ bg: rgb(V.cancelButtonBg), color: rgb(V.cancelButtonText), border: rgb(V.cancelButtonBorder) });
      expect(cancel2.hover).toEqual({ bg: rgb(V.cancelButtonHoverBg), color: rgb(V.cancelButtonHoverText), border: rgb(V.cancelButtonHoverBorder) });

      await prefs.getByTestId('theme-confirm-no').click();
    },
    { env: { THRONG_CONFIG_ROOT: cfgRoot } },
  );
});
