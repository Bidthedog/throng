/**
 * 052 T019 (FR-010, FR-011, research R7) — a panel LINKED to another panel's document.
 *
 * A Replace that lands the owner's file on a clean open file's path leaves one document and two panels. The
 * linked panel's config carries `linkedTo: <owner panel id>` beside its `filePath`. On a restore it attaches to the
 * owner's document while the owner is open; with the owner gone it drops the link and loads `filePath` itself, as an
 * ordinary editor, saying nothing. `MovedPathSync` writes and clears `linkedTo` from the relay.
 */
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { removeEditorState } from '../../src/renderer/editor/editor-state.js';
import { removePanelLanguage } from '../../src/renderer/editor/editor-language.js';
import { mountEditor } from './helpers/mount-editor.js';

const PANEL = 'p-linked';
const PATH = 'C:/proj/b.md';

afterEach(() => {
  removeEditorState(PANEL);
  removePanelLanguage(PANEL);
  Reflect.deleteProperty(window, 'throng');
});

const hasKey = (config: Record<string, unknown> | undefined, key: string): boolean =>
  config !== undefined && Object.prototype.hasOwnProperty.call(config, key) && config[key] !== undefined;

describe('a restored linked panel (052 T019)', () => {
  it('attaches to the owner’s document when the owner is open, and does not load its own', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'OWNER-TEXT\n', version: 3, absPath: PATH },
      restoreByLoad: true,
      panelConfig: { linkedTo: 'owner', filePath: PATH },
      linkOwner: { text: 'OWNER-TEXT\n', version: 3, absPath: PATH },
    });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe('OWNER-TEXT\n'));
    // The tab id rides along, so main can place the linked panel (052 R7b).
    expect(h.calls.link).toHaveBeenCalledWith(PANEL, 'owner', 't1');
    expect(h.calls.load).not.toHaveBeenCalled();
  });

  it('drops linkedTo and loads filePath as an ordinary editor when the owner is gone', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'FROM-DISK\n', version: 1, absPath: PATH },
      restoreByLoad: true,
      panelConfig: { linkedTo: 'owner', filePath: PATH },
      linkOwner: null,
    });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe('FROM-DISK\n'));
    expect(h.calls.link).toHaveBeenCalledWith(PANEL, 'owner', 't1');
    expect(h.calls.load).toHaveBeenCalledTimes(1);
    // The link is dropped from what the layout persists — and nothing is shown to the user about it.
    await waitFor(() => expect(h.savedPanelConfig()).toBeDefined());
    expect(hasKey(h.savedPanelConfig(), 'linkedTo')).toBe(false);
    expect(h.savedPanelConfig()?.filePath).toBe(PATH);
  });

  it('a load the authority answers as LINKED (the path is already held) keeps the link (052 R1)', async () => {
    // The owner was not open when link() was asked, so this panel loaded first — and then the owner's own
    // load found the path held and was linked to it, or this one was: either way the answer names the holder.
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'HOLDER-TEXT\n', version: 2, absPath: PATH, linkedTo: 'holder' },
      restoreByLoad: true,
      panelConfig: { linkedTo: 'owner', filePath: PATH },
      linkOwner: null,
    });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe('HOLDER-TEXT\n'));
    await waitFor(() => expect(h.savedPanelConfig()?.linkedTo).toBe('holder'));
    expect(h.savedPanelConfig()?.filePath).toBe(PATH);
  });

  it('opening a file in place that is held by another panel links to it; an ordinary open clears the link', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'MINE\n', version: 1, absPath: 'C:/proj/mine.md' },
    });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe('MINE\n'));

    await h.openFile({ text: 'HELD\n', version: 5, absPath: PATH, linkedTo: 'holder' });
    await waitFor(() => expect(h.savedPanelConfig()?.linkedTo).toBe('holder'));

    await h.openFile({ text: 'PLAIN\n', version: 1, absPath: 'C:/proj/plain.md' });
    await waitFor(() => expect(hasKey(h.savedPanelConfig(), 'linkedTo')).toBe(false));
  });

  it('a panel with no link never asks the authority to link it', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'x\n', version: 1, absPath: PATH },
      restoreByLoad: true,
    });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe('x\n'));
    expect(h.calls.link).not.toHaveBeenCalled();
  });
});

describe('the relay of a link (052 T019)', () => {
  const reset = (documentId: string, text: string) => ({
    documentId,
    text,
    version: 7,
    dirty: false,
    filePath: PATH,
  });

  it('adopts the owner’s document, and MovedPathSync writes linkedTo into the layout', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'MINE\n', version: 1, absPath: PATH },
      withChrome: true,
      registerProject: true,
    });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe('MINE\n'));

    h.pushSync({ linkedTo: 'owner', reset: reset('owner', 'OWNERS\n') });

    await waitFor(() => expect(h.view().state.doc.toString()).toBe('OWNERS\n'));
    await waitFor(() => expect(h.savedPanelConfig()?.linkedTo).toBe('owner'));
  });

  it('writes the link away again when the authority unlinks, and the panel loads its own path', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'MINE\n', version: 1, absPath: PATH },
      withChrome: true,
      registerProject: true,
    });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe('MINE\n'));
    h.pushSync({ linkedTo: 'owner', reset: reset('owner', 'OWNERS\n') });
    await waitFor(() => expect(h.savedPanelConfig()?.linkedTo).toBe('owner'));

    // The owner moved away (an undo): no reset comes with it, and the panel reads what its path holds now.
    h.serve({ text: 'ON-DISK-NOW\n', version: 1, absPath: PATH });
    h.pushSync({ linkedTo: null });

    await waitFor(() => expect(h.calls.load).toHaveBeenCalled());
    await waitFor(() => expect(hasKey(h.savedPanelConfig(), 'linkedTo')).toBe(false));
    await waitFor(() => expect(h.view().state.doc.toString()).toBe('ON-DISK-NOW\n'));
  });

  it('becoming the owner (the owner panel closed) keeps the text and does not reload', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'MINE\n', version: 1, absPath: PATH },
      withChrome: true,
      registerProject: true,
    });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe('MINE\n'));
    h.pushSync({ linkedTo: 'owner', reset: reset('owner', 'OWNERS\n') });
    await waitFor(() => expect(h.savedPanelConfig()?.linkedTo).toBe('owner'));

    h.pushSync({ linkedTo: null, reset: reset(PANEL, 'OWNERS\n') });

    await waitFor(() => expect(hasKey(h.savedPanelConfig(), 'linkedTo')).toBe(false));
    expect(h.view().state.doc.toString()).toBe('OWNERS\n');
    expect(h.calls.load).not.toHaveBeenCalled();
  });
});
