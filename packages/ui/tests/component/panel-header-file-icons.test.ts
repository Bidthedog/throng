/**
 * 081 US5 (#725, FR-040 – FR-045) — Open in OS Default Program and Find in File Explorer on editor and preview
 * title bars.
 *
 * Layer: component. What the header draws, its tooltips, what a click sends and which controls a width keeps are
 * all visible in jsdom; the drawn widths behind the thresholds are `panel-header-narrow.e2e.ts`'s. jsdom has no
 * layout, so the header's width is driven through a ResizeObserver double, as `panel-header-save-icons.test.ts` does.
 *
 * Mutations that redden this file: mount the pair after the save icons (order), drop the separator, read the
 * setting for Find (setting case), enable the buttons with no file (disabled case), give the buttons a second
 * handler instead of the menu's (the click cases compare the two), and leave the pair up below its threshold.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEditorState, removeEditorState } from '../../src/renderer/editor/editor-state.js';
import { __resetDirtyCloseStore } from '../../src/renderer/editor/dirty-close-store.js';
import { REVEAL_IN_TREE_EVENT } from '../../src/renderer/explorer/reveal-in-tree.js';
import { FILE_ICONS_MIN_HEADER_WIDTH, SAVE_AS_MIN_HEADER_WIDTH } from '../../src/renderer/workspace/panel-header-fit.js';
import { mountEditor } from './helpers/mount-editor.js';
import { mountMarkdownPreview } from './helpers/mount-preview-panel.js';
import { drawnIcon, iconMarkup } from './helpers/icon-markup.js';

const PANEL = 'p-ed';
const OPEN = 'Open in OS Default Program';
const FIND = 'Find in File Explorer';

const observers: { cb: ResizeObserverCallback; targets: Element[] }[] = [];
class FakeResizeObserver implements ResizeObserver {
  private readonly entry: { cb: ResizeObserverCallback; targets: Element[] };
  constructor(cb: ResizeObserverCallback) {
    this.entry = { cb, targets: [] };
    observers.push(this.entry);
  }
  observe(target: Element): void {
    this.entry.targets.push(target);
  }
  unobserve(): void {}
  disconnect(): void {
    this.entry.targets = [];
  }
}

function resizeHeader(panelId: string, width: number): void {
  const header = screen.getByTestId(`panel-handle-${panelId}`);
  act(() => {
    for (const o of observers) {
      const watching = o.targets.filter((t) => t === header || t.contains(header) || header.contains(t));
      if (watching.length === 0) continue;
      o.cb(
        watching.map(
          (target) =>
            ({
              target,
              contentRect: { width, height: 24, top: 0, left: 0, right: width, bottom: 24, x: 0, y: 0 },
            }) as unknown as ResizeObserverEntry,
        ),
        {} as ResizeObserver,
      );
    }
  });
}

/** What reached `throng:reveal-in-tree` since the test started. */
const revealed: (string | undefined)[] = [];
const onReveal = (e: Event): void => {
  revealed.push((e as CustomEvent<{ absPath?: string }>).detail.absPath);
};

beforeEach(() => {
  observers.length = 0;
  revealed.length = 0;
  globalThis.ResizeObserver = FakeResizeObserver;
  window.addEventListener(REVEAL_IN_TREE_EVENT, onReveal);
});
afterEach(() => {
  window.removeEventListener(REVEAL_IN_TREE_EVENT, onReveal);
  __resetDirtyCloseStore();
  removeEditorState(PANEL);
  Reflect.deleteProperty(window, 'throng');
  Reflect.deleteProperty(globalThis, 'ResizeObserver');
  document.body.replaceChildren();
});

const openBtn = (id = PANEL): HTMLElement | null => screen.queryByTestId(`panel-open-default-${id}`);
const findBtn = (id = PANEL): HTMLElement | null => screen.queryByTestId(`panel-find-in-explorer-${id}`);
const fileSep = (id = PANEL): HTMLElement | null => screen.queryByTestId(`panel-file-separator-${id}`);

/** Stub main's link route so Open in OS Default Program can be observed. */
function stubOpen(): ReturnType<typeof vi.fn> {
  const open = vi.fn(async () => ({ ok: true }));
  const throng = window.throng as unknown as { links?: Record<string, unknown> };
  throng.links = { ...(throng.links ?? {}), open };
  return open;
}

async function editorWith(absPath: string | null, settings?: Record<string, unknown>) {
  const h = mountEditor({
    panelId: PANEL,
    doc: { text: 'body\n', version: 1, absPath },
    withHeader: true,
    ...(settings ? { settings } : {}),
  });
  if (absPath) await waitFor(() => expect(getEditorState(PANEL)?.filePath).toBe(absPath));
  await screen.findByTestId(`panel-handle-${PANEL}`);
  if (settings) await waitFor(() => expect(h.settingsLoaded()).toBe(true));
  return h;
}

describe('an editor title bar (FR-040, FR-042)', () => {
  it('shows Open in OS Default Program, then Find in File Explorer, then a separator, before Save', async () => {
    await editorWith('C:/proj/note.txt');
    const order = [...openBtn()!.parentElement!.children].map((c) => c.getAttribute('data-testid'));
    const at = (id: string): number => order.indexOf(`${id}-${PANEL}`);
    expect(at('panel-open-default')).toBe(order.findIndex((t) => t !== null));
    expect(at('panel-open-default')).toBeLessThan(at('panel-find-in-explorer'));
    expect(at('panel-find-in-explorer')).toBeLessThan(at('panel-file-separator'));
    expect(at('panel-file-separator')).toBeLessThan(at('panel-save'));
    expect(fileSep()!.getAttribute('role')).toBe('separator');
    expect(fileSep()!.className).toBe('panel-box__actions-separator');
  });

  it('draws each as a themed icon button named by its hover title', async () => {
    await editorWith('C:/proj/note.txt');
    expect(drawnIcon(openBtn()!)).toBe(iconMarkup('openInDefaultProgram'));
    expect(drawnIcon(findBtn()!)).toBe(iconMarkup('findInFileExplorer'));
    expect(openBtn()!.getAttribute('title')).toBe(OPEN);
    expect(findBtn()!.getAttribute('title')).toBe(FIND);
    expect(openBtn()!.tagName).toBe('BUTTON');
    expect(findBtn()!.getAttribute('aria-label')).toBe(FIND);
  });
});

