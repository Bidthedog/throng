import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEditorState, removeEditorState } from '../../src/renderer/editor/editor-state.js';
import { getEditorActions } from '../../src/renderer/editor/editor-actions.js';
import { __resetDirtyCloseStore } from '../../src/renderer/editor/dirty-close-store.js';
import { requestPanelDestroy } from '../../src/renderer/workspace/panel-destroy.js';
import { mountEditor } from './helpers/mount-editor.js';

/**
 * An editor whose file a move took out of its project (050 FR-035, FR-036, SC-012; research R18, R19).
 *
 * The panel stays where it is, shows the file's new path, goes read-only and says so ONCE, inline, with
 * Close and Copy. It lets go of the file: it never reads it, so no "Couldn't open" notice can follow.
 *
 * Two doors lead there and both are tested: the sync relay (`movedOut: true` beside `movedTo`) for a
 * panel on screen, and a persisted `movedOut` in the panel's config for one mounted later, after the
 * layout walk (R19) or a restart.
 */

const PANEL = 'p-ed';
const OLD = 'C:/proj/note.txt';
const NEW = 'D:/other/note.txt';
const SENTENCE = `This file moved to another project, at ${NEW}. You can no longer work on it in this project.`;

afterEach(() => {
  __resetDirtyCloseStore();
  removeEditorState(PANEL);
  Reflect.deleteProperty(window, 'throng');
});

const bannerId = `panel-failure-${PANEL}`;

describe('a movedOut sync (FR-035)', () => {
  it('shows the moved notice with the new path, and makes the editor read-only', async () => {
    const h = mountEditor({ panelId: PANEL, doc: { text: 'body\n', version: 1, absPath: OLD }, withHeader: true });
    await waitFor(() => expect(getEditorState(PANEL)?.filePath).toBe(OLD));
    expect(h.view().state.readOnly).toBe(false);

    act(() => h.pushSync({ movedTo: NEW, movedOut: true }));

    const banner = await screen.findByTestId(bannerId);
    expect(banner).toHaveTextContent(/This file moved to another project/);
    expect(banner).toHaveTextContent(NEW.replace(/\//g, '\\'));
    expect(getEditorState(PANEL)?.filePath).toBe(NEW);
    expect(h.view().state.readOnly).toBe(true);
  });

  it('says the whole sentence once, with Close and Copy and no Retry', async () => {
    const h = mountEditor({ panelId: PANEL, doc: { text: 'body\n', version: 1, absPath: OLD } });
    await waitFor(() => expect(getEditorState(PANEL)?.filePath).toBe(OLD));

    act(() => h.pushSync({ movedTo: NEW, movedOut: true }));

    const banner = await screen.findByTestId(bannerId);
    expect(screen.getAllByTestId(bannerId)).toHaveLength(1);
    const text = banner.textContent ?? '';
    expect(text.replace(/\\/g, '/')).toContain(SENTENCE);
    expect(banner.querySelector('[title="Close"]')).not.toBeNull();
    expect(banner.querySelector('[title="Copy details"]')).not.toBeNull();
    expect(banner.querySelector('[title="Try again"]'), 'no Retry').toBeNull();
    expect(banner.querySelector('[title="Clear panel type"]')).toBeNull();
  });

  it('keeps unsaved text, refuses Save and offers Save As in the new folder (FR-036)', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'unsaved work\n', version: 3, absPath: OLD, dirty: true },
    });
    await waitFor(() => expect(getEditorState(PANEL)?.dirty).toBe(true));
    const chooseSavePath = vi.fn((_o: { defaultDir?: string }) => Promise.resolve(null));
    (Reflect.get(window, 'throng') as { editor: Record<string, unknown> }).editor.chooseSavePath =
      chooseSavePath;

    act(() => h.pushSync({ movedTo: NEW, movedOut: true, dirty: true }));
    await screen.findByTestId(bannerId);

    expect(h.view().state.doc.toString()).toBe('unsaved work\n');
    expect(getEditorState(PANEL)?.dirty).toBe(true);

    const saved = await getEditorActions(PANEL)!.save();
    expect(saved, 'Save is unavailable').toBe(false);
    expect(h.calls.save).not.toHaveBeenCalled();

    await getEditorActions(PANEL)!.saveAs();
    expect(chooseSavePath).toHaveBeenCalledTimes(1);
    expect(chooseSavePath.mock.calls[0]![0].defaultDir).toBe('D:/other');
  });

  it('after a Save As the panel stays moved out, naming the path it saved to (FR-036 amended)', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'unsaved work\n', version: 3, absPath: OLD, dirty: true },
    });
    await waitFor(() => expect(getEditorState(PANEL)?.dirty).toBe(true));
    const SAVED = 'D:/other/sub/renamed.txt';
    (Reflect.get(window, 'throng') as { editor: Record<string, unknown> }).editor.chooseSavePath = () =>
      Promise.resolve(SAVED);
    h.calls.save.mockResolvedValue({ ok: true, absPath: SAVED, encoding: 'utf8', lineEnding: 'lf' });
    act(() => h.pushSync({ movedTo: NEW, movedOut: true, dirty: true }));
    await screen.findByTestId(bannerId);

    await act(async () => {
      await getEditorActions(PANEL)!.saveAs();
    });
    act(() => h.pushSync({ dirty: false }));

    await waitFor(() => expect(getEditorState(PANEL)?.filePath).toBe(SAVED));
    expect(getEditorState(PANEL)?.dirty).toBe(false);
    expect(h.view().state.readOnly).toBe(true);
    expect((await screen.findByTestId(bannerId)).textContent?.replace(/\\/g, '/')).toContain(SAVED);
  });

  it('a Save As into the editor’s OWN project leaves a persisted config with no movedOut (relay beats the answer)', async () => {
    // Main relays `movedOut: false` BEFORE the save invoke returns. `writeTo` must not write the config it
    // snapshotted before its awaits back over that: a restart would show the moved notice on an editor main
    // says is ordinary.
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'work\n', version: 3, absPath: OLD, dirty: true },
      withChrome: true,
    });
    await waitFor(() => expect(getEditorState(PANEL)?.dirty).toBe(true));
    act(() => h.pushSync({ movedTo: NEW, movedOut: true, dirty: true }));
    await screen.findByTestId(bannerId);
    const SAVED = 'C:/proj/saved.txt';
    (Reflect.get(window, 'throng') as { editor: Record<string, unknown> }).editor.chooseSavePath = () =>
      Promise.resolve(SAVED);
    h.calls.save.mockImplementation(async () => {
      await Promise.resolve();
      h.pushSync({ dirty: false });
      h.pushSync({ movedTo: SAVED, movedOut: false });
      await new Promise((r) => setTimeout(r, 0));
      return { ok: true, absPath: SAVED, encoding: 'utf8', lineEnding: 'lf' };
    });

    await act(async () => {
      await getEditorActions(PANEL)!.saveAs();
    });

    await waitFor(() => expect(h.savedPanelConfig()?.filePath).toBe(SAVED), { timeout: 3000 });
    // As the layout blob is persisted: JSON drops an `undefined`, so the key is gone from the record.
    expect(JSON.parse(JSON.stringify(h.savedPanelConfig()))).not.toHaveProperty('movedOut');
    expect(getEditorState(PANEL)?.movedOut).toBe(false);
  });

  it('closing a dirty moved-out editor asks Save As, Discard or Cancel', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'unsaved work\n', version: 3, absPath: OLD, dirty: true },
      withHeader: true,
      withChrome: true,
    });
    await waitFor(() => expect(getEditorState(PANEL)?.dirty).toBe(true));
    act(() => h.pushSync({ movedTo: NEW, movedOut: true, dirty: true }));
    await screen.findByTestId(bannerId);

    act(() => void requestPanelDestroy(PANEL));

    const dialog = await screen.findByTestId('dirty-close-dialog');
    expect(screen.getByTestId('dirty-close-cancel')).toBeInTheDocument();
    expect(screen.getByTestId('dirty-close-discard')).toBeInTheDocument();
    expect(screen.getByTestId('dirty-close-save')).toHaveTextContent(/Save As/);
    expect(dialog).not.toHaveTextContent(/Save & close/);
    await userEvent.setup().click(screen.getByTestId('dirty-close-cancel'));
  });

  it('becomes an ordinary editor again when a sync says movedOut: false (undo)', async () => {
    const h = mountEditor({ panelId: PANEL, doc: { text: 'body\n', version: 1, absPath: OLD } });
    await waitFor(() => expect(getEditorState(PANEL)?.filePath).toBe(OLD));
    act(() => h.pushSync({ movedTo: NEW, movedOut: true }));
    await screen.findByTestId(bannerId);

    act(() => h.pushSync({ movedTo: OLD, movedOut: false }));

    await waitFor(() => expect(screen.queryByTestId(bannerId)).toBeNull());
    expect(h.view().state.readOnly).toBe(false);
    expect(getEditorState(PANEL)?.filePath).toBe(OLD);
  });
});

