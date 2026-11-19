/**
 * 053 FR-002, FR-003 — a command typed at a new shell's first prompt is named by its command line, never by the
 * prompt's own window title.
 *
 * ══ THE REPORTED DEFECT ══
 *
 * v1.0.0-beta1 release run, Linux, `terminal-title-template.e2e.ts` "every shell names its running command …", step 2
 * (failed on both attempts): with `ping 127.0.0.77` running in a fresh Bash terminal the name read
 * `ping: runner@runnervm…: /tmp/…/throng-titles-… | Bash (…)` instead of `ping 127.0.0.77 | Bash (…)`.
 *
 * Bash's prompt sets the window title (`user@host: dir`). The command store tells the prompt's title from a program's
 * by snapshotting the title at an observation of "nothing running" — but the daemon publishes an observation only
 * when it changes, and a new shell's one "nothing running" observation can be read before its first prompt's title
 * reaches the renderer. That title then arrives AFTER the reading, so it is (rightly, 1 run in 9) not taken for the
 * prompt's — and no later observation of "nothing running" ever comes to take it. The ping then started, the title
 * stayed as the prompt set it, and the prompt's title was named as ping's.
 *
 * Layer: component — a real `useTerminal` over a real xterm in jsdom, with a stubbed bridge delivering the daemon's
 * observation, the attach answer, the prompt's title and the typed command line in the order the fresh shell produced.
 */
import { act, renderHook } from '@testing-library/react';
import type { Terminal } from '@xterm/xterm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureTerminalCommandBridge,
  forgetTerminalCommand,
  peekProgramTitle,
} from '../../src/renderer/terminal/command-store.js';
import { clearTerminalTitle, setTerminalTitle } from '../../src/renderer/terminal/title-store.js';
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

/** One panel id per test: the prompt-title snapshot is module state no public call clears. */
let PANEL = '';
let panels = 0;
const PROMPT_TITLE = 'runner@runnervm: /tmp/throng-titles';
const PING = 'ping 127.0.0.77';

function noop(): void {
  /* nothing */
}

const xterm = (): Terminal => recorded.instances.at(-1) as Terminal;

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
  PANEL = `p-title-first-prompt-${panels}`;
  vi.useFakeTimers({ now: 10_000, toFake: ['Date'] });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  forgetTerminalCommand(PANEL);
  clearTerminalTitle(PANEL);
  container.remove();
  vi.useRealTimers();
});

async function answer(reply: Record<string, unknown>): Promise<void> {
  await act(async () => {
    answerAttach({ ok: true, scrollback: '', replayEnd: 0, grid: { cols: 80, rows: 24 }, ...reply });
  });
}

/** The user types a line at the prompt and presses Enter — through xterm, as a keyboard would. */
function typeLine(line: string): void {
  act(() => {
    xterm().input(`${line}\r`, true);
  });
}

describe('053 FR-003 — a command typed at a new shell’s first prompt is not named by the prompt’s title', () => {
  it('the prompt’s title, arriving after the only "nothing running" reading, is not taken for the command’s', async () => {
    mountTerminal(container);
    // The daemon's first reading is taken as the shell starts, before its first prompt; it sees nothing running.
    const reading = Date.now();
    vi.setSystemTime(10_050);
    act(() => publish!({ panelId: PANEL, command: null, observedAt: reading }));
    await answer({ status: 'running', sessionId: 1 });
    // The first prompt sets its window title, after that reading. Nothing running is unchanged, so no second
    // observation is published.
    vi.setSystemTime(10_300);
    act(() => setTerminalTitle(PANEL, PROMPT_TITLE));
    // The user types the command at that prompt; the next reading sees it running. Its title is the prompt's still.
    vi.setSystemTime(12_000);
    typeLine(PING);
    vi.setSystemTime(13_100);
    act(() => publish!({ panelId: PANEL, command: PING, observedAt: 13_000 }));

    expect(peekProgramTitle(PANEL), 'the prompt’s own title was named as the command’s').toBeUndefined();
  });

  it('control: a program titling itself AFTER the command line was entered keeps its title', async () => {
    mountTerminal(container);
    const reading = Date.now();
    vi.setSystemTime(10_050);
    act(() => publish!({ panelId: PANEL, command: null, observedAt: reading }));
    await answer({ status: 'running', sessionId: 1 });
    vi.setSystemTime(10_300);
    act(() => setTerminalTitle(PANEL, PROMPT_TITLE));
    vi.setSystemTime(12_000);
    typeLine('node titler.js');
    // The program starts and titles itself before the daemon's next reading sees it.
    vi.setSystemTime(12_200);
    act(() => setTerminalTitle(PANEL, 'writing the tests'));
    vi.setSystemTime(13_100);
    act(() => publish!({ panelId: PANEL, command: 'node titler.js', observedAt: 13_000 }));

    expect(peekProgramTitle(PANEL)).toBe('writing the tests');
  });
});
