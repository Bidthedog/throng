/**
 * 044 T232 — where a synchronised pair lands: T222's top-of-document step (FR-121e) and where a pair starts
 * (FR-121h). plan.md Iteration 2026-09-16 decision 4, research R32, data-model §15.3.
 *
 * Mounted as `preview-scroll-sync.test.ts` mounts: the whole panel with the shipped Markdown body, the editor
 * side played by the store (`publishEditorTopLine` for its view scrolling, a registered scroller for its view
 * being asked to move), and layout supplied — the host's viewport at client y 100, 20px per source line, so
 * the block on line L at the top leaves `scrollTop` at `L * 20`.
 *
 * FR-121e as ruled (519d3a8a): the editor-line rule applies only to a step that CROSSES files; a same-file
 * step restores its place, the top included, and the editor follows it.
 */
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetEditorScrollStore,
  publishEditorTopLine,
  registerEditorScroller,
} from '../../src/renderer/editor/editor-scroll-store.js';
import { attachEditorScrollRelay, type RelayView } from '../../src/renderer/editor/editor-scroll-relay.js';
import { applyPreviewUpdate } from '../../src/renderer/preview/preview-store.js';
import { COLD, README, ROOT, mountMarkdownPreview, previewUpdate, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const paragraphs = (n: number, prefix = 'P'): string => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join('\n\n');
const DOC = paragraphs(30);
const PARENT = { panelId: 'ed-1', title: 'README.md' };
const OFF = { editor: { previews: { syncScroll: false } } };

let m: MountedPreviewWindow | undefined;
let ed1: ReturnType<typeof vi.fn<(line: number) => void>>;

const panel = (): MountedPreviewWindow => m!;
const host = (): HTMLElement => screen.getByTestId(`preview-body-${panel().id}`);

function withGeometry(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
    const scroller = document.querySelector<HTMLElement>('.preview-panel__body');
    if (this === scroller) return { top: 100, height: 400, left: 0, width: 400 } as DOMRect;
    const line = Number(this.getAttribute('data-source-line'));
    return { top: 100 + line * 20 - (scroller?.scrollTop ?? 0), height: 40, left: 0, width: 400 } as DOMRect;
  });
}

function editorAt(editorPanelId: string, line: number, fromSync = false): void {
  act(() => publishEditorTopLine(editorPanelId, line, fromSync));
}

async function frames(n = 2): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
}

async function mountDoc(opts: { settings?: Record<string, unknown>; attachParent?: boolean; attachViewState?: unknown } = {}): Promise<void> {
  m = await mountMarkdownPreview(DOC, README, {
    settings: opts.settings,
    attach: {
      ...(opts.attachParent === false ? {} : { parent: PARENT }),
      ...(opts.attachViewState !== undefined ? { viewState: opts.attachViewState } : {}),
    },
  });
  await screen.findByText('P29', {}, COLD);
}

/**
 * T222's route: synchronised at line 13, the reader scrolls to P20 and follows a link to a file with no
 * editor (sync stops), then presses Back — main answers README again with `back` as the update's extras.
 */
async function backFromFileWithNoEditor(back: { parent?: typeof PARENT | null; viewState: unknown }): Promise<void> {
  editorAt('ed-1', 13);
  host().scrollTop = 800;
  panel().push(
    previewUpdate({
      panelId: panel().id,
      revision: 3,
      filePath: `${ROOT}/docs/setup.md`,
      content: { kind: 'text', text: '# Setup\n\nStep one.' },
      parent: null,
      navigationSeq: 1,
    }),
  );
  await screen.findByText('Step one.');
  await frames();
  ed1.mockClear();
  panel().push(
    previewUpdate({
      panelId: panel().id,
      revision: 4,
      content: { kind: 'text', text: DOC },
      parent: back.parent === undefined ? PARENT : back.parent,
      navigationSeq: 2,
      viewState: back.viewState,
    }),
  );
  await screen.findByText('P29', {}, COLD);
  await frames();
}

beforeEach(() => {
  __resetEditorScrollStore();
  withGeometry();
  ed1 = vi.fn<(line: number) => void>();
  registerEditorScroller('ed-1', ed1);
});

