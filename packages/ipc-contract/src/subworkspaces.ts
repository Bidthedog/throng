// JSON-RPC shapes for the `subworkspace.*` methods (003 / contracts/ipc-subworkspaces.md).
// Post-creation management of first-class sub-workspaces; scoped to the current
// owner_user (resolved by the daemon via IUserContext). Creation is not a method —
// detach persists via the existing workspace.persistSubWorkspaces path.

export const SUBWORKSPACE_LIST_METHOD = 'subworkspace.list';
export const SUBWORKSPACE_RENAME_METHOD = 'subworkspace.rename';
export const SUBWORKSPACE_RECOLOUR_METHOD = 'subworkspace.recolour';
export const SUBWORKSPACE_DELETE_METHOD = 'subworkspace.delete';
export const SUBWORKSPACE_REORDER_METHOD = 'subworkspace.reorder';
export const SUBWORKSPACE_UPDATE_BOUNDS_METHOD = 'subworkspace.updateBounds';

/** Sidebar-list metadata (windows are opened lazily, so no bounds/content here). */
export interface SubWorkspaceMetaDto {
  id: string;
  name: string;
  colour: string;
  /** Tab + Panel counts for the list row (like the project list). */
  tabCount: number;
  panelCount: number;
}

export type SubworkspaceListParams = Record<string, never>;
export interface SubworkspaceListResult {
  subWorkspaces: SubWorkspaceMetaDto[];
}

export interface SubworkspaceRenameParams {
  id: string;
  name: string;
}

export interface SubworkspaceRecolourParams {
  id: string;
  colour: string;
}

export interface SubworkspaceDeleteParams {
  id: string;
}

export interface SubworkspaceReorderParams {
  /** The sub-workspace ids in their new order. */
  orderedIds: string[];
}

export interface SubworkspaceUpdateBoundsParams {
  id: string;
  bounds: { x: number; y: number; width: number; height: number; displayId?: string };
}

export interface SubworkspaceOkResult {
  ok: true;
}
