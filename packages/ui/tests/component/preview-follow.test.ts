/**
 * 044 T091 — what following a link DOES, decided by the chrome (`PreviewPanel.onFollow`) and main's
 * answer to `navigate` (FR-090 – FR-091, FR-107; contracts/preview-ipc.md §1 `navigate`,
 * contracts/menus-and-controls.md §9).
 *
 * The whole panel is mounted with the shipped Markdown body and main's bridge faked, so each case is a
 * real Ctrl+click on a real rendered link. jsdom has no layout, so the geometry is supplied, as in
 * `markdown-body.test.ts`: the body host's viewport starts at client y 100, and every source-mapped block
 * is drawn at 20px per source line. A heading brought to the top of the host therefore leaves the host's
 * `scrollTop` at `line * 20`.
 *
 * 044 T192 (iteration 2026-09-15, FR-115) — a followed same-document heading is now a history jump: the
 * heading block below supersedes the old "never reach main" rule.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewNavigateResponse } from '@throng/core';
import { captureScrollAnchor } from '../../src/renderer/preview/providers/markdown/scroll-anchor.js';
import { headingRevealTarget } from '../../src/renderer/editor/reveal-range.js';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';
import { revealPreviewFragment } from '../../src/renderer/preview/preview-panel-handles.js';
import { COLD, README, ROOT, mountMarkdownPreview, previewUpdate, type MountedPreview } from './helpers/mount-preview-panel.js';

const SETUP = `${ROOT}/docs/setup.md`;

const DOC = [
  '# Readme', //                                       0
  '', //                                               1
  '[Site](https://example.com/)', //                   2
  '', //                                               3
  '[Here](#usage) and [Nowhere](#no-such-heading)', // 4
  '', //                                               5
  '[Setup](docs/setup.md#install) and [Plain](docs/setup.md) and [Gone](docs/missing.md)', // 6
  '', //                                               7
  '[Code](src/app.ts#main) and [Out](../outside.md)', // 8
  '', //                                               9
  '## Usage', //                                       10
  '', //                                               11
  'Usage text.', //                                    12
].join('\n');

let m: MountedPreview | undefined;

async function mountDoc(text = DOC): Promise<MountedPreview> {
  m = await mountMarkdownPreview(text);
  await screen.findByText('Site', {}, COLD);
  return m;
}

const panel = (): MountedPreview => m!;
const host = (): HTMLElement => screen.getByTestId(`preview-body-${panel().id}`);

/** Supply layout: the host's viewport starts at y 100; each source line is 20px. */
function withGeometry(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
    const scroller = document.querySelector<HTMLElement>('.preview-panel__body');
    if (this === scroller) return { top: 100, height: 400, left: 0, width: 400 } as DOMRect;
    const line = Number(this.getAttribute('data-source-line'));
    return { top: 100 + line * 20 - (scroller?.scrollTop ?? 0), height: 40, left: 0, width: 400 } as DOMRect;
  });
}

function ctrlClick(text: string): void {
  fireEvent.click(screen.getByText(text), { ctrlKey: true });
}

const notice = (): HTMLElement | null => screen.queryByTestId(`preview-link-notice-${panel().id}`);

beforeEach(() => {
  __resetPreviewStore();
  withGeometry();
});

