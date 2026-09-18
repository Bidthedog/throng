import { beforeEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  DEFAULT_LINK_ACTIONS,
  createPreviewProviderRegistry,
  parsePreviewSettings,
  type DefaultLinkAction,
  type LinkResolution,
  type LinkResolutionRequest,
  type ResolvedLink,
} from '@throng/core';
import { WindowsExecutableExtensions } from '@throng/platform-windows';
import {
  followLink,
  linkRouting,
  osLinkActions,
  type LinkFollowDeps,
  type LinkRoutingInputs,
} from '../../src/renderer/links/link-actions.js';
import { fileLinkMenuActions } from '../../src/renderer/links/link-menu-items.js';
import { createFileLinkProvider } from '../../src/renderer/terminal/file-link-provider.js';
import { followLinkAtCaret, type EditorLinkDeps } from '../../src/renderer/editor/link-decorations.js';

/**
 * 045 T106, FR-039 / SC-010 — **a click never runs an executable.**
 *
 * ══ THE SET COMES FROM THE PORT, NOT FROM THIS FILE ══
 *
 * SC-010 asks that *every* extension the classification considers executable be unreachable by a
 * click at *every* setting. Written as a hand-copied list it goes stale the first time
 * `WindowsExecutableExtensions` adds one — which is exactly why `IExecutableExtensions` reports its
 * set (EX6). The loops below iterate `executableExtensions()`, so the criterion cannot drift from
 * the implementation it is about.
 *
 * ══ WHY THIS IS THE ONE RULE THAT CANNOT SHIP AND BE FIXED LATER ══
 *
 * The setting can NAME `osDefaultProgram`. A precedence that merely reordered the FALLBACK would let
 * that name through, and a Ctrl+click on a downloaded `setup.exe` would run it. So FR-039 is clause
 * one of `resolveDefaultLinkAction`, before anything reads the preference, and the three gestures
 * reach it because they route THROUGH that function rather than around it. There is no second
 * implementation here to keep in step.
 *
 * ══ AND THE ITEM THAT DOES RUN IT IS STILL THERE ══
 *
 * *Open in OS Default Program*, chosen explicitly from the menu, runs the file. The user reached
 * past Open Link and said exactly what they wanted; an item that silently refused would be a menu
 * row that does nothing. The refusal is about the GESTURE, not about the file.
 */

const EXECUTABLES = new WindowsExecutableExtensions(() => ({
  PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
})).executableExtensions();

const REGISTRY = createPreviewProviderRegistry([
  { id: 'testMd', displayName: 'Test markdown', extensions: ['.md'], kind: 'text' },
]);

const ROOT = 'D:\\p';

let live: LinkRoutingInputs;
const osCalls: string[] = [];

beforeEach(() => {
  live = {
    defaultAction: 'throng',
    previewRegistry: REGISTRY,
    previewSettings: parsePreviewSettings({}, REGISTRY),
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
    },
  };
});

interface Surface {
  readonly deps: LinkFollowDeps;
  readonly performed: string[];
}

function surface(): Surface {
  const performed: string[] = [];
  return {
    performed,
    deps: {
      openInEditor: (l) => void performed.push(`editor:${l.path}`),
      openInPreview: (l) => void performed.push(`preview:${l.path}`),
      reportFailure: (outcome) => void performed.push(`failure:${outcome.reason}`),
      ...linkRouting(() => live),
    },
  };
}

/** How main reports one: `executable: true`, in project, and a real file. */
const executableLink = (extension: string): ResolvedLink => ({
  path: `${ROOT}\\src\\tool${extension}`,
  kind: 'file',
  inProject: true,
  executable: true,
  preview: 'none',
});

const answer =
  (resolved: ResolvedLink) =>
  (): LinkResolution => ({ ok: true, link: resolved });

const requestFor = (text: string): LinkResolutionRequest => ({
  text,
  kind: 'detectedPath',
  baseDirectory: ROOT,
  panelId: 'panel-1',
  originProjectId: 'project-1',
});

async function terminalCtrlClick(resolved: ResolvedLink, text: string, s: Surface): Promise<void> {
  let followed: Promise<void> = Promise.resolve();
  const provider = createFileLinkProvider({
    detect: () => true,
    terminal: { buffer: { active: { getLine: () => ({ translateToString: () => `run ${text}` }) } } },
    site: () => ({ panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: ROOT }),
    ask: answer(resolved),
    onHover: () => {},
    follow: ({ request }) => {
      followed = followLink({ request, resolve: answer(resolved), deps: s.deps });
    },
  });
  let links: { activate(event: MouseEvent, text: string): void }[] = [];
  provider.provideLinks(1, (provided) => {
    links = provided ?? [];
  });
  expect(links, `no link drawn for "${text}"`).toHaveLength(1);
  links[0]!.activate({ ctrlKey: true, metaKey: false } as MouseEvent, text);
  await followed;
}

