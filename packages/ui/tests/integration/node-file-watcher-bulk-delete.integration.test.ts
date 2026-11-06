/**
 * REPRO #585 — deleting a large folder inside an open project freezes throng for minutes on Linux.
 *
 * ══ WHAT THE USER SEES ══
 *
 * `rm -rf node_modules` in a project throng has open: the window stops repainting and taking input
 * until well after `rm` returns — four minutes for throng's own ~40,000-entry `node_modules`. The
 * main process is pinned inside `fs.watch` callbacks the whole time.
 *
 * ══ WHAT SHOULD HAPPEN ══
 *
 * A bulk change on disk costs the process hosting the watch a bounded amount of work per event, so
 * its event loop keeps turning while the delete runs. This test watches a root the way the project
 * watch does, deletes a large subtree from ANOTHER process (as a terminal does), and measures the
 * longest gap between ticks of a 10 ms interval on the watching process.
 *
 * Layer: integration — the stall is spent inside the platform's recursive watch implementation
 * (Node 24 on Linux), which only a real watch over a real tree exercises.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';

/** Entries in the deleted subtree. Big enough that a per-event cost growing with the tree shows. */
const ENTRIES = 12_000;
/**
 * The longest the watching process may go without turning its event loop.
 *
 * A stall this long is already a visible hitch in a window; the defect measures 1.6 s here at
 * 12,000 entries and grows with the square of the tree.
 */
const MAX_STALL_MS = 250;
/** No report for this long means the watch has drained what the delete queued. */
const QUIET_MS = 400;
/** Bound on waiting for that quiet: the defective watch needs a few seconds at this size. */
const QUIET_BOUND_MS = 30_000;

/** Builds a node_modules-shaped tree: packages holding a `lib` folder of small files. */
function buildTree(root: string, entries: number): void {
  let made = 0;
  for (let pkg = 0; made < entries; pkg += 1) {
    const lib = join(root, `pkg${pkg}`, 'lib');
    mkdirSync(lib, { recursive: true });
    made += 2;
    for (let f = 0; f < 8 && made < entries; f += 1, made += 1) {
      writeFileSync(join(lib, `f${f}.js`), 'x');
    }
  }
}

/** Runs `rm -rf <dir>` in a child process, as a terminal would, and resolves when it exits. */
function removeExternally(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const rm = spawn('rm', ['-rf', dir], { stdio: 'ignore' });
    rm.on('error', reject);
    rm.on('exit', () => resolve());
  });
}

describe('NodeFileWatcher — a bulk delete under a watched root (#585)', () => {
  let root: string | null = null;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = null;
  });

  it.runIf(process.platform !== 'win32')(
    'keeps the watching process responsive while a large subtree is deleted',
    async () => {
      root = mkdtempSync(join(tmpdir(), 'throng-bulk-delete-'));
      const nodeModules = join(root, 'node_modules');
      buildTree(nodeModules, ENTRIES);

      let lastReportAt = Date.now();
      const reported = new Set<string>();
      let incomplete = false;
      const handle = new NodeFileWatcher(50).watch(root, (path, batch) => {
        lastReportAt = Date.now();
        if (batch && !batch.complete) incomplete = true;
        for (const p of batch?.paths ?? [path]) reported.add(p);
      });

      /** Resolves once no report has arrived for QUIET_MS; fails past QUIET_BOUND_MS. */
      const quiet = async (): Promise<void> => {
        const started = Date.now();
        while (Date.now() - lastReportAt < QUIET_MS) {
          if (Date.now() - started > QUIET_BOUND_MS) throw new Error('the watch never went quiet');
          await new Promise((r) => setTimeout(r, 50));
        }
      };
      /**
       * Resolves once a report about the deleted folder has arrived; fails past QUIET_BOUND_MS. A
       * burst this size passes the batch's path cap (#482), so the report may say it is incomplete
       * rather than name every path — either is the watch doing its job.
       */
      const deletionReported = async (): Promise<void> => {
        const started = Date.now();
        while (!incomplete && ![...reported].some((p) => p.startsWith(nodeModules))) {
          if (Date.now() - started > QUIET_BOUND_MS) throw new Error('the deletion was never reported');
          await new Promise((r) => setTimeout(r, 50));
        }
      };

      try {
        await quiet(); // anything arming the watch reported has drained
        reported.clear();
        incomplete = false;

        let last = Date.now();
        let worstStallMs = 0;
        const tick = setInterval(() => {
          const now = Date.now();
          worstStallMs = Math.max(worstStallMs, now - last);
          last = now;
        }, 10);
        try {
          last = Date.now();
          await removeExternally(nodeModules);
          // The watch still does its job — the deletion is reported — and then drains.
          await deletionReported();
          await quiet();
        } finally {
          clearInterval(tick);
        }

        expect(worstStallMs).toBeLessThan(MAX_STALL_MS);
      } finally {
        handle.dispose();
      }
    },
    60_000,
  );
});
