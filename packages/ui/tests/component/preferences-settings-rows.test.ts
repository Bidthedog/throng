/**
 * Descriptors that share a `row` render as ONE row (057 FR-108, T101): the row's label once, each leaf's
 * control inline on one line, one Reset / Revert / Clear set acting on every leaf. A descriptor with no
 * `row` renders exactly as it always did.
 *
 * Layer: component — a rendered form. SYNTHETIC rows: real descriptors borrowed from the registry (so
 * their values, `enabledWhen` and `confirmWhen` are real) given a `row`, so this proves the renderer and
 * not any particular group. The real Notifications group is asserted separately.
 *
 * ANTI-VACUITY CONTROL: ignore `row` in the tab and the "one row" test fails; render a reset per leaf and
 * the "one set of actions" test fails; drop the leaves' own `control-<key>` ids and every lookup fails.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_METADATA, type FieldDescriptor } from '@throng/core';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';
import { SettingsMetadataContext, SettingsTab } from '../../src/renderer/preferences/settings-tab.js';

const MODE = 'search.inFiles.summaryNoticeMode';
const TIMEOUT = 'search.inFiles.summaryNoticeTimeoutMs';
const FLAG = 'terminals.advertiseHyperlinks';
const ROW = { id: 'synthetic', label: 'Synthetic row' };

const base = (key: string): FieldDescriptor => {
  const d = SETTINGS_METADATA.find((x) => x.key === key);
  if (d === undefined) throw new Error(`no descriptor ${key}`);
  return d;
};
/** `row` is the T100 contract; typed locally so this file does not depend on core having landed it. */
type Rowed = FieldDescriptor & { row?: { id: string; label: string } };
/** Everything in one group and no subgroup, so consecutive descriptors really are consecutive. */
const together = (d: FieldDescriptor): FieldDescriptor => ({ ...d, group: 'Synthetic', subgroup: undefined, subsection: undefined });
const rowed = (key: string): Rowed => ({ ...together(base(key)), row: ROW }) as Rowed;
const plain = (key: string): FieldDescriptor => together(base(key));

let settingsPayload: Record<string, unknown> = { version: 1 };
const resetSetting = vi.fn(() => Promise.resolve({ ok: true }));

