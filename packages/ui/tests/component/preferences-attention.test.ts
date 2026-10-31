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

// The registry-only guard ("has the settings this spec names": the Attention keys, 7 signals, master
// switch and quiet time) moved to `packages/core/tests/unit/settings-metadata.test.ts` (audit,
// component-2a): it never touched the DOM. The loops below still guard against an empty list by
// asserting each row is PRESENT before anything about it.

describe('Attention settings, as drawn (057 US4)', () => {
  it('draws the Attention group and Terminal › Attention with every setting and description, and the notification choices live elsewhere (FR-108)', async () => {
    await mount({});

    const group = screen.getByTestId('settings-group-Attention');
    for (const d of ATTENTION_GROUP) {
      const el = within(group).getByTestId(`setting-${d.key}`);
      expect(el, d.key).toHaveTextContent(d.label);
      expect(el, d.key).toHaveTextContent(d.description);
    }
    // No longer carries the notification choices — they are Notifications' now (FR-108).
    expect(within(group).queryByTestId('control-attention.delivery.attention')).toBeNull();
    expect(within(group).queryByTestId('control-attention.toasts.attention.mode')).toBeNull();
    expect(screen.getByTestId('control-notifications.attention.mode')).toBeInTheDocument();

    // The master switch, every signal and the quiet time, each with its description.
    const sub = screen.getByTestId('settings-subgroup-Terminal-Attention');
    for (const d of TERMINAL_ATTENTION) {
      const el = within(sub).getByTestId(`setting-${d.key}`);
      expect(el, d.key).toHaveTextContent(d.label);
      expect(el, d.key).toHaveTextContent(d.description);
    }
  });

  it.each([
    { enabled: false, label: 'DISABLED while the master switch is off — present, not hidden' },
    { enabled: true, label: 'enabled while the master switch is on' },
  ])('draws the per-signal switches and quiet time $label', async ({ enabled }) => {
    await mount({ terminals: { attention: { enabled } } });
    // Guard against an empty list: the registry holds the seven signals this spec names.
    expect(SIGNALS.length).toBeGreaterThan(0);
    if (!enabled) expect(control('terminals.attention.enabled')).not.toBeDisabled();
    for (const d of SIGNALS) {
      expect(row(d.key), d.key).toBeInTheDocument();
      if (enabled) expect(control(d.key), d.key).not.toBeDisabled();
      else expect(control(d.key), d.key).toBeDisabled();
    }
    if (enabled) expect(control('terminals.attention.quietSeconds')).not.toBeDisabled();
    else expect(control('terminals.attention.quietSeconds')).toBeDisabled();
  });
});
