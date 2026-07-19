import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';
import { tmpDir, registerTempCleanup } from './temp-file-helpers.js';

registerTempCleanup();
import type { ElectronApplication, Page } from '@playwright/test';

const mainEntry = fileURLToPath(new URL('../../dist/main/main.js', import.meta.url));
const daemonEntry = fileURLToPath(new URL('../../../daemon/dist/main.js', import.meta.url));

// The single authoritative product version + copyright holder (FR-001/003): the ROOT
// package.json — the same source the About dialog reads (NOT app.getVersion(), which reports
// Electron's own version when the app runs unpackaged).
const rootPkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../package.json', import.meta.url)), 'utf8'),
) as { version: string; author?: string | { name?: string } };
const PRODUCT_VERSION = rootPkg.version;
const PRODUCT_AUTHOR =
  typeof rootPkg.author === 'string' ? rootPkg.author : (rootPkg.author?.name ?? '');

function startDaemon(pipeName: string, dataDir: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [daemonEntry], {
    env: { ...process.env, THRONG_PIPE_NAME: pipeName, THRONG_DATABASE_PATH: join(dataDir, 'throng.db') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('daemon not ready')), 10_000);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => {
      if (c.includes('listening')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function stopDaemon(daemon: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    daemon.once('exit', () => resolve());
    daemon.kill();
    setTimeout(resolve, 3000);
  });
}

function launchApp(pipeName: string): Promise<ElectronApplication> {
  const userData = tmpDir('throng-ud-');
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userData}`],
    env: { ...process.env, THRONG_PIPE_NAME: pipeName, THRONG_CONFIG_ROOT: tmpDir('throng-cfg-') },
  });
}

async function run(fn: (app: ElectronApplication, win: Page) => Promise<void>): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-e2e-about-'));
  const pipeName = `\\\\.\\pipe\\throng-e2e-about-${process.pid}-${Date.now()}`;
  const daemon = await startDaemon(pipeName, dataDir);
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(pipeName);
    const win = await app.firstWindow();
    await fn(app, win);
  } finally {
    if (app) await app.close();
    await stopDaemon(daemon);
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

/**
 * Open the About window by driving the REAL native application menu item
 * (Help → About throng) — the spec-required entry point (FR-003) — via the main
 * process, then return the new BrowserWindow's Page once it has loaded.
 */
async function openAboutViaMenu(app: ElectronApplication): Promise<Page> {
  const clicked = await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) return false;
    const help = menu.items.find((i) => i.label === 'Help');
    const about = help?.submenu?.items.find((i) => i.label === 'About throng');
    if (!about) return false;
    about.click();
    return true;
  });
  expect(clicked, 'Help → About throng menu item is present and clickable').toBe(true);

  const aboutWin = await app.waitForEvent('window', {
    predicate: (w) => w.url().includes('about=1'),
  });
  await aboutWin.waitForLoadState('domcontentloaded');
  return aboutWin;
}

/**
 * Open the About window the way a user actually does it (020, FR-003): click the cog
 * in throng's own title bar, then choose "About throng". This is the DISCOVERABLE
 * entry point — the native application menu never renders because every window is
 * `frame: false`. Returns the About window's Page once it has loaded.
 */
async function openAboutViaCog(win: Page, app: ElectronApplication): Promise<Page> {
  await win.getByTestId('title-bar-cog').click();
  await win.getByTestId('cog-menu-about').click();

  const aboutWin = await app.waitForEvent('window', {
    predicate: (w) => w.url().includes('about=1'),
  });
  await aboutWin.waitForLoadState('domcontentloaded');
  return aboutWin;
}

test('The cog menu has an "About throng" item that opens the About window (the discoverable entry point)', async () => {
  await run(async (app, win) => {
    const about = await openAboutViaCog(win, app);
    await expect(about.getByTestId('about-window')).toBeVisible();
    // It is the same About surface, showing the authoritative PRODUCT version (FR-001/FR-003) —
    // the root package.json version, not Electron's app.getVersion().
    await expect(about.getByTestId('about-version')).toHaveText(PRODUCT_VERSION);
  });
});

test('About shows the product version (not Electron\'s), the copyright holder, the new title, close-only chrome, and third-party licences', async () => {
  await run(async (app, win) => {
    const about = await openAboutViaCog(win, app);
    await expect(about.getByTestId('about-window')).toBeVisible();

    // Version is the product version — and specifically NOT Electron's own version, the bug this
    // fixes (running unpackaged, app.getVersion() returns Electron's, e.g. 43.0.0).
    const electronVersion = await app.evaluate(({ app: a }) => a.getVersion());
    await expect(about.getByTestId('about-version')).toHaveText(PRODUCT_VERSION);
    expect(PRODUCT_VERSION).not.toBe(electronVersion);

    // Copyright names the real author from package.json, not "throng contributors".
    const copyright = about.getByTestId('about-copyright');
    await expect(copyright).toContainText(PRODUCT_AUTHOR);
    await expect(copyright).not.toContainText('contributors');

    // Title bar reads "About — throng".
    await expect(about.getByTestId('title-bar-identity')).toHaveText('About — throng');

    // Only a close control — no minimise/maximise on a fixed-size dialog.
    await expect(about.getByTestId('window-close')).toBeVisible();
    await expect(about.getByTestId('window-min')).toHaveCount(0);
    await expect(about.getByTestId('window-max')).toHaveCount(0);

    // Third-party packages: the FULL production closure, not just the root's direct deps — so
    // transitive deps the UI pulls in (e.g. @codemirror/view) must appear, and there must be many.
    const thirdParty = about.getByTestId('about-thirdparty');
    await expect(thirdParty).toContainText('better-sqlite3');
    await expect(thirdParty).toContainText('@codemirror/view');
    expect(await thirdParty.getByRole('listitem').count()).toBeGreaterThan(50);
    // A live, canonical link to each licence (SPDX) and to the project page (https GitHub).
    const licenceLink = thirdParty.getByRole('link', { name: 'MIT' }).first();
    await expect(licenceLink).toHaveAttribute('href', /spdx\.org\/licenses\/MIT/);
    await expect(thirdParty.getByRole('link', { name: 'better-sqlite3' })).toHaveAttribute(
      'href',
      'https://github.com/WiseLibs/better-sqlite3',
    );

    // The throng licence link points at throng's own repo, and the repo base is on the page.
    await expect(about.getByTestId('about-licence-link')).toHaveAttribute(
      'href',
      /github\.com\/.+\/throng\/blob\/HEAD\/LICENSE/,
    );
    await expect(about.getByTestId('about-repo-link')).toHaveAttribute(
      'href',
      /github\.com\/.+\/throng$/,
    );
  });
});

test('About throng shows version + build id as selectable text, copyright, licence link and the full AGPL text', async () => {
  await run(async (app, _mainWin) => {
    const about = await openAboutViaMenu(app);

    // Positive settle: the About surface mounted.
    await expect(about.getByTestId('about-window')).toBeVisible();

    // Version equals the authoritative product version (FR-001) and is selectable text (FR-003).
    const version = about.getByTestId('about-version');
    await expect(version).toHaveText(PRODUCT_VERSION);
    await expect(version).toHaveCSS('user-select', 'text');

    // Build id is present and selectable (FR-003 / FR-006).
    const buildId = about.getByTestId('about-build-id');
    await expect(buildId).not.toHaveText('');
    await expect(buildId).toHaveCSS('user-select', 'text');

    // Copyright notice + licence link (FR-003a).
    await expect(about.getByTestId('about-copyright')).toBeVisible();
    const licenceLink = about.getByTestId('about-licence-link');
    await expect(licenceLink).toBeVisible();
    await expect(licenceLink).toHaveText(/AGPL-3\.0/);

    // Full AGPL-3.0 licence text in a read-only, scrollable region (FR-003a).
    const licence = about.getByTestId('about-licence-text');
    await expect(licence).toHaveValue(/GNU AFFERO GENERAL PUBLIC LICENSE/);
    await expect(licence).toHaveValue(/Version 3, 19 November 2007/);
    await expect(licence).toHaveJSProperty('readOnly', true);
    await expect(licence).toHaveCSS('overflow-y', 'auto');
  });
});

test('Reopening About focuses the single window rather than opening a second', async () => {
  await run(async (app, _mainWin) => {
    const about = await openAboutViaMenu(app);
    await expect(about.getByTestId('about-window')).toBeVisible();

    const beforeCount = app.windows().length;

    // Click Help → About throng again: it must focus the existing window (FR-003 —
    // one entry point, one dialog), not spawn another.
    await app.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      const help = menu?.items.find((i) => i.label === 'Help');
      const item = help?.submenu?.items.find((i) => i.label === 'About throng');
      item?.click();
    });

    // Give any (erroneous) second window a chance to appear, then assert none did.
    await about.waitForTimeout(300);
    expect(app.windows().length).toBe(beforeCount);
  });
});

test('The About Close button dismisses the window', async () => {
  await run(async (app, _mainWin) => {
    const about = await openAboutViaMenu(app);
    await expect(about.getByTestId('about-window')).toBeVisible();

    const closed = about.waitForEvent('close');
    await about.getByTestId('about-close').click();
    await closed;
    expect(about.isClosed()).toBe(true);
  });
});
