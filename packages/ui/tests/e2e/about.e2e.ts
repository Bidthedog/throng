import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { cleanupTemp, shutdownApp, DAEMON_READY_TIMEOUT_MS } from './harness.js';

/**
 * ══ ONE APP FOR THE FILE (034 FR-045) ══
 *
 * **Launches: 5 Electron apps + 5 daemons BEFORE → 1 app + 1 daemon AFTER.**
 *
 * This file creates no projects, seeds nothing before launch, relaunches nothing, and every
 * assertion is either a constant read from the root `package.json` or relative to what the test
 * itself just did. Check that again against the tests below: the version, the copyright holder, the
 * licence text and the third-party list are properties of the BUILD, and test 4's window count is
 * expressed as a delta (`beforeCount`), which survives any number of leftovers.
 *
 * ══ THE FIX THAT MADE IT SHAREABLE ══
 *
 * Exactly one thing stopped it: the About window is a SINGLETON by requirement (FR-003, "one entry
 * point, one dialog") and APP-MODAL (`about-window.ts` calls `setEnabled(false)` on every other
 * window while it is open). Four of the five tests opened it and never closed it. Under one shared
 * app that is not a degraded assertion, it is a HANG: both entry-point helpers wait for a new
 * `window` event, the main process would merely focus the window already open, no event would ever
 * fire, and the helper would wait out the whole 60s test budget — with the main window disabled, so
 * the cog click could not land either.
 *
 * The fix is the `afterEach` below: close any window whose URL carries `about=1`. Nothing in any
 * test body changed — no assertion, no comment, no timing — because the leak was never in the
 * bodies, it was in what `run()` used to clean up by throwing the whole app away.
 *
 * `afterEach` rather than a `finally` per test on purpose: it also covers the case where a test
 * fails BETWEEN the window opening and the handle being captured, which a `finally` cannot see.
 *
 * ══ NO `mode: 'serial'` ══
 *
 * `fullyParallel: false` (playwright.config.ts) already pins a file to one worker, in order, so the
 * shared app can never be driven by two tests at once — which is the only thing serial mode would
 * add here. What it would ALSO add is skipping: these are five independent claims about one dialog,
 * and a failure in "the cog opens it" must not hide "the full AGPL text is present".
 */

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

/*
 * Temp dirs are tracked and removed ONCE, in a file-level `afterAll` — NOT by
 * `registerTempCleanup()`, which this file used to call.
 *
 * That helper installs an `afterEach` which deletes every directory `tmpDir()` has handed out and
 * empties the list. With one app per test that was right. With ONE app for the file it is fatal:
 * the first test's `afterEach` would delete the LIVE app's userData and config root out from under
 * it, and the failure would surface later, somewhere else, as an app that had lost its state.
 */
const ownedTempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  ownedTempDirs.push(dir);
  return dir;
}

