import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureTerminalCommandBridge,
  forgetTerminalCommand,
  peekProgramTitle,
} from '../../src/renderer/terminal/command-store.js';
import { clearTerminalTitle, setTerminalTitle } from '../../src/renderer/terminal/title-store.js';
import { useTerminal } from '../../src/renderer/terminal/use-terminal.js';

/**
 * 053 FR-003 `{title}` — a program that titles itself once, restarted in a NEW session of the same panel, is named by
 * that title again: the previous session's title is not taken for the new shell's prompt title.
 *
 * ══ THE REPORTED DEFECT ══
 *
 * Hosted macOS, `terminal-title-template.e2e.ts` "a program that titles itself …", step 9 (failed, passed on retry):
 * after Unload with End Terminals and a reload, the remembered `node titler.js` ran again and set its title, and the
 * name stayed `node titler.js | Bash (…)` instead of `node: writing the tests | Bash (…)`.
 *
 * The title and the prompt-title snapshot are module state keyed by panel id. A session's title is dropped when a
 * view hears that session's exit — and Unload now unmounts every view before it ends the terminals, so that exit is
 * heard by nobody and the ended program's title outlives it. The new shell's first "nothing running" observation
 * then snapshots that stale title as the PROMPT's own; the restarted program sets the same string, which changes
 * nothing in the store, and `isProgramTitle` rejects it as the prompt's title.
 *
 * Layer: component — a real `useTerminal` against a stubbed bridge, delivering the attach answer and the daemon's
 * observations in the order the reload produces.
 */

/** One panel id per test: the prompt-title snapshot is module state no public call clears. */
let PANEL = '';
let panels = 0;
const TITLE = 'writing the tests';

function noop(): void {
  /* nothing */
}

type CommandEvent = { panelId: string; command: string | null; arch?: string | null; observedAt?: number };
let publish: null | ((e: CommandEvent) => void) = null;
let answerAttach: (value: unknown) => void = noop;

function fakeTerminalBridge() {
  return {
    attach: vi.fn(
      () =>
        new Promise((resolve) => {
          answerAttach = resolve;
        }),
    ),
    detach: vi.fn(() => Promise.resolve()),
    write: vi.fn(() => Promise.resolve()),
    writeClipboard: vi.fn(() => Promise.resolve()),
    resize: vi.fn(() => Promise.resolve()),
    onOutput: vi.fn(() => noop),
    onGrid: vi.fn(() => noop),
    onExit: vi.fn(() => noop),
    onCommand: (cb: (e: CommandEvent) => void) => {
      publish = cb;
      return () => {
        publish = null;
      };
    },
  };
}

function mountTerminal(container: HTMLElement) {
  return renderHook(() =>
    useTerminal({
      panelId: PANEL,
      projectId: 'proj-1',
      projectRoot: '/tmp/proj',
      flavourId: 'bash',
      shellArguments: '',
      startupCommand: 'node titler.js',
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

/** jsdom has no media queries and no layout; xterm asks for both as it mounts (see terminal-title-unmount.test.ts). */
function shimDom(): void {
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

// The command store subscribes to the bridge once per renderer, so the bridge is installed once for the file.
beforeAll(() => {
  shimDom();
  Reflect.set(window, 'throng', { terminal: fakeTerminalBridge() });
  ensureTerminalCommandBridge();
});

beforeEach(() => {
  panels += 1;
  PANEL = `p-title-new-session-${panels}`;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  forgetTerminalCommand(PANEL);
  clearTerminalTitle(PANEL);
  container.remove();
});

async function answer(reply: Record<string, unknown>): Promise<void> {
  await act(async () => {
    answerAttach({ ok: true, scrollback: '', replayEnd: 0, grid: { cols: 80, rows: 24 }, ...reply });
  });
}

describe('053 FR-003 — a program restarted in a new session of its panel is named by its own title', () => {
  it('after Unload with End Terminals and a reload, the restarted program’s title names it again', async () => {
    // Session 1: the program runs and titles itself.
    const first = mountTerminal(container);
    await answer({ status: 'running', sessionId: 1 });
    act(() => {
      publish!({ panelId: PANEL, command: 'node titler.js', observedAt: Date.now() });
      setTerminalTitle(PANEL, TITLE);
    });
    expect(peekProgramTitle(PANEL)).toBe(TITLE);

    // Unload with End Terminals: the view goes first, so no view hears session 1's exit.
    first.unmount();

    // The reload: a new view, a cold start (session 2, no title of its own yet). The new shell is seen at its
    // prompt before its startup command runs.
    mountTerminal(container);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      publish!({ panelId: PANEL, command: null, observedAt: Date.now() });
    });
    await answer({ status: 'running', sessionId: 2 });
    act(() => {
      publish!({ panelId: PANEL, command: 'node titler.js', observedAt: Date.now() });
      // The restarted program titles itself, as it did the first time.
      setTerminalTitle(PANEL, TITLE);
    });

    expect(peekProgramTitle(PANEL), 'the ended session’s title was taken for the new prompt’s').toBe(TITLE);
  });

  it('control: a project switch re-attaching the SAME session keeps the title the program set', async () => {
    const first = mountTerminal(container);
    await answer({ status: 'running', sessionId: 7 });
    act(() => {
      publish!({ panelId: PANEL, command: 'node titler.js', observedAt: Date.now() });
      setTerminalTitle(PANEL, TITLE);
    });
    first.unmount();

    mountTerminal(container);
    await answer({ status: 'running', sessionId: 7, command: 'node titler.js' });

    expect(peekProgramTitle(PANEL)).toBe(TITLE);
  });
});
