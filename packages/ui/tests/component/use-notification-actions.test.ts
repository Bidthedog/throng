/**
 * 068 B16/B18 (FR-063) — what an entry's go-to-panel link means in a window: whether its panel still exists (anywhere —
 * another project, a sub-workspace window — not only in this window's layout), and how it goes there.
 *
 * Layer: component — the real `useNotificationActions` hook over a fake `window.throng` and stubbed stores. Whether main
 * finds a panel with no mark is `attention-service.test.ts`'s (unit, no mocked go-to); this proves the renderer asks main
 * and follows its answer.
 */
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationEntry } from '@throng/core';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { useNotificationActions } from '../../src/renderer/notifications/use-notification-actions.js';
import { buildEntryMenu, iconFor } from '../../src/renderer/notifications/notifications-menu.js';
import type { NotificationsSnapshot } from '../../src/renderer/global.js';

const layoutHolder: { layout: unknown } = { layout: null };
vi.mock('../../src/renderer/state/workspace-store.js', () => ({ useWorkspaceOptional: () => ({ layout: layoutHolder.layout }) }));
vi.mock('../../src/renderer/state/projects-store.js', () => ({ useProjects: () => ({ activeProject: { id: 'proj-a', rootFolder: '/a' } }) }));
vi.mock('../../src/renderer/attention/attention-store.js', () => ({ getAttentionMarks: () => [] }));
vi.mock('../../src/renderer/editor/editor-open.js', () => ({ openFileInTab: vi.fn() }));

const entry = (id: string, panelId: string, projectId?: string): NotificationEntry => ({
  id,
  key: id,
  severity: 'error',
  message: id,
  details: [],
  copyText: id,
  affected: [],
  actions: [],
  raisedAt: 1,
  repeatCount: 1,
  origin: { panelId, ...(projectId ? { projectId } : {}) },
});

let goToPanel: ReturnType<typeof vi.fn>;
let panelsExist: ReturnType<typeof vi.fn>;
let snapshot: NotificationsSnapshot;

beforeEach(() => {
  layoutHolder.layout = null;
  goToPanel = vi.fn(() => Promise.resolve(true));
  panelsExist = vi.fn((panels: { panelId: string }[]) => Promise.resolve(panels.filter((p) => p.panelId === 'there').map((p) => p.panelId)));
  snapshot = {
    entries: [entry('e1', 'there', 'proj-b'), entry('e2', 'gone', 'proj-b')],
    order: 'oldest',
    pendingCount: 2,
    pendingSeverity: 'error',
    limit: 100,
  };
  Reflect.set(window, 'throng', {
    attention: { goTo: vi.fn(), goToPanel, panelsExist },
    notifications: {
      list: () => Promise.resolve(snapshot),
      onChanged: () => () => {},
      onRepeat: () => () => {},
      onLimitReached: () => () => {},
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  vi.clearAllMocks();
});

const link = (panelId: string, projectId?: string) => ({ kind: 'goToPanel' as const, panelId, label: 'Go to panel', ...(projectId ? { projectId } : {}) });

describe('does the link\'s panel exist (B18)', () => {
  it('asks main about the panels the entries name, with their projects', async () => {
    renderHook(() => useNotificationActions());
    await waitFor(() => expect(panelsExist).toHaveBeenCalled());
    expect(panelsExist.mock.calls.at(-1)![0]).toEqual(
      expect.arrayContaining([
        { panelId: 'there', projectId: 'proj-b' },
        { panelId: 'gone', projectId: 'proj-b' },
      ]),
    );
  });

  it('is true for a panel in ANOTHER project that main found, false for one it did not', async () => {
    const { result } = renderHook(() => useNotificationActions());
    await waitFor(() => expect(result.current.targetExists(link('there', 'proj-b'))).toBe(true));
    expect(result.current.targetExists(link('gone', 'proj-b'))).toBe(false);
  });

  it('is true at once for a panel this window\'s own layout holds, with no answer needed', () => {
    layoutHolder.layout = { projectId: 'proj-a', tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'here', originProjectId: 'proj-a', title: 'x' } }] };
    const { result } = renderHook(() => useNotificationActions());
    expect(result.current.targetExists(link('here'))).toBe(true);
  });
});

describe('going there (B16)', () => {
  it('takes the panel and its project to main\'s link route, which needs no mark — not to the mark-only go-to', async () => {
    const { result } = renderHook(() => useNotificationActions());
    await act(async () => {
      result.current.runAction(link('there', 'proj-b'));
    });
    expect(goToPanel).toHaveBeenCalledWith({ panelId: 'there', projectId: 'proj-b' });
    expect((window.throng as { attention: { goTo: ReturnType<typeof vi.fn> } }).attention.goTo).not.toHaveBeenCalled();
  });

  it('leaves the project out when the entry names none', async () => {
    const { result } = renderHook(() => useNotificationActions());
    await act(async () => {
      result.current.runAction(link('there'));
    });
    expect(goToPanel).toHaveBeenCalledWith({ panelId: 'there' });
  });
});

/*
 * 069 FR-039 (research R7) — the `openIconSetsFolder` action a backup notice carries: it is not about any panel, so it is
 * always available, and running it opens the icon sets folder itself (no set named) through the icon-sets bridge.
 */
describe('open the icon sets folder (069 R7)', () => {
  const openFolderAction = { kind: 'openIconSetsFolder' as const, label: 'Open the icon sets folder' };
  const withBridge = (): ReturnType<typeof vi.fn> => {
    const openFolder = vi.fn(() => Promise.resolve({ ok: true }));
    Reflect.set(window, 'throng', { ...(window.throng as object), iconSets: { openFolder } });
    return openFolder;
  };

  it('is always available — it names no panel that could be gone', () => {
    const { result } = renderHook(() => useNotificationActions());
    expect(result.current.targetExists(openFolderAction)).toBe(true);
  });

  it('opens the icon sets folder itself: the bridge is asked for no set', async () => {
    const openFolder = withBridge();
    const { result } = renderHook(() => useNotificationActions());
    await act(async () => {
      result.current.runAction(openFolderAction);
    });
    expect(openFolder).toHaveBeenCalledTimes(1);
    expect(openFolder).toHaveBeenCalledWith();
  });

  it('shows a notice naming the reason when main answers that the folder could not be opened', async () => {
    const openFolder = vi.fn(() => Promise.resolve({ ok: false, reason: 'io', message: 'no file manager here' }));
    const base = window.throng as unknown as { notifications: object };
    Reflect.set(window, 'throng', {
      ...base,
      notifications: { ...base.notifications, add: () => Promise.resolve() }, // the provider keeps what it raises
      iconSets: { openFolder },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(NotificationProvider, null, children);
    const { result } = renderHook(() => useNotificationActions(), { wrapper });
    await act(async () => {
      result.current.runAction(openFolderAction);
    });
    const notice = await screen.findByTestId('icon-set-notice-error');
    expect(notice.textContent).toContain('no file manager here');
  });

  it('is drawn with the folderOpen key, in the entry menu and on the entry', () => {
    expect(iconFor(openFolderAction)).toBe('folderOpen');
    const menu = buildEntryMenu({
      entry: entry('e1', 'there'),
      actions: [openFolderAction],
      onCopy: vi.fn(),
      onDismiss: vi.fn(),
      onRun: vi.fn(),
    });
    expect(menu.find((item) => item.label === openFolderAction.label)?.icon).toBe('folderOpen');
  });
});
