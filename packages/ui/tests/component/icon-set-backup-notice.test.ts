/**
 * 069 FR-038 — a window that starts with icon-set backups in the user's folder says so, once, with the
 * action that resolves it.
 *
 * Layer: component — what one renderer component renders and how it reacts to a pushed event; jsdom
 * shows all of it. Which folders count as backups is core's (`icon-set-upgrade`) and when main sends the
 * event is main's; this proves the window subscribes, announces it is listening, and raises one sticky
 * notice from core's text.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { iconSetBackupNoticeText } from '@throng/core';
import { IconSetBackupNotice } from '../../src/renderer/common/icon-set-backup-notice.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { drawnIcon, iconMarkup } from './helpers/icon-markup.js';

let push: ((payload: { count: number }) => void) | undefined;
const backupsReady = vi.fn();
const openFolder = vi.fn(() => Promise.resolve({ ok: true }));
const TEST_ID = 'icon-set-backup-notice';

beforeEach(() => {
  push = undefined;
  backupsReady.mockClear();
  openFolder.mockClear();
  Reflect.set(window, 'throng', {
    notices: { log: () => undefined },
    config: { get: () => Promise.resolve({ settings: { version: 1 } }) },
    iconSets: {
      onBackupsPresent: (cb: (payload: { count: number }) => void) => {
        push = cb;
        return () => {
          push = undefined;
        };
      },
      backupsReady,
      openFolder,
    },
  });
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

async function mount(): Promise<void> {
  render(createElement(ConfigProvider, null, createElement(NotificationProvider, null, createElement(IconSetBackupNotice))));
  await waitFor(() => expect(push).toBeDefined());
}

describe('the icon-set backup notice (069 FR-038)', () => {
  it('announces it is listening only after subscribing, so a count found before the window loaded still arrives', async () => {
    await mount();
    expect(backupsReady).toHaveBeenCalledTimes(1);
  });

  it('raises one notice with core’s text for the count', async () => {
    await mount();
    act(() => push!({ count: 2 }));

    const card = await screen.findByTestId(TEST_ID);
    const { title, message } = iconSetBackupNoticeText(2);
    expect(card.textContent).toContain(message);
    expect(card.textContent).toContain(title);
  });

  it('is sticky: it stays long past the toast duration (068 FR-021e)', async () => {
    await mount();
    vi.useFakeTimers();
    act(() => push!({ count: 1 }));
    expect(screen.getByTestId(TEST_ID)).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(screen.queryByTestId(TEST_ID), 'the duration timer took a sticky card').not.toBeNull();
    vi.useRealTimers();
  });

  it('carries an Open folder icon control that opens the icon sets folder itself', async () => {
    await mount();
    act(() => push!({ count: 1 }));

    const open = await screen.findByTestId('icon-set-backup-open-folder');
    expect(drawnIcon(open)).toBe(iconMarkup('folderOpen'));
    // 069 FR-050 (constitution, toast controls): in the card's control group, to the left of Copy and Dismiss.
    const group = [...open.closest('[data-testid="notice-controls"]')!.querySelectorAll('button')].map((b) => b.getAttribute('data-testid'));
    expect(group).toEqual(['icon-set-backup-open-folder', `${TEST_ID}-copy`, `${TEST_ID}-dismiss`]);
    expect(open.getAttribute('title') ?? '').not.toBe('');
    fireEvent.click(open);
    expect(openFolder).toHaveBeenCalledTimes(1);
    expect(openFolder).toHaveBeenCalledWith();
  });

  it('shows a notice naming the reason when main answers that the folder could not be opened', async () => {
    openFolder.mockResolvedValueOnce({ ok: false, reason: 'io', message: 'no file manager here' } as never);
    await mount();
    act(() => push!({ count: 1 }));

    fireEvent.click(await screen.findByTestId('icon-set-backup-open-folder'));

    const notice = await screen.findByTestId('icon-set-notice-error');
    expect(notice.textContent).toContain('no file manager here');
  });

  it('raises the notice again as ONE notice: a repeat flashes it rather than adding a second', async () => {
    await mount();
    act(() => push!({ count: 2 }));
    await screen.findByTestId(TEST_ID);
    act(() => push!({ count: 2 }));

    expect(screen.getAllByTestId(TEST_ID)).toHaveLength(1);
  });

  it('raises nothing when main sends no event (a count of 0 is never sent)', async () => {
    await mount();
    expect(screen.queryByTestId(TEST_ID)).toBeNull();
  });
});
