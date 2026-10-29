/**
 * 059 T065 — View Whitespace (FR-059, FR-060, US6).
 *
 * A per-PANEL toggle, off by default, whose default comes from `editor.defaultShowWhitespace` and whose own
 * choice is persisted with the panel (`EditorPanelConfig.showWhitespace`). It is on the status strip beside
 * the wrap toggle — inside the measured group, so width never hides it (040 FR-024) — and in the content
 * menu, and it is a command. On, the view draws a symbol for each space and tab, a line-break symbol that
 * names THAT line's own ending, a visible mark for VT, FF, ESC, every other C0 control and U+FEFF, and a
 * BOM mark before the first character of a document with a BOM. Decoration only: nothing enters the document.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { removeEditorState } from '../../src/renderer/editor/editor-state.js';
import { removePanelLanguage } from '../../src/renderer/editor/editor-language.js';
import { __resetDocumentFormats } from '../../src/renderer/editor/document-format-store.js';
import {
  __resetPanelWhitespace,
  panelWhitespace,
  setPanelWhitespace,
} from '../../src/renderer/editor/view-whitespace.js';
import { mountEditor, type EditorDoc } from './helpers/mount-editor.js';

const PANEL = 'p-ws';
const PATH = 'C:/proj/notes.txt';

afterEach(() => {
  removeEditorState(PANEL);
  removePanelLanguage(PANEL);
  __resetDocumentFormats();
  __resetPanelWhitespace();
  Reflect.deleteProperty(window, 'throng');
});

async function mount(
  opts: {
    doc?: Partial<EditorDoc>;
    settings?: Record<string, unknown>;
    keybindings?: Record<string, string[]>;
    panelConfig?: Record<string, unknown>;
  } = {},
) {
  const text = opts.doc?.text ?? 'a b\n';
  const h = mountEditor({
    panelId: PANEL,
    doc: { text, version: 1, absPath: PATH, ...opts.doc },
    settings: opts.settings,
    keybindings: opts.keybindings,
    panelConfig: opts.panelConfig,
  });
  await waitFor(() => expect(h.view().state.doc.toString()).toBe(text));
  if (opts.settings || opts.keybindings) await waitFor(() => expect(h.settingsLoaded()).toBe(true));
  return h;
}

const toggle = (): HTMLElement => screen.getByTestId(`editor-whitespace-${PANEL}`);
const editorRoot = (): HTMLElement => document.querySelector<HTMLElement>('.cm-editor')!;
const marks = (cls: string): HTMLElement[] => [...editorRoot().querySelectorAll<HTMLElement>(`.${cls}`)];
/** The name a marker shows on hover (FR-065), carried as data for the popover (FR-067). */
const wsName = (e: HTMLElement): string | undefined => e.dataset.wsName;

describe('the status-strip toggle (059 FR-059)', () => {
  it('sits immediately after the wrap toggle, inside the group width never hides, off by default', async () => {
    await mount();
    const wrap = screen.getByTestId(`editor-word-wrap-${PANEL}`);
    expect(wrap.nextElementSibling).toBe(toggle());
    expect(screen.getByTestId(`editor-status-fixed-${PANEL}`)).toContainElement(toggle());
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(marks('cm-ws-space')).toHaveLength(0);
  });

  it('is a themeable icon control named for its action', async () => {
    await mount();
    expect(toggle().tagName).toBe('BUTTON');
    expect(toggle()).toHaveAttribute('title', 'View Whitespace');
    expect(toggle()).toHaveAccessibleName('View Whitespace');
    expect(toggle().querySelector('.icon')).not.toBeNull();
  });

  it('names its chord in the title once bound', async () => {
    await mount({ keybindings: { 'editor.toggleWhitespace': ['Ctrl+Alt+W'] } });
    expect(toggle()).toHaveAttribute('title', 'View Whitespace (Ctrl+Alt+W)');
  });

  it('turns the symbols on and off, and persists the panel’s choice with the panel', async () => {
    const h = await mount();
    fireEvent.click(toggle());
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-pressed', 'true'));
    expect(marks('cm-ws-space')).toHaveLength(1);
    await waitFor(() => expect(h.savedPanelConfig()?.showWhitespace).toBe(true));

    fireEvent.click(toggle());
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-pressed', 'false'));
    expect(marks('cm-ws-space')).toHaveLength(0);
    await waitFor(() => expect(h.savedPanelConfig()?.showWhitespace).toBe(false));
  });
});

