/**
 * 074 FR-072a, FR-092a — the Safe HTML preview sources each HTML Preview frame may load from, as main's request filter
 * reads them.
 *
 * The renderer knows a panel's sources (the global preference and the panel's project list); the filter sees only a
 * request, its window and the frame it came from. The renderer registers each panel's list here
 * (`throng:preview:setFrameSources`) and names the frame `throng-html-<panelId>`, so the filter can find the list from
 * `details.frame.name`. The lists are normalised again on the way in: the filter trusts nothing a renderer sends.
 * A window's lists are forgotten when it is destroyed; a panel's when it registers an empty list.
 *
 * Type-only Electron imports: a structural fake drives it in a unit test.
 */
import { safeSourceList } from '@throng/core';

const FRAME_PREFIX = 'throng-html-';

/** The `name` an HTML Preview frame carries, which the request filter reads its sources by. */
export function frameNameFor(panelId: string): string {
  return `${FRAME_PREFIX}${panelId}`;
}

export interface FrameSources {
  set(webContentsId: number, panelId: string, origins: readonly string[]): void;
  forgetWindow(webContentsId: number): void;
  /** The sources the frame named `frameName` in window `webContentsId` registered; none for any other frame. */
  sourcesFor(webContentsId: number | undefined, frameName: string | undefined): readonly string[];
}

export function createFrameSources(): FrameSources {
  const byWindow = new Map<number, Map<string, readonly string[]>>();
  return {
    set(webContentsId, panelId, origins) {
      const panels = byWindow.get(webContentsId) ?? new Map<string, readonly string[]>();
      if (origins.length === 0) panels.delete(panelId);
      else panels.set(panelId, origins);
      if (panels.size === 0) byWindow.delete(webContentsId);
      else byWindow.set(webContentsId, panels);
    },
    forgetWindow(webContentsId) {
      byWindow.delete(webContentsId);
    },
    sourcesFor(webContentsId, frameName) {
      if (webContentsId === undefined || frameName === undefined || !frameName.startsWith(FRAME_PREFIX)) return [];
      return byWindow.get(webContentsId)?.get(frameName.slice(FRAME_PREFIX.length)) ?? [];
    },
  };
}

/** The part of a sender the registration needs. */
interface FrameSourcesSender {
  id: number;
  once(event: 'destroyed', listener: () => void): unknown;
}

/** The part of `ipcMain` the registration needs. */
export interface FrameSourcesIpc {
  on(channel: string, listener: (event: { sender: FrameSourcesSender }, payload: unknown) => void): unknown;
}

/** `throng:preview:setFrameSources { panelId, origins }` — fire-and-forget; a malformed payload is ignored. */
export function registerFrameSourcesIpc(ipc: FrameSourcesIpc, sources: FrameSources): void {
  const watched = new Set<number>();
  ipc.on('throng:preview:setFrameSources', (event, payload) => {
    if (typeof payload !== 'object' || payload === null) return;
    const { panelId, origins } = payload as { panelId?: unknown; origins?: unknown };
    if (typeof panelId !== 'string' || panelId.length === 0 || panelId.length > 256 || !Array.isArray(origins)) return;
    const id = event.sender.id;
    if (!watched.has(id)) {
      watched.add(id);
      event.sender.once('destroyed', () => {
        watched.delete(id);
        sources.forgetWindow(id);
      });
    }
    sources.set(id, panelId, safeSourceList(origins));
  });
}
