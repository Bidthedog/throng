import { test, expect } from '@playwright/test';
import { openApp, type OpenApp } from './harness.js';

/**
 * 080 FR-048, FR-049 — Help opens in ONE throng Help window, on the guide shipped with the app.
 *
 * Help opens it on the guide's start page, served by the read-only `throng-help:` scheme from the build's own bundle
 * (no network, no OS browser). A second Help request — a (?) — loads its page into the SAME window rather than
 * opening another, and the window is never kept on top. Both go through `window.throng.openHelp`, the one entry F1,
 * the cog menu's Help and every (?) share (their own wiring is component-tested: `window-help-key`, `help-surfaces`);
 * a synthetic F1 here would test Playwright's focus, not throng.
 *
 * Why E2E: only a real Electron process has a second BrowserWindow, a WebContentsView on its own session, and a
 * privileged scheme answering from `packages/ui/dist/help`. The decisions are unit-tested (`help-protocol`,
 * `help-window-model`, `decideHelpNavigation`); this proves they are wired. In the serial tier (FOCUS): it opens a
 * second window, which takes focus from the first.
 *
 * One app for the file: nothing is seeded before launch, and the Help window is closed after each test. The last
 * test closes a main window, so it runs on an app of its own.
 */

test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});
test.afterEach(async () => {
  await shared.app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('help=1')) w.close();
  });
});

/** Every Help window: how many, the guide view's URL in the first, and whether it is kept on top. */
const helpWindows = (): Promise<{ count: number; viewUrl: string; onTop: boolean }> =>
  shared.app.evaluate(({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.webContents.getURL().includes('help=1'));
    const view = wins[0]?.contentView.children[0] as { webContents?: { getURL(): string } } | undefined;
    return { count: wins.length, viewUrl: view?.webContents?.getURL() ?? '', onTop: wins[0]?.isAlwaysOnTop() ?? false };
  });

test('Help opens one Help window on the shipped guide, and a (?) reuses it', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const { win } = shared;
  await win.evaluate(() => window.throng?.openHelp?.('throng-help://app/guide/'));

  await expect.poll(async () => (await helpWindows()).viewUrl, { timeout: 15_000 }).toBe('throng-help://app/guide/');
  expect(await helpWindows()).toMatchObject({ count: 1, onTop: false });

  // A (?) — any Help route — loads its page into the same window.
  await win.evaluate(() => window.throng?.openHelp?.('throng-help://app/guide/terminals/#open-a-terminal'));
  await expect.poll(async () => (await helpWindows()).viewUrl, { timeout: 15_000 }).toBe(
    'throng-help://app/guide/terminals/#open-a-terminal',
  );
  expect((await helpWindows()).count).toBe(1);
});

/** The guide view's webContents in the one Help window, evaluated in main. */
const inGuide = <T>(script: string): Promise<T> =>
  shared.app.evaluate(async ({ BrowserWindow }, code) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes('help=1'));
    const view = w?.contentView.children[0] as unknown as { webContents: Electron.WebContents } | undefined;
    return view ? ((await view.webContents.executeJavaScript(code)) as never) : (null as never);
  }, script);

test('the navigation shows the open page, however low it sits in the list (FR-053)', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  const { win, app } = shared;
  await win.evaluate(() => window.throng?.openHelp?.('throng-help://app/guide/'));
  await expect.poll(async () => (await helpWindows()).viewUrl, { timeout: 15_000 }).toBe('throng-help://app/guide/');
  // Short enough that the page list scrolls, then open the list's last page.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('help=1'))?.setSize(1000, 480);
  });
  const last = await inGuide<string>("[...document.querySelectorAll('.guide-nav a')].pop().href");
  await win.evaluate((url) => window.throng?.openHelp?.(url), last);
  await expect.poll(async () => (await helpWindows()).viewUrl, { timeout: 15_000 }).toBe(last);

  const seen = await inGuide<{ scrolls: boolean; inView: boolean }>(`(() => {
    const nav = document.querySelector('.guide-nav');
    const here = nav.querySelector('a[aria-current="page"]');
    const a = nav.getBoundingClientRect(), b = here.getBoundingClientRect();
    return { scrolls: nav.scrollHeight > nav.clientHeight, inView: b.top >= a.top && b.bottom <= a.bottom };
  })()`);
  expect(seen.scrolls, 'the page list must overflow for this test to mean anything').toBe(true);
  expect(seen.inView).toBe(true);
});

