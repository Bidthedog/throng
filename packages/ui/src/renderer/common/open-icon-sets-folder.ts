import { logCaught } from '@throng/core';
import type { NoticeInput } from './notification.js';

/**
 * Open the icon sets folder (no `set`: main opens the directory itself, contracts/icon-sets-ipc.md) and
 * SHOW a failure (Principle XIII). main answers `{ ok: false, reason, message }` rather than throwing, so
 * a caller that only `.catch`es never hears of it: the control would simply do nothing.
 *
 * Shared by the backup notice and the notification panel's `openIconSetsFolder` action, which both
 * offer the same control and so must fail the same way. `notify` is `null` outside a notification
 * provider; the failure is still logged.
 */
export async function openIconSetsFolder(notify: ((notice: NoticeInput) => unknown) | null): Promise<void> {
  const what = 'Could not open the icon sets folder';
  let message: string;
  try {
    const result = await window.throng?.iconSets?.openFolder();
    if (!result || result.ok) return;
    logCaught('icon sets: open the icon sets folder', new Error(`${result.reason}: ${result.message}`));
    message = result.message;
  } catch (error) {
    logCaught('icon sets: open the icon sets folder', error);
    message = error instanceof Error ? error.message : String(error);
  }
  notify?.({
    severity: 'error',
    subject: { kind: 'none' },
    message: `${what}: ${message}`,
    testId: 'icon-set-notice-error',
  });
}
