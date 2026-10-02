/**
 * 049 T039 — other instances of the selected text, tinted in a PREVIEW (#324; FR-013 – FR-020, research R8/R9).
 *
 * The occurrences controller directly over a real DOM subtree with a fake `CSS.highlights` (jsdom has neither the
 * API nor its types) and an injected frame queue, plus one mounted panel for the setting and the wiring. What is
 * asserted is what the registry would paint — which ranges, under which name, and when.
 */
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPreviewOccurrences,
  PREVIEW_OCCURRENCE_HIGHLIGHT,
  PREVIEW_OCCURRENCE_INACTIVE_HIGHLIGHT,
  type PreviewOccurrences,
} from '../../src/renderer/preview/preview-occurrences.js';
import { clearPanel } from '../../src/renderer/preview/highlight-registry.js';
import { COLD, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';
import { __resetFindState } from '../../src/renderer/search/search-store.js';

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

const created: PreviewOccurrences[] = [];
afterEach(() => {
  created.splice(0).forEach((o) => o.dispose());
  clearPanel('a');
  clearPanel('b');
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  Reflect.deleteProperty(globalThis, 'CSS');
  Reflect.deleteProperty(globalThis, 'Highlight');
});

// Blocks are separated by a newline text node, as the Markdown renderer emits them — which is also what makes
// a selection that crosses blocks read as spanning lines.
const BODY =
  '<p>alpha beta alpha</p>\n' + //
  '<p>x <strong>i</strong>d and id; width valid id_x</p>\n' +
  '<p aria-hidden="true">alpha</p>';

function hostWith(html: string): HTMLDivElement {
  const host = document.createElement('div');
  host.tabIndex = 0;
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

interface Opts {
  panelId?: string;
  enabled?: () => boolean;
  searchMatches?: () => { from: number; to: number }[];
  focused?: () => boolean;
}
function occurrencesOver(host: HTMLElement, opts: Opts = {}): PreviewOccurrences {
  const o = createPreviewOccurrences({
    host: () => host,
    panelId: opts.panelId ?? 'a',
    enabled: opts.enabled ?? (() => true),
    searchMatches: opts.searchMatches ?? (() => []),
    isFocused: opts.focused ?? (() => true),
    requestFrame,
    cancelFrame,
  });
  created.push(o);
  return o;
}

/** Select `[from, to)` of `node`'s own text and tell the document, as the browser does. */
function selectText(node: Node, from: number, to: number): void {
  const range = document.createRange();
  range.setStart(node, from);
  range.setEnd(node, to);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}

const painted = (name: string): string[] =>
  (registry.get(name)?.ranges ?? []).map((r) => `${r.startContainer.parentElement?.tagName}:${r.startOffset}:${r.toString()}`);

describe('which ranges are painted (FR-014, FR-014a, FR-015)', () => {
  it('paints the other occurrences of a selected word one frame after the selection, and not the selection', () => {
    const host = hostWith(BODY);
    occurrencesOver(host);
    const p = host.querySelector('p')!.firstChild!; // "alpha beta alpha"
    selectText(p, 0, 5);
    expect(registry.size).toBe(0); // the handler only schedules
    flush();
    expect(painted(PREVIEW_OCCURRENCE_HIGHLIGHT)).toEqual(['P:11:alpha']);
  });

  it('does not match inside aria-hidden content (what preview find excludes)', () => {
    const host = hostWith(BODY);
    occurrencesOver(host);
    selectText(host.querySelector('p')!.firstChild!, 0, 5);
    flush();
    const ranges = registry.get(PREVIEW_OCCURRENCE_HIGHLIGHT)!.ranges;
    expect(ranges.every((r) => !host.querySelector('[aria-hidden="true"]')!.contains(r.startContainer))).toBe(true);
  });

  it('reads text continuously across formatting: a bold "i" then a plain "d" is the word "id" (FR-014a)', () => {
    const host = hostWith(BODY);
    occurrencesOver(host);
    const bold = host.querySelector('strong')!.firstChild!;
    const plain = bold.parentElement!.nextSibling!; // "d and id; width valid id_x"
    const range = document.createRange();
    range.setStart(bold, 0);
    range.setEnd(plain, 1);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    flush();
    // Whole word `id`: the standalone "id;" counts; width, valid and id_x do not.
    expect(painted(PREVIEW_OCCURRENCE_HIGHLIGHT)).toEqual(['P:6:id']);
  });

  it('tints nothing for a selection of one character', () => {
    const host = hostWith(BODY);
    occurrencesOver(host);
    selectText(host.querySelector('p')!.firstChild!, 0, 1);
    flush();
    expect(registry.size).toBe(0);
  });

  it('paints no occurrence on a range that is a search match (FR-013)', () => {
    const host = hostWith(BODY);
    // The other "alpha" is a find match: model offsets 11–16.
    occurrencesOver(host, { searchMatches: () => [{ from: 11, to: 16 }] });
    selectText(host.querySelector('p')!.firstChild!, 0, 5);
    flush();
    expect(registry.size).toBe(0);
  });
});

describe('inactive strength while the body has no focus (FR-018a)', () => {
  it('paints under the inactive name when unfocused, and returns to full strength on focus', () => {
    const host = hostWith(BODY);
    let focused = false;
    occurrencesOver(host, { focused: () => focused });
    selectText(host.querySelector('p')!.firstChild!, 0, 5);
    flush();
    expect(painted(PREVIEW_OCCURRENCE_INACTIVE_HIGHLIGHT)).toHaveLength(1);
    expect(registry.has(PREVIEW_OCCURRENCE_HIGHLIGHT)).toBe(false);

    focused = true;
    host.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    flush();
    expect(painted(PREVIEW_OCCURRENCE_HIGHLIGHT)).toHaveLength(1);
    expect(registry.has(PREVIEW_OCCURRENCE_INACTIVE_HIGHLIGHT)).toBe(false);
  });
});

describe('a panel paints its own selection only (FR-014b)', () => {
  it('a second preview of the same file paints nothing for a selection made in the first', () => {
    const a = hostWith(BODY);
    const b = hostWith(BODY);
    occurrencesOver(a, { panelId: 'a' });
    occurrencesOver(b, { panelId: 'b' });
    selectText(a.querySelector('p')!.firstChild!, 0, 5);
    flush();
    expect(registry.get(PREVIEW_OCCURRENCE_HIGHLIGHT)!.ranges).toHaveLength(1);
    expect(registry.get(PREVIEW_OCCURRENCE_HIGHLIGHT)!.ranges[0]!.startContainer.parentElement!.closest('div')).toBe(a);
  });
});

describe('following the selection (FR-018)', () => {
  it('replaces the ranges when the selection changes and removes them when it clears, in the next frame', () => {
    const host = hostWith(BODY);
    occurrencesOver(host);
    const p = host.querySelector('p')!.firstChild!;
    selectText(p, 0, 5);
    flush();
    expect(painted(PREVIEW_OCCURRENCE_HIGHLIGHT)).toHaveLength(1);

    selectText(p, 6, 10); // "beta", once
    flush();
    expect(registry.size).toBe(0);

    selectText(p, 0, 5);
    flush();
    expect(registry.size).toBe(1);
    window.getSelection()!.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    flush();
    expect(registry.size).toBe(0);
  });

  it('a redraw invalidates the cached text model: new content is matched on the next frame', () => {
    const host = hostWith('<p>alpha beta</p>');
    const o = occurrencesOver(host);
    selectText(host.querySelector('p')!.firstChild!, 0, 5);
    flush();
    expect(registry.size).toBe(0);

    host.innerHTML = '<p>alpha beta alpha</p>';
    selectText(host.querySelector('p')!.firstChild!, 0, 5);
    o.invalidate();
    flush();
    expect(registry.size).toBe(1);
  });
});

describe('the setting (FR-019)', () => {
  it('paints nothing while off and paints when switched on, without a remount', () => {
    const host = hostWith(BODY);
    let on = false;
    const o = occurrencesOver(host, { enabled: () => on });
    selectText(host.querySelector('p')!.firstChild!, 0, 5);
    flush();
    expect(registry.size).toBe(0);

    on = true;
    o.schedule();
    flush();
    expect(registry.size).toBe(1);

    on = false;
    o.schedule();
    flush();
    expect(registry.size).toBe(0);
  });
});

/**
 * Principle XII / SC-005: the frame's work — offset mapping, matching, range building, painting — on a rendered
 * 10,000-line document with a word of ≥ 2,000 occurrences, and the `selectionchange` handler itself only schedules.
 */
describe('cost on a 10,000-line rendered document (Principle XII, SC-005)', () => {
  it('the frame completes well inside 100 ms, and the handler only schedules', () => {
    const html = Array.from({ length: 10_000 }, (_, i) => (i % 4 === 0 ? `<p>needle ${i} and needle again</p>` : `<p>plain line ${i}</p>`)).join('\n');
    const host = hostWith(html);
    const requested = vi.fn(requestFrame);
    const o = createPreviewOccurrences({
      host: () => host,
      panelId: 'a',
      enabled: () => true,
      searchMatches: () => [],
      isFocused: () => true,
      requestFrame: requested,
      cancelFrame,
      requestIdle: (cb) => idleQueue.push(cb),
      cancelIdle: () => undefined,
    });
    created.push(o);
    const idleQueue: (() => void)[] = [];
    const runIdle = (): void => idleQueue.splice(0).forEach((cb) => cb());

    // Real Ranges for the user's selections, made before `document.createRange` is stubbed for the frame below.
    const first = host.querySelector('p')!.firstChild!;
    const second = host.querySelectorAll('p')[4]!.firstChild!; // another "needle…" paragraph
    const third = host.querySelectorAll('p')[8]!.firstChild!;
    const select = (node: Node): void => {
      const r = new Range();
      r.setStart(node, 0);
      r.setEnd(node, 6);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(r);
    };
    select(first);
    const t0 = performance.now();
    document.dispatchEvent(new Event('selectionchange'));
    const handler = performance.now() - t0;
    expect(handler).toBeLessThan(10);
    expect(requested).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);

    /*
     * jsdom's Range boundary operations walk the document: measured here at ~4 ms per `setStart` on this
     * 10,000-paragraph tree, where a browser takes microseconds. Building 2,500 real jsdom Ranges would time
     * jsdom, not this code, so the construction is stubbed for the frame and the COUNT of ranges built is
     * asserted instead. Everything else — offset mapping, matching, filtering, `locate`, painting — is real.
     */
    const made: unknown[] = [];
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      const fake = { startContainer: null as unknown, setStart(n: unknown) { this.startContainer = n; }, setEnd() {} };
      made.push(fake);
      return fake as unknown as Range;
    });
    // COLD: a selection lands before the idle build ever ran (the model is then built in the frame — correctness
    // first), so the frame also pays for the walk, the offset map and the source text.
    const t1 = performance.now();
    flush();
    const cold = performance.now() - t1;
    const painted = registry.get(PREVIEW_OCCURRENCE_HIGHLIGHT)!.ranges.length;

    // The body redraws (what `onDrawn` reports); the model is built when the browser is idle, not on the next selection.
    window.getSelection()!.removeAllRanges();
    o.invalidate();
    flush(); // the redraw's re-evaluation: nothing is selected-and-new yet, so it must not build the model
    const t2 = performance.now();
    runIdle();
    const idleBuild = performance.now() - t2;

    // AFTER IDLE: the first selection over a draw whose model is ready — SC-005's case.
    select(second);
    document.dispatchEvent(new Event('selectionchange'));
    const t3 = performance.now();
    flush();
    const afterIdle = performance.now() - t3;

    // WARM: the next selection change over the same draw — what the user does while dragging.
    select(third);
    document.dispatchEvent(new Event('selectionchange'));
    const t4 = performance.now();
    flush();
    const warm = performance.now() - t4;
    vi.restoreAllMocks();

    const summary =
      `[049 T039/T051 timings, 10,000 lines, ${painted} occurrences] selectionchange handler ${handler.toFixed(2)} ms; ` +
      `idle model build ${idleBuild.toFixed(1)} ms; frame: ${cold.toFixed(1)} ms cold (selection beat the idle build), ` +
      `${afterIdle.toFixed(1)} ms after idle, ${warm.toFixed(1)} ms warm`;
    // Shown for the PR body with `--silent=false`, which prints a passing test's console output.
    console.info(summary);
    expect(painted).toBeGreaterThanOrEqual(2000);
    expect(made.length).toBeGreaterThanOrEqual(painted);
    expect(afterIdle).toBeLessThan(100);
    expect(warm).toBeLessThan(50);
    // The correctness-first fallback pays for the model build inside the frame, so it is bounded RELATIVE to that
    // build measured in this same run: a fixed millisecond figure measured the machine's load instead (255 ms
    // against a 250 ms cap under the full parallel component run, 134 ms alone). It also runs first, with the JIT
    // cold, hence the factor. What it catches is a cold path that does more than build once and paint once.
    expect(cold).toBeLessThan(2 * (idleBuild + afterIdle) + 25);
  });
});

