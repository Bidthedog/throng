/**
 * The preview's LINK notice (044, FR-090e, FR-090f, FR-106c; contracts/menus-and-controls.md §9).
 *
 * ══ ONE CONDITION, ONE NOTICE ══
 *
 * A link that cannot be followed — its file missing, outside the project, or its heading not found — and
 * a history step main refused are reported HERE, inline in the panel, and nowhere else: not as a toast,
 * not in the failure banner (which is the file's own condition, FR-026). The panel holds one link notice
 * at a time. A second report of the SAME condition does not add a second element; it flashes this one
 * (`flash` counts the reports, and `useInPlaceFlash` restarts the animation on the same element, so focus
 * on Dismiss survives). A different
 * condition replaces it, because the reader has moved on to a different link.
 *
 * ══ STYLED AS THE SHARED IN-PANEL NOTICE ══
 *
 * The markup and classes are `panel-failure-banner.css`'s — `.panel-failure`, its text, headline and
 * control classes — so a link notice reads like every other in-panel notice in every theme, and
 * neither `preview.css` (the panel chrome) nor a provider's own stylesheet (e.g. `markdown.css`,
 * T093) ever styles it. The one control is Dismiss: the condition is a moment, not a state the panel
 * stays in, so there is nothing to retry.
 *
 * ══ WHAT IT SAYS ══
 *
 * What is wrong, naming the target — never what the reader may not do. A path is shown relative to the
 * project, the way Files & Folders names it.
 */
import type { ReactElement } from 'react';
import { relativeToRoot, type PreviewNotice } from '@throng/core';
import { IconButton } from '../common/icon-button.js';
import { useInPlaceFlash } from '../common/panel-failure-banner.js';
import { stripBidiControls } from './link-dom.js';
import '../common/panel-failure-banner.css';

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

export interface PreviewLinkNoticeProps {
  panelId: string;
  notice: LinkNotice;
  /** How many times this condition has been reported; each report after the first flashes. */
  flash: number;
  projectRoot: string | null;
  onDismiss: () => void;
}

export function PreviewLinkNotice({ panelId, notice, flash, projectRoot, onDismiss }: PreviewLinkNoticeProps): ReactElement {
  // Each report after the first restarts the flash IN PLACE (044 US2 fix round 1), exactly as the file
  // banner does, so a keyboard user's focus on Dismiss survives a repeat.
  const ref = useInPlaceFlash(flash, flash > 1);
  return (
    <div
      ref={ref}
      className={flash > 1 ? 'panel-failure panel-failure--flash' : 'panel-failure'}
      data-testid={`preview-link-notice-${panelId}`}
      data-notice-kind={notice.kind}
      data-flash={flash}
      role="status"
    >
      <div className="panel-failure__text">
        <strong className="panel-failure__headline">{linkNoticeMessage(notice, projectRoot)}</strong>
      </div>
      <IconButton token="dismiss" title="Dismiss" className="panel-failure__control" onClick={onDismiss} />
    </div>
  );
}
