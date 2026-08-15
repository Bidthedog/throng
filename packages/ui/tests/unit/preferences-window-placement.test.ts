import { describe, expect, it } from 'vitest';
import { centredOnParent } from '../../src/main/window-placement.js';

/**
 * Preferences opens centred on the MAIN WINDOW, not on the primary monitor.
 *
 * ══ WHAT WAS WRONG ══
 *
 * The window was created with no `x`/`y` and no `center`, so Electron chose the default position —
 * the primary display. With throng on a second monitor, Preferences opened on the other screen
 * entirely: the user clicks a cog on one monitor and the window appears on another.
 *
 * ══ WHY CLAMPING IS PART OF THE FEATURE, NOT A DEFENSIVE EXTRA ══
 *
 * "Centre it on the parent" alone is wrong at the edges. A main window pushed against the right of a
 * display, or one bigger than the display it sits on, produces a centre whose derived top-left puts
 * Preferences partly or wholly off-screen — and an unreachable window is a worse bug than a
 * misplaced one, because there is no affordance to recover it.
 *
 * Geometry is separated from Electron so it can be tested at all: every vitest project here runs in
 * a node environment, and a rule buried inside a `BrowserWindow` call cannot be exercised without a
 * real display.
 */
const SIZE = { width: 780, height: 640 };

/** A typical 1920×1080 display with a taskbar, positioned as a secondary monitor to the right. */
const SECONDARY = { x: 1920, y: 0, width: 1920, height: 1040 };

describe('centredOnParent', () => {
  it('puts the two centres in the same place', () => {
    const parent = { x: 2200, y: 200, width: 1200, height: 800 };
    const { x, y } = centredOnParent(parent, SECONDARY, SIZE);

    expect(x + SIZE.width / 2, 'horizontal centres must coincide').toBe(
      parent.x + parent.width / 2,
    );
    expect(y + SIZE.height / 2, 'vertical centres must coincide').toBe(
      parent.y + parent.height / 2,
    );
  });

  it('stays on the SECOND monitor when the parent is there', () => {
    // The actual report: throng on another monitor, Preferences opening on the primary one.
    const parent = { x: 2200, y: 200, width: 1200, height: 800 };
    const { x } = centredOnParent(parent, SECONDARY, SIZE);

    expect(x).toBeGreaterThanOrEqual(SECONDARY.x);
    expect(x + SIZE.width).toBeLessThanOrEqual(SECONDARY.x + SECONDARY.width);
  });

  it('clamps rather than hanging off the right edge', () => {
    // A main window shoved against the right of the display: the true centre would put most of
    // Preferences beyond it.
    const parent = { x: 3500, y: 100, width: 340, height: 600 };
    const { x } = centredOnParent(parent, SECONDARY, SIZE);

    expect(x + SIZE.width, 'the whole window must remain on the work area').toBeLessThanOrEqual(
      SECONDARY.x + SECONDARY.width,
    );
  });

  it('clamps rather than hanging off the top, where the title bar would be unreachable', () => {
    const parent = { x: 2200, y: 0, width: 1200, height: 200 };
    const { y } = centredOnParent(parent, SECONDARY, SIZE);

    expect(y, 'a window above the work area cannot be dragged back').toBeGreaterThanOrEqual(
      SECONDARY.y,
    );
  });

  it('falls back to the work-area origin when the window does not fit at all', () => {
    /*
     * A display smaller than the window — a low-resolution secondary screen, or a scaled display
     * with a large taskbar. Clamping both ways is contradictory here, so the rule is "show the
     * top-left", because that is the corner carrying the title bar and the close button.
     */
    const tiny = { x: 0, y: 0, width: 640, height: 480 };
    const parent = { x: 0, y: 0, width: 640, height: 480 };
    const { x, y } = centredOnParent(parent, tiny, SIZE);

    expect({ x, y }).toEqual({ x: tiny.x, y: tiny.y });
  });

  it('rounds to whole pixels — Electron bounds are integers', () => {
    const parent = { x: 0, y: 0, width: 1001, height: 801 };
    const { x, y } = centredOnParent(parent, { x: 0, y: 0, width: 3000, height: 2000 }, SIZE);

    expect(Number.isInteger(x)).toBe(true);
    expect(Number.isInteger(y)).toBe(true);
  });
});