describe('its default and its persistence (059 FR-059, FR-060)', () => {
  it('a panel that has not chosen follows editor.defaultShowWhitespace', async () => {
    await mount({ settings: { editor: { defaultShowWhitespace: true } } });
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-pressed', 'true'));
    expect(marks('cm-ws-space')).toHaveLength(1);
  });

  it('a panel’s own persisted choice wins over the preference, both ways (restart, US6 AC4)', async () => {
    await mount({ panelConfig: { showWhitespace: true } });
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(marks('cm-ws-space')).toHaveLength(1);
  });

  it('a panel that chose OFF stays off with the preference on', async () => {
    await mount({ settings: { editor: { defaultShowWhitespace: true } }, panelConfig: { showWhitespace: false } });
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(marks('cm-ws-space')).toHaveLength(0);
  });

  it('is per PANEL: one panel’s choice is not another’s (US6 AC3)', () => {
    setPanelWhitespace('panel-a', true);
    expect(panelWhitespace('panel-a', false)).toBe(true);
    expect(panelWhitespace('panel-b', false)).toBe(false);
  });
});

describe('the content menu item and the command (059 FR-058, FR-059)', () => {
  it('View Whitespace is in View State after Word Wrap, checked while on, and toggles', async () => {
    const h = await mount({ keybindings: { 'editor.toggleWhitespace': ['Ctrl+Alt+W'] } });
    fireEvent.contextMenu(h.content());
    const item = await screen.findByTestId('menu-item-View Whitespace');
    expect(item).toHaveTextContent(/^View Whitespace\s*\(Ctrl\+Alt\+W\)$/);
    const rows = [...document.querySelectorAll('[data-testid="context-menu"] > [data-testid^="menu-item-"]')].map((r) =>
      r.getAttribute('data-testid'),
    );
    expect(rows.indexOf('menu-item-View Whitespace')).toBe(rows.indexOf('menu-item-Word Wrap') + 1);
    fireEvent.click(item);
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-pressed', 'true'));

    fireEvent.contextMenu(h.content());
    expect(await screen.findByTestId('menu-item-View Whitespace')).toHaveTextContent('View Whitespace ✓');
  });

  it('the command toggles it from its chord', async () => {
    const h = await mount({ keybindings: { 'editor.toggleWhitespace': ['Ctrl+Alt+W'] } });
    fireEvent.keyDown(h.content(), { key: 'w', code: 'KeyW', ctrlKey: true, altKey: true });
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-pressed', 'true'));
  });

  it('works with the status bar hidden', async () => {
    const h = await mount({ settings: { editor: { showStatusBar: false } } });
    fireEvent.contextMenu(h.content());
    fireEvent.click(await screen.findByTestId('menu-item-View Whitespace'));
    await waitFor(() => expect(marks('cm-ws-space')).toHaveLength(1));
  });
});

