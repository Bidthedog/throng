/**
 * 068 US4 T052, rewritten for T086/T087 (FR-059, FR-060) — the badge counts every Notifications panel entry not
 * yet dismissed, in the theme colour of the most severe of them, and shows in exactly two places: beside the
 * Notifications title (open or minimised) and below the File Explorer title on the collapsed right rail. It
 * shows nowhere at a count of zero, and the control that shows the right pane carries none.
 *
 * Layer: component — the badge and the panel header over a fake `window.throng.notifications`. jsdom cannot
 * measure alignment, so the vertical centring and the one-character gap are asserted as the rules that make them
 * (the stylesheet's own text) and the structure they apply to; how it LOOKS is manual test MT-05.
 *
 * ANTI-VACUITY: the severity colour is asserted from two different seeds, and "nothing" is asserted to render
 * nothing, so a badge that always rendered, or always rendered one colour, fails.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationEntry } from '@throng/core';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { NotificationsPanel } from '../../src/renderer/notifications/notifications-panel.js';
import { PendingBadge, PendingNotificationsBadge } from '../../src/renderer/notifications/pending-badge.js';
import type { NotificationsSnapshot } from '../../src/renderer/global.js';

let snapshot: NotificationsSnapshot;
const changedListeners: ((s: NotificationsSnapshot) => void)[] = [];
const api = {
  list: vi.fn(),
  onChanged: vi.fn(),
  onRepeat: vi.fn(),
  onLimitReached: vi.fn(),
  dismiss: vi.fn(),
  dismissAll: vi.fn(),
  setOrder: vi.fn(),
  add: vi.fn(),
  dismissLimitWarning: vi.fn(),
};
const emit = (s: NotificationsSnapshot): void => act(() => changedListeners.forEach((cb) => cb(s)));

const entry = (id: string, severity: NotificationEntry['severity']): NotificationEntry => ({
  id,
  key: id,
  severity,
  message: id,
  details: [],
  copyText: id,
  affected: [],
  actions: [],
  raisedAt: 1,
  repeatCount: 1,
});

const snap = (entries: NotificationEntry[]): NotificationsSnapshot => {
  const order = ['error', 'warning', 'attention', 'info', 'success'] as const;
  const severity = order.find((s) => entries.some((e) => e.severity === s)) ?? null;
  return { entries, order: 'oldest', pendingCount: entries.length, pendingSeverity: severity, limit: 100 };
};

beforeEach(() => {
  snapshot = snap([]);
  changedListeners.length = 0;
  for (const fn of Object.values(api)) fn.mockReset();
  api.list.mockImplementation(() => Promise.resolve(snapshot));
  api.onChanged.mockImplementation((cb: (s: NotificationsSnapshot) => void) => {
    changedListeners.push(cb);
    return () => {};
  });
  api.onRepeat.mockImplementation(() => () => {});
  api.onLimitReached.mockImplementation(() => () => {});
  Reflect.set(window, 'throng', {
    notices: { log: () => {} },
    config: { get: () => Promise.resolve({ settings: { version: 1 } }) },
    notifications: api,
    attention: { onChanged: () => () => {}, onToast: () => () => {}, goTo: () => {} },
    osName: 'windows',
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

const tree = (child: ReactElement): ReactElement =>
  createElement(
    ConfigProvider,
    null,
    createElement(
      NotificationProvider,
      null,
      createElement(ConfirmProvider, null, createElement(ContextMenuProvider, null, child)),
    ),
  );

const panel = (minimised: boolean): ReactElement =>
  tree(
    createElement(NotificationsPanel, {
      minimised,
      onToggleMinimise: () => {},
      targetExists: () => true,
      runAction: () => {},
    }),
  );

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('the badge itself', () => {
  it('draws nothing for a count of zero', () => {
    render(createElement(PendingBadge, { count: 0, severity: null }));
    expect(screen.queryByTestId('notifications-pending-badge')).toBeNull();
  });

  it('shows the count, digit-grouped, with no colour class of the severity it is given (FR-093)', () => {
    render(createElement(PendingBadge, { count: 1234, severity: 'warning' }));
    const badge = screen.getByTestId('notifications-pending-badge');
    expect(badge.textContent).toBe(new Intl.NumberFormat().format(1234));
    expect(badge.getAttribute('data-severity')).toBe('warning');
    expect(badge.className).not.toMatch(/pending-badge--/);
  });

  it('is throng\'s highlight colour with its paired text colour, whatever the types it counts (FR-093)', () => {
    const css = read('packages/ui/src/renderer/notifications/notifications.css');
    const at = css.indexOf('.pending-badge {');
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).toMatch(/background:\s*var\(--throng-colour-accent\)/);
    expect(rule).toMatch(/color:\s*var\(--throng-colour-accentText\)/);
    expect(css).not.toMatch(/\.pending-badge--/);
  });
});

describe.each([[true], [false]])('beside the Notifications title, minimised=%s (FR-060)', (minimised) => {
  it('counts every entry and takes the colour of the most severe, whether the panel is open or minimised', async () => {
    snapshot = snap([entry('a', 'info'), entry('b', 'error'), entry('c', 'success')]);
    render(panel(minimised));
    const badge = await screen.findByTestId('notifications-pending-badge');
    expect(badge.textContent).toBe('3');
    expect(badge.getAttribute('data-severity')).toBe('error');
  });

  it('shares one row with the title, so it sits beside it', async () => {
    snapshot = snap([entry('a', 'warning')]);
    render(panel(minimised));
    const badge = await screen.findByTestId('notifications-pending-badge');
    const title = screen.getByText('Notifications', { selector: '.panel__title' });
    expect(badge.parentElement).toBe(title.parentElement);
    expect(badge.parentElement).toHaveClass('notifications-panel__heading');
    expect(title.nextElementSibling).toBe(badge);
  });

  it('follows a dismissal: the count falls and the colour follows the most severe left, down to nothing', async () => {
    snapshot = snap([entry('a', 'info'), entry('b', 'error')]);
    render(panel(minimised));
    await screen.findByTestId('notifications-pending-badge');
    emit(snap([entry('a', 'info')]));
    expect(screen.getByTestId('notifications-pending-badge').getAttribute('data-severity')).toBe('info');
    expect(screen.getByTestId('notifications-pending-badge').textContent).toBe('1');
    emit(snap([]));
    expect(screen.queryByTestId('notifications-pending-badge')).toBeNull();
  });

  it('is not drawn at zero', async () => {
    render(panel(minimised));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('notifications-pending-badge')).toBeNull();
  });
});

describe('the count does not depend on the panel being out of view (FR-059)', () => {
  it('is the same open and minimised, from the same entries', async () => {
    snapshot = snap([entry('a', 'attention'), entry('b', 'info')]);
    const open = render(panel(false));
    const openText = (await screen.findByTestId('notifications-pending-badge')).textContent;
    open.unmount();
    render(panel(true));
    expect((await screen.findByTestId('notifications-pending-badge')).textContent).toBe(openText);
  });
});

describe('below File Explorer on the collapsed rail (FR-060)', () => {
  it('draws the live count and the most severe colour', async () => {
    snapshot = snap([entry('a', 'warning')]);
    render(tree(createElement(PendingNotificationsBadge, { testId: 'rail-badge' })));
    const badge = await screen.findByTestId('rail-badge');
    expect(badge.textContent).toBe('1');
    expect(badge.getAttribute('data-severity')).toBe('warning');
    emit(snap([entry('a', 'warning'), entry('b', 'error')]));
    expect(screen.getByTestId('rail-badge').getAttribute('data-severity')).toBe('error');
    expect(screen.getByTestId('rail-badge').textContent).toBe('2');
  });
});

describe('the main window wires it (FR-060)', () => {
  const app = read('packages/ui/src/renderer/app.tsx');

  it('puts the badge on the rail after its "File Explorer & Notifications" label (FR-068), and nowhere else', () => {
    // The strip is `CollapsedRail` (FR-069): its label, then the badge it carries as a child (below the title).
    expect(app).toMatch(/<CollapsedRail testId="pane-rail-right" label="File Explorer & Notifications" onShow={toggleRight}>\s*<PendingNotificationsBadge testId="pane-rail-right-badge" \/>\s*<\/CollapsedRail>/);
    expect(app.match(/PendingNotificationsBadge testId=/g)).toHaveLength(1);
  });

  it('carries none on the control that shows the right pane', () => {
    expect(app).not.toContain('pane-show-right-badge');
  });

  it('no longer tells main when the panel is out of view', () => {
    expect(app).not.toContain('PendingModeReporter');
  });
});

describe('alignment rules (FR-060; the look itself is MT-05)', () => {
  const rule = (css: string, selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    expect(at, `${selector} must have a rule`).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf('}', at));
  };

  it('centres the title and badge vertically and separates them by one character', () => {
    const css = read('packages/ui/src/renderer/notifications/notifications.css');
    const heading = rule(css, '.notifications-panel__heading');
    expect(heading).toMatch(/align-items:\s*center/);
    expect(heading).toMatch(/gap:\s*1ch/);
  });

  it('centres the badge text in its own box, vertically and horizontally', () => {
    const css = read('packages/ui/src/renderer/notifications/notifications.css');
    const badge = rule(css, '.pending-badge');
    expect(badge).toMatch(/display:\s*inline-flex/);
    expect(badge).toMatch(/align-items:\s*center/);
    expect(badge).toMatch(/justify-content:\s*center/);
  });

  it('separates the rail badge from the label above it by one character', () => {
    const css = read('packages/ui/src/renderer/notifications/notifications.css');
    expect(rule(css, '.pane-rail .pending-badge')).toMatch(/margin-top:\s*1ch/);
  });
});
