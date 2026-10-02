/**
 * 049 T043 — a terminal's viewport and selection cross windows (US6.2; FR-000a; research R3; Edge Cases).
 *
 * The real `useTerminal` over a real xterm in jsdom and a fake bridge that answers `attach` with a scrollback
 * backlog. The `Terminal` class is wrapped only to record the instance the hook creates, so the buffer — the
 * viewport and the selection — can be read and driven directly.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelSnapshot } from '@throng/core';
import { stashPanelState } from '../../src/renderer/workspace/panel-state-capture.js';
import {
  clearTerminalViewState,
  seedTerminalViewState,
} from '../../src/renderer/terminal/terminal-view-state.js';
import { useTerminal } from '../../src/renderer/terminal/use-terminal.js';

const recorded = vi.hoisted(() => ({ instances: [] as unknown[] }));
vi.mock('@xterm/xterm', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@xterm/xterm')>();
  class RecordingTerminal extends mod.Terminal {
    constructor(...args: ConstructorParameters<typeof mod.Terminal>) {
      super(...args);
      recorded.instances.push(this);
    }
    /*
     * In a browser, `scrollLines`/`scrollToLine` move the DOM viewport and the buffer follows its scroll event.
     * jsdom has no layout and fires none, so on a stock xterm the viewport never moves (measured: `scrollToLine`
     * leaves `viewportY` where it was). Routing the same request to xterm's own buffer service — which is what
     * that scroll event ends up calling — gives the buffer behaviour this test is about: a scrolled-back viewport
     * stays put under new output, and a request is clamped to the scrollback.
     */
    override scrollLines(amount: number): void {
      (this as unknown as { _core: { _bufferService: { scrollLines(n: number): void } } })._core._bufferService.scrollLines(amount);
    }
    override scrollToLine(line: number): void {
      this.scrollLines(line - this.buffer.active.viewportY);
    }
  }
  return { ...mod, Terminal: RecordingTerminal };
});

const PANEL = 'p-term-hand';
const noop = (): void => undefined;
const xterm = (): Terminal => recorded.instances.at(-1) as Terminal;

/** 300 numbered lines: far more than the 24-row screen, so there is scrollback to be scrolled back in. */
const BACKLOG = Array.from({ length: 300 }, (_, i) => `row ${String(i).padStart(3, '0')}`).join('\r\n') + '\r\n';

let outputListeners: ((e: { panelId: string; data: string }) => void)[] = [];
let releaseAttach: (() => void) | null = null;
let stash: ReturnType<typeof vi.fn>;

