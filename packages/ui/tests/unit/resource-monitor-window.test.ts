import { describe, expect, it } from 'vitest';
import {
  ResourceMonitorWindow,
  shrinkSteps,
  toScreenRect,
  visibleBounds,
  type MainWindowHandle,
  type MonitorWindowHandle,
  type Rect,
} from '../../src/main/resource-monitor-window.js';

/**
 * 055 T106, T108 — the Resource Monitor window (FR-081, FR-083 – FR-087).
 *
 * Layer: unit — what is under test is which window exists, where it is placed, what it remembers and the
 * steps minimise takes; Electron sits behind a seam, so none of it needs a display. That the real window
 * looks and floats right is MT-08 and `resource-monitor-window.e2e.ts`.
 */

const SCREEN: Rect = { x: 0, y: 0, width: 1920, height: 1040 };

class FakeWindow implements MonitorWindowHandle {
  static next = 1;
  readonly id = FakeWindow.next++;
  destroyed = false;
  minimised = false;
  maximised = false;
  focused = 0;
  bounds: Rect;
  normal: Rect;
  opacity = 1;
  minSize: [number, number] = [640, 420];
  readonly boundsLog: Rect[] = [];
  private readonly handlers = new Map<string, (() => void)[]>();
  constructor(bounds: Rect) {
    this.bounds = bounds;
    this.normal = bounds;
  }
  isDestroyed = () => this.destroyed;
  isMinimized = () => this.minimised;
  restore = () => {
    this.minimised = false;
  };
  focus = () => {
    this.focused += 1;
  };
  isMaximized = () => this.maximised;
  maximize = () => {
    this.maximised = true;
    this.bounds = SCREEN;
  };
  unmaximize = () => {
    this.maximised = false;
    this.bounds = this.normal;
  };
  getBounds = () => this.bounds;
  getNormalBounds = () => (this.maximised ? this.normal : this.bounds);
  setBounds = (r: Rect) => {
    this.bounds = r;
    this.boundsLog.push(r);
    if (!this.maximised) this.normal = r;
  };
  setOpacity = (o: number) => {
    this.opacity = o;
  };
  setMinimumSize = (w: number, h: number) => {
    this.minSize = [w, h];
  };
  once = (event: string, fn: () => void) => {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
  };
  close = () => {
    if (this.destroyed) return;
    for (const fn of this.handlers.get('close') ?? []) fn();
    this.destroyed = true;
    for (const fn of this.handlers.get('closed') ?? []) fn();
  };
}

class FakeMain implements MainWindowHandle {
  destroyed = false;
  minimised = false;
  zoom = 1;
  readonly webContents = { getZoomFactor: () => this.zoom };
  private readonly closed: (() => void)[] = [];
  constructor(
    readonly bounds: Rect = { x: 100, y: 100, width: 1600, height: 900 },
    readonly content: Rect = { x: 108, y: 108, width: 1584, height: 884 },
  ) {}
  isDestroyed = () => this.destroyed;
  isMinimized = () => this.minimised;
  getBounds = () => this.bounds;
  getContentBounds = () => this.content;
  once = (_event: 'closed', fn: () => void) => {
    this.closed.push(fn);
  };
  close(): void {
    this.destroyed = true;
    for (const fn of this.closed) fn();
  }
}

