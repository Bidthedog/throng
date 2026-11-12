/**
 * Per-project side-pane state (067 FR-056 to FR-060).
 *
 * With a project active, whether the Projects and File Explorer panes are expanded is part of that
 * project's layout, so activating a project restores its panes. With none loaded (no project, or the
 * layout still arriving) the window's own persisted flags answer, exactly as before (FR-059). Pane
 * WIDTH stays global (003 FR-008).
 *
 * `App` renders the workspace provider itself, so it cannot read the layout; {@link SidePanesBridge}
 * sits inside the provider and hands App what it needs.
 */
import { useEffect } from 'react';
import { effectiveSidePanes, type SidePanes } from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';

export interface PanePref {
  value: boolean;
  set: (v: boolean) => void;
}

export interface SidePanesSync {
  /** The active project's panes, or `null` while no layout is loaded. */
  panes: SidePanes | null;
  set: (patch: Partial<SidePanes>) => void;
}

export const NO_SIDE_PANES: SidePanesSync = { panes: null, set: () => {} };

/** Which store answers for each pane: the project's layout when loaded, else the persisted fallback. */
export function panePrefs(
  sync: SidePanesSync,
  fallback: { projects: PanePref; files: PanePref },
): { projects: PanePref; files: PanePref } {
  const { panes } = sync;
  if (panes === null) return fallback;
  return {
    projects: { value: panes.projects, set: (v) => sync.set({ projects: v }) },
    files: { value: panes.files, set: (v) => sync.set({ files: v }) },
  };
}

/** Mounted inside the workspace provider; reports the loaded layout's panes up to `App`. */
export function SidePanesBridge({ onSync }: { onSync: (sync: SidePanesSync) => void }): null {
  const { layout, setSidePanes } = useWorkspace();
  const projects = layout ? effectiveSidePanes(layout).projects : null;
  const files = layout ? effectiveSidePanes(layout).files : null;
  useEffect(() => {
    onSync(projects === null || files === null ? NO_SIDE_PANES : { panes: { projects, files }, set: setSidePanes });
  }, [projects, files, setSidePanes, onSync]);
  return null;
}
