/**
 * 059 T027, T063 — the encoding indicator, its menu and the encoding picker (FR-024 … FR-026, FR-030 … FR-034,
 * FR-055, FR-056, SC-006).
 *
 * The indicator is on EVERY editor panel, whatever the encoding (clarification 1), names the encoding in
 * FR-031's words, and is a named button rather than a glyph (#282). Its menu lists every supported encoding
 * with the current one marked, then Reopen with Encoding… last (FR-055, FR-056). Choosing an encoding is
 * Change Encoding — the document changes, nothing is written — so it calls `changeEncoding`, never a save.
 * Reopen asks first on a dirty document and is unavailable without a file on disk.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ENCODING_CHOICES } from '@throng/core';
import { removeEditorState } from '../../src/renderer/editor/editor-state.js';
import { removePanelLanguage } from '../../src/renderer/editor/editor-language.js';
import { __resetDocumentFormats } from '../../src/renderer/editor/document-format-store.js';
import { mountEditor, type EditorDoc } from './helpers/mount-editor.js';

const PANEL = 'p-enc-strip';
const PATH = 'C:/proj/notes.txt';

afterEach(() => {
  removeEditorState(PANEL);
  removePanelLanguage(PANEL);
  __resetDocumentFormats();
  Reflect.deleteProperty(window, 'throng');
});

async function mount(doc: Partial<EditorDoc> = {}, opts: { keybindings?: Record<string, string[]> } = {}) {
  const h = mountEditor({
    panelId: PANEL,
    doc: { text: 'hello\n', version: 1, absPath: PATH, ...doc },
    ...opts,
  });
  await waitFor(() => expect(h.view().state.doc.toString()).toBe(doc.text ?? 'hello\n'));
  if (opts.keybindings) await waitFor(() => expect(h.settingsLoaded()).toBe(true));
  return h;
}

const indicator = (): HTMLElement => screen.getByTestId(`editor-encoding-${PANEL}`);
const optionId = (c: { encoding: string; hasBom: boolean }): string =>
  `menu-item-encoding-${c.encoding}${c.hasBom ? '-bom' : ''}`;
const menuRows = (): string[] =>
  [...document.querySelectorAll('[data-testid="context-menu"] > [data-testid^="menu-item-"]')].map(
    (r) => r.getAttribute('data-testid') ?? '',
  );

describe('the encoding indicator (059 FR-030, FR-031)', () => {
  it('is on a UTF-8 document without a BOM, named "encoding: UTF-8"', async () => {
    await mount();
    expect(indicator()).toHaveTextContent('UTF-8');
    expect(screen.getByRole('button', { name: 'encoding: UTF-8' })).toBe(indicator());
  });

  it('names a BOM and the UTF-16 byte orders in FR-031’s words', async () => {
    await mount({ encoding: 'utf8', hasBom: true });
    expect(indicator()).toHaveTextContent('UTF-8 with BOM');
    expect(indicator()).toHaveAccessibleName('encoding: UTF-8 with BOM');
  });

  it('names a code page with its script in brackets (FR-073)', async () => {
    await mount({ encoding: 'windows1253', hasBom: false });
    expect(indicator()).toHaveTextContent(/^Windows-1253 \(Greek\)$/);
    expect(indicator()).toHaveAccessibleName('encoding: Windows-1253 (Greek)');
  });

  it('follows the authority’s relay at once (FR-034)', async () => {
    const h = await mount();
    act(() => h.pushSync({ encoding: 'utf16le', hasBom: true }));
    await waitFor(() => expect(indicator()).toHaveTextContent('UTF-16 LE'));
    expect(indicator()).toHaveAccessibleName('encoding: UTF-16 LE');
  });

  it('follows a Change Encoding (or its undo) carried on the canonical stream', async () => {
    const h = await mount();
    act(() =>
      h.pushSync({
        change: {
          documentId: PANEL,
          kind: 'undo',
          changes: [6],
          version: 2,
          dirty: false,
          origin: 'another-view',
          encoding: { encoding: 'windows1252', hasBom: false },
        },
      }),
    );
    await waitFor(() => expect(indicator()).toHaveTextContent('Windows-1252 (Western European)'));
  });

  it('is a named control with a hover title naming Change Encoding, not a glyph (#282)', async () => {
    await mount();
    expect(indicator().tagName).toBe('BUTTON');
    expect(indicator().getAttribute('title')).toMatch(/change encoding/i);
    expect((indicator().textContent ?? '').trim().length).toBeGreaterThan(1);
  });
});

describe('the encoding menu (059 FR-055, FR-056)', () => {
  it('lists every supported encoding with the current one marked, then Reopen with Encoding… last', async () => {
    await mount({ encoding: 'utf16be', hasBom: true });
    fireEvent.click(indicator());
    await screen.findByTestId('menu-item-Reopen with Encoding…');
    // FR-070: the Unicode rows, then the Windows Code Pages submenu, then Reopen.
    const unicode = ENCODING_CHOICES.filter((c) => c.group === 'unicode');
    expect(menuRows()).toEqual([...unicode.map(optionId), 'menu-item-encoding-codepages', 'menu-item-Reopen with Encoding…']);
    expect(screen.getByTestId('menu-item-encoding-codepages').querySelector('.context-menu__label')?.textContent).toBe('Windows Code Pages');
    for (const c of unicode) {
      const row = screen.getByTestId(optionId(c));
      const current = c.encoding === 'utf16be' && c.hasBom;
      // Exact: a code page's label carries its script in brackets, so a plain substring match would pass a tick.
      expect(row.textContent).toBe(current ? `${c.label} ✓` : c.label);
    }
    // Change Encoding is not a save: there is no Save with Encoding any more.
    expect(screen.queryByTestId('menu-item-Save with Encoding…')).toBeNull();
  });

  it('choosing an encoding changes the document’s encoding with that entry’s BOM, writing nothing (FR-055)', async () => {
    const h = await mount();
    fireEvent.click(indicator());
    fireEvent.click(await screen.findByTestId('menu-item-encoding-utf16le-bom'));
    await waitFor(() =>
      expect(h.calls.changeEncoding).toHaveBeenCalledWith({ panelId: PANEL, encoding: 'utf16le', hasBom: true }),
    );
    expect(h.calls.save).not.toHaveBeenCalled();
  });

  it('choosing the current encoding is a no-op (FR-055)', async () => {
    const h = await mount();
    fireEvent.click(indicator());
    fireEvent.click(await screen.findByTestId('menu-item-encoding-utf8'));
    await act(async () => {});
    expect(h.calls.changeEncoding).not.toHaveBeenCalled();
  });

  it('an UNTITLED document changes encoding too — no location is asked for until it is saved', async () => {
    const h = await mount({ absPath: null, dirty: true });
    fireEvent.click(indicator());
    fireEvent.click(await screen.findByTestId('menu-item-encoding-codepages'));
    fireEvent.click(await screen.findByTestId('menu-item-encoding-windows1252'));
    await waitFor(() =>
      expect(h.calls.changeEncoding).toHaveBeenCalledWith({ panelId: PANEL, encoding: 'windows1252', hasBom: false }),
    );
    expect(h.calls.chooseSavePath).not.toHaveBeenCalled();
  });

  it('the Change Encoding command opens the encoding list as a picker, the current one marked (FR-058)', async () => {
    const h = await mount({ encoding: 'windows1252' }, { keybindings: { 'editor.changeEncoding': ['Ctrl+Alt+E'] } });
    fireEvent.keyDown(h.content(), { key: 'e', code: 'KeyE', ctrlKey: true, altKey: true });
    const picker = await screen.findByTestId(`encoding-picker-${PANEL}`);
    expect(picker).toHaveAttribute('data-mode', 'change');
    const options = [...picker.querySelectorAll('[role="option"]')];
    expect(options.map((o) => o.textContent)).toEqual(ENCODING_CHOICES.map((c) => c.label));
    expect(options.filter((o) => o.getAttribute('aria-selected') === 'true').map((o) => o.textContent)).toEqual([
      'Windows-1252 (Western European)',
    ]);
    fireEvent.click(screen.getByTestId('encoding-option-utf8-bom'));
    await waitFor(() =>
      expect(h.calls.changeEncoding).toHaveBeenCalledWith({ panelId: PANEL, encoding: 'utf8', hasBom: true }),
    );
    await waitFor(() => expect(screen.queryByTestId(`encoding-picker-${PANEL}`)).toBeNull());
  });
});

describe('Reopen with Encoding… (059 FR-024 … FR-026, FR-056)', () => {
  it('re-reads a clean document in the chosen encoding, unasked (FR-024)', async () => {
    const h = await mount();
    fireEvent.click(indicator());
    fireEvent.click(await screen.findByTestId('menu-item-Reopen with Encoding…'));
    fireEvent.click(await screen.findByTestId('encoding-option-windows1252'));
    await waitFor(() =>
      expect(h.calls.reopenWithEncoding).toHaveBeenCalledWith({ panelId: PANEL, encoding: 'windows1252' }),
    );
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('on a DIRTY document asks first, and Cancel changes nothing (FR-025)', async () => {
    const h = await mount({ dirty: true });
    fireEvent.click(indicator());
    fireEvent.click(await screen.findByTestId('menu-item-Reopen with Encoding…'));
    fireEvent.click(await screen.findByTestId('encoding-option-windows1252'));

    fireEvent.click(await screen.findByTestId('confirm-cancel'));
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect(h.calls.reopenWithEncoding).not.toHaveBeenCalled();
    expect(h.view().state.doc.toString()).toBe('hello\n');
  });

  it('on a DIRTY document, discarding reopens', async () => {
    const h = await mount({ dirty: true });
    fireEvent.click(indicator());
    fireEvent.click(await screen.findByTestId('menu-item-Reopen with Encoding…'));
    fireEvent.click(await screen.findByTestId('encoding-option-utf8'));
    fireEvent.click(await screen.findByTestId('confirm-accept'));
    await waitFor(() =>
      expect(h.calls.reopenWithEncoding).toHaveBeenCalledWith({ panelId: PANEL, encoding: 'utf8' }),
    );
  });

  it('is unavailable for a document with no file on disk (FR-026)', async () => {
    await mount({ absPath: null });
    fireEvent.click(indicator());
    const reopen = await screen.findByTestId('menu-item-Reopen with Encoding…');
    expect(reopen).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('the encoding lists are grouped: Unicode, then Windows Code Pages (059 FR-069, FR-070)', () => {
  it('the Windows Code Pages submenu is ticked when the document is in one, and its flyout lists all nine', async () => {
    await mount({ encoding: 'windows1253' });
    fireEvent.click(indicator());
    const sub = await screen.findByTestId('menu-item-encoding-codepages');
    expect(sub.querySelector('.context-menu__label')?.textContent).toBe('Windows Code Pages ✓');
    fireEvent.click(sub);
    await waitFor(() => expect(sub.querySelector('ul')).not.toBeNull());
    const rows = [...(sub.querySelector('ul')?.children ?? [])].map((r) => r.getAttribute('data-testid')).filter(Boolean);
    expect(rows).toEqual(ENCODING_CHOICES.filter((c) => c.group === 'codepage').map(optionId));
    expect(screen.getByTestId('menu-item-encoding-windows1253').textContent).toBe('Windows-1253 (Greek) ✓');
    fireEvent.click(screen.getByTestId('menu-item-encoding-windows1251'));
    await waitFor(() => expect(screen.queryByTestId('context-menu')).toBeNull());
  });

  it('a Unicode document leaves the submenu unticked', async () => {
    await mount();
    fireEvent.click(indicator());
    expect((await screen.findByTestId('menu-item-encoding-codepages')).querySelector('.context-menu__label')?.textContent).toBe('Windows Code Pages');
  });

  it('the Reopen picker lists one row per encoding, code pages with their script, the file’s marked', async () => {
    await mount({ encoding: 'windows1251' });
    fireEvent.click(indicator());
    fireEvent.click(await screen.findByTestId('menu-item-Reopen with Encoding…'));
    const picker = await screen.findByTestId(`encoding-picker-${PANEL}`);
    const options = [...picker.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(options.slice(0, 4)).toEqual(['UTF-8', 'UTF-16 LE', 'UTF-16 BE', 'Windows-1250 (Central European)']);
    expect(options).toHaveLength(12);
    expect(picker.querySelector('[aria-selected="true"]')).toHaveTextContent('Windows-1251 (Cyrillic)');
    // One flat keyboard list, under two headings that are not options.
    expect([...picker.querySelectorAll('.encoding-picker__heading')].map((h) => h.textContent)).toEqual([
      'Unicode',
      'Windows Code Pages',
    ]);
  });
});
