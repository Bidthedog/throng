/**
 * 081 FR-031 (#733 item 2) — scrolling the editor onto a table highlights that table's row in the preview, every time:
 * each body line its own row, the header line and the delimiter line under it the header row. On the issue's own shape
 * (an empty header row, `| | |`) and on a table with a normal header.
 *
 * Mounted as `preview-sync-mark.test.ts` mounts it (the whole panel, the shipped Markdown body, the editor played by the
 * scroll store), with its stand-in geometry: every block at 20 px per source line.
 *
 * Layer: component — which rendered element the panel marks for a source line; no layout is involved.
 */
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetEditorScrollStore, publishEditorCentreLine, publishEditorTopLine, registerEditorScroller } from '../../src/renderer/editor/editor-scroll-store.js';
import { __resetSyncMarks, syncMarkOf } from '../../src/renderer/preview/sync-mark-store.js';
import { COLD, README, mountMarkdownPreview, previewUpdate, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const PARENT = { panelId: 'ed-1', title: 'README.md' };
const GUTTER = { editor: { previews: { providers: { markdown: { gutter: true } } } } };

/** Source lines: 0 Intro · 2 header · 3 delimiter · 4-6 body rows · 8 Outro. */
const doc = (header: string): string =>
  ['Intro', '', header, '|---|---|', '| Alpha | one |', '| Beta | two |', '| Gamma | three |', '', 'Outro'].join('\n');

let m: MountedPreviewWindow | undefined;
const host = (): HTMLElement => screen.getByTestId(`preview-body-${m!.id}`);
/** What is marked, named so a failure reads: `TR@4`. */
const name = (e: Element): string => `${e.tagName}@${e.getAttribute('data-source-line')}`;
const marked = (): string[] => [...host().querySelectorAll('.preview-sync-mark')].map(name);
const rowNamed = (text: string): HTMLTableRowElement =>
  [...host().querySelectorAll('tr')].find((tr) => tr.cells[0]?.textContent?.trim() === text)!;
const headerRow = (): HTMLTableRowElement => host().querySelector('thead tr')!;

async function frames(n = 2): Promise<void> {
  for (let i = 0; i < n; i += 1) await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

let top = 0;
/** The editor scrolls (its top line moves), stopping with `centre` under the middle of its viewport. */
async function editorStopsWithCentreOn(centre: number): Promise<void> {
  top += 1;
  act(() => {
    publishEditorCentreLine('ed-1', centre);
    publishEditorTopLine('ed-1', top);
  });
  await waitFor(() => expect(syncMarkOf('ed-1')).toEqual({ line: centre, on: true }));
}

async function mountParented(text: string): Promise<void> {
  m = await mountMarkdownPreview(text, README, { settings: GUTTER, attach: { parent: PARENT } });
  await screen.findByText('Outro', {}, COLD);
  // The table layout runs after the draw and re-anchors the scroll; let it settle before the editor moves.
  await waitFor(() => expect(host().querySelector('table > colgroup')).not.toBeNull());
  m.push(previewUpdate({ panelId: m.id, revision: 2, content: null, parent: PARENT }));
  act(() => publishEditorTopLine('ed-1', 0));
  await frames();
}

beforeEach(() => {
  __resetEditorScrollStore();
  __resetSyncMarks();
  top = 0;
  // A preview on screen has a width, so its tables are laid out (081 FR-020: jsdom's 0 reads as a box-less body).
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
    const scroller = document.querySelector<HTMLElement>('.preview-panel__body');
    if (this === scroller) return { top: 100, height: 400, left: 0, width: 400 } as DOMRect;
    const line = Number(this.getAttribute('data-source-line'));
    return { top: 100 + line * 20 - (scroller?.scrollTop ?? 0), height: 20, left: 0, width: 400 } as DOMRect;
  });
  registerEditorScroller('ed-1', vi.fn());
});
afterEach(() => {
  m?.unmount();
  m = undefined;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe.each([
  ['an empty header row (the #733 shape)', '| | |'],
  ['a normal header row', '| Name | Value |'],
])('every table line marks its own row, with %s (081 FR-031)', (_, header) => {
  it('marks the header row for the header line and for the delimiter line under it', async () => {
    await mountParented(doc(header));
    await editorStopsWithCentreOn(2);
    await frames(1);
    expect(marked()).toEqual([name(headerRow())]);
    await editorStopsWithCentreOn(3);
    await frames(1);
    expect(marked()).toEqual([name(headerRow())]);
  });

  it('marks each body row for its own line, the first one included', async () => {
    await mountParented(doc(header));
    for (const [line, row] of [[4, 'Alpha'], [5, 'Beta'], [6, 'Gamma'], [4, 'Alpha']] as const) {
      await editorStopsWithCentreOn(line);
      await frames(1);
      expect(marked(), `line ${line}`).toEqual([name(rowNamed(row))]);
    }
  });
});
