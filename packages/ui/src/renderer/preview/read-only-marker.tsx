/**
 * 073 FR-050a, FR-050b — the **Read-only** marker on a workbook preview's status bar, and its flash.
 *
 * The marker is permanent: a padlock and the words, with a hover saying how to edit the cells. It is a readout, not a
 * control — it performs nothing — so it is drawn as the status bar's readouts are, with the theme's icon.
 *
 * An edit tried on the workbook's grid (`DataGrid`'s `onEditAttempt`) does not raise a notice of its own: one
 * condition, one notice (constitution), and the condition — this workbook is read-only — is already on screen. The
 * attempt makes that notice louder instead, with the pulse a repeated notice card uses (`notification.tsx`'s flash,
 * 600 ms): a repeat while a pulse is running is absorbed into it, not queued, so trying again and again never makes
 * the marker twitch.
 *
 * The grid and the bar are drawn by different components (the body and the panel chrome), so the request travels
 * through this per-panel store rather than through props.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Icon } from '../common/icon.js';
import './read-only-marker.css';

/** The marker's hover, and the reason every disabled editing row in a workbook's menus gives (FR-050a, FR-050c). */
export const WORKBOOK_READ_ONLY_TITLE = 'Workbooks open read-only. Copy cells and paste them into a CSV to edit them.';

/** One pulse, as long as a repeated notice card's (`notification.tsx`). */
export const READ_ONLY_PULSE_MS = 600;

const listeners = new Map<string, Set<() => void>>();

/** Ask `panelId`'s Read-only marker to flash: an edit was tried on its read-only grid. */
export function requestReadOnlyFlash(panelId: string): void {
  for (const listener of [...(listeners.get(panelId) ?? [])]) listener();
}

/** Hear `panelId`'s flash requests. Returns the unsubscribe. */
export function subscribeReadOnlyFlash(panelId: string, listener: () => void): () => void {
  let set = listeners.get(panelId);
  if (set === undefined) {
    set = new Set();
    listeners.set(panelId, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(panelId);
    current?.delete(listener);
    if (current?.size === 0) listeners.delete(panelId);
  };
}

export function ReadOnlyMarker({ panelId }: { panelId: string }): ReactElement {
  const [pulsing, setPulsing] = useState(false);
  const [pulses, setPulses] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeReadOnlyFlash(panelId, () => {
      if (timer.current !== null) return; // absorbed into the pulse already running
      setPulsing(true);
      setPulses((n) => n + 1);
      timer.current = setTimeout(() => {
        timer.current = null;
        setPulsing(false);
      }, READ_ONLY_PULSE_MS);
    });
    return () => {
      unsubscribe();
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [panelId]);

  return (
    <span
      className={`editor-status-strip__readout preview-read-only${pulsing ? ' preview-read-only--pulsing' : ''}`}
      data-testid={`preview-read-only-${panelId}`}
      data-pulsing={pulsing ? 'true' : undefined}
      data-pulse-count={pulses}
      title={WORKBOOK_READ_ONLY_TITLE}
    >
      <Icon token="readOnly" className="preview-read-only__icon" />
      Read-only
    </span>
  );
}
