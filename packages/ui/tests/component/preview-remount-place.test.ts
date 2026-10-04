/**
 * 048 T053/T054 — #459: a preview whose tab is hidden and shown again comes back at its OWN last place
 * (FR-083, FR-084, SC-011).
 *
 * An inactive tab's panels are unmounted, so a tab switch — and a panel drag that hover-switches tabs and
 * back — is an unmount and a remount of the preview. On the way out the chrome stores the reader's place on
 * the run's current history entry (`throng:history:setViewState`); on the way back main's attach answer
 * carries it. This file drives exactly that path: the real `PanelPlaceholder` → `PreviewPanel` → shipped
 * Markdown body, unmounted and remounted by a gate above it, with main played by a fake that answers each
 * attach with the place the last detach stored.
 *
 * ══ LAYOUT ══
 *
 * jsdom has none, so `getBoundingClientRect` is supplied from a model of the body's DOM as it stands at the
 * moment of each read: the scroller's viewport starts at client y 100; every direct child of the body that
 * carries a source line is 20px tall, 0 while `hidden` (a collapsed section, 047 R6); a table is 100px until
 * the deferred table pass has laid it out (`table-layout: fixed`, 047 R13) and 60px after. A block inside a
 * hidden ancestor has Chromium's rect for a `display: none` box — all zeros. So the model moves content
 * exactly when the real body does: when the fold gutter hides a section, and when the table pass runs.
 *
 * The document has two collapsed sections and a table in every section, all above the reader's place.
 */
import { act, screen } from '@testing-library/react';
import { createElement, useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialFold, setSection, type PreviewAttachRequest, type PreviewUpdate } from '@throng/core';
import { setDocumentFoldState, __resetFoldStateStore } from '../../src/renderer/editor/fold-state-store.js';
import { __resetEditorScrollStore, publishEditorTopLine, registerEditorScroller } from '../../src/renderer/editor/editor-scroll-store.js';
import { topBlockLine } from '../../src/renderer/preview/providers/markdown/scroll-anchor.js';
import { COLD, README, mountMarkdownPreview, previewUpdate, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const VIEW_TOP = 100;
const LINE_PX = 20;
const TABLE_RAW_PX = 100;
const TABLE_LAID_OUT_PX = 60;
/** Longer than the body's table-layout debounce (120 ms), so the deferred pass has run. */
const TABLE_PASS_MS = 200;

function section(n: number): string {
  const paras = Array.from({ length: 4 }, (_, i) => `S${n} p${i}`).join('\n\n');
  return `## Section ${n}\n\n${paras}\n\n| a${n} | b${n} |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |`;
}
const DOC = ['# Title', 'Intro one', 'Intro two', ...Array.from({ length: 9 }, (_, i) => section(i + 1))].join('\n\n');
const LAST_TEXT = 'S9 p3';

// ── layout model ──────────────────────────────────────────────────────────────────────────────────────

function bodyEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.preview-markdown');
}

function blockHeight(el: Element): number {
  if (el.hasAttribute('hidden')) return 0;
  const table = el.tagName === 'TABLE' ? (el as HTMLElement) : el.querySelector<HTMLElement>('table');
  if (table !== null) return table.style.tableLayout === 'fixed' ? TABLE_LAID_OUT_PX : TABLE_RAW_PX;
  return el.hasAttribute('data-source-line') ? LINE_PX : 0;
}

const ZERO = { top: 0, height: 0, left: 0, width: 0, bottom: 0, right: 0, x: 0, y: 0 } as DOMRect;

function modelRect(el: Element): DOMRect {
  const scroller = document.querySelector<HTMLElement>('.preview-panel__body');
  if (el === scroller) return { ...ZERO, top: VIEW_TOP, height: 400, width: 400, bottom: VIEW_TOP + 400 } as DOMRect;
  const body = bodyEl();
  if (body === null || scroller === null || !body.contains(el) || el === body) return ZERO;
  // The body's direct child holding this element; any hidden box on the way up is `display: none`.
  let top = el;
  while (top.parentElement !== body) {
    if (top.hasAttribute('hidden')) return ZERO;
    top = top.parentElement!;
  }
  if (top.hasAttribute('hidden') && top !== el) return ZERO;
  let offset = 0;
  for (let s = top.previousElementSibling; s !== null; s = s.previousElementSibling) offset += blockHeight(s);
  const y = VIEW_TOP + offset - scroller.scrollTop;
  const height = blockHeight(top);
  return { ...ZERO, top: y, height, bottom: y + height, width: 400 } as DOMRect;
}

