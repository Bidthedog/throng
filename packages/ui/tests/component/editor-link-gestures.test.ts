import { EditorState, type TransactionSpec } from '@codemirror/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BINDING_PLATFORM,
  shippedBindingsFor,
  type LinkResolution,
  type LinkResolutionRequest,
  type ResolvedLink,
} from '@throng/core';
import {
  createLinkPointerHandlers,
  linkAtPosition,
  linkHitsBetween,
  linkModifierFromChord,
  linkModifierName,
  type EditorLinkDeps,
  type EditorLinkHit,
} from '../../src/renderer/editor/link-decorations.js';
import { hideLinkHint, peekLinkHint } from '../../src/renderer/links/link-hint-store.js';

/**
 * 045 FR-040, FR-041 — the pointer gestures in an editor (T092): G1, G3 and G4 of
 * `contracts/menus-and-gestures.md` §3.
 *
 * ══ G4 IS THE ONE THAT DECIDES THE DESIGN ══
 *
 * Ctrl+click in a CodeMirror editor ALREADY means something: it adds a cursor. That is not a
 * behaviour this feature may quietly take away, and FR-041 says so — anywhere but over a link, the
 * gesture keeps the meaning it has today. So the handler claims the event only when the modifier is
 * held AND the position lands inside a resolved link, and returns false otherwise, at which point
 * CodeMirror's own multi-cursor handler runs and G4 holds by default rather than by imitation.
 *
 * ══ AND G3 IS WHY THE FOLLOW HAPPENS ON MOUSEUP ══
 *
 * FR-040: a Ctrl+click that DRAGS selects. Following on mousedown would make a drag that happens to
 * begin on a link open the file instead of selecting — so the press is claimed, the position is
 * remembered, and the release decides: a release where the press was is a click, and a release
 * anywhere else is a drag, which selects from one to the other. Claiming the press is what keeps
 * CodeMirror from adding a cursor under the drag; performing the selection ourselves is the price of
 * having claimed it.
 *
 * ══ THE MODIFIER IS NOT SPELLED `Ctrl` HERE ══
 *
 * FR-040's "Cmd on macOS" clause has exactly one home: the shipped binding for the Open Link
 * command. Writing `ctrlKey` into this handler would be a second place for the platform answer to
 * live, and the two would disagree the day macOS bindings are added.
 */

const DOC = 'see src/foo.ts here\nand nothing on this line\n';
const LINK_FROM = DOC.indexOf('src/foo.ts');
const LINK_TO = LINK_FROM + 'src/foo.ts'.length;

const resolved: ResolvedLink = {
  path: 'D:\\project\\src\\foo.ts',
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'none',
};

class FakeView {
  state = EditorState.create({ doc: DOC });
  readonly dispatched: TransactionSpec[] = [];
  readonly visibleRanges = [{ from: 0, to: DOC.length }];
  /** What `posAtCoords` answers next — jsdom measures nothing, so the position is supplied. */
  posAt: number | null = LINK_FROM + 2;
  /** What `coordsAtPos` answers next — `null` until a test sets it (the hint's release-point fallback). */
  coordsAt: { left: number; top: number; right: number; bottom: number } | null = null;

  dispatch(spec: TransactionSpec): void {
    this.dispatched.push(spec);
    this.state = this.state.update(spec).state;
  }

  posAtCoords(): number | null {
    return this.posAt;
  }

  coordsAtPos(): { left: number; top: number; right: number; bottom: number } | null {
    return this.coordsAt;
  }
}

function deps(): EditorLinkDeps & { followed: EditorLinkHit[] } {
  const followed: EditorLinkHit[] = [];
  return {
    followed,
    site: () => ({ panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: 'D:\\p' }),
    // T263: never consulted — an editor link is valid by grammar (FR-155).
    ask: vi.fn(
      (request: LinkResolutionRequest): LinkResolution | undefined =>
        request.text === 'src/foo.ts' ? { ok: true, link: resolved } : { ok: false },
    ),
    follow: (hit: EditorLinkHit) => followed.push(hit),
  } as EditorLinkDeps & { followed: EditorLinkHit[] };
}

