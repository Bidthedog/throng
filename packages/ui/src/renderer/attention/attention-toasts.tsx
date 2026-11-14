import { logCaught } from '@throng/core';
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
 * ══ ITS ENTRY IN THE NOTIFICATIONS PANEL (068 FR-024, FR-025) ══
 *
 * Under `panel` mode the card is also an entry, typed `attention` and keyed `attention:<panelId>`. The
 * entry lives as long as the MARK, not the toast: the MAIN window (`reconcile`) removes every such entry
 * whose panel is no longer marked, on each change of the mark set, because the window that raised the
 * toast may be closed by the time the mark clears.
 *
 * The WHOLE CARD is the link (FR-124): a click anywhere but Copy and Dismiss goes to the panel (FR-034's
 * navigation), and the card carries no go-to control of its own. Dismiss stays (030 FR-060).
 */
export function AttentionToasts({ reconcile = false }: { reconcile?: boolean } = {}): ReactElement | null {
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
        display: { toast: displayRef.current.toast, panel: displayRef.current.panel },
        panelSeverity: 'attention',
        panelKey: `attention:${e.panelId}`,
        // No `panelActions`: the entry is a link to its panel through its origin, which the subject's `panelId`
        // states (068 FR-063), so no go-to-panel descriptor is stored or drawn.
        // No `title`: with a subject and no action the heading IS the subject (`noticeHeading`), and the notice's
        // place (FR-061) stands in for it, so the card reads "<project> › <tab> › <panel>" over the reason.
        // FR-120: project, tab and panel head the card, through the one subject formatter.
        subject: {
          kind: 'panel',
          panelId: e.panelId,
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

  // FR-025: an attention entry goes when its mark does. Main window only; removing an entry twice is harmless,
  // but only one window should be reading the store for it.
  useEffect(() => {
    const attention = window.throng?.attention;
    if (!reconcile || !attention?.onChanged) return undefined;
    return attention.onChanged(({ marks }) => {
      const api = window.throng?.notifications;
      if (!api) return;
      const marked = new Set(marks.map((m) => m.panelId));
      void api
        .list()
        .then((snapshot) => {
          for (const entry of snapshot?.entries ?? []) {
            const prefix = 'group:attention:';
            if (!entry.key.startsWith(prefix) || marked.has(entry.key.slice(prefix.length))) continue;
            void api.dismiss(entry.id);
          }
        })
        .catch((error: unknown) => {
          logCaught('attention: reconcile the notification entries', error);
        });
    });
  }, [reconcile]);

  return null;
}
