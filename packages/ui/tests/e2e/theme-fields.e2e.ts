import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { openApp, createProject, cleanupTemp, type AppOptions, type OpenApp } from './harness.js';
import { configRootSeeded } from './helpers/config-snapshot.js';
import { closePrefsWindow } from './helpers/prefs-window.js';

/**
 * 021 / US6 + US7 — the surface consolidation (FR-023–026) and the three-type button model (FR-027–030), proven in
 * the running app. THIS FILE ALSO HOLDS WHAT WAS `theme-buttons.e2e.ts` (test-suite audit, pass 1): the two shared
 * a shape — write distinct hex values into the active theme, read real elements' computed colours back — and each
 * paid for its own launch to do it.
 *
 * ONE app for both tests (2 launches -> 1). Neither seeds anything before launch: the theme is written into the
 * RUNNING config root and the hot reload is polled for, which is the `theme-tokens.e2e.ts` pattern. Every write
 * replaces the WHOLE theme document, so neither test can inherit a partial theme from the other and their order is
 * free. The preferences window is a singleton (`app.waitForEvent('window')` never fires on a reused one), so it is
 * closed after each test.
 *
 * ── Fields (FR-023–026) ──
 * Distinct hex values are written into the active theme, then real elements' computed backgrounds are read back:
 *  - every `.ctl` field (a settings input + the Themes dropdown) resolves to `inputSurface`;
 *  - a menu/dropdown card (the context menu) resolves to `surfaceActive`;
 *  - a dialog card (a modal) resolves to `surface`;
 *  - the File Explorer pane (`.pane--explorer`) resolves to the SAME background as the sidebar.
 * It also proves the US5 relabel reached the UI: the Themes editor shows the renamed rows.
 *
 * ── Buttons (FR-027–030) ──
 * Distinct hex values are written into each of the 18 button tokens, then real dialog buttons are read back: a
 * Confirm button (the name dialog's primary), a Cancel button (its dismiss AND the confirmation's plain button), and
 * a Destroy button (the delete confirmation's danger button). Each must paint its rest AND hover
 * background/text/border from ONLY its own type's six tokens. An IconButton is checked to use none of them — it
 * keeps the neutral `hoverSurface`.
 */
test.describe.configure({ mode: 'serial' });

const sharedCfg = mkdtempSync(join(tmpdir(), 'throng-cfg-theme-surfaces-'));
let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp({ env: { THRONG_CONFIG_ROOT: sharedCfg } });
  // First-run seeding must have finished before a test overwrites `themes/throng.json`, or the seed could land
  // after the write and replace it.
  await expect.poll(() => configRootSeeded(sharedCfg), { timeout: 30_000 }).toBe(true);
});

test.afterEach(async () => {
  await closePrefsWindow(shared.app);
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
    throw new Error('this file shares one app; a test needing launch options must open its own');
  }
  return fn(shared.app, shared.win);
};

/** Replace the active theme's document in the running app's config root (a whole-file write, never a patch). */
function writeTheme(colours: Record<string, string>): void {
  writeFileSync(
    join(sharedCfg, 'themes', 'throng.json'),
    JSON.stringify({ name: 'throng', colours }, null, 2),
    'utf8',
  );
}

const rgb = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

const rootVar = (page: Page, name: string): Promise<string> =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

const bgOf = (page: Page, selector: string): Promise<string> =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);

async function openThemes(app: ElectronApplication, win: Page): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  const [prefs] = await Promise.all([app.waitForEvent('window'), win.getByTestId('cog-menu-themes').click()]);
  await prefs.waitForLoadState('domcontentloaded');
  await expect(prefs.getByTestId('themes-tab')).toBeVisible();
  return prefs;
}

// ── Fields ──────────────────────────────────────────────────────────────────────────────────────────────────────────

// Distinct, collision-free values so a wrong token can't accidentally match the right colour.
const VALUES = {
  inputSurface: '#113355',
  surface: '#224466',
  surfaceActive: '#335577',
  sidebarBg: '#446688',
};

test('every surface resolves to its consolidated token + the relabel renders', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
  await runApp(
    async (app, win) => {
      writeTheme({ ...VALUES });
      await createProject(win, 'Fields', 'C:/c/fields');
      // Wait for the written theme to actually apply before reading any computed colour.
      await expect.poll(() => rootVar(win, '--throng-colour-inputSurface'), { timeout: 8000 }).toBe(VALUES.inputSurface);

      // --- File Explorer pane == the sidebar (both are Side Panel Background). The `.pane--explorer`
      // element is always in the DOM (collapsed or not), so its background is readable without toggling. ---
      const sidebarBg = await bgOf(win, '.pane--sidebar');
      const explorerBg = await bgOf(win, '.pane--explorer');
      expect(sidebarBg).toBe(rgb(VALUES.sidebarBg));
      expect(explorerBg).toBe(sidebarBg);

      // --- A menu/dropdown card == surfaceActive. ---
      const panelBox = win.locator('.panel-box').first();
      const pid = await panelBox.evaluate((el) => (el as HTMLElement).dataset.panelId ?? '');
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await expect(win.getByTestId('context-menu')).toBeVisible();
      expect(await bgOf(win, '.context-menu')).toBe(rgb(VALUES.surfaceActive));
      await win.keyboard.press('Escape');

      // --- A dialog card == surface. ---
      await win.getByTestId('project-settings-open').click();
      const dialog = win.getByTestId('project-settings-dialog');
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgb(VALUES.surface));
      await win.keyboard.press('Escape');

      // --- The preferences fields: a settings input + the Themes dropdown == inputSurface. ---
      const prefs = await openThemes(app, win);
      await expect.poll(() => rootVar(prefs, '--throng-colour-inputSurface'), { timeout: 8000 }).toBe(VALUES.inputSurface);
      expect(await bgOf(prefs, '[data-testid="theme-select"]')).toBe(rgb(VALUES.inputSurface));

      // The renamed US5 labels render in the Themes editor (E2E evidence, not unit-only).
      await expect(prefs.locator('.settings-row', { hasText: 'Confirm Button Background' }).first()).toBeVisible();
      await expect(prefs.locator('.settings-row', { hasText: 'Editor Font Size' }).first()).toBeVisible();

      // A Settings-tab field resolves to the field surface too.
      await prefs.getByTestId('prefs-tab-settings').click();
      await expect(prefs.getByTestId('settings-tab')).toBeVisible();
      const field = prefs.getByTestId('control-behaviour.submenuHoverMs');
      await expect(field).toBeVisible();
      expect(await field.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgb(VALUES.inputSurface));
    },
  );
});

