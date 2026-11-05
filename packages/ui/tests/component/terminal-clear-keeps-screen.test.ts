/**
 * Output that begins with a screen clear keeps what it then draws.
 *
 * Layer: component. The real `useTerminal` over a real xterm in jsdom, with a fake bridge: what matters is
 * what the buffer holds after the hook writes a chunk, and no window is needed to see that.
 *
 * `top` on the normal screen starts each first frame with `ESC[H ESC[2J`, which the hook takes for a `cls` and
 * follows with `term.clear()`. That keeps only the cursor's row, so every row in that chunk vanished: the top
 * of the display, or all but one line when the frame landed in one chunk, until `top` next repainted.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTerminalViewState } from '../../src/renderer/terminal/terminal-view-state.js';
import { useTerminal } from '../../src/renderer/terminal/use-terminal.js';

const recorded = vi.hoisted(() => ({ instances: [] as unknown[] }));
vi.mock('@xterm/xterm', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@xterm/xterm')>();
  class RecordingTerminal extends mod.Terminal {
    constructor(...args: ConstructorParameters<typeof mod.Terminal>) {
      super(...args);
      recorded.instances.push(this);
    }
  }
  return { ...mod, Terminal: RecordingTerminal };
});

const PANEL = 'p-clear';
const ESC = '\u001b';
const CLEAR = `${ESC}[H${ESC}[2J`;
const noop = (): void => undefined;
const xterm = (): Terminal => recorded.instances.at(-1) as Terminal;

let outputListeners: ((e: { panelId: string; data: string }) => void)[] = [];
let container: HTMLElement;

function installBridge(): void {
  (window as unknown as { throng?: unknown }).throng = {
    terminal: {
      attach: vi.fn(() => Promise.resolve({ ok: true as const, status: 'running', scrollback: '', grid: { cols: 80, rows: 24 } })),
      detach: vi.fn(() => Promise.resolve()),
      write: vi.fn(() => Promise.resolve()),
      writeClipboard: vi.fn(() => Promise.resolve()),
      resize: vi.fn(() => Promise.resolve()),
      onOutput: vi.fn((cb: (e: { panelId: string; data: string }) => void) => {
        outputListeners.push(cb);
        return noop;
      }),
      onGrid: vi.fn(() => noop),
      onExit: vi.fn(() => noop),
    },
    panelState: { stash: vi.fn(async () => undefined), claim: vi.fn() },
  };
}

function shims(): void {
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: noop,
        removeListener: noop,
        addEventListener: noop,
        removeEventListener: noop,
        dispatchEvent: () => false,
      }),
    });
  }
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver !== 'function') {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe = noop;
      unobserve = noop;
      disconnect = noop;
    };
  }
}

function mountTerminal() {
  return renderHook(() =>
    useTerminal({
      panelId: PANEL,
      projectId: 'proj-1',
      projectRoot: '/tmp/proj',
      flavourId: 'bash',
      shellArguments: '',
      startupCommand: '',
      container,
      theme: {},
      fontFamily: 'monospace',
      fontSize: 12,
      onExit: noop,
      onError: noop,
      onStillStarting: noop,
      onAttached: noop,
    }),
  );
}

async function output(data: string): Promise<void> {
  await act(async () => {
    for (const listener of outputListeners) listener({ panelId: PANEL, data });
    await new Promise<void>((resolve) => xterm().write('', resolve));
  });
}

/** A mounted terminal past its startup clear and the resize window, as a running shell is. */
async function running() {
  const hook = mountTerminal();
  await waitFor(() => expect(outputListeners.length).toBeGreaterThan(0));
  // Past the resize window first: a clear inside it is taken for a resize repaint and uses nothing up.
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
  await output(CLEAR);
  return hook;
}

const screenRows = (): string[] => {
  const buf = xterm().buffer.active;
  const out: string[] = [];
  for (let i = 0; i < xterm().rows; i++) out.push(buf.getLine(buf.viewportY + i)?.translateToString(true) ?? '');
  return out;
};

beforeEach(() => {
  shims();
  recorded.instances.length = 0;
  outputListeners = [];
  installBridge();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  vi.restoreAllMocks();
  clearTerminalViewState(PANEL);
  container.remove();
  Reflect.deleteProperty(window, 'throng');
});

describe('a chunk that clears the screen and then draws', () => {
  it("keeps every row of top's first frame", async () => {
    const { unmount } = await running();
    const frame = Array.from({ length: 20 }, (_, i) => `row ${i}${ESC}[K\r\n`).join('');
    await output(`${CLEAR}${frame}`);
    expect(screenRows().slice(0, 3)).toEqual(['row 0', 'row 1', 'row 2']);
    unmount();
  });

  it('keeps what a command prints straight after clear', async () => {
    const { unmount } = await running();
    await output(`${CLEAR}${ESC}[3Jfirst\r\nsecond\r\n$ `);
    expect(screenRows().slice(0, 3)).toEqual(['first', 'second', '$ ']);
    unmount();
  });

  it('keeps a repaint made of home and one erase per row', async () => {
    const { unmount } = await running();
    const repaint = Array.from({ length: 24 }, (_, i) => `row ${i}${ESC}[K${i < 23 ? '\r\n' : ''}`).join('');
    await output(`${ESC}[H${repaint}`);
    expect(screenRows()[0]).toBe('row 0');
    unmount();
  });

  it('still drops the scrollback a clear leaves behind, on the shape cls produces', async () => {
    const { unmount } = await running();
    await output(Array.from({ length: 100 }, (_, i) => `line ${i}\r\n`).join(''));
    expect(xterm().buffer.active.baseY).toBeGreaterThan(0);
    await output(CLEAR);
    expect(xterm().buffer.active.baseY).toBe(0);
    unmount();
  });
});
