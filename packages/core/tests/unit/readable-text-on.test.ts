/**
 * #489 — the text colour drawn on a fill the USER chose (a project's colour), so it can be any hex
 * value at all: black or white, whichever reads, and at least WCAG AA 4.5:1 for every colour.
 */
import { describe, expect, it } from 'vitest';
import { contrastRatio, readableTextOn } from '@throng/core';

describe('readableTextOn', () => {
  it('draws dark text on a very light fill and light text on a very dark one', () => {
    expect(readableTextOn('#fafafa')).toBe('#000000');
    expect(readableTextOn('#0a0a12')).toBe('#ffffff');
  });

  it('meets 4.5:1 for every grey and every primary/secondary hue, light to dark', () => {
    const fills: string[] = [];
    for (let v = 0; v <= 255; v += 5) {
      const h = v.toString(16).padStart(2, '0');
      fills.push(`#${h}${h}${h}`, `#${h}0000`, `#00${h}00`, `#0000${h}`, `#${h}${h}00`, `#00${h}${h}`, `#${h}00${h}`);
    }
    for (const fill of fills) {
      const text = readableTextOn(fill);
      expect(text, fill).not.toBeNull();
      expect(contrastRatio(fill, text!), fill).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('accepts the 3-digit form a project colour may be stored in', () => {
    expect(readableTextOn('#fff')).toBe('#000000');
    expect(readableTextOn('#000')).toBe('#ffffff');
  });

  it('answers null for anything that is not a hex colour, so the caller can fall back to a theme pair', () => {
    expect(readableTextOn('')).toBeNull();
    expect(readableTextOn('red')).toBeNull();
    expect(readableTextOn('#12345')).toBeNull();
  });
});
