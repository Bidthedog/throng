/**
 * #67 — the terminal flavour settings are edited in Preferences: custom flavours as an ordered table of records,
 * the per-flavour shell arguments as a keyed table, and the hidden built-ins as a picker over every built-in this
 * machine has, the hidden ones included, so hiding one can be undone.
 *
 * Layer: component — whether the Settings tab draws a control for each, and what each control writes, are visible in
 * jsdom with the detected built-ins stubbed at the preload seam. Launching a flavour is the terminal suite's, not this.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_METADATA, type FieldDescriptor } from '@throng/core';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';
import { SettingsTab } from '../../src/renderer/preferences/settings-tab.js';
import { SettingControl } from '../../src/renderer/preferences/form-controls.js';

const FLAVOURS = 'terminals.flavours';
const HIDDEN = 'terminals.disabledBuiltins';
const ARGS = 'terminals.defaultShellArguments';

const DETECTED = [
  { id: 'cmd', label: 'Command Prompt' },
  { id: 'pwsh', label: 'PowerShell 7' },
  { id: 'git-bash', label: 'Git Bash' },
];

const descriptor = (key: string): FieldDescriptor => {
  const d = SETTINGS_METADATA.find((x) => x.key === key);
  if (!d) throw new Error(`the Settings tab has no descriptor for ${key}`);
  return d;
};

/** One setting's control, holding its value as the window does, under the Preferences toast. */
function mountControl(key: string, initial: unknown, extra: Record<string, unknown> = {}) {
  const onCommit = vi.fn();
  function Host() {
    const [value, setValue] = useState<unknown>(initial);
    return createElement(SettingControl, {
      descriptor: descriptor(key),
      value,
      ...extra,
      onCommit: (v: unknown) => {
        onCommit(v);
        setValue(v);
      },
    });
  }
  render(createElement(NotificationProvider, null, createElement(Host)));
  return { onCommit, user: userEvent.setup({ delay: null }) };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/?foldDefault=open');
  (window as unknown as { throng: unknown }).throng = {
    terminal: { listDetectedFlavours: () => Promise.resolve(DETECTED) },
  };
});

afterEach(() => {
  delete (window as unknown as { throng?: unknown }).throng;
  document.body.replaceChildren();
});

describe('the Settings tab draws the flavour settings (#67)', () => {
  it('has a row for custom flavours, their shell arguments and the hidden built-ins', () => {
    render(
      createElement(
        NotificationProvider,
        null,
        createElement(ResetNoticeProvider, null, createElement(ConfirmProvider, null, createElement(SettingsTab, {}))),
      ),
    );
    for (const key of [FLAVOURS, ARGS, HIDDEN]) expect(screen.queryByTestId(`setting-${key}`), key).not.toBeNull();
  });

  it('offers every built-in this machine has in the hidden-built-ins picker, by name', async () => {
    render(
      createElement(
        NotificationProvider,
        null,
        createElement(ResetNoticeProvider, null, createElement(ConfirmProvider, null, createElement(SettingsTab, {}))),
      ),
    );
    const picker = await screen.findByTestId(`control-${HIDDEN}`);
    await waitFor(() => expect(within(picker).getAllByRole('checkbox')).toHaveLength(3));
    expect(picker.textContent).toContain('Git Bash');
  });
});

