/**
 * The preview's FILE notice (044, FR-026, FR-027, FR-028; contracts/menus-and-controls.md §9,
 * contracts/preview-ipc.md §2 `update.notice`).
 *
 * ══ ONE CONDITION, ONE NOTICE ══
 *
 * When a preview cannot show its file — unreadable, deleted, too large, not text — or the file's type
 * has no preview any more, MAIN holds that condition on the run and sends it on every update. This is
 * its one surface: the shared `PanelFailureBanner`, inline in the panel, never a toast. Its owner is
 * the run, so every caller that bounces off the condition sees this same banner rather than raising
 * its own. A repeat of the condition (`repeat: true`, main's answer to a refresh that finds it
 * unchanged) FLASHES this banner in place.
 *
 * The link notice (`preview-link-notice.tsx`) is a different condition — a link that could not be
 * followed while the preview stays where it is — with its own slot; a notice kind belongs to exactly
 * one of the two (`isFileNotice` / `isLinkNotice`).
 *
 * ══ WHAT EACH OFFERS ══
 *
 * | Notice                                   | Actions                                             |
 * |------------------------------------------|-----------------------------------------------------|
 * | unreadable, deleted, too-large, not-text | Try again (= Refresh, FR-028), Copy details, Clear panel type |
 * | no-provider (FR-027)                     | Close, and only Close — no retry can change a file's type |
 *
 * No notification is raised for any of these, so the banner's pointer offers Copy alone (FR-026).
 *
 * ══ WHICH FAILURE THE ONE SLOT SHOWS ══
 *
 * {@link shownPreviewFailure} is the one ranking of a preview's failures, read by the panel that draws the
 * banner AND by the header whose menu mirrors it (030 FR-042c) — so the menu's Copy details copies the
 * text of the banner actually on screen, and its three rows appear exactly when that banner offers them.
 *
 * ══ WHAT IT SAYS ══
 *
 * What is wrong with the file, in one sentence — never the notice's kind, never a raw error, and never
 * what the reader may not do. The file's path is shown under it, as every panel's banner shows it.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { toDisplayPath, type NoticeSubject, type OsName, type PreviewNotice } from '@throng/core';
import { PanelFailureBanner } from '../common/panel-failure-banner.js';
import type { PreviewFailure, PreviewPanelState } from './preview-store.js';

/** The notices this surface shows. The link conditions (FR-090e/f, FR-106c) are the link notice's. */
export type PreviewFileNoticeKind = 'unreadable' | 'deleted' | 'too-large' | 'not-text' | 'no-provider';

export type FileNotice = Extract<PreviewNotice, { kind: PreviewFileNoticeKind }>;

const FILE_KINDS: ReadonlySet<string> = new Set<PreviewFileNoticeKind>([
  'unreadable',
  'deleted',
  'too-large',
  'not-text',
  'no-provider',
]);

/** Whether a notice is one this surface shows. */
export function isFileNotice(notice: PreviewNotice | null | undefined): notice is FileNotice {
  return notice !== null && notice !== undefined && FILE_KINDS.has(notice.kind);
}

/** The one sentence a file notice says (030 FR-040, FR-026). */
export function previewNoticeMessage(notice: FileNotice): string {
  switch (notice.kind) {
    case 'deleted':
      return 'This file no longer exists.';
    case 'unreadable':
      return 'This file could not be read.';
    case 'too-large':
      return 'This file is too large to preview.';
    case 'not-text':
      return 'This file is not text.';
    case 'no-provider':
      return 'This file type has no preview.';
    default:
      return 'This file could not be shown.';
  }
}

/** The failure a preview's one banner slot shows, and which actions that banner offers. */
export type ShownPreviewFailure =
  | { source: 'failure'; failure: PreviewFailure; offers: 'retry' }
  | { source: 'notice'; notice: FileNotice; offers: 'retry' | 'close' };

/**
 * The failure a preview's banner shows, or `null` for none.
 *
 * An ATTACH failure outranks the file notice — without an attach there is no live run for the notice to
 * describe — and the file notice outranks a BODY failure, whose retry cannot help while the file itself
 * cannot be shown. Only one is ever drawn, so the menus' Try again reaches it.
 */
