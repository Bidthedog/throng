/**
 * Issue #50 — the renderer's config write path.
 *
 * Every preferences edit serialises the WHOLE document, so two writes to the same file are not
 * commutative: whichever lands last wins outright. Two things follow, and both are tested here.
 *
 *   1. Writes to the same document are SERIALISED, so a slow first write cannot be overtaken by a
 *      fast second one and silently resurrect the state the user just changed.
 *   2. A successful write is PUBLISHED, so the config store can adopt the document immediately
 *      instead of waiting for the file watcher to round-trip it — which is what left the next edit
 *      building on a pre-edit snapshot in the first place.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { onConfigWritten, writeConfig } from '../../src/renderer/config/write-config.js';

type Write = (id: unknown, json: string) => Promise<{ ok: boolean; error?: string }>;

function installBridge(write: Write): void {
  (globalThis as { window?: unknown }).window = { throng: { config: { write } } };
}

beforeEach(() => {
  // A renderer always HAS a window; what it may lack is the preload bridge on it.
  (globalThis as { window?: unknown }).window = {};
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('writeConfig ordering (issue #50)', () => {
  it('serialises writes to the SAME document, so the last edit is the last to land', async () => {
    const landed: string[] = [];
    // The first write is slow, the second is instant — the exact shape that loses an edit.
    const write: Write = (_id, json) => {
      const delay = json.includes('first') ? 40 : 0;
      return new Promise((resolve) =>
        setTimeout(() => {
          landed.push(json);
          resolve({ ok: true });
        }, delay),
      );
    };
    installBridge(write);

    const a = writeConfig({ kind: 'settings' }, '{"edit":"first"}');
    const b = writeConfig({ kind: 'settings' }, '{"edit":"second"}');
    await Promise.all([a, b]);

    expect(landed).toEqual(['{"edit":"first"}', '{"edit":"second"}']);
  });

  it('does not serialise across DIFFERENT documents — they cannot clobber each other', async () => {
    const started: string[] = [];
    const write: Write = (id, _json) => {
      started.push((id as { kind: string }).kind);
      return new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 20));
    };
    installBridge(write);

    await Promise.all([
      writeConfig({ kind: 'settings' }, '{}'),
      writeConfig({ kind: 'keybindings' }, '{}'),
    ]);

    // Both were in flight at once: independent files, no reason to make one wait.
    expect(started).toEqual(['settings', 'keybindings']);
  });

  it('publishes a successful write so the next edit can build on it', async () => {
    installBridge(() => Promise.resolve({ ok: true }));
    const seen: string[] = [];
    const off = onConfigWritten((_id, json) => seen.push(json));

    await writeConfig({ kind: 'keybindings' }, '{"version":1}');
    off();

    expect(seen).toEqual(['{"version":1}']);
  });

  it('publishes NOTHING when the write failed — a document that never landed must not be adopted', async () => {
    installBridge(() => Promise.resolve({ ok: false, error: 'locked' }));
    const seen: string[] = [];
    const off = onConfigWritten((_id, json) => seen.push(json));

    const res = await writeConfig({ kind: 'settings' }, '{"editor":{"autoSave":true}}');
    off();

    expect(res.ok).toBe(false);
    expect(seen).toEqual([]);
  });

  it('a failed write does not sink the writes queued behind it', async () => {
    const calls: string[] = [];
    const write: Write = (_id, json) => {
      calls.push(json);
      return json.includes('bad')
        ? Promise.resolve({ ok: false, error: 'locked' })
        : Promise.resolve({ ok: true });
    };
    installBridge(write);

    const bad = await writeConfig({ kind: 'settings' }, '{"edit":"bad"}');
    const good = await writeConfig({ kind: 'settings' }, '{"edit":"good"}');

    expect(bad.ok).toBe(false);
    expect(good.ok).toBe(true);
    expect(calls).toEqual(['{"edit":"bad"}', '{"edit":"good"}']);
  });

  it('reports a missing preload bridge as a failure rather than throwing', async () => {
    (globalThis as { window?: unknown }).window = {}; // rendered without preload
    const res = await writeConfig({ kind: 'settings' }, '{}');
    expect(res).toEqual({ ok: false, error: 'bridge-unavailable' });
  });
});
