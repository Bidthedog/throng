/**
 * WindowManager (US7 / Constitution XI): tracks the main window plus detached
 * sub-workspace windows. Every window is an INDEPENDENT top-level window (issue
 * #138): focusing any of them — main or sub-workspace — raises ONLY that window
 * and leaves every other window's Z-order untouched. Neither direction drags the
 * other forward: focusing a sub-workspace never raises the main window, and
 * focusing the main window never raises the sub-workspaces. Raising never changes
 * a window's minimise state (minimise/restore stay independent). Closing the main
 * window still closes all sub-workspace windows (application exit).
 *
 * Decoupled from Electron via {@link ManagedWindow} so it is unit-testable; the
 * real impl passes Electron BrowserWindows (which satisfy the interface).
 */
export interface ManagedWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  /** Raise to the top of the Z-order without focusing or un-minimising (moveTop). */
  moveTop(): void;
  on(event: 'focus' | 'closed', listener: () => void): void;
  close(): void;
}

export class WindowManager {
  private readonly children = new Map<string, ManagedWindow>();
  private raising = false;
  // Child ids most-recently-focused first → the visual top-to-bottom order, used
  // to resolve which overlapping window is under the cursor (drop hit-test).
  private recentFocus: string[] = [];

  /** Register the main window: focusing raises only it; closing closes all children. */
  registerMain(win: ManagedWindow): void {
    // The main window is independent too — focusing it must not drag the
    // sub-workspace windows forward (issue #138).
    win.on('focus', () => this.raiseOne(win));
    win.on('closed', () => this.closeChildren());
  }

  /** Track a detached sub-workspace window keyed by its sub-workspace id. */
  registerChild(id: string, win: ManagedWindow): void {
    this.children.set(id, win);
    this.recentFocus = [id, ...this.recentFocus.filter((x) => x !== id)];
    win.on('focus', () => {
      this.recentFocus = [id, ...this.recentFocus.filter((x) => x !== id)];
      // A sub-workspace window is independent: raise only itself, never the main
      // window or its siblings (issue #138).
      this.raiseOne(win);
    });
    win.on('closed', () => {
      this.children.delete(id);
      this.recentFocus = this.recentFocus.filter((x) => x !== id);
    });
  }

  /** Is a window already open for this sub-workspace? (lazy reopen guard). */
  hasChild(id: string): boolean {
    return this.children.has(id);
  }

  getChild(id: string): ManagedWindow | null {
    return this.children.get(id) ?? null;
  }

  /** Ids of all tracked sub-workspace windows (e.g. to hit-test a drop). */
  childIds(): string[] {
    return [...this.children.keys()];
  }

  /** Child ids ordered topmost-first (most-recently-focused), so a cursor over
   *  overlapping windows resolves to the one the user actually sees. */
  childIdsByFocus(): string[] {
    const known = new Set(this.recentFocus);
    return [...this.recentFocus, ...this.childIds().filter((id) => !known.has(id))];
  }

  childCount(): number {
    return this.children.size;
  }

  /**
   * Raise a single window to the top of the Z-order without focusing, un-minimising
   * or disturbing any other window (issue #138). The re-entry guard stops a
   * `moveTop`-triggered focus event from recursing.
   */
  raiseOne(win: ManagedWindow): void {
    if (this.raising) return; // guard against focus events fired while raising
    this.raising = true;
    try {
      if (!win.isDestroyed() && !win.isMinimized()) win.moveTop();
    } finally {
      this.raising = false;
    }
  }

  /** Close every sub-workspace window (e.g. on main-window close). */
  closeChildren(): void {
    for (const win of this.children.values()) {
      if (!win.isDestroyed()) win.close();
    }
    this.children.clear();
  }
}
