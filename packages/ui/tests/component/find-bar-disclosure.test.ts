/**
 * The find bar's replace DISCLOSURE control (043 US2 — FR-008, FR-009, FR-013).
 *
 * ══ WHAT THIS FILE IS FOR ══
 *
 * Before 043 the only way to discover that the shared find bar could replace at all was to know
 * `Ctrl+H`, and the only way to put the replace row away again was to close the bar and reopen it.
 * FR-008 adds a control that expands and collapses the row in BOTH directions and renders which
 * state it is in; FR-009 says the key-binding route and the click route must never disagree.
 *
 * ══ WHY THE TWO ROUTES ARE THE INTERESTING ASSERTION ══
 *
 * "Never disagree" is only provable by driving BOTH doors into the same state within one mounted
 * tree, which is exactly what this layer can do cheaply and what a store-only unit test cannot:
 * `Ctrl+H` goes through `SearchKeybindings` → `openFind(…, { replace: true })`, while the arrow goes
 * through the bar's own click handler. A second piece of component state behind the arrow —
 * `useState` in `FindBar` rather than the session's `replaceShown` — satisfies every single-route
 * assertion and fails the moment the two are driven in sequence. So each test below CROSSES the two
 * routes rather than exercising one.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Delete the `WorkspaceProvider` element in `mount()` and `useWorkspace()` throws inside
 * `SearchKeybindings`, failing every test here — the same fence `find-bar-panel-kind.test.ts`
 * documents. Beyond that, every test asserts something PRESENT (the bar, the arrow, the replace
 * row) before or instead of an absence, so a `FindBar` that had stopped rendering satisfies none of
 * them — including the terminal test, which anchors on the find input first.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  type SearchController,
} from '../../src/renderer/search/search-controller.js';
import { __resetFindState, getFindSession } from '../../src/renderer/search/search-store.js';

const PROJECT = 'proj-1';
const PANEL = 'panel-1';
const NO_MATCHES = { current: 0, total: 0 };

function layoutWith(kind: 'editor' | 'terminal'): WorkspaceLayout {
  const base = createDefaultLayout(PROJECT, { tab: 't1', panel: PANEL });
  const root = base.tabs[0].root as Panel;
  return { ...base, tabs: [{ ...base.tabs[0], root: { ...root, kind } }] };
}

/** A terminal controller: no replace methods at all — read-only by type (013 FR-010). */
function terminalController(): SearchController {
  return {
    panelKind: 'terminal',
    seedFromSelection: () => '',
    setQuery: () => NO_MATCHES,
    findNext: () => NO_MATCHES,
    findPrevious: () => NO_MATCHES,
    close: () => {},
    scrollLines: () => {},
    scrollPages: () => {},
    scrollToTop: () => {},
    scrollToLiveBottom: () => {},
    onCountChange: () => () => {},
  };
}

