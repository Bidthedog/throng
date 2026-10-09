import type { SubWorkspace, WorkspaceLayout } from '../workspace/model.js';

/** Outcome of loading a per-project layout (FR-029 fallback signalling). */
export interface WorkspaceLoadResult {
  layout: WorkspaceLayout;
  /** True if a saved layout was restored; false if the default-empty fallback was used. */
  restored: boolean;
  /**
   * Why the fallback was used (only when `restored` is false): `missing` for a
   * never-saved project (no notice needed) vs `corrupt` for an unreadable/invalid
   * saved layout (surface "could not restore", SC-011 / US3).
   */
  reason?: 'missing' | 'corrupt';
}

/**
 * Persistence port for per-project workspace layouts and sub-workspaces
 * (research D4/D5). The daemon's `WorkspaceRepository` implements it, storing
 * the layout as a JSON document per project. Scoped by `ownerUser`; synchronous
 * (see {@link IProjectStore}).
 */
export interface IWorkspaceStore {
  /**
   * Load a project's saved layout. If none exists, or the stored document is
   * unparseable/invalid, returns the default empty workspace with
   * `restored: false` (FR-029).
   */
  load(ownerUser: string, projectId: string): WorkspaceLoadResult;
  /** Persist a project's layout document whole (debounced by the caller). */
  save(ownerUser: string, projectId: string, layout: WorkspaceLayout): void;
  /**
   * All of the owner's detached sub-workspaces (US4). A row that cannot be parsed is skipped; `onCorrupt` (052
   * FR-009) is told its id, for a caller that must count it.
   */
  loadSubWorkspaces(ownerUser: string, onCorrupt?: (id: string, error: unknown) => void): SubWorkspace[];
  /** Replace the owner's persisted sub-workspace set (US4). */
  persistSubWorkspaces(ownerUser: string, subWorkspaces: SubWorkspace[]): void;
  /** 052 R3 — upsert ONE record, keeping its position (a new id is appended last); siblings are untouched. */
  saveSubWorkspace(ownerUser: string, subWorkspace: SubWorkspace): void;
  /** 052 R3 — delete the named records; answers the ids that existed. */
  deleteSubWorkspaces(ownerUser: string, ids: readonly string[]): string[];
  /** 052 R2 — run `body` as one transaction: every write in it lands, or none does. */
  atomically<T>(body: () => T): T;
}
