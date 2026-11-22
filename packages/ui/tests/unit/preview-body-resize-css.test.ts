/**
 * 075 SC-006 (2026-11-20) — dragging a panel edge beside a preview costs what it costs beside plain text, whatever
 * the preview holds.
 *
 * Measured beside 500 typeset equations, a drag spent its time in three places, each answered by one declaration
 * on the preview's scrolling body. jsdom lays nothing out and paints nothing, so the claim is asserted on the
 * stylesheet, where it is made:
 *   - a themed scrollbar that moves is "changed", and a changed scrollbar lays out everything it scrolls — hidden
 *     while a drag is held (`resize-freeze.ts`), over a gutter that stays so hiding it narrows nothing;
 *   - moving the body re-recorded its paint — its own compositor layer;
 *   - pre-paint and forced layouts elsewhere walked into the document — contained.
 *
 * The layer and the containment are the drag's alone. Either makes the body the containing block of every
 * `position: fixed` element inside it, and three dialogs open there over the whole window — the CSV cell dialog,
 * Go to Row and Go to Page (`.modal-overlay`, 073 FR-036a, FR-062b): held by a body that scrolls, they would open
 * inside the panel, scrolled with the document and clipped by it. No drag starts while one is open; its overlay
 * covers the window.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RESIZING_CLASS } from '../../src/renderer/preview/resize-freeze.js';

const css = readFileSync(resolve(__dirname, '../../src/renderer/preview/preview.css'), 'utf8');

/** The body of the top-level rule whose selector is exactly `prelude`. */
function blockOf(prelude: string): string {
  const at = css.indexOf(`\n${prelude} {`);
  expect(at, `preview.css has no \`${prelude} {\``).toBeGreaterThanOrEqual(0);
  const open = at + prelude.length + 3;
  return css.slice(open, css.indexOf('\n}', open));
}

describe('the preview body under a panel drag (075 SC-006)', () => {
  it('keeps a gutter that stays, and holds no fixed-position element of its own between drags', () => {
    const body = blockOf('.preview-panel__body');
    expect(body).toMatch(/scrollbar-gutter:\s*stable;/);
    // Each of these makes the body the containing block of a `position: fixed` descendant.
    expect(body).not.toMatch(/will-change:[^;]*transform/);
    expect(body).not.toMatch(/contain:\s*[^;]*(strict|content|layout|paint)/);
    expect(body).not.toMatch(/(^|[^-])(transform|filter|perspective):/m);
  });

  it('is its own contained layer, with its scrollbar hidden, while a drag is held', () => {
    const held = blockOf(`.${RESIZING_CLASS}`);
    expect(held).toMatch(/overflow:\s*hidden;/);
    expect(held).toMatch(/will-change:\s*transform;/);
    expect(held).toMatch(/contain:\s*strict;/);
  });
});
