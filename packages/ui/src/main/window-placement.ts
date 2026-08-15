/**
 * Where a secondary window opens — centred on the window it belongs to, not on the primary monitor.
 *
 * ══ WHY THIS EXISTS ══
 *
 * Preferences and About were created with no `x`/`y` and no `center`, so Electron chose the default
 * position: the primary display. With throng on a second monitor the user clicked a cog on one
 * screen and the window appeared on another.
 *
 * ══ WHY THE GEOMETRY IS SEPARATED FROM ELECTRON ══
 *
 * So it can be tested. Every vitest project in this repo runs in a node environment, and a rule
 * buried inside a `BrowserWindow` call needs a real display to exercise. Keeping the arithmetic pure
 * also keeps it honest about the one part that is genuinely fiddly — the edges.
 */

import { screen, type BrowserWindow } from 'electron';

/** The rectangle shape Electron uses for both window bounds and a display's work area. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * The top-left at which a window of `size` is centred over `parent`, kept inside `workArea`.
 *
 * **Clamping is part of the feature rather than a defensive extra.** "Centre on the parent" alone is
 * wrong at the edges: a main window pushed against the side of a display, or one larger than the
 * display it sits on, yields a centre whose derived top-left puts the new window partly or wholly
 * off-screen. An unreachable window is worse than a misplaced one, because there is no affordance
 * left to recover it — the title bar is exactly the part that goes missing.
 *
 * `workArea` rather than `bounds` deliberately: it excludes the taskbar, so a window is never
 * centred underneath it.
 */
export function centredOnParent(parent: Rect, workArea: Rect, size: Size): { x: number; y: number } {
  const centreX = parent.x + parent.width / 2;
  const centreY = parent.y + parent.height / 2;

  return {
    x: clamp(Math.round(centreX - size.width / 2), workArea.x, workArea.x + workArea.width - size.width),
    y: clamp(Math.round(centreY - size.height / 2), workArea.y, workArea.y + workArea.height - size.height),
  };
}

/**
 * `min` wins when the range is inverted.
 *
 * That happens when the window is larger than the work area — a low-resolution secondary screen, or
 * a scaled display with a tall taskbar — and the two clamps contradict each other. Showing the
 * top-left corner is the right answer there: it is the corner carrying the title bar and the close
 * button, so the window stays usable even though it does not fit.
 */
function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * The `{x, y}` to open a window of `size` centred over `parent` — or `{}` when there is no parent to
 * centre on, which lets the caller spread it into `BrowserWindow` options and get Electron's default.
 *
 * The display is chosen by the PARENT'S CENTRE rather than by its origin. A window straddling two
 * monitors belongs to the one holding most of it, and its origin can easily be on the other.
 *
 * `screen` is only usable after the app is ready. Every caller here runs on a user action — a cog
 * click, a menu item — so that is always true by then.
 */
export function placeOverParent(
  parent: BrowserWindow | null | undefined,
  size: Size,
): { x: number; y: number } | Record<string, never> {
  if (!parent || parent.isDestroyed()) return {};

  const bounds = parent.getBounds();
  const centre = {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  };
  return centredOnParent(bounds, screen.getDisplayNearestPoint(centre).workArea, size);
}
