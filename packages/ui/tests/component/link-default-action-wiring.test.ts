import { beforeEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  createPreviewProviderRegistry,
  parsePreviewSettings,
  type LinkResolution,
  type LinkResolutionRequest,
  type PreviewProviderRegistry,
  type PreviewSettings,
  type ResolvedLink,
} from '@throng/core';
import { followLink, linkRouting, type LinkFollowDeps, type LinkRoutingInputs } from '../../src/renderer/links/link-actions.js';
import { linkMenuActions } from '../../src/renderer/links/link-menu.js';
import { createFileLinkProvider } from '../../src/renderer/terminal/file-link-provider.js';
import {
  createLinkPointerHandlers,
  followLinkAtCaret,
  type EditorLinkDeps,
} from '../../src/renderer/editor/link-decorations.js';

/**
 * 045 T157 (rewritten from T104, as the 2026-09-18 supersessions permit) — **the click rule**, wired
 * into both surfaces (FR-110, FR-111, FR-114; FR-054's "same action for the same link").
 *
 * ══ WHAT CHANGED, AND WHY THIS FILE WAS REWRITTEN RATHER THAN EXTENDED ══
 *
 * T104 drove every gesture over every value of *Default link action* (FR-050). FR-112 retires that
 * setting: its five values, its reader and its fallback are gone, and the in-project half of its
 * shipped value becomes the fixed rule FR-110 states. So the cross product over settings is replaced
 * by the rule's own table, and the assertion that the preference is read at the gesture is replaced
 * by one that NO link-specific preference is read at all.
 *
 * | The link resolves to        | What happens                                                      |
 * |-----------------------------|-------------------------------------------------------------------|
 * | a file in the project       | throng: Preview when that file's default open action is Preview   |
 * |                             | and there is no position; otherwise an editor, at the position     |
 * | an executable in the project| the same — it opens in throng as its text (FR-114)                |
 * | a file outside the project  | Open in OS Explorer, the file selected                            |
 * | a folder, in or out         | Open in OS Explorer                                               |
 *
 * What the user sees today: an out-of-project file handed to its DEFAULT PROGRAM by a Ctrl+click
 * (O11's probe, every flavour and the editor), and an in-project `.exe` or `.bat` revealed in Explorer
 * instead of opened as text.
 *
 * ══ FOUR GESTURES, TWO PANEL TYPES, ONE DECISION ══
 *
 * Each arrives through the plumbing it really uses — the terminal provider's `activate`, the editor's
 * caret chord, the editor's pointer handlers, and the row `linkMenuActions` draws for the plain
 * Open Link item — and every one ends in `followLink`.
 */

const REGISTRY = createPreviewProviderRegistry([
  { id: 'testMd', displayName: 'Test markdown', extensions: ['.md'], kind: 'text' },
]);

const previewSettings = (defaultOpenAction: 'editor' | 'preview', enabled = true): PreviewSettings =>
  parsePreviewSettings({ providers: { testMd: { enabled, defaultOpenAction } } }, REGISTRY);

const ROOT = 'D:\\p';
const TS = `${ROOT}\\src\\foo.ts`;
const MD = `${ROOT}\\docs\\a.md`;

const link = (over: Partial<ResolvedLink> = {}): ResolvedLink => ({
  path: TS,
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'none',
  ...over,
});

/** The Markdown link as main resolves it: an enabled provider makes the preview target `offered`. */
const mdLink = (over: Partial<ResolvedLink> = {}): ResolvedLink =>
  link({ path: MD, preview: 'enabled', ...over });

/**
 * What the preferences say RIGHT NOW — only the two preview inputs FR-051 still reads. Mutated
 * between gestures, never re-wired. Cast on the way into `linkRouting` because, until T158 lands,
 * its input type still demands the retired `defaultAction`.
 */
let live: { previewRegistry: PreviewProviderRegistry; previewSettings: PreviewSettings };

const osCalls: string[] = [];

/**
 * 045 T294 (data-model §16.18) — what main resolves the next follow to. A follow is ONE
 * `throng:links:follow`: main answers `openInThrong` for an in-project file and reveals everything
 * else itself (FR-158a, FR-160a) — recorded here as the `osExplorer:` call it makes.
 */
let mainLink: ResolvedLink;

beforeEach(() => {
  live = { previewRegistry: REGISTRY, previewSettings: previewSettings('editor') };
  osCalls.length = 0;
  (window as unknown as { throng: unknown }).throng = {
    links: {
      follow: (request: LinkResolutionRequest) => {
        if (mainLink.kind === 'file' && mainLink.inProject) {
          return Promise.resolve({ kind: 'openInThrong' as const, link: mainLink });
        }
        osCalls.push(`osExplorer:${request.text}`);
        return Promise.resolve({ kind: 'revealed' as const });
      },
      reveal: (request: LinkResolutionRequest) => {
        osCalls.push(`osExplorer:${request.text}`);
        return Promise.resolve({ ok: true as const });
      },
      open: (request: LinkResolutionRequest) => {
        osCalls.push(`osDefaultProgram:${request.text}`);
        return Promise.resolve({ ok: true as const });
      },
      resolve: () => Promise.resolve({ ok: false as const }),
    },
  };
});

