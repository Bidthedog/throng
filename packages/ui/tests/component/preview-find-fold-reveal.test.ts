/**
 * 049 T022 — #455 for PREVIEWS: find reveals a match inside a COLLAPSED section (FR-004, FR-006; US2.1–2.3, 2.5).
 *
 * 047 built the mechanism (`revealBeforeScroll`) and `preview-fold-reveal.test.ts` pins one reading of
 * "collapsed" — a match hidden under a collapsed ANCESTOR. #455 is the other reading: the match sits in the
 * body of a section that is itself collapsed, so its heading is shown and its text is not. The panel asked
 * `visibleSections` — "is this section's HEADING shown" — and took yes for "so is the match".
 *
 * Mounted on the real panel with the shipped foldable Markdown body and the real find bar, so what is asserted
 * is what a reader sees: the match's text visible, the fold state, and which element was scrolled to.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialFold, setSection, type FoldState } from '@throng/core';
import {
  __resetFoldStateStore,
  documentFoldState,
  setDocumentFoldState,
} from '../../src/renderer/editor/fold-state-store.js';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';
import { SearchKeybindings } from '../../src/renderer/search/search-keybindings.js';
import { __resetFindState, findNext, findPrevious } from '../../src/renderer/search/search-store.js';
import { COLD, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const DOC = [
  '# One', //                  0
  '', //                       1
  'intro text', //             2
  '', //                       3
  '## Two', //                 4
  '', //                       5
  'body two needle', //        6
  '', //                       7
  '## Four', //                8
  '', //                       9
  '### Five', //               10
  '', //                       11
  'body five needle', //       12
].join('\n');

let m: MountedPreviewWindow | undefined;
let scrolled: Element[];

beforeEach(() => {
  __resetPreviewStore();
  scrolled = [];
  // jsdom has no scrollIntoView; record WHICH element the find asked to bring into view.
  Element.prototype.scrollIntoView = vi.fn(function scroll(this: Element) {
    scrolled.push(this);
  });
});

afterEach(() => {
  m?.unmount();
  m = undefined;
  __resetFoldStateStore();
  __resetFindState();
  vi.restoreAllMocks();
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

const collapse = (...slugs: string[]): FoldState =>
  slugs.reduce((state, slug) => setSection(state, slug, true), initialFold('expanded'));
const foldNow = (): FoldState => documentFoldState(`panel:${m!.id}`, initialFold('expanded'));

async function mountFoldable(): Promise<void> {
  m = await mountMarkdownPreview(DOC, undefined, { extras: [createElement(SearchKeybindings, { key: 'search-kb' })] });
  await screen.findByText('intro text', {}, COLD);
}

async function findFor(term: string): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await user.keyboard('{Control>}f{/Control}');
  await waitFor(() => expect(screen.getByTestId(`find-bar-${m!.id}`)).toBeVisible());
  await user.type(screen.getByTestId('find-input'), term);
  return user;
}

describe('typed find, match in a section that is itself collapsed (US2.1)', () => {
  it('expands that section and scrolls the match’s (connected) element into view', async () => {
    await mountFoldable();
    setDocumentFoldState(`panel:${m!.id}`, collapse('two'));
    await waitFor(() => expect(screen.getByText('body two needle')).not.toBeVisible());

    await findFor('body two needle');

    await waitFor(() => expect(screen.getByText('body two needle')).toBeVisible());
    expect(foldNow().flipped).toEqual([]);
    await waitFor(() => expect(scrolled.length).toBeGreaterThan(0));
    const target = scrolled.at(-1)!;
    expect(target.isConnected).toBe(true);
    expect(target.textContent).toContain('body two needle');
  });
});

describe('a match two collapsed levels deep (US2.2)', () => {
  it('expands every collapsed ancestor, and nothing else', async () => {
    await mountFoldable();
    setDocumentFoldState(`panel:${m!.id}`, collapse('two', 'four', 'five'));
    await waitFor(() => expect(screen.getByText('body five needle')).not.toBeVisible());

    await findFor('body five needle');

    await waitFor(() => expect(screen.getByText('body five needle')).toBeVisible());
    expect(foldNow().flipped).toEqual(['two']); // four and five opened; two, which holds no match, is untouched
    await waitFor(() => expect(scrolled.at(-1)?.isConnected).toBe(true));
  });
});

describe('matches in two collapsed sections (US2.3, US2.5)', () => {
  it('Next expands each only when its match becomes current, and moving on never collapses', async () => {
    await mountFoldable();
    setDocumentFoldState(`panel:${m!.id}`, collapse('two', 'five'));
    await waitFor(() => expect(screen.getByText('body two needle')).not.toBeVisible());
    await findFor('needle');
    await waitFor(() => expect(screen.getByTestId('find-count')).toHaveTextContent('1 of 2'));

    // The first match is current: only its section is open.
    await waitFor(() => expect(screen.getByText('body two needle')).toBeVisible());
    expect(foldNow().flipped).toEqual(['five']);
    expect(screen.getByText('body five needle')).not.toBeVisible();

    act(() => findNext(m!.id));
    await waitFor(() => expect(screen.getByText('body five needle')).toBeVisible());
    expect(foldNow().flipped).toEqual([]); // two stays open: moving on never collapses

    act(() => findPrevious(m!.id));
    await waitFor(() => expect(screen.getByTestId('find-count')).toHaveTextContent('1 of 2'));
    expect(screen.getByText('body two needle')).toBeVisible();
    expect(screen.getByText('body five needle')).toBeVisible();
    expect(foldNow().flipped).toEqual([]);
  });
});
