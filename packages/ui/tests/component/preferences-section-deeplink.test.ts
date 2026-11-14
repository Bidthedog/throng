/**
 * 068 US3 T046/T047 (contracts/ipc.md "Preferences deep link") — the Settings tab, given a section to
 * open, scrolls to that group and unfolds it. The limit warning's link opens Preferences "at
 * Notifications", and sections start folded (056 FR-016), so a link that only scrolled would land the
 * user on a closed heading.
 *
 * Layer: component — a rendered tab, its fold state and the scroll call; jsdom shows all of it. That
 * main carries the section from the opener to this window is `preferences-window-query.test.ts`'s.
 *
 * ANTI-VACUITY: the same tab without a section is asserted folded and unscrolled, so a tab that always
 * unfolded, or always scrolled, fails.
 */
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_METADATA, type FieldDescriptor } from '@throng/core';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';
import { SettingsMetadataContext, SettingsTab } from '../../src/renderer/preferences/settings-tab.js';

const REGISTRY: readonly FieldDescriptor[] = [
  ...SETTINGS_METADATA.filter((d) => d.group === 'Notifications'),
  ...SETTINGS_METADATA.filter((d) => d.group === 'Terminal').slice(0, 2),
];

const scrollIntoView = vi.fn();
let originalScroll: typeof Element.prototype.scrollIntoView | undefined;

beforeEach(() => {
  localStorage.clear();
  scrollIntoView.mockReset();
  originalScroll = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function scroll(this: Element, ...args: unknown[]): void {
    scrollIntoView(this, ...args);
  };
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScroll as typeof Element.prototype.scrollIntoView;
});

const tab = (focusSection?: { name: string; nonce: number }) =>
  createElement(
    NotificationProvider,
    null,
    createElement(
      ResetNoticeProvider,
      null,
      createElement(
        ConfirmProvider,
        null,
        createElement(
          SettingsMetadataContext.Provider,
          { value: REGISTRY },
          createElement(SettingsTab, { searchDebounceMs: 0, ...(focusSection ? { focusSection } : {}) }),
        ),
      ),
    ),
  );

const NOTIFICATIONS = 'settings-group-Notifications';
const expanded = (id: string): boolean => screen.getByTestId(`${id}-toggle`).getAttribute('aria-expanded') === 'true';

describe('a section handed to the Settings tab (FR-031f link)', () => {
  it('starts with the section folded and nothing scrolled when no section is named', () => {
    render(tab());
    expect(expanded(NOTIFICATIONS)).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('unfolds the named section and scrolls to it', () => {
    render(tab({ name: 'Notifications', nonce: 1 }));
    expect(expanded(NOTIFICATIONS)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.calls[0]![0]).toBe(screen.getByTestId(NOTIFICATIONS));
  });

  it('leaves the other sections as they were', () => {
    render(tab({ name: 'Notifications', nonce: 1 }));
    expect(expanded('settings-group-Terminal')).toBe(false);
  });

  it('scrolls again for a new request even though the section is already open, and does not fold it', () => {
    const view = render(tab({ name: 'Notifications', nonce: 1 }));
    view.rerender(tab({ name: 'Notifications', nonce: 2 }));
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(expanded(NOTIFICATIONS)).toBe(true);
  });

  it('does nothing for a re-render with the same request', () => {
    const view = render(tab({ name: 'Notifications', nonce: 1 }));
    view.rerender(tab({ name: 'Notifications', nonce: 1 }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('ignores a name that is no section, without throwing', () => {
    expect(() => render(tab({ name: 'No Such Section', nonce: 1 }))).not.toThrow();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(expanded(NOTIFICATIONS)).toBe(false);
  });
});
