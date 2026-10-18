import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addPanel,
  createDefaultLayout,
  setActivePanel,
  type LayoutNode,
  type WorkspaceLayout,
} from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { WorkspaceProvider } from '../../src/renderer/state/workspace-store.js';
import { ProjectsProvider, useProjects } from '../../src/renderer/state/projects-store.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { AppTitleBar } from '../../src/renderer/app.js';

/**
 * `[ADMIN]` belongs to the title bar, and to nothing else (026 / #166).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/status-bar-deduped.e2e.ts:70` (035 T055) — `test('when
 * elevated, [ADMIN] is on the title bar only — the status bar has no pill')`.
 *
 * ══ THE OTHER HALF WAS ALREADY HERE, AND SAID SO ══
 *
 * `component/status-bar-content.test.ts:203` proves the STATUS bar carries no ADMIN pill while the
 * daemon reports the app elevated. Its own note explains why it stopped there: the `[ADMIN]` marker
 * is composed in `AppTitleBar` and reaches `TitleBar` as a plain `identity` prop, so proving it
 * needed that composition to be reachable — "a production refactor, not a test migration".
 *
 * This is that refactor, and it is one word: `AppTitleBar` is exported. Nothing else changed. It
 * consumes three hooks and renders `TitleBar`, so mounting it is testing the composition itself
 * rather than a copy of it — which is the whole reason a pure `identityOf(...)` helper would have
 * been the weaker answer: the bug this pins is a marker that reaches the WRONG bar, and only the
 * real wiring can be wrong in that way.
 *
 * ══ WHAT MAKES THE PAIR MEANINGFUL ══
 *
 * #166's finding was that the pill, the dot, the project name and the `Tab · Panel` context were all
 * SECOND COPIES of what the frameless title bar already showed. So the requirement is not "the
 * status bar hides its pill" — it is that exactly ONE surface says it. Neither test states that on
 * its own; together, against the same elevated daemon, they do.
 */

/**
 * A sibling that captures the projects store.
 *
 * `activeProject` follows `openedId`, which ONLY `switchProject` sets — a project the daemon
 * marks `isActive` is not thereby the one this window has open, and conflating the two is how the
 * first draft of this test read "No project" while asserting on a project name.
 */
const captured: { projects: ReturnType<typeof useProjects> | null } = { projects: null };
function Probe(): null {
  captured.projects = useProjects();
  return null;
}

const PROJECT = 'p1';

