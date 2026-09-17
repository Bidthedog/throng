/**
 * preview-ipc — the `throng:preview:*` bridge onto {@link PreviewService} (044 T064,
 * contracts/preview-ipc.md §1–§2).
 *
 * Two rules the whole surface keeps, both copied from `file-search-ipc.ts` for the same reasons:
 *
 * - **The window is `event.sender`, never the payload.** A viewer, a requester and a placing window
 *   are all named by the webContents that sent the message, so pushes only ever reach a window that
 *   asked for them — a renderer-supplied id would let one window aim a run's updates at another.
 *   Project isolation (Principle I) is NOT this rule's doing: a window names the panel it attaches,
 *   and it is `PreviewService.attach` that refuses an existing run whose project differs from the
 *   request's (`outside-project`).
 * - **Failures are returned, never thrown across the bridge** (the `EditorService` convention). Every
 *   payload is coerced rather than trusted, a malformed one never reaches the service, and a service
 *   that throws answers with the failure shape its channel already has.
 *
 * Electron is not imported: `ipcMain` and the window lookups are handed in, so the contract test drives
 * the real handlers on a fake `ipcMain` (T060).
 */
import type {
  PersistedHistory,
  PreviewAttachRequest,
  PreviewAttachResponse,
  PreviewFocusMessage,
  PreviewNavigateRequest,
  PreviewNavigateResponse,
  PreviewOpenChanged,
  PreviewOpenRequest,
  PreviewOpenResponse,
  PreviewPathChanged,
  PreviewPlaceMessage,
  PreviewRefreshResponse,
  PreviewUpdate,
} from '@throng/core';
import { broadcastToWindows, type BroadcastContents, type BroadcastTarget } from './broadcast.js';
import type { PreviewPush, PreviewService } from './preview-service.js';

export interface PreviewIpcEvent {
  sender: { id: number };
}

/** The subset of `ipcMain` this registers on. */
export interface PreviewIpcMain {
  handle(channel: string, listener: (event: PreviewIpcEvent, payload: unknown) => unknown): void;
  on(channel: string, listener: (event: PreviewIpcEvent, payload: unknown) => void): void;
}

export type PreviewIpcService = Pick<
  PreviewService,
  | 'open'
  | 'attach'
  | 'detach'
  | 'destroyed'
  | 'navigate'
  | 'refresh'
  | 'isOpen'
  | 'openPaths'
  | 'publishEditorTitle'
  | 'placeDeclined'
>;

const OPEN_FAILED: PreviewOpenResponse = { kind: 'refused', reason: 'no-file' };
/** A request main cannot read names no previewable file: a verdict, so the renderer clears the panel. */
const ATTACH_MALFORMED: PreviewAttachResponse = { ok: false, reason: 'no-provider' };
/** An unexpected error is not a verdict: the renderer keeps the panel and offers Try again. */
const ATTACH_FAILED: PreviewAttachResponse = { ok: false, reason: 'failed' };

const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

function asOpen(payload: unknown): PreviewOpenRequest | null {
  const p = record(payload);
  const absPath = text(p.absPath);
  const projectId = text(p.projectId);
  if (absPath === null || projectId === null) return null;
  const req: PreviewOpenRequest = { absPath, projectId, hasParentLocally: p.hasParentLocally === true };
  const requester = text(p.requesterPanelId);
  if (requester !== null) req.requesterPanelId = requester;
  return req;
}

/** Only the outer shape is checked; `parseHistory` is tolerant about everything inside it. */
function asHistory(value: unknown): PersistedHistory | undefined {
  const h = record(value);
  return h.v === 1 && Array.isArray(h.entries) ? (value as PersistedHistory) : undefined;
}

function asAttach(payload: unknown): PreviewAttachRequest | null {
  const p = record(payload);
  const panelId = text(p.panelId);
  const projectId = text(p.projectId);
  const filePath = text(p.filePath);
  if (panelId === null || projectId === null || filePath === null) return null;
  const req: PreviewAttachRequest = { panelId, projectId, filePath };
  const reservation = text(p.reservation);
  if (reservation !== null) req.reservation = reservation;
  const history = asHistory(p.history);
  if (history !== undefined) req.history = history;
  return req;
}

function asNavigate(payload: unknown): PreviewNavigateRequest | { invalid: string } {
  const p = record(payload);
  const target = record(p.target);
  const absPath = text(target.absPath);
  const panelId = text(p.panelId);
  const intent = record(p.intent);
  if (panelId === null || absPath === null) return { invalid: absPath ?? '' };
  let parsedIntent: PreviewNavigateRequest['intent'];
  if (intent.kind === 'link') parsedIntent = { kind: 'link' };
  else if (intent.kind === 'history' && Number.isInteger(intent.index)) {
    parsedIntent = { kind: 'history', index: intent.index as number };
  } else if (intent.kind === 'heading') parsedIntent = { kind: 'heading' };
  else return { invalid: absPath };
  const req: PreviewNavigateRequest = { panelId, target: { absPath }, intent: parsedIntent };
  const fragment = text(target.fragment);
  if (fragment !== null) req.target.fragment = fragment;
  if (p.leavingViewState !== undefined) req.leavingViewState = p.leavingViewState;
  // Where a jump landed means something for a heading only (FR-115); it reaches no other intent.
  if (parsedIntent.kind === 'heading' && p.arrivingViewState !== undefined) req.arrivingViewState = p.arrivingViewState;
  return req;
}

