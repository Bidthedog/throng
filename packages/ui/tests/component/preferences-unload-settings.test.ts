/**
 * 046 US4 — the Unload setting in Preferences after FR-111 (T125; originally T063).
 *
 * `confirmations.unloadProject` is withdrawn (FR-111): no project-menu Unload row prompts, so the
 * confirmation level that governed that prompt has nothing left to govern, and its control leaves the
 * Confirmations group. A control that changes nothing would mislead the user who sets it.
 * `projects.unloadTerminalAction` stays, unchanged in key, values, labels and default (FR-034a), and
 * its description no longer talks about a dialog.
 *
 * Mounting follows `preferences-settings-search.test.ts` exactly (same three providers):
 * `useAppSettings`/`useOnEntry` read a context with a real DEFAULT, so no config bridge is needed to
 * render the shipped document.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';
import { SettingsTab } from '../../src/renderer/preferences/settings-tab.js';

function mount(): void {
  render(
    createElement(
      NotificationProvider,
      null,
      createElement(
        ResetNoticeProvider,
        null,
        createElement(ConfirmProvider, null, createElement(SettingsTab, { searchDebounceMs: 150 })),
      ),
    ),
  );
}

const rowFor = (key: string): HTMLElement | null => screen.queryByTestId(`setting-${key}`);
const controlFor = (key: string): HTMLElement | null => screen.queryByTestId(`control-${key}`);

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('the withdrawn unload confirmation level has no control (FR-111)', () => {
  it('draws no confirmations.unloadProject row or control', () => {
    mount();

    expect(screen.getByTestId('settings-group-Confirmations')).toBeInTheDocument();
    expect(rowFor('confirmations.unloadProject'), 'the withdrawn setting still has a row').toBeNull();
    expect(controlFor('confirmations.unloadProject'), 'the withdrawn setting still has a control').toBeNull();
  });

  it('no Confirmations row is labelled for unloading with running terminals', () => {
    mount();

    const group = screen.getByTestId('settings-group-Confirmations');
    expect(within(group).queryByText('Unload a project with running terminals')).toBeNull();
  });
});

describe('projects.unloadTerminalAction is unchanged (FR-034a, FR-081)', () => {
  it('sits in the Confirmations group, offering Keep terminals running / End terminals', () => {
    mount();

    const group = screen.getByTestId('settings-group-Confirmations');
    const row = within(group).getByTestId('setting-projects.unloadTerminalAction');
    expect(within(row).getByText('Unload project: default terminal action')).toBeInTheDocument();

    const control = controlFor('projects.unloadTerminalAction') as HTMLSelectElement;
    const labels = [...control.querySelectorAll('option')].map((o) => o.textContent?.trim());
    expect(labels).toEqual(['Keep terminals running', 'End terminals']);
  });

  it('defaults to keepRunning, matching app-settings.ts', () => {
    mount();

    expect((controlFor('projects.unloadTerminalAction') as HTMLSelectElement).value).toBe('keepRunning');
  });

  it('its description mentions no dialog, and no idle shells being closed (FR-086, FR-111)', () => {
    mount();

    const row = rowFor('projects.unloadTerminalAction')!;
    expect(row.textContent ?? '').not.toMatch(/dialog/i);
    expect(row.textContent ?? '').not.toMatch(/clos\w*\s+idle/i);
  });

  it('changing it writes projects.unloadTerminalAction, and nothing else', async () => {
    const writes: unknown[] = [];
    Reflect.set(window, 'throng', {
      config: {
        writePatch: (_id: unknown, changes: unknown) => {
          writes.push(changes);
          return Promise.resolve({ ok: true });
        },
      },
    });
    mount();

    const control = controlFor('projects.unloadTerminalAction') as HTMLSelectElement;
    fireEvent.change(control, { target: { value: 'endTerminals' } });

    // The write goes through `writeConfigPatch`, which is itself async, so wait for it rather than
    // reading `writes` the instant `fireEvent.change` returns.
    await waitFor(() =>
      expect(writes).toEqual([[{ path: ['projects', 'unloadTerminalAction'], value: 'endTerminals' }]]),
    );
  });
});