afterEach(() => {
  m?.unmount();
  m = undefined;
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe('external links (FR-091)', () => {
  /*
   * Through the PREVIEW's channel, not the general one (adversarial review ruling): main opens `mailto:` for
   * a preview link only (044 FR-091), and keeps http(s)-only for a terminal's (024 FR-019).
   */
  it('open through window.throng.preview.openExternal, never the general channel, and nothing goes to main', async () => {
    await mountDoc();
    ctrlClick('Site');
    expect(panel().openExternal).toHaveBeenCalledWith('https://example.com/');
    expect(panel().generalOpenExternal).not.toHaveBeenCalled();
    expect(panel().preview.navigate).not.toHaveBeenCalled();
  });
});

/*
 * 044 T192 — SUPERSEDED by FR-115 (iteration 2026-09-15). This block was titled "same-document headings never
 * reach main (FR-090f)" and asserted that `navigate` was never called for a heading. FR-115 makes a followed
 * heading a history entry, so a FOUND heading now reaches main exactly once, as `intent: 'heading'`, after the
 * scroll (contracts/preview-ipc.md §1, contracts/navigation-history.md §8). A heading that is not found, and a
 * link to this file without a fragment, still send nothing.
 */
describe('same-document headings are history jumps (FR-090f, FR-115)', () => {
  const TOP = { line: 0, offsetRatio: 0 };

  it('bring the slugged heading to the top of the body, then send ONE heading intent with both places', async () => {
    await mountDoc();
    panel().preview.navigate.mockImplementation(() => new Promise(() => {}));
    ctrlClick('Here');
    expect(host().scrollTop).toBe(200);
    await waitFor(() => expect(panel().preview.navigate).toHaveBeenCalledTimes(1));
    expect(panel().preview.navigate).toHaveBeenCalledWith({
      panelId: panel().id,
      target: { absPath: README, fragment: 'usage' },
      intent: { kind: 'heading' },
      // The top of the document is a place, never omitted.
      leavingViewState: TOP,
      arrivingViewState: { line: 10, offsetRatio: 0 },
    });
    expect(notice()).toBeNull();
  });

  it('the place left is where the reader WAS, read before the scroll', async () => {
    await mountDoc();
    host().scrollTop = 90; // a quarter of the way into the block on line 4
    const leaving = captureScrollAnchor(host());
    expect(leaving).toEqual({ line: 4, offsetRatio: 0.25 });
    panel().preview.navigate.mockImplementation(() => new Promise(() => {}));
    ctrlClick('Here');
    await waitFor(() => expect(panel().preview.navigate).toHaveBeenCalledTimes(1));
    expect(panel().preview.navigate.mock.calls[0][0]).toMatchObject({
      intent: { kind: 'heading' },
      leavingViewState: leaving,
      arrivingViewState: { line: 10, offsetRatio: 0 },
    });
  });

  it('main’s unchanged snapshot leaves the reader at the heading', async () => {
    await mountDoc();
    panel().preview.navigate.mockImplementation((req) =>
      Promise.resolve({
        kind: 'shown',
        update: previewUpdate({ panelId: req.panelId, filePath: README, revision: 1, content: null }),
      }),
    );
    ctrlClick('Here');
    await waitFor(() => expect(panel().preview.navigate).toHaveBeenCalledTimes(1));
    await act(() => Promise.resolve());
    expect(host().scrollTop).toBe(200);
    expect(screen.getByText('Usage text.')).toBeInTheDocument();
    expect(panel().preview.navigate).toHaveBeenCalledTimes(1);
  });

  it('a missing heading raises ONE link notice naming it, scrolls nothing, and sends nothing', async () => {
    await mountDoc();
    ctrlClick('Nowhere');
    const n = await screen.findByTestId(`preview-link-notice-${panel().id}`);
    expect(n.getAttribute('data-notice-kind')).toBe('link-missing-heading');
    expect(n.textContent).toContain('no-such-heading');
    expect(host().scrollTop).toBe(0);
    await act(() => Promise.resolve());
    expect(panel().preview.navigate).not.toHaveBeenCalled();
  });

  it('a link to the document’s OWN file with a fragment is a same-document heading jump', async () => {
    await mountDoc(`${DOC}\n\n[Self](README.md#usage)\n`);
    panel().preview.navigate.mockImplementation(() => new Promise(() => {}));
    ctrlClick('Self');
    expect(host().scrollTop).toBe(200);
    await waitFor(() => expect(panel().preview.navigate).toHaveBeenCalledTimes(1));
    expect(panel().preview.navigate).toHaveBeenCalledWith({
      panelId: panel().id,
      target: { absPath: README, fragment: 'usage' },
      intent: { kind: 'heading' },
      leavingViewState: TOP,
      arrivingViewState: { line: 10, offsetRatio: 0 },
    });
  });

  it('a link to the document’s OWN file WITHOUT a fragment scrolls to the top and sends nothing (FR-103)', async () => {
    await mountDoc(`${DOC}\n\n[Top](README.md)\n`);
    host().scrollTop = 150;
    ctrlClick('Top');
    expect(host().scrollTop).toBe(0);
    await act(() => Promise.resolve());
    expect(panel().preview.navigate).not.toHaveBeenCalled();
  });

  /*
   * analyze Medium 2 — a heading followed while the preview is still drawing the file the run moved to. The
   * scroll waits for `onDrawn`; the heading intent must wait with it and still be sent, naming that file.
   */
  it('a heading followed while the body is still drawing the run’s new file is sent once that file has drawn', async () => {
    await mountDoc();
    const GUIDE = `${ROOT}/docs/guide.md`;
    const guideText = ['# Guide', '', 'Intro.', '', '', '', '## Usage', '', 'Guide usage.'].join('\n');
    panel().preview.navigate.mockImplementation(() => new Promise(() => {}));

    // The run moves to guide.md; the body has not drawn it yet, so README's links are still on screen.
    panel().push(previewUpdate({ panelId: panel().id, filePath: GUIDE, revision: 2, content: { kind: 'text', text: guideText } }));
    expect(screen.getByText('Here')).toBeInTheDocument();
    ctrlClick('Here');
    expect(panel().preview.navigate).not.toHaveBeenCalled();

    await screen.findByText('Guide usage.', {}, COLD);
    // `## Usage` is on line 6 of guide.md.
    await waitFor(() => expect(host().scrollTop).toBe(120));
    await waitFor(() => expect(panel().preview.navigate).toHaveBeenCalledTimes(1));
    expect(panel().preview.navigate).toHaveBeenCalledWith({
      panelId: panel().id,
      target: { absPath: GUIDE, fragment: 'usage' },
      intent: { kind: 'heading' },
      leavingViewState: TOP,
      arrivingViewState: { line: 6, offsetRatio: 0 },
    });
  });

  it('a link’s own fragment, scrolled to once main has shown the other file, is NOT a heading jump', async () => {
    await mountDoc();
    const setupText = '# Setup\n\nIntro.\n\n## Install\n\nSteps.\n';
    panel().preview.navigate.mockImplementationOnce(() =>
      Promise.resolve({
        kind: 'shown',
        update: previewUpdate({ panelId: panel().id, filePath: SETUP, revision: 5, content: { kind: 'text', text: setupText } }),
        fragment: 'install',
      }),
    );
    ctrlClick('Setup');
    await waitFor(() => expect(host().scrollTop).toBe(80));
    await act(() => Promise.resolve());
    expect(panel().preview.navigate).toHaveBeenCalledTimes(1);
    expect(panel().preview.navigate.mock.calls[0][0].intent).toEqual({ kind: 'link' });
  });
});

describe('fix round 1 — a link followed successfully clears a stale link notice (item 13)', () => {
  it('a heading scroll clears the missing-heading notice left by the previous link', async () => {
    await mountDoc();
    ctrlClick('Nowhere');
    await screen.findByTestId(`preview-link-notice-${panel().id}`);
    ctrlClick('Here');
    await waitFor(() => expect(notice()).toBeNull());
    expect(host().scrollTop).toBe(200);
  });

  it('an external open clears it too', async () => {
    await mountDoc();
    ctrlClick('Nowhere');
    await screen.findByTestId(`preview-link-notice-${panel().id}`);
    ctrlClick('Site');
    await waitFor(() => expect(notice()).toBeNull());
  });
});

describe('outside the project (FR-090e)', () => {
  it('raises link-outside naming the link as written, and asks main nothing', async () => {
    await mountDoc();
    ctrlClick('Out');
    const n = await screen.findByTestId(`preview-link-notice-${panel().id}`);
    expect(n.getAttribute('data-notice-kind')).toBe('link-outside');
    expect(n.textContent).toContain('../outside.md');
    expect(panel().preview.navigate).not.toHaveBeenCalled();
  });
});

describe('a project file goes to main as a link navigation (FR-090, FR-107)', () => {
  it('sends navigate with intent link and the view state captured from the body BEFORE the call', async () => {
    await mountDoc();
    const scroller = host();
    scroller.scrollTop = 90; // reading the block on line 4, a quarter of the way in
    const expected = captureScrollAnchor(scroller);
    expect(expected).not.toBeNull();

    let atCall: unknown = 'not called';
    panel().preview.navigate.mockImplementation((req) => {
      atCall = req.leavingViewState;
      return Promise.resolve({ kind: 'focusedOther', panelId: 'other' });
    });
    ctrlClick('Setup');

    await waitFor(() => expect(panel().preview.navigate).toHaveBeenCalledTimes(1));
    expect(panel().preview.navigate).toHaveBeenCalledWith({
      panelId: panel().id,
      target: { absPath: SETUP, fragment: 'install' },
      intent: { kind: 'link' },
      leavingViewState: expected,
    });
    expect(atCall).toEqual(expected);
  });

  /*
   * U3b concern 1 (FR-107, FR-115) — the reader at the TOP is at a place, and the top is
   * `{ line: 0, offsetRatio: 0 }`, never "no place". Omitted, main stores nothing on the entry being left,
   * and a later Back onto it is indistinguishable from an ordinary update: the position moves and the view
   * does not. A heading jump has always sent the explicit top; a link and a history step must too.
   */
  it('a reader at the TOP leaves an explicit place, never an omitted one', async () => {
    await mountDoc();
    expect(host().scrollTop).toBe(0);
    expect(captureScrollAnchor(host())).toBeNull();
    panel().preview.navigate.mockResolvedValue({ kind: 'focusedOther', panelId: 'other' });

    ctrlClick('Plain');

    await waitFor(() => expect(panel().preview.navigate).toHaveBeenCalledTimes(1));
    expect(panel().preview.navigate.mock.calls[0][0].leavingViewState).toEqual({ line: 0, offsetRatio: 0 });
  });

  it('omits the fragment when the link names none', async () => {
    await mountDoc();
    panel().preview.navigate.mockResolvedValue({ kind: 'focusedOther', panelId: 'other' });
    ctrlClick('Plain');
    await waitFor(() => expect(panel().preview.navigate).toHaveBeenCalledTimes(1));
    expect(panel().preview.navigate.mock.calls[0][0].target).toEqual({ absPath: SETUP });
  });
});

describe('main’s answers', () => {
  const setupText = '# Setup\n\nIntro.\n\n## Install\n\nSteps.\n';

  // A NAVIGATION's answer, so it carries a raised `navigationSeq` exactly as main's does (T177): the
  // target is shown from its top, where a re-point at the same count would keep the reader's place.
  const shown = (text: string | null, fragment?: string, over: Record<string, unknown> = {}): PreviewNavigateResponse => ({
    kind: 'shown',
    update: previewUpdate({
      panelId: panel().id,
      filePath: SETUP,
      revision: 5,
      navigationSeq: 1,
      content: text === null ? null : { kind: 'text', text },
      ...over,
    }),
    ...(fragment !== undefined ? { fragment } : {}),
  });

  it('shown → applies the update and brings the fragment’s heading to the top (FR-090a, FR-090b)', async () => {
    await mountDoc();
    panel().preview.navigate.mockImplementation(() => Promise.resolve(shown(setupText, 'install')));
    ctrlClick('Setup');

    await waitFor(() => expect(screen.getByText('Steps.')).toBeInTheDocument());
    // `## Install` is on line 4.
    await waitFor(() => expect(host().scrollTop).toBe(80));
    expect(screen.queryByText('Usage text.')).toBeNull();
    expect(notice()).toBeNull();
  });

  it('shown without a fragment → the target from its top', async () => {
    await mountDoc();
    host().scrollTop = 300;
    panel().preview.navigate.mockImplementation(() => Promise.resolve(shown(setupText)));
    ctrlClick('Plain');
    await waitFor(() => expect(screen.getByText('Steps.')).toBeInTheDocument());
    expect(host().scrollTop).toBe(0);
  });

  it('shown for a file whose #heading the target lacks → the file from its top, and ONE notice naming the heading (FR-090e)', async () => {
    await mountDoc();
    host().scrollTop = 300;
    panel().preview.navigate.mockImplementation(() => Promise.resolve(shown('# Setup\n\nNo install section.\n', 'install')));
    ctrlClick('Setup');

    const n = await screen.findByTestId(`preview-link-notice-${panel().id}`);
    expect(n.getAttribute('data-notice-kind')).toBe('link-missing-heading');
    expect(n.textContent).toContain('install');
    expect(screen.getByText('No install section.')).toBeInTheDocument();
    expect(host().scrollTop).toBe(0);
    expect(screen.getAllByTestId(`preview-link-notice-${panel().id}`)).toHaveLength(1);
  });

  it('fix round 1 (item 1) — shown for a file main could not read: the previous document is gone', async () => {
    await mountDoc();
    panel().preview.navigate.mockImplementation(() =>
      Promise.resolve(shown('', undefined, { notice: { kind: 'too-large' } })),
    );
    ctrlClick('Plain');
    await waitFor(() => expect(screen.queryByText('Usage text.')).toBeNull());
    expect(screen.getByTestId(`preview-markdown-${panel().id}`).textContent).toBe('');
  });

  it('fix round 1 (item 1) — a shown update for ANOTHER file with content "unchanged" never keeps the old document under the new path', async () => {
    await mountDoc();
    panel().preview.navigate.mockImplementation(() => Promise.resolve(shown(null)));
    ctrlClick('Plain');
    await waitFor(() => expect(panel().preview.navigate).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Usage text.')).toBeNull());
    expect(screen.queryByText('Site')).toBeNull();
  });

  it('focusedOther → this preview does not change (FR-090c)', async () => {
    await mountDoc();
    panel().preview.navigate.mockResolvedValue({ kind: 'focusedOther', panelId: 'other' });
    ctrlClick('Setup');
    await waitFor(() => expect(panel().preview.navigate).toHaveBeenCalled());
    await act(() => Promise.resolve());
    expect(screen.getByText('Usage text.')).toBeInTheDocument();
    expect(notice()).toBeNull();
  });

  it('openedInEditor → the Files & Folders open path, carrying the heading for the caret (FR-090d)', async () => {
    await mountDoc();
    const opened: unknown[] = [];
    const listener = (e: Event): void => void opened.push((e as CustomEvent).detail);
    window.addEventListener('throng:open-file', listener);
    try {
      panel().preview.navigate.mockResolvedValue({ kind: 'openedInEditor' });
      ctrlClick('Code');
      await waitFor(() => expect(opened).toHaveLength(1));
      expect(opened[0]).toEqual({ absPath: `${ROOT}/src/app.ts`, headingFragment: 'main' });
      expect(screen.getByText('Usage text.')).toBeInTheDocument();
    } finally {
      window.removeEventListener('throng:open-file', listener);
    }
  });

  it('refused → one notice naming the target, and the preview stays where it is (FR-090e)', async () => {
    await mountDoc();
    panel().preview.navigate.mockResolvedValue({
      kind: 'refused',
      notice: { kind: 'link-missing-file', target: `${ROOT}/docs/missing.md` },
    });
    ctrlClick('Gone');
    const n = await screen.findByTestId(`preview-link-notice-${panel().id}`);
    expect(n.getAttribute('data-notice-kind')).toBe('link-missing-file');
    expect(n.textContent).toContain('docs/missing.md');
    expect(screen.getByText('Usage text.')).toBeInTheDocument();
  });

  it('a repeat of the same notice FLASHES the one already shown rather than stacking a second', async () => {
    await mountDoc();
    panel().preview.navigate.mockResolvedValue({
      kind: 'refused',
      notice: { kind: 'link-missing-file', target: `${ROOT}/docs/missing.md` },
    });
    ctrlClick('Gone');
    const first = await screen.findByTestId(`preview-link-notice-${panel().id}`);
    const flashBefore = Number(first.getAttribute('data-flash'));

    ctrlClick('Gone');
    await waitFor(() =>
      expect(Number(screen.getByTestId(`preview-link-notice-${panel().id}`).getAttribute('data-flash'))).toBe(flashBefore + 1),
    );
    expect(screen.getAllByTestId(`preview-link-notice-${panel().id}`)).toHaveLength(1);
    expect(screen.getByTestId(`preview-link-notice-${panel().id}`)).toHaveClass('panel-failure--flash');
    // 044 US2 fix round 1 (item 6) — flashed IN PLACE, as the file banner is: the same element, so the
    // focus of a keyboard user on its Dismiss control survives the repeat.
    expect(screen.getByTestId(`preview-link-notice-${panel().id}`)).toBe(first);
  });

  it('the notice uses the shared in-panel notice element and is dismissed by its own control', async () => {
    await mountDoc();
    ctrlClick('Nowhere');
    const n = await screen.findByTestId(`preview-link-notice-${panel().id}`);
    expect(n).toHaveClass('panel-failure');
    expect(n.querySelector('.panel-failure__text .panel-failure__headline')).not.toBeNull();
    const dismiss = screen.getByTitle('Dismiss');
    expect(dismiss).toHaveClass('panel-failure__control');
    fireEvent.click(dismiss);
    expect(notice()).toBeNull();
  });
});

describe('fix round 2 — an overtaken navigate is ignored; every successful follow clears a stale notice', () => {
  const OTHER = `${ROOT}/docs/other.md`;
  const TWO = '# Readme\n\n[A](docs/setup.md#install) and [B](docs/other.md#usage) and [Nowhere](#nope)\n\nReadme text.\n';

  function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it('A answers AFTER B with main’s overtaken snapshot: B’s notice stays and nothing scrolls to A’s heading', async () => {
    m = await mountMarkdownPreview(TWO);
    await screen.findByText('A', {}, COLD);
    const a = deferred<PreviewNavigateResponse>();
    const b = deferred<PreviewNavigateResponse>();
    panel().preview.navigate.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise);

    ctrlClick('A');
    ctrlClick('B');
    await waitFor(() => expect(panel().preview.navigate).toHaveBeenCalledTimes(2));

    // B answers first: other.md, which has an `install` heading but no `usage` one — so B raises its notice.
    const otherText = '# Other\n\n## Install\n\nOther text.\n';
    const bUpdate = previewUpdate({ panelId: panel().id, filePath: OTHER, revision: 6, content: { kind: 'text', text: otherText } });
    await act(async () => {
      b.resolve({ kind: 'shown', update: bUpdate, fragment: 'usage' });
    });
    const n = await screen.findByTestId(`preview-link-notice-${panel().id}`);
    expect(n.textContent).toContain('usage');
    await waitFor(() => expect(screen.getByText('Other text.')).toBeInTheDocument());
    const scrollBefore = host().scrollTop;

    // A answers last with the run as it stands (other.md), no fragment — main's overtaken answer.
    await act(async () => {
      a.resolve({ kind: 'shown', update: bUpdate });
    });
    await act(() => Promise.resolve());

    const after = screen.getByTestId(`preview-link-notice-${panel().id}`);
    expect(after.getAttribute('data-notice-kind')).toBe('link-missing-heading');
    expect(after.textContent).toContain('usage');
    expect(after.textContent).not.toContain('install');
    expect(host().scrollTop).toBe(scrollBefore);
    expect(screen.getByText('Other text.')).toBeInTheDocument();
  });

  it.each<[string, PreviewNavigateResponse]>([
    ['openedInEditor', { kind: 'openedInEditor' }],
    ['focusedOther', { kind: 'focusedOther', panelId: 'other' }],
  ])('%s clears the notice an earlier link left', async (_name, response) => {
    m = await mountMarkdownPreview(TWO);
    await screen.findByText('A', {}, COLD);
    ctrlClick('Nowhere');
    await screen.findByTestId(`preview-link-notice-${panel().id}`);

    panel().preview.navigate.mockResolvedValue(response);
    ctrlClick('B');
    await waitFor(() => expect(panel().preview.navigate).toHaveBeenCalled());
    await waitFor(() => expect(notice()).toBeNull());
  });
});

describe('fix round 1 (item 9) — the panel’s revealFragment handle, as main’s focus reaches it (FR-090c)', () => {
  it('a present heading is brought to the top, with no notice', async () => {
    await mountDoc();
    act(() => {
      expect(revealPreviewFragment(panel().id, 'usage')).toBe(true);
    });
    expect(host().scrollTop).toBe(200);
    expect(notice()).toBeNull();
    // Main's own reveal, not a followed link: it records no jump (contracts/navigation-history.md §8).
    await act(() => Promise.resolve());
    expect(panel().preview.navigate).not.toHaveBeenCalled();
  });

  it('a missing heading raises exactly one link-missing-heading notice', async () => {
    await mountDoc();
    act(() => {
      revealPreviewFragment(panel().id, 'nope');
    });
    const n = await screen.findByTestId(`preview-link-notice-${panel().id}`);
    expect(n.getAttribute('data-notice-kind')).toBe('link-missing-heading');
    expect(screen.getAllByTestId(`preview-link-notice-${panel().id}`)).toHaveLength(1);
  });

  it('is removed when the panel unmounts', async () => {
    const mounted = await mountDoc();
    const id = mounted.id;
    mounted.unmount();
    m = undefined;
    expect(revealPreviewFragment(id, 'usage')).toBe(false);
  });
});

describe('the caret for a heading opened in an editor (FR-090d)', () => {
  it('a Markdown file places the caret at the start of the heading’s line', () => {
    const target = headingRevealTarget(`${ROOT}/docs/guide.md`, 'install');
    expect(target).toBeDefined();
    const text = '# Guide\n\nIntro.\n\n## Install\n\nSteps.\n';
    const at = text.indexOf('## Install');
    expect(target!.resolve(text)).toEqual({ from: at, to: at });
  });

  it('a Markdown file without the heading opens at the top', () => {
    expect(headingRevealTarget(`${ROOT}/docs/guide.md`, 'nope')!.resolve('# Guide\n')).toBeNull();
  });

  it('a language that cannot identify headings opens at the top', () => {
    expect(headingRevealTarget(`${ROOT}/src/app.ts`, 'main')).toBeUndefined();
    expect(headingRevealTarget(README, undefined)).toBeUndefined();
  });
});
