import type { WebContents } from 'electron';
import type { KillRequest, PanelEstimate, WorkspaceContext } from '@throng/ipc-contract';
import type { ResourceMonitorHost } from './resource-monitor-host.js';

/** The two `ipcMain` members this surface uses — narrow, so its contract test needs no Electron. */
export interface ResourcesIpcMain {
  handle(channel: string, listener: (event: { sender: WebContents }, ...args: unknown[]) => unknown): void;
  on(channel: string, listener: (event: { sender: WebContents }, ...args: unknown[]) => void): void;
}

export type ResourcesIpcHost = Pick<
  ResourceMonitorHost,
  'latestSummary' | 'subscribe' | 'unsubscribe' | 'reportPanels' | 'kill' | 'detailDemand' | 'windowHolding'
>;

export interface ResourcesIpcDeps {
  readonly host: ResourcesIpcHost;
  /** The BrowserWindow id behind a sender, or null for one that is not a window. */
  readonly windowIdOf: (sender: WebContents) => number | null;
  /** The OS pid of a sender's renderer — a renderer cannot learn its own, so its estimates are stamped here. */
  readonly osPidOf: (sender: WebContents) => number;
  /** Bring one window forward and deliver a push to it; false when it is gone. */
  readonly sendTo: (windowId: number, channel: string, payload: unknown) => boolean;
  /** The main window's id, where Unload Project runs (R14); null when there is none. */
  readonly mainWindowId: () => number | null;
  /** Deliver a push to the main window WITHOUT bringing it forward; false when there is none. */
  readonly postToMainWindow: (channel: string, payload: unknown) => boolean;
  /** The monitor window (R14). */
  readonly monitor: {
    open(): void;
    minimise(opts: { reducedMotion: boolean }): unknown;
    viewState(): unknown;
    saveViewState(view: unknown): void;
  };
  /** How long to wait for the main window's status-bar rectangle before minimising without it. */
  readonly statusRectTimeoutMs?: number;
}

/** What registering hands back: main's half of the status-rect exchange (FR-085). */
export interface ResourcesIpcSurface {
  /** The main window's status-bar figures in its CSS px, or null when it has none or does not answer. */
  requestStatusRect(): Promise<StatusRect | null>;
}

export interface StatusRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const UNLOAD_VARIANTS: readonly unknown[] = ['keepRunning', 'endTerminals'];

function isStatusRect(v: unknown): v is StatusRect {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (['x', 'y', 'width', 'height'] as const).every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]));
}

function isKillRequest(v: unknown): v is KillRequest {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    (r.mode === 'process' || r.mode === 'below') &&
    typeof r.nodeId === 'string' &&
    Array.isArray(r.targets) &&
    r.targets.every((t) => typeof t === 'string')
  );
}

/**
 * `window.throng.resources` (055, contracts/resources-ipc-055.md). Every invoke resolves; a failure
 * comes back as a cause, never a rejection (FR-064).
 */
