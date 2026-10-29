/**
 * 059 T019 — the save refusal for a character the document's encoding cannot hold (FR-021 … FR-023).
 *
 * One condition, one notice: an inline banner on the editor naming the encoding, the first unrepresentable
 * character and its line, with the one action that resolves it — Save as UTF-8. The refusal is the
 * DOCUMENT's state, so the authority owns it and relays it (`saveRefused`) to every view of the document; a
 * repeat refusal is relayed again and FLASHES the notice. The modal "Cannot save" dialog never speaks for
 * this reason.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createDefaultLayout } from '@throng/core';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { getEditorActions } from '../../src/renderer/editor/editor-actions.js';
import { removeEditorState } from '../../src/renderer/editor/editor-state.js';
import { removePanelLanguage } from '../../src/renderer/editor/editor-language.js';
import { EncodingSaveBanner } from '../../src/renderer/editor/encoding-save-banner.js';
import {
  __resetEncodingRefusals,
  applySaveRefusal,
} from '../../src/renderer/editor/encoding-refusal-store.js';
import { mountEditor } from './helpers/mount-editor.js';
import { mountWorkspace } from './helpers/mount-workspace.js';

const PANEL = 'p-enc';
const PATH = 'C:/proj/notes.txt';
const TEXT = 'one\ntwo\nthree \u{1F600}\n';

const REFUSED = { encoding: 'windows1252' as const, char: '\u{1F600}', line: 3, column: 7 };
const RESULT = { ok: false as const, reason: 'unrepresentable' as const, unrepresentable: REFUSED, error: 'unrepresentable' };

afterEach(() => {
  removeEditorState(PANEL);
  removePanelLanguage(PANEL);
  __resetEncodingRefusals();
  Reflect.deleteProperty(window, 'throng');
});

/** A mounted editor whose saves the authority refuses — answering the caller AND relaying the state. */
async function mountRefusing() {
  const h = mountEditor({
    panelId: PANEL,
    doc: { text: TEXT, version: 2, dirty: true, absPath: PATH, encoding: 'windows1252' },
    withNotices: true,
  });
  await waitFor(() => expect(h.view().state.doc.toString()).toBe(TEXT));
  h.calls.save.mockImplementation(() => {
    h.pushSync({ saveRefused: REFUSED });
    return Promise.resolve(RESULT);
  });
  return h;
}

async function refusedSave(): Promise<boolean | undefined> {
  let saved: boolean | undefined;
  await act(async () => {
    saved = await getEditorActions(PANEL)?.save();
  });
  return saved;
}

const banners = (): NodeListOf<Element> => document.querySelectorAll('[data-testid^="panel-failure-"]');

