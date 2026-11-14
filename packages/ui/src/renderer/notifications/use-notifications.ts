import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { logCaught, orderEntries, type EntrySeverity, type NotificationEntry, type NotificationOrder } from '@throng/core';
import type { NotificationsSnapshot } from '../global.js';

/** How long an entry pulses after main reports a repeat (FR-031b). Matches the toast's own pulse. */
const FLASH_MS = 600;

export interface NotificationsState {
  /** The entries in the chosen order (FR-028). */
  entries: readonly NotificationEntry[];
  order: NotificationOrder;
  pendingCount: number;
  pendingSeverity: EntrySeverity | null;
  limit: number;
  /** The entry currently pulsing because its condition was raised again, or null. */
  flashingId: string | null;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  setOrder: (order: NotificationOrder) => void;
}

const EMPTY: NotificationsSnapshot = { entries: [], order: 'oldest', pendingCount: 0, pendingSeverity: null, limit: 100 };

/**
 * The Notifications panel's state in a window: main's snapshot (read once, then pushed on every
 * change to every window), the order applied to it, and the brief flash main asks the MAIN window for
 * when a stored condition is raised again (068 FR-029, FR-031b).
 *
 * The entries live in main; this hook holds a mirror and sends every action back. Answers carry the
 * new snapshot, but the `changed` push is what every window — this one included — renders from, so a
 * second window never disagrees with the first.
 */
export function useNotifications(): NotificationsState {
  const [snapshot, setSnapshot] = useState<NotificationsSnapshot>(EMPTY);
  const [flashingId, setFlashingId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const api = window.throng?.notifications;
    if (!api) return undefined;
    let live = true;
    void api
      .list()
      .then((s) => {
        if (live && s) setSnapshot(s);
      })
      .catch((error: unknown) => {
        // The panel stays empty until the next `changed`.
        logCaught('notifications: read the stored entries', error);
      });
    const offChanged = api.onChanged((s) => setSnapshot(s));
    const offRepeat = api.onRepeat(({ id }) => {
      setFlashingId(id);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashingId(null), FLASH_MS);
    });
    return () => {
      live = false;
      offChanged();
      offRepeat();
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  const entries = useMemo(() => orderEntries(snapshot.entries, snapshot.order), [snapshot.entries, snapshot.order]);

  const adopt = useCallback((answer: NotificationsSnapshot | null | undefined) => {
    if (answer) setSnapshot(answer);
  }, []);
  const dismiss = useCallback((id: string) => void window.throng?.notifications?.dismiss(id).then(adopt), [adopt]);
  const dismissAll = useCallback(() => void window.throng?.notifications?.dismissAll().then(adopt), [adopt]);
  const setOrder = useCallback((order: NotificationOrder) => void window.throng?.notifications?.setOrder(order).then(adopt), [adopt]);

  return {
    entries,
    order: snapshot.order,
    pendingCount: snapshot.pendingCount,
    pendingSeverity: snapshot.pendingSeverity,
    limit: snapshot.limit,
    flashingId,
    dismiss,
    dismissAll,
    setOrder,
  };
}
