/**
 * Keyboard handling for the breakdown (055 FR-068).
 *
 *   Up / Down        the previous / next node, in the order the rows are drawn
 *   Right / Enter    drill into the focused node
 *   Left / Backspace go up one level, and land on the node left
 *
 * Focus is ROVING: the breakdown is one Tab stop, on the focused row (`tabIndex` 0, the rest -1), and a
 * move hands DOM focus to the new row once it has rendered. These keys apply only while focus is in the
 * breakdown itself: in the filter field, a select or a button they belong to that control, and the
 * handler leaves them (and the event) untouched.
 */
import { useCallback, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { focusOn, setSelection } from './monitor-session.js';
import type { BreakdownRow } from './monitor-model.js';

export interface BreakdownKeysInput {
  readonly rows: readonly BreakdownRow[];
  readonly activeId: string | null;
  readonly focusPath: readonly string[];
}

export interface BreakdownKeys {
  readonly ref: RefObject<HTMLDivElement | null>;
  readonly onKeyDown: (event: ReactKeyboardEvent) => void;
}

/** Elements whose own keys these are. */
const OWN_KEYS = 'input, textarea, select, button, a[href], [contenteditable="true"], [role="button"], [role="menuitem"]';

/** Where DOM focus goes after the render a key caused: a named row, or whichever row comes first. */
type Pending = { readonly id: string } | 'first' | null;

export function useBreakdownKeys({ rows, activeId, focusPath }: BreakdownKeysInput): BreakdownKeys {
  const ref = useRef<HTMLDivElement | null>(null);
  const pending = useRef<Pending>(null);

  // After the commit the key caused: one attempt, then forget it, so a stale request can never steal
  // focus from a later render.
  useLayoutEffect(() => {
    const want = pending.current;
    if (want === null) return;
    pending.current = null;
    const rowsInDom = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []);
    const target = want === 'first' ? rowsInDom[0] : rowsInDom.find((e) => e.getAttribute('data-node-id') === want.id);
    // A leaf has no rows to land on: the breakdown itself keeps the keyboard, so Left still works.
    (target ?? ref.current)?.focus();
  });

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent): void => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
      if ((e.target as Element).closest(OWN_KEYS) !== null) return;
      const index = rows.findIndex((r) => r.node.id === activeId);
      const move = (to: number): void => {
        const next = rows[Math.max(0, Math.min(rows.length - 1, to))];
        if (next === undefined) return;
        pending.current = { id: next.node.id };
        setSelection(next.node.id);
      };
      switch (e.key) {
        case 'ArrowDown':
          move(index + 1);
          break;
        case 'ArrowUp':
          move(index - 1);
          break;
        case 'Home':
          move(0);
          break;
        case 'End':
          move(rows.length - 1);
          break;
        case 'ArrowRight':
        case 'Enter': {
          const row = rows[index];
          if (row === undefined) return;
          pending.current = 'first';
          focusOn(row.path);
          break;
        }
        case 'ArrowLeft':
        case 'Backspace': {
          if (focusPath.length < 2) return;
          const left = focusPath[focusPath.length - 1] as string;
          pending.current = { id: left };
          focusOn(focusPath.slice(0, -1));
          setSelection(left);
          break;
        }
        default:
          return;
      }
      e.preventDefault();
    },
    [rows, activeId, focusPath],
  );

  return { ref, onKeyDown };
}
