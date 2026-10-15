/**
 * `useUnloadProject()` (055 FR-063): the project list's Unload and the Resource Monitor's Unload Project
 * are ONE function over the same collaborators.
 *
 * Layer: component — a real hook run in a real render; every store it reads is replaced at the module
 * seam by a stub that records what it was asked, because what is being claimed is WHICH collaborators
 * reach the unload orchestrator (and that none is invented here), not what the orchestrator does with
 * them — `unload-project.test.ts` owns that.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seam = vi.hoisted(() => ({
  runUnload: vi.fn(() => Promise.resolve()),
  unloadProject: vi.fn(),
  reportFailure: vi.fn(),
  disposeEditor: vi.fn(),
  settings: { projects: { unloadTerminalAction: 'keepRunning' as 'keepRunning' | 'endTerminals' } },
  dirtyKey: 'dirty-1,dirty-2',
  subWorkspaces: [{ id: 's1' }],
  editorStates: [
    { panelId: 'e1', ownerProjectId: 'p1' },
    { panelId: 'e2', ownerProjectId: 'p2' },
    { panelId: 'e3', ownerProjectId: 'p1' },
  ],
}));

vi.mock('../../../src/renderer/sidebar/unload-project.js', () => ({ unloadProject: seam.runUnload }));
vi.mock('../../../src/renderer/state/projects-store.js', () => ({
  useProjects: () => ({ unloadProject: seam.unloadProject, reportFailure: seam.reportFailure }),
}));
vi.mock('../../../src/renderer/config/config-store.js', () => ({ useAppSettings: () => seam.settings }));
vi.mock('../../../src/renderer/workspace/detach-context.js', () => ({ useDetach: () => ({ subWorkspaces: seam.subWorkspaces }) }));
vi.mock('../../../src/renderer/editor/editor-state.js', () => ({
  allEditorStates: () => seam.editorStates,
  useDirtyProjectKey: () => seam.dirtyKey,
}));
vi.mock('../../../src/renderer/editor/use-editor.js', () => ({ disposeEditor: seam.disposeEditor }));

import { useUnloadProject } from '../../../src/renderer/sidebar/use-unload-project.js';

beforeEach(() => {
  seam.runUnload.mockClear();
});

describe('useUnloadProject', () => {
  it('hands the orchestrator the project, the variant and the one set of collaborators', () => {
    const { result } = renderHook(() => useUnloadProject());

    result.current({ id: 'p1', name: 'Alpha' }, 'endTerminals');

    expect(seam.runUnload).toHaveBeenCalledTimes(1);
    const [id, name, variant, collaborators] = seam.runUnload.mock.calls[0] as unknown as [string, string, string, Record<string, unknown>];
    expect([id, name, variant]).toEqual(['p1', 'Alpha', 'endTerminals']);
    expect(collaborators.settings).toEqual({ projects: { unloadTerminalAction: 'keepRunning' } });
    expect(collaborators.subWorkspaces).toEqual(seam.subWorkspaces);
    expect(collaborators.unloadProject).toBe(seam.unloadProject);
    expect(collaborators.reportFailure).toBe(seam.reportFailure);
    expect(collaborators.disposeEditor).toBe(seam.disposeEditor);
  });

  it('names only the editors the project owns, not every editor in the window', () => {
    const { result } = renderHook(() => useUnloadProject());
    result.current({ id: 'p1', name: 'Alpha' });
    const collaborators = seam.runUnload.mock.calls[0]![3] as { editorPanelIds: string[] };
    expect(collaborators.editorPanelIds).toEqual(['e1', 'e3']);
  });

  it('reads dirtiness from the same set the unsaved dot reads', () => {
    const { result } = renderHook(() => useUnloadProject());
    result.current({ id: 'p1', name: 'Alpha' });
    const { isDirty } = seam.runUnload.mock.calls[0]![3] as { isDirty: (id: string) => boolean };
    expect(isDirty('dirty-2')).toBe(true);
    expect(isDirty('p1')).toBe(false);
  });

  it('runs the configured default when no variant is given', () => {
    const { result } = renderHook(() => useUnloadProject());
    result.current({ id: 'p2', name: 'Beta' });
    expect(seam.runUnload.mock.calls[0]![2]).toBeUndefined();
  });

  it('reads the editors at call time, so one opened since the last render is found', () => {
    const { result } = renderHook(() => useUnloadProject());
    seam.editorStates.push({ panelId: 'e4', ownerProjectId: 'p1' });
    result.current({ id: 'p1', name: 'Alpha' });
    expect((seam.runUnload.mock.calls[0]![3] as { editorPanelIds: string[] }).editorPanelIds).toContain('e4');
    seam.editorStates.pop();
  });
});
