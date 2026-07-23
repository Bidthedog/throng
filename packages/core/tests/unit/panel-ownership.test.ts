import { describe, it, expect } from 'vitest';
import {
  createDefaultLayout,
  convertPanelToProject,
  setPanelType,
  collectPanels,
  isMainLayoutValid,
  type WorkspaceLayout,
} from '@throng/core';

function base(projectId: string): WorkspaceLayout {
  return createDefaultLayout(projectId, { tab: 't1', panel: 'p1' });
}
function panel(layout: WorkspaceLayout, id: string) {
  return layout.tabs.flatMap((t) => collectPanels(t.root)).find((p) => p.id === id);
}

/**
 * US4 / FR-012 (spec 024): a tree file dropped on an untyped SUB-WORKSPACE-owned panel converts the
 * panel to PROJECT-owned (rewrites originProjectId) so it can host a project file without violating
 * INV-4 (no cross-project panel in the main layout).
 */
describe('convertPanelToProject (024 US4)', () => {
  it('rewrites an untyped panel’s originProjectId to the target project', () => {
    // A default layout for project "proj" owns its panel by "proj"; simulate sub-workspace ownership
    // by starting from a different origin, then convert.
    const l0 = base('proj');
    const foreign = { ...l0, tabs: l0.tabs.map((t) => ({ ...t, root: { ...t.root } })) };
    // Force the panel's origin to a sub-workspace synthetic id, then convert back to the project.
    const withSub = convertPanelToProject(foreign, 'p1', 'subwin-synthetic');
    expect(panel(withSub, 'p1')!.originProjectId).toBe('subwin-synthetic');

    const converted = convertPanelToProject(withSub, 'p1', 'proj');
    expect(panel(converted, 'p1')!.originProjectId).toBe('proj');
  });

  it('leaves the converted panel valid in the main layout (INV-4)', () => {
    const converted = convertPanelToProject(base('proj'), 'p1', 'proj');
    const typed = setPanelType(converted, 'p1', 'editor', { filePath: 'D:/proj/a.ts' });
    expect(isMainLayoutValid(typed)).toBe(true);
  });

  it('is a no-op on an already-typed panel (ownership is fixed once content is live)', () => {
    const typed = setPanelType(base('proj'), 'p1', 'editor', { filePath: 'D:/proj/a.ts' });
    const again = convertPanelToProject(typed, 'p1', 'other');
    expect(panel(again, 'p1')!.originProjectId).toBe(panel(typed, 'p1')!.originProjectId);
  });

  it('does not mutate the input layout', () => {
    const original = base('proj');
    const before = panel(original, 'p1')!.originProjectId;
    convertPanelToProject(original, 'p1', 'changed');
    expect(panel(original, 'p1')!.originProjectId).toBe(before);
  });
});