describe('mounted with movedOut in its config (R19)', () => {
  it('shows the notice without reading the file, and raises no could-not-open notice', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: '', version: 1, absPath: NEW },
      panelConfig: { movedOut: true },
      restoreByLoad: true,
      withNotices: true,
      withMissingFileWatcher: true,
    });

    expect(await screen.findByTestId(bannerId)).toHaveTextContent(/moved to another project/);
    expect(h.calls.load, 'the file is not read').not.toHaveBeenCalled();
    expect(h.calls.register).not.toHaveBeenCalled();
    expect(h.view().state.readOnly).toBe(true);
    // The watcher's scan runs 300 ms after mount; wait it out, then nothing may have been raised.
    await new Promise((r) => setTimeout(r, 450));
    expect(screen.queryByText(/Couldn.t open/i)).toBeNull();
    expect(screen.queryByText(/could not be read/i)).toBeNull();
    expect(getEditorState(PANEL)?.movedOut).toBe(true);
  });

  it('after a restart, shows the unsaved text a recovery snapshot kept — read-only, registered moved out, never loaded (FR-036)', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: '', version: 1, absPath: NEW },
      panelConfig: { movedOut: true },
      restoreByLoad: true,
      recovered: { text: 'survived the restart\n' },
    });

    await screen.findByTestId(bannerId);
    await waitFor(() => expect(h.view().state.doc.toString()).toBe('survived the restart\n'));
    expect(h.view().state.readOnly).toBe(true);
    expect(h.calls.load, 'the file is not read').not.toHaveBeenCalled();
    expect(h.calls.register).toHaveBeenCalledWith(expect.objectContaining({ movedOut: true, absPath: NEW }));
    expect(h.calls.restoreRecovered).toHaveBeenCalledWith(PANEL, 'survived the restart\n', undefined);
    await waitFor(() => expect(getEditorState(PANEL)?.dirty).toBe(true));
  });

  it('adopts a live document without verifying a path it no longer serves', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'kept\n', version: 2, absPath: NEW },
      panelConfig: { movedOut: true },
    });

    expect(await screen.findByTestId(bannerId)).toBeInTheDocument();
    expect(h.calls.verifyPath).not.toHaveBeenCalled();
    expect(h.view().state.doc.toString()).toBe('kept\n');
    expect(h.view().state.readOnly).toBe(true);
  });
});