describe('what it draws (059 FR-059, US6 AC2)', () => {
  const ON = { panelConfig: { showWhitespace: true } };

  it('a symbol for each space and each tab', async () => {
    await mount({ ...ON, doc: { text: 'a  b\tc\t\n' } });
    expect(marks('cm-ws-space')).toHaveLength(2);
    expect(marks('cm-ws-tab')).toHaveLength(2);
  });

  it('a line-break symbol on every line that has one, naming a uniform document’s ending', async () => {
    await mount({ ...ON, doc: { text: 'a\nb\nc', lineEnding: 'crlf' } });
    const eols = marks('cm-ws-eol');
    expect(eols.map((e) => e.dataset.ending)).toEqual(['crlf', 'crlf']);
    expect(eols.every((e) => (e.textContent ?? '').length > 0)).toBe(true);
  });

  it('LF, CR and CRLF draw three different symbols', async () => {
    const h = await mount({ ...ON, doc: { text: 'a\nb\nc\n' } });
    act(() => h.pushSync({ lineFormat: { lineEnding: 'crlf', mixed: true, lineEndings: ['lf', 'cr', 'crlf'] } }));
    await waitFor(() => expect(marks('cm-ws-eol').map((e) => e.dataset.ending)).toEqual(['lf', 'cr', 'crlf']));
    const symbols = new Set(marks('cm-ws-eol').map((e) => e.textContent));
    expect(symbols.size).toBe(3);
  });

  it('each line’s OWN ending on a mixed document, from the authority’s per-line record (US6 independent test)', async () => {
    const h = await mount({ ...ON, doc: { text: 'one\ntwo\nthree\n' } });
    act(() =>
      h.pushSync({ lineFormat: { lineEnding: 'crlf', mixed: true, lineEndings: ['crlf', 'lf', 'crlf'] } }),
    );
    await waitFor(() =>
      expect(marks('cm-ws-eol').map((e) => e.dataset.ending)).toEqual(['crlf', 'lf', 'crlf']),
    );
  });

  it('a visible mark for VT, FF, ESC, every other C0 control and U+FEFF', async () => {
    await mount({ ...ON, doc: { text: 'a\u000bb\u000cc\u001bd\u0001e\u001ff\ufeffg' } });
    const controls = marks('cm-ws-control');
    expect(controls.map((c) => c.dataset.code)).toEqual(['000B', '000C', '001B', '0001', '001F', 'FEFF']);
    for (const c of controls) {
      expect((c.textContent ?? '').trim().length).toBeGreaterThan(0);
      expect(wsName(c)).toBeTruthy();
    }
  });

  it('line breaks read LF, CR and CR LF on one line, in every theme’s font — named on hover (FR-066)', async () => {
    const h = await mount({ ...ON, doc: { text: 'a\nb\nc\n' } });
    act(() => h.pushSync({ lineFormat: { lineEnding: 'lf', mixed: true, lineEndings: ['lf', 'cr', 'crlf'] } }));
    await waitFor(() => expect(marks('cm-ws-eol').map((e) => e.textContent)).toEqual(['LF', 'CR', 'CR LF']));
    expect(marks('cm-ws-eol').map(wsName)).toEqual([
      'LF — U+000A LINE FEED',
      'CR — U+000D CARRIAGE RETURN',
      'CRLF — U+000D U+000A CARRIAGE RETURN, LINE FEED',
    ]);
  });

  it('a space’s dot, a tab and the BOM are named on hover too (FR-065)', async () => {
    await mount({ ...ON, doc: { text: 'a b\tc\n', hasBom: true, encoding: 'utf16le' } });
    expect(marks('cm-ws-space').map(wsName)).toEqual(['SP — U+0020 SPACE']);
    expect(marks('cm-ws-tab').map(wsName)).toEqual(['HT — U+0009 CHARACTER TABULATION']);
    expect(marks('cm-ws-bom').map(wsName)).toEqual(['BOM — U+FEFF BYTE ORDER MARK']);
  });

  it('a named mark for every character of whitespace-all.txt (FR-062, US6 AC6)', async () => {
    // Numbers, not escapes: an escape typed into a source file has arrived as the raw character.
    const codes = [
      0x0b, 0x0c, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008,
      0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0x180e, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff,
      0x115f, 0x1160, 0x3164, 0xffa0, 0x2800,
    ];
    const text = codes.map((c) => `[${String.fromCodePoint(c)}]`).join('') + '\n';
    await mount({ ...ON, doc: { text } });
    await waitFor(() =>
      expect(marks('cm-ws-control').map((c) => c.dataset.code)).toEqual(
        codes.map((c) => c.toString(16).toUpperCase().padStart(4, '0')),
      ),
    );
    const byCode = new Map(marks('cm-ws-control').map((c) => [c.dataset.code, c]));
    // One glyph each, so the marker fits one cell; the name is on hover (FR-064).
    for (const mark of marks('cm-ws-control')) expect([...(mark.textContent ?? '')]).toHaveLength(1);
    expect(byCode.get('00A0')?.textContent).toBe('°');
    expect(byCode.get('200B')?.textContent).toBe('ø');
    expect(wsName(byCode.get('2003')!)).toBe('EMSP — U+2003 EM SPACE');
    expect(wsName(byCode.get('0085')!)).toBe('NEL — U+0085 NEXT LINE');
  });

  it('none of those marks while it is off', async () => {
    await mount({ doc: { text: 'a\u001bb c\n' } });
    expect(marks('cm-ws-control')).toHaveLength(0);
    expect(marks('cm-ws-eol')).toHaveLength(0);
  });

  it('a BOM mark before the first character when the document has a BOM, and none without', async () => {
    await mount({ ...ON, doc: { text: 'hi\n', hasBom: true, encoding: 'utf16le' } });
    const bom = marks('cm-ws-bom');
    expect(bom).toHaveLength(1);
    const firstLine = editorRoot().querySelector('.cm-line');
    expect(firstLine?.firstElementChild).toBe(bom[0]);
  });

  it('no BOM mark on a document without one', async () => {
    await mount({ ...ON, doc: { text: 'hi\n' } });
    expect(marks('cm-ws-bom')).toHaveLength(0);
  });

  it('the BOM mark follows a Change Encoding relay', async () => {
    const h = await mount({ ...ON, doc: { text: 'hi\n' } });
    act(() => h.pushSync({ encoding: 'utf8', hasBom: true }));
    await waitFor(() => expect(marks('cm-ws-bom')).toHaveLength(1));
  });

  it('nothing enters the document: turning it on changes no text and dispatches nothing (US6 AC5)', async () => {
    const text = ' \tx\u001b\n';
    const h = await mount({ doc: { text, hasBom: true } });
    const sent = h.dispatched.length;
    fireEvent.click(toggle());
    await waitFor(() => expect(marks('cm-ws-space')).toHaveLength(1));
    expect(h.view().state.doc.toString()).toBe(text);
    expect(h.dispatched).toHaveLength(sent);
  });
});

