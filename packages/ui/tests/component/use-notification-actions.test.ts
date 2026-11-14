/**
 * 068 B16/B18 (FR-063) — what an entry's go-to-panel link means in a window: whether its panel still exists (anywhere —
 * another project, a sub-workspace window — not only in this window's layout), and how it goes there.
 *
 * Layer: component — the real `useNotificationActions` hook over a fake `window.throng` and stubbed stores. Whether main
 * finds a panel with no mark is `attention-service.test.ts`'s (unit, no mocked go-to); this proves the renderer asks main
 * and follows its answer.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationEntry } from '@throng/core';
import { useNotificationActions } from '../../src/renderer/notifications/use-notification-actions.js';
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
