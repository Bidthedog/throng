/**
 * 054 (manual test change requests, 2026-10-12) — two diagram rules that live only in CSS: the box is
 * highlighted while anything in it holds focus, and the toolbar's text glyph ("1:1") never wraps.
 *
 * Layer: unit — jsdom applies no stylesheet, so the declared rules are what a test can hold; how they paint
 * is the manual test plan's (MT-04).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../../src/renderer/preview/diagram/diagram.css', import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n');

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
}

describe('diagram.css', () => {
  // The ring is an overlay above the viewport, never an outline under it (2026-10-13; B8 measures the paint).
  it('rings the whole frame while focus is anywhere inside it, above the diagram', () => {
    const ring = rule('.preview-diagram-frame:focus-within::after');
    expect(ring).toMatch(/border:\s*2px solid var\(--panel-border-colour, var\(--throng-colour-activePanelBorder\)\)/);
    expect(ring).toMatch(/position:\s*absolute/);
    expect(ring).toMatch(/z-index:\s*2/);
    expect(ring).toMatch(/pointer-events:\s*none/);
    expect(css).not.toMatch(/\.preview-diagram-frame:focus-within\s*\{/);
  });

  it('shows the move cursor over the whole viewport while panning', () => {
    expect(rule('.preview-diagram-frame__viewport--panning,\n.preview-diagram-frame__viewport--panning *')).toMatch(/cursor:\s*move/);
  });

  // FR-046a (manual test change request, 2026-10-13) — a .mmd preview's diagram fills the panel; no scrollbar.
  it('never scrolls a Mermaid preview’s body, and gives its diagram the whole height', () => {
    expect(rule('.preview-panel__body:has(.preview-mermaid)')).toMatch(/overflow:\s*hidden/);
    expect(rule('.preview-mermaid')).toMatch(/height:\s*100%/);
    expect(rule('.preview-diagram-frame--fills > .preview-diagram-frame__viewport')).toMatch(/flex:\s*1 1 auto/);
  });

  // MT-04 retest (2026-10-13) — a .mmd preview's diagram is selected with its panel; only the panel is bordered.
  // …and the rule must WIN: at equal specificity the general ring, declared later, drew it anyway (MT-04 retest,
  // 2026-10-13: an inner border round a clicked .mmd diagram).
  it('draws no ring around a diagram that fills its panel, overriding the general ring', () => {
    const general = '.preview-diagram-frame:focus-within::after';
    const fills = '.preview-diagram-frame.preview-diagram-frame--fills:focus-within::after';
    expect(rule(fills)).toMatch(/content:\s*none/);
    expect(css.indexOf(`${fills} {`), 'the override comes after the ring it overrides').toBeGreaterThan(css.indexOf(`${general} {`));
  });

  // FR-032 (2026-10-13) — a diagram a Find in Files match revealed is marked above the drawing, then fades.
  it('marks a revealed diagram above the drawing, in the find match colour, fading out', () => {
    const mark = rule('.preview-diagram-host--revealed .preview-diagram-frame::before');
    expect(mark).toMatch(/var\(--throng-colour-searchMatchCurrent/);
    expect(mark).toMatch(/z-index:\s*2/);
    expect(mark).toMatch(/pointer-events:\s*none/);
    expect(mark).toMatch(/animation:\s*preview-diagram-revealed 1600ms/);
  });

  it('lets a toolbar glyph grow to its text and never wrap', () => {
    const icon = rule('.preview-diagram-frame__toolbar .icon');
    expect(icon).toMatch(/white-space:\s*nowrap/);
    expect(icon).toMatch(/width:\s*auto/);
  });
});
