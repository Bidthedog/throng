import { describe, it, expect } from 'vitest';
import {
  canDestroyProject,
  findProjectPanelsInSubWorkspaces,
  planConfirmations,
  type DestroyConfirmSettings,
} from '@throng/core';

const settings: DestroyConfirmSettings = {
  destroyProject: 'double',
  destroyTab: 'single',
  destroyPanel: 'single',
};

describe('destroy confirmation plan (FR-019–025)', () => {
  it('panel: no dialog when inactive; one when active', () => {
    expect(planConfirmations('panel', settings, { panelActive: false })).toEqual({ dialogs: 0, wryFinal: false });
    expect(planConfirmations('panel', settings, { panelActive: true })).toEqual({ dialogs: 1, wryFinal: false });
  });

  it('tab: per level, including a wry second on double', () => {
    expect(planConfirmations('tab', settings).dialogs).toBe(1); // single
    expect(planConfirmations('tab', { ...settings, destroyTab: 'none' }).dialogs).toBe(0);
    expect(planConfirmations('tab', { ...settings, destroyTab: 'double' })).toEqual({
      dialogs: 2,
      wryFinal: true,
    });
  });

  it('panel: double adds the wry second when active', () => {
    expect(planConfirmations('panel', { ...settings, destroyPanel: 'double' }, { panelActive: true })).toEqual({
      dialogs: 2,
      wryFinal: true,
    });
    // still nothing when inactive, regardless of level
    expect(planConfirmations('panel', { ...settings, destroyPanel: 'double' }, { panelActive: false })).toEqual({
      dialogs: 0,
      wryFinal: false,
    });
  });

  it('project: double → summary + wry; single → summary only; none → none', () => {
    expect(planConfirmations('project', settings)).toEqual({ dialogs: 2, wryFinal: true });
    expect(planConfirmations('project', { ...settings, destroyProject: 'single' })).toEqual({ dialogs: 1, wryFinal: false });
    expect(planConfirmations('project', { ...settings, destroyProject: 'none' })).toEqual({ dialogs: 0, wryFinal: false });
  });
});

describe('project destroy block (FR-025a)', () => {
  const subs = [
    { id: 's1', name: 'Scratch', tabs: [{ id: 'a', originProjectIds: ['proj', 'other'] }, { id: 'b', originProjectIds: ['other'] }] },
    { id: 's2', name: 'Notes', tabs: [{ id: 'c', originProjectIds: ['other'] }] },
  ];

  it('lists the sub-workspaces/tabs holding the project panels', () => {
    const blocking = findProjectPanelsInSubWorkspaces('proj', subs);
    expect(blocking).toEqual([{ subWorkspaceId: 's1', subWorkspaceName: 'Scratch', tabIds: ['a'] }]);
    expect(canDestroyProject(blocking)).toBe(false);
  });

  it('allows destroy when no panels of the project remain in sub-workspaces', () => {
    const blocking = findProjectPanelsInSubWorkspaces('lonely', subs);
    expect(blocking).toEqual([]);
    expect(canDestroyProject(blocking)).toBe(true);
  });
});
