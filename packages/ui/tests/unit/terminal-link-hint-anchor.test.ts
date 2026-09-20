import { describe, expect, it } from 'vitest';
import { terminalLinkHintAnchor } from '../../src/renderer/terminal/link-hint-anchor.js';
import type { MarkedLink } from '../../src/renderer/terminal/link-marks.js';

/**
 * 045 FR-165b, FR-165c (maintainer correction) — the terminal plain-click hint anchors at the LINK's
 * own last row's bottom-right corner, in cell geometry, never at the point the mouse released at.
 */
describe('terminalLinkHintAnchor', () => {
  it('anchors at the bottom-right of a single-row link, in cell geometry', () => {
    const link: MarkedLink = {
      kind: 'file',
      text: 'src/foo.ts',
      range: { start: { x: 5, y: 3 }, end: { x: 15, y: 3 } },
    };
    const anchor = terminalLinkHintAnchor(link, {
      cellWidth: 8,
      cellHeight: 16,
      screenLeft: 100,
      screenTop: 50,
      viewportY: 0,
    });
    // Row 3 (1-based) is viewport row index 2 (0-based): top = 50 + 2*16 = 82, bottom = 98.
    // end.x = 15 columns from the screen's own left: right = 100 + 15*8 = 220.
    expect(anchor).toEqual({ left: 220, top: 98, right: 220, bottom: 98 });
  });

  it('uses the LAST row for a link that wraps across several — not the first, and not the click', () => {
    const wrapped: MarkedLink = {
      kind: 'osc8',
      text: 'a long wrapped hyperlink',
      uri: 'file:///D:/proj/README.md',
      range: { start: { x: 70, y: 3 }, end: { x: 20, y: 4 } },
    };
    const anchor = terminalLinkHintAnchor(wrapped, {
      cellWidth: 8,
      cellHeight: 16,
      screenLeft: 0,
      screenTop: 0,
      viewportY: 0,
    });
    // Row 4 (1-based) is viewport row index 3: top = 3*16 = 48, bottom = 64. end.x = 20 -> right = 160.
    // Row 3 (the FIRST row, x=70) is deliberately not what this asserts — that would be right = 560.
    expect(anchor).toEqual({ left: 160, top: 64, right: 160, bottom: 64 });
  });

  it('accounts for a scrolled viewport (viewportY), not the absolute buffer row', () => {
    const link: MarkedLink = {
      kind: 'web',
      text: 'https://example.com/',
      range: { start: { x: 1, y: 50 }, end: { x: 9, y: 50 } },
    };
    const anchor = terminalLinkHintAnchor(link, {
      cellWidth: 10,
      cellHeight: 20,
      screenLeft: 0,
      screenTop: 0,
      viewportY: 45,
    });
    // Absolute 0-based row = 49; viewport row = 49 - 45 = 4: top = 80, bottom = 100. end.x = 9 -> right = 90.
    expect(anchor).toEqual({ left: 90, top: 100, right: 90, bottom: 100 });
  });
});