// ── Buttons ─────────────────────────────────────────────────────────────────────────────────────────────────────────

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
async function restAndHover(el: Locator): Promise<{ rest: Style; hover: Style }> {
  const rest = await styleOf(el);
  await el.hover();
  // Every call site's theme gives hover a DIFFERENT background from rest (that difference is what
  // each one goes on to assert), so "the background has actually changed" is a real, generic
  // condition for "the :hover repaint has landed" — poll it instead of guessing how long one takes.
  await expect.poll(async () => (await styleOf(el)).bg, { timeout: 5000 }).not.toBe(rest.bg);
  const hover = await styleOf(el);
  return { rest, hover };
}

test('each button type paints only its own six tokens; an IconButton uses none', { tag: ['@extended', '@prefs', '@reserve:layout'] }, async () => {
  await runApp(
    async (app, win) => {
      writeTheme({ ...V });
      // The hot reload reaches the main window before the preferences window is opened on it.
      await expect.poll(() => rootVar(win, '--throng-colour-confirmButtonBg'), { timeout: 8000 }).toBe(V.confirmButtonBg);
      const prefs = await openThemes(app, win);
      await expect.poll(() => rootVar(prefs, '--throng-colour-confirmButtonBg'), { timeout: 8000 }).toBe(V.confirmButtonBg);

      // --- IconButton exclusion: a toolbar IconButton uses hoverSurface, none of the button tokens. ---
      const iconBtn = prefs.getByTestId('theme-restore-all');
      const iconRest = await styleOf(iconBtn);
      const buttonBgs = [V.confirmButtonBg, V.cancelButtonBg, V.destroyButtonBg, V.confirmButtonHoverBg, V.cancelButtonHoverBg, V.destroyButtonHoverBg].map(rgb);
      expect(buttonBgs).not.toContain(iconRest.bg); // rest is transparent, not any button surface
      await iconBtn.hover();
      // Poll for the actual hover background rather than guessing how long the repaint takes.
      await expect
        .poll(() => iconBtn.evaluate((n) => getComputedStyle(n).backgroundColor), { timeout: 5000 })
        .toBe(rgb(V.hoverSurface));

      // --- Confirm + Cancel: the name dialog's primary and dismiss buttons. ---
      await prefs.getByTestId('theme-clone').click();
      await expect(prefs.getByTestId('theme-name-dialog')).toBeVisible();

      const confirm = await restAndHover(prefs.getByTestId('theme-name-confirm'));
      expect(confirm.rest).toEqual({ bg: rgb(V.confirmButtonBg), color: rgb(V.confirmButtonText), border: rgb(V.confirmButtonBorder) });
      expect(confirm.hover).toEqual({ bg: rgb(V.confirmButtonHoverBg), color: rgb(V.confirmButtonHoverText), border: rgb(V.confirmButtonHoverBorder) });

      const cancel = await restAndHover(prefs.getByTestId('theme-name-cancel'));
      expect(cancel.rest).toEqual({ bg: rgb(V.cancelButtonBg), color: rgb(V.cancelButtonText), border: rgb(V.cancelButtonBorder) });
      expect(cancel.hover).toEqual({ bg: rgb(V.cancelButtonHoverBg), color: rgb(V.cancelButtonHoverText), border: rgb(V.cancelButtonHoverBorder) });

      await prefs.getByTestId('theme-name-cancel').click();
      await expect(prefs.getByTestId('theme-name-dialog')).toBeHidden();

      // --- Destroy + Cancel: the delete confirmation's danger and plain buttons. ---
      await prefs.getByTestId('theme-delete').click();
      await expect(prefs.getByTestId('theme-delete-confirm')).toBeVisible();

      const destroy = await restAndHover(prefs.getByTestId('theme-confirm-yes'));
      expect(destroy.rest).toEqual({ bg: rgb(V.destroyButtonBg), color: rgb(V.destroyButtonText), border: rgb(V.destroyButtonBorder) });
      expect(destroy.hover).toEqual({ bg: rgb(V.destroyButtonHoverBg), color: rgb(V.destroyButtonHoverText), border: rgb(V.destroyButtonHoverBorder) });

      const cancel2 = await restAndHover(prefs.getByTestId('theme-confirm-no'));
      expect(cancel2.rest).toEqual({ bg: rgb(V.cancelButtonBg), color: rgb(V.cancelButtonText), border: rgb(V.cancelButtonBorder) });
      expect(cancel2.hover).toEqual({ bg: rgb(V.cancelButtonHoverBg), color: rgb(V.cancelButtonHoverText), border: rgb(V.cancelButtonHoverBorder) });

      await prefs.getByTestId('theme-confirm-no').click();
    },
  );
});
