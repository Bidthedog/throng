/**
 * THE invariant behind #176 and #218: a panel the user never typed into is never `titleIsCustom`.
 *
 * Both issues are the same defect reached by different routes, and #218 is the second time it has
 * been closed and come back. Patching the route of the day cannot prevent a third, because the mark
 * is what does the damage wherever it comes from — a custom title outranks the terminal's live
 * window title and the editor's file name for the rest of the panel's life, and it is what puts
 * "Reset Name" in front of a user who has renamed nothing.
 *
 * So this is stated as a property of the OPERATION SURFACE rather than of any one caller:
 * `renamePanel` is the sole writer, every other operation leaves the mark alone, and everything
 * throng does to a name of its own accord goes through `retitlePanel`, which cannot set it.
 */
import { describe, it, expect } from 'vitest';
import {
  addPanel,
  addTab,
  addTabFromPanel,
  clearPanelType,
  collectPanels,
  createDefaultLayout,
  movePanelToEdge,
  movePanelToTab,
  removePanel,
  renamePanel,
  renameTab,
  resetPanelName,
  retitlePanel,
  setPanelType,
} from '@throng/core';
import type { WorkspaceLayout } from '@throng/core';

const panels = (l: WorkspaceLayout) => l.tabs.flatMap((t) => collectPanels(t.root));
const panel = (l: WorkspaceLayout, id: string) => panels(l).find((p) => p.id === id)!;
const base = (): WorkspaceLayout => createDefaultLayout('proj', { tab: 't1', panel: 'p1' });

describe('titleIsCustom is only ever set by a rename', () => {
  it('stays unset through every other operation a panel’s life is made of', () => {
    let l = base();
    l = addPanel(l, 't1', 'p2');
    l = addTab(l, { tab: 't2', panel: 'p3' });
    l = setPanelType(l, 'p1', 'terminal', { flavourId: 'cmd', flavourLabel: 'Command Prompt' });
    l = setPanelType(l, 'p2', 'editor', { filePath: 'C:/proj/alpha.ts' });
    // The name throng moves when it clashes with a panel in another project (#184) — the route that
    // produced #218 once it was relayed to windows as a rename.
    l = retitlePanel(l, 'p1', 'Panel 1 (2)');
    l = retitlePanel(l, 'p3', 'Panel 3 (2)');
    l = renameTab(l, 't1', 'Work');
    l = movePanelToEdge(l, 'p2', 'p1', 'right');
    l = movePanelToTab(l, 'p3', 't1');
    l = addTabFromPanel(l, 'p3', { tab: 't3' });
    l = clearPanelType(l, 'p1'); // the terminal ended — the panel is offered for re-typing
    l = resetPanelName(l, 'p2');
    l = removePanel(l, 'p3');

    expect(panels(l).map((p) => p.titleIsCustom ?? false)).toEqual(panels(l).map(() => false));
    // …and the displayed names still moved where throng moved them.
    expect(panel(l, 'p1').title).toBe('Panel 1 (2)');
  });

  it('a retitle never sets the mark, and never clears one the user earned', () => {
    const renamed = renamePanel(base(), 'p1', 'Build');
    expect(panel(renamed, 'p1').titleIsCustom).toBe(true);

    const adjusted = retitlePanel(renamed, 'p1', 'Build (2)');
    expect(panel(adjusted, 'p1').title).toBe('Build (2)');
    expect(panel(adjusted, 'p1').titleIsCustom).toBe(true); // still the user's name, moved

    expect(panel(retitlePanel(base(), 'p1', 'Panel 1 (2)'), 'p1').titleIsCustom).toBeFalsy();
  });
});