export function registerResourcesIpc(ipcMain: ResourcesIpcMain, deps: ResourcesIpcDeps): ResourcesIpcSurface {
  const { host } = deps;

  /*
   * FR-110 — Activate goes to the window holding the tab (a sub-workspace, or the main window for the
   * active project), which comes forward and selects the tab and focuses the panel. A tab no window holds,
   * or a project alone, goes to the main window: it switches project first, then selects. The monitor
   * window stays open; its focus-scoped layering keeps it above throng's windows (R14).
   */
  const routeActivate = (r: Record<string, unknown>): boolean => {
    const { projectId, tabId, panelId } = r;
    if (typeof projectId !== 'string' || projectId === '') return false;
    if (tabId !== undefined && typeof tabId !== 'string') return false;
    if (panelId !== undefined && (typeof panelId !== 'string' || tabId === undefined)) return false;
    const payload = {
      action: 'activate',
      projectId,
      ...(tabId !== undefined ? { tabId } : {}),
      ...(panelId !== undefined ? { panelId } : {}),
    };
    const holder = typeof tabId === 'string' ? host.windowHolding('tab', tabId) : null;
    const target = holder ?? deps.mainWindowId();
    return target === null ? false : deps.sendTo(target, 'throng:resources:action', payload);
  };

  ipcMain.handle('throng:resources:summary:get', () => host.latestSummary());
  ipcMain.handle('throng:resources:detail-demand:get', () => host.detailDemand());
  ipcMain.handle('throng:resources:detail:subscribe', (event) => {
    const windowId = deps.windowIdOf(event.sender);
    return { subscriptionId: windowId === null ? 0 : host.subscribe(windowId) };
  });
  ipcMain.handle('throng:resources:detail:unsubscribe', (_event, id: unknown) => {
    if (typeof id === 'number') host.unsubscribe(id);
  });
  ipcMain.on('throng:resources:panels', (event, payload: unknown) => {
    const windowId = deps.windowIdOf(event.sender);
    if (windowId === null || typeof payload !== 'object' || payload === null) return;
    const { context, estimates } = payload as { context?: WorkspaceContext | null; estimates?: PanelEstimate[] };
    const pid = deps.osPidOf(event.sender);
    const stamped = (Array.isArray(estimates) ? estimates : []).map((e) => (e.source === 'renderer' ? { ...e, pid } : e));
    host.reportPanels(windowId, context ?? null, stamped);
  });
  ipcMain.handle('throng:resources:kill', (_event, req: unknown) =>
    isKillRequest(req) ? host.kill(req) : { results: [] },
  );
  // R14 — every route to the monitor opens the one monitor window, or brings it forward.
  ipcMain.on('throng:resources:open', () => deps.monitor.open());
  ipcMain.on('throng:resources:minimise', (_event, opts: unknown) => {
    const reducedMotion = typeof opts === 'object' && opts !== null && (opts as { reducedMotion?: unknown }).reducedMotion === true;
    void deps.monitor.minimise({ reducedMotion });
  });
  ipcMain.handle('throng:resources:view:get', () => deps.monitor.viewState() ?? null);
  ipcMain.on('throng:resources:view:set', (_event, view: unknown) => deps.monitor.saveViewState(view));
  /*
   * R12, R14 — an action chosen in the monitor window runs in the window that owns it: Destroy Tab and
   * Destroy Panel where the tab or panel is held, Unload Project in the main window. That window comes
   * forward, because its own confirmation is what the user answers next.
   */
  ipcMain.handle('throng:resources:action:route', (_event, req: unknown) => {
    if (typeof req !== 'object' || req === null) return false;
    if ((req as { action?: unknown }).action === 'activate') return routeActivate(req as Record<string, unknown>);
    const { action, id, name, variant } = req as { action?: unknown; id?: unknown; name?: unknown; variant?: unknown };
    if (typeof id !== 'string') return false;
    if (action === 'unloadProject') {
      if (typeof name !== 'string' || (variant !== undefined && !UNLOAD_VARIANTS.includes(variant))) return false;
      const main = deps.mainWindowId();
      const payload = variant === undefined ? { action, id, name } : { action, id, name, variant };
      return main === null ? false : deps.sendTo(main, 'throng:resources:action', payload);
    }
    if (action !== 'destroyTab' && action !== 'destroyPanel') return false;
    const windowId = host.windowHolding(action === 'destroyTab' ? 'tab' : 'panel', id);
    return windowId === null ? false : deps.sendTo(windowId, 'throng:resources:action', { action, id });
  });

  // FR-085 — the status-bar figures are in the main window; Minimise asks it where they are.
  const waiting = new Map<number, (rect: StatusRect | null) => void>();
  let nextRequest = 1;
  ipcMain.on('throng:resources:status-rect:reply', (_event, reply: unknown) => {
    if (typeof reply !== 'object' || reply === null) return;
    const { requestId, rect } = reply as { requestId?: unknown; rect?: unknown };
    if (typeof requestId !== 'number') return;
    const resolve = waiting.get(requestId);
    if (resolve === undefined) return;
    waiting.delete(requestId);
    resolve(isStatusRect(rect) ? rect : null);
  });
  return {
    requestStatusRect: () =>
      new Promise<StatusRect | null>((resolve) => {
        const requestId = nextRequest++;
        waiting.set(requestId, resolve);
        if (!deps.postToMainWindow('throng:resources:status-rect:request', requestId)) {
          waiting.delete(requestId);
          resolve(null);
          return;
        }
        setTimeout(() => {
          if (waiting.delete(requestId)) resolve(null);
        }, deps.statusRectTimeoutMs ?? 250);
      }),
  };
}
