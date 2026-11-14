/**
 * 068 T106–T108 (FR-076 to FR-080) — how big a toast is and what a Notifications panel entry shows beside it.
 *
 * Layer: component. jsdom lays nothing out, so the width is asserted as the CSS custom property the provider sets on the toast
 * stack (the one the stylesheet's width rule reads), the three-line limit as the rule that makes it, and "cut off" by
 * giving the text block a scroll height taller than its box — the same comparison the component makes. How it LOOKS is MT-05.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationEntry } from '@throng/core';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { NotificationProvider, useNotify, type NoticeInput } from '../../src/renderer/common/notification.js';
import { NotificationsPanel } from '../../src/renderer/notifications/notifications-panel.js';
import type { NotificationsSnapshot } from '../../src/renderer/global.js';
import { flushUntil } from './helpers/flush-until.js';

let settingsPayload: Record<string, unknown> = { version: 1 };
let snapshot: NotificationsSnapshot;

beforeEach(() => {
  settingsPayload = { version: 1 };
  snapshot = { entries: [], order: 'oldest', pendingCount: 0, pendingSeverity: null, limit: 100 };
  Reflect.set(window, 'throng', {
    notices: { log: () => {} },
    config: { get: () => Promise.resolve({ settings: settingsPayload }) },
    notifications: {
      add: () => Promise.resolve({ outcome: 'added', id: 'e1' }),
      list: () => Promise.resolve(snapshot),
      dismiss: () => Promise.resolve(snapshot),
      dismissAll: () => Promise.resolve(snapshot),
      setOrder: () => Promise.resolve(snapshot),
      dismissLimitWarning: () => {},
      onChanged: () => () => {},
      onRepeat: () => () => {},
      onLimitReached: () => () => {},
    },
    attention: { goTo: () => {}, goToPanel: () => Promise.resolve(true), panelsExist: () => Promise.resolve([]), onToast: () => () => {}, onChanged: () => () => {} },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  vi.restoreAllMocks();
});

interface Probe {
  notify?: (input: NoticeInput) => string;
  loaded?: boolean;
}
function ProbeView({ into }: { into: Probe }): null {
  into.notify = useNotify().notify;
  into.loaded = useConfigLoaded();
  return null;
}

async function mount(withPanel = false): Promise<Probe> {
  const probe: Probe = {};
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(
        NotificationProvider,
        null,
        createElement(ProbeView, { into: probe, key: 'p' }),
        withPanel
          ? createElement(
              ConfirmProvider,
              null,
              createElement(
                ContextMenuProvider,
                null,
                createElement(NotificationsPanel, { minimised: false, onToggleMinimise: () => {}, targetExists: () => true, runAction: () => {} }),
              ),
            )
          : null,
      ),
    ),
  );
  await flushUntil(() => probe.loaded === true);
  return probe;
}

const RAISE: NoticeInput = {
  severity: 'info',
  title: 'Heading line',
  message: 'The message line.',
  testId: 'toast',
  subject: { kind: 'panel', name: 'Shell', tab: 'Build', project: 'Alpha', panelId: 'p1' },
};

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');
const rule = (css: string, selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} must have a rule`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
};
const theme = read('packages/ui/src/renderer/theme.css');

describe('the toast width (FR-076)', () => {
  it('is the setting, held at no more than half the window, on the toast stack', async () => {
    settingsPayload = { version: 1, notifications: { toastWidthPx: 340 } };
    await mount();
    expect(screen.getByTestId('notices').style.getPropertyValue('--throng-notice-width')).toBe('min(340px, 50vw)');
  });

  it('is 520 by default (FR-081)', async () => {
    await mount();
    expect(screen.getByTestId('notices').style.getPropertyValue('--throng-notice-width')).toBe('min(520px, 50vw)');
  });

  it('is held to the 300–800 range for a value outside it (the bounds guard, 030 FR-010; FR-090)', async () => {
    settingsPayload = { version: 1, notifications: { toastWidthPx: 900 } };
    await mount();
    expect(screen.getByTestId('notices').style.getPropertyValue('--throng-notice-width')).toBe('min(800px, 50vw)');
  });

  it('is held to its 300 px minimum for a value below it (FR-090)', async () => {
    settingsPayload = { version: 1, notifications: { toastWidthPx: 240 } };
    await mount();
    expect(screen.getByTestId('notices').style.getPropertyValue('--throng-notice-width')).toBe('min(300px, 50vw)');
  });

  it('is what the stylesheet\'s width rule reads; its own fallback is the shipped 520', () => {
    expect(rule(theme, '.notices')).toMatch(/--throng-notice-width:\s*min\(520px,\s*50vw\)/);
    expect(theme).toMatch(/width:\s*var\(--throng-notice-width\)/);
  });
});

describe('three lines at most (FR-077)', () => {
  it('wraps heading, place and message, in that order, in one clamped block, with its controls outside it', async () => {
    const probe = await mount();
    act(() => void probe.notify!({ ...RAISE, origin: { panelId: 'p1' }, details: ['one.md'] }));
    const toast = screen.getByTestId('toast');
    const text = toast.querySelector('.notice__text')!;
    expect(text).not.toBeNull();
    expect([...text.children].map((c) => c.className.split(' ')[0])).toEqual(['notice__title', 'notice__place', 'notice__message']);
    expect(text.contains(screen.getByTestId('toast-copy'))).toBe(false);
    expect(text.contains(screen.getByTestId('toast-dismiss'))).toBe(false);
    expect(text.contains(screen.getByText('one.md'))).toBe(false);
  });

  it('is clamped by the stylesheet to three lines with an ellipsis', () => {
    const block = rule(read('packages/ui/src/renderer/common/notification.css') + theme, '.notice__text');
    expect(block).toMatch(/-webkit-line-clamp:\s*3/);
    expect(block).toMatch(/overflow:\s*hidden/);
  });
});

describe('a Notifications panel entry is whole (FR-078)', () => {
  it('has no line clamp anywhere in its rules', () => {
    const css = read('packages/ui/src/renderer/notifications/notifications.css');
    expect(css).not.toMatch(/line-clamp/);
  });
});

describe('the whole text of a cut-off toast, in a popover (FR-079)', () => {
  const sizes = (scroll: number, client: number): void => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('notice__text') ? scroll : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('notice__text') ? client : 0;
    });
  };

  it('shows heading, place and message whole on hover when the text is cut off, and removes it when the pointer leaves', async () => {
    sizes(120, 66);
    const probe = await mount();
    act(() => void probe.notify!({ ...RAISE, origin: { panelId: 'p1' } }));
    const toast = screen.getByTestId('toast');
    fireEvent.pointerEnter(toast);
    const popover = await screen.findByTestId('notice-text-popover');
    expect(popover.textContent).toBe('Heading line\nAlpha › Build › Shell\nThe message line.');
    expect(popover.getAttribute('role')).toBe('tooltip');
    expect(popover.parentElement).toBe(document.body);
    fireEvent.pointerLeave(toast);
    expect(screen.queryByTestId('notice-text-popover')).toBeNull();
  });

  it('shows none for a toast whose text fits', async () => {
    sizes(66, 66);
    const probe = await mount();
    act(() => void probe.notify!({ ...RAISE }));
    fireEvent.pointerEnter(screen.getByTestId('toast'));
    expect(screen.queryByTestId('notice-text-popover')).toBeNull();
  });

  it('is gone with its toast', async () => {
    sizes(120, 66);
    const probe = await mount();
    act(() => void probe.notify!({ ...RAISE }));
    fireEvent.pointerEnter(screen.getByTestId('toast'));
    await screen.findByTestId('notice-text-popover');
    fireEvent.click(screen.getByTestId('toast-dismiss'));
    expect(screen.queryByTestId('notice-text-popover')).toBeNull();
  });

  it('shows on keyboard focus too', async () => {
    sizes(120, 66);
    const probe = await mount();
    act(() => void probe.notify!({ ...RAISE }));
    fireEvent.focus(screen.getByTestId('toast'));
    expect(await screen.findByTestId('notice-text-popover')).toBeInTheDocument();
  });
});

describe('date and time (FR-080)', () => {
  const RAISED = new Date(2026, 10, 14, 9, 5).getTime();
  const stored = (over: Partial<NotificationEntry> = {}): NotificationEntry => ({
    id: 'e1',
    key: 'k',
    severity: 'info',
    title: 'Title',
    message: 'Message',
    details: [],
    copyText: 'x',
    affected: [],
    actions: [],
    raisedAt: RAISED,
    repeatCount: 1,
    ...over,
  });

  it('shows every entry\'s first-raised date and time in the user\'s locale, short form, on its header line', async () => {
    snapshot = { entries: [stored(), stored({ id: 'e2', key: 'k2', raisedAt: RAISED + 86_400_000 })], order: 'oldest', pendingCount: 2, pendingSeverity: 'info', limit: 100 };
    await mount(true);
    const expected = (ms: number): string => new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(ms);
    const cards = await screen.findAllByTestId('notification-entry');
    const times = cards.map((c) => c.querySelector('time'));
    expect(times.map((t) => t?.textContent)).toEqual([expected(RAISED), expected(RAISED + 86_400_000)]);
    expect(times[0]!.getAttribute('datetime')).toBe(new Date(RAISED).toISOString());
    // On line 1, after the icon (FR-083).
    expect(times[0]!.parentElement!.className).toContain('notification-entry__lead');
  });

  it('shows no date or time on a toast', async () => {
    const probe = await mount();
    act(() => void probe.notify!({ ...RAISE }));
    const toast = screen.getByTestId('toast');
    expect(toast.querySelector('time')).toBeNull();
    expect(within(toast).queryByText(/\d{1,2}[:.]\d{2}/)).toBeNull();
  });
});