test('a hovered link shows its address and kind in one popover at the bottom left (FR-062)', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const { win } = shared;
  await win.evaluate(() => window.throng?.openHelp?.('throng-help://app/guide/'));
  await expect.poll(async () => (await helpWindows()).viewUrl, { timeout: 15_000 }).toBe('throng-help://app/guide/');
  // The pointer cannot reach the guide view from Playwright's page (the main window), so the page's own pointer
  // events are dispatched in it: the wiring under test is the guide's, not the OS's hit-testing.
  const hover = (selector: string): Promise<{ shown: boolean; kind: string; address: string; count: number; left: number; bottomGap: number }> =>
    inGuide(`(async () => {
      const link = document.querySelector(${JSON.stringify(selector)});
      link.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      const pop = document.querySelector('.link-status');
      const box = pop.getBoundingClientRect();
      return { shown: pop.classList.contains('shown'), kind: pop.querySelector('.link-status__kind').textContent,
        address: pop.querySelector('.link-status__address').textContent, count: document.querySelectorAll('.link-status').length,
        left: box.left, bottomGap: window.innerHeight - box.bottom };
    })()`);
  const inside = await hover('.guide-nav a');
  expect(inside).toMatchObject({ shown: true, kind: 'In the guide', count: 1 });
  expect(inside.address).toMatch(/^\/guide\//);
  expect(inside.left).toBeLessThan(20);
  expect(inside.bottomGap).toBeLessThan(20);

  const outside = await hover('a[href^="https://github.com"]');
  expect(outside).toMatchObject({ shown: true, kind: 'External', count: 1 });
  expect(outside.address).toMatch(/^https:\/\/github\.com\//);

  // A shipped link to the website's home page goes to the browser (FR-050): the local preview, unpackaged (FR-065).
  const website = await hover('header a[href="/#features"]');
  expect(website).toMatchObject({ shown: true, kind: 'External', address: 'http://localhost:8080/#features' });

  const left = await inGuide<boolean>(`(() => {
    const link = document.querySelector('a[href^="https://github.com"]');
    link.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
    return document.querySelector('.link-status').classList.contains('shown');
  })()`);
  expect(left).toBe(false);
});

test('an external link asks first; Cancel opens nothing and Open opens it (FR-063)', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const own = await openApp({ externalLinkPrompt: true });
  try {
    await own.app.evaluate(({ shell }) => {
      const g = globalThis as unknown as { __opened: string[] };
      g.__opened = [];
      shell.openExternal = async (url: string) => {
        g.__opened.push(url);
      };
    });
    const opened = (): Promise<string[]> => own.app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened);
    await own.win.evaluate(() => window.throng?.openHelp?.('throng-help://app/guide/'));
    const clickGitHub = (): Promise<unknown> =>
      own.app.evaluate(async ({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes('help=1'));
        const view = w?.contentView.children[0] as unknown as { webContents: Electron.WebContents } | undefined;
        if (!view) return false;
        await view.webContents.executeJavaScript(
          `new Promise((r) => { const go = () => { const a = document.querySelector('a[href^="https://github.com"]'); if (a) { a.click(); r(true); } else setTimeout(go, 100); }; go(); })`,
        );
        return true;
      });
    // FR-070 — the prompt is drawn inline in the window the link was followed in: here, the Help window's own page.
    const helpPage = () => own.app.windows().find((p) => p.url().includes('help=1'));
    const prompt = async () => {
      // Playwright registers the Help window's page some time after the window opens: wait for it before asking it.
      await expect.poll(() => helpPage() !== undefined, { timeout: 15_000 }).toBe(true);
      const page = helpPage()!;
      await expect(page.getByTestId('link-prompt')).toBeVisible({ timeout: 15_000 });
      return page;
    };

    await expect.poll(clickGitHub, { timeout: 15_000 }).toBe(true);
    const first = await prompt();
    await expect(first.getByTestId('link-prompt-url')).toHaveText(/^https:\/\/github\.com\//);
    // The guide's view is swapped for a still of itself, so the dialog covers the whole window; no window opened.
    await expect(first.getByTestId('help-cover')).toBeVisible();
    expect(own.app.windows().some((p) => p.url().includes('linkPrompt'))).toBe(false);
    // It blocks its own window only: the main window carries no prompt and takes input.
    await expect(own.win.getByTestId('link-prompt')).toHaveCount(0);
    await first.getByTestId('link-prompt-cancel').click();
    await expect(first.getByTestId('link-prompt')).toHaveCount(0, { timeout: 10_000 });
    await expect(first.getByTestId('help-cover')).toHaveCount(0);
    expect(await opened()).toEqual([]);

    await clickGitHub();
    const second = await prompt();
    await second.getByTestId('link-prompt-open').click();
    await expect.poll(opened, { timeout: 10_000 }).toEqual([expect.stringMatching(/^https:\/\/github\.com\//)]);
  } finally {
    await own.close().catch(() => undefined);
  }
});

test('closing the main window closes the Help window with it (FR-054)', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  const own = await openApp();
  try {
    await own.win.evaluate(() => window.throng?.openHelp?.('throng-help://app/guide/'));
    // Both windows on screen first: the main window is the one that is not Help.
    await expect
      .poll(
        () =>
          own.app.evaluate(({ BrowserWindow }) => {
            const wins = BrowserWindow.getAllWindows().filter((w) => w.isVisible());
            return wins.some((w) => w.webContents.getURL().includes('help=1')) && wins.some((w) => !w.webContents.getURL().includes('help=1'));
          }),
        { timeout: 15_000 },
      )
      .toBe(true);
    // Gone means no Help window left, or no app left to ask: with Help still open the app could not have quit.
    const helpLeft = (): Promise<number> =>
      own.app
        .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.webContents.getURL().includes('help=1')).length)
        .catch(() => 0);
    await own.app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) if (w.isVisible() && !w.webContents.getURL().includes('help=1')) w.close();
    });
    // A running terminal makes the close ask first (067); leaving it running is the answer that closes throng.
    await own.win
      .getByTestId('app-close-leave')
      .click({ timeout: 3_000 })
      .catch(() => undefined);
    await expect.poll(helpLeft, { timeout: 15_000 }).toBe(0);
  } finally {
    await own.close().catch(() => undefined);
  }
});
