import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigChange, ConfigDocId } from '@throng/core';
import {
  writeConfigPatch,
  onConfigPatched,
  onConfigWriteFailed,
  type ConfigWriteResult,
} from '../../src/renderer/config/write-config.js';

/**
 * The renderer's config-write chokepoint — ordering, failure isolation, and what it tells listeners
 * (007 T010, 032 FR-001, issues #50 and #265).
 *
 * PLACE AT: `packages/ui/tests/unit/config-write-ordering.test.ts`
 * NEW COVERAGE (035). `write-config.ts` had no test of its own. Every preferences tab's apply-client
 * builds on it — its own header says *"Every config write goes through `writeConfig`"* — and a
 * repo-wide search finds it only in component tests that import it incidentally, and in E2E.
 *
 * ══ WHY THIS IS THE FILE 035 WAS LOOKING FOR ══
 *
 * 48 E2E tests carry `@reserve:runtime`, and the largest cluster of them is preferences: a control
 * is driven, and the assertion is that the value reached `settings.json` on disk. Two independent
 * readers of the same specs disagreed about precisely this class — one calling it irreducible, the
 * other calling it integration-testable — which made it the most contested entry in the vocabulary.
 *
 * Reading the chain settles it. For the slider at `preferences-slider.e2e.ts:74` it runs:
 *
 *   1. the control commits a plain number   → `preferences-number-control.test.ts:171` proves this,
 *                                             including that the grouped display `2,000` is NOT
 *                                             what gets committed
 *   2. the renderer serialises and forwards → **this file**, previously nothing
 *   3. the main handler writes the bytes    → `contract/config-write-patch.contract.test.ts`
 *
 * Every link had a home except the middle one. The E2E was not proving something irreducible; it
 * was standing in for a gap.
 *
 * ══ THE ORDERING GUARANTEE IS THE POINT, AND IT IS #50 ══
 *
 * `writeChains` exists because *"two writes to the same file are not commutative: if the second one
 * lands first, it wins, and the first edit is lost"*. That is issue #50, and it is exactly what
 * `preferences-rapid-edit.e2e.ts` was written to catch — a spec whose own comments say it reproduces
 * only under real full-suite load.
 *
 * That was true of the E2E's METHOD, not of the property. Here the race is not raced: the fake
 * bridge hands back promises this test resolves in whatever order it likes, so "the second write
 * waits for the first" is asserted directly and deterministically rather than provoked and hoped
 * for. A test that cannot fail on demand cannot be trusted when it passes.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Delete the `previous.catch(...).then(...)` chaining in `writeConfigPatch` and call `writePatch`
 * directly. The two ordering tests fail immediately — the second write resolves before the first.
 * The rest keep passing, which is the shape a targeted guard should have.
 */

const SETTINGS: ConfigDocId = { kind: 'settings' };
const KEYBINDINGS: ConfigDocId = { kind: 'keybindings' };
const CHANGE: readonly ConfigChange[] = [{ path: ['behaviour', 'tabHoverActivateMs'], value: 2000 }];

/**
 * `window` is provided explicitly, because this project runs in the NODE environment.
 *
 * The module's own header says it is *"kept free of React/DOM module-scope so the debounce timing
 * is unit-testable in the node env"* — and that is true of its module scope, but `writeConfigPatch`
 * still reaches for `window.throng` at CALL time, which is a bare `ReferenceError` under node
 * rather than the `undefined` the optional chaining expects. Supplying the global here keeps the
 * test in the cheapest environment that can run it instead of promoting the whole file to jsdom for
 * one property lookup.
 */
function setWindow(value: unknown): void {
  Reflect.set(globalThis, 'window', value);
}

/** A bridge whose every call is a promise this test resolves by hand. */
function controllableBridge() {
  const calls: { id: ConfigDocId; changes: readonly ConfigChange[]; settle: (r: ConfigWriteResult) => void }[] = [];
  const writePatch = vi.fn((id: ConfigDocId, changes: readonly ConfigChange[]) => {
    return new Promise<ConfigWriteResult>((resolve) => {
      calls.push({ id, changes, settle: resolve });
    });
  });
  setWindow({ throng: { config: { writePatch } } });
  return { calls, writePatch };
}

