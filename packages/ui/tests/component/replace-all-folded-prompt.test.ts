/**
 * 049 T026 — Replace All asks before acting on matches inside FOLDED sections (FR-007a, research R6).
 *
 * A folded match is text the user cannot see being rewritten, so with any of them in play Replace All asks:
 * Cancel · Replace and keep folded · Replace and unfold, focus on the last. With none it does what it always
 * did, with no dialog. Mounted on a real Markdown editor with the real store, so what is asserted is the document
 * text, the fold state and the number of document transactions — not a fake's call log.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatGrouped, initialFold } from '@throng/core';
import { __resetFoldStateStore, documentFoldState } from '../../src/renderer/editor/fold-state-store.js';
import { ReplaceAllPrompt } from '../../src/renderer/search/replace-all-prompt.js';
import {
  __resetFindState,
  openFind,
  replaceAll,
  setReplacement,
  setTerm,
} from '../../src/renderer/search/search-store.js';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';

const PANEL = 'p-ed';
const KEY = 'file:C:/proj/note.md';

/** A open, B and C collapsed: `foo` ×1 in the visible section and ×2 + ×1 in folded ones. */
const DOC = '# Top\n\n## A\n\nfoo a1\n\n## B\n\nfoo b1\nfoo b2\n\n## C\n\nfoo c1\n';

let h: EditorHarness | undefined;
let changeDispatches = 0;
let setFoldState: ReturnType<typeof vi.fn>;

async function mount(text: string, flipped: string[]): Promise<EditorHarness> {
  h = mountEditor({
    panelId: PANEL,
    doc: { text, version: 1, absPath: 'C:/proj/note.md' },
    foldAuthority: { base: 'expanded', flipped },
    extras: [createElement(ReplaceAllPrompt, { key: 'replace-all-prompt' })],
  });
  await waitFor(() => expect(docText()).toContain('foo'));
  await waitFor(() => expect(h!.settingsLoaded()).toBe(true));
  await waitFor(() => expect(documentFoldState(KEY, initialFold('expanded')).flipped).toEqual(flipped));
  const view = h.view();
  const real = view.dispatch.bind(view);
  changeDispatches = 0;
  view.dispatch = ((...args: Parameters<typeof view.dispatch>) => {
    const spec = args[0] as { changes?: unknown };
    if (spec && typeof spec === 'object' && 'changes' in spec && spec.changes !== undefined) changeDispatches += 1;
    return real(...args);
  }) as typeof view.dispatch;
  const editorApi = (window.throng as { editor: { setFoldState: () => void } }).editor;
  setFoldState = vi.spyOn(editorApi, 'setFoldState') as unknown as ReturnType<typeof vi.fn>;
  act(() => {
    openFind(PANEL, 'editor', { replace: true });
    setTerm(PANEL, 'foo');
    setReplacement(PANEL, 'bar');
  });
  setFoldState.mockClear();
  return h;
}

afterEach(() => {
  h?.unmount();
  h = undefined;
  __resetFindState();
  __resetFoldStateStore();
  vi.restoreAllMocks();
});

/** The document as CodeMirror holds it — `h.text()` reads what is DRAWN, which a fold replaces with a placeholder. */
const docText = (): string => h!.view().state.doc.toString();
const dialog = (): HTMLElement => screen.getByTestId('replace-all-folded-dialog');
const foldNow = (): string[] => [...documentFoldState(KEY, initialFold('expanded')).flipped];

describe('Replace All with no folded match', () => {
  it('runs at once, with no dialog', async () => {
    await mount('# Top\n\n## A\n\nfoo a1\nfoo a2\n', []);
    act(() => void replaceAll(PANEL));
    await waitFor(() => expect(docText()).toBe('# Top\n\n## A\n\nbar a1\nbar a2\n'));
    expect(screen.queryByTestId('replace-all-folded-dialog')).toBeNull();
  });
});

describe('Replace All with folded matches', () => {
  it('asks, naming the count, with the three choices and focus on Replace and unfold', async () => {
    await mount(DOC, ['b', 'c']);
    act(() => void replaceAll(PANEL));

    await waitFor(() => expect(dialog()).toBeTruthy());
    expect(screen.getByText('Replace in folded sections')).toBeTruthy();
    expect(dialog()).toHaveTextContent('3 of 4 matches are inside folded sections.');
    const labels = Array.from(dialog().querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['Cancel', 'Replace and keep folded', 'Replace and unfold']);
    expect(document.activeElement?.textContent).toBe('Replace and unfold');
    expect(docText()).toBe(DOC); // nothing happened yet
  });

  it('digit-groups the counts', async () => {
    const many = `# Top\n\n## A\n\nfoo a\n\n## B\n\n${'foo b\n'.repeat(1099)}`;
    await mount(many, ['b']);
    act(() => void replaceAll(PANEL));
    await waitFor(() => expect(dialog()).toBeTruthy());
    expect(dialog()).toHaveTextContent(`${formatGrouped(1099)} of ${formatGrouped(1100)} matches are inside folded sections.`);
  });

  it('Cancel replaces nothing and unfolds nothing', async () => {
    await mount(DOC, ['b', 'c']);
    act(() => void replaceAll(PANEL));
    await waitFor(() => expect(dialog()).toBeTruthy());
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.queryByTestId('replace-all-folded-dialog')).toBeNull());
    expect(docText()).toBe(DOC);
    expect(foldNow()).toEqual(['b', 'c']);
    expect(setFoldState).not.toHaveBeenCalled();
  });

  it('Escape replaces nothing and unfolds nothing', async () => {
    await mount(DOC, ['b', 'c']);
    act(() => void replaceAll(PANEL));
    await waitFor(() => expect(dialog()).toBeTruthy());
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('replace-all-folded-dialog')).toBeNull());
    expect(docText()).toBe(DOC);
    expect(foldNow()).toEqual(['b', 'c']);
    expect(setFoldState).not.toHaveBeenCalled();
  });

  it('Replace and keep folded replaces every match in ONE transaction and leaves the folds alone', async () => {
    await mount(DOC, ['b', 'c']);
    act(() => void replaceAll(PANEL));
    await waitFor(() => expect(dialog()).toBeTruthy());
    fireEvent.click(screen.getByText('Replace and keep folded'));
    await waitFor(() => expect(docText()).not.toContain('foo'));
    expect(docText()).toBe(DOC.replaceAll('foo', 'bar'));
    expect(changeDispatches).toBe(1);
    expect(foldNow()).toEqual(['b', 'c']);
    expect(setFoldState).not.toHaveBeenCalled();
  });

  it('Replace and unfold opens every affected section in ONE fold-state write, then replaces in ONE transaction', async () => {
    await mount(DOC, ['b', 'c']);
    act(() => void replaceAll(PANEL));
    await waitFor(() => expect(dialog()).toBeTruthy());
    fireEvent.click(screen.getByText('Replace and unfold'));
    await waitFor(() => expect(docText()).not.toContain('foo'));
    expect(docText()).toBe(DOC.replaceAll('foo', 'bar'));
    expect(changeDispatches).toBe(1);
    expect(foldNow()).toEqual([]);
    expect(setFoldState).toHaveBeenCalledTimes(1);
  });
});
