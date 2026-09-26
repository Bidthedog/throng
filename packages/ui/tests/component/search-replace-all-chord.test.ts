/**
 * `search.replaceAll` (`Ctrl+Alt+Enter`) — the reported defect ("Ctrl+Alt+Enter in an editor does
 * not currently replace all"), reproduced through the REAL `SearchKeybindings` and `FindBar`
 * (046 iterate round 1, T140, FR-093 — replicating-bugs).
 *
 * ══ WHAT THIS FILE FOUND, READING `search-keybindings.tsx` AND `search-store.ts` ══
 *
 * The maintainer's literal complaint does NOT reproduce at this layer. With the find bar open and
 * its replace section DISCLOSED (`showReplace` / `openFind(…, {replace:true})`), pressing
 * `Ctrl+Alt+Enter` already calls `replaceAll(activePanelId)` — `search-keybindings.tsx:157-161` gates
 * only on `findOpen && activeKind === 'editor'`, and neither of those depends on which element has
 * DOM focus (the listener never reads `document.activeElement`), so the chord already works with
 * focus in the find field, the replace field, or the document alike. The **PASSING** describe block
 * below pins exactly that — not as padding, but as the record that this specific reading of "does
 * not replace all" is not what is wrong.
 *
 * What FR-093 also requires, and what today's handler gets backwards, is the "replace section
 * shown" gate itself (FR-093's own text: "a hidden replace field can still replace with its last
 * value"). `search-keybindings.tsx:158` checks `!findOpen`, never `!session.replaceShown` — so with
 * the bar open on FIND ONLY (replace never disclosed), `Ctrl+Alt+Enter` STILL runs
 * `controller.replaceAll(session.replacement)`, using whatever `replacement` happens to be sitting in
 * the session (`''` if the user never typed one) — a **silent, wrong-value replace** rather than the
 * "does nothing" the report describes, but the one provable defect this layer can show under FR-093's
 * own condition. The **RED** describe block below is this case: T141's "replace-section gate" is
 * exactly the fix it names.
 *
 * Harness borrowed from `find-bar-disclosure.test.ts` (registered controller + real `WorkspaceProvider`
 * + real `SearchKeybindings` + real `FindBar`); the "focus in the document" case adds a stand-in
 * `.cm-content` element, the same device `window-zoom-reset-shift.test.ts` uses, because no real
 * CodeMirror view is mounted here.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { SearchKeybindings } from '../../src/renderer/search/search-keybindings.js';
import { FindBar } from '../../src/renderer/search/find-bar.js';
import {
  registerPanelSearch,
  unregisterPanelSearch,
  type EditorSearchController,
} from '../../src/renderer/search/search-controller.js';
import {
  __resetFindState,
  openFind,
  setReplacement,
  showReplace,
} from '../../src/renderer/search/search-store.js';

const PROJECT = 'proj-1';
const PANEL = 'panel-1';
const NO_MATCHES = { current: 0, total: 0 };
const REPLACED = { current: 0, total: 3 };

function layout(): WorkspaceLayout {
  const base = createDefaultLayout(PROJECT, { tab: 't1', panel: PANEL });
  const root = base.tabs[0].root as Panel;
  return { ...base, tabs: [{ ...base.tabs[0], root: { ...root, kind: 'editor' } }] };
}

function fakeBridge(): ThrongBridge {
  return {
    invoke<TResult>(method: string): Promise<TResult> {
      if (method === 'workspace.load') return Promise.resolve({ layout: layout(), restored: true } as TResult);
      if (method === 'workspace.save') return Promise.resolve({ ok: true } as TResult);
      return Promise.reject(new Error(`unexpected RPC: ${method}`));
    },
  };
}

/** Records every `replaceAll` call and the replacement string it ran with. */
function editorController(replaceAll: ReturnType<typeof vi.fn>): EditorSearchController {
  return {
    panelKind: 'editor',
    seedFromSelection: () => '',
    setQuery: () => NO_MATCHES,
    findNext: () => NO_MATCHES,
    findPrevious: () => NO_MATCHES,
    close: () => {},
    replaceCurrent: () => NO_MATCHES,
    replaceAll,
    isReadOnly: () => false,
  };
}

function LayoutProbe(): ReactElement {
  const { layout: l } = useWorkspace();
  return createElement('span', { 'data-testid': 'layout-state' }, l ? `loaded:${l.tabs.length}` : 'none');
}

let documentEl: HTMLDivElement;

