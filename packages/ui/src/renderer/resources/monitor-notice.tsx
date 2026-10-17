/**
 * The monitor's ONE inline notice (055 FR-064; 030 "one condition, one notice").
 *
 * Inline in the dialog and not a toast, because it carries an action — Dismiss — and a toast cannot
 * (030). A second failure replaces the first in the session, so there is never a stack of them. It says
 * what went wrong in words; the raw cause code never reaches it.
 */
import { type ReactElement } from 'react';
import { IconButton } from '../common/icon-button.js';
import { setNotice, useNotice } from './monitor-session.js';

export function MonitorNotice(): ReactElement | null {
  const notice = useNotice();
  if (notice === null) return null;
  return (
    <div className="monitor-notice" role="alert" data-testid="monitor-notice">
      <div className="monitor-notice__text">
        <strong className="monitor-notice__heading">{notice.heading}</strong>
        {notice.lines.map((line, i) => (
          <p key={i} className="monitor-notice__line">
            {line}
          </p>
        ))}
      </div>
      <IconButton
        token="dismiss"
        title="Dismiss"
        testId="monitor-notice-dismiss"
        className="icon-button monitor-notice__dismiss"
        onClick={() => setNotice(null)}
      />
    </div>
  );
}