describe('the save refusal for an unrepresentable character (059 FR-022)', () => {
  it('a refused save raises ONE inline notice naming the encoding, the character and its line', async () => {
    await mountRefusing();
    expect(await refusedSave()).toBe(false);

    const notice = await screen.findByTestId(`panel-failure-${PANEL}`);
    expect(banners()).toHaveLength(1);
    expect(notice).toHaveTextContent('Windows-1252');
    expect(notice).toHaveTextContent('\u{1F600}');
    expect(notice).toHaveTextContent('line 3');
    // What is wrong, not what the user may not do.
    expect(notice.textContent ?? '').not.toMatch(/cannot save|can't save|you cannot/i);
    // The modal is never this reason's surface.
    expect(screen.queryByText('Cannot save')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('carries exactly one action, Save as UTF-8', async () => {
    await mountRefusing();
    await refusedSave();
    const notice = await screen.findByTestId(`panel-failure-${PANEL}`);
    const buttons = [...notice.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Save as UTF-8']);
  });

  it('a second refused save flashes the existing notice and raises no second one', async () => {
    await mountRefusing();
    await refusedSave();
    const notice = await screen.findByTestId(`panel-failure-${PANEL}`);
    expect(notice.getAttribute('data-flash')).toBe('0');

    await refusedSave();

    await waitFor(() =>
      expect(screen.getByTestId(`panel-failure-${PANEL}`).getAttribute('data-flash')).toBe('1'),
    );
    expect(banners()).toHaveLength(1);
    expect(screen.queryByText('Cannot save')).toBeNull();
  });

  it('Save as UTF-8 changes the encoding to UTF-8 without a BOM, then saves by the ordinary route (FR-055)', async () => {
    const h = await mountRefusing();
    await refusedSave();
    await screen.findByTestId(`panel-failure-${PANEL}`);
    const savesBefore = h.calls.save.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Save as UTF-8' }));

    await waitFor(() =>
      expect(h.calls.changeEncoding).toHaveBeenCalledWith({ panelId: PANEL, encoding: 'utf8', hasBom: false }),
    );
    await waitFor(() => expect(h.calls.save.mock.calls.length).toBe(savesBefore + 1));
    // The change comes first: the save must write the new encoding, not refuse again in the old one.
    expect(h.calls.changeEncoding.mock.invocationCallOrder[0]).toBeLessThan(
      h.calls.save.mock.invocationCallOrder.at(-1) ?? 0,
    );
  });

  it('goes when the authority clears the condition (a successful save, or an edit removing the character)', async () => {
    const h = await mountRefusing();
    await refusedSave();
    await screen.findByTestId(`panel-failure-${PANEL}`);

    act(() => h.pushSync({ saveRefused: null }));

    await waitFor(() => expect(screen.queryByTestId(`panel-failure-${PANEL}`)).toBeNull());
  });

  it('typing an unrepresentable character raises no notice — the save is the only moment it is reported', async () => {
    const h = await mountRefusing();
    const view = h.view();
    act(() => {
      view.dispatch({ changes: { from: 0, insert: '\u{1F601}' } });
    });
    expect(screen.queryByTestId(`panel-failure-${PANEL}`)).toBeNull();
  });

  it('a close whose Save is refused is not completed (FR-023)', async () => {
    const h = await mountRefusing();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await getEditorActions(PANEL)?.saveForClose();
    });
    expect(ok).toBe(false);
    expect(h.calls.save).toHaveBeenCalledTimes(1);
    await screen.findByTestId(`panel-failure-${PANEL}`);
    expect(h.view().state.doc.toString()).toBe(TEXT);
  });
});

describe('the save payload names no line ending (059 T016)', () => {
  it('a save sends no lineEnding: the authority encodes with the format it owns', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'a\r\nb', version: 1, dirty: true, absPath: PATH, lineEnding: 'crlf' },
    });
    await waitFor(() => expect(h.view().state.doc.toString()).not.toBe(''));
    await act(async () => {
      await getEditorActions(PANEL)?.save();
    });
    expect(h.calls.save).toHaveBeenCalledTimes(1);
    expect(h.calls.save.mock.calls[0]?.[0]).not.toHaveProperty('lineEnding');
  });
});

describe('every view the refusal is relayed to shows it (059 FR-022, Principle XI)', () => {
  const OTHER = 'p-enc-2';

  it('two views each show the notice, and a repeat flashes both', async () => {
    act(() => {
      applySaveRefusal(PANEL, REFUSED);
      applySaveRefusal(OTHER, REFUSED);
    });
    const ws = await mountWorkspace(createDefaultLayout('proj-1', { tab: 't1', panel: PANEL }), {
      extras: [
        createElement(EncodingSaveBanner, { key: 'a', panelId: PANEL }),
        createElement(EncodingSaveBanner, { key: 'b', panelId: OTHER }),
        createElement(EncodingSaveBanner, { key: 'c', panelId: 'p-elsewhere' }),
      ],
    });
    expect(screen.getByTestId(`panel-failure-${PANEL}`)).toHaveTextContent('Windows-1252');
    expect(screen.getByTestId(`panel-failure-${OTHER}`)).toHaveTextContent('Windows-1252');
    expect(screen.queryByTestId('panel-failure-p-elsewhere')).toBeNull();

    act(() => {
      applySaveRefusal(PANEL, REFUSED);
      applySaveRefusal(OTHER, REFUSED);
    });
    expect(screen.getByTestId(`panel-failure-${PANEL}`).getAttribute('data-flash')).toBe('1');
    expect(screen.getByTestId(`panel-failure-${OTHER}`).getAttribute('data-flash')).toBe('1');
    ws.unmount();
  });
});
