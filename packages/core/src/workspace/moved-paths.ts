/**
 * Where a panel's file went after an in-app move, and whether the move took it out of the panel's project
 * (019 FR-002/FR-005, 050 FR-016, FR-035, R19).
 *
 * Pure, so the ONE rule serves both writers of a layout: main's walk of the layouts no window holds
 * (`moved-layout-walk.ts`) and the window that holds a layout, for its panels that are not mounted.
 */
import { EDITOR_KIND } from '../editor/panel-type.js';
import { isUnderPath, remainderUnder, samePath } from '../fs/path-id.js';
import { rewritePaths, serialiseHistory } from '../navigation/history.js';
import { PREVIEW_KIND } from '../preview/panel-type.js';
import type { LayoutNode, Panel, PersistedHistory, PreviewPanelConfig, Tab } from './model.js';
import { previewPathOf } from './persisted-paths.js';

/** One moved file or folder: its path before the move, and after. */
export interface MovedPathPair {
  from: string;
  to: string;
}

/**
 * Where did `absPath` go — if it went anywhere? A folder's pair re-points everything beneath it by PREFIX,
 * compared on the normalised form (`/` and `\` mixed), and the result is spelled the way the DESTINATION is
 * spelled. `null` when no pair covers it.
 */
export function movedPathOf(absPath: string, moves: readonly MovedPathPair[]): string | null {
  for (const move of moves) {
    if (samePath(absPath, move.from)) return move.to;
    // Cut by SEGMENTS (`remainderUnder`), never by a lower-cased length: lower-casing can lengthen a name.
    const remainder = remainderUnder(absPath, move.from);
    if (remainder !== null) {
      const to = move.to.replace(/[\\/]+$/, '');
      const sep = to.includes('\\') ? '\\' : '/';
      return to + remainder.replace(/[\\/]/g, sep);
    }
  }
  return null;
}

type PathedConfig = { filePath?: string; history?: PersistedHistory; movedOut?: true } & Record<string, unknown>;

/**
 * One editor or preview panel's config after `moves`, or `null` when the moves touch nothing in it.
 *
 * - `filePath` and every `history` entry follow the move.
 * - When the file the panel SHOWS moved (an editor's `filePath`; a preview's `previewPathOf`) and
 *   `projectRoot` is known: outside it → `movedOut: true`; inside it → `movedOut` is dropped.
 *   `projectRoot` is the root of the panel's project (its `originProjectId`); `undefined` for a panel of
 *   no project (a sub-workspace's own), which is never flagged.
 * - Any other panel kind → `null`.
 */
export function movedPanelConfig(
  panel: Panel,
  moves: readonly MovedPathPair[],
  projectRoot: string | undefined,
): Record<string, unknown> | null {
  if (panel.kind !== EDITOR_KIND && panel.kind !== PREVIEW_KIND) return null;
  const config = (panel.config ?? {}) as PathedConfig;
  const shownOf = (c: PathedConfig): string | undefined =>
    panel.kind === PREVIEW_KIND ? previewPathOf(c as PreviewPanelConfig) : c.filePath;
  const shownBefore = shownOf(config);
  let next: PathedConfig = config;
  const filePath = config.filePath !== undefined ? movedPathOf(config.filePath, moves) : null;
  if (filePath !== null && filePath !== config.filePath) next = { ...next, filePath };
  if (config.history) {
    const before = { entries: config.history.entries, index: config.history.index };
    const after = rewritePaths(before, moves);
    if (after !== before) next = { ...next, history: serialiseHistory(after) };
  }
  if (next === config) return null;
  const shownAfter = shownOf(next);
  const shownMoved = shownBefore !== undefined && shownAfter !== undefined && !samePath(shownBefore, shownAfter);
  if (shownMoved && projectRoot !== undefined) {
    if (isUnderPath(shownAfter, projectRoot)) {
      const { movedOut: _dropped, ...rest } = next;
      next = rest;
    } else next = { ...next, movedOut: true };
  }
  return next;
}

/** `movedPanelConfig` over every panel under `node`; the same node back when nothing changed. */
export function moveLayoutNode(
  node: LayoutNode,
  moves: readonly MovedPathPair[],
  rootOf: (panel: Panel) => string | undefined,
): LayoutNode {
  if (node.type === 'panel') {
    const config = movedPanelConfig(node, moves, rootOf(node));
    return config === null ? node : { ...node, config };
  }
  let changed = false;
  const children = node.children.map((child) => {
    const moved = moveLayoutNode(child, moves, rootOf);
    if (moved !== child) changed = true;
    return moved;
  });
  return changed ? { ...node, children } : node;
}

/** `moveLayoutNode` over every tab; `null` when nothing in them changed. */
export function moveLayoutTabs(
  tabs: readonly Tab[],
  moves: readonly MovedPathPair[],
  rootOf: (panel: Panel) => string | undefined,
): Tab[] | null {
  let changed = false;
  const next = tabs.map((tab) => {
    const root = moveLayoutNode(tab.root, moves, rootOf);
    if (root === tab.root) return tab;
    changed = true;
    return { ...tab, root };
  });
  return changed ? next : null;
}
