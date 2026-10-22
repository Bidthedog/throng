import { copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { NEW_WINDOW_TIMEOUT_MS } from '../harness.js';

/**
 * #286: open a sub-workspace window from the list, and say where the open stopped if no window
 * appears.
 *
 * ══ WHY EVERY SPEC GOES THROUGH HERE ══
 *
 * #286 is a first sub-workspace open that produces no window, about 1 in 440 on a hosted runner. It
 * was first seen in `theme-flash.e2e.ts`, then in `terminate-all-drain.e2e.ts:507`, a spec that had no
 * probes, so that sighting said nothing about where the open died. A probe that lives in one spec
 * only fires when the flake lands there. With every open routed through this helper, any sighting in
 * any spec, nightly or stress run, prints the same dump.
 *
 * ══ WHAT IT RECORDS, AND WHAT IT COSTS ══
 *
 * Each hop of the open: in the renderer, what the click hit; in main, the open IPC arriving, a
 * `BrowserWindow` being created, and a renderer dying. Installing the probes is two `evaluate` round
 * trips, each guarded so a listener is added once per app (main) and once per document (renderer).
 * Nothing else runs on a successful open; the dump happens only when no window appears.
 *
 * ══ HOW TO READ A `[#286]` LINE ══
 *
 * - the click is missing from `renderer.clicks` and `loaded` is "false": the click was lost;
 * - `loaded` is "true" and `main.probe.ipc` is empty: the IPC never reached main;
 * - `ipc` is set but `created` is empty: main did not create the window (see `main.log` and `notice`);
 * - `created` is set and main lists the `sw=` window, but `pw` does not: Playwright never surfaced
 *   the page.
 *
 * `ipc` and `created` are cumulative for the app, so compare them against `at`, the time the click
 * was issued.
 *
 * ══ POLLED, NOT EVENTED ══
 *
 * `app.waitForEvent('window')` catches the event only while its listener is attached, and a timeout
 * says nothing beyond "waiting for event". Polling the window list asks the actual question (is
 * there a new window?) and cannot miss a transition it was not listening for.
 */
export async function openSubWorkspaceWindow(
  app: ElectronApplication,
  win: Page,
  id: string,
  opts: { timeout?: number } = {},
): Promise<Page> {
  await installOpenProbes(app, win);
  const before = new Set(app.windows());
  const at = Date.now();
  await win.getByTestId(`subworkspace-open-${id}`).click();
  try {
    await expect
      .poll(() => app.windows().filter((w) => !before.has(w)).length, {
        timeout: opts.timeout ?? NEW_WINDOW_TIMEOUT_MS,
        message: `no new window was created for sub-workspace ${id}`,
      })
      .toBeGreaterThan(0);
  } catch (error) {
    await dumpOpenProbes(app, win, id, at);
    throw error;
  }
  const opened = app.windows().find((w) => !before.has(w));
  if (!opened) throw new Error('a new window was counted but could not be identified');
  return opened;
}

interface MainProbe {
  ipc: number[];
  created: Array<{ id: number; at: number }>;
  gone: string[];
}

/** Install the hop recorders. Idempotent per app (main) and per document (renderer). */
async function installOpenProbes(app: ElectronApplication, win: Page): Promise<void> {
  await app.evaluate(({ ipcMain, app: electronApp }) => {
    const g = globalThis as unknown as { __swProbe?: MainProbe };
    if (g.__swProbe) return;
    const probe: MainProbe = { ipc: [], created: [], gone: [] };
    g.__swProbe = probe;
    // An extra listener beside the app's own. It observes and handles nothing.
    ipcMain.on('throng:subworkspace:open', () => probe.ipc.push(Date.now()));
    electronApp.on('browser-window-created', (_e, w) => probe.created.push({ id: w.id, at: Date.now() }));
    electronApp.on('render-process-gone', (_e, wc, d) => probe.gone.push(`${wc.id}:${d.reason}`));
  });
  await win.evaluate(() => {
    const w = window as unknown as { __clicks?: string[] };
    if (w.__clicks) return;
    w.__clicks = [];
    document.addEventListener(
      'click',
      (e) => {
        const target = e.target as HTMLElement;
        w.__clicks!.push(target.closest('[data-testid]')?.getAttribute('data-testid') ?? target.tagName);
      },
      true,
    );
  });
}

/** How much of the end of `main.log` to print with the dump. */
const MAIN_LOG_TAIL_LINES = 40;

/**
 * Print every recorded hop as `[#286]` lines on stderr. The list reporter writes them into the run's
 * output, so `gh run view --log-failed` keeps them. Also prints the end of `main.log`, and keeps a
 * copy of the whole log beside the test's other artifacts.
 *
 * Never throws: it runs on a path that is already failing, and the original error must be the one
 * reported.
 */
async function dumpOpenProbes(app: ElectronApplication, win: Page, id: string, at: number): Promise<void> {
  const main = await app
    .evaluate(({ BrowserWindow, app: electronApp }) => ({
      probe: (globalThis as unknown as { __swProbe?: MainProbe }).__swProbe,
      userData: electronApp.getPath('userData'),
      wins: BrowserWindow.getAllWindows().map((w) => ({
        id: w.id,
        url: w.webContents.getURL(),
        visible: w.isVisible(),
        loading: w.webContents.isLoading(),
        crashed: w.webContents.isCrashed(),
      })),
    }))
    .catch((error: unknown) => String(error));
  const renderer = await win
    .evaluate(
      (swId) => ({
        clicks: (window as unknown as { __clicks?: string[] }).__clicks,
        loaded:
          document.querySelector(`[data-testid="subworkspace-item-${swId}"]`)?.getAttribute('data-loaded') ?? null,
        notice: document.querySelector('[data-testid="subworkspace-error"]')?.textContent ?? null,
        button:
          document.querySelector(`[data-testid="subworkspace-open-${swId}"]`)?.getBoundingClientRect().toJSON() ??
          null,
      }),
      id,
    )
    .catch((error: unknown) => String(error));
  const pw = app.windows().map((p) => p.url());
  const title = test.info().titlePath.join(' > ');
  console.warn('[#286]', JSON.stringify({ test: title, id, at, main, renderer, pw }));

  if (typeof main === 'string') return;
  const log = join(main.userData, 'logs', 'main.log');
  try {
    const tail = readFileSync(log, 'utf8').split(/\r?\n/).slice(-MAIN_LOG_TAIL_LINES);
    for (const line of tail) console.warn('[#286] main.log:', line);
  } catch {
    console.warn('[#286] main.log: (not readable)');
  }
  try {
    copyFileSync(log, test.info().outputPath('main.log'));
  } catch {
    /* no log to keep */
  }
}
