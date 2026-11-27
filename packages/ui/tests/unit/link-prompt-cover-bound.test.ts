/**
 * 080 FR-063, FR-070 — the Help window covers its guide with a still before the link prompt shows, and the still
 * comes from `capturePage`, which need not settle: Windows can leave it pending for a window it has not painted. The
 * prompt waits for the cover only so long, then asks without it, and a cover that lands after that is undone at once.
 *
 * Layer: unit — `askToOpenLink` over a mocked Electron and fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => null },
}));

import { LINK_PROMPT_COVER_MS, askToOpenLink } from '../../src/main/link-prompt.js';

function fakeWindow() {
  const sent: unknown[] = [];
  const contents = {
    isDestroyed: () => false,
    send: (channel: string, request: unknown) => sent.push([channel, request]),
    once: () => undefined,
    removeListener: () => undefined,
  };
  return { sent, webContents: contents, isDestroyed: () => false, once: () => undefined, removeListener: () => undefined };
}

describe('a cover that does not settle never holds the link prompt back (FR-063)', () => {
  let win: ReturnType<typeof fakeWindow>;
  beforeEach(() => {
    vi.useFakeTimers();
    win = fakeWindow();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks once the bound passes, though the cover is still pending', async () => {
    const deps = { getMainWindow: () => win as never, openPreferences: () => undefined, cover: () => new Promise<() => void>(() => undefined) };
    void askToOpenLink(deps, 'https://example.test/');
    await vi.advanceTimersByTimeAsync(LINK_PROMPT_COVER_MS - 1);
    expect(win.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(win.sent).toEqual([['throng:linkPrompt:ask', { id: expect.any(Number), url: 'https://example.test/' }]]);
  });

  it('asks as soon as the cover lands, without waiting out the bound', async () => {
    const deps = { getMainWindow: () => win as never, openPreferences: () => undefined, cover: () => Promise.resolve(() => undefined) };
    void askToOpenLink(deps, 'https://example.test/');
    await vi.advanceTimersByTimeAsync(0);
    expect(win.sent).toHaveLength(1);
  });

  it('undoes a cover that lands after the prompt went ahead without it', async () => {
    let land: (undo: () => void) => void = () => undefined;
    const undo = vi.fn();
    const deps = { getMainWindow: () => win as never, openPreferences: () => undefined, cover: () => new Promise<() => void>((r) => (land = r)) };
    void askToOpenLink(deps, 'https://example.test/');
    await vi.advanceTimersByTimeAsync(LINK_PROMPT_COVER_MS);
    expect(win.sent).toHaveLength(1);
    land(undo);
    await vi.advanceTimersByTimeAsync(0);
    expect(undo).toHaveBeenCalledTimes(1);
  });
});
