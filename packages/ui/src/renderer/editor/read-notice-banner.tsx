import type { ReactElement } from 'react';
import { codePageName, encodingLabel, isCodePageId } from '@throng/core';
import { PanelFailureBanner, type PanelFailureAction } from '../common/panel-failure-banner.js';
import { panelSubject, usePanelPlace } from '../common/panel-subject.js';
import { getEditorActions } from './editor-actions.js';
import { requestEncodingPicker } from './picker-request.js';
import { useReadNotice, type ReadNotice } from './read-notice-store.js';

/**
 * The ONE notice for how the document was read (059 FR-068, FR-069).
 *
 * After a Reopen with Encoding it says the reading lasts for this editor session only — nothing about it is
 * kept, so the file opens the old way next time — and how to fix the file. On an open that may have been read
 * in the wrong encoding it says so: a UTF-8 reading that looks like the fallback code page read as UTF-8, or a
 * code-page reading whose text looks like another code page. A hint, which the user can dismiss. Inline, on
 * the banner every panel type shares, with the actions that resolve it; main owns it, so Dismiss asks main.
 */
/** A code page by its number and script; anything else by its status-bar name. */
function nameOf(encoding: ReadNotice['readAs']): string {
  return isCodePageId(encoding) ? codePageName(encoding) : encodingLabel(encoding, false);
}

export function readNoticeHeadline(n: ReadNotice): string {
  const readAs = encodingLabel(n.readAs, false);
  if (n.kind === 'reopened') {
    const lasts = `This file has been read as ${nameOf(n.readAs)} for this editor session only; the file is unchanged.`;
    // FR-071: name the remedies that make it open this way every time. A UTF-8 reopen keeps FR-068's wording.
    if (n.readAs === 'utf8') return `${lasts} To fix the file, change its encoding, verify, and save.`;
    return n.fallbackHelps
      ? `${lasts} To open it this way every time, convert it to UTF-8 and save, or make ${nameOf(n.readAs)} your fallback encoding in preferences.`
      : `${lasts} To open it this way every time, convert it to UTF-8 and save.`;
  }
  if (n.readAs === 'utf8') {
    return `This file may be ${encodingLabel(n.likely ?? 'windows1252', false)} text read as UTF-8: some words mix letters from different scripts.`;
  }
  return n.likely
    ? `This file was read as ${readAs}, but its text looks like ${codePageName(n.likely)}.`
    : `This file was read as ${readAs}, but its text may be in another encoding.`;
}

function actionsFor(panelId: string, n: ReadNotice): PanelFailureAction[] {
  if (n.kind === 'reopened') {
    if (n.readAs === 'utf8') {
      return [{ label: 'Change Encoding…', type: 'confirm', onClick: () => requestEncodingPicker(panelId, 'change') }];
    }
    // FR-071: not the picker, which would open on the encoding already chosen — the remedy itself. The fallback
    // is named in the sentence and set in preferences, never from here (FR-074).
    return [
      {
        label: 'Convert to UTF-8',
        type: 'confirm',
        onClick: () => void getEditorActions(panelId)?.changeEncoding?.('utf8', false),
      },
    ];
  }
  // A UTF-8 suspect always has its code page: the fallback the bytes would otherwise have been read in.
  const likely = n.likely ?? (n.readAs === 'utf8' ? 'windows1252' : null);
  const out: PanelFailureAction[] = [];
  if (likely) {
    out.push({
      label: `Reopen as ${codePageName(likely)}`,
      type: 'confirm',
      onClick: () => void getEditorActions(panelId)?.reopenWithEncoding?.(likely),
    });
  }
  if (n.readAs !== 'utf8') {
    out.push({ label: 'Reopen with Encoding…', type: 'confirm', onClick: () => requestEncodingPicker(panelId, 'reopen') });
  }
  return out;
}

export function ReadNoticeBanner({ panelId }: { panelId: string }): ReactElement | null {
  const notice = useReadNotice(panelId);
  const place = usePanelPlace(panelId);
  if (notice === null) return null;
  return (
    <PanelFailureBanner
      panelId={panelId}
      headline={readNoticeHeadline(notice)}
      subject={panelSubject(place)}
      actions={[
        ...actionsFor(panelId, notice),
        {
          // Gives nothing up: the file is untouched either way.
          label: 'Dismiss',
          type: 'confirm',
          onClick: () => void window.throng?.editor?.dismissReadNotice?.({ panelId }),
        },
      ]}
    />
  );
}
