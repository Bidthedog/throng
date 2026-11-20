/**
 * 073 FR-033d — the maintainer's report (MT-10 step 6): "I do not see the highlight in the editor any more - just on the
 * CSV preview". `editor-sync-mark.test.ts` builds its OWN bare CodeMirror view with the extension in it, so it could not
 * see anything the real editor panel does differently. This mounts the REAL editor panel (`useEditor`'s own extension
 * list, theme and stylesheet-free DOM) and publishes the pair's mark the way the preview chrome does.
 *
 * Layer: component — the real panel in jsdom (`helpers/mount-editor.ts`).
 */
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { __resetSyncMarks, publishSyncMark } from '../../src/renderer/preview/sync-mark-store.js';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';

beforeAll(() => {
  const range = globalThis.Range?.prototype as unknown as Record<string, unknown> | undefined;
  if (range && typeof range.getClientRects !== 'function') {
    range.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
    range.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
  }
});

const TEXT = Array.from({ length: 12 }, (_, i) => `row ${i},b,c`).join('\n') + '\n';
const PANEL = 'p-ed-sync-mark';
let mounted: EditorHarness | undefined;

beforeEach(() => __resetSyncMarks());
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const marked = (h: EditorHarness): { text: string; on: boolean }[] =>
  [...h.view().dom.querySelectorAll<HTMLElement>('.cm-line.throng-sync-mark')].map((el) => ({
    text: el.textContent ?? '',
    on: el.classList.contains('throng-sync-mark--on'),
  }));

describe('the real editor panel draws the pair\'s sync mark (FR-033d)', () => {
  it('puts the highlight class on the marked line of a CSV editor', async () => {
    mounted = mountEditor({ panelId: PANEL, doc: { text: TEXT, version: 1, absPath: 'D:/proj/data.csv' } });
    await waitFor(() => expect(mounted!.text()).toBe(TEXT));
    act(() => publishSyncMark(PANEL, 5));
    expect(marked(mounted)).toEqual([{ text: 'row 5,b,c', on: true }]);
  });
});
