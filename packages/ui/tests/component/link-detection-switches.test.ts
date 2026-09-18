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
  type EditorLinkDeps,
  type EditorLinkHit,
} from '../../src/renderer/editor/link-decorations.js';

/**
 * 045 T112, FR-060 / SC-008 — the two detection switches, and **exactly** what each one stops.
 *
 * ══ A SWITCH NEVER TOUCHES AN EXPLICIT HYPERLINK ══
 *
 * This is the half that is easy to get wrong, and the one a user would notice. `detectInTerminals`
 * governs throng's guess that a run of characters is a path. It says nothing about a link a PROGRAM
 * declared — an OSC 8 target, or an `http(s)` url — because that is not a guess and turning the
 * guessing off is no reason to stop honouring it. So the gate sits on `provideLinks`, which is the
 * only place the guess happens, and nothing else in the terminal changes.
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
        // T177: the row's url is served by this provider too now, and FR-060 leaves it working —
        // only the DETECTED path is this switch's subject, so only file links are counted here.
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

describe('FR-060 — and an EXPLICIT hyperlink is untouched by it', () => {
  it('a web url on the same row is still drawn with detection off (T177: this provider serves it)', () => {
    detectInTerminals = false;
    const provider = createFileLinkProvider({
      terminal: { buffer: { active: { getLine: () => ({ translateToString: () => ROW }) } } },
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
    expect(texts).toEqual(['https://example.com/x']);
  });

  it('a `file:` OSC 8 target still resolves and still underlines', () => {
    detectInTerminals = false;
    const hovered = hoveredLinkFromUri('file:///D:/p/src/foo.ts', SITE, answer);
    expect(hovered?.kind).toBe('file');
  });

  it('a `file:` OSC 8 target is still followable on Ctrl+click', async () => {
    detectInTerminals = false;
    const followed: LinkResolutionRequest[] = [];
    await activateTerminalHyperlink({
      event: { ctrlKey: true, metaKey: false },
      uri: 'file:///D:/p/src/foo.ts',
      site: SITE,
      deps: {
        openInEditor: () => void followed.push({ text: 'editor' } as LinkResolutionRequest),
        openInPreview: () => {},
        reportFailure: () => {},
      },
    });
    // The cache has no answer in this test, so nothing opens — but the ROUTE was taken, which is
    // what the switch must not have closed. `hoveredLinkFromUri` above is the observable half.
    expect(osCalls, 'no web route was taken for a file: target').toEqual([]);
  });

  it('a web link still opens through the OS url seam', () => {
    detectInTerminals = false;
    void activateTerminalHyperlink({
      event: { ctrlKey: true, metaKey: false },
      uri: 'https://example.com/x',
      site: SITE,
      deps: { openInEditor: () => {}, openInPreview: () => {}, reportFailure: () => {} },
    });
    expect(osCalls).toEqual(['external:https://example.com/x']);
    expect(hoveredLinkFromUri('https://example.com/x', SITE, answer)).toEqual({
      kind: 'web',
      uri: 'https://example.com/x',
    });
  });
});

/* ── The editor ────────────────────────────────────────────────────────────────────────────── */

const DOC = 'see src/foo.ts here\n';
const LINK_AT = DOC.indexOf('src/foo.ts') + 2;

function editorDeps(): EditorLinkDeps & { readonly followed: EditorLinkHit[] } {
  const followed: EditorLinkHit[] = [];
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