async function editorChord(resolved: ResolvedLink, text: string, s: Surface): Promise<void> {
  const doc = `run ${text} now\n`;
  let followed: Promise<void> = Promise.resolve();
  const deps: EditorLinkDeps = {
    site: () => ({ panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: ROOT }),
    ask: answer(resolved),
    follow: (hit) => {
      followed = followLink({ request: hit.request, resolve: answer(resolved), deps: s.deps });
    },
  };
  const view = {
    state: EditorState.create({ doc, selection: { anchor: doc.indexOf(text) + 1 } }),
    visibleRanges: [{ from: 0, to: doc.length }],
  };
  expect(followLinkAtCaret(view, deps), `the chord did not claim "${text}"`).toBe(true);
  await followed;
}

async function menuOpenLink(resolved: ResolvedLink, text: string, s: Surface): Promise<void> {
  let followed: Promise<void> = Promise.resolve();
  const actions = fileLinkMenuActions({
    link: resolved,
    request: requestFor(text),
    openLink: () => {
      followed = followLink({
        request: requestFor(text),
        resolve: answer(resolved),
        deps: s.deps,
      });
      return followed;
    },
    deps: { ...s.deps, ...osLinkActions() },
  });
  actions.find((a) => a.label === 'Open Link')!.onClick?.();
  await followed;
}

const GESTURES = [
  ['Ctrl+click (terminal)', terminalCtrlClick],
  ['Open Link chord (editor)', editorChord],
  ['Open Link menu item', menuOpenLink],
] as const;

describe('SC-010 — no gesture runs an executable, at any setting', () => {
  it('the port reports a set to iterate at all', () => {
    expect(EXECUTABLES.length).toBeGreaterThan(10);
    expect(EXECUTABLES).toContain('.exe');
    expect(EXECUTABLES, 'a shortcut is launch-by-handler, and is in the set').toContain('.lnk');
  });

  it('every reported extension reveals in OS Explorer instead of running', async () => {
    const ran: string[] = [];
    for (const extension of EXECUTABLES) {
      for (const setting of DEFAULT_LINK_ACTIONS) {
        for (const [name, drive] of GESTURES) {
          live = { ...live, defaultAction: setting };
          osCalls.length = 0;
          const s = surface();
          const text = `src/tool${extension}`;
          await drive(executableLink(extension), text, s);
          const outcome = [...s.performed, ...osCalls];
          if (outcome.join(',') !== `osExplorer:${text}`) {
            ran.push(`${extension}/${setting}/${name}: ${outcome.join(',') || '(nothing)'}`);
          }
        }
      }
    }
    expect(ran).toEqual([]);
  });

  it('including when the preference NAMES Open in OS Default Program', async () => {
    live = { ...live, defaultAction: 'osDefaultProgram' satisfies DefaultLinkAction };
    const s = surface();
    await terminalCtrlClick(executableLink('.exe'), 'src/tool.exe', s);
    expect(osCalls).toEqual(['osExplorer:src/tool.exe']);
  });

  it('and an executable OUTSIDE the project is revealed too, never run', async () => {
    for (const setting of DEFAULT_LINK_ACTIONS) {
      live = { ...live, defaultAction: setting };
      osCalls.length = 0;
      const s = surface();
      await terminalCtrlClick(
        { ...executableLink('.msi'), path: 'D:\\downloads\\setup.msi', inProject: false },
        'D:/downloads/setup.msi',
        s,
      );
      expect(osCalls, setting).toEqual(['osExplorer:D:/downloads/setup.msi']);
      expect(s.performed, setting).toEqual([]);
    }
  });
});

describe('FR-053 — the explicit menu item still runs it', () => {
  it('every reported extension runs from *Open in OS Default Program*', async () => {
    const refused: string[] = [];
    for (const extension of EXECUTABLES) {
      osCalls.length = 0;
      const s = surface();
      const text = `src/tool${extension}`;
      const actions = fileLinkMenuActions({
        link: executableLink(extension),
        request: requestFor(text),
        openLink: () => {},
        deps: { ...s.deps, ...osLinkActions() },
      });
      const row = actions.find((a) => a.label === 'Open in OS Default Program');
      if (!row) {
        refused.push(`${extension}: the menu offered no OS Default Program row`);
        continue;
      }
      await row.onClick?.();
      if (osCalls.join(',') !== `osDefaultProgram:${text}`) {
        refused.push(`${extension}: ${osCalls.join(',') || '(nothing)'}`);
      }
    }
    expect(refused).toEqual([]);
  });
});
