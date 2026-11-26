/**
 * 080 FR-014 (US3 AC4) — the (?) on a setting row: a themeable icon control with a hover title naming where
 * it goes, reachable from the keyboard, opening that setting's section of the preferences reference in the
 * OS browser.
 *
 * Layer: component — real focus, real key events and the window's own title tooltip host; the opener's only
 * door is `window.throng.openHelp`.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELP_APP_BASE_URL, keyBindingHelpUrl, settingHelpUrl } from '@throng/core';
import { HelpLink, helpUrlOrNone } from '../../../src/renderer/common/help-link.js';
import { TITLE_TOOLTIP_DELAY_MS, TitleTooltipHost, installTitleTooltips } from '../../../src/renderer/common/title-tooltips.js';
import { drawnIcon, iconMarkup } from '../helpers/icon-markup.js';
import { nativeTooltipAt } from '../native-tooltip.js';

const openHelp = vi.fn();
let uninstall: (() => void) | undefined;

beforeEach(() => {
  openHelp.mockClear();
  Reflect.set(window, 'throng', { openHelp });
});

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  vi.useRealTimers();
  cleanup();
  Reflect.deleteProperty(window, 'throng');
});

/** The caller builds the URL (a setting, a binding, a token or a task); the link only opens it. */
const URL = settingHelpUrl('terminals.titleTemplate', HELP_APP_BASE_URL);

const mount = (url: string = URL): HTMLElement => {
  render(createElement(HelpLink, { url, label: 'Title template', testId: 'help-link-terminals.titleTemplate' }));
  return screen.getByRole('button', { name: 'Help: Title template' });
};

describe('HelpLink (FR-014)', () => {
  it('is an icon button wearing the help icon, named for where it goes', () => {
    const button = mount();
    expect(button.tagName).toBe('BUTTON');
    expect(drawnIcon(button)).toBe(iconMarkup('help'));
    expect(button.textContent?.trim() ?? '').toBe('');
  });

  it('shows "Help: {label}" in the app’s popup style, and the OS draws nothing under the pointer', () => {
    vi.useFakeTimers();
    render(createElement(TitleTooltipHost));
    uninstall = installTitleTooltips();
    const button = mount();
    fireEvent.pointerOver(button, { clientX: 10, clientY: 10 });
    expect(nativeTooltipAt(button), 'the native title must be moved aside').toBe('');
    act(() => vi.advanceTimersByTime(TITLE_TOOLTIP_DELAY_MS));
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Help: Title template');
    expect(tip).toHaveClass('throng-popup');
  });

  it('is reached by Tab', async () => {
    const user = userEvent.setup({ delay: null });
    const button = mount();
    await user.tab();
    expect(button).toHaveFocus();
  });

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('opens the setting’s section in the OS browser on %s', async (_name, keys) => {
    const user = userEvent.setup({ delay: null });
    mount();
    await user.tab();
    await user.keyboard(keys);
    expect(openHelp).toHaveBeenCalledExactlyOnceWith(settingHelpUrl('terminals.titleTemplate', HELP_APP_BASE_URL));
  });

  it('opens exactly the URL it was given, whatever surface built it', async () => {
    const url = keyBindingHelpUrl('editor.save', 'http://localhost:4321/guide/');
    const user = userEvent.setup({ delay: null });
    await user.click(mount(url));
    expect(openHelp).toHaveBeenCalledExactlyOnceWith(url);
  });

  it('carries the test id the caller gave it', () => {
    expect(mount()).toHaveAttribute('data-testid', 'help-link-terminals.titleTemplate');
  });

  it('draws nothing for a target the help URLs do not know, rather than throwing', () => {
    const url = helpUrlOrNone(() => settingHelpUrl('synthetic.unknown', HELP_APP_BASE_URL));
    expect(url).toBeUndefined();
    const { container } = render(createElement(HelpLink, { url, label: 'Unknown', testId: 'help-link-unknown' }));
    expect(container).toBeEmptyDOMElement();
    expect(helpUrlOrNone(() => settingHelpUrl('terminals.titleTemplate', HELP_APP_BASE_URL))).toBe(settingHelpUrl('terminals.titleTemplate', HELP_APP_BASE_URL));
  });
});
