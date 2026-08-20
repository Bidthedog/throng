import { render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceLayout } from '@throng/core';
import type { ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { WorkspaceProvider } from '../../src/renderer/state/workspace-store.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import {
  usePanelPlace,
  panelSubject,
  terminalSubject,
  type PanelPlace,
} from '../../src/renderer/common/panel-subject.js';

/**
 * WHERE a panel is, so a notice can say which one it means (030 US2 / #195, FR-021/022/026/027).
 *
 * PLACE AT: `packages/ui/tests/component/panel-subject.test.ts`
 * NEW COVERAGE (035). `panel-subject.ts` has four dependents and had no test.
 *
 * ══ THE TRAP THIS MODULE EXISTS TO PREVENT ══
 *
 * FR-022 wants a panel named `Project — Tab — Panel`, and the three facts live in three places: the
 * panel's title in the layout, the tab's title one level up, and the project's NAME — not its id —
 * in the projects store. Every surface raising a notice would otherwise assemble that itself.
 *
 * The module's header says exactly where that goes wrong: *"a sub-workspace window, which may hold
 * panels from several projects at once (INV-5), is exactly where a locally-assembled version would
 * quietly name the wrong one."* The project must come from the panel's **originProjectId**, never
 * from whichever project the window happens to have active — and those two agree in the ordinary
 * case, which is what makes the bug survivable until the day it isn't.
 *
 * So the sub-workspace test below is not an edge case. It is the reason the file exists, and it is
 * the only test here that can tell a correct implementation from `activeProject.name`.
 */

const ALPHA = 'project-alpha';
const BETA = 'project-beta';

function dto(id: string, name: string): ProjectDto {
  return {
    id,
    name,
    colour: '#4488cc',
    rootFolder: `D:/work/${id}`,
    isActive: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    hiddenPaths: [],
  };
}

/** A layout with one tab holding one panel, whose ORIGIN project is `originProjectId`. */
function layoutWith(originProjectId: string): WorkspaceLayout {
  return {
    projectId: ALPHA,
    schemaVersion: 1,
    tabs: [
      {
        id: 'tab-1',
        title: 'Build',
        root: { type: 'panel', id: 'panel-1', originProjectId, title: 'Server' },
        activePanelId: 'panel-1',
      },
    ],
    activeTabId: 'tab-1',
  } as WorkspaceLayout;
}

function services(layout: WorkspaceLayout, projects: ProjectDto[]): Services {
  const bridge: ThrongBridge = {
    invoke<TResult>(method: string): Promise<TResult> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout, restored: true } as TResult);
        case 'projects.list':
          return Promise.resolve({ projects } as TResult);
        default:
          return Promise.resolve({} as TResult);
      }
    },
  };
  return {
    bridge,
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
}

/** Renders whatever `usePanelPlace` returns, so the test can read it out of the DOM. */
function Probe({ panelId }: { panelId: string }): ReactElement {
  const place = usePanelPlace(panelId);
  return createElement(
    'div',
    { 'data-testid': 'place' },
    place ? JSON.stringify(place) : 'undefined',
  );
}

