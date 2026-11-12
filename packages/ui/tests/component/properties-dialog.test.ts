/**
 * 067 T074 (FR-045 to FR-049, FR-052 to FR-055, FR-108, SC-006) — the Properties dialog.
 *
 * A modal dialog that opens at once with what is already known (the names), fills in the rest when main
 * answers, and lets a folder's figures grow while it is open, labelled as still being calculated. It
 * offers revealing the item in the OS file manager and, where the platform has one, the OS's own
 * properties window; it offers no way to edit anything. Closing it stops the calculation.
 *
 * Main owns the walk, the 60-second cache and the links rule (FR-049 to FR-051); here the bridge is a
 * double and the assertions are about what the dialog shows and sends.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FolderTally, ItemProperties } from '@throng/core';
import { PropertiesDialog } from '../../src/renderer/explorer/properties-dialog.js';

const ATTRS = { readOnly: false, hidden: false, system: false, archive: false, junction: false };

const file = (over: Partial<ItemProperties> = {}): ItemProperties => ({
  name: 'report.txt',
  path: 'C:/projects/demo/Docs/report.txt',
  type: 'file',
  sizeBytes: 1_234_567,
  attributes: { ...ATTRS, readOnly: true, archive: true },
  created: Date.UTC(2026, 0, 2, 3, 4, 5),
  modified: Date.UTC(2026, 5, 7, 8, 9, 10),
  accessed: Date.UTC(2026, 10, 11, 12, 13, 14),
  ...over,
});

const folder = (over: Partial<ItemProperties> = {}): ItemProperties =>
  file({ name: 'Docs', path: 'C:/projects/demo/Docs', type: 'folder', sizeBytes: 0, attributes: ATTRS, ...over });

type Opened = Awaited<ReturnType<NonNullable<NonNullable<Window['throng']>['properties']>['open']>>;

function setup(items: ItemProperties[], os: { available: boolean; reason?: string } = { available: true }) {
  let tallyCb: (evt: { requestId: string; tally: FolderTally }) => void = () => {};
  let resolveOpen: (value: Opened) => void = () => {};
  const open = vi.fn(
    () =>
      new Promise<Opened>((resolve) => {
        resolveOpen = resolve;
      }),
  );
  const api = {
    open,
    close: vi.fn(),
    onTally: vi.fn((cb: typeof tallyCb) => ((tallyCb = cb), () => {})),
    showOsProperties: vi.fn(() => Promise.resolve({ ok: true as const })),
  };
  const reveal = vi.fn(() => Promise.resolve({ ok: true as const }));
  const clipboardWrite = vi.fn(() => Promise.resolve());
  Reflect.set(window, 'throng', { properties: api, files: { reveal }, clipboard: { write: clipboardWrite } });
  const onClose = vi.fn();
  render(createElement(PropertiesDialog, { relPaths: items.map((i) => i.path.replace('C:/projects/demo/', '')), onClose }));
  return {
    api,
    reveal,
    clipboardWrite,
    onClose,
    answer: () => act(() => resolveOpen({ requestId: 'req-1', items, osProperties: os })),
    tally: (tally: Partial<FolderTally>, requestId = 'req-1') =>
      act(() =>
        tallyCb({
          requestId,
          tally: { sizeBytes: 0, files: 0, folders: 0, skipped: 0, done: false, ...tally },
        }),
      ),
  };
}

const dialog = (): HTMLElement => screen.getByRole('dialog');
const text = (): string => dialog().textContent ?? '';

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('opening (FR-045, FR-048, SC-006)', () => {
  it('is on screen at once, modal, naming the item, before main has answered', () => {
    setup([file()]);
    expect(dialog()).toHaveAttribute('aria-modal', 'true');
    expect(dialog()).toHaveAccessibleName(/report\.txt/);
    expect(text()).toContain('report.txt');
    expect(screen.getByTestId('properties-busy')).toBeInTheDocument();
  });

  it('asks main for the relative paths it was given', () => {
    const t = setup([file()]);
    expect(t.api.open).toHaveBeenCalledWith(['Docs/report.txt']);
  });
});

describe('what a file shows (FR-046)', () => {
  it('shows the path, type, grouped size, attributes and the three timestamps once main answers', async () => {
    const t = setup([file()]);
    t.answer();
    await waitFor(() => expect(screen.queryByTestId('properties-busy')).toBeNull());
    expect(screen.getByTestId('properties-path')).toHaveValue('C:/projects/demo/Docs/report.txt');
    expect(screen.getByTestId('properties-type')).toHaveTextContent('File');
    expect(screen.getByTestId('properties-size')).toHaveTextContent('1,234,567 bytes');
    const attrs = screen.getByTestId('properties-attributes').textContent ?? '';
    expect(attrs).toMatch(/read-only/i);
    expect(attrs).toMatch(/archive/i);
    expect(attrs).not.toMatch(/hidden|system/i);
    for (const id of ['created', 'modified', 'accessed']) {
      expect(screen.getByTestId(`properties-${id}`).textContent).toMatch(/2026/);
    }
  });

  it('says None when no attribute is set', async () => {
    const t = setup([file({ attributes: ATTRS })]);
    t.answer();
    await waitFor(() => expect(screen.getByTestId('properties-attributes')).toHaveTextContent(/none/i));
  });

  it('shows a symlink’s type and where it points', async () => {
    const t = setup([file({ type: 'symlink', linkTarget: 'C:/elsewhere/real.txt' })]);
    t.answer();
    await waitFor(() => expect(screen.getByTestId('properties-type')).toHaveTextContent(/symbolic link|symlink/i));
    expect(screen.getByTestId('properties-link-target')).toHaveTextContent('C:/elsewhere/real.txt');
  });

  it('says a junction is a junction', async () => {
    const t = setup([folder({ type: 'junction', linkTarget: 'D:/target' })]);
    t.answer();
    await waitFor(() => expect(screen.getByTestId('properties-type')).toHaveTextContent(/junction/i));
  });

  it('says so when the item has been deleted since the menu opened', async () => {
    const t = setup([file({ gone: true })]);
    t.answer();
    await waitFor(() => expect(text()).toMatch(/no longer exists/i));
  });
});

describe('an item deleted or renamed while the dialog is open (T112)', () => {
  it('a final tally naming the path shows "no longer exists", stops calculating and ignores later tallies', async () => {
    const t = setup([folder()]);
    t.answer();
    await screen.findByTestId('properties-contents');
    t.tally({ sizeBytes: 10, files: 1, folders: 0 });
    t.tally({ done: true, gone: ['C:/projects/demo/Docs'] });
    await waitFor(() => expect(text()).toMatch(/no longer exists/i));
    expect(screen.getByTestId('properties-contents')).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByTestId('properties-contents')).not.toHaveTextContent(/calculating/i);
    t.tally({ sizeBytes: 999_999, files: 99, folders: 9, done: true });
    expect(screen.getByTestId('properties-contents')).not.toHaveTextContent('999,999');
    expect(screen.getByTestId('properties-os')).toBeDisabled();
  });

  it('in a selection, only the named paths are reported gone', async () => {
    const t = setup([
      file({ name: 'a.txt', path: 'C:/projects/demo/a.txt' }),
      folder({ name: 'Docs', path: 'C:/projects/demo/Docs' }),
    ]);
    t.answer();
    await screen.findByTestId('properties-contents');
    t.tally({ done: true, gone: ['C:/projects/demo/a.txt'] });
    await waitFor(() => expect(screen.getByTestId('properties-gone')).toHaveTextContent('1 item no longer exists'));
  });
});

describe('the path is copyable (FR-046)', () => {
  it('is selectable text, and the copy control writes it verbatim to the clipboard', async () => {
    const user = userEvent.setup({ delay: null });
    const t = setup([file()]);
    t.answer();
    const path = await screen.findByTestId('properties-path');
    expect(path).toHaveAttribute('readonly');
    await user.click(screen.getByTestId('properties-copy-path'));
    expect(t.clipboardWrite).toHaveBeenCalledWith({ text: 'C:/projects/demo/Docs/report.txt', mode: 'verbatim' });
  });
});

describe('a folder’s figures fill in (FR-047, FR-048)', () => {
  it('is labelled as calculating, and grows with each tally until done', async () => {
    const t = setup([folder()]);
    t.answer();
    const contents = await screen.findByTestId('properties-contents');
    expect(contents).toHaveTextContent(/calculating/i);
    expect(contents).toHaveAttribute('aria-busy', 'true');

    t.tally({ sizeBytes: 2048, files: 3, folders: 1 });
    expect(contents).toHaveTextContent('2,048 bytes');
    expect(contents).toHaveTextContent('3 files');
    expect(contents).toHaveTextContent('1 folder');
    expect(contents).toHaveTextContent(/calculating/i);

    t.tally({ sizeBytes: 5_000_000, files: 1_200, folders: 12, done: true });
    expect(contents).toHaveTextContent('5,000,000 bytes');
    expect(contents).toHaveTextContent('1,200 files');
    expect(contents).toHaveTextContent('12 folders');
    expect(contents).not.toHaveTextContent(/calculating/i);
    expect(contents).toHaveAttribute('aria-busy', 'false');
  });

  it('reports unreadable sub-folders as a skipped count, not an error', async () => {
    const t = setup([folder()]);
    t.answer();
    await screen.findByTestId('properties-contents');
    t.tally({ sizeBytes: 10, files: 1, folders: 1, skipped: 3, done: true });
    expect(screen.getByTestId('properties-skipped')).toHaveTextContent('3 folders could not be read');
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('ignores a tally for some other request', async () => {
    const t = setup([folder()]);
    t.answer();
    await screen.findByTestId('properties-contents');
    t.tally({ sizeBytes: 999, files: 9, done: true }, 'someone-else');
    expect(screen.getByTestId('properties-contents')).toHaveTextContent(/calculating/i);
    expect(screen.getByTestId('properties-contents')).not.toHaveTextContent('999');
  });
});

describe('a multi-selection (FR-054)', () => {
  it('shows the combined size and counts of everything selected', async () => {
    const t = setup([
      file({ name: 'a.txt', path: 'C:/projects/demo/a.txt', sizeBytes: 100 }),
      file({ name: 'b.txt', path: 'C:/projects/demo/b.txt', sizeBytes: 200 }),
      folder({ name: 'Docs', path: 'C:/projects/demo/Docs' }),
    ]);
    t.answer();
    const combined = await screen.findByTestId('properties-contents');
    t.tally({ sizeBytes: 1000, files: 5, folders: 1, done: true });
    expect(screen.getByTestId('properties-size')).toHaveTextContent('1,300 bytes');
    expect(combined).toHaveTextContent('7 files');
    expect(combined).toHaveTextContent('1 folder');
    expect(dialog()).toHaveAccessibleName(/3 items/);
  });

  it('offers no single path to copy and no OS properties window', async () => {
    const t = setup([
      file({ name: 'a.txt', path: 'C:/projects/demo/a.txt' }),
      file({ name: 'b.txt', path: 'C:/projects/demo/b.txt' }),
    ]);
    t.answer();
    await screen.findByTestId('properties-contents');
    expect(screen.queryByTestId('properties-path')).toBeNull();
    expect(screen.getByTestId('properties-os')).toBeDisabled();
  });
});

describe('the actions (FR-052, FR-053)', () => {
  it('reveals the item in the OS file manager through the existing seam', async () => {
    const user = userEvent.setup({ delay: null });
    const t = setup([file()]);
    t.answer();
    await user.click(await screen.findByTestId('properties-reveal'));
    expect(t.reveal).toHaveBeenCalledWith('Docs/report.txt');
  });

  it('opens the OS’s own properties window where there is one', async () => {
    const user = userEvent.setup({ delay: null });
    const t = setup([file()], { available: true });
    t.answer();
    const os = await screen.findByTestId('properties-os');
    expect(os).not.toBeDisabled();
    await user.click(os);
    expect(t.api.showOsProperties).toHaveBeenCalledWith('C:/projects/demo/Docs/report.txt');
  });

  it('is absent, with no message, where the platform has none (FR-122)', async () => {
    const t = setup([file()], { available: false });
    t.answer();
    await screen.findByTestId('properties-path');
    expect(screen.queryByTestId('properties-os')).toBeNull();
    expect(screen.queryByTestId('properties-os-reason')).toBeNull();
    expect(text()).not.toMatch(/no system properties|unavailable|not available/i);
  });
});

describe('closing (FR-049, FR-119)', () => {
  it('the X at the top right stops the calculation and closes the dialog', async () => {
    const user = userEvent.setup({ delay: null });
    const t = setup([folder()]);
    t.answer();
    await screen.findByTestId('properties-contents');
    await user.click(screen.getByTestId('properties-dismiss'));
    expect(t.api.close).toHaveBeenCalledWith('req-1');
    expect(t.onClose).toHaveBeenCalledTimes(1);
  });

  it('a click on the scrim does the same', async () => {
    const user = userEvent.setup({ delay: null });
    const t = setup([folder()]);
    t.answer();
    await screen.findByTestId('properties-contents');
    await user.click(screen.getByTestId('properties-overlay'));
    expect(t.api.close).toHaveBeenCalledWith('req-1');
    expect(t.onClose).toHaveBeenCalledTimes(1);
  });

  it('a press that starts in the dialog and ends on the scrim does not close it (selecting the path)', async () => {
    const t = setup([file()]);
    t.answer();
    const path = await screen.findByTestId('properties-path');
    fireEvent.mouseDown(path);
    fireEvent.mouseUp(screen.getByTestId('properties-overlay'));
    fireEvent.click(screen.getByTestId('properties-overlay'));
    expect(t.onClose).not.toHaveBeenCalled();
  });

  it('a click inside the dialog does not close it', async () => {
    const user = userEvent.setup({ delay: null });
    const t = setup([file()]);
    t.answer();
    await user.click(await screen.findByTestId('properties-type'));
    expect(t.onClose).not.toHaveBeenCalled();
  });

  it('has no Close button, only the X, which names its action', async () => {
    const t = setup([file()]);
    t.answer();
    await screen.findByTestId('properties-path');
    expect(screen.getAllByRole('button', { name: /^close$/i })).toEqual([screen.getByTestId('properties-dismiss')]);
    expect(screen.queryByTestId('properties-close')).toBeNull();
    expect([...dialog().querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Close')).toHaveLength(0);
  });

  it('Escape does the same', async () => {
    const t = setup([folder()]);
    t.answer();
    await screen.findByTestId('properties-contents');
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(t.api.close).toHaveBeenCalledWith('req-1');
    expect(t.onClose).toHaveBeenCalledTimes(1);
  });

  it('closing before main has answered still stops the request once it exists', async () => {
    const t = setup([folder()]);
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(t.onClose).toHaveBeenCalledTimes(1);
    t.answer();
    await waitFor(() => expect(t.api.close).toHaveBeenCalledWith('req-1'));
  });
});

describe('accessibility and scope (FR-108, FR-055)', () => {
  it('names every control and keeps the keyboard inside, starting on the X', async () => {
    const t = setup([file()]);
    t.answer();
    await screen.findByTestId('properties-path');
    for (const control of dialog().querySelectorAll('button, input')) {
      expect(control, control.outerHTML).toHaveAccessibleName();
    }
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('properties-dismiss')));
  });

  it('offers nothing that edits attributes or permissions', async () => {
    const t = setup([file()]);
    t.answer();
    await screen.findByTestId('properties-path');
    expect(dialog().querySelectorAll('input[type="checkbox"], input[type="radio"], select, textarea')).toHaveLength(0);
    const writable = [...dialog().querySelectorAll('input')].filter((i) => !i.hasAttribute('readonly'));
    expect(writable).toHaveLength(0);
    expect(text()).not.toMatch(/owner|permission|ACL/i);
  });
});

describe('every value can be copied (FR-120)', () => {
  const copyTo = async (id: string): Promise<void> => {
    await userEvent.setup({ delay: null }).click(screen.getByTestId(`properties-copy-${id}`));
  };

  it('has a copy button beside each value of a file, and each places that value on the clipboard', async () => {
    const t = setup([file()]);
    t.answer();
    await screen.findByTestId('properties-path');
    const expected: Record<string, string> = {
      name: 'report.txt',
      type: 'File',
      attributes: 'Read-only, Archive',
      created: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)).toLocaleString(),
      modified: new Date(Date.UTC(2026, 5, 7, 8, 9, 10)).toLocaleString(),
      accessed: new Date(Date.UTC(2026, 10, 11, 12, 13, 14)).toLocaleString(),
    };
    for (const [id, text] of Object.entries(expected)) {
      await copyTo(id);
      expect(t.clipboardWrite, id).toHaveBeenLastCalledWith({ text, mode: 'verbatim' });
    }
  });

  it('copies a size as the bare count, without the separators it is shown with', async () => {
    const t = setup([file()]);
    t.answer();
    await screen.findByTestId('properties-path');
    expect(screen.getByTestId('properties-size')).toHaveTextContent('1,234,567 bytes');
    await copyTo('size');
    expect(t.clipboardWrite).toHaveBeenLastCalledWith({ text: '1234567', mode: 'verbatim' });
  });

  it('copies a folder’s contents with bare counts, and offers nothing to copy while it is calculating', async () => {
    const t = setup([folder()]);
    t.answer();
    await screen.findByTestId('properties-contents');
    expect(screen.queryByTestId('properties-copy-contents')).toBeNull();
    t.tally({ sizeBytes: 5_000_000, files: 1_200, folders: 12, done: true });
    await copyTo('contents');
    expect(t.clipboardWrite).toHaveBeenLastCalledWith({ text: '5000000 bytes in 1200 files, 12 folders', mode: 'verbatim' });
  });

  it('copies a symbolic link’s target, and the names of a selection', async () => {
    const t = setup([file({ type: 'symlink', linkTarget: 'C:/elsewhere/real.txt' })]);
    t.answer();
    await screen.findByTestId('properties-link-target');
    await copyTo('link-target');
    expect(t.clipboardWrite).toHaveBeenLastCalledWith({ text: 'C:/elsewhere/real.txt', mode: 'verbatim' });
  });

  it('names its action on every copy button', async () => {
    const t = setup([file({ access: { owner: 'sam', group: 'staff', modeSymbolic: 'rw-r--r--', modeOctal: '0644' } })]);
    t.answer();
    await screen.findByTestId('properties-path');
    const copies = [...dialog().querySelectorAll<HTMLElement>('[data-testid^="properties-copy-"]')];
    expect(copies.length).toBeGreaterThan(8);
    for (const c of copies) expect(c, c.outerHTML).toHaveAccessibleName(/^Copy /);
  });
});

describe('a single item’s access details (FR-121)', () => {
  const ACCESS = { owner: 'sam', group: 'staff', modeSymbolic: 'rwxr-xr-x', modeOctal: '0755' };

  it('shows the owner, group and permissions in both forms, each copyable', async () => {
    const t = setup([file({ access: ACCESS })]);
    t.answer();
    await screen.findByTestId('properties-path');
    expect(screen.getByTestId('properties-owner')).toHaveTextContent('sam');
    expect(screen.getByTestId('properties-group')).toHaveTextContent('staff');
    expect(screen.getByTestId('properties-permissions')).toHaveTextContent('rwxr-xr-x');
    expect(screen.getByTestId('properties-octal')).toHaveTextContent('0755');
    await userEvent.setup({ delay: null }).click(screen.getByTestId('properties-copy-octal'));
    expect(t.clipboardWrite).toHaveBeenLastCalledWith({ text: '0755', mode: 'verbatim' });
  });

  it('shows only what the OS reported (a Windows owner, no mode)', async () => {
    const t = setup([file({ access: { owner: 'BUILTIN\\Users' } })]);
    t.answer();
    await screen.findByTestId('properties-path');
    expect(screen.getByTestId('properties-owner')).toHaveTextContent('BUILTIN\\Users');
    expect(screen.queryByTestId('properties-permissions')).toBeNull();
    expect(screen.queryByTestId('properties-octal')).toBeNull();
  });

  it('is absent when the item carries none', async () => {
    const t = setup([file()]);
    t.answer();
    await screen.findByTestId('properties-path');
    expect(screen.queryByTestId('properties-owner')).toBeNull();
  });

  it('is omitted for a multi-selection', async () => {
    const t = setup([
      file({ name: 'a.txt', path: 'C:/projects/demo/a.txt', access: ACCESS }),
      file({ name: 'b.txt', path: 'C:/projects/demo/b.txt', access: ACCESS }),
    ]);
    t.answer();
    await screen.findByTestId('properties-contents');
    expect(screen.queryByTestId('properties-owner')).toBeNull();
    expect(screen.queryByTestId('properties-octal')).toBeNull();
  });
});
