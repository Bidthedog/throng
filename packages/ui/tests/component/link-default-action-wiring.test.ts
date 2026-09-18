import { beforeEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  DEFAULT_LINK_ACTIONS,
  createPreviewProviderRegistry,
  defaultOpenActionFor,
  parsePreviewSettings,
  resolveDefaultLinkAction,
  type DefaultLinkAction,
  type LinkResolution,
  type LinkResolutionRequest,
  type PreviewSettings,
  type ResolvedLink,
} from '@throng/core';
import {
  followLink,
  linkRouting,
  type LinkFollowDeps,
  type LinkRoutingInputs,
} from '../../src/renderer/links/link-actions.js';
import { fileLinkMenuActions } from '../../src/renderer/links/link-menu-items.js';
import { osLinkActions } from '../../src/renderer/links/link-actions.js';
import { createFileLinkProvider } from '../../src/renderer/terminal/file-link-provider.js';
import {
  createLinkPointerHandlers,
  followLinkAtCaret,
  type EditorLinkDeps,
} from '../../src/renderer/editor/link-decorations.js';

/**
 * 045 T104, FR-050 – FR-054 — the *Default link action* preference, wired into both surfaces.
 *
 * ══ THREE GESTURES, ONE DECISION ══
 *
 * FR-054 puts Ctrl+click, the Open Link chord and the plain **Open Link** menu item on the same
 * answer for the same link. Each of the three arrives here through the plumbing it really uses — the
 * terminal's link provider's `activate`, the editor's caret chord, and the row `fileLinkMenuActions`
 * draws — and every one of them ends in `followLink`. The assertion is not "they agree by
 * inspection": it is that over every setting and every link shape the three record the SAME
 * destination, and that the destination is the one `resolveDefaultLinkAction` names.
 *
 * ══ THE PREFERENCE IS READ AT THE GESTURE, NOT AT MOUNT ══
 *
 * `linkRouting` takes a READER. Both surfaces build their deps once — the terminal in a `useMemo`
 * the mount effect holds through a ref, the editor in a function the extension closes over — so a
 * captured value would freeze the preference at whatever it was when the panel appeared. SC-008
 * says a change applies to the next gesture, so the reader is consulted inside `followLink`.
 *
 * ══ `previewIsDefault` IS THE CALLER'S SUM, NOT THE DECISION'S ══
 *
 * `core/src/links/default-action.ts` must not know the preview registry exists (044 FR-070), so the
 * renderer computes `defaultOpenActionFor(...) === 'preview'` and hands over a boolean. This file
 * proves the two halves meet: a provider set to Preview makes an in-project `.md` open its preview,
 * and the SAME file with a position opens an editor instead (FR-052).
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

/** What the preferences say RIGHT NOW. Mutated between gestures, never re-wired. */
let live: LinkRoutingInputs;

const osCalls: string[] = [];

