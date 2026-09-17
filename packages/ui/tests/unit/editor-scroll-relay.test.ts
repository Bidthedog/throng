/**
 * 044 T229 (2) — the editor's half of two-way scroll sync (FR-121, FR-121a–c, FR-121f, FR-121g;
 * data-model §15.1 R-E1–R-E4, plan.md Iteration 2026-09-16 decisions 5 and 6, research R30–R31).
 *
 * `editor-scroll-relay.ts` is framework-free on purpose: its contract is WHICH SPEC it dispatches and WHAT
 * it publishes, both observable over a fake view with a hand-driven animation frame. Nothing here lays
 * anything out. What a real CodeMirror does with the dispatched effect, and the real order of its measure
 * cycle against the `scroll` event, is the one E2E's (T237).
 *
 * The fake view's top line is a number the test sets; a "scroll" is the test changing it (and `scrollTop`)
 * and firing the listener the relay added, exactly as the engine would after a `scrollTop` write.
 */
import { EditorView } from '@codemirror/view';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetEditorScrollStore,
  editorDocLinesOf,
  editorTopLineOf,
  requestEditorTopLine,
  subscribeEditorTopLine,
} from '../../src/renderer/editor/editor-scroll-store.js';
import { attachEditorScrollRelay, type RelayView } from '../../src/renderer/editor/editor-scroll-relay.js';

/** A hand-driven `requestAnimationFrame`: `frame()` runs what was queued BEFORE it started. */
function fakeFrames() {
  let next = 1;
  let queue = new Map<number, () => void>();
  return {
    raf: vi.fn((cb: () => void): number => {
      const id = next++;
      queue.set(id, cb);
      return id;
    }),
    caf: vi.fn((id: number): void => {
      queue.delete(id);
    }),
    frame(): void {
      const due = queue;
      queue = new Map();
      for (const cb of due.values()) cb();
    },
    get pending(): number {
      return queue.size;
    },
  };
}

/**
 * A view of a `lines`-line document whose top visible line is `top` (0-based). A position IS a 0-based line
 * here — `line(n).from` is `n - 1` and `lineAt(pos).number` is `pos + 1` — so the dispatched effect's
 * position names the line directly.
 */
function fakeView(opts: { lines?: number; top?: number } = {}) {
  const listeners = new Set<() => void>();
  const dispatched: unknown[] = [];
  const model = { top: opts.top ?? 0, lines: opts.lines ?? 500 };
  const scrollDOM = {
    scrollTop: model.top * 20,
    getBoundingClientRect: () => ({ top: 0, left: 0 }),
    addEventListener: vi.fn((_type: 'scroll', l: () => void) => void listeners.add(l)),
    removeEventListener: vi.fn((_type: 'scroll', l: () => void) => void listeners.delete(l)),
  };
  const focus = vi.fn();
  const view: RelayView & { focus: () => void } = {
    scrollDOM,
    contentDOM: { getBoundingClientRect: () => ({ top: 0, left: 40 }) },
    posAtCoords: () => model.top,
    state: {
      doc: {
        get lines() {
          return model.lines;
        },
        lineAt: (pos: number) => ({ number: pos + 1 }),
        line: (n: number) => ({ from: n - 1 }),
      },
    },
    dispatch: vi.fn((spec: unknown) => void dispatched.push(spec)),
    focus,
  };
  return {
    view,
    model,
    dispatched,
    focus,
    listenerCount: () => listeners.size,
    /** Move the viewport's top to `line`, as a `scrollTop` write would, WITHOUT the event yet. */
    moveTo(line: number): void {
      model.top = line;
      scrollDOM.scrollTop = line * 20;
    },
    /** The engine's `scroll` event. */
    fireScroll(): void {
      for (const l of [...listeners]) l();
    },
    /** A scroll the reader made: the viewport moves and the event fires. */
    userScroll(line: number): void {
      this.moveTo(line);
      this.fireScroll();
    },
  };
}

const scrollTo = (line: number) => ({ effects: EditorView.scrollIntoView(line, { y: 'start', yMargin: 0 }) });

let frames: ReturnType<typeof fakeFrames>;

beforeEach(() => {
  __resetEditorScrollStore();
  frames = fakeFrames();
});

