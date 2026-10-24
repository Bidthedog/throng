/**
 * What the Resource Monitor's body shows for the current session and view (055 US2) — pure functions
 * over a hierarchy, so that WHICH nodes are drawn, in what order and with what words is decided in one
 * place and proven without a DOM. The components only draw this.
 *
 * Filtering, ordering and the idle rule are core's (`filterHierarchy`, `orderChildren`,
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
import { FIGURE_ORDER, figureOf, metricNumber, monitorFigure, type Figure, type FigureId } from './figures.js';
import { resolveFocusPath, type ViewState } from './monitor-session.js';

export interface BreakdownRow {
  readonly node: ResourceNode;
  /** 0 for a node that is a direct child of its section; deeper for a process under a process. */
  readonly depth: number;
  /** Node ids from the root: where drilling into this row puts the focus. */
  readonly path: readonly string[];
  readonly ended: boolean;
}

export type SectionId = 'components' | 'children';

export interface BreakdownSection {
  readonly id: SectionId;
  readonly title: string;
  /** The path of the section's parent; a child's path is this plus its id. */
  readonly basePath: readonly string[];
  /** The section's top-level nodes, ordered by the chosen metric. */
  readonly nodes: readonly ResourceNode[];
  /** `nodes` and, beneath processes (or everywhere, while filtering), their descendants. */
  readonly rows: readonly BreakdownRow[];
  /** The Total row (FR-104): the listed node's own rolled-up figures, whatever the filter shows. */
  readonly total: BreakdownTotal;
}

export interface BreakdownTotal {
  /** The node whose children are listed, as the capture has it — not as the filter shows it. */
  readonly node: ResourceNode;
  /** How many of the live children it counts the filter, Hide idle or Hide ended left out. */
  readonly hidden: number;
}

export interface BreakdownModel {
  readonly focusPath: readonly string[];
  readonly focus: ResourceNode;
  readonly sections: readonly BreakdownSection[];
  /** The live processes the text filter shows (a match keeps its subtree); 0 with no filter text. */
  readonly matches: number;
  /** The live processes Hide idle left out of what else is shown; 0 when it is off. */
  readonly hiddenIdle: number;
}

function countProcesses(node: ResourceNode, isEnded: (id: string) => boolean): number {
  let n = node.kind === 'process' && !isEnded(node.id) ? 1 : 0;
  for (const child of node.children) n += countProcesses(child, isEnded);
  return n;
}

/**
 * The live processes that match `text` THEMSELVES — not the ancestors kept to show them, nor the subtree a
 * match keeps. Core's `filterHierarchy` is asked about each process alone (children stripped), so the rule
 * for "matches" is core's (FR-061) and cannot drift from what the filter shows.
 */
function countMatches(node: ResourceNode, text: string, isEnded: (id: string) => boolean): number {
  let n = 0;
  if (node.kind === 'process' && !isEnded(node.id) && filterHierarchy({ ...node, children: [] }, { text }) !== null) n += 1;
  for (const child of node.children) n += countMatches(child, text, isEnded);
  return n;
}

export interface ModelContext {
  readonly isEnded: (nodeId: string) => boolean;
  /** A node's own figures, oldest first — the input of the idle rule. */
  readonly ownHistory: (nodeId: string) => readonly Metrics[];
  readonly thresholds: UsageThresholds;
  readonly machine: Pick<MachineInfo, 'installedRamBytes'>;
  /**
   * The order the nodes were last drawn in (every node id, in display order). Given, siblings keep the
   * place it gives them — new nodes follow, in ranked order, and gone ones fall away — instead of being
   * re-ranked by the chosen metric, so nothing moves under the pointer (FR-090).
   */
  readonly heldOrder?: readonly string[];
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
  held: ReadonlyMap<string, number> | undefined,
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
      out.push(...rowsFor(orderBy(node.children, metric, held), path, expandAll, metric, ctx, held, depth + 1));
    }
  }
  return out;
}