function withLayout(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
    return modelRect(this);
  });
}

// ── the window: a gate that unmounts and remounts the panel, and main's history ────────────────────────

let setGate: ((shown: boolean) => void) | null = null;
function Gate({ children }: { children: ReactElement }): ReactElement | null {
  const [shown, setShown] = useState(true);
  setGate = setShown;
  return shown ? children : null;
}

let m: MountedPreviewWindow | undefined;
/** What main's history holds for the panel's current entry — what the last detach stored. */
let stored: unknown;
let setViewState: ReturnType<typeof vi.fn>;
/** When set, the next attach answers only once this is called (the attach is in flight until then). */
let holdAttach = false;
let releaseAttach: (() => void) | null = null;
/** What main's next attach answer carries beyond the snapshot — a newer revision the hidden view missed. */
let answerOver: Partial<PreviewUpdate> = {};

const host = (): HTMLElement => screen.getByTestId(`preview-body-${m!.id}`);

async function settle(ms = TABLE_PASS_MS): Promise<void> {
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

async function mountDoc(attach: Partial<PreviewUpdate> = {}): Promise<void> {
  m = await mountMarkdownPreview(DOC, README, { attach, wrap: (children) => createElement(Gate, null, children) });
  setViewState = vi.fn((_panelId: string, viewState: unknown) => {
    stored = viewState;
  });
  const throng = Reflect.get(window, 'throng') as Record<string, unknown>;
  Reflect.set(throng, 'history', { setViewState, attach: vi.fn(), purge: vi.fn(), onChanged: () => () => {} });
  // Main: every attach answers the run's snapshot (the revision this window already holds) with the place
  // its history's current entry holds — exactly what the last detach stored.
  m.preview.attach.mockImplementation((req: PreviewAttachRequest) => {
    const answer = {
      ok: true as const,
      update: previewUpdate({
        panelId: req.panelId,
        filePath: req.filePath,
        content: { kind: 'text', text: DOC },
        revision: 1,
        ...attach,
        ...answerOver,
        ...(stored !== undefined ? { viewState: stored } : {}),
      }),
    };
    if (!holdAttach) return Promise.resolve(answer);
    return new Promise((resolve) => {
      releaseAttach = () => resolve(answer);
    });
  });
  await screen.findByText(LAST_TEXT, {}, COLD);
}

/** The reader collapses Sections 1 and 2 (above where they will read) and scrolls to `text`. */
async function readAt(foldKey: string, text: string): Promise<{ line: number | null; scrollTop: number }> {
  act(() => setDocumentFoldState(foldKey, setSection(setSection(initialFold('expanded'), 'section-1', true), 'section-2', true)));
  await settle();
  const el = screen.getByText(text);
  host().scrollTop = 0;
  host().scrollTop = el.getBoundingClientRect().top - VIEW_TOP;
  host().dispatchEvent(new Event('scroll'));
  await settle(0);
  return { line: topBlockLine(host()), scrollTop: host().scrollTop };
}

async function hide(): Promise<void> {
  act(() => setGate!(false));
  await settle(0);
}

async function show(): Promise<void> {
  act(() => setGate!(true));
  await screen.findByText(LAST_TEXT, {}, COLD);
}

beforeEach(() => {
  stored = undefined;
  answerOver = {};
  holdAttach = false;
  releaseAttach = null;
  __resetFoldStateStore();
  __resetEditorScrollStore();
  withLayout();
});

afterEach(() => {
  m?.unmount();
  m = undefined;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('#459 — a standalone preview shown again comes back at its own place (FR-083)', () => {
  it('after a hide and a show, the same block is at the top, at the same offset', async () => {
    await mountDoc();
    const before = await readAt(`panel:${m!.id}`, 'S6 p2');
    expect(before.line).not.toBeNull();

    await hide();
    expect(setViewState).toHaveBeenCalledWith(m!.id, expect.objectContaining({ line: before.line }));
    await show();
    await settle();

    expect(topBlockLine(host())).toBe(before.line);
    expect(host().scrollTop).toBe(before.scrollTop);
  });

  it('a show whose attach answers only after the body has drawn lands on the place through the fold and the table pass', async () => {
    await mountDoc();
    const before = await readAt(`panel:${m!.id}`, 'S6 p2');
    await hide();
    holdAttach = true;
    await show();
    await settle(0);
    act(() => releaseAttach!());
    await settle();

    expect(topBlockLine(host())).toBe(before.line);
    expect(host().scrollTop).toBe(before.scrollTop);
  });

  it('hidden again before the place was restored, it stores that place — never the top it was drawn at', async () => {
    await mountDoc();
    const before = await readAt(`panel:${m!.id}`, 'S6 p2');
    await hide();
    const first = stored;
    holdAttach = true;
    await show();
    await settle(0);
    // A drag hovers another tab again while this view's attach is still in flight.
    await hide();

    expect(stored).toEqual(first);
    holdAttach = false;
    await show();
    await settle();
    expect(topBlockLine(host())).toBe(before.line);
  });

  it('SC-011 — twenty hide/show cycles keep the place every time', async () => {
    await mountDoc();
    const before = await readAt(`panel:${m!.id}`, 'S6 p2');
    for (let i = 0; i < 20; i += 1) {
      await hide();
      await show();
      await settle();
      expect({ cycle: i, line: topBlockLine(host()), scrollTop: host().scrollTop }).toEqual({
        cycle: i,
        line: before.line,
        scrollTop: before.scrollTop,
      });
    }
    // Twenty real remounts, each waiting out the table pass: ~8 s on an idle machine, so the project's
    // 15 s default left no headroom and the full component run timed it out under load.
  }, 60_000);
});

describe('#459 — a parented preview with sync on keeps its own place, not the editor’s line (FR-084)', () => {
  const PARENT = { panelId: 'ed-1', title: 'README.md' };

  it('shown again, it returns to its own place and asks the editor to move nowhere', async () => {
    const ed1 = vi.fn<(line: number) => void>();
    registerEditorScroller('ed-1', ed1);
    act(() => publishEditorTopLine('ed-1', 4, false));
    await mountDoc({ parent: PARENT });
    await settle();
    const before = await readAt(`file:${README}`, 'S6 p2');
    await settle();
    // The reader's scroll asked the editor to follow (FR-121f); this fake editor stays at its own line 4, so
    // the editor and the preview are now each somewhere of their own.
    ed1.mockClear();

    await hide();
    await show();
    await settle();

    expect(topBlockLine(host())).toBe(before.line);
    expect(ed1).not.toHaveBeenCalled();
  });

  /*
   * Review R3. A hidden view hears no pushes (it subscribes only while mounted), so an edit made while its
   * tab is hidden reaches it as a NEWER revision in the attach answer. That answer must not turn the view's
   * own place into an opening's place (FR-121h), and the place re-anchors onto the new text by its source line.
   */
  it.each([
    ['far below the place', DOC.replace(LAST_TEXT, `${LAST_TEXT}\n\nAdded at the end`)],
    ['above the place, moving every line after it', DOC.replace('Intro two', 'Intro two\n\nAdded above\n\nAnd more')],
  ])('an edit %s while hidden: shown again at its own block, and the editor is asked nothing', async (_where, edited) => {
    const ed1 = vi.fn<(line: number) => void>();
    registerEditorScroller('ed-1', ed1);
    act(() => publishEditorTopLine('ed-1', 4, false));
    await mountDoc({ parent: PARENT });
    await settle();
    await readAt(`file:${README}`, 'S6 p2');
    await settle();
    ed1.mockClear();

    await hide();
    answerOver = { revision: 2, content: { kind: 'text', text: edited } };
    act(() => setGate!(true));
    await screen.findByText(edited.includes('Added at the end') ? 'Added at the end' : 'Added above', {}, COLD);
    await settle();

    const own = Number(screen.getByText('S6 p2').closest('[data-source-line]')!.getAttribute('data-source-line'));
    expect(topBlockLine(host())).toBe(own);
    expect(ed1).not.toHaveBeenCalled();
  });
});

describe('#459 — a standalone preview whose text changed while hidden (review R3)', () => {
  it('comes back at its own block, re-anchored past lines added above it', async () => {
    await mountDoc();
    await readAt(`panel:${m!.id}`, 'S6 p2');
    await hide();
    const edited = DOC.replace('Intro two', 'Intro two\n\nAdded above\n\nAnd more');
    answerOver = { revision: 2, content: { kind: 'text', text: edited } };
    act(() => setGate!(true));
    await screen.findByText('Added above', {}, COLD);
    await settle();

    const own = Number(screen.getByText('S6 p2').closest('[data-source-line]')!.getAttribute('data-source-line'));
    expect(topBlockLine(host())).toBe(own);
  });
});
