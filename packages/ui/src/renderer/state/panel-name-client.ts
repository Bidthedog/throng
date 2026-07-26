import {
  PANEL_NAME_CLAIM_METHOD,
  PANEL_NAME_RECONCILE_METHOD,
  type PanelNameClaimResult,
  type PanelNameReconcileResult,
} from '@throng/ipc-contract';
import type { ThrongBridge } from './bridge.js';

/**
 * Globally unique panel names, over the daemon (024 follow-up).
 *
 * A window cannot answer "is this name taken?" — the clash may be in a project it does not have
 * open, or a sub-workspace belonging to another. So it asks, and uses what it is given.
 *
 * A failure GRANTS THE DESIRED NAME. A daemon that cannot be reached must not stop a user renaming
 * a panel: uniqueness is a tidiness rule, and enforcing it is worth less than the rename working.
 * The next reconcile pass will resolve anything that slipped through.
 */
export class PanelNameClient {
  constructor(private readonly bridge: ThrongBridge) {}

  async claim(panelId: string, desired: string): Promise<PanelNameClaimResult> {
    try {
      return await this.bridge.invoke<PanelNameClaimResult>(PANEL_NAME_CLAIM_METHOD, {
        panelId,
        desired,
      });
    } catch {
      return { granted: desired, adjusted: false };
    }
  }

  async reconcile(): Promise<PanelNameReconcileResult> {
    try {
      return await this.bridge.invoke<PanelNameReconcileResult>(PANEL_NAME_RECONCILE_METHOD, {});
    } catch {
      return { renamed: 0 };
    }
  }
}
