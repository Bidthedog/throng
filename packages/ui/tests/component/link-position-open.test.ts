import { waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import type { LinkPosition, LinkResolution, LinkResolutionRequest, Panel, ResolvedLink } from '@throng/core';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import { TerminalPanel } from '../../src/renderer/terminal/terminal-panel.js';
import { createFileLinkProvider, type ProvidedLink } from '../../src/renderer/terminal/file-link-provider.js';
import { followLink, type LinkFollowDeps } from '../../src/renderer/links/link-actions.js';
import { followLinkInPanel } from '../../src/renderer/editor/link-decorations.js';
import { __resetLinkCacheForTests } from '../../src/renderer/links/link-cache.js';

/**
 * 045 T174 — REPRODUCTION of D2: a position suffix is not honoured (FR-004, FR-033, FR-052, FR-110,
 * SC-016; spec.md *A link's position*).
 *
 * ══ WHAT THE MAINTAINER SAW ══
 *
 * Ctrl+click `test.md:3:5` — the corpus line, exactly — and `test.md` opens with the caret at 1:1, not
 * at line 3, column 5. The third-round probe located it in TERMINALS only: in an editor the same text
 * lands on 3:5. And with `test.md` already open in a tab, the terminal follow changed nothing visible.
 *
 * ══ WHY THIS LAYER ══
 *
 * Every half of the route is reachable in jsdom, and nothing about it needs a window, OS focus or a
 * real shell: the terminal's link provider is a pure function over a fake buffer; the terminal
 * PANEL'S performers (`openInEditor`, where the probe says the position is dropped —
 * `terminal-panel.tsx:271`) are built in its render, so the panel is rendered for real with only
 * `useTerminal` stubbed (it would mount xterm and attach a shell, neither of which is the subject);
 * and the editor that receives the open is a REAL CodeMirror view behind `mount-editor.ts`'s fake
 * document authority, so "the caret is at 3:5" is read from the live `EditorState`, not inferred.
 * The editor-side follow goes through the editor's own registered deps (`followLinkInPanel`), which
 * is the Open Link chord's route.
 *
 * ══ THE MATRIX ══
 *
 * `test.md` with the Markdown provider enabled and its default open action **Preview** (FR-052: a
 * position sends it to an EDITOR anyway), the same file with **Editor**, and a `.ts` control — each
 * with the file NOT yet open, and ALREADY open in the tab. From a terminal and from an editor.
 */

const ROOT = 'C:/proj';
const TEST_MD = `${ROOT}/test.md`;
const FOO_TS = `${ROOT}/src/foo.ts`;
const NOTES = `${ROOT}/notes.txt`;

/** Five lines; line 3 is long enough for column 5 to be a real place in it. */
const MD_TEXT = '# Title\n\nabcdefgh line three\nfour\nfive\n';
const TS_TEXT = 'const a = 1;\n\nexport function three() {}\nconst four = 4;\nconst five = 5;\n';

type Case = {
  readonly name: string;
  readonly path: string;
  readonly text: string;
  /** The corpus line as printed, and the file-name half of it as detection splits it. */
  readonly line: string;
  readonly written: string;
  readonly defaultOpenAction: 'preview' | 'editor';
  readonly preview: ResolvedLink['preview'];
};

const CASES: readonly Case[] = [
  {
    name: 'test.md, provider enabled, default open action Preview',
    path: TEST_MD,
    text: MD_TEXT,
    line: 'see test.md:3:5 here',
    written: 'test.md',
    defaultOpenAction: 'preview',
    preview: 'enabled',
  },
  {
    name: 'test.md, default open action Editor',
    path: TEST_MD,
    text: MD_TEXT,
    line: 'see test.md:3:5 here',
    written: 'test.md',
    defaultOpenAction: 'editor',
    preview: 'enabled',
  },
  {
    name: 'src/foo.ts (control)',
    path: FOO_TS,
    text: TS_TEXT,
    line: 'see src/foo.ts:3:5 here',
    written: 'src/foo.ts',
    defaultOpenAction: 'editor',
    preview: 'none',
  },
];

const resolvedFor = (c: Case): ResolvedLink => ({
  path: c.path,
  kind: 'file',
  inProject: true,
  executable: false,
  preview: c.preview,
});

/** What `useTerminal` was handed by the rendered TerminalPanel — its performers live in `linkActions`. */
const captured = vi.hoisted(() => ({ terminal: null as null | { linkActions?: unknown } }));

vi.mock('../../src/renderer/terminal/use-terminal.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminal: (opts: { linkActions?: unknown }) => {
    captured.terminal = opts;
  },
}));

vi.mock('../../src/renderer/terminal/use-terminal-reconnect.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminalReconnect: () => {},
}));

let harness: EditorHarness | undefined;

beforeEach(() => {
  captured.terminal = null;
  __resetLinkCacheForTests();
});

afterEach(() => {
  harness?.unmount();
  harness = undefined;
  __resetLinkCacheForTests();
  Reflect.deleteProperty(window, 'throng');
  document.body.replaceChildren();
});

/** 1-based line and column of the main caret, read from the live document. */
function caret(view: EditorView): { path?: string; line: number; column: number } {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  return { line: line.number, column: head - line.from + 1 };
}

function settingsFor(c: Case): Record<string, unknown> {
  return {
    editor: {
      previews: { providers: { markdown: { enabled: true, defaultOpenAction: c.defaultOpenAction } } },
    },
  };
}

/** The `throng.links` bridge: main's answer for the one link this case is about. */
function linksBridge(c: Case) {
  return {
    resolve: async (request: LinkResolutionRequest): Promise<LinkResolution> =>
      request.text === c.written ? { ok: true, link: resolvedFor(c) } : { ok: false },
    reveal: async () => ({ ok: true as const }),
    open: async () => ({ ok: true as const }),
  };
}

