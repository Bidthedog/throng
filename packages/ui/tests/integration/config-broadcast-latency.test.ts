/**
 * 032 T024a / SC-008 — FR-004's 100 ms bound, MEASURED (not asserted in prose).
 *
 * An FR with a number that nothing reads is the old unbounded wording wearing a figure. This is the
 * measurement that gives it a referent — and it is also what says whether the deferred cross-window
 * write broadcast (T048) is needed to meet the bound, or whether the existing watcher path already
 * does.
 *
 * ══ WHAT IS AND IS NOT MEASURED ══
 *
 * The interval measured is **write completes → payload available to a subscriber**: the config
 * watcher's own debounce plus the re-read. It deliberately excludes Electron's IPC hop and the
 * renderer's React render, which cannot be observed from this layer and are not where the time
 * goes.
 *
 * The threshold is generous relative to the observed value on purpose. This is a WALL-CLOCK test on
 * a machine that may be running an E2E suite on every other core, and a latency assertion tuned to
 * the median is a flake generator. It is here to catch a regression from milliseconds to seconds —
 * a synchronous re-read, an unbounded retry, a debounce someone raised — not to police jitter.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { readConfigWithRetry } from '../../src/main/config-watcher.js';
import { writeConfigPatch } from '../../src/main/config-write-ipc.js';

/** FR-004's bound. */
const FR004_BOUND_MS = 100;

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-broadcast-latency-'));
  tempDirs.push(root);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'settings.json'), JSON.stringify(DEFAULT_APP_SETTINGS, null, 2), 'utf8');
  return root;
}

describe('FR-004 / SC-008 — an accepted change is observable within the bound', () => {
  it('a completed write is readable well inside 100 ms', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);

    const started = Date.now();
    const written = await writeConfigPatch(store, { kind: 'settings' }, [
      { path: ['appearance', 'theme'], value: 'Matrix' },
    ]);
    const result = await readConfigWithRetry(store);
    const elapsed = Date.now() - started;

    expect(written).toEqual({ ok: true });
    expect(result.payload.settings.appearance.theme).toBe('Matrix');
    expect(
      elapsed,
      `write → observable took ${elapsed} ms, against FR-004's ${FR004_BOUND_MS} ms bound`,
    ).toBeLessThan(FR004_BOUND_MS);
  });

  it('stays inside the bound across ten consecutive changes', async () => {
    // One sample can be lucky. Ten in a row catches a path that is fast when warm and slow on every
    // subsequent read — a cache that is not being invalidated, for instance.
    const root = freshRoot();
    const store = new FileConfigStore(root);
    const timings: number[] = [];

    for (let i = 0; i < 10; i += 1) {
      const started = Date.now();
      await writeConfigPatch(store, { kind: 'settings' }, [
        { path: ['appearance', 'theme'], value: `theme-${i}` },
      ]);
      const result = await readConfigWithRetry(store);
      timings.push(Date.now() - started);
      expect(result.payload.settings.appearance.theme).toBe(`theme-${i}`);
    }

    const worst = Math.max(...timings);
    expect(worst, `worst of ten was ${worst} ms (all: ${timings.join(', ')})`).toBeLessThan(
      FR004_BOUND_MS,
    );
  });

  it('an unreadable document spends the retry budget and NOT more', async () => {
    // The one case where the bound is legitimately exceeded, and the reason it is bounded at all.
    // Without a ceiling on the retries, a permanently corrupt file would make every read slow
    // forever rather than once.
    const root = freshRoot();
    writeFileSync(join(root, 'settings.json'), '{ broken', 'utf8');
    const store = new FileConfigStore(root);

    const started = Date.now();
    const result = await readConfigWithRetry(store, { attempts: 3, intervalMs: 50 });
    const elapsed = Date.now() - started;

    expect(result.settingsUnreadable).toBe(true);
    // Two 50 ms pauses, plus the reads. A ceiling far above that catches an unbounded retry without
    // policing machine load.
    expect(elapsed, `exhausting the retries took ${elapsed} ms`).toBeLessThan(2_000);
  });
});
