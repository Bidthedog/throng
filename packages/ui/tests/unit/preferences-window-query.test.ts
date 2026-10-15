import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Preferences window's load query (056 FR-016, research R10).
 *
 * Layer: unit — a mocked `electron` and a source read; nothing here needs a real window.
 *
 * ══ WHAT IS PINNED ══
 *
 * The renderer folds Preferences sections by default and reads the test seam `foldDefault=open` from its own
 * URL. This file pins the two halves of how that parameter gets there:
 *
 *   1. `openPreferences` loads `{ prefs: <tab> }` ALONE unless the deps carry a `query`, which is merged in.
 *   2. `main.ts` is the only place that reads `THRONG_PREFS_SECTIONS_OPEN` (Principle X), inside
 *      `rendererQuery()` beside the autosave seam, and hands the result to the Preferences deps only.
 *
 * Half 1 is behavioural, through a mocked `electron`. Half 2 is a source guard, because `main.ts` runs the
 * whole application at import and cannot be loaded in a unit test — the same reasoning as
 * `window-parent-tdz.test.ts`.
 */

const loadFile = vi.hoisted(() => vi.fn());

vi.mock('electron', () => {
  class FakeWindow {
    webContents = { ipc: { on: vi.fn(), off: vi.fn() }, send: vi.fn(), isDestroyed: () => false };
    loadFile = loadFile;
    on = vi.fn();
    isDestroyed = (): boolean => false;
    setAlwaysOnTop = vi.fn();
    isAlwaysOnTop = (): boolean => false;
    static getAllWindows = (): FakeWindow[] => [];
    static getFocusedWindow = (): null => null;
  }
  return { app: { on: vi.fn(), off: vi.fn() }, BrowserWindow: FakeWindow };
});
vi.mock('../../src/main/window-controls-ipc.js', () => ({ wireWindowMaximizeEvents: vi.fn() }));
vi.mock('../../src/main/window-open-guard.js', () => ({ denyRendererWindows: vi.fn() }));
vi.mock('../../src/main/app-icon.js', () => ({ appIcon: () => undefined }));
vi.mock('../../src/main/reveal-when-painted.js', () => ({ revealWhenPainted: vi.fn() }));
vi.mock('../../src/main/window-placement.js', () => ({ placeOverParent: () => ({}) }));

type Deps = import('../../src/main/preferences-window.js').PreferencesWindowDeps;

const baseDeps = (extra: Partial<Deps> = {}): Deps => ({
  indexHtml: '/renderer/index.html',
  preloadPath: '/preload.cjs',
  shellIntegration: {} as Deps['shellIntegration'],
  ...extra,
});

beforeEach(() => {
  loadFile.mockClear();
  // The module keeps the one open window in a variable; a fresh import is a fresh "no window open".
  vi.resetModules();
});

describe('the Preferences window load query', () => {
  it('is { prefs: <tab> } alone when the deps carry no query', async () => {
    const { openPreferences } = await import('../../src/main/preferences-window.js');
    openPreferences('themes', baseDeps());
    expect(loadFile).toHaveBeenCalledWith('/renderer/index.html', { query: { prefs: 'themes' } });
  });

  it('is { prefs: <tab> } alone when the renderer query is empty', async () => {
    const { openPreferences } = await import('../../src/main/preferences-window.js');
    openPreferences('settings', baseDeps({ query: {} }));
    expect(loadFile).toHaveBeenCalledWith('/renderer/index.html', { query: { prefs: 'settings' } });
  });

  it("carries foldDefault: 'open' when the deps' renderer query says so", async () => {
    const { openPreferences } = await import('../../src/main/preferences-window.js');
    openPreferences('keybindings', baseDeps({ query: { foldDefault: 'open' } }));
    expect(loadFile).toHaveBeenCalledWith('/renderer/index.html', {
      query: { prefs: 'keybindings', foldDefault: 'open' },
    });
  });

  it('never lets the renderer query replace the tab', async () => {
    const { openPreferences } = await import('../../src/main/preferences-window.js');
    openPreferences('themes', baseDeps({ query: { prefs: 'settings', foldDefault: 'open' } }));
    const [, options] = loadFile.mock.calls[0] as [string, { query: Record<string, string> }];
    expect(options.query.prefs).toBe('themes');
  });
});

describe('main.ts is the one reader of THRONG_PREFS_SECTIONS_OPEN (Principle X)', () => {
  const MAIN = readFileSync(fileURLToPath(new URL('../../src/main/main.ts', import.meta.url)), 'utf8');

  /** A function's body, from its signature to the closing brace. */
  const bodyOf = (name: string): string => {
    const start = MAIN.indexOf(`function ${name}`);
    expect(start, `${name} has been renamed — update this guard`).toBeGreaterThan(-1);
    return MAIN.slice(start, MAIN.indexOf('\n}', start));
  };

  it('reads the variable once, inside prefsQuery', () => {
    expect(bodyOf('prefsQuery')).toMatch(/process\.env\.THRONG_PREFS_SECTIONS_OPEN/);
    expect([...MAIN.matchAll(/process\.env\.THRONG_PREFS_SECTIONS_OPEN/g)]).toHaveLength(1);
  });

  it("adds foldDefault: 'open' only when the value is '1'", () => {
    expect(bodyOf('prefsQuery')).toMatch(/THRONG_PREFS_SECTIONS_OPEN\s*===\s*'1'/);
    expect(bodyOf('prefsQuery')).toMatch(/foldDefault\s*:\s*'open'/);
  });

  it('keeps foldDefault out of the query every other window receives', () => {
    // `rendererQuery()` feeds the main window and the sub-workspaces; the seam is the Preferences window's alone.
    expect(bodyOf('rendererQuery')).not.toMatch(/foldDefault|THRONG_PREFS_SECTIONS_OPEN/);
    // …and nothing outside prefsQuery names the parameter in code that builds a query.
    const outside = MAIN.replace(bodyOf('prefsQuery'), '');
    expect(outside).not.toMatch(/foldDefault\s*:/);
  });

  it('hands the query to the Preferences deps and not to the About deps', () => {
    const prefs = MAIN.slice(MAIN.indexOf('const preferencesDeps'));
    expect(prefs.slice(0, prefs.indexOf('};'))).toMatch(/query\s*:\s*prefsQuery\(\)/);
    const about = MAIN.slice(MAIN.indexOf('const aboutDeps'));
    expect(about.slice(0, about.indexOf('};'))).not.toMatch(/query/);
  });
});
