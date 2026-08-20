import { describe, expect, it, vi } from 'vitest';
import type { WindowBounds } from '@throng/core';
import {
  openSubWorkspace,
  type OpenSubWorkspaceDeps,
  type OpenableWindow,
} from '../../src/main/subworkspace-open.js';

/**
 * Opening a sub-workspace window (#287, 003 FR-017a).
 *
 * ══ THE DEFECT THIS FILE EXISTS FOR ══
 *
 * The open path was a handler body — `ipcMain.on(…, () => { void (async () => { … })(); })` — with
 * exactly one `try` in it, around the bounds lookup. Anything else that threw became an unhandled
 * rejection: **no window, no error, no notice.** The user pressed Open, nothing happened, and
 * pressing it again did the same thing.
 *
 * That shape also meant nothing below E2E could ask what happens when a sub-workspace is opened, so
 * the silence had never been tested for. It was found by reading the path while investigating #286,
 * not by a test — which is the point.
 *
 * ══ WHY A FAILURE MUST BE A VALUE AND NOT AN EXCEPTION ══
 *
 * The caller is an IPC handler. An exception thrown at it goes nowhere a user can see, so "throws on
 * failure" would reproduce the original defect with better manners. Every outcome is returned, and
 * the three are distinguished because they mean different things to the caller: `opened` creates a
 * window and fires Electron's `window` event, `focused` deliberately does not, and `failed` needs a
 * notice.
 */

/** A window that behaves; the tests below make it misbehave where that is the subject. */
function fakeWindow(over: Partial<OpenableWindow> = {}): OpenableWindow {
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    focus: vi.fn(),
    ...over,
  };
}

const BOUNDS: WindowBounds = { x: 10, y: 20, width: 800, height: 600 };

/** Deps whose every step succeeds, so a test only has to say which one it is breaking. */
function deps(
  over: Partial<OpenSubWorkspaceDeps<OpenableWindow>> = {},
): OpenSubWorkspaceDeps<OpenableWindow> & { created: OpenableWindow } {
  const created = fakeWindow();
  return {
    created,
    getChild: () => undefined,
    loadBounds: () => Promise.resolve(BOUNDS),
    createWindow: () => created,
    registerChild: vi.fn(),
    watchBounds: vi.fn(),
    ...over,
  };
}

describe('the happy path', () => {
  it('creates the window, registers it, and watches its bounds', async () => {
    const d = deps();
    const outcome = await openSubWorkspace('sw1', d);

    expect(outcome).toEqual({ kind: 'opened' });
    expect(d.registerChild).toHaveBeenCalledWith('sw1', d.created);
    expect(d.watchBounds).toHaveBeenCalledWith('sw1', d.created);
  });

  it('opens at the persisted bounds when there are some', async () => {
    const createWindow = vi.fn(() => fakeWindow());
    await openSubWorkspace('sw1', deps({ createWindow }));

    expect(createWindow).toHaveBeenCalledWith('sw1', BOUNDS);
  });

  it('opens at the default size when there are none', async () => {
    const createWindow = vi.fn(() => fakeWindow());
    await openSubWorkspace('sw1', deps({ createWindow, loadBounds: () => Promise.resolve(undefined) }));

    expect(createWindow).toHaveBeenCalledWith('sw1', undefined);
  });
});

