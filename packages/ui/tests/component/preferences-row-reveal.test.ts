/**
 * 080 FR-064 — the one Preferences reveal, on the Key Bindings and Themes tabs: handed a key, a tab unfolds the
 * row's group (and subgroup and subsection, where it has them) and scrolls that row into view, as the Settings
 * tab has done since 068 (`preferences-section-deeplink.test.ts`).
 *
 * Layer: component — the real tabs over the shipped registries, their fold state and the scroll call.
 *
 * ANTI-VACUITY: each tab is first mounted with no target and asserted folded and unscrolled.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYBINDINGS_METADATA, THEME_METADATA } from '@throng/core';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { KeybindingsTab } from '../../src/renderer/preferences/keybindings-tab.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';
import { ThemesTab } from '../../src/renderer/preferences/themes-tab.js';

const scrollIntoView = vi.fn();
let originalScroll: typeof Element.prototype.scrollIntoView | undefined;

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  scrollIntoView.mockReset();
  originalScroll = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function scroll(this: Element, ...args: unknown[]): void {
    scrollIntoView(this, ...args);
  };
});
afterEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = originalScroll as typeof Element.prototype.scrollIntoView;
});

const wrap = (child: ReactElement): ReactElement =>
  createElement(
    NotificationProvider,
    null,
    createElement(ResetNoticeProvider, null, createElement(ConfirmProvider, null, createElement(ContextMenuProvider, null, child))),
  );

const expanded = (id: string): boolean => screen.getByTestId(`${id}-toggle`).getAttribute('aria-expanded') === 'true';

const scrolledTo = (): Element | undefined => scrollIntoView.mock.calls.at(-1)?.[0] as Element | undefined;

describe('the Key Bindings tab reveals a binding by action id (FR-064)', () => {
  const target = KEYBINDINGS_METADATA.find((d) => d.key === 'navigate.gotoLine')!;

  it('starts folded and unscrolled with no target', () => {
    render(wrap(createElement(KeybindingsTab, { searchDebounceMs: 0 })));
    expect(expanded(`keybindings-group-${target.group}`)).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('unfolds its group and scrolls its row into view', () => {
    render(wrap(createElement(KeybindingsTab, { searchDebounceMs: 0, focusSection: { name: target.key, nonce: 1 } })));
    expect(expanded(`keybindings-group-${target.group}`)).toBe(true);
    expect(scrolledTo()).toBe(screen.getByTestId(`binding-${target.key}`));
  });
});

describe('the Themes tab reveals a theme setting by key (FR-064)', () => {
  // A token nested a level down, so the reveal has a subgroup to unfold as well as a group.
  const target = THEME_METADATA.find((d) => d.subgroup !== undefined)!;

  it('starts folded and unscrolled with no target', () => {
    render(wrap(createElement(ThemesTab)));
    expect(expanded(`settings-group-${target.group}`)).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('unfolds its group and subgroup and scrolls its row into view', () => {
    render(wrap(createElement(ThemesTab, { focusSection: { name: target.key, nonce: 1 } })));
    expect(expanded(`settings-group-${target.group}`)).toBe(true);
    expect(scrolledTo()).toBe(screen.getByTestId(`theme-row-${target.key}`));
  });
});
