import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ExplorerWatcher } from '../../src/main/explorer-watcher.js';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';

/**
 * 026 / #186 — the watcher must stay live under sustained filesystem churn.
 *
 * THE CAUSE THIS PINS, and why it is not the one #186 nominates. The issue's leading suspect is
 * that `fs.watch`'s `'error'` handler closes the watcher with no re-establish, killing the tree for
 * the session (covered separately in `file-watcher-error-recovery.test.ts`). That is a real hole,
 * but it is not what a healthy project reproduces — and the single-window external create/delete
 * path is demonstrably fine (`explorer-live-sync.e2e.ts` passes on master).
 *
 * What actually starves the tree is the debounce. `NodeFileWatcher` restarts its timer on EVERY
 * raw event and has no maximum wait:
 *
 *     if (timer) clearTimeout(timer);
 *     timer = setTimeout(fire, this.debounceMs);   // 150ms for the explorer
 *
 * So while events keep arriving closer together than 150ms, the timer is reset forever and NOTHING
 * is ever reported. A project root holding `node_modules`, `.git` or build output does exactly
 * that whenever a build, an install or a git operation runs — and a recursive watch sees all of it.
 * Measured on this branch: 180 raw events over 3s of 40ms-interval churn produced **0** reported
 * changes; the first and only report landed after the churn stopped. That is precisely the reported
 * "the tree only catches up on some later unrelated action".
 *
 * The contract this asserts is a MAXIMUM WAIT, not the removal of debouncing. Coalescing bursts is
 * correct and must stay; what may not happen is a burst deferring the report indefinitely.
 *
 * RED on master: no change is reported for as long as the churn continues.
 */

/** Comfortably above the 150ms debounce, and far below any believable max-wait ceiling. */
const MAX_ACCEPTABLE_SILENCE_MS = 2000;
/** Faster than the debounce window — the condition that starves it. */
const CHURN_INTERVAL_MS = 40;

/** Churn a subfolder until stopped, the way a build or an install does. */
function startChurn(dir: string): () => void {
  let n = 0;
  const timer = setInterval(() => {
    void writeFile(join(dir, `churn-${n++ % 50}.tmp`), String(n)).catch(() => {
      /* the dir may be being torn down — churn is noise, never an assertion */
    });
  }, CHURN_INTERVAL_MS);
  return () => clearInterval(timer);
}

describe('watcher liveness under churn (026 / #186)', () => {
  it('reports a change WHILE a noisy directory is still churning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'throng-churn-'));
    await mkdir(join(root, 'node_modules'));
    const events: Array<{ relDir: string }> = [];
    const watcher = new ExplorerWatcher(new NodeFileWatcher(150), (e) => events.push(e));
    watcher.setRoot(root);
    let stopChurn = (): void => {};
    try {
      await new Promise((r) => setTimeout(r, 200)); // let the recursive watch arm
      stopChurn = startChurn(join(root, 'node_modules'));

      // The change the USER made, in amongst the noise.
      await new Promise((r) => setTimeout(r, 300));
      await writeFile(join(root, 'the-user-file.txt'), 'x');

      // The churn is STILL RUNNING here — that is the whole point. A watcher that only
      // reports once the machine goes quiet is a tree that is stale exactly when it is busy.
      await new Promise((r) => setTimeout(r, MAX_ACCEPTABLE_SILENCE_MS));
      expect(
        events.length,
        'no change was reported while the directory kept churning — the debounce timer is being reset forever',
      ).toBeGreaterThan(0);
    } finally {
      stopChurn();
      watcher.dispose();
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    }
  }, 20_000);

  it('still COALESCES a burst — a max wait must not turn into an event per write', async () => {
    // The regression fence for the fix. Debouncing is correct behaviour and the reason the
    // renderer is not re-reading every loaded directory hundreds of times a second; a fix that
    // simply removes the debounce trades a stale tree for a melted one.
    const root = await mkdtemp(join(tmpdir(), 'throng-coalesce-'));
    const events: Array<{ relDir: string }> = [];
    const watcher = new ExplorerWatcher(new NodeFileWatcher(150), (e) => events.push(e));
    watcher.setRoot(root);
    try {
      await new Promise((r) => setTimeout(r, 200));
      for (let i = 0; i < 40; i += 1) await writeFile(join(root, `burst-${i}.txt`), 'x');
      await new Promise((r) => setTimeout(r, 800));
      expect(events.length).toBeGreaterThan(0);
      expect(events.length, 'a 40-write burst must not become 40 reports').toBeLessThan(10);
    } finally {
      watcher.dispose();
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    }
  }, 20_000);
});
