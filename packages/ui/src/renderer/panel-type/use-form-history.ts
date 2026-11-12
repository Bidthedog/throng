/**
 * The remembered Startup Commands and Shell Arguments for one terminal type (067 FR-061).
 *
 * Main owns the lists and their rules (distinct, newest first, trimmed to N, kept on restart); this reads
 * them when the terminal type changes and forgets one field on request. With the history switched off
 * (FR-064a) nothing is asked for or offered, though stored values stay until cleared in Preferences.
 */
import { useCallback, useEffect, useState } from 'react';
import { logCaught } from '@throng/core';
import { useAppSettings } from '../config/config-store.js';

export type HistoryField = 'startupCommand' | 'shellArguments';

export interface FormHistory {
  startupCommand: readonly string[];
  shellArguments: readonly string[];
  clearField: (field: HistoryField) => void;
  /** 067 FR-133 — forget one value of one field; main then tells every open form. */
  removeValue: (field: HistoryField, value: string) => void;
}

const EMPTY = { startupCommand: [], shellArguments: [] } as const;

export function useFormHistory(flavourId: string | undefined): FormHistory {
  const enabled = useAppSettings().terminals.formHistory.enabled;
  const [lists, setLists] = useState<{ flavourId: string | undefined; startupCommand: readonly string[]; shellArguments: readonly string[] }>({
    flavourId: undefined,
    ...EMPTY,
  });

  // 067 FR-064b, FR-066 — a clear made anywhere (the Preferences window is a separate window) reaches a
  // form that is already open: main announces it, and the lists are read again.
  const [stale, setStale] = useState(0);
  useEffect(() => {
    const api = window.throng?.formHistory;
    if (!enabled || !api?.onChanged || !flavourId) return undefined;
    return api.onChanged((change) => {
      if (change.flavourId === undefined || change.flavourId === flavourId) setStale((n) => n + 1);
    });
  }, [enabled, flavourId]);

  useEffect(() => {
    const api = window.throng?.formHistory;
    if (!enabled || !api || !flavourId) return undefined;
    let current = true;
    api
      .get(flavourId)
      .then((got) => {
        if (current) setLists({ flavourId, startupCommand: got.startupCommand, shellArguments: got.shellArguments });
      })
      .catch((error: unknown) => logCaught('use-form-history: read the remembered values', error));
    return () => {
      current = false;
    };
  }, [enabled, flavourId, stale]);

  const clearField = useCallback(
    (field: HistoryField) => {
      if (!flavourId) return;
      window.throng?.formHistory?.clearField(flavourId, field);
      setLists((l) => (l.flavourId === flavourId ? { ...l, [field]: [] } : l));
    },
    [flavourId],
  );

  const removeValue = useCallback(
    (field: HistoryField, value: string) => {
      if (!flavourId) return;
      window.throng?.formHistory?.removeValue?.(flavourId, field, value);
      // At once, so the open list does not wait on main's announcement.
      setLists((l) => (l.flavourId === flavourId ? { ...l, [field]: l[field].filter((v) => v !== value) } : l));
    },
    [flavourId],
  );

  // Another type's lists, or a turned-off history, read as empty — never stale values from before.
  const own = enabled && lists.flavourId === flavourId ? lists : { ...EMPTY };
  return { startupCommand: own.startupCommand, shellArguments: own.shellArguments, clearField, removeValue };
}
