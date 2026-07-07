/**
 * WindowManager (US7 / Constitution XI): tracks the main window plus detached
 * sub-workspace windows as a single focus/raise group. Focusing any window raises
 * the whole group to the foreground together (shared effective Z-order) WITHOUT
 * changing each window's minimise state (minimise/restore stay independent).
 * Closing the main window closes all sub-workspace windows (application exit).
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
  private main: ManagedWindow | null = null;
  private readonly children = new Map<string, ManagedWindow>();
  private raising = false;
  // Child ids most-recently-focused first → the visual top-to-bottom order, used
  // to resolve which overlapping window is under the cursor (drop hit-test).
  private recentFocus: string[] = [];

  /** Register the main window: focusing raises the group; closing closes all children. */
  registerMain(win: ManagedWindow): void {
    this.main = win;
    win.on('focus', () => this.raiseGroup(win));
    win.on('closed', () => this.closeChildren());
  }

  /** Track a detached sub-workspace window keyed by its sub-workspace id. */
  registerChild(id: string, win: ManagedWindow): void {
    this.children.set(id, win);
    this.recentFocus = [id, ...this.recentFocus.filter((x) => x !== id)];
    win.on('focus', () => {
      this.recentFocus = [id, ...this.recentFocus.filter((x) => x !== id)];
      this.raiseGroup(win);
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
   * Bring the whole group forward together, preserving each window's minimise
   * state. The `focused` window (if any) is raised **last** so it ends up on top
   * of the group — a sub-workspace is only above the main window while it has
   * focus, not permanently "always on top".
   */
  raiseGroup(focused?: ManagedWindow): void {
    if (this.raising) return; // guard against focus events fired while raising
    this.raising = true;
    try {
      const raisable = (win: ManagedWindow): boolean => !win.isDestroyed() && !win.isMinimized();
      for (const win of this.allWindows()) {
        if (win !== focused && raisable(win)) win.moveTop();
      }
      // Raise the focused window last so it sits at the very top of the group.
      if (focused && raisable(focused)) focused.moveTop();
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

  private *allWindows(): IterableIterator<ManagedWindow> {
    if (this.main && !this.main.isDestroyed()) yield this.main;
    yield* this.children.values();
  }
}
