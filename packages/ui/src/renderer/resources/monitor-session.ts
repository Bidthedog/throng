/**
 * The Resource Monitor window's session (055 FR-033, FR-033a, FR-057, FR-065a, data-model *Ended
 * entries* and *Modal view state*): the one place that remembers anything between two frames.
 *
 * Module-level state read through `useSyncExternalStore` — `workspace/maximise-store.ts`'s pattern —
 * because the writers (the window shell feeding frames, the toolbar, the breakdown) and the readers
 * (every pane of the body) share no component, and the view state must outlive the window's mount.
 *
 * ══ TWO LIFETIMES ══
 *
 *  - The SESSION (history, ended entries, the displayed tree) lives from `startSession` to
 *    `endSession`: charts start empty on every open and are discarded on close (FR-033).
 *  - The VIEW (metric, filter, narrowing, hide idle, focus path) is held by UI main until throng
 *    restarts and never persisted (FR-057, FR-087): each open is a fresh renderer, so `restoreView` reapplies it.
 *
 * ══ ENDED ENTRIES ══
 *
 * The collector sends the live hierarchy only. A process present in the previous frame and absent from
 * the next — killed here or ended on its own — is re-inserted at its last place with its figures
 * cleared, so it reads "ended" and can neither take a share nor feed a roll-up. Roll-ups need no
 * correction: they arrive already summed over the live nodes only. A process that is merely somewhere
 * ELSE in the new frame (lineage re-attributed it) is live, not ended. A process never seen live is
 * never shown, because it is only ever re-inserted from a frame we held. A UI element that vanishes
 * (a destroyed panel) takes its ended processes with it: there is no place left to show them in.
 */
import { useSyncExternalStore } from 'react';
import { NOT_MEASURED, historyLength, type Metrics, type ResourceNode } from '@throng/core';
import type { DetailFrame } from '@throng/ipc-contract';
import { metricNumber, type FigureId } from './figures.js';

export interface SessionSettings {
  readonly intervalSeconds: number;
  readonly historyMinutes: number;
}

/** One sample of one node: its own figures and its rolled-up figures at a tick. */
export interface HistoryPoint {
  readonly tick: number;
  /** Epoch ms of the reading. */
  readonly at: number;
  readonly own: Metrics;
  readonly rolled: Metrics;
}

export interface SessionSnapshot {
  /** The latest frame, or `null` before the first one arrives (the window's loading state, FR-051). */
  readonly frame: DetailFrame | null;
  /** The latest hierarchy with ended processes re-inserted, or `null` before the first frame. */
  readonly tree: ResourceNode | null;
  /** Bumps on every ingest, so a reader of {@link getHistory} knows its arrays moved. */
  readonly version: number;
}

export interface ViewState {
  readonly metric: FigureId;
  readonly filterText: string;
  /** A component (`c:…`) or project (`p:…`) id, or `null` for everything. */
  readonly narrowTo: string | null;
  readonly hideIdle: boolean;
  /** Node ids from the root down to the node in focus. */
  readonly focusPath: readonly string[];
}

const DEFAULT_VIEW: ViewState = Object.freeze({
  metric: 'cpu',
  filterText: '',
  narrowTo: null,
  hideIdle: false,
  focusPath: Object.freeze(['root']),
});

/** An ended node's figures: nothing to sum, nothing to size, and never a zero that reads as live. */
const ENDED_METRICS: Metrics = Object.freeze({
  cpu: NOT_MEASURED,
  memory: NOT_MEASURED,
  gpu: NOT_MEASURED,
  ioRead: NOT_MEASURED,
  ioWrite: NOT_MEASURED,
  network: NOT_MEASURED,
});

const EMPTY: readonly HistoryPoint[] = Object.freeze([]);
const EMPTY_SNAPSHOT: SessionSnapshot = Object.freeze({ frame: null, tree: null, version: 0 });

/** The most points a node ever keeps (FR-004b makes the table that bounds it). */
const DEFAULT_CAPACITY = 150;

