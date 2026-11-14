import { type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPosition } from '../common/use-anchored-position.js';

/**
 * 068 FR-075 — the whole `Project › Tab › Panel` path of a Notifications panel entry, in the app's hover popover, so a path
 * the entry's own line has cut off can be read in full.
 *
 * Built as the attention popover and the tab popover are: portaled to the body (the list scrolls and clips), placed by the
 * shared `clampToViewport` through `useAnchoredPosition` (flips and clamps, held `visibility: hidden` until measured), and
 * `pointer-events: none` so it never swallows a click on the entry or strands a hover of its own. Not a native title: a title
 * waits, cannot be styled, and cannot wrap a long path.
 */
export function PlacePopover({
  anchor,
  text,
  testId = 'notification-place-popover',
  multiline = false,
}: {
  anchor: HTMLElement | null;
  text: string;
  testId?: string;
  /** The text carries line breaks the popover keeps (a toast's heading, place and message, one per line). */
  multiline?: boolean;
}): ReactElement | null {
  const { ref, pos } = useAnchoredPosition<HTMLDivElement>(anchor, text);
  if (!anchor || text === '') return null;
  return createPortal(
    <div
      ref={ref}
      className="notification-place-popover"
      data-testid={testId}
      role="tooltip"
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? 'visible' : 'hidden',
        // A toast's popover sits over the toast stack (z-index 2500), whose cards it may overlap.
        ...(multiline ? { whiteSpace: 'pre-line' as const, zIndex: 2600 } : {}),
      }}
    >
      {text}
    </div>,
    document.body,
  );
}
