/**
 * navigation-history-ipc — the `throng:history:*` bridge onto {@link NavigationHistoryService}, and the
 * two broadcasts that keep every window's layout in step with it (044 T154,
 * contracts/navigation-history.md §2 and §3 *Path changes*).
 *
 * The surface is deliberately small. Recording and moving have NO channel: they happen inside a load
 * (`throng:editor:load`) or a preview navigate, so no caller can move a position without the panel's
 * content having changed. What a renderer may do directly is attach (an editor on mount — a preview's
 * attach is `throng:preview:attach`), report where the reader is on a preview's current entry, and purge
 * a panel that no longer exists.
 *
 * The conventions are `preview-ipc.ts`'s, for the same reasons: payloads are coerced rather than trusted,
 * a malformed one never reaches the service, failures are returned rather than thrown across the bridge,
 * and Electron is not imported — `ipcMain` and the window list are handed in, so the contract test drives
 * the real handlers on fakes (T153).
 */
import { EMPTY_HISTORY, type NavigationHistory, type PersistedHistory } from '@throng/core';
import { broadcastToWindows, type BroadcastTarget } from './broadcast.js';
import type { HistoryChangedMessage, HistoryPanelKind, NavigationHistoryService } from './navigation-history-service.js';

export interface HistoryIpcEvent {
  sender: { id: number };
}

/** The subset of `ipcMain` this registers on. */
export interface HistoryIpcMain {
  handle(channel: string, listener: (event: HistoryIpcEvent, payload: unknown) => unknown): void;
  on(channel: string, listener: (event: HistoryIpcEvent, payload: unknown) => void): void;
}

export type HistoryIpcService = Pick<NavigationHistoryService, 'attach' | 'purge' | 'setCurrentViewState'>;

/** `throng:files:moved` — every window rewrites `config.history` and a preview's `config.filePath` (§3). */
export interface FilesMovedMessage {
  moves: readonly { from: string; to: string }[];
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/** Only the outer shape is checked; `parseHistory` is tolerant about everything inside it. */
function asPersisted(value: unknown): PersistedHistory | undefined {
  const h = record(value);
  return h.v === 1 && Array.isArray(h.entries) ? (value as PersistedHistory) : undefined;
}

/** `throng:editor:load`'s history intent — Back or Forward (§3). */
export interface EditorLoadNavigationField {
  kind: 'history';
  index: number;
  filePath: string;
}

/**
 * The two history fields `throng:editor:load` may carry (§3, §6 amended 2026-09-15), read off its raw
 * payload: `navigation`, the Back/Forward intent, and `history`, the layout's `config.history` a
 * RESTORING load brings so the coordinator can adopt it before recording.
 *
 * Here rather than in `editor-ipc.ts` so the contract test can reach it without Electron. Each field is
 * dropped — never the load refused — when malformed: a bad intent makes the load an ordinary open, and a
 * bad history is a panel with none, exactly as `parseHistory` would treat it.
 */
export function editorLoadHistoryFields(raw: unknown): {
  navigation?: EditorLoadNavigationField;
  history?: PersistedHistory;
} {
  const p = record(raw);
  const out: { navigation?: EditorLoadNavigationField; history?: PersistedHistory } = {};
  const n = record(p.navigation);
  if (n.kind === 'history' && Number.isInteger(n.index) && text(n.filePath) !== null) {
    out.navigation = { kind: 'history', index: n.index as number, filePath: n.filePath as string };
  }
  const history = asPersisted(p.history);
  if (history !== undefined) out.history = history;
  return out;
}

function asKind(value: unknown): HistoryPanelKind | null {
  return value === 'editor' || value === 'preview' ? value : null;
}

/** Run a fire-and-forget call; a throw is logged and dropped rather than raised into `ipcMain`. */
function quietly(channel: string, call: () => void): void {
  try {
    call();
  } catch (err) {
    console.error(`[navigation-history-ipc] ${channel} failed:`, err);
  }
}

export function registerNavigationHistoryIpc(ipc: HistoryIpcMain, service: HistoryIpcService): void {
  /*
   * An editor panel's mount (T158). Answers the record — adopted or created — so the mounting window's
   * store has it before any `changed` arrives. A request main cannot read, or a service that throws,
   * answers an empty history: the panel still works, its buttons are simply disabled until a load
   * records.
   */
  ipc.handle('throng:history:attach', (_event, payload): NavigationHistory => {
    const p = record(payload);
    const panelId = text(p.panelId);
    const panelKind = asKind(p.panelKind);
    if (panelId === null || panelKind === null) return EMPTY_HISTORY;
    try {
      return service.attach(panelId, panelKind, asPersisted(p.persisted));
    } catch (err) {
      console.error('[navigation-history-ipc] attach failed:', err);
      return EMPTY_HISTORY;
    }
  });

  ipc.on('throng:history:purge', (_event, payload) => {
    const panelId = text(record(payload).panelId);
    if (panelId !== null) quietly('purge', () => service.purge(panelId));
  });

  // Preview only, and the service enforces it (H10). `viewState` absent is a value: it clears the entry's.
  ipc.on('throng:history:setViewState', (_event, payload) => {
    const p = record(payload);
    const panelId = text(p.panelId);
    if (panelId !== null) quietly('setViewState', () => service.setCurrentViewState(panelId, p.viewState));
  });
}

/** The window list the broadcasts need. `main.ts` passes `BrowserWindow.getAllWindows`. */
export interface HistoryPushWindows {
  all(): readonly BroadcastTarget[];
}

/**
 * §2 / §3 — BOTH messages go to every live window, and there is no way to name one: a history has no
 * viewer set, and a window holding a panel in a background tab must hear it too.
 */
export function createHistoryPush(windows: HistoryPushWindows): {
  broadcastChanged(message: HistoryChangedMessage): void;
  broadcastFilesMoved(moves: readonly { from: string; to: string }[]): void;
} {
  return {
    broadcastChanged: (message) => broadcastToWindows(windows.all(), 'throng:history:changed', message),
    broadcastFilesMoved: (moves) =>
      broadcastToWindows(windows.all(), 'throng:files:moved', { moves } satisfies FilesMovedMessage),
  };
}
