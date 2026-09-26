/**
 * The Unload orchestrator (046 US4, contracts/unload.md §2 as superseded by §6; T073, T128).
 *
 * A PLAIN async function, not a hook: everything reachable off `window.throng` (editor.saveAll,
 * terminal.killAll) is called directly, the same way `projects-panel.tsx#confirmDelete` already calls
 * `window.throng?.editor?.saveAll` inline. Everything that is REACT STATE — settings, the dirty set,
 * the sub-workspace tab trees, the projects store's own `unloadProject(id)`, editor disposal and the
 * store's failure path — is passed in as {@link UnloadCollaborators}, because a plain function cannot
 * call a hook itself.
 *
 * FR-111 (iterate round 1): no project-menu Unload row asks anything. Each row names its action before
 * the click (FR-081), so the only dialog Unload may show is the unsaved-editor prompt (FR-035), which
 * protects typed text rather than confirming the unload (SC-015). FR-086: Keep Terminals Running keeps
 * EVERY terminal, idle shells included — it sends the terminal service nothing.
 */
import { planUnload, projectPanelIdsInSubWorkspaces } from '@throng/core';
import type { Tab, UnloadTerminalAction } from '@throng/core';
import { promptDirtyClose } from '../editor/dirty-close-store.js';
import { settleLayoutSaves } from '../state/layout-saves.js';
import type { EditorSaveAllResult } from '../global.js';

export interface UnloadCollaborators {
  settings: {
    projects: { unloadTerminalAction: UnloadTerminalAction };
  };
  isDirty(id: string): boolean;
  /** For {@link projectPanelIdsInSubWorkspaces} — the panels a sub-workspace holds, FR-037. */
  subWorkspaces: ReadonlyArray<{ tabs: readonly Tab[] }>;
  /** This project's OWN editor panels, in the MAIN window's layout. */
  editorPanelIds: readonly string[];
  /** The projects store's own transition (T071) — `loadedIds` and, if active, `openedId`. */
  unloadProject(id: string): void;
  disposeEditor(panelId: string): void;
  /** The store's `fail` path, with the project as subject. */
  reportFailure(message: string, projectName: string): void;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * What went wrong, in words a user can read (046 branch review #1).
 *
 * A daemon call that fails in main reaches the renderer wrapped by Electron — `Error invoking remote
 * method 'throng:terminal:killAll': RpcTimeoutError: RPC "terminal.killAll" timed out` — and none of
 * that wrapping is anything the user can act on. The wrapping and the error's class name are dropped;
 * a timeout, which says nothing but the channel's name, becomes a sentence.
 */
function reasonOf(err: unknown): string {
  const raw = messageOf(err);
  if (/timed out/i.test(raw)) return "throng's terminal service did not answer in time";
  return raw
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^[A-Za-z]*Error:\s*/, '');
}

export async function unloadProject(
  id: string,
  projectName: string,
  variant: UnloadTerminalAction | undefined,
  collaborators: UnloadCollaborators,
): Promise<void> {
  // Step 1 (FR-035) — the unsaved guard runs before anything else, and is the only dialog (SC-015).
  if (collaborators.isDirty(id)) {
    const choice = await promptDirtyClose(projectName, []);
    if (choice === 'cancel') return;
    if (choice === 'save') {
      // 046 branch review C1 — `saveAll` always resolves an `EditorSaveAllResult` object, which is
      // always truthy, so a boolean check here can never see a failed or skipped save: the project
      // would unload anyway with a dirty editor's typed text dropped. A failed save (`failed`) or an
      // editor Save-All cannot reach yet (`skippedUnpathed`, e.g. an Untitled buffer) both stop the
      // flow the same way Cancel does — the project stays loaded, unchanged, with one clear notice.
      //
      // 046 branch review I2 — scope 'project' (not 'all'): 'all' saves every OTHER loaded project's
      // dirty editors too, which unloading this one project never asked for. `activeProjectId` here
      // is not "whichever project is active" but "the project this Save-All is scoped to" — exactly
      // this project, `id` — matching `editorsInScope`'s 'project' branch (`@throng/core`).
      const result: EditorSaveAllResult | undefined = await window.throng?.editor?.saveAll?.({
        scope: 'project',
        activeProjectId: id,
      });
      if (!result || result.failed.length > 0 || result.skippedUnpathed.length > 0) {
        collaborators.reportFailure(
          `Nothing was unloaded: not every unsaved change in ${projectName} could be saved.`,
          projectName,
        );
        return;
      }
    }
    // 'discard' falls straight through into the release.
  }

  // Step 2 (FR-037) — the panels a sub-workspace still holds are spared.
  const spare = projectPanelIdsInSubWorkspaces(id, collaborators.subWorkspaces);

  // Step 3 (FR-081, FR-111) — the row's action, else the preference. Always one `apply` step.
  const [step] = planUnload({
    defaultAction: collaborators.settings.projects.unloadTerminalAction,
    variant,
  });
  const action = step!.action;

  // Step 4 (FR-032, FR-036) — release the project BEFORE touching any terminal, so no view is left
  // showing a session about to be ended (Principle III).
  await settleLayoutSaves();
  collaborators.unloadProject(id);

  // From here the project is ALREADY released (step 4), so nothing below may stop the rest, and
  // every problem is collected into ONE notice at the end ("one condition, one notice"): the user
  // sees what state the project is in — unloaded — and what may be left over, once.
  const problems: string[] = [];

  // Step 5 (FR-037) — dispose this project's editors, except those a sub-workspace still holds. A
  // panel that fails does not stop the others, nor step 6.
  let disposeFailure: unknown;
  for (const panelId of collaborators.editorPanelIds) {
    if (spare.includes(panelId)) continue;
    try {
      collaborators.disposeEditor(panelId);
    } catch (err) {
      disposeFailure ??= err;
    }
  }
  if (disposeFailure !== undefined) problems.push(`some of its editors could not be closed (${reasonOf(disposeFailure)})`);

  // Step 6 — End Terminals ends every terminal of the project not spared. Keep Terminals Running
  // sends NOTHING: every session, idle shells included, stays alive and reattaches on the next load
  // (FR-086, constitution III stated exception).
  if (action === 'endTerminals') {
    try {
      await window.throng!.terminal!.killAll({ projectId: id, exceptPanelIds: spare });
    } catch (err) {
      problems.push(
        `throng could not end its terminals (${reasonOf(err)}). Some of them may still be running; they reattach when you open ${projectName} again`,
      );
    }
  }

  if (problems.length > 0) {
    collaborators.reportFailure(`${projectName} was unloaded, but ${problems.join('; and ')}.`, projectName);
  }
}
