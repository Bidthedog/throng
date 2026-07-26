/**
 * `panelName.*` daemon RPC (024 follow-up) — globally unique panel names.
 *
 * No two panels anywhere in throng, across every project AND every sub-workspace, may share a name.
 * Only the daemon can enforce that: a window sees its own project's layout and nothing else, so the
 * name a user types in one project cannot be checked against another without asking the one
 * component that holds them all.
 *
 * The OWNER IS NEVER SENT BY THE CLIENT — resolved from `IUserContext`, as everywhere else.
 */
export const PANEL_NAME_CLAIM_METHOD = 'panelName.claim';
export const PANEL_NAME_RECONCILE_METHOD = 'panelName.reconcile';

export interface PanelNameClaimParams {
  /** The panel asking. Excluded from the taken set — a panel never clashes with itself, and a
   *  panel MIRRORED into a sub-workspace shares this id, so its copies do not either. */
  panelId: string;
  /** The name the user typed, or the one the layout generated. */
  desired: string;
}
export interface PanelNameClaimResult {
  /** The name actually granted — `desired`, or the first free `"<desired> (n)"`. */
  granted: string;
  /** True when the desired name was taken, so the caller can say so. */
  adjusted: boolean;
}

/** Bring what is already on disk into line: first claim wins, later duplicates move. */
export interface PanelNameReconcileResult {
  /** How many panels were renamed. Zero on every run after the first. */
  renamed: number;
}