function installBridge(holdAttach: boolean): void {
  const attach = vi.fn(
    () =>
      new Promise((resolve) => {
        const answer = (): void => resolve({ ok: true as const, status: 'running', scrollback: BACKLOG, grid: { cols: 80, rows: 24 } });
        if (holdAttach) releaseAttach = answer;
        else answer();
      }),
  );
  (window as unknown as { throng?: unknown }).throng = {
    terminal: {
      attach,
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
    panelState: { stash, claim: vi.fn() },
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

function mountTerminal() {
  return renderHook(() =>
    useTerminal({
      panelId: PANEL,
      projectId: 'proj-1',
      projectRoot: 'C:/tmp/proj',
      flavourId: 'git-bash',
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

/** Wait until xterm has parsed the whole backlog and the restore (a deferred empty write) has run. */
const settled = async (): Promise<void> => {
  await waitFor(() => expect(xterm().buffer.active.baseY).toBeGreaterThan(200), { timeout: 5000 });
  await act(async () => {
    await new Promise<void>((resolve) => xterm().write('', resolve));
  });
};

const offsetFromBottom = (): number => xterm().buffer.active.baseY - xterm().buffer.active.viewportY;
const bufferHas = (text: string): boolean => {
  const buf = xterm().buffer.active;
  for (let i = 0; i < buf.length; i++) if (buf.getLine(i)?.translateToString(true).includes(text)) return true;
  return false;
};

beforeEach(() => {
  shims();
  recorded.instances.length = 0;
  outputListeners = [];
  releaseAttach = null;
  stash = vi.fn(async () => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  clearTerminalViewState(PANEL);
  container.remove();
  Reflect.deleteProperty(window, 'throng');
});

describe('the terminal capture', () => {
  it('returns { offsetFromBottom: baseY - viewportY, selection: getSelectionPosition() } of the live view', async () => {
    installBridge(false);
    const { unmount } = mountTerminal();
    await settled();

    act(() => {
      xterm().scrollToLine(xterm().buffer.active.baseY - 37);
      xterm().select(2, xterm().buffer.active.viewportY + 3, 5);
    });
    await stashPanelState([PANEL]);

    const sent = (stash.mock.calls[0] as unknown as [PanelSnapshot[]])[0];
    expect(sent[0]!.terminal).toEqual({
      offsetFromBottom: 37,
      selection: xterm().getSelectionPosition(),
    });
    expect(sent[0]!.terminal?.selection).toBeTruthy();
    unmount();
  });

  it('stops answering once the view unmounts — and the saved entry answers instead', async () => {
    installBridge(false);
    const { unmount } = mountTerminal();
    await settled();
    act(() => xterm().scrollToLine(xterm().buffer.active.baseY - 12));
    unmount();

    await stashPanelState([PANEL]);
    const sent = (stash.mock.calls[0] as unknown as [PanelSnapshot[]])[0];
    expect(sent[0]!.terminal?.offsetFromBottom).toBe(12);
  });
});

describe('a seeded entry (what the receiving window leaves)', () => {
  it('is restored after the scrollback replay: the viewport sits where it was, the selection is back', async () => {
    // The coordinates are exactly what `getSelectionPosition()` returns — the capture and the restore must agree
    // on them, or a selection moves by one cell every time it is carried (B1: it used to).
    const selection = { start: { x: 3, y: 10 }, end: { x: 8, y: 10 } };
    seedTerminalViewState(PANEL, { offsetFromBottom: 40, selection });
    installBridge(false);
    const { unmount } = mountTerminal();
    await settled();

    expect(offsetFromBottom()).toBe(40);
    expect(xterm().getSelectionPosition()).toEqual(selection);
    unmount();
  });

  it('output written after the restore does not move a scrolled-back viewport', async () => {
    seedTerminalViewState(PANEL, { offsetFromBottom: 40 });
    installBridge(false);
    const { unmount } = mountTerminal();
    await settled();
    const before = xterm().buffer.active.viewportY;

    act(() => outputListeners.forEach((cb) => cb({ panelId: PANEL, data: 'LATER-1\r\nLATER-2\r\nLATER-3\r\n' })));
    await act(async () => {
      await new Promise<void>((resolve) => xterm().write('', resolve));
    });

    expect(xterm().buffer.active.viewportY).toBe(before); // still looking at the same history, not pulled to the end
    expect(bufferHas('LATER-3')).toBe(true); // …and nothing was lost
    unmount();
  });

  it('output written between the replay and the restore is in the buffer afterwards, with the viewport still at the restored offset', async () => {
    seedTerminalViewState(PANEL, { offsetFromBottom: 40 });
    installBridge(true); // the attach answer is held back
    const { unmount } = mountTerminal();
    await waitFor(() => expect(releaseAttach).not.toBeNull());

    // Live output arrives while the backlog is still being fetched (two sockets, no ordering between them).
    act(() => outputListeners.forEach((cb) => cb({ panelId: PANEL, data: 'MIDFLIGHT\r\nMIDFLIGHT-2\r\n' })));
    act(() => releaseAttach!());
    await settled();

    expect(bufferHas('MIDFLIGHT-2')).toBe(true);
    expect(offsetFromBottom()).toBe(40);
    unmount();
  });
});
