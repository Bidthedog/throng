/**
 * 057 — what each holder (panel header, tab chip, project row, category header, taskbar badge) shows,
 * derived from the mark set (data-model § Holder state). Never stored. Failed outranks Attention (FR-014).
 */
import type { AttentionKind, AttentionMark, AttentionReason, AttentionSignalName } from './attention-types.js';

const REASON_LABELS: Record<AttentionSignalName, string> = {
  processExited: 'Process exited',
  commandFinished: 'Command finished',
  bell: 'Wants your attention', // FR-101: the user never sees a bell, only that something wants them
  notification: 'Notification',
  progressEnded: 'Progress ended',
  unseenOutput: 'Unseen output',
  outputQuiet: 'Output went quiet',
};

export function reasonLabel(reason: AttentionReason): string {
  return REASON_LABELS[reason.signal];
}

export function kindLabel(kind: AttentionKind): string {
  return kind === 'failed' ? 'Failed' : 'Attention';
}

/** The strongest kind among `marks`; null when there are none. */
function strongest(marks: readonly AttentionMark[]): AttentionKind | null {
  if (marks.length === 0) return null;
  return marks.some((m) => m.kind === 'failed') ? 'failed' : 'attention';
}

export function marksForPanels(marks: readonly AttentionMark[], panelIds: Iterable<string>): AttentionMark[] {
  const ids = new Set(panelIds);
  return marks.filter((m) => ids.has(m.panelId));
}

export function marksForProject(marks: readonly AttentionMark[], projectId: string): AttentionMark[] {
  return marks.filter((m) => m.projectId === projectId);
}

export function marksForProjects(marks: readonly AttentionMark[], projectIds: Iterable<string>): AttentionMark[] {
  const ids = new Set(projectIds);
  return marks.filter((m) => ids.has(m.projectId));
}

/** A tab chip, overflow control or panel header over `panelIds`. */
export function holderKind(marks: readonly AttentionMark[], panelIds: Iterable<string>): AttentionKind | null {
  return strongest(marksForPanels(marks, panelIds));
}

/** A project row, whether or not the project is loaded (FR-012). */
export function projectKind(marks: readonly AttentionMark[], projectId: string): AttentionKind | null {
  return strongest(marksForProject(marks, projectId));
}

/** A category header over every project in it, including rows a minimised category hides (FR-013). */
export function categoryKind(marks: readonly AttentionMark[], projectIds: Iterable<string>): AttentionKind | null {
  return strongest(marksForProjects(marks, projectIds));
}

/** The taskbar badge (FR-039); null when nothing is marked. */
export function badgeSummary(
  marks: readonly AttentionMark[],
): { count: number; label: string; kind: AttentionKind } | null {
  const kind = strongest(marks);
  if (kind === null) return null;
  return { count: marks.length, label: marks.length > 9 ? '9+' : String(marks.length), kind };
}

/** The reason as a line says it: the signal's wording, then the detail it carried (an exit code, a title). */
export function reasonText(reason: AttentionReason): string {
  const detail = reason.detail === null ? '' : ` '${reason.detail}'`;
  return `${reasonLabel(reason)}${detail}`;
}

/**
 * A mark as a notification or popover line says it (FR-102): the reason, then what the terminal was
 * doing — left out when unknown, or when the reason's own detail already names it (a finished command).
 */
export function describeMark(mark: AttentionMark): string {
  const reason = reasonText(mark.reason);
  return mark.doing !== null && mark.doing !== '' && mark.doing !== mark.reason.detail ? `${reason} — ${mark.doing}` : reason;
}

/**
 * What a toast or Windows notification says under the panel's title (FR-115, FR-117) — one line, nothing
 * appended: what failed, for a Failed mark; else the message the program sent, "<command> has finished",
 * or "Wants your attention". The popovers carry the rest (`describeMark`).
 */
export function notificationText(mark: AttentionMark): string {
  if (mark.kind === 'failed') return reasonText(mark.reason);
  const { signal, detail } = mark.reason;
  if (detail !== null && detail !== '') {
    if (signal === 'notification') return detail;
    if (signal === 'commandFinished') return `${detail} has finished`;
  }
  return 'Wants your attention';
}

/** One line per marked panel (FR-015). Pass the marks already filtered to the holder. */
export function tooltipLines(marks: readonly AttentionMark[]): string[] {
  return marks.map((m) => `${m.panelTitle} — ${m.projectName}: ${reasonText(m.reason)} (${kindLabel(m.kind)})`);
}

/** The tooltip as one accessible name. */
export function holderLabel(marks: readonly AttentionMark[]): string {
  return tooltipLines(marks).join('. ');
}
