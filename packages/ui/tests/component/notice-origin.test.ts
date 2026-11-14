/**
 * 068 US3 T089 and T090 (FR-061, FR-063, FR-034b, SC-005b) — where a notice belongs, and the click that goes there.
 *
 * Layer: component — the real `NotificationProvider` (the toast), the real `NotificationsPanel` (the entry) and the
 * hook between them, over a fake `window.throng`. What main stores is the store's and the IPC's; what the pure model
 * decides is `place.test.ts`'s. This proves what the renderer SHOWS, COPIES and LOGS for a notice with an origin, and
 * what clicking it does.
 *
 * ANTI-VACUITY: every "names it" assertion has a sibling notice with no origin that must name nothing, and every
 * "goes to the panel" assertion has a sibling that must not (a button, no origin, a panel that is gone).
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationActionDescriptor, NotificationEntry, NotificationEntryInput } from '@throng/core';
import { NotificationProvider, useNotify, type NoticeInput } from '../../src/renderer/common/notification.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { NotificationsPanel } from '../../src/renderer/notifications/notifications-panel.js';
import type { NotificationsSnapshot } from '../../src/renderer/global.js';
import { flushUntil } from './helpers/flush-until.js';

const PLACE = 'Alpha › Build › Shell';
const NAMES = ['Alpha', 'Build', 'Shell'];

let added: NotificationEntryInput[] = [];
let logged: unknown[] = [];
let clipboardWrites: string[] = [];
let goTo: ReturnType<typeof vi.fn>;
let panelsExist: ReturnType<typeof vi.fn>;
let snapshot: NotificationsSnapshot;

const snap = (entries: NotificationEntry[]): NotificationsSnapshot => ({
  entries,
  order: 'oldest',
  pendingCount: entries.length,
  pendingSeverity: entries[0]?.severity ?? null,
  limit: 100,
});

beforeEach(() => {
  added = [];
  logged = [];
  clipboardWrites = [];
  goTo = vi.fn(() => Promise.resolve(true));
  panelsExist = vi.fn((panels: { panelId: string }[]) => Promise.resolve(panels.map((p) => p.panelId)));
  snapshot = snap([]);
  Reflect.set(window, 'throng', {
    notices: { log: (record: unknown) => logged.push(record) },
    config: { get: () => Promise.resolve({ settings: { version: 1 } }) },
    clipboard: {
      write: (entry: { text: string }) => {
        clipboardWrites.push(entry.text);
        return Promise.resolve();
      },
    },
    notifications: {
      add: (entry: NotificationEntryInput) => {
        added.push(entry);
        return Promise.resolve({ outcome: 'added', id: `e${added.length}` });
      },
      list: () => Promise.resolve(snapshot),
      dismiss: () => Promise.resolve(snapshot),
      dismissAll: () => Promise.resolve(snapshot),
      setOrder: () => Promise.resolve(snapshot),
      dismissLimitWarning: () => {},
      onChanged: () => () => {},
      onRepeat: () => () => {},
      onLimitReached: () => () => {},
    },
    attention: { onToast: () => () => {}, onChanged: () => () => {}, goTo: vi.fn(), goToPanel: goTo, panelsExist },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

interface Probe {
  notify?: (input: NoticeInput) => string;
  loaded?: boolean;
}
function ProbeView({ into }: { into: Probe }): ReactElement | null {
  into.notify = useNotify().notify;
  into.loaded = useConfigLoaded();
  return null;
}

interface PanelOptions {
  targetExists?: (a: NotificationActionDescriptor) => boolean;
  runAction?: (a: NotificationActionDescriptor) => void;
}

async function mount(panel?: PanelOptions): Promise<Probe> {
  const probe: Probe = {};
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(
        NotificationProvider,
        null,
        createElement(ProbeView, { into: probe, key: 'probe' }),
        panel
          ? createElement(
              ConfirmProvider,
              null,
              createElement(
                ContextMenuProvider,
                null,
                createElement(NotificationsPanel, {
                  minimised: false,
                  onToggleMinimise: () => {},
                  targetExists: panel.targetExists ?? (() => true),
                  runAction: panel.runAction ?? (() => {}),
                }),
              ),
            )
          : null,
      ),
    ),
  );
  await flushUntil(() => probe.loaded === true);
  return probe;
}

const BASE = {
  severity: 'error' as const,
  title: 'Could not start',
  message: 'The shell exited.',
  testId: 'origin-notice',
};
const PANEL_SUBJECT = { kind: 'panel', name: 'Shell', tab: 'Build', project: 'Alpha' } as const;

describe('a notice with a panel origin names project, tab and panel (FR-061)', () => {
  it('in its toast, as Project › Tab › Panel', async () => {
    const probe = await mount();
    act(() => void probe.notify!({ ...BASE, subject: PANEL_SUBJECT, origin: { panelId: 'p1', projectId: 'pr1' } }));
    const toast = screen.getByTestId('origin-notice');
    expect(toast.textContent).toContain(PLACE);
    expect(within(toast).getAllByText(PLACE)).toHaveLength(1);
  });

  it('once: a notice that heads itself with its bare subject shows the place instead of repeating it', async () => {
    const probe = await mount();
    act(() => void probe.notify!({ severity: 'error', message: 'It failed.', testId: 'bare', subject: PANEL_SUBJECT, origin: { panelId: 'p1' } }));
    const toast = screen.getByTestId('bare');
    expect(toast.textContent).toContain(PLACE);
    expect(toast.textContent).not.toContain('Alpha — Build — Shell');
  });

  it('keeps a terminal\'s flavour: its heading stays and the place sits under it (030 FR-026, B19)', async () => {
    const probe = await mount();
    act(
      () =>
        void probe.notify!({
          severity: 'error',
          message: 'It exited.',
          testId: 'term',
          subject: { kind: 'terminal', flavour: 'PowerShell', panel: 'Shell', tab: 'Build', project: 'Alpha', panelId: 'p3' },
        }),
    );
    const toast = screen.getByTestId('term');
    expect(toast.textContent).toContain('PowerShell');
    expect(toast.textContent).toContain(PLACE);
    await waitFor(() => expect(added).toHaveLength(1));
    expect(added[0]!.title).toContain('PowerShell');
    expect(added[0]!.copyText).toContain('PowerShell');
    expect(added[0]!.copyText).toContain(PLACE);
  });

  it('in the entry it keeps, and in the copy text of both', async () => {
    const probe = await mount();
    act(() => void probe.notify!({ ...BASE, subject: PANEL_SUBJECT, origin: { panelId: 'p1', projectId: 'pr1' } }));
    await waitFor(() => expect(added).toHaveLength(1));
    expect(added[0]).toMatchObject({
      origin: { panelId: 'p1', projectId: 'pr1' },
      place: { project: 'Alpha', tab: 'Build', panel: 'Shell' },
    });
    expect(added[0]!.copyText).toContain(PLACE);
    fireEvent.click(screen.getByTestId('origin-notice-copy'));
    await waitFor(() => expect(clipboardWrites).toHaveLength(1));
    expect(clipboardWrites[0]).toBe(added[0]!.copyText);
  });

  it('without a stated origin, when its panel subject carries the panel id (every panel raiser does)', async () => {
    const probe = await mount();
    act(() => void probe.notify!({ ...BASE, subject: { ...PANEL_SUBJECT, panelId: 'p7', projectId: 'pr7' } }));
    const toast = screen.getByTestId('origin-notice');
    expect(toast.textContent).toContain(PLACE);
    fireEvent.click(within(toast).getByText('The shell exited.'));
    expect(goTo).toHaveBeenCalledWith({ panelId: 'p7', projectId: 'pr7' });
    await waitFor(() => expect(added).toHaveLength(1));
    expect(added[0]).toMatchObject({ origin: { panelId: 'p7', projectId: 'pr7' }, place: { panel: 'Shell' } });
  });

  it('names the project alone when the notice relates to a project but to no single panel', async () => {
    const probe = await mount();
    act(
      () =>
        void probe.notify!({ ...BASE, subject: { kind: 'project', name: 'Alpha' }, origin: { projectId: 'pr1' } }),
    );
    const toast = screen.getByTestId('origin-notice');
    expect(within(toast).getByText('Alpha')).toBeInTheDocument();
    expect(toast.textContent).not.toContain('›');
    await waitFor(() => expect(added).toHaveLength(1));
    expect(added[0]).toMatchObject({ origin: { projectId: 'pr1' }, place: { project: 'Alpha' } });
    expect(added[0]!.origin).not.toHaveProperty('panelId');
  });

  it('names none of them for a notice about the whole app, and stores no origin', async () => {
    const probe = await mount();
    act(() => void probe.notify!({ ...BASE, subject: { kind: 'none' } }));
    expect(screen.getByTestId('origin-notice').textContent).not.toContain('›');
    await waitFor(() => expect(added).toHaveLength(1));
    expect(added[0]).not.toHaveProperty('origin');
    expect(added[0]).not.toHaveProperty('place');
    expect(added[0]!.copyText).not.toContain('›');
  });

  it('takes the names a raiser states outright, when its subject is not the place', async () => {
    const probe = await mount();
    act(
      () =>
        void probe.notify!({
          ...BASE,
          subject: { kind: 'none' },
          origin: { panelId: 'p1' },
          place: { project: 'Alpha', tab: 'Build', panel: 'Shell' },
        }),
    );
    expect(screen.getByTestId('origin-notice').textContent).toContain(PLACE);
  });
});

describe('the diagnostic log record stays anonymised (FR-034b, SC-005b)', () => {
  it('carries none of the names the toast shows, and no origin or place field', async () => {
    const probe = await mount();
    act(
      () =>
        void probe.notify!({
          ...BASE,
          subject: { kind: 'none' },
          origin: { panelId: 'p1', projectId: 'pr1' },
          place: { project: 'Alpha', tab: 'Build', panel: 'Shell' },
        }),
    );
    expect(screen.getByTestId('origin-notice').textContent).toContain(PLACE);
    await waitFor(() => expect(logged.length).toBeGreaterThan(0));
    const text = JSON.stringify(logged);
    for (const name of NAMES) expect(text, `the log record must not name "${name}"`).not.toContain(name);
    expect(text).not.toContain('›');
    for (const record of logged) {
      expect(record).not.toHaveProperty('place');
      expect(record).not.toHaveProperty('origin');
    }
  });
});

describe('an entry keeps the names it was raised with, across a restart (FR-061)', () => {
  const stored = (over: Partial<NotificationEntry> = {}): NotificationEntry => ({
    id: 'e1',
    key: 'k',
    severity: 'error',
    title: 'Could not start',
    message: 'The shell exited.',
    details: [],
    copyText: 'x',
    affected: [],
    actions: [],
    raisedAt: 1,
    repeatCount: 1,
    ...over,
  });

  it('draws the stored place on the entry, as raised', async () => {
    snapshot = snap([
      stored({ origin: { panelId: 'p1' }, place: { project: 'Alpha', tab: 'Build', panel: 'Shell' } }),
      stored({ id: 'e2', key: 'k2', message: 'About the app.' }),
    ]);
    await mount({});
    const [withPlace, without] = await screen.findAllByTestId('notification-entry');
    expect(withPlace!.textContent).toContain(PLACE);
    expect(without!.textContent).not.toContain('›');
  });
});

describe('clicking a notice with a panel origin goes to that panel (FR-063)', () => {
  it('a toast: a click anywhere but its buttons goes to the panel', async () => {
    const probe = await mount();
    act(() => void probe.notify!({ ...BASE, subject: PANEL_SUBJECT, origin: { panelId: 'p1' } }));
    const toast = screen.getByTestId('origin-notice');
    fireEvent.click(within(toast).getByText('The shell exited.'));
    expect(goTo).toHaveBeenCalledTimes(1);
    expect(goTo).toHaveBeenCalledWith({ panelId: 'p1' });
  });

  it('a toast: Enter on the focused toast does the same', async () => {
    const probe = await mount();
    act(() => void probe.notify!({ ...BASE, subject: PANEL_SUBJECT, origin: { panelId: 'p1' } }));
    const toast = screen.getByTestId('origin-notice');
    expect(toast.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(toast, { key: 'Enter' });
    expect(goTo).toHaveBeenCalledWith({ panelId: 'p1' });
  });

  it('a toast: its Copy and Dismiss buttons do only their own job', async () => {
    const probe = await mount();
    act(() => void probe.notify!({ ...BASE, subject: PANEL_SUBJECT, origin: { panelId: 'p1' } }));
    fireEvent.click(screen.getByTestId('origin-notice-copy'));
    fireEvent.click(screen.getByTestId('origin-notice-dismiss'));
    expect(goTo).not.toHaveBeenCalled();
    expect(screen.queryByTestId('origin-notice')).toBeNull();
  });

  it('a toast with no origin, or an origin that is only a project, is not a link', async () => {
    const probe = await mount();
    act(() => void probe.notify!({ ...BASE, subject: { kind: 'none' } }));
    act(() => void probe.notify!({ ...BASE, testId: 'project-only', subject: { kind: 'project', name: 'Alpha' }, origin: { projectId: 'pr1' } }));
    for (const id of ['origin-notice', 'project-only']) {
      const toast = screen.getByTestId(id);
      fireEvent.click(toast);
      fireEvent.keyDown(toast, { key: 'Enter' });
      expect(toast.getAttribute('tabindex'), id).toBeNull();
      expect(toast.className, id).not.toContain('notice--activatable');
    }
    expect(goTo).not.toHaveBeenCalled();
  });

  describe('a toast whose panel is gone (T096, FR-063 last sentence)', () => {
    const raise = (probe: Probe): HTMLElement => {
      act(() => void probe.notify!({ ...BASE, subject: PANEL_SUBJECT, origin: { panelId: 'p1', projectId: 'pr1' } }));
      return screen.getByTestId('origin-notice');
    };

    it('stops being a link once main says its panel no longer exists, asked once as the pointer enters', async () => {
      panelsExist.mockImplementation(() => Promise.resolve([]));
      const probe = await mount();
      const toast = raise(probe);
      expect(toast.className).toContain('notice--activatable');
      fireEvent.pointerEnter(toast);
      await waitFor(() => expect(toast.className).not.toContain('notice--activatable'));
      expect(panelsExist).toHaveBeenCalledTimes(1);
      expect(panelsExist).toHaveBeenCalledWith([{ panelId: 'p1', projectId: 'pr1' }]);
      expect(toast.getAttribute('tabindex')).toBeNull();
      fireEvent.click(within(toast).getByText('The shell exited.'));
      fireEvent.keyDown(toast, { key: 'Enter' });
      expect(goTo).not.toHaveBeenCalled();
    });

    it('asks on keyboard focus too', async () => {
      panelsExist.mockImplementation(() => Promise.resolve([]));
      const probe = await mount();
      const toast = raise(probe);
      fireEvent.focus(toast);
      await waitFor(() => expect(toast.className).not.toContain('notice--activatable'));
    });

    it('stays a link while its panel exists (anti-vacuity), and still goes there', async () => {
      const probe = await mount();
      const toast = raise(probe);
      fireEvent.pointerEnter(toast);
      await waitFor(() => expect(panelsExist).toHaveBeenCalled());
      await act(async () => {
        await Promise.resolve();
      });
      expect(toast.className).toContain('notice--activatable');
      fireEvent.click(within(toast).getByText('The shell exited.'));
      expect(goTo).toHaveBeenCalledWith({ panelId: 'p1', projectId: 'pr1' });
    });

    it('asks nothing for a notice with no panel origin', async () => {
      const probe = await mount();
      act(() => void probe.notify!({ ...BASE, subject: { kind: 'none' } }));
      fireEvent.pointerEnter(screen.getByTestId('origin-notice'));
      expect(panelsExist).not.toHaveBeenCalled();
    });
  });

  describe('an entry', () => {
    const entry = (over: Partial<NotificationEntry> = {}): NotificationEntry => ({
      id: 'e1',
      key: 'k',
      severity: 'error',
      message: 'The shell exited.',
      details: [],
      copyText: 'x',
      affected: [],
      actions: [],
      raisedAt: 1,
      repeatCount: 1,
      origin: { panelId: 'p1' },
      place: { project: 'Alpha', tab: 'Build', panel: 'Shell' },
      ...over,
    });

    it('goes to the panel on a click anywhere but its buttons, and on Enter', async () => {
      snapshot = snap([entry()]);
      const runAction = vi.fn();
      await mount({ runAction });
      const card = await screen.findByTestId('notification-entry');
      fireEvent.click(within(card).getByTestId('notification-message'));
      expect(runAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'goToPanel', panelId: 'p1' }));
      runAction.mockClear();
      fireEvent.keyDown(card, { key: 'Enter' });
      expect(runAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'goToPanel', panelId: 'p1' }));
      expect(card.className).toContain('notification-entry--activatable');
    });

    it('its buttons do only their own job', async () => {
      snapshot = snap([entry()]);
      const runAction = vi.fn();
      await mount({ runAction });
      await screen.findByTestId('notification-entry');
      fireEvent.click(screen.getByTestId('notification-copy-e1'));
      fireEvent.click(screen.getByTestId('notification-dismiss-e1'));
      expect(runAction).not.toHaveBeenCalled();
    });

    it('renders no go-to-panel control, whether the panel comes from its origin or from a stored descriptor', async () => {
      snapshot = snap([
        entry(),
        entry({ id: 'e2', key: 'k2', actions: [{ kind: 'goToPanel', panelId: 'p9', label: 'Go to panel' }] }),
        entry({
          id: 'e3',
          key: 'k3',
          origin: undefined,
          actions: [
            { kind: 'goToPanel', panelId: 'p9', label: 'Go to panel' },
            { kind: 'openPreferences', section: 'notifications', label: 'Open settings' },
          ],
        }),
      ]);
      await mount({});
      await screen.findAllByTestId('notification-entry');
      expect(screen.queryByTitle('Go to panel')).toBeNull();
      // The entry's other actions are still controls (anti-vacuity): only the go-to one went.
      expect(screen.getByTitle('Open settings')).toBeInTheDocument();
    });

    it('is not a link with no origin', async () => {
      snapshot = snap([entry({ origin: undefined, place: undefined })]);
      const runAction = vi.fn();
      await mount({ runAction });
      const card = await screen.findByTestId('notification-entry');
      fireEvent.click(card);
      fireEvent.keyDown(card, { key: 'Enter' });
      expect(runAction).not.toHaveBeenCalled();
      expect(card.className).not.toContain('notification-entry--activatable');
    });

    it('is not a link once its panel no longer exists (FR-031a)', async () => {
      snapshot = snap([entry()]);
      const runAction = vi.fn();
      await mount({ runAction, targetExists: (a) => a.kind !== 'goToPanel' });
      const card = await screen.findByTestId('notification-entry');
      fireEvent.click(card);
      fireEvent.keyDown(card, { key: 'Enter' });
      expect(runAction).not.toHaveBeenCalled();
      expect(card.className).not.toContain('notification-entry--activatable');
    });

    it('still has a menu route to the panel (Principle VI: no control, but every action has a menu item)', async () => {
      snapshot = snap([entry()]);
      const runAction = vi.fn();
      await mount({ runAction });
      const card = await screen.findByTestId('notification-entry');
      fireEvent.contextMenu(card);
      fireEvent.click(await screen.findByTestId('menu-item-Go to panel'));
      expect(runAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'goToPanel', panelId: 'p1' }));
    });
  });
});
