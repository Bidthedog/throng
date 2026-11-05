/**
 * Replaying a terminal's scrollback never types into it.
 *
 * Layer: component. The real `useTerminal` over a real xterm in jsdom, with a fake bridge: what matters is
 * what xterm hands the hook to send to the shell, and no window is needed to see that.
 *
 * A tab switch rebuilds the view and replays the daemon's tail, and that tail still holds every question a
 * program asked long ago. xterm answered them again, and the answers reached the shell as if typed:
 * `11;rgb:1c1c/1c1c/1c1c;1R` at a bash prompt, once per switch.
 *
 * ANTI-VACUITY CONTROL: the "live" test is why dropping every report would fail here too: a program that is
 * asking now must still be answered.
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

const PANEL = 'p-replay';
const ESC = '\u001b';
const noop = (): void => undefined;
const xterm = (): Terminal => recorded.instances.at(-1) as Terminal;

/** What programs ask a terminal: background colour, cursor position, device attributes, device status, a mode. */
const QUERIES = `${ESC}]11;?${ESC}\\${ESC}[6n${ESC}[c${ESC}[>c${ESC}[5n${ESC}[?1004$p`;
const TAIL = `$ some-program\r\n${QUERIES}done\r\n$ `;

let write: ReturnType<typeof vi.fn>;
let outputListeners: ((e: { panelId: string; data: string }) => void)[] = [];
let container: HTMLElement;

function installBridge(): void {
  write = vi.fn(() => Promise.resolve());
  (window as unknown as { throng?: unknown }).throng = {
    terminal: {
      attach: vi.fn(() => Promise.resolve({ ok: true as const, status: 'running', scrollback: TAIL, grid: { cols: 80, rows: 24 } })),
      detach: vi.fn(() => Promise.resolve()),
      write,
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

const bufferHas = (text: string): boolean => {
  const buf = xterm().buffer.active;
  for (let i = 0; i < buf.length; i++) if (buf.getLine(i)?.translateToString(true).includes(text)) return true;
  return false;
};

/** Until xterm has parsed the tail, and everything queued behind it. */
async function replayed(): Promise<void> {
  await waitFor(() => expect(bufferHas('done')).toBe(true), { timeout: 5000 });
  await act(async () => {
    await new Promise<void>((resolve) => xterm().write('', resolve));
  });
}

const sentToShell = (): string[] => write.mock.calls.map((call) => String(call[1]));

beforeEach(() => {
  shims();
  recorded.instances.length = 0;
  outputListeners = [];
  installBridge();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  clearTerminalViewState(PANEL);
  container.remove();
  Reflect.deleteProperty(window, 'throng');
});

describe('replaying scrollback', () => {
  it('sends nothing to the shell, whatever the tail asked', async () => {
    const { unmount } = mountTerminal();
    await replayed();
    expect(sentToShell()).toEqual([]);
    unmount();
  });

  it('still answers a program that asks after the replay', async () => {
    const { unmount } = mountTerminal();
    await replayed();
    await act(async () => {
      for (const listener of outputListeners) listener({ panelId: PANEL, data: `${ESC}[6n` });
      await new Promise<void>((resolve) => xterm().write('', resolve));
    });
    expect(sentToShell().join('')).toMatch(new RegExp(`${ESC}\\[\\d+;\\d+R`));
    unmount();
  });

  it('still sends what the user types', async () => {
    const { unmount } = mountTerminal();
    await replayed();
    act(() => xterm().input('ls\r'));
    expect(sentToShell()).toContain('ls\r');
    unmount();
  });
});
