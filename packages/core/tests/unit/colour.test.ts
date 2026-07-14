import { describe, expect, it } from 'vitest';

import { hsvToRgb, isValidHex, parseHex, rgbToHsv, toHex } from '../../src/index.js';

/**
 * 018 / FR-026 — an invalid colour is REJECTED.
 *
 * This is a bug fix, not a preserved behaviour. Before it, the colour control committed its raw text
 * on every keystroke with no validation whatsoever: typing `zzz` into the hex field wrote the string
 * `zzz` into the theme file on disk, and the token silently stopped rendering.
 */
describe('parseHex (FR-026)', () => {
  it('accepts the six-digit form, with or without the hash', () => {
    expect(parseHex('#ff8800')).toEqual({ r: 255, g: 136, b: 0 });
    expect(parseHex('ff8800')).toEqual({ r: 255, g: 136, b: 0 });
    expect(parseHex('  #FF8800  ')).toEqual({ r: 255, g: 136, b: 0 });
  });

  it('accepts the three-digit shorthand', () => {
    expect(parseHex('#f80')).toEqual({ r: 255, g: 136, b: 0 });
    expect(parseHex('fff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('REJECTS everything that is not a colour', () => {
    // Each of these would have been written to the theme file verbatim before 018.
    for (const bad of ['zzz', '', '   ', '#', '#12', '#12345', '#1234567', 'rgb(1,2,3)', 'red']) {
      expect(parseHex(bad), `${JSON.stringify(bad)} must be rejected`).toBeNull();
      expect(isValidHex(bad)).toBe(false);
    }
  });
});

describe('the colour spaces the picker works in', () => {
  it('round-trips rgb → hsv → rgb', () => {
    // The saturation/value area and the hue slider work in HSV; the file holds hex. A drag that
    // silently shifted the colour on every round-trip would be a picker that cannot be trusted.
    for (const hex of ['#ff8800', '#000000', '#ffffff', '#6aa3ff', '#00ff41', '#123456']) {
      const rgb = parseHex(hex)!;
      const back = hsvToRgb(rgbToHsv(rgb));
      expect(toHex(back), `${hex} must survive the round trip`).toBe(hex);
    }
  });

  it('normalises to the six-digit lower-case form that goes on disk', () => {
    // The file must not vary by how the user typed it.
    expect(toHex(parseHex('#F80')!)).toBe('#ff8800');
    expect(toHex(parseHex('FF8800')!)).toBe('#ff8800');
  });

  it('clamps out-of-range channels rather than emitting nonsense', () => {
    expect(toHex({ r: 300, g: -20, b: 128 })).toBe('#ff0080');
  });

  it('keeps grey stable (a hue of zero, not an undefined one)', () => {
    const grey = rgbToHsv({ r: 128, g: 128, b: 128 });
    expect(grey.s).toBe(0);
    expect(Number.isNaN(grey.h)).toBe(false);
  });
});
