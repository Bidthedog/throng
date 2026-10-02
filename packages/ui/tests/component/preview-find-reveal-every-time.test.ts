/**
 * 049 T055 — #455 for PREVIEWS: Next / Previous / F3 onto a match inside a collapsed section expands it EVERY time
 * (FR-004), not only for the first match the query lands on.
 *
 * The maintainer's report: "the first result expands collapsed sections, but Next / F3 only occasionally expands
 * one". `preview-find-fold-reveal.test.ts` steps once across two sections; this walks a longer document — four
 * collapsed sections, forward, backward and round the wrap — and a section the reader collapsed AGAIN after find
 * had opened it, which is the same step repeated over a state find itself produced.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import { __resetFindState } from '../../src/renderer/search/search-store.js';
import { COLD, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const DOC = [
  '# Top',
  '',
  'intro text',
  '',
  '## Alpha',
  '',
  'alpha needle',
  '',
  '## Beta',
  '',
  'beta needle',
  '',
  '## Gamma',
  '',
  'gamma needle',
  '',
  '## Delta',
  '',
  'delta needle',
].join('\n');

let m: MountedPreviewWindow | undefined;

beforeEach(() => {
  __resetPreviewStore();
  Element.prototype.scrollIntoView = vi.fn();
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

const key = (): string => `panel:${m!.id}`;
const collapse = (...slugs: string[]): FoldState =>
  slugs.reduce((state, slug) => setSection(state, slug, true), initialFold('expanded'));
const text = (needle: string): HTMLElement => screen.getByText(needle);

async function mountAllCollapsed(): Promise<ReturnType<typeof userEvent.setup>> {
  m = await mountMarkdownPreview(DOC, undefined, { extras: [createElement(SearchKeybindings, { key: 'search-kb' })] });
  await screen.findByText('intro text', {}, COLD);
  setDocumentFoldState(key(), collapse('alpha', 'beta', 'gamma', 'delta'));
  await waitFor(() => expect(text('alpha needle')).not.toBeVisible());
  const user = userEvent.setup();
  await user.keyboard('{Control>}f{/Control}');
  await waitFor(() => expect(screen.getByTestId(`find-bar-${m!.id}`)).toBeVisible());
  await user.type(screen.getByTestId('find-input'), 'needle');
  await waitFor(() => expect(screen.getByTestId('find-count')).toHaveTextContent('1 of 4'));
  return user;
}

describe('Next and F3 across four collapsed sections (FR-004)', () => {
  it('opens each section as its match becomes current, with F3', async () => {
    const user = await mountAllCollapsed();
    await waitFor(() => expect(text('alpha needle')).toBeVisible());

    await user.keyboard('{F3}');
    await waitFor(() => expect(screen.getByTestId('find-count')).toHaveTextContent('2 of 4'));
    await waitFor(() => expect(text('beta needle')).toBeVisible());

    await user.keyboard('{F3}');
    await waitFor(() => expect(screen.getByTestId('find-count')).toHaveTextContent('3 of 4'));
    await waitFor(() => expect(text('gamma needle')).toBeVisible());

    await user.keyboard('{F3}');
    await waitFor(() => expect(screen.getByTestId('find-count')).toHaveTextContent('4 of 4'));
    await waitFor(() => expect(text('delta needle')).toBeVisible());
  });

  it('opens a section the reader collapsed again after find had opened it, when Next returns to it', async () => {
    const user = await mountAllCollapsed();
    await waitFor(() => expect(text('alpha needle')).toBeVisible());

    // The reader folds Alpha away again, then steps on and comes back round the wrap.
    setDocumentFoldState(key(), collapse('alpha', 'beta', 'gamma', 'delta'));
    await waitFor(() => expect(text('alpha needle')).not.toBeVisible());

    await user.keyboard('{F3}{F3}{F3}{F3}'); // 2, 3, 4, then round to 1
    await waitFor(() => expect(screen.getByTestId('find-count')).toHaveTextContent('1 of 4'));
    await waitFor(() => expect(text('alpha needle')).toBeVisible());
    expect(documentFoldState(key(), initialFold('expanded')).flipped).toEqual([]);
  });

  it('opens each section stepping backwards too (Previous from the first wraps to the last)', async () => {
    const user = await mountAllCollapsed();
    await user.keyboard('{Shift>}{F3}{/Shift}');
    await waitFor(() => expect(screen.getByTestId('find-count')).toHaveTextContent('4 of 4'));
    await waitFor(() => expect(text('delta needle')).toBeVisible());

    await user.keyboard('{Shift>}{F3}{/Shift}');
    await waitFor(() => expect(screen.getByTestId('find-count')).toHaveTextContent('3 of 4'));
    await waitFor(() => expect(text('gamma needle')).toBeVisible());
  });
});