interface Surface {
  readonly deps: LinkFollowDeps;
  readonly performed: string[];
}

/** One surface's performers, plus the live routing both surfaces compose in exactly this way. */
function surface(): Surface {
  const performed: string[] = [];
  return {
    performed,
    deps: {
      openInEditor: (l, position) =>
        void performed.push(position ? `editor@${position.line}:${l.path}` : `editor:${l.path}`),
      openInPreview: (l) => void performed.push(`preview:${l.path}`),
      reportFailure: (outcome) => void performed.push(`failure:${outcome.reason}`),
      ...linkRouting(() => live as unknown as LinkRoutingInputs),
    },
  };
}

/** The request a surface holds, with the position already split off (`LinkCandidate.text`). */
const requestFor = (text: string): LinkResolutionRequest => ({
  text: text.replace(/:\d+$/, ''),
  kind: 'detectedPath',
  baseDirectory: ROOT,
  panelId: 'panel-1',
  originProjectId: 'project-1',
});

const answer =
  (resolved: ResolvedLink) =>
  (): LinkResolution => ({ ok: true, link: resolved });

/** `foo.ts:42` carries a position; the bare text does not. */
function positionIn(text: string): { line: number } | undefined {
  const match = /:(\d+)$/.exec(text);
  return match ? { line: Number(match[1]) } : undefined;
}

/* ── The four gestures, each through the plumbing it really uses ───────────────────────────── */

/** G1 in a terminal: the link provider's own `activate`, with Ctrl held. */
async function terminalCtrlClick(resolved: ResolvedLink, text: string, s: Surface): Promise<void> {
  mainLink = resolved;
  const row = `see ${text} here`;
  let followed: Promise<void> = Promise.resolve();
  const provider = createFileLinkProvider({
    detect: () => true,
    terminal: { buffer: { active: { getLine: () => ({ translateToString: () => row }) } } },
    site: () => ({ panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: ROOT }),
    ask: answer(resolved),
    onHover: () => {},
    follow: ({ request, position }: { request: LinkResolutionRequest; position?: { line: number } }) => {
      followed = followLink({
        request,
        ...(position === undefined ? {} : { position }),
        deps: s.deps,
      });
    },
  } as Parameters<typeof createFileLinkProvider>[0]);
  let links: { activate(event: MouseEvent, text: string): void }[] = [];
  provider.provideLinks(1, (provided) => {
    links = provided ?? [];
  });
  expect(links, `the terminal provider drew no link for "${text}"`).toHaveLength(1);
  links[0]!.activate({ ctrlKey: true, metaKey: false } as MouseEvent, text);
  await followed;
}

function editorDeps(resolved: ResolvedLink, s: Surface, track: (p: Promise<void>) => void): EditorLinkDeps {
  mainLink = resolved;
  return {
    site: () => ({ panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: ROOT }),
    ask: answer(resolved),
    follow: (hit) => {
      if (hit.kind !== 'file') return;
      track(
        followLink({
          request: hit.request,
          ...(hit.position === undefined ? {} : { position: hit.position }),
          deps: s.deps,
        }),
      );
    },
  } as EditorLinkDeps;
}

/** G8 in an editor: the Open Link chord, over the caret. */
async function editorChord(resolved: ResolvedLink, text: string, s: Surface): Promise<void> {
  const doc = `see ${text} here\n`;
  let followed: Promise<void> = Promise.resolve();
  const deps = editorDeps(resolved, s, (p) => (followed = p));
  const view = {
    state: EditorState.create({ doc, selection: { anchor: doc.indexOf(text) + 2 } }),
    visibleRanges: [{ from: 0, to: doc.length }],
  };
  expect(followLinkAtCaret(view, deps), `the chord did not claim "${text}"`).toBe(true);
  await followed;
}

/** G1 in an editor: a Ctrl press and release over the link. */
async function editorCtrlClick(resolved: ResolvedLink, text: string, s: Surface): Promise<void> {
  const doc = `see ${text} here\n`;
  let followed: Promise<void> = Promise.resolve();
  const deps = editorDeps(resolved, s, (p) => (followed = p));
  const view = {
    state: EditorState.create({ doc }),
    visibleRanges: [{ from: 0, to: doc.length }],
    posAtCoords: () => doc.indexOf(text) + 2,
    dispatch: () => {},
  };
  const handlers = createLinkPointerHandlers(deps);
  const event = { button: 0, ctrlKey: true, metaKey: false, clientX: 10, clientY: 10 } as MouseEvent;
  expect(handlers.mousedown(event, view), `the editor did not claim a Ctrl+click on "${text}"`).toBe(true);
  handlers.mouseup(event, view);
  await followed;
}

