/**
 * 059 T028, T063 — the editor content menu's Encoding and Line Endings items (FR-033, FR-041, FR-055 … FR-058,
 * FR-061, SC-006).
 *
 * Two items in the `viewState` section beside Set Language, each naming the current state and holding the
 * indicator's own list: **Encoding** — every encoding, the current one marked, then Reopen with Encoding…;
 * **Line Endings** — LF, CR, CRLF and Mixed (never selectable), then Insert Line Break (LF) / (CR) / (CRLF).
 * They are the route that survives a hidden status bar, and each command runs from its chord once bound.
 */
import { EditorSelection } from '@codemirror/state';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ENCODING_CHOICES } from '@throng/core';
import { removeEditorState } from '../../src/renderer/editor/editor-state.js';
import { removePanelLanguage } from '../../src/renderer/editor/editor-language.js';
import { __resetDocumentFormats } from '../../src/renderer/editor/document-format-store.js';
import {
  encodingMenuItems,
  insertLineBreakItems,
  lineEndingMenuItems,
} from '../../src/renderer/editor/content-menu.js';
import { mountEditor } from './helpers/mount-editor.js';

const PANEL = 'p-enc-menu';
const PATH = 'C:/proj/notes.txt';

afterEach(() => {
  removeEditorState(PANEL);
  removePanelLanguage(PANEL);
  __resetDocumentFormats();
  Reflect.deleteProperty(window, 'throng');
});

async function mount(opts: { settings?: Record<string, unknown>; keybindings?: Record<string, string[]> } = {}) {
  const h = mountEditor({
    panelId: PANEL,
    doc: { text: 'hello\n', version: 1, absPath: PATH, encoding: 'windows1252', lineEnding: 'crlf' },
    ...opts,
  });
  await waitFor(() => expect(h.view().state.doc.toString()).toBe('hello\n'));
  if (opts.settings || opts.keybindings) await waitFor(() => expect(h.settingsLoaded()).toBe(true));
  return h;
}

const ENCODING_ROWS = [
  // FR-070: the Unicode rows, the Windows Code Pages submenu, Reopen.
  ...ENCODING_CHOICES.filter((c) => c.group === 'unicode').map((c) => `menu-item-encoding-${c.encoding}${c.hasBom ? '-bom' : ''}`),
  'menu-item-encoding-codepages',
  'menu-item-Reopen with Encoding…',
];
const LINE_ENDING_ROWS = [
  'menu-item-line-ending-lf',
  'menu-item-line-ending-cr',
  'menu-item-line-ending-crlf',
  'menu-item-line-ending-mixed',
  'menu-item-insert-line-break-lf',
  'menu-item-insert-line-break-cr',
  'menu-item-insert-line-break-crlf',
];

/** The rows of the flyout a parent item opened — its own `ul`, not the root's. */
const submenuRows = (parent: HTMLElement): string[] =>
  [...(parent.querySelector('ul')?.children ?? [])]
    .map((r) => r.getAttribute('data-testid'))
    .filter((id): id is string => id !== null);

async function openSubmenu(h: Awaited<ReturnType<typeof mount>>, testId: string): Promise<HTMLElement> {
  fireEvent.contextMenu(h.content());
  const parent = await screen.findByTestId(testId);
  fireEvent.click(parent);
  await waitFor(() => expect(parent.querySelector('ul')).not.toBeNull());
  return parent;
}

describe('the builders (059 FR-055, FR-057, FR-061)', () => {
  it('every row declares the viewState section', () => {
    const items = [
      ...encodingMenuItems({
        current: { encoding: 'utf8', hasBom: false },
        canReopen: true,
        change: () => {},
        openReopenPicker: () => {},
      }),
      ...lineEndingMenuItems({ lineEnding: 'lf', mixed: false, convert: () => {} }),
      ...insertLineBreakItems({ insert: () => {} }),
    ];
    expect(items.map((i) => i.testId)).toEqual([...ENCODING_ROWS, ...LINE_ENDING_ROWS]);
    for (const item of items) expect(item.section).toBe('viewState');
  });
});

