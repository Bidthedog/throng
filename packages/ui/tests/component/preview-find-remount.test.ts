/**
 * 049 T015 — #456 for PREVIEWS: an open find survives the panel's view being rebuilt (FR-000..003, R2).
 *
 * A preview that unmounts (a tab switch) and mounts again got a fresh find controller with no query and a
 * fresh painter, while the session — kept by the store — still read `2 of 5` and the bar was showing. So the
 * body carried no highlights and Next did nothing.
 *
 * What is asserted is what a user sees: the ranges registered under the Custom Highlight names (the fake
 * `CSS.highlights` below stands in for the browser's), the count, and what Next does.
 */
import { act, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountMarkdownPreview, COLD, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';
import { SearchKeybindings } from '../../src/renderer/search/search-keybindings.js';
import { unregisterPanelSearch } from '../../src/renderer/search/search-controller.js';
import {
  __resetFindState,
  findNext,
  getFindSession,
  openFind,
  setTerm,
} from '../../src/renderer/search/search-store.js';
import {
  createCssHighlightPainter,
  createPreviewSearchController,
  PREVIEW_CURRENT_MATCH_HIGHLIGHT,
  PREVIEW_MATCH_HIGHLIGHT,
} from '../../src/renderer/preview/preview-search.js';

class FakeHighlight {
  readonly ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

let registry: Map<string, FakeHighlight>;

beforeEach(() => {
  registry = new Map();
  Reflect.set(globalThis, 'CSS', { highlights: registry });
  Reflect.set(globalThis, 'Highlight', FakeHighlight);
});

let m: MountedPreviewWindow | undefined;
afterEach(() => {
  m?.unmount();
  if (m) unregisterPanelSearch(m.id);
  m = undefined;
  __resetFindState();
  Reflect.deleteProperty(globalThis, 'CSS');
  Reflect.deleteProperty(globalThis, 'Highlight');
  document.body.innerHTML = '';
});

const doc = (lines: string[]): string => `# Title\n\n${lines.join('\n\n')}\n`;
const FIVE = doc(['foo 1', 'foo 2', 'foo 3', 'foo 4', 'foo 5']);

const matchRanges = (): Range[] => registry.get(PREVIEW_MATCH_HIGHLIGHT)?.ranges ?? [];
const currentRange = (): Range | undefined => registry.get(PREVIEW_CURRENT_MATCH_HIGHLIGHT)?.ranges[0];
const paragraphOf = (r: Range | undefined): string | null | undefined =>
  r?.startContainer.parentElement?.textContent;

async function mountPreview(text: string): Promise<MountedPreviewWindow> {
  m = await mountMarkdownPreview(text, undefined, {
    extras: [createElement(SearchKeybindings, { key: 'search-kb' })],
  });
  await screen.findByTestId(`preview-markdown-${m.id}`, {}, COLD);
  await screen.findByRole('heading', { name: 'Title' }, COLD); // the body has drawn
  return m;
}

describe('a preview panel with an open find, unmounted and remounted (#456)', () => {
  it('paints the same matches, the same current one, and Next carries on from it', async () => {
    const first = await mountPreview(FIVE);
    act(() => {
      openFind(first.id, 'preview');
      setTerm(first.id, 'foo');
      findNext(first.id);
    });
    expect(getFindSession(first.id)?.count).toEqual({ current: 2, total: 5 });
    expect(matchRanges()).toHaveLength(5);

    first.unmount();
    unregisterPanelSearch(first.id);
    const second = await mountPreview(FIVE);

    await waitFor(() => expect(matchRanges()).toHaveLength(5), COLD);
    expect(paragraphOf(currentRange())).toBe('foo 2');
    expect(getFindSession(second.id)?.count).toEqual({ current: 2, total: 5 });

    act(() => findNext(second.id));
    expect(getFindSession(second.id)?.count).toEqual({ current: 3, total: 5 });
    expect(paragraphOf(currentRange())).toBe('foo 3');
  });

  it('re-runs the search when the text changed while hidden, landing on the nearest following match (FR-003)', async () => {
    const first = await mountPreview(FIVE);
    act(() => {
      openFind(first.id, 'preview');
      setTerm(first.id, 'foo');
      findNext(first.id); // 'foo 2'
    });
    first.unmount();
    unregisterPanelSearch(first.id);

    const second = await mountPreview(doc(['foo 0', 'xx', 'foo 2', 'foo 3', 'foo 4']));

    await waitFor(() => expect(matchRanges()).toHaveLength(4), COLD);
    expect(paragraphOf(currentRange())).toBe('foo 2');
    expect(getFindSession(second.id)?.count).toEqual({ current: 2, total: 4 });
  });

  it('paints nothing for a panel whose find bar is closed', async () => {
    const first = await mountPreview(FIVE);
    first.unmount();
    unregisterPanelSearch(first.id);
    await mountPreview(FIVE);
    expect(matchRanges()).toHaveLength(0);
  });
});

describe('two previews in one window each keep their own painted matches (R2)', () => {
  function previewOver(html: string, panelId: string) {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const controller = createPreviewSearchController({
      host: () => host,
      painter: createCssHighlightPainter(panelId),
    });
    return controller;
  }

  it("one remounting does not wipe, and is not wiped by, the other's matches", () => {
    const modes = { caseSensitive: false, wholeWord: false };
    const a = previewOver('<p>foo foo foo</p>', 'a');
    const b = previewOver('<p>foo foo</p>', 'b');
    a.setQuery('foo', modes);
    b.setQuery('foo', modes);
    expect(matchRanges()).toHaveLength(5);

    // A unmounts (its painter is cleared) and comes back.
    a.close({ refocus: false });
    expect(matchRanges()).toHaveLength(2);
    const a2 = previewOver('<p>foo foo foo</p>', 'a');
    a2.setQuery('foo', modes);
    expect(matchRanges()).toHaveLength(5);
  });
});
