import { LAYOUT_SCHEMA_VERSION, type SubWorkspace, type WorkspaceLayout } from '@throng/core';
import type {
  WorkspaceLoadResultDto,
  WorkspaceLoadSubsResult,
  WorkspaceSaveResult,
} from '@throng/ipc-contract';
import { WorkspaceClient } from './workspace-client.js';
import type { ThrongBridge } from './bridge.js';

/**
 * A {@link WorkspaceClient} for a detached **sub-workspace** window (US7 / T075).
 * It lets the sub-workspace window reuse the exact project workspace renderer
 * (`WorkspaceProvider` + `TabGroup`) unchanged: `load` hydrates the sub-workspace
 * and presents it as a {@link WorkspaceLayout}; `save` writes the edited tabs back.
 *
 * Saves go through the FULL set (`workspace.loadSubWorkspaces` → replace this one →
 * `workspace.persistSubWorkspaces`) because the persist path replaces the whole
 * owner set — writing only this sub-workspace would drop the siblings. The window's
 * own identity (name/colour/bounds/owner) is preserved across the round-trip.
 */
export class SubWorkspaceWorkspaceClient extends WorkspaceClient {
  /** Last-loaded identity of this window's sub-workspace, reused when saving. */
  private cached: SubWorkspace | null = null;

  constructor(
    private readonly subBridge: ThrongBridge,
    private readonly subWorkspaceId: string,
  ) {
    super(subBridge);
  }

  /** The synthetic project id used by the provider for a sub-workspace window. */
  static layoutProjectId(id: string): string {
    return `subworkspace:${id}`;
  }

  override async load(): Promise<WorkspaceLoadResultDto> {
    const { subWorkspaces } = await this.subBridge.invoke<WorkspaceLoadSubsResult>(
      'workspace.loadSubWorkspaces',
      {},
    );
    const sub = subWorkspaces.find((s) => s.id === this.subWorkspaceId);
    if (!sub || sub.tabs.length === 0) {
      return {
        layout: this.emptyLayout(),
        restored: false,
        reason: sub ? 'corrupt' : 'missing',
      };
    }
    this.cached = sub;
    return { layout: this.toLayout(sub), restored: true };
  }

  override async save(_projectId: string, layout: WorkspaceLayout): Promise<WorkspaceSaveResult> {
    const { subWorkspaces } = await this.subBridge.invoke<WorkspaceLoadSubsResult>(
      'workspace.loadSubWorkspaces',
      {},
    );
    const next = subWorkspaces.map((s) =>
      s.id === this.subWorkspaceId
        ? { ...s, tabs: layout.tabs, activeTabId: layout.activeTabId }
        : s,
    );
    await this.subBridge.invoke<WorkspaceSaveResult>('workspace.persistSubWorkspaces', {
      subWorkspaces: next,
    });
    if (this.cached) {
      this.cached = { ...this.cached, tabs: layout.tabs, activeTabId: layout.activeTabId };
    }
    // Broadcast the content change so the main window re-reads this sub-workspace
    // (its `fullSubs`): the "Sync to" menu, the cross-window drop hint, and the
    // active-Tab a dropped Panel targets all depend on it being current. The relay
    // excludes this sender, so the window does not remount itself on its own edit.
    window.throng?.subWorkspace?.notifyChanged(this.subWorkspaceId);
    return { ok: true };
  }

  private toLayout(sub: SubWorkspace): WorkspaceLayout {
    // Restore the persisted active Tab (defaulting to the first) so cross-window
    // drops can target what the window is actually showing.
    const activeTabId =
      sub.activeTabId && sub.tabs.some((t) => t.id === sub.activeTabId)
        ? sub.activeTabId
        : sub.tabs[0].id;
    return {
      projectId: SubWorkspaceWorkspaceClient.layoutProjectId(sub.id),
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      tabs: sub.tabs,
      activeTabId,
    };
  }

  private emptyLayout(): WorkspaceLayout {
    return {
      projectId: SubWorkspaceWorkspaceClient.layoutProjectId(this.subWorkspaceId),
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      tabs: [],
      activeTabId: '',
    };
  }
}
