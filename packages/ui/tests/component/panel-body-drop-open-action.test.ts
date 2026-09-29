/**
 * 047 US5 (T080; FR-077, research R18) — a file dropped onto an EMPTY panel opens in the view its
 * provider's default open action names.
 *
 * ══ WHAT IS UNDER TEST ══
 *
 * `UntypedPanelBody` (in `panel-body.tsx`) used to type the panel as an EDITOR unconditionally — both for a
 * drag from the File Explorer (`TreeDropTarget`) and for an OS-file drop (`PanelDropTarget`). It now asks the
 * question the default open action asks (044 FR-052): `defaultOpenActionFor` — core's decision, an ENABLED
 * provider whose action is Preview — and a Preview answer asks for a preview of the file INTO THIS panel
 * (`requestPreviewOpen` with `intoPanelId`), never an editor. Anything else keeps the editor route.
 *
 * ══ WHAT IS SUBSTITUTED, AND WHY ══
 *
 * - the stores (`useProjects`, `useWorkspace`) — ownership is all the dispatcher needs;
 * - `useAppSettings` — the one thing the setting is read through;
 * - `PanelTypeForm` — the type-selection form pulls the flavour catalogue and half the config stack, none
 *   of which a drop decision touches;
 * - `PanelDropTarget` — an OS drop is judged by main over IPC before `onOpen` fires; a button that calls
 *   `onOpen` stands for "main approved this path", which is the seam this feature changes;
 * - `requestPreviewOpen` — the one `preview.open` command (FR-005): the observable for "a preview was asked
 *   for". `open-preview.test.ts` owns what it does with `intoPanelId`.
 *
 * ══ ANTI-VACUITY ══
 *
 * Each preview case also asserts that `setPanelType` was NOT called with `editor`, and each editor case that
 * no preview was asked for, so neither route can pass by doing both or neither.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Panel } from '@throng/core';
import { PanelBody } from '../../src/renderer/workspace/panel-body.js';
import { TREE_DROP_EVENT } from '../../src/renderer/explorer/tree-drag-store.js';

const fixture = vi.hoisted(() => ({
  root: 'D:/proj',
  projectId: 'proj-1',
  action: 'preview' as 'preview' | 'editor',
  enabled: true,
  setPanelType: vi.fn(),
  convertPanelToProject: vi.fn(),
  requestPreviewOpen: vi.fn(),
}));

vi.mock('../../src/renderer/state/projects-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/state/projects-store.js')>();
  const project = { id: fixture.projectId, name: 'Proj', rootFolder: fixture.root };
  return { ...actual, useProjects: () => ({ projects: [project], activeProject: project, loading: false }) };
});

vi.mock('../../src/renderer/state/workspace-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/state/workspace-store.js')>();
  return {
    ...actual,
    useWorkspace: () => ({
      layout: { tabs: [] },
      setPanelType: fixture.setPanelType,
      convertPanelToProject: fixture.convertPanelToProject,
    }),
  };
});

vi.mock('../../src/renderer/config/config-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/config/config-store.js')>();
  return {
    ...actual,
    useAppSettings: () => ({
      editor: {
        previews: { providers: { markdown: { enabled: fixture.enabled, defaultOpenAction: fixture.action } } },
      },
    }),
  };
});

vi.mock('../../src/renderer/panel-type/panel-type-form.js', () => ({ PanelTypeForm: () => null }));

vi.mock('../../src/renderer/editor/drop-target.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/editor/drop-target.js')>();
  return {
    ...actual,
    PanelDropTarget: ({ onOpen, children }: { onOpen: (absPath: string) => void; children: ReactElement }) =>
      createElement(
        'div',
        null,
        createElement('button', { 'data-testid': 'os-drop', onClick: () => onOpen(`${fixture.root}/os-dropped.md`) }),
        children,
      ),
  };
});

vi.mock('../../src/renderer/preview/open-preview.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/preview/open-preview.js')>();
  return { ...actual, requestPreviewOpen: fixture.requestPreviewOpen };
});

const PANEL: Panel = { id: 'empty-1', kind: undefined, title: 'Panel 1' } as Panel;
const MD = `${fixture.root}/notes.md`;
const TXT = `${fixture.root}/notes.txt`;

function mount(): void {
  render(createElement(PanelBody, { panel: PANEL, tabId: 'tab-1', onDestroy: vi.fn() }));
}

/** The File Explorer's drag-and-drop seam: what a tree drop onto this panel dispatches (`tree-drop-target.tsx`). */
function dropFromTree(absPath: string): void {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(TREE_DROP_EVENT, { detail: { panelId: PANEL.id, paths: [absPath], singleFile: true } }),
    );
  });
}

const editorTyped = (): unknown[][] => fixture.setPanelType.mock.calls.filter((c) => c[1] === 'editor');

beforeEach(() => {
  fixture.action = 'preview';
  fixture.enabled = true;
  fixture.setPanelType.mockReset();
  fixture.convertPanelToProject.mockReset();
  fixture.requestPreviewOpen.mockReset();
  fixture.requestPreviewOpen.mockResolvedValue(true);
  Reflect.set(window, 'throng', { panel: { notifyTyped: vi.fn() } });
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('a tree drop onto an empty panel follows the default open action (FR-077)', () => {
  it('Preview: asks for a preview INTO this panel, and does not type an editor', () => {
    mount();
    dropFromTree(MD);

    expect(fixture.requestPreviewOpen).toHaveBeenCalledTimes(1);
    expect(fixture.requestPreviewOpen).toHaveBeenCalledWith({
      absPath: MD,
      projectId: fixture.projectId,
      target: { mode: 'new' },
      intoPanelId: PANEL.id,
    });
    expect(editorTyped()).toEqual([]);
  });

  it('Editor: types the panel as an editor and asks for no preview', () => {
    fixture.action = 'editor';
    mount();
    dropFromTree(MD);

    expect(editorTyped()).toEqual([[PANEL.id, 'editor', { filePath: MD }]]);
    expect(fixture.requestPreviewOpen).not.toHaveBeenCalled();
  });

  it('a provider turned off suspends the choice: an editor, whatever the stored action says', () => {
    fixture.enabled = false;
    mount();
    dropFromTree(MD);

    expect(editorTyped()).toEqual([[PANEL.id, 'editor', { filePath: MD }]]);
    expect(fixture.requestPreviewOpen).not.toHaveBeenCalled();
  });

  it('a file no provider claims is an editor even while Markdown says Preview', () => {
    mount();
    dropFromTree(TXT);

    expect(editorTyped()).toEqual([[PANEL.id, 'editor', { filePath: TXT }]]);
    expect(fixture.requestPreviewOpen).not.toHaveBeenCalled();
  });
});

describe('an OS-file drop onto an empty panel follows it too (FR-077)', () => {
  it('Preview: a preview into this panel', () => {
    mount();
    fireEvent.click(document.querySelector('[data-testid="os-drop"]')!);

    expect(fixture.requestPreviewOpen).toHaveBeenCalledWith({
      absPath: `${fixture.root}/os-dropped.md`,
      projectId: fixture.projectId,
      target: { mode: 'new' },
      intoPanelId: PANEL.id,
    });
    expect(editorTyped()).toEqual([]);
  });

  it('Editor: an editor, as before', () => {
    fixture.action = 'editor';
    mount();
    fireEvent.click(document.querySelector('[data-testid="os-drop"]')!);

    expect(editorTyped()).toEqual([[PANEL.id, 'editor', { filePath: `${fixture.root}/os-dropped.md` }]]);
    expect(fixture.requestPreviewOpen).not.toHaveBeenCalled();
  });
});
