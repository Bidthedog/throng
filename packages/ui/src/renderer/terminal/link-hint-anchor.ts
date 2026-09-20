import type { AnchorRect } from '../common/clamp-to-viewport.js';
import { linkHintAnchor } from '../links/link-hint-anchor.js';
import type { MarkedLink } from './link-marks.js';

/**
 * The cell geometry a terminal's plain-click hint needs to place itself — the DOM-dependent half,
 * read once at the mouseup site (`.xterm-screen`'s own rect, `term.cols`/`term.rows` for a uniform
 * monospace grid, and `buffer.active.viewportY` for how far the view has scrolled) and handed to the
 * pure function below so it can be driven without an xterm, a DOM or a shell (the same split
 * `hovered-link.ts` already uses).
 */
export interface TerminalCellGeometry {
  readonly cellWidth: number;
  readonly cellHeight: number;
  /** `.xterm-screen`'s own bounding rect, top-left, in page coordinates. */
  readonly screenLeft: number;
  readonly screenTop: number;
  /** `buffer.active.viewportY` — the 0-based buffer row currently at the TOP of the visible viewport. */
  readonly viewportY: number;
}

/**
 * 045 FR-165b, FR-165c (maintainer correction) — the plain-click hint's anchor for a terminal link:
 * the LINK's own LAST row's bottom-right corner, in cell geometry — never the point the mouse
 * happened to release at, which used to disagree with a link that wraps across rows and could land
 * the hint mid-link, obscuring its own text.
 *
 * `mark.range.end` is already the last row's own end cell (`link-marks.ts`'s 1-based, inclusive
 * range), so no separate "which row is last" judgement is needed here — only its geometry.
 */
export function terminalLinkHintAnchor(mark: MarkedLink, geometry: TerminalCellGeometry): AnchorRect {
  const rowIndex = mark.range.end.y - 1 - geometry.viewportY;
  const top = geometry.screenTop + rowIndex * geometry.cellHeight;
  return linkHintAnchor({
    left: geometry.screenLeft,
    top,
    right: geometry.screenLeft + mark.range.end.x * geometry.cellWidth,
    bottom: top + geometry.cellHeight,
  });
}