function servicesOver(bridge: ThrongBridge): Services {
  return {
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
}

function mount(opts: { elevated: boolean; projectName?: string; layout?: WorkspaceLayout }) {
  const layout: WorkspaceLayout =
    opts.layout ?? createDefaultLayout(PROJECT, { tab: 't1', panel: 'pan1' });
  const project = {
    id: PROJECT,
    name: opts.projectName ?? 'Alpha',
    colour: '#6aa3ff',
    rootFolder: 'C:/proj',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    hiddenPaths: [],
  };
  const bridge: ThrongBridge = {
    invoke<T>(method: string): Promise<T> {
      switch (method) {
        case 'projects.list':
          return Promise.resolve({ projects: [project] } as T);
        case 'projects.categories.list':
          return Promise.resolve({ categories: [] } as T);
        case 'workspace.load':
          return Promise.resolve({ layout, restored: true } as T);
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list':
          return Promise.resolve({ subWorkspaces: [] } as T);
        default:
          return Promise.resolve({} as T);
      }
    },
  };
  Reflect.set(window, 'throng', {
    // The seam `useCapabilities` reads. This is what `THRONG_FAKE_ELEVATED=1` produces in the app.
    terminal: { capabilities: () => Promise.resolve({ elevated: opts.elevated }) },
    window: { minimise: vi.fn(), maximise: vi.fn(), close: vi.fn() },
  });
  const services = servicesOver(bridge);
  render(
    createElement(
      ServicesProvider,
      { services },
      createElement(
        ProjectsProvider,
        { client: services.projects },
        createElement(
          WorkspaceProvider,
          { client: services.workspace, activeProjectId: PROJECT },
          createElement(
            ContextMenuProvider,
            null,
            createElement(Fragment, null, createElement(AppTitleBar, null), createElement(Probe, null)),
          ),
        ),
      ),
    ),
  );
}

const identity = (): string => screen.getByTestId('title-bar-identity').textContent ?? '';

/** Open the project in this window — the click in the sidebar, without the sidebar. */
async function openProject(): Promise<void> {
  await waitFor(() => expect(captured.projects?.projects.length).toBe(1));
  await act(async () => {
    await captured.projects!.switchProject(PROJECT);
  });
}

afterEach(() => {
  captured.projects = null;
  Reflect.deleteProperty(window, 'throng');
});

describe('the title bar’s identity carries the elevation marker (#166)', () => {
  it('shows [ADMIN] when the daemon reports the app IS elevated', async () => {
    mount({ elevated: true });
    await openProject();

    await waitFor(() => expect(identity()).toContain('[ADMIN]'));
  });

  it('shows NO marker when it is not — so the one above is about elevation', async () => {
    /*
     * Without this, a title bar that appended `[ADMIN]` unconditionally would pass the test above
     * and tell every user they were running as administrator.
     */
    mount({ elevated: false });
    await openProject();

    await waitFor(() => expect(identity()).toContain('Alpha'));
    expect(identity()).not.toContain('ADMIN');
  });

  it('still names the project and the active context beside the marker', async () => {
    /*
     * The marker is appended to an identity that already has a job. A composition that replaced the
     * identity with `[ADMIN]` rather than extending it would satisfy the first test and lose the
     * thing the title bar exists for — and this is the same string `TitleManager` sends to the OS
     * taskbar, so it would be lost there too.
     */
    mount({ elevated: true, projectName: 'Bravo' });
    await openProject();

    await waitFor(() => expect(identity()).toContain('[ADMIN]'));
    expect(identity()).toContain('Bravo');
    expect(identity(), 'the marker goes at the END, after the context').toMatch(/\[ADMIN\]/);
    expect(identity().indexOf('Bravo')).toBeLessThan(identity().indexOf('[ADMIN]'));
  });
});

/** Make `panelId` an editor holding `filePath`, leaving its stored fallback title as it was. */
function asEditor(node: LayoutNode, panelId: string, filePath: string): LayoutNode {
  if (node.type === 'panel') {
    return node.id === panelId ? { ...node, kind: 'editor', config: { filePath } } : node;
  }
  return { ...node, children: node.children.map((c) => asEditor(c, panelId, filePath)) };
}

/**
 * The title bar names the active panel by the name its header wears (#504).
 *
 * The stored `panel.title` is a generated fallback ("Blank Panel 2") that exists only to keep names
 * unique (048 FR-032, `use-panel-display-names.ts`). A panel holding a file is named after the file
 * in its header, the tab popover and every notice, so the title bar reading the stored title showed
 * a name that appears nowhere else. The identity is the string `TitleManager` sends to the taskbar,
 * so this surface stands for both.
 *
 * Layer: component — the defect is in `AppTitleBar`'s composition; core's `activeContextLabel` has
 * no access to the renderer's live naming sources and cannot observe it.
 */
describe('the title bar names the active panel as its header does (#504)', () => {
  it('shows the file an editor panel holds, not its stored "Blank Panel 2"', async () => {
    let layout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'pan1' });
    layout = addPanel(layout, 't1', 'pan2'); // stored as "Blank Panel 2"
    layout = setActivePanel(layout, 't1', 'pan2');
    layout = {
      ...layout,
      tabs: layout.tabs.map((t) => ({ ...t, root: asEditor(t.root, 'pan2', 'C:/proj/notes.md') })),
    };
    mount({ elevated: false, layout });
    await openProject();

    await waitFor(() => expect(identity()).toContain('Tab 1'));
    // The header names an editor by its file's stem (`editorAutoTitle`), so `notes`, not `notes.md`.
    expect(identity()).toContain('Tab 1 · notes —');
    expect(identity()).not.toContain('Blank Panel');
  });
});