let capacity = DEFAULT_CAPACITY;
let snapshot: SessionSnapshot = EMPTY_SNAPSHOT;
let version = 0;
let view: ViewState = DEFAULT_VIEW;
/** The node the detail pane describes (the keyboard- or click-selected row); `null` means the node in focus. */
let selectedId: string | null = null;
/** The highest total read-plus-write rate seen since the window opened: what I/O bars are coloured against (FR-094). */
let ioPeak = 0;
const history = new Map<string, HistoryPoint[]>();
const endedIds = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function walk(node: ResourceNode, visit: (n: ResourceNode) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

function trim(points: HistoryPoint[]): void {
  if (points.length > capacity) points.splice(0, points.length - capacity);
}

/** A new session: charts empty, nothing ended, window sized from the settings. The view is kept. */
export function startSession(settings: SessionSettings): void {
  history.clear();
  endedIds.clear();
  selectedId = null;
  ioPeak = 0;
  notice = null;
  capacity = Math.min(DEFAULT_CAPACITY, historyLength(settings));
  version += 1;
  snapshot = { frame: null, tree: null, version };
  notify();
}

/** The window closed: history, ended entries and the displayed tree are discarded (FR-033, FR-065a). */
export function endSession(): void {
  history.clear();
  endedIds.clear();
  selectedId = null;
  ioPeak = 0;
  notice = null;
  capacity = DEFAULT_CAPACITY;
  version += 1;
  snapshot = { frame: null, tree: null, version };
  notify();
}

/** The interval or the window changed while open: resize the window, dropping the oldest points. */
export function reconfigureSession(settings: SessionSettings): void {
  capacity = Math.min(DEFAULT_CAPACITY, historyLength(settings));
  for (const points of history.values()) trim(points);
  version += 1;
  snapshot = { ...snapshot, version };
  notify();
}

function markEnded(node: ResourceNode, liveIds: ReadonlySet<string>): ResourceNode {
  endedIds.add(node.id);
  const children = node.children
    // A descendant that is live elsewhere in the new frame did not end with its parent.
    .filter((c) => !liveIds.has(c.id))
    .map((c) => (endedIds.has(c.id) ? c : markEnded(c, liveIds)));
  return { ...node, own: ENDED_METRICS, rolled: ENDED_METRICS, children };
}

function mergeEnded(prev: ResourceNode | null, next: ResourceNode): ResourceNode {
  if (prev === null) return next;
  const liveIds = new Set<string>();
  walk(next, (n) => liveIds.add(n.id));

  const merge = (before: ResourceNode | undefined, now: ResourceNode): ResourceNode => {
    if (before === undefined) return now;
    const beforeById = new Map(before.children.map((c) => [c.id, c]));
    const children = now.children.map((c) => merge(beforeById.get(c.id), c));
    let changed = children.some((c, i) => c !== now.children[i]);
    before.children.forEach((old, index) => {
      if (liveIds.has(old.id) || old.kind !== 'process') return;
      children.splice(Math.min(index, children.length), 0, endedIds.has(old.id) ? old : markEnded(old, liveIds));
      changed = true;
    });
    return changed ? { ...now, children } : now;
  };
  return merge(prev, next);
}

/** Take one detail frame: record every live node's point, then re-insert what vanished as ended. */
export function ingestFrame(f: DetailFrame): void {
  // A stale frame repeats the last good reading (and its time) at a later tick: shown as the latest, but
  // recording it would draw a flat run of identical points across the charts for as long as it lasts.
  if (!f.stale) recordPoints(f);
  if (pendingCatchUps > 0) {
    pendingCatchUps -= 1;
    catchUpEpoch += 1;
  }
  mergeFrame(f);
}

// ── catching a held list up with what the user just did (FR-095) ──────────────────────────────────

/**
 * A list the pointer rests on holds still (FR-095) — but a Kill, Unload or Destroy chosen from it must
 * show its result there, or the user is left looking at a process that has already ended. An action asks
 * for the next two captures to be taken into held lists too: the first may be read before the process has
 * gone, the second will not be. The order still holds; only what the rows say catches up.
 */
const CATCH_UP_CAPTURES = 2;
let pendingCatchUps = 0;
let catchUpEpoch = 0;

export function requestCatchUp(): void {
  pendingCatchUps = CATCH_UP_CAPTURES;
}

const getCatchUpEpoch = (): number => catchUpEpoch;

/** Changes each time a held list should take the latest capture. */
export function useCatchUpEpoch(): number {
  return useSyncExternalStore(subscribeSession, getCatchUpEpoch, getCatchUpEpoch);
}

function recordPoints(f: DetailFrame): void {
  ioPeak = Math.max(ioPeak, metricNumber(f.hierarchy.rolled, 'io'));
  walk(f.hierarchy, (n) => {
    let points = history.get(n.id);
    if (points === undefined) {
      points = [];
      history.set(n.id, points);
    }
    points.push({ tick: f.tick, at: f.at, own: n.own, rolled: n.rolled });
    trim(points);
  });
}

function mergeFrame(f: DetailFrame): void {
  const tree = mergeEnded(snapshot.tree, f.hierarchy);
  /*
   * A narrowing to a component or project that is no longer in the tree is dropped (FR-057: fall back to
   * the nearest thing that survives, here "everything"). Left in place it filters every node out while
   * the toolbar's <select>, which has no such option, reads "Everything" — an empty monitor with nothing
   * to explain it. This runs on every frame, so it covers a reopen (the first frame) and a project that
   * goes away while the monitor is open. The focus path needs no fix: it resolves to its nearest survivor.
   */
  if (view.narrowTo !== null) {
    let present = false;
    walk(tree, (n) => {
      if (n.id === view.narrowTo) present = true;
    });
    if (!present) view = { ...view, narrowTo: null };
  }
  version += 1;
  snapshot = { frame: f, tree, version };
  notify();
}

export function getSessionSnapshot(): SessionSnapshot {
  return snapshot;
}

/** The highest total I/O rate (read plus write) reached since the window opened; 0 before any. */
export function getIoPeak(): number {
  return ioPeak;
}

export function isEnded(nodeId: string): boolean {
  return endedIds.has(nodeId);
}

/** A node's points, oldest first. Empty for a node the session never saw. */
export function getHistory(nodeId: string): readonly HistoryPoint[] {
  return history.get(nodeId) ?? EMPTY;
}

// ── view state ───────────────────────────────────────────────────────────────────────────────────

export function getView(): ViewState {
  return view;
}

export function setView(patch: Partial<ViewState>): void {
  const next = { ...view, ...patch };
  if ((Object.keys(next) as (keyof ViewState)[]).every((k) => next[k] === view[k])) return;
  view = next;
  notify();
}

/**
 * Apply the view UI main held for the last monitor window (FR-087). It crosses IPC as opaque JSON, so
 * every field is checked and an unusable one is left at its default rather than trusted.
 */
export function restoreView(raw: unknown): void {
  if (typeof raw !== 'object' || raw === null) return;
  const r = raw as Record<string, unknown>;
  const patch: { -readonly [K in keyof ViewState]?: ViewState[K] } = {};
  if (r.metric === 'cpu' || r.metric === 'memory' || r.metric === 'gpu' || r.metric === 'io') patch.metric = r.metric;
  if (typeof r.filterText === 'string') patch.filterText = r.filterText;
  if (typeof r.narrowTo === 'string' || r.narrowTo === null) patch.narrowTo = r.narrowTo;
  if (typeof r.hideIdle === 'boolean') patch.hideIdle = r.hideIdle;
  if (Array.isArray(r.focusPath) && r.focusPath.length > 0 && r.focusPath.every((s) => typeof s === 'string')) {
    patch.focusPath = r.focusPath as string[];
  }
  setView(patch);
}

/** Drill to a node (or go back up to one): the breakdown re-roots there and the detail pane follows it. */
export function focusOn(path: readonly string[]): void {
  const same = view.focusPath.length === path.length && view.focusPath.every((id, i) => id === path[i]);
  if (same && selectedId === null) return;
  view = same ? view : { ...view, focusPath: path };
  selectedId = null;
  notify();
}

/**
 * `path` as far as it still exists in `tree`: the nearest surviving ancestor of a node that is gone
 * (FR-057). With no tree yet the path is returned untouched, to be resolved against the first frame.
 */
export function resolveFocusPath(path: readonly string[], tree: ResourceNode | null): readonly string[] {
  if (tree === null) return path;
  if (path[0] !== tree.id) return [tree.id];
  const out = [tree.id];
  let current = tree;
  for (let i = 1; i < path.length; i += 1) {
    const next = current.children.find((c) => c.id === path[i]);
    if (next === undefined) break;
    out.push(next.id);
    current = next;
  }
  return out;
}

// ── selection (session-long, not part of the view FR-057 restores) ───────────────────────────────

export function getSelection(): string | null {
  return selectedId;
}

export function setSelection(id: string | null): void {
  if (selectedId === id) return;
  selectedId = id;
  notify();
}

/** A click on a node: select it, or — when it already is the selection — clear it (FR-088). */
export function toggleSelection(id: string): void {
  setSelection(selectedId === id ? null : id);
}

export function useSelection(): string | null {
  return useSyncExternalStore(subscribeSession, getSelection, getSelection);
}

// ── the one inline notice (030 "one condition, one notice"; 055 FR-064) ───────────────────────────

/** What went wrong with an action the monitor ran, in plain terms — never a raw error string. */
export interface MonitorNotice {
  readonly heading: string;
  readonly lines: readonly string[];
}

let notice: MonitorNotice | null = null;

export function getNotice(): MonitorNotice | null {
  return notice;
}

/** Raise the notice, or clear it with `null`. A second failure REPLACES the first: it is one surface. */
export function setNotice(next: MonitorNotice | null): void {
  notice = next;
  notify();
}

export function useNotice(): MonitorNotice | null {
  return useSyncExternalStore(subscribeSession, getNotice, getNotice);
}

export function useSession(): SessionSnapshot {
  return useSyncExternalStore(subscribeSession, getSessionSnapshot, getSessionSnapshot);
}

const hasFrame = (): boolean => snapshot.frame !== null;

/**
 * Whether the first frame has arrived — and nothing else. A reader that only needs to know that (the
 * window's shell) subscribes to this, not to {@link useSession}, so a capture does not re-render it (D3).
 */
export function useHasFrame(): boolean {
  return useSyncExternalStore(subscribeSession, hasFrame, hasFrame);
}

export function useView(): ViewState {
  return useSyncExternalStore(subscribeSession, getView, getView);
}

/** Tests only: no session, no view memory, no listeners. */
export function __resetSession(): void {
  pendingCatchUps = 0;
  catchUpEpoch = 0;
  history.clear();
  endedIds.clear();
  capacity = DEFAULT_CAPACITY;
  version = 0;
  snapshot = EMPTY_SNAPSHOT;
  view = DEFAULT_VIEW;
  selectedId = null;
  ioPeak = 0;
  notice = null;
  listeners.clear();
}
