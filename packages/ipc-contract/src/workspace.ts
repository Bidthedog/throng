// JSON-RPC shapes for the `workspace.*` methods (002 / contracts/ipc-workspace.md).
// The per-project layout document is sent/stored whole (research D4/D5); we reuse
// the core domain types directly rather than redefine the recursive tree.
import type { WorkspaceLayout, SubWorkspace } from '@throng/core';

export const WORKSPACE_LOAD_METHOD = 'workspace.load';
export const WORKSPACE_SAVE_METHOD = 'workspace.save';
export const WORKSPACE_LOAD_SUBS_METHOD = 'workspace.loadSubWorkspaces';
export const WORKSPACE_PERSIST_SUBS_METHOD = 'workspace.persistSubWorkspaces';
export const WORKSPACE_SUMMARY_METHOD = 'workspace.summary';
/** 052 R2 — rewrite every layout no window holds after an in-app move, in one daemon turn. */
export const WORKSPACE_FOLLOW_MOVES_METHOD = 'workspace.followMoves';
/** 052 R3 — upsert ONE sub-workspace record; siblings are never rewritten. */
export const WORKSPACE_SAVE_SUB_METHOD = 'workspace.saveSubWorkspace';
/** 052 R3 — delete the named sub-workspace records. */
export const WORKSPACE_DELETE_SUBS_METHOD = 'workspace.deleteSubWorkspaces';

/** 052 contracts/workspace-rpc.md. */
export interface WorkspaceFollowMovesParams {
  moves: Array<{ from: string; to: string }>;
  held: { projectIds: string[]; subWorkspaceIds: string[] };
  /** R4 — restrict the walk to these records, regardless of `held` (a renderer's in-flight save). */
  only?: { projectIds?: string[]; subWorkspaceIds?: string[] };
}
export interface WorkspaceFollowMovesResult {
  changedProjectIds: string[];
  changedSubWorkspaceIds: string[];
  /** Records that could not be read or written, left unchanged (FR-009). */
  skipped: number;
}

export interface WorkspaceSaveSubParams {
  subWorkspace: SubWorkspace;
}
export interface WorkspaceDeleteSubsParams {
  ids: string[];
}
export interface WorkspaceDeleteSubsResult {
  ok: true;
  deleted: string[];
}

/** Aggregate counts for the window-title summary (FR-040). */
export interface WorkspaceSummaryResult {
  projects: number;
  tabs: number;
  panels: number;
}

export interface WorkspaceLoadParams {
  projectId: string;
}
export interface WorkspaceLoadResultDto {
  layout: WorkspaceLayout;
  /** True if a saved layout was restored; false if the default-empty fallback was used. */
  restored: boolean;
  /** `missing` (never saved — no notice) vs `corrupt` (unreadable — surface it). */
  reason?: 'missing' | 'corrupt';
}

export interface WorkspaceSaveParams {
  projectId: string;
  layout: WorkspaceLayout;
}
export interface WorkspaceSaveResult {
  ok: true;
}

export type WorkspaceLoadSubsParams = Record<string, never>;
export interface WorkspaceLoadSubsResult {
  subWorkspaces: SubWorkspace[];
}

export interface WorkspacePersistSubsParams {
  subWorkspaces: SubWorkspace[];
}
export interface WorkspacePersistSubsResult {
  ok: true;
}
