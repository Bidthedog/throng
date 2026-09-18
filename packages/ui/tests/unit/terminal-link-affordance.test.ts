import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkResolution, LinkResolutionRequest } from '@throng/core';
import { __resetLinkCacheForTests } from '../../src/renderer/links/link-cache.js';
import { createLinkMarks } from '../../src/renderer/terminal/link-marks.js';
import { askTerminalLink, terminalLinkRequest } from '../../src/renderer/terminal/terminal-link-activation.js';

/**
 * 045 T185 — the terminal's link AFFORDANCE, drawn as xterm decorations (FR-130, FR-131, FR-135,
 * FR-136, FR-139; contracts/menus-and-gestures.md §7.6; data-model §14.2).
 *
 * What the user sees today (O11's probe): an OSC 8 link carries xterm's own dashed underline, a
 * plain-text link carries only a solid underline on hover, and the hover underline of a WRAPPED link
 * covers only the row under the pointer (#326). Three kinds, three looks, and nothing at rest for
 * most of them — so the user cannot tell at a glance what is clickable.
 *
 * FR-135's one affordance, for every kind in the terminal:
 *
 *   | at rest            | a mark on EVERY row the link occupies                        |
 *   | hovered            | the hover state on every row of THAT link (FR-131)           |
 *   | hovered + modifier | the pointer — only then, because only then does a click follow |
 *
 * ══ THE SUBJECT, AND WHAT IS ASSUMED ABOUT ITS SHAPE ══
 *
 * `link-marks.ts` is new (T187). data-model §14.2 sketches it as `syncLinkMarks(links, state)`; a
 * mark needs a terminal to decorate, so this test takes it as a factory over the terminal —
 * `createLinkMarks({ terminal, cols })` returning `sync(links, hovered, modifierHeld)` and `dispose()`
 * — and observes only what reaches the fake terminal's decoration API. The CSS class names are
 * matched loosely (`hover`, `pointer`), since the tokens and the stylesheet are T187's; what is
 * pinned is WHICH rows are marked and in WHICH state. T187 may reshape the call; the assertions are
 * about the decorations.
 */

const COLS = 20;

interface FakeDecoration {
  readonly line: number;
  readonly x: number;
  readonly width: number;
  disposed: boolean;
  readonly element: HTMLElementLike;
}

/** The slice of a DOM element a decoration's `onRender` is handed, as much as a node test can hold. */
interface HTMLElementLike {
  readonly classList: { add(...c: string[]): void; remove(...c: string[]): void; toggle(c: string, on?: boolean): void; contains(c: string): boolean };
  className: string;
  readonly style: Record<string, string>;
}

function elementLike(): HTMLElementLike {
  const classes = new Set<string>();
  const el: HTMLElementLike = {
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, on) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    get className() {
      return [...classes].join(' ');
    },
    set className(v: string) {
      classes.clear();
      v.split(/\s+/).filter(Boolean).forEach((x) => classes.add(x));
    },
    style: {},
  };
  return el;
}

/** An xterm `Terminal`, as far as markers and decorations go. Buffer line numbers are 0-based. */
class FakeTerminal {
  readonly decorations: FakeDecoration[] = [];
  readonly buffer = { active: { baseY: 0, cursorY: 0, viewportY: 0 } };
  readonly cols = COLS;

  registerMarker(cursorYOffset = 0) {
    const line = this.buffer.active.baseY + this.buffer.active.cursorY + cursorYOffset;
    return { line, isDisposed: false, dispose() {}, onDispose: () => ({ dispose() {} }) };
  }

  registerDecoration(opts: { marker: { line: number }; x?: number; width?: number; height?: number }) {
    const element = elementLike();
    const decoration: FakeDecoration = {
      line: opts.marker.line,
      x: opts.x ?? 0,
      width: opts.width ?? COLS,
      disposed: false,
      element,
    };
    this.decorations.push(decoration);
    return {
      marker: opts.marker,
      element,
      isDisposed: false,
      onRender: (listener: (el: HTMLElementLike) => void) => {
        listener(element);
        return { dispose() {} };
      },
      onDispose: () => ({ dispose() {} }),
      dispose: () => {
        decoration.disposed = true;
      },
    };
  }

  live(): FakeDecoration[] {
    return this.decorations.filter((d) => !d.disposed);
  }
}

type Kind = 'file' | 'web' | 'osc8';

/** A link as the provider hands it over — xterm's 1-based inclusive range — with its kind. */
interface MarkedLink {
  readonly kind: Kind;
  readonly text: string;
  readonly range: { readonly start: { x: number; y: number }; readonly end: { x: number; y: number } };
  /**
   * An OSC 8 link's declared TARGET (045 T212, FR-154). The label is what the program printed; the
   * target is what decides whether it is a link at all, so a mark cannot be judged without it.
   */
  readonly uri?: string;
}

const link = (
  kind: Kind,
  text: string,
  start: [number, number],
  end: [number, number],
  uri?: string,
): MarkedLink => ({
  kind,
  text,
  range: { start: { x: start[0], y: start[1] }, end: { x: end[0], y: end[1] } },
  ...(uri === undefined ? {} : { uri }),
});