function harness(opts: { main?: FakeMain | null; areas?: Rect[]; rect?: Rect | null } = {}) {
  const created: { window: FakeWindow; parent: MainWindowHandle | null }[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const main = opts.main === undefined ? new FakeMain() : opts.main;
  const monitor = new ResourceMonitorWindow({
    createWindow: ({ bounds, parent }) => {
      const window = new FakeWindow(bounds);
      created.push({ window, parent });
      return window;
    },
    mainWindow: () => main,
    workAreas: () => opts.areas ?? [SCREEN],
    statusRect: async () => (opts.rect === undefined ? { x: 1400, y: 860, width: 200, height: 24 } : opts.rect),
    schedule: (fn, ms) => timers.push({ fn, ms }),
  });
  const runTimers = (): void => {
    while (timers.length > 0) timers.shift()!.fn();
  };
  return { monitor, created, timers, runTimers, main, last: () => created[created.length - 1]!.window };
}

describe('the monitor window (055 FR-081, FR-083, FR-086)', () => {
  it('is one window: opening it again brings the open one forward', () => {
    const h = harness();
    h.monitor.open();
    h.last().minimised = true;
    h.monitor.open();
    expect(h.created).toHaveLength(1);
    expect(h.last().minimised).toBe(false);
    expect(h.last().focused).toBe(2);
    expect(h.monitor.isOpen()).toBe(true);
  });

  it('is parented to the main window, centred over it the first time', () => {
    const h = harness();
    h.monitor.open();
    const { window, parent } = h.created[0]!;
    expect(parent).toBe(h.main);
    const centre = (r: Rect) => [r.x + r.width / 2, r.y + r.height / 2];
    expect(centre(window.bounds)).toEqual(centre(h.main!.bounds));
  });

  it('closes when the main window closes (FR-083)', () => {
    const h = harness();
    h.monitor.open();
    h.main!.close();
    expect(h.last().destroyed).toBe(true);
    expect(h.monitor.isOpen()).toBe(false);
  });

  it('opens with no main window to centre on, inside the screen', () => {
    const h = harness({ main: null });
    h.monitor.open();
    const b = h.last().bounds;
    expect(h.created[0]!.parent).toBeNull();
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(SCREEN.width);
  });
});

describe('what it remembers (055 FR-087)', () => {
  it('reopens where it was left, at the same size', () => {
    const h = harness();
    h.monitor.open();
    h.last().setBounds({ x: 300, y: 200, width: 900, height: 600 });
    h.last().close();
    h.monitor.open();
    expect(h.last().bounds).toEqual({ x: 300, y: 200, width: 900, height: 600 });
  });

  it('reopens maximised when it was closed maximised, restoring to the size it had before', () => {
    const h = harness();
    h.monitor.open();
    h.last().setBounds({ x: 300, y: 200, width: 900, height: 600 });
    h.last().maximize();
    h.last().close();
    h.monitor.open();
    expect(h.last().maximised).toBe(true);
    expect(h.last().normal).toEqual({ x: 300, y: 200, width: 900, height: 600 });
  });

  it('comes back onto a visible screen when the display it was left on is gone', () => {
    const areas = [SCREEN, { x: 1920, y: 0, width: 1920, height: 1040 }];
    const h = harness({ areas });
    h.monitor.open();
    h.last().setBounds({ x: 2400, y: 200, width: 900, height: 600 });
    h.last().close();
    areas.pop();
    h.monitor.open();
    const b = h.last().bounds;
    expect(b.x + b.width).toBeLessThanOrEqual(SCREEN.width);
    expect(b.width).toBe(900);
  });

  it('keeps the view until restart, and has none the first time', () => {
    const h = harness();
    expect(h.monitor.viewState()).toBeNull();
    h.monitor.saveViewState({ metric: 'memory', focusPath: ['root', 'c:projects'] });
    expect(h.monitor.viewState()).toEqual({ metric: 'memory', focusPath: ['root', 'c:projects'] });
  });
});

describe('minimise (055 FR-085)', () => {
  it('shrinks toward the status-bar figures in steps, fading, then closes', async () => {
    const h = harness();
    h.monitor.open();
    const w = h.last();
    await h.monitor.minimise({ reducedMotion: false });
    expect(w.destroyed).toBe(false);
    expect(w.minSize).toEqual([1, 1]);
    h.runTimers();
    expect(w.boundsLog.length).toBeGreaterThan(4);
    const lastStep = w.boundsLog[w.boundsLog.length - 1]!;
    // The status rect (1400, 860) in a content area at (108, 108), zoom 1.
    expect(lastStep.x).toBe(1508);
    expect(lastStep.y).toBe(968);
    expect(w.opacity).toBeLessThan(0.5);
    expect(w.destroyed).toBe(true);
  });

  it('remembers where it was before it shrank, not where the animation left it', async () => {
    const h = harness();
    h.monitor.open();
    h.last().setBounds({ x: 300, y: 200, width: 900, height: 600 });
    await h.monitor.minimise({ reducedMotion: false });
    h.runTimers();
    h.monitor.open();
    expect(h.last().bounds).toEqual({ x: 300, y: 200, width: 900, height: 600 });
  });

  it('closes at once under reduced motion', async () => {
    const h = harness();
    h.monitor.open();
    await h.monitor.minimise({ reducedMotion: true });
    expect(h.last().destroyed).toBe(true);
    expect(h.timers).toHaveLength(0);
  });

  it('closes at once when the figures are not on screen', async () => {
    const noRect = harness({ rect: null });
    noRect.monitor.open();
    await noRect.monitor.minimise({ reducedMotion: false });
    expect(noRect.last().destroyed).toBe(true);

    const mainMinimised = harness();
    mainMinimised.monitor.open();
    mainMinimised.main!.minimised = true;
    await mainMinimised.monitor.minimise({ reducedMotion: false });
    expect(mainMinimised.last().destroyed).toBe(true);
  });
});

describe('the geometry', () => {
  it('scales the status rect by the zoom factor into screen coordinates', () => {
    expect(toScreenRect({ x: 100, y: 50, width: 20, height: 10 }, { x: 8, y: 30, width: 0, height: 0 }, 1.5)).toEqual({
      x: 158,
      y: 105,
      width: 30,
      height: 15,
    });
  });

  it('steps from the window to the target, ending exactly on it', () => {
    const steps = shrinkSteps({ x: 0, y: 0, width: 1000, height: 800 }, { x: 900, y: 700, width: 100, height: 20 }, 10);
    expect(steps).toHaveLength(10);
    expect(steps[9]).toEqual({ x: 900, y: 700, width: 100, height: 20 });
    expect(steps[0]!.width).toBeLessThan(1000);
    expect(steps[0]!.width).toBeGreaterThan(steps[9]!.width);
  });

  it('keeps bounds whose title bar is on a screen, and drops ones that are not', () => {
    expect(visibleBounds({ x: 10, y: 10, width: 800, height: 600 }, [SCREEN])).toEqual({ x: 10, y: 10, width: 800, height: 600 });
    expect(visibleBounds({ x: 5000, y: 10, width: 800, height: 600 }, [SCREEN])).toBeNull();
    expect(visibleBounds({ x: 10, y: -600, width: 800, height: 600 }, [SCREEN])).toBeNull();
  });
});
