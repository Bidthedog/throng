/**
 * 074 SC-003 (B2, 2026-11-20) — a large SVG is drawn without first parsing the whole document. Measured in the real
 * renderer, a 5 MB SVG of 110,000 shapes spent ~611 ms in an inert DOMParser parse whose only use was its size, on top
 * of Chromium's own ~869 ms decode: past the one-second budget. The size is on the root tag; the full parse is kept
 * for naming what is wrong when the picture will not draw.
 *
 * Layer: component — needs a DOM (DOMParser); jsdom decodes no image, so the loader is a fake. jsdom's parse is far
 * slower than Chromium's, which makes the whole-document parse unmistakable here.
 */
import { describe, expect, it } from 'vitest';
import { drawSvgSource, type PictureLoader } from '../../src/renderer/preview/blocks/picture.js';

const ok: PictureLoader = { load: () => Promise.resolve({ width: 10, height: 10 }) };
const bad: PictureLoader = { load: () => Promise.reject(new Error('decode')) };

function heavy(shapes: number): string {
  const rects = Array.from({ length: shapes }, (_, i) => `<rect x="${i % 400}" y="${Math.floor(i / 400)}" width="1" height="1"/>`).join('');
  return `<?xml version="1.0"?>\n<!-- a comment before the root -->\n<svg xmlns="http://www.w3.org/2000/svg" width="400" height="${Math.ceil(shapes / 400)}">${rects}</svg>`;
}

describe('a large SVG (SC-003)', () => {
  it('is sized from its root tag, without parsing the whole document', async () => {
    const source = heavy(60_000); // ~2.3 MB
    const started = performance.now();
    const wrapper = await drawSvgSource(source, ok);
    const elapsed = performance.now() - started;
    expect(wrapper.getAttribute('viewBox')).toBe('0 0 400 150');
    // jsdom parses this in seconds; a root-tag read takes a few milliseconds. 250 ms is an alarm, not a budget.
    expect(elapsed, `drawing took ${Math.round(elapsed)} ms`).toBeLessThan(250);
  });

  it('a malformed large SVG that will not draw still says what is wrong with it', async () => {
    const broken = heavy(2_000).replace('</svg>', '<g></svg>');
    await expect(drawSvgSource(broken, bad)).rejects.toThrow(/not well formed/);
  });

  it('a root tag it cannot read cheaply falls back to the full parse', async () => {
    const wrapper = await drawSvgSource('<!DOCTYPE svg [<!ENTITY w "30">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 10"/>', ok);
    expect(wrapper.getAttribute('viewBox')).toBe('0 0 30 10');
  });
});