beforeEach(() => {
  resetSetting.mockClear();
  Reflect.set(window, 'throng', {
    notices: { log: () => {} },
    config: {
      get: () => Promise.resolve({ settings: settingsPayload }),
      writePatch: () => Promise.resolve({ ok: true }),
      resetSetting,
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

async function mount(descriptors: readonly FieldDescriptor[], settings: Record<string, unknown>): Promise<void> {
  loaded = false;
  settingsPayload = { version: 1, ...settings };
  render(
    createElement(SettingsMetadataContext.Provider, { value: descriptors },
      createElement(ConfigProvider, null,
        createElement(NotificationProvider, null,
          createElement(ResetNoticeProvider, null,
            createElement(ConfirmProvider, null,
              createElement(LoadProbe, { key: 'probe' }),
              createElement(SettingsTab, { searchDebounceMs: 150, key: 'tab' })))))),
  );
  await waitFor(() => expect(loaded).toBe(true));
}

const TIMED = { search: { inFiles: { summaryNoticeMode: 'timed', summaryNoticeTimeoutMs: 5000 } } };
const DISMISS = { search: { inFiles: { summaryNoticeMode: 'dismiss', summaryNoticeTimeoutMs: 5000 } }, terminals: { advertiseHyperlinks: false } };

describe('descriptors sharing a row (FR-108)', () => {
  it('render as ONE row: the label once, every leaf’s control inside it', async () => {
    await mount([rowed(MODE), rowed(TIMEOUT), rowed(FLAG)], TIMED);
    const row = screen.getByTestId('setting-row-synthetic');
    expect(within(row).getAllByText('Synthetic row')).toHaveLength(1);
    for (const key of [MODE, TIMEOUT, FLAG]) {
      expect(within(row).getByTestId(`control-${key}`), key).toBeInTheDocument();
    }
    // One row on the page, not three.
    expect(document.querySelectorAll('.settings-row')).toHaveLength(1);
    // The leaves share one line: an inline container the stylesheet lays out and wraps.
    expect(row.querySelector('.settings-row__control--inline')).not.toBeNull();
  });

  it('keeps the leaves in the order they were declared', async () => {
    await mount([rowed(FLAG), rowed(MODE), rowed(TIMEOUT)], TIMED);
    const ids = [...screen.getByTestId('setting-row-synthetic').querySelectorAll('[data-testid^="control-"]')]
      .map((el) => el.getAttribute('data-testid'))
      .filter((id) => id === `control-${FLAG}` || id === `control-${MODE}` || id === `control-${TIMEOUT}`);
    expect(ids).toEqual([`control-${FLAG}`, `control-${MODE}`, `control-${TIMEOUT}`]);
  });

  it('offers ONE set of actions for the row, and none per leaf', async () => {
    await mount([rowed(MODE), rowed(TIMEOUT), rowed(FLAG)], DISMISS);
    expect(screen.getAllByTestId(/^setting-reset-/)).toHaveLength(1);
    expect(screen.getByTestId('setting-reset-synthetic')).toBeInTheDocument();
    expect(screen.getByTestId('setting-revert-synthetic')).toBeInTheDocument();
    expect(screen.queryByTestId(`setting-reset-${MODE}`)).toBeNull();
  });

  it('Reset acts on EVERY leaf of the row, and is idle only when none is overridden', async () => {
    await mount([rowed(MODE), rowed(TIMEOUT), rowed(FLAG)], DISMISS);
    const reset = screen.getByTestId('setting-reset-synthetic');
    expect(reset).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(reset);
    });
    expect(resetSetting.mock.calls.map((c) => (c as unknown as string[])[0]).sort()).toEqual([FLAG, MODE, TIMEOUT].sort());
  });

  it('leaves a descriptor with no `row` exactly as it was: its own row and its own actions', async () => {
    await mount([rowed(MODE), rowed(TIMEOUT), plain(FLAG)], TIMED);
    expect(screen.getByTestId(`setting-${FLAG}`)).toBeInTheDocument();
    expect(screen.getByTestId(`setting-reset-${FLAG}`)).toBeInTheDocument();
    expect(document.querySelectorAll('.settings-row')).toHaveLength(2);
  });

  it('keeps a leaf’s inertness: the duration is inert unless the mode leaf is Display for', async () => {
    await mount([rowed(MODE), rowed(TIMEOUT)], DISMISS);
    expect((screen.getByTestId(`control-${TIMEOUT}`) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId(`control-${MODE}`) as HTMLSelectElement).disabled).toBe(false);
  });

  it('leaves the duration live under Display for', async () => {
    await mount([rowed(MODE), rowed(TIMEOUT)], TIMED);
    expect((screen.getByTestId(`control-${TIMEOUT}`) as HTMLInputElement).disabled).toBe(false);
  });

  it('still asks for consent before the mode leaf silences a failure (030 FR-008)', async () => {
    await mount([rowed(MODE), rowed(TIMEOUT)], TIMED);
    fireEvent.change(screen.getByTestId(`control-${MODE}`), { target: { value: 'never' } });
    expect(screen.queryByTestId('confirm-dialog')).not.toBeNull();
  });
});

/*
 * 057 round 5 — the real Notifications group: while "Operating system notifications" is off, every row's
 * OS Notify switch greys out and keeps the value it holds.
 */
describe('OS Notify waits on the global switch', () => {
  const notifications = SETTINGS_METADATA.filter((d) => d.group === 'Notifications');
  const osLeaf = (type: string): HTMLInputElement =>
    screen.getByTestId(`control-notifications.${type}.os`) as HTMLInputElement;

  it('greys out every OS Notify, keeping its value, while the global switch is off', async () => {
    await mount(notifications, { notifications: { os: false, error: { os: true } } });
    for (const type of ['error', 'warning', 'info', 'success', 'attention']) {
      expect(osLeaf(type), type).toBeDisabled();
      expect(screen.getByTestId(`setting-notifications.${type}.os`).getAttribute('data-inert'), type).toBe('true');
    }
    expect(osLeaf('error')).toBeChecked();
    expect(osLeaf('attention')).toBeChecked();
    expect(osLeaf('info')).not.toBeChecked();
  });

  it('leaves them live while it is on', async () => {
    await mount(notifications, { notifications: { os: true } });
    for (const type of ['error', 'warning', 'info', 'success', 'attention']) {
      expect(osLeaf(type), type).toBeEnabled();
      expect(screen.getByTestId(`setting-notifications.${type}.os`).getAttribute('data-inert'), type).toBe('false');
    }
  });
});
