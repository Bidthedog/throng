/**
 * Destroy-confirmation decision logic (003 / FR-019–025a, research D10). Pure:
 * given the confirmation settings, a target's (emulated) active state, and the
 * sub-workspace placement of a project's panels, decide how many confirmation
 * dialogs to show and whether a project destroy is blocked. No OS/DOM.
 */
import type { ConfirmLevel } from '../config/app-settings.js';

export type DestroyTarget = 'tab' | 'panel' | 'project' | 'subWorkspace';

/** How a destroy action should be confirmed. */
export interface ConfirmPlan {
  /** Number of dialogs to show before destroying (0, 1, or 2). */
  dialogs: 0 | 1 | 2;
  /** True when the final dialog is the wry "Yes, I'm absolutely sure" prompt (project + double). */
  wryFinal: boolean;
}

/** Confirmation settings (mirror of AppSettings.confirmations). */
export interface DestroyConfirmSettings {
  destroyProject: ConfirmLevel;
  destroyTab: ConfirmLevel;
  destroyPanel: ConfirmLevel;
  destroySubWorkspace: ConfirmLevel;
}

function levelToDialogs(level: ConfirmLevel): 0 | 1 | 2 {
  if (level === 'none') return 0;
  if (level === 'double') return 2;
  return 1; // 'single'
}

/**
 * Resolve the confirmation plan for destroying a target.
 *
 * For every target, the level maps directly: `none` → 0 dialogs, `single` → 1,
 * `double` → 2 (the final dialog being the wry "Yes, I'm absolutely sure"
 * confirmation). A **panel** additionally shows nothing unless it currently has
 * an active (emulated) subprocess (`panelActive`).
 */
export function planConfirmations(
  target: DestroyTarget,
  settings: DestroyConfirmSettings,
  ctx: { panelActive?: boolean } = {},
): ConfirmPlan {
  if (target === 'panel' && !ctx.panelActive) return { dialogs: 0, wryFinal: false };
  const level =
    target === 'panel'
      ? settings.destroyPanel
      : target === 'tab'
        ? settings.destroyTab
        : target === 'subWorkspace'
          ? settings.destroySubWorkspace
          : settings.destroyProject;
  const dialogs = levelToDialogs(level);
  return { dialogs, wryFinal: dialogs === 2 };
}

/** A sub-workspace location that holds one or more of a project's panels (FR-025a). */
export interface BlockingLocation {
  subWorkspaceId: string;
  subWorkspaceName: string;
  tabIds: string[];
}

/**
 * Determine whether destroying a project is blocked because its panels live in
 * sub-workspaces (FR-025a), and where. The caller passes each sub-workspace with
 * its panels' origin project ids per tab. Destroy is refused when the list is
 * non-empty; the locations name where to find the panels.
 */
export function findProjectPanelsInSubWorkspaces(
  projectId: string,
  subWorkspaces: ReadonlyArray<{
    id: string;
    name: string;
    tabs: ReadonlyArray<{ id: string; originProjectIds: ReadonlyArray<string> }>;
  }>,
): BlockingLocation[] {
  const blocking: BlockingLocation[] = [];
  for (const sub of subWorkspaces) {
    const tabIds = sub.tabs
      .filter((t) => t.originProjectIds.includes(projectId))
      .map((t) => t.id);
    if (tabIds.length > 0) {
      blocking.push({ subWorkspaceId: sub.id, subWorkspaceName: sub.name, tabIds });
    }
  }
  return blocking;
}

/** True when a project may be destroyed (no panels of it remain in any sub-workspace). */
export function canDestroyProject(blocking: ReadonlyArray<BlockingLocation>): boolean {
  return blocking.length === 0;
}
