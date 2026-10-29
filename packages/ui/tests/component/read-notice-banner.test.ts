/**
 * 059 FR-068 — the notice that tells the user how the document was read.
 *
 * After a Reopen with Encoding it says the reading lasts for this editor session only and how to fix the file,
 * with Change Encoding… and Dismiss. On a UTF-8 open that looks like misread Windows-1252 it says so, with
 * Reopen as Windows-1252 and Dismiss. Inline, never a toast, and the DOCUMENT's: main owns it and relays it
 * (`readNotice`) to every view, a remount reads it from `getContent`, and Dismiss asks main to clear it.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { removeEditorState } from '../../src/renderer/editor/editor-state.js';
import { removePanelLanguage } from '../../src/renderer/editor/editor-language.js';
import { __resetEncodingRefusals } from '../../src/renderer/editor/encoding-refusal-store.js';
import { __resetReadNotices } from '../../src/renderer/editor/read-notice-store.js';
import { mountEditor, type EditorDoc } from './helpers/mount-editor.js';

const PANEL = 'p-read';
const PATH = 'C:/proj/misread.txt';
const TEXT = 'one\ntwo\n';

const REOPENED = 'This file has been read as UTF-8 for this editor session only; the file is unchanged. To fix the file, change its encoding, verify, and save.';
const SUSPECT = 'This file may be Windows-1252 text read as UTF-8: some words mix letters from different scripts.';

afterEach(() => {
  removeEditorState(PANEL);
  removePanelLanguage(PANEL);
  __resetEncodingRefusals();
  __resetReadNotices();
  Reflect.deleteProperty(window, 'throng');
});

async function mount(doc: Partial<EditorDoc> = {}) {
  const h = mountEditor({ panelId: PANEL, doc: { text: TEXT, version: 1, absPath: PATH, ...doc } });
  await waitFor(() => expect(h.view().state.doc.toString()).toBe(TEXT));
  return h;
}

const notice = (): HTMLElement | null => screen.queryByTestId(`panel-failure-${PANEL}`);
const buttons = (): (string | null)[] => [...(notice()?.querySelectorAll('button') ?? [])].map((b) => b.textContent);

describe('the read notice (059 FR-068)', () => {
  it('after a reopen in UTF-8: the session-only wording, with Change Encoding… and Dismiss', async () => {
    const h = await mount({ encoding: 'utf8' });
    act(() => h.pushSync({ readNotice: { kind: 'reopened', readAs: 'utf8' } }));
    await waitFor(() => expect(notice()).toHaveTextContent(REOPENED));
    expect(buttons()).toEqual(['Change Encoding…', 'Dismiss']);
  });

  it('names the encoding it was read as', async () => {
    const h = await mount({ encoding: 'utf16le' });
    act(() => h.pushSync({ readNotice: { kind: 'reopened', readAs: 'utf16le' } }));
    await waitFor(() => expect(notice()).toHaveTextContent('read as UTF-16 LE for this editor session only'));
  });

  it('Change Encoding… opens the encoding list in Change Encoding mode', async () => {
    const h = await mount({ encoding: 'utf8' });
    act(() => h.pushSync({ readNotice: { kind: 'reopened', readAs: 'utf8' } }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change Encoding…' }));
    const picker = await screen.findByTestId(`encoding-picker-${PANEL}`);
    expect(picker).toHaveTextContent('Change Encoding');
  });

  it('on a suspect open: says it may be misread, with Reopen as Windows-1252 and Dismiss', async () => {
    const h = await mount({ readNotice: { kind: 'suspect', readAs: 'utf8', likely: 'windows1252' } });
    await waitFor(() => expect(notice()).toHaveTextContent(SUSPECT));
    expect(buttons()).toEqual(['Reopen as Windows-1252 (Western European)', 'Dismiss']);
    fireEvent.click(screen.getByRole('button', { name: 'Reopen as Windows-1252 (Western European)' }));
    await waitFor(() =>
      expect(h.calls.reopenWithEncoding).toHaveBeenCalledWith({ panelId: PANEL, encoding: 'windows1252' }),
    );
  });

  it('Dismiss asks main to clear it, and it goes when main relays that', async () => {
    const h = await mount({ readNotice: { kind: 'suspect', readAs: 'utf8', likely: 'windows1252' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(h.calls.dismissReadNotice).toHaveBeenCalledWith({ panelId: PANEL }));
    act(() => h.pushSync({ readNotice: null }));
    await waitFor(() => expect(notice()).toBeNull());
  });

  it('a refused save outranks it: one notice, the refusal', async () => {
    const h = await mount({ readNotice: { kind: 'suspect', readAs: 'utf8', likely: 'windows1252' } });
    await waitFor(() => expect(notice()).toHaveTextContent(SUSPECT));
    act(() => h.pushSync({ saveRefused: { encoding: 'windows1252', char: '\u{1F600}', line: 1, column: 1 } }));
    await waitFor(() => expect(buttons()).toEqual(['Save as UTF-8']));
    expect(document.querySelectorAll('[data-testid^="panel-failure-"]')).toHaveLength(1);
  });
});

describe('the read notice for a code page (059 FR-069)', () => {
  it('a UTF-8 suspect names the fallback code page it may be', async () => {
    await mount({ readNotice: { kind: 'suspect', readAs: 'utf8', likely: 'windows1251' } });
    await waitFor(() => expect(notice()).toHaveTextContent('This file may be Windows-1251 text read as UTF-8'));
    expect(buttons()).toEqual(['Reopen as Windows-1251 (Cyrillic)', 'Dismiss']);
  });

  it('names the likely code page, with Reopen as it, Reopen with Encoding… and Dismiss', async () => {
    const h = await mount({ encoding: 'windows1252', readNotice: { kind: 'suspect', readAs: 'windows1252', likely: 'windows1253' } });
    await waitFor(() =>
      expect(notice()).toHaveTextContent('This file was read as Windows-1252, but its text looks like Windows-1253 (Greek).'),
    );
    expect(buttons()).toEqual(['Reopen as Windows-1253 (Greek)', 'Reopen with Encoding…', 'Dismiss']);
    fireEvent.click(screen.getByRole('button', { name: 'Reopen as Windows-1253 (Greek)' }));
    await waitFor(() =>
      expect(h.calls.reopenWithEncoding).toHaveBeenCalledWith({ panelId: PANEL, encoding: 'windows1253' }),
    );
  });

  it('with no better guess, says it may be in another encoding and offers the list', async () => {
    await mount({ encoding: 'windows1252', readNotice: { kind: 'suspect', readAs: 'windows1252', likely: null } });
    await waitFor(() =>
      expect(notice()).toHaveTextContent('This file was read as Windows-1252, but its text may be in another encoding.'),
    );
    expect(buttons()).toEqual(['Reopen with Encoding…', 'Dismiss']);
    fireEvent.click(screen.getByRole('button', { name: 'Reopen with Encoding…' }));
    expect(await screen.findByTestId(`encoding-picker-${PANEL}`)).toHaveTextContent('Reopen with Encoding');
  });
});

describe('after a reopen, the remedies that make it open this way every time (059 FR-071)', () => {
  const GREEK = 'This file has been read as Windows-1253 (Greek) for this editor session only; the file is unchanged. To open it this way every time, convert it to UTF-8 and save, or make Windows-1253 (Greek) your fallback encoding in preferences.';

  it('a code page the fallback would read: the sentence names preferences, the actions are Convert to UTF-8 and Dismiss (FR-074)', async () => {
    const h = await mount({ encoding: 'windows1253' });
    act(() => h.pushSync({ readNotice: { kind: 'reopened', readAs: 'windows1253', fallbackHelps: true } }));
    await waitFor(() => expect(notice()).toHaveTextContent(GREEK));
    expect(buttons()).toEqual(['Convert to UTF-8', 'Dismiss']);
    expect(h.calls.changeEncoding).not.toHaveBeenCalled();
  });

  it('Convert to UTF-8 changes the document to UTF-8 without a BOM', async () => {
    const h = await mount({ encoding: 'windows1253' });
    act(() => h.pushSync({ readNotice: { kind: 'reopened', readAs: 'windows1253', fallbackHelps: true } }));
    fireEvent.click(await screen.findByRole('button', { name: 'Convert to UTF-8' }));
    await waitFor(() =>
      expect(h.calls.changeEncoding).toHaveBeenCalledWith({ panelId: PANEL, encoding: 'utf8', hasBom: false }),
    );
  });

  it('a file the fallback would not read this way (it is valid UTF-8) is offered Convert to UTF-8 only', async () => {
    const h = await mount({ encoding: 'windows1252' });
    act(() => h.pushSync({ readNotice: { kind: 'reopened', readAs: 'windows1252' } }));
    await waitFor(() =>
      expect(notice()).toHaveTextContent('read as Windows-1252 (Western European) for this editor session only; the file is unchanged. To open it this way every time, convert it to UTF-8 and save.'),
    );
    expect(buttons()).toEqual(['Convert to UTF-8', 'Dismiss']);
  });

  it('a UTF-16 reopen is offered Convert to UTF-8 only', async () => {
    const h = await mount({ encoding: 'utf16le' });
    act(() => h.pushSync({ readNotice: { kind: 'reopened', readAs: 'utf16le' } }));
    await waitFor(() => expect(notice()).toHaveTextContent('read as UTF-16 LE for this editor session only'));
    expect(buttons()).toEqual(['Convert to UTF-8', 'Dismiss']);
  });
});
