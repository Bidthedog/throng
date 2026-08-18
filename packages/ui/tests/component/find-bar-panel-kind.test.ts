/**
 * Which half of the find bar a panel gets — a terminal's find is read-only, an editor's is not
 * (013 FR-010; the one shared bar, FR-002).
 *
 * PLACE AT: `packages/ui/tests/component/find-bar-panel-kind.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/editor-replace.e2e.ts:197` —
 * `a terminal never offers replace — its find is read-only (FR-010)` (034 FR-045).
 *
 * ══ WHY THIS ONE COMES DOWN ══
 *
 * It launched Electron, started a daemon, created a project on a real temp folder and spawned a real
 * `cmd.exe` — in order to press two chords and count two absent elements. Nothing it asserted came
 * from the shell: no output was searched, no scrollback was read, and the bar never received a term.
 * The whole chain it exercised is four renderer guards and it is mountable here in full:
 *
 *   1. `search-keybindings.tsx:123` — `search.replace` returns early unless the active panel is an
 *      editor, so `Ctrl+H` on a terminal opens NOTHING.
 *   2. `search-keybindings.tsx:106` — the active panel's `kind` is what becomes the `FindPanelKind`
 *      handed to the store. This is the wiring hop, and it is why `SearchKeybindings` is mounted here
 *      rather than the store being driven directly: a version that always passed `'editor'` would
 *      defeat guards 3 and 4 at once, and only this hop can see it.
 *   3. `search-store.ts:105` — `replaceShown` is forced false for any non-editor kind.
 *   4. `find-bar.tsx:156` — the replace row renders only for `isEditor && replaceShown`.
 *
 * ══ WHERE THIS LANDS STRONGER THAN THE E2E DID ══
 *
 *   - The E2E pressed `Ctrl+H` and then `Ctrl+F` and asserted the END STATE. That cannot tell the
 *     difference between "the replace chord was refused" and "the replace chord opened a bar that
 *     happened to have no replace row" — guard 1 and guard 3 are indistinguishable from outside.
 *     Here the two chords are asserted separately, so the first one is proved to be INERT.
 *   - The editor case is asserted in the same file. Without it, a `FindBar` that returned `null`
 *     unconditionally satisfies every "no replace row" assertion in this file, and would look like a
 *     passing test for a feature that had ceased to exist.
 *
 * ══ WHAT DOES NOT COME DOWN FROM THAT FILE ══
 *
 * `editor-replace.e2e.ts`'s other three tests stay: two assert the BYTES on disk after a save
 * (`replace-all` preserving CRLF, and `replace-current` advancing), and the third rebases matches
 * across a live document edit through the real find bar and the undo authority.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * In `mount()` below, render the tree WITHOUT the `WorkspaceProvider` element. `SearchKeybindings`
 * calls `useWorkspace()`, which throws `useWorkspace must be used within a WorkspaceProvider`, so
 * the render fails before any assertion runs. **ALL FOUR tests fail.** Every test in this file
 * asserts something PRESENT — the find bar, or the replace row — before or instead of an absence, so
 * an empty document cannot satisfy any of them.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
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
import {
  __resetFindState,
  getFindState,
  openFind,
  showReplace,
} from '../../src/renderer/search/search-store.js';

const PROJECT = 'proj-1';
const PANEL = 'panel-1';
const NO_MATCHES = { current: 0, total: 0 };

/**
 * The layout, with the panel's `kind` set.
 *
 * Patched onto `createDefaultLayout`'s own shape rather than hand-built, so the fixture stays a
 * layout the application could really produce. `kind` is the only field `search-keybindings.tsx:67`
 * reads, and a full `config` would be inert here — stating that is better than inventing a terminal
 * configuration this test never uses.
 */
function layoutWith(kind: 'editor' | 'terminal'): WorkspaceLayout {
  const base = createDefaultLayout(PROJECT, { tab: 't1', panel: PANEL });
  const root = base.tabs[0].root as Panel;
  return { ...base, tabs: [{ ...base.tabs[0], root: { ...root, kind } }] };
}

/** A terminal controller: no replace methods AT ALL — read-only by type (FR-010). */
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

/** An editor controller on a WRITEABLE document, so the replace controls are live rather than merely present. */
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
  // The panel commands are gated on the workspace pane being active (`search-keybindings.tsx:88`).
  // The module's own default is already 'workspace'; saying so is cheaper than depending on it.
  setActivePane('workspace');
});

afterEach(() => {
  unregisterPanelSearch(PANEL);
  __resetFindState();
});

