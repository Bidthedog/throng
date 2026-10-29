/** A tab as the monitor names it: `"<sub-workspace> › <tab>"` when it lives in one (FR-020a). */
export function tabLabel(tab: { readonly name: string; readonly subWorkspaceName: string | null }): string {
  return tab.subWorkspaceName === null ? tab.name : `${tab.subWorkspaceName} › ${tab.name}`;
}

export interface HeldLockInput {
  readonly path: string;
  readonly projectId: string;
  readonly panelIds: readonly string[];
}

export interface HeldContextInput {
  readonly tabs: readonly { readonly id: string; readonly name: string; readonly subWorkspaceName: string | null }[];
  readonly panels: readonly { readonly id: string; readonly tabId: string; readonly name: string }[];
}

export interface HeldFolderView {
  readonly path: string;
  readonly projectId: string;
  readonly panels: readonly { readonly panelId: string; readonly tabName: string; readonly panelName: string }[];
}

/** How a holding terminal is named when no window reports its tab — another project's, or a kept one. */
const UNNAMED_TAB = 'Not open in a window';
const UNNAMED_PANEL = 'Terminal';

/**
 * Every folder throng holds, with the terminal panels keeping it held (FR-070). The roster is the
 * authority — its panel ids are the live terminals holding each lock — so a panel no window names
 * keeps its place under a fallback name, and a folder leaves only when no terminal holds it (FR-072).
 */
export function heldFolders(locks: readonly HeldLockInput[], context: HeldContextInput): HeldFolderView[] {
  const tabs = new Map(context.tabs.map((t) => [t.id, t]));
  const panels = new Map(context.panels.map((p) => [p.id, p]));
  const out: HeldFolderView[] = [];
  for (const lock of locks) {
    const holding = lock.panelIds.map((id) => {
      const panel = panels.get(id);
      const tab = panel === undefined ? undefined : tabs.get(panel.tabId);
      return {
        panelId: id,
        tabName: tab === undefined ? UNNAMED_TAB : tabLabel(tab),
        panelName: panel?.name ?? UNNAMED_PANEL,
      };
    });
    if (holding.length > 0) out.push({ path: lock.path, projectId: lock.projectId, panels: holding });
  }
  return out;
}
