/**
 * Preferences → Attention, and Terminal → Attention (057 US4 — FR-061, FR-081, FR-082, FR-090).
 *
 * Layer: component — the REAL `SettingsTab` over the shipped registry. `settings-metadata.test.ts` proves
 * the descriptors exist; this proves the form DRAWS them: every setting with its description, in the two
 * places the contract puts them, and the per-signal switches drawn disabled (not hidden) while the master
 * switch is off.
 *
 * ANTI-VACUITY CONTROL: every absence/disabled assertion is preceded by a presence assertion on the same
 * row, so a form that drew nothing cannot pass them.
 */
import { act, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { SETTINGS_METADATA } from '@throng/core';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';
import { SettingsTab } from '../../src/renderer/preferences/settings-tab.js';

const ATTENTION_GROUP = SETTINGS_METADATA.filter((d) => d.group === 'Attention');
const TERMINAL_ATTENTION = SETTINGS_METADATA.filter((d) => d.group === 'Terminal' && d.subgroup === 'Attention');
const SIGNALS = TERMINAL_ATTENTION.filter((d) => d.key.startsWith('terminals.attention.signals.'));

async function mount(settings: unknown): Promise<void> {
  Reflect.set(window, 'throng', {
    config: {
      get: () => Promise.resolve({ settings }),
      onChange: () => () => {},
      writePatch: () => Promise.resolve({ ok: true }),
    },
  });
  render(
    createElement(ConfigProvider, null,
      createElement(NotificationProvider, null,
        createElement(ResetNoticeProvider, null, createElement(ConfirmProvider, null, createElement(SettingsTab, null))))),
  );
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

const row = (key: string): HTMLElement => screen.getByTestId(`setting-${key}`);
const control = (key: string): HTMLInputElement | HTMLSelectElement =>
  screen.getByTestId(`control-${key}`) as HTMLInputElement | HTMLSelectElement;

describe('the registry the form draws from', () => {
  it('has the settings this spec names (a guard against asserting an empty list)', () => {
    // 057 FR-108 / FR-111 (round 4): the notification choices moved to Notifications, one row per type;
    // Attention keeps the clear delay and the taskbar badge only.
    expect(ATTENTION_GROUP.map((d) => d.key).sort()).toEqual(['attention.clearDelayMs', 'attention.taskbarBadge']);
    expect(SIGNALS).toHaveLength(7);
    expect(TERMINAL_ATTENTION.map((d) => d.key)).toContain('terminals.attention.enabled');
    expect(TERMINAL_ATTENTION.map((d) => d.key)).toContain('terminals.attention.quietSeconds');
  });
});

describe('the Attention group', () => {
  it('lists every setting, each with its description', async () => {
    await mount({});
    const group = screen.getByTestId('settings-group-Attention');
    for (const d of ATTENTION_GROUP) {
      const el = within(group).getByTestId(`setting-${d.key}`);
      expect(el, d.key).toHaveTextContent(d.label);
      expect(el, d.key).toHaveTextContent(d.description);
    }
  });

  it('no longer carries the notification choices — they are Notifications’ now (FR-108)', async () => {
    await mount({});
    const group = screen.getByTestId('settings-group-Attention');
    expect(within(group).getByTestId('setting-attention.clearDelayMs')).toBeInTheDocument();
    expect(within(group).queryByTestId('control-attention.delivery.attention')).toBeNull();
    expect(within(group).queryByTestId('control-attention.toasts.attention.mode')).toBeNull();
    expect(screen.getByTestId('control-notifications.attention.mode')).toBeInTheDocument();
  });
});

describe('Terminal › Attention', () => {
  it('lists the master switch, every signal and the quiet time, each with its description', async () => {
    await mount({});
    const sub = screen.getByTestId('settings-subgroup-Terminal-Attention');
    for (const d of TERMINAL_ATTENTION) {
      const el = within(sub).getByTestId(`setting-${d.key}`);
      expect(el, d.key).toHaveTextContent(d.label);
      expect(el, d.key).toHaveTextContent(d.description);
    }
  });

  it('draws the per-signal switches DISABLED while the master switch is off — present, not hidden', async () => {
    await mount({ terminals: { attention: { enabled: false } } });
    expect(control('terminals.attention.enabled')).not.toBeDisabled();
    for (const d of SIGNALS) {
      expect(row(d.key), d.key).toBeInTheDocument();
      expect(control(d.key), d.key).toBeDisabled();
    }
    expect(control('terminals.attention.quietSeconds')).toBeDisabled();
  });

  it('enables them while the master switch is on', async () => {
    await mount({ terminals: { attention: { enabled: true } } });
    for (const d of SIGNALS) expect(control(d.key), d.key).not.toBeDisabled();
    expect(control('terminals.attention.quietSeconds')).not.toBeDisabled();
  });
});
