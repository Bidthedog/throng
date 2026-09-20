import { act, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { collectPanels, type LinkPosition, type LinkResolution, type LinkResolutionRequest, type Panel, type ResolvedLink } from '@throng/core';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import { TerminalPanel } from '../../src/renderer/terminal/terminal-panel.js';
import { createFileLinkProvider, type ProvidedLink } from '../../src/renderer/terminal/file-link-provider.js';
import { followLink, type LinkFollowDeps } from '../../src/renderer/links/link-actions.js';
import { followLinkInPanel } from '../../src/renderer/editor/link-decorations.js';
import { useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { EditorPanel } from '../../src/renderer/editor/editor-panel.js';
import { disposeEditor } from '../../src/renderer/editor/use-editor.js';

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
});

afterEach(() => {
  harness?.unmount();
  harness = undefined;
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
    // 045 T294: a follow is one `throng:links:follow` (data-model §16.18).
    follow: async (request: LinkResolutionRequest) =>
      request.text === c.written
        ? { kind: 'openInThrong' as const, link: resolvedFor(c) }
        : { kind: 'notFound' as const, path: request.text },
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
  bridge: Record<string, unknown> = linksBridge(c),
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
    throng: { links: bridge, terminal: {} },
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
        deps: captured.terminal!.linkActions as LinkFollowDeps,
      });

      const h = harness;
      await waitFor(() => expect(h.view().state.doc.toString(), 'the editor holds the linked file').toBe(c.text));
      await waitFor(() => expect(caret(h.view()), 'the caret lands where the link said').toEqual({ line: 3, column: 5 }));
    });
  }
});

/**
 * The corpus probe's editor rows #30 / #31: with *Open files in* = New Editor, Ctrl+click the link, close
 * the panel it opened, Ctrl+click the SAME link again — the probe read the second panel's caret as 1:1
 * (`test.md:3`) and 3:1 (`test.md:3:5`). Driven here with every new panel really mounted (each one a
 * live CodeMirror view behind the fake authority), closed the way the panel header's Destroy closes it
 * (`removePanel` + `disposeEditor`), and followed from an editor and from a terminal.
 *
 * ══ NOT A REPRODUCTION: THE PROBE CLICKED THE LINE ABOVE ══
 *
 * These pass against the unchanged product, and so did the real app (a throwaway Playwright probe with
 * fresh geometry per click: 3:1 and 3:5 on each of three follows). The probe's own capture explains
 * it — its "middle" point on row #30 hovered `./test.md` (row #29), and on row #31 hovered the link of
 * row #30, and each follow opened exactly what was under the pointer. Kept as the guard that a second
 * follow of the same link, after the first panel is gone, still lands where the link says; a mutation
 * dropping every second open's position turns all four red.
 */
const workspaceRef = vi.hoisted(() => ({ ws: null as null | { removePanel(id: string): void; layout: unknown } }));

/** Renders every editor panel `openFileInTab` adds to the layout, beside the harness's own `p-ed`. */
function OpenedEditors(): ReturnType<typeof createElement> {
  const ws = useWorkspace();
  workspaceRef.ws = ws as unknown as typeof workspaceRef.ws;
  const panels = ws.layout ? ws.layout.tabs.flatMap((t) => collectPanels(t.root)) : [];
  return createElement(
    'div',
    { className: 'opened-editors' },
    ...panels
      .filter((p) => p.id !== 'p-ed' && p.kind === 'editor')
      .map((p) => createElement('div', { key: p.id, 'data-panel': p.id }, createElement(EditorPanel, { panel: p, tabId: 't1', projectRoot: ROOT }))),
  );
}

/** The live view of a mounted panel other than `p-ed`. */
function viewOf(panelId: string): EditorView {
  const el = document.querySelector<HTMLElement>(`[data-panel="${panelId}"] .cm-editor`);
  const view = el ? EditorView.findFromDOM(el) : null;
  if (!view) throw new Error(`panel ${panelId} has no live editor yet`);
  return view;
}

function openedIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-panel]')].map((el) => el.dataset.panel!);
}

