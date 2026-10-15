/**
 * Whether the Resource Monitor modal is open (055 FR-050 – FR-056), and where the status-bar item is.
 *
 * Module-level rather than React state, like `maximise-store.ts`: the writers are the status-bar item,
 * the cog menu, the window dispatcher's chord and the main-process open request, none of which share a
 * component; the readers are the modal host, the dispatcher's exclusive gate and the status bar. It is
 * never persisted — the modal's view state lives in `monitor-session.ts` and lasts until throng
 * restarts (FR-057).
 */
import { useSyncExternalStore } from 'react';
import { parseWindowIdentity } from '../window-identity.js';

let open = false;
const listeners = new Set<() => void>();
let statusItem: HTMLElement | null = null;

function notify(): void {
  for (const listener of [...listeners]) listener();
}

export function isMonitorOpen(): boolean {
  return open;
}

export function openMonitor(): void {
  if (open) return;
  open = true;
  notify();
}

export function closeMonitor(): void {
  if (!open) return;
  open = false;
  notify();
}

/** The monitor's own chord: opens it, and closes it again while it is the thing in front (FR-050). */
export function toggleMonitor(): void {
  if (open) closeMonitor();
  else openMonitor();
}

export function subscribeMonitor(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMonitorOpen(): boolean {
  return useSyncExternalStore(subscribeMonitor, isMonitorOpen, isMonitorOpen);
}

/**
 * The route every "Resource Monitor" command takes (FR-056): the main window opens its own modal, a
 * sub-workspace window asks main to open it in the main window and bring that forward.
 */
export function openResourceMonitor(): void {
  if (parseWindowIdentity(window.location.search).kind === 'subworkspace') {
    window.throng?.resources?.open();
    return;
  }
  openMonitor();
}

/** The status-bar item registers its element so the minimise animation has somewhere to shrink to. */
export function setStatusItemElement(element: HTMLElement | null): void {
  statusItem = element;
}

/** The item's rectangle, or `null` when the bar has none (no item mounted). One read, on demand. */
export function getStatusItemRect(): DOMRect | null {
  return statusItem?.getBoundingClientRect() ?? null;
}

/** Tests only: closed, no item, no listeners carried between tests. */
export function __resetMonitorStore(): void {
  open = false;
  statusItem = null;
  listeners.clear();
}
