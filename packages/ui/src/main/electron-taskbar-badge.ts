import type { ITaskbarBadge } from '@throng/core';

/** The slice of a BrowserWindow the badge touches. */
export interface BadgeWindow {
  isDestroyed(): boolean;
  setOverlayIcon(image: unknown, description: string): void;
}

/**
 * The windows that have a taskbar button of their own: not the hidden drag ghost (`skipTaskbar`), and
 * not an owned window such as Preferences or About, which Windows folds into its owner's button.
 */
export function windowsWithTaskbarButton<W extends { getParentWindow(): unknown }>(
  all: readonly W[],
  isGhost: (win: W) => boolean,
): W[] {
  return all.filter((w) => !isGhost(w) && w.getParentWindow() == null);
}

/**
 * 057 FR-039 — ITaskbarBadge over `setOverlayIcon`, applied to every window with a taskbar button.
 * `windows` is the provider of those windows (not the drag ghost), asked afresh on each call so a
 * window opened after the badge was set is covered by the next `set`.
 */
export class ElectronTaskbarBadge implements ITaskbarBadge {
  constructor(
    private readonly windows: () => readonly BadgeWindow[],
    private readonly imageFromDataUrl: (dataUrl: string) => unknown,
  ) {}

  private current: { icon: unknown; description: string } | null = null;

  set(image: string, description: string): void {
    const icon = this.imageFromDataUrl(image);
    this.current = { icon, description };
    this.each((w) => w.setOverlayIcon(icon, description));
  }

  clear(): void {
    this.current = null;
    this.each((w) => w.setOverlayIcon(null, ''));
  }

  /**
   * Put the badge that is showing on a window that appeared after it was set — a sub-workspace torn
   * off, or the main window reopened — so every window with a button shows the same count (FR-039).
   */
  reapply(win: BadgeWindow): void {
    const current = this.current;
    if (current === null) return;
    try {
      if (!win.isDestroyed()) win.setOverlayIcon(current.icon, current.description);
    } catch {
      // Destroyed between the guard and the call.
    }
  }

  private each(apply: (w: BadgeWindow) => void): void {
    for (const w of this.windows()) {
      try {
        if (!w.isDestroyed()) apply(w);
      } catch {
        // Destroyed between the guard and the call; the remaining windows still get the badge.
      }
    }
  }
}