afterEach(() => {
  m?.unmount();
  m = undefined;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('FR-121e / T222 — a step onto the top of a document', () => {
  it('(a) a cross-file Back onto an entry with no saved place lands on the editor’s line, and drives nothing', async () => {
    await mountDoc();
    await backFromFileWithNoEditor({ viewState: null });

    expect(host().scrollTop).toBe(240);
    expect(ed1).not.toHaveBeenCalled();
  });

  it('(b) a SAME-file step onto the top restores the top, and the editor follows it (the 519d3a8a ruling)', async () => {
    await mountDoc();
    editorAt('ed-1', 20);
    await waitFor(() => expect(host().scrollTop).toBe(400));

    panel().push(previewUpdate({ panelId: panel().id, revision: 2, content: null, parent: PARENT, viewState: { line: 0, offsetRatio: 0 } }));
    await frames();

    expect(host().scrollTop).toBe(0);
    expect(ed1).toHaveBeenCalledTimes(1);
    expect(ed1).toHaveBeenCalledWith(0);
  });

  it('(b2) a followed LINK to a parented file starts at the top and drives that editor there — never to its own line (analysis C2)', async () => {
    await mountDoc();
    editorAt('ed-1', 13);
    await waitFor(() => expect(host().scrollTop).toBe(240));
    const ed2 = vi.fn<(line: number) => void>();
    registerEditorScroller('ed-2', ed2);
    editorAt('ed-2', 30);

    panel().push(
      previewUpdate({
        panelId: panel().id,
        revision: 2,
        filePath: `${ROOT}/docs/setup.md`,
        content: { kind: 'text', text: paragraphs(30, 'S') },
        parent: { panelId: 'ed-2', title: 'setup.md' },
        navigationSeq: 1,
      }),
    );
    await screen.findByText('S29');
    await frames();

    expect(host().scrollTop).toBe(0);
    expect(ed2).toHaveBeenCalledTimes(1);
    expect(ed2).toHaveBeenCalledWith(0);
  });

  it('(c) with the setting off, the same Back lands at the top (FR-107)', async () => {
    await mountDoc({ settings: OFF });
    await backFromFileWithNoEditor({ viewState: null });

    expect(host().scrollTop).toBe(0);
    expect(ed1).not.toHaveBeenCalled();
  });

  it('(d) on a standalone preview, the same Back lands at the top (FR-107)', async () => {
    await mountDoc();
    await backFromFileWithNoEditor({ parent: null, viewState: null });

    expect(host().scrollTop).toBe(0);
    expect(ed1).not.toHaveBeenCalled();
  });

  it('(e) with no view of the parent in this window, the same Back lands at the top and requests nothing', async () => {
    await mountDoc();
    // No scroller and no line for ed-1 here: its view is in another window, so nothing can be requested.
    __resetEditorScrollStore();
    host().scrollTop = 800;
    panel().push(
      previewUpdate({
        panelId: panel().id,
        revision: 3,
        filePath: `${ROOT}/docs/setup.md`,
        content: { kind: 'text', text: '# Setup\n\nStep one.' },
        parent: null,
        navigationSeq: 1,
      }),
    );
    await screen.findByText('Step one.');
    panel().push(
      previewUpdate({ panelId: panel().id, revision: 4, content: { kind: 'text', text: DOC }, parent: PARENT, navigationSeq: 2, viewState: null }),
    );
    await screen.findByText('P29', {}, COLD);
    await frames();

    expect(host().scrollTop).toBe(0);
    expect(ed1).not.toHaveBeenCalled();
  });

  it('(f) a saved place part-way down is restored, and then the editor follows it (FR-107, FR-121f)', async () => {
    await mountDoc();
    await backFromFileWithNoEditor({ viewState: { line: 40, offsetRatio: 0 } });

    expect(host().scrollTop).toBe(800);
    expect(ed1).toHaveBeenCalledTimes(1);
    expect(ed1).toHaveBeenCalledWith(40);
  });
});

describe('FR-121h — where a pair starts', () => {
  it('(g) opening beside an editor: the editor’s line wins over the saved place, and nothing is requested', async () => {
    editorAt('ed-1', 13);
    await mountDoc({ attachViewState: { line: 40, offsetRatio: 0 } });
    await frames();

    expect(host().scrollTop).toBe(240);
    expect(ed1).not.toHaveBeenCalled();
  });

  it('(h) a place from a re-attach arriving after the first draw does not move an opening pair off the editor’s line', async () => {
    editorAt('ed-1', 13);
    await mountDoc();
    await waitFor(() => expect(host().scrollTop).toBe(240));

    act(() => {
      applyPreviewUpdate(
        previewUpdate({ panelId: panel().id, revision: 1, content: null, parent: PARENT, viewState: { line: 40, offsetRatio: 0 } }),
        'attach',
      );
    });
    await frames();

    expect(host().scrollTop).toBe(240);
    expect(ed1).not.toHaveBeenCalled();
  });

  it('(i) adoption: a standalone preview gaining an editor places the editor at the preview, and does not move', async () => {
    await mountDoc({ attachParent: false });
    host().scrollTop = 800;
    host().dispatchEvent(new Event('scroll'));
    await frames();
    const ed9 = vi.fn<(line: number) => void>();
    registerEditorScroller('ed-9', ed9);

    // Open in Editor: the same file gains a parent, and the navigation count stands still.
    panel().push(previewUpdate({ panelId: panel().id, revision: 2, content: null, parent: { panelId: 'ed-9', title: 'README.md' } }));
    await frames();
    expect(ed9).toHaveBeenCalledTimes(1);
    expect(ed9).toHaveBeenCalledWith(40);
    expect(host().scrollTop).toBe(800);

    // The new view's first publishes: where it was constructed, then where the request put it.
    editorAt('ed-9', 0);
    await frames();
    expect(host().scrollTop).toBe(800);
    editorAt('ed-9', 40, true);
    await frames();
    expect(host().scrollTop).toBe(800);
    expect(ed9).toHaveBeenCalledTimes(1);

    // Paired from here on: the editor's own next move is followed.
    editorAt('ed-9', 20);
    await waitFor(() => expect(host().scrollTop).toBe(400));
  });

  /*
   * Review round 2, I2. The adopted editor cannot move towards the preview's line: its whole document fits its
   * viewport. The relay's scroll moves nothing, so no `scroll` event follows — and the adoption must still end,
   * or neither side ever drives the other again. The editor side is the real relay over a view that cannot
   * scroll; only the view is fake.
   */
  it('(i2) adoption by an editor that cannot move towards the preview still pairs them, both ways', async () => {
    await mountDoc({ attachParent: false });
    host().scrollTop = 800;
    host().dispatchEvent(new Event('scroll'));
    await frames();

    const listeners = new Set<() => void>();
    const model = { top: 0 };
    const view: RelayView = {
      scrollDOM: {
        get scrollTop() {
          return model.top * 20;
        },
        getBoundingClientRect: () => ({ top: 0, left: 0 }),
        addEventListener: (_type: 'scroll', l: () => void) => void listeners.add(l),
        removeEventListener: (_type: 'scroll', l: () => void) => void listeners.delete(l),
      },
      contentDOM: { getBoundingClientRect: () => ({ top: 0, left: 40 }) },
      posAtCoords: () => model.top,
      // DOC's 59 lines, as the preview numbers them — in a viewport tall enough for all of them.
      state: { doc: { lines: 59, lineAt: (pos: number) => ({ number: pos + 1 }), line: (n: number) => ({ from: n - 1 }) } },
      // So a scroll request moves nothing, and fires no `scroll`.
      dispatch: vi.fn(),
    };
    const relay = attachEditorScrollRelay(view, 'ed-9', {
      raf: (cb) => requestAnimationFrame(() => cb()),
      caf: (id) => cancelAnimationFrame(id),
    });
    relay.ready();
    await frames();

    // Open in Editor: the same file gains a parent, and the navigation count stands still.
    panel().push(previewUpdate({ panelId: panel().id, revision: 2, content: null, parent: { panelId: 'ed-9', title: 'README.md' } }));
    await frames(4);
    expect(view.dispatch).toHaveBeenCalledTimes(1);
    expect(host().scrollTop).toBe(800);

    try {
      // The reader scrolls the preview: the editor is asked to follow (it still cannot move).
      host().scrollTop = 600;
      host().dispatchEvent(new Event('scroll'));
      await frames(4);
      expect(view.dispatch).toHaveBeenCalledTimes(2);

      // Enough is typed that the editor can scroll, and the reader scrolls it: the preview follows.
      model.top = 20;
      for (const l of [...listeners]) l();
      await waitFor(() => expect(host().scrollTop).toBe(400));
    } finally {
      relay.dispose();
    }
  });

  it('(j) turning the setting on aligns the pair by the editor’s line, and requests nothing', async () => {
    editorAt('ed-1', 13);
    await mountDoc({ settings: OFF });
    host().scrollTop = 800;

    panel().setSettings({ editor: { previews: { syncScroll: true } } });
    await waitFor(() => expect(host().scrollTop).toBe(240));
    await frames();

    expect(ed1).not.toHaveBeenCalled();
  });
});
