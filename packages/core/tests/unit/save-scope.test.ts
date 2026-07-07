import { describe, it, expect } from 'vitest';
import {
  editorsInScope,
  partitionByPathed,
  type ScopeEditor,
  type ScopeContext,
} from '../../src/editor/save-scope.js';

const editors: ScopeEditor[] = [
  { panelId: 'p1', tabId: 't1', ownerKind: 'project', ownerProjectId: 'A', pathed: true },
  { panelId: 'p2', tabId: 't1', ownerKind: 'project', ownerProjectId: 'A', pathed: false },
  { panelId: 'p3', tabId: 't2', ownerKind: 'project', ownerProjectId: 'B', pathed: true },
  { panelId: 'p4', tabId: 't1', ownerKind: 'subworkspace', pathed: true },
];

const ctx: ScopeContext = { editors, activeTabId: 't1', activeProjectId: 'A' };

describe('Save-All scope resolution (006, FR-023)', () => {
  it('tab scope covers every editor in the active tab, incl. sub-workspace-owned', () => {
    expect(editorsInScope('tab', ctx).sort()).toEqual(['p1', 'p2', 'p4']);
  });

  it('project scope covers project-owned editors of the active project only (never sub-ws)', () => {
    // p1,p2 are project A; p4 is sub-ws (excluded); p3 is project B (excluded).
    expect(editorsInScope('project', ctx).sort()).toEqual(['p1', 'p2']);
  });

  it('all scope covers every project-owned editor across projects (never sub-ws)', () => {
    expect(editorsInScope('all', ctx).sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('sub-workspace-owned editors are never in project/all scope', () => {
    expect(editorsInScope('project', ctx)).not.toContain('p4');
    expect(editorsInScope('all', ctx)).not.toContain('p4');
  });

  it('partitions in-scope editors into savable (pathed) and skipped (unpathed)', () => {
    const ids = editorsInScope('tab', ctx);
    const { pathed, unpathed } = partitionByPathed(ids, editors);
    expect(pathed.sort()).toEqual(['p1', 'p4']);
    expect(unpathed).toEqual(['p2']);
  });

  it('handles a null active tab/project gracefully', () => {
    const empty: ScopeContext = { editors, activeTabId: null, activeProjectId: null };
    expect(editorsInScope('tab', empty)).toEqual([]);
    expect(editorsInScope('project', empty)).toEqual([]);
    // all scope does not depend on active context.
    expect(editorsInScope('all', empty).sort()).toEqual(['p1', 'p2', 'p3']);
  });
});
