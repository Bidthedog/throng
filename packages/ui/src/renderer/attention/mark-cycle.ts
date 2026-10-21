import type { WorkspaceLayout } from '@throng/core';
import { getAttentionMarks } from './attention-store.js';
import { groupMarksByProject, nextInCycle } from './mark-order.js';

/**
 * Click-to-cycle through the marked panels a holder stands for (057 FR-105, FR-106): a project row's mark
 * and the Go to Next Marked Panel row of that project's context menu share ONE cursor per project, so a
 * click then a menu pick walk the same cycle rather than each starting again from the first.
 *
 * The cursor is module state keyed by holder (`project:<id>`, `category:<id>`), because the holders that
 * share it are different components and neither owns the other. It holds a panel id and a position, never
 * a mark, so a mark that has since cleared costs nothing (see {@link nextInCycle}).
 */
const cursors = new Map<string, { panelId: string | null; index: number }>();

export function projectCycleKey(projectId: string): string {
  return `project:${projectId}`;
}

export function categoryCycleKey(categoryId: string): string {
  return `category:${categoryId}`;
}

/** Whether any of `projectIds` has a marked panel now. */
export function hasMarkedPanel(projectIds: readonly string[]): boolean {
  const ids = new Set(projectIds);
  return getAttentionMarks().some((m) => ids.has(m.projectId));
}

/**
 * Go to the next marked panel of `projectIds` (project by project in the order given, each project's
 * panels in layout order where `layout` is theirs, else raise order), wrapping. Goes through main, which
 * routes to the window hosting the panel and switches project if need be (`attention.goTo`, the route a
 * toast's link takes). Returns the panel gone to, or `null` when nothing is marked.
 */
export function goToNextMarkedOf(
  key: string,
  projectIds: readonly string[],
  layout: WorkspaceLayout | null,
): string | null {
  const flat = groupMarksByProject(getAttentionMarks(), projectIds, layout).flatMap((g) => g.marks.map((m) => m.panelId));
  const last = cursors.get(key) ?? { panelId: null, index: -1 };
  const next = nextInCycle(flat, last.panelId, last.index);
  if (next === null) return null;
  cursors.set(key, next);
  window.throng?.attention?.goTo?.(next.panelId);
  return next.panelId;
}

/** Test seam: forget every cursor. */
export function __resetMarkCycles(): void {
  cursors.clear();
}
