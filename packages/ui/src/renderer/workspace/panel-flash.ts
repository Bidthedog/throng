/**
 * 047 FR-083 — a brief flash of a panel's border, marking where a file opened from File Explorer went.
 *
 * FR-081 leaves the keyboard in the tree, so the panel the file landed in no longer takes focus, and with
 * several editors and previews on screen nothing says which one it was. The flash answers that.
 *
 * Module-level rather than React state, like `panel-focus.ts`: the open routes are plain functions that
 * never see the panel's component. A request made BEFORE the panel mounts — a preview or editor placed a
 * moment ago — is honoured when it does, provided it mounts within {@link FLASH_PARK_MS}; an older one is
 * stale and never plays, so a panel that mounts much later (a tab switched to next week) does not flash.
 *
 * Constitution XII: nothing here reads layout. The flash is an overlay whose only animated property is
 * opacity, so it runs on the compositor and costs the input thread nothing.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/** How long the flash plays. `theme.css`'s `panel-flash` animation runs for the same time. */
export const FLASH_DURATION_MS = 900;
/** How long a request waits for its panel to mount before it is dropped as stale. */
export const FLASH_PARK_MS = 1000;

interface FlashRequest {
  seq: number;
  at: number;
}

const requests = new Map<string, FlashRequest>();
const listeners = new Set<() => void>();
let seq = 0;

/** Flash `panelId`'s border now, or the moment it mounts (within {@link FLASH_PARK_MS}). */
export function requestPanelFlash(panelId: string): void {
  seq += 1;
  requests.set(panelId, { seq, at: Date.now() });
  for (const listener of listeners) listener();
}

/** Tests only: the request standing for `panelId`, if any. */
export function panelFlashRequest(panelId: string): FlashRequest | undefined {
  return requests.get(panelId);
}

/** Tests only: no requests, no listeners' state carried between tests. */
export function __resetPanelFlash(): void {
  requests.clear();
  seq = 0;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The key of the flash `panelId` should be showing, or `null`. A new key per request, so a second flash
 * while one is still playing remounts the overlay and restarts its animation rather than being lost.
 */
export function usePanelFlash(panelId: string): number | null {
  const requested = useSyncExternalStore(subscribe, () => requests.get(panelId)?.seq ?? 0);
  const [showing, setShowing] = useState<number | null>(null);
  const played = useRef(0);

  // Start: once per request, and only while it is fresh.
  useEffect(() => {
    const req = requests.get(panelId);
    if (req === undefined || req.seq !== requested || req.seq <= played.current) return;
    played.current = req.seq;
    requests.delete(panelId);
    if (Date.now() - req.at <= FLASH_PARK_MS) setShowing(req.seq);
  }, [panelId, requested]);

  // Stop: keyed on what is showing, so a restart replaces the timer rather than racing it.
  useEffect(() => {
    if (showing === null) return;
    const timer = setTimeout(() => setShowing(null), FLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, [showing]);

  return showing;
}