describe('the Encoding and Line Endings items (059 FR-058)', () => {
  it('sit beside Set Language, each naming the current state', async () => {
    const h = await mount();
    fireEvent.contextMenu(h.content());
    expect(await screen.findByTestId('menu-item-Encoding')).toHaveTextContent('Encoding (Windows-1252)');
    expect(screen.getByTestId('menu-item-Line Endings')).toHaveTextContent('Line Endings (CRLF)');
    const rows = [...document.querySelectorAll('[data-testid="context-menu"] > [data-testid^="menu-item-"]')].map((r) =>
      r.getAttribute('data-testid'),
    );
    const lang = rows.indexOf('menu-item-Set Language…');
    expect(lang).toBeGreaterThanOrEqual(0);
    const enc = rows.indexOf('menu-item-Encoding');
    expect(enc).toBeGreaterThan(lang);
    expect(rows[enc + 1]).toBe('menu-item-Line Endings');
    // The round-1 items are gone: Save with Encoding (superseded by FR-055) and the two Convert items (FR-058).
    expect(screen.queryByTestId('menu-item-Save with Encoding…')).toBeNull();
    expect(screen.queryByTestId('menu-item-Convert to LF')).toBeNull();
  });

  it('Encoding holds the indicator’s list, current marked, Reopen with Encoding… last', async () => {
    const h = await mount();
    const parent = await openSubmenu(h, 'menu-item-Encoding');
    expect(submenuRows(parent)).toEqual(ENCODING_ROWS);
    const pages = screen.getByTestId('menu-item-encoding-codepages');
    expect(pages.querySelector('.context-menu__label')?.textContent).toBe('Windows Code Pages ✓');
    fireEvent.click(pages);
    expect(await screen.findByTestId('menu-item-encoding-windows1252')).toHaveTextContent('Windows-1252 (Western European) ✓');
    fireEvent.click(screen.getByTestId('menu-item-encoding-utf16le-bom'));
    await waitFor(() =>
      expect(h.calls.changeEncoding).toHaveBeenCalledWith({ panelId: PANEL, encoding: 'utf16le', hasBom: true }),
    );
  });

  it('Line Endings holds LF / CR / CRLF / Mixed then Insert Line Break (LF) / (CR) / (CRLF)', async () => {
    const h = await mount();
    const parent = await openSubmenu(h, 'menu-item-Line Endings');
    expect(submenuRows(parent)).toEqual(LINE_ENDING_ROWS);
    expect(screen.getByTestId('menu-item-line-ending-crlf')).toHaveTextContent('CRLF ✓');
    expect(screen.getByTestId('menu-item-line-ending-mixed')).toHaveAttribute('aria-disabled', 'true');
    // The key binder's labels, so the menu and the bindings editor name the command alike.
    expect(screen.getByTestId('menu-item-insert-line-break-cr')).toHaveTextContent(/^Insert Line Break \(CR\)$/);
  });

  const CHORDS = {
    'editor.changeEncoding': ['Ctrl+Alt+E'],
    'editor.reopenWithEncoding': ['Ctrl+Alt+R'],
    'editor.convertLineEndingsToLf': ['Ctrl+Alt+L'],
    'editor.convertLineEndingsToCr': ['Ctrl+Alt+M'],
    'editor.convertLineEndingsToCrlf': ['Ctrl+Alt+K'],
    'editor.insertLineBreakCrlf': ['Ctrl+Alt+J'],
  };

  it('shows the encoding commands’ chords once bound (FR-041, FR-058)', async () => {
    const h = await mount({ keybindings: CHORDS });
    const enc = await openSubmenu(h, 'menu-item-Encoding');
    expect(enc.querySelector('.context-menu__shortcut')).toHaveTextContent('Ctrl+Alt+E');
    expect(screen.getByTestId('menu-item-Reopen with Encoding…')).toHaveTextContent('Ctrl+Alt+R');
  });

  it('shows the line-ending commands’ chords once bound (FR-041, FR-058)', async () => {
    const h = await mount({ keybindings: CHORDS });
    await openSubmenu(h, 'menu-item-Line Endings');
    expect(screen.getByTestId('menu-item-line-ending-lf')).toHaveTextContent('Ctrl+Alt+L');
    expect(screen.getByTestId('menu-item-line-ending-cr')).toHaveTextContent('Ctrl+Alt+M');
    expect(screen.getByTestId('menu-item-line-ending-crlf')).toHaveTextContent('Ctrl+Alt+K');
    expect(screen.getByTestId('menu-item-insert-line-break-crlf')).toHaveTextContent('Ctrl+Alt+J');
  });
});

