/**
 * The preview's LINK notice (044, FR-090e, FR-090f, FR-106c, FR-123; contracts/menus-and-controls.md §9).
 *
 * ══ AN APPLICATION NOTIFICATION, NOT A PANEL ELEMENT (FR-123) ══
 *
 * A link that cannot be followed — its file missing, outside the project, or its heading not found — and
 * a history step main refused are reported as a warning in the application's notifications, raised by the
 * preview panel (`preview-panel.tsx`). Until Session 2026-09-17 this was an inline notice in the panel; the
 * maintainer asked for it to move. The file's own conditions (FR-026, FR-027) are not these: they stay in
 * the panel's failure banner, with their actions (`preview-notice.tsx`).
 *
 * ══ ONE CONDITION, ONE NOTIFICATION ══
 *
 * The panel holds one link notice at a time. A second report of the SAME condition ({@link sameLinkNotice})
 * is raised again unchanged, and the notification system's duplicate rule flashes the card already showing.
 * A different condition clears the last one first, because the reader has moved on to a different link.
 * Every card a panel raises carries {@link previewLinkNoticeTestId}, which is what clearing addresses.
 *
 * ══ WHAT IT SAYS ══
 *
 * The heading is what was attempted, in which panel ({@link linkNoticeAction} with the panel subject); the
 * message is what is wrong, naming the target — never what the reader may not do. A path is shown relative
 * to the project, the way File Explorer names it.
 */
import { relativeToRoot, type PreviewNotice } from '@throng/core';
import { stripBidiControls } from './link-dom.js';

/** The notices this surface shows. The file's own conditions (FR-026, FR-027) are the banner's. */
export type PreviewLinkNoticeKind = 'link-missing-file' | 'link-outside' | 'link-missing-heading' | 'history-refused';

export type LinkNotice = Extract<PreviewNotice, { kind: PreviewLinkNoticeKind }>;

const LINK_KINDS: ReadonlySet<string> = new Set<PreviewLinkNoticeKind>([
  'link-missing-file',
  'link-outside',
  'link-missing-heading',
  'history-refused',
]);

/** Whether a notice is one this surface shows. */
export function isLinkNotice(notice: PreviewNotice | null | undefined): notice is LinkNotice {
  return notice !== null && notice !== undefined && LINK_KINDS.has(notice.kind);
}

/** Two reports of the same condition — the same kind, about the same target. */
export function sameLinkNotice(a: LinkNotice, b: LinkNotice): boolean {
  return a.kind === b.kind && a.target === b.target;
}

/** The test id every link notification a preview panel raises carries — and what clearing it addresses. */
export function previewLinkNoticeTestId(panelId: string): string {
  return `preview-link-notice-${panelId}`;
}

/**
 * FR-123a — what the reader was trying to do, for the heading: `Couldn't {action} {panel}`. A refused history
 * step was not a link.
 */
export function linkNoticeAction(notice: LinkNotice): string {
  return notice.kind === 'history-refused' ? 'go back or forward in' : 'follow the link in';
}

/** The one sentence a link notice says (030 FR-040: never a raw error). */
export function linkNoticeMessage(notice: LinkNotice, projectRoot: string | null): string {
  // A target comes from a document; no bidi control in it may reorder what the notice says (fix round 2).
  const shown = (target: string): string => stripBidiControls(relativeToRoot(target, projectRoot));
  switch (notice.kind) {
    case 'link-missing-file':
      return `${shown(notice.target)} was not found.`;
    case 'link-outside':
      return `${shown(notice.target)} is outside this project.`;
    case 'link-missing-heading':
      return `No heading “${stripBidiControls(notice.target)}” was found.`;
    case 'history-refused':
      return `${shown(notice.target)} could not be shown.`;
    default:
      return 'That link could not be followed.';
  }
}
