/**
 * 077 FR-003 — "MB" means 1,048,576 bytes, and Preferences says so beside every size setting: the size rows'
 * description carries the sentence, and no other row does.
 *
 * Layer: component — the claim is what a rendered row reads; jsdom renders the row from the registry.
 */
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';
import { SETTINGS_METADATA } from '@throng/core';
import { SettingsMetadataContext, SettingsTab } from '../../src/renderer/preferences/settings-tab.js';

const SIZES = ['editor.maxOpenFileBytes', 'diagnostics.maxFileBytes', 'diagnostics.maxTotalBytes'];
const NOT_A_SIZE = 'editor.autoSaveDebounceMs';
const ROWS = SETTINGS_METADATA.filter((d) => SIZES.includes(d.key) || d.key === NOT_A_SIZE);

function mount(): void {
  render(
    createElement(
      SettingsMetadataContext.Provider,
      { value: ROWS },
      createElement(
        NotificationProvider,
        null,
        createElement(ResetNoticeProvider, null, createElement(ConfirmProvider, null, createElement(SettingsTab, {}))),
      ),
    ),
  );
}

const description = (key: string): string =>
  screen.getByTestId(`setting-${key}`).querySelector('.settings-row__desc')?.textContent ?? '';

describe('Preferences says what MB means beside every size setting (077 FR-003)', () => {
  it('each size row’s description says 1 MB is 1,048,576 bytes; a duration row does not', () => {
    mount();
    for (const key of SIZES) expect(description(key), key).toContain('1 MB is 1,048,576 bytes');
    expect(description(NOT_A_SIZE)).not.toContain('1,048,576');
  });
});
