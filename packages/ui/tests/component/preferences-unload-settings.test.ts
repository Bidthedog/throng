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
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const controlFor = (key: string): HTMLElement | null => screen.queryByTestId(`control-${key}`);

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

/*
 * The five read-only cases that lived here (no unloadProject row/control, no Confirmations row for
 * it, the select's label/options/group, the keepRunning default, the description wording) were
 * deleted in the audit: they re-read registry data, which is proved without a DOM by
 * `packages/core/tests/unit/settings-metadata.test.ts` ("the Unload settings in the registry after
 * FR-111") and `app-settings-unload.test.ts` ("defaults to keepRunning"). What only a mount can show
 * is that the control WRITES, which is the one case kept.
 */
describe('projects.unloadTerminalAction in the editor (FR-034a, FR-081)', () => {
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
