/**
 * 067 T055 (FR-034) — the Preferences control for the file manager's "Open as throng project" item.
 *
 * The registration is the state; no setting could disagree with it. So the toggle shows what
 * `status()` says, a machine-wide Windows registration (which only an elevated process can change) is
 * disabled and says why, and a change that did not take is never reported as made: the toggle shows the
 * state main answers with, and one notice says the change was not made.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileManagerRegistration } from '@throng/core';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { FileManagerItemControl } from '../../src/renderer/preferences/file-manager-item-control.js';

function mount(initial: FileManagerRegistration, setEnabled?: (on: boolean) => Promise<FileManagerRegistration>) {
  const api = {
    status: vi.fn(() => Promise.resolve(initial)),
    setEnabled: vi.fn(setEnabled ?? ((on: boolean) => Promise.resolve({ state: on ? 'on' : 'off' } as FileManagerRegistration))),
  };
  Reflect.set(window, 'throng', { fileManagerItem: api });
  render(createElement(NotificationProvider, null, createElement(FileManagerItemControl)));
  return api;
}

const toggle = (): HTMLInputElement => screen.getByTestId('file-manager-item-toggle') as HTMLInputElement;
const notices = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('[data-testid="notices"] .notice'),
];

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('reflecting status() (FR-034)', () => {
  it('is on when the item is registered, off when it is not', async () => {
    mount({ state: 'on' });
    await waitFor(() => expect(toggle().checked).toBe(true));
    expect(toggle()).not.toBeDisabled();
  });

  it('shows off for an unregistered item', async () => {
    const api = mount({ state: 'off' });
    await waitFor(() => expect(api.status).toHaveBeenCalled());
    await waitFor(() => expect(toggle().checked).toBe(false));
    expect(toggle()).not.toBeDisabled();
  });

  it('has an accessible name and is reachable by keyboard', async () => {
    mount({ state: 'on' });
    await waitFor(() => expect(toggle().checked).toBe(true));
    expect(toggle()).toHaveAccessibleName(/open as throng project/i);
    toggle().focus();
    expect(document.activeElement).toBe(toggle());
  });
});

describe('a machine-wide registration (FR-034)', () => {
  it('is disabled, shown as on, and says why', async () => {
    mount({ state: 'machine-wide', reason: 'It was registered for every user, which needs administrator rights to change.' });
    await waitFor(() => expect(toggle()).toBeDisabled());
    expect(toggle().checked).toBe(true);
    expect(screen.getByTestId('file-manager-item-reason')).toHaveTextContent(/every user/);
  });

  it('never calls setEnabled', async () => {
    const api = mount({ state: 'machine-wide', reason: 'Machine-wide.' });
    // Disabled while loading too, so wait for the answer itself.
    await screen.findByTestId('file-manager-item-reason');
    fireEvent.click(toggle());
    expect(api.setEnabled).not.toHaveBeenCalled();
  });
});

describe('where there is nothing to register (FR-036)', () => {
  it('is disabled and says why', async () => {
    mount({ state: 'unavailable', reason: 'This build is portable and registers nothing.' });
    await waitFor(() => expect(toggle()).toBeDisabled());
    expect(screen.getByTestId('file-manager-item-reason')).toHaveTextContent(/portable/);
  });
});

describe('changing it', () => {
  it('asks main to turn it off and shows what main answers with', async () => {
    const user = userEvent.setup({ delay: null });
    const api = mount({ state: 'on' });
    await waitFor(() => expect(toggle().checked).toBe(true));
    await user.click(toggle());
    await waitFor(() => expect(api.setEnabled).toHaveBeenCalledWith(false));
    await waitFor(() => expect(toggle().checked).toBe(false));
    expect(notices()).toHaveLength(0);
  });

  it('does not report a change main could not make: the toggle stays as it was and ONE notice says so', async () => {
    const user = userEvent.setup({ delay: null });
    const api = mount({ state: 'on' }, () => Promise.resolve({ state: 'on' } as FileManagerRegistration));
    await waitFor(() => expect(toggle().checked).toBe(true));
    await user.click(toggle());
    await waitFor(() => expect(api.setEnabled).toHaveBeenCalledWith(false));
    await waitFor(() => expect(notices()).toHaveLength(1));
    expect(toggle().checked).toBe(true);
  });

  it('treats a rejected call the same way', async () => {
    const user = userEvent.setup({ delay: null });
    mount({ state: 'off' }, () => Promise.reject(new Error('registry said no')));
    await waitFor(() => expect(toggle().checked).toBe(false));
    await user.click(toggle());
    await waitFor(() => expect(notices()).toHaveLength(1));
    expect(toggle().checked).toBe(false);
  });

  it('adopts a machine-wide answer to a change request: disabled with the reason', async () => {
    const user = userEvent.setup({ delay: null });
    mount({ state: 'on' }, () => Promise.resolve({ state: 'machine-wide', reason: 'Needs administrator rights.' } as FileManagerRegistration));
    await waitFor(() => expect(toggle().checked).toBe(true));
    await user.click(toggle());
    await waitFor(() => expect(toggle()).toBeDisabled());
    expect(screen.getByTestId('file-manager-item-reason')).toHaveTextContent(/administrator/);
  });
});