describe('custom flavours: an ordered table of records (#67)', () => {
  const nu = { id: 'nu', label: 'Nushell', file: 'nu', args: [], defaultShellArguments: '' };
  const fish = { id: 'fish', label: 'Fish', file: '/usr/bin/fish', args: ['-l'], defaultShellArguments: '' };

  it('adds a flavour in the modal and writes the list — an array, in order, the new one last — on Save', async () => {
    const { user, onCommit } = mountControl(FLAVOURS, [nu]);
    await user.click(screen.getByTestId(`list-edit-${FLAVOURS}`));
    await user.type(screen.getByTestId(`flavour-new-id`), 'elvish');
    await user.click(screen.getByTestId(`flavour-add`));
    await user.type(screen.getByTestId(`flavour-cell-elvish-file`), 'elvish');
    await user.click(screen.getByTestId(`list-editor-save-${FLAVOURS}`));

    expect(onCommit).toHaveBeenCalledTimes(1);
    const written = onCommit.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(Array.isArray(written)).toBe(true);
    expect(written.map((f) => f.id)).toEqual(['nu', 'elvish']);
    expect(written[1]).toMatchObject({ id: 'elvish', file: 'elvish' });
  });

  it('keeps the file’s order when a row in the middle is edited', async () => {
    const { user, onCommit } = mountControl(FLAVOURS, [fish, nu]);
    await user.click(screen.getByTestId(`list-edit-${FLAVOURS}`));
    const label = screen.getByTestId(`flavour-cell-fish-label`);
    await user.clear(label);
    await user.type(label, 'Friendly shell');
    await user.click(screen.getByTestId(`list-editor-save-${FLAVOURS}`));
    const written = onCommit.mock.calls.at(-1)![0] as Array<Record<string, unknown>>;
    expect(written.map((f) => f.id)).toEqual(['fish', 'nu']);
    expect(written[0]).toMatchObject({ label: 'Friendly shell', args: ['-l'] });
  });

  it('refuses a flavour with no id, or an id already used, and writes nothing', async () => {
    const { user, onCommit } = mountControl(FLAVOURS, [nu]);
    await user.click(screen.getByTestId(`list-edit-${FLAVOURS}`));
    await user.click(screen.getByTestId(`flavour-add`));
    await user.type(screen.getByTestId(`flavour-new-id`), 'nu');
    await user.click(screen.getByTestId(`flavour-add`));
    expect(screen.getAllByTestId('flavour-row-nu')).toHaveLength(1);
    await user.click(screen.getByTestId(`list-editor-save-${FLAVOURS}`));
    expect(onCommit).not.toHaveBeenCalled();
  });

  // 077 FR-024 — one condition, one notice: a draft row's problem is an entry's, said in the toast alone. Only a row
  // that arrived broken from the file keeps its own inline message (C17), because it reports the file.
  it('says a draft row’s problem in the toast alone, and a row broken in the file in its own row', async () => {
    const { user } = mountControl(FLAVOURS, [nu, { id: 'broken' }]);
    await user.click(screen.getByTestId(`list-edit-${FLAVOURS}`));
    await user.type(screen.getByTestId(`flavour-new-id`), 'elvish');
    await user.click(screen.getByTestId(`flavour-add`));

    expect(screen.getByTestId('flavour-row-elvish')).toBeInTheDocument();
    expect(screen.getByTestId('flavour-error')).toBeInTheDocument();
    expect(screen.queryByTestId('flavour-row-error-elvish'), 'the draft’s problem is drawn twice').toBeNull();
    expect(screen.getByTestId('flavour-row-error-broken')).toBeInTheDocument();
  });
});

describe('default shell arguments: a keyed table of text (#67)', () => {
  it('adds a flavour’s arguments as text and writes the map on Save', async () => {
    const { user, onCommit } = mountControl(ARGS, {});
    await user.click(screen.getByTestId(`list-edit-${ARGS}`));
    await user.type(screen.getByTestId(`map-new-key-${ARGS}`), 'pwsh');
    await user.click(screen.getByTestId(`map-add-${ARGS}`));
    const cell = within(screen.getByTestId(`map-row-${ARGS}-pwsh`)).getByRole('textbox');
    await user.type(cell, '-NoLogo');
    await user.click(screen.getByTestId(`list-editor-save-${ARGS}`));
    expect(onCommit.mock.calls.at(-1)![0]).toEqual({ pwsh: '-NoLogo' });
  });
});

describe('hidden built-ins: a picker that can un-hide (#67)', () => {
  it('shows a hidden built-in ticked, and unticking it writes it back to visible', async () => {
    const { user, onCommit } = mountControl(HIDDEN, ['pwsh'], {
      options: DETECTED.map((d) => d.id),
      optionLabels: Object.fromEntries(DETECTED.map((d) => [d.id, d.label])),
    });
    const pwsh = screen.getByRole('checkbox', { name: 'PowerShell 7' });
    expect(pwsh).toBeChecked();
    await user.click(pwsh);
    expect(onCommit).toHaveBeenLastCalledWith([]);
  });
});
