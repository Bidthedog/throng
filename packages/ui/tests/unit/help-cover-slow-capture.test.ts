/**
 * 080 FR-063, FR-070 — a link followed in the Help window asks first, in a dialog drawn over the whole window. The
 * guide is a view drawn over the window's own page, so the guide must be hidden while the dialog is up, or the dialog
 * sits under it where nobody can see it. The still that stands in for the guide comes from `capturePage`, which can
 * take longer than the prompt waits (a busy machine; a CI runner, where help-window.e2e.ts then failed to find the
 * still), or never settle (Windows, for a window it has not painted).
 *
 * Layer: unit — the real Help window module and link prompt over a mocked Electron, with fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  capture: (): Promise<{ toPNG: () => Buffer; isEmpty: () => boolean }> => new Promise(() => undefined),
  visible: [] as boolean[],
  sentToHelp: [] as [string, unknown][],
}));

vi.mock('electron', () => {
  class FakeContents {
    navigationHistory = { canGoBack: () => false, canGoForward: () => false, goBack: () => undefined, goForward: () => undefined };
    isDestroyed = () => false;
    on = () => undefined;
    once = () => undefined;
    removeListener = () => undefined;
    setWindowOpenHandler = () => undefined;
    loadURL = () => Promise.resolve();
    getTitle = () => 'Guide';
    getURL = () => 'throng-help://app/guide/';
    focus = () => undefined;
    capturePage = () => state.capture();
    send = (channel: string, payload: unknown) => state.sentToHelp.push([channel, payload]);
  }
  class WebContentsView {
    webContents = new FakeContents();
    setBounds = () => undefined;
    setVisible = (v: boolean) => state.visible.push(v);
  }
  class BrowserWindow {
    static getFocusedWindow = () => null;
    static getAllWindows = () => [];
    webContents = new FakeContents();
    contentView = { addChildView: () => undefined };
    isDestroyed = () => false;
    // The module keeps its one Help window, so a later test reopens it: shown and raised again.
    isMinimized = () => false;
    restore = () => undefined;
    show = () => undefined;
    moveTop = () => undefined;
    focus = () => undefined;
    getContentSize = () => [1100, 820];
    getNormalBounds = () => ({ x: 0, y: 0, width: 1100, height: 820 });
    on = () => undefined;
    once = () => undefined;
    removeListener = () => undefined;
    loadFile = () => Promise.resolve();
  }
  const fakeSession = {
    protocol: { handle: () => undefined },
    webRequest: { onBeforeRequest: () => undefined },
    setPermissionRequestHandler: () => undefined,
  };
  return {
    BrowserWindow,
    WebContentsView,
    ipcMain: { on: () => undefined, handle: () => undefined },
    screen: { getAllDisplays: () => [] },
    session: { fromPartition: () => fakeSession },
  };
});
vi.mock('../../src/main/app-icon.js', () => ({ appIcon: () => undefined }));
vi.mock('../../src/main/help-protocol.js', () => ({ HELP_SCHEME: 'throng-help', createHelpProtocolHandler: () => () => undefined }));
vi.mock('../../src/main/renderer-request-filter.js', () => ({ exemptFromNavigationGuard: () => undefined }));
vi.mock('../../src/main/reveal-when-painted.js', () => ({ revealWhenPainted: () => undefined }));
vi.mock('../../src/main/window-controls-ipc.js', () => ({ wireWindowMaximizeEvents: () => undefined }));
vi.mock('../../src/main/window-open-guard.js', () => ({ denyRendererWindows: () => undefined }));
vi.mock('../../src/main/window-placement.js', () => ({ placeOverParent: () => ({}) }));
vi.mock('../../src/main/resource-monitor-window.js', () => ({ visibleBounds: () => null }));

import { coverHelpGuide, openHelpWindow } from '../../src/main/help-window.js';
import { LINK_PROMPT_COVER_MS, askToOpenLink } from '../../src/main/link-prompt.js';

const png = { toPNG: () => Buffer.from([1, 2, 3]), isEmpty: () => false };

function openHelp() {
  const win = openHelpWindow({
    indexHtml: 'index.html',
    preloadPath: 'preload.js',
    bundleRoot: '/guide',
    log: () => undefined,
    shellIntegration: { openExternal: () => Promise.resolve() },
  } as never);
  const asked: unknown[] = [];
  const realSend = win.webContents.send;
  win.webContents.send = (channel: string, payload: unknown) => {
    if (channel === 'throng:linkPrompt:ask') asked.push({ guideHiddenWhenAsked: state.visible.at(-1) === false });
    realSend(channel, payload);
  };
  const deps = { getMainWindow: () => win, openPreferences: () => undefined, cover: coverHelpGuide };
  return { win, asked, follow: () => void askToOpenLink(deps as never, 'https://github.com/'), };
}

/** The stills the page was sent, and the plain covers (an empty image: covered, no still yet). */
const covers = (): unknown[] => state.sentToHelp.filter(([c, p]) => c === 'throng:help:cover' && p instanceof Uint8Array && p.length > 0);
const plainCovers = (): unknown[] => state.sentToHelp.filter(([c, p]) => c === 'throng:help:cover' && p instanceof Uint8Array && p.length === 0);

describe('the Help window hides its guide while a link prompt is up (FR-070)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.visible.length = 0;
    state.sentToHelp.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('with a capture slower than the prompt waits: the guide is hidden when the prompt asks, and the still lands late', async () => {
    let land: (still: typeof png) => void = () => undefined;
    state.capture = () => new Promise((r) => (land = r));
    const { asked, follow } = openHelp();
    follow();
    await vi.advanceTimersByTimeAsync(LINK_PROMPT_COVER_MS + 1);
    expect(asked, 'the prompt asked, and the guide was hidden at that moment').toEqual([{ guideHiddenWhenAsked: true }]);
    expect(plainCovers(), 'the page covers the guide plainly meanwhile').toHaveLength(1);
    land(png);
    await vi.advanceTimersByTimeAsync(0);
    expect(covers(), 'the still arrives once the capture settles').toHaveLength(1);
  });

  it('with a capture that never settles: the guide is still hidden when the prompt asks', async () => {
    state.capture = () => new Promise(() => undefined);
    const { asked, follow } = openHelp();
    follow();
    await vi.advanceTimersByTimeAsync(LINK_PROMPT_COVER_MS + 1);
    expect(asked).toEqual([{ guideHiddenWhenAsked: true }]);
    expect(plainCovers(), 'the page covers the guide plainly').toHaveLength(1);
  });

  it('with a quick capture: the still is drawn and the guide hidden before the prompt asks', async () => {
    state.capture = () => Promise.resolve(png);
    const { asked, follow } = openHelp();
    follow();
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual([{ guideHiddenWhenAsked: true }]);
    expect(covers()).toHaveLength(1);
    expect(plainCovers()).toHaveLength(0);
  });

  it('with a capture that fails: the guide is hidden and covered plainly', async () => {
    state.capture = () => Promise.reject(new Error('capture failed'));
    const { asked, follow } = openHelp();
    follow();
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual([{ guideHiddenWhenAsked: true }]);
    expect(plainCovers()).toHaveLength(1);
  });
});
