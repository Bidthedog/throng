/**
 * 067 T086 (FR-064b, FR-066, FR-108) — clearing the remembered terminal-form values from Preferences.
 *
 * Two controls: clear one terminal type's values (touching no other), and clear every type's at once.
 * Both work whether the history is on or off, so a user who turned it off can still wipe what is stored.
 * Clearing is destructive but small and reversible by typing again, so it acts at once and says what it
 * did rather than asking first. Every control is named and reachable by keyboard.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { FormHistoryControl } from '../../src/renderer/preferences/form-history-control.js';

const FLAVOURS = [
  { id: 'cmd', label: 'Command Prompt', file: 'cmd.exe', args: [], source: 'builtin', defaultShellArguments: '/K', reportsDirectory: true },
  { id: 'pwsh', label: 'PowerShell', file: 'pwsh.exe', args: [], source: 'builtin', defaultShellArguments: '-NoLogo', reportsDirectory: true },
];

function mount(enabled = true) {
  const api = { get: vi.fn(), record: vi.fn(), clearField: vi.fn(), clearFlavour: vi.fn(), clearAll: vi.fn() };
  Reflect.set(window, 'throng', {
    formHistory: api,
    terminal: { listFlavours: () => Promise.resolve(FLAVOURS) },
    config: {
      get: () =>
        Promise.resolve({
          settings: {
            ...DEFAULT_APP_SETTINGS,
            terminals: { ...DEFAULT_APP_SETTINGS.terminals, formHistory: { enabled, maxEntries: 10 } },
          },
        }),
      onChange: () => () => {},
    },
  });
  render(createElement(NotificationProvider, null, createElement(ConfigProvider, null, createElement(FormHistoryControl))));
  return { api, user: userEvent.setup({ delay: null }) };
}

const picker = (): HTMLSelectElement => screen.getByTestId('form-history-flavour') as HTMLSelectElement;
const notices = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('[data-testid="notices"] .notice'),
];

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('clearing one terminal type (FR-066)', () => {
  it('offers every terminal type and clears only the chosen one', async () => {
    const { api, user } = mount();
    await waitFor(() => expect(picker().options.length).toBe(2));
    await user.selectOptions(picker(), 'pwsh');
    await user.click(screen.getByTestId('form-history-clear-flavour'));
    expect(api.clearFlavour).toHaveBeenCalledTimes(1);
    expect(api.clearFlavour).toHaveBeenCalledWith('pwsh');
    expect(api.clearAll).not.toHaveBeenCalled();
  });

  it('says what it cleared, once', async () => {
    const { user } = mount();
    await waitFor(() => expect(picker().options.length).toBe(2));
    await user.click(screen.getByTestId('form-history-clear-flavour'));
    await waitFor(() => expect(notices()).toHaveLength(1));
    expect(notices()[0]!.textContent).toMatch(/Command Prompt/);
  });
});

describe('clearing everything (FR-064b)', () => {
  it('clears every terminal type at once', async () => {
    const { api, user } = mount();
    await user.click(await screen.findByTestId('form-history-clear-all'));
    expect(api.clearAll).toHaveBeenCalledTimes(1);
    expect(api.clearFlavour).not.toHaveBeenCalled();
  });
});

describe('whether the history is on or off', () => {
  it('both controls work with the history off', async () => {
    const { api, user } = mount(false);
    await new Promise((r) => setTimeout(r, 50));
    await waitFor(() => expect(picker().options.length).toBe(2));
    expect(screen.getByTestId('form-history-clear-all')).toBeEnabled();
    expect(screen.getByTestId('form-history-clear-flavour')).toBeEnabled();
    await user.click(screen.getByTestId('form-history-clear-all'));
    await user.click(screen.getByTestId('form-history-clear-flavour'));
    expect(api.clearAll).toHaveBeenCalledTimes(1);
    expect(api.clearFlavour).toHaveBeenCalledTimes(1);
  });
});

describe('accessibility (FR-108)', () => {
  it('names every control and reaches each by keyboard', async () => {
    const { api, user } = mount();
    await waitFor(() => expect(picker().options.length).toBe(2));
    expect(picker()).toHaveAccessibleName(/terminal type/i);
    expect(screen.getByTestId('form-history-clear-flavour')).toHaveAccessibleName(/clear.*(this|selected|terminal type)/i);
    expect(screen.getByTestId('form-history-clear-all')).toHaveAccessibleName(/clear.*all/i);
    await user.tab();
    expect(document.activeElement).toBe(picker());
    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId('form-history-clear-flavour'));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId('form-history-clear-all'));
    await user.keyboard('{Enter}');
    expect(api.clearAll).toHaveBeenCalledTimes(1);
  });
});
