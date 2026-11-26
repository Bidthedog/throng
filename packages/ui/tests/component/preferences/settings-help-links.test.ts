/**
 * 080 FR-014 — every setting row the Settings tab draws carries one (?) that opens THAT setting's section,
 * and a setting the tab does not draw (hidden on this platform) has none (spec edge case).
 *
 * Layer: component — the REAL Settings tab over the shipped registry; what each row renders and what its
 * (?) opens.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELP_APP_BASE_URL, SETTINGS_METADATA, hostTraits, settingHelpUrl, type FieldDescriptor } from '@throng/core';
import { NotificationProvider } from '../../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../../src/renderer/confirm-dialog.js';
import { ResetNoticeProvider } from '../../../src/renderer/preferences/reset-notice.js';
import { SettingsMetadataContext, SettingsTab } from '../../../src/renderer/preferences/settings-tab.js';

const openHelp = vi.fn();

beforeEach(() => {
  openHelp.mockClear();
  Reflect.set(window, 'throng', { openHelp });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'throng');
});

function mount(rows?: readonly FieldDescriptor[]): void {
  const tab = createElement(
    NotificationProvider,
    null,
    createElement(ResetNoticeProvider, null, createElement(ConfirmProvider, null, createElement(SettingsTab, {}))),
  );
  render(rows ? createElement(SettingsMetadataContext.Provider, { value: rows }, tab) : tab);
}

/** The keys of the settings the tab drew: a `setting-<key>` element for a registered descriptor. */
function drawnKeys(): string[] {
  const known = new Set(SETTINGS_METADATA.map((d) => d.key));
  return [...document.querySelectorAll('[data-testid^="setting-"]')]
    .map((el) => (el.getAttribute('data-testid') ?? '').slice('setting-'.length))
    .filter((key) => known.has(key));
}

describe('a (?) on every drawn setting row (FR-014)', () => {
  it('draws exactly one per drawn setting, each inside its own row and naming it', () => {
    mount();
    const keys = drawnKeys();
    expect(keys.length, 'the tab drew no settings — the test has gone vacuous').toBeGreaterThan(20);
    for (const key of keys) {
      const row = screen.getByTestId(`setting-${key}`);
      const links = within(row).getAllByTestId(`help-link-${key}`);
      expect(links, `${key}: one (?) in its row`).toHaveLength(1);
    }
    // No (?) for anything that is not a drawn setting: the counts match.
    expect(document.querySelectorAll('[data-testid^="help-link-"]')).toHaveLength(keys.length);
  });

  it('sits beside the setting’s title, before the description, and names the setting in its hover title (FR-027)', () => {
    const d = SETTINGS_METADATA.find((s) => s.key === 'terminals.titleTemplate')!;
    mount([d]);
    const row = screen.getByTestId(`setting-${d.key}`);
    const link = within(row).getByTestId(`help-link-${d.key}`);
    const title = row.querySelector('.settings-row__title')!;
    expect(title, 'the label line is one element holding the label and its (?)').not.toBeNull();
    expect(title).toContainElement(link);
    expect(title.querySelector('.settings-row__label')).toHaveTextContent(d.label);
    const label = title.querySelector('.settings-row__label')!;
    expect(label.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const desc = row.querySelector('.settings-row__desc')!;
    expect(title).not.toContainElement(desc);
    expect(desc.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(link).toHaveAttribute('title', `Help: ${d.label}`);
  });

  it('puts a grouped row’s toggle leaf (?) beside that leaf’s own label (FR-027)', () => {
    mount();
    const leaf = document.querySelector('.settings-row__leaf:has(.settings-row__leaf-label)');
    expect(leaf, 'no grouped toggle leaf drawn').not.toBeNull();
    const label = leaf!.querySelector('.settings-row__leaf-label')!;
    const link = leaf!.querySelector('[data-testid^="help-link-"]')!;
    expect(label.nextElementSibling).toBe(link);
  });

  it('opens that setting’s section when pressed', async () => {
    const d = SETTINGS_METADATA.find((s) => s.key === 'terminals.titleTemplate')!;
    mount([d]);
    await userEvent.setup({ delay: null }).click(screen.getByTestId(`help-link-${d.key}`));
    expect(openHelp).toHaveBeenCalledExactlyOnceWith(settingHelpUrl(d.key, HELP_APP_BASE_URL));
  });

  it('draws none for a setting the tab hides on this platform, because the setting is not drawn', () => {
    const elsewhere = hostTraits().os === 'windows' ? 'linux' : 'windows';
    const hidden: FieldDescriptor = { ...SETTINGS_METADATA.find((s) => s.key === 'terminals.titleTemplate')!, onlyOn: elsewhere };
    mount([hidden]);
    expect(screen.queryByTestId(`setting-${hidden.key}`)).toBeNull();
    expect(screen.queryByTestId(`help-link-${hidden.key}`)).toBeNull();
  });
});
