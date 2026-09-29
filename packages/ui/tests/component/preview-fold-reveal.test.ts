/**
 * 047 T050 (US3, FR-040, contracts "Commands"/"Status bar" scroll-sync note) — following a `#heading`
 * link into a collapsed section, and the find bar's current match landing inside one, expand it and
 * its ancestors before scrolling there.
 *
 * The whole panel is mounted with the shipped Markdown body, exactly as `preview-follow.test.ts` and
 * `preview-find.test.ts` do — jsdom has no layout, so `withGeometry()` supplies the same fixture those
 * files use: the host's viewport starts at client y 100, every source-mapped block is drawn at 20px
 * per source line, so a heading brought to the top of the host leaves `scrollTop` at `line * 20`.
 *
 * The fold state is set directly through `fold-state-store.ts` before each case — the same store
 * `preview-fold-link.test.ts` (T046) drives, and the doc comment on `setDocumentFoldState` names this
 * exact use ("a caller can update the cache alone (tests...)").
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialFold, setSection } from '@throng/core';
import { __resetFoldStateStore, setDocumentFoldState } from '../../src/renderer/editor/fold-state-store.js';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';
import { SearchKeybindings } from '../../src/renderer/search/search-keybindings.js';
import { __resetFindState } from '../../src/renderer/search/search-store.js';
import { COLD, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const DOC = [
  '# One', //                     0
  '', //                          1
  '[Jump to Three](#three)', //   2
  '', //                          3
  '## Two', //                    4
  '', //                          5
  '### Three', //                 6
  '', //                          7
  'body three', //                8
].join('\n');

let m: MountedPreviewWindow | undefined;

/** Supply layout: the host's viewport starts at y 100; each source line is 20px (`preview-follow.test.ts`'s own fixture). */
function withGeometry(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
    const scroller = document.querySelector<HTMLElement>('.preview-panel__body');
    if (this === scroller) return { top: 100, height: 400, left: 0, width: 400 } as DOMRect;
    const line = Number(this.getAttribute('data-source-line'));
    return { top: 100 + line * 20 - (scroller?.scrollTop ?? 0), height: 40, left: 0, width: 400 } as DOMRect;
  });
}

beforeEach(() => {
  __resetPreviewStore();
  withGeometry();
});

afterEach(() => {
  m?.unmount();
  m = undefined;
  __resetFoldStateStore();
  __resetFindState();
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe('following a same-document heading link into a COLLAPSED ancestor (FR-040)', () => {
  it('expands the collapsed "Two" (and so "Three", its descendant), then scrolls to "Three"', async () => {
    m = await mountMarkdownPreview(DOC);
    await screen.findByText('Jump to Three', {}, COLD);
    const host = screen.getByTestId(`preview-body-${m.id}`);
    const three = () => host.querySelector<HTMLElement>('[data-heading-slug="three"]')!;

    // Collapse "Two" directly through the store — the same fold-state cache the panel itself reads.
    setDocumentFoldState(`panel:${m.id}`, setSection(initialFold('expanded'), 'two', true));
    await waitFor(() => expect(three().hidden).toBe(true));
    expect(host.scrollTop).toBe(0);

    fireEvent.click(screen.getByText('Jump to Three'), { ctrlKey: true });

    await waitFor(() => expect(three().hidden).toBe(false));
    await waitFor(() => expect(host.scrollTop).toBe(120)); // "### Three" is data-source-line 6 → 6*20
  });

  it('leaves an ALREADY-expanded document\'s scroll unaffected in shape — same result as before folding existed', async () => {
    m = await mountMarkdownPreview(DOC);
    await screen.findByText('Jump to Three', {}, COLD);
    const host = screen.getByTestId(`preview-body-${m.id}`);

    fireEvent.click(screen.getByText('Jump to Three'), { ctrlKey: true });

    await waitFor(() => expect(host.scrollTop).toBe(120));
  });
});

const press = (user: ReturnType<typeof userEvent.setup>, key: string): Promise<void> =>
  user.keyboard(`{Control>}${key}{/Control}`);

/*
 * Reported in review (2026-09-28): "Go to heading does not work (mouse or enter) if the heading is
 * collapsed. If a heading that is collapsed is selected, that heading should be expanded to and
 * scrolled to." Both readings of "collapsed" are driven: hidden inside a collapsed ancestor, and its
 * OWN section collapsed.
 */
describe('Go to Heading onto a COLLAPSED heading (FR-042c, FR-040)', () => {
  const open = async (): Promise<HTMLElement> => {
    m = await mountMarkdownPreview(DOC);
    await screen.findByText('Jump to Three', {}, COLD);
    return screen.getByTestId(`preview-body-${m.id}`);
  };
  const three = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-heading-slug="three"]')!;

  for (const how of ['enter', 'click'] as const) {
    it(`${how}: a heading hidden in a collapsed ancestor is revealed and scrolled to`, async () => {
      const host = await open();
      setDocumentFoldState(`panel:${m!.id}`, setSection(initialFold('expanded'), 'two', true));
      await waitFor(() => expect(three(host).hidden).toBe(true));

      const user = userEvent.setup();
      await press(user, 'g');
      const row = await screen.findByTestId('heading-outline-row-three');
      if (how === 'enter') fireEvent.keyDown(row, { key: 'Enter' });
      else fireEvent.click(row);

      await waitFor(() => expect(three(host).hidden).toBe(false));
      await waitFor(() => expect(host.scrollTop).toBe(120));
    });

    it(`${how}: a heading whose OWN section is collapsed is expanded and scrolled to`, async () => {
      const host = await open();
      setDocumentFoldState(`panel:${m!.id}`, setSection(initialFold('expanded'), 'three', true));
      await waitFor(() => expect(screen.getByText('body three')).not.toBeVisible());

      const user = userEvent.setup();
      await press(user, 'g');
      const row = await screen.findByTestId('heading-outline-row-three');
      if (how === 'enter') fireEvent.keyDown(row, { key: 'Enter' });
      else fireEvent.click(row);

      await waitFor(() => expect(screen.getByText('body three')).toBeVisible());
      await waitFor(() => expect(host.scrollTop).toBe(120));
    });
  }
});

describe('Find’s current match inside a COLLAPSED section (FR-040)', () => {
  it('expands the section a match is in, mounted through the real find bar — proven by the previously-hidden text becoming visible', async () => {
    m = await mountMarkdownPreview(DOC, undefined, { extras: [createElement(SearchKeybindings, { key: 'search-kb' })] });
    await screen.findByText('Jump to Three', {}, COLD);
    const bodyThree = () => screen.getByText('body three');

    setDocumentFoldState(`panel:${m.id}`, setSection(initialFold('expanded'), 'two', true));
    await waitFor(() => expect(bodyThree()).not.toBeVisible());

    const user = userEvent.setup();
    await press(user, 'f');
    await waitFor(() => expect(screen.getByTestId(`find-bar-${m!.id}`)).toBeVisible());
    await user.type(screen.getByTestId('find-input'), 'body three');
    await waitFor(() => expect(screen.getByTestId('find-count')).toHaveTextContent('1 of 1'));

    await waitFor(() => expect(bodyThree()).toBeVisible());
  });
});
