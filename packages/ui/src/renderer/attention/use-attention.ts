import { useMemo, useSyncExternalStore } from 'react';
import {
  categoryKind,
  holderKind,
  holderLabel,
  marksForPanels,
  marksForProject,
  marksForProjects,
  projectKind,
  type AttentionKind,
  type AttentionMark,
} from '@throng/core';
import { getAttentionMarks, subscribeAttention } from './attention-store.js';

/**
 * What a holder draws: the kind of its mark, and the one-line-per-marked-panel text that is both its
 * tooltip and its accessible name (FR-015).
 */
export interface HolderMark {
  kind: AttentionKind;
  label: string;
}

/**
 * Selectors over the store that are compared BY VALUE (Principle XII).
 *
 * A holder subscribes through a string key, not through the mark array. `useSyncExternalStore`
 * re-renders a component only when its snapshot changes under `Object.is`, and a string is compared by
 * value — so a project row whose own marks did not change does not re-render when some other project's
 * mark is raised. With 200 tabs on screen that is the difference between one row updating and the
 * whole strip.
 */
const SEP = '\n';

function encode(kind: AttentionKind | null, marks: readonly AttentionMark[]): string {
  if (kind === null || marks.length === 0) return '';
  return `${kind}${SEP}${holderLabel(marks)}`;
}

function decode(key: string): HolderMark | null {
  if (key === '') return null;
  const at = key.indexOf(SEP);
  return { kind: key.slice(0, at) as AttentionKind, label: key.slice(at + 1) };
}

function useKey(compute: (marks: readonly AttentionMark[]) => string): HolderMark | null {
  const key = useSyncExternalStore(
    subscribeAttention,
    () => compute(getAttentionMarks()),
    () => '',
  );
  return useMemo(() => decode(key), [key]);
}

/** The mark on one panel (its header), or `null`. */
export function usePanelMark(panelId: string): HolderMark | null {
  return useKey((marks) => {
    const mine = marksForPanels(marks, [panelId]);
    return encode(holderKind(marks, [panelId]), mine);
  });
}

/**
 * The mark a holder of SEVERAL panels wears — a tab chip, a strip's overflow control, a tab-picker row:
 * Failed if any is failed (FR-014), one tooltip line per marked panel.
 */
export function useMarkForPanels(panelIds: readonly string[]): HolderMark | null {
  return useKey((marks) => encode(holderKind(marks, panelIds), marksForPanels(marks, panelIds)));
}

/** The mark on a project row, for the active, loaded and unloaded alike (FR-012). */
export function useProjectMarkKey(projectId: string): HolderMark | null {
  return useKey((marks) => encode(projectKind(marks, projectId), marksForProject(marks, projectId)));
}

/**
 * The mark on a minimised category's header: any project in the category counts, whether or not its row
 * is visible (FR-013).
 */
export function useCategoryMark(projectIds: readonly string[]): HolderMark | null {
  return useKey((marks) => encode(categoryKind(marks, projectIds), marksForProjects(marks, projectIds)));
}

/** The whole set, for the few consumers that need it (the badge, Go to Next Marked Panel). */
export function useAttentionMarks(): readonly AttentionMark[] {
  return useSyncExternalStore(subscribeAttention, getAttentionMarks, getAttentionMarks);
}
