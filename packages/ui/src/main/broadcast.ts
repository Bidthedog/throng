import type { WebContents } from 'electron';

/**
 * The subset of a BrowserWindow the cross-window broadcaster touches. Declared
 * structurally so the broadcaster is unit-testable with plain fakes (no Electron
 * in the test) and so a real `BrowserWindow` satisfies it directly.
 */
export interface BroadcastTarget {
  isDestroyed(): boolean;
  readonly webContents: BroadcastContents;
}
export interface BroadcastContents {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
}

/**
 * Send `payload` on `channel` to every live renderer window, optionally excluding
 * one window by its `webContents` id (the sender, for edits a window applies
 * locally and must not have echoed back).
 *
 * Windows being torn down are skipped and every access is guarded:
 * `BrowserWindow.getAllWindows()` can still return a window whose `webContents` is
 * mid-destroy, and an IPC broadcast can run after a window closed — so reading
 * `.id` or calling `.send()` throws `TypeError: Object has been destroyed`.
 * Unguarded (the original per-handler loops), that escaped as an UNCAUGHT
 * main-process exception: it popped the Electron "A JavaScript error occurred in
 * the main process" dialog, could hang the app, and flaked every multi-window E2E
 * (panel-sync, subworkspaces, app-close) — worst on the hot daemon-events path
 * that fans terminal output out to all windows.
 */
export function broadcastToWindows(
  windows: readonly BroadcastTarget[],
  channel: string,
  payload: unknown,
  excludeWebContentsId?: number,
): void {
  for (const w of windows) {
    try {
      if (w.isDestroyed() || w.webContents.isDestroyed()) continue;
      if (excludeWebContentsId !== undefined && w.webContents.id === excludeWebContentsId) continue;
      w.webContents.send(channel, payload);
    } catch {
      // Window/webContents destroyed between the guard and the send — skip it and
      // keep broadcasting to the remaining windows.
    }
  }
}

/** The sender's `webContents` id, or `null` if it has already been destroyed. */
export function senderWebContentsId(sender: Pick<WebContents, 'id' | 'isDestroyed'>): number | null {
  try {
    return sender.isDestroyed() ? null : sender.id;
  } catch {
    return null;
  }
}
