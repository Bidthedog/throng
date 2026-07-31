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

    /**
     * 026 / #186 — the obligations that were implicit, and therefore unmet.
     *
     * The two cases above say a watcher reports changes and stops on dispose. Both were true of the
     * implementation that produced #186, because neither asks WHEN a change is reported. A watcher
     * whose coalescing has no ceiling satisfies "fires onChange" perfectly while reporting nothing
     * at all for as long as the machine is busy — which is the entire defect.
     *
     * These belong in the shared contract rather than in one implementation's tests: any
     * IFileWatcher can be written with an unbounded debounce, so any implementation must be held to
     * a ceiling.
     */
    describe('liveness under sustained churn (026 / #186)', () => {
      it('reports a change WHILE the directory is still being written to', async () => {
        const h = await makeHarness();
        let stopChurn: ReturnType<typeof setInterval> | undefined;
        let reported = 0;
        const sub = h.watcher.watch(h.dir, () => {
          reported += 1;
        });
        try {
          await new Promise((r) => setTimeout(r, 150)); // let the watch arm
          let n = 0;
          // 5ms, deliberately: the contract cannot know the implementation's debounce, and a churn
          // interval close to it would let an UNBOUNDED debounce fire anyway on a lucky gap — the
          // test would then pass against the very implementation it exists to reject. At 5ms the
          // timer is re-armed long before any plausible quiet period elapses, so only a real
          // ceiling can satisfy this.
          stopChurn = setInterval(() => {
            void h.touch(`churn-${n++ % 20}.tmp`).catch(() => {
              /* teardown race; churn is noise, never an assertion */
            });
          }, 5);

          // The churn is STILL RUNNING when this assertion is made. A watcher that only reports
          // once the machine goes quiet is a watcher whose consumer is stale exactly when it is busy.
          await new Promise((r) => setTimeout(r, 2000));
          expect(
            reported,
            'nothing was reported while the directory kept changing — the coalescing window has no ceiling',
          ).toBeGreaterThan(0);
        } finally {
          if (stopChurn) clearInterval(stopChurn);
          sub.dispose();
          await h.cleanup();
        }
      }, 20_000);

      it('still coalesces a burst rather than reporting once per change', async () => {
        // The fence for the fix above. Bounding the delay must not become "no batching at all" —
        // that would trade a stale consumer for one re-reading the filesystem on every write.
        const h = await makeHarness();
        let reported = 0;
        const sub = h.watcher.watch(h.dir, () => {
          reported += 1;
        });
        try {
          await new Promise((r) => setTimeout(r, 150));
          for (let i = 0; i < 30; i += 1) await h.touch(`burst-${i}.json`);
          await new Promise((r) => setTimeout(r, 800));
          expect(reported).toBeGreaterThan(0);
          expect(reported, 'a 30-write burst must not become 30 reports').toBeLessThan(10);
        } finally {
          sub.dispose();
          await h.cleanup();
        }
      }, 20_000);
    });
  });
}
