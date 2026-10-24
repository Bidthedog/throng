import { useEffect, useRef, type ReactElement } from 'react';
import { useNotify, type NoticeInput } from '../common/notification.js';
import { useAppSettings } from '../config/config-store.js';
import type { AttentionToastEvent } from '../global.js';

/**
 * The in-app toast for a panel that needs the user (057 FR-033, FR-035, FR-036, FR-037; research R12).
 *
 * Notices can only be raised in a renderer, so main picks ONE window per mark (the focused throng
 * window, else the main window) and sends `throng:attention:toast`. This is the half that turns the push
 * into a card, and it is mounted once per window beside `NotificationProvider`.
 *
 * ══ ONE CARD PER PANEL, FOR AS LONG AS THE MARK STANDS ══
 *
 * `instanceKey: 'attention:<panelId>'` is what keeps two panels' toasts apart: they are otherwise
 * identical (same reason, same project) and 041's identical-content rule would fold them into one card
 * with one link, which would navigate to only one of them. The same key is also the card's identity
 * across a repeat raise: `update` patches the card in place rather than stacking a second — silently, and
 * only while the card is still showing (FR-112: a mark is announced once).
 *
 * Severity follows the kind — `info` for Attention, `error` for Failed (FR-037) — for the colour, icon and
 * log level. How long the card stays is the user's `notifications.attention`, for both kinds (FR-111).
 *
 * The WHOLE CARD is the link (FR-124): a click anywhere but Copy and Dismiss goes to the panel (FR-034's
 * navigation), and the card carries no go-to control of its own. Dismiss stays (030 FR-060).
 */
export function AttentionToasts(): ReactElement | null {
  const { notify, update, dismiss } = useNotify();
  const display = useAppSettings().notifications.attention;
  const displayRef = useRef(display);
  displayRef.current = display;

  useEffect(() => {
    const attention = window.throng?.attention;
    if (!attention?.onToast) return undefined;
    /** The live card for each panel. */
    const cards = new Map<string, string>();

    const content = (e: AttentionToastEvent): NoticeInput => {
      const failed = e.kind === 'failed';
      return {
        severity: failed ? 'error' : 'info',
        display: { mode: displayRef.current.mode, timeoutMs: displayRef.current.timeoutMs },
        // No `title`: with a subject and no action the heading IS the subject (`noticeHeading`), so the
        // card reads "<project> — <tab> — <panel>" over the reason, from the one formatter (030 FR-058).
        // FR-120: project, tab and panel head the card, through the one subject formatter.
        subject: {
          kind: 'panel',
          name: e.title ?? 'Terminal',
          ...(e.tabTitle ? { tab: e.tabTitle } : {}),
          ...(e.projectName ? { project: e.projectName } : {}),
        },
        message: e.reason ?? (failed ? 'Failed' : 'Needs attention'),
        testId: `attention-toast-${e.panelId}`,
        instanceKey: `attention:${e.panelId}`,
        onActivate: () => attention.goTo(e.panelId),
        onDismiss: () => {
          cards.delete(e.panelId);
        },
      };
    };

    const raise = (e: AttentionToastEvent): void => {
      const id = notify(content(e));
      if (id !== '') cards.set(e.panelId, id);
    };

    const off = attention.onToast((e) => {
      const existing = cards.get(e.panelId);
      if (e.op === 'dismiss') {
        cards.delete(e.panelId);
        if (existing !== undefined) dismiss(existing);
        return;
      }
      // A repeat changes the same card. It leaves `display` out of the patch, which would restart the card's
      // timer, and an `update` whose card has gone (dismissed, or timed out) raises nothing (FR-112).
      if (existing !== undefined) {
        const { display: _display, ...patch } = content(e);
        if (update(existing, patch)) return;
        cards.delete(e.panelId);
      }
      if (e.op === 'raise') raise(e);
    });
    return () => {
      off();
    };
  }, [notify, update, dismiss]);

  return null;
}
