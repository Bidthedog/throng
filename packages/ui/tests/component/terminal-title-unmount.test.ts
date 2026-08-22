import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTerminalTitle,
  setTerminalTitle,
  useTerminalTitle,
} from '../../src/renderer/terminal/title-store.js';
import { useTerminal } from '../../src/renderer/terminal/use-terminal.js';

/**
 * REPRODUCTION for #295 — a terminal loses its live window title when its view unmounts.
 *
 * ══ WHY THIS FILE EXISTS WHEN `terminal-title-store.test.ts` ALREADY DOES ══
 *
 * That file asserts the STORE survives a remount, and it does — it is module-level, so it survives
 * by construction. What it remounts is a HEADER that subscribes to the store. The terminal view is
 * never mounted in it, so the one line that actually destroys the title
 * (`use-terminal.ts:1202`, in the attach effect's cleanup) is never run.
 *
 * That gap has a history worth recording. `terminal-title-persist.e2e.ts` DID unmount the real
 * terminal — it added a second tab to force it — and 035 T055 replaced that E2E with the store
 * test. The replacement covers the store's rules and not the view's lifecycle policy, which is
 * exactly the "a replacement covering PART of what the E2E asserted is not a replacement" trap.
 *
 * ══ AND WHY THE E2E WOULD NOT HAVE CAUGHT IT EITHER ══
 *
 * It drove `cmd`, which re-announces its title on every prompt, so a remount got a fresh
 * announcement and the header was repopulated within the assertion's window. The reported case is
 * a program that announces ONCE at startup (a named Claude session), which has no reason to say it
 * again — so nothing repopulates it and the header falls through to the flavour label.
 *
 * So this is the assertion neither layer had: the title is SESSION state, and unmounting a view of
 * a session must not destroy it. Its neighbour two lines up already gets this right —
 * `saveTerminalViewState` deliberately preserves scroll offset across the same unmount.
 */

const PANEL = 'p-term-1';
const TITLE = 'ISSUE MANAGEMENT';

/**
 * Every built-in flavour (`core/src/terminal/defaults.ts`), plus a user-defined one.
 *
 * The defect is flavour-independent — one `clearTerminalTitle` in one cleanup — but the way it
 * SHOWS is not, which is why it went unnoticed. `cmd` re-announces its title at every prompt, so a
 * remount repopulates the header almost immediately and the loss is invisible; a program that
 * announces once has nothing to repeat and the header stays wrong for the life of the session.
 * Asserting the invariant per flavour is what stops a future flavour-specific title path
 * reintroducing it for only some of them.
 */
const FLAVOURS = ['windows-powershell', 'pwsh', 'cmd', 'git-bash', 'my-custom-shell'] as const;

function noop(): void {
  /* nothing */
}

/** Exit listeners the mounted terminal registered, so a test can end the session for real. */
let exitListeners: ((e: { panelId: string; code?: number }) => void)[] = [];

/** A bridge that satisfies every call the attach effect makes, and does nothing. */
function fakeTerminalBridge() {
  return {
    attach: vi.fn(() => Promise.resolve({ ok: true as const })),
    detach: vi.fn(() => Promise.resolve()),
    write: vi.fn(() => Promise.resolve()),
    writeClipboard: vi.fn(() => Promise.resolve()),
    resize: vi.fn(() => Promise.resolve()),
    onOutput: vi.fn(() => noop),
    onGrid: vi.fn(() => noop),
    onExit: vi.fn((cb: (e: { panelId: string; code?: number }) => void) => {
      exitListeners.push(cb);
      return noop;
    }),
  };
}

/** The program ended — what the daemon reports over the bridge. */
function endSession(): void {
  act(() => {
    for (const cb of exitListeners) cb({ panelId: PANEL, code: 0 });
  });
}

function mountTerminal(container: HTMLElement, flavourId: string) {
  return renderHook(() =>
    useTerminal({
      panelId: PANEL,
      projectId: 'proj-1',
      projectRoot: 'C:/tmp/proj',
      flavourId,
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

let container: HTMLElement;

/**
 * jsdom implements no CSS media queries, and xterm asks for `devicePixelRatio` through
 * `matchMedia` on the very first render. Without this the mount throws before reaching anything
 * this test is about — a failure that looks like the bug and is not, which is the one outcome a
 * reproduction must never have.
 */
function shimMatchMedia(): void {
  if (typeof window.matchMedia === 'function') return;
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

/**
 * jsdom has no layout, so it ships no `ResizeObserver`. The terminal installs one to refit xterm
 * when its container changes size; with no layout there is nothing to observe, so a constructor
 * that records the callback and never fires is the honest stand-in.
 */
function shimResizeObserver(): void {
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'function') return;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe = noop;
    unobserve = noop;
    disconnect = noop;
  };
}

beforeEach(() => {
  shimMatchMedia();
  shimResizeObserver();
  exitListeners = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  (window as unknown as { throng?: unknown }).throng = { terminal: fakeTerminalBridge() };
});

afterEach(() => {
  clearTerminalTitle(PANEL);
  container.remove();
  Reflect.deleteProperty(window, 'throng');
});

describe.each(FLAVOURS)('a title the %s program announced once', (flavourId) => {
  it('SURVIVES the terminal view unmounting (#295)', () => {
    const { unmount } = mountTerminal(container, flavourId);

    // What `term.onTitleChange` does when the program announces (use-terminal.ts:418). Set
    // directly rather than driven through a real PTY: how the title ARRIVED is not what is under
    // test, and a program that announces once is precisely the case that cannot re-announce.
    setTerminalTitle(PANEL, TITLE);

    unmount(); // a tab switch, a project switch — anything that unmounts the view

    // The session is still running and still called this. Nothing has ended.
    expect(
      readTitle(),
      'the panel header falls back to the shell flavour and Reset Name cannot bring it back',
    ).toBe(TITLE);
  });

  it('is still dropped when the SESSION ends, so a recycled panel id inherits nothing', () => {
    /*
     * The other half of the fix, and the reason `clearTerminalTitle` cannot simply be deleted:
     * `terminal-title-store.test.ts` already guards that a NEW terminal in a recycled panel id
     * does not wear the dead one's title. Moving the call from "view unmounted" to "session ended"
     * has to keep that true, so it is asserted here rather than left to the other file to discover.
     */
    const { unmount } = mountTerminal(container, flavourId);
    setTerminalTitle(PANEL, TITLE);

    endSession();
    unmount();

    expect(readTitle(), 'a dead session must not leave its title behind').toBeUndefined();
  });
});

/** Read the store the way a header does — through the hook, not the Map behind it. */
function readTitle(): string | undefined {
  const probe = renderHook(() => useTerminalTitle(PANEL));
  const value = probe.result.current;
  probe.unmount();
  return value;
}