async function mount(replaceAll: ReturnType<typeof vi.fn>): Promise<void> {
  registerPanelSearch(PANEL, editorController(replaceAll));
  const client = new WorkspaceClient(fakeBridge());

  render(
    createElement(
      WorkspaceProvider,
      { client, activeProjectId: PROJECT },
      createElement(LayoutProbe, { key: 'probe' }),
      createElement(SearchKeybindings, { key: 'keys' }),
      createElement(FindBar, { key: 'bar', panelId: PANEL }),
    ),
  );
  await waitFor(() => expect(screen.getByTestId('layout-state')).toHaveTextContent('loaded:1'));

  // The stand-in for "focus in the document" — no real CodeMirror view is mounted by this harness,
  // exactly as `window-zoom-reset-shift.test.ts` stands in for a terminal/editor/find-bar surface.
  documentEl = document.createElement('div');
  documentEl.className = 'cm-content';
  documentEl.tabIndex = 0;
  document.body.append(documentEl);
}

beforeEach(() => {
  __resetFindState();
  setActivePane('workspace');
});

afterEach(() => {
  unregisterPanelSearch(PANEL);
  __resetFindState();
  documentEl?.remove();
});

/** Ctrl+Alt+Enter, focused on `el` first — the chord `search.replaceAll` ships (FR-093/FR-096). */
function pressReplaceAllChord(el: HTMLElement): boolean {
  el.focus();
  let notPrevented = true;
  act(() => {
    notPrevented = fireEvent.keyDown(el, {
      key: 'Enter',
      ctrlKey: true,
      altKey: true,
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });
  });
  return notPrevented;
}

describe('PASSING today — bar open, replace section SHOWN: Ctrl+Alt+Enter already replaces, from any focus (FR-093)', () => {
  /*
   * Not the reported defect. Recorded here, not skipped, because `replicating-bugs` asks for the
   * cases that were CHECKED as much as the one that failed — and because a future change to
   * `search-keybindings.tsx` that broke this specific path would otherwise go unnoticed by T140/T141.
   */
  const contexts: Array<[string, () => HTMLElement]> = [
    ['the find field', () => screen.getByTestId('find-input')],
    ['the replace field', () => screen.getByTestId('replace-input')],
    ['the document', () => documentEl],
  ];

  for (const [label, getEl] of contexts) {
    it(`replaces every match with focus in ${label}`, async () => {
      const replaceAll = vi.fn(() => REPLACED);
      await mount(replaceAll);
      act(() => openFind(PANEL, 'editor', { replace: true }));
      act(() => setReplacement(PANEL, 'REPL'));
      await waitFor(() => expect(screen.getByTestId('find-replace-row')).toBeVisible());

      const notPrevented = pressReplaceAllChord(getEl());

      expect(notPrevented, 'a handled command must preventDefault, or the key also reaches the shell/editor').toBe(false);
      expect(replaceAll).toHaveBeenCalledWith('REPL');
    });
  }
});

describe('RED today — bar open, replace section HIDDEN: Ctrl+Alt+Enter must be a no-op (FR-093, the "replace-section gate" T141 fixes)', () => {
  it('does NOT replace, and passes the key on, when the bar is open on find only', async () => {
    const replaceAll = vi.fn(() => REPLACED);
    await mount(replaceAll);
    act(() => openFind(PANEL, 'editor')); // find only — no `{replace: true}`, and `showReplace` never called
    act(() => setReplacement(PANEL, 'REPL')); // a STALE value a prior replace-and-collapse could leave behind
    await waitFor(() => expect(screen.getByTestId('find-input')).toBeVisible());
    expect(screen.queryByTestId('find-replace-row'), 'the replace section must be hidden for this case').toBeNull();

    const notPrevented = pressReplaceAllChord(screen.getByTestId('find-input'));

    expect(
      replaceAll,
      'today\'s handler gates only on `findOpen` (search-keybindings.tsx:158), not on `replaceShown` — so this currently FAILS, replacing with the stale value instead of doing nothing',
    ).not.toHaveBeenCalled();
    expect(notPrevented, 'a true no-op must pass the key on').toBe(true);
  });

  it('showing replace and then hiding it again (the disclosure arrow) must ALSO go back to a no-op', async () => {
    // The exact shape of "a hidden replace field can still replace with its last value" (FR-093):
    // the session's `replacement` from before the row was collapsed is still sitting there.
    const replaceAll = vi.fn(() => REPLACED);
    await mount(replaceAll);
    act(() => openFind(PANEL, 'editor', { replace: true }));
    act(() => setReplacement(PANEL, 'REPL'));
    act(() => showReplace(PANEL)); // idempotent here, but this is the route `find-bar-disclosure.test.ts` pins
    await waitFor(() => expect(screen.getByTestId('find-replace-row')).toBeVisible());
    act(() => {
      fireEvent.click(screen.getByTestId('find-toggle-replace')); // collapse — session.replaceShown -> false
    });
    await waitFor(() => expect(screen.queryByTestId('find-replace-row')).toBeNull());

    pressReplaceAllChord(screen.getByTestId('find-input'));

    expect(replaceAll, 'collapsing the row must retire the chord, not just hide the field').not.toHaveBeenCalled();
  });
});

