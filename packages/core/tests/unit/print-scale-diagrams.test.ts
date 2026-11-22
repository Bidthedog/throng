/**
 * Scale reaches a diagram (maintainer, 2026-11-22: "The 'scale' does not seem to work for mermaid diagram previews;
 * they fill the horizontal space of the preview regardless of which scale it set"). A diagram drawn at 100% of its
 * column fills the column at any scale, since the column widens as the scale shrinks it. With a scale chosen (Fit
 * off) a diagram is laid out at its own size instead, still no wider than its column, so the scale shrinks or grows
 * it with everything else. Fit keeps the diagram filling the page or column (075 FR-075).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINT_SETTINGS, PRINT_NATURAL_DIAGRAM_CSS, toPdfOptions } from '../../src/index.js';

describe('Scale and a diagram', () => {
  it('lays diagrams out at their own size while a scale applies, and fills the page while fitting', () => {
    // A flowing document's diagrams; a page-shaped printable's own Scale is its Fit stylesheet (print-page-fit.test.ts).
    const scaled = { ...DEFAULT_PRINT_SETTINGS, scale: { ...DEFAULT_PRINT_SETTINGS.scale, fitWidth: false, percent: 50 } };
    expect(toPdfOptions(scaled, undefined, 'width').naturalDiagrams).toBe(true);
    expect(toPdfOptions(scaled, undefined, 'width').scale).toBe(0.5);
    expect(toPdfOptions({ ...scaled, scale: { ...scaled.scale, fitWidth: true } }, undefined, 'width').naturalDiagrams).toBe(false);
  });

  it('sizes each diagram by its own width, capped at its column', () => {
    expect(PRINT_NATURAL_DIAGRAM_CSS).toMatch(/\.throng-print__diagram svg\{[^}]*width:var\(--throng-print-natural-width,100%\)/);
    expect(PRINT_NATURAL_DIAGRAM_CSS).toMatch(/max-width:100%/);
  });
});
