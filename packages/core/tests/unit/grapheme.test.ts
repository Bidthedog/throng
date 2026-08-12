import { describe, it, expect, vi } from 'vitest';
import { countGraphemes, truncateGraphemes, wasTruncated } from '../../src/text/grapheme.js';

/**
 * 031 US4 — the name limit counts what the user counts (contracts/name-limit.md, N1–N9).
 *
 * The limit is stated in "characters", and the only definition of that word a user shares with the
 * application is the **grapheme cluster**: the thing they would point at. A flag is one character
 * even though it is two code points and four UTF-16 units; a family emoji is one character even
 * though it is eight. Counting in `.length` would let a ten-character limit refuse the fourth emoji,
 * and slicing in `.length` would cut a name into a broken encoding.
 *
 * The fixtures below are written as escapes on purpose — their COMPOSITION is the thing under test,
 * and each one straddles the limit boundary, which is the ONLY place N2 can fail. A naive
 * `text.slice(0, limit)` passes every counting test in this file and fails every truncation one.
 */

/** man + ZWJ + woman + ZWJ + girl — ONE cluster, 8 UTF-16 units. */
const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
/** thumbs-up + medium skin-tone modifier — ONE cluster, 4 UTF-16 units. */
const THUMBS = '\u{1F44D}\u{1F3FD}';
/** regional indicators G + B (a flag) — ONE cluster, 4 UTF-16 units. */
const FLAG = '\u{1F1EC}\u{1F1E7}';
/** e + combining acute accent — ONE cluster, 2 UTF-16 units. */
const ACCENT = 'e\u0301';
/** Four CJK ideographs — four clusters, four UTF-16 units (BMP, so a naive slice survives these). */
const CJK = '漢字仮名';

