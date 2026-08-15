/**
 * 032 US1 — the key-scoped patch (T006, FR-001/FR-002, contract steps 3 and 5).
 *
 * The whole feature rests on one property: a key nobody named must come out the other side exactly
 * as it went in. Everything else here defends the edges of that — the paths that must be refused,
 * the intermediate objects that must be created, and the prototype keys that must never be written
 * however innocently they arrive.
 */
import { describe, it, expect } from 'vitest';
import { applyConfigPatch, type ConfigChange } from '../../src/config/config-patch.js';

/** Shorthand: the successful value, or a hard failure naming the error it got instead. */
function applied(base: unknown, changes: readonly ConfigChange[]): Record<string, unknown> {
  const out = applyConfigPatch(base, changes);
  if (!out.ok) throw new Error(`expected the patch to apply, got ${out.error}`);
  return out.value;
}

describe('applyConfigPatch — what it preserves', () => {
  it('leaves every key the patch did not name exactly as it was', () => {
    const base = {
      appearance: { theme: 'Matrix', fontSize: 13 },
      newProject: { lastProjectFolder: 'D:/work' },
      notifications: { error: { mode: 'toast' } },
    };

    const value = applied(base, [{ path: ['notifications', 'error', 'mode'], value: 'banner' }]);

    expect(value.notifications).toEqual({ error: { mode: 'banner' } });
    // The guarantee the feature exists for: the OTHER window's key survives.
    expect(value.newProject).toEqual({ lastProjectFolder: 'D:/work' });
    expect(value.appearance).toEqual({ theme: 'Matrix', fontSize: 13 });
  });

  it('does not mutate the base document', () => {
    const base = { appearance: { theme: 'Matrix' } };
    applied(base, [{ path: ['appearance', 'theme'], value: 'Gothic' }]);
    expect(base.appearance.theme).toBe('Matrix');
  });

  it('leaves a sibling of the patched leaf alone', () => {
    const base = { editor: { indentWidth: 2, wordWrap: true } };
    const value = applied(base, [{ path: ['editor', 'indentWidth'], value: 4 }]);
    expect(value.editor).toEqual({ indentWidth: 4, wordWrap: true });
  });

  it('treats an absent document as an empty one rather than a failure', () => {
    const value = applied({}, [{ path: ['appearance', 'theme'], value: 'Matrix' }]);
    expect(value).toEqual({ appearance: { theme: 'Matrix' } });
  });
});

describe('applyConfigPatch — ordering', () => {
  it('applies changes in array order, so the later one wins', () => {
    const value = applied({}, [
      { path: ['a'], value: 1 },
      { path: ['a'], value: 2 },
    ]);
    expect(value.a).toBe(2);
  });

  it('applies unrelated changes in one patch together', () => {
    const value = applied({ keep: true }, [
      { path: ['x', 'y'], value: 'one' },
      { path: ['z'], value: 'two' },
    ]);
    expect(value).toEqual({ keep: true, x: { y: 'one' }, z: 'two' });
  });
});

describe('applyConfigPatch — intermediate objects', () => {
  it('creates missing intermediate objects', () => {
    const value = applied({}, [{ path: ['a', 'b', 'c'], value: 42 }]);
    expect(value).toEqual({ a: { b: { c: 42 } } });
  });

  it('replaces a non-object standing where an intermediate is needed', () => {
    // `a` is a string, so there is nothing to descend into. The patch names `a.b`, which is a
    // statement that `a` is an object — honouring it is what the caller asked for, and refusing
    // would strand a document the user could only fix by hand.
    const value = applied({ a: 'not an object' }, [{ path: ['a', 'b'], value: 1 }]);
    expect(value).toEqual({ a: { b: 1 } });
  });

  it('descends into an existing intermediate rather than replacing it', () => {
    const value = applied({ a: { keep: 1 } }, [{ path: ['a', 'add'], value: 2 }]);
    expect(value.a).toEqual({ keep: 1, add: 2 });
  });

  it('addresses a key containing a dot, which a dotted string could not', () => {
    // The reason `path` is a segment array. `tabs.openPicker` is one segment, not two.
    const value = applied({ bindings: {} }, [
      { path: ['bindings', 'tabs.openPicker'], value: ['Ctrl+P'] },
    ]);
    expect(value.bindings).toEqual({ 'tabs.openPicker': ['Ctrl+P'] });
  });

  it('writes a whole subtree when the path names one', () => {
    const value = applied({ a: { old: 1 } }, [{ path: ['a'], value: { fresh: 2 } }]);
    expect(value.a).toEqual({ fresh: 2 });
  });
});

describe('applyConfigPatch — what it refuses', () => {
  it('refuses an empty patch', () => {
    expect(applyConfigPatch({}, [])).toEqual({ ok: false, error: 'empty-patch' });
  });

  it('refuses an empty path', () => {
    expect(applyConfigPatch({}, [{ path: [], value: 1 }])).toEqual({
      ok: false,
      error: 'invalid-path',
    });
  });

  it('refuses an empty segment', () => {
    expect(applyConfigPatch({}, [{ path: ['a', ''], value: 1 }])).toEqual({
      ok: false,
      error: 'invalid-path',
    });
  });

  it('refuses a non-string segment', () => {
    const change = { path: ['a', 3] as unknown as string[], value: 1 };
    expect(applyConfigPatch({}, [change])).toEqual({ ok: false, error: 'invalid-path' });
  });

  it('refuses a base that is not a JSON object', () => {
    for (const base of [null, [], 'text', 7]) {
      expect(applyConfigPatch(base, [{ path: ['a'], value: 1 }])).toEqual({
        ok: false,
        error: 'not-an-object',
      });
    }
  });

  it.each(['__proto__', 'constructor', 'prototype'])('refuses the segment %s', (segment) => {
    expect(applyConfigPatch({}, [{ path: [segment], value: 1 }])).toEqual({
      ok: false,
      error: 'invalid-path',
    });
    expect(applyConfigPatch({}, [{ path: ['a', segment, 'b'], value: 1 }])).toEqual({
      ok: false,
      error: 'invalid-path',
    });
  });

  it('does not pollute Object.prototype even in the shape that would', () => {
    applyConfigPatch({}, [{ path: ['__proto__', 'polluted'], value: true }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('applies NOTHING when one change in the patch is invalid (G4)', () => {
    const base = { keep: 'me' };
    const out = applyConfigPatch(base, [
      { path: ['ok'], value: 1 },
      { path: [], value: 2 },
    ]);
    expect(out).toEqual({ ok: false, error: 'invalid-path' });
    // No partial application, and the base is untouched.
    expect(base).toEqual({ keep: 'me' });
  });
});
