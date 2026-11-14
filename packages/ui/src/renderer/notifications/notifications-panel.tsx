import { useCallback, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react';
import {
  ENTRY_TYPE_ICON_TOKEN,
  ENTRY_TYPE_LABEL,
  formatGrouped,
  formatPlace,
  type NotificationActionDescriptor, type NotificationEntry } from '@throng/core';
import { Icon } from '../common/icon.js';
import { IconButton } from '../common/icon-button.js';
import { MinimiseChevronButton } from '../panes/chevron.js';
import { isRealPointerMove, useCollapsedHover } from '../panes/use-collapsed-hover.js';
import { useCopyToClipboard } from '../common/use-copy.js';
import { useAppSettings } from '../config/config-store.js';
import { useConfirm } from '../confirm-dialog.js';
import { useContextMenu } from '../context-menu-provider.js';
import { buildEntryMenu, buildPanelMenu, iconFor, orderMenuItems } from './notifications-menu.js';
import { PendingBadge } from './pending-badge.js';
import { useProjectsOptional } from '../state/projects-store.js';
import { useNotifications } from './use-notifications.js';
import './notifications.css';

export interface NotificationsPanelProps {
  /** The panel is minimised to its header (FR-036). The owner holds the state: it persists. */
  minimised: boolean;
  onToggleMinimise: () => void;
  /** Whether an action's target still exists; an action whose target is gone is hidden (FR-031a). */
  targetExists: (action: NotificationActionDescriptor) => boolean;
  runAction: (action: NotificationActionDescriptor) => void;
}

/**
 * The Notifications panel (068 US3, FR-024 to FR-034): the notices the user chose to keep, listed in
 * the order they chose, each with Copy, Dismiss and whatever it can take the user to.
 *
 * The entries live in main and every window mirrors them (`useNotifications`); this component only
 * draws that mirror and sends each action back. A panel failure banner and the Find in Files bar are
 * NOT entries and stay where they are (FR-034): they were never notices.
 *
 * Every control is an icon button naming itself by hover title (themeable icon controls), and every
 * action it offers is also in the panel's context menu (Principle VI).
 */
/** The date and time an entry was first raised, short, in the user's locale (FR-080). */
const RAISED_AT = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });

