/**
 * `terminals.macOptionIsMeta` reaches xterm (070 FR-031, research R22).
 *
 * Layer: component — the real `useTerminal` over a real xterm in jsdom with a fake bridge, because the claim is that
 * the hook hands the value to xterm's own option, at creation and on a later change; nothing below needs a window.
 */
import { renderHook, waitFor } from '@testing-library/react';
import type { Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTerminalViewState } from '../../src/renderer/terminal/terminal-view-state.js';
import { useTerminal } from '../../src/renderer/terminal/use-terminal.js';

const recorded = vi.hoisted(() => ({ instances: [] as unknown[], options: [] as unknown[] }));
vi.mock('@xterm/xterm', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@xterm/xterm')>();
  class RecordingTerminal extends mod.Terminal {
    constructor(...args: ConstructorParameters<typeof mod.Terminal>) {
      super(...args);
      recorded.instances.push(this);
      recorded.options.push(args[0]);
    }
  }
  return { ...mod, Terminal: RecordingTerminal };
});

const PANEL = 'p-option-meta';
const noop = (): void => undefined;
const xterm = (): Terminal => recorded.instances.at(-1) as Terminal;
let container: HTMLElement;

function installBridge(): void {
  (window as unknown as { throng?: unknown }).throng = {
    terminal: {
      attach: vi.fn(() => Promise.resolve({ ok: true as const, status: 'running', scrollback: '', grid: { cols: 80, rows: 24 } })),
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

function mountTerminal(macOptionIsMeta: boolean | undefined) {
  return renderHook(
    ({ meta }: { meta: boolean | undefined }) =>
      useTerminal({
        panelId: PANEL,
        projectId: 'proj-1',
        projectRoot: '/tmp/proj',
        flavourId: 'zsh',
        shellArguments: '',
        startupCommand: '',
        container,
        theme: {},
        fontFamily: 'monospace',
        fontSize: 12,
        ...(meta === undefined ? {} : { macOptionIsMeta: meta }),
        onExit: noop,
        onError: noop,
        onStillStarting: noop,
        onAttached: noop,
      }),
    { initialProps: { meta: macOptionIsMeta } },
  );
}

beforeEach(() => {
  shims();
  recorded.instances.length = 0;
  recorded.options.length = 0;
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

describe('terminals.macOptionIsMeta reaches xterm (070 FR-031)', () => {
  it('is off when the setting is off or absent, so Option types the layout’s characters', async () => {
    mountTerminal(undefined);
    await waitFor(() => expect(recorded.instances.length).toBeGreaterThan(0));
    expect(xterm().options.macOptionIsMeta).toBe(false);
  });

  it('is on when the setting is on, and follows a later change without a new terminal', async () => {
    const hook = mountTerminal(true);
    await waitFor(() => expect(recorded.instances.length).toBeGreaterThan(0));
    expect(xterm().options.macOptionIsMeta).toBe(true);
    const created = recorded.instances.length;
    hook.rerender({ meta: false });
    await waitFor(() => expect(xterm().options.macOptionIsMeta).toBe(false));
    expect(recorded.instances.length).toBe(created);
    hook.unmount();
  });
});

describe('a right-click never selects a word (045 FR-169, FR-171)', () => {
  // xterm's own default is on for macOS: the right button's press selected the word under the pointer, which then
  // read as the user's selection, so a right-click on a terminal link opened the ordinary menu, not the Link menu
  // (hosted macOS E2E, terminal-clipboard). Asserted on what throng PASSES, because jsdom is not macOS and xterm's
  // resulting default here would be off whatever throng did.
  it('is passed off explicitly, on every platform', async () => {
    mountTerminal(undefined);
    await waitFor(() => expect(recorded.options.length).toBeGreaterThan(0));
    expect((recorded.options.at(-1) as { rightClickSelectsWord?: boolean }).rightClickSelectsWord).toBe(false);
  });
});