/** The plain **Open Link** row, which every surface points at its own default route. */
async function menuOpenLink(resolved: ResolvedLink, text: string, s: Surface): Promise<void> {
  mainLink = resolved;
  const request = requestFor(text);
  const position = positionIn(text);
  let followed: Promise<void> = Promise.resolve();
  const actions = linkMenuActions(
    {
      cls: 'onDevice',
      applicable: { inProjectByName: true, previewByExtension: 'none', executableByExtension: false, folderByGrammar: false },
      openLink: () => {
        followed = followLink({
          request,
          ...(position === undefined ? {} : { position }),
          deps: s.deps,
        });
        return followed;
      },
      copyLink: () => {},
    },
    { kind: resolved.kind, inProject: resolved.inProject, executable: resolved.executable, preview: resolved.preview },
  );
  const open = actions.find((a) => a.label === 'Open Link');
  expect(open, 'the menu offered no Open Link row').toBeDefined();
  open!.onClick?.();
  await followed;
}

const GESTURES = [
  ['Ctrl+click (terminal)', terminalCtrlClick],
  ['Ctrl+click (editor)', editorCtrlClick],
  ['Open Link chord (editor)', editorChord],
  ['Open Link menu item', menuOpenLink],
] as const;

/** What actually happened, whichever route it went out by. */
const outcomeOf = (s: Surface): string[] => [...s.performed, ...osCalls];

/* ── FR-110: the table, over every gesture ─────────────────────────────────────────────────── */

interface Row {
  readonly name: string;
  readonly text: string;
  readonly resolved: ResolvedLink;
  readonly previews: 'editor' | 'preview';
  readonly expected: string;
}

const EXE = `${ROOT}\\src\\tool.exe`;
const OUT_TS = 'C:\\elsewhere\\x.ts';
const OUT_MD = 'C:\\elsewhere\\notes.md';

const TABLE: readonly Row[] = [
  { name: 'in-project file', text: 'src/foo.ts', resolved: link(), previews: 'editor', expected: `editor:${TS}` },
  { name: 'in-project file, positioned', text: 'src/foo.ts:42', resolved: link(), previews: 'editor', expected: `editor@42:${TS}` },
  { name: 'in-project .md, provider set to Preview', text: 'docs/a.md', resolved: mdLink(), previews: 'preview', expected: `preview:${MD}` },
  { name: 'in-project .md, provider set to Editor', text: 'docs/a.md', resolved: mdLink(), previews: 'editor', expected: `editor:${MD}` },
  { name: 'in-project .md, Preview, positioned (FR-052)', text: 'docs/a.md:42', resolved: mdLink(), previews: 'preview', expected: `editor@42:${MD}` },
  { name: 'in-project .md, provider DISABLED', text: 'docs/a.md', resolved: mdLink({ preview: 'disabled' }), previews: 'preview', expected: `editor:${MD}` },
  // FR-114: an executable IN the project opens in throng as its text — never revealed, never run.
  { name: 'in-project executable (FR-114)', text: 'src/tool.exe', resolved: link({ path: EXE, executable: true }), previews: 'editor', expected: `editor:${EXE}` },
  // FR-110 row three: a file outside the project is shown in OS Explorer — never its default program.
  { name: 'out-of-project file', text: 'elsewhere/x.ts', resolved: link({ path: OUT_TS, inProject: false }), previews: 'editor', expected: 'osExplorer:elsewhere/x.ts' },
  { name: 'out-of-project .md with Preview set', text: 'elsewhere/notes.md', resolved: mdLink({ path: OUT_MD, inProject: false }), previews: 'preview', expected: 'osExplorer:elsewhere/notes.md' },
  { name: 'out-of-project executable', text: 'elsewhere/setup.exe', resolved: link({ path: 'C:\\elsewhere\\setup.exe', inProject: false, executable: true }), previews: 'editor', expected: 'osExplorer:elsewhere/setup.exe' },
];

