/**
 * 080 FR-070 — the external-link prompt is asked of the window the link was followed in. A caller that knows that
 * window (the Help window, whose links leave from its guide view) names it, and it wins over whichever window has
 * focus; with none named, the focused window, else the main window.
 *
 * Layer: unit — `askToOpenLink` over a mocked Electron: which window's contents it sends the request to.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const focused = { current: null as unknown };

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => focused.current },
}));

import { askToOpenLink, openFromWindow } from '../../src/main/link-prompt.js';

function fakeWindow(name: string) {
  const sent: unknown[] = [];
  const contents = {
    isDestroyed: () => false,
    send: (channel: string, request: unknown) => sent.push([channel, request]),
    once: () => undefined,
    removeListener: () => undefined,
  };
  return { name, sent, webContents: contents, isDestroyed: () => false, once: () => undefined, removeListener: () => undefined };
}

describe('which window the link prompt asks (FR-070)', () => {
  let main: ReturnType<typeof fakeWindow>;
  let help: ReturnType<typeof fakeWindow>;
  beforeEach(() => {
    main = fakeWindow('main');
    help = fakeWindow('help');
    focused.current = null;
  });
  const deps = () => ({ getMainWindow: () => main as never, openPreferences: () => undefined });

  it('asks the window the link was followed in, even when another window has focus', () => {
    focused.current = main;
    void openFromWindow(help as never, () => askToOpenLink(deps(), 'https://example.test/'));
    return Promise.resolve().then(() => {
      expect(help.sent).toHaveLength(1);
      expect(main.sent).toHaveLength(0);
    });
  });

  it('asks the focused window when no window is named', async () => {
    focused.current = help;
    void askToOpenLink(deps(), 'https://example.test/');
    await Promise.resolve();
    expect(help.sent).toHaveLength(1);
  });

  it('falls back to the main window when nothing has focus', async () => {
    void askToOpenLink(deps(), 'https://example.test/');
    await Promise.resolve();
    expect(main.sent).toEqual([['throng:linkPrompt:ask', { id: expect.any(Number), url: 'https://example.test/' }]]);
  });

  it('forgets the named window once the call returns', async () => {
    focused.current = main;
    openFromWindow(help as never, () => undefined);
    void askToOpenLink(deps(), 'https://example.test/');
    await Promise.resolve();
    expect(main.sent).toHaveLength(1);
    expect(help.sent).toHaveLength(0);
  });
});
