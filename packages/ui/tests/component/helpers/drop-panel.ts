/**
 * Drive a REAL dnd-kit panel drag to a drop target in jsdom (049 FR-000b, FR-000..FR-002 across a drag).
 *
 * jsdom has no layout, so `pointerWithin` — the collision detection the app uses — would find nothing. Each
 * drop target is given a rectangle through `getBoundingClientRect`, keyed by its `data-testid`, and the
 * pointer is released inside it: the drop lands where the real one would, through `onDragEnd` in
 * `tab-group.tsx`. Call {@link installDropGeometry} in `beforeEach` and the returned function in `afterEach`.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import type { MountedTabGroup } from './mount-tab-group.js';

const rects = new Map<string, { left: number; top: number; width: number; height: number }>();

/** Install the rectangle stub; returns the uninstall. */
export function installDropGeometry(): () => void {
  rects.clear();
  const real = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const r = rects.get(this.getAttribute('data-testid') ?? '');
    if (!r) return real.call(this);
    return {
      x: r.left,
      y: r.top,
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      right: r.left + r.width,
      bottom: r.top + r.height,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return () => {
    Element.prototype.getBoundingClientRect = real;
  };
}

/** Press a panel's header, drag, and release inside the rectangle given to `targetTestId`. */
export async function dragPanelTo(
  mounted: MountedTabGroup,
  panelId: string,
  targetTestId: string,
  /** Hold the pointer over the target this long before releasing — over a tab, long enough for its dwell to switch to it. */
  dwellMs = 0,
): Promise<void> {
  const stopsBefore = mounted.ghost.stop.mock.calls.length;
  rects.set(targetTestId, { left: 400, top: 400, width: 60, height: 30 });
  const handle = screen.getByTestId(`panel-handle-${panelId}`);
  fireEvent.pointerDown(handle, { isPrimary: true, button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(document, { isPrimary: true, clientX: 30, clientY: 10 });
  fireEvent.pointerMove(document, { isPrimary: true, clientX: 50, clientY: 10 });
  await waitFor(() => expect(mounted.ghost.start).toHaveBeenCalled());
  fireEvent.pointerMove(document, { isPrimary: true, clientX: 420, clientY: 415 });
  if (dwellMs > 0) await new Promise((resolve) => setTimeout(resolve, dwellMs));
  fireEvent.pointerUp(document, { isPrimary: true, clientX: 420, clientY: 415 });
  await waitFor(() => expect(mounted.ghost.stop.mock.calls.length).toBeGreaterThan(stopsBefore));
  rects.delete(targetTestId);
}
