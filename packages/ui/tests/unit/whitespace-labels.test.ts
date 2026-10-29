/**
 * 059 FR-062 — View Whitespace names every invisible character it marks.
 *
 * The set is every Unicode White_Space character, every other C0/C1 control and DEL, and the invisible
 * look-alikes; `whitespace-all.txt` (the maintainer's reference file, MT-07) holds most of them. Code points
 * are written as numbers throughout: an escape typed into a source file has twice arrived as the raw
 * character, which for U+2028 breaks the very literal it sits in.
 */
import { describe, expect, it } from 'vitest';
import { whitespaceLabel, isMarkedCharacter } from '../../src/renderer/editor/whitespace-labels.js';

/** Every White_Space code point except the three with marks of their own: TAB, LF and SPACE. */
const WHITE_SPACE = [
  0x0b, 0x0c, 0x0d, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
  0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
];
const LOOK_ALIKES = [
  0xad, 0x34f, 0x61c, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a,
  0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x2066, 0x2067, 0x2068, 0x2069,
  0x206a, 0x206f, 0x3164, 0xfeff, 0xffa0, 0x2800,
];
const CONTROLS = [0x00, 0x01, 0x08, 0x0e, 0x1b, 0x1f, 0x7f, 0x80, 0x9f];

describe('whitespaceLabel (059 FR-062)', () => {
  it('names every character of the set, with a label and a name', () => {
    for (const code of [...WHITE_SPACE, ...LOOK_ALIKES, ...CONTROLS]) {
      const label = whitespaceLabel(code);
      expect(label, code.toString(16)).not.toBeNull();
      expect(label!.abbr.length, code.toString(16)).toBeGreaterThan(0);
      expect(label!.name.length, code.toString(16)).toBeGreaterThan(0);
      expect(isMarkedCharacter(code), code.toString(16)).toBe(true);
    }
  });

  it('uses Unicode’s abbreviation where there is one', () => {
    const abbr = (c: number) => whitespaceLabel(c)?.abbr;
    expect(abbr(0xa0)).toBe('NBSP');
    expect(abbr(0x200b)).toBe('ZWSP');
    expect(abbr(0x200d)).toBe('ZWJ');
    expect(abbr(0x2060)).toBe('WJ');
    expect(abbr(0x85)).toBe('NEL');
    expect(abbr(0x0b)).toBe('VT');
    expect(abbr(0x0c)).toBe('FF');
    expect(abbr(0x1b)).toBe('ESC');
    expect(abbr(0x7f)).toBe('DEL');
    expect(abbr(0x2003)).toBe('EMSP');
    expect(abbr(0x2028)).toBe('LSEP');
    expect(abbr(0x3000)).toBe('IDSP');
    expect(abbr(0xfeff)).toBe('ZWNBSP');
  });

  it('falls back to U+XXXX where there is none', () => {
    expect(whitespaceLabel(0x2800)?.abbr).toBe('U+2800');
    expect(whitespaceLabel(0x115f)?.abbr).toBe('U+115F');
  });

  it('names the character in full for the hover', () => {
    expect(whitespaceLabel(0x2003)?.name).toBe('U+2003 EM SPACE');
    expect(whitespaceLabel(0x1b)?.name).toBe('U+001B ESCAPE');
  });

  it('draws each as ONE glyph, so its marker fits one cell (FR-064)', () => {
    for (const code of [...WHITE_SPACE, ...LOOK_ALIKES, ...CONTROLS]) {
      expect([...whitespaceLabel(code)!.glyph], code.toString(16)).toHaveLength(1);
    }
    const glyph = (c: number) => whitespaceLabel(c)?.glyph;
    expect(glyph(0xa0)).toBe('°');
    expect(glyph(0x2003)).toBe('␣');
    expect(glyph(0x200b)).toBe('ø');
    expect(glyph(0x200e)).toBe('↔');
    expect(glyph(0x1b)).toBe('ε');
  });

  it('leaves SPACE, TAB, LF and ordinary text to their own marks, or none', () => {
    for (const code of [0x20, 0x09, 0x0a, 0x41, 0xe9, 0x4e2d]) {
      expect(whitespaceLabel(code), code.toString(16)).toBeNull();
      expect(isMarkedCharacter(code), code.toString(16)).toBe(false);
    }
  });
});
