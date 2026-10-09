/**
 * 053 FR-014 — the title template is edited on one line under its description, the full width of the row.
 *
 * Layer: component — the claim is where the control sits in the rendered row: under the description, in
 * the row's text column, rather than in the narrow column beside it. jsdom renders that structure; the
 * width itself is the stylesheet's, asserted by its class.
 */
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';
import { SettingsTab } from '../../src/renderer/preferences/settings-tab.js';

const WIDE = 'terminals.titleTemplate';
const NARROW = 'terminals.titleCommandMaxLength';

function mount(): void {
  render(
    createElement(
      NotificationProvider,
      null,
      createElement(ResetNoticeProvider, null, createElement(ConfirmProvider, null, createElement(SettingsTab, {}))),
    ),
  );
}

describe('a wide setting’s control sits under its description (053 FR-014)', () => {
  it('the title template: a single-line field after the description, spanning the row', () => {
    mount();
    const row = screen.getByTestId(`setting-${WIDE}`);
    const input = screen.getByTestId(`control-${WIDE}`);
    const description = row.querySelector('.settings-row__desc')!;

    expect(input.tagName, 'one line: an input, not a textarea').toBe('INPUT');
    expect(description.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.querySelector('.settings-row__meta')).toContainElement(input);
    expect(input.closest('.settings-row__control--wide')).not.toBeNull();
  });

  it('control: an ordinary setting keeps its control beside the text', () => {
    mount();
    const row = screen.getByTestId(`setting-${NARROW}`);
    const control = screen.getByTestId(`control-${NARROW}`);

    expect(row.querySelector('.settings-row__meta')).not.toContainElement(control);
    expect(control.closest('.settings-row__control--wide')).toBeNull();
  });
});
