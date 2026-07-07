/**
 * OS-abstraction contract for display geometry (Principle II / research D8).
 * `core` defines only the interface; the concrete `ElectronDisplayInfo` lives in
 * the UI **main** process (Electron `screen` is main-only). Used by the
 * window-manager to restore sub-workspace windows onto a visible display when a
 * saved position is on a now-absent monitor (FR-028, US4).
 */
export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayDescriptor {
  id: string;
  bounds: DisplayBounds;
}

export interface WindowBounds extends DisplayBounds {
  displayId?: string;
}

export interface IDisplayInfo {
  listDisplays(): DisplayDescriptor[];
  /** True if the window bounds lie (at least partly) within some connected display. */
  isVisible(bounds: WindowBounds): boolean;
  /** Bounds repositioned onto a currently-connected display (no-op if already visible). */
  clampToVisible(bounds: WindowBounds): WindowBounds;
  /** The primary display's bounds (the display at the desktop origin, else the
   *  first). Used to place a fresh window predictably on the primary monitor. */
  primaryBounds(): DisplayBounds;
  /** Centre a window of `width`×`height` on the primary display. */
  centerOnPrimary(width: number, height: number): DisplayBounds;
}
