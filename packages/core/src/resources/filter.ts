import type { MetricName, ProjectLoadState, ResourceNode } from './types.js';

export interface HierarchyFilter {
  /** Matches a node's name, a process's command line or its pid, ignoring case (FR-061). */
  readonly text?: string;
  /** A component (`c:…`) or project (`p:…`) id: only the path down to it and its subtree remain. */
  readonly narrowTo?: string | null;
  /** Process nodes this hides — idle ones (FR-061a) — unless a descendant stays visible. */
  readonly hide?: (node: ResourceNode) => boolean;
}

function matches(node: ResourceNode, needle: string): boolean {
  if (node.label.toLowerCase().includes(needle)) return true;
  const p = node.process;
  if (p === undefined) return false;
  return String(p.pid).includes(needle) || (p.commandLine?.toLowerCase().includes(needle) ?? false);
}

/**
 * The hierarchy as the filter shows it, or `null` when nothing is left. Every kept node keeps all its
 * ancestors (FR-061); a text match keeps its whole subtree. Nodes are rebuilt only where a child was
 * dropped, so an unchanged branch keeps its identity.
 */
export function filterHierarchy(root: ResourceNode, filter: HierarchyFilter): ResourceNode | null {
  const needle = filter.text?.trim().toLowerCase() ?? '';
  const narrowTo = filter.narrowTo ?? null;
  if (needle === '' && narrowTo === null && filter.hide === undefined) return root;

  const visit = (node: ResourceNode, matched: boolean, inNarrowed: boolean): ResourceNode | null => {
    const here = inNarrowed || narrowTo === null || node.id === narrowTo;
    const selfMatch = matched || needle === '' || matches(node, needle);
    const kids: ResourceNode[] = [];
    for (const child of node.children) {
      const kept = visit(child, selfMatch && needle !== '' ? true : matched, here);
      if (kept !== null) kids.push(kept);
    }
    const hiddenSelf = node.kind === 'process' && filter.hide !== undefined && filter.hide(node);
    const keepSelf = here && (needle === '' || selfMatch) && !hiddenSelf;
    if (!keepSelf && kids.length === 0) {
      // A non-process UI node inside the narrowed subtree survives on its own when nothing filters by
      // text: an idle-hidden terminal still shows its panel.
      if (!(here && needle === '' && node.kind !== 'process')) return null;
    }
    const same = kids.length === node.children.length && kids.every((k, i) => k === node.children[i]);
    return same ? node : { ...node, children: kids };
  };
  return visit(root, false, false);
}

const STATE_RANK: Record<ProjectLoadState, number> = { active: 0, loaded: 1, unloaded: 2 };

/**
 * Children ordered by the chosen metric, largest first; a figure that is not a number sorts last;
 * ties keep their given order. Projects go active → loaded → unloaded first (FR-020c).
 */
export function orderChildren(children: readonly ResourceNode[], metric: MetricName): ResourceNode[] {
  const value = (n: ResourceNode): number => {
    const v = n.rolled[metric];
    return typeof v === 'number' ? v : -1;
  };
  const rank = (n: ResourceNode): number => (n.projectState === undefined ? 0 : STATE_RANK[n.projectState]);
  return children
    .map((node, index) => ({ node, index }))
    .sort((a, b) => rank(a.node) - rank(b.node) || value(b.node) - value(a.node) || a.index - b.index)
    .map((e) => e.node);
}
