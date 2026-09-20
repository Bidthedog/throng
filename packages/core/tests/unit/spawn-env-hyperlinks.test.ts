import { describe, expect, it } from 'vitest';
import { hyperlinkAdvertisementEnv } from '../../src/terminal/spawn-env.js';

/**
 * 045 E1–E7 — `contracts/settings-and-environment.md` §4, FR-080 – FR-080d.
 *
 * Two rules, and both are about NOT doing something.
 *
 *  - **FR-080a**: a `FORCE_HYPERLINK` the user set is never overridden, in either direction. Not
 *    just their `0` — their `1` too, because their value is theirs and throng adding an identical
 *    one would make it throng's to take away later.
 *  - **FR-080d**: throng must not set `WT_SESSION`, or a `TERM_PROGRAM` naming another terminal,
 *    because programs read those as promises of that terminal's OTHER behaviour. E7 is how that is
 *    met rather than merely intended: the function can return **at most one key** and it is
 *    `FORCE_HYPERLINK`, so there is no version of this that could set a second.
 */

describe('hyperlinkAdvertisementEnv — E1: nothing set, advertising on', () => {
  it('adds FORCE_HYPERLINK=1', () => {
    expect(hyperlinkAdvertisementEnv({}, true)).toEqual({ FORCE_HYPERLINK: '1' });
    expect(hyperlinkAdvertisementEnv({ PATH: 'C:\\', TERM: 'xterm' }, true)).toEqual({
      FORCE_HYPERLINK: '1',
    });
  });
});

describe("hyperlinkAdvertisementEnv — E2\u2013E5: the user's own value always survives (FR-080a)", () => {
  it('E2: a user 0 is left alone', () => {
    expect(hyperlinkAdvertisementEnv({ FORCE_HYPERLINK: '0' }, true)).toBeUndefined();
  });

  it('E3: a user 1 is left alone too \u2014 it is theirs, not throng\u2019s', () => {
    expect(hyperlinkAdvertisementEnv({ FORCE_HYPERLINK: '1' }, true)).toBeUndefined();
  });

  it('E4: the key is matched without case, because Windows env names fold case', () => {
    expect(hyperlinkAdvertisementEnv({ force_hyperlink: '0' }, true)).toBeUndefined();
    expect(hyperlinkAdvertisementEnv({ Force_HyperLink: '1' }, true)).toBeUndefined();
    expect(hyperlinkAdvertisementEnv({ FORCE_HYPERLINK: 'anything' }, true)).toBeUndefined();
  });

  it('E5: set-but-empty is still set', () => {
    expect(hyperlinkAdvertisementEnv({ FORCE_HYPERLINK: '' }, true)).toBeUndefined();
  });

  it('a key whose VALUE is undefined is not set, so throng may add one', () => {
    // `process.env` reports an absent name as `undefined` rather than omitting it in some shapes;
    // that is absence, not a user choice.
    expect(hyperlinkAdvertisementEnv({ FORCE_HYPERLINK: undefined }, true)).toEqual({
      FORCE_HYPERLINK: '1',
    });
  });

  it('a merely similar name is not the same name', () => {
    expect(hyperlinkAdvertisementEnv({ FORCE_HYPERLINKS: '0' }, true)).toEqual({
      FORCE_HYPERLINK: '1',
    });
    expect(hyperlinkAdvertisementEnv({ HYPERLINK: '0' }, true)).toEqual({ FORCE_HYPERLINK: '1' });
  });
});

describe('hyperlinkAdvertisementEnv — E6: advertising off changes nothing at all (FR-080b)', () => {
  it('adds nothing, whatever the base holds', () => {
    for (const base of [
      {},
      { FORCE_HYPERLINK: '1' },
      { FORCE_HYPERLINK: '0' },
      { force_hyperlink: '1' },
    ]) {
      expect(hyperlinkAdvertisementEnv(base, false), JSON.stringify(base)).toBeUndefined();
    }
  });

  it('it does not UNSET a value either \u2014 throng neither sets nor clears', () => {
    // The answer is `undefined`, not `{ FORCE_HYPERLINK: '' }`: the caller merges the result, so
    // returning an empty value would be throng deleting something it did not create.
    expect(hyperlinkAdvertisementEnv({ FORCE_HYPERLINK: '1' }, false)).toBeUndefined();
  });
});

describe('hyperlinkAdvertisementEnv — E7: at most one key, and it is FORCE_HYPERLINK (FR-080d)', () => {
  it('over every input there is', () => {
    const bases: Record<string, string | undefined>[] = [
      {},
      { PATH: 'C:\\' },
      { WT_SESSION: 'abc' },
      { TERM_PROGRAM: 'vscode' },
      { FORCE_HYPERLINK: '0', WT_SESSION: 'abc', TERM_PROGRAM: 'WindowsTerminal' },
      { force_hyperlink: '' },
    ];
    for (const base of bases) {
      for (const advertise of [true, false]) {
        const result = hyperlinkAdvertisementEnv(base, advertise);
        if (result === undefined) continue;
        expect(Object.keys(result), JSON.stringify(base)).toEqual(['FORCE_HYPERLINK']);
      }
    }
  });

  it('never sets WT_SESSION or TERM_PROGRAM, even when the base carries neither', () => {
    const result = hyperlinkAdvertisementEnv({}, true) ?? {};
    expect(result).not.toHaveProperty('WT_SESSION');
    expect(result).not.toHaveProperty('TERM_PROGRAM');
  });
});

describe('hyperlinkAdvertisementEnv — purity', () => {
  it('does not mutate the base environment it was handed', () => {
    const base = { PATH: 'C:\\', FORCE_HYPERLINK: undefined };
    const before = JSON.stringify(base);
    hyperlinkAdvertisementEnv(base, true);
    expect(JSON.stringify(base)).toBe(before);
  });
});
