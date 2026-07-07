/**
 * Contract suite for any {@link IFileWatcher} implementation (Principle V /
 * contracts/os-config-store.md). Filesystem- and timing-bound, so impls run it
 * in the integration/contract layer with a real temp directory.
 */
import { describe, it, expect } from 'vitest';
import type { IFileWatcher } from '../abstractions/file-watcher.js';

export interface FileWatcherHarness {
  watcher: IFileWatcher;
  /** A real, watchable directory. */
  dir: string;
  /** Create/modify a file within `dir`. */
  touch(file: string): Promise<void>;
  /** Tear down the temp directory. */
  cleanup(): Promise<void>;
}

function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timed out waiting for watcher'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

export function runFileWatcherContract(
  name: string,
  makeHarness: () => Promise<FileWatcherHarness>,
): void {
  describe(`IFileWatcher contract: ${name}`, () => {
    it('fires onChange when a file in the directory changes', async () => {
      const h = await makeHarness();
      try {
        const changed: string[] = [];
        const sub = h.watcher.watch(h.dir, (p) => changed.push(p));
        await h.touch('settings.json');
        await waitFor(() => changed.length > 0);
        expect(changed.length).toBeGreaterThan(0);
        sub.dispose();
      } finally {
        await h.cleanup();
      }
    });

    it('stops firing after dispose', async () => {
      const h = await makeHarness();
      try {
        let count = 0;
        const sub = h.watcher.watch(h.dir, () => {
          count += 1;
        });
        await h.touch('a.json');
        await waitFor(() => count > 0);
        sub.dispose();
        const afterDispose = count;
        await h.touch('b.json');
        await new Promise((r) => setTimeout(r, 300));
        expect(count).toBe(afterDispose);
      } finally {
        await h.cleanup();
      }
    });
  });
}