describe('D2 twice — New Editor, close, follow the same link again (corpus probe rows #30, #31)', () => {
  const c = CASES[1]!; // test.md, default open action Editor
  const LINES = `./test.md\ntest.md:3\ntest.md:3:5\n`;

  async function mountWithNewTarget(): Promise<EditorHarness> {
    const h = mountEditor({
      doc: { text: LINES, version: 1, absPath: NOTES },
      projectRoot: ROOT,
      registerProject: true,
      settings: { ...settingsFor(c), editor: { ...(settingsFor(c).editor as object), openTarget: 'new' } },
      throng: { links: linksBridge(c), terminal: {} },
      extras: [
        createElement(OpenedEditors, { key: 'opened' }),
        createElement(TerminalPanel, {
          key: 'term',
          panel: { type: 'panel', id: 'p-term', originProjectId: 'proj-editor', title: 'Terminal', kind: 'terminal', config: { flavourId: 'cmd' } } as Panel,
          tabId: 't1',
          projectRoot: ROOT,
        }),
      ],
    });
    // One authority, per panel: `p-ed` keeps the harness's document, every panel opened later holds test.md.
    const editor = (window as unknown as { throng: { editor: Record<string, unknown> } }).throng.editor;
    const original = editor.getContent as (id: string) => Promise<unknown>;
    editor.getContent = (id: string) =>
      id === 'p-ed'
        ? original(id)
        : Promise.resolve({ text: c.text, version: 1, dirty: false, absPath: c.path, fileMissing: false, unloadable: false, encoding: 'utf8', hasBom: false, lineEnding: 'lf' });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe(LINES));
    await waitFor(() => expect(h.settings().editor.openTarget).toBe('new'));
    await waitFor(() => expect(captured.terminal?.linkActions).toBeDefined());
    return h;
  }

  /** Follow, wait for the ONE new panel it opens, read its caret once it has settled, then close it. */
  async function followAndClose(follow: () => unknown): Promise<{ line: number; column: number }> {
    const before = openedIds();
    await follow();
    let id = '';
    await waitFor(() => {
      const added = openedIds().filter((p) => !before.includes(p));
      expect(added, 'exactly one new editor panel').toHaveLength(1);
      id = added[0]!;
      expect(viewOf(id).state.doc.toString()).toBe(c.text);
    });
    // Long enough for the reveal (it polls every 25 ms) AND for anything that would move the caret after it.
    await new Promise((r) => setTimeout(r, 300));
    const at = caret(viewOf(id));
    act(() => {
      disposeEditor(id);
      workspaceRef.ws!.removePanel(id);
    });
    await waitFor(() => expect(openedIds()).not.toContain(id));
    return at;
  }

  for (const [label, written, expected] of [
    ['test.md:3', 'test.md:3', { line: 3, column: 1 }],
    ['test.md:3:5', 'test.md:3:5', { line: 3, column: 5 }],
  ] as const) {
    it(`from an EDITOR, ${label}: both follows land at ${expected.line}:${expected.column}`, async () => {
      harness = await mountWithNewTarget();
      const h = harness;
      const at = LINES.indexOf(`${written}\n`) + 2;
      // The Open Link chord — the same `followEditorLink` a Ctrl+click reaches. Retried only until the
      // decoration pass has an answer to claim with; the first claim IS the follow.
      const chord = () =>
        waitFor(() => {
          h.view().dispatch({ selection: { anchor: at } });
          expect(followLinkInPanel('p-ed', h.view()), 'the chord claims the link').toBe(true);
        });
      const first = await followAndClose(chord);
      const second = await followAndClose(chord);
      expect({ first, second }).toEqual({ first: expected, second: expected });
    });

    it(`from a TERMINAL, ${label}: both follows land at ${expected.line}:${expected.column}`, async () => {
      harness = await mountWithNewTarget();
      const lineCase = { ...c, line: `see ${written} here` };
      const viaTerminal = () => {
        const [f] = terminalCtrlClick(lineCase);
        void followLink({
          request: f!.request,
          ...(f!.position === undefined ? {} : { position: f!.position }),
          deps: captured.terminal!.linkActions as LinkFollowDeps,
        });
      };
      const first = await followAndClose(viaTerminal);
      const second = await followAndClose(viaTerminal);
      expect({ first, second }).toEqual({ first: expected, second: expected });
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

/**
 * 045 T293 — a Ctrl+click on a link NOTHING has asked about yet (FR-155, plan *Corrections, tenth pass*).
 *
 * What the user meets today: the first Ctrl+click on a freshly printed path does nothing, because the
 * follow reads an answer no hover has fetched yet (FR-071's "not a link"); only a later click works.
 * Round four draws every link by grammar, so the follow must stand on its own: ONE `throng:links:follow`
 * request, and the renderer acts on main's `LinkFollowOutcome` — here `openInThrong`, opened by the
 * click rule with the position kept, and `notFound`, one notice and no editor. The bridge below answers
 * `resolve` with nothing at all, so no prior answer can be what makes it work.
 */
describe('T293 — a follow with NO prior answer: one follow request, its outcome acted on', () => {
  const c = CASES[2]!; // src/foo.ts — the control

  function followOnlyBridge(): { bridge: Record<string, unknown>; sent: string[] } {
    const sent: string[] = [];
    return {
      sent,
      bridge: {
        resolve: async (r: LinkResolutionRequest) => {
          sent.push(`resolve:${r.text}`);
          return { ok: false };
        },
        follow: async (r: LinkResolutionRequest) => {
          sent.push(`follow:${r.text}`);
          return r.text === c.written ? { kind: 'openInThrong', link: resolvedFor(c) } : { kind: 'notFound', path: r.text };
        },
        reveal: async () => ({ ok: true as const }),
        open: async () => ({ ok: true as const }),
      },
    };
  }

  /** The terminal's provider over the corpus line, with no answer for anything (`ask` → not yet). */
  function terminalLinkFor(line: string): ProvidedLink[] {
    const followed: { request: LinkResolutionRequest; position?: LinkPosition }[] = [];
    const provider = createFileLinkProvider({
      detect: () => true,
      terminal: { buffer: { active: { getLine: () => ({ translateToString: () => line }) } } },
      site: () => ({ panelId: 'p-term', originProjectId: 'proj-editor', baseDirectory: ROOT }),
      ask: () => undefined,
      onHover: () => {},
      follow: (args: { request: LinkResolutionRequest; position?: LinkPosition }) =>
        void followed.push(args),
    } as unknown as Parameters<typeof createFileLinkProvider>[0]);
    let links: ProvidedLink[] = [];
    provider.provideLinks(1, (provided) => {
      links = provided ?? [];
    });
    return links;
  }

  it('from a TERMINAL: the link is drawn with no answer, and ONE follow opens it at 3:5', async () => {
    const { bridge, sent } = followOnlyBridge();
    harness = await mountBoth(c, { absPath: NOTES, text: 'unrelated notes\n' }, false, bridge);
    const links = terminalLinkFor(c.line);
    expect(links.map((l) => l.text), 'drawn by grammar, with nothing answered').toEqual([c.written]);
    sent.length = 0;
    await (followLink as unknown as (a: unknown) => Promise<void>)({
      request: { text: c.written, kind: 'detectedPath', panelId: 'p-term', originProjectId: 'proj-editor', baseDirectory: ROOT },
      position: { line: 3, column: 5 },
      deps: captured.terminal!.linkActions as LinkFollowDeps,
    });
    const h = harness;
    await waitFor(() => expect(h.view().state.doc.toString()).toBe(c.text));
    await waitFor(() => expect(caret(h.view())).toEqual({ line: 3, column: 5 }));
    expect(sent, 'exactly one main request per follow').toEqual([`follow:${c.written}`]);
  });

  it('from an EDITOR: the chord claims a link nothing has resolved, and ONE follow opens it at 3:5', async () => {
    const { bridge, sent } = followOnlyBridge();
    const start = { absPath: NOTES, text: `${c.line}\n` };
    harness = await mountBoth(c, start, false, bridge);
    const h = harness;
    h.view().dispatch({ selection: { anchor: start.text.indexOf(c.written) + 2 } });
    sent.length = 0;
    expect(followLinkInPanel('p-ed', h.view()), 'the chord claims a link drawn by grammar').toBe(true);
    await waitFor(() => expect(h.view().state.doc.toString()).toBe(c.text));
    await waitFor(() => expect(caret(h.view())).toEqual({ line: 3, column: 5 }));
    expect(sent, 'exactly one main request per follow').toEqual([`follow:${c.written}`]);
  });

  it('from an EDITOR: a follow main answers notFound opens NO editor', async () => {
    const { bridge, sent } = followOnlyBridge();
    const start = { absPath: NOTES, text: 'see src/missing.ts:3 here\n' };
    harness = await mountBoth(c, start, false, bridge);
    const h = harness;
    h.view().dispatch({ selection: { anchor: start.text.indexOf('src/missing.ts') + 2 } });
    sent.length = 0;
    expect(followLinkInPanel('p-ed', h.view())).toBe(true);
    await waitFor(() => expect(sent).toEqual(['follow:src/missing.ts']));
    await new Promise((r) => setTimeout(r, 100));
    expect(h.view().state.doc.toString(), 'the editor still holds its own file').toBe(start.text);
  });
});