function startDaemon(pipeName: string, dataDir: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [daemonEntry], {
    env: { ...process.env, THRONG_PIPE_NAME: pipeName, THRONG_DATABASE_PATH: join(dataDir, 'throng.db') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('daemon not ready')), DAEMON_READY_TIMEOUT_MS);
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
  const userData = tempDir('throng-ud-');
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userData}`],
    env: { ...process.env, THRONG_PIPE_NAME: pipeName, THRONG_CONFIG_ROOT: tempDir('throng-cfg-') },
  });
}

/*
 * The one app, one daemon and one main window every test below drives.
 *
 * Deliberately the FILE'S OWN launch rather than `harness.openApp()`. `openApp()` additionally
 * stubs `shell.openPath`/`showItemInFolder`, sets `THRONG_E2E_CLIPBOARD=memory` and
 * `THRONG_NO_ORPHAN_REAP`, and strips `CLAUDE_*`/`ANTHROPIC_*` — none of which this file has ever
 * run against. The About window is the one surface in the app that is MADE of external links, so
 * changing shell stubbing underneath it would change what is under test at the same moment as
 * changing how often it launches.
 */
let daemon: ChildProcess;
let dataDir: string;
let app: ElectronApplication;
let win: Page;

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'throng-e2e-about-'));
  const pipeName = `\\\\.\\pipe\\throng-e2e-about-${process.pid}-${Date.now()}`;
  daemon = await startDaemon(pipeName, dataDir);
  app = await launchApp(pipeName);
  win = await app.firstWindow();
});

/**
 * Close the About window this test opened — the whole of what made this file shareable.
 *
 * It is a singleton AND app-modal, so leaving it open does two things to the next test: its
 * `waitForEvent('window')` waits for an event that can never fire (the main process focuses the
 * existing window instead of creating one), and the main window stays `setEnabled(false)` so the
 * cog click that would have opened it cannot land either. Both are hangs, not failures.
 *
 * Closing it is enough to make the next test's open a genuine open: `about-window.ts` nulls its
 * singleton reference and re-enables every window in the window's own `closed` handler. The poll is
 * what waits for that handler to have run — a closed Page is not yet a closed BrowserWindow.
 */
test.afterEach(async () => {
  if (!app) return; // beforeAll failed; there is nothing to clean up
  for (const page of app.windows()) {
    if (!page.isClosed() && page.url().includes('about=1')) await page.close().catch(() => {});
  }
  await expect
    .poll(() => app.windows().filter((w) => w.url().includes('about=1')).length, { timeout: 5000 })
    .toBe(0);
});

test.afterAll(async () => {
  if (app) await shutdownApp(app);
  if (daemon) await stopDaemon(daemon);
  if (dataDir) cleanupTemp(dataDir);
  for (const dir of ownedTempDirs.splice(0)) cleanupTemp(dir);
});

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

test('The cog menu has an "About throng" item that opens the About window (the discoverable entry point)', { tag: ['@extended', '@window'] }, async () => {
  const about = await openAboutViaCog(win, app);
  await expect(about.getByTestId('about-window')).toBeVisible();
  // It is the same About surface, showing the authoritative PRODUCT version (FR-001/FR-003) —
  // the root package.json version, not Electron's app.getVersion().
  await expect(about.getByTestId('about-version')).toHaveText(PRODUCT_VERSION);
});

test('About shows the product version (not Electron\'s), the copyright holder, the new title, close-only chrome, and third-party licences', { tag: ['@extended', '@window'] }, async () => {
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

test('About throng shows version + build id as selectable text, copyright, licence link and the full AGPL text', { tag: ['@extended', '@window'] }, async () => {
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

test('Reopening About focuses the single window rather than opening a second', { tag: ['@extended', '@window'] }, async () => {
  const about = await openAboutViaMenu(app);
  await expect(about.getByTestId('about-window')).toBeVisible();

  // A DELTA, not a literal — which is exactly why this test survives a shared app untouched: it
  // never claims how many windows exist, only that reopening adds none.
  const beforeCount = app.windows().length;

  // Click Help → About throng again: it must focus the existing window (FR-003 —
  // one entry point, one dialog), not spawn another.
  await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const help = menu?.items.find((i) => i.label === 'Help');
    const item = help?.submenu?.items.find((i) => i.label === 'About throng');
    item?.click();
  });

  // Focusing back onto the EXISTING window is the visible effect of the reopen path completing
  // (about-window.ts's create-or-focus branch calls `.focus()` synchronously) — wait for that
  // rather than a fixed pause, then assert no second window was created.
  await expect.poll(() => about.evaluate(() => document.hasFocus())).toBe(true);
  expect(app.windows().length).toBe(beforeCount);
});

test('The About Close button dismisses the window', { tag: ['@extended', '@window'] }, async () => {
  const about = await openAboutViaMenu(app);
  await expect(about.getByTestId('about-window')).toBeVisible();

  const closed = about.waitForEvent('close');
  await about.getByTestId('about-close').click();
  await closed;
  expect(about.isClosed()).toBe(true);
});
