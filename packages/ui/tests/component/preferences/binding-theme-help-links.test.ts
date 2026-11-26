/**
 * 080 FR-028 — every command row on the Key Bindings tab and every token row on the Themes tab carries one
 * (?) beside its label, opening that command's or token's entry in the reference in the OS browser.
 *
 * Layer: component — the REAL tabs over the shipped registries; what each row renders and what its (?) opens.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELP_APP_BASE_URL, THEME_METADATA, keyBindingHelpUrl, themeTokenHelpUrl } from '@throng/core';
import { NotificationProvider } from '../../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../../src/renderer/confirm-dialog.js';
import { ContextMenuProvider } from '../../../src/renderer/context-menu-provider.js';
import { KeybindingsTab } from '../../../src/renderer/preferences/keybindings-tab.js';
import { ResetNoticeProvider } from '../../../src/renderer/preferences/reset-notice.js';
import { ThemesTab } from '../../../src/renderer/preferences/themes-tab.js';

const openHelp = vi.fn();

beforeEach(() => {
  openHelp.mockClear();
  Reflect.set(window, 'throng', { openHelp });
  // Sections fold by default (056 FR-016); open them so every row is drawn.
  window.history.replaceState(null, '', '/?foldDefault=open');
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'throng');
});

describe('Key Bindings tab (?) (FR-028)', () => {
  const mount = (): void => {
    render(
      createElement(
        NotificationProvider,
        null,
        createElement(
          ResetNoticeProvider,
          null,
          createElement(ContextMenuProvider, null, createElement(KeybindingsTab)),
        ),
      ),
    );
  };

  it('draws one beside every command’s label, before its description', () => {
    mount();
    const rows = [...document.querySelectorAll('[data-testid^="binding-"].keybinding-row')];
    expect(rows.length, 'the tab drew no bindings — the test has gone vacuous').toBeGreaterThan(20);
    for (const row of rows) {
      const id = (row.getAttribute('data-testid') ?? '').slice('binding-'.length);
      const links = within(row as HTMLElement).getAllByTestId(`help-link-binding-${id}`);
      expect(links, `${id}: one (?)`).toHaveLength(1);
      const title = row.querySelector('.settings-row__title')!;
      expect(title, `${id}: label line`).toContainElement(links[0]);
      expect(links[0]).toHaveAttribute('title', expect.stringMatching(/^Help: .+/));
    }
  });

  it('opens that command’s entry in the key bindings reference', async () => {
    mount();
    await userEvent.setup({ delay: null }).click(screen.getByTestId('help-link-binding-editor.save'));
    expect(openHelp).toHaveBeenCalledExactlyOnceWith(keyBindingHelpUrl('editor.save', HELP_APP_BASE_URL));
  });
});

describe('Themes tab (?) (FR-028)', () => {
  const mount = (): void => {
    render(
      createElement(NotificationProvider, null, createElement(ConfirmProvider, null, createElement(ThemesTab))),
    );
  };

  it('draws one beside every token row’s label', () => {
    mount();
    const rows = [...document.querySelectorAll('[data-testid^="theme-row-"]')];
    expect(rows.length, 'the tab drew no token rows — the test has gone vacuous').toBeGreaterThan(20);
    for (const row of rows) {
      const key = (row.getAttribute('data-testid') ?? '').slice('theme-row-'.length);
      const links = within(row as HTMLElement).getAllByTestId(`help-link-theme-${key}`);
      expect(links, `${key}: one (?)`).toHaveLength(1);
      expect(row.querySelector('.settings-row__title')).toContainElement(links[0]);
    }
  });

  it('gives the icon colour row, drawn by the icon section, its (?) and its one-line description', async () => {
    mount();
    const row = await screen.findByTestId('icon-colour-row');
    const link = within(row).getByTestId('help-link-theme-colours.iconColour');
    expect(row.querySelector('.settings-row__title')).toContainElement(link);
    const d = THEME_METADATA.find((m) => m.key === 'colours.iconColour')!;
    expect(row.querySelector('.settings-row__desc')?.textContent).toBe(d.description);
    await userEvent.setup({ delay: null }).click(link);
    expect(openHelp).toHaveBeenCalledExactlyOnceWith(themeTokenHelpUrl('colours.iconColour', HELP_APP_BASE_URL));
  });

  it('opens that token’s entry in the theme settings reference', async () => {
    mount();
    const key = THEME_METADATA.find((d) => document.querySelector(`[data-testid="theme-row-${d.key}"]`) !== null)!.key;
    await userEvent.setup({ delay: null }).click(screen.getByTestId(`help-link-theme-${key}`));
    expect(openHelp).toHaveBeenCalledExactlyOnceWith(themeTokenHelpUrl(key, HELP_APP_BASE_URL));
  });
});
