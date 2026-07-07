import type { WorkspaceLayout } from '@throng/core';
import type {
  WorkspaceLoadResultDto,
  WorkspaceSaveResult,
  WorkspaceSummaryResult,
} from '@throng/ipc-contract';
import type { ThrongBridge } from './bridge.js';

/**
 * Typed renderer client for the `workspace.*` daemon methods (research D9/D10).
 * The renderer mirrors the layout locally and only round-trips snapshots
 * (debounced) — it never touches SQLite.
 */
export class WorkspaceClient {
  constructor(private readonly bridge: ThrongBridge) {}

  load(projectId: string): Promise<WorkspaceLoadResultDto> {
    return this.bridge.invoke<WorkspaceLoadResultDto>('workspace.load', { projectId });
  }

  save(projectId: string, layout: WorkspaceLayout): Promise<WorkspaceSaveResult> {
    return this.bridge.invoke<WorkspaceSaveResult>('workspace.save', { projectId, layout });
  }

  summary(): Promise<WorkspaceSummaryResult> {
    return this.bridge.invoke<WorkspaceSummaryResult>('workspace.summary', {});
  }
}
