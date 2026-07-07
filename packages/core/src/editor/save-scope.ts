/**
 * Save-All scope resolution (006 Phase A, FR-023). Pure. Resolves which open
 * editors a `Ctrl+Shift+S` covers for the chosen scope. Sub-workspace-owned
 * editors are in scope ONLY for `tab` (by tab membership); `project`/`all` cover
 * project-owned editors only. The service saves pathed editors and skips+reports
 * unpathed ones (`partitionByPathed`). No OS calls.
 */

export type SaveAllScope = 'tab' | 'project' | 'all';

/** One open editor's identity for scope resolution. */
export interface ScopeEditor {
  panelId: string;
  /** The tab this editor lives in (any window). */
  tabId: string;
  ownerKind: 'project' | 'subworkspace';
  /** Set when `ownerKind === 'project'`. */
  ownerProjectId?: string;
  /** Whether the editor has a real save target yet (unpathed → skipped). */
  pathed: boolean;
}

export interface ScopeContext {
  editors: readonly ScopeEditor[];
  /** The active tab (for `tab` scope). */
  activeTabId: string | null;
  /** The active project (for `project` scope). */
  activeProjectId: string | null;
}

/** Resolve the panelIds an editor Save-All covers for `scope` (pathed or not). */
export function editorsInScope(scope: SaveAllScope, ctx: ScopeContext): string[] {
  const inScope = ctx.editors.filter((e) => {
    switch (scope) {
      case 'tab':
        // Every editor in the active tab — project- or sub-workspace-owned.
        return ctx.activeTabId !== null && e.tabId === ctx.activeTabId;
      case 'project':
        // Project-owned editors of the active project only (never sub-ws-owned).
        return (
          e.ownerKind === 'project' &&
          ctx.activeProjectId !== null &&
          e.ownerProjectId === ctx.activeProjectId
        );
      case 'all':
        // Every project-owned editor across all projects (never sub-ws-owned).
        return e.ownerKind === 'project';
    }
  });
  return inScope.map((e) => e.panelId);
}

/** Split in-scope editors into savable (pathed) and skipped (unpathed) panelIds. */
export function partitionByPathed(
  panelIds: readonly string[],
  editors: readonly ScopeEditor[],
): { pathed: string[]; unpathed: string[] } {
  const byId = new Map(editors.map((e) => [e.panelId, e]));
  const pathed: string[] = [];
  const unpathed: string[] = [];
  for (const id of panelIds) {
    (byId.get(id)?.pathed ? pathed : unpathed).push(id);
  }
  return { pathed, unpathed };
}
