import { afterEach, describe, expect, it } from 'vitest';
import { captureSelection } from '../../src/renderer/preview/copy.js';

/**
 * 047 T045 — a `.preview-fold-toggle` sits inside its heading as the heading's first child (R6), so a
 * selection spanning that heading must not carry the toggle's icon glyph into the copied text or HTML,
 * as if the author had typed it. `preview-copy.test.ts` covers copy end to end through the full body;
 * this is `captureSelection`'s own exclusion, over a plain DOM tree.
 */

function select(range: Range): void {
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

afterEach(() => {
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

describe('captureSelection excludes a throng-drawn fold toggle (T045, R6)', () => {
  it('a selection spanning a heading with a toggle carries the heading text, never the glyph', () => {
    const host = document.createElement('div');
    const h1 = document.createElement('h1');
    const toggle = document.createElement('button');
    toggle.className = 'preview-fold-toggle';
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '▾'; // the glyph a real toggle carries (▾)
    toggle.append(icon);
    h1.append(toggle, document.createTextNode('My Heading'));
    const p = document.createElement('p');
    p.textContent = 'body text';
    host.append(h1, p);
    document.body.append(host);

    const range = document.createRange();
    range.selectNodeContents(host);
    select(range);

    const captured = captureSelection(host);
    expect(captured?.text).toBe('My Headingbody text');
    expect(captured?.text).not.toContain('▾');
    expect(captured?.fragment.querySelectorAll('.preview-fold-toggle')).toHaveLength(0);
  });

  it('a selection of the toggle alone (no other text) captures nothing — not the alt-text fallback either', () => {
    const host = document.createElement('div');
    const toggle = document.createElement('button');
    toggle.className = 'preview-fold-toggle';
    toggle.textContent = '▸'; // ▸
    host.append(toggle);
    document.body.append(host);

    const range = document.createRange();
    range.selectNodeContents(host);
    select(range);

    const captured = captureSelection(host);
    expect(captured?.text).toBe('');
  });

  it('leaves ordinary content untouched when no toggle is present', () => {
    const host = document.createElement('div');
    host.textContent = 'plain text, no gutter';
    document.body.append(host);
    const range = document.createRange();
    range.selectNodeContents(host);
    select(range);

    expect(captureSelection(host)?.text).toBe('plain text, no gutter');
  });
});

describe('captureSelection excludes a throng-drawn table resize handle (T066, R6)', () => {
  it('a selection spanning a header cell with a handle carries the header text, never any handle content', () => {
    const host = document.createElement('div');
    const table = document.createElement('table');
    const row = document.createElement('tr');
    const th = document.createElement('th');
    const handle = document.createElement('div');
    handle.className = 'preview-table-resize-handle';
    th.append(document.createTextNode('Column A'), handle);
    row.append(th);
    table.append(row);
    host.append(table);
    document.body.append(host);

    const range = document.createRange();
    range.selectNodeContents(host);
    select(range);

    const captured = captureSelection(host);
    expect(captured?.text).toBe('Column A');
    expect(captured?.fragment.querySelectorAll('.preview-table-resize-handle')).toHaveLength(0);
  });
});
