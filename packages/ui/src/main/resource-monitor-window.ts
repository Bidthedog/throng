/**
 * The Resource Monitor window (055 FR-081 – FR-087, research R14): one frameless, movable window built
 * like Preferences, parented to the main window, with throng fully usable behind it.
 *
 * Electron sits behind {@link ResourceMonitorWindowDeps} — `main.ts` creates the real `BrowserWindow`,
 * this decides when, where, what is remembered and how Minimise moves it — so every rule here is
 * testable without a display.
 *
 * ══ WHY MAIN REMEMBERS, NOT THE RENDERER ══
 *
 * The window is destroyed on close (keeping a whole renderer alive after one glance would cost the very
 * memory the monitor exists to show), so the renderer cannot carry anything to the next opening. Its
 * place, size and maximised state, and the view it showed (FR-057), live here until throng restarts.
 *
 * ══ WHY MINIMISE IS DRAWN BY MAIN ══
 *
 * The status-bar figures it shrinks into are in ANOTHER window, so no renderer-side animation can reach
 * them. Main asks the main window where the figures are, converts that to screen coordinates, and steps
 * this window's bounds toward them while fading it, then closes it (FR-085).
 */
import { centredOnParent, type Rect } from './window-placement.js';

export type { Rect } from './window-placement.js';

/** The part of a `BrowserWindow` the monitor window uses; a real `BrowserWindow` satisfies it. */
export interface MonitorWindowHandle {
  readonly id: number;
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
  close(): void;
  isMaximized(): boolean;
  maximize(): void;
  unmaximize(): void;
  getBounds(): Rect;
  getNormalBounds(): Rect;
  setBounds(bounds: Rect): void;
  setOpacity(opacity: number): void;
  setMinimumSize(width: number, height: number): void;
  once(event: 'close' | 'closed', listener: () => void): unknown;
}

/** The part of the main window it uses; a real `BrowserWindow` satisfies it. */
export interface MainWindowHandle {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  getBounds(): Rect;
  getContentBounds(): Rect;
  readonly webContents: { getZoomFactor(): number };
  once(event: 'closed', listener: () => void): unknown;
}

export interface ResourceMonitorWindowDeps {
  /** Create the real window at `bounds`, parented to `parent` (null: no parent). Not yet shown. */
  createWindow(spec: { bounds: Rect; parent: MainWindowHandle | null }): MonitorWindowHandle;
  mainWindow(): MainWindowHandle | null;
  /** Every display's work area. */
  workAreas(): Rect[];
  /** The main window's status-bar figures, in its CSS px; null when not shown or no answer. */
  statusRect(): Promise<Rect | null>;
  schedule(fn: () => void, ms: number): void;
}

/** The size it first opens at (the modal's, R12). */
export const MONITOR_DEFAULT_SIZE = { width: 1120, height: 780 } as const;
/** Its smallest size; dropped to 1×1 only while Minimise shrinks it. */
export const MONITOR_MIN_SIZE = { width: 640, height: 420 } as const;

const MINIMISE_STEPS = 12;
const MINIMISE_STEP_MS = 16;
/** How much of the title bar must be on a screen for remembered bounds to be reused. */
const GRIP = { width: 120, height: 32 } as const;

/** A rectangle in the main window's CSS px, in screen coordinates. */
export function toScreenRect(rect: Rect, content: Rect, zoom: number): Rect {
  return {
    x: Math.round(content.x + rect.x * zoom),
    y: Math.round(content.y + rect.y * zoom),
    width: Math.round(rect.width * zoom),
    height: Math.round(rect.height * zoom),
  };
}

/** `n` rectangles from `from` toward `to` (easing in), the last exactly `to`. */
export function shrinkSteps(from: Rect, to: Rect, n: number): Rect[] {
  const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);
  return Array.from({ length: n }, (_, i) => {
    const t = ((i + 1) / n) ** 2;
    return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t), width: lerp(from.width, to.width, t), height: lerp(from.height, to.height, t) };
  });
}

/** `bounds` if its title bar's grip is on some screen, else null (FR-087: never reopen off-screen). */
export function visibleBounds(bounds: Rect, workAreas: readonly Rect[]): Rect | null {
  const grip = { x: bounds.x, y: bounds.y, width: Math.min(GRIP.width, bounds.width), height: GRIP.height };
  const inside = workAreas.some(
    (a) => grip.x >= a.x && grip.y >= a.y && grip.x + grip.width <= a.x + a.width && grip.y + grip.height <= a.y + a.height,
  );
  return inside ? bounds : null;
}

