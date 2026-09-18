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
import {
  __resetLinkCacheForTests,
  LINK_CACHE_TTL_MS,
  peekLink,
  requestLink,
} from '../../src/renderer/links/link-cache.js';

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

  dispatch(spec: TransactionSpec): void {
    this.dispatched.push(spec);
    this.state = this.state.update(spec).state;
  }

  posAtCoords(): number | null {
    return this.posAt;
  }
}

function deps(): EditorLinkDeps & { followed: EditorLinkHit[] } {
  const followed: EditorLinkHit[] = [];
  return {
    followed,
    site: () => ({ panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: 'D:\\p' }),
    ask: vi.fn(
      (request: LinkResolutionRequest): LinkResolution | undefined =>
        request.text === 'src/foo.ts' ? { ok: true, link: resolved } : { ok: false },
    ),
    follow: (hit) => followed.push(hit),
  };
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
    expect(d.followed[0]!.link.path).toBe(resolved.path);
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
    ask: (request: LinkResolutionRequest): LinkResolution | undefined => {
      const link = OUT_OF_PROJECT[request.text];
      return link === undefined ? { ok: false } : { ok: true, link };
    },
    follow: (hit) => followed.push(hit),
  };
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
 * T215, continued — the same gesture over the REAL renderer link cache, as `use-editor.ts` wires it
 * (`askEditorLink` = `peekLink`, then `requestLink` on a miss).
 *
 * Every case above passes: with an `ask` that always answers, the hit-test and the decoration agree
 * at column 1, cold or straight after the previous row. So the boundary hypothesis (§8.2's first)
 * does not reproduce here, and the condition D3 needs is something the synchronous `ask` hides.
 *
 * ══ A HYPOTHESIS, NOT A FINDING — for the maintainer to confirm or reject ══
 *
 * The one state in which the decoration and the handler read DIFFERENT answers is a cache entry that
 * has outlived `LINK_CACHE_TTL_MS` while nothing redrew the view. The decoration still shows the span
 * (it is rebuilt only on a transaction or a cache notification); the mousedown asks again, `peekLink`
 * drops the stale entry and answers `undefined` — "not a link" — so the press is not claimed and
 * CodeMirror adds a caret. That same miss fires a fresh request, so by the next press the answer is
 * back: a second Ctrl+click on the same link follows. The probe clicked the first character FIRST on
 * each row, which would give exactly what it recorded — the first-character click missed and a
 * mid-link click on the same link followed — and only on rows whose entry had expired unredrawn, which
 * would explain 2 of 27 rather than every one. Nothing here is specific to the first character; the
 * probe's order is what would make it look so.
 */
describe('T215 / D3 — over the real link cache, after the answer outlives its TTL unredrawn', () => {
  beforeEach(() => {
    __resetLinkCacheForTests();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-18T12:00:00Z'));
    vi.stubGlobal('window', {
      ...globalThis.window,
      throng: {
        links: {
          resolve: async (request: LinkResolutionRequest): Promise<LinkResolution> => {
            const link = OUT_OF_PROJECT[request.text];
            return link === undefined ? { ok: false } : { ok: true, link };
          },
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    __resetLinkCacheForTests();
  });

  const cachedDeps = (): EditorLinkDeps & { followed: EditorLinkHit[] } => {
    const followed: EditorLinkHit[] = [];
    return {
      followed,
      site: () => ({ panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: 'D:\\p' }),
      ask: (request) => {
        const cached = peekLink(request);
        if (cached === undefined) requestLink(request);
        return cached;
      },
      follow: (hit) => followed.push(hit),
    };
  };

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  };

  it('a first-character Ctrl+click on a link the view still shows follows it — never a caret', async () => {
    const deps = cachedDeps();
    const view = new D3View();
    const handlers = createLinkPointerHandlers(deps);

    // The view draws its decorations: the first build asks, the answers land, the rebuild draws.
    linkHitsBetween(view.state, 0, D3_DOC.length, deps);
    await settle();
    expect(linkHitsBetween(view.state, 0, D3_DOC.length, deps), 'both links are drawn').toHaveLength(2);

    // Time passes with the view untouched — no transaction, so nothing rebuilds the decorations.
    vi.setSystemTime(Date.now() + LINK_CACHE_TTL_MS + 1);

    // Ctrl+click the FIRST character of the link the user can see underlined.
    view.posAt = lineStart(view, 1);
    const claimed = handlers.mousedown(press(), view);
    handlers.mouseup(press(), view);

    expect(claimed, '§8.2: the press over a drawn link is claimed, so CodeMirror adds no caret').toBe(true);
    expect(deps.followed.map((h) => h.request.text)).toEqual([WIN_INI]);
  });
});