/**
 * Mount the editor panel `p-ed` holding `start`, with a real TerminalPanel beside it in the same
 * workspace tree. `alreadyOpen` makes main's one-buffer oracle answer "that file is open in p-ed".
 */
async function mountBoth(
  c: Case,
  start: { absPath: string; text: string },
  alreadyOpen: boolean,
): Promise<EditorHarness> {
  const terminalPanel: Panel = {
    type: 'panel',
    id: 'p-term',
    originProjectId: 'proj-editor',
    title: 'Terminal',
    kind: 'terminal',
    config: { flavourId: 'cmd' },
  } as Panel;
  const h = mountEditor({
    doc: { text: start.text, version: 1, absPath: start.absPath },
    projectRoot: ROOT,
    registerProject: true,
    settings: settingsFor(c),
    throng: { links: linksBridge(c), terminal: {} },
    extras: [
      createElement(TerminalPanel, {
        key: 'term',
        panel: terminalPanel,
        tabId: 't1',
        projectRoot: ROOT,
      }),
    ],
  });
  if (alreadyOpen) h.calls.openInto!.mockImplementation(() => Promise.resolve({ action: 'focus', panelId: 'p-ed' }));
  else h.serve({ absPath: c.path, text: c.text, version: 2 });
  await waitFor(() => expect(h.view().state.doc.toString()).toBe(start.text));
  await waitFor(() => expect(h.settingsLoaded()).toBe(true));
  await waitFor(() => expect(captured.terminal?.linkActions, 'the TerminalPanel rendered and built its performers').toBeDefined());
  return h;
}

/**
 * The terminal half, through the real provider: a Ctrl+click on the corpus line, and the follow it
 * produces. Returns what the provider handed `follow` — the first link in the chain.
 */
function terminalCtrlClick(c: Case): { request: LinkResolutionRequest; position?: LinkPosition }[] {
  const followed: { request: LinkResolutionRequest; position?: LinkPosition }[] = [];
  const provider = createFileLinkProvider({
    detect: () => true,
    terminal: { buffer: { active: { getLine: () => ({ translateToString: () => c.line }) } } },
    site: () => ({ panelId: 'p-term', originProjectId: 'proj-editor', baseDirectory: ROOT }),
    ask: (request) => (request.text === c.written ? { ok: true, link: resolvedFor(c) } : { ok: false }),
    onHover: () => {},
    follow: (args) => void followed.push(args),
  });
  let links: ProvidedLink[] = [];
  provider.provideLinks(1, (provided) => {
    links = provided ?? [];
  });
  expect(links.map((l) => l.text), 'the terminal draws exactly one link for the corpus line').toEqual([c.written]);
  links[0]!.activate({ ctrlKey: true, metaKey: false } as MouseEvent, c.written);
  return followed;
}

describe.each(CASES)('D2 from a TERMINAL — $name', (c) => {
  it('the provider hands the follow position { line: 3, column: 5 }', () => {
    const followed = terminalCtrlClick(c);
    expect(followed).toHaveLength(1);
    expect(followed[0]!.request.text).toBe(c.written);
    expect(followed[0]!.position).toEqual({ line: 3, column: 5 });
  });

  for (const alreadyOpen of [false, true]) {
    it(`opens an editor with the caret at 3:5 — file ${alreadyOpen ? 'ALREADY open in the tab' : 'not yet open'}`, async () => {
      harness = alreadyOpen
        ? await mountBoth(c, { absPath: c.path, text: c.text }, true)
        : await mountBoth(c, { absPath: NOTES, text: 'unrelated notes\n' }, false);
      const [follow] = terminalCtrlClick(c);

      // The terminal PANEL's own performers — the ones `useTerminal` would hand its provider.
      await followLink({
        request: follow!.request,
        ...(follow!.position === undefined ? {} : { position: follow!.position }),
        resolve: () => ({ ok: true, link: resolvedFor(c) }),
        deps: captured.terminal!.linkActions as LinkFollowDeps,
      });

      const h = harness;
      await waitFor(() => expect(h.view().state.doc.toString(), 'the editor holds the linked file').toBe(c.text));
      await waitFor(() => expect(caret(h.view()), 'the caret lands where the link said').toEqual({ line: 3, column: 5 }));
    });
  }
});

describe.each(CASES)('D2 from an EDITOR (the probe says this works) — $name', (c) => {
  for (const alreadyOpen of [false, true]) {
    it(`opens with the caret at 3:5 — file ${alreadyOpen ? 'ALREADY open (the link is in the file itself)' : 'not yet open'}`, async () => {
      // Already open: the link sits on line 1 of the very file it names, so the file IS open in a tab.
      const start = alreadyOpen
        ? { absPath: c.path, text: `${c.line}\n${c.text.split('\n').slice(1).join('\n')}` }
        : { absPath: NOTES, text: `${c.line}\n` };
      harness = await mountBoth(c, start, alreadyOpen);
      const h = harness;
      const at = start.text.indexOf(c.written) + 2;
      h.view().dispatch({ selection: { anchor: at } });

      // The decoration pass asked main on mount; wait for the chord to find a resolved link.
      await waitFor(() => expect(followLinkInPanel('p-ed', h.view()), 'the Open Link chord claims the caret').toBe(true));

      const expectedText = alreadyOpen ? start.text : c.text;
      await waitFor(() => expect(h.view().state.doc.toString()).toBe(expectedText));
      await waitFor(() => expect(caret(h.view())).toEqual({ line: 3, column: 5 }));
    });
  }
});
