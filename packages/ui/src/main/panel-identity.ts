import type { PanelIdentity } from './throng-holder.js';

/**
 * 029 FR-013 / FR-013a — panel id to what the user calls it, gathered from every window.
 *
 * ══ WHY THIS IS A REGISTRY AND NOT A MAP ══
 *
 * Each renderer publishes ITS OWN panels; there is no window that can see them all. The first
 * version of this held one flat map and cleared it on every message, which works exactly until a
 * sub-workspace window exists — then whichever window published last owns the map and every panel in
 * the other one silently becomes unnameable. Not a crash, not an error: just "throng could not
 * identify which panel" about a panel throng was perfectly able to identify a moment earlier.
 *
 * So publications are kept PER WINDOW and merged on read. A window's entries leave when the window
 * does, which is what stops a closed sub-workspace naming panels that no longer exist.
 *
 * ══ AND WHY THE READER SAYS WHO IS ASKING ══
 *
 * FR-013a wants the sub-workspace named only when the holder is somewhere ELSE. "The terminal Build,
 * in the sub-workspace Deploy" is orientation when the user is looking at a different window and
 * noise when they are looking at that one. The registry cannot know which case it is, so the caller
 * passes the window doing the reporting and the answer is composed for it.
 */

interface Published {
  windowTitle: string;
  /** panel id → the title the user sees. */
  panels: ReadonlyMap<string, string>;
}

export class PanelIdentityRegistry {
  private readonly byWindow = new Map<number, Published>();

  /**
   * Replace everything window `windowId` had published. A window is authoritative about itself.
   *
   * Returns whether this window was previously UNKNOWN, so the caller can attach its teardown
   * exactly once. The renderer republishes on every layout change, and a caller that subscribed on
   * each message would accumulate listeners for the life of the window.
   */
  publish(
    windowId: number,
    windowTitle: string,
    panels: ReadonlyArray<{ panelId: string; panelTitle: string }>,
  ): boolean {
    const isNew = !this.byWindow.has(windowId);
    const map = new Map<string, string>();
    for (const p of panels) {
      if (typeof p?.panelId === 'string' && typeof p?.panelTitle === 'string') {
        map.set(p.panelId, p.panelTitle);
      }
    }
    this.byWindow.set(windowId, { windowTitle, panels: map });
    return isNew;
  }

  /** A window has gone. Its panels went with it, and naming them would be a lie. */
  forget(windowId: number): void {
    this.byWindow.delete(windowId);
  }

  /**
   * Every known panel, as the window `reportingWindowId` should be told about it.
   *
   * A panel in that same window carries no `windowTitle` — the user is already looking at it
   * (FR-013a). A panel anywhere else carries the title of the window it is in.
   */
  identities(reportingWindowId?: number): ReadonlyMap<string, PanelIdentity> {
    const out = new Map<string, PanelIdentity>();
    for (const [windowId, published] of this.byWindow) {
      const elsewhere = reportingWindowId !== undefined && windowId !== reportingWindowId;
      for (const [panelId, panelTitle] of published.panels) {
        out.set(panelId, {
          panelTitle,
          ...(elsewhere && published.windowTitle ? { windowTitle: published.windowTitle } : {}),
        });
      }
    }
    return out;
  }
}
