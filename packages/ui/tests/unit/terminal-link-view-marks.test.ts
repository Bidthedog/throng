import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_LINK_CANDIDATES_PER_LINE,
  scanLinkLine,
  type LinkResolutionRequest,
} from '@throng/core';
import { createFileLinkProvider, type ProvidedLink } from '../../src/renderer/terminal/file-link-provider.js';
import { createLinkViewMarks } from '../../src/renderer/terminal/link-view-marks.js';
import { logicalLinesBetween } from '../../src/renderer/terminal/logical-line.js';
import {
  createLinkMarks,
  LINK_MARK_CLASS,
  LINK_MARK_HOVER_CLASS,
  LINK_MARK_POINTER_CLASS,
  LINK_POINTER_HOST_CLASS,
  type MarkedLink,
} from '../../src/renderer/terminal/link-marks.js';

/**
 * 045 T233 — D5's REPRODUCTION (spec D5, FR-135 – FR-139, FR-172; the replicating-bugs gate).
 *
 * What the maintainer sees (M11): in Claude Code's full-screen UI a link carries no mark at rest and
 * none on hover, though a Ctrl+hover shows the hand and a Ctrl+click follows — so nothing on screen
 * says what is clickable.
 *
 * What makes Claude Code different from a shell prompt is the OUTPUT: its spinner and status line
 * repaint in place on the alternate screen and never go quiet. The fake below is exactly that — a
 * write every 50 ms, rows repainted in place, and a switch between the normal and alternate buffers.
 *
 *   (a) the rows in view are marked within 100 ms of being drawn (FR-172; `LINK_MARK_THROTTLE_MS`,
 *       which T236 declares — a literal here until it exists);
 *   (b) hovering a link no pass has collected, WITH CTRL HELD, draws the hover mark and the pointer —
 *       while xterm's Linkifier path (the provider's `provideLinks` → `hover` / `activate`) keeps
 *       working, which is why M11's Ctrl+click still follows. The no-modifier pointer is FR-164's
 *       (T238), so holding Ctrl here isolates D5;
 *   (c) after a buffer switch no decoration drawn in the other buffer remains.
 *
 * ══ THE SUBJECT ══
 *
 * `mountLinkMarking` below is `use-terminal.ts`'s composition: since T237, `link-view-marks.ts` feeding
 * `link-marks`, and the provider's hover becoming the hovered mark. It is the ONLY part of this file
 * that names the modules: T233 wrote it over the idle scan (deleted by T264) and saw every case fail;
 * T237 replaced it over the same fake, and no assertion changed.
 */

const COLS = 60;
const ROWS = 10;
/** Claude Code's spinner cadence (tasks.md T233). */
const WRITE_EVERY_MS = 50;
/** FR-172's bound: `LINK_MARK_THROTTLE_MS`, declared by T236. */
const MARKED_WITHIN_MS = 100;

type BufferType = 'normal' | 'alternate';

interface ClassListLike {
  add(...c: string[]): void;
  toggle(c: string, on?: boolean): void;
  contains(c: string): boolean;
}

function classListLike(): ClassListLike {
  const classes = new Set<string>();
  return {
    add: (...c) => c.forEach((x) => classes.add(x)),
    toggle: (c, on) => void ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)),
    contains: (c) => classes.has(c),
  };
}

interface FakeDecoration {
  /** 0-based buffer line, and the buffer it was drawn in. */
  readonly line: number;
  readonly buffer: BufferType;
  readonly x: number;
  readonly width: number;
  disposed: boolean;
  readonly element: { readonly classList: ClassListLike };
}

/** An OSC 8 hyperlink as xterm's own provider reports it: its row's range (1-based) and target. */
interface FakeHyperlink {
  readonly range: { readonly start: { x: number; y: number }; readonly end: { x: number; y: number } };
  readonly uri: string;
}