/** A lone surrogate is the tell-tale of a cut that landed inside a cluster. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('countGraphemes (N1)', () => {
  it('counts nothing in an empty string', () => {
    expect(countGraphemes('')).toBe(0);
  });

  it('counts ASCII and CJK as the user sees them', () => {
    expect(countGraphemes('abcdef')).toBe(6);
    expect(countGraphemes(CJK)).toBe(4);
  });

  it('counts ten emoji as TEN — not twenty, and not forty', () => {
    // The failure this exists to catch: `.length` reports 80 for the families and 40 for the flags.
    expect(FAMILY.repeat(10).length).toBe(80);
    expect(countGraphemes(FAMILY.repeat(10))).toBe(10);
    expect(countGraphemes(THUMBS.repeat(10))).toBe(10);
    expect(countGraphemes(FLAG.repeat(10))).toBe(10);
  });

  it('counts each composed cluster class as one character', () => {
    expect(countGraphemes(FAMILY)).toBe(1);
    expect(countGraphemes(THUMBS)).toBe(1);
    expect(countGraphemes(FLAG)).toBe(1);
    expect(countGraphemes(ACCENT)).toBe(1);
  });

  it('counts a mixed name by cluster, not by code unit', () => {
    const mixed = `a${FAMILY}${CJK}${FLAG}${ACCENT}z`;
    expect(countGraphemes(mixed)).toBe(1 + 1 + 4 + 1 + 1 + 1);
    expect(mixed.length).toBeGreaterThan(countGraphemes(mixed));
  });
});

describe('truncateGraphemes cuts only on a cluster boundary (N2)', () => {
  // Each case places the boundary INSIDE a multi-unit cluster, so a `.length`-based cut breaks it.
  const straddles: ReadonlyArray<{ what: string; text: string; limit: number; expected: string }> = [
    { what: 'ASCII', text: 'abcdef', limit: 3, expected: 'abc' },
    { what: 'CJK', text: `${CJK}xy`, limit: 3, expected: '漢字仮' },
    { what: 'a ZWJ family emoji', text: `ab${FAMILY}cd`, limit: 3, expected: `ab${FAMILY}` },
    { what: 'a skin-tone modifier', text: `a${THUMBS}b`, limit: 2, expected: `a${THUMBS}` },
    { what: 'a regional-indicator flag', text: `a${FLAG}b`, limit: 2, expected: `a${FLAG}` },
    { what: 'a combining accent', text: `caf${ACCENT}x`, limit: 4, expected: `caf${ACCENT}` },
  ];

  for (const { what, text, limit, expected } of straddles) {
    it(`keeps ${what} whole when the boundary falls inside it`, () => {
      const out = truncateGraphemes(text, limit);
      expect(out).toBe(expected);
      expect(countGraphemes(out)).toBe(limit);
      expect(out).not.toMatch(LONE_SURROGATE);
      expect(text.startsWith(out)).toBe(true);
    });
  }

  it('never yields more clusters than the limit, whatever the mixture', () => {
    const mixed = `${FAMILY}a${FLAG}${ACCENT}${CJK}${THUMBS}z`;
    for (let limit = 1; limit <= countGraphemes(mixed) + 3; limit += 1) {
      const out = truncateGraphemes(mixed, limit);
      expect(countGraphemes(out)).toBeLessThanOrEqual(limit);
      expect(out).not.toMatch(LONE_SURROGATE);
      expect(mixed.startsWith(out)).toBe(true);
    }
  });

  it('leaves a name shorter than the limit exactly as it was', () => {
    expect(truncateGraphemes(`ab${FAMILY}`, 10)).toBe(`ab${FAMILY}`);
    expect(truncateGraphemes('', 10)).toBe('');
  });

  it('leaves a name EXACTLY at the limit exactly as it was', () => {
    expect(truncateGraphemes(FAMILY.repeat(10), 10)).toBe(FAMILY.repeat(10));
  });
});

describe('truncateGraphemes adds nothing and repeats cleanly (N4, N5)', () => {
  it('adds no ellipsis and no marker of any kind', () => {
    const out = truncateGraphemes('a long enough name to cut', 6);
    expect(out).toBe('a long');
    expect(out).not.toContain('…');
    expect(out).not.toContain('...');
  });

  it('is idempotent at a fixed limit, for every cluster class', () => {
    const texts = [
      'a long enough name to cut',
      `ab${FAMILY}cd${FLAG}`,
      `${THUMBS}${THUMBS}${THUMBS}`,
      `caf${ACCENT}s and more`,
      `${CJK}${CJK}`,
      'trailing space  before the cut',
    ];
    for (const text of texts) {
      for (const limit of [1, 2, 3, 5, 8, 13]) {
        const once = truncateGraphemes(text, limit);
        expect(truncateGraphemes(once, limit)).toBe(once);
      }
    }
  });
});

describe('wasTruncated and defensive limits (N6, N7)', () => {
  it('is false for a name exactly at the limit', () => {
    expect(wasTruncated('abcde', 5)).toBe(false);
    expect(wasTruncated(FAMILY.repeat(10), 10)).toBe(false);
  });

  it('is false below the limit and true above it', () => {
    expect(wasTruncated('abcd', 5)).toBe(false);
    expect(wasTruncated('abcdef', 5)).toBe(true);
    expect(wasTruncated(FAMILY.repeat(11), 10)).toBe(true);
  });

  it('agrees with truncation: it is true exactly when the value changed', () => {
    const texts = ['', 'abc', 'abcdef', `ab${FAMILY}cd`, 'cut after this  x', CJK];
    for (const text of texts) {
      for (const limit of [0, 1, 3, 4, 6, 20]) {
        expect(wasTruncated(text, limit)).toBe(truncateGraphemes(text, limit) !== text);
      }
    }
  });

  it('yields an empty string for a limit of zero or below, without throwing', () => {
    expect(truncateGraphemes(`ab${FAMILY}`, 0)).toBe('');
    expect(truncateGraphemes(`ab${FAMILY}`, -5)).toBe('');
    expect(wasTruncated('a', 0)).toBe(true);
    expect(wasTruncated('', 0)).toBe(false);
    expect(wasTruncated('a', -5)).toBe(true);
  });

  it('treats a non-finite limit as unbounded', () => {
    const text = `ab${FAMILY}cd`;
    expect(truncateGraphemes(text, Number.POSITIVE_INFINITY)).toBe(text);
    expect(truncateGraphemes(text, Number.NaN)).toBe(text);
    expect(wasTruncated(text, Number.POSITIVE_INFINITY)).toBe(false);
    expect(wasTruncated(text, Number.NaN)).toBe(false);
  });

  it('floors a fractional limit rather than cutting inside a cluster', () => {
    expect(truncateGraphemes('abcdef', 3.9)).toBe('abc');
  });
});

describe('trailing whitespace left by a cut (N9, FR-037e)', () => {
  it('trims a cut that lands after a space, so two names cannot render identically', () => {
    // Without the trim, "ab cd" and "ab ef" both render as "ab " — indistinguishable, and a name
    // ending in an invisible character is one the user can neither tell apart nor retype.
    expect(truncateGraphemes('ab cd', 3)).toBe('ab');
    expect(truncateGraphemes('ab ef', 3)).toBe('ab');
    expect(truncateGraphemes('one two three', 8)).toBe('one two');
  });

  it('may therefore leave a result SHORTER than the limit — correct, not a rounding error', () => {
    expect(countGraphemes(truncateGraphemes('ab cd', 3))).toBe(2);
  });

  it('leaves LEADING whitespace alone — the user typed that', () => {
    expect(truncateGraphemes('  abcd', 4)).toBe('  ab');
    expect(truncateGraphemes('  ab', 10)).toBe('  ab');
  });

  it('leaves trailing whitespace alone when no cut happened', () => {
    // The trim is a consequence of the cut, not a general normalisation of the name.
    expect(truncateGraphemes('ab  ', 10)).toBe('ab  ');
    expect(truncateGraphemes('ab  ', 4)).toBe('ab  ');
  });

  it('never empties a name whose cut is all whitespace — that whitespace is leading', () => {
    expect(truncateGraphemes('   abc', 2)).toBe('  ');
  });

  it('trims whitespace of every kind the cut leaves behind', () => {
    expect(truncateGraphemes('ab\t\ncd', 4)).toBe('ab');
  });
});

describe('the rename counter counts what the field permits (C4, FR-035d)', () => {
  it('never reports a count the field would refuse', () => {
    const typed = `${FAMILY}${THUMBS}${FLAG}${ACCENT}${CJK}abc`;
    const limit = 6;
    const capped = truncateGraphemes(typed, limit);
    expect(countGraphemes(capped)).toBe(limit);
    // One more cluster is refused: the capped value already sits at the counter's total.
    expect(wasTruncated(capped + FAMILY, limit)).toBe(true);
    expect(truncateGraphemes(capped + FAMILY, limit)).toBe(capped);
  });
});

describe('segmenter construction (R4)', () => {
  it('constructs its segmenter ONCE, not per call — the rename cap runs per keystroke', async () => {
    vi.resetModules();
    const Real = Intl.Segmenter;
    let constructions = 0;
    class Counting extends Real {
      constructor(locales?: Intl.LocalesArgument, options?: Intl.SegmenterOptions) {
        super(locales, options);
        constructions += 1;
      }
    }
    Object.defineProperty(Intl, 'Segmenter', { value: Counting, configurable: true, writable: true });
    try {
      const mod = await import('../../src/text/grapheme.js');
      for (let i = 0; i < 100; i += 1) {
        mod.countGraphemes(`ab${FAMILY}cd`);
        mod.truncateGraphemes(`ab${FAMILY}cd`, 3);
        mod.wasTruncated(`ab${FAMILY}cd`, 3);
      }
      expect(constructions).toBe(1);
    } finally {
      Object.defineProperty(Intl, 'Segmenter', { value: Real, configurable: true, writable: true });
    }
  });
});
