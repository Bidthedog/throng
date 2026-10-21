/** The slice of a BrowserWindow the raise sequence uses; structural so it unit-tests without Electron. */
export interface RaisableWindow {
  getBounds(): { x: number; y: number; width: number; height: number };
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

/** The slice of IDisplayInfo the raise sequence uses. */
export interface RaiseDisplayInfo {
  isVisible(bounds: { x: number; y: number; width: number; height: number }): boolean;
  clampToVisible(bounds: { x: number; y: number; width: number; height: number }): {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Bring a window to the user: recover it onto a visible display first (one the user "lost" on a
 * now-disconnected monitor), then restore, show and focus. Shared by a second launch and by 057's
 * "go to this panel" (FR-034), so the two cannot drift.
 */
export function raiseWindow(win: RaisableWindow, displayInfo: RaiseDisplayInfo): void {
  const bounds = win.getBounds();
  if (!displayInfo.isVisible(bounds)) {
    const v = displayInfo.clampToVisible(bounds);
    win.setBounds({ x: v.x, y: v.y, width: v.width, height: v.height });
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
