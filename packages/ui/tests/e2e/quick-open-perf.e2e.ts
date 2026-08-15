/**
 * 033 US1 (#219) — Quick Open's cost, and the index staying current.
 *
 * Covers SC-002's ARCHITECTURAL half (no keystroke touches the filesystem), FR-013's ceiling as it
 * is felt through Electron, FR-015 (a modal opened before enumeration finishes) and FR-016 / SC-005
 * (the candidate set tracks the disk while the app runs).
 *
 * ══ WHY THIS SPEC IS SERIAL (T027), AND WHY THE TIMED CASES LIVE HERE ══
 *
 * Two of the assertions below have a WALL-CLOCK CEILING, and contention breaks a wall-clock ceiling
 * without anything having regressed — measured elsewhere in this suite at 2039 ms against a 2000 ms
 * budget with six workers, where 1200 ms of it was grace by design. So this file runs at one worker,
 * and SC-005's two-second case was moved OUT of `quick-open.e2e.ts` into it for exactly that reason:
 * that spec is registered parallel on the express grounds that it asserts no ceiling.
 *
 * ══ THE TWO NUMBERS ARE NOT THE SAME NUMBER ══
 *
 * SC-002 says 100 ms. That is measured over the PURE pipeline — `compileQuery` → filter →
 * `rankFilePath` → `rankStable` → cap — at the unit layer, over 50,000 synthetic paths (T008). The
 * ceiling asserted here is 250 ms, deliberately looser, because this measurement additionally
 * carries Electron IPC, a React render and a paint. It is stated rather than omitted: a measurement
 * with no threshold asserts nothing at all, and would pass on an implementation that took a second.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  settle,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';
import { openQuickOpen, quickOpenRows, quickOpenRowPaths } from './helpers/navigation.js';

/*
 * ONE app for this file. No test here seeds state before launch — each builds its own project — and
 * an Electron launch per test would be pure cost on a file that is already the slowest in the
 * feature. The shim refuses options rather than ignoring them.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;

/**
 * ONE large fixture for the whole file, built once.
 *
 * Two tests need a project big enough to be worth measuring and a third needs one big enough that
 * ENUMERATING it outlasts a keypress (FR-015). Building it per test would spend most of the file's
 * wall-clock writing files, and the three tests do not modify it — only the live-index test writes,
 * and it has its own small tree for exactly that reason.
 */
const BIG_TREE_DIRS = 60;
const BIG_TREE_FILES_PER_DIR = 200; // 12,000 files
let bigRoot = '';

function createBigTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-qop-big-'));
  for (let d = 0; d < BIG_TREE_DIRS; d += 1) {
    const dir = join(root, 'src', `area-${String(d).padStart(3, '0')}`, 'components');
    mkdirSync(dir, { recursive: true });
    for (let f = 0; f < BIG_TREE_FILES_PER_DIR; f += 1) {
      const name = `widget-${String(f).padStart(4, '0')}.ts`;
      writeFileSync(join(dir, name), `// ${name}\n`);
    }
  }
  return root;
}

