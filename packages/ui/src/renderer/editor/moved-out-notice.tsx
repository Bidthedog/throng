import type { ReactElement } from 'react';
import { toDisplayPath } from '@throng/core';
import { PanelFailureBanner } from '../common/panel-failure-banner.js';
import { panelSubject, usePanelPlace } from '../common/panel-subject.js';

/**
 * The moved notice (050 FR-035): the ONE notice an editor or preview shows when a move took its file
 * out of its project. Standing, inline, and drawn by the banner every panel type shares — the variant
 * with Close and Copy, no Retry (no retry brings a file back into a project it left).
 *
 * The headline names the new path as the user sees paths elsewhere (`toDisplayPath`). The path is also
 * the banner's own path line, so Copy carries it under the headline like every other banner.
 */
export function movedOutHeadline(displayPath: string): string {
  return `This file moved to another project, at ${displayPath}. You can no longer work on it in this project.`;
}

export function MovedOutNotice({
  panelId,
  filePath,
  onClose,
}: {
  panelId: string;
  filePath: string | null;
  onClose: () => void;
}): ReactElement {
  const place = usePanelPlace(panelId);
  const os = window.throng?.osName ?? 'windows';
  const path = filePath ? toDisplayPath(filePath, os) : '';
  return (
    <PanelFailureBanner
      panelId={panelId}
      headline={movedOutHeadline(path)}
      subject={panelSubject(place)}
      detail={{ path }}
      notified={false}
      onClose={onClose}
      copyable
    />
  );
}
