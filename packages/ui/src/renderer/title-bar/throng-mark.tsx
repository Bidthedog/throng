import { type ReactElement } from 'react';

/**
 * The throng brand mark in the title bar (#72) — the app's own icon, sitting left
 * of the window identity in every window that draws a bar.
 *
 * This is the SMALL artwork (`icon/icon_small.svg`): the title bar is 34px tall, so
 * the mark renders small, well inside the size band the simplified drawing was made
 * for. The detailed drawing (`icon_large.svg`) is what the .ico carries at >=48px
 * for the taskbar. Keep the paths below in step with `icon_small.svg` — that file is
 * the source of truth for the geometry (the Inkscape working file, `icon/icon.svg`,
 * is not).
 *
 * The size is 15px and must stay ODD. The bar is 34px with `box-sizing: border-box`
 * and a 1px bottom border, so its content box is 33px — centring an even-sized mark
 * in it lands on a half pixel ((33-16)/2 = 8.5), and because this artwork runs
 * edge-to-edge in its viewBox, that half pixel renders the outermost row at 50%
 * coverage and the mark looks shaved off along the bottom. An odd size centres on a
 * whole pixel ((33-15)/2 = 9). 15px also matches the cog glyph beside it.
 *
 * Why it is inlined rather than an <img> of the .svg: the mark has to take its
 * COLOUR FROM THE ACTIVE THEME. It is drawn as a frame around a body the colour of
 * the app background — shipping it as fixed white-on-black would erase the frame on
 * the bundled Light theme. Inlined, the frame and glyph ride `currentColor` (the
 * identity text colour) and the body takes the app-background token, so the mark is
 * correct on all 15 bundled themes and any the user writes. This also sidesteps the
 * renderer CSP, which forbids the `data:` URI a bundled SVG import would produce.
 *
 * A brand mark is chrome, not an action control, so it is not an icon-pack token
 * (constitution: themeable icons apply to action controls) — a user's icon pack must
 * not be able to replace the application's own identity. It matches the sibling
 * inline glyphs (cog, window controls) in construction.
 */
export function ThrongMark(): ReactElement {
  return (
    <svg
      className="throng-mark"
      data-testid="throng-mark"
      width="15"
      height="15"
      viewBox="0 0 1000 1000"
      aria-hidden
      focusable="false"
    >
      {/* Outer plate: the window's border/frame. */}
      <path
        className="throng-mark__frame"
        d="m 30,970 v 30 h 940 v -30 h 30 V 30 H 970 V 0 H 30 V 30 H 0 v 940 z"
      />
      {/* The window body — the colour of the app behind it. */}
      <path
        className="throng-mark__body"
        d="M 50,920 V 80 H 80 V 50 h 840 v 30 h 30 v 840 h -30 v 30 H 80 v -30 z"
      />
      {/* The "T". */}
      <path
        className="throng-mark__glyph"
        d="M 335.89741,100 H 500 v 164.10257 h 164.10256 v 123.0769 H 500 l 1.09055,389.74364 H 664.10256 V 674.35901 H 766.66668 V 900 H 438.46154 V 879.48726 H 397.43589 V 858.97435 H 376.92306 V 817.94882 H 335.89741 V 387.17947 H 233.33332 v -123.0769 c 0,0 61.53846,0 82.05127,0 13.1698,0 20.51282,-9.42808 20.51282,-20.51281 0,-47.86327 0,-143.58975 0,-143.58976 z"
      />
    </svg>
  );
}
