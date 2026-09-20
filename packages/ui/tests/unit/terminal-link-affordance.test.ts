import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkResolution, LinkResolutionRequest } from '@throng/core';
import {
  createLinkMarks,
  LINK_ALT_BUFFER_HOST_CLASS,
  LINK_POINTER_HOST_CLASS,
} from '../../src/renderer/terminal/link-marks.js';

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

/** The panel host the hand is shown on — a classList that records its classes. */
function hostLike(): { readonly classes: Set<string>; readonly classList: { toggle(c: string, on?: boolean): void } } {
  const classes = new Set<string>();
  return {
    classes,
    classList: { toggle: (c, on) => void ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)) },
  };
}

/** The panel the marks belong to. Round four judges no mark by it (FR-163); kept as the caller's shape. */
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

/*
 * 045 T238 — FR-164 supersedes FR-135's third row: a valid link shows the hand whenever it is hovered,
 * with or without the modifier (a Ctrl+click is still the only click that follows, FR-040). The case
 * below used to assert NO pointer without the modifier; that is the row FR-164 withdrew.
 */
describe('FR-164 — the hand shows on every hover of a valid link, with or without the modifier', () => {
  it('hovered without the modifier: the pointer on every row of that link; with it: the same', () => {
    const { terminal, marks } = mount();
    const pointerRows = (): number[] =>
      terminal.live().filter((d) => /pointer/.test(d.element.className)).map((d) => d.line).sort((a, b) => a - b);

    marks.sync([WRAPPED_FILE, WEB], WRAPPED_FILE, false);
    expect(pointerRows(), 'no modifier held').toEqual(rowsOf(WRAPPED_FILE));

    marks.sync([WRAPPED_FILE, WEB], WRAPPED_FILE, true);
    expect(pointerRows(), 'modifier held').toEqual(rowsOf(WRAPPED_FILE));
  });

  it('the host shows the hand while a valid link is hovered, modifier or not, and not once it is left', () => {
    const terminal = new FakeTerminal();
    const host = hostLike();
    const marks = createLinkMarks({ terminal, cols: COLS, site: () => SITE, host } as unknown as Parameters<typeof createLinkMarks>[0]);

    marks.sync([WEB], WEB, false);
    expect(host.classes.has(LINK_POINTER_HOST_CLASS), 'hovered, no modifier').toBe(true);
    marks.sync([WEB], null, false);
    expect(host.classes.has(LINK_POINTER_HOST_CLASS), 'left').toBe(false);
  });
});

/*
 * 045 T238 — FR-172: the hover mark is drawn from the HOVERED link itself — the provider's range —
 * whether or not a view pass has collected it yet (D5 / T228: output that never pauses left the hovered
 * link out of `viewLinks`, and so without a hover mark).
 */
