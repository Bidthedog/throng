/**
 * 054 FR-074 review finding 2 — every path that PLACES a panel in a tab, or lands in an existing one,
 * must not leave it hidden behind a maximised target: a placing open restores the tab first
 * (`createDedicatedEditor` / `openPreview`'s pattern), an open into an existing hidden panel makes it
 * visible, and a MOVE into a maximised tab is refused (a restore there would act on a tab the user is not
 * looking at).
 *
 * Layer: component — the placing opens (explorer "Open terminal here", Find in Files, a preview's Open in
 * Editor) all go through the workspace store's `addPanel` / `addPanelBeside`, so the store is where the
 * one gate sits and where it is asserted; Find in Files' reuse of an existing panel is its own opener's.
 */
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectPanels, createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import { mountTabGroup, type MountedTabGroup } from './helpers/mount-tab-group.js';
import {
  __resetMaximise,
  getMaximiseStack,
  maximisePanel,
  maximiseSection,
  registerPanelTabResolver,
} from '../../src/renderer/workspace/maximise-store.js';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import { __resetLastActiveFindInFiles } from '../../src/renderer/find-in-files/last-active-find-in-files.js';
import { openFindInFiles, type FindInFilesWorkspace } from '../../src/renderer/find-in-files/open-find-in-files.js';
import { PROJECT_ID, PROJECT_ROOT, findInFilesPanel, installFileSearchStub } from './helpers/find-in-files.js';
import { vi } from 'vitest';

const PROJECT = 'proj-open';
const blank = (id: string): Panel => ({ type: 'panel', id, originProjectId: PROJECT, title: id });

function twoPanels(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  l.tabs[0].root = { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [blank('p1'), blank('p2')] };
  l.tabs[0].activePanelId = 'p1';
  return l;
}

let m: MountedTabGroup | undefined;

afterEach(() => {
  m?.unmount();
  m = undefined;
  __resetMaximise();
});

describe('the workspace store restores a maximised tab before it places a panel (FR-074)', () => {
  beforeEach(async () => {
    m = mountTabGroup(twoPanels());
    await screen.findByTestId('panel-p1');
    act(() => maximisePanel('t1', 'p1'));
    expect(getMaximiseStack('t1')).toHaveLength(1);
  });

  it('addPanel — explorer "Open terminal here", Find in Files\' new panel', () => {
    act(() => {
      m!.ws().addPanel('t1');
    });
    expect(getMaximiseStack('t1')).toEqual([]);
  });

  it('addPanelBeside — a preview\'s Open in Editor', () => {
    act(() => {
      m!.ws().addPanelBeside('p1', 'left');
    });
    expect(getMaximiseStack('t1')).toEqual([]);
  });

  it('addPanel into ANOTHER, un-maximised tab leaves this tab maximised', () => {
    let t2 = '';
    act(() => {
      t2 = m!.ws().addTab();
    });
    act(() => {
      m!.ws().addPanel(t2);
    });
    expect(getMaximiseStack('t1')).toHaveLength(1);
  });

  it('movePanelToTab into a maximised tab is refused: the panel stays where it was', () => {
    let t2 = '';
    act(() => {
      t2 = m!.ws().addTab();
    });
    const target = m!.ws().layout!.tabs.find((t) => t.id === t2)!.activePanelId!;
    act(() => maximisePanel(t2, target));
    act(() => m!.ws().movePanelToTab('p2', t2));
    const tabOf = (id: string): string | undefined =>
      m!.ws().layout!.tabs.find((t) => collectPanels(t.root).some((p) => p.id === id))?.id;
    expect(tabOf('p2')).toBe('t1');
    expect(getMaximiseStack(t2)).toHaveLength(1);
  });
});

describe('a panel changing type keeps its maximise and drops its sections (FR-075, review 7)', () => {
  const sectionOf = (): string[] => getMaximiseStack('t1').map((t) => (t.kind === 'panel' ? 'panel' : `section:${t.sectionId}`));

  beforeEach(async () => {
    m = mountTabGroup(twoPanels());
    await screen.findByTestId('panel-p1');
    act(() => maximisePanel('t1', 'p1'));
    act(() => maximiseSection('t1', 'p1', 'd0', () => null));
    expect(sectionOf()).toEqual(['panel', 'section:d0']);
  });

  it('setPanelType to another kind', () => {
    act(() => m!.ws().setPanelType('p1', 'terminal', {}));
    expect(sectionOf()).toEqual(['panel']);
  });

  it('clearPanelType', () => {
    act(() => m!.ws().setPanelType('p1', 'terminal', {}));
    act(() => maximiseSection('t1', 'p1', 'd1', () => null));
    act(() => m!.ws().clearPanelType('p1'));
    expect(sectionOf()).toEqual(['panel']);
  });

  it('setPanelType to the SAME kind (a retarget) leaves the stack alone', () => {
    act(() => m!.ws().setPanelType('p1', 'terminal', {}));
    act(() => maximiseSection('t1', 'p1', 'd1', () => null));
    act(() => m!.ws().setPanelType('p1', 'terminal', { startDirectory: 'D:/x' }));
    expect(sectionOf()).toEqual(['panel', 'section:d1']);
  });
});

describe('Find in Files reusing a panel the maximise hides makes it visible (FR-074)', () => {
  let restoreResolver: (() => void) | undefined;

  beforeEach(() => {
    __resetFindInFilesState();
    __resetLastActiveFindInFiles();
    installFileSearchStub();
  });

  afterEach(() => {
    restoreResolver?.();
    __resetFindInFilesState();
    __resetLastActiveFindInFiles();
  });

  it('restores the tab when the reused panel is hidden', () => {
    const editor: Panel = { type: 'panel', id: 'ed', originProjectId: PROJECT_ID, title: 'ed', kind: 'editor' };
    const fif = findInFilesPanel({ id: 'fif' });
    const layout: WorkspaceLayout = {
      projectId: PROJECT_ID,
      schemaVersion: 3,
      activeTabId: 'ta',
      tabs: [
        {
          id: 'ta',
          title: 'Tab',
          activePanelId: 'ed',
          root: { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [editor, fif] },
        },
      ],
    };
    restoreResolver = registerPanelTabResolver((id) => (id === 'ed' || id === 'fif' ? 'ta' : null));
    maximisePanel('ta', 'ed');
    const ws: FindInFilesWorkspace = {
      layout,
      addPanel: vi.fn(() => 'new'),
      setPanelType: vi.fn(),
      setActivePanel: vi.fn(),
    };
    act(() => {
      openFindInFiles({
        ws,
        projectId: PROJECT_ID,
        projectRoot: PROJECT_ROOT,
        openTarget: 'lastActive',
        grouping: 'file',
        route: 'toolbar',
        replace: false,
      });
    });
    expect(getMaximiseStack('ta')).toEqual([]);
  });
});
