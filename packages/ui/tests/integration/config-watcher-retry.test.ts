/**
 * 032 T024 — the watcher looks again (FR-008, G6/G7).
 *
 * ══ THE EDGE CASE ══
 *
 * A re-read used to happen only when the watcher fired, and the watcher fires only when a file
 * changes. So a single bad read — waking mid-write, or a scanner holding the file for a moment —
 * broadcast the shipped defaults as though they were the user's settings, and then NOTHING looked
 * again. Every open window stayed on the defaults indefinitely.
 *
 * That is a lost event, not a late one, which is why no timeout ever helped and why the fix has to
 * be a re-read rather than a longer wait.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { readConfigWithRetry, type ConfigWatchPolicy } from '../../src/main/config-watcher.js';

const FAST: ConfigWatchPolicy = { attempts: 3, intervalMs: 10 };
const tempDirs: string[] = [];

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-watch-retry-'));
  tempDirs.push(root);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeSettings(root: string, text: string): void {
  writeFileSync(join(root, 'settings.json'), text, 'utf8');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('G6 — a broadcast is never derived from an unreadable read while a retry remains', () => {
  it('recovers the real value when the file becomes readable between attempts', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);

    // Start corrupt — the state a half-written file is in for a few milliseconds.
    writeSettings(root, '{ "appearance": { "theme": "Matrix" ');

    // Complete the write shortly after the first attempt has already failed.
    setTimeout(() => {
      writeSettings(root, JSON.stringify({ ...DEFAULT_APP_SETTINGS, appearance: { theme: 'Matrix' } }));
    }, 15);

    const result = await readConfigWithRetry(store, FAST);

    // The user's theme, not the shipped default — which is the whole difference between a lost
    // change and a late one.
    expect(result.settingsUnreadable).toBe(false);
    expect(result.payload.settings.appearance.theme).toBe('Matrix');
  });

  it('does not retry a readable document at all', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    writeSettings(root, JSON.stringify({ ...DEFAULT_APP_SETTINGS, appearance: { theme: 'Matrix' } }));

    // A slow policy that would be obvious if it were used: 3 attempts at 5 seconds. The read must
    // return immediately, because there is nothing to retry.
    const started = Date.now();
    const result = await readConfigWithRetry(store, { attempts: 3, intervalMs: 5_000 });

    expect(result.settingsUnreadable).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('does not retry an ABSENT document', async () => {
    // Absent is not unreadable. Retrying would delay every first launch by the whole budget to
    // discover something that was never going to change.
    const root = freshRoot();
    const store = new FileConfigStore(root);

    const started = Date.now();
    const result = await readConfigWithRetry(store, { attempts: 3, intervalMs: 5_000 });

    expect(result.settingsUnreadable).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('G7 — after the retries are spent, the last read is broadcast anyway', () => {
  it('reports unreadable and still hands back a usable payload', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    writeSettings(root, '{ this will never parse');

    const result = await readConfigWithRetry(store, FAST);

    // Reported, so a caller can log it — and still complete, so the app runs on defaults rather
    // than quietly suspending configuration updates. Silence is the worse failure here: it is
    // indistinguishable from the bug this whole feature is about.
    expect(result.settingsUnreadable).toBe(true);
    expect(result.payload.settings.appearance.theme).toBe(DEFAULT_APP_SETTINGS.appearance.theme);
    expect(result.payload.keybindings).toBeDefined();
    expect(result.payload.theme).toBeDefined();
  });

  it('spends the whole budget before giving up', async () => {
    const root = freshRoot();
    const store = new FileConfigStore(root);
    writeSettings(root, 'not json at all');

    const started = Date.now();
    await readConfigWithRetry(store, { attempts: 3, intervalMs: 40 });

    // Two pauses between three attempts. Asserted as a floor rather than a range, because a loaded
    // machine can take longer and that is not a defect.
    expect(Date.now() - started).toBeGreaterThanOrEqual(70);
  });

  it('treats a document that parses to a NON-OBJECT as unreadable too', async () => {
    // `[1,2,3]` parses perfectly and is not settings. Without this it would sail through as a
    // successful read of an empty configuration.
    const root = freshRoot();
    const store = new FileConfigStore(root);
    writeSettings(root, '[1, 2, 3]');

    const result = await readConfigWithRetry(store, FAST);
    expect(result.settingsUnreadable).toBe(true);
  });
});
