import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { IShellIntegration } from '@throng/core';
import { windowOpenDecision, denyRendererWindows } from '../../src/main/window-open-guard.js';

/**
 * US7 / FR-019b (spec 024): a renderer-opened window is always denied; only an http(s)/mailto target
 * is handed to the OS opener. The window is NEVER opened in-app.
 */
describe('windowOpenDecision (024 US7)', () => {
  it('routes http and https targets to the OS opener', () => {
    expect(windowOpenDecision('https://example.com').openExternal).toBe(true);
    expect(windowOpenDecision('http://example.com').openExternal).toBe(true);
  });

  it('does not open non-http(s) targets externally (nor in-app — the caller always denies)', () => {
    for (const bad of ['javascript:alert(1)', 'file:///c/x', 'data:text/html,x', 'about:blank', '', 42]) {
      expect(windowOpenDecision(bad as unknown).openExternal).toBe(false);
    }
  });
});

/**
 * `denyRendererWindows` takes its OS opener by INJECTION (044 FR-091 / R10), not from Electron's
 * `shell` module directly — the point of the seam is that nothing in this file touches Electron.
 * A minimal structural fake stands in for the `WebContents` it installs the handler on: only
 * `setWindowOpenHandler` is exercised, so nothing else needs to exist on the fake.
 */
function fakeWebContents(): {
  contents: Parameters<typeof denyRendererWindows>[0];
  fire(url: string): { action: string };
} {
  let handler: ((details: { url: string }) => { action: 'deny' }) | undefined;
  const contents = {
    setWindowOpenHandler: (h: typeof handler) => {
      handler = h;
    },
  } as unknown as Parameters<typeof denyRendererWindows>[0];
  return {
    contents,
    fire: (url: string) => {
      if (!handler) throw new Error('setWindowOpenHandler was never called');
      return handler({ url });
    },
  };
}

function fakeShellIntegration(): { shell: IShellIntegration; opened: string[] } {
  const opened: string[] = [];
  const shell: IShellIntegration = {
    revealInFileManager: async () => {},
    openFolder: async () => {},
    openExternal: async (url: string) => {
      opened.push(url);
    },
  };
  return { shell, opened };
}

describe('denyRendererWindows (024 US7 / 044 FR-091)', () => {
  it('always denies the new window', () => {
    const { contents, fire } = fakeWebContents();
    const { shell } = fakeShellIntegration();
    denyRendererWindows(contents, shell);
    expect(fire('https://example.com')).toEqual({ action: 'deny' });
  });

  it('routes a safe target through the INJECTED IShellIntegration, never Electron directly', () => {
    const { contents, fire } = fakeWebContents();
    const { shell, opened } = fakeShellIntegration();
    denyRendererWindows(contents, shell);
    fire('https://example.com');
    expect(opened).toEqual(['https://example.com']);
  });

  /*
   * Adversarial review ruling: `mailto:` is a PREVIEW link's scheme (044 FR-091), opened only through the
   * preview's own channel. `window.open` is the terminal's route (024 FR-019b), and 024 FR-019 forbids a
   * terminal opening `mailto:` — so the guard opens http(s) only, and still denies the window.
   */
  it('does not open a mailto: target from window.open (024 FR-019), and still denies the window', () => {
    const { contents, fire } = fakeWebContents();
    const { shell, opened } = fakeShellIntegration();
    denyRendererWindows(contents, shell);
    expect(fire('mailto:a@b.com')).toEqual({ action: 'deny' });
    expect(opened).toEqual([]);
  });

  it('does not open a non-http(s) target, and still denies the window', () => {
    const { contents, fire } = fakeWebContents();
    const { shell, opened } = fakeShellIntegration();
    denyRendererWindows(contents, shell);
    expect(fire('javascript:alert(1)')).toEqual({ action: 'deny' });
    expect(opened).toEqual([]);
  });
});

/**
 * The guard only protects a window it is installed on. `main.ts` runs the whole application at import and
 * cannot be loaded here, so this is a source guard (as `preferences-window-query.test.ts` does): the MAIN
 * window — the one whose renderer a terminal link lives in — gets `denyRendererWindows`. Moved down from
 * terminal-links.e2e.ts, which called `window.open` from the renderer to learn the same thing.
 */
describe('the main window installs the guard (024 US7)', () => {
  it('createMainWindow calls denyRendererWindows on its own webContents', () => {
    const source = readFileSync(fileURLToPath(new URL('../../src/main/main.ts', import.meta.url)), 'utf8');
    const start = source.indexOf('async function createMainWindow(');
    const end = source.indexOf('\nfunction ', start);
    expect(start, 'createMainWindow exists').toBeGreaterThan(-1);
    expect(source.slice(start, end), 'the main window denies renderer-opened windows').toMatch(
      /denyRendererWindows\(window\.webContents,\s*shellIntegration\)/,
    );
  });
});