const press = (over: Partial<MouseEvent> = {}): MouseEvent =>
  ({ button: 0, ctrlKey: true, metaKey: false, clientX: 100, clientY: 50, ...over }) as MouseEvent;

describe('G1 — Ctrl+click over a resolved link follows it (FR-040)', () => {
  it('claims the press and follows on the release', () => {
    const d = deps();
    const view = new FakeView();
    const handlers = createLinkPointerHandlers(d);

    expect(handlers.mousedown(press(), view)).toBe(true);
    expect(d.followed, 'nothing happens until the button comes back up').toEqual([]);

    handlers.mouseup(press(), view);

    expect(d.followed).toHaveLength(1);
    expect(d.followed[0]!.request.text).toBe('src/foo.ts');
  });

  it('adds no cursor and dispatches nothing for a plain click-through', () => {
    const d = deps();
    const view = new FakeView();
    const handlers = createLinkPointerHandlers(d);
    handlers.mousedown(press(), view);
    handlers.mouseup(press(), view);

    expect(view.dispatched).toEqual([]);
  });
});

describe('G4 — Ctrl+click anywhere else is unchanged (FR-041)', () => {
  it('does not claim the press when the position is outside every link', () => {
    const d = deps();
    const view = new FakeView();
    view.posAt = DOC.indexOf('and nothing');

    expect(createLinkPointerHandlers(d).mousedown(press(), view)).toBe(false);
    expect(d.followed).toEqual([]);
  });

  it('does not claim a press CodeMirror could not place at all', () => {
    const d = deps();
    const view = new FakeView();
    view.posAt = null;

    expect(createLinkPointerHandlers(d).mousedown(press(), view)).toBe(false);
  });
});

describe('G2 — a plain click keeps its ordinary meaning (FR-040)', () => {
  it('is not claimed and follows nothing, even over a link', () => {
    const d = deps();
    const handlers = createLinkPointerHandlers(d);
    const view = new FakeView();

    expect(handlers.mousedown(press({ ctrlKey: false }), view)).toBe(false);
    handlers.mouseup(press({ ctrlKey: false }), view);
    expect(d.followed).toEqual([]);
  });

  it('a right-click over a link is not a follow either — the menu is its own route', () => {
    const d = deps();
    expect(createLinkPointerHandlers(d).mousedown(press({ button: 2 }), new FakeView())).toBe(false);
  });
});

/*
 * 045 FR-165 (round four, T271) — a plain click ALSO shows the link hint, additively: neither
 * handler's return value changes (G2 above is unchanged byte for byte), so the caret is placed and
 * the selection/mouse-report meaning is kept exactly as it always was — the hint is a side effect on
 * top, never a substitute for it.
 */