/** Three kinds, one wrapped across three rows, in a 20-column terminal. */
const WRAPPED_FILE = link('file', 'src/deeply/nested/folder/and/more/foo.ts', [7, 1], [6, 3]);
const WEB = link('web', 'https://example.com/a', [1, 5], [21 - 1, 5]);
// *T212:* given an `https` target, so it stays a followable OSC 8 link under FR-154 (V4 — marked as
// drawn). Without a target FR-154 has nothing to judge it by; every assertion above and below that
// uses it is unchanged.
const OSC8 = link('osc8', 'build output', [3, 7], [14, 7], 'https://example.com/build');

/** The panel a mark is judged for — the same site the hover and the idle scan ask with (P4). */
const SITE = { panelId: 'panel-1', originProjectId: 'project-1' };

function mount() {
  const terminal = new FakeTerminal();
  const marks = createLinkMarks({ terminal, cols: COLS, site: () => SITE } as unknown as Parameters<typeof createLinkMarks>[0]) as unknown as {
    sync(links: readonly MarkedLink[], hovered: MarkedLink | null, modifierHeld: boolean): void;
    dispose(): void;
  };
  return { terminal, marks };
}

/** 0-based buffer rows a link occupies. */
const rowsOf = (l: MarkedLink): number[] =>
  Array.from({ length: l.range.end.y - l.range.start.y + 1 }, (_, i) => l.range.start.y - 1 + i);

describe('FR-136 / FR-130 — at rest, a mark on EVERY row of every link in view, whatever its kind', () => {
  it('a wrapped path, a web link and an OSC 8 link: one decoration per occupied row', () => {
    const { terminal, marks } = mount();
    marks.sync([WRAPPED_FILE, WEB, OSC8], null, false);

    const marked = terminal.live().map((d) => d.line).sort((a, b) => a - b);
    expect(marked).toEqual([...rowsOf(WRAPPED_FILE), ...rowsOf(WEB), ...rowsOf(OSC8)].sort((a, b) => a - b));
  });

  it('each row’s decoration covers exactly the link’s cells on that row', () => {
    const { terminal, marks } = mount();
    marks.sync([WRAPPED_FILE], null, false);

    const byRow = terminal.live().sort((a, b) => a.line - b.line).map((d) => ({ line: d.line, x: d.x, width: d.width }));
    expect(byRow).toEqual([
      { line: 0, x: 6, width: COLS - 6 }, // from column 7 (1-based) to the end of the row
      { line: 1, x: 0, width: COLS }, // the whole middle row
      { line: 2, x: 0, width: 6 }, // up to column 6 (1-based, inclusive)
    ]);
  });

  it('FR-139: the three kinds get the SAME mark — one look, whatever draws the link', () => {
    const { terminal, marks } = mount();
    marks.sync([WRAPPED_FILE, WEB, OSC8], null, false);

    const classesByKind = new Set(terminal.live().map((d) => d.element.className));
    expect(classesByKind.size, [...classesByKind].join(' | ')).toBe(1);
  });

  it('at rest, nothing is in the hover state and nothing carries the pointer', () => {
    const { terminal, marks } = mount();
    marks.sync([WRAPPED_FILE, WEB, OSC8], null, false);

    for (const d of terminal.live()) {
      expect(d.element.className).not.toMatch(/hover/);
      expect(d.element.className).not.toMatch(/pointer/);
    }
  });
});

describe('FR-131 — hovering a wrapped link puts EVERY row of it in the hover state', () => {
  it('all three rows of the wrapped path, and no row of any other link', () => {
    const { terminal, marks } = mount();
    marks.sync([WRAPPED_FILE, WEB, OSC8], WRAPPED_FILE, false);

    const hovered = terminal.live().filter((d) => /hover/.test(d.element.className)).map((d) => d.line).sort((a, b) => a - b);
    expect(hovered).toEqual(rowsOf(WRAPPED_FILE));
  });
});

describe('FR-135 — the pointer appears only while the modifier is held', () => {
  it('hovered without the modifier: no pointer; with it: the pointer on every row of that link', () => {
    const { terminal, marks } = mount();
    marks.sync([WRAPPED_FILE, WEB], WRAPPED_FILE, false);
    expect(terminal.live().filter((d) => /pointer/.test(d.element.className))).toEqual([]);

    marks.sync([WRAPPED_FILE, WEB], WRAPPED_FILE, true);
    const pointer = terminal.live().filter((d) => /pointer/.test(d.element.className)).map((d) => d.line).sort((a, b) => a - b);
    expect(pointer).toEqual(rowsOf(WRAPPED_FILE));
  });
});

