import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, SHIPPED_PREVIEW_PROVIDERS, type AppSettings } from '@throng/core';
import {
  guardNavigation,
  installNavigationGuards,
  installRendererRequestFilter,
  type RequestFilterSession,
  type NavigationGuardApp,
  type NavigationGuardTarget,
} from '../../src/main/renderer-request-filter.js';

/**
 * T049 — the main-process request filter and the navigation guard (044 FR-092, FR-093;
 * contracts/security-policy.md Layer 4 and "Navigation guard").
 *
 * The decision itself is pinned row by row in core (`renderer-request-policy.test.ts`). What this
 * file proves is the WIRING: which requests reach the decision at all, that the remote-images answer
 * is read from settings on every request rather than captured once, and that the guard is installed on
 * every window it is handed.
 */

type Details = {
  url: string;
  resourceType: string;
  webContents?: object;
  webContentsId?: number;
};
type Callback = (response: { cancel?: boolean }) => void;
type Listener = (details: Details, callback: Callback) => void;

function fakeSession(): {
  session: RequestFilterSession;
  filters: unknown[];
  send(d: Details): { cancel?: boolean };
} {
  let listener: Listener | undefined;
  const filters: unknown[] = [];
  const session = {
    webRequest: {
      onBeforeRequest: (filter: unknown, l: Listener) => {
        filters.push(filter);
        listener = l;
      },
    },
  } as unknown as RequestFilterSession;
  return {
    session,
    filters,
    send: (d) => {
      if (!listener) throw new Error('onBeforeRequest was never called');
      let answer: { cancel?: boolean } | undefined;
      listener(d, (r) => {
        answer = r;
      });
      if (!answer) throw new Error('the listener did not call back synchronously');
      return answer;
    },
  };
}

const RENDERER_DIR = 'D:/app/packages/ui/dist/renderer';
const renderer = { id: 7 };

function withRemoteImages(on: boolean): AppSettings {
  const previews = DEFAULT_APP_SETTINGS.editor.previews;
  return {
    ...DEFAULT_APP_SETTINGS,
    editor: {
      ...DEFAULT_APP_SETTINGS.editor,
      previews: {
        ...previews,
        providers: {
          ...previews.providers,
          markdown: { ...previews.providers.markdown, loadRemoteImages: on },
        },
      },
    },
  };
}

describe('installRendererRequestFilter (FR-092, FR-093)', () => {
  it('filters every URL on the session it is given', () => {
    const { session, filters } = fakeSession();
    installRendererRequestFilter(session, () => withRemoteImages(true), SHIPPED_PREVIEW_PROVIDERS, RENDERER_DIR);
    expect(filters).toEqual([{ urls: ['<all_urls>'] }]);
  });

  it('passes a request with no webContents untouched, whatever it is', () => {
    const { session, send } = fakeSession();
    installRendererRequestFilter(session, () => withRemoteImages(false), SHIPPED_PREVIEW_PROVIDERS, RENDERER_DIR);
    // The daemon, update checks and main's own `net` requests: none are a renderer's, none are filtered.
    expect(send({ url: 'http://example.com/update.json', resourceType: 'xhr' })).toEqual({});
    expect(send({ url: 'https://example.com/badge.svg', resourceType: 'image' })).toEqual({});
    expect(send({ url: 'file:///C:/Windows/win.ini', resourceType: 'other' })).toEqual({});
  });

  it("puts a renderer's request through the decision", () => {
    const { session, send } = fakeSession();
    installRendererRequestFilter(session, () => withRemoteImages(true), SHIPPED_PREVIEW_PROVIDERS, RENDERER_DIR);
    const from = { webContents: renderer, webContentsId: renderer.id };
    expect(send({ url: `file:///${RENDERER_DIR}/index.html`, resourceType: 'mainFrame', ...from })).toEqual({});
    expect(send({ url: 'file:///C:/Windows/win.ini', resourceType: 'image', ...from })).toEqual({ cancel: true });
    expect(send({ url: 'throng-preview://asset/p1/img.png', resourceType: 'image', ...from })).toEqual({});
    expect(send({ url: 'http://example.com/a.png', resourceType: 'image', ...from })).toEqual({ cancel: true });
    expect(send({ url: 'https://example.com/a.css', resourceType: 'stylesheet', ...from })).toEqual({
      cancel: true,
    });
  });

  it('reads remote images from settings LIVE, on every request', () => {
    const { session, send } = fakeSession();
    let current = withRemoteImages(true);
    installRendererRequestFilter(session, () => current, SHIPPED_PREVIEW_PROVIDERS, RENDERER_DIR);
    const badge = { url: 'https://example.com/badge.svg', resourceType: 'image', webContents: renderer };

    expect(send(badge)).toEqual({});
    current = withRemoteImages(false);
    expect(send(badge)).toEqual({ cancel: true });
    current = withRemoteImages(true);
    expect(send(badge)).toEqual({});
  });

  it("lets the drag ghost's data:text/html main-frame load through", () => {
    const { session, send } = fakeSession();
    installRendererRequestFilter(session, () => withRemoteImages(false), SHIPPED_PREVIEW_PROVIDERS, RENDERER_DIR);
    const ghost = { id: 12 };
    expect(
      send({
        url: 'data:text/html;charset=utf-8,%3C!doctype%20html%3E',
        resourceType: 'mainFrame',
        webContents: ghost,
        webContentsId: ghost.id,
      }),
    ).toEqual({});
  });

  it('treats a request that names a webContents id alone as a renderer request', () => {
    const { session, send } = fakeSession();
    installRendererRequestFilter(session, () => withRemoteImages(false), SHIPPED_PREVIEW_PROVIDERS, RENDERER_DIR);
    expect(send({ url: 'http://example.com/x.js', resourceType: 'script', webContentsId: 3 })).toEqual({
      cancel: true,
    });
  });
});

