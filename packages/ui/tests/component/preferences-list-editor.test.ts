/**
 * 077 FR-025 — a setting holding an unbounded list or table is summarised in its row and edited in a modal over the
 * Preferences window, by the same editor it had inline: Save writes the draft once, Cancel and Escape drop it.
 *
 * Layer: component — what the row and the modal render, where focus goes and what reaches `onCommit` are all
 * observable in jsdom; the modal hosts the real list and table editors through `SettingControl`.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_METADATA, type FieldDescriptor } from '@throng/core';
import { HIDDEN_TERMINAL_FLAVOUR_DESCRIPTORS } from '../../../core/src/config/settings-metadata.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { SettingControl } from '../../src/renderer/preferences/form-controls.js';
import { listSummary } from '../../src/renderer/preferences/list-editor.js';

const byKey = (key: string): FieldDescriptor => {
  const d = [...SETTINGS_METADATA, ...HIDDEN_TERMINAL_FLAVOUR_DESCRIPTORS].find((x) => x.key === key);
  if (!d) throw new Error(`no descriptor ${key}`);
  return d;
};

const GLOBS = byKey('explorer.excludeGlobs');
const SOURCES = byKey('editor.previews.providers.html.safeSources');
const BY_EXTENSION = byKey('editor.languageByExtension');
const BY_LANGUAGE = byKey('editor.indentByLanguage');
const FLAVOURS = byKey('terminals.flavours');

/** The setting's row as the Settings tab draws it, holding its value as the window does. */
function mount(descriptor: FieldDescriptor, initial: unknown, options?: readonly (string | number)[]) {
  const onCommit = vi.fn();
  function Host() {
    const [value, setValue] = useState<unknown>(initial);
    return createElement(SettingControl, {
      descriptor,
      value,
      ...(options ? { options } : {}),
      onCommit: (v: unknown) => {
        onCommit(v);
        setValue(v);
      },
    });
  }
  render(createElement(NotificationProvider, null, createElement(Host)));
  return { onCommit, user: userEvent.setup({ delay: null }) };
}

const editButton = (d: FieldDescriptor): HTMLElement => screen.getByTestId(`list-edit-${d.key}`);
const modal = (d: FieldDescriptor): HTMLElement | null => screen.queryByTestId(`list-editor-${d.key}`);
const summary = (d: FieldDescriptor): string => screen.getByTestId(`list-summary-${d.key}`).textContent ?? '';

afterEach(() => {
  document.body.replaceChildren();
});

describe('the row (FR-025)', () => {
  it('says how many entries the list holds and names the first three, and draws no inline editor', () => {
    mount(GLOBS, ['**/node_modules', '**/dist', '**/.git', '**/coverage']);
    expect(summary(GLOBS)).toBe('4 entries: **/node_modules, **/dist, **/.git, …');
    expect(screen.queryByTestId(`control-${GLOBS.key}-add`)).toBeNull();
    expect(editButton(GLOBS)).toHaveAttribute('title', `Edit ${GLOBS.label}…`);
  });

  it('says so when the list is empty, and counts one entry in the singular', () => {
    expect(listSummary(GLOBS, [])).toBe('No entries');
    expect(listSummary(GLOBS, ['**/dist'])).toBe('1 entry: **/dist');
  });

  it('names a table by its keys — a language by its name, never its id — and a records table by each row’s first text', () => {
    expect(listSummary(BY_EXTENSION, { '.h': 'c', '.hpp': 'cpp' })).toBe('2 entries: .h, .hpp');
    expect(listSummary(BY_LANGUAGE, { typescript: { style: 'spaces', width: 2 } })).toMatch(/^1 entry: TypeScript$/);
    expect(listSummary(FLAVOURS, [{ id: 'nu', label: 'Nushell', file: 'nu' }])).toBe('1 entry: nu');
  });

  it('digit-groups a large count', () => {
    const many = Array.from({ length: 1200 }, (_, i) => `g${i}`);
    expect(listSummary(GLOBS, many)).toMatch(/^1,200 entries: g0, g1, g2, …$/);
  });

  it('cannot be opened while the row is disabled', () => {
    render(
      createElement(
        NotificationProvider,
        null,
        createElement(SettingControl, { descriptor: GLOBS, value: [], disabled: true, onCommit: vi.fn() }),
      ),
    );
    expect(editButton(GLOBS)).toBeDisabled();
  });
});

