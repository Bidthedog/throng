import { logExpected } from '@throng/core';
import type { TerminalOutputNotification, TerminalSubscribeParams } from '@throng/ipc-contract';

const OUTPUT_CHANNEL = 'throng:terminal:output';

/** The subset of a `WebContents` routing touches, so it can be tested with plain fakes. */
export interface OutputRouteContents {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
}

interface Route {
  contents: OutputRouteContents;
  views: Set<string | undefined>;
}

/**
 * Which windows are showing which terminals (061 FR-001, FR-006): a window hears a terminal's output only while it has
 * a view of it, once however many views it has.
 *
 * A route is added BEFORE the attach RPC is sent. Output produced while that attach is in flight must reach the view's
 * gate, and a reconnect's `terminal.subscribe` must name a view whose attach has already gone (research R2).
 */
export class TerminalOutputRoutes {
  private readonly byPanel = new Map<string, Map<number, Route>>();

  add(contents: OutputRouteContents, panelId: string, viewId?: string): void {
    let windows = this.byPanel.get(panelId);
    if (!windows) {
      windows = new Map();
      this.byPanel.set(panelId, windows);
    }
    let route = windows.get(contents.id);
    if (!route) {
      route = { contents, views: new Set() };
      windows.set(contents.id, route);
    }
    route.views.add(viewId);
  }

  remove(contents: Pick<OutputRouteContents, 'id'>, panelId: string, viewId?: string): void {
    const windows = this.byPanel.get(panelId);
    const route = windows?.get(contents.id);
    if (!windows || !route) return;
    route.views.delete(viewId);
    if (route.views.size > 0) return;
    windows.delete(contents.id);
    if (windows.size === 0) this.byPanel.delete(panelId);
  }

  send(delivery: TerminalOutputNotification): void {
    const windows = this.byPanel.get(delivery.panelId);
    if (!windows) return;
    for (const { contents } of windows.values()) {
      try {
        if (!contents.isDestroyed()) contents.send(OUTPUT_CHANNEL, delivery);
      } catch (error) {
        logExpected('terminal-output-routes: send', 'a window closed between the destroyed check and the send', error);
      }
    }
  }

  /** Every view being routed, for the `terminal.subscribe` a reconnect sends (061 FR-005a). */
  viewsForSubscribe(): TerminalSubscribeParams['views'] {
    const views: TerminalSubscribeParams['views'] = [];
    for (const [panelId, windows] of this.byPanel) {
      for (const route of windows.values()) {
        for (const viewId of route.views) views.push(viewId === undefined ? { panelId } : { panelId, viewId });
      }
    }
    return views;
  }

  /** A window that crashed or closed never detaches, so its routes go with it (061 FR-004). */
  releaseWindow(contentsId: number): void {
    for (const [panelId, windows] of this.byPanel) {
      windows.delete(contentsId);
      if (windows.size === 0) this.byPanel.delete(panelId);
    }
  }
}