interface FakeBuffer {
  readonly type: BufferType;
  readonly lines: string[];
  /** T237: the OSC 8 hyperlinks the program printed into this buffer. */
  readonly hyperlinks: FakeHyperlink[];
  baseY: number;
  cursorY: number;
  viewportY: number;
  getLine(index: number): { translateToString(): string; isWrapped: boolean } | undefined;
}

function fakeBuffer(type: BufferType): FakeBuffer {
  const lines: string[] = Array.from({ length: ROWS }, () => '');
  return {
    type,
    lines,
    hyperlinks: [],
    baseY: 0,
    cursorY: 0,
    viewportY: 0,
    getLine: (i) => (lines[i] === undefined ? undefined : { translateToString: () => lines[i]!, isWrapped: false }),
  };
}

type Listener<T = void> = (value: T) => void;

/**
 * An xterm `Terminal` as far as link marking reaches: two buffers, markers and decorations, and the
 * events a full-screen program drives — every write, a scroll, a resize, a buffer switch.
 */
class FakeTerminal {
  readonly cols = COLS;
  readonly rows = ROWS;
  readonly decorations: FakeDecoration[] = [];
  private readonly normal = fakeBuffer('normal');
  private readonly alternate = fakeBuffer('alternate');
  private current: FakeBuffer = this.normal;
  private readonly writeParsed = new Set<Listener>();
  private readonly bufferChange = new Set<Listener<FakeBuffer>>();

  readonly buffer: {
    readonly active: FakeBuffer;
    readonly normal: FakeBuffer;
    readonly alternate: FakeBuffer;
    onBufferChange(l: Listener<FakeBuffer>): { dispose(): void };
  };

  constructor() {
    const active = (): FakeBuffer => this.current;
    const { normal, alternate } = this;
    this.buffer = {
      get active() {
        return active();
      },
      normal,
      alternate,
      onBufferChange: (l) => this.subscribe(this.bufferChange, l),
    };
  }

  private subscribe<T>(set: Set<Listener<T>>, l: Listener<T>): { dispose(): void } {
    set.add(l);
    return { dispose: () => void set.delete(l) };
  }

  onWriteParsed(l: Listener): { dispose(): void } {
    return this.subscribe(this.writeParsed, l);
  }
  onScroll(_l: Listener<number>): { dispose(): void } {
    return { dispose() {} }; // the full-screen program never scrolls the viewport
  }
  onResize(_l: Listener<unknown>): { dispose(): void } {
    return { dispose() {} };
  }

  /** The program repaints `row` of the ACTIVE buffer in place. */
  paint(row: number, text: string): void {
    this.current.lines[row] = text;
    for (const l of this.writeParsed) l();
  }

  /**
   * T237 — the program repaints `row` with `text`, `label` of it wrapped in an OSC 8 hyperlink to
   * `uri` (`ESC]8;;uri ST label ESC]8;; ST`). The plain text of the row does not contain the target.
   */
  paintHyperlink(row: number, text: string, label: string, uri: string): void {
    const x = text.indexOf(label) + 1;
    const y = row + 1;
    const links = this.current.hyperlinks;
    links.splice(0, links.length, ...links.filter((l) => l.range.start.y !== y));
    links.push({ range: { start: { x, y }, end: { x: x + label.length - 1, y } }, uri });
    this.paint(row, text);
  }

  /** xterm's built-in OSC 8 provider (`_linkProviderService.linkProviders[0]`), over the ACTIVE buffer. */
  readonly oscProvider = {
    provideLinks: (y: number, callback: (links: { text: string; range: FakeHyperlink['range'] }[] | undefined) => void) => {
      const on = this.current.hyperlinks.filter((l) => l.range.start.y === y);
      callback(on.length === 0 ? undefined : on.map((l) => ({ text: l.uri, range: l.range })));
    },
  };

