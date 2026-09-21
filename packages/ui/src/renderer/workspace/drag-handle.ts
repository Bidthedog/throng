/**
 * A drag handle that only drags from its NON-interactive parts (#406).
 *
 * A panel title and a tab chip are each one dnd-kit drag handle, with controls inside them — Add,
 * Close, Back, Forward, a tab's X. dnd-kit's PointerSensor listens for `pointerdown` on the handle,
 * so a press on a control that moved a few pixels before release started a drag instead of (or as
 * well as) the control's own action. Stopping `mousedown` on the control, which the tab's X did,
 * never reached it: the sensor is on POINTER events.
 *
 * So the handle's `onPointerDown` ignores a press that began on an interactive element inside it.
 * Everything else still drags — the title text, the empty space, and non-interactive marks such as
 * the panel type icon (the maintainer's ruling on #406: only interactable elements are excluded).
 * One rule, in one place, so a control added to either strip later is covered without remembering to
 * stop anything.
 */
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { DraggableSyntheticListeners } from '@dnd-kit/core';

/** What counts as interactive: something a press ACTS on, rather than something it merely lands on. */
export const INTERACTIVE_SELECTOR =
  'button, a[href], input, select, textarea, [role="button"], [contenteditable="true"]';

/** Did this press begin on an interactive element inside the handle (the handle itself excluded)? */
export function pressedOnControl(event: ReactPointerEvent<Element>): boolean {
  const target = event.target as Element | null;
  const control = target?.closest?.(INTERACTIVE_SELECTOR) ?? null;
  return control !== null && control !== event.currentTarget && event.currentTarget.contains(control);
}

/** dnd-kit's listeners, with `onPointerDown` refusing a press that began on a control. */
export function dragFromNonInteractive(
  listeners: DraggableSyntheticListeners,
): DraggableSyntheticListeners {
  const down = listeners?.onPointerDown as ((event: ReactPointerEvent<Element>) => void) | undefined;
  if (!listeners || !down) return listeners;
  return {
    ...listeners,
    onPointerDown: (event: ReactPointerEvent<Element>) => {
      if (pressedOnControl(event)) return;
      down(event);
    },
  };
}