describe('a window that is already open is RAISED, not duplicated', () => {
  it('focuses it and reports `focused`, creating nothing', async () => {
    /*
     * Reported as its own outcome rather than as success, because the caller cannot tell them apart
     * otherwise — and `opened` is the only one of the two that fires Electron's `window` event.
     */
    const existing = fakeWindow();
    const createWindow = vi.fn(() => fakeWindow());
    const outcome = await openSubWorkspace('sw1', deps({ getChild: () => existing, createWindow }));

    expect(outcome).toEqual({ kind: 'focused' });
    expect(existing.focus).toHaveBeenCalled();
    expect(createWindow).not.toHaveBeenCalled();
  });

  it('restores it first when it is minimised', async () => {
    const existing = fakeWindow({ isMinimized: () => true });
    await openSubWorkspace('sw1', deps({ getChild: () => existing }));

    expect(existing.restore).toHaveBeenCalled();
    expect(existing.focus).toHaveBeenCalled();
  });

  it('treats a DESTROYED registry entry as absent and opens a fresh window', async () => {
    /*
     * The stale-registry branch, decided deliberately rather than left to chance (#287). A window
     * that has been destroyed is not a window to focus — focusing it would leave the user with
     * nothing and no explanation, which is this issue's whole subject.
     */
    const dead = fakeWindow({ isDestroyed: () => true });
    const createWindow = vi.fn(() => fakeWindow());
    const outcome = await openSubWorkspace('sw1', deps({ getChild: () => dead, createWindow }));

    expect(outcome).toEqual({ kind: 'opened' });
    expect(createWindow).toHaveBeenCalled();
    expect(dead.focus).not.toHaveBeenCalled();
  });
});

describe('bounds are best-effort and never cost the user their window (FR-017a)', () => {
  it('opens at the default size when the bounds lookup REJECTS', async () => {
    /*
     * A daemon that cannot answer should cost the user their window POSITION, not their window.
     * Letting this reject the whole open would turn a cosmetic gap into an inert button.
     */
    const createWindow = vi.fn(() => fakeWindow());
    const outcome = await openSubWorkspace(
      'sw1',
      deps({ createWindow, loadBounds: () => Promise.reject(new Error('daemon unreachable')) }),
    );

    expect(outcome).toEqual({ kind: 'opened' });
    expect(createWindow).toHaveBeenCalledWith('sw1', undefined);
  });
});

describe('a failure is REPORTED, never swallowed (#287)', () => {
  it('reports `failed` when the window cannot be created', async () => {
    /*
     * THE DEFECT. Before this module existed, a throw here was an unhandled rejection inside a
     * floating promise: no window, no error, no notice, and a button that appeared inert.
     */
    const outcome = await openSubWorkspace(
      'sw1',
      deps({
        createWindow: () => {
          throw new Error('BrowserWindow construction failed');
        },
      }),
    );

    expect(outcome.kind).toBe('failed');
    expect((outcome as { reason: string }).reason).toContain('BrowserWindow construction failed');
  });

  it('reports `failed` when the window cannot be REGISTERED', async () => {
    // A throw after the window exists is the nastier one — a window may be on screen while the app
    // believes none is, so the next open would duplicate it.
    const outcome = await openSubWorkspace(
      'sw1',
      deps({
        registerChild: () => {
          throw new Error('registry rejected the id');
        },
      }),
    );

    expect(outcome.kind).toBe('failed');
    expect((outcome as { reason: string }).reason).toContain('registry rejected the id');
  });

  it('reports `failed` when bounds-watching cannot be set up', async () => {
    const outcome = await openSubWorkspace(
      'sw1',
      deps({
        watchBounds: () => {
          throw new Error('listener attach failed');
        },
      }),
    );

    expect(outcome.kind).toBe('failed');
  });

  it('never throws — the caller is an IPC handler with nowhere to put an exception', async () => {
    await expect(
      openSubWorkspace(
        'sw1',
        deps({
          createWindow: () => {
            throw new Error('boom');
          },
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('reports `failed` rather than a raw errno when the failure is not an Error at all', async () => {
    // Anything can be thrown in JavaScript, and `String(undefined)` in a notice is its own bug.
    const outcome = await openSubWorkspace(
      'sw1',
      deps({
        createWindow: () => {
          throw 'a bare string';
        },
      }),
    );

    expect(outcome.kind).toBe('failed');
    expect((outcome as { reason: string }).reason.length).toBeGreaterThan(0);
  });
});