describe('the plain click shows the link hint, without changing what the click itself does (FR-165)', () => {
  afterEach(() => {
    hideLinkHint();
  });

  it('a plain click over a link shows the hint and still keeps its ordinary meaning', () => {
    const d = deps();
    const handlers = createLinkPointerHandlers(d);
    const view = new FakeView();
    const plain = press({ ctrlKey: false });

    expect(handlers.mousedown(plain, view), 'the press is still unclaimed').toBe(false);
    expect(handlers.mouseup(plain, view), 'the release is still unclaimed').toBe(false);

    expect(d.followed, 'a plain click never follows').toEqual([]);
    expect(peekLinkHint()?.text).toBeTruthy();
  });

  it('names an active editor by default, in the same words the tooltip uses', () => {
    const d = deps();
    const handlers = createLinkPointerHandlers(d);
    const view = new FakeView();
    const plain = press({ ctrlKey: false });

    handlers.mousedown(plain, view);
    handlers.mouseup(plain, view);

    expect(peekLinkHint()?.text).toBe('Ctrl+Click to open in throng active editor');
  });

  /*
   * Maintainer correction (FR-165b, FR-165c): the hint anchors at the LINK's own end, not the release
   * point — `coordsAtPos(hit.to, -1)`, collapsed to its bottom-right corner, so the popover never
   * lands over the link's own text.
   */
  it("anchors the hint at the link's own end, not the release point", () => {
    const d = deps();
    const handlers = createLinkPointerHandlers(d);
    const view = new FakeView();
    view.coordsAt = { left: 200, top: 60, right: 210, bottom: 74 };
    const plain = press({ ctrlKey: false, clientX: 123, clientY: 45 });

    handlers.mousedown(plain, view);
    handlers.mouseup(plain, view);

    expect(peekLinkHint()?.anchor).toEqual({ left: 210, top: 74, right: 210, bottom: 74 });
  });

  it("anchors at the LAST row's bottom-right for a link that wraps across rows, not the click", () => {
    const d = deps();
    const handlers = createLinkPointerHandlers(d);
    const view = new FakeView();
    // The click lands on an earlier wrapped row; `coordsAtPos(hit.to, -1)` must still be read at the
    // link's END (its last row), which this rect — deliberately different from the click point — stands in for.
    view.coordsAt = { left: 5, top: 200, right: 40, bottom: 220 };
    const plain = press({ ctrlKey: false, clientX: 15, clientY: 55 });

    handlers.mousedown(plain, view);
    handlers.mouseup(plain, view);

    expect(peekLinkHint()?.anchor).toEqual({ left: 40, top: 220, right: 40, bottom: 220 });
  });

  it('falls back to the release point when the position cannot be measured at all', () => {
    const d = deps();
    const handlers = createLinkPointerHandlers(d);
    const view = new FakeView();
    view.coordsAt = null;
    const plain = press({ ctrlKey: false, clientX: 123, clientY: 45 });

    handlers.mousedown(plain, view);
    handlers.mouseup(plain, view);

    expect(peekLinkHint()?.anchor).toEqual({ left: 123, top: 45, right: 123, bottom: 45 });
  });

  it('shows nothing for a click that drags (FR-165e)', () => {
    const d = deps();
    const handlers = createLinkPointerHandlers(d);
    const view = new FakeView();

    handlers.mousedown(press({ ctrlKey: false }), view);
    view.posAt = LINK_TO + 4;
    handlers.mouseup(press({ ctrlKey: false, clientX: 260, clientY: 50 }), view);

    expect(peekLinkHint()).toBeNull();
  });

  it('shows nothing away from a link', () => {
    const d = deps();
    const handlers = createLinkPointerHandlers(d);
    const view = new FakeView();
    view.posAt = DOC.indexOf('and nothing');
    const plain = press({ ctrlKey: false });

    handlers.mousedown(plain, view);
    handlers.mouseup(plain, view);

    expect(peekLinkHint()).toBeNull();
  });

  it('never on Ctrl+click, and never on hover alone (FR-165e)', () => {
    const d = deps();
    const handlers = createLinkPointerHandlers(d);
    const view = new FakeView();

    handlers.mousedown(press(), view); // Ctrl held
    handlers.mouseup(press(), view);
    expect(peekLinkHint(), 'a Ctrl+click follows — it does not show the hint too').toBeNull();
  });
});

describe('G3 — a Ctrl+click that DRAGS selects (FR-040, Principle VI)', () => {
  it('selects from the press to the release instead of following', () => {
    const d = deps();
    const view = new FakeView();
    const handlers = createLinkPointerHandlers(d);

    handlers.mousedown(press(), view);
    view.posAt = LINK_TO + 4;
    handlers.mouseup(press({ clientX: 260, clientY: 50 }), view);

    expect(d.followed, 'a drag is a selection, never an activation').toEqual([]);
    expect(view.state.selection.main.from).toBe(LINK_FROM + 2);
    expect(view.state.selection.main.to).toBe(LINK_TO + 4);
  });

  it('a release a pixel or two away is still a click, not a drag', () => {
    const d = deps();
    const view = new FakeView();
    const handlers = createLinkPointerHandlers(d);

    handlers.mousedown(press(), view);
    handlers.mouseup(press({ clientX: 101, clientY: 51 }), view);

    expect(d.followed).toHaveLength(1);
  });

  it('a release with no press before it does nothing', () => {
    const d = deps();
    createLinkPointerHandlers(d).mouseup(press(), new FakeView());
    expect(d.followed).toEqual([]);
  });
});

