/**
 * 067 T135 (FR-130, refining FR-064b and FR-066) — the control that clears the terminal form history sits
 * in Preferences' Terminal section, after the two `terminals.formHistory.*` rows, not in a section of its
 * own; and the settings search still finds it.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';
import { SettingsTab } from '../../src/renderer/preferences/settings-tab.js';

const DEBOUNCE_MS = 150;

function mount(): void {
  Reflect.set(window, 'throng', {
    formHistory: { get: vi.fn(), record: vi.fn(), clearField: vi.fn(), clearFlavour: vi.fn(), clearAll: vi.fn() },
    terminal: { listFlavours: () => Promise.resolve([]) },
  });
  render(
    createElement(
      NotificationProvider,
      null,
      createElement(
        ResetNoticeProvider,
        null,
        createElement(ConfirmProvider, null, createElement(SettingsTab, { searchDebounceMs: DEBOUNCE_MS })),
      ),
    ),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'throng');
});

const FOLLOWS = Node.DOCUMENT_POSITION_FOLLOWING;

describe('the clear control lives in the Terminal section (FR-130)', () => {
  it('is inside the Terminal group, after both form-history rows, and there is no section of its own', () => {
    mount();
    const terminal = screen.getByTestId('settings-group-Terminal');
    const control = within(terminal).getByTestId('setting-form-history-clear');
    const enabled = within(terminal).getByTestId('setting-terminals.formHistory.enabled');
    const max = within(terminal).getByTestId('setting-terminals.formHistory.maxEntries');
    expect(enabled.compareDocumentPosition(control) & FOLLOWS).toBeTruthy();
    expect(max.compareDocumentPosition(control) & FOLLOWS).toBeTruthy();
    // Directly after the second row: nothing else sits between the two.
    expect(max.nextElementSibling).toBe(control);
    expect(screen.queryByTestId('settings-group-form-history')).toBeNull();
  });

  it('is found by the search: a query for it keeps the Terminal group and the control', () => {
    mount();
    for (const q of ['clear remembered', 'history']) {
      fireEvent.change(screen.getByTestId('settings-search'), { target: { value: q } });
      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS + 1);
      });
      const terminal = screen.getByTestId('settings-group-Terminal');
      expect(within(terminal).getByTestId('setting-form-history-clear'), q).toBeTruthy();
    }
  });

  it('is not shown for a query that has nothing to do with it', () => {
    mount();
    fireEvent.change(screen.getByTestId('settings-search'), { target: { value: 'theme' } });
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS + 1);
    });
    expect(screen.queryByTestId('setting-form-history-clear')).toBeNull();
  });
});
