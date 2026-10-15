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
  /** Open the monitor in the main window and bring it forward (R12). */
  readonly openInMainWindow: () => void;
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
export function registerResourcesIpc(ipcMain: ResourcesIpcMain, deps: ResourcesIpcDeps): void {
  const { host } = deps;
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
  ipcMain.on('throng:resources:open', () => deps.openInMainWindow());
  // R12 — a Destroy Tab / Destroy Panel chosen in the monitor runs in the window that holds it.
  ipcMain.handle('throng:resources:action:route', (_event, req: unknown) => {
    if (typeof req !== 'object' || req === null) return false;
    const { action, id } = req as { action?: unknown; id?: unknown };
    if ((action !== 'destroyTab' && action !== 'destroyPanel') || typeof id !== 'string') return false;
    const windowId = host.windowHolding(action === 'destroyTab' ? 'tab' : 'panel', id);
    return windowId === null ? false : deps.sendTo(windowId, 'throng:resources:action', { action, id });
  });
}