  /** `ESC[?1049h` / `ESC[?1049l`: the program enters or leaves the alternate screen. */
  switchTo(type: BufferType): void {
    this.current = type === 'alternate' ? this.alternate : this.normal;
    for (const l of this.bufferChange) l(this.current);
  }

  registerMarker(cursorYOffset = 0) {
    const line = this.current.baseY + this.current.cursorY + cursorYOffset;
    return { line, isDisposed: false, dispose() {}, onDispose: () => ({ dispose() {} }) };
  }

  registerDecoration(opts: { marker: { line: number }; x?: number; width?: number; height?: number }) {
    const element = { classList: classListLike() };
    const decoration: FakeDecoration = {
      line: opts.marker.line,
      buffer: this.current.type,
      x: opts.x ?? 0,
      width: opts.width ?? COLS,
      disposed: false,
      element,
    };
    this.decorations.push(decoration);
    return {
      marker: opts.marker,
      element,
      onRender: (listener: (el: typeof element) => void) => {
        listener(element);
        return { dispose() {} };
      },
      dispose: () => {
        decoration.disposed = true;
      },
    };
  }

  live(): FakeDecoration[] {
    return this.decorations.filter((d) => !d.disposed);
  }

  marksOn(line: number): FakeDecoration[] {
    return this.live().filter((d) => d.line === line && d.element.classList.contains(LINK_MARK_CLASS));
  }
}

interface Mounted {
  readonly host: { readonly classList: ClassListLike };
  /** xterm's Linkifier: ask the provider for row `y` (1-based), and hover the link under column `x`. */
  hover(y: number, x: number, ctrl: boolean): ProvidedLink | undefined;
  dispose(): void;
}

/**
 * THE WIRING — `use-terminal.ts`'s view-marks composition (T237), reduced to the fake: the rows in view
 * go through `link-view-marks.ts` on every render, and the provider's hover becomes the hovered mark.
 * Until T237 this helper mounted the idle scan (deleted by T264); the assertions did not change.
 */
function mountLinkMarking(term: FakeTerminal): Mounted {
  const host = { classList: classListLike() };
  let hoveredMark: MarkedLink | null = null;
  let modifierHeld = false;
  let viewLinks: readonly MarkedLink[] = [];
  let syncMarks = (): void => {};

  const provider = createFileLinkProvider({
    terminal: term,
    detect: () => true,
    site: () => ({ panelId: 'panel-1', baseDirectory: 'C:/proj' }),
    // use-terminal.ts: onHover → setHovered with markOf.
    onHover: (hovered, _event, range) => {
      hoveredMark =
        hovered === null || range === undefined
          ? null
          : hovered.kind === 'web'
            ? { kind: 'web', text: hovered.uri, range }
            : { kind: 'file', text: hovered.request.text, range };
      syncMarks();
    },
    follow: () => {},
    openWeb: () => {},
  });

  const marks = createLinkMarks({
    terminal: term,
    cols: () => term.cols,
    host,
  });
  syncMarks = () => marks.sync(viewLinks, hoveredMark, modifierHeld);

  const viewRows = (): { top: number; bottom: number } => ({
    top: term.buffer.active.viewportY + 1,
    bottom: term.buffer.active.viewportY + term.rows,
  });
  const viewMarks = createLinkViewMarks({
    // xterm renders the rows a parsed write changed; the fake has no renderer, so a write IS a render.
    onRender: (listener) => {
      const sub = term.onWriteParsed(listener);
      return () => sub.dispose();
    },
    onBufferChange: (listener) => {
      const sub = term.buffer.onBufferChange(() => listener());
      return () => sub.dispose();
    },
    logicalLinesInView: () => {
      const { top, bottom } = viewRows();
      return logicalLinesBetween(term.buffer.active, top, bottom);
    },
    scan: (text) => scanLinkLine(text),
    oscLinksInView: () => {
      const found: { range: MarkedLink['range']; uri: string }[] = [];
      const { top, bottom } = viewRows();
      for (let y = top; y <= bottom; y += 1) {
        term.oscProvider.provideLinks(y, (links) => {
          for (const l of links ?? []) found.push({ range: l.range, uri: l.text });
        });
      }
      return found;
    },
    draw: (links) => {
      viewLinks = links;
      syncMarks();
    },
    clear: () => {
      viewLinks = [];
      hoveredMark = null;
      syncMarks();
    },
  });

  return {
    host,
    hover(y, x, ctrl) {
      // use-terminal.ts:1164-1169 — the modifier is read off the mousemove that carries the hover.
      if (ctrl !== modifierHeld) {
        modifierHeld = ctrl;
        syncMarks();
      }
      let hit: ProvidedLink | undefined;
      provider.provideLinks(y, (links) => {
        hit = links?.find((l) => l.range.start.y === y && l.range.start.x <= x && x <= l.range.end.x);
      });
      hit?.hover?.({ ctrlKey: ctrl } as MouseEvent, hit.text);
      return hit;
    },
    dispose() {
      viewMarks.dispose();
      marks.dispose();
    },
  };
}

