/**
 * 068 US3 T042 (FR-026a, FR-026b, FR-027, FR-028, FR-031a, FR-033, FR-034) — the Notifications panel.
 *
 * Layer: component — what the panel renders from a snapshot, what each control sends back, its context
 * menu, and its keyboard handling; jsdom shows all of it. What main stores is T036's; what reaches the
 * panel is T040's.
 *
 * ANTI-VACUITY: Dismiss all is driven under both settings of `confirmDismissAll`, a descriptor action is
 * checked both present and hidden, and the order test seeds entries out of raise order so a panel that
 * ignored the order fails.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationActionDescriptor, NotificationEntry } from '@throng/core';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { PanelFailureBanner } from '../../src/renderer/common/panel-failure-banner.js';
import { NotificationsPanel } from '../../src/renderer/notifications/notifications-panel.js';
import type { NotificationsSnapshot } from '../../src/renderer/global.js';

let settingsPayload: Record<string, unknown> = { version: 1 };
let snapshot: NotificationsSnapshot;
const api = {
  add: vi.fn(),
  list: vi.fn(),
  dismiss: vi.fn(),
  dismissAll: vi.fn(),
  setOrder: vi.fn(),
  dismissLimitWarning: vi.fn(),
  onChanged: vi.fn(),
  onRepeat: vi.fn(),
  onLimitReached: vi.fn(),
};
const attention = { goTo: vi.fn(), flag: vi.fn(), onChanged: vi.fn(() => () => {}), reportFocus: vi.fn(), onToast: vi.fn(() => () => {}) };
let clipboardWrites: string[] = [];

const entry = (id: string, over: Partial<NotificationEntry> = {}): NotificationEntry => ({
  id,
  key: id,
  severity: 'error',
  title: `Title ${id}`,
  message: `Message ${id}`,
  details: [],
  copyText: `Copy text ${id}`,
  affected: [],
  actions: [],
  raisedAt: 1000,
  repeatCount: 1,
  ...over,
});

const snap = (entries: NotificationEntry[], order: NotificationsSnapshot['order'] = 'oldest'): NotificationsSnapshot => ({
  entries,
  order,
  pendingCount: 0,
  pendingSeverity: null,
  limit: 100,
});

beforeEach(() => {
  settingsPayload = { version: 1 };
  snapshot = snap([]);
  clipboardWrites = [];
  for (const fn of Object.values(api)) fn.mockReset();
  api.list.mockImplementation(() => Promise.resolve(snapshot));
  for (const name of ['dismiss', 'dismissAll', 'setOrder'] as const) {
    api[name].mockImplementation(() => Promise.resolve(snapshot));
  }
  api.onChanged.mockImplementation(() => () => {});
  api.onRepeat.mockImplementation(() => () => {});
  api.onLimitReached.mockImplementation(() => () => {});
  attention.goTo.mockReset();
  attention.flag.mockReset();
  Reflect.set(window, 'throng', {
    notices: { log: () => {} },
    config: { get: () => Promise.resolve({ settings: settingsPayload }) },
    clipboard: { write: (e: { text: string }) => { clipboardWrites.push(e.text); return Promise.resolve(); } },
    notifications: api,
    attention,
    osName: 'windows',
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

const loaded = { value: false };
function Loaded(): ReactElement | null {
  loaded.value = useConfigLoaded();
  return null;
}

interface Mounted {
  runAction: ReturnType<typeof vi.fn>;
  onToggleMinimise: ReturnType<typeof vi.fn>;
}

async function mount(
  over: { minimised?: boolean; targetExists?: (a: NotificationActionDescriptor) => boolean; extra?: ReactElement } = {},
): Promise<Mounted> {
  loaded.value = false;
  const runAction = vi.fn();
  const onToggleMinimise = vi.fn();
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(
        NotificationProvider,
        null,
        createElement(
          ConfirmProvider,
          null,
          createElement(
            ContextMenuProvider,
            null,
            createElement(Loaded, { key: 'loaded' }),
            createElement(NotificationsPanel, {
              minimised: over.minimised ?? false,
              onToggleMinimise,
              targetExists: over.targetExists ?? (() => true),
              runAction,
            }),
            over.extra ?? null,
          ),
        ),
      ),
    ),
  );
  await waitFor(() => expect(loaded.value).toBe(true));
  await act(async () => {
    await Promise.resolve();
  });
  return { runAction, onToggleMinimise };
}

const messages = (): string[] =>
  screen.queryAllByTestId('notification-entry').map((el) => within(el).getByTestId('notification-message').textContent ?? '');

describe('entries and order (FR-027, FR-028)', () => {
  it('renders the entries oldest first by default, whatever order they were stored in', async () => {
    snapshot = snap([entry('b', { raisedAt: 3000 }), entry('a', { raisedAt: 1000 }), entry('c', { raisedAt: 2000 })]);
    await mount();
    expect(messages()).toEqual(['Message a', 'Message c', 'Message b']);
  });

  it('honours the chosen order', async () => {
    snapshot = snap([entry('a', { raisedAt: 1000 }), entry('b', { raisedAt: 3000 }), entry('c', { raisedAt: 2000 })], 'newest');
    await mount();
    expect(messages()).toEqual(['Message b', 'Message c', 'Message a']);
  });

  it('shows the heading, details and affected rows of an entry', async () => {
    snapshot = snap([entry('a', { details: ['one.md'], affected: [{ label: 'Alpha — Tab — Panel' }] })]);
    await mount();
    const card = screen.getByTestId('notification-entry');
    expect(card.textContent).toContain('Title a');
    expect(card.textContent).toContain('one.md');
    expect(card.textContent).toContain('Alpha — Tab — Panel');
    expect(card.className).toContain('notification-entry--error');
  });

  it('says "No notifications" when it is empty', async () => {
    await mount();
    expect(screen.getByTestId('notifications-empty').textContent).toBe('No notifications');
    expect(screen.queryByTestId('notification-entry')).toBeNull();
  });

  it('scrolls when the list overflows: a focusable, bounded region', async () => {
    snapshot = snap([entry('a')]);
    await mount();
    const list = screen.getByTestId('notifications-list');
    expect(list.getAttribute('tabindex')).toBe('0');
    expect(list.getAttribute('aria-label')).toBe('Notifications');
  });

  it('orders from the header: a control that sends the chosen order to main', async () => {
    snapshot = snap([entry('a')]);
    await mount();
    fireEvent.click(screen.getByTestId('notifications-order'));
    fireEvent.click(await screen.findByTestId('menu-item-Newest first'));
    expect(api.setOrder).toHaveBeenCalledWith('newest');
  });
});

describe('each entry’s own controls (FR-031a)', () => {
  it('has a dismiss and a copy, and they do their jobs', async () => {
    snapshot = snap([entry('a'), entry('b')]);
    await mount();
    fireEvent.click(screen.getByTestId('notification-dismiss-a'));
    expect(api.dismiss).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByTestId('notification-copy-b'));
    await waitFor(() => expect(clipboardWrites).toEqual(['Copy text b']));
  });

  it('draws no go-to-panel control (FR-063): the entry is the link, and a click on it runs the go-to', async () => {
    const goTo: NotificationActionDescriptor = { kind: 'goToPanel', panelId: 'p9', label: 'Go to panel' };
    snapshot = snap([entry('a', { actions: [goTo] })]);
    const { runAction } = await mount();
    expect(screen.queryByTestId('notification-action-a-0')).toBeNull();
    expect(screen.queryByTitle('Go to panel')).toBeNull();
    fireEvent.click(screen.getByTestId('notification-message'));
    expect(runAction).toHaveBeenCalledWith(goTo);
  });

  it('HIDES an action whose target no longer exists, keeping the entry', async () => {
    snapshot = snap([
      entry('a', { actions: [{ kind: 'goToPanel', panelId: 'gone', label: 'Go to panel' }, { kind: 'openPreferences', section: 'Notifications', label: 'Open settings' }] }),
    ]);
    await mount({ targetExists: (a) => a.kind !== 'goToPanel' });
    expect(screen.queryByTestId('notification-action-a-0')).toBeNull();
    expect(screen.getByTestId('notification-action-a-1').getAttribute('title')).toBe('Open settings');
    expect(screen.getByTestId('notification-entry')).toBeInTheDocument();
  });
});

describe('Dismiss all (FR-026a, FR-026b, FR-026c)', () => {
  it('asks first while confirmDismissAll is on, does nothing on Cancel, and dismisses on accept', async () => {
    snapshot = snap([entry('a'), entry('b')]);
    await mount();
    fireEvent.click(screen.getByTestId('notifications-dismiss-all'));
    expect(await screen.findByTestId('confirm-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-cancel'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.dismissAll).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('notifications-dismiss-all'));
    fireEvent.click(await screen.findByTestId('confirm-accept'));
    await waitFor(() => expect(api.dismissAll).toHaveBeenCalledTimes(1));
  });

  it('does not ask when confirmDismissAll is off', async () => {
    settingsPayload = { version: 1, notifications: { confirmDismissAll: false } };
    snapshot = snap([entry('a')]);
    await mount();
    fireEvent.click(screen.getByTestId('notifications-dismiss-all'));
    await waitFor(() => expect(api.dismissAll).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('leaves attention marks alone: it calls nothing on the attention bridge', async () => {
    settingsPayload = { version: 1, notifications: { confirmDismissAll: false } };
    snapshot = snap([entry('a', { severity: 'attention', key: 'group:attention:p1' })]);
    await mount();
    fireEvent.click(screen.getByTestId('notifications-dismiss-all'));
    await waitFor(() => expect(api.dismissAll).toHaveBeenCalled());
    expect(attention.goTo).not.toHaveBeenCalled();
    expect(attention.flag).not.toHaveBeenCalled();
  });

  it('is disabled when there is nothing to dismiss', async () => {
    await mount();
    expect(screen.getByTestId('notifications-dismiss-all')).toBeDisabled();
  });
});

describe('every action has a context-menu item, every control an icon (Principle VI)', () => {
  it('offers Dismiss all, the four orders and Minimise from the panel’s menu', async () => {
    snapshot = snap([entry('a')]);
    await mount();
    fireEvent.contextMenu(screen.getByTestId('notifications-panel'));
    for (const label of ['Dismiss all', 'Oldest first', 'Newest first', 'Priority, oldest first', 'Priority, newest first', 'Minimise']) {
      expect(await screen.findByTestId(`menu-item-${label}`), label).toBeInTheDocument();
    }
  });

  it('offers Restore instead of Minimise while minimised', async () => {
    const { onToggleMinimise } = await mount({ minimised: true });
    fireEvent.contextMenu(screen.getByTestId('notifications-panel'));
    fireEvent.click(await screen.findByTestId('menu-item-Restore'));
    expect(onToggleMinimise).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('menu-item-Minimise')).toBeNull();
  });

  it('offers Copy, Dismiss and the entry’s actions from an entry’s menu', async () => {
    snapshot = snap([entry('a', { actions: [{ kind: 'goToPanel', panelId: 'p9', label: 'Go to panel' }] })]);
    const { runAction } = await mount();
    fireEvent.contextMenu(screen.getByTestId('notification-entry'));
    expect(await screen.findByTestId('menu-item-Copy')).toBeInTheDocument();
    expect(screen.getByTestId('menu-item-Dismiss')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('menu-item-Go to panel'));
    expect(runAction).toHaveBeenCalledTimes(1);
  });

  it('draws every control as a themed icon button, never a text label', async () => {
    snapshot = snap([entry('a', { actions: [{ kind: 'goToPanel', panelId: 'p9', label: 'Go to panel' }] })]);
    await mount();
    const buttons = within(screen.getByTestId('notifications-panel')).getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    for (const button of buttons) {
      expect(button.querySelector('.icon[aria-hidden="true"]'), button.getAttribute('data-testid') ?? '').not.toBeNull();
      expect(button.getAttribute('title'), button.getAttribute('data-testid') ?? '').toBeTruthy();
    }
  });

  it('has a minimise control in the header that asks its owner to toggle', async () => {
    const { onToggleMinimise } = await mount();
    fireEvent.click(screen.getByTestId('notifications-minimise'));
    expect(onToggleMinimise).toHaveBeenCalledTimes(1);
  });

  it('shows only its header while minimised', async () => {
    snapshot = snap([entry('a')]);
    await mount({ minimised: true });
    expect(screen.getByTestId('notifications-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('notifications-list')).toBeNull();
    expect(screen.queryByTestId('notifications-empty')).toBeNull();
    expect(screen.getByTestId('notifications-restore')).toBeInTheDocument();
  });
});

describe('the keyboard (FR-033)', () => {
  it('makes each entry a tab stop; Delete dismisses it and Enter goes to its panel (FR-063)', async () => {
    const goTo: NotificationActionDescriptor = { kind: 'goToPanel', panelId: 'p9', label: 'Go to panel' };
    snapshot = snap([entry('a', { actions: [goTo] })]);
    const { runAction } = await mount();
    const card = screen.getByTestId('notification-entry');
    expect(card.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(runAction).toHaveBeenCalledWith(goTo);
    fireEvent.keyDown(card, { key: 'Delete' });
    expect(api.dismiss).toHaveBeenCalledWith('a');
  });

  it('opens an entry’s menu from the keyboard (the ContextMenu key)', async () => {
    snapshot = snap([entry('a')]);
    await mount();
    fireEvent.keyDown(screen.getByTestId('notification-entry'), { key: 'ContextMenu' });
    expect(await screen.findByTestId('menu-item-Copy')).toBeInTheDocument();
  });

  it('does not act on a key pressed in one of its own buttons', async () => {
    snapshot = snap([entry('a', { actions: [{ kind: 'goToPanel', panelId: 'p9', label: 'Go to panel' }] })]);
    const { runAction } = await mount();
    fireEvent.keyDown(screen.getByTestId('notification-copy-a'), { key: 'Enter' });
    expect(runAction).not.toHaveBeenCalled();
  });
});

describe('the minimise control is the side panes\' chevron (FR-058)', () => {
  it('points down to minimise', async () => {
    await mount();
    const button = screen.getByTestId('notifications-minimise');
    expect(button.querySelector('.pane-chevron.pane-chevron--down')).not.toBeNull();
    expect(button.querySelector('.pane-chevron--up')).toBeNull();
    expect(button.className).toContain('panel__action--chevron');
    expect(button.getAttribute('title')).toBe('Minimise Notifications');
  });

  it('points up to restore, and is still the one control that restores', async () => {
    const { onToggleMinimise } = await mount({ minimised: true });
    const button = screen.getByTestId('notifications-restore');
    expect(button.querySelector('.pane-chevron.pane-chevron--up')).not.toBeNull();
    expect(button.querySelector('.pane-chevron--down')).toBeNull();
    fireEvent.click(button);
    expect(onToggleMinimise).toHaveBeenCalledTimes(1);
  });

  it('centres the chevron in its button, and rotates the one themed glyph rather than drawing another', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/panes/panes.css'), 'utf8');
    const rule = (selector: string): string => {
      const at = css.indexOf(`${selector} {`);
      expect(at, `${selector} must have a rule`).toBeGreaterThanOrEqual(0);
      return css.slice(at, css.indexOf('}', at));
    };
    const button = rule('.panel__action--chevron');
    expect(button).toMatch(/display:\s*inline-flex/);
    expect(button).toMatch(/align-items:\s*center/);
    expect(button).toMatch(/justify-content:\s*center/);
    expect(rule('.pane-chevron--down')).toMatch(/rotate\(90deg\)/);
    expect(rule('.pane-chevron--up')).toMatch(/rotate\(-90deg\)/);
  });
});

describe('the header restores a minimised panel (FR-067)', () => {
  it('restores on a click anywhere on the minimised header, and marks it for the hover style', async () => {
    const { onToggleMinimise } = await mount({ minimised: true });
    const header = screen.getByTestId('notifications-panel').querySelector('header')!;
    expect(screen.getByTestId('notifications-panel').className).toContain('panel--minimised');
    fireEvent.click(screen.getByText('Notifications', { selector: '.panel__title' }));
    expect(onToggleMinimise).toHaveBeenCalledTimes(1);
    fireEvent.click(header);
    expect(onToggleMinimise).toHaveBeenCalledTimes(2);
  });

  it('does not double-fire when the restore button itself is clicked', async () => {
    const { onToggleMinimise } = await mount({ minimised: true });
    fireEvent.click(screen.getByTestId('notifications-restore'));
    expect(onToggleMinimise).toHaveBeenCalledTimes(1);
  });

  it('does NOT minimise on a click on an open panel\'s header; only its control does', async () => {
    const { onToggleMinimise } = await mount();
    expect(screen.getByTestId('notifications-panel').className).not.toContain('panel--minimised');
    fireEvent.click(screen.getByText('Notifications', { selector: '.panel__title' }));
    fireEvent.click(screen.getByTestId('notifications-panel').querySelector('header')!);
    expect(onToggleMinimise).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('notifications-minimise'));
    expect(onToggleMinimise).toHaveBeenCalledTimes(1);
  });

  it('wires the shared collapsed hover to the minimised header only (FR-070), unarmed until the pointer moves over it', async () => {
    await mount({ minimised: true });
    const header = screen.getByTestId('notifications-panel').querySelector('header')!;
    expect(header.className).toContain('collapsed-hover');
    expect(header.getAttribute('data-hover-armed')).toBe('false');
    fireEvent.pointerMove(header, { movementX: 3, movementY: 0 });
    expect(header.getAttribute('data-hover-armed')).toBe('true');
  });

  it('has none of it on an open header', async () => {
    await mount();
    const header = screen.getByTestId('notifications-panel').querySelector('header')!;
    expect(header.className).not.toContain('collapsed-hover');
    expect(header.getAttribute('data-hover-armed')).toBeNull();
  });
});

describe('inline surfaces stay inline (FR-034)', () => {
  it('a panel failure banner renders in place and adds no entry', async () => {
    await mount({
      extra: createElement(PanelFailureBanner, {
        panelId: 'p1',
        headline: 'This file could not be read',
        subject: 'Proj — Tab — Panel',
        detail: { path: 'D:\\proj\\a.ts', systemError: 'ENOENT' },
      } as never),
    });
    expect(screen.getByTestId('panel-failure-p1')).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.add).not.toHaveBeenCalled();
    expect(screen.queryByTestId('notification-entry')).toBeNull();
  });
});
