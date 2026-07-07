import type { SubWorkspacesClient } from '../state/subworkspaces-client.js';

/**
 * Destroy the sub-workspace a detached window is showing (005 / FR-029): closing
 * the last Panel (or last Tab) in a sub-workspace closes the whole sub-workspace.
 * Deletes its persisted record, tells the other windows so the main-window sidebar
 * refreshes (the record is gone), then closes this window. A closed sub-workspace
 * is not linked to any project, so nothing else needs cleaning up.
 */
export async function destroySubWorkspace(
  client: SubWorkspacesClient,
  subId: string,
): Promise<void> {
  await client.remove(subId);
  window.throng?.subWorkspace?.notifyChanged(subId);
  window.throng?.subWorkspace?.close(subId);
}
