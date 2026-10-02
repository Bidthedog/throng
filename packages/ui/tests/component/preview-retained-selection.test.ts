/**
 * 049 T047 — a preview keeps the selection it had when focus left it (US5, #457; FR-021 – FR-026, research R11).
 *
 * The controller directly over a real DOM subtree with a fake `CSS.highlights` and an injected frame queue, as
 * `preview-occurrences.test.ts` does; what is asserted is what the registry would paint, what the DOM selection is
 * after focus returns, and what the hand-off section reports.
 */
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearPreviewSelection,
  createPreviewSelection,
  peekPreviewSelection,
  PREVIEW_SELECTION_INACTIVE_HIGHLIGHT,
  seedPreviewSelection,
  type PreviewSelection,
} from '../../src/renderer/preview/preview-selection.js';
import {
  createPreviewOccurrences,
  PREVIEW_OCCURRENCE_INACTIVE_HIGHLIGHT,
  type PreviewOccurrences,
} from '../../src/renderer/preview/preview-occurrences.js';
import { createModelCache } from '../../src/renderer/preview/preview-selection-model.js';
import { clearPanel } from '../../src/renderer/preview/highlight-registry.js';
import { seedPanelState, snapshotPanel } from '../../src/renderer/workspace/panel-state-capture.js';
import { __resetFindState } from '../../src/renderer/search/search-store.js';
import { COLD, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

class FakeHighlight {
  readonly ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

let registry: Map<string, FakeHighlight>;
let frames: (() => void)[];
const requestFrame = (cb: () => void): number => frames.push(cb);
const cancelFrame = (): void => undefined;
const flush = (): void => {
  const run = frames;
  frames = [];
  run.forEach((cb) => cb());
};

beforeEach(() => {
  registry = new Map();
  frames = [];
  Reflect.set(globalThis, 'CSS', { highlights: registry });
  Reflect.set(globalThis, 'Highlight', FakeHighlight);
});

const created: { dispose(): void }[] = [];
afterEach(() => {
  created.splice(0).forEach((c) => c.dispose());
  clearPanel('a');
  clearPreviewSelection('a');
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  Reflect.deleteProperty(globalThis, 'CSS');
  Reflect.deleteProperty(globalThis, 'Highlight');
});

const BODY = '<p>alpha beta alpha</p>\n<p>second block here</p>';

function hostWith(html: string): HTMLDivElement {
  const host = document.createElement('div');
  host.tabIndex = 0;
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

function controllerOver(host: HTMLElement, panelId = 'a'): PreviewSelection {
  const s = createPreviewSelection({ host: () => host, panelId, requestFrame, cancelFrame });
  created.push(s);
  return s;
}

function selectText(node: Node, from: number, to: number): void {
  const r = new Range();
  r.setStart(node, from);
  r.setEnd(node, to);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(r);
  document.dispatchEvent(new Event('selectionchange'));
}

const outside = (): HTMLInputElement => {
  const input = document.createElement('input');
  document.body.appendChild(input);
  return input;
};
const paintedText = (): string[] =>
  (registry.get(PREVIEW_SELECTION_INACTIVE_HIGHLIGHT)?.ranges ?? []).map((r) => r.toString());

/** Select "alpha" in the first paragraph of a focused body, and move focus away. */
function selectAndLeave(host: HTMLElement): HTMLInputElement {
  host.focus();
  selectText(host.querySelector('p')!.firstChild!, 0, 5);
  flush();
  const away = outside();
  away.focus();
  flush();
  return away;
}

describe('a selection made in a focused preview body', () => {
  it('is retained as { from, to, text } in text-model offsets', () => {
    const host = hostWith(BODY);
    const s = controllerOver(host);
    host.focus();
    selectText(host.querySelector('p')!.firstChild!, 6, 10);
    flush();
    expect(s.retained()).toEqual({ from: 6, to: 10, text: 'beta' });
    expect(registry.get(PREVIEW_SELECTION_INACTIVE_HIGHLIGHT)).toBeUndefined(); // focused: the native selection is the paint
  });

  it('may span blocks', () => {
    const host = hostWith(BODY);
    const s = controllerOver(host);
    host.focus();
    const r = new Range();
    r.setStart(host.querySelector('p')!.firstChild!, 6);
    r.setEnd(host.querySelectorAll('p')[1]!.firstChild!, 6);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
    flush();
    expect(s.retained()?.text).toBe('beta alpha\nsecond');
  });
});

describe('focus leaving the body (FR-021)', () => {
  it('paints the retained selection under throng-preview-selection-inactive', () => {
    const host = hostWith(BODY);
    const s = controllerOver(host);
    selectAndLeave(host);
    expect(s.retained()).toEqual({ from: 0, to: 5, text: 'alpha' });
    expect(paintedText()).toEqual(['alpha']);
  });

  it('keeps it painted through a selection made in ANOTHER panel (US5.6)', () => {
    const host = hostWith(BODY);
    const s = controllerOver(host);
    selectAndLeave(host);
    const other = hostWith('<p>another panel entirely</p>');
    other.focus();
    selectText(other.querySelector('p')!.firstChild!, 0, 7);
    flush();
    expect(s.retained()?.text).toBe('alpha');
    expect(paintedText()).toEqual(['alpha']);
  });

  it('captures a selection whose frame had not run when focus left', () => {
    const host = hostWith(BODY);
    const s = controllerOver(host);
    host.focus();
    selectText(host.querySelector('p')!.firstChild!, 0, 5);
    outside().focus(); // no flush in between: the click that follows a drag
    flush();
    expect(s.retained()?.text).toBe('alpha');
    expect(paintedText()).toEqual(['alpha']);
  });
});

describe('focus returning (FR-023, US5.3)', () => {
  it('without a pointer-down inside, re-creates the DOM selection with the same text and clears the paint', () => {
    const host = hostWith(BODY);
    const s = controllerOver(host);
    selectAndLeave(host);
    window.getSelection()!.removeAllRanges(); // what clicking into another panel did to the document's one selection

    host.focus();
    flush();

    expect(window.getSelection()!.toString()).toBe('alpha'); // Copy's source
    expect(paintedText()).toEqual([]);
    expect(s.retained()?.text).toBe('alpha');
  });

  it('after a pointer-down inside the body, discards it and restores nothing (US5.4)', () => {
    const host = hostWith(BODY);
    const s = controllerOver(host);
    selectAndLeave(host);
    window.getSelection()!.removeAllRanges();

    host.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    host.focus();
    flush();

    expect(s.retained()).toBeNull();
    expect(paintedText()).toEqual([]);
    expect(window.getSelection()!.toString()).toBe('');
  });

  it('is replaced by a new selection, and dropped by a collapsed caret (FR-022)', () => {
    const host = hostWith(BODY);
    const s = controllerOver(host);
    host.focus();
    selectText(host.querySelector('p')!.firstChild!, 0, 5);
    flush();
    selectText(host.querySelector('p')!.firstChild!, 11, 16);
    flush();
    expect(s.retained()).toEqual({ from: 11, to: 16, text: 'alpha' });
    window.getSelection()!.collapse(host.querySelector('p')!.firstChild!, 3); // the caret moves: the selection is gone
    document.dispatchEvent(new Event('selectionchange'));
    flush();
    expect(s.retained()).toBeNull();
  });
});

describe('an unmount and a remount (US5.7, FR-026)', () => {
  it('over the same text shows the same selection, inactive', () => {
    const first = hostWith(BODY);
    const s1 = controllerOver(first);
    selectAndLeave(first);
    s1.dispose(); // the view goes away
    first.remove();
    window.getSelection()!.removeAllRanges();
    expect(paintedText()).toEqual([]); // nothing left painted by the dead view

    const second = hostWith(BODY);
    const s2 = controllerOver(second);
    s2.invalidate(); // the first draw
    flush();

    expect(s2.retained()).toEqual({ from: 0, to: 5, text: 'alpha' });
    expect(paintedText()).toEqual(['alpha']);
  });

  it('over changed text drops it, and never paints it over other text', () => {
    const first = hostWith(BODY);
    const s1 = controllerOver(first);
    selectAndLeave(first);
    s1.dispose();
    first.remove();

    const second = hostWith('<p>omega beta alpha</p>\n<p>second block here</p>');
    const s2 = controllerOver(second);
    s2.invalidate();
    flush();

    expect(s2.retained()).toBeNull();
    expect(paintedText()).toEqual([]);
  });

  it('is dropped when a redraw changes the text under it', () => {
    const host = hostWith(BODY);
    const s = controllerOver(host);
    selectAndLeave(host);
    host.innerHTML = '<p>omega beta alpha</p>\n<p>second block here</p>';
    s.invalidate();
    flush();
    expect(s.retained()).toBeNull();
    expect(paintedText()).toEqual([]);
  });

  it('is repainted over the new DOM when a redraw leaves the text as it was', () => {
    const host = hostWith(BODY);
    const s = controllerOver(host);
    selectAndLeave(host);
    host.innerHTML = BODY; // a redraw replaces every node
    s.invalidate();
    flush();
    expect(paintedText()).toEqual(['alpha']);
    expect(registry.get(PREVIEW_SELECTION_INACTIVE_HIGHLIGHT)!.ranges[0]!.startContainer.isConnected).toBe(true);
  });
});

describe('its occurrences (FR-018a)', () => {
  it('follow it at inactive strength while the body is unfocused', () => {
    const host = hostWith(BODY);
    const models = createModelCache(() => host);
    const s = createPreviewSelection({ host: () => host, panelId: 'a', requestFrame, cancelFrame, modelCache: models });
    const o: PreviewOccurrences = createPreviewOccurrences({
      host: () => host,
      panelId: 'a',
      enabled: () => true,
      searchMatches: () => [],
      isFocused: () => host.contains(document.activeElement),
      retained: () => s.retained(),
      modelCache: models,
      requestFrame,
      cancelFrame,
      requestIdle: () => 0,
      cancelIdle: () => undefined,
    });
    created.push(s, o);

    selectAndLeave(host);
    o.schedule();
    flush();

    expect((registry.get(PREVIEW_OCCURRENCE_INACTIVE_HIGHLIGHT)?.ranges ?? []).map((r) => r.toString())).toEqual(['alpha']);
  });
});

describe('the previewSelection hand-off section', () => {
  it('captures a mounted body\'s retained selection, then the saved one after unmount', () => {
    const host = hostWith(BODY);
    const s = controllerOver(host);
    selectAndLeave(host);
    expect(snapshotPanel('a').previewSelection).toEqual({ from: 0, to: 5, text: 'alpha' });

    s.dispose();
    expect(snapshotPanel('a').previewSelection).toEqual({ from: 0, to: 5, text: 'alpha' });
  });

  it('seeds the received selection, which the next mounted body takes and validates against its text', () => {
    seedPanelState({ a: { panelId: 'a', previewSelection: { from: 6, to: 10, text: 'beta' } } });
    expect(peekPreviewSelection('a')).toEqual({ from: 6, to: 10, text: 'beta' });

    const host = hostWith(BODY);
    const s = controllerOver(host);
    s.invalidate();
    flush();

    expect(s.retained()).toEqual({ from: 6, to: 10, text: 'beta' });
    expect(paintedText()).toEqual(['beta']);
  });

  it('does not overwrite a selection this window already holds for the panel', () => {
    seedPreviewSelection('a', { from: 0, to: 5, text: 'alpha' });
    seedPreviewSelection('a', { from: 6, to: 10, text: 'beta' });
    expect(peekPreviewSelection('a')?.text).toBe('alpha');
  });
});

describe('on a mounted preview panel', () => {
  let m: MountedPreviewWindow | undefined;
  afterEach(() => {
    m?.unmount();
    m = undefined;
    __resetFindState();
  });

  it('keeps a selection painted inactive when focus leaves the body, through the real wiring', async () => {
    m = await mountMarkdownPreview('# Title\n\nalpha beta alpha gamma\n');
    const body = await screen.findByTestId(`preview-body-${m.id}`, {}, COLD);
    const text = await waitFor(() => {
      const node = Array.from(body.querySelectorAll('p')).find((p) => p.textContent?.includes('alpha beta'))?.firstChild;
      if (!node) throw new Error('not drawn yet');
      return node;
    });
    const host = body.closest('[tabindex]') as HTMLElement;
    act(() => {
      host.focus();
      selectText(text, 6, 10);
    });
    act(() => outside().focus());

    await waitFor(() => expect(paintedText()).toEqual(['beta']));
    expect(snapshotPanel(m.id).previewSelection?.text).toBe('beta');
  });
});
