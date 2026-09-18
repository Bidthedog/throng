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
 * 045 T106 → T157, FR-039 / FR-111 / FR-114 / SC-010 — **a click never runs an executable.**
 *
 * ══ WHAT CHANGED (2026-09-18 supersessions, T157) ══
 *
 * FR-039's "perform Open in OS Explorer instead" now applies only OUTSIDE the project, where FR-110
 * sends every file there anyway. An executable IN the project follows the click rule like any other
 * in-project file: it opens in throng AS ITS TEXT (FR-114). What does not change is the property
 * that matters — no gesture hands it to the OS to run (FR-111) — and the explicit *Open in OS Default
 * Program* item still runs it.
 *
 * What the user sees today: Ctrl+click an in-project `build.bat` and Explorer opens with it selected,
 * rather than the script opening in an editor where they can read it.
 *
 * ══ THE SET COMES FROM THE PORT, NOT FROM THIS FILE ══
 *
 * SC-010 asks that *every* extension the classification considers executable be unreachable by a
 * click. The loops iterate `executableExtensions()` (EX6), so the criterion cannot drift from the
 * implementation it is about.
 */

const EXECUTABLES = new WindowsExecutableExtensions(() => ({
  PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
})).executableExtensions();

const REGISTRY = createPreviewProviderRegistry([
  { id: 'testMd', displayName: 'Test markdown', extensions: ['.md'], kind: 'text' },
]);

const ROOT = 'D:\\p';

/** Only FR-051's two inputs; cast into `linkRouting` until T158 drops the retired field. */
let live: { previewRegistry: PreviewProviderRegistry; previewSettings: PreviewSettings };
const osCalls: string[] = [];

beforeEach(() => {
  live = { previewRegistry: REGISTRY, previewSettings: parsePreviewSettings({}, REGISTRY) };
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
      ...linkRouting(() => live as unknown as LinkRoutingInputs),
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

describe('SC-010 / FR-111 — no gesture runs an executable', () => {
  it('the port reports a set to iterate at all', () => {
    expect(EXECUTABLES.length).toBeGreaterThan(10);
    expect(EXECUTABLES).toContain('.exe');
    expect(EXECUTABLES, 'a shortcut is launch-by-handler, and is in the set').toContain('.lnk');
  });

  it('FR-114: every reported extension IN the project opens in throng as its text — never revealed, never run', async () => {
    const wrong: string[] = [];
    for (const extension of EXECUTABLES) {
      for (const [name, drive] of GESTURES) {
        osCalls.length = 0;
        const s = surface();
        const text = `src/tool${extension}`;
        const resolved = executableLink(extension);
        await drive(resolved, text, s);
        const outcome = [...s.performed, ...osCalls].join(',');
        if (outcome !== `editor:${resolved.path}`) wrong.push(`${extension}/${name}: ${outcome || '(nothing)'}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('and an executable OUTSIDE the project is revealed in OS Explorer, never run', async () => {
    const wrong: string[] = [];
    for (const extension of EXECUTABLES) {
      for (const [name, drive] of GESTURES) {
        osCalls.length = 0;
        const s = surface();
        const text = `D:/downloads/setup${extension}`;
        await drive(
          { ...executableLink(extension), path: `D:\\downloads\\setup${extension}`, inProject: false },
          text,
          s,
        );
        const outcome = [...s.performed, ...osCalls].join(',');
        if (outcome !== `osExplorer:${text}`) wrong.push(`${extension}/${name}: ${outcome || '(nothing)'}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('in neither case does any gesture reach the OS default program', async () => {
    const ran: string[] = [];
    for (const extension of EXECUTABLES) {
      for (const inProject of [true, false]) {
        for (const [name, drive] of GESTURES) {
          osCalls.length = 0;
          const s = surface();
          const resolved = inProject
            ? executableLink(extension)
            : { ...executableLink(extension), path: `D:\\downloads\\setup${extension}`, inProject: false };
          await drive(resolved, inProject ? `src/tool${extension}` : `D:/downloads/setup${extension}`, s);
          if (osCalls.some((c) => c.startsWith('osDefaultProgram:'))) ran.push(`${extension}/${inProject ? 'in' : 'out'}/${name}`);
        }
      }
    }
    expect(ran).toEqual([]);
  });
});

describe('FR-111 — the explicit menu item still runs it', () => {
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
