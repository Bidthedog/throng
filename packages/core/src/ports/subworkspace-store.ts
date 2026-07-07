import type { SubWorkspace, SubWorkspaceBounds } from '../workspace/model.js';

/** Lightweight sub-workspace metadata for the sidebar list (lazy startup, FR-015). */
export interface SubWorkspaceMeta {
  id: string;
  name: string;
  colour: string;
  /** Number of Tabs in the sub-workspace (shown in the list, like projects). */
  tabCount: number;
  /** Total Panels across all of its Tabs. */
  panelCount: number;
}

/**
 * Persistence port for first-class sub-workspaces (003 / research D5). The
 * daemon's `SubWorkspaceRepository` implements it over SQLite (migration v4 adds
 * name/colour). Scoped by `ownerUser`; synchronous like the other stores.
 */
export interface ISubWorkspaceStore {
  /** Metadata for all of the owner's sub-workspaces (sidebar list at startup). */
  list(ownerUser: string): SubWorkspaceMeta[];
  /** Full sub-workspace (tabs/panels/bounds) for opening a window on demand. */
  get(ownerUser: string, id: string): SubWorkspace | null;
  /** Rename a sub-workspace (FR-012). */
  rename(ownerUser: string, id: string, name: string): void;
  /** Recolour a sub-workspace (FR-012). */
  recolour(ownerUser: string, id: string, colour: string): void;
  /** Delete a sub-workspace and its persisted tabs/panels (FR-014). */
  delete(ownerUser: string, id: string): void;
  /** Reorder the owner's sub-workspaces to match `orderedIds` (drag-to-reorder). */
  reorder(ownerUser: string, orderedIds: string[]): void;
  /** Persist a sub-workspace window's on-screen bounds (move/resize/close, FR-017a). */
  updateBounds(ownerUser: string, id: string, bounds: SubWorkspaceBounds): void;
}
