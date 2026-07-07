import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SUBWORKSPACE_COLOUR,
  SUBWORKSPACE_PALETTE,
  detachPanel,
  createDefaultLayout,
  addPanel,
  nextSubWorkspaceName,
  pickUnusedColour,
  recolourSubWorkspace,
  removePanelFromSubWorkspace,
  renameSubWorkspace,
  type SubWorkspace,
} from '@throng/core';

const bounds = { x: 0, y: 0, width: 800, height: 600 };

function panel(id: string, project = 'proj') {
  return { type: 'panel' as const, id, originProjectId: project, title: id };
}

function twoPanelSub(): SubWorkspace {
  return {
    id: 's1',
    ownerUser: 'u',
    name: 'X',
    colour: '#ffffff',
    bounds,
    tabs: [
      {
        id: 't',
        title: 'T',
        root: { type: 'split', orientation: 'row', children: [panel('p1'), panel('p2')], sizes: [0.5, 0.5] },
      },
    ],
  };
}

describe('sub-workspace identity & lifecycle (FR-012/018)', () => {
  it('auto-names "Sub-workspace N" from the highest existing index', () => {
    expect(nextSubWorkspaceName([])).toBe('Sub-workspace 1');
    expect(nextSubWorkspaceName([{ name: 'Sub-workspace 1' }, { name: 'Sub-workspace 3' }])).toBe(
      'Sub-workspace 4',
    );
    expect(nextSubWorkspaceName([{ name: 'Custom' }])).toBe('Sub-workspace 1');
  });

  it('picks the first unused palette colour, else falls back to palette[0]', () => {
    expect(pickUnusedColour([])).toBe(SUBWORKSPACE_PALETTE[0]);
    expect(pickUnusedColour([SUBWORKSPACE_PALETTE[0]])).toBe(SUBWORKSPACE_PALETTE[1]);
    expect(pickUnusedColour([...SUBWORKSPACE_PALETTE])).toBe(SUBWORKSPACE_PALETTE[0]);
  });

  it('rename ignores blanks; recolour replaces', () => {
    const sub = twoPanelSub();
    expect(renameSubWorkspace(sub, '  ').name).toBe('X');
    expect(renameSubWorkspace(sub, 'New').name).toBe('New');
    expect(recolourSubWorkspace(sub, '#123456').colour).toBe('#123456');
  });

  it('removePanelFromSubWorkspace prunes, and returns null when the last panel goes', () => {
    const sub = twoPanelSub();
    const afterOne = removePanelFromSubWorkspace(sub, 'p1');
    expect(afterOne).not.toBeNull();
    expect(afterOne && afterOne.tabs[0].root).toEqual(panel('p2'));
    const afterBoth = removePanelFromSubWorkspace(afterOne as SubWorkspace, 'p2');
    expect(afterBoth).toBeNull();
  });

  it('detach assigns name/colour defaults and an active panel', () => {
    let layout = createDefaultLayout('proj', { tab: 't1', panel: 'p1' });
    layout = addPanel(layout, 't1', 'p2');
    const { subWorkspace } = detachPanel(layout, 'p2', { subWorkspace: 's1', tab: 'st1' }, 'u', bounds);
    expect(subWorkspace).not.toBeNull();
    expect(subWorkspace?.name).toBe('Sub-workspace');
    expect(subWorkspace?.colour).toBe(DEFAULT_SUBWORKSPACE_COLOUR);
    expect(subWorkspace?.tabs[0].activePanelId).toBe('p2');
  });
});
