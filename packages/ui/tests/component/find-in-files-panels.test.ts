/**
 * 043 T100 — several Find in Files panels at once, each its own search (FR-019, FR-021, FR-022,
 * SC-009, US5 scenarios 1–3).
 *
 * ══ WHY THREE AND NOT TWO ══
 *
 * Two panels prove independence from a global; three prove independence from "the other one". A
 * store keyed by panel and a store holding a current and a previous behave identically at two, and
 * the second is exactly the shape someone reaches for when a panel needs to remember what it found
 * while another is on screen. SC-009 asks for several searches kept side by side, so three is the
 * smallest number that can tell the two implementations apart.
 *
 * ══ WHY THE TREE IS UNMOUNTED AND REMOUNTED ══
 *
 * "Returnable without re-running" is a claim about a panel the user has been away from, and going
 * away is what an inactive Tab does to a panel: it stops being rendered. So the test unmounts the
 * whole tree and mounts it again — which is the closest this layer gets to a tab switch, and is the
 * thing that would fail if results lived in a component's `useState` rather than in the store. The
 * proof that nothing re-ran is the scan bridge's own call count, not the absence of a spinner.
 *
 * ══ WHY THE WORKSPACE IS SPIES AND THE PANELS ARE REAL ══
 *
 * `find-in-files-entry.test.ts`'s arrangement, for its reasons: `openFindInFiles` takes a
 * structural slice of the store so which panel it picks can be driven without a provider, while the
 * panels themselves are rendered because "shows its own results" is a claim about a DOM.
 */
import { act, render, screen, type RenderResult } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type Panel,
  type Tab,
  type WorkspaceLayout,
} from '@throng/core';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { FindInFilesPanel } from '../../src/renderer/find-in-files/find-in-files-panel.js';
import {
  __resetFindInFilesState,
  getFindInFilesPanel,
  runFindInFiles,
  setFindInFilesTerm,
} from '../../src/renderer/find-in-files/find-in-files-store.js';
import { __resetLastActiveFindInFiles } from '../../src/renderer/find-in-files/last-active-find-in-files.js';
import {
  openFindInFiles,
  type FindInFilesWorkspace,
  type OpenFindInFilesArgs,
} from '../../src/renderer/find-in-files/open-find-in-files.js';
import {
  PROJECT_ID,
  PROJECT_ROOT,
  findInFilesPanel,
  installFileSearchStub,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

const config = vi.hoisted(() => ({ settings: null as unknown as AppSettings }));

vi.mock('../../src/renderer/config/config-store.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/renderer/config/config-store.js')>();
  return { ...actual, useAppSettings: () => config.settings };
});

const TAB_ID = 'tab-1';
const OTHER_TAB_ID = 'tab-2';
const NEW_PANEL_ID = 'p-new';
const IDS = ['fif-a', 'fif-b', 'fif-c'] as const;

let bridge: FileSearchStub;
let previousThrong: unknown;

/** The three panels, mounted together the way one Tab holds them. */
function renderThree(): RenderResult {
  return render(
    createElement(
      NotificationProvider,
      null,
      createElement(
        ConfirmProvider,
        null,
        createElement(
          ContextMenuProvider,
          null,
          createElement(
            Fragment,
            null,
            ...IDS.map((id) =>
              createElement(FindInFilesPanel, {
                key: id,
                panel: findInFilesPanel({ id, originProjectId: PROJECT_ID }),
                projectRoot: PROJECT_ROOT,
                projectId: PROJECT_ID,
              }),
            ),
          ),
        ),
      ),
    ),
  );
}

/** A completed scan for one panel, with `n` matches in one file named after the panel. */
function completeScan(panelId: string, n: number): void {
  bridge.emit({
    panelId,
    generation: 1,
    status: 'complete',
    rows: Array.from({ length: n }, (_, i) => resultRow(`src/${panelId}.ts`, i + 1, i * 10)),
    totalMatches: n,
    filesScanned: 1,
  });
}

function panel(id: string): Panel {
  return findInFilesPanel({ id, originProjectId: PROJECT_ID });
}

function tabWith(ids: readonly string[], activePanelId: string): Tab {
  const panels = ids.map(panel);
  return {
    id: TAB_ID,
    title: 'Tab 1',
    activePanelId,
    root:
      panels.length === 1
        ? panels[0]
        : { type: 'split', orientation: 'row', children: panels, sizes: panels.map(() => 1 / panels.length) },
  };
}

function layout(ids: readonly string[], activePanelId: string): WorkspaceLayout {
  return {
    projectId: PROJECT_ID,
    schemaVersion: 3,
    tabs: [
      tabWith(ids, activePanelId),
      {
        id: OTHER_TAB_ID,
        title: 'Tab 2',
        // An EDITOR, deliberately: the FR-022 test below needs a tab that holds no Find in Files
        // panel at all, and a second one of ours here would make it assert nothing.
        root: {
          type: 'panel',
          id: 'other-editor',
          originProjectId: PROJECT_ID,
          title: 'Panel 1',
          kind: 'editor',
        },
      },
    ],
    activeTabId: TAB_ID,
  };
}

interface Spies {
  ws: FindInFilesWorkspace;
  addPanel: ReturnType<typeof vi.fn>;
  setPanelType: ReturnType<typeof vi.fn>;
}

function workspace(l: WorkspaceLayout): Spies {
  const addPanel = vi.fn(() => NEW_PANEL_ID);
  const setPanelType = vi.fn();
  return {
    addPanel,
    setPanelType,
    ws: {
      layout: l,
      addPanel,
      clearLastAddedPanel: vi.fn(),
      setPanelType,
      setActivePanel: vi.fn(),
    },
  };
}

