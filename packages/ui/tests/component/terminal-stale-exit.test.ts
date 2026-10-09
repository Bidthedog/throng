/**
 * MT-01 (051) — reopening a project straight after Unload with End Terminals closed its terminals.
 *
 * Layer: component — the race is between this view's exit subscription and its own attach, both inside
 * `useTerminal`; the real hook over a real xterm in jsdom with a fake bridge drives it without a daemon.
 *
 * A reopened view listens for its panel's exits BEFORE its attach reaches the daemon. The terminal the
 * Unload is still ending exits in that gap (code 1, from taskkill), and its exit is published for the same
 * panel id. The view took it as its own: the panel reverted with "Terminal exited (code 1)" while the
 * fresh shell its attach then started kept running with nothing showing it.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTerminal } from '../../src/renderer/terminal/use-terminal.js';

const PANEL = 'p-term-stale-exit';
const noop = (): void => undefined;

type ExitEvent = { panelId: string; code: number | null; unexpected: boolean };
type ExitEventWithSession = ExitEvent & { sessionId?: number };
let exitListeners: ((e: ExitEventWithSession) => void)[] = [];
let answerAttach: (() => void) | null = null;
let attach: ReturnType<typeof vi.fn>;

/** The fresh session the daemon answers the reopened view's attach with. */
const FRESH_SESSION = 8;

function installBridge(): void {
  attach = vi.fn(
    () =>
      new Promise((resolve) => {
        answerAttach = () =>
          resolve({ ok: true as const, status: 'running', sessionId: FRESH_SESSION, scrollback: '', grid: { cols: 80, rows: 24 } });
      }),
  );
  (window as unknown as { throng?: unknown }).throng = {
    terminal: {
      attach,
      detach: vi.fn(() => Promise.resolve()),
      write: vi.fn(() => Promise.resolve()),
      writeClipboard: vi.fn(() => Promise.resolve()),
      resize: vi.fn(() => Promise.resolve()),
      onOutput: vi.fn(() => noop),
      onGrid: vi.fn(() => noop),
      onExit: vi.fn((cb: (e: ExitEventWithSession) => void) => {
        exitListeners.push(cb);
        return noop;
      }),
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

let container: HTMLElement;

beforeEach(() => {
  shims();
  exitListeners = [];
  answerAttach = null;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
  Reflect.deleteProperty(window, 'throng');
});

/** The session the Unload is still ending in this panel. */
const ENDING_SESSION = 7;

function mount(onExit: (e: { code: number | null; unexpected: boolean }) => void) {
  return renderHook(() =>
    useTerminal({
      panelId: PANEL,
      projectId: 'proj-1',
      projectRoot: 'C:/tmp/proj',
      flavourId: 'pwsh',
      shellArguments: '',
      startupCommand: '',
      container,
      theme: {},
      fontFamily: 'monospace',
      fontSize: 12,
      onExit,
      onError: noop,
      onStillStarting: noop,
      onAttached: noop,
    }),
  );
}

const publishExit = (e: Omit<ExitEventWithSession, 'panelId'>): void =>
  act(() => {
    for (const listener of exitListeners) listener({ panelId: PANEL, ...e });
  });

const answer = async (): Promise<void> =>
  act(async () => {
    answerAttach!();
    await Promise.resolve();
  });

describe('MT-01 — a reopened terminal and the exits of other sessions in its panel', () => {
  it('after the attach answers, a late exit of the ending session is ignored; its own exit is taken', async () => {
    installBridge();
    const onExit = vi.fn();
    const { unmount } = mount(onExit);
    await waitFor(() => expect(attach).toHaveBeenCalled());
    await answer();

    publishExit({ code: 1, unexpected: false, sessionId: ENDING_SESSION });
    expect(onExit).not.toHaveBeenCalled();
    publishExit({ code: 2, unexpected: true, sessionId: FRESH_SESSION });
    expect(onExit).toHaveBeenCalledWith({ code: 2, unexpected: true });
    unmount();
  });

  it('the attached session exiting before the answer arrives is still taken, once the answer names it', async () => {
    installBridge();
    const onExit = vi.fn();
    const { unmount } = mount(onExit);
    await waitFor(() => expect(attach).toHaveBeenCalled());

    publishExit({ code: 3, unexpected: true, sessionId: FRESH_SESSION });
    expect(onExit).not.toHaveBeenCalled();
    await answer();
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith({ code: 3, unexpected: true });
    unmount();
  });

  it('an exit published while this view is still attaching is not reported as this terminal exiting', async () => {
    installBridge();
    const onExit = vi.fn();
    const { unmount } = renderHook(() =>
      useTerminal({
        panelId: PANEL,
        projectId: 'proj-1',
        projectRoot: 'C:/tmp/proj',
        flavourId: 'pwsh',
        shellArguments: '',
        startupCommand: '',
        container,
        theme: {},
        fontFamily: 'monospace',
        fontSize: 12,
        onExit,
        onError: noop,
        onStillStarting: noop,
        onAttached: noop,
      }),
    );
    await waitFor(() => expect(attach).toHaveBeenCalled());

    // The previous terminal in this panel — ended by the Unload — exits now, before the attach is answered.
    act(() => {
      for (const listener of exitListeners) listener({ panelId: PANEL, code: 1, unexpected: false, sessionId: ENDING_SESSION });
    });
    // The daemon then answers the attach with the fresh terminal it started.
    await act(async () => {
      answerAttach!();
      await Promise.resolve();
    });

    expect(onExit).not.toHaveBeenCalled();
    unmount();
  });
});
