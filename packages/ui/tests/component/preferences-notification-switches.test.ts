/**
 * 068 FR-092 — each notification type's row is three checkboxes, Toast, Panel and OS Notify, in any
 * combination; for error and warning, clearing the LAST of Toast and Panel asks first (030 FR-008).
 *
 * Layer: component — what the form draws, and whether its two-keyed consent asks, are the Settings
 * tab's rendering and commit path; the declarations themselves are `settings-metadata.test.ts`'s.
 *
 * Replaces the mode-dropdown consent tests of `preferences-settings-search.test.ts`. The consent now
 * depends on the value beside the clicked box, so each test seeds a settings document through the
 * config store.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';
import { SettingsTab } from '../../src/renderer/preferences/settings-tab.js';

const DEBOUNCE_MS = 150;
const TYPES = ['error', 'warning', 'info', 'success', 'attention'] as const;

let settingsPayload: Record<string, unknown> = { version: 1 };
let writes: string[] = [];

beforeEach(() => {
  settingsPayload = { version: 1 };
  writes = [];
  Reflect.set(window, 'throng', {
    notices: { log: () => {} },
    config: {
      get: () => Promise.resolve({ settings: settingsPayload }),
      // writePatch, NOT write: `applyChange` goes through `writeConfigPatch`.
      writePatch: (_id: unknown, changes: unknown) => {
        writes.push(JSON.stringify(changes));
        return Promise.resolve({ ok: true });
      },
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

let loaded = false;

function LoadProbe(): ReactElement | null {
  loaded = useConfigLoaded();
  return null;
}

async function mount(notifications: Record<string, unknown> = {}): Promise<void> {
  loaded = false;
  settingsPayload = { version: 1, notifications };
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(
        NotificationProvider,
        null,
        createElement(
          ResetNoticeProvider,
          null,
          createElement(
            ConfirmProvider,
            null,
            createElement(LoadProbe, { key: 'probe' }),
            createElement(SettingsTab, { searchDebounceMs: DEBOUNCE_MS, key: 'tab' }),
          ),
        ),
      ),
    ),
  );
  await waitFor(() => {
    expect(loaded, 'the seeded settings never reached the config store').toBe(true);
  });
}

const box = (type: string, which: 'toast' | 'panel' | 'os'): HTMLInputElement =>
  screen.getByTestId(`control-notifications.${type}.${which}`) as HTMLInputElement;

describe('a type row is three checkboxes (FR-092)', () => {
  it('draws Toast, Panel and OS Notify for every type, in that order, ticked Toast and Panel, with no drop-down', async () => {
    await mount();
    const group = screen.getByTestId('settings-group-Notifications');
    for (const type of TYPES) {
      const row = within(group).getByTestId(`setting-row-notifications.${type}`);
      expect(row.querySelector('select'), type).toBeNull();
      const labels = [...row.querySelectorAll('.settings-row__leaf-label')].map((l) => l.textContent);
      expect(labels, type).toEqual(['Toast', 'Panel', 'OS Notify']);
      expect(box(type, 'toast').checked, type).toBe(true);
      expect(box(type, 'panel').checked, type).toBe(true);
    }
  });

  it('shows a saved mode as the switches it stands for', async () => {
    await mount({ info: { mode: 'toast' }, success: { mode: 'never' } });
    expect([box('info', 'toast').checked, box('info', 'panel').checked]).toEqual([true, false]);
    expect([box('success', 'toast').checked, box('success', 'panel').checked]).toEqual([false, false]);
  });

  it('writes a cleared Toast at once, asking nothing, while Panel is still ticked', async () => {
    await mount({ error: { toast: true, panel: true } });
    fireEvent.click(box('error', 'toast'));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    await waitFor(() => expect(writes.join('')).toMatch(/"path":\["notifications","error","toast"\],"value":false/));
  });

  it.each(['toast', 'panel'] as const)(
    'shows a cleared %s at once, before the write comes back, while the other switch is still ticked',
    async (which) => {
      // Only a click that will ASK is held back; one that writes straight away shows straight away.
      await mount({ error: { toast: true, panel: true } });
      fireEvent.click(box('error', which));
      expect(box('error', which).checked, 'the box waited for the stored value').toBe(false);
    },
  );
});

describe('clearing the last of Toast and Panel is confirmed for failures (030 FR-008, FR-092)', () => {
  it.each([
    ['error', 'toast', { toast: true, panel: false }],
    ['warning', 'panel', { toast: false, panel: true }],
  ] as const)('asks before %s %s is cleared while the other is clear, naming the consequence', async (type, which, row) => {
    await mount({ [type]: row });
    fireEvent.click(box(type, which));
    const dialog = screen.getByTestId('confirm-dialog');
    expect(dialog.textContent ?? '').toMatch(new RegExp(`Never display ${type} notices\\?`, 'i'));
    const message = within(dialog).getByTestId('confirm-message');
    expect(message.textContent ?? '').toMatch(/report nothing/i);
    expect(message.textContent ?? '').toMatch(/diagnostic log/i);
    expect(writes).toEqual([]);
  });

  it('leaves the box ticked and writes NOTHING when declined, and writes it once accepted', async () => {
    await mount({ error: { toast: false, panel: true } });
    fireEvent.click(box('error', 'panel'));
    fireEvent.click(screen.getByTestId('confirm-cancel'));
    await act(async () => {});
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    expect(writes, 'a declined confirmation wrote to the settings document').toEqual([]);
    expect(box('error', 'panel').checked).toBe(true);

    fireEvent.click(box('error', 'panel'));
    fireEvent.click(screen.getByTestId('confirm-accept'));
    await waitFor(() => expect(writes.join('')).toMatch(/"path":\["notifications","error","panel"\],"value":false/));
  });
});