/**
 * Children ordered by the chosen figure, largest first. I/O is read PLUS write — the figure a row prints —
 * which core's `orderChildren` (one metric name) cannot say, so it orders shadows whose read carries the
 * sum and hands back the real nodes.
 */
function orderBy(nodes: readonly ResourceNode[], metric: FigureId, held?: ReadonlyMap<string, number>): ResourceNode[] {
  const ranked = rank(nodes, metric);
  if (held === undefined) return ranked;
  // Held nodes first, in the place they held; the rest follow in their ranked order.
  const place = (n: ResourceNode): number => held.get(n.id) ?? Number.POSITIVE_INFINITY;
  return ranked
    .map((n, rankIndex) => ({ n, rankIndex }))
    .sort((a, b) => {
      const pa = place(a.n);
      const pb = place(b.n);
      return pa === pb ? a.rankIndex - b.rankIndex : pa < pb ? -1 : 1;
    })
    .map((e) => e.n);
}

function rank(nodes: readonly ResourceNode[], metric: FigureId): ResourceNode[] {
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
  // Hide ended (FR-105) takes an ended process out before anything is ordered; Hide idle a live idle one.
  const hideEnded = view.hideEnded ? (n: ResourceNode): boolean => ctx.isEnded(n.id) : undefined;
  const hideIdle = view.hideIdle
    ? (n: ResourceNode): boolean => !ctx.isEnded(n.id) && isIdle(ctx.ownHistory(n.id), ctx.thresholds, ctx.machine)
    : undefined;
  const hide =
    hideEnded && hideIdle ? (n: ResourceNode): boolean => hideEnded(n) || hideIdle(n) : (hideEnded ?? hideIdle);
  const filtered = filterHierarchy(tree, { text: view.filterText, hide }) ?? { ...tree, children: [] };
  const searching = view.filterText.trim() !== '';
  const matches = searching ? countMatches(filtered, view.filterText, ctx.isEnded) : 0;
  // What Hide idle took out is what is shown without it, less what is shown with it.
  const hiddenIdle = view.hideIdle
    ? countProcesses(filterHierarchy(tree, { text: view.filterText, hide: hideEnded }) ?? filtered, ctx.isEnded) - countProcesses(filtered, ctx.isEnded)
    : 0;
  const focusPath = resolveFocusPath(view.focusPath, filtered);
  const focus = nodeAt(filtered, focusPath) ?? filtered;
  const expandAll = view.filterText.trim() !== '';

  const held = ctx.heldOrder === undefined ? undefined : new Map(ctx.heldOrder.map((id, i) => [id, i] as const));

  const ordered = (nodes: readonly ResourceNode[]): ResourceNode[] => orderBy(nodes, view.metric, held);
  // The Total is the listed node's own figure (FR-104), read from the capture rather than from what the
  // filter left, so filtering never changes it; an ended child counts toward nothing, so it is not "hidden".
  const listed = nodeAt(tree, focusPath) ?? focus;
  const shown = new Set(focus.children.map((c) => c.id));
  const total: BreakdownTotal = {
    node: listed,
    hidden: listed.children.filter((c) => c.kind !== 'limitation' && !ctx.isEnded(c.id) && !shown.has(c.id)).length,
  };
  const section = (
    id: SectionId,
    title: string,
    basePath: readonly string[],
    nodes: readonly ResourceNode[],
  ): BreakdownSection => {
    const top = ordered(nodes);
    return { id, title, basePath, nodes: top, rows: rowsFor(top, basePath, expandAll, view.metric, ctx, held), total };
  };

  // The top level lists the four components only (FR-103): the user's projects are one drill into Projects.
  const sections: BreakdownSection[] =
    focus.kind === 'root'
      ? [section('components', 'Components', focusPath, focus.children)]
      : [section('children', focus.label, focusPath, focus.children)];
  return { focusPath, focus, sections, matches, hiddenIdle };
}

/** Every row of every section, in the order the eye reads them — the keyboard's order. */
export function allRows(model: BreakdownModel): BreakdownRow[] {
  return model.sections.flatMap((s) => s.rows);
}