const navigateRefused = (target: string): PreviewNavigateResponse => ({
  kind: 'refused',
  notice: { kind: 'link-missing-file', target },
});

/** Run a fire-and-forget call; a throw is logged and dropped rather than raised into `ipcMain`. */
function quietly(channel: string, call: () => void): void {
  try {
    call();
  } catch (err) {
    console.error(`[preview-ipc] ${channel} failed:`, err);
  }
}

export function registerPreviewIpc(ipc: PreviewIpcMain, service: PreviewIpcService): void {
  ipc.handle('throng:preview:open', async (event, payload) => {
    const req = asOpen(payload);
    if (req === null) return OPEN_FAILED;
    try {
      return await service.open(event.sender.id, req);
    } catch {
      return OPEN_FAILED;
    }
  });

  ipc.handle('throng:preview:attach', async (event, payload) => {
    const req = asAttach(payload);
    if (req === null) return ATTACH_MALFORMED;
    try {
      return await service.attach(event.sender.id, req);
    } catch (err) {
      console.error('[preview-ipc] attach failed:', err);
      return ATTACH_FAILED;
    }
  });

  ipc.handle('throng:preview:navigate', async (event, payload) => {
    const req = asNavigate(payload);
    if ('invalid' in req) return navigateRefused(req.invalid);
    try {
      return await service.navigate(event.sender.id, req);
    } catch (err) {
      console.error('[preview-ipc] navigate failed:', err);
      // Refused, so the preview's position does not move and no file is created (FR-090e, FR-106c) — in
      // the vocabulary of the intent: Back or Forward is not a broken link (adversarial review hardening).
      if (req.intent.kind === 'history') {
        return {
          kind: 'refused',
          notice: { kind: 'history-refused', target: req.target.absPath, reason: 'unavailable' },
        } satisfies PreviewNavigateResponse;
      }
      return navigateRefused(req.target.absPath);
    }
  });

  ipc.handle('throng:preview:refresh', async (_event, payload) => {
    const panelId = text(record(payload).panelId);
    const none: PreviewRefreshResponse = { update: null };
    if (panelId === null) return none;
    try {
      return await service.refresh(panelId);
    } catch {
      return none;
    }
  });

  ipc.handle('throng:preview:isOpen', (_event, payload) => {
    const absPath = text(record(payload).absPath);
    if (absPath === null) return false;
    try {
      return service.isOpen(absPath);
    } catch {
      return false;
    }
  });

  // §1 (amended, US1 review) — the compare-form paths with a run, a new window's open-set seed. No
  // payload. A failure is an empty seed, never a throw: the window's broadcasts still carry it forward.
  ipc.handle('throng:preview:openPaths', () => {
    try {
      return service.openPaths();
    } catch {
      return [];
    }
  });

  ipc.on('throng:preview:detach', (event, payload) => {
    const panelId = text(record(payload).panelId);
    if (panelId !== null) quietly('detach', () => service.detach(event.sender.id, panelId));
  });

  ipc.on('throng:preview:destroyed', (_event, payload) => {
    const panelId = text(record(payload).panelId);
    if (panelId !== null) quietly('destroyed', () => service.destroyed(panelId));
  });

  ipc.on('throng:preview:publishEditorTitle', (_event, payload) => {
    const p = record(payload);
    const panelId = text(p.panelId);
    const title = typeof p.title === 'string' ? p.title : null;
    if (panelId !== null && title !== null) {
      quietly('publishEditorTitle', () => service.publishEditorTitle(panelId, title));
    }
  });

  ipc.on('throng:preview:placeDeclined', (_event, payload) => {
    const requestId = text(record(payload).requestId);
    if (requestId !== null) quietly('placeDeclined', () => service.placeDeclined(requestId));
  });
}

/** The window lookups the push needs. `main.ts` passes `webContents.fromId` and `getAllWindows`. */
export interface PreviewPushWindows {
  fromId(webContentsId: number): BroadcastContents | null | undefined;
  all(): readonly BroadcastTarget[];
}

/** §2 — `update`, `focus` and `place` to ONE window; `openChanged` and `pathChanged` to every window. */
export function createPreviewPush(windows: PreviewPushWindows): PreviewPush {
  /** Whether it was delivered — `place` needs to know (§2; a dead window is a decline). */
  const toOne = (webContentsId: number, channel: string, payload: unknown): boolean => {
    try {
      const target = windows.fromId(webContentsId);
      // A window can close between a run's viewer set being read and the send reaching it.
      if (!target || target.isDestroyed()) return false;
      target.send(channel, payload);
      return true;
    } catch {
      // Destroyed between the guard and the send — the same race `broadcastToWindows` absorbs.
      return false;
    }
  };
  return {
    update: (id, update: PreviewUpdate) => void toOne(id, 'throng:preview:update', update),
    broadcastOpenChanged: (payload: PreviewOpenChanged) =>
      broadcastToWindows(windows.all(), 'throng:preview:openChanged', payload),
    broadcastPathChanged: (payload: PreviewPathChanged) =>
      broadcastToWindows(windows.all(), 'throng:preview:pathChanged', payload),
    sendFocus: (id, payload: PreviewFocusMessage) => void toOne(id, 'throng:preview:focus', payload),
    sendPlace: (id, payload: PreviewPlaceMessage) => toOne(id, 'throng:preview:place', payload),
  };
}
