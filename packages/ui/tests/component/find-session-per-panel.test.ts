/**
 * A find session belongs to its PANEL (043 US1, FR-001 – FR-006, FR-025b).
 *
 * PLACE AT: `packages/ui/tests/component/find-session-per-panel.test.ts`
 *
 * ══ THE DEFECT THIS FILE EXISTS FOR (#220) ══
 *
 * Before 043 the renderer held ONE find session for the whole window — `search-store.ts` was
 * `let state: FindState = CLOSED`, and `openFind` discarded the previous panel's term, replacement
 * and modes whenever the panel changed. Search in editor A, click into editor B, come back, and the
 * search is gone. Everything below is a statement of what must happen instead.
 *
 * ══ WHY COMPONENT AND NOT E2E ══
 *
 * Every hop the defect lives in is in the renderer and mounts here in full: the layout's active
 * panel (`search-keybindings.tsx`), the chord routing, the store's session map, and the bar that
 * reads its own panel's session. No Electron, no daemon, no shell, no real CodeMirror — the search
 * engines are behind `SearchController`, which is exactly the seam this feature was given in 013.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Drop the `WorkspaceProvider` element in `mount()` and `useWorkspace()` throws inside
 * `SearchKeybindings`, failing every test here before an assertion runs. Beyond that, every test
 * asserts something PRESENT — a bar, a term, a count — and not merely an absence, so a `FindBar`
 * that rendered `null` unconditionally, or a `SearchKeybindings` that had stopped listening, fails
 * the file rather than passing it.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LayoutNode, Panel, Tab, WorkspaceLayout } from '@throng/core';
import { LAYOUT_SCHEMA_VERSION } from '@throng/core';
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
  type SearchController,
  type TerminalSearchController,
} from '../../src/renderer/search/search-controller.js';
import {
  __resetFindState,
  destroyPanelSearch,
  getFindSession,
} from '../../src/renderer/search/search-store.js';

const PROJECT = 'proj-1';
const TAB = 't1';
const A = 'panel-a';
const B = 'panel-b';
const NO_MATCHES = { current: 0, total: 0 };

/** What a panel's engine was actually asked to do — so "no session's actions may alter another
 *  session's state" (FR-003) is asserted against the ENGINE, not only against the store. */
interface Recorder {
  queries: string[];
  steps: number;
  closes: number;
}

function recorder(): Recorder {
  return { queries: [], steps: 0, closes: 0 };
}

/** A writeable editor engine with three matches, standing in for CodeMirror. */
function editorController(rec: Recorder): EditorSearchController {
  let current = 0;
  const total = 3;
  return {
    panelKind: 'editor',
    seedFromSelection: () => '',
    setQuery: (term) => {
      rec.queries.push(term);
      current = term.length > 0 ? 1 : 0;
      return term.length > 0 ? { current, total } : NO_MATCHES;
    },
    findNext: () => {
      rec.steps += 1;
      current = (current % total) + 1;
      return { current, total };
    },
    findPrevious: () => {
      rec.steps += 1;
      current = current <= 1 ? total : current - 1;
      return { current, total };
    },
    replaceCurrent: () => ({ current, total }),
    replaceAll: () => NO_MATCHES,
    isReadOnly: () => false,
    close: () => {
      rec.closes += 1;
    },
  };
}

/** A terminal engine: read-only by type — no replace methods at all (013 FR-010). */
function terminalController(rec: Recorder): TerminalSearchController {
  return {
    panelKind: 'terminal',
    seedFromSelection: () => '',
    setQuery: (term) => {
      rec.queries.push(term);
      return term.length > 0 ? { current: 1, total: 2 } : NO_MATCHES;
    },
    findNext: () => ({ current: 2, total: 2 }),
    findPrevious: () => ({ current: 1, total: 2 }),
    close: () => {
      rec.closes += 1;
    },
    scrollLines: () => {},
    scrollPages: () => {},
    scrollToTop: () => {},
    scrollToLiveBottom: () => {},
    onCountChange: () => () => {},
  };
}

function panel(id: string, kind: 'editor' | 'terminal'): Panel {
  return { type: 'panel', id, originProjectId: PROJECT, title: id, kind };
}