function invoke(spies: Spies, over: Partial<OpenFindInFilesArgs> = {}): string | null {
  let opened: string | null = null;
  act(() => {
    opened = openFindInFiles({
      ws: spies.ws,
      projectId: PROJECT_ID,
      projectRoot: PROJECT_ROOT,
      openTarget: 'lastActive',
      grouping: 'file',
      route: 'toolbar',
      replace: false,
      ...over,
    });
  });
  return opened;
}

const total = (id: string): string => screen.getByTestId(`fif-total-${id}`).textContent ?? '';
const rowsIn = (id: string): number =>
  screen.getByTestId(`fif-results-${id}`).querySelectorAll('.fif-row').length;

beforeEach(() => {
  config.settings = DEFAULT_APP_SETTINGS;
  __resetFindInFilesState();
  __resetLastActiveFindInFiles();
  previousThrong = (window as unknown as { throng?: unknown }).throng;
  bridge = installFileSearchStub();
});

afterEach(() => {
  __resetFindInFilesState();
  __resetLastActiveFindInFiles();
  (window as unknown as { throng?: unknown }).throng = previousThrong;
  vi.restoreAllMocks();
});

describe('three panels, three independent searches (FR-019, SC-009)', () => {
  it('gives each panel its own results, with nothing crossing between them', () => {
    renderThree();

    completeScan(IDS[0], 1);
    completeScan(IDS[1], 2);
    completeScan(IDS[2], 3);

    expect(total(IDS[0])).toBe('1');
    expect(total(IDS[1])).toBe('2');
    expect(total(IDS[2])).toBe('3');
    expect(rowsIn(IDS[0])).toBe(1);
    expect(rowsIn(IDS[1])).toBe(2);
    expect(rowsIn(IDS[2])).toBe(3);
  });

  it('leaves the other two alone when one is re-run', () => {
    renderThree();
    completeScan(IDS[0], 1);
    completeScan(IDS[1], 2);
    completeScan(IDS[2], 3);

    // A NEW generation for the middle panel only — the rows it had are replaced, the others' stand.
    act(() => {
      setFindInFilesTerm(IDS[1], 'needle');
      runFindInFiles(IDS[1]);
    });
    bridge.emit({
      panelId: IDS[1],
      generation: 2,
      status: 'complete',
      rows: [resultRow('src/other.ts', 9, 90)],
      totalMatches: 1,
      filesScanned: 1,
    });

    expect(total(IDS[1])).toBe('1');
    expect(total(IDS[0])).toBe('1');
    expect(total(IDS[2])).toBe('3');
    expect(rowsIn(IDS[2])).toBe(3);
  });

  it('still shows what was left in each panel after the tree is unmounted and mounted again', () => {
    /*
     * The SC-009 claim: a panel the user went away from and came back to is still holding its
     * answer, and coming back did not go and ask again. An inactive Tab stops rendering its panels,
     * so unmounting is what "away" means at this layer — and the scan count is what "did not ask
     * again" means, because a panel that silently re-ran would look identical on screen.
     */
    const first = renderThree();
    completeScan(IDS[0], 1);
    completeScan(IDS[1], 2);
    completeScan(IDS[2], 3);
    act(() => {
      setFindInFilesTerm(IDS[1], 'needle');
      runFindInFiles(IDS[1]);
    });
    const scansBefore = bridge.start.mock.calls.length;
    expect(scansBefore).toBe(1);

    first.unmount();
    renderThree();

    expect(total(IDS[0])).toBe('1');
    expect(total(IDS[2])).toBe('3');
    expect(rowsIn(IDS[2])).toBe(3);
    expect(bridge.start.mock.calls.length).toBe(scansBefore);
  });
});

describe('which of the three receives the next search (FR-021, FR-022)', () => {
  it('reuses the tab’s ACTIVE Find in Files panel at the shipped default', () => {
    renderThree();
    completeScan(IDS[2], 3);

    expect(invoke(workspace(layout(IDS, IDS[1])))).toBe(IDS[1]);
    // The other two are untouched — the reuse rule picks one panel, it does not reset the set.
    expect(total(IDS[2])).toBe('3');
  });

  it('opens a fourth rather than reusing when the preference says New Panel — there is no limit', () => {
    renderThree();
    completeScan(IDS[0], 1);
    const spies = workspace(layout(IDS, IDS[1]));

    expect(invoke(spies, { openTarget: 'new' })).toBe(NEW_PANEL_ID);
    expect(spies.addPanel).toHaveBeenCalledWith(TAB_ID);
    expect(spies.setPanelType).toHaveBeenCalledWith(NEW_PANEL_ID, 'findInFiles', {});
    // FR-019 — a fourth panel exists alongside the three, which keep their own searches.
    expect(getFindInFilesPanel(NEW_PANEL_ID)).toBeDefined();
    expect(total(IDS[0])).toBe('1');
  });

  it('opens one in a tab that holds NONE, whatever the preference says (FR-022)', () => {
    /*
     * The sharp edge of FR-022, restated where three panels exist to be wrongly chosen: "reuse the
     * last active panel" is the shipped default, and three candidates sitting in another Tab must
     * not attract the search. A per-window "last active" would hand it to one of them, in a tab the
     * user is not looking at.
     */
    renderThree();
    completeScan(IDS[1], 2);
    const elsewhere: WorkspaceLayout = { ...layout(IDS, IDS[1]), activeTabId: OTHER_TAB_ID };
    const spies = workspace(elsewhere);

    expect(invoke(spies, { openTarget: 'lastActive' })).toBe(NEW_PANEL_ID);
    expect(spies.addPanel).toHaveBeenCalledWith(OTHER_TAB_ID);
    expect(total(IDS[1])).toBe('2');
  });
});