describe('R-E1 — every change of the top line is published, at most once a frame (FR-121f)', () => {
  it('publishes the view’s line as soon as it is attached, for a preview that mounted first', () => {
    const fake = fakeView({ top: 7 });
    attachEditorScrollRelay(fake.view, 'ed-1', frames);
    expect(editorTopLineOf('ed-1')).toEqual({ line: 7, fromSync: false });
  });

  it('two scroll events in one frame publish once, with the line at the frame', () => {
    const fake = fakeView();
    attachEditorScrollRelay(fake.view, 'ed-1', frames);
    const listener = vi.fn();
    subscribeEditorTopLine(listener);

    fake.userScroll(10);
    fake.userScroll(12);
    expect(listener).not.toHaveBeenCalled();
    frames.frame();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(editorTopLineOf('ed-1')).toEqual({ line: 12, fromSync: false });
  });

  it('an update that changed the document republishes with no scroll event (lines inserted above the viewport)', () => {
    const fake = fakeView({ top: 40 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);

    fake.model.top = 43; // the same text, three lines further down the file; scrollTop did not move
    relay.onUpdate({ docChanged: true, geometryChanged: false });
    frames.frame();

    expect(editorTopLineOf('ed-1')).toEqual({ line: 43, fromSync: false });
  });

  it('an update that changed the geometry republishes (a wrap or zoom reflow at the top)', () => {
    const fake = fakeView({ top: 0 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);

    fake.model.top = 2;
    relay.onUpdate({ docChanged: false, geometryChanged: true });
    frames.frame();

    expect(editorTopLineOf('ed-1')).toEqual({ line: 2, fromSync: false });
  });

  it('an update with neither schedules nothing and publishes nothing new', () => {
    const fake = fakeView({ top: 5 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);
    const listener = vi.fn();
    subscribeEditorTopLine(listener);

    fake.model.top = 9;
    relay.onUpdate({ docChanged: false, geometryChanged: false });
    frames.frame();

    expect(frames.raf).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(editorTopLineOf('ed-1')).toEqual({ line: 5, fromSync: false });
  });

  it('a scroll and an update in the same frame still publish once', () => {
    const fake = fakeView();
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);
    const listener = vi.fn();
    subscribeEditorTopLine(listener);

    fake.userScroll(3);
    relay.onUpdate({ docChanged: true, geometryChanged: true });
    frames.frame();

    expect(frames.raf).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  /*
   * Analyze U2 (hypothesis): "the editor publishes on docChanged before the preview re-renders, so a
   * same-block check may read stale lines". The editor's half of that claim is a timing fact this layer can
   * settle: a docChanged publish lands in the NEXT animation frame, and depends on nothing but the frame.
   * The preview's new content cannot arrive that fast — main settles a parented preview's content on
   * `updateDelayMs` (shipped 300 ms, R13) and sends it over IPC — so for at least that long the preview's
   * `data-source-line` values are the OLD document's while the editor's line is the NEW document's.
   * CONFIRMED at the ordering level; what the preview does with the stale window is T242's.
   */
  it('U2 — a docChanged publish lands within one frame, before any preview content could be re-rendered', () => {
    const fake = fakeView({ top: 40 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);

    fake.model.top = 43;
    relay.onUpdate({ docChanged: true, geometryChanged: false });
    expect(editorTopLineOf('ed-1')).toEqual({ line: 40, fromSync: false });
    frames.frame();

    expect(editorTopLineOf('ed-1')).toEqual({ line: 43, fromSync: false });
  });

  /*
   * U2, the preview's half (T242): the preview holds its side while the text it has drawn is behind the
   * editor's document. The editor's line count is what renumbers `data-source-line`, so the relay publishes it
   * beside the line — at attach, and in the same frame as a docChanged publish.
   */
  it('U2 — publishes the document’s line count at attach and with every publish, and forgets it on dispose', () => {
    const fake = fakeView({ top: 40, lines: 300 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);
    expect(editorDocLinesOf('ed-1')).toBe(300);

    fake.model.lines = 303;
    relay.onUpdate({ docChanged: true, geometryChanged: false });
    expect(editorDocLinesOf('ed-1')).toBe(300);
    frames.frame();
    expect(editorDocLinesOf('ed-1')).toBe(303);

    relay.dispose();
    expect(editorDocLinesOf('ed-1')).toBeNull();
  });
});

describe('R-E2 — a request scrolls the view and changes nothing else (FR-121b, FR-121g)', () => {
  it('dispatches exactly one spec whose only key is a scroll-into-view effect at the line’s start', () => {
    const fake = fakeView({ top: 0 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);
    relay.ready();

    expect(requestEditorTopLine('ed-1', 40)).toBe(true);

    expect(fake.dispatched).toHaveLength(1);
    const spec = fake.dispatched[0] as Record<string, unknown>;
    // No `selection` (the caret stays), no `changes` (not dirty, no undo step), nothing else.
    expect(Object.keys(spec)).toEqual(['effects']);
    expect(spec).toEqual(scrollTo(40));
    expect(fake.focus).not.toHaveBeenCalled();
  });

  it('puts the line AT the top edge — no scroll margin, so the line above is not left showing (FR-121b; 044 T246)', () => {
    /*
     * CodeMirror's `scrollIntoView` keeps a 5px `yMargin` unless told otherwise. With it, the requested line
     * lands 5px below the edge, the line above fills that strip, and this relay's own `posAtCoords` read at
     * the top then names the line ABOVE — measured in `preview-scroll.e2e.ts` (T237): a preview wheeled to a
     * heading on line 66 left the editor reporting 65, with the heading's row 4.2px down.
     */
    const fake = fakeView({ top: 0 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);
    relay.ready();

    requestEditorTopLine('ed-1', 40);

    const spec = fake.dispatched[0] as { effects: { value: { yMargin: number; y: string } } };
    expect(spec.effects.value.y).toBe('start');
    expect(spec.effects.value.yMargin).toBe(0);
  });

  it('clamps a line past the end of the document to the last line', () => {
    const fake = fakeView({ top: 0, lines: 100 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);
    relay.ready();

    requestEditorTopLine('ed-1', 500);

    expect(fake.dispatched).toEqual([scrollTo(99)]);
  });

  it('clamps a negative line to the first', () => {
    const fake = fakeView({ top: 30 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);
    relay.ready();

    requestEditorTopLine('ed-1', -4);

    expect(fake.dispatched).toEqual([scrollTo(0)]);
  });

  it('dispatches nothing for the line already at the top (FR-121g)', () => {
    const fake = fakeView({ top: 40 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);
    relay.ready();

    expect(requestEditorTopLine('ed-1', 40)).toBe(true);

    expect(fake.dispatched).toEqual([]);
    // …and arms nothing: the reader's next scroll is theirs.
    fake.userScroll(44);
    frames.frame();
    expect(editorTopLineOf('ed-1')).toEqual({ line: 44, fromSync: false });
  });
});

describe('R-E3 — what a request causes is marked, and the mark always lapses (FR-121c, FR-121g)', () => {
  it('the publish the request caused carries fromSync, and the reader’s next scroll does not', () => {
    const fake = fakeView({ top: 0 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);
    relay.ready();

    requestEditorTopLine('ed-1', 40);
    fake.userScroll(40); // the engine applying the effect
    frames.frame();
    expect(editorTopLineOf('ed-1')).toEqual({ line: 40, fromSync: true });

    fake.userScroll(46);
    frames.frame();
    expect(editorTopLineOf('ed-1')).toEqual({ line: 46, fromSync: false });
  });

  it('a request that produced no scroll at all lapses after one frame, so the following scroll is the reader’s', () => {
    // Already at the bottom: the engine clamps, `scrollTop` cannot move, no `scroll` event ever fires.
    const fake = fakeView({ top: 480, lines: 500 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);
    relay.ready();

    requestEditorTopLine('ed-1', 499);
    expect(fake.dispatched).toHaveLength(1);
    frames.frame(); // nothing moved

    fake.userScroll(470);
    frames.frame();
    expect(editorTopLineOf('ed-1')).toEqual({ line: 470, fromSync: false });
  });

  it('R-E5 — a request that moved nothing is answered with the view’s unchanged line, as an echo (review round 2, I2)', () => {
    const fake = fakeView({ top: 0, lines: 20 }); // the whole document fits: the engine cannot scroll
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);
    relay.ready();
    expect(editorTopLineOf('ed-1')).toEqual({ line: 0, fromSync: false });

    requestEditorTopLine('ed-1', 40);
    expect(fake.dispatched).toEqual([scrollTo(19)]);
    frames.frame(); // nothing moved

    expect(editorTopLineOf('ed-1')).toEqual({ line: 0, fromSync: true });
    fake.userScroll(3);
    frames.frame();
    expect(editorTopLineOf('ed-1')).toEqual({ line: 3, fromSync: false });
  });

  it('R-E5 — a request clamped onto the line already at the top dispatches nothing, and is answered', () => {
    const fake = fakeView({ top: 99, lines: 100 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);
    relay.ready();

    requestEditorTopLine('ed-1', 140);

    expect(fake.dispatched).toEqual([]);
    expect(editorTopLineOf('ed-1')).toEqual({ line: 99, fromSync: true });
    expect(frames.pending).toBe(0);
  });

  it('a request whose viewport moved without its event never publishes an unmoved answer', () => {
    const fake = fakeView({ top: 0 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);
    relay.ready();

    requestEditorTopLine('ed-1', 40);
    fake.moveTo(40);
    frames.frame();
    frames.frame(); // the second chance lapses with no event

    expect(editorTopLineOf('ed-1')).toEqual({ line: 0, fromSync: false });
  });

  it('a scroll that arrives a frame after the dispatch moved the viewport is still the request’s (the engine’s real order)', () => {
    /*
     * CodeMirror writes `scrollTop` in its measure pass — an animation frame requested by the dispatch —
     * and the browser fires `scroll` at the NEXT frame's rendering step. So the lapse frame can see a
     * viewport that has moved while its event is still due; lapsing there would hand the echo to the
     * preview as a reader's scroll.
     */
    const fake = fakeView({ top: 0 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);
    relay.ready();

    requestEditorTopLine('ed-1', 40);
    fake.moveTo(40); // the measure pass wrote scrollTop…
    frames.frame(); // …the lapse frame runs…
    fake.fireScroll(); // …and the event arrives after it.
    frames.frame();

    expect(editorTopLineOf('ed-1')).toEqual({ line: 40, fromSync: true });
    fake.userScroll(41);
    frames.frame();
    expect(editorTopLineOf('ed-1')).toEqual({ line: 41, fromSync: false });
  });

  it('an update republished while a request is settling is marked too', () => {
    const fake = fakeView({ top: 0 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);
    relay.ready();

    requestEditorTopLine('ed-1', 40);
    fake.moveTo(40);
    relay.onUpdate({ docChanged: false, geometryChanged: true });
    frames.frame();

    expect(editorTopLineOf('ed-1')).toEqual({ line: 40, fromSync: true });
  });

  it('a second request while the first is settling keeps the mark until its own scroll', () => {
    const fake = fakeView({ top: 0 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);
    relay.ready();

    requestEditorTopLine('ed-1', 40);
    fake.userScroll(40); // the first request's scroll, not yet published…
    requestEditorTopLine('ed-1', 60); // …when the second arrives
    fake.moveTo(60); // its measure pass
    frames.frame();
    expect(editorTopLineOf('ed-1')).toEqual({ line: 60, fromSync: true });

    fake.fireScroll(); // the second request's own event
    frames.frame();
    expect(editorTopLineOf('ed-1')).toEqual({ line: 60, fromSync: true });

    fake.userScroll(61);
    frames.frame();
    expect(editorTopLineOf('ed-1')).toEqual({ line: 61, fromSync: false });
  });
});

describe('R-E4 — held until the view has placed itself; gone when it unmounts (FR-121a, FR-121h)', () => {
  it('a request before ready() is held, the latest wins, and ready() applies it once', () => {
    const fake = fakeView({ top: 0 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);

    // The view exists in this window, so the preview's request is accepted — and waits.
    expect(requestEditorTopLine('ed-1', 30)).toBe(true);
    expect(requestEditorTopLine('ed-1', 40)).toBe(true);
    expect(fake.dispatched).toEqual([]);

    // The view's own placement (#144 view state, US8) scrolls first; it is the view's, not the request's.
    fake.userScroll(12);
    relay.ready();

    expect(fake.dispatched).toEqual([scrollTo(40)]);
    relay.ready();
    expect(fake.dispatched).toHaveLength(1);
  });

  it('a held request for the line the placement already shows dispatches nothing', () => {
    const fake = fakeView({ top: 0 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);

    requestEditorTopLine('ed-1', 12);
    fake.moveTo(12);
    relay.ready();

    expect(fake.dispatched).toEqual([]);
  });

  it('a request after ready() is applied at once', () => {
    const fake = fakeView({ top: 0 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);
    relay.ready();

    requestEditorTopLine('ed-1', 9);

    expect(fake.dispatched).toEqual([scrollTo(9)]);
  });

  it('dispose() removes the listener, cancels a pending frame, forgets the line and unregisters', () => {
    const fake = fakeView({ top: 3 });
    const relay = attachEditorScrollRelay(fake.view, 'ed-1', frames);
    relay.ready();
    fake.userScroll(8);
    expect(frames.pending).toBe(1);

    relay.dispose();

    expect(fake.listenerCount()).toBe(0);
    expect(frames.caf).toHaveBeenCalled();
    frames.frame();
    expect(editorTopLineOf('ed-1')).toBeNull();
    expect(requestEditorTopLine('ed-1', 40)).toBe(false);
    expect(fake.dispatched).toEqual([]);
  });

  it('dispose() leaves another editor’s line and scroller alone', () => {
    const one = fakeView({ top: 3 });
    const two = fakeView({ top: 5 });
    const first = attachEditorScrollRelay(one.view, 'ed-1', frames);
    const second = attachEditorScrollRelay(two.view, 'ed-2', frames);
    second.ready();

    first.dispose();

    expect(editorTopLineOf('ed-2')).toEqual({ line: 5, fromSync: false });
    expect(requestEditorTopLine('ed-2', 20)).toBe(true);
    expect(two.dispatched).toEqual([scrollTo(20)]);
  });
});