/** Two panels side by side in one Tab — the arrangement the defect is met in. */
function twoPanelLayout(kindA: 'editor' | 'terminal', kindB: 'editor' | 'terminal'): WorkspaceLayout {
  const root: LayoutNode = {
    type: 'split',
    orientation: 'row',
    children: [panel(A, kindA), panel(B, kindB)],
    sizes: [0.5, 0.5],
  };
  const tab: Tab = { id: TAB, title: 'Tab 1', root, activePanelId: A };
  return {
    projectId: PROJECT,
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    tabs: [tab],
    activeTabId: TAB,
  };
}

function fakeBridge(layout: WorkspaceLayout): ThrongBridge {
  return {
    invoke<TResult>(method: string): Promise<TResult> {
      if (method === 'workspace.load') return Promise.resolve({ layout, restored: true } as TResult);
      if (method === 'workspace.save') return Promise.resolve({ ok: true } as TResult);
      return Promise.reject(new Error(`unexpected RPC from the find bar: ${method}`));
    },
  };
}

/**
 * Moves the active panel the way the application does — through the workspace store — and reports
 * which panel is active, so the tests can wait for the move rather than assuming it landed.
 */
function FocusControl(): ReactElement {
  const { layout, setActivePanel } = useWorkspace();
  const tab = layout?.tabs.find((t) => t.id === TAB);
  return createElement(
    'div',
    null,
    createElement(
      'span',
      { 'data-testid': 'active-panel', key: 'label' },
      layout ? (tab?.activePanelId ?? 'none') : 'no-layout',
    ),
    createElement(
      'button',
      { 'data-testid': 'focus-a', key: 'a', onClick: () => setActivePanel(TAB, A) },
      'A',
    ),
    createElement(
      'button',
      { 'data-testid': 'focus-b', key: 'b', onClick: () => setActivePanel(TAB, B) },
      'B',
    ),
  );
}

beforeEach(() => {
  __resetFindState();
  setActivePane('workspace');
});

afterEach(() => {
  unregisterPanelSearch(A);
  unregisterPanelSearch(B);
  __resetFindState();
});

async function mount(
  controllers: Record<string, SearchController>,
  kinds: { a: 'editor' | 'terminal'; b: 'editor' | 'terminal' } = { a: 'editor', b: 'editor' },
) {
  for (const [id, c] of Object.entries(controllers)) registerPanelSearch(id, c);
  const client = new WorkspaceClient(fakeBridge(twoPanelLayout(kinds.a, kinds.b)));
  const user = userEvent.setup();

  render(
    // ANTI-VACUITY CONTROL: remove this provider and `useWorkspace` throws — see the file header.
    createElement(
      WorkspaceProvider,
      { client, activeProjectId: PROJECT },
      createElement(FocusControl, { key: 'focus' }),
      createElement(SearchKeybindings, { key: 'keys' }),
      createElement(FindBar, { key: 'bar-a', panelId: A }),
      createElement(FindBar, { key: 'bar-b', panelId: B }),
    ),
  );

  // The chords resolve the active panel from the LOADED layout, so a keystroke before the load
  // lands resolves to no panel and does nothing — every assertion below would then be about a
  // component that had not started yet.
  await waitFor(() => expect(screen.getByTestId('active-panel')).toHaveTextContent(A));
  return { user };
}

const press = (user: ReturnType<typeof userEvent.setup>, key: string): Promise<void> =>
  user.keyboard(`{Control>}${key}{/Control}`);

const bar = (panelId: string): HTMLElement | null => screen.queryByTestId(`find-bar-${panelId}`);

