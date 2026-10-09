/**
 * 052 T020 (FR-012, research R7) — a DIRTY document a Replace landed on keeps its buffer and says so ONCE.
 *
 * The notice is the panel's standing condition, owned by its document state: it has Save As… and Discard, a plain
 * save the authority refuses is reported on THIS notice (flashed, never a second surface — 032's "one condition,
 * one notice"), and Discard goes to the authority, which drops the buffer.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getEditorActions } from '../../src/renderer/editor/editor-actions.js';
import { removeEditorState } from '../../src/renderer/editor/editor-state.js';
import { removePanelLanguage } from '../../src/renderer/editor/editor-language.js';
import { mountEditor } from './helpers/mount-editor.js';

const PANEL = 'p-replaced';
const PATH = 'C:/proj/b.md';
const HEADLINE = 'b.md was replaced by a moved file. Your unsaved changes are kept here.';

afterEach(() => {
  removeEditorState(PANEL);
  removePanelLanguage(PANEL);
  Reflect.deleteProperty(window, 'throng');
});

async function mountReplaced() {
  const h = mountEditor({
    panelId: PANEL,
    doc: { text: 'MY UNSAVED WORK\n', version: 4, dirty: true, absPath: PATH },
    withNotices: true,
  });
  await waitFor(() => expect(h.view().state.doc.toString()).toBe('MY UNSAVED WORK\n'));
  act(() => h.pushSync({ replaced: true }));
  await screen.findByTestId(`panel-failure-${PANEL}`);
  return h;
}

describe('the replaced notice (052 T020)', () => {
  it('shows ONE inline notice, naming the file, with Save As… and Discard', async () => {
    await mountReplaced();
    const notices = document.querySelectorAll('[data-testid^="panel-failure-"]');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toHaveTextContent(HEADLINE);
    expect(screen.getByRole('button', { name: 'Save As…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy();
  });

  it('is gone once the authority clears the replaced state', async () => {
    const h = await mountReplaced();
    act(() => h.pushSync({ replaced: false }));
    await waitFor(() => expect(screen.queryByTestId(`panel-failure-${PANEL}`)).toBeNull());
  });

  it('a refused Ctrl+S shows the refusal in that same notice, not a second one', async () => {
    const h = await mountReplaced();
    h.calls.save.mockResolvedValueOnce({
      ok: false,
      reason: 'replaced',
      error: 'This file was replaced. Use Save As to keep your changes.',
    });
    const notice = screen.getByTestId(`panel-failure-${PANEL}`);
    expect(notice.getAttribute('data-flash')).toBe('0');

    await act(async () => {
      await getEditorActions(PANEL)?.save();
    });

    await waitFor(() => expect(screen.getByTestId(`panel-failure-${PANEL}`).getAttribute('data-flash')).toBe('1'));
    expect(document.querySelectorAll('[data-testid^="panel-failure-"]')).toHaveLength(1);
    // No second surface: neither the editor's "Cannot save" dialog nor another notice.
    expect(screen.queryByText('Cannot save')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closing it with "Save" routes to Save As, never a plain save, and the buffer survives (052 R5)', async () => {
    const h = await mountReplaced();

    const saved = await getEditorActions(PANEL)!.saveForClose();

    expect(saved).toBe(false); // the dialog was cancelled, so the flow stops
    expect(h.calls.chooseSavePath).toHaveBeenCalledTimes(1);
    expect(h.calls.save).not.toHaveBeenCalled();
    expect(h.view().state.doc.toString()).toBe('MY UNSAVED WORK\n');
  });

  it('a plain Ctrl+S never reaches the authority while the document is replaced; the notice flashes (052 T024)', async () => {
    const h = await mountReplaced();

    await act(async () => {
      expect(await getEditorActions(PANEL)?.save()).toBe(false);
    });

    expect(h.calls.save).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId(`panel-failure-${PANEL}`).getAttribute('data-flash')).toBe('1'));
  });

  it('Discard calls discardReplaced for this panel', async () => {
    const h = await mountReplaced();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(h.calls.discardReplaced).toHaveBeenCalledWith(PANEL));
  });

  it('a remount shows the notice from getContent, with no relay', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'MY UNSAVED WORK\n', version: 4, dirty: true, absPath: PATH, replaced: true },
    });
    await screen.findByTestId(`panel-failure-${PANEL}`);
    expect(screen.getByTestId(`panel-failure-${PANEL}`)).toHaveTextContent(HEADLINE);
    expect(h.calls.save).not.toHaveBeenCalled();
  });
});

/*
 * 052 T024 — the replaced state survives a restart. The panel's config carries `replaced: true` (written from the
 * relay by `MovedPathSync`); a restore registers the document as replaced with the recovered text instead of
 * loading the path, which another document holds now.
 */
describe('the replaced state is persisted (052 T024)', () => {
  const stub = { replaced: true };

  it('MovedPathSync writes it from the relay and removes it when the state clears', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'MINE\n', version: 1, dirty: true, absPath: PATH },
      withChrome: true,
      registerProject: true,
    });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe('MINE\n'));

    act(() => h.pushSync(stub));
    await waitFor(() => expect(h.savedPanelConfig()?.replaced).toBe(true));

    act(() => h.pushSync({ replaced: false }));
    await waitFor(() => expect(h.savedPanelConfig()?.replaced).toBeUndefined());
  });

  it('a remount from a layout carrying it shows the notice, restores the unsaved text and does not plain-save', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'ON-DISK-FOR-ANOTHER-DOC\n', version: 1, absPath: PATH },
      restoreByLoad: true,
      panelConfig: { replaced: true, filePath: PATH },
      recovered: { text: 'MY UNSAVED WORK\n' },
    });
    await screen.findByTestId(`panel-failure-${PANEL}`);
    expect(screen.getByTestId(`panel-failure-${PANEL}`)).toHaveTextContent(HEADLINE);
    // Registered as replaced, with the surviving text — and the path, which another document holds, never loaded.
    expect(h.calls.register).toHaveBeenCalledWith(expect.objectContaining({ replaced: true, absPath: PATH }));
    expect(h.calls.restoreRecovered).toHaveBeenCalledWith(PANEL, 'MY UNSAVED WORK\n', undefined);
    expect(h.calls.load).not.toHaveBeenCalled();
    await waitFor(() => expect(h.view().state.doc.toString()).toBe('MY UNSAVED WORK\n'));

    await act(async () => {
      expect(await getEditorActions(PANEL)?.save()).toBe(false);
    });
    expect(h.calls.save).not.toHaveBeenCalled();
  });

  it('with nothing unsaved to restore the flag is dropped and the path loads as an ordinary editor', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'FROM-DISK\n', version: 1, absPath: PATH },
      restoreByLoad: true,
      panelConfig: { replaced: true, filePath: PATH },
    });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe('FROM-DISK\n'));
    expect(h.calls.register).not.toHaveBeenCalledWith(expect.objectContaining({ replaced: true }));
    await waitFor(() => expect(h.savedPanelConfig()).toBeDefined());
    expect(h.savedPanelConfig()?.replaced).toBeUndefined();
    expect(screen.queryByTestId(`panel-failure-${PANEL}`)).toBeNull();
  });
});
