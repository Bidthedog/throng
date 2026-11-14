import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { logCaught } from '@throng/core';
import { useNotify } from '../common/notification.js';
import './notifications.css';

const TEST_ID = 'notification-limit-warning';

/**
 * The warning raised when the Notifications panel reaches its limit (068 FR-031f, FR-031g), mounted once
 * in the main window — the window main reports the limit to.
 *
 * ══ WHY IT IS A TOAST THAT CANNOT BE SILENCED, AND NOT AN ENTRY ══
 *
 * It tells the user the panel itself is full, so it cannot live in the panel, and it must not be lost to
 * a preference: a `display` of `toast` states the mode on the notice itself, so *Never display* for
 * warnings does not hide it, and `sticky` keeps the duration from taking it before it is read. It stays
 * until the user acts on it.
 *
 * ══ TWO WAYS OUT, AND THEY ARE NOT THE SAME ══
 *
 * The X means "I have read this, do not warn me again": it tells main (`dismissLimitWarning`), which
 * persists that for good. Following the link — to Preferences at Notifications, where the limit and the
 * modes are — closes the card but is NOT a refusal of the warning, so it must not make that call. The
 * link follows on Ctrl+click and Ctrl+Enter and a plain click navigates nothing (constitution 5.5.0).
 */
export function LimitWarning(): null {
  const { notify, dismiss } = useNotify();
  const liveId = useRef('');
  // Set while the card is being closed by following the link, so `onDismiss` can tell the two apart.
  const followed = useRef(false);

  useEffect(() => {
    const api = window.throng?.notifications;
    if (!api?.onLimitReached) return undefined;

    const follow = (): void => {
      followed.current = true;
      window.throng?.openPreferences?.('settings', 'Notifications');
      // Not a refusal: main arms the warning again, so the raised limit warns when it is filled (FR-031g).
      api.followLimitWarning?.();
      if (liveId.current) dismiss(liveId.current);
      liveId.current = '';
    };

    const raise = (): void => {
      // ONE card, however often it is reported while it is up.
      if (liveId.current) return;
      followed.current = false;
      liveId.current = notify({
        severity: 'warning',
        subject: { kind: 'none' },
        title: 'Notifications are piling up',
        message:
          'The Notifications panel has reached its limit, so the oldest notifications are being dropped. Change the notification preferences, or dismiss what you have dealt with: unattended notifications can affect performance.',
        testId: TEST_ID,
        display: { toast: true, panel: false },
        sticky: true,
        body: (
          <span
            className="notice__link"
            role="link"
            tabIndex={0}
            data-testid={`${TEST_ID}-link`}
            title="Ctrl+click to open the notification preferences"
            onClick={(e: ReactMouseEvent) => {
              if (e.ctrlKey || e.metaKey) follow();
            }}
            onKeyDown={(e: ReactKeyboardEvent) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                follow();
              }
            }}
          >
            Open the notification preferences
          </span>
        ),
        onDismiss: () => {
          liveId.current = '';
          // The X: do not warn again. Following the link closes the card too, but is not a refusal.
          if (!followed.current) api.dismissLimitWarning();
        },
      });
    };

    // FR-031f: it stays until dismissed or followed — across a restart too. Main says whether one is outstanding.
    let live = true;
    void api
      .list?.()
      .then((snapshot) => {
        if (live && snapshot?.limitWarningActive) raise();
      })
      .catch((error: unknown) => logCaught('notifications: read the limit warning state', error));
    const off = api.onLimitReached(raise);
    return () => {
      live = false;
      off();
    };
  }, [notify, dismiss]);

  return null;
}