test.beforeAll(async () => {
  bigRoot = createBigTree();
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
  if (bigRoot !== '') cleanupTemp(bigRoot);
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

let projectSeq = 0;
const createProject = (win: Page, name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

/**
 * Record every `files.*` and `fileIndex.*` message the renderer sends, from the MAIN process.
 *
 * ══ WHY NOT IN THE PAGE, WHICH IS WHERE THE PLAN ASKED FOR IT ══
 *
 * Because it cannot be done there, and that was measured rather than assumed. `contextBridge`
 * exposes `window.throng` as a non-configurable, non-writable property whose namespace objects are
 * FROZEN — `Object.isFrozen(window.throng.files) === true`, and every one of the eighteen
 * assignments needed to wrap them is a silent no-op in a page that is not in strict mode. An
 * in-page recorder therefore installs successfully, records nothing, and reports "zero IPC calls"
 * about an application that made plenty. It is the exact shape of guard #244 exists to name, and it
 * would have passed for the wrong reason forever.
 *
 * The main process is the other end of the same wire, so it sees the same traffic:
 *
 *   - `invoke` channels live in `ipcMain._invokeHandlers`, keyed by channel. This is INTERNAL, and
 *     that is the reason for the return value: the caller asserts that the channels it cares about
 *     were actually found, so an Electron upgrade that renames the map fails this test loudly
 *     rather than making it vacuous.
 *   - `send` channels are ordinary EventEmitter events, so an extra listener is public API and
 *     rides alongside the real one.
 *
 * Only renderer → main traffic is recorded, which is the right half: FR-013 is about a KEYSTROKE
 * causing IPC, and an index update arriving from main while the user types was not caused by the
 * keystroke.
 */
async function instrumentMainIpc(
  app: OpenApp['app'],
): Promise<{ invoke: string[]; send: string[] }> {
  return app.evaluate(({ ipcMain }) => {
    const g = globalThis as unknown as { __ipcCalls?: string[] };
    g.__ipcCalls = [];
    const watched = /^throng:(files|fileIndex):/;
    const invoke: string[] = [];
    const send: string[] = [];

    const handlers = (
      ipcMain as unknown as {
        _invokeHandlers?: Map<string, (...args: unknown[]) => unknown>;
      }
    )._invokeHandlers;
    if (handlers) {
      for (const [channel, handler] of [...handlers]) {
        if (!watched.test(channel)) continue;
        handlers.set(channel, (...args: unknown[]) => {
          g.__ipcCalls!.push(channel);
          return handler(...args);
        });
        invoke.push(channel);
      }
    }

    for (const channel of ipcMain.eventNames()) {
      if (typeof channel !== 'string' || !watched.test(channel)) continue;
      ipcMain.on(channel, () => {
        g.__ipcCalls!.push(channel);
      });
      send.push(channel);
    }

    return { invoke, send };
  });
}

/** What the renderer has asked main to do since the last reset. */
const ipcCalls = (app: OpenApp['app']): Promise<string[]> =>
  app.evaluate(() => (globalThis as unknown as { __ipcCalls?: string[] }).__ipcCalls ?? []);

const resetIpcCalls = (app: OpenApp['app']): Promise<void> =>
  app.evaluate(() => {
    (globalThis as unknown as { __ipcCalls: string[] }).__ipcCalls = [];
  });

/* ────────────────────────────────────────────────────────────────────────────────────────────── */

test('typing performs no IPC at all — no files.* call and no fileIndex subscription on the keystroke path (SC-002, FR-013, R5)', async () => {
  // 12,000 files to write, a project to open and a walk to complete before the measurement starts.
  test.setTimeout(180_000);
  await runApp(async (app, win) => {
    await settle(win);

    /*
     * INSTRUMENT FIRST — before the project, so the recorder can be proved to RECORD.
     *
     * `throng:files:list` is shipped and definitely registered, so requiring it in the attach report
     * is a statement about the instrument rather than about this feature: if the internal handler
     * map is ever renamed, this line fails and names it.
     */
    const attached = await instrumentMainIpc(app);
    expect(attached.invoke, 'the IPC recorder never found the shipped files channels').toContain(
      'throng:files:list',
    );

    await createProject(win, 'QOPerfNoIpc', bigRoot);

    /*
     * …and the recorder demonstrably RECORDS. Opening a project reads the tree, which is `files.*`
     * traffic by construction. Without this line, an "empty array" at the end would be equally
     * consistent with a keystroke that did no IPC and with a recorder that was never wired to
     * anything — and those are the two worlds this test exists to tell apart.
     */
    await expect
      .poll(async () => (await ipcCalls(app)).some((c) => c.startsWith('throng:files:')))
      .toBe(true);

    await openQuickOpen(win);
    // Let the index settle to a real list first: the subscription itself is IPC and is entirely
    // legitimate (S2). What FR-013 forbids is IPC on the KEYSTROKE path.
    await expect(quickOpenRows(win).first()).toBeVisible();
    await resetIpcCalls(app);

    await win.keyboard.type('components/w');
    await expect(quickOpenRows(win).first()).toBeVisible();

    expect(await ipcCalls(app), 'a keystroke reached the filesystem').toEqual([]);

    await win.keyboard.press('Escape');
    await expect(win.getByTestId('quickopen')).toHaveCount(0);
  });
});

test('keystroke-to-list stays inside its stated ceiling on a realistic project (SC-002 as felt through Electron)', async () => {
  test.setTimeout(180_000);
  await runApp(async (_app, win) => {
    await settle(win);
    await createProject(win, 'QOPerfLatency', bigRoot);

    await openQuickOpen(win);
    await expect(quickOpenRows(win).first()).toBeVisible();

    /*
     * Measured INSIDE the page, around the keystroke.
     *
     * A Playwright round trip is the same order as the budget itself, so a measurement taken from
     * the test process would mostly be measuring the test process. `insertText` is CodeMirror's and
     * React's real input path — the same technique `editor-highlight-perf.e2e.ts` uses.
     *
     * Each sample waits for the LIST to change, not for a fixed period: the number recorded is
     * keystroke → rendered result. A keystroke that never changes the list resolves to Infinity and
     * fails the assertion loudly rather than hanging the test.
     */
    const samples: number[] = await win.evaluate(async () => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="quickopen-input"]');
      const list = document.querySelector('[data-testid="quickopen-list"]');
      if (!input || !list) return [Number.POSITIVE_INFINITY];
      const out: number[] = [];
      for (const ch of 'components/widget-01') {
        const start = performance.now();
        const changed = new Promise<number>((resolve) => {
          const observer = new MutationObserver(() => {
            observer.disconnect();
            resolve(performance.now());
          });
          observer.observe(list, { childList: true, subtree: true, characterData: true });
          setTimeout(() => {
            observer.disconnect();
            resolve(Number.POSITIVE_INFINITY);
          }, 5000);
        });
        input.focus();
        document.execCommand('insertText', false, ch);
        out.push((await changed) - start);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      return out;
    });

    // The WORST keystroke, not the average: an average of 40 ms with one 900 ms spike is a modal
    // that visibly stalls, and the average is exactly what would hide it.
    expect(Math.max(...samples)).toBeLessThanOrEqual(250);

    await win.keyboard.press('Escape');
    await expect(win.getByTestId('quickopen')).toHaveCount(0);
  });
});

test('a modal opened before enumeration finishes says it is still listing, then shows results (FR-015, S3)', async () => {
  test.setTimeout(180_000);
  await runApp(async (_app, win) => {
    await settle(win);
    await createProject(win, 'QOPerfBuilding', bigRoot);

    /*
     * The chord goes in immediately, while the walk of 12,000 files is still in flight.
     *
     * The fixture's SIZE is the lever that makes this observable: a keypress costs milliseconds and
     * enumerating twelve thousand files costs considerably more, so the building state is on screen
     * for long enough to be seen. If this ever becomes racy, the fixture grows — the answer is never
     * to soften the assertion into one a partial list would also satisfy, which is the failure S3
     * exists to prevent.
     */
    await openQuickOpen(win);
    await expect(win.getByTestId('quickopen-building')).toBeVisible();

    // …and then the real list, which is the second half of S3: a partial list must never be
    // presented as though it were whole.
    await expect(win.getByTestId('quickopen-building')).toHaveCount(0, { timeout: 30_000 });
    await win.keyboard.type('widget-0001');
    await expect(quickOpenRows(win)).toHaveCount(BIG_TREE_DIRS);

    await win.keyboard.press('Escape');
    await expect(win.getByTestId('quickopen')).toHaveCount(0);
  });
});

test('a file created and then deleted OUTSIDE throng becomes, and stops being, choosable within two seconds (FR-016, SC-005)', async () => {
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-qop-live-'));
  writeFileSync(join(root, 'anchor.txt'), '// anchor.txt\n');
  const created = join(root, 'appeared-later.txt');
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'QOPerfLive', root);

      await openQuickOpen(win);

      /*
       * The POSITIVE control first. `anchor.txt` being listed is what makes the next line — the new
       * file being absent — a statement about the index rather than about a list that never
       * rendered, which an unrendered DOM satisfies vacuously.
       */
      await win.keyboard.type('anchor');
      await expect(quickOpenRows(win)).toHaveCount(1);
      await win.getByTestId('quickopen-input').fill('appeared-later');
      await expect(quickOpenRows(win)).toHaveCount(0);

      // Created by something that is not throng — a terminal, an agent, another editor.
      writeFileSync(created, '// appeared-later.txt\n');
      await expect
        .poll(() => quickOpenRowPaths(win), {
          timeout: 2000,
          message: 'a file created on disk was not choosable within two seconds (SC-005)',
        })
        .toEqual(['appeared-later.txt']);

      // …and removed again. A delta that only ever adds is half an index.
      rmSync(created);
      await expect
        .poll(() => quickOpenRowPaths(win), {
          timeout: 2000,
          message: 'a deleted file was still being offered two seconds later (SC-005)',
        })
        .toEqual([]);

      await win.keyboard.press('Escape');
      await expect(win.getByTestId('quickopen')).toHaveCount(0);
    });
  } finally {
    cleanupTemp(root);
  }
});
