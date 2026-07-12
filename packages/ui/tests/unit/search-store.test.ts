/**
 * 013 — the find session store, driven against a FAKE controller (no CodeMirror, no
 * xterm, no DOM). Covers the routing the whole feature hangs on: the bar drives the
 * ACTIVE panel's engine, the count follows, closing clears and returns focus, and
 * switching panels never leaves a stray bar on the wrong one.
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
  closeFindIfNotOn,
  findNext,
  findPrevious,
  getFindState,
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
    setTerm('needle');

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
    setTerm('a');

    findNext();
    expect(editor.findNext).toHaveBeenCalled();
    expect(getFindState().count.total).toBe(3);

    findPrevious();
    expect(editor.findPrevious).toHaveBeenCalled();
  });

  it('re-runs the query when a match mode is toggled (FR-007)', () => {
    const editor = fakeEditor();
    registerPanelSearch('p1', editor);
    openFind('p1', 'editor');
    setTerm('a');
    toggleMode('caseSensitive');

    expect(getFindState().modes.caseSensitive).toBe(true);
    expect(editor.setQuery).toHaveBeenLastCalledWith('a', { caseSensitive: true, wholeWord: false });
  });

  it('shows the no-results state for a term that misses (FR-009)', () => {
    registerPanelSearch('p1', fakeEditor({ setQuery: () => ({ current: 0, total: 0 }) }));
    openFind('p1', 'editor');
    setTerm('missing');
    expect(getFindState().count).toEqual({ current: 0, total: 0 });
  });
});

describe('replace (FR-008, read-only edge case)', () => {
  it('replaces the current match and the count follows', () => {
    const editor = fakeEditor();
    registerPanelSearch('p1', editor);
    openFind('p1', 'editor');
    setTerm('a');
    setReplacement('b');

    replaceCurrent();
    expect(editor.replaceCurrent).toHaveBeenCalledWith('b');
    expect(getFindState().count).toEqual({ current: 1, total: 2 });

    replaceAll();
    expect(editor.replaceAll).toHaveBeenCalledWith('b');
    expect(getFindState().count).toEqual({ current: 0, total: 0 });
  });

  it('refuses to replace in a read-only document (find still works)', () => {
    const editor = fakeEditor({ isReadOnly: () => true });
    registerPanelSearch('p1', editor);
    openFind('p1', 'editor');
    setTerm('a');
    setReplacement('b');

    replaceCurrent();
    replaceAll();

    expect(editor.replaceCurrent).not.toHaveBeenCalled();
    expect(editor.replaceAll).not.toHaveBeenCalled();
    expect(editor.setQuery).toHaveBeenCalled(); // find is unaffected
  });

  it('cannot replace through a terminal controller (read-only by type, FR-010)', () => {
    const term = fakeTerminal();
    registerPanelSearch('p1', term);
    openFind('p1', 'terminal');
    setReplacement('b');

    expect(() => {
      replaceCurrent();
      replaceAll();
    }).not.toThrow();
    expect('replaceAll' in term).toBe(false);
  });
});

describe('closing and panel switching (FR-004, spec Edge Cases)', () => {
  it('clears highlights and returns focus to the panel on close', () => {
    const editor = fakeEditor();
    registerPanelSearch('p1', editor);
    openFind('p1', 'editor');
    closeFind();

    expect(editor.close).toHaveBeenCalled();
    expect(getFindState().panelId).toBeNull();
  });

  it('closes a bar left open on a panel that is no longer active', () => {
    const editor = fakeEditor();
    registerPanelSearch('p1', editor);
    openFind('p1', 'editor');

    closeFindIfNotOn('p2'); // the user moved focus to another panel

    expect(editor.close).toHaveBeenCalled();
    expect(getFindState().panelId).toBeNull();
  });

  it('leaves the bar alone while its own panel stays active', () => {
    const editor = fakeEditor();
    registerPanelSearch('p1', editor);
    openFind('p1', 'editor');

    closeFindIfNotOn('p1');

    expect(editor.close).not.toHaveBeenCalled();
    expect(getFindState().panelId).toBe('p1');
  });

  it('starts a fresh session when find opens on a different panel', () => {
    registerPanelSearch('p1', fakeEditor());
    registerPanelSearch('p2', fakeEditor());

    openFind('p1', 'editor');
    setTerm('first');
    openFind('p2', 'editor');

    expect(getFindState().panelId).toBe('p2');
    expect(getFindState().term).toBe(''); // p2's session is its own
  });
});