/**
 * Drain every pending microtask.
 *
 * A single `await Promise.resolve()` is NOT enough, and the reason is worth stating because it cost
 * a red run to find: the write is dispatched through `previous.catch(...).then(...)`, so the bridge
 * call sits at least two hops down the microtask queue. Counting those hops would encode an
 * implementation detail this test has no business knowing — a macrotask boundary drains whatever is
 * queued, however the chain is later restructured.
 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const unsubscribers: (() => void)[] = [];
const track = (off: () => void): void => {
  unsubscribers.push(off);
};

beforeEach(() => {
  // A window with no `throng` at all — the state a renderer is in before the preload has wired up.
  setWindow({});
});

afterEach(() => {
  for (const off of unsubscribers.splice(0)) off();
  Reflect.deleteProperty(globalThis, 'window');
});

describe('ordering, per document (#50)', () => {
  it('does not start a second write to the same document until the first has settled', async () => {
    /*
     * The claim `preferences-rapid-edit.e2e.ts` provokes under load. Asserted here instead:
     * the bridge is called ONCE while the first write is outstanding, whatever the caller does.
     */
    const bridge = controllableBridge();

    const first = writeConfigPatch(SETTINGS, CHANGE);
    const second = writeConfigPatch(SETTINGS, [{ path: ['behaviour', 'tabHoverActivateMs'], value: 3000 }]);

    // Let any un-chained implementation get its second call in.
    await flush();
    expect(bridge.calls, 'the second write must wait for the first').toHaveLength(1);

    bridge.calls[0].settle({ ok: true });
    await first;
    await flush();

    expect(bridge.calls).toHaveLength(2);
    expect(bridge.calls[1].changes[0].value).toBe(3000);

    bridge.calls[1].settle({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
  });

  it('lets writes to DIFFERENT documents proceed in parallel', async () => {
    // Serialising everything would make the whole preferences window as slow as its slowest write,
    // and the chains are keyed per document precisely to avoid that.
    const bridge = controllableBridge();

    const a = writeConfigPatch(SETTINGS, CHANGE);
    const b = writeConfigPatch(KEYBINDINGS, CHANGE);
    await flush();

    expect(bridge.calls).toHaveLength(2);
    bridge.calls[0].settle({ ok: true });
    bridge.calls[1].settle({ ok: true });
    await Promise.all([a, b]);
  });

  it('does not let a FAILED write sink the writes queued behind it', async () => {
    /*
     * `.catch(() => undefined)` on the previous link. Without it a rejected write poisons the chain
     * and every later edit to that document silently never happens — the worst shape a config bug
     * can take, because the UI has already moved on.
     */
    const bridge = controllableBridge();

    const first = writeConfigPatch(SETTINGS, CHANGE);
    const second = writeConfigPatch(SETTINGS, CHANGE);
    await flush();

    bridge.calls[0].settle({ ok: false, error: 'disk is full' });
    await first;
    await flush();

    expect(bridge.calls, 'the next write must still be attempted').toHaveLength(2);
    bridge.calls[1].settle({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
  });
});

describe('what the write path tells its subscribers', () => {
  it('announces a successful patch with the changes that landed', async () => {
    const bridge = controllableBridge();
    const seen: { id: ConfigDocId; changes: readonly ConfigChange[] }[] = [];
    track(onConfigPatched((id, changes) => seen.push({ id, changes })));

    const write = writeConfigPatch(SETTINGS, CHANGE);
    await flush();
    bridge.calls[0].settle({ ok: true });
    await write;

    expect(seen).toHaveLength(1);
    expect(seen[0].id).toEqual(SETTINGS);
    expect(seen[0].changes[0].value).toBe(2000);
  });

  it('announces nothing on failure — a write that did not land is not a change', async () => {
    // The config store applies a patched document at once so the next edit builds on it. Announcing
    // a failed write would seed that cache with a value the file does not hold.
    const bridge = controllableBridge();
    const patched: unknown[] = [];
    track(onConfigPatched((id) => patched.push(id)));

    const write = writeConfigPatch(SETTINGS, CHANGE);
    await flush();
    bridge.calls[0].settle({ ok: false, error: 'nope' });
    await write;

    expect(patched).toEqual([]);
  });

  it('keeps the user sentence and the raw errno apart (#265)', async () => {
    /*
     * They used to be one string, which is how a notice came to read
     * `"settings.json.2.tmp" is open in another program`. One value cannot be both a sentence a
     * person reads and a record a log keeps.
     */
    const bridge = controllableBridge();
    const failures: { error: string; detail?: string }[] = [];
    track(onConfigWriteFailed((_id, error, detail) => failures.push({ error, detail })));

    const write = writeConfigPatch(SETTINGS, CHANGE);
    await flush();
    bridge.calls[0].settle({ ok: false, error: 'could not be saved', detail: 'EPERM: operation not permitted' });
    await write;

    expect(failures).toEqual([{ error: 'could not be saved', detail: 'EPERM: operation not permitted' }]);
  });

  it('survives a subscriber that throws', async () => {
    // "A reporter must not break a writer." A notice component that blows up must not also lose the
    // write result for everyone downstream of it.
    const bridge = controllableBridge();
    const after: string[] = [];
    track(onConfigWriteFailed(() => {
      throw new Error('listener exploded');
    }));
    track(onConfigWriteFailed((_id, error) => after.push(error)));

    const write = writeConfigPatch(SETTINGS, CHANGE);
    await flush();
    bridge.calls[0].settle({ ok: false, error: 'still reported' });

    await expect(write).resolves.toEqual({ ok: false, error: 'still reported' });
    expect(after).toEqual(['still reported']);
  });
});

describe('when the bridge is not there at all', () => {
  it('reports bridge-unavailable rather than throwing', async () => {
    /*
     * `window.throng` is absent in a window that has not finished wiring, and during teardown. A
     * throw here would surface as an unhandled rejection from whichever control the user happened
     * to touch, instead of the failure notice the config path already has a channel for.
     */
    const failures: string[] = [];
    track(onConfigWriteFailed((_id, error) => failures.push(error)));

    await expect(writeConfigPatch(SETTINGS, CHANGE)).resolves.toEqual({
      ok: false,
      error: 'bridge-unavailable',
    });
    expect(failures, 'the failure is announced, not swallowed').toEqual(['bridge-unavailable']);
  });
});
