/**
 * The WCAG colour maths, with no dependency on any theme.
 *
 * Split out of `theme-quality.ts` (which re-exports all of it) by 057 round 13: `toCssVariables` in
 * `theme.ts` derives the attention circle's number colour with `readableTextOn` (FR-136), and
 * `theme-quality.ts` imports `THRONG_THEME` from `theme.ts` and reads it at load, so `theme.ts` cannot
 * import `theme-quality.ts` back. A leaf module both can import has no cycle.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse an `#rrggbb` string (case-insensitive) into 0–255 channels. */
export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

/** sRGB channel (0–255) → linear-light component (WCAG 2.1). */
export function channelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance in [0,1]. */
export function relativeLuminance(rgb: Rgb): number {
  const r = channelToLinear(rgb.r);
  const g = channelToLinear(rgb.g);
  const b = channelToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio in [1,21]. Symmetric in its arguments. */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexToRgb(hexA));
  const lb = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Black or white, whichever has more contrast against `fill` — or `null` when `fill` is not a 3- or
 * 6-digit hex colour (#489).
 *
 * For a fill a USER picked, a project's colour, so no theme pair was ever checked against it. One of
 * the two always clears WCAG AA 4.5:1: the worst case is a fill of luminance ~0.18, where both give
 * ~4.58.
 */
export function readableTextOn(fill: string): '#000000' | '#ffffff' | null {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(fill.trim());
  const hex = short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : fill.trim();
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  return contrastRatio(hex, '#000000') >= contrastRatio(hex, '#ffffff') ? '#000000' : '#ffffff';
}
