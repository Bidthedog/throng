/**
 * 043 T061 — the panel-body dispatcher routes `kind: 'findInFiles'` to the panel (FR-017's other
 * half).
 *
 * ══ WHY A DISPATCH BRANCH DESERVES ITS OWN TEST ══
 *
 * `PanelBody` ends in `return <span className="panel-box__placeholder">Empty Panel</span>` — so a
 * kind nobody added a branch for does not fail, it renders the words "Empty Panel" inside a panel
 * whose HEADER says Find in Files, drawn from the registry that already knows about it. Every other
 * test in this feature renders `FindInFilesPanel` directly and would pass with the branch missing.
 *
 * The two stores are substituted because ownership — which project a panel belongs to — is the only
 * thing the dispatcher needs to route this kind, and standing up the real workspace and project
 * stores would be rebuilding the harness this layer exists to avoid.
 */
import { screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIND_IN_FILES_KIND } from '@throng/core';
import { PanelBody } from '../../src/renderer/workspace/panel-body.js';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  PROJECT_ROOT,
  findInFilesPanel,
  installFileSearchStub,
  removeFileSearchStub,
  renderWithContextMenu,
  type FileSearchStub,
} from './helpers/find-in-files.js';

/*
 * `vi.hoisted`, because a `vi.mock` factory runs during the import phase — before any `const` in
 * this file's body has been initialised. A plain constant referenced from a factory is in its
 * temporal dead zone at that moment, which fails as a ReferenceError inside the mock rather than
 * anywhere near the line that caused it.
 */
const fixture = vi.hoisted(() => ({ projectId: 'proj-1', root: 'D:/proj', loading: false }));

vi.mock('../../src/renderer/state/projects-store.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/renderer/state/projects-store.js')>();
  return {
    ...actual,
    useProjects: () => ({
      projects: [{ id: fixture.projectId, name: 'Proj', rootFolder: fixture.root }],
      activeProject: { id: fixture.projectId, name: 'Proj', rootFolder: fixture.root },
      loading: fixture.loading,
    }),
  };
});

vi.mock('../../src/renderer/state/workspace-store.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/renderer/state/workspace-store.js')>();
  return { ...actual, useWorkspace: () => ({ layout: { tabs: [] } }) };
});

let bridge: FileSearchStub;

beforeEach(() => {
  fixture.loading = false;
  __resetFindInFilesState();
  bridge = installFileSearchStub();
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
});

describe('PanelBody routes a Find in Files panel to its own body (T061)', () => {
  it('renders the panel rather than the neutral placeholder', () => {
    renderWithContextMenu(
      createElement(PanelBody, { panel: findInFilesPanel(), tabId: 'tab-1' }),
    );

    expect(screen.getByTestId(`fif-panel-${PANEL_ID}`)).toBeInTheDocument();
    expect(screen.queryByText('Empty Panel')).toBeNull();
  });

  it('uses the registered kind, not a hand-spelled string', () => {
    // If the constant and the branch ever disagree the panel silently falls through to the
    // placeholder, so the test names the constant the registry uses.
    renderWithContextMenu(
      createElement(PanelBody, {
        panel: findInFilesPanel({ kind: FIND_IN_FILES_KIND }),
        tabId: 'tab-1',
      }),
    );

    expect(screen.getByTestId(`fif-panel-${PANEL_ID}`)).toBeInTheDocument();
  });

  it('waits for the project list before searching anything (FR-018)', () => {
    // Ownership decides which tree is searched. While the list is loading, "outside every project"
    // is vacuously true of every path on disk — the same reason the editor branch waits.
    fixture.loading = true;
    renderWithContextMenu(createElement(PanelBody, { panel: findInFilesPanel(), tabId: 'tab-1' }));

    expect(screen.queryByTestId(`fif-panel-${PANEL_ID}`)).toBeNull();
    expect(screen.getByTestId(`find-in-files-loading-${PANEL_ID}`)).toBeInTheDocument();
    expect(bridge.start).not.toHaveBeenCalled();
    // The fixture's root is the one the panel would have been given had it mounted.
    expect(PROJECT_ROOT).toBe(fixture.root);
  });
});