// Claude Code's screen: a path and a url in the transcript, a spinner on the last row.
const PATH_ROW = 2; // 0-based buffer row
const PATH_LINE = 'Edited src/app.ts with two changes';
const URL_ROW = 4;
const URL_LINE = 'Docs: https://example.com/guide for more';
// T237 — an OSC 8 hyperlink: the row's text is the label, the target travels out of band.
const OSC_ROW = 6;
const OSC_LABEL = 'the build log';
const OSC_LINE = `See ${OSC_LABEL} for details`;
const OSC_URI = 'https://example.com/build/42';
const SPINNER_ROW = ROWS - 1;
const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽'];

describe('045 T233 — D5: links under output that never goes quiet (spec D5, FR-172)', () => {
  let term: FakeTerminal;
  let mounted: Mounted;
  let spinner: ReturnType<typeof setInterval> | undefined;

  /** Claude Code's spinner and status line: a repaint in place every 50 ms, for ever. */
  const startSpinner = (): void => {
    let frame = 0;
    spinner = setInterval(() => {
      frame += 1;
      term.paint(SPINNER_ROW, `${SPINNER[frame % SPINNER.length]} Thinking… (${frame}s · esc to interrupt)`);
    }, WRITE_EVERY_MS);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    term = new FakeTerminal();
    mounted = mountLinkMarking(term);
  });

  afterEach(() => {
    if (spinner !== undefined) clearInterval(spinner);
    spinner = undefined;
    mounted.dispose();
    vi.useRealTimers();
  });

  it('(a) marks the links in view within 100 ms of their being drawn, while the spinner never stops', async () => {
    term.switchTo('alternate');
    startSpinner();
    await vi.advanceTimersByTimeAsync(WRITE_EVERY_MS * 3);

    term.paint(PATH_ROW, PATH_LINE);
    term.paint(URL_ROW, URL_LINE);
    await vi.advanceTimersByTimeAsync(MARKED_WITHIN_MS);

    expect(term.marksOn(PATH_ROW).length, `the path on row ${PATH_ROW} is marked at rest`).toBeGreaterThan(0);
    expect(term.marksOn(URL_ROW).length, `the url on row ${URL_ROW} is marked at rest`).toBeGreaterThan(0);
  });

  it('(a, OSC 8) an OSC 8 hyperlink in view is marked at rest within 100 ms, spinner running (FR-136, T237)', async () => {
    term.switchTo('alternate');
    startSpinner();
    await vi.advanceTimersByTimeAsync(WRITE_EVERY_MS * 3);

    term.paintHyperlink(OSC_ROW, OSC_LINE, OSC_LABEL, OSC_URI);
    await vi.advanceTimersByTimeAsync(MARKED_WITHIN_MS);

    const marked = term.marksOn(OSC_ROW);
    expect(marked.length, `the OSC 8 link on row ${OSC_ROW} is marked at rest`).toBe(1);
    expect(
      { x: marked[0]!.x, width: marked[0]!.width },
      'the mark covers the label, the only cells the hyperlink occupies',
    ).toEqual({ x: OSC_LINE.indexOf(OSC_LABEL), width: OSC_LABEL.length });
  });

  /*
   * 045 T285 — FR-163: an OSC 8 `file:` target that names NOTHING is still a link — marked at rest in
   * view, spinner running, with no call to main (SC-021). Before round four it waited for an answer
   * that said "not found" and stayed text.
   */
  it('(a, OSC 8 file:) a file: target that does not exist is marked at rest, asking main nothing (FR-163)', async () => {
    const asked: string[] = [];
    vi.stubGlobal('window', {
      throng: {
        links: {
          resolve: async (r: LinkResolutionRequest) => {
            asked.push(r.text);
            return { ok: false };
          },
        },
      },
    });
    try {
      term.switchTo('alternate');
      startSpinner();
      await vi.advanceTimersByTimeAsync(WRITE_EVERY_MS * 3);

      term.paintHyperlink(OSC_ROW, OSC_LINE, OSC_LABEL, 'file:///C:/does/not/exist.txt');
      await vi.advanceTimersByTimeAsync(MARKED_WITHIN_MS);

      expect(term.marksOn(OSC_ROW).length, 'the dead-looking file: target is a link, marked at rest').toBe(1);
      expect(asked, 'nothing is asked to draw it').toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('(a, OSC 8 crafted) a target carrying %00 is NOT drawn clickable (FR-156, §16.15)', async () => {
    term.switchTo('alternate');
    startSpinner();
    await vi.advanceTimersByTimeAsync(WRITE_EVERY_MS * 3);

    term.paintHyperlink(OSC_ROW, OSC_LINE, OSC_LABEL, 'file:///C:/x.txt%00.exe');
    await vi.advanceTimersByTimeAsync(MARKED_WITHIN_MS);

    expect(term.marksOn(OSC_ROW)).toEqual([]);
  });

  it('(b) hovering an uncollected link with Ctrl held draws the hover mark and the hand; the Linkifier still follows', async () => {
    term.switchTo('alternate');
    startSpinner();
    term.paint(URL_ROW, URL_LINE);
    await vi.advanceTimersByTimeAsync(WRITE_EVERY_MS * 2);

    const urlColumn = URL_LINE.indexOf('https://') + 3; // 1-based cell inside the url
    const hovered = mounted.hover(URL_ROW + 1, urlColumn, true);

    // What M11 says still works: xterm's Linkifier gets the link, and a Ctrl+click on it follows.
    expect(hovered?.text, 'the provider hands the Linkifier the url under the pointer').toBe('https://example.com/guide');
    expect(typeof hovered?.activate, 'and the Linkifier can activate it').toBe('function');

    // What M11 says is missing: the hover mark, and the hand throng draws.
    const onRow = term.marksOn(URL_ROW);
    expect(
      onRow.some((d) => d.element.classList.contains(LINK_MARK_HOVER_CLASS)),
      'the hovered url carries the hover mark',
    ).toBe(true);
    expect(
      onRow.some((d) => d.element.classList.contains(LINK_MARK_POINTER_CLASS)),
      'the hovered url carries the pointer class (Ctrl held)',
    ).toBe(true);
    expect(mounted.host.classList.contains(LINK_POINTER_HOST_CLASS), 'the host shows the hand').toBe(true);
  });

  it.each([
    ['normal', 'alternate'],
    ['alternate', 'normal'],
  ] as const)('(c) after a switch from the %s buffer to the %s one, no decoration from the old buffer remains', async (from, to) => {
    term.switchTo(from);
    term.paint(PATH_ROW, PATH_LINE);
    term.paint(URL_ROW, URL_LINE);
    // Let the old buffer settle so its links ARE marked — the idle scan T233 ran against marked a quiet screen.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(term.live().filter((d) => d.buffer === from).length, `precondition: the ${from} buffer's links are marked`).toBeGreaterThan(0);

    term.switchTo(to);
    startSpinner();
    await vi.advanceTimersByTimeAsync(MARKED_WITHIN_MS);

    const stale = term.live().filter((d) => d.buffer === from);
    expect(
      stale.map((d) => `row ${d.line} cols ${d.x}+${d.width}`),
      `no mark drawn in the ${from} buffer survives the switch to the ${to} one`,
    ).toEqual([]);
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * 045 T264 — moved here from the idle scan's test when the idle scan was deleted (R32)
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Two of the idle scan's assertions were never about waiting for quiet, and are still true of the
 * view pass that replaced it: it is handed no output DATA — a render tells it rows changed, never what
 * was written, and it reads only the rows in view — and the per-line cap bounds its work, so a line of
 * ten thousand dotted words is still one line's worth of marks.
 */
describe('T264 — the view pass reads no output data, and the per-line cap bounds it (FR-072)', () => {
  function passOver(lines: string[], view: { top: number; bottom: number }) {
    const buffer = {
      getLine: (i: number) => (lines[i] === undefined ? undefined : { translateToString: () => lines[i]!, isWrapped: false }),
    };
    const scanned: string[] = [];
    let drawn: readonly MarkedLink[] = [];
    let renderListener: ((...args: unknown[]) => void) | undefined;
    const pass = createLinkViewMarks({
      onRender: (listener) => {
        renderListener = listener as (...args: unknown[]) => void;
        return () => {};
      },
      onBufferChange: () => () => {},
      logicalLinesInView: () => logicalLinesBetween(buffer, view.top, view.bottom),
      scan: (text) => {
        scanned.push(text);
        return scanLinkLine(text);
      },
      oscLinksInView: () => [],
      draw: (links) => {
        drawn = links;
      },
      clear: () => {},
      now: () => 0,
      schedule: (fn) => {
        fn();
        return () => {};
      },
    });
    return { pass, scanned, drawn: () => drawn, renderListener: () => renderListener };
  }

  it('its render signal carries no data, and a pass reads only the rows in view', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `row${i} src/file${i}.ts`);
    const { pass, scanned, renderListener } = passOver(lines, { top: 41, bottom: 50 });
    expect(renderListener()?.length, 'the render listener takes no arguments — no output data').toBe(0);
    expect(scanned).toEqual(lines.slice(40, 50));
    pass.dispose();
  });

  it('a line of 5,000 path candidates yields at most MAX_LINK_CANDIDATES_PER_LINE marks', () => {
    const long = Array.from({ length: 5_000 }, (_, i) => `d${i}/f${i}.ts`).join(' ');
    const { pass, drawn } = passOver([long], { top: 1, bottom: 1 });
    const files = drawn().filter((l) => l.kind === 'file');
    expect(files.length).toBeGreaterThan(0);
    expect(files.length).toBeLessThanOrEqual(MAX_LINK_CANDIDATES_PER_LINE);
    pass.dispose();
  });

  // Review round four (L2): the same bound, for the declared addresses the view pass also marks.
  it('a line of 5,000 web urls yields at most MAX_LINK_CANDIDATES_PER_LINE marks', () => {
    const long = Array.from({ length: 5_000 }, (_, i) => `https://example.com/p${i}`).join(' ');
    const { pass, drawn } = passOver([long], { top: 1, bottom: 1 });
    const web = drawn().filter((l) => l.kind === 'web');
    expect(web.length).toBeGreaterThan(0);
    expect(web.length).toBeLessThanOrEqual(MAX_LINK_CANDIDATES_PER_LINE);
    pass.dispose();
  });
});
