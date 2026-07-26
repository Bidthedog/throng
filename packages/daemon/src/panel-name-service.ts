import {
  JSON_RPC_INVALID_PARAMS,
  PANEL_NAME_CLAIM_METHOD,
  PANEL_NAME_RECONCILE_METHOD,
  type PanelNameClaimResult,
  type PanelNameReconcileResult,
} from '@throng/ipc-contract';
import {
  collectPanels,
  reconcilePanelNames,
  uniquePanelName,
  type IUserContext,
  type Panel,
  type SubWorkspace,
  type WorkspaceLayout,
} from '@throng/core';
import { RpcError, type RpcRouter } from './rpc-router.js';
import type { ProjectRepository, WorkspaceRepository } from '@throng/persistence';

function asObject(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) {
    throw new RpcError('Params must be an object', JSON_RPC_INVALID_PARAMS);
  }
  return params as Record<string, unknown>;
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new RpcError(`A non-empty "${key}" is required`, JSON_RPC_INVALID_PARAMS);
  }
  return value;
}

export interface PanelNameDeps {
  projectStore: Pick<ProjectRepository, 'list'>;
  workspaceStore: Pick<
    WorkspaceRepository,
    'load' | 'save' | 'loadSubWorkspaces' | 'persistSubWorkspaces'
  >;
  userContext: IUserContext;
}

/**
 * `panelName.*` (024 follow-up) — the ONE component that can see every panel name.
 *
 * A window holds its own project's layout and nothing else, so "is this name taken?" is a question
 * it cannot answer: the clash may be in a project that is not open, or in a sub-workspace belonging
 * to another. The daemon holds every layout, so it answers, and the rule it applies is the pure one
 * in core.
 *
 * Names are read from the LAYOUTS themselves rather than from a registry table beside them. A second
 * source of truth for something the layouts already state would only ever drift out of step with
 * them — and a stale registry that refuses a name nobody holds is worse than no registry at all.
 */
export class PanelNameIpcService {
  constructor(private readonly deps: PanelNameDeps) {}

  private get owner(): string {
    return this.deps.userContext.currentUser().userId;
  }

  /** Every panel in the application, project layouts first, then sub-workspaces. */
  private allPanels(): { panel: Panel; source: { kind: 'project'; id: string } | { kind: 'sub' } }[] {
    const out: { panel: Panel; source: { kind: 'project'; id: string } | { kind: 'sub' } }[] = [];
    for (const project of this.deps.projectStore.list(this.owner)) {
      // `load` is a convenience that SYNTHESISES a default layout — with a freshly generated panel
      // and the name "Panel 1" — for a project that has never saved one. Those panels do not exist:
      // nothing is showing them and no id in the application matches them. Counting them made the
      // very first panel of a brand-new project clash with its own phantom and come out as
      // "Panel 1 (2)", and a reconcile pass would then have PERSISTED the phantom. Only a layout
      // that was actually restored describes panels that are real.
      const result = this.deps.workspaceStore.load(this.owner, project.id);
      if (!result.restored) continue;
      for (const tab of result.layout.tabs) {
        for (const panel of collectPanels(tab.root)) {
          out.push({ panel, source: { kind: 'project', id: project.id } });
        }
      }
    }
    for (const sub of this.deps.workspaceStore.loadSubWorkspaces(this.owner)) {
      for (const tab of sub.tabs) {
        for (const panel of collectPanels(tab.root)) out.push({ panel, source: { kind: 'sub' } });
      }
    }
    return out;
  }

  register(router: RpcRouter): void {
    router.register(PANEL_NAME_CLAIM_METHOD, (params) => this.claim(params));
    router.register(PANEL_NAME_RECONCILE_METHOD, () => this.reconcile());
  }

  private claim(params: unknown): PanelNameClaimResult {
    const p = asObject(params);
    const panelId = requireString(p, 'panelId');
    const desired = requireString(p, 'desired');
    // Everything EXCEPT this panel: a panel never clashes with itself, and a panel mirrored into a
    // sub-workspace carries the same id, so its own copies are not rivals either.
    const taken = this.allPanels()
      .filter((entry) => entry.panel.id !== panelId)
      .map((entry) => entry.panel.title);
    const granted = uniquePanelName(desired, taken);
    return { granted, adjusted: granted !== desired.trim() };
  }

  /**
   * Bring what is already on disk into line (run once, at startup).
   *
   * Every project shipped its panels as "Panel 1", "Panel 2" … numbered within its own layout, so
   * duplicates across projects are not an edge case — they are the norm for anyone who has more
   * than one project. The FIRST claim wins, in project order then sub-workspace order, so the panel
   * a user has been calling "Build" for a month keeps the name and the newcomer moves.
   */
  private reconcile(): PanelNameReconcileResult {
    const all = this.allPanels();
    const changes = reconcilePanelNames(all.map((e) => ({ id: e.panel.id, name: e.panel.title })));
    if (changes.length === 0) return { renamed: 0 };
    const byId = new Map(changes.map((c) => [c.id, c.to]));

    const rename = (panel: Panel): Panel => {
      const next = byId.get(panel.id);
      return next === undefined || next === panel.title ? panel : { ...panel, title: next };
    };
    const mapLayout = (layout: WorkspaceLayout): { layout: WorkspaceLayout; touched: boolean } => {
      let touched = false;
      const tabs = layout.tabs.map((tab) => ({
        ...tab,
        root: mapPanels(tab.root, (panel) => {
          const next = rename(panel);
          if (next !== panel) touched = true;
          return next;
        }),
      }));
      return { layout: { ...layout, tabs }, touched };
    };

    for (const project of this.deps.projectStore.list(this.owner)) {
      // Same rule as `allPanels`: a layout that was never saved has no real panels, and writing the
      // synthesised default back would CREATE the layout — inventing a persisted panel for a project
      // the user has not opened yet.
      const result = this.deps.workspaceStore.load(this.owner, project.id);
      if (!result.restored) continue;
      const mapped = mapLayout(result.layout);
      if (mapped.touched) this.deps.workspaceStore.save(this.owner, project.id, mapped.layout);
    }
    const subs = this.deps.workspaceStore.loadSubWorkspaces(this.owner);
    let subsTouched = false;
    const nextSubs: SubWorkspace[] = subs.map((sub) => {
      let touched = false;
      const tabs = sub.tabs.map((tab) => ({
        ...tab,
        root: mapPanels(tab.root, (panel) => {
          const next = rename(panel);
          if (next !== panel) touched = true;
          return next;
        }),
      }));
      if (touched) subsTouched = true;
      return touched ? { ...sub, tabs } : sub;
    });
    if (subsTouched) this.deps.workspaceStore.persistSubWorkspaces(this.owner, nextSubs);

    return { renamed: changes.length };
  }
}

/** Map every panel in a split tree, rebuilding it immutably. */
function mapPanels<T extends { type?: string; children?: T[] }>(node: T, fn: (panel: Panel) => Panel): T {
  const asNode = node as unknown as { type?: string; children?: unknown[] };
  if (asNode.type === 'panel') return fn(node as unknown as Panel) as unknown as T;
  if (!Array.isArray(asNode.children)) return node;
  return {
    ...node,
    children: (asNode.children as T[]).map((child) => mapPanels(child, fn)),
  };
}
