import type { ReactElement } from 'react';
import { encodingLabel, formatGrouped } from '@throng/core';
import { PanelFailureBanner } from '../common/panel-failure-banner.js';
import { panelSubject, usePanelPlace } from '../common/panel-subject.js';
import { getEditorActions } from './editor-actions.js';
import { useSaveRefusal, type SaveRefusal } from './encoding-refusal-store.js';

/**
 * The ONE notice for a save the document's encoding refused (059 FR-022).
 *
 * Inline, on the editor, drawn by the banner every panel type shares, with the single action that resolves
 * it — *Save as UTF-8*, which writes the same text in an encoding that can hold every character. It says
 * what is wrong (this encoding has no such character), never what the user may not do.
 *
 * The condition is the document's and the authority relays it to every view of the document; a second
 * refused save is relayed again and FLASHES this notice (`flash`) rather than raising another.
 */
export function encodingRefusalHeadline(r: Pick<SaveRefusal, 'encoding' | 'char' | 'line'>): string {
  const code = r.char.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0') ?? '';
  return `${encodingLabel(r.encoding, false)} has no character for “${r.char}” (U+${code}) on line ${formatGrouped(r.line)}, so the file was not saved.`;
}

export function EncodingSaveBanner({ panelId }: { panelId: string }): ReactElement | null {
  const refusal = useSaveRefusal(panelId);
  const place = usePanelPlace(panelId);
  if (refusal === null) return null;
  return (
    <PanelFailureBanner
      panelId={panelId}
      headline={encodingRefusalHeadline(refusal)}
      subject={panelSubject(place)}
      flash={refusal.flash}
      actions={[
        {
          label: 'Save as UTF-8',
          type: 'confirm',
          // 059 FR-055 — Save with Encoding is withdrawn: change the document to UTF-8 (one undo step), then the
          // ordinary save writes it. Undo after the save puts the original encoding back, dirty.
          onClick: () => {
            const actions = getEditorActions(panelId);
            if (!actions) return;
            void (async () => {
              await actions.changeEncoding?.('utf8', false);
              await actions.save();
            })();
          },
        },
      ]}
    />
  );
}