export function NotificationsPanel({ minimised, onToggleMinimise, targetExists, runAction }: NotificationsPanelProps): ReactElement {
  const panel = useNotifications();
  const confirm = useConfirm();
  const contextMenu = useContextMenu();
  const copy = useCopyToClipboard();
  const { confirmDismissAll } = useAppSettings().notifications;
  const hover = useCollapsedHover(minimised);
  const projects = useProjectsOptional()?.projects;
  /**
   * 068 FR-085 — the entry the pointer is pointing at, and the one focus is in: each shows its whole text in place.
   * The pointer one is set only by a pointer that MOVES over the entry, never by one that merely enters: an entry that
   * slid under a still pointer because the one above it grew or shrank was not pointed at, so moving between entries
   * cannot make them oscillate. No timers.
   */
  const [pointedId, setPointedId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  /**
   * 068 FR-087 — the entry whose context menu is open, with the id that opening was given. It holds the entry expanded
   * only while the provider still has THAT menu open, so it lets go by itself when the menu closes or another replaces it.
   */
  const [menuOf, setMenuOf] = useState<{ entryId: string; opId: number } | null>(null);
  const menuEntryId = menuOf && contextMenu.openId === menuOf.opId ? menuOf.entryId : null;

  const dismissAll = useCallback(async (): Promise<void> => {
    if (panel.entries.length === 0) return;
    if (confirmDismissAll) {
      const ok = await confirm({
        title: 'Dismiss all notifications?',
        message: `This removes ${formatGrouped(panel.entries.length)} ${panel.entries.length === 1 ? 'notification' : 'notifications'} from the Notifications panel. Attention marks on panels are not affected.`,
        confirmLabel: 'Dismiss all',
        danger: true,
      });
      if (!ok) return;
    }
    panel.dismissAll();
  }, [confirm, confirmDismissAll, panel]);

  const openPanelMenu = (x: number, y: number): void => {
    contextMenu.openMenu(
      x,
      y,
      buildPanelMenu({
        minimised,
        order: panel.order,
        hasEntries: panel.entries.length > 0,
        onSetOrder: panel.setOrder,
        onDismissAll: () => void dismissAll(),
        onToggleMinimise,
      }),
    );
  };

  /** The entry's own buttons: every action whose target exists, but the go-to-panel one — that is the entry itself (FR-063). */
  const visibleActions = (entry: NotificationEntry): { action: NotificationActionDescriptor; index: number }[] =>
    entry.actions
      .map((action, index) => ({ action, index }))
      .filter(({ action }) => action.kind !== 'goToPanel' && targetExists(action));

  /**
   * Where clicking the entry goes (FR-063): the panel its notice relates to, while that panel exists (FR-031a). An
   * entry stored before `origin` existed names its panel in a go-to-panel descriptor; that still counts.
   */
  const linkOf = (entry: NotificationEntry): NotificationActionDescriptor | undefined => {
    const panelId = entry.origin?.panelId ?? entry.actions.find((a) => a.kind === 'goToPanel')?.panelId;
    if (!panelId) return undefined;
    const projectId = entry.origin?.projectId;
    const link: NotificationActionDescriptor = { kind: 'goToPanel', panelId, label: 'Go to panel', ...(projectId ? { projectId } : {}) };
    return targetExists(link) ? link : undefined;
  };

  const openEntryMenu = (entry: NotificationEntry, x: number, y: number): void => {
    const opId = contextMenu.openMenu(
      x,
      y,
      buildEntryMenu({
        entry,
        // No control, but still a menu item: every action has a menu route (Principle VI).
        actions: [...(linkOf(entry) ? [linkOf(entry)!] : []), ...visibleActions(entry).map((a) => a.action)],
        onCopy: () => copy(entry.copyText, { kind: 'none' }),
        onDismiss: () => panel.dismiss(entry.id),
        onRun: runAction,
      }),
    );
    setMenuOf({ entryId: entry.id, opId });
  };

  const onEntryKeyDown = (entry: NotificationEntry) => (e: ReactKeyboardEvent<HTMLLIElement>): void => {
    // A key pressed in one of the entry's own buttons is that button's.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Delete') {
      e.preventDefault();
      panel.dismiss(entry.id);
    } else if (e.key === 'Enter') {
      const link = linkOf(entry);
      if (link) {
        e.preventDefault();
        runAction(link);
      }
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      openEntryMenu(entry, rect.left + 12, rect.top + 12);
    }
  };

  return (
    <div
      className={`panel notifications-panel${minimised ? ' notifications-panel--minimised panel--minimised' : ''}`}
      data-testid="notifications-panel"
      onContextMenu={(e) => {
        e.preventDefault();
        openPanelMenu(e.clientX, e.clientY);
      }}
    >
      <header
        {...hover}
        className={`panel__header${hover.className ? ` ${hover.className}` : ''}`}
        // 068 FR-067: a click anywhere on a MINIMISED header restores the panel; an open header does nothing, so it never
        // competes with the resize handle. A press on a control inside it is that control's, never the header's.
        onClick={
          minimised
            ? (e) => {
                if ((e.target as Element).closest('button')) return;
                onToggleMinimise();
              }
            : undefined
        }
      >
        {/* 068 FR-060: the count sits beside the title, open or minimised, vertically centred with it. */}
        <span className="notifications-panel__heading">
          <span className="panel__title">Notifications</span>
          <PendingBadge count={panel.pendingCount} severity={panel.pendingSeverity} />
        </span>
        <span className="panel__header-actions">
          {minimised ? null : (
            <>
              <IconButton
                token="sortOrder"
                className="panel__action panel__action--icon panel__action--neutral"
                testId="notifications-order"
                title="Order notifications"
                ariaHasPopup="menu"
                onClick={(e: ReactMouseEvent) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  contextMenu.openMenu(rect.left, rect.bottom, orderMenuItems(panel.order, panel.setOrder));
                }}
              />
              <IconButton
                token="dismissAll"
                className="panel__action panel__action--icon panel__action--neutral"
                testId="notifications-dismiss-all"
                title="Dismiss all notifications"
                disabled={panel.entries.length === 0}
                onClick={() => void dismissAll()}
              />
            </>
          )}
          <MinimiseChevronButton
            minimised={minimised}
            testId={minimised ? 'notifications-restore' : 'notifications-minimise'}
            title={minimised ? 'Restore Notifications' : 'Minimise Notifications'}
            onClick={onToggleMinimise}
          />
        </span>
      </header>
      {minimised ? null : panel.entries.length === 0 ? (
        <p className="notifications-panel__empty" data-testid="notifications-empty">
          No notifications
        </p>
      ) : (
        <ul className="notifications-panel__list" data-testid="notifications-list" aria-label="Notifications" tabIndex={0}>
          {panel.entries.map((entry) => {
            const actions = visibleActions(entry);
            const link = linkOf(entry);
            const place = formatPlace(entry.place);
            const expanded = pointedId === entry.id || focusedId === entry.id || menuEntryId === entry.id;
            // 068 FR-072: the colour of the project the entry relates to, read live so a recoloured project follows.
            const projectColour = entry.origin?.projectId ? projects?.find((p) => p.id === entry.origin?.projectId)?.colour : undefined;
            return (
              <li
                key={entry.id}
                className={`notification-entry notification-entry--${entry.severity}${link ? ' notification-entry--activatable' : ''}`}
                data-testid="notification-entry"
                data-entry-id={entry.id}
                data-flashing={panel.flashingId === entry.id ? 'true' : undefined}
                data-project={projectColour ? 'true' : undefined}
                style={projectColour ? ({ '--entry-project': projectColour } as CSSProperties) : undefined}
                data-expanded={expanded ? 'true' : undefined}
                onPointerMove={(e) => {
                  if (pointedId !== entry.id && isRealPointerMove(e)) setPointedId(entry.id);
                }}
                onPointerLeave={() => setPointedId((cur) => (cur === entry.id ? null : cur))}
                onFocus={() => setFocusedId(entry.id)}
                onBlur={(e) => {
                  if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
                  setFocusedId((cur) => (cur === entry.id ? null : cur));
                }}
                tabIndex={0}
                onClick={
                  link
                    ? (e) => {
                        // A press on one of the entry's own buttons is that button's, never the entry's.
                        if ((e.target as Element).closest('button')) return;
                        runAction(link);
                      }
                    : undefined
                }
                onKeyDown={onEntryKeyDown(entry)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openEntryMenu(entry, e.clientX, e.clientY);
                }}
              >
                {/* 068 FR-083: line 1 — the type's icon (FR-074), when it was first raised (FR-080) and the repeat count, which
                    shed in that order from the right when there is no room, then the actions, which never do. */}
                <div className="notification-entry__line1">
                  <div className="notification-entry__lead">
                    <span className="notification-entry__icon" title={ENTRY_TYPE_LABEL[entry.severity]}>
                      <Icon token={ENTRY_TYPE_ICON_TOKEN[entry.severity]} />
                    </span>
                    <time className="notification-entry__time" dateTime={new Date(entry.raisedAt).toISOString()}>
                      {RAISED_AT.format(entry.raisedAt)}
                    </time>
                    {entry.repeatCount > 1 ? (
                      <span className="notification-entry__count" title="Raised again">
                        {`×${formatGrouped(entry.repeatCount)}`}
                      </span>
                    ) : null}
                  </div>
                  <span className="notification-entry__controls">
                    {actions.map(({ action, index }) => (
                      <IconButton
                        key={index}
                        token={iconFor(action)}
                        className="notice__control"
                        testId={`notification-action-${entry.id}-${index}`}
                        title={action.label}
                        onClick={() => runAction(action)}
                      />
                    ))}
                    <IconButton
                      token="copy"
                      className="notice__copy"
                      testId={`notification-copy-${entry.id}`}
                      title="Copy this notification"
                      onClick={() => copy(entry.copyText, { kind: 'none' })}
                    />
                    <IconButton
                      token="dismiss"
                      className="notice__dismiss"
                      testId={`notification-dismiss-${entry.id}`}
                      title="Dismiss"
                      onClick={() => panel.dismiss(entry.id)}
                    />
                  </span>
                </div>
                {/* Lines 2 to 4 — each one line at rest, cut by the stylesheet with an ellipsis, and whole when the entry is expanded (FR-084, FR-085). */}
                {entry.title ? <h4 className="notification-entry__title">{entry.title}</h4> : null}
                {/* 068 FR-061 — where it belongs, as it was named when raised. */}
                {place ? (
                  <p className="notification-entry__place" data-testid="notification-place">
                    {place}
                  </p>
                ) : null}
                {entry.message ? (
                  <p className="notification-entry__message" data-testid="notification-message">
                    {entry.message}
                  </p>
                ) : null}
                {/* Not among the four lines at rest: they show once the entry is expanded. */}
                {entry.details.length > 0 ? (
                  <ul className="notification-entry__details">
                    {entry.details.map((d, i) => (
                      <li key={`${d}-${i}`}>{d}</li>
                    ))}
                  </ul>
                ) : null}
                {entry.affected.length > 0 ? (
                  <ul className="notification-entry__affected">
                    {entry.affected.map((a, i) => (
                      <li key={`${a.label}-${i}`}>{a.label}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