/** An editor controller on a WRITEABLE document, so the revealed controls are live, not decorative. */
function editorController(): SearchController {
  return {
    panelKind: 'editor',
    seedFromSelection: () => '',
    setQuery: () => NO_MATCHES,
    findNext: () => NO_MATCHES,
    findPrevious: () => NO_MATCHES,
    close: () => {},
    replaceCurrent: () => NO_MATCHES,
    replaceAll: () => NO_MATCHES,
    isReadOnly: () => false,
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

beforeEach(() => {
  __resetFindState();
  setActivePane('workspace');
});

afterEach(() => {
  unregisterPanelSearch(PANEL);
  __resetFindState();
});

/** Says when the store has a layout — a chord pressed before it lands resolves to no panel. */
function LayoutProbe(): ReactElement {
  const { layout } = useWorkspace();
  return createElement(
    'span',
    { 'data-testid': 'layout-state' },
    layout ? `loaded:${layout.tabs.length}` : 'none',
  );
}

async function mount(kind: 'editor' | 'terminal') {
  registerPanelSearch(PANEL, kind === 'terminal' ? terminalController() : editorController());
  const client = new WorkspaceClient(fakeBridge(layoutWith(kind)));
  const user = userEvent.setup();

  render(
    // ANTI-VACUITY CONTROL: drop this `WorkspaceProvider` element and every test here fails.
    createElement(
      WorkspaceProvider,
      { client, activeProjectId: PROJECT },
      createElement(LayoutProbe, { key: 'probe' }),
      createElement(SearchKeybindings, { key: 'keys' }),
      createElement(FindBar, { key: 'bar', panelId: PANEL }),
    ),
  );

  await waitFor(() => expect(screen.getByTestId('layout-state')).toHaveTextContent('loaded:1'));
  return { user };
}

const press = (user: ReturnType<typeof userEvent.setup>, key: string): Promise<void> =>
  user.keyboard(`{Control>}${key}{/Control}`);

const disclosure = (): HTMLElement | null => screen.queryByTestId('find-toggle-replace');
const replaceRow = (): HTMLElement | null => screen.queryByTestId('find-replace-row');

describe('the disclosure control expands and collapses the replace row (FR-008)', () => {
  it('starts collapsed, opens the row on a click, and says which state it is in', async () => {
    const { user } = await mount('editor');
    await press(user, 'f');
    await waitFor(() => expect(screen.getByTestId('find-input')).toBeVisible());

    // Collapsed: the control is drawn, and it ANNOUNCES the state rather than only implying it.
    const arrow = disclosure();
    expect(arrow, 'an editor find bar draws the replace disclosure control').not.toBeNull();
    expect(arrow).toHaveAttribute('aria-expanded', 'false');
    expect(replaceRow()).toBeNull();

    await user.click(arrow as HTMLElement);

    await waitFor(() => expect(replaceRow()).not.toBeNull());
    expect(disclosure()).toHaveAttribute('aria-expanded', 'true');
    // The row is the real one, with its controls — not an empty div that satisfies a query.
    expect(screen.getByTestId('replace-input')).toBeVisible();
    expect(screen.getByTestId('replace-all')).toBeVisible();
  });

  it('collapses it again from the same control — the bar stays open on find only', async () => {
    /*
     * The half that was impossible before 043: `showReplace` only ever set the flag TRUE, so the
     * only way back to a find-only bar was Escape and a fresh `Ctrl+F`. FR-008 requires both
     * directions from one control.
     */
    const { user } = await mount('editor');
    await press(user, 'h');
    await waitFor(() => expect(replaceRow()).not.toBeNull());

    await user.click(disclosure() as HTMLElement);

    await waitFor(() => expect(replaceRow()).toBeNull());
    expect(disclosure()).toHaveAttribute('aria-expanded', 'false');
    // Collapsing hides the ROW, it does not close the bar (013 FR-005 keeps Escape for that).
    expect(screen.getByTestId('find-input')).toBeVisible();
    expect(getFindSession(PANEL)?.replaceShown).toBe(false);
  });

  it('renders a DIFFERENT glyph in each state, so the state is legible without a screen reader', async () => {
    /*
     * `aria-expanded` alone would satisfy every assertion above while the control looked identical
     * in both states — FR-008 says it must RENDER which state it is in. The glyphs come from the
     * active theme's icon set (FR-011), so this compares the two rendered glyphs to each other
     * rather than to any hardcoded character.
     */
    const { user } = await mount('editor');
    await press(user, 'f');
    await waitFor(() => expect(disclosure()).not.toBeNull());

    const collapsed = disclosure()?.textContent ?? '';
    expect(collapsed, 'the collapsed control draws a glyph').not.toBe('');

    await user.click(disclosure() as HTMLElement);
    await waitFor(() => expect(replaceRow()).not.toBeNull());

    expect(disclosure()?.textContent).not.toBe(collapsed);
    // …and the hover title names the action it will perform, in each state (constitution v3.12.0).
    expect(disclosure()?.getAttribute('title')).toBeTruthy();
  });
});

describe('the key binding and the control drive ONE state (FR-009)', () => {
  it('Ctrl+H leaves the control showing expanded', async () => {
    const { user } = await mount('editor');

    await press(user, 'h');

    await waitFor(() => expect(replaceRow()).not.toBeNull());
    expect(
      disclosure(),
      'the chord revealed replace, so the control must show the expanded state',
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('the two routes never disagree, driven alternately', async () => {
    /*
     * The test a second `useState` behind the arrow cannot pass. Chord → arrow → chord → arrow, with
     * the row and the control's own state read after every step: any private copy drifts out of step
     * with the session on the first crossing.
     */
    const { user } = await mount('editor');

    await press(user, 'h'); // chord opens replace
    await waitFor(() => expect(replaceRow()).not.toBeNull());
    expect(disclosure()).toHaveAttribute('aria-expanded', 'true');

    await user.click(disclosure() as HTMLElement); // arrow closes it
    await waitFor(() => expect(replaceRow()).toBeNull());
    expect(disclosure()).toHaveAttribute('aria-expanded', 'false');

    await press(user, 'h'); // chord opens it again
    await waitFor(() => expect(replaceRow()).not.toBeNull());
    expect(disclosure()).toHaveAttribute('aria-expanded', 'true');

    await user.click(disclosure() as HTMLElement); // and the arrow still closes it
    await waitFor(() => expect(replaceRow()).toBeNull());
    expect(disclosure()).toHaveAttribute('aria-expanded', 'false');
    expect(getFindSession(PANEL)?.replaceShown).toBe(false);
  });

  it('the arrow writes the SESSION, so re-opening the bar keeps what the user chose', async () => {
    /*
     * `replaceShown` lives on the panel's session (043 US1), and `openFind` carries it forward. A
     * control backed by component state would lose the choice on the next `Ctrl+F` — which is the
     * observable difference between "the arrow toggled a view" and "the arrow set the session".
     */
    const { user } = await mount('editor');
    await press(user, 'f');
    await waitFor(() => expect(disclosure()).not.toBeNull());

    await user.click(disclosure() as HTMLElement);
    await waitFor(() => expect(replaceRow()).not.toBeNull());
    expect(getFindSession(PANEL)?.replaceShown).toBe(true);

    await press(user, 'f'); // re-open the bar on the same panel

    await waitFor(() => expect(screen.getByTestId('find-input')).toBeVisible());
    expect(replaceRow(), 're-opening find kept the revealed replace row').not.toBeNull();
    expect(disclosure()).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('a TERMINAL bar has neither (FR-013)', () => {
  it('draws the find input but no disclosure control and no replace row', async () => {
    const { user } = await mount('terminal');
    await press(user, 'f');

    // The anchor first: this is a real, rendered find bar, so the two absences below mean something.
    await waitFor(() => expect(screen.getByTestId('find-input')).toBeVisible());
    expect(screen.getByTestId('find-next')).toBeVisible();

    expect(disclosure(), 'a terminal find is read-only — there is nothing to disclose').toBeNull();
    expect(replaceRow()).toBeNull();
  });
});
