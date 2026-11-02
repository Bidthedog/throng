/**
 * 008 FR-005 / SC-006 (moved down from terminal-slow-start.e2e.ts) — an attach that outlives its budget is
 * reported as "still starting", never as a failure or an exit, and a retry re-attaches.
 *
 * Layer: component — the decision is `useTerminal`'s reading of the attach answer; the real hook over a real
 * xterm in jsdom with a fake bridge answering `{ stillStarting: true }` (what main sends when the budget
 * runs out) shows which callback it reaches. The panel's rendering of that state is
 * terminal-slow-start-panel.test.ts.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTerminal } from '../../src/renderer/terminal/use-terminal.js';

const PANEL = 'p-term-slow-start';
const noop = (): void => undefined;

type AttachAnswer = Record<string, unknown>;
let answers: ((a: AttachAnswer) => void)[] = [];
let attach: ReturnType<typeof vi.fn>;

function installBridge(): void {
  attach = vi.fn(() => new Promise<AttachAnswer>((resolve) => answers.push(resolve)));
  (window as unknown as { throng?: unknown }).throng = {
    terminal: {
      attach,
      detach: vi.fn(() => Promise.resolve()),
      write: vi.fn(() => Promise.resolve()),
      writeClipboard: vi.fn(() => Promise.resolve()),
      resize: vi.fn(() => Promise.resolve()),
      onOutput: vi.fn(() => noop),
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

let container: HTMLElement;

beforeEach(() => {
  shims();
  answers = [];
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
  Reflect.deleteProperty(window, 'throng');
});

const answer = async (index: number, a: AttachAnswer): Promise<void> =>
  act(async () => {
    answers[index]!(a);
    await Promise.resolve();
  });

describe('008 FR-005 — a cold-start attach that outlives its budget', () => {
  it('reports "still starting" (not an error, not an exit); a retry re-attaches and the session attaches', async () => {
    installBridge();
    const cb = { onExit: vi.fn(), onError: vi.fn(), onStillStarting: vi.fn(), onAttached: vi.fn() };
    const { rerender, unmount } = renderHook(
      ({ attempt }: { attempt: number }) =>
        useTerminal({
          panelId: PANEL,
          projectId: 'proj-1',
          projectRoot: 'C:/tmp/proj',
          flavourId: 'cmd',
          shellArguments: '',
          startupCommand: '',
          container,
          theme: {},
          fontFamily: 'monospace',
          fontSize: 12,
          attempt,
          ...cb,
        }),
      { initialProps: { attempt: 0 } },
    );
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(1));

    // What main answers when the attach budget runs out (terminal-ipc.ts).
    await answer(0, { ok: false, stillStarting: true, error: { code: null, message: 'still starting' } });
    expect(cb.onStillStarting, 'the overrun is the non-fatal state').toHaveBeenCalledTimes(1);
    expect(cb.onError, 'it is not a hard error (which reverts the panel to the type form)').not.toHaveBeenCalled();
    expect(cb.onExit, 'it is not an exit').not.toHaveBeenCalled();
    expect(cb.onAttached).not.toHaveBeenCalled();

    // Retry bumps `attempt`: the hook re-attaches, and the (now running) session answers.
    rerender({ attempt: 1 });
    await waitFor(() => expect(attach, 'the retry attaches again').toHaveBeenCalledTimes(2));
    await answer(1, { ok: true, status: 'running', sessionId: 5, scrollback: '', grid: { cols: 80, rows: 24 } });
    expect(cb.onAttached, 'the retry recovers the session').toHaveBeenCalledTimes(1);
    expect(cb.onError).not.toHaveBeenCalled();
    unmount();
  });
});
