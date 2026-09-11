/**
 * 043 T236 (FR-037, FR-038, FR-087, FR-087c) — a result row opens in a SUB-WORKSPACE window too.
 *
 * ══ THE DEFECT ══
 *
 * `FindInFilesChrome` resolved ONE project root for the whole window, from `ws.layout.projectId`. In
 * a sub-workspace window that id is the synthetic `subworkspace:<id>`, which matches no project, so
 * the root came out `null` and the chrome registered NO result opener and NO target lister. In that
 * window double-click and Enter on a row did nothing, and Open In was always drawn disabled — on a
 * panel whose rows were right there, mirrored from the parent by FR-078.
 *
 * ══ THE RULE THE FIX FOLLOWS ══
 *
 * Quick Open's, stated in `navigation-chrome.tsx`: a sub-workspace may hold panels from several
 * projects, so the root must be the root of the PANEL the user is acting in, never one chosen for
 * the window. The Find in Files panel already knows its own root — it was handed it when it mounted
 * — so it sends that root with every request, and the chrome answers against it.
 *
 * This mounts the chrome as a sub-workspace window sees it: a layout whose project id is synthetic
 * and a project list that does not contain it. Before the fix, `requestOpenResult` answered `false`
 * because nothing was listening, and no open reached the editor.
 */
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { FindInFilesChrome } from '../../src/renderer/find-in-files/find-in-files-chrome.js';
import {
  queryResultOpenTargets,
  requestOpenResult,
} from '../../src/renderer/find-in-files/result-open.js';

const SUB_LAYOUT = {
  projectId: 'subworkspace:7',
  schemaVersion: 3,
  activeTabId: 't1',
  tabs: [
    {
      id: 't1',
      title: 'Tab 1',
      activePanelId: 'fif-1',
      root: { type: 'panel', id: 'fif-1', originProjectId: 'proj-a', title: 'Find in Files', kind: 'findInFiles' },
    },
  ],
};

vi.mock('../../src/renderer/state/workspace-store.js', () => ({
  useWorkspace: () => ({
    layout: SUB_LAYOUT,
    addPanel: vi.fn(),
    clearLastAddedPanel: vi.fn(),
    setPanelType: vi.fn(),
    setActivePanel: vi.fn(),
    setActiveTab: vi.fn(),
  }),
}));

vi.mock('../../src/renderer/state/projects-store.js', () => ({
  // The sub-workspace window's project list does not contain its synthetic id — the whole defect.
  useProjects: () => ({ projects: [], activeProject: null }),
}));

vi.mock('../../src/renderer/config/config-store.js', () => ({
  useAppSettings: () => DEFAULT_APP_SETTINGS,
}));

const openInto = vi.fn();
const isOpen = vi.fn();

beforeEach(() => {
  openInto.mockReset().mockResolvedValue({ action: 'focus', panelId: 'ed-elsewhere' });
  isOpen.mockReset().mockResolvedValue(false);
  Reflect.set(window, 'throng', { editor: { openInto, isOpen } });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('a row opens in a sub-workspace window, against the PANEL’s root (T236)', () => {
  it('has an opener listening at all — before the fix nothing was registered', () => {
    render(createElement(FindInFilesChrome));

    const listened = requestOpenResult({ relPath: 'src/a.ts', from: 4, to: 10, projectRoot: 'D:/proj-a' });

    expect(listened).toBe(true);
  });

  it('opens the file under the root the PANEL sent, not a root chosen for the window', async () => {
    render(createElement(FindInFilesChrome));

    requestOpenResult({ relPath: 'src/a.ts', from: 4, to: 10, projectRoot: 'D:/proj-a' });

    await vi.waitFor(() => expect(openInto).toHaveBeenCalled());
    expect(openInto.mock.calls[0]?.[0]).toMatchObject({ absPath: 'D:/proj-a/src/a.ts' });
  });

  it('describes Open In targets for that file, rather than answering nothing', async () => {
    render(createElement(FindInFilesChrome));

    const targets = await queryResultOpenTargets('src/a.ts', 'D:/proj-a');

    // The three kinds are the shared builder's business; here it is enough that the window answered
    // for a file it could not resolve before, and asked main the one-buffer question about it.
    expect(targets.map((t) => t.kind)).toContain('new');
    expect(isOpen).toHaveBeenCalledWith('D:/proj-a/src/a.ts');
  });
});
