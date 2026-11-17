import { type ReactElement } from 'react';

/**
 * The throng brand mark in the title bar (#72) — the app's own icon, sitting left
 * of the window identity in every window that draws a bar.
 *
 * It is the app icon (`icon/icon_large.svg`, the "crowd" t: a pixel t built from
 * project-coloured tiles on a black plate), redrawn on a 15px pixel grid as
 * `icon/icon_16.svg` is on a 16px one. Keep the cells and colours below in step with
 * those files.
 *
 * The size is 15px and must stay ODD. The bar is 34px with `box-sizing: border-box`
 * and a 1px bottom border, so its content box is 33px — centring an even-sized mark
 * in it lands on a half pixel ((33-16)/2 = 8.5) and blurs its bottom row. An odd size
 * centres on a whole pixel ((33-15)/2 = 9). 15px also matches the cog glyph beside it.
 *
 * Its colours are fixed rather than themed: the black plate carries its own contrast,
 * so the mark reads on every bundled theme, light and dark. It is inlined rather than
 * an <img> because the renderer CSP forbids the `data:` URI a bundled SVG import
 * would produce.
 *
 * A brand mark is chrome, not an action control, so it is not an icon key
 * (constitution: themeable icons apply to action controls) — a user's icon set must
 * not be able to replace the application's own identity.
 */
// The t's cells (column, row) on the icon's 5x7 grid, with each tile's colour.
const TILES: ReadonlyArray<readonly [col: number, row: number, fill: string]> = [
  [1, 0, '#2bb3a3'],
  [1, 1, '#8a7cf0'],
  [0, 2, '#2bb3a3'],
  [1, 2, '#f2a93b'],
  [2, 2, '#8a7cf0'],
  [3, 2, '#f2665e'],
  [1, 3, '#f2a93b'],
  [1, 4, '#f2665e'],
  [1, 5, '#f2a93b'],
  [4, 5, '#8a7cf0'],
  [2, 6, '#2bb3a3'],
  [3, 6, '#f2a93b'],
];

export function ThrongMark(): ReactElement {
  return (
    <svg
      className="throng-mark"
      data-testid="throng-mark"
      width="15"
      height="15"
      viewBox="0 0 15 15"
      aria-hidden
      focusable="false"
    >
      <rect width="15" height="15" rx="3" fill="#000000" />
      {/* One 2px block per cell, on whole pixels: at 15px the 1024 drawing's tiles would fall between pixels and blur. */}
      {TILES.map(([col, row, fill]) => (
        <rect key={`${col},${row}`} x={2 + col * 2} y={1 + row * 2} width="2" height="2" fill={fill} shapeRendering="crispEdges" />
      ))}
    </svg>
  );
}