interface Remembered {
  readonly bounds: Rect;
  readonly maximised: boolean;
}

export class ResourceMonitorWindow {
  private window: MonitorWindowHandle | null = null;
  private remembered: Remembered | null = null;
  /** Set once Minimise has recorded where the window was, so the shrinking bounds are not recorded. */
  private rememberedFinal = false;
  private view: unknown = null;

  constructor(private readonly deps: ResourceMonitorWindowDeps) {}

  isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed();
  }

  /** The one window's id while open, for routing. */
  windowId(): number | null {
    return this.isOpen() ? this.window!.id : null;
  }

  /** Open the monitor window, or bring the open one forward (FR-081, FR-086). */
  open(): void {
    const existing = this.window;
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return;
    }
    const main = this.liveMain();
    const win = this.deps.createWindow({ bounds: this.placement(main), parent: main });
    this.window = win;
    this.rememberedFinal = false;
    if (this.remembered?.maximised) win.maximize();
    win.once('close', () => this.remember(win));
    win.once('closed', () => {
      if (this.window === win) this.window = null;
    });
    // Parenting already closes a child with its parent on Windows; saying so keeps it true elsewhere.
    main?.once('closed', () => {
      if (!win.isDestroyed()) win.close();
    });
    win.focus();
  }

  /** Close the window, shrinking it into the status-bar figures unless motion is reduced (FR-085). */
  async minimise(opts: { reducedMotion: boolean }): Promise<void> {
    const win = this.window;
    if (!win || win.isDestroyed()) return;
    this.remember(win);
    this.rememberedFinal = true;
    const main = this.liveMain();
    const rect = opts.reducedMotion || main === null || main.isMinimized() ? null : await this.deps.statusRect();
    if (win.isDestroyed()) return;
    if (rect === null || main === null || main.isDestroyed() || main.isMinimized()) {
      win.close();
      return;
    }
    const target = toScreenRect(rect, main.getContentBounds(), main.webContents.getZoomFactor());
    const from = win.getBounds();
    if (win.isMaximized()) {
      win.unmaximize();
      win.setBounds(from);
    }
    win.setMinimumSize(1, 1);
    shrinkSteps(from, target, MINIMISE_STEPS).forEach((step, i) => {
      this.deps.schedule(() => {
        if (win.isDestroyed()) return;
        win.setBounds(step);
        win.setOpacity(1 - ((i + 1) / MINIMISE_STEPS) * 0.9);
      }, (i + 1) * MINIMISE_STEP_MS);
    });
    this.deps.schedule(() => {
      if (!win.isDestroyed()) win.close();
    }, (MINIMISE_STEPS + 1) * MINIMISE_STEP_MS);
  }

  /** The view the window showed when it last closed (FR-057, FR-087); null the first time. */
  viewState(): unknown {
    return this.view;
  }

  saveViewState(view: unknown): void {
    this.view = view;
  }

  private liveMain(): MainWindowHandle | null {
    const main = this.deps.mainWindow();
    return main && !main.isDestroyed() ? main : null;
  }

  private remember(win: MonitorWindowHandle): void {
    if (this.rememberedFinal || win.isDestroyed()) return;
    const maximised = win.isMaximized();
    this.remembered = { bounds: maximised ? win.getNormalBounds() : win.getBounds(), maximised };
  }

  private placement(main: MainWindowHandle | null): Rect {
    const areas = this.deps.workAreas();
    const saved = this.remembered?.bounds ?? null;
    if (saved !== null && visibleBounds(saved, areas) !== null) return saved;
    const size = saved ? { width: saved.width, height: saved.height } : MONITOR_DEFAULT_SIZE;
    const anchor = main?.getBounds() ?? areas[0] ?? { x: 0, y: 0, width: size.width, height: size.height };
    const centre = { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 };
    const area =
      areas.find((a) => centre.x >= a.x && centre.x < a.x + a.width && centre.y >= a.y && centre.y < a.y + a.height) ??
      areas[0] ??
      anchor;
    const fitted = { width: Math.min(size.width, area.width), height: Math.min(size.height, area.height) };
    return { ...centredOnParent(anchor, area, fitted), ...fitted };
  }
}
