// JSON-RPC shapes for the `workspace.*` methods (002 / contracts/ipc-workspace.md).
// The per-project layout document is sent/stored whole (research D4/D5); we reuse
// the core domain types directly rather than redefine the recursive tree.
import type { WorkspaceLayout, SubWorkspace } from '@throng/core';

export const WORKSPACE_LOAD_METHOD = 'workspace.load';
export const WORKSPACE_SAVE_METHOD = 'workspace.save';
export const WORKSPACE_LOAD_SUBS_METHOD = 'workspace.loadSubWorkspaces';
export const WORKSPACE_PERSIST_SUBS_METHOD = 'workspace.persistSubWorkspaces';
export const WORKSPACE_SUMMARY_METHOD = 'workspace.summary';

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
