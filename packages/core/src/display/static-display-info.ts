import type {
  DisplayBounds,
  DisplayDescriptor,
  IDisplayInfo,
  WindowBounds,
} from '../abstractions/display-info.js';

function overlaps(a: WindowBounds, b: DisplayDescriptor['bounds']): boolean {
  return !(
    a.x + a.width <= b.x ||
    a.x >= b.x + b.width ||
    a.y + a.height <= b.y ||
    a.y >= b.y + b.height
  );
}

/**
 * Pure {@link IDisplayInfo} over a fixed list of displays (research D8). The
 * geometry — `isVisible` (partial overlap with any display) and `clampToVisible`
 * (reposition onto the primary display when off-screen, e.g. a disconnected
 * monitor, FR-028) — lives here in the OS-agnostic core. `ElectronDisplayInfo`
 * supplies the real display list from Electron `screen` and reuses this logic.
 */
export function createStaticDisplayInfo(displays: DisplayDescriptor[]): IDisplayInfo {
  if (displays.length === 0) {
    throw new Error('createStaticDisplayInfo requires at least one display');
  }
  // The OS primary display sits at the desktop origin (0,0) on Windows; fall back
  // to the first listed display if none reports the origin.
  const primary = displays.find((d) => d.bounds.x === 0 && d.bounds.y === 0) ?? displays[0];
  const centerOn = (b: DisplayDescriptor['bounds'], id: string, w: number, h: number): DisplayBounds & { displayId: string } => {
    const width = Math.min(w, b.width);
    const height = Math.min(h, b.height);
    return {
      x: b.x + Math.max(0, Math.floor((b.width - width) / 2)),
      y: b.y + Math.max(0, Math.floor((b.height - height) / 2)),
      width,
      height,
      displayId: id,
    };
  };
  return {
    listDisplays: () => displays,
    isVisible: (bounds) => displays.some((d) => overlaps(bounds, d.bounds)),
    clampToVisible: (bounds) => {
      if (displays.some((d) => overlaps(bounds, d.bounds))) return bounds;
      return centerOn(primary.bounds, primary.id, bounds.width, bounds.height);
    },
    primaryBounds: () => ({ ...primary.bounds }),
    centerOnPrimary: (width, height) => centerOn(primary.bounds, primary.id, width, height),
  };
}
