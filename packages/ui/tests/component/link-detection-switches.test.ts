import { beforeEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { LinkResolution, LinkResolutionRequest, ResolvedLink } from '@throng/core';
import { createFileLinkProvider } from '../../src/renderer/terminal/file-link-provider.js';
import {
  activateTerminalHyperlink,
  hoveredLinkFromUri,
  type TerminalLinkSite,
} from '../../src/renderer/terminal/terminal-link-activation.js';
import type { HoveredLink } from '../../src/renderer/terminal/hovered-link.js';
import {
  buildLinkDecorations,
  createLinkPointerHandlers,
  editorLinkExtension,
  followLinkAtCaret,
  linkAtPosition,
  linkHitsBetween,
  type EditorLinkAt,
  type EditorLinkDeps,
} from '../../src/renderer/editor/link-decorations.js';
import { terminalViewScan } from '../../src/renderer/terminal/link-view-marks.js';

/**
 * 045 T112, FR-060 / SC-008 — the two detection switches, and **exactly** what each one stops.
 *
 * ══ ROUND FIVE: BOTH SWITCHES GOVERN EVERY KIND OF LINK ══
 *
 * They used to gate the GUESS alone, so a web url, an allowlisted `mailto:` and a program's own OSC 8
 * hyperlink all went on working with detection off. The maintainer's rule is the one the setting
 * reads like: **enabled, every kind of link is shown; disabled, no links are shown on that surface.**
 *
 * So the section that used to be headed "a switch never touches an explicit hyperlink" is inverted
 * below, for both surfaces. It is worth keeping the cases rather than deleting them: they are the
 * ones that say what the setting DOES, and the inversion is the whole of the change.
 *
 * In the terminal the gate is the first line of `linksOnLine` (`file-link-provider.ts`) and the same
 * answer in `terminalViewScan`; `use-terminal.ts` applies it to the three OSC 8 seams neither of
 * those can see — xterm's hyperlink hover, its activation, and the OSC 8 ranges the marks pass reads.
 * The last three need an xterm, so they are covered by the E2E specs rather than from here.
 *
 * ══ AND OFF MEANS THE GESTURES GO BACK TO WHAT THEY WERE ══
 *
 * In an editor Ctrl+click adds a cursor and Ctrl+Enter inserts a blank line. Those are the meanings
 * FR-041 and FR-044 protect everywhere OUTSIDE a link; with detection off there are no links, so
 * they must hold everywhere, full stop. A gate that only stopped the underline would leave a click
 * following a link the user can no longer see.
 *
 * ══ LIVE, BOTH WAYS ══
 *
 * The switches are read through a reader on deps that are built once, for the same reason the
 * default link action is: a terminal's link provider is registered at mount against a live shell,
 * and an editor's handlers are installed on a live view. Every case below flips the switch on the
 * SAME provider and the SAME deps that were built before it moved.
 */

const ROOT = 'D:\\p';

const resolved: ResolvedLink = {
  path: `${ROOT}\\src\\foo.ts`,
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'none',
};

const answer = (): LinkResolution => ({ ok: true, link: resolved });

const SITE: TerminalLinkSite = {
  panelId: 'panel-1',
  originProjectId: 'project-1',
  baseDirectory: ROOT,
};

const ROW = 'built src/foo.ts and https://example.com/x';

/** The terminal switch, as a value the reader below closes over. */
let detectInTerminals = true;
/** The editor switch, likewise. */
let detectInEditors = true;

const osCalls: string[] = [];

beforeEach(() => {
  detectInTerminals = true;
  detectInEditors = true;
  osCalls.length = 0;
  (window as unknown as { throng: unknown }).throng = {
    openExternal: (url: string) => void osCalls.push(`external:${url}`),
    // 045 T291: web and allowlisted protocol links leave by `throng:linkUri:openExternal`.
    linkUri: {
      openExternal: (url: string) => void osCalls.push(`linkUri:${url}`),
      refusedSchemes: () => Promise.resolve([]),
    },
    links: {
      reveal: (request: LinkResolutionRequest) => {
        osCalls.push(`osExplorer:${request.text}`);
        return Promise.resolve({ ok: true as const });
      },
      open: (request: LinkResolutionRequest) => {
        osCalls.push(`osDefaultProgram:${request.text}`);
        return Promise.resolve({ ok: true as const });
      },
    },
  };
});

/* ── The terminal ──────────────────────────────────────────────────────────────────────────── */

interface ProvidedLink {
  readonly text: string;
  activate(event: MouseEvent, text: string): void;
  hover(event: MouseEvent, text: string): void;
}

function terminalProvider(): {
  links(): ProvidedLink[];
  readonly hovered: (HoveredLink | null)[];
  readonly followed: LinkResolutionRequest[];
} {
  const hovered: (HoveredLink | null)[] = [];
  const followed: LinkResolutionRequest[] = [];
  const provider = createFileLinkProvider({
    terminal: { buffer: { active: { getLine: () => ({ translateToString: () => ROW }) } } },
    detect: () => detectInTerminals,
    site: () => SITE,
    ask: answer,
    onHover: (h) => void hovered.push(h),
    follow: ({ request }) => void followed.push(request),
  });
  return {
    hovered,
    followed,
    links() {
      let out: ProvidedLink[] = [];
      provider.provideLinks(1, (provided) => {
        // The path half specifically — the row's url is asserted by its own cases below, because
        // round five made the switch govern it too and the two answers must be seen separately.
        out = (provided ?? []).filter((l) => l.kind === 'file') as ProvidedLink[];
      });
      return out;
    },
  };
}

describe('FR-060 — `detectInTerminals` off: a detected path stops being a link', () => {
  it('nothing is drawn, so there is nothing to underline or click', () => {
    const t = terminalProvider();
    expect(t.links(), 'on: the path is a link').toHaveLength(1);

    detectInTerminals = false;
    expect(t.links(), 'off: no link at all').toEqual([]);
    expect(t.hovered, 'and nothing was ever hovered, so the menu has no file-link items').toEqual([]);
    expect(t.followed).toEqual([]);
  });

  it('and back on again without the provider being re-registered', () => {
    const t = terminalProvider();
    detectInTerminals = false;
    expect(t.links()).toEqual([]);
    detectInTerminals = true;
    expect(t.links(), 'the switch is read per call, so the next hover works').toHaveLength(1);
  });

  it('a Ctrl+click over where the path WAS does nothing', () => {
    const t = terminalProvider();
    const link = t.links()[0]!;
    detectInTerminals = false;
    // xterm asks for the row again before it dispatches; with no link there is nothing to activate.
    expect(t.links()).toEqual([]);
    // Even the stale handle, held from before the switch moved, follows nothing new.
    expect(t.followed).toEqual([]);
    expect(link.text).toBe('src/foo.ts');
  });
});

describe('FR-060 (round five) — and a WEB url on the same row goes with it', () => {
  const textsOnRow = (row: string): string[] => {
    const provider = createFileLinkProvider({
      terminal: { buffer: { active: { getLine: () => ({ translateToString: () => row }) } } },
      detect: () => detectInTerminals,
      site: () => SITE,
      ask: answer,
      onHover: () => {},
      follow: () => {},
    });
    let texts: string[] = [];
    provider.provideLinks(1, (provided) => {
      texts = (provided ?? []).map((l) => l.text);
    });
    return texts;
  };

  it('on: the url and the path are both served by this one provider (T177)', () => {
    expect(textsOnRow(ROW).sort()).toEqual(['https://example.com/x', 'src/foo.ts'].sort());
  });

  it('off: the row has no links at all — not the path, and not the url either', () => {
    detectInTerminals = false;
    expect(textsOnRow(ROW)).toEqual([]);
  });

  /*
   * The OSC 8 half of the terminal's switch is NOT here, and that is deliberate rather than an
   * omission. `hoveredLinkFromUri` and `activateTerminalHyperlink` are pure functions of a target and
   * a site — they judge what a URI MEANS (FR-163), which the setting does not change. What the
   * setting changes is whether this terminal asks them at all, and those three seams
   * (`setHoveredUri`, `openTerminalLink`, `oscLinksInView`) live inside the mount effect against a
   * real xterm. Their cases are in `terminal-link-once.e2e.ts`.
   *
   * The two below therefore assert what remains TRUE: the pure gate still answers by class alone, so
   * nothing about a target's meaning moved when the switch's scope did.
   */
  it('a `file:` target still MEANS a file link — the switch is not a scheme rule', () => {
    const hovered = hoveredLinkFromUri('file:///D:/p/src/foo.ts', SITE);
    expect(hovered?.kind).toBe('file');
  });

  // *Round four (T291):* asserted `external:` — the general `throng:openExternal` channel. Web and
  // protocol follows now leave by `throng:linkUri:openExternal` (plan round four, twelfth pass).
  it('and a web target still leaves by the OS url seam when it is followed at all', () => {
    void activateTerminalHyperlink({
      event: { ctrlKey: true, metaKey: false },
      uri: 'https://example.com/x',
      site: SITE,
      deps: { openInEditor: () => {}, openInPreview: () => {}, reportFailure: () => {} },
    });
    expect(osCalls).toEqual(['linkUri:https://example.com/x']);
    expect(hoveredLinkFromUri('https://example.com/x', SITE, answer)).toEqual({
      kind: 'web',
      uri: 'https://example.com/x',
    });
  });
});

/*
 * 045 T291 — FR-060a said an allowlisted protocol link was not governed by the detection switch, so
 * a `mailto:` stayed marked and followable with detection off while a path did not. **Round five
 * supersedes that on both surfaces:** the switch is about links, not about guesses, so an
 * allowlisted protocol link goes with everything else. (The plain-click hint half is T271's.)
 */
const MAILTO_ROW = 'built src/foo.ts, mail mailto:a@b.c now';

describe('FR-060 (round five) — `detectInTerminals` off: the allowlisted protocol link goes too', () => {
  const providerOnMailtoRow = (opened: string[]): ReturnType<typeof createFileLinkProvider> =>
    createFileLinkProvider({
      terminal: { buffer: { active: { getLine: () => ({ translateToString: () => MAILTO_ROW }) } } },
      detect: () => detectInTerminals,
      site: () => SITE,
      ask: answer,
      onHover: () => {},
      follow: () => {},
      openWeb: (_event, uri) => void opened.push(uri),
    });

  it('on: both are served, and a Ctrl+click follows the protocol link through the URI route', () => {
    const opened: string[] = [];
    let provided: { text: string; activate(event: MouseEvent, text: string): void }[] = [];
    providerOnMailtoRow(opened).provideLinks(1, (links) => {
      provided = links ?? [];
    });
    expect(provided.map((l) => l.text).sort()).toEqual(['mailto:a@b.c', 'src/foo.ts'].sort());
    provided.find((l) => l.text === 'mailto:a@b.c')!.activate(
      { ctrlKey: true, metaKey: false } as MouseEvent,
      'mailto:a@b.c',
    );
    expect(opened).toEqual(['mailto:a@b.c']);
  });

  it('off: the provider serves nothing, so there is nothing to Ctrl+click', () => {
    detectInTerminals = false;
    const opened: string[] = [];
    let provided: { text: string }[] = [];
    providerOnMailtoRow(opened).provideLinks(1, (links) => {
      provided = links ?? [];
    });
    expect(provided).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('and the view pass marks nothing either — not the path, the url or the protocol link', () => {
    // It does not even READ the settings with the switch off: there is no line to scan, so the
    // reader below must never be called. (The ON direction is the provider's cases above.)
    let read = 0;
    const links = () => {
      read += 1;
      return { protocolAllowlist: ['mailto', 'tel', 'slack'], knownFileExtensions: [] };
    };
    const off = terminalViewScan({ links, detect: () => false })(MAILTO_ROW);
    expect(off).toEqual({ web: [], protocol: [], paths: [] });
    expect(read).toBe(0);
  });
});

/*
 * Round five (maintainer correction over T291's FR-060a reading above): in an EDITOR the switch gates
 * EVERY link kind, not guessed paths alone. Enabled shows the path and the protocol link alike;
 * disabled draws neither, so there is nothing to mark, follow or offer in the menu for either one.
 */
describe('FR-060 (round five) — `detectInEditors` off: every link kind is gone, the protocol link included', () => {
  const MAIL_DOC = 'see src/foo.ts or mailto:a@b.c here\n';
  const MAIL_AT = MAIL_DOC.indexOf('mailto:') + 3;
  const view = {
    state: EditorState.create({ doc: MAIL_DOC, selection: { anchor: MAIL_AT } }),
    visibleRanges: [{ from: 0, to: MAIL_DOC.length }],
  };

  it('neither the path nor the protocol link is marked, followed or offered', () => {
    detectInEditors = false;
    const deps = editorDeps();
    expect(linkHitsBetween(view.state, 0, MAIL_DOC.length, deps)).toEqual([]);
    expect(buildLinkDecorations(view, deps).size).toBe(0);
    expect(followLinkAtCaret(view, deps), 'off: Ctrl+Enter is not claimed for the mailto link either').toBe(false);
    expect(deps.followed).toEqual([]);
  });

  it('and back on again, live, brings both kinds back', () => {
    detectInEditors = false;
    const deps = editorDeps();
    expect(linkHitsBetween(view.state, 0, MAIL_DOC.length, deps)).toEqual([]);

    detectInEditors = true;
    const hits = linkHitsBetween(view.state, 0, MAIL_DOC.length, deps);
    expect(hits.map((h) => MAIL_DOC.slice(h.from, h.to)).sort()).toEqual(['mailto:a@b.c', 'src/foo.ts'].sort());
    expect(followLinkAtCaret(view, deps)).toBe(true);
    expect(deps.followed).toMatchObject([{ uri: 'mailto:a@b.c' }]);
  });
});

/* ── The editor ────────────────────────────────────────────────────────────────────────────── */

const DOC = 'see src/foo.ts here\n';
const LINK_AT = DOC.indexOf('src/foo.ts') + 2;

function editorDeps(): EditorLinkDeps & { readonly followed: EditorLinkAt[] } {
  const followed: EditorLinkAt[] = [];
  return {
    followed,
    detect: () => detectInEditors,
    site: () => ({ panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: ROOT }),
    ask: answer,
    follow: (hit) => void followed.push(hit),
  };
}

const scanView = (anchor = LINK_AT): {
  state: EditorState;
  visibleRanges: { from: number; to: number }[];
  posAtCoords(): number | null;
  dispatch(): void;
} => ({
  state: EditorState.create({ doc: DOC, selection: { anchor } }),
  visibleRanges: [{ from: 0, to: DOC.length }],
  posAtCoords: () => LINK_AT,
  dispatch: () => {},
});

describe('FR-060 — `detectInEditors` off: the same, in a document', () => {
  it('no decoration is built', () => {
    const deps = editorDeps();
    expect(buildLinkDecorations(scanView(), deps).size, 'on: one mark').toBe(1);
    detectInEditors = false;
    expect(buildLinkDecorations(scanView(), deps).size, 'off: none').toBe(0);
  });

  it('the compartment’s off position holds NOTHING, rather than a disabled plugin', () => {
    expect(editorLinkExtension(null)).toEqual([]);
  });

  it('Ctrl+click keeps its ordinary meaning — it is not even claimed', () => {
    const deps = editorDeps();
    const handlers = createLinkPointerHandlers(deps);
    const press = { button: 0, ctrlKey: true, metaKey: false, clientX: 10, clientY: 10 } as MouseEvent;
    expect(handlers.mousedown(press, scanView()), 'on: claimed').toBe(true);

    detectInEditors = false;
    // The SAME handlers the view was built with — nothing is reinstalled when the switch moves.
    expect(
      handlers.mousedown(press, scanView()),
      'off: CodeMirror adds a cursor as it always did',
    ).toBe(false);
    handlers.mouseup(press, scanView());
    expect(deps.followed, 'and nothing was followed').toEqual([]);
  });

  it('Ctrl+Enter keeps its ordinary meaning — the key is not claimed', () => {
    const deps = editorDeps();
    expect(followLinkAtCaret(scanView(), deps), 'on: claimed').toBe(true);
    detectInEditors = false;
    expect(followLinkAtCaret(scanView(), deps), 'off: CodeMirror inserts a blank line').toBe(false);
  });

  it('the menu has no link to offer, because there is no link under the caret', () => {
    const deps = editorDeps();
    expect(linkAtPosition(scanView().state, LINK_AT, deps)).not.toBeNull();
    detectInEditors = false;
    expect(linkAtPosition(scanView().state, LINK_AT, deps)).toBeNull();
  });

  it('and back on again, on the deps the view was built with', () => {
    const deps = editorDeps();
    detectInEditors = false;
    expect(followLinkAtCaret(scanView(), deps)).toBe(false);
    detectInEditors = true;
    expect(followLinkAtCaret(scanView(), deps), 'live, with nothing remounted').toBe(true);
  });
});