export function shownPreviewFailure(
  state: PreviewPanelState | undefined,
  failure: PreviewFailure | undefined,
): ShownPreviewFailure | null {
  if (failure?.kind === 'attach') return { source: 'failure', failure, offers: 'retry' };
  if (state !== undefined && isFileNotice(state.notice)) {
    return { source: 'notice', notice: state.notice, offers: state.notice.kind === 'no-provider' ? 'close' : 'retry' };
  }
  return failure !== undefined ? { source: 'failure', failure, offers: 'retry' } : null;
}

/**
 * Which failure a banner's words are about. Its actions play no part in what it says, so `offers` is not
 * asked for — a `ShownPreviewFailure` is accepted as it is.
 */
export type PreviewFailureSource = { source: 'failure'; failure: PreviewFailure } | { source: 'notice'; notice: FileNotice };

/**
 * What the shown failure's banner says — its headline and the path under it — assembled the way the banner
 * assembles them, so Copy details on the banner and on the header menu copy identical text (030 FR-042c).
 */
export function shownPreviewFailureFacts(
  shown: PreviewFailureSource,
  filePath: string | undefined,
  os: OsName,
): { headline: string; detail?: { path?: string; systemError?: string } } {
  if (shown.source === 'failure') {
    return { headline: shown.failure.headline, ...(shown.failure.detail ? { detail: shown.failure.detail } : {}) };
  }
  return {
    headline: previewNoticeMessage(shown.notice),
    ...(filePath ? { detail: { path: toDisplayPath(filePath, os) } } : {}),
  };
}

export interface PreviewFileNoticeProps {
  panelId: string;
  notice: FileNotice;
  /** The update revision that carried `notice` — each new revision with `repeat: true` is one more report. */
  revision: number;
  /** The file the run shows, for the path under the message. */
  filePath: string;
  subject: NoticeSubject;
  /** Refresh (FR-028): resolves `true` when the condition cleared. */
  onRetry: () => Promise<boolean>;
  /** The banner's Clear panel type (030 FR-043). */
  onClearType: () => void;
  /** Close the panel, as its header's Close Panel does (FR-027). */
  onClose: () => void;
}

export function PreviewFileNotice({
  panelId,
  notice,
  revision,
  filePath,
  subject,
  onRetry,
  onClearType,
  onClose,
}: PreviewFileNoticeProps): ReactElement {
  const os = window.throng?.osName ?? 'windows';
  const { detail } = shownPreviewFailureFacts({ source: 'notice', notice }, filePath, os);

  // Count the repeats of THIS condition: a new revision marked `repeat` is one more report of it; a
  // different condition starts the count again.
  // The count is held WITH its condition and read only while it still matches, so a new condition's banner
  // is never drawn, even for one frame, with the previous condition's flash.
  const [repeats, setRepeats] = useState<{ kind: string; count: number }>({ kind: notice.kind, count: 0 });
  const seen = useRef<{ kind: string; revision: number }>({ kind: notice.kind, revision });
  useEffect(() => {
    const last = seen.current;
    if (last.kind !== notice.kind) setRepeats({ kind: notice.kind, count: 0 });
    else if (notice.repeat === true && revision > last.revision) {
      setRepeats((r) => ({ kind: notice.kind, count: r.kind === notice.kind ? r.count + 1 : 1 }));
    }
    seen.current = { kind: notice.kind, revision };
  }, [notice.kind, notice.repeat, revision]);
  const flash = repeats.kind === notice.kind ? repeats.count : 0;

  const headline = previewNoticeMessage(notice);
  // FR-027 as amended — the no-provider banner's one action is Close; its variant draws no Copy details.
  // Keyed on the CONDITION: a different condition is a new banner, so nothing the last one said — a failed
  // retry's sentence above all — carries over (US2 fix round 1). A repeat of the same one keeps the element.
  // `notified={false}`: no notification is raised for a file notice, so the pointer names none (FR-026).
  return notice.kind === 'no-provider' ? (
    <PanelFailureBanner
      key={notice.kind}
      panelId={panelId}
      headline={headline}
      subject={subject}
      {...(detail ? { detail } : {})}
      flash={flash}
      notified={false}
      onClose={onClose}
    />
  ) : (
    <PanelFailureBanner
      key={notice.kind}
      panelId={panelId}
      headline={headline}
      subject={subject}
      {...(detail ? { detail } : {})}
      flash={flash}
      notified={false}
      onRetry={onRetry}
      onCancel={onClearType}
    />
  );
}
