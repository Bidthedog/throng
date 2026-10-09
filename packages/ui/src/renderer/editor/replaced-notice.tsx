import type { ReactElement } from 'react';
import { toDisplayPath } from '@throng/core';
import { PanelFailureBanner } from '../common/panel-failure-banner.js';
import { panelSubject, usePanelPlace } from '../common/panel-subject.js';
import { getEditorActions } from './editor-actions.js';
import { flashReplacedNotice, useEditorState } from './editor-state.js';

/**
 * The replaced notice (052 FR-012): the ONE notice a DIRTY editor shows when a Replace landed another file on its
 * path. Its unsaved changes are kept here; the path is the moved file's now, so a plain Save is refused.
 *
 * Standing and inline, drawn by the banner every panel type shares, with the two ways out as decisions: *Save As…*
 * keeps the changes in a file of their own, *Discard* gives them up and shows the file that is there now.
 *
 * One condition, one notice: the notice is owned by the panel's document state, not by whichever caller bounced
 * off it. A Ctrl+S the authority refuses raises no second surface — it FLASHES this one (`replacedFlash`).
 */
export function replacedHeadline(name: string): string {
  return `${name} was replaced by a moved file. Your unsaved changes are kept here.`;
}

const basename = (p: string): string => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);

export function ReplacedNotice({ panelId }: { panelId: string }): ReactElement {
  const state = useEditorState(panelId);
  const place = usePanelPlace(panelId);
  const os = window.throng?.osName ?? 'windows';
  const filePath = state?.filePath ?? null;
  const name = filePath ? basename(filePath) : (state?.displayName ?? 'This file');
  const discard = (): void => {
    void (async () => {
      const result = await window.throng?.editor?.discardReplaced?.(panelId);
      // The relay carries the outcome into the view and the layout. A refusal changes nothing, so it is
      // said on the notice that is already standing — flashed, not repeated.
      if (!result || result.ok !== true) flashReplacedNotice(panelId);
    })();
  };
  return (
    <PanelFailureBanner
      panelId={panelId}
      headline={replacedHeadline(name)}
      subject={panelSubject(place)}
      detail={filePath ? { path: toDisplayPath(filePath, os) } : undefined}
      flash={state?.replacedFlash ?? 0}
      actions={[
        { label: 'Save As…', type: 'confirm', onClick: () => void getEditorActions(panelId)?.saveAs() },
        { label: 'Discard', type: 'destroy', onClick: discard },
      ]}
      copyable
    />
  );
}
