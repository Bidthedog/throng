/**
 * 057 FR-080 — "Go to Next Marked Panel": which marked panel comes after where the user is.
 *
 * Pure. The caller supplies the navigation order it can see; marks the order does not list are not lost:
 * they follow their project's listed panels, oldest raise first, and marks for a project the order does
 * not list come last. Window-specific knowledge (which tabs exist, sub-workspace panels) stays with the
 * caller, which orders `panelIds` by tab and then by panel, sub-workspace panels last.
 */
import type { AttentionMark } from './attention-types.js';

/** Project-list order; each project's panels in tab order, then panel order. A project may list none. */
export type AttentionOrder = readonly { projectId: string; panelIds: readonly string[] }[];

export interface AttentionPosition {
  projectId: string;
  /** The focused panel, or null when focus is not in one (then the position is the start of the project). */
  panelId: string | null;
}

export interface MarkedPanelTarget {
  panelId: string;
  projectId: string;
}

export function nextMarkedPanel(
  position: AttentionPosition | null,
  order: AttentionOrder,
  marks: readonly AttentionMark[],
): MarkedPanelTarget | null {
  if (marks.length === 0) return null;
  const marked = new Map(marks.map((m) => [m.panelId, m]));

  // Every panel the order lists (marked or not, so a position on an unmarked panel has a place), then the
  // marks it does not list.
  const sequence: MarkedPanelTarget[] = [];
  /** Where each project's segment starts in `sequence`. */
  const segmentStart = new Map<string, number>();
  const listed = new Set<string>();
  const projects: string[] = [];
  const known = new Set<string>();
  const addProject = (projectId: string): void => {
    if (!known.has(projectId)) {
      known.add(projectId);
      projects.push(projectId);
    }
  };
  for (const entry of order) addProject(entry.projectId);
  for (const m of marks) addProject(m.projectId);

  for (const projectId of projects) {
    segmentStart.set(projectId, sequence.length);
    for (const entry of order) {
      if (entry.projectId !== projectId) continue;
      for (const panelId of entry.panelIds) {
        if (listed.has(panelId)) continue;
        listed.add(panelId);
        sequence.push({ panelId, projectId });
      }
    }
    const unlisted = marks
      .filter((m) => m.projectId === projectId && !listed.has(m.panelId))
      .sort((a, b) => a.raisedAt - b.raisedAt);
    for (const m of unlisted) {
      listed.add(m.panelId);
      sequence.push({ panelId: m.panelId, projectId });
    }
  }

  let at = -1;
  if (position !== null) {
    const found = position.panelId === null ? -1 : sequence.findIndex((s) => s.panelId === position.panelId);
    if (found >= 0) at = found;
    else at = (segmentStart.get(position.projectId) ?? sequence.length) - 1;
  }
  for (let step = 1; step <= sequence.length; step++) {
    const candidate = sequence[(at + step + sequence.length) % sequence.length]!;
    if (marked.has(candidate.panelId)) return candidate;
  }
  return null;
}