describe('the modifier comes from the shipped binding, not from a literal (FR-040)', () => {
  it('reads the Open Link command’s own chord', () => {
    const shipped = shippedBindingsFor(DEFAULT_BINDING_PLATFORM).bindings['preview.followLink'];
    expect(shipped, 'the Open Link command must still ship a chord').toBeDefined();
    expect(linkModifierName()).toBe(linkModifierFromChord(shipped![0]!));
  });

  it('answers Meta for a Cmd-based chord, which is FR-040’s macOS clause', () => {
    expect(linkModifierFromChord('Meta+Enter')).toBe('Meta');
    expect(linkModifierFromChord('Ctrl+Enter')).toBe('Ctrl');
  });

  it('a Meta+click is not a follow while the shipped chord is Ctrl-based', () => {
    const d = deps();
    const claimed = createLinkPointerHandlers(d).mousedown(
      press({ ctrlKey: false, metaKey: true }),
      new FakeView(),
    );
    expect(claimed).toBe(linkModifierName() === 'Meta');
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * 045 T215 — D3: an editor Ctrl+click on a link's FIRST character missed it
 * (menus-and-gestures.md §8.2; FR-040, FR-100, FR-110)
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * What the user saw (O11, the probe's editor pass): 2 of 27 Ctrl+clicks on the first character of a
 * decorated link placed a caret instead of following it — `/c/Windows/win.ini` and the long
 * `…\en\Microsoft.PowerShell.DSC.FileDownloadManager.Resources.dll`, both at column 1 — while hover
 * showed a link and a hand pointer, and a Ctrl+click in the middle of the same link followed it.
 *
 * The two lines are the probe's. The long path is elided in the spec (`…\en\…`); it is written out
 * here as the file actually lies on Windows, which is the one the corpus names.
 *
 * Both are OUT-OF-PROJECT links (FR-110: shown in the OS file manager), and each is clicked cold and
 * immediately after a Ctrl+click on the previous line's link returned — the probe's order. The
 * assertion is the whole of §8.2: the press is claimed, the follow happens once, and no caret is
 * added (CodeMirror's add-a-cursor runs only on an UNCLAIMED press, so "claimed" is "no caret").
 */
const WIN_INI = '/c/Windows/win.ini';
const DSC_DLL =
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules\\PSDesiredStateConfiguration\\DownloadManager\\DSCFileDownloadManager\\en\\Microsoft.PowerShell.DSC.FileDownloadManager.Resources.dll';
const D3_DOC = `${WIN_INI}\n${DSC_DLL}\n`;

const OUT_OF_PROJECT: Record<string, ResolvedLink> = {
  [WIN_INI]: { path: 'C:\\Windows\\win.ini', kind: 'file', inProject: false, executable: false, preview: 'none' },
  [DSC_DLL]: { path: DSC_DLL, kind: 'file', inProject: false, executable: false, preview: 'none' },
};

class D3View extends FakeView {
  override state = EditorState.create({ doc: D3_DOC });
  override readonly visibleRanges = [{ from: 0, to: D3_DOC.length }];
}

function d3Deps(): EditorLinkDeps & { followed: EditorLinkHit[] } {
  const followed: EditorLinkHit[] = [];
  return {
    followed,
    site: () => ({ panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: 'D:\\p' }),
    // T263: never consulted — the spans are the grammar's (FR-155).
    ask: (request: LinkResolutionRequest): LinkResolution | undefined => {
      const link = OUT_OF_PROJECT[request.text];
      return link === undefined ? { ok: false } : { ok: true, link };
    },
    follow: (hit: EditorLinkHit) => followed.push(hit),
  } as EditorLinkDeps & { followed: EditorLinkHit[] };
}

const lineStart = (view: FakeView, n: number): number => view.state.doc.line(n).from;

describe('T215 / D3 — Ctrl+click on the FIRST character of a decorated link follows it', () => {
  it('the decoration and the hit-test agree on where each span starts (column 1)', () => {
    const view = new D3View();
    const deps = d3Deps();
    // What the decoration draws…
    const drawn = linkHitsBetween(view.state, 0, D3_DOC.length, deps).map((h) => [h.from, h.to]);
    expect(drawn).toEqual([
      [lineStart(view, 1), lineStart(view, 1) + WIN_INI.length],
      [lineStart(view, 2), lineStart(view, 2) + DSC_DLL.length],
    ]);
    // …is what a press at its first character hits.
    for (const n of [1, 2]) {
      expect(linkAtPosition(view.state, lineStart(view, n), deps)?.from, `line ${n}`).toBe(lineStart(view, n));
    }
  });

  for (const [n, text] of [[1, WIN_INI], [2, DSC_DLL]] as const) {
    it(`cold: ${n === 1 ? WIN_INI : '…Resources.dll'} — claimed, followed once, no caret`, () => {
      const deps = d3Deps();
      const view = new D3View();
      const handlers = createLinkPointerHandlers(deps);
      view.posAt = lineStart(view, n);

      expect(handlers.mousedown(press(), view), 'claimed — CodeMirror adds no cursor').toBe(true);
      handlers.mouseup(press(), view);

      expect(deps.followed).toHaveLength(1);
      expect(deps.followed[0]!.request.text).toBe(text);
      expect(view.dispatched, 'no selection or caret change').toEqual([]);
      expect(view.state.selection.ranges).toHaveLength(1);
    });
  }

  it('immediately after a Ctrl+click on the previous line\u2019s link returned — the probe\u2019s order', () => {
    const deps = d3Deps();
    const view = new D3View();
    const handlers = createLinkPointerHandlers(deps);

    // Line 1, first character: follow.
    view.posAt = lineStart(view, 1);
    expect(handlers.mousedown(press(), view)).toBe(true);
    handlers.mouseup(press(), view);
    // …and straight on to line 2's first character, one row down.
    view.posAt = lineStart(view, 2);
    expect(handlers.mousedown(press({ clientY: 70 }), view), 'claimed — CodeMirror adds no cursor').toBe(true);
    handlers.mouseup(press({ clientY: 70 }), view);

    expect(deps.followed.map((h) => h.request.text)).toEqual([WIN_INI, DSC_DLL]);
    expect(view.dispatched).toEqual([]);
    expect(view.state.selection.ranges).toHaveLength(1);
  });

  it('and the reverse order, line 2 then line 1', () => {
    const deps = d3Deps();
    const view = new D3View();
    const handlers = createLinkPointerHandlers(deps);

    view.posAt = lineStart(view, 2);
    handlers.mousedown(press({ clientY: 70 }), view);
    handlers.mouseup(press({ clientY: 70 }), view);
    view.posAt = lineStart(view, 1);
    expect(handlers.mousedown(press(), view)).toBe(true);
    handlers.mouseup(press(), view);

    expect(deps.followed.map((h) => h.request.text)).toEqual([DSC_DLL, WIN_INI]);
    expect(view.dispatched).toEqual([]);
  });
});

/*
 * T215, continued — D3's confirmed cause was a cache entry that outlived the cache's lifetime while
 * nothing redrew the view: the decoration still showed the span, the press asked again, heard "not a
 * link", and CodeMirror added a caret. Round four (T263, T265; FR-155, R32) has no cache and no answer
 * to outlive — the decoration and the hit-test both read the grammar — so the property is pinned with
 * NO answer anywhere: a bridge that never resolves anything, and a first-character press.
 */
describe('T215 / D3 — with no answer anywhere, a first-character Ctrl+click is claimed and followed', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      ...globalThis.window,
      throng: { links: { resolve: () => new Promise<LinkResolution>(() => {}) } },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a first-character Ctrl+click on a link the view shows follows it — never a caret', () => {
    const followed: EditorLinkHit[] = [];
    const deps: EditorLinkDeps = {
      site: () => ({ panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: 'D:\\p' }),
      follow: (hit) => void followed.push(hit as EditorLinkHit),
    };
    const view = new D3View();
    const handlers = createLinkPointerHandlers(deps);
    expect(linkHitsBetween(view.state, 0, D3_DOC.length, deps), 'both links are drawn').toHaveLength(2);

    view.posAt = lineStart(view, 1);
    const claimed = handlers.mousedown(press(), view);
    handlers.mouseup(press(), view);

    expect(claimed, '§8.2: the press over a drawn link is claimed, so CodeMirror adds no caret').toBe(true);
    expect(followed.map((h) => h.request.text)).toEqual([WIN_INI]);
  });
});