describe('Insert Line Break (059 FR-061)', () => {
  it('from the menu: a line break at the caret, dispatched with its chosen ending', async () => {
    const h = await mount();
    await openSubmenu(h, 'menu-item-Line Endings');
    fireEvent.click(screen.getByTestId('menu-item-insert-line-break-lf'));
    await waitFor(() =>
      expect(h.dispatched).toContainEqual(expect.objectContaining({ insertedLineEnding: 'lf' })),
    );
    expect(h.view().state.doc.lines).toBe(3);
  });

  it('from its chord: replaces EACH selection with a break, as one change carrying that ending', async () => {
    const h = await mount({ keybindings: { 'editor.insertLineBreakCr': ['Ctrl+Alt+J'] } });
    const view = h.view();
    act(() => {
      view.dispatch({
        selection: EditorSelection.create([EditorSelection.range(1, 3), EditorSelection.cursor(5)]),
      });
    });
    const before = h.dispatched.length;
    fireEvent.keyDown(h.content(), { key: 'j', code: 'KeyJ', ctrlKey: true, altKey: true });
    await waitFor(() => expect(h.dispatched.length).toBe(before + 1));
    expect(view.state.doc.toString()).toBe('h\nlo\n\n');
    const msg = h.dispatched.at(-1) as { insertedLineEnding?: string; mergeClass?: unknown };
    expect(msg.insertedLineEnding).toBe('cr');
    // A command is its own undo step: it never merges into a typing run (FR-026).
    expect(msg.mergeClass ?? null).toBeNull();
  });

  it('an ordinary edit carries no inserted ending — Enter keeps the dominant one', async () => {
    const h = await mount();
    act(() => {
      h.view().dispatch({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' });
    });
    await waitFor(() => expect(h.dispatched.length).toBeGreaterThan(0));
    expect(h.dispatched.at(-1)).not.toHaveProperty('insertedLineEnding');
  });
});

describe('the commands run from their chords once bound (059 FR-041, FR-058)', () => {
  it('Convert to CR converts; Convert to LF converts', async () => {
    const h = await mount({
      keybindings: { 'editor.convertLineEndingsToCr': ['Ctrl+Alt+M'], 'editor.convertLineEndingsToLf': ['Ctrl+Alt+L'] },
    });
    fireEvent.keyDown(h.content(), { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true });
    await waitFor(() => expect(h.calls.convertLineEndings).toHaveBeenCalledWith({ panelId: PANEL, target: 'cr' }));
    fireEvent.keyDown(h.content(), { key: 'l', code: 'KeyL', ctrlKey: true, altKey: true });
    await waitFor(() => expect(h.calls.convertLineEndings).toHaveBeenCalledWith({ panelId: PANEL, target: 'lf' }));
  });

  it('Reopen with Encoding opens the picker in reopen mode', async () => {
    const h = await mount({ keybindings: { 'editor.reopenWithEncoding': ['Ctrl+Alt+R'] } });
    fireEvent.keyDown(h.content(), { key: 'r', code: 'KeyR', ctrlKey: true, altKey: true });
    expect(await screen.findByTestId(`encoding-picker-${PANEL}`)).toHaveAttribute('data-mode', 'reopen');
  });
});

describe('a hidden status bar strands nothing (059 FR-033, SC-006)', () => {
  it('the Encoding list is there with editor.showStatusBar off, and changes the encoding', async () => {
    const h = await mount({ settings: { editor: { showStatusBar: false } } });
    expect(screen.queryByTestId(`editor-status-strip-${PANEL}`)).toBeNull();
    await openSubmenu(h, 'menu-item-Encoding');
    fireEvent.click(screen.getByTestId('menu-item-encoding-utf8'));
    await waitFor(() =>
      expect(h.calls.changeEncoding).toHaveBeenCalledWith({ panelId: PANEL, encoding: 'utf8', hasBom: false }),
    );
  });

  it('Change Encoding from its chord reveals the strip for the picker', async () => {
    const h = await mount({
      settings: { editor: { showStatusBar: false } },
      keybindings: { 'editor.changeEncoding': ['Ctrl+Alt+E'] },
    });
    fireEvent.keyDown(h.content(), { key: 'e', code: 'KeyE', ctrlKey: true, altKey: true });
    const picker = await screen.findByTestId(`encoding-picker-${PANEL}`);
    expect(picker.querySelector('[aria-selected="true"]')?.textContent).toBe('Windows-1252 (Western European)');
  });

  it('LF converts with the status bar hidden', async () => {
    const h = await mount({ settings: { editor: { showStatusBar: false } } });
    await openSubmenu(h, 'menu-item-Line Endings');
    fireEvent.click(screen.getByTestId('menu-item-line-ending-lf'));
    await waitFor(() =>
      expect(h.calls.convertLineEndings).toHaveBeenCalledWith({ panelId: PANEL, target: 'lf' }),
    );
  });
});
