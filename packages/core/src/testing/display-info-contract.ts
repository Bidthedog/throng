import type { IDisplayInfo, WindowBounds } from '../abstractions/display-info.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`IDisplayInfo contract violation: ${message}`);
  }
}

/**
 * Reusable contract suite for any `IDisplayInfo` implementation (research D8).
 * Throws on the first violation; returns normally when satisfied. Imports
 * nothing OS-specific so any test layer can run it.
 */
export function runDisplayInfoContract(makeSubject: () => IDisplayInfo): void {
  const subject = makeSubject();

  // Obligation 1: at least one display, each with positive dimensions.
  const displays = subject.listDisplays();
  assert(Array.isArray(displays) && displays.length >= 1, 'listDisplays() must return ≥ 1 display');
  for (const display of displays) {
    assert(
      display.bounds.width > 0 && display.bounds.height > 0,
      `display ${display.id} must have positive width/height`,
    );
  }

  // Obligation 2: a window fully inside the first display is visible.
  const first = displays[0].bounds;
  const inside: WindowBounds = {
    x: first.x + 10,
    y: first.y + 10,
    width: Math.max(1, Math.floor(first.width / 2)),
    height: Math.max(1, Math.floor(first.height / 2)),
  };
  assert(subject.isVisible(inside) === true, 'bounds inside a display must be visible');

  // Obligation 3: a window far off all displays is not visible.
  const offscreen: WindowBounds = { x: 1_000_000, y: 1_000_000, width: 400, height: 300 };
  assert(subject.isVisible(offscreen) === false, 'bounds off all displays must not be visible');

  // Obligation 4: clampToVisible always yields visible bounds, and is a no-op when already visible.
  const clamped = subject.clampToVisible(offscreen);
  assert(subject.isVisible(clamped) === true, 'clampToVisible() must produce visible bounds');
  const alreadyVisible = subject.clampToVisible(inside);
  assert(
    alreadyVisible.x === inside.x && alreadyVisible.y === inside.y,
    'clampToVisible() must be a no-op for already-visible bounds',
  );

  // Obligation 5: primaryBounds() names a real, positively-sized display.
  const primary = subject.primaryBounds();
  assert(
    primary.width > 0 && primary.height > 0,
    'primaryBounds() must have positive width/height',
  );
  assert(
    displays.some((d) => d.bounds.x === primary.x && d.bounds.y === primary.y),
    'primaryBounds() must match a connected display',
  );

  // Obligation 6: centerOnPrimary() yields a visible window centred within the
  // primary display (never off-screen, never larger than the display).
  const centred = subject.centerOnPrimary(400, 300);
  assert(subject.isVisible(centred) === true, 'centerOnPrimary() must be visible');
  assert(
    centred.x >= primary.x &&
      centred.y >= primary.y &&
      centred.x + centred.width <= primary.x + primary.width &&
      centred.y + centred.height <= primary.y + primary.height,
    'centerOnPrimary() must lie within the primary display',
  );
}