describe('FR-110 — every gesture, in both panel types, performs the click rule', () => {
  it('over every row of the table', async () => {
    const wrong: string[] = [];
    for (const row of TABLE) {
      for (const [gesture, drive] of GESTURES) {
        live = { previewRegistry: REGISTRY, previewSettings: previewSettings(row.previews) };
        osCalls.length = 0;
        const s = surface();
        await drive(row.resolved, row.text, s);
        const actual = outcomeOf(s).join(',');
        if (actual !== row.expected) wrong.push(`${row.name} / ${gesture}: expected ${row.expected}, got ${actual || '(nothing)'}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('a FOLDER, in the project or not, goes to OS Explorer — never a throng destination', async () => {
    for (const inProject of [true, false]) {
      const folder = link({ path: `${ROOT}\\packages\\core`, kind: 'folder', inProject });
      const request: LinkResolutionRequest = {
        // A folder arrives as an OSC 8 target: detection needs an extension (`detect.ts` rule C).
        text: 'file:///D:/p/packages/core',
        kind: 'fileHyperlink',
        panelId: 'panel-1',
        originProjectId: 'project-1',
      };
      osCalls.length = 0;
      const s = surface();
      mainLink = folder;
      await followLink({ request, deps: s.deps });
      expect(s.performed, `inProject=${inProject}`).toEqual([]);
      expect(osCalls, `inProject=${inProject}`).toEqual([`osExplorer:${request.text}`]);
    }
  });

  it('FR-111: no gesture ever reaches `window.throng.links.open`, on any row', async () => {
    const opened: string[] = [];
    for (const row of TABLE) {
      for (const [gesture, drive] of GESTURES) {
        live = { previewRegistry: REGISTRY, previewSettings: previewSettings(row.previews) };
        osCalls.length = 0;
        const s = surface();
        await drive(row.resolved, row.text, s);
        if (osCalls.some((c) => c.startsWith('osDefaultProgram:'))) opened.push(`${row.name} / ${gesture}`);
      }
    }
    expect(opened).toEqual([]);
  });
});

/* ── FR-110 / FR-112: no link-specific preference is consulted ─────────────────────────────── */

describe('FR-110 / FR-112 — the rule consults no link-specific preference', () => {
  it('a surface still carrying a stale `defaultAction` reader is not steered by it', async () => {
    // What a panel built before T158 would still hand over: a reader for the retired setting that
    // answers `osDefaultProgram`. FR-112 says nothing reads it; FR-111 says no gesture could obey it.
    const s = surface();
    const stale = { ...s.deps, defaultAction: () => 'osDefaultProgram' } as LinkFollowDeps;
    mainLink = link();
    await followLink({ request: requestFor('src/foo.ts'), deps: stale });

    expect(osCalls, 'the OS default program was reached through a retired setting').toEqual([]);
    expect(s.performed).toEqual([`editor:${TS}`]);
  });

  it('nor by one answering `osExplorer`', async () => {
    const s = surface();
    const stale = { ...s.deps, defaultAction: () => 'osExplorer' } as LinkFollowDeps;
    mainLink = link();
    await followLink({ request: requestFor('src/foo.ts'), deps: stale });

    expect(osCalls).toEqual([]);
    expect(s.performed).toEqual([`editor:${TS}`]);
  });
});

/* ── FR-051 / FR-052: unchanged, and still live ────────────────────────────────────────────── */

describe('FR-051 — an in-project file honours its own default open action', () => {
  it('an in-project .md whose provider is set to Preview opens its PREVIEW', async () => {
    live = { previewRegistry: REGISTRY, previewSettings: previewSettings('preview') };
    const s = surface();
    await terminalCtrlClick(mdLink(), 'docs/a.md', s);
    expect(s.performed).toEqual([`preview:${MD}`]);
  });

  it('the same file opens an EDITOR while that provider is set to Editor', async () => {
    const s = surface();
    await terminalCtrlClick(mdLink(), 'docs/a.md', s);
    expect(s.performed).toEqual([`editor:${MD}`]);
  });

  it('a file NO provider claims is an editor, whatever the Markdown provider says', async () => {
    live = { previewRegistry: REGISTRY, previewSettings: previewSettings('preview') };
    const s = surface();
    await terminalCtrlClick(link(), 'src/foo.ts', s);
    expect(s.performed).toEqual([`editor:${TS}`]);
  });

  it('the provider\u2019s own setting is read at the gesture, with nothing re-wired', async () => {
    const s = surface();
    await terminalCtrlClick(mdLink(), 'docs/a.md', s);
    live = { previewRegistry: REGISTRY, previewSettings: previewSettings('preview') };
    await terminalCtrlClick(mdLink(), 'docs/a.md', s);
    expect(s.performed).toEqual([`editor:${MD}`, `preview:${MD}`]);
  });
});

describe('FR-052 — a position always opens an editor', () => {
  it('even for a file whose default open action is Preview, from every gesture', async () => {
    live = { previewRegistry: REGISTRY, previewSettings: previewSettings('preview') };
    for (const [name, drive] of GESTURES) {
      const s = surface();
      await drive(mdLink(), 'docs/a.md:42', s);
      expect(s.performed, name).toEqual([`editor@42:${MD}`]);
    }
  });
});
