import { useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * The hover style of a collapsed side pane's strip and of a minimised panel's header (068 FR-067, FR-069, FR-070).
 *
 * Spread the result onto the element. While `collapsed` it carries the shared `collapsed-hover` class, whose style is
 * painted only when `data-hover-armed` is `true` — and that is set by a pointer that MOVES over the element, and cleared
 * when the pointer leaves. So an element collapsed under a pointer that has not moved since never shows the style until
 * the pointer leaves and returns (FR-070): the moment it collapses it is unarmed, whatever armed it before. No timers.
 *
 * A browser sends a synthetic move to an element that appears under a still pointer; it carries no movement, which is
 * how it is told from a real one. A host that reports no movement fields at all is taken at its word.
 */
/** Whether a pointer event carries real movement: a synthetic one after layout moved an element under a still pointer does not. */
export function isRealPointerMove(e: { movementX?: number; movementY?: number }): boolean {
  return e.movementX === undefined || e.movementY === undefined || e.movementX !== 0 || e.movementY !== 0;
}

export function useCollapsedHover(collapsed: boolean): {
  className?: string;
  'data-hover-armed'?: 'true' | 'false';
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerLeave: () => void;
} {
  const [armed, setArmed] = useState(false);
  // Derived reset: a fresh collapse starts unarmed, even when the pointer armed an earlier one.
  const [wasCollapsed, setWasCollapsed] = useState(collapsed);
  if (wasCollapsed !== collapsed) {
    setWasCollapsed(collapsed);
    setArmed(false);
  }

  const onPointerMove = (e: ReactPointerEvent): void => {
    if (!collapsed || armed) return;
    if (isRealPointerMove(e)) setArmed(true);
  };
  const onPointerLeave = (): void => setArmed(false);

  if (!collapsed) return { onPointerMove, onPointerLeave };
  return { className: 'collapsed-hover', 'data-hover-armed': armed ? 'true' : 'false', onPointerMove, onPointerLeave };
}
