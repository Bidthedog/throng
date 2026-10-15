/**
 * The persisted fold store (056 FR-010, FR-011, FR-011a, FR-016, FR-017; data-model "PreferencesFoldState",
 * "Version 2"; research R9).
 *
 * Layer: unit — the store is pure logic over a key/value storage; the unit project runs in node, so
 * `localStorage` is a Map-backed stand-in installed per test. The remount-with-the-same-storage claim is
 * proven at the component layer (settings-tab-folding), where the real jsdom storage is used.
 *
 * Version 2 stores the user's EXPLICIT choice per heading (`true` folded, `false` unfolded). A heading with
 * no entry takes its default, which is not stored: a section is folded, a subgroup or subsection is not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultFolded,
  readFolds,
  sectionsOpenByDefault,
  writeFolds,
} from '../../src/renderer/preferences/preferences-folds.js';

const KEY = 'throng.preferences.folds';

let data: Map<string, string>;
let failGet = false;
let failSet = false;

beforeEach(() => {
  data = new Map();
  failGet = false;
  failSet = false;
  vi.stubGlobal('localStorage', {
    getItem: (k: string): string | null => {
      if (failGet) throw new Error('denied');
      return data.get(k) ?? null;
    },
    setItem: (k: string, v: string): void => {
      if (failSet) throw new Error('quota');
      data.set(k, v);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const put = (value: unknown): void => {
  data.set(KEY, typeof value === 'string' ? value : JSON.stringify(value));
};
const stored = (): Record<string, unknown> => JSON.parse(data.get(KEY) ?? 'null') as Record<string, unknown>;
const choices = (entries: Array<[string, boolean]>): ReadonlyMap<string, boolean> => new Map(entries);

describe('readFolds', () => {
  it('reads the explicit choices of the named tab (v2)', () => {
    put({ v: 2, settings: { '["Editor"]': true, '["Editor","Previews"]': false }, keybindings: {}, themes: {} });
    expect([...readFolds('settings')]).toEqual([
      ['["Editor"]', true],
      ['["Editor","Previews"]', false],
    ]);
    expect(readFolds('keybindings').size).toBe(0);
  });

  it('round-trips true and false', () => {
    writeFolds('themes', choices([['["Icons"]', false], ['["A"]', true]]), new Set(['["Icons"]', '["A"]']));
    const read = readFolds('themes');
    expect(read.get('["Icons"]')).toBe(false);
    expect(read.get('["A"]')).toBe(true);
  });

  it('reads a v1 document as empty — that shape never shipped, so it is not migrated', () => {
    put({ v: 1, settings: ['["Editor"]'], keybindings: [], themes: ['["Icons"]'] });
    expect(readFolds('settings').size).toBe(0);
    expect(readFolds('themes').size).toBe(0);
  });

  it('reads as empty when nothing is stored', () => {
    expect(readFolds('settings').size).toBe(0);
  });

  it('reads any other version as empty', () => {
    put({ v: 3, settings: { '["Editor"]': true } });
    expect(readFolds('settings').size).toBe(0);
  });

  it('reads unparseable JSON as empty', () => {
    put('{not json');
    expect(readFolds('settings').size).toBe(0);
  });

  it('reads a missing tab object as empty', () => {
    put({ v: 2, settings: { '["Editor"]': true } });
    expect(readFolds('themes').size).toBe(0);
  });

  it('ignores a non-object tab and non-boolean values', () => {
    put({ v: 2, settings: 'x', themes: { '["A"]': true, '["B"]': 1 } });
    expect(readFolds('settings').size).toBe(0);
    expect([...readFolds('themes')]).toEqual([['["A"]', true]]);
  });

});

describe('writeFolds', () => {
  it('writes v2 and rewrites only its own tab', () => {
    put({ v: 2, settings: { '["Editor"]': false }, keybindings: {}, themes: { '["Icons"]': true } });
    writeFolds('keybindings', choices([['["Global"]', false]]), new Set(['["Global"]']));
    expect(stored()).toEqual({
      v: 2,
      settings: { '["Editor"]': false },
      keybindings: { '["Global"]': false },
      themes: { '["Icons"]': true },
    });
  });

  it('prunes keys that name no current heading in the tab', () => {
    writeFolds(
      'settings',
      choices([['["Editor"]', false], ['["Gone"]', true]]),
      new Set(['["Editor"]', '["Other"]']),
    );
    expect(stored().settings).toEqual({ '["Editor"]': false });
  });

  it('starts afresh over a v1 document rather than carrying it forward', () => {
    put({ v: 1, settings: ['["Editor"]'], keybindings: [], themes: [] });
    writeFolds('keybindings', choices([['["G"]', false]]), new Set(['["G"]']));
    expect(stored()).toEqual({ v: 2, settings: {}, keybindings: { '["G"]': false }, themes: {} });
  });

  it('starts afresh over an unreadable document', () => {
    put('{not json');
    writeFolds('settings', choices([['["A"]', true]]), new Set(['["A"]']));
    expect(stored()).toEqual({ v: 2, settings: { '["A"]': true }, keybindings: {}, themes: {} });
  });
});

describe('storage failures', () => {
  it('swallows a read exception', () => {
    failGet = true;
    expect(readFolds('settings').size).toBe(0);
  });

  it('swallows a write exception', () => {
    failSet = true;
    expect(() => writeFolds('settings', choices([['["A"]', true]]), new Set(['["A"]']))).not.toThrow();
  });
});

describe('defaultFolded (FR-016)', () => {
  it('folds a section, the Icons section included, and unfolds a subgroup or subsection', () => {
    expect(defaultFolded('["Editor"]', false)).toBe(true);
    expect(defaultFolded('["Icons"]', false)).toBe(true);
    expect(defaultFolded('["Editor","Previews"]', false)).toBe(false);
    expect(defaultFolded('["Editor","Previews","Deep"]', false)).toBe(false);
  });

  it('unfolds sections too when they open by default', () => {
    expect(defaultFolded('["Editor"]', true)).toBe(false);
    expect(defaultFolded('["Editor","Previews"]', true)).toBe(false);
  });
});

describe('sectionsOpenByDefault', () => {
  it('is false with no window', () => {
    expect(sectionsOpenByDefault()).toBe(false);
  });

  it('is true only when the page URL carries foldDefault=open', () => {
    vi.stubGlobal('window', { location: { search: '?prefs=settings&foldDefault=open' } });
    expect(sectionsOpenByDefault()).toBe(true);
    vi.stubGlobal('window', { location: { search: '?prefs=settings' } });
    expect(sectionsOpenByDefault()).toBe(false);
    vi.stubGlobal('window', { location: { search: '?foldDefault=closed' } });
    expect(sectionsOpenByDefault()).toBe(false);
  });

  it('is read on every call, with no cache', () => {
    vi.stubGlobal('window', { location: { search: '' } });
    expect(sectionsOpenByDefault()).toBe(false);
    vi.stubGlobal('window', { location: { search: '?foldDefault=open' } });
    expect(sectionsOpenByDefault()).toBe(true);
  });
});