describe('the hover-name popover (059 FR-067)', () => {
  const ON = { panelConfig: { showWhitespace: true } };
  const popover = (): HTMLElement | null => document.querySelector<HTMLElement>('.cm-ws-hover-name');

  afterEach(() => {
    vi.useRealTimers();
    popover()?.remove();
  });

  it('markers carry their name as data, never a native title', async () => {
    await mount({ ...ON, doc: { text: 'a b\tc\u001b\n', hasBom: true, encoding: 'utf16le' } });
    for (const cls of ['cm-ws-space', 'cm-ws-tab', 'cm-ws-eol', 'cm-ws-bom', 'cm-ws-control']) {
      for (const m of marks(cls)) {
        expect(wsName(m), cls).toBeTruthy();
        expect(m.hasAttribute('title'), cls).toBe(false);
      }
    }
  });

  it('shows after 500 ms over a marker — not before — above the pointer, and follows it', async () => {
    await mount({ ...ON, doc: { text: 'a\u001bb\n' } });
    vi.useFakeTimers();
    const esc = marks('cm-ws-control')[0]!;
    fireEvent.mouseMove(esc, { clientX: 100, clientY: 200 });
    act(() => vi.advanceTimersByTime(499));
    expect(popover()).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(popover()?.textContent).toBe('ESC — U+001B ESCAPE');
    expect(popover()?.getAttribute('role')).toBe('tooltip');
    const top1 = parseFloat(popover()!.style.top);
    const left1 = parseFloat(popover()!.style.left);
    expect(top1).toBeLessThan(200);
    fireEvent.mouseMove(esc, { clientX: 140, clientY: 210 });
    expect(parseFloat(popover()!.style.left)).toBe(left1 + 40);
    expect(parseFloat(popover()!.style.top)).toBe(top1 + 10);
  });

  it('closes when the pointer leaves the marker, and a quick sweep shows nothing', async () => {
    await mount({ ...ON, doc: { text: 'a\u001bb c\n' } });
    vi.useFakeTimers();
    const esc = marks('cm-ws-control')[0]!;
    fireEvent.mouseMove(esc, { clientX: 100, clientY: 200 });
    act(() => vi.advanceTimersByTime(500));
    expect(popover()).not.toBeNull();
    fireEvent.mouseMove(editorRoot().querySelector('.cm-line')!, { clientX: 300, clientY: 200 });
    expect(popover()).toBeNull();
    fireEvent.mouseMove(esc, { clientX: 100, clientY: 200 });
    act(() => vi.advanceTimersByTime(300));
    fireEvent.mouseMove(marks('cm-ws-space')[0]!, { clientX: 120, clientY: 200 });
    act(() => vi.advanceTimersByTime(300));
    expect(popover()).toBeNull();
  });

  it('closes on a key press', async () => {
    await mount({ ...ON, doc: { text: 'a\u001bb\n' } });
    vi.useFakeTimers();
    fireEvent.mouseMove(marks('cm-ws-control')[0]!, { clientX: 100, clientY: 200 });
    act(() => vi.advanceTimersByTime(500));
    expect(popover()).not.toBeNull();
    fireEvent.keyDown(editorRoot(), { key: 'a' });
    expect(popover()).toBeNull();
  });

  it('is on by default, marking the editor for the help cursor', async () => {
    await mount({ ...ON, doc: { text: 'a\u001bb\n' } });
    expect(editorRoot().classList.contains('cm-ws-hover-names')).toBe(true);
  });

  it('with editor.whitespaceHoverNames off: no popover and no help-cursor class', async () => {
    await mount({ ...ON, settings: { editor: { whitespaceHoverNames: false } }, doc: { text: 'a\u001bb\n' } });
    await waitFor(() => expect(editorRoot().classList.contains('cm-ws-hover-names')).toBe(false));
    vi.useFakeTimers();
    fireEvent.mouseMove(marks('cm-ws-control')[0]!, { clientX: 100, clientY: 200 });
    act(() => vi.advanceTimersByTime(2000));
    expect(popover()).toBeNull();
  });
});