describe('the modal over a string list (FR-025)', () => {
  it('opens as a labelled modal dialog holding the list’s editor, with the caret inside it', async () => {
    const { user } = mount(GLOBS, ['**/dist']);
    await user.click(editButton(GLOBS));
    const dialog = modal(GLOBS)!;
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { name: GLOBS.label })).toBeInTheDocument();
    expect(within(dialog).getByTestId(`control-${GLOBS.key}-item-0`)).toHaveValue('**/dist');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('writes the edited list once, on Save, and the row then summarises it', async () => {
    const { user, onCommit } = mount(GLOBS, ['**/dist']);
    await user.click(editButton(GLOBS));
    await user.click(screen.getByTestId(`control-${GLOBS.key}-add`));
    await user.type(screen.getByTestId(`control-${GLOBS.key}-item-1`), '**/build');
    expect(onCommit, 'nothing is written while the modal is open').not.toHaveBeenCalled();

    await user.click(screen.getByTestId(`list-editor-save-${GLOBS.key}`));
    expect(onCommit.mock.calls).toEqual([[['**/dist', '**/build']]]);
    expect(modal(GLOBS)).toBeNull();
    expect(summary(GLOBS)).toBe('2 entries: **/dist, **/build');
  });

  it('writes nothing when Save is pressed with nothing changed', async () => {
    const { user, onCommit } = mount(GLOBS, ['**/dist']);
    await user.click(editButton(GLOBS));
    await user.click(screen.getByTestId(`list-editor-save-${GLOBS.key}`));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it.each([
    ['Cancel', async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByTestId(`list-editor-cancel-${GLOBS.key}`))],
    ['Escape', async (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
  ])('drops every edit on %s, and opens again on the stored list', async (_name, dismiss) => {
    const { user, onCommit } = mount(GLOBS, ['**/dist']);
    await user.click(editButton(GLOBS));
    await user.click(screen.getByTestId(`control-${GLOBS.key}-remove-0`));
    await dismiss(user);

    expect(modal(GLOBS)).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
    await user.click(editButton(GLOBS));
    expect(screen.getByTestId(`control-${GLOBS.key}-item-0`)).toHaveValue('**/dist');
  });

  it('saves on Ctrl+Enter', async () => {
    const { user, onCommit } = mount(GLOBS, ['**/dist']);
    await user.click(editButton(GLOBS));
    await user.click(screen.getByTestId(`control-${GLOBS.key}-remove-0`));
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onCommit.mock.calls).toEqual([[[]]]);
  });

  it('keeps the caret in the dialog when a row lets go on Enter, so Escape still closes it', async () => {
    const { user, onCommit } = mount(GLOBS, ['**/dist']);
    await user.click(editButton(GLOBS));
    const row = screen.getByTestId(`control-${GLOBS.key}-item-0`);
    await user.click(row);
    await user.type(row, 'x{Enter}');
    await waitFor(() => expect(document.activeElement).toBe(modal(GLOBS)));
    await user.keyboard('{Escape}');
    expect(modal(GLOBS)).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('gives the caret back to the Edit button when it closes', async () => {
    const { user } = mount(GLOBS, ['**/dist']);
    await user.click(editButton(GLOBS));
    await user.click(screen.getByTestId(`list-editor-cancel-${GLOBS.key}`));
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(document.activeElement).toBe(editButton(GLOBS));
  });
});

describe('the modal over a checked list (FR-025, FR-024)', () => {
  it('refuses a bad entry in the Preferences toast, and Save writes only what passed', async () => {
    const shipped = ['https://fonts.googleapis.com'];
    const { user, onCommit } = mount(SOURCES, shipped);
    await user.click(editButton(SOURCES));
    await user.click(screen.getByTestId(`control-${SOURCES.key}-add`));
    const entry = screen.getByTestId(`control-${SOURCES.key}-item-1`);
    await user.type(entry, 'http://cdn.example.com{Enter}');
    expect(screen.getByTestId(`control-${SOURCES.key}-item-1-invalid`).textContent).toContain('Only https addresses can be sources');
    expect(modal(SOURCES)!.contains(screen.getByTestId(`control-${SOURCES.key}-item-1-invalid`)), 'said in the toast, not in the modal').toBe(false);

    fireEvent.click(screen.getByTestId(`list-editor-save-${SOURCES.key}`));
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('the modal over a keyed table (FR-025)', () => {
  it('adds a row in the modal and writes the table on Save', async () => {
    const languages = ['c', 'cpp', 'typescript'];
    const { user, onCommit } = mount(BY_EXTENSION, { '.h': 'c' }, languages);
    expect(summary(BY_EXTENSION)).toBe('1 entry: .h');
    await user.click(editButton(BY_EXTENSION));
    await user.type(screen.getByTestId(`map-new-key-${BY_EXTENSION.key}`), '.hpp');
    await user.click(screen.getByTestId(`map-add-${BY_EXTENSION.key}`));
    expect(screen.getByTestId(`map-row-${BY_EXTENSION.key}-.hpp`)).toBeVisible();
    expect(onCommit).not.toHaveBeenCalled();

    await user.click(screen.getByTestId(`list-editor-save-${BY_EXTENSION.key}`));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]![0]).toEqual(expect.objectContaining({ '.h': 'c', '.hpp': expect.anything() }));
    expect(summary(BY_EXTENSION)).toBe('2 entries: .h, .hpp');
  });
});
