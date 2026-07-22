/**
 * Reset Name (panel header) — a renamed panel remembers the default it was given at creation, so
 * the user can undo a rename. Renaming marks the title custom and captures the original default the
 * FIRST time; resetting restores that default and clears the custom mark. This is also what lets a
 * terminal panel fall back to showing its live window title again after a reset.
 */
import { describe, it, expect } from 'vitest';
import { createDefaultLayout, renamePanel, resetPanelName, collectPanels } from '@throng/core';
import type { WorkspaceLayout } from '@throng/core';

function base(): WorkspaceLayout {
  return createDefaultLayout('proj', { tab: 't1', panel: 'p1' });
}
function panel(layout: WorkspaceLayout, id: string) {
  return layout.tabs.flatMap((t) => collectPanels(t.root)).find((p) => p.id === id)!;
}

describe('resetPanelName', () => {
  it('rename marks the title custom and captures the original default once', () => {
    const before = panel(base(), 'p1').title; // e.g. "Panel 1"
    let l = renamePanel(base(), 'p1', 'My Shell');
    expect(panel(l, 'p1').title).toBe('My Shell');
    expect(panel(l, 'p1').titleIsCustom).toBe(true);
    expect(panel(l, 'p1').defaultTitle).toBe(before);

    // A second rename keeps the FIRST captured default, not the intermediate custom name.
    l = renamePanel(l, 'p1', 'Another Name');
    expect(panel(l, 'p1').defaultTitle).toBe(before);
  });

  it('reset restores the captured default and clears the custom mark', () => {
    const original = panel(base(), 'p1').title;
    const renamed = renamePanel(base(), 'p1', 'My Shell');
    const reset = resetPanelName(renamed, 'p1');
    expect(panel(reset, 'p1').title).toBe(original);
    expect(panel(reset, 'p1').titleIsCustom).toBeFalsy();
  });

  it('reset on a never-renamed panel leaves it unchanged', () => {
    const l = base();
    const reset = resetPanelName(l, 'p1');
    expect(panel(reset, 'p1').title).toBe(panel(l, 'p1').title);
    expect(panel(reset, 'p1').titleIsCustom).toBeFalsy();
  });
});