async function mount(
  layout: WorkspaceLayout,
  projects: ProjectDto[],
  panelId = 'panel-1',
): Promise<PanelPlace | undefined> {
  const svc = services(layout, projects);
  // ANTI-VACUITY CONTROL: remove the WorkspaceProvider element and `useWorkspace` throws inside the
  // probe, so every test here fails at `waitFor` rather than quietly reading `undefined` — which is
  // a legitimate answer this module gives, and would otherwise be indistinguishable from a broken
  // harness.
  render(
    createElement(
      ServicesProvider,
      { services: svc },
      createElement(
        WorkspaceProvider,
        { client: svc.workspace, activeProjectId: ALPHA },
        createElement(
          ProjectsProvider,
          { client: svc.projects },
          createElement(Probe, { panelId }),
        ),
      ),
    ),
  );

  await waitFor(() => expect(screen.getByTestId('place')).toBeInTheDocument());
  const read = (): string => screen.getByTestId('place').textContent ?? '';
  await waitFor(() => expect(read()).not.toBe(''));
  return read() === 'undefined' ? undefined : (JSON.parse(read()) as PanelPlace);
}

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('locating a panel (FR-022)', () => {
  it('names the panel, its tab, and its project', async () => {
    const place = await mount(layoutWith(ALPHA), [dto(ALPHA, 'Alpha'), dto(BETA, 'Beta')]);

    expect(place).toEqual({ name: 'Server', tab: 'Build', project: 'Alpha' });
  });

  it('names the panel’s ORIGIN project, not the window’s active one (INV-5/6)', async () => {
    /*
     * The reason this module exists, and the only assertion here that a naive implementation fails.
     *
     * The window's active project is Alpha throughout — `activeProjectId: ALPHA` in `mount`. The
     * panel came from Beta. A sub-workspace window can hold panels from several projects at once,
     * so "the project" is a property of the PANEL and reading it off the window names the wrong one
     * — silently, and only in the window where it matters.
     */
    const place = await mount(layoutWith(BETA), [dto(ALPHA, 'Alpha'), dto(BETA, 'Beta')]);

    expect(place?.project).toBe('Beta');
  });

  it('gives the project NAME rather than its id', async () => {
    // FR-022 asks for a name a user recognises. An id would satisfy "the project is identified"
    // and satisfy nobody reading the notice.
    const place = await mount(layoutWith(ALPHA), [dto(ALPHA, 'Alpha')]);

    expect(place?.project).toBe('Alpha');
    expect(place?.project).not.toBe(ALPHA);
  });

  it('leaves the project out when its record is not loaded', async () => {
    // A panel can outlive the project list this window holds. Better an unqualified `Tab — Panel`
    // than a confident wrong name.
    const place = await mount(layoutWith('project-unknown'), [dto(ALPHA, 'Alpha')]);

    expect(place).toEqual({ name: 'Server', tab: 'Build', project: undefined });
  });

  it('returns undefined for a panel that is not in this window', async () => {
    /*
     * `undefined` is a real answer and the caller must handle it: a panel can be destroyed between
     * the failure and the render that reports it, and inventing a name for one that no longer
     * exists is the placeholder FR-027 forbids.
     */
    const place = await mount(layoutWith(ALPHA), [dto(ALPHA, 'Alpha')], 'panel-gone');

    expect(place).toBeUndefined();
  });
});

describe('turning a place into a notice subject', () => {
  const place: PanelPlace = { name: 'Server', tab: 'Build', project: 'Alpha' };

  it('describes the panel', () => {
    expect(panelSubject(place)).toEqual({
      kind: 'panel',
      name: 'Server',
      tab: 'Build',
      project: 'Alpha',
    });
  });

  it('says NOTHING rather than inventing a placeholder for a panel that has gone (FR-027)', () => {
    // `{ kind: 'none' }` is a deliberate answer. A notice about a destroyed panel says what went
    // wrong without pretending to know which panel it was.
    expect(panelSubject(undefined)).toEqual({ kind: 'none' });
  });

  it('makes the FLAVOUR the subject of a terminal notice, with the panel as a qualifier (FR-026)', () => {
    /*
     * Without the flavour, a terminal notice says "the terminal exited" about a panel that can host
     * any of several shells — the same "which one?" question #195 is about, one level down.
     */
    expect(terminalSubject(place, 'pwsh')).toEqual({
      kind: 'terminal',
      flavour: 'pwsh',
      panel: 'Server',
      tab: 'Build',
      project: 'Alpha',
    });
  });

  it('falls back to the panel when there is no flavour to name', () => {
    expect(terminalSubject(place, undefined)).toEqual({
      kind: 'panel',
      name: 'Server',
      tab: 'Build',
      project: 'Alpha',
    });
  });

  it('still names the flavour when the panel itself has gone', () => {
    // The terminal is the subject; the panel is only a qualifier, so losing the qualifier must not
    // cost the notice its subject.
    expect(terminalSubject(undefined, 'cmd')).toEqual({
      kind: 'terminal',
      flavour: 'cmd',
      panel: undefined,
      tab: undefined,
      project: undefined,
    });
  });
});