type NavEvent = { url: string; preventDefault(): void };

const RENDERER_URL = 'file:///D:/app/packages/ui/dist/renderer/index.html?sw=abc';

function fakeContents(
  currentUrl = RENDERER_URL,
  type = 'window',
): { contents: NavigationGuardTarget; navigate(url: string): { prevented: boolean } } {
  const handlers = new Map<string, Array<(event: NavEvent) => void>>();
  const contents = {
    on: (event: string, h: (event: NavEvent) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), h]);
      return contents;
    },
    getURL: () => currentUrl,
    getType: () => type,
  } as unknown as NavigationGuardTarget;
  return {
    contents,
    navigate: (url) => {
      let prevented = false;
      const event: NavEvent = {
        url,
        preventDefault: () => {
          prevented = true;
        },
      };
      for (const h of handlers.get('will-navigate') ?? []) h(event);
      return { prevented };
    },
  };
}

describe('guardNavigation', () => {
  it('prevents a navigation away from the document on every window it is given', () => {
    const windows = [fakeContents(), fakeContents(), fakeContents(), fakeContents()];
    for (const w of windows) guardNavigation(w.contents);
    for (const w of windows) expect(w.navigate('https://example.com/')).toEqual({ prevented: true });
  });

  it('leaves an unguarded window alone (the guard is per window, not global)', () => {
    const guarded = fakeContents();
    const unguarded = fakeContents();
    guardNavigation(guarded.contents);
    expect(unguarded.navigate('https://example.com/')).toEqual({ prevented: false });
    expect(guarded.navigate('https://example.com/')).toEqual({ prevented: true });
  });

  /*
   * Fix round 1: `location.reload()` raises `will-navigate` with the document's OWN URL. Refusing it
   * made the E2E harness's `reloadWindow` time out (40 call sites), and a product reload is not a
   * navigation away from anything.
   */
  it('lets a reload of the same document through', () => {
    const w = fakeContents();
    guardNavigation(w.contents);
    expect(w.navigate(RENDERER_URL)).toEqual({ prevented: false });
  });

  it('still prevents a different file: URL, including the same file with another query', () => {
    const w = fakeContents();
    guardNavigation(w.contents);
    expect(w.navigate('file:///C:/Windows/win.ini')).toEqual({ prevented: true });
    expect(w.navigate('file:///D:/app/packages/ui/dist/renderer/index.html?sw=other')).toEqual({
      prevented: true,
    });
    expect(w.navigate('https://example.com/')).toEqual({ prevented: true });
  });
});

describe('installNavigationGuards', () => {
  function fakeApp(): { app: NavigationGuardApp; create(contents: NavigationGuardTarget): void } {
    const listeners: Array<(event: unknown, contents: NavigationGuardTarget) => void> = [];
    const app = {
      on: (event: string, l: (event: unknown, contents: NavigationGuardTarget) => void) => {
        if (event === 'web-contents-created') listeners.push(l);
        return app;
      },
    } as unknown as NavigationGuardApp;
    return { app, create: (contents) => listeners.forEach((l) => l({}, contents)) };
  }

  it('guards every web contents created after it is installed', () => {
    const { app, create } = fakeApp();
    installNavigationGuards(app);
    const windows = [fakeContents(), fakeContents(RENDERER_URL, 'window'), fakeContents('data:text/html,x')];
    for (const w of windows) create(w.contents);
    for (const w of windows) expect(w.navigate('https://example.com/')).toEqual({ prevented: true });
  });

  it("leaves DevTools web contents (Electron's `remote` type) unguarded", () => {
    const { app, create } = fakeApp();
    installNavigationGuards(app);
    const devtools = fakeContents('devtools://devtools/bundled/inspector.html', 'remote');
    create(devtools.contents);
    expect(devtools.navigate('devtools://devtools/bundled/other.html')).toEqual({ prevented: false });
  });
});
