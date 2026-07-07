import type { ReactElement } from 'react';

/**
 * Surfaces that a project's previously-saved layout could not be restored
 * (FR-029 / SC-011). Shown only when the daemon reports `reason: 'corrupt'`; a
 * brand-new project (no saved layout) shows nothing.
 */
export function RestoreNotice(): ReactElement {
  return (
    <div className="restore-notice" data-testid="restore-notice" role="status">
      The previous layout could not be restored; a fresh workspace was opened.
    </div>
  );
}
