/**
 * 059 T033, T063 — the line-ending indicator and its list (FR-030, FR-031, FR-033 … FR-035, FR-038, FR-057).
 *
 * `LF`, `CRLF`, `CR`, or `Mixed (<dominant>)`, named "line endings: <label>". A click lists LF, CR, CRLF
 * and Mixed, the current state marked. LF, CR and CRLF convert; the current uniform ending is a no-op.
 * Mixed is ALWAYS listed and NEVER selectable — it is a state to switch from (FR-057). Both indicators sit
 * inside the strip, so they take its active / inactive treatment (016 FR-010g) and its themed colour, as
 * the language label does (FR-034).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { removeEditorState } from '../../src/renderer/editor/editor-state.js';
import { removePanelLanguage } from '../../src/renderer/editor/editor-language.js';
import { __resetDocumentFormats } from '../../src/renderer/editor/document-format-store.js';
import { mountEditor, type EditorDoc } from './helpers/mount-editor.js';

const PANEL = 'p-le-strip';
const PATH = 'C:/proj/notes.txt';

afterEach(() => {
  removeEditorState(PANEL);
  removePanelLanguage(PANEL);
  __resetDocumentFormats();
  Reflect.deleteProperty(window, 'throng');
});

async function mount(doc: Partial<EditorDoc> = {}) {
  const h = mountEditor({ panelId: PANEL, doc: { text: 'a\nb\n', version: 1, absPath: PATH, ...doc } });
  await waitFor(() => expect(h.view().state.doc.toString()).toBe('a\nb\n'));
  return h;
}

const indicator = (): HTMLElement => screen.getByTestId(`editor-line-ending-${PANEL}`);
const LIST = ['menu-item-line-ending-lf', 'menu-item-line-ending-cr', 'menu-item-line-ending-crlf', 'menu-item-line-ending-mixed'];
const menuRows = (): string[] =>
  [...document.querySelectorAll('[data-testid="context-menu"] > [data-testid^="menu-item-"]')].map(
    (r) => r.getAttribute('data-testid') ?? '',
  );

describe('the line-ending indicator (059 FR-030, FR-031)', () => {
  it('reads LF on an LF document, named "line endings: LF"', async () => {
    await mount();
    expect(indicator()).toHaveTextContent('LF');
    expect(screen.getByRole('button', { name: 'line endings: LF' })).toBe(indicator());
  });

  it('reads CRLF and CR', async () => {
    const h = await mount({ lineEnding: 'crlf' });
    expect(indicator()).toHaveAccessibleName('line endings: CRLF');
    act(() => h.pushSync({ lineFormat: { lineEnding: 'cr', mixed: false } }));
    await waitFor(() => expect(indicator()).toHaveTextContent('CR'));
    expect(indicator()).toHaveAccessibleName('line endings: CR');
  });

  it('reads Mixed (<dominant>) on a mixed document, from the relay', async () => {
    const h = await mount();
    act(() => h.pushSync({ lineFormat: { lineEnding: 'crlf', mixed: true } }));
    await waitFor(() => expect(indicator()).toHaveTextContent('Mixed (CRLF)'));
    expect(indicator()).toHaveAccessibleName('line endings: Mixed (CRLF)');
  });

  it('follows a conversion carried on the canonical stream (FR-034)', async () => {
    const h = await mount();
    act(() =>
      h.pushSync({
        change: {
          documentId: PANEL,
          kind: 'edit',
          changes: [4],
          version: 2,
          dirty: true,
          origin: '__throng:bulk-edit__',
          lineFormat: { lineEnding: 'crlf', mixed: false },
        },
      }),
    );
    await waitFor(() => expect(indicator()).toHaveTextContent('CRLF'));
    expect(h.view().state.doc.toString()).toBe('a\nb\n');
  });

  it('its hover title names the action', async () => {
    await mount();
    expect(indicator().getAttribute('title')).toMatch(/line endings/i);
  });
});

describe('the line-ending list (059 FR-057)', () => {
  it('lists LF, CR, CRLF and Mixed, in that order, the current uniform ending marked', async () => {
    await mount();
    fireEvent.click(indicator());
    await screen.findByTestId('menu-item-line-ending-lf');
    expect(menuRows()).toEqual(LIST);
    expect(screen.getByTestId('menu-item-line-ending-lf')).toHaveTextContent('LF ✓');
    expect(screen.getByTestId('menu-item-line-ending-cr')).toHaveTextContent(/^CR$/);
    expect(screen.getByTestId('menu-item-line-ending-crlf')).toHaveTextContent(/^CRLF$/);
    expect(screen.getByTestId('menu-item-line-ending-mixed')).toHaveTextContent(/^Mixed$/);
    // The insert commands are the CONTENT menu's (MT-04 step 5), not the indicator's.
    expect(screen.queryByTestId('menu-item-insert-line-break-lf')).toBeNull();
  });

  it('choosing CR converts the document to CR (FR-057)', async () => {
    const h = await mount({ lineEnding: 'crlf' });
    fireEvent.click(indicator());
    fireEvent.click(await screen.findByTestId('menu-item-line-ending-cr'));
    await waitFor(() =>
      expect(h.calls.convertLineEndings).toHaveBeenCalledWith({ panelId: PANEL, target: 'cr' }),
    );
  });

  it('choosing CRLF converts the document', async () => {
    const h = await mount();
    fireEvent.click(indicator());
    fireEvent.click(await screen.findByTestId('menu-item-line-ending-crlf'));
    await waitFor(() =>
      expect(h.calls.convertLineEndings).toHaveBeenCalledWith({ panelId: PANEL, target: 'crlf' }),
    );
  });

  it('choosing the current ending is a no-op (FR-038)', async () => {
    const h = await mount();
    fireEvent.click(indicator());
    fireEvent.click(await screen.findByTestId('menu-item-line-ending-lf'));
    await act(async () => {});
    expect(h.calls.convertLineEndings).not.toHaveBeenCalled();
  });

  it('on a uniform document Mixed is listed, unmarked, and cannot be chosen (FR-057, US4 AC10)', async () => {
    const h = await mount();
    fireEvent.click(indicator());
    const mixed = await screen.findByTestId('menu-item-line-ending-mixed');
    expect(mixed).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(mixed);
    await act(async () => {});
    expect(h.calls.convertLineEndings).not.toHaveBeenCalled();
  });

  it('on a mixed document Mixed is marked current and still cannot be chosen; LF, CR and CRLF all convert (US4 AC9)', async () => {
    const h = await mount();
    act(() => h.pushSync({ lineFormat: { lineEnding: 'lf', mixed: true } }));
    await waitFor(() => expect(indicator()).toHaveTextContent('Mixed (LF)'));
    fireEvent.click(indicator());
    const mixed = await screen.findByTestId('menu-item-line-ending-mixed');
    expect(mixed).toHaveTextContent('Mixed ✓');
    expect(mixed).toHaveAttribute('aria-disabled', 'true');
    for (const id of ['lf', 'cr', 'crlf']) {
      const row = screen.getByTestId(`menu-item-line-ending-${id}`);
      expect(row).toHaveAttribute('aria-disabled', 'false');
      expect(row.textContent).not.toContain('✓');
    }
    // The dominant ending is not "current" on a mixed document: choosing it converts.
    fireEvent.click(screen.getByTestId('menu-item-line-ending-lf'));
    await waitFor(() =>
      expect(h.calls.convertLineEndings).toHaveBeenCalledWith({ panelId: PANEL, target: 'lf' }),
    );
  });
});

describe('both indicators take the strip’s treatment (059 FR-034, 016 FR-010g)', () => {
  const EDITOR_CSS = resolve(process.cwd(), 'packages/ui/src/renderer/editor/editor.css');

  it('sit inside the strip whose opacity dims an inactive panel, in its inherited colour', async () => {
    expect(existsSync(EDITOR_CSS)).toBe(true);
    const sheet = document.createElement('style');
    sheet.textContent = readFileSync(EDITOR_CSS, 'utf8');
    document.head.appendChild(sheet);
    try {
      await mount();
      const strip = screen.getByTestId(`editor-status-strip-${PANEL}`);
      for (const el of [indicator(), screen.getByTestId(`editor-encoding-${PANEL}`)]) {
        expect(strip).toContainElement(el);
        // The language label's own rule: the strip's themed foreground, never a colour of its own.
        expect(getComputedStyle(el).color).toBe(getComputedStyle(screen.getByTestId(`editor-language-${PANEL}`)).color);
        expect(el).toHaveClass('editor-status-strip__format');
      }
    } finally {
      sheet.remove();
    }
  });
});
