/**
 * 073 FR-008g, as widened by the maintainer on 2026-11-21 ("middle click should not paste at all in throng, in any
 * panel") — a program in a terminal that reads the mouse (tmux, vim with the mouse on) never receives the middle
 * button. xterm forwards a button press to the pty as a mouse report while the program has asked for them, and such a
 * program may paste its own buffer on a middle press. The left button still reaches it: the control that shows this
 * harness sees the events at all.
 *
 * Layer: component — the real `useTerminal` over a real xterm in jsdom with a fake bridge.
 */
import { renderHook, waitFor } from '@testing-library/react';
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

const PANEL = 'p-no-middle-report';
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

function mountTerminal() {
  return renderHook(() =>
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
      onExit: noop,
      onError: noop,
      onStillStarting: noop,
      onAttached: noop,
    }),
  );
}


/** A press and release of `button` over the terminal's screen, as the browser delivers them. */
function click(button: number, opts: { ctrlKey?: boolean } = {}): void {
  const target = container.querySelector('.xterm-screen') ?? container.querySelector('.xterm') ?? container;
  const init = { bubbles: true, cancelable: true, button, buttons: button === 1 ? 4 : 1, clientX: 10, clientY: 10, ...opts };
  target.dispatchEvent(new MouseEvent('mousedown', init));
  target.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
  if (button !== 0) target.dispatchEvent(new MouseEvent('auxclick', init));
}

beforeEach(() => {
  shims();
  recorded.instances.length = 0;
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

describe('a mouse-reporting program never receives the middle button (073 FR-008g, 2026-11-21)', () => {
  /*
   * xterm reads the mouse through listeners on its own element and the screen inside it, and turns what reaches them
   * into reports while the program has asked for them. jsdom gives xterm no cell size, so it cannot place a click on a
   * cell and reports nothing here, even for the left button; the claim is therefore that no middle-button event ever
   * reaches xterm's element, which is what it would report. The left button still does: the control.
   */
  it('lets a left press reach xterm, and no middle press, release, auxclick or middle drag, with or without Ctrl', async () => {
    mountTerminal();
    await waitFor(() => expect(recorded.instances.length).toBeGreaterThan(0));
    // The program asks for button and motion reports in SGR form, as tmux and vim do.
    await new Promise<void>((resolve) => xterm().write('\x1b[?1003h\x1b[?1006h', resolve));
    const screenEl = container.querySelector<HTMLElement>('.xterm-screen');
    expect(screenEl).not.toBeNull();
    const reached: string[] = [];
    for (const type of ['mousedown', 'mouseup', 'auxclick', 'mousemove']) {
      screenEl!.addEventListener(type, (e) => reached.push(`${type}:${(e as MouseEvent).button}:${(e as MouseEvent).buttons}`));
    }

    click(0);
    expect(reached).toContain('mousedown:0:1');

    reached.length = 0;
    click(1);
    click(1, { ctrlKey: true });
    screenEl!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, button: 1, buttons: 4, clientX: 20, clientY: 20 }));
    expect(reached, 'a middle-button event reached xterm').toEqual([]);
  });
});