beforeEach(() => {
  live = {
    defaultAction: 'throng',
    previewRegistry: REGISTRY,
    previewSettings: previewSettings('editor'),
  };
  osCalls.length = 0;
  (window as unknown as { throng: unknown }).throng = {
    links: {
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
      ...linkRouting(() => live),
    },
  };
}

/**
 * The request a surface holds for a link, with the position already split off — which is what both
 * detection and the menu really carry (`LinkCandidate.text` never includes `:42`).
 */
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

/* ── The three gestures, each through the plumbing it really uses ───────────────────────────── */

/** G1 in a terminal: the link provider's own `activate`, with Ctrl held. */
async function terminalCtrlClick(
  resolved: ResolvedLink,
  text: string,
  s: Surface,
): Promise<string[]> {
  const row = `see ${text} here`;
  let followed: Promise<void> = Promise.resolve();
  const provider = createFileLinkProvider({
    terminal: { buffer: { active: { getLine: () => ({ translateToString: () => row }) } } },
    site: () => ({ panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: ROOT }),
    ask: answer(resolved),
    onHover: () => {},
    follow: ({ request, position }) => {
      followed = followLink({
        request,
        ...(position === undefined ? {} : { position }),
        resolve: answer(resolved),
        deps: s.deps,
      });
    },
  });
  let links: { activate(event: MouseEvent, text: string): void }[] = [];
  provider.provideLinks(1, (provided) => {
    links = provided ?? [];
  });
  expect(links, `the terminal provider drew no link for "${text}"`).toHaveLength(1);
  links[0]!.activate({ ctrlKey: true, metaKey: false } as MouseEvent, text);
  await followed;
  return s.performed;
}

/** G8 in an editor: the Open Link chord, over the caret. */
async function editorChord(resolved: ResolvedLink, text: string, s: Surface): Promise<string[]> {
  const doc = `see ${text} here\n`;
  const caret = doc.indexOf(text) + 2;
  let followed: Promise<void> = Promise.resolve();
  const deps: EditorLinkDeps = {
    site: () => ({ panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: ROOT }),
    ask: answer(resolved),
    follow: (hit) => {
      followed = followLink({
        request: hit.request,
        ...(hit.position === undefined ? {} : { position: hit.position }),
        resolve: answer(resolved),
        deps: s.deps,
      });
    },
  };
  const view = {
    state: EditorState.create({ doc, selection: { anchor: caret } }),
    visibleRanges: [{ from: 0, to: doc.length }],
  };
  expect(followLinkAtCaret(view, deps), `the chord did not claim "${text}"`).toBe(true);
  await followed;
  return s.performed;
}

/** The plain **Open Link** row, which every surface points at its own default route. */
async function menuOpenLink(
  resolved: ResolvedLink,
  text: string,
  s: Surface,
): Promise<string[]> {
  const request = requestFor(text);
  const position = positionIn(text);
  let followed: Promise<void> = Promise.resolve();
  const actions = fileLinkMenuActions({
    link: resolved,
    request,
    ...(position === undefined ? {} : { position }),
    openLink: () => {
      followed = followLink({
        request,
        ...(position === undefined ? {} : { position }),
        resolve: answer(resolved),
        deps: s.deps,
      });
      return followed;
    },
    deps: { ...s.deps, ...osLinkActions() },
  });
  const open = actions.find((a) => a.label === 'Open Link');
  expect(open, 'the menu offered no Open Link row').toBeDefined();
  open!.onClick?.();
  await followed;
  return s.performed;
}

/** `foo.ts:42` carries a position; the bare text does not. */
function positionIn(text: string): { line: number } | undefined {
  const match = /:(\d+)$/.exec(text);
  return match ? { line: Number(match[1]) } : undefined;
}

const GESTURES = [
  ['Ctrl+click (terminal)', terminalCtrlClick],
  ['Open Link chord (editor)', editorChord],
  ['Open Link menu item', menuOpenLink],
] as const;

/** What actually happened, whichever route it went out by. */
const outcomeOf = (s: Surface): string[] => [...s.performed, ...osCalls];

/* ── FR-054: the three never disagree ──────────────────────────────────────────────────────── */

describe('FR-054 — every gesture resolves the SAME default action', () => {
  it('over every setting and every link shape', async () => {
    const disagreements: string[] = [];
    for (const setting of DEFAULT_LINK_ACTIONS) {
      for (const shape of [
        { text: 'src/foo.ts', resolved: link() },
        { text: 'src/foo.ts:42', resolved: link() },
        { text: 'docs/a.md', resolved: mdLink() },
        { text: 'docs/a.md:42', resolved: mdLink() },
        { text: 'src/tool.exe', resolved: link({ path: `${ROOT}\\src\\tool.exe`, executable: true }) },
        { text: 'elsewhere/x.ts', resolved: link({ path: 'D:\\other\\x.ts', inProject: false }) },
        // No FOLDER here: detection needs a plausible extension (`detect.ts` rule C), so a folder
        // only ever reaches a terminal as an OSC 8 `file:` target. It has its own case below.
      ]) {
        for (const previews of ['editor', 'preview'] as const) {
          const seen: string[] = [];
          for (const [name, drive] of GESTURES) {
            live = {
              defaultAction: setting,
              previewRegistry: REGISTRY,
              previewSettings: previewSettings(previews),
            };
            osCalls.length = 0;
            const s = surface();
            await drive(shape.resolved, shape.text, s);
            seen.push(`${name} => ${outcomeOf(s).join(',')}`);
          }
          const answers = new Set(seen.map((line) => line.split(' => ')[1]));
          if (answers.size !== 1) {
            disagreements.push(`${setting}/${shape.text}/${previews}: ${seen.join(' | ')}`);
          }
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('and the answer is the one `resolveDefaultLinkAction` names', async () => {
    const wrong: string[] = [];
    for (const setting of DEFAULT_LINK_ACTIONS) {
      for (const previews of ['editor', 'preview'] as const) {
        for (const shape of [
          { text: 'docs/a.md', resolved: mdLink() },
          { text: 'docs/a.md:42', resolved: mdLink() },
          { text: 'src/foo.ts', resolved: link() },
        ]) {
          live = {
            defaultAction: setting,
            previewRegistry: REGISTRY,
            previewSettings: previewSettings(previews),
          };
          osCalls.length = 0;
          const s = surface();
          await terminalCtrlClick(shape.resolved, shape.text, s);
          const expected = resolveDefaultLinkAction({
            setting,
            link: shape.resolved,
            hasPosition: positionIn(shape.text) !== undefined,
            previewIsDefault:
              defaultOpenActionFor(REGISTRY, previewSettings(previews), shape.resolved.path) ===
              'preview',
          });
          const actual = outcomeOf(s).join(',');
          if (!actual.startsWith(expected)) {
            wrong.push(`${setting}/${shape.text}/${previews}: ${expected} expected, got ${actual}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('FR-053 — a FOLDER has only the two OS destinations, at every setting', () => {
  it('and reaches OS Explorer whichever of them the preference names', async () => {
    const folder = link({ path: `${ROOT}\\packages\\core`, kind: 'folder' });
    const request: LinkResolutionRequest = {
      // A folder arrives as an OSC 8 target: detection needs an extension, so no folder is ever a
      // DETECTED path (`detect.ts` rule C).
      text: `file:///D:/p/packages/core`,
      kind: 'fileHyperlink',
      panelId: 'panel-1',
      originProjectId: 'project-1',
    };
    for (const setting of DEFAULT_LINK_ACTIONS) {
      live = { ...live, defaultAction: setting };
      osCalls.length = 0;
      const s = surface();
      await followLink({ request, resolve: answer(folder), deps: s.deps });
      expect(s.performed, `${setting}: no throng destination for a folder`).toEqual([]);
      expect(osCalls, setting).toEqual([`osExplorer:${request.text}`]);
    }
  });
});

/* ── FR-051 / FR-052: `throng` means what throng would do, unless a position says otherwise ─── */

describe('FR-051 — *Open in throng* honours the file’s own default open action', () => {
  it('an in-project .md whose provider is set to Preview opens its PREVIEW', async () => {
    live = {
      defaultAction: 'throng',
      previewRegistry: REGISTRY,
      previewSettings: previewSettings('preview'),
    };
    const s = surface();
    await terminalCtrlClick(mdLink(), 'docs/a.md', s);
    expect(s.performed).toEqual([`preview:${MD}`]);
  });

  it('the same file opens an EDITOR while that provider is set to Editor', async () => {
    const s = surface();
    await terminalCtrlClick(mdLink(), 'docs/a.md', s);
    expect(s.performed).toEqual([`editor:${MD}`]);
  });

  it('a DISABLED provider is not a preview destination, so the editor takes it', async () => {
    live = {
      defaultAction: 'throng',
      previewRegistry: REGISTRY,
      previewSettings: previewSettings('preview', false),
    };
    const s = surface();
    // `preview: 'disabled'` is how main reports an off provider (FR-030).
    await terminalCtrlClick(mdLink({ preview: 'disabled' }), 'docs/a.md', s);
    expect(s.performed).toEqual([`editor:${MD}`]);
  });

  it('a file NO provider claims is an editor, whatever the Markdown provider says', async () => {
    live = {
      defaultAction: 'throng',
      previewRegistry: REGISTRY,
      previewSettings: previewSettings('preview'),
    };
    const s = surface();
    await terminalCtrlClick(link(), 'src/foo.ts', s);
    expect(s.performed).toEqual([`editor:${TS}`]);
  });
});

describe('FR-052 — a position always opens an editor', () => {
  it('even for a file whose default open action is Preview', async () => {
    live = {
      defaultAction: 'throng',
      previewRegistry: REGISTRY,
      previewSettings: previewSettings('preview'),
    };
    for (const [name, drive] of GESTURES) {
      const s = surface();
      await drive(mdLink(), 'docs/a.md:42', s);
      expect(s.performed, name).toEqual([`editor@42:${MD}`]);
    }
  });
});

/* ── SC-008: the preference is read at the gesture ─────────────────────────────────────────── */

describe('FR-050 — the LIVE preference decides, gesture by gesture', () => {
  it('a change between two gestures changes the second one, with nothing re-wired', async () => {
    const s = surface();
    await terminalCtrlClick(link(), 'src/foo.ts', s);
    expect(s.performed).toEqual([`editor:${TS}`]);

    live = { ...live, defaultAction: 'osExplorer' };
    osCalls.length = 0;
    await terminalCtrlClick(link(), 'src/foo.ts', s);
    expect(osCalls).toEqual(['osExplorer:src/foo.ts']);
    expect(s.performed, 'the second gesture opened no editor').toEqual([`editor:${TS}`]);
  });

  it('every named setting performs itself when the link offers it', async () => {
    const expected: Record<DefaultLinkAction, string> = {
      throng: `editor:${MD}`,
      editor: `editor:${MD}`,
      preview: `preview:${MD}`,
      osExplorer: 'osExplorer:docs/a.md',
      osDefaultProgram: 'osDefaultProgram:docs/a.md',
    };
    for (const setting of DEFAULT_LINK_ACTIONS) {
      live = {
        defaultAction: setting,
        previewRegistry: REGISTRY,
        previewSettings: previewSettings('editor'),
      };
      osCalls.length = 0;
      const s = surface();
      await terminalCtrlClick(mdLink(), 'docs/a.md', s);
      expect(outcomeOf(s), setting).toEqual([expected[setting]]);
    }
  });
});

/* ── The pointer half of the editor gesture takes the same route ───────────────────────────── */

describe('FR-040 — the editor’s Ctrl+click reaches the same decision', () => {
  it('a press and release over a link performs the preference’s destination', async () => {
    live = { ...live, defaultAction: 'osDefaultProgram' };
    const s = surface();
    const doc = 'see src/foo.ts here\n';
    let followed: Promise<void> = Promise.resolve();
    const resolved = link();
    const deps: EditorLinkDeps = {
      site: () => ({ panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: ROOT }),
      ask: answer(resolved),
      follow: (hit) => {
        followed = followLink({
          request: hit.request,
          resolve: answer(resolved),
          deps: s.deps,
        });
      },
    };
    const view = {
      state: EditorState.create({ doc }),
      visibleRanges: [{ from: 0, to: doc.length }],
      posAtCoords: () => doc.indexOf('src/foo.ts') + 2,
      dispatch: () => {},
    };
    const handlers = createLinkPointerHandlers(deps);
    const event = { button: 0, ctrlKey: true, metaKey: false, clientX: 10, clientY: 10 } as MouseEvent;
    handlers.mousedown(event, view);
    handlers.mouseup(event, view);
    await followed;

    expect(osCalls).toEqual(['osDefaultProgram:src/foo.ts']);
  });
});
