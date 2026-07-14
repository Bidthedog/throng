/**
 * Colour parsing and validation for the themed colour picker (018 / US4, FR-026).
 *
 * There was NO validation before this. The colour control committed its raw text on every keystroke,
 * so typing `zzz` into the hex field wrote the string `zzz` straight into the theme file on disk, and
 * the token silently stopped rendering. The specification described FR-026 as *preserving* the
 * numeric control's rejection behaviour; it is not preserving anything, it is a bug fix.
 *
 * Pure, and in core, so it can be unit-tested without a DOM — the renderer has no component-test
 * layer, so a validator living only in the picker could not be tested at all.
 */

// `Rgb` already exists — the theme-quality guards work in it. One shape, one name: a second `Rgb`
// with identical fields is exactly the duplication this feature exists to remove.
import type { Rgb } from './theme-quality.js';

export type { Rgb };

export interface Hsv {
  /** 0–360 */
  h: number;
  /** 0–1 */
  s: number;
  /** 0–1 */
  v: number;
}

const HEX6 = /^#?([0-9a-fA-F]{6})$/;
const HEX3 = /^#?([0-9a-fA-F]{3})$/;

/**
 * Parse a hex colour, accepting the 3- and 6-digit forms with or without the leading `#`.
 *
 * Returns `null` for anything else — which is what makes rejection possible. The picker keeps the
 * last valid colour applied and shows the error on the row, exactly as the numeric control does.
 */
export function parseHex(input: string): Rgb | null {
  const text = input.trim();

  const six = HEX6.exec(text);
  if (six) {
    const n = parseInt(six[1]!, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  const three = HEX3.exec(text);
  if (three) {
    const [r, g, b] = [...three[1]!].map((c) => parseInt(c + c, 16));
    return { r: r!, g: g!, b: b! };
  }

  return null;
}

/** Is this a colour the theme file can hold? */
export function isValidHex(input: string): boolean {
  return parseHex(input) !== null;
}

/** Normalise to the 6-digit lower-case form that goes on disk, so the file never varies by input. */
export function toHex({ r, g, b }: Rgb): string {
  const byte = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r1, g1, b1] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}