/** Type a term into the bar showing for `panelId`, and wait for the debounced query to land. */
async function search(
  user: ReturnType<typeof userEvent.setup>,
  panelId: string,
  term: string,
  rec: Recorder,
): Promise<void> {
  const host = await waitFor(() => {
    const el = bar(panelId);
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
  await user.click(within(host).getByTestId('find-input'));
  await user.keyboard(term);
  await waitFor(() => expect(rec.queries.at(-1)).toBe(term));
}

async function focus(
  user: ReturnType<typeof userEvent.setup>,
  panelId: string,
  target: 'focus-a' | 'focus-b',
): Promise<void> {
  await user.click(screen.getByTestId(target));
  await waitFor(() => expect(screen.getByTestId('active-panel')).toHaveTextContent(panelId));
}

describe('two panels, two sessions (FR-003)', () => {
  it('holds a different term in each panel at the same time, and neither drives the other', async () => {
    const recA = recorder();
    const recB = recorder();
    const { user } = await mount({ [A]: editorController(recA), [B]: editorController(recB) });

    await press(user, 'f');
    await search(user, A, 'alpha', recA);

    await focus(user, B, 'focus-b');
    await press(user, 'f');
    await search(user, B, 'beta', recB);

    // Each engine saw only its OWN term — the guarantee FR-003 is about.
    expect(recA.queries).not.toContain('beta');
    expect(recB.queries).not.toContain('alpha');

    // …and A's session is still there, holding its own term, when the user comes back.
    await focus(user, A, 'focus-a');
    const host = await waitFor(() => {
      const el = bar(A);
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(host).getByTestId('find-input')).toHaveValue('alpha');
    expect(bar(B)).toBeNull();
  });

  it('steps matches in A without moving B (US1 scenario 2)', async () => {
    const recA = recorder();
    const recB = recorder();
    const { user } = await mount({ [A]: editorController(recA), [B]: editorController(recB) });

    await press(user, 'f');
    await search(user, A, 'alpha', recA);
    await focus(user, B, 'focus-b');
    await press(user, 'f');
    await search(user, B, 'beta', recB);
    const bBefore = within(bar(B) as HTMLElement).getByTestId('find-count').textContent;

    await focus(user, A, 'focus-a');
    await user.click(within(bar(A) as HTMLElement).getByTestId('find-next'));
    await waitFor(() =>
      expect(within(bar(A) as HTMLElement).getByTestId('find-count')).toHaveTextContent('2 of 3'),
    );

    expect(recB.steps).toBe(0);
    await focus(user, B, 'focus-b');
    expect(within(bar(B) as HTMLElement).getByTestId('find-count').textContent).toBe(bBefore);
  });
});

describe('leaving a panel hides its bar, it does not throw the session away (FR-002)', () => {
  it('restores the term, the replacement, the match modes and the current match (US1 scenario 1)', async () => {
    const recA = recorder();
    const recB = recorder();
    const { user } = await mount({ [A]: editorController(recA), [B]: editorController(recB) });

    // Term, modes, replacement and a stepped current match — all four of scenario 1.
    await press(user, 'h'); // opens find WITH the replace row (013)
    await search(user, A, 'alpha', recA);
    await user.click(within(bar(A) as HTMLElement).getByTestId('find-match-case'));
    await user.click(within(bar(A) as HTMLElement).getByTestId('replace-input'));
    await user.keyboard('omega');
    await user.click(within(bar(A) as HTMLElement).getByTestId('find-next'));
    await waitFor(() =>
      expect(within(bar(A) as HTMLElement).getByTestId('find-count')).toHaveTextContent('2 of 3'),
    );

    await focus(user, B, 'focus-b');
    expect(bar(A)).toBeNull(); // hidden…
    expect(recA.closes).toBe(0); // …and NOT closed: the engine still holds A's matches.

    await focus(user, A, 'focus-a');
    const host = await waitFor(() => {
      const el = bar(A);
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(host).getByTestId('find-input')).toHaveValue('alpha');
    expect(within(host).getByTestId('replace-input')).toHaveValue('omega');
    expect(within(host).getByTestId('find-match-case')).toHaveAttribute('aria-pressed', 'true');
    expect(within(host).getByTestId('find-count')).toHaveTextContent('2 of 3');
  });
});

describe('Escape closes one session only (FR-005)', () => {
  it('closes the focused panel’s session and leaves the other panel’s intact (US1 scenario 3)', async () => {
    const recA = recorder();
    const recB = recorder();
    const { user } = await mount({ [A]: editorController(recA), [B]: editorController(recB) });

    await press(user, 'f');
    await search(user, A, 'alpha', recA);
    await focus(user, B, 'focus-b');
    await press(user, 'f');
    await search(user, B, 'beta', recB);

    await focus(user, A, 'focus-a');
    await waitFor(() => expect(bar(A)).not.toBeNull());
    await user.keyboard('{Escape}');

    await waitFor(() => expect(bar(A)).toBeNull());
    expect(recA.closes).toBe(1);
    expect(recB.closes).toBe(0);

    // B's session survived, term and all.
    await focus(user, B, 'focus-b');
    const host = await waitFor(() => {
      const el = bar(B);
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(host).getByTestId('find-input')).toHaveValue('beta');
  });
});

describe('a session dies with its panel — and ONLY with its panel (FR-006, FR-025b)', () => {
  it('destroying a panel discards its session and leaves the other panel’s (US1 scenario 5)', async () => {
    const recA = recorder();
    const recB = recorder();
    const { user } = await mount({ [A]: editorController(recA), [B]: editorController(recB) });

    await press(user, 'f');
    await search(user, A, 'alpha', recA);
    await focus(user, B, 'focus-b');
    await press(user, 'f');
    await search(user, B, 'beta', recB);

    // What `disposeEditor` / `destroyPanel` / the cross-window destroy cascade all call.
    act(() => destroyPanelSearch(A));

    expect(getFindSession(A)).toBeUndefined();
    // Coming back to A shows nothing: there is no session left to show.
    await focus(user, A, 'focus-a');
    expect(bar(A)).toBeNull();

    // B is untouched, and still shows its own search.
    expect(getFindSession(B)?.term).toBe('beta');
    await focus(user, B, 'focus-b');
    const host = await waitFor(() => {
      const el = bar(B);
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(host).getByTestId('find-input')).toHaveValue('beta');
  });

  it('survives a MOVE: unmounting and re-registering the panel keeps the session (FR-025b)', async () => {
    /*
     * T039a. This is the guard on the discard hook, and it is not hypothetical:
     * `unregisterPanelSearch` runs from the editor's and the terminal's UNMOUNT cleanup, and a
     * panel unmounts for two very different reasons — it was destroyed, or it MOVED. Detaching a
     * panel into a sub-workspace and reattaching it is a move; so is dragging it to another tab.
     * Hanging the FR-006 discard off the unregister would look correct in every destroy test in
     * this file and silently lose the user's search every time they rearranged their window.
     *
     * The move is played out here exactly as the application performs it: the controller is
     * unregistered as the old view goes, and a NEW controller — a new CodeMirror view, in a new
     * window — registers under the same panel id when the panel lands.
     */
    const recA = recorder();
    const recB = recorder();
    const { user } = await mount({ [A]: editorController(recA), [B]: editorController(recB) });

    await press(user, 'h');
    await search(user, A, 'alpha', recA);
    await user.click(within(bar(A) as HTMLElement).getByTestId('find-match-case'));
    await user.click(within(bar(A) as HTMLElement).getByTestId('replace-input'));
    await user.keyboard('omega');
    await focus(user, B, 'focus-b');

    // ── the panel is detached: its view goes, its controller with it ──
    act(() => unregisterPanelSearch(A));
    expect(getFindSession(A)?.term).toBe('alpha');

    // ── and lands again: a fresh engine registers under the same panel id ──
    const moved = recorder();
    act(() => registerPanelSearch(A, editorController(moved)));

    await focus(user, A, 'focus-a');
    const host = await waitFor(() => {
      const el = bar(A);
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(host).getByTestId('find-input')).toHaveValue('alpha');
    expect(within(host).getByTestId('replace-input')).toHaveValue('omega');
    expect(within(host).getByTestId('find-match-case')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('an editor and a terminal, side by side (FR-004, US1 scenario 4)', () => {
  it('focusing the terminal hides the editor’s bar without touching the editor’s session', async () => {
    const recEditor = recorder();
    const recTerminal = recorder();
    const { user } = await mount(
      { [A]: editorController(recEditor), [B]: terminalController(recTerminal) },
      { a: 'editor', b: 'terminal' },
    );

    await press(user, 'h'); // find WITH replace, on the editor
    await search(user, A, 'alpha', recEditor);
    await user.click(within(bar(A) as HTMLElement).getByTestId('replace-input'));
    await user.keyboard('omega');

    await focus(user, B, 'focus-b');
    expect(bar(A)).toBeNull(); // hidden with its panel…
    expect(recEditor.closes).toBe(0); // …not closed.

    // The terminal gets its own, READ-ONLY session (013 FR-013): no replace row, ever.
    await press(user, 'f');
    const term = await waitFor(() => {
      const el = bar(B);
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(term).queryByTestId('find-replace-row')).toBeNull();
    await search(user, B, 'beta', recTerminal);

    // Nothing done in the terminal reached the editor's session or its engine. (The editor's
    // engine saw one more query than the user typed: opening a bar runs the query it opens with,
    // which for a fresh session is the empty term — 013 behaviour, unchanged here.)
    expect(recEditor.queries).not.toContain('beta');
    expect(recEditor.queries.at(-1)).toBe('alpha');
    expect(getFindSession(A)?.replacement).toBe('omega');

    await focus(user, A, 'focus-a');
    const host = await waitFor(() => {
      const el = bar(A);
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(host).getByTestId('find-input')).toHaveValue('alpha');
    expect(within(host).getByTestId('replace-input')).toHaveValue('omega');
  });
});
