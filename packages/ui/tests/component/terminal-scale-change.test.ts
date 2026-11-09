/**
 * Moving a window to a monitor with another display scale changes how many rows fit, with no change to the panel's size
 * (061 FR-042).
 *
 * Layer: component. The real `useTerminal` with the fit measurement and `matchMedia` faked: jsdom has no layout, and what
 * is under test is that a scale change makes the hook measure again and report the result.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTerminalViewState } from '../../src/renderer/terminal/terminal-view-state.js';
import { useTerminal } from '../../src/renderer/terminal/use-terminal.js';

const fit = vi.hoisted(() => ({ dims: { cols: 100, rows: 40 } }));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    activate(): void {}
    dispose(): void {}
    fit(): void {}
    proposeDimensions() {
      return fit.dims;
    }
  },
}));

const PANEL = 'p-scale';
const noop = (): void => undefined;
let resize: ReturnType<typeof vi.fn>;
let container: HTMLElement;
let scaleListeners: Set<() => void>;

beforeEach(() => {
  fit.dims = { cols: 100, rows: 40 };
  scaleListeners = new Set();
  resize = vi.fn(() => Promise.resolve());
  container = document.createElement('div');
  document.body.appendChild(container);
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addListener: noop,
      removeListener: noop,
      addEventListener: (_: string, l: () => void) => void (query.includes('resolution') && scaleListeners.add(l)),
      removeEventListener: (_: string, l: () => void) => void scaleListeners.delete(l),
    }),
  });
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe = noop;
    unobserve = noop;
    disconnect = noop;
  };
  (window as unknown as { throng?: unknown }).throng = {
    terminal: {
      attach: vi.fn(() => Promise.resolve({ ok: true as const, status: 'running', scrollback: '', replayEnd: 0, grid: { cols: 80, rows: 24 } })),
      detach: vi.fn(() => Promise.resolve()),
      write: vi.fn(() => Promise.resolve()),
      resize,
      onOutput: vi.fn(() => noop),
      onGrid: vi.fn(() => noop),
      onExit: vi.fn(() => noop),
    },
    panelState: { stash: vi.fn(async () => undefined), claim: vi.fn() },
  };
});

afterEach(() => {
  container.remove();
  clearTerminalViewState(PANEL);
});

function mount() {
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

describe('a display scale change (061 FR-042)', () => {
  it('re-measures and reports the new capacity without the panel changing size', async () => {
    mount();
    await waitFor(() => expect(scaleListeners.size).toBe(1));

    fit.dims = { cols: 90, rows: 33 };
    for (const listener of [...scaleListeners]) listener();

    await waitFor(() => expect(resize).toHaveBeenCalledWith(PANEL, 90, 33, expect.anything()));
  });

  it('goes on listening at the new scale', async () => {
    mount();
    await waitFor(() => expect(scaleListeners.size).toBe(1));
    const first = [...scaleListeners][0]!;

    first();

    expect(scaleListeners.size).toBe(1);
    expect([...scaleListeners][0]).not.toBe(undefined);
  });

  it('stops listening when the view goes', async () => {
    const { unmount } = mount();
    await waitFor(() => expect(scaleListeners.size).toBe(1));
    unmount();
    expect(scaleListeners.size).toBe(0);
  });
});
