/**
 * 077 FR-024 (the maintainer, 2026-11-21 08:16: "When entering an invalid value in a preferences box, the error should
 * be shown in preferences toast, rather than inline. The inline setting shifts the layout and its ugly.")
 *
 * What is wrong with a box's entry is said in the Preferences window's own toast — the notification surface every
 * other Preferences message already uses (`useNotify`) — and the box keeps only its red outline, so nothing moves.
 *
 * One condition, one notice (CLAUDE.md): a box owns at most one card, named by the box's `…-invalid` test id. A new
 * problem with the same entry rewrites that card in place; the same entry confirmed again flashes it (the provider's
 * duplicate rule); the entry put right, restored with Escape, or the box leaving the window clears it.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useNotifyOptional } from '../common/notification.js';

/**
 * Report a box's problem: `message` is what the toast says, `null` when the entry is fine. `repeat` marks the same
 * entry confirmed again, which flashes the card already showing it rather than raising nothing.
 *
 * A control mounted with no notification provider (a bare component under test) reports nothing; its outline still
 * shows.
 */
export type FieldNotice = (message: string | null, repeat?: boolean) => void;

export function useFieldNotice(testId: string): FieldNotice {
  const ctx = useNotifyOptional();
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const shown = useRef<{ id: string; message: string } | null>(null);

  const report = useCallback<FieldNotice>(
    (message, repeat = false) => {
      const notices = ctxRef.current;
      if (notices === null) return;
      if (message === null) {
        if (shown.current === null) return;
        shown.current = null;
        notices.clear(testId);
        return;
      }
      if (shown.current !== null && shown.current.message === message && !repeat) return;
      // A different problem with the same box rewrites its card rather than stacking a second one beside it.
      if (shown.current !== null && shown.current.message !== message && notices.update(shown.current.id, { message })) {
        shown.current = { id: shown.current.id, message };
        return;
      }
      // A first raise, or the same message again: the provider flashes a card that is still up, or raises it anew if
      // its time ran out.
      const id = notices.notify({ severity: 'warning', subject: { kind: 'none' }, message, testId });
      shown.current = { id, message };
    },
    [testId],
  );

  useEffect(
    () => () => {
      if (shown.current !== null) ctxRef.current?.clear(testId);
    },
    [testId],
  );

  return report;
}
