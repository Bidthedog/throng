/**
 * What the Resource Monitor's body shows for the current session and view (055 US2) — pure functions
 * over a hierarchy, so that WHICH nodes are drawn, in what order and with what words is decided in one
 * place and proven without a DOM. The components only draw this.
 *
 * Filtering, narrowing, ordering and the idle rule are core's (`filterHierarchy`, `orderChildren`,
 * `isIdle`); this module composes them with the session's ended entries and the view state.
 */
import {
  filterHierarchy,
  isIdle,
  orderChildren,
  type MachineInfo,
  type Metrics,
  type ResourceNode,
  type UsageThresholds,
} from '@throng/core';
import { FIGURE_HINT, FIGURE_LABEL, FIGURE_ORDER, figureOf, metricNumber, type Figure, type FigureId } from './figures.js';
import { resolveFocusPath, type ViewState } from './monitor-session.js';

export interface BreakdownRow {
  readonly node: ResourceNode;
  /** 0 for a node that is a direct child of its section; deeper for a process under a process. */
  readonly depth: number;
  /** Node ids from the root: where drilling into this row puts the focus. */
  readonly path: readonly string[];
  readonly ended: boolean;
}

export type SectionId = 'components' | 'projects' | 'children';

export interface BreakdownSection {
  readonly id: SectionId;
  readonly title: string;
  /** The path of the section's parent; a child's path is this plus its id. */
  readonly basePath: readonly string[];
  /** The section's top-level nodes, ordered by the chosen metric. */
  readonly nodes: readonly ResourceNode[];
  /** `nodes` and, beneath processes (or everywhere, while filtering), their descendants. */
  readonly rows: readonly BreakdownRow[];
}

export interface BreakdownModel {
  readonly focusPath: readonly string[];
  readonly focus: ResourceNode;
  readonly sections: readonly BreakdownSection[];
}

export interface ModelContext {
  readonly isEnded: (nodeId: string) => boolean;
  /** A node's own figures, oldest first — the input of the idle rule. */
  readonly ownHistory: (nodeId: string) => readonly Metrics[];
  readonly thresholds: UsageThresholds;
  readonly machine: Pick<MachineInfo, 'installedRamBytes'>;
}

/** The node `path` names in `tree`, or `undefined` when any step of it is missing. */
export function nodeAt(tree: ResourceNode, path: readonly string[]): ResourceNode | undefined {
  if (path[0] !== tree.id) return undefined;
  let current = tree;
  for (const id of path.slice(1)) {
    const next = current.children.find((c) => c.id === id);
    if (next === undefined) return undefined;
    current = next;
  }
  return current;
}

/** Every node under `node` (itself first), depth first. */
export function descendants(node: ResourceNode): ResourceNode[] {
  return [node, ...node.children.flatMap(descendants)];
}

function rowsFor(
  nodes: readonly ResourceNode[],
  basePath: readonly string[],
  expandAll: boolean,
  metric: FigureId,
  ctx: ModelContext,
  depth = 0,
): BreakdownRow[] {
  const out: BreakdownRow[] = [];
  for (const node of nodes) {
    const path = [...basePath, node.id];
    out.push({ node, depth, path, ended: ctx.isEnded(node.id) });
    // A process's descendants are processes: the whole chain is the answer to "what is this running?".
    // Everything else lists its children only as far as the user drills — except while searching, when
    // a match is only useful with its ancestors showing.
    if (expandAll || node.kind === 'process') {
      out.push(...rowsFor(orderBy(node.children, metric), path, expandAll, metric, ctx, depth + 1));
    }
  }
  return out;
}

/**
 * Children ordered by the chosen figure, largest first. I/O is read PLUS write — the figure a row prints —
 * which core's `orderChildren` (one metric name) cannot say, so it orders shadows whose read carries the
 * sum and hands back the real nodes.
 */
function orderBy(nodes: readonly ResourceNode[], metric: FigureId): ResourceNode[] {
  if (metric !== 'io') return orderChildren(nodes, metric);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // A figure that is not a number stays one, so it still sorts last.
  const sum = (n: ResourceNode) => (typeof n.rolled.ioRead === 'number' && typeof n.rolled.ioWrite === 'number' ? metricNumber(n.rolled, 'io') : n.rolled.ioRead);
  const shadows = nodes.map((n) => ({ ...n, rolled: { ...n.rolled, ioRead: sum(n) } }));
  return orderChildren(shadows, 'ioRead').map((s) => byId.get(s.id)!);
}

/**
 * The breakdown for the session's tree and the view: filtered and narrowed, focused on the node the
 * view names (or its nearest surviving ancestor), its children ordered by the chosen metric. At the
 * root the first view carries both halves of the intent (FR-020b): the components, and the projects.
 */