/**
 * `search.replaceCurrent` (`Alt+Enter`) — the SAME stale-hidden-value hazard as Replace All (review of
 * T141). `toggleReplace` collapses the row without clearing `session.replacement`, so Ctrl+H, type a
 * replacement, collapse the row, then Alt+Enter silently replaced the current match with a value the
 * user can no longer see. FR-093's replace-section gate, applied by the same reasoning *(derived)*.
 */
function pressReplaceCurrentChord(el: HTMLElement): boolean {
  el.focus();
  let notPrevented = true;
  act(() => {
    notPrevented = fireEvent.keyDown(el, {
      key: 'Enter',
      ctrlKey: false,
      altKey: true,
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });
  });
  return notPrevented;
}

async function mountWithReplaceCurrent(replaceCurrent: ReturnType<typeof vi.fn>): Promise<void> {
  registerPanelSearch(PANEL, { ...editorController(vi.fn(() => REPLACED)), replaceCurrent });
  const client = new WorkspaceClient(fakeBridge());
  render(
    createElement(
      WorkspaceProvider,
      { client, activeProjectId: PROJECT },
      createElement(LayoutProbe, { key: 'probe' }),
      createElement(SearchKeybindings, { key: 'keys' }),
      createElement(FindBar, { key: 'bar', panelId: PANEL }),
    ),
  );
  await waitFor(() => expect(screen.getByTestId('layout-state')).toHaveTextContent('loaded:1'));
}

describe('Alt+Enter (replaceCurrent) carries the same replace-section gate (FR-093, derived)', () => {
  it('control: with the replace section SHOWN it replaces the current match', async () => {
    const replaceCurrent = vi.fn(() => NO_MATCHES);
    await mountWithReplaceCurrent(replaceCurrent);
    act(() => openFind(PANEL, 'editor', { replace: true }));
    act(() => setReplacement(PANEL, 'REPL'));
    await waitFor(() => expect(screen.getByTestId('find-replace-row')).toBeVisible());

    const notPrevented = pressReplaceCurrentChord(screen.getByTestId('find-input'));

    expect(notPrevented).toBe(false);
    expect(replaceCurrent).toHaveBeenCalled();
  });

  it('does NOT replace, and passes the key on, when the bar is open on find only', async () => {
    const replaceCurrent = vi.fn(() => NO_MATCHES);
    await mountWithReplaceCurrent(replaceCurrent);
    act(() => openFind(PANEL, 'editor'));
    act(() => setReplacement(PANEL, 'REPL'));
    await waitFor(() => expect(screen.getByTestId('find-input')).toBeVisible());

    const notPrevented = pressReplaceCurrentChord(screen.getByTestId('find-input'));

    expect(replaceCurrent, 'a hidden replace field must not replace with its stale value').not.toHaveBeenCalled();
    expect(notPrevented, 'a true no-op must pass the key on').toBe(true);
  });

  it('collapsing the replace row (the disclosure arrow) retires Alt+Enter too', async () => {
    const replaceCurrent = vi.fn(() => NO_MATCHES);
    await mountWithReplaceCurrent(replaceCurrent);
    act(() => openFind(PANEL, 'editor', { replace: true }));
    act(() => setReplacement(PANEL, 'REPL'));
    await waitFor(() => expect(screen.getByTestId('find-replace-row')).toBeVisible());
    act(() => {
      fireEvent.click(screen.getByTestId('find-toggle-replace'));
    });
    await waitFor(() => expect(screen.queryByTestId('find-replace-row')).toBeNull());

    pressReplaceCurrentChord(screen.getByTestId('find-input'));

    expect(replaceCurrent).not.toHaveBeenCalled();
  });
});

describe('unchanged by this round — no bar open, or a terminal panel: still a no-op (FR-093)', () => {
  it('no bar open at all: does nothing and passes the key on', async () => {
    const replaceAll = vi.fn(() => REPLACED);
    await mount(replaceAll);
    // No `openFind` call — the bar was never opened on this panel.

    const notPrevented = pressReplaceAllChord(documentEl);

    expect(replaceAll).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });
});