describe('marks follow the answers — an invalidated link loses its marks', () => {
  it('a link absent from the next sync (its cached answer was dropped) has every decoration disposed', () => {
    const { terminal, marks } = mount();
    marks.sync([WRAPPED_FILE, WEB], null, false);
    marks.sync([WEB], null, false);

    expect(terminal.live().map((d) => d.line)).toEqual(rowsOf(WEB));
  });

  it('dispose removes every mark', () => {
    const { terminal, marks } = mount();
    marks.sync([WRAPPED_FILE, WEB, OSC8], null, false);
    marks.dispose();
    expect(terminal.live()).toEqual([]);
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * 045 T212 — FR-154: an OSC 8 hyperlink that goes nowhere gets NO mark (menus-and-gestures §8.1,
 * link-resolution §8.4 V1 – V4, P15)
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * §7.6's "every link kind takes the same row" means every FOLLOWABLE link. An OSC 8 hyperlink to
 * `notascheme:foo`, to nothing, to a file that does not exist or to a host that does not answer is
 * text: no mark at rest, no hover state, no pointer. A `file:` target is marked once it has RESOLVED
 * — through the same cache the hover and the idle scan fill (P4) — and an `https` target as drawn.
 *
 * ══ WHAT IS ASSUMED ABOUT THE SHAPE ══
 *
 * data-model §15.3 puts the judgement where the OSC 8 hover arrives, and T214 names `link-marks.ts`
 * as one of the places it is consulted. This file takes `createLinkMarks` to be given the panel's
 * `site` and to judge an `osc8` link by its `uri` against the renderer's link cache, so a dead one is
 * never drawn whichever caller hands it over. T214 may move the judgement to the caller; if it does,
 * these cases move with it and keep their assertions.
 */
describe('T212 / FR-154 — a dead OSC 8 target is never marked', () => {
  const answers = new Map<string, LinkResolution>();

  beforeEach(() => {
    answers.clear();
    __resetLinkCacheForTests();
    vi.stubGlobal('window', {
      throng: {
        links: {
          resolve: async (request: LinkResolutionRequest): Promise<LinkResolution> =>
            answers.get(request.text) ?? { ok: false },
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** What the hover or the idle scan does for a `file:` target: ask, and let main's answer land. */
  async function resolveTarget(uri: string): Promise<void> {
    askTerminalLink(terminalLinkRequest({ text: uri, kind: 'fileHyperlink', site: SITE }));
    await Promise.resolve();
    await Promise.resolve();
  }

  const osc8 = (uri: string, row: number) => link('osc8', 'label text', [3, row], [12, row], uri);

  const DEAD: readonly (readonly [string, string, LinkResolution | undefined])[] = [
    ['V1: a scheme throng does not follow', 'notascheme:foo', undefined],
    ['V1: an empty target', '', undefined],
    ['V2: a file: target that does not exist', 'file:///C:/does/not/exist.txt', { ok: false }],
    ['V2: a file: target whose host does not answer', 'file://nonexistent-host-xyz/share/file.txt', { ok: false, reason: 'unreachable' }],
  ];

  for (const [label, uri, answer] of DEAD) {
    it(`${label}: no mark at rest, none hovered, none with the modifier`, async () => {
      if (answer !== undefined) answers.set(uri, answer);
      if (uri.startsWith('file:')) await resolveTarget(uri);
      const dead = osc8(uri, 9);
      const { terminal, marks } = mount();

      marks.sync([dead], null, false);
      expect(terminal.live(), 'at rest').toEqual([]);

      marks.sync([dead], dead, true);
      expect(terminal.live(), 'hovered with the modifier — no hover state and no pointer either').toEqual([]);
    });
  }

  it('a dead one beside a live one: only the live one is marked', async () => {
    answers.set('file:///C:/does/not/exist.txt', { ok: false });
    await resolveTarget('file:///C:/does/not/exist.txt');
    const { terminal, marks } = mount();
    marks.sync([OSC8, osc8('file:///C:/does/not/exist.txt', 9), osc8('notascheme:foo', 10)], null, false);
    expect(terminal.live().map((d) => d.line)).toEqual(rowsOf(OSC8));
  });

  it('V3: a file: target is NOT marked before it resolves, and IS once it has — no pointer movement', async () => {
    const uri = 'file:///D:/p/src/foo.ts';
    const target = osc8(uri, 9);
    const { terminal, marks } = mount();

    marks.sync([target], null, false);
    expect(terminal.live(), 'not yet answered: not yet a link (FR-071)').toEqual([]);

    // The idle scan (or a hover elsewhere) asks; main answers late (FR-123).
    answers.set(uri, {
      ok: true,
      link: { path: 'D:\\p\\src\\foo.ts', kind: 'file', inProject: true, executable: false, preview: 'none' },
    });
    await resolveTarget(uri);

    // The same sync the cache's notification drives — nothing hovered, nothing moved.
    marks.sync([target], null, false);
    expect(terminal.live().map((d) => d.line)).toEqual(rowsOf(target));
  });

  it('V4: an https target is marked as drawn — no existence check', () => {
    const { terminal, marks } = mount();
    marks.sync([osc8('https://example.com/x', 9)], null, false);
    expect(terminal.live().map((d) => d.line)).toEqual([8]);
  });
});