export function buildBreakdown(tree: ResourceNode, view: ViewState, ctx: ModelContext): BreakdownModel {
  const filtered =
    filterHierarchy(tree, {
      text: view.filterText,
      narrowTo: view.narrowTo,
      hide: view.hideIdle
        ? (n) => !ctx.isEnded(n.id) && isIdle(ctx.ownHistory(n.id), ctx.thresholds, ctx.machine)
        : undefined,
    }) ?? { ...tree, children: [] };
  const focusPath = resolveFocusPath(view.focusPath, filtered);
  const focus = nodeAt(filtered, focusPath) ?? filtered;
  const expandAll = view.filterText.trim() !== '';

  const ordered = (nodes: readonly ResourceNode[]): ResourceNode[] => orderBy(nodes, view.metric);
  const section = (id: SectionId, title: string, basePath: readonly string[], nodes: readonly ResourceNode[]): BreakdownSection => {
    const top = ordered(nodes);
    return { id, title, basePath, nodes: top, rows: rowsFor(top, basePath, expandAll, view.metric, ctx) };
  };

  const sections: BreakdownSection[] = [];
  if (focus.kind === 'root') {
    sections.push(section('components', 'Components', focusPath, focus.children));
    const projects = focus.children.find((c) => c.id === 'c:projects');
    if (projects) sections.push(section('projects', 'Projects', [...focusPath, projects.id], projects.children));
  } else {
    sections.push(section('children', focus.label, focusPath, focus.children));
  }
  return { focusPath, focus, sections };
}

/** Every row of every section, in the order the eye reads them — the keyboard's order. */
export function allRows(model: BreakdownModel): BreakdownRow[] {
  return model.sections.flatMap((s) => s.rows);
}

// ── tiles ────────────────────────────────────────────────────────────────────────────────────────

export interface TileItem {
  readonly kind: 'node';
  readonly node: ResourceNode;
  readonly path: readonly string[];
  readonly value: number;
}
export interface OthersItem {
  readonly kind: 'others';
  readonly count: number;
  readonly value: number;
}

/** The most tiles a treemap draws before the rest are grouped. */
export const MAX_TILES = 24;
/** A contributor under this share of the total is grouped, however few tiles there are. */
export const MIN_TILE_SHARE = 0.015;

/**
 * The tiles for a section's nodes by `metric`: every contributor with a share, the small ones grouped
 * into one "N others" tile (Edge Cases, *Very large trees*). A node with nothing to size — ended, not
 * measured, unavailable, zero — takes no share (FR-020c) and no tile; it keeps its row.
 */
export function tilesFor(
  section: Pick<BreakdownSection, 'nodes' | 'basePath'>,
  metric: FigureId,
  isEnded: (id: string) => boolean,
): (TileItem | OthersItem)[] {
  const sized = section.nodes
    .filter((n) => n.kind !== 'limitation' && !isEnded(n.id))
    .map((node) => ({ node, value: metricNumber(node.rolled, metric) }))
    .filter((e) => e.value > 0);
  const total = sized.reduce((sum, e) => sum + e.value, 0);
  if (total <= 0) return [];
  const sorted = [...sized].sort((a, b) => b.value - a.value);
  const keep = sorted.filter((e, i) => i < MAX_TILES - 1 && e.value / total >= MIN_TILE_SHARE);
  const rest = sorted.filter((e) => !keep.includes(e));
  const tiles: (TileItem | OthersItem)[] = keep.map((e) => ({
    kind: 'node',
    node: e.node,
    path: [...section.basePath, e.node.id],
    value: e.value,
  }));
  // One leftover would be "1 others" — a tile for a single node is just that node's tile.
  if (rest.length === 1 && keep.length < MAX_TILES) {
    const only = rest[0]!;
    tiles.push({ kind: 'node', node: only.node, path: [...section.basePath, only.node.id], value: only.value });
  } else if (rest.length > 0) {
    tiles.push({ kind: 'others', count: rest.length, value: rest.reduce((s, e) => s + e.value, 0) });
  }
  return tiles;
}

// ── words ────────────────────────────────────────────────────────────────────────────────────────

export interface FigureContext {
  readonly thresholds: UsageThresholds;
  readonly machine: Pick<MachineInfo, 'installedRamBytes'>;
}

/** The four figures of a node's rolled-up metrics, in display order. */
export function figuresOf(node: ResourceNode, ctx: FigureContext): Figure[] {
  return FIGURE_ORDER.map((id) => figureOf(id, node.rolled, ctx.thresholds, ctx.machine));
}

/**
 * A node's values as text — what hovering it shows and what a focused node reads out (FR-068), so the
 * pointer and the keyboard are told exactly the same thing.
 */
export function valueText(node: ResourceNode, ended: boolean, ctx: FigureContext, known?: readonly Figure[]): string {
  if (node.kind === 'limitation') return `${node.label}: ${node.reason ?? 'not measured'}`;
  const head = `${node.label}${node.estimated ? ' (estimated)' : ''}${ended ? ' — ended' : ''}`;
  if (ended) return head;
  // A caller that has already worked the figures out hands them in: a row does, for every row, per frame.
  const lines = (known ?? figuresOf(node, ctx)).map((f) => {
    let line = `${FIGURE_LABEL[f.id]} ${f.text}`;
    if (f.band) line += ` (${f.band})`;
    line += ` — ${FIGURE_HINT[f.id]}`;
    if (f.partial !== undefined) line += `; partial: ${f.partial}`;
    return line;
  });
  return [head, ...lines].join('\n');
}
