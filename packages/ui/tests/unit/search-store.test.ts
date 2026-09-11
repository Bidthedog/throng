/**
 * 013 — the find session store, driven against a FAKE controller (no CodeMirror, no
 * xterm, no DOM). Covers the routing the whole feature hangs on: the bar drives the
 * panel's engine, the count follows, closing clears and returns focus, and switching
 * panels never leaves a stray bar on the wrong one.
 *
 * ══ WHAT 043 CHANGED HERE, AND WHAT IT DID NOT ══
 *
 * Every 013 assertion below still stands. Two things moved, both required by 043 US1:
 *
 *   • Every action now takes the `panelId` it acts on (FR-003). A signature change, not a
 *     behaviour one — the same call still drives the same engine.
 *   • Leaving a panel HIDES its bar instead of closing its session (FR-002). The 013 case named
 *     "closes a bar left open on a panel that is no longer active" asserted the old behaviour
 *     directly; it is restated below as the hide it has become, with the restore that goes with it.
 *     That is the #220 defect, so the assertion changing IS the fix.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerPanelSearch,
  unregisterPanelSearch,
  type EditorSearchController,
  type TerminalSearchController,
} from '../../src/renderer/search/search-controller.js';
import {
  __resetFindState,
  closeFind,
  destroyPanelSearch,
  findNext,
  findPrevious,
  followActivePanel,
  getFindSession,
  getFindState,
  isFindShowingOn,
  openFind,
  replaceAll,
  replaceCurrent,
  setReplacement,
  setTerm,
  toggleMode,
} from '../../src/renderer/search/search-store.js';
import type { MatchModes, SearchCount } from '../../src/renderer/search/search-model.js';

/** A controller that records what the store asked of it. */
function fakeEditor(overrides: Partial<EditorSearchController> = {}): EditorSearchController {
  let current = 0;
  const total = 3;
  return {
    panelKind: 'editor',
    seedFromSelection: vi.fn(() => ''),
    setQuery: vi.fn((term: string, _modes: MatchModes): SearchCount =>
      term.length > 0 ? { current: 1, total } : { current: 0, total: 0 },
    ),
    findNext: vi.fn((): SearchCount => ({ current: (current = (current % total) + 1), total })),
    findPrevious: vi.fn((): SearchCount => ({ current: 1, total })),
    replaceCurrent: vi.fn((): SearchCount => ({ current: 1, total: total - 1 })),
    replaceAll: vi.fn((): SearchCount => ({ current: 0, total: 0 })),
    isReadOnly: vi.fn(() => false),
    close: vi.fn(),
    ...overrides,
  } as EditorSearchController;
}

function fakeTerminal(): TerminalSearchController {
  return {
    panelKind: 'terminal',
    seedFromSelection: vi.fn(() => ''),
    setQuery: vi.fn((): SearchCount => ({ current: 1, total: 2 })),
    findNext: vi.fn((): SearchCount => ({ current: 2, total: 2 })),
    findPrevious: vi.fn((): SearchCount => ({ current: 1, total: 2 })),
    close: vi.fn(),
    scrollLines: vi.fn(),
    scrollPages: vi.fn(),
    scrollToTop: vi.fn(),
    scrollToLiveBottom: vi.fn(),
    onCountChange: vi.fn(() => () => undefined),
  };
}

beforeEach(() => {
  __resetFindState();
  unregisterPanelSearch('p1');
  unregisterPanelSearch('p2');
});

describe('routing to the active panel (FR-001)', () => {
  it('drives the engine of the panel find was opened on', () => {
    const editor = fakeEditor();
    registerPanelSearch('p1', editor);

    openFind('p1', 'editor');
    setTerm('p1', 'needle');

    expect(editor.setQuery).toHaveBeenLastCalledWith('needle', {
      caseSensitive: false,
      wholeWord: false,
    });
    expect(getFindState().count).toEqual({ current: 1, total: 3 });
  });

  it('seeds the term from a single-line selection (FR-002b)', () => {
    registerPanelSearch('p1', fakeEditor({ seedFromSelection: () => 'selected' }));
    openFind('p1', 'editor');
    expect(getFindState().term).toBe('selected');
    expect(getFindState().seeded).toBe(true);
  });

  it('never reveals replace controls on a terminal (FR-002)', () => {
    registerPanelSearch('p1', fakeTerminal());
    openFind('p1', 'terminal', { replace: true });
    expect(getFindState().replaceShown).toBe(false);
  });
});

describe('stepping and toggles', () => {
  it('advances the current match and records the new count', () => {
    const editor = fakeEditor();
    registerPanelSearch('p1', editor);
    openFind('p1', 'editor');
    setTerm('p1', 'a');

    findNext('p1');
    expect(editor.findNext).toHaveBeenCalled();
    expect(getFindState().count.total).toBe(3);

    findPrevious('p1');
    expect(editor.findPrevious).toHaveBeenCalled();
  });

  it('re-runs the query when a match mode is toggled (FR-007)', () => {
    const editor = fakeEditor();
    registerPanelSearch('p1', editor);
    openFind('p1', 'editor');
    setTerm('p1', 'a');
    toggleMode('p1', 'caseSensitive');

    expect(getFindState().modes.caseSensitive).toBe(true);
    expect(editor.setQuery).toHaveBeenLastCalledWith('a', { caseSensitive: true, wholeWord: false });
  });

  it('shows the no-results state for a term that misses (FR-009)', () => {
    registerPanelSearch('p1', fakeEditor({ setQuery: () => ({ current: 0, total: 0 }) }));
    openFind('p1', 'editor');
    setTerm('p1', 'missing');
    expect(getFindState().count).toEqual({ current: 0, total: 0 });
  });
});