describe('on a mounted preview panel', () => {
  let m: MountedPreviewWindow | undefined;
  afterEach(() => {
    m?.unmount();
    m = undefined;
    __resetFindState();
  });

  it('tints the other occurrences of a selection in the body, and honours editor.highlightOccurrences live', async () => {
    m = await mountMarkdownPreview('# Title\n\nalpha beta alpha gamma alpha\n');
    const body = await screen.findByTestId(`preview-body-${m.id}`, {}, COLD);
    const text = await waitFor(() => {
      const node = Array.from(body.querySelectorAll('p')).find((p) => p.textContent?.includes('alpha beta'))?.firstChild;
      if (!node) throw new Error('not drawn yet');
      return node;
    });

    act(() => selectText(text, 0, 5));
    await waitFor(() => expect(registry.get(PREVIEW_OCCURRENCE_HIGHLIGHT) ?? registry.get(PREVIEW_OCCURRENCE_INACTIVE_HIGHLIGHT)).toBeTruthy());
    const held = (): number =>
      (registry.get(PREVIEW_OCCURRENCE_HIGHLIGHT)?.ranges.length ?? 0) + (registry.get(PREVIEW_OCCURRENCE_INACTIVE_HIGHLIGHT)?.ranges.length ?? 0);
    expect(held()).toBe(2);

    act(() => m!.setSettings({ editor: { highlightOccurrences: false } }));
    await waitFor(() => expect(held()).toBe(0));

    act(() => m!.setSettings({ editor: { highlightOccurrences: true } }));
    await waitFor(() => expect(held()).toBe(2));
  });
});