describe('what they do (FR-041)', () => {
  it('Find in File Explorer sends what the menu row sends', async () => {
    await editorWith('C:/proj/note.txt');
    fireEvent.click(findBtn()!);
    fireEvent.contextMenu(screen.getByTestId(`panel-handle-${PANEL}`));
    fireEvent.click(await screen.findByTestId(`menu-item-${FIND}`));
    expect(revealed).toEqual(['C:/proj/note.txt', 'C:/proj/note.txt']);
  });

  it('Open in OS Default Program sends what the menu row sends', async () => {
    await editorWith('C:/proj/note.txt');
    const open = stubOpen();
    fireEvent.click(openBtn()!);
    fireEvent.contextMenu(screen.getByTestId(`panel-handle-${PANEL}`));
    fireEvent.click(await screen.findByTestId(`menu-item-${OPEN}`));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(open.mock.calls[0]).toEqual(open.mock.calls[1]);
    expect(open.mock.calls[0]?.[0]).toMatchObject({ text: 'C:/proj/note.txt', panelId: PANEL });
  });
});

describe('a document with no file (FR-041)', () => {
  it('draws both buttons disabled with the reason, and the menu rows disabled with the same reason', async () => {
    await editorWith(null);
    for (const [btn, label] of [
      [openBtn(), OPEN],
      [findBtn(), FIND],
    ] as const) {
      expect(btn).toBeDisabled();
      expect(btn!.getAttribute('title')).toMatch(new RegExp(`^${label} is unavailable: .*save`, 'i'));
    }
    fireEvent.contextMenu(screen.getByTestId(`panel-handle-${PANEL}`));
    for (const [btn, label] of [
      [openBtn(), OPEN],
      [findBtn(), FIND],
    ] as const) {
      const row = await screen.findByTestId(`menu-item-${label}`);
      expect(row).toHaveAttribute('aria-disabled', 'true');
      expect(row.getAttribute('title')).toBe(btn!.getAttribute('title'));
    }
  });
});

describe('the default-program setting (FR-041)', () => {
  it('with explorer.showOpenInOsDefaultProgram off, the default-program button is not shown; Find stays', async () => {
    await editorWith('C:/proj/note.txt', { explorer: { showOpenInOsDefaultProgram: false } });
    await waitFor(() => expect(openBtn()).toBeNull());
    expect(findBtn()).not.toBeNull();
    expect(fileSep()).not.toBeNull();
  });
});

describe('a preview title bar (FR-040)', () => {
  it('shows the pair and its separator at the head of the actions', async () => {
    const m = await mountMarkdownPreview('hello', 'D:/proj/notes.md', {});
    await screen.findByTestId(`panel-handle-${m.id}`);
    const order = [...openBtn(m.id)!.parentElement!.children].map((c) => c.getAttribute('data-testid'));
    expect(order.indexOf(`panel-open-default-${m.id}`)).toBe(order.findIndex((t) => t !== null));
    expect(order.indexOf(`panel-find-in-explorer-${m.id}`)).toBe(order.indexOf(`panel-open-default-${m.id}`) + 1);
    expect(order.indexOf(`panel-file-separator-${m.id}`)).toBe(order.indexOf(`panel-find-in-explorer-${m.id}`) + 1);
    fireEvent.click(findBtn(m.id)!);
    expect(revealed).toEqual(['D:/proj/notes.md']);
    m.unmount();
  });
});

describe('a narrow title bar (FR-043)', () => {
  it('hides the pair and its separator before Save As, and widening restores them', async () => {
    expect(FILE_ICONS_MIN_HEADER_WIDTH).toBeGreaterThan(SAVE_AS_MIN_HEADER_WIDTH);
    await editorWith('C:/proj/note.txt');
    resizeHeader(PANEL, 1000);
    expect(openBtn()).not.toBeNull();

    resizeHeader(PANEL, FILE_ICONS_MIN_HEADER_WIDTH - 1);
    await waitFor(() => expect(findBtn()).toBeNull());
    expect(openBtn()).toBeNull();
    expect(fileSep()).toBeNull();
    expect(screen.queryByTestId(`panel-save-as-${PANEL}`)).not.toBeNull();

    resizeHeader(PANEL, 1000);
    await waitFor(() => expect(findBtn()).not.toBeNull());
    expect(openBtn()).not.toBeNull();
    expect(fileSep()).not.toBeNull();
  });

  it('keeps both actions on the panel menu however narrow it is', async () => {
    await editorWith('C:/proj/note.txt');
    resizeHeader(PANEL, 60);
    await waitFor(() => expect(findBtn()).toBeNull());
    fireEvent.contextMenu(screen.getByTestId(`panel-handle-${PANEL}`));
    expect(await screen.findByTestId(`menu-item-${FIND}`)).toBeTruthy();
    expect(screen.getByTestId(`menu-item-${OPEN}`)).toBeTruthy();
  });
});