// ── share bars ───────────────────────────────────────────────────────────────────────────────────

export interface BarItem {
  readonly node: ResourceNode;
  /** The node's rolled-up figure for the chosen metric, as a number. */
  readonly value: number;
  /** `value` as a fraction (0 – 1) of the item the bars belong to. */
  readonly share: number;
}

export interface BarsModel {
  readonly bars: readonly BarItem[];
  /** The contributors too small to have a bar of their own, grouped; `null` when there are none. */
  readonly others: { readonly count: number; readonly value: number; readonly share: number } | null;
}

/** The most bars the right column draws before the rest are grouped. */
export const MAX_BARS = 12;
/** A contributor under this share is grouped, however few bars there are. */
export const MIN_BAR_SHARE = 0.015;

/**
 * The right column's bars for `subject` (FR-097): its children ranked by `metric`, biggest first, each with
 * its share of the subject — the subject's own figure, or what its children add up to when that is less
 * (the bars of a process do not sum to 100% while the process itself is doing some of the work). The small
 * ones are grouped into one "N others" line (Edge Cases, *Very large trees*). A node with nothing to size —
 * ended, not measured, unavailable, zero — takes no share (FR-020c) and no bar; it keeps its row on the left.
 */
export function barsFor(subject: ResourceNode, metric: FigureId, isEnded: (id: string) => boolean): BarsModel {
  const sized = subject.children
    .filter((n) => n.kind !== 'limitation' && !isEnded(n.id))
    .map((node) => ({ node, value: metricNumber(node.rolled, metric) }))
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value || (a.node.label < b.node.label ? -1 : a.node.label > b.node.label ? 1 : 0));
  const sum = sized.reduce((total, e) => total + e.value, 0);
  const whole = Math.max(metricNumber(subject.rolled, metric), sum);
  if (whole <= 0) return { bars: [], others: null };
  const keep = sized.filter((e, i) => i < MAX_BARS - 1 && e.value / whole >= MIN_BAR_SHARE);
  const rest = sized.filter((e) => !keep.includes(e));
  // One leftover would be "1 others" — a line for a single node is just that node's bar.
  const single = rest.length === 1 && keep.length < MAX_BARS;
  const shown = single ? [...keep, rest[0]!] : keep;
  const others = !single && rest.length > 0 ? rest.reduce((total, e) => total + e.value, 0) : 0;
  return {
    bars: shown.map((e) => ({ node: e.node, value: e.value, share: e.value / whole })),
    others: !single && rest.length > 0 ? { count: rest.length, value: others, share: others / whole } : null,
  };
}

// ── words ────────────────────────────────────────────────────────────────────────────────────────

export interface FigureContext {
  readonly thresholds: UsageThresholds;
  readonly machine: Pick<MachineInfo, 'installedRamBytes'>;
}

interface CachedFigures {
  readonly thresholds: UsageThresholds;
  readonly installedRamBytes: number;
  readonly figures: Figure[];
}
/**
 * A node's figures are worked out once per capture, not once per asker. Nodes are never changed once the
 * session holds them, and a figure depends on the node, the thresholds and the installed RAM alone — so a
 * row asking whether it must be redrawn, the row being redrawn, the summary and the readout all share one answer.
 */
const figuresCache = new WeakMap<ResourceNode, CachedFigures>();

/** The figures of a node's rolled-up metrics, in display order. */
export function figuresOf(node: ResourceNode, ctx: FigureContext): Figure[] {
  const hit = figuresCache.get(node);
  if (hit !== undefined && hit.thresholds === ctx.thresholds && hit.installedRamBytes === ctx.machine.installedRamBytes) return hit.figures;
  // Written as the monitor writes them (FR-107): "-" with the reason in the title, "~" before an estimate.
  const figures = FIGURE_ORDER.map((id) => monitorFigure(figureOf(id, node.rolled, ctx.thresholds, ctx.machine), node.estimated === true));
  figuresCache.set(node, { thresholds: ctx.thresholds, installedRamBytes: ctx.machine.installedRamBytes, figures });
  return figures;
}
