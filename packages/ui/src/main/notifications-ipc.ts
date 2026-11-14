import {
  ENTRY_SEVERITIES,
  NOTIFICATION_ORDERS,
  logCaught,
  normalisePlace,
  originOf,
  type NotificationActionDescriptor,
  type NotificationEntryInput,
  type NotificationOrder,
} from '@throng/core';
import { broadcastToWindows, type BroadcastTarget } from './broadcast.js';
import type { NotificationsSnapshot } from './notification-store.js';

/** contracts/ipc.md "Main ↔ renderer: notifications". */
export const NOTIFICATIONS_CHANNELS = {
  add: 'throng:notifications:add',
  list: 'throng:notifications:list',
  dismiss: 'throng:notifications:dismiss',
  dismissAll: 'throng:notifications:dismissAll',
  setOrder: 'throng:notifications:setOrder',
  dismissLimitWarning: 'throng:notifications:dismissLimitWarning',
  followLimitWarning: 'throng:notifications:followLimitWarning',
  changed: 'throng:notifications:changed',
  repeat: 'throng:notifications:repeat',
  limitReached: 'throng:notifications:limitReached',
} as const;

/** The subset of `ipcMain` this wiring touches, so a fake can stand in for it in a contract test. */
export interface NotificationsIpcMain {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

/** What `NotificationStore` offers the wire. */
export interface NotificationsIpcService {
  add(input: NotificationEntryInput): Promise<{ outcome: 'added' | 'repeat'; id: string }>;
  list(): Promise<NotificationsSnapshot>;
  dismiss(id: string): Promise<void>;
  dismissAll(): Promise<void>;
  setOrder(order: NotificationOrder): Promise<void>;
  dismissLimitWarning(): Promise<void>;
  followLimitWarning(): Promise<void>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function descriptor(raw: unknown): NotificationActionDescriptor | undefined {
  if (!isRecord(raw)) return undefined;
  const label = str(raw.label);
  if (label === undefined) return undefined;
  if (raw.kind === 'goToPanel' && typeof raw.panelId === 'string') return { kind: 'goToPanel', panelId: raw.panelId, label };
  if (raw.kind === 'openFile' && typeof raw.projectId === 'string' && typeof raw.relPath === 'string') {
    return { kind: 'openFile', projectId: raw.projectId, relPath: raw.relPath, label };
  }
  if (raw.kind === 'openPreferences' && typeof raw.section === 'string') return { kind: 'openPreferences', section: raw.section, label };
  return undefined;
}

/**
 * Validate what a window sent. A payload that is not an entry is `undefined` and changes nothing; an
 * action descriptor of a kind this build does not know is dropped and the entry kept (renderers are
 * trusted code, but a stale one must not be able to store a verb nothing can run).
 */
const placeOf = (raw: Record<string, unknown>): { project?: string; tab?: string; panel?: string } => ({
  project: str(raw.project),
  tab: str(raw.tab),
  panel: str(raw.panel),
});

function entryInput(raw: unknown): NotificationEntryInput | undefined {
  if (!isRecord(raw)) return undefined;
  if (!ENTRY_SEVERITIES.includes(raw.severity as (typeof ENTRY_SEVERITIES)[number])) return undefined;
  const copyText = str(raw.copyText);
  if (copyText === undefined) return undefined;
  for (const optional of ['groupKey', 'title', 'message', 'action', 'subject', 'testId', 'instanceKey'] as const) {
    if (raw[optional] !== undefined && typeof raw[optional] !== 'string') return undefined;
  }
  const list = <T>(v: unknown, f: (x: unknown) => T | undefined): T[] =>
    Array.isArray(v) ? v.map(f).filter((x): x is T => x !== undefined) : [];
  return {
    severity: raw.severity as NotificationEntryInput['severity'],
    ...(raw.groupKey !== undefined ? { groupKey: raw.groupKey as string } : {}),
    ...(raw.title !== undefined ? { title: raw.title as string } : {}),
    ...(raw.message !== undefined ? { message: raw.message as string } : {}),
    ...(raw.action !== undefined ? { action: raw.action as string } : {}),
    ...(raw.subject !== undefined ? { subject: raw.subject as string } : {}),
    ...(raw.testId !== undefined ? { testId: raw.testId as string } : {}),
    ...(raw.instanceKey !== undefined ? { instanceKey: raw.instanceKey as string } : {}),
    details: list(raw.details, str),
    copyText,
    affected: list(raw.affected, (a) => {
      if (!isRecord(a)) return undefined;
      const label = str(a.label);
      if (label === undefined) return undefined;
      const panelId = str(a.panelId);
      return panelId === undefined ? { label } : { panelId, label };
    }),
    actions: list(raw.actions, descriptor),
    // 068 FR-061, FR-063: a malformed origin or place is dropped, and the entry kept without it.
    ...originOf(isRecord(raw.origin) ? { panelId: str(raw.origin.panelId), projectId: str(raw.origin.projectId) } : undefined),
    ...(isRecord(raw.place) && normalisePlace(placeOf(raw.place)) ? { place: normalisePlace(placeOf(raw.place))! } : {}),
  };
}

/**
 * Wire the requests onto `ipcMain` (once per app run, from the composition root).
 *
 * Nothing here may throw or reject: an uncaught failure inside an `ipcMain` listener is a main-process
 * fault, and the panel is an observer of what happened, not something that may take the app down. A
 * failed request answers `null` and is logged (Principle XIII: the failure leaves a trace).
 */
export function registerNotificationsIpc(
  ipc: NotificationsIpcMain,
  service: NotificationsIpcService,
  /**
   * 068 FR-030: a kept notice raised in a window with no Notifications panel (Preferences, the Resource
   * Monitor, a sub-workspace) is added to the main window's panel, whose NEW entry flashes. `isMainSender`
   * tells the windows apart; `flash` is the same push a repeat uses.
   */
  flashing?: { isMainSender(event: unknown): boolean; flash(id: string): void },
): void {
  const guarded =
    (what: string, work: (payload: unknown, event: unknown) => Promise<unknown>) =>
    async (event: unknown, payload?: unknown): Promise<unknown> => {
      try {
        return await work(payload, event);
      } catch (error) {
        logCaught(`notifications: ${what}`, error);
        return null;
      }
    };

  ipc.handle(
    NOTIFICATIONS_CHANNELS.add,
    guarded('add an entry', async (payload, event) => {
      const input = entryInput(payload);
      if (input === undefined) return null;
      const result = await service.add(input);
      if (flashing && result.outcome === 'added' && !flashing.isMainSender(event)) flashing.flash(result.id);
      return result;
    }),
  );
  ipc.handle(NOTIFICATIONS_CHANNELS.list, guarded('list', () => service.list()));
  ipc.handle(
    NOTIFICATIONS_CHANNELS.dismiss,
    guarded('dismiss an entry', async (payload) => {
      const id = isRecord(payload) ? str(payload.id) : undefined;
      if (id !== undefined) await service.dismiss(id);
      return service.list();
    }),
  );
  ipc.handle(
    NOTIFICATIONS_CHANNELS.dismissAll,
    guarded('dismiss all', async () => {
      await service.dismissAll();
      return service.list();
    }),
  );
  ipc.handle(
    NOTIFICATIONS_CHANNELS.setOrder,
    guarded('set the order', async (payload) => {
      const order = isRecord(payload) ? payload.order : undefined;
      if (NOTIFICATION_ORDERS.includes(order as NotificationOrder)) await service.setOrder(order as NotificationOrder);
      return service.list();
    }),
  );
  ipc.on(
    NOTIFICATIONS_CHANNELS.dismissLimitWarning,
    guarded('dismiss the limit warning', () => service.dismissLimitWarning()),
  );
  ipc.on(
    NOTIFICATIONS_CHANNELS.followLimitWarning,
    guarded('follow the limit warning', () => service.followLimitWarning()),
  );
}

/**
 * The events main raises: `changed` to EVERY window (every window renders the panel and a Preferences
 * window adds to it), `repeat` and `limitReached` to the MAIN window alone — the one that flashes an
 * entry and raises the warning toast, so a second window does neither.
 */
export function createNotificationsEvents(
  windows: () => readonly BroadcastTarget[],
  mainWindow: () => BroadcastTarget | undefined,
): { changed(snapshot: NotificationsSnapshot): void; repeat(id: string): void; limitReached(): void } {
  const toMain = (channel: string, payload: unknown): void => {
    const target = mainWindow();
    if (target) broadcastToWindows([target], channel, payload);
  };
  return {
    changed: (snapshot) => broadcastToWindows(windows(), NOTIFICATIONS_CHANNELS.changed, snapshot),
    repeat: (id) => toMain(NOTIFICATIONS_CHANNELS.repeat, { id }),
    limitReached: () => toMain(NOTIFICATIONS_CHANNELS.limitReached, undefined),
  };
}
