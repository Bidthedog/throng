/**
 * Maximise and restore for the custom title bar (007 FR-002/004), including the windows the window
 * manager will not maximise.
 *
 * ══ WHY IT IS EMULATED FOR A PARENTED WINDOW ON LINUX ══
 *
 * Preferences is parented to the main window (007 FR-013), which on X11 makes it transient-for that
 * window, and Mutter does not maximise a transient window: `maximize()` returns and nothing happens,
 * framed or frameless, with or without a minimum size. An unparented window maximises normally. The
 * dev and packaged builds run under XWayland by default (062 FR-028), so this is the ordinary case on
 * a GNOME desktop, not an edge.
 *
 * Dropping the parent would give up what it is there for: Preferences staying above throng's main
 * window and minimising with it. So such a window is maximised by hand: its bounds are remembered and
 * it is sized to its display's work area, and Restore puts the remembered bounds back.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The slice of a window this needs, a seam so the rule is unit-tested without Electron. */
export interface MaximiseTarget {
  readonly id: number;
  isMaximized(): boolean;
  maximize(): void;
  unmaximize(): void;
  getBounds(): Rect;
  setBounds(bounds: Rect): void;
  /** The work area of the display the window is on. */
  workArea(): Rect;
  hasParent(): boolean;
  /** Tell the window's renderer its maximised state, so the title bar shows Maximise or Restore. */
  notify(maximized: boolean): void;
}

/** Whether a window must be maximised by hand: a parented window on Linux. */
export function mustEmulateMaximise(platform: NodeJS.Platform, hasParent: boolean): boolean {
  return platform === 'linux' && hasParent;
}

export class WindowMaximise {
  /** The bounds each hand-maximised window had before, by window id. */
  private readonly restoreTo = new Map<number, Rect>();

  constructor(private readonly platform: NodeJS.Platform) {}

  isMaximized(win: MaximiseTarget): boolean {
    return this.restoreTo.has(win.id) || win.isMaximized();
  }

  toggle(win: MaximiseTarget): void {
    if (!mustEmulateMaximise(this.platform, win.hasParent())) {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return; // the window's own maximize / unmaximize events tell the renderer
    }
    const before = this.restoreTo.get(win.id);
    if (before) {
      this.restoreTo.delete(win.id);
      win.setBounds(before);
      win.notify(false);
      return;
    }
    this.restoreTo.set(win.id, win.getBounds());
    win.setBounds(win.workArea());
    win.notify(true);
  }

  /** Drop what is remembered for a closed window. */
  forget(id: number): void {
    this.restoreTo.delete(id);
  }
}
