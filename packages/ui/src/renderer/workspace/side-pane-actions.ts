/**
 * 046 US2 (FR-010 – FR-019) — the ONE dispatch behind both the four side-pane chords and the cog
 * menu's Navigate section: stepping the active project forward/back, and moving keyboard focus
 * straight to the File Explorer or the Projects pane.
 *
 * `onRevealLeft` / `onRevealRight` are threaded IN rather than read here, because only `App()` holds
 * the persisted show/hide state a reveal has to affect (`usePersistedBool` is per-component state
 * backed by localStorage, with no cross-instance sync — a second hook instance calling `.set(true)`
 * would write the same key without making `App()`'s own instance, which actually gates the pane's
 * render, re-render). Everything else this needs — the project list, the active project,
 * `switchProject` — is ordinary `ProjectsProvider` context any component in the tree can read for
 * itself, so it is read here rather than threaded too.
 *
 * `KeybindingsHandler` (app.tsx) and `AppTitleBar`'s cog menu each call this hook and get back the
 * SAME dispatch behaviour — literally the same function body — so choosing "Next Project" from the
 * menu can never drift from what the chord does.
 */
import {
  listRows,
  reachableProjectIds,
  stepProject,
  type ActionId,
} from '@throng/core';
import { useProjects } from '../state/projects-store.js';
import { setActivePane } from './active-pane.js';
import { requestExplorerFocus } from '../explorer/explorer-commands.js';
import { requestProjectsFocus } from '../sidebar/projects-panel-commands.js';

export type SidePaneActionId = 'project.next' | 'project.previous' | 'focus.explorer' | 'focus.projects';

export interface SidePaneActions {
  dispatch: (action: SidePaneActionId) => void;
  /** Whether Next/Previous currently have anywhere to go (FR-019 — the cog menu's disabled state). */
  canStepNext: boolean;
  canStepPrevious: boolean;
}

export function useSidePaneActions(onRevealLeft: () => void, onRevealRight: () => void): SidePaneActions {
  const { projects, categories, activeProject, switchProject } = useProjects();
  const activeId = activeProject?.id ?? null;
  const reachable = reachableProjectIds(listRows(projects, categories, activeId));
  const canStepNext = stepProject(reachable, activeId, 1) !== null;
  const canStepPrevious = stepProject(reachable, activeId, -1) !== null;

  const dispatch = (action: SidePaneActionId): void => {
    if (action === 'project.next' || action === 'project.previous') {
      const target = stepProject(reachable, activeId, action === 'project.next' ? 1 : -1);
      if (target) void switchProject(target);
      return;
    }
    if (action === 'focus.explorer') {
      // Reveal, THEN set the active pane, THEN focus (FR-017) — focus is pending-safe
      // (`requestExplorerFocus`), so it lands whether the pane was already mounted or the reveal
      // above is what mounts it.
      onRevealRight();
      setActivePane('files');
      requestExplorerFocus();
      return;
    }
    onRevealLeft();
    setActivePane('projects');
    requestProjectsFocus();
  };

  return { dispatch, canStepNext, canStepPrevious };
}

/** Narrow an `ActionId` to a {@link SidePaneActionId}, for callers holding the wider union. */
export function isSidePaneAction(action: ActionId): action is SidePaneActionId {
  return (
    action === 'project.next' ||
    action === 'project.previous' ||
    action === 'focus.explorer' ||
    action === 'focus.projects'
  );
}
