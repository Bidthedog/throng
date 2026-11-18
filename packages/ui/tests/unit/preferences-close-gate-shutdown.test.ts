import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PREFERENCES_CLOSE_REQUEST_CHANNEL,
  releasePreferencesForShutdown,
  resetPreferencesShutdownForTest,
  wireCloseGate,
} from '../../src/main/preferences-window.js';

/**
 * A quit with Preferences open must finish (070 FR-028, 032 FR-018, #86).
 *
 * On macOS the shutdown ends with `app.quit()`, which closes every window and is ABORTED by any
 * window whose `close` is prevented. The Preferences close gate prevents the first close to ask its
 * renderer (FR-018), so a Cmd+Q with Preferences open drained the edit and then never quit. On
 * Windows and Linux the main window's close destroys its parented Preferences natively, so the gate
 * never ran. Once the shutdown has drained (the drain already committed a valid JSON buffer, 032
 * FR-020) there is nothing left for the gate to ask, so it stands aside.
 *
 * Layer: unit — the gate's veto is a decision on one window's `close` event; a fake window shows it.
 */

interface FakeWindow {
  win: BrowserWindow;
  sent: string[];
  /** Fire `close` as Electron does; true when no listener prevented it. */
  close: () => boolean;
}

function fakeWindow(): FakeWindow {
  const emitter = new EventEmitter();
  const sent: string[] = [];
  let destroyed = false;
  const close = (): boolean => {
    let prevented = false;
    emitter.emit('close', { preventDefault: () => (prevented = true) });
    if (!prevented) destroyed = true;
    return !prevented;
  };
  const win = Object.assign(emitter, {
    isDestroyed: () => destroyed,
    close,
    webContents: {
      isDestroyed: () => destroyed,
      send: (channel: string) => sent.push(channel),
      ipc: { on: vi.fn(), off: vi.fn() },
    },
  }) as unknown as BrowserWindow;
  return { win, sent, close };
}

afterEach(() => resetPreferencesShutdownForTest());

describe('the Preferences close gate and the shutdown', () => {
  it('asks the renderer before an ordinary close (FR-018 — the control)', () => {
    vi.useFakeTimers();
    try {
      const w = fakeWindow();
      wireCloseGate(w.win);
      expect(w.close(), 'an ordinary close is held for the answer').toBe(false);
      expect(w.sent).toEqual([PREFERENCES_CLOSE_REQUEST_CHANNEL]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not veto the close once the shutdown has drained, so a quit can finish', () => {
    const w = fakeWindow();
    wireCloseGate(w.win);
    releasePreferencesForShutdown();
    expect(w.close(), 'a vetoed close aborts app.quit() on macOS').toBe(true);
    expect(w.sent, 'nothing is left to ask: the drain has already run').toEqual([]);
  });
});
