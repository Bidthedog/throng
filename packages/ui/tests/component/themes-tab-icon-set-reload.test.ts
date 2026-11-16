/**
 * Selecting an icon set while its theme write is still debounced (069 FR-029).
 *
 * Layer: component — the race is between two renderer-side things, the debounced theme write and
 * the config broadcast that Reload the icon sets from disk triggers. Both are stood in at the bridge, over the real
 * `ConfigProvider` and `ThemesTab`; no main process is needed to see it.
 *
 * The observable: the user picks a set and the picker stays on it. A broadcast that re-reads the
 * theme from disk BEFORE the write lands carries the old theme, which flicks the picker back and
 * resets the optimistic copy a following token edit builds on, so that edit drops `iconPack`.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, DEFAULT_KEYBINDINGS, THRONG_THEME, type Theme, type UserIconSetDto } from '@throng/core';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ThemesTab } from '../../src/renderer/preferences/themes-tab.js';

const MINE: UserIconSetDto = { name: 'mine', overrides: {}, failures: {}, unrecognised: [] };

beforeEach(() => {
  window.history.replaceState(null, '', '/?foldDefault=open');
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

/** A bridge over a one-theme "disk": reload broadcasts whatever the disk holds at that moment. */
function mountOverDisk() {
  let disk: Theme = THRONG_THEME;
  const written: Theme[] = [];
  let emit: (payload: unknown) => void = () => undefined;
  const payload = () => ({ settings: DEFAULT_APP_SETTINGS, theme: disk, keybindings: DEFAULT_KEYBINDINGS, iconSets: [MINE] });
  Reflect.set(window, 'throng', {
    config: {
      get: () => Promise.resolve(payload()),
      onChange: (cb: (p: unknown) => void) => {
        emit = cb;
        return () => undefined;
      },
      // The write lands a tick later, as an IPC round trip would.
      write: (_id: unknown, json: string) =>
        new Promise((resolve) => {
          setTimeout(() => {
            disk = JSON.parse(json) as Theme;
            written.push(disk);
            resolve({ ok: true });
          }, 5);
        }),
    },
    iconSets: {
      reload: () => {
        const snapshot = payload(); // main reads the config as it is on disk NOW
        setTimeout(() => act(() => emit(snapshot)), 1);
        return Promise.resolve({ ok: true });
      },
      openFolder: () => Promise.resolve({ ok: true }),
      create: () => Promise.resolve({ ok: true }),
      override: () => Promise.resolve({ ok: true }),
      onBackupsPresent: () => () => undefined,
      backupsReady: () => undefined,
    },
  });
  render(
    createElement(
      NotificationProvider,
      null,
      createElement(ConfigProvider, null, createElement(ConfirmProvider, null, createElement(ThemesTab))),
    ),
  );
  return { user: userEvent.setup({ delay: null }), written };
}

describe('selecting an icon set while the theme write is pending', () => {
  it('keeps the picker on the chosen set through the reload broadcast, and the theme file ends up naming it', async () => {
    const { user, written } = mountOverDisk();
    await waitFor(() => expect(screen.getByTestId('icon-set-option-mine')).toBeInTheDocument());
    const select = screen.getByTestId('icon-set-select') as HTMLSelectElement;

    await user.selectOptions(select, 'mine');

    // Once the theme write has landed (the picker is controlled, so it adopts the set then), it must
    // stay on the set through every broadcast that follows.
    await waitFor(() => expect(written.at(-1)?.iconPack).toBe('mine'));
    await waitFor(() => expect(select.value).toBe('mine'));
    const seen = new Set<string>();
    const deadline = Date.now() + 400;
    while (Date.now() < deadline) {
      await act(() => new Promise((r) => setTimeout(r, 2)));
      seen.add(select.value);
    }
    expect([...seen]).toEqual(['mine']);
  });

  it('does not lose the chosen set from a token edit made right after selecting it', async () => {
    const { user, written } = mountOverDisk();
    await waitFor(() => expect(screen.getByTestId('icon-set-option-mine')).toBeInTheDocument());

    await user.selectOptions(screen.getByTestId('icon-set-select'), 'mine');
    await act(() => new Promise((r) => setTimeout(r, 30))); // the reload's broadcast has been adopted by now

    const hex = screen.getByTestId('control-colours.iconColour-hex') as HTMLInputElement;
    await user.clear(hex);
    await user.type(hex, '#112233');
    await user.tab();

    await waitFor(() => expect(written.at(-1)?.colours.iconColour).toBe('#112233'));
    expect(written.at(-1)?.iconPack).toBe('mine');
  });
});
