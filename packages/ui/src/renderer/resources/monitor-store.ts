/**
 * What every window needs of the Resource Monitor that is not the monitor itself (055 FR-081, FR-085,
 * FR-086): the one route that opens it, and where the status-bar figures are.
 *
 * Whether the monitor is open is no longer a renderer fact: it is its own window (research R14), and
 * UI main owns that window — one instance, focused when asked for again. So there is no open state here,
 * and no exclusive gate behind it: the rest of throng stays usable while the monitor is up.
 */

let statusItem: HTMLElement | null = null;

/**
 * The route every "Resource Monitor" command takes, from any window (FR-086): the main window, a
 * sub-workspace and the cog menu alike ask UI main, which opens the monitor window or brings it forward.
 */
export function openResourceMonitor(): void {
  window.throng?.resources?.open?.();
}

/** The status-bar item registers its element so main can ask where the monitor should shrink to. */
export function setStatusItemElement(element: HTMLElement | null): void {
  statusItem = element;
}

/**
 * The item's rectangle in CSS px relative to the viewport (FR-085), or `null` when the bar has none (no
 * item mounted). One read, on demand — main asks, and converts to screen coordinates itself.
 */
export function getStatusItemRect(): { x: number; y: number; width: number; height: number } | null {
  const r = statusItem?.getBoundingClientRect();
  return r === undefined ? null : { x: r.x, y: r.y, width: r.width, height: r.height };
}

/** Tests only: no item carried between tests. */
export function __resetMonitorStore(): void {
  statusItem = null;
}