describe('FR-172 — the hover mark comes from the hovered link, not from the links in view', () => {
  it('a hovered link no pass has collected: every row of it in the hover state, with the pointer', () => {
    const { terminal, marks } = mount();
    marks.sync([WEB], WRAPPED_FILE, false);

    const hovered = terminal.live().filter((d) => /hover/.test(d.element.className)).map((d) => d.line).sort((a, b) => a - b);
    expect(hovered, 'the hovered link is drawn in the hover state on every row').toEqual(rowsOf(WRAPPED_FILE));
    const pointer = terminal.live().filter((d) => /pointer/.test(d.element.className)).map((d) => d.line).sort((a, b) => a - b);
    expect(pointer, 'and carries the pointer').toEqual(rowsOf(WRAPPED_FILE));
    expect(
      terminal.live().filter((d) => rowsOf(WEB).includes(d.line)).map((d) => /hover/.test(d.element.className)),
      'the link in view keeps its at-rest mark',
    ).toEqual([false]);
  });

  it('once it is left, its marks go with it — it was never in view', () => {
    const { terminal, marks } = mount();
    marks.sync([WEB], WRAPPED_FILE, false);
    marks.sync([WEB], null, false);
    expect(terminal.live().map((d) => d.line)).toEqual(rowsOf(WEB));
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
 * 045 T285 — FR-163 (superseding FR-154 for `file:` targets), FR-156, FR-159: an OSC 8 target is
 * judged by its resource class ALONE
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * *Round four:* the T212 block that stood here marked a `file:` target only once it had RESOLVED, and
 * treated one naming nothing — or a host that does not answer — as text. FR-163 makes a well-formed
 * `file:` target a link whatever it points at: marked at rest, hovered, with the hand, and worded,
 * without any call to main (SC-021). What is still not a link keeps FR-154's look — plain text, no
 * mark, no hover, no hand: an empty target, a scheme that is refused (even when allowlisted, FR-159),
 * one not on the allowlist, and a target carrying control characters or `%00` (FR-156's render-side
 * half, data-model §16.15).
 */
describe('T285 / FR-163 — an OSC 8 target is a link by its class alone, and nothing asks main', () => {
  let asked: string[];

  beforeEach(() => {
    asked = [];
    vi.stubGlobal('window', {
      throng: {
        links: {
          resolve: async (request: LinkResolutionRequest): Promise<LinkResolution> => {
            asked.push(`resolve:${request.text}`);
            return { ok: false };
          },
          follow: async (request: LinkResolutionRequest) => {
            asked.push(`follow:${request.text}`);
            return { kind: 'notFound', path: request.text };
          },
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const osc8 = (uri: string, row: number) => link('osc8', 'label text', [3, row], [12, row], uri);

  function mountWith(allowlist: ReadonlySet<string>) {
    const terminal = new FakeTerminal();
    const host = hostLike();
    const marks = createLinkMarks({
      terminal,
      cols: COLS,
      site: () => SITE,
      host,
      allowlist: () => allowlist,
    } as unknown as Parameters<typeof createLinkMarks>[0]) as unknown as {
      sync(links: readonly MarkedLink[], hovered: MarkedLink | null, modifierHeld: boolean): void;
    };
    return { terminal, marks, host };
  }

  const LINKS: readonly (readonly [string, string])[] = [
    ['a file: target that does not exist', 'file:///C:/does/not/exist.txt'],
    ['a file: target whose host does not answer', 'file://nonexistent-host-xyz/share/file.txt'],
    ['a file: target in the project, never asked about', 'file:///D:/p/src/foo.ts'],
    ['an https target', 'https://example.com/x'],
    ['an allowlisted mailto: target', 'mailto:someone@example.com'],
  ];

  for (const [label, uri] of LINKS) {
    it(`${label}: marked at rest, hovered, with the hand — and main is asked nothing`, () => {
      const target = osc8(uri, 9);
      const { terminal, marks, host } = mountWith(new Set(['mailto']));

      marks.sync([target], null, false);
      expect(terminal.live().map((d) => d.line), 'at rest').toEqual(rowsOf(target));

      marks.sync([target], target, false);
      const hovered = terminal.live().filter((d) => /hover/.test(d.element.className)).map((d) => d.line);
      const pointer = terminal.live().filter((d) => /pointer/.test(d.element.className)).map((d) => d.line);
      expect(hovered, 'hover state').toEqual(rowsOf(target));
      expect(pointer, 'the hand').toEqual(rowsOf(target));
      expect(host.classes.has(LINK_POINTER_HOST_CLASS)).toBe(true);
      expect(asked, 'SC-021: drawing asks main nothing').toEqual([]);
    });
  }

  const CTRL_BELL = String.fromCharCode(0x07);
  const NOT_LINKS: readonly (readonly [string, string])[] = [
    ['V1: a scheme throng does not follow', 'notascheme:foo'],
    ['V1: an empty target', ''],
    ['a refused scheme, even allowlisted (FR-159)', 'javascript:alert(1)'],
    ['a scheme not on the allowlist', 'tel:+441234567890'],
    ['a target carrying %00 (FR-156)', 'file:///C:/x.txt%00.exe'],
    ['a target carrying a control character (FR-156)', `file:///C:/x${CTRL_BELL}.txt`],
  ];

  for (const [label, uri] of NOT_LINKS) {
    it(`${label}: no mark at rest, none hovered, none with the modifier`, () => {
      const dead = osc8(uri, 9);
      const { terminal, marks } = mountWith(new Set(['mailto', 'javascript']));

      marks.sync([dead], null, false);
      expect(terminal.live(), 'at rest').toEqual([]);

      marks.sync([dead], dead, true);
      expect(terminal.live(), 'hovered with the modifier — no hover state and no pointer either').toEqual([]);
      expect(asked).toEqual([]);
    });
  }

  it('an unfollowable one beside a link: only the link is marked', () => {
    const { terminal, marks } = mountWith(new Set(['mailto']));
    marks.sync([OSC8, osc8('file:///C:/does/not/exist.txt', 9), osc8('notascheme:foo', 10)], null, false);
    expect(terminal.live().map((d) => d.line).sort((a, b) => a - b)).toEqual([...rowsOf(OSC8), 8]);
  });
});

/*
 * 045 T280 (D5, FR-172) — the marks must SHOW on the alternate screen.
 *
 * xterm 6's decoration renderer sets `display: none` on every decoration while the alternate buffer is
 * active, so a mark drawn there existed and was invisible — found by the alternate-screen case in
 * `terminal-link-once.e2e.ts`. `terminal.css` restores it under a host class, and this pins the class:
 * on the host exactly while the active buffer is the alternate one, and gone once the marks are.
 */
describe('T280 — the host names the alternate buffer, so its marks can be shown', () => {
  it('on while the alternate buffer is active, off on the normal one, off after dispose', () => {
    const terminal = new FakeTerminal();
    const active = terminal.buffer.active as { type?: 'normal' | 'alternate' };
    const host = hostLike();
    const marks = createLinkMarks({ terminal, cols: COLS, site: () => SITE, host } as unknown as Parameters<
      typeof createLinkMarks
    >[0]);

    active.type = 'alternate';
    marks.sync([WEB], null, false);
    expect(host.classes.has(LINK_ALT_BUFFER_HOST_CLASS), 'alternate buffer').toBe(true);

    active.type = 'normal';
    marks.sync([WEB], null, false);
    expect(host.classes.has(LINK_ALT_BUFFER_HOST_CLASS), 'normal buffer').toBe(false);

    active.type = 'alternate';
    marks.sync([], null, false);
    expect(host.classes.has(LINK_ALT_BUFFER_HOST_CLASS), 'alternate buffer, nothing marked yet').toBe(true);
    marks.dispose();
    expect(host.classes.has(LINK_ALT_BUFFER_HOST_CLASS), 'disposed').toBe(false);
  });
});

/*
 * 045 T280 (D5, FR-172) — a mark xterm disposed underneath is drawn again.
 *
 * xterm disposes a marker, and every decoration on it, when its line is trimmed or deleted — on the
 * alternate screen, whose rows are its whole buffer, a full-screen program's repaint does exactly that
 * while the link stays at the same row. The mark's key (kind, range, text) is unchanged, so a sync that
 * only compared keys kept the dead mark and never drew the link again. Measured in the mouse-owning
 * case of `terminal-link-once.e2e.ts`: all four marks with `isDisposed` markers and no element left.
 */
describe('T280 — a mark whose marker xterm disposed is drawn again on the next sync', () => {
  class RecordingTerminal extends FakeTerminal {
    readonly markers: { isDisposed: boolean }[] = [];
    override registerMarker(cursorYOffset = 0) {
      const marker = super.registerMarker(cursorYOffset);
      this.markers.push(marker);
      return marker;
    }
  }

  it('the same link, still in view, gets a live decoration again', () => {
    const terminal = new RecordingTerminal();
    const marks = createLinkMarks({ terminal, cols: COLS, site: () => SITE } as unknown as Parameters<
      typeof createLinkMarks
    >[0]);
    marks.sync([WEB], null, false);
    expect(terminal.live()).toHaveLength(1);

    // What xterm does to a marker whose line went: the marker and its decoration are disposed.
    terminal.markers[0]!.isDisposed = true;
    terminal.decorations[0]!.disposed = true;

    marks.sync([WEB], null, false);
    expect(terminal.live(), 'the link is still in view, so it is marked again').toHaveLength(1);
  });
});

/*
 * Round five (maintainer) — "hovering over a link in a terminal … should simply show the link text,
 * in full, in the HTML title popup." The bespoke floating tooltip is gone from the terminal entirely
 * (`use-terminal.ts`, not this file); this is what replaced it: a native `title` on `deps.host`, set
 * for exactly as long as a LIVE hover lasts.
 */
describe('round five — the hovered link’s native `title` (link-marks.ts, "THE HOVER TITLE")', () => {
  function mountWithTitledHost(): {
    terminal: FakeTerminal;
    marks: ReturnType<typeof createLinkMarks>;
    host: { classes: Set<string>; classList: { toggle(c: string, on?: boolean): void }; title: string };
  } {
    const terminal = new FakeTerminal();
    const host = { ...hostLike(), title: '' };
    const marks = createLinkMarks({
      terminal,
      cols: COLS,
      site: () => SITE,
      host,
    } as unknown as Parameters<typeof createLinkMarks>[0]);
    return { terminal, marks, host };
  }

  it('falls back to the mark’s own uri (an OSC 8 target) or text (web/file) with no caller wording', () => {
    const { marks, host } = mountWithTitledHost();
    marks.sync([WEB], WEB, false);
    expect(host.title).toBe(WEB.text);

    marks.sync([OSC8], OSC8, false);
    expect(host.title).toBe(OSC8.uri);
  });

  it('a caller-supplied `hoverTitle` wins over the fallback', () => {
    const { marks, host } = mountWithTitledHost();
    marks.sync([WEB], WEB, false, 'D:\\resolved\\path.ts');
    expect(host.title).toBe('D:\\resolved\\path.ts');
  });

  it('clears the instant the pointer leaves — no stale title', () => {
    const { marks, host } = mountWithTitledHost();
    marks.sync([WEB], WEB, false);
    expect(host.title).toBe(WEB.text);
    marks.sync([WEB], null, false);
    expect(host.title).toBe('');
  });

  it('a hovered target that turns out not to be a live link (FR-154) gets no title either', () => {
    const { marks, host } = mountWithTitledHost();
    const dead = link('osc8', 'label', [3, 9], [12, 9], 'notascheme:foo');
    marks.sync([dead], dead, false);
    expect(host.title).toBe('');
  });

  it('dispose clears it', () => {
    const { marks, host } = mountWithTitledHost();
    marks.sync([WEB], WEB, false);
    expect(host.title).toBe(WEB.text);
    marks.dispose();
    expect(host.title).toBe('');
  });
});