describe('replace (FR-008, read-only edge case)', () => {
  it('replaces the current match and the count follows', () => {
    const editor = fakeEditor();
    registerPanelSearch('p1', editor);
    openFind('p1', 'editor');
    setTerm('p1', 'a');
    setReplacement('p1', 'b');

    replaceCurrent('p1');
    expect(editor.replaceCurrent).toHaveBeenCalledWith('b');
    expect(getFindState().count).toEqual({ current: 1, total: 2 });

    replaceAll('p1');
    expect(editor.replaceAll).toHaveBeenCalledWith('b');
    expect(getFindState().count).toEqual({ current: 0, total: 0 });
  });

  it('refuses to replace in a read-only document (find still works)', () => {
    const editor = fakeEditor({ isReadOnly: () => true });
    registerPanelSearch('p1', editor);
    openFind('p1', 'editor');
    setTerm('p1', 'a');
    setReplacement('p1', 'b');

    replaceCurrent('p1');
    replaceAll('p1');

    expect(editor.replaceCurrent).not.toHaveBeenCalled();
    expect(editor.replaceAll).not.toHaveBeenCalled();
    expect(editor.setQuery).toHaveBeenCalled(); // find is unaffected
  });

  it('cannot replace through a terminal controller (read-only by type, FR-010)', () => {
    const term = fakeTerminal();
    registerPanelSearch('p1', term);
    openFind('p1', 'terminal');
    setReplacement('p1', 'b');

    expect(() => {
      replaceCurrent('p1');
      replaceAll('p1');
    }).not.toThrow();
    expect('replaceAll' in term).toBe(false);
  });
});

describe('closing and panel switching (FR-004, spec Edge Cases)', () => {
  it('clears highlights and returns focus to the panel on close', () => {
    const editor = fakeEditor();
    registerPanelSearch('p1', editor);
    openFind('p1', 'editor');
    closeFind('p1');

    expect(editor.close).toHaveBeenCalled();
    expect(getFindState().panelId).toBeNull();
    expect(getFindSession('p1')).toBeUndefined();
  });

  it('HIDES a bar left showing on a panel that is no longer active — and keeps its session', () => {
    /*
     * 043 FR-002, replacing 013's "closes a bar left open on a panel that is no longer active".
     *
     * The bar must go: it would otherwise act on the panel the user has left (FR-004, which is
     * what the 013 case was really protecting). The SESSION must not: throwing it away on every
     * focus change is #220. So the engine is never told anything, and the term is still there.
     */
    const editor = fakeEditor();
    registerPanelSearch('p1', editor);
    openFind('p1', 'editor');
    setTerm('p1', 'needle');

    followActivePanel('p2'); // the user moved focus to another panel

    expect(editor.close).not.toHaveBeenCalled();
    expect(getFindState().panelId).toBeNull(); // no bar is showing
    expect(isFindShowingOn('p1')).toBe(false);
    expect(getFindSession('p1')?.term).toBe('needle'); // …but the session is intact
  });

  it('shows the session again when its panel becomes active (US1 scenario 1)', () => {
    registerPanelSearch('p1', fakeEditor());
    openFind('p1', 'editor');
    setTerm('p1', 'needle');

    followActivePanel('p2');
    followActivePanel('p1');

    expect(isFindShowingOn('p1')).toBe(true);
    expect(getFindState().term).toBe('needle');
  });

  it('leaves the bar alone while its own panel stays active', () => {
    const editor = fakeEditor();
    registerPanelSearch('p1', editor);
    openFind('p1', 'editor');

    followActivePanel('p1');

    expect(editor.close).not.toHaveBeenCalled();
    expect(getFindState().panelId).toBe('p1');
  });

  it('gives a second panel its own session, and the first keeps its own (FR-003)', () => {
    registerPanelSearch('p1', fakeEditor());
    registerPanelSearch('p2', fakeEditor());

    openFind('p1', 'editor');
    setTerm('p1', 'first');
    openFind('p2', 'editor');

    expect(getFindState().panelId).toBe('p2');
    expect(getFindState().term).toBe(''); // p2's session is its own…
    expect(getFindSession('p1')?.term).toBe('first'); // …and p1's is still p1's
  });
});

describe('a session dies with its panel, and only with its panel (FR-006 / FR-025b)', () => {
  it('discards the destroyed panel’s session and no other', () => {
    registerPanelSearch('p1', fakeEditor());
    registerPanelSearch('p2', fakeEditor());
    openFind('p1', 'editor');
    setTerm('p1', 'first');
    openFind('p2', 'editor');
    setTerm('p2', 'second');

    destroyPanelSearch('p1');

    expect(getFindSession('p1')).toBeUndefined();
    expect(getFindSession('p2')?.term).toBe('second');
  });

  it('survives its panel being UNREGISTERED — that is a move, not a destroy (FR-025b)', () => {
    /*
     * `unregisterPanelSearch` runs from the editor's and terminal's unmount cleanup, and a panel
     * unmounts when it is detached into a sub-workspace, reattached, or dragged to another tab.
     * Hanging the discard off it would lose the user's search every time they moved a panel.
     */
    registerPanelSearch('p1', fakeEditor());
    openFind('p1', 'editor');
    setTerm('p1', 'first');

    unregisterPanelSearch('p1');

    expect(getFindSession('p1')?.term).toBe('first');
  });
});
