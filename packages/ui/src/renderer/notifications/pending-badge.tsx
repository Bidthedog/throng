import type { ReactElement } from 'react';
import { formatGrouped, type EntrySeverity } from '@throng/core';
import { useNotifications } from './use-notifications.js';
import './notifications.css';

/**
 * The number of Notifications panel entries not yet dismissed (068 FR-059), in throng's highlight colour
 * whatever their types (FR-093). It is drawn beside the Notifications title and below File Explorer on the collapsed
 * right rail (FR-060), so the same facts read the same everywhere. Whether the panel is minimised or the
 * pane hidden never changes the count.
 *
 * Nothing is drawn for a count of zero. The count is a quantity the user reads, so it is digit-grouped
 * (constitution 4.5.0); the most severe type rides as `data-severity` for a test to read. It sets no colour.
 */
export function PendingBadge({
  count,
  severity,
  testId,
  className,
}: {
  count: number;
  severity: EntrySeverity | null;
  testId?: string;
  className?: string;
}): ReactElement | null {
  if (count <= 0 || severity === null) return null;
  return (
    <span
      className={`pending-badge${className ? ` ${className}` : ''}`}
      data-testid={testId ?? 'notifications-pending-badge'}
      data-severity={severity}
      role="status"
      aria-label={`${formatGrouped(count)} ${count === 1 ? 'notification' : 'notifications'}`}
    >
      {formatGrouped(count)}
    </span>
  );
}

/** The live count and colour, wherever it is placed: the Notifications title and the collapsed rail (FR-060). */
export function PendingNotificationsBadge({ testId, className }: { testId?: string; className?: string }): ReactElement | null {
  const { pendingCount, pendingSeverity } = useNotifications();
  return <PendingBadge count={pendingCount} severity={pendingSeverity} testId={testId} className={className} />;
}
