import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadFirstDocument } from '../../src/main/first-load.js';

/**
 * #286 — "no new window was created for sub-workspace sw1".
 *
 * ══ WHAT THE STRESS RUN CAUGHT ══
 *
 * Stress run 39632667614, round 94 of 100 of `theme-flash.e2e.ts`. The open IPC reached main 41 ms
 * after the click, no window was ever created, and nothing was logged about the open. `main.log` held
 * exactly one thing after the two startup lines:
 *
 *   ERROR [ui-main] unhandledRejection: Error: ERR_ABORTED (-3) loading 'file:///…/renderer/index.html'
 *
 * The spec reloads the main window as its first act (`activateTheme`). When that reload starts before
 * the initial `loadFile` has finished, Electron rejects the `loadFile` promise with ERR_ABORTED.
 * `createMainWindow` awaited it, startup awaits `createMainWindow` inside `app.whenReady().then(async
 * …)`, and that callback has no catch — so the REST OF STARTUP never ran. Everything registered after
 * `createMainWindow` was missing for that whole app, `throng:subworkspace:open` among it: an
 * `ipcMain.on` channel with no listener drops the message silently, which is exactly "IPC received,
 * nothing created, nothing logged". (The probe's `ipc` timestamp came from the test's OWN listener on
 * that channel, so it never said the app's listener existed.)
 *
 * Everything the spec drove before the open — the theme, About, Preferences, the seed RPC — is
 * registered BEFORE `createMainWindow`, which is why the run got as far as the sub-workspace at all.
 *
 * ══ THE FAKE ══
 *
 * `FakeContents` models the Electron sequence that matters: `load()` returns the pending load promise;
 * `reload()` aborts it the way `webContents.loadURL` does (`rejectAndCleanup` on the next
 * main-frame navigation) and starts a new navigation; `finish()` / `fail()` end the current one.
 */

class FakeContents extends EventEmitter {
  private pending: { resolve: () => void; reject: (e: Error) => void } | null = null;

  /** What `window.loadFile(...)` returns. */
  load = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      this.pending = { resolve, reject };
    });

  /** `location.reload()` from the renderer while the first load is in flight. */
  reload(): void {
    const p = this.pending;
    this.pending = null;
    // Electron's own shape: `${errorDescription} (${errorCode}) loading '${url}'`, errno + code attached.
    const error = Object.assign(new Error("ERR_ABORTED (-3) loading 'file:///renderer/index.html'"), {
      errno: -3,
      code: 'ERR_ABORTED',
      url: 'file:///renderer/index.html',
    });
    p?.reject(error);
    this.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'file:///renderer/index.html', true);
  }

  /** The current navigation completes. */
  finish(): void {
    const p = this.pending;
    this.pending = null;
    this.emit('did-finish-load');
    p?.resolve();
  }

  /** The current navigation fails for real. */
  fail(code: number, description: string): void {
    const p = this.pending;
    this.pending = null;
    p?.reject(Object.assign(new Error(`${description} (${code}) loading 'x'`), { errno: code, code: description }));
    this.emit('did-fail-load', {}, code, description, 'file:///renderer/index.html', true);
  }
}

/** Settle state of a promise without awaiting it forever. */
async function settled(p: Promise<unknown>): Promise<'resolved' | 'pending' | `rejected: ${string}`> {
  let state: 'resolved' | 'pending' | `rejected: ${string}` = 'pending';
  p.then(
    () => (state = 'resolved'),
    (e: unknown) => (state = `rejected: ${e instanceof Error ? e.message : String(e)}`),
  );
  // Several macrotask turns: enough for every chained microtask to run.
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  return state;
}

describe('the main window first load (#286)', () => {
  it('a reload that aborts the first load, then completes, counts as loaded — startup carries on', async () => {
    const contents = new FakeContents();
    const startup = loadFirstDocument(contents, contents.load);

    contents.reload(); // the spec's `activateTheme` reload, landing before the first load finished
    contents.finish(); // ...and the reloaded document finishes

    expect(await settled(startup)).toBe('resolved');
  });

  it('does not count the abort itself as loaded — it waits for the document that replaced it', async () => {
    const contents = new FakeContents();
    const startup = loadFirstDocument(contents, contents.load);

    contents.reload();

    expect(await settled(startup)).toBe('pending');
    contents.finish();
    expect(await settled(startup)).toBe('resolved');
  });

  it('survives two reloads in a row', async () => {
    const contents = new FakeContents();
    const startup = loadFirstDocument(contents, contents.load);

    contents.reload();
    contents.reload();
    contents.finish();

    expect(await settled(startup)).toBe('resolved');
  });

  it('an ordinary first load resolves as before', async () => {
    const contents = new FakeContents();
    const startup = loadFirstDocument(contents, contents.load);

    contents.finish();

    expect(await settled(startup)).toBe('resolved');
  });

  it('a first load that genuinely fails still rejects — only an abort is forgiven', async () => {
    const contents = new FakeContents();
    const startup = loadFirstDocument(contents, contents.load);

    contents.fail(-6, 'ERR_FILE_NOT_FOUND');

    expect(await settled(startup)).toMatch(/^rejected: ERR_FILE_NOT_FOUND/);
  });

  it('a reload whose own load then fails rejects with that failure', async () => {
    const contents = new FakeContents();
    const startup = loadFirstDocument(contents, contents.load);

    contents.reload();
    contents.fail(-6, 'ERR_FILE_NOT_FOUND');

    expect(await settled(startup)).toMatch(/ERR_FILE_NOT_FOUND/);
  });

  it('a window destroyed after the abort rejects rather than hanging startup forever', async () => {
    const contents = new FakeContents();
    const startup = loadFirstDocument(contents, contents.load);

    contents.reload();
    contents.emit('destroyed');

    expect(await settled(startup)).toMatch(/^rejected: /);
  });

  it('leaves no listeners behind once settled', async () => {
    const contents = new FakeContents();
    const startup = loadFirstDocument(contents, contents.load);
    contents.reload();
    contents.finish();
    await startup;

    expect(contents.listenerCount('did-finish-load')).toBe(0);
    expect(contents.listenerCount('did-fail-load')).toBe(0);
    expect(contents.listenerCount('destroyed')).toBe(0);
  });
});

describe('main.ts routes the main window through it (#286)', () => {
  const main = readFileSync(fileURLToPath(new URL('../../src/main/main.ts', import.meta.url)), 'utf8');
  const body = main.slice(main.indexOf('async function createMainWindow('), main.indexOf('function rendererQuery('));

  it('createMainWindow awaits loadFirstDocument, never a bare loadFile', () => {
    expect(body).toMatch(/await loadFirstDocument\(window\.webContents,/);
    expect(body).not.toMatch(/await window\.load(File|URL)\(/);
  });

  it('the sub-workspace open handler is registered after createMainWindow — why the abort cost it', () => {
    // Pins the precondition the first describe block relies on. If this ever stops being true the
    // abort would no longer silence the open, but the reasoning in this file would be stale.
    expect(main.indexOf("ipcMain.on('throng:subworkspace:open'")).toBeGreaterThan(
      main.indexOf('const mainWindow = await createMainWindow('),
    );
  });
});
