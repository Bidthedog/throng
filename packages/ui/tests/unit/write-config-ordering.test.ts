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
import {
  cancelWrite,
  onConfigWritten,
  scheduleWrite,
  settleConfigWrites,
  writeConfig,
} from '../../src/renderer/config/write-config.js';

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

/**
 * Issue #86 / 019 FR-010 — the config half of the shutdown drain.
 *
 * The drain settles this MODULE rather than counting writers, tabs or windows, so these are the
 * properties the whole feature rests on: what `scheduleWrite` defers, what `cancelWrite` takes
 * back, and — the one that decides whether a close is safe — what `settleConfigWrites` will and
 * will not ack over. Driven here rather than only through the E2E, where each costs an app
 * launch and none can hold the write open long enough to ask the question directly.
 */

/** A promise plus its resolver — a write held on the wire for exactly as long as the test wants. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Whether `p` has settled. The tie-breaker is a MACROTASK, so `p`'s own microtasks run first. */
async function isSettled(p: Promise<unknown>): Promise<boolean> {
  const marker = Symbol('settled');
  return (
    (await Promise.race([
      p.then(() => marker),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 0)),
    ])) === marker
  );
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('the config drain module API (019 FR-010, C22-C26)', () => {
  it('coalesces rapid edits into ONE write carrying the LAST value', async () => {
    const landed: string[] = [];
    installBridge((_id, json) => {
      landed.push(json);
      return Promise.resolve({ ok: true });
    });

    scheduleWrite({ kind: 'settings' }, () => '{"n":1}', 20);
    scheduleWrite({ kind: 'settings' }, () => '{"n":2}', 20);
    scheduleWrite({ kind: 'settings' }, () => '{"n":3}', 20);
    await wait(60);

    expect(landed).toEqual(['{"n":3}']);
  });

  it('evaluates `produce` at FIRE time, so the write carries the state as it is THEN', async () => {
    // The theme tab's id comes out of the debounced payload, and the JSON tab parses its buffer:
    // neither can be handed a finished string at schedule time (C25/C26).
    const landed: string[] = [];
    installBridge((_id, json) => {
      landed.push(json);
      return Promise.resolve({ ok: true });
    });

    let buffer = 'typed-so-far';
    scheduleWrite({ kind: 'settings' }, () => `{"v":"${buffer}"}`, 20);
    buffer = 'the-whole-edit'; // the user kept typing after the timer was armed
    await wait(60);

    expect(landed).toEqual(['{"v":"the-whole-edit"}']);
  });

  it('writes NOTHING when `produce` returns null — an unparseable buffer must not reach the file', async () => {
    let calls = 0;
    installBridge(() => {
      calls += 1;
      return Promise.resolve({ ok: true });
    });

    // The JSON tab's body: it fires on schedule, does its dirty/echo bookkeeping, and declines
    // to write (007 FR-017). A `null` is a decision, not an error.
    let produced = 0;
    scheduleWrite(
      { kind: 'settings' },
      () => {
        produced += 1;
        return null;
      },
      20,
    );
    await wait(60);

    expect(produced, 'the scheduled work must still RUN').toBe(1);
    expect(calls, '…but nothing may be written').toBe(0);
  });

  it('debounces PER document — one theme pending does not displace another', async () => {
    // 018 FR-023's captured-at-edit-time guarantee, enforced by the module rather than by a
    // payload convention: an id bound at creation could not express `writeTheme` at all (C25).
    const landed: string[] = [];
    installBridge((id, json) => {
      landed.push(`${(id as { name?: string }).name}:${json}`);
      return Promise.resolve({ ok: true });
    });

    scheduleWrite({ kind: 'theme', name: 'A' }, () => '{"a":1}', 20);
    scheduleWrite({ kind: 'theme', name: 'B' }, () => '{"b":1}', 20);
    await wait(60);

    expect(landed.sort()).toEqual(['A:{"a":1}', 'B:{"b":1}']);
  });

  it('cancelWrite drops the armed write without firing it', async () => {
    // The JSON tab's `reload` abandon: the edit being ABANDONED must not fire afterwards and
    // silently write itself back over the document just adopted (C26).
    let calls = 0;
    installBridge(() => {
      calls += 1;
      return Promise.resolve({ ok: true });
    });

    scheduleWrite({ kind: 'settings' }, () => '{"abandoned":true}', 20);
    cancelWrite({ kind: 'settings' });
    await wait(60);

    expect(calls).toBe(0);
  });

  it('cancelWrite cancels only ITS document, and is a no-op when nothing is armed', async () => {
    const landed: string[] = [];
    installBridge((_id, json) => {
      landed.push(json);
      return Promise.resolve({ ok: true });
    });

    scheduleWrite({ kind: 'settings' }, () => '{"s":1}', 20);
    scheduleWrite({ kind: 'keybindings' }, () => '{"k":1}', 20);
    cancelWrite({ kind: 'settings' });
    cancelWrite({ kind: 'theme', name: 'never-armed' }); // must not throw
    await wait(60);

    expect(landed).toEqual(['{"k":1}']);
  });

  it('settleConfigWrites fires an ARMED write immediately — it does not wait out the debounce', async () => {
    // The whole point: a 300ms timer must not need 300ms of close to survive.
    const landed: string[] = [];
    installBridge((_id, json) => {
      landed.push(json);
      return Promise.resolve({ ok: true });
    });

    scheduleWrite({ kind: 'settings' }, () => '{"unsaved":true}', 60_000); // never, on its own
    await settleConfigWrites();

    expect(landed).toEqual(['{"unsaved":true}']);
  });

  it('settleConfigWrites awaits a write that is already IN FLIGHT', async () => {
    // The undebounced writers, and any timer that fired a moment ago: `void writeConfig(…)`
    // dropped the promise, so `writeChains` is the only thing that still knows it exists.
    const write = deferred<{ ok: true }>();
    installBridge(() => write.promise);

    void writeConfig({ kind: 'settings' }, '{"inflight":true}');
    const settling = settleConfigWrites();
    expect(
      await isSettled(settling),
      'the drain must not ack over a write that is still on the wire',
    ).toBe(false);

    write.resolve({ ok: true });
    await expect(settling).resolves.toBeUndefined();
  });

  it('settleConfigWrites awaits the write it just FIRED, not merely the timer', async () => {
    // Firing an armed timer and acking before the write it started has landed would settle the
    // debounce and lose the write anyway — the defect one level down.
    const write = deferred<{ ok: true }>();
    installBridge(() => write.promise);

    scheduleWrite({ kind: 'settings' }, () => '{"armed":true}', 60_000);
    const settling = settleConfigWrites();
    expect(await isSettled(settling), 'firing is not landing').toBe(false);

    write.resolve({ ok: true });
    await expect(settling).resolves.toBeUndefined();
  });

  it('settleConfigWrites resolves immediately when nothing is pending', async () => {
    installBridge(() => Promise.resolve({ ok: true }));
    // A window hosting no config writer at all settles at once — which is what lets the drain
    // ask every window and name none of them (C22/C23).
    expect(await isSettled(settleConfigWrites())).toBe(true);
  });

  it('settleConfigWrites resolves — never rejects — when a write FAILS', async () => {
    installBridge(() => Promise.reject(new Error('config file locked')));

    // The rejection is swallowed HERE only to keep the runner's unhandled-rejection watch quiet:
    // what is under test is that `settleConfigWrites` — which awaits its OWN copy out of
    // `writeChains`, not this one — survives it.
    void writeConfig({ kind: 'settings' }, '{"doomed":true}').catch(() => undefined);
    // A write that cannot land is reported through the existing reload path; it must never
    // wedge the close, nor throw across the bridge into the drain's ack.
    await expect(settleConfigWrites()).resolves.toBeUndefined();
  });
});