/** Says when the store has a layout — see the wait in `mount`. */
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
    // ANTI-VACUITY CONTROL: drop this `WorkspaceProvider` element and `useWorkspace` throws inside
    // `SearchKeybindings` (and in `LayoutProbe`), failing all four tests. See the file header.
    createElement(
      WorkspaceProvider,
      { client, activeProjectId: PROJECT },
      createElement(LayoutProbe, { key: 'probe' }),
      createElement(SearchKeybindings, { key: 'keys' }),
      createElement(FindBar, { key: 'bar', panelId: PANEL }),
    ),
  );

  /*
   * `SearchKeybindings` resolves the active panel from the LOADED layout (`:62-67`), so a chord
   * pressed before the load lands resolves to no panel and returns at `:108` — doing nothing. Every
   * "no bar" assertion in this file would then pass against a component that had simply not started
   * yet, which is the most expensive kind of false green. Waiting on the layout removes the race.
   */
  await waitFor(() => expect(screen.getByTestId('layout-state')).toHaveTextContent('loaded:1'));
  return { user };
}

/** The chord, delivered as a real keydown on the window (`search-keybindings.tsx:191`). */
const press = (user: ReturnType<typeof userEvent.setup>, key: string): Promise<void> =>
  user.keyboard(`{Control>}${key}{/Control}`);

const findBar = (): HTMLElement | null => screen.queryByTestId(`find-bar-${PANEL}`);

describe('a TERMINAL panel', () => {
  it('ignores the replace chord entirely — Ctrl+H opens no bar at all', async () => {
    /*
     * The half `editor-replace.e2e.ts:197` could not see. It pressed Ctrl+H and Ctrl+F back to back
     * and asserted the end state, which is satisfied whether the replace chord was refused or merely
     * produced a bar with the row suppressed. Refusing it is the requirement (FR-010): replace is an
     * editor affordance and the chord is inert on a terminal.
     */
    const { user } = await mount('terminal');
    expect(findBar()).toBeNull();

    await press(user, 'h');

    expect(findBar()).toBeNull();
    expect(getFindState().panelId).toBeNull();
  });

  it('opens a find-only bar on Ctrl+F: no replace row, no Replace All', async () => {
    // MIGRATED FROM `editor-replace.e2e.ts:197`, both chords in the order it pressed them.
    const { user } = await mount('terminal');
    await press(user, 'h');
    await press(user, 'f');

    await waitFor(() => expect(findBar()).not.toBeNull());
    // Present, and a real find bar — the anchor that keeps the two absences below meaningful.
    expect(screen.getByTestId('find-input')).toBeVisible();
    expect(screen.getByTestId('find-next')).toBeVisible();

    expect(screen.queryByTestId('find-replace-row')).toBeNull();
    expect(screen.queryByTestId('replace-all')).toBeNull();
    expect(screen.queryByTestId('replace-current')).toBeNull();
  });

  it('cannot be talked into a replace row by asking the store directly', async () => {
    /*
     * The second guard, independent of the chord. `openFind(…, { replace: true })` is what
     * `search.replace` would call if its editor check were removed, and `showReplace()` is the other
     * door into the same state. Both are refused for a non-editor kind
     * (`search-store.ts:105` and `:153`), and the bar draws no row either way.
     */
    await mount('terminal');

    act(() => openFind(PANEL, 'terminal', { replace: true }));
    await waitFor(() => expect(findBar()).not.toBeNull());
    expect(getFindState().replaceShown).toBe(false);
    expect(screen.queryByTestId('find-replace-row')).toBeNull();

    act(() => showReplace());
    expect(getFindState().replaceShown).toBe(false);
    expect(screen.queryByTestId('find-replace-row')).toBeNull();
  });
});

describe('an EDITOR panel', () => {
  it('DOES get the replace row from the same chord — so the absences above are a decision', async () => {
    /*
     * The contrast, and the file's own vacuity fence. Every assertion in the terminal block is an
     * absence, and a `FindBar` that had stopped rendering — or a `SearchKeybindings` that had stopped
     * listening — satisfies all of them. This one fails in that world.
     */
    const { user } = await mount('editor');

    await press(user, 'h');

    await waitFor(() => expect(findBar()).not.toBeNull());
    expect(screen.getByTestId('find-replace-row')).toBeVisible();
    expect(screen.getByTestId('replace-all')).toBeVisible();
    expect(screen.getByTestId('replace-current')).toBeVisible();
    // …and on a writeable document the controls are usable, not decorative.
    expect(screen.getByTestId('replace-input')).toBeEnabled();
    expect(screen.getByTestId('replace-all')).toBeEnabled();
  });
});
