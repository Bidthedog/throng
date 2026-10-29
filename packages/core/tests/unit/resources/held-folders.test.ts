import { describe, it, expect } from 'vitest';
import { heldFolders } from '../../../src/resources/index.js';

const context = {
  tabs: [
    { id: 't1', name: 'Build', subWorkspaceName: null },
    { id: 't2', name: 'Logs', subWorkspaceName: 'Scratch' },
  ],
  panels: [
    { id: 'n1', tabId: 't1', name: 'pwsh' },
    { id: 'n2', tabId: 't2', name: 'tail' },
  ],
};

describe('heldFolders (055 FR-070 – FR-072)', () => {
  it('lists each held folder with its project and every holding panel by tab and panel name', () => {
    expect(
      heldFolders([{ path: 'D:/a', projectId: 'p1', panelIds: ['n1', 'n2'] }], context),
    ).toEqual([
      {
        path: 'D:/a',
        projectId: 'p1',
        panels: [
          { panelId: 'n1', tabName: 'Build', panelName: 'pwsh' },
          { panelId: 'n2', tabName: 'Scratch › Logs', panelName: 'tail' },
        ],
      },
    ]);
  });

  it('lists a folder whatever the windows report: a holding panel no window names keeps its place, by a fallback name (convergence T093)', () => {
    expect(
      heldFolders(
        [
          { path: 'D:/a', projectId: 'p2', panelIds: ['elsewhere'] },
          { path: 'D:/b', projectId: 'p1', panelIds: ['elsewhere', 'n1'] },
        ],
        { tabs: [], panels: [] },
      ).map((f) => [f.path, f.panels.map((p) => p.panelId)]),
    ).toEqual([
      ['D:/a', ['elsewhere']],
      ['D:/b', ['elsewhere', 'n1']],
    ]);
    expect(heldFolders([{ path: 'D:/a', projectId: 'p2', panelIds: ['elsewhere'] }], context)[0]!.panels).toEqual([
      { panelId: 'elsewhere', tabName: 'Not open in a window', panelName: 'Terminal' },
    ]);
  });

  it('drops a folder once no terminal holds it (FR-072)', () => {
    expect(heldFolders([{ path: 'D:/a', projectId: 'p1', panelIds: [] }], context)).toEqual([]);
  });
});
