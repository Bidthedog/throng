/**
 * A returning view loads the terminal's kept lines without blocking the window (061 FR-017, R6).
 *
 * Layer: component. The real `useTerminal` over a real xterm in jsdom with a fake bridge: what matters is how the hook
 * feeds xterm, and no window is needed to see that.
 */
import { renderHook, waitFor } from '@testing-library/react';
import type { Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTerminalViewState } from '../../src/renderer/terminal/terminal-view-state.js';
import { useTerminal } from '../../src/renderer/terminal/use-terminal.js';

const recorded = vi.hoisted(() => ({ instances: [] as unknown[], writes: [] as number[] }));
vi.mock('@xterm/xterm', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@xterm/xterm')>();
  class RecordingTerminal extends mod.Terminal {
    constructor(...args: ConstructorParameters<typeof mod.Terminal>) {
      super(...args);
      recorded.instances.push(this);
    }
    override write(data: string | Uint8Array, callback?: () => void): void {
      if (typeof data === 'string' && data.length > 0) recorded.writes.push(data.length);
      super.write(data, callback);
    }
  }
  return { ...mod, Terminal: RecordingTerminal };
});

const PANEL = 'p-slices';
const noop = (): void => undefined;
const xterm = (): Terminal => recorded.instances.at(-1) as Terminal;
const LINE = `${'x'.repeat(78)}\r\n`;
const REPLAY = LINE.repeat(3000); // 240,000 characters

let container: HTMLElement;

function installBridge(): void {
  (window as unknown as { throng?: unknown }).throng = {
    terminal: {
      attach: vi.fn(() =>
        Promise.resolve({ ok: true as const, status: 'running', scrollback: REPLAY, replayEnd: REPLAY.length, grid: { cols: 80, rows: 24 } }),
      ),
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

beforeEach(() => {
  recorded.instances.length = 0;
  recorded.writes.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({ matches: false, media: query, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
    });
  }
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver !== 'function') {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe = noop;
      unobserve = noop;
      disconnect = noop;
    };
  }
  installBridge();
});

afterEach(() => {
  container.remove();
  clearTerminalViewState(PANEL);
});

describe('replaying what a terminal kept', () => {
  it('holds 10,000 lines', () => {
    mountTerminal();
    expect(xterm().options.scrollback).toBe(10_000);
  });

  it('writes a large replay in slices, so xterm can yield between them', async () => {
    mountTerminal();
    await waitFor(() => expect(recorded.writes.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(REPLAY.length));
    expect(recorded.writes.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...recorded.writes)).toBeLessThanOrEqual(64 * 1024);
  });

  it('shows the panel only once the replay has been applied', async () => {
    mountTerminal();
    await waitFor(() => expect(container.classList.contains('terminal-replaying')).toBe(true));
    await waitFor(() => expect(container.classList.contains('terminal-replaying')).toBe(false), { timeout: 5000 });
    expect(xterm().buffer.active.length).toBeGreaterThan(2000);
  });
});
