/**
 * panel-state-handoff — where a loaded panel's view and transient UI state waits between the window that
 * sends the panel to another window and the window that receives it (049 R3, FR-000, FR-000a;
 * contracts/panel-state-handoff.md).
 *
 * A tear-off COPIES a panel into another renderer, and every renderer keeps that state in module maps of
 * its own, so without this the receiving window starts empty. The navigation-history `viewState` slot is
 * not a substitute: it is preview-only, per history entry, persisted and merged (research R3).
 *
 * In memory only — the state is transient by FR-000, so nothing here survives the app. Snapshots are
 * renderer-supplied JSON, so each is checked by `isPanelSnapshot` and measured against
 * `MAX_PANEL_SNAPSHOT_BYTES`, and one that fails is dropped rather than refused across the bridge.
 */
import { isPanelSnapshot, MAX_PANEL_SNAPSHOT_BYTES, panelSnapshotBytes, type PanelSnapshot } from '@throng/core';

export class PanelStateHandoff {
  private readonly snapshots = new Map<string, PanelSnapshot>();

  /** Keep each valid snapshot, replacing any earlier unclaimed one for the same panel. */
  stash(snapshots: readonly unknown[]): void {
    for (const s of snapshots) {
      if (!isPanelSnapshot(s) || panelSnapshotBytes(s) > MAX_PANEL_SNAPSHOT_BYTES) continue;
      this.snapshots.set(s.panelId, s);
    }
  }

  /** Return and delete the snapshots held for these panels; a panel with none is absent. */
  claim(panelIds: readonly string[]): Record<string, PanelSnapshot> {
    const out: Record<string, PanelSnapshot> = {};
    for (const id of panelIds) {
      const s = this.snapshots.get(id);
      if (s === undefined) continue;
      out[id] = s;
      this.snapshots.delete(id);
    }
    return out;
  }

  /** A destroyed panel's snapshot will never be claimed. */
  forget(panelId: string): void {
    this.snapshots.delete(panelId);
  }
}
