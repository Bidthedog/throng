import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  SHIPPED_PREVIEW_PROVIDERS,
  previewSettingsDefaults,
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
  performLinkTarget,
  type LinkFollowDeps,
  type LinkRoutingInputs,
} from '../../src/renderer/links/link-actions.js';
import { linkMenuActions, type LinkMenuPerformers } from '../../src/renderer/links/link-menu.js';
import { createFileLinkProvider } from '../../src/renderer/terminal/file-link-provider.js';
import {
  followLinkAtCaret,
  type EditorLinkAt,
  type EditorLinkDeps,
} from '../../src/renderer/editor/link-decorations.js';

/**
 * 045 T110, FR-055 / SC-007 — **nothing outside the owning project opens in a throng editor or
 * preview.** Not by a gesture, not by a menu item, not by any setting.
 *
 * ══ WHY IT IS ASSERTED EXHAUSTIVELY RATHER THAN CASE BY CASE ══
 *
 * This is the failure with nothing to see. There is no error, no refusal, no notice — just a file
 * that should not have opened, in a panel where it looks exactly like one that should. A reviewer
 * cannot spot it, and a user would not report it as a bug. So it is asserted over the CROSS PRODUCT
 * of everything a user can reach: every fixture in `tests/fixtures/links/`, every setting, every
 * gesture and every named menu row.
 *
 * ══ THREE WAYS TO BE OUT OF PROJECT, AND ALL THREE MATTER ══
 *
 * 1. A path outside every project (`C:\Windows\notepad.exe`).
 * 2. A path inside **another throng project** — the one that looks most like it should open, because
 *    throng really does know that file.
 * 3. A panel with **no owning project** at all (a sub-workspace's own panel), where main answers
 *    `inProject: false` for everything because there is no root to be inside (M3).
 *
 * The renderer cannot tell them apart and must not try: `inProject` is main's single answer, derived
 * in main from the project ID the renderer named (I2). What this file proves is that the renderer
 * acts on that one bit consistently, whichever of the three produced it.
 */

// Resolved from the runner's own root rather than from `import.meta.url`: under jsdom the module's
// url is not a `file:` one, and `fileURLToPath` throws on it before a single assertion runs.
const FIXTURES = `${resolve(process.cwd(), 'packages/ui/tests/fixtures/links')}/`;

/** Every file the fixture tree holds, as a link text a user could click. */
function fixtureNames(): string[] {
  const names: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}${entry.name}/`, `${prefix}${entry.name}/`);
      else names.push(`${prefix}${entry.name}`);
    }
  };
  walk(FIXTURES, '');
  return names;
}

const NAMES = fixtureNames();

/** The three ways a link ends up out of project, as the absolute path main would answer with. */
const OUTSIDE = [
  ['outside every project', (name: string) => `C:\\elsewhere\\${name.replace(/\//g, '\\')}`],
  ['inside ANOTHER throng project', (name: string) => `D:\\other-project\\${name.replace(/\//g, '\\')}`],
  ['a panel with no owning project', (name: string) => `D:\\p\\${name.replace(/\//g, '\\')}`],
] as const;

/**
 * Only FR-051's two inputs — the *Default link action* is retired (FR-112, T157). Cast into
 * `linkRouting` until T158 drops the field from its input type.
 */
let live: { previewRegistry: PreviewProviderRegistry; previewSettings: PreviewSettings };
const osCalls: string[] = [];

beforeEach(() => {
  live = {
    previewRegistry: SHIPPED_PREVIEW_PROVIDERS,
    previewSettings: previewSettingsDefaults(SHIPPED_PREVIEW_PROVIDERS),
  };
  osCalls.length = 0;
  (window as unknown as { throng: unknown }).throng = {
    links: {
      // 045 T294 (data-model §16.18): a follow is ONE request. Main answers openInThrong for an
      // in-project FILE only, and reveals everything else itself (FR-158a) — never opens it (FR-111).
      follow: () => {
        if (mainLink.kind === 'file' && mainLink.inProject) {
          return Promise.resolve({ kind: 'openInThrong' as const, link: mainLink });
        }
        osCalls.push('osExplorer');
        return Promise.resolve({ kind: 'revealed' as const });
      },
      reveal: () => {
        osCalls.push('osExplorer');
        return Promise.resolve({ ok: true as const });
      },
      open: () => {
        osCalls.push('osDefaultProgram');
        return Promise.resolve({ ok: true as const });
      },
    },
  };
});

/** What main resolves the next follow to (T294). */
let mainLink: ResolvedLink;

interface Surface {
  readonly deps: LinkFollowDeps;
  readonly opened: string[];
}

function surface(): Surface {
  const opened: string[] = [];
  return {
    opened,
    deps: {
      openInEditor: (l) => void opened.push(`editor:${l.path}`),
      openInPreview: (l) => void opened.push(`preview:${l.path}`),
      reportFailure: () => {},
      ...linkRouting(() => live as unknown as LinkRoutingInputs),
    },
  };
}

/** Out of project, with every OTHER bit as favourable to opening as it can be. */
const outsideLink = (path: string): ResolvedLink => ({
  path,
  kind: 'folder' === path ? 'folder' : 'file',
  inProject: false,
  executable: false,
  // `enabled` is the most permissive value there is: the provider handles this type and is ON.
  preview: 'enabled',
});

const answer =
  (resolved: ResolvedLink) =>
  (): LinkResolution => ({ ok: true, link: resolved });

const requestFor = (text: string): LinkResolutionRequest => ({
  text,
  kind: 'detectedPath',
  baseDirectory: 'D:\\p',
  panelId: 'panel-1',
});

/** `link`, resolved — the shape `linkMenuActions`'s `resolution` argument takes. */
const resolutionOf = (link: ResolvedLink) => ({
  kind: link.kind,
  inProject: link.inProject,
  executable: link.executable,
  preview: link.preview,
});

/**
 * The `LinkMenuPerformers` a real surface builds (`links/file-link-menu.ts`'s `openFileLinkMenu`):
 * every named row routes to `performLinkTarget` with ITS OWN target, never the resolved path handed
 * anywhere but as the `link` `performLinkTarget` itself already carries (FR-054).
 */
function performersFor(link: ResolvedLink, request: LinkResolutionRequest, deps: LinkFollowDeps): LinkMenuPerformers {
  const run = (target: 'editor' | 'preview' | 'osExplorer' | 'osDefaultProgram') => (): void => {
    void performLinkTarget({ target, link, request, deps: { ...deps, ...osLinkActions() } });
  };
  return {
    openInEditor: run('editor'),
    openInPreview: run('preview'),
    osExplorer: run('osExplorer'),
    osDefaultProgram: run('osDefaultProgram'),
    // S8 — the SAME route: opening an executable with its default handler runs it.
    openProgram: run('osDefaultProgram'),
  };
}

async function terminalCtrlClick(resolved: ResolvedLink, text: string, s: Surface): Promise<void> {
  mainLink = resolved;
  let pending: Promise<void> = Promise.resolve();
  const provider = createFileLinkProvider({
    detect: () => true,
    terminal: { buffer: { active: { getLine: () => ({ translateToString: () => `at ${text}` }) } } },
    site: () => ({ panelId: 'panel-1', baseDirectory: 'D:\\p' }),
    ask: answer(resolved),
    onHover: () => {},
    follow: ({ request }: { request: LinkResolutionRequest }) => {
      pending = followLink({ request, deps: s.deps });
    },
  } as Parameters<typeof createFileLinkProvider>[0]);
  let links: { activate(event: MouseEvent, text: string): void }[] = [];
  provider.provideLinks(1, (provided) => {
    links = provided ?? [];
  });
  if (links.length === 0) return; // the text was not path-shaped; nothing to click
  links[0]!.activate({ ctrlKey: true, metaKey: false } as MouseEvent, text);
  await pending;
}

async function editorChord(resolved: ResolvedLink, text: string, s: Surface): Promise<void> {
  mainLink = resolved;
  const doc = `at ${text} here\n`;
  let pending: Promise<void> = Promise.resolve();
  const deps = {
    site: () => ({ panelId: 'panel-1', baseDirectory: 'D:\\p' }),
    ask: answer(resolved),
    follow: (hit: EditorLinkAt) => {
      if (hit.kind !== 'file') return;
      pending = followLink({ request: hit.request, deps: s.deps });
    },
  } as EditorLinkDeps;
  const view = {
    state: EditorState.create({ doc, selection: { anchor: doc.indexOf(text) + 1 } }),
    visibleRanges: [{ from: 0, to: doc.length }],
  };
  if (!followLinkAtCaret(view, deps)) return; // not path-shaped here either
  await pending;
}

describe('SC-007 — no gesture opens an out-of-project file in throng', () => {
  // T157: the loop over *Default link action* values is gone with the setting (FR-112); the claim
  // it made is unchanged and now holds by the click rule alone.
  it('across the fixture set and both gestures', async () => {
    const offenders: string[] = [];
    for (const name of NAMES) {
      for (const [why, toPath] of OUTSIDE) {
        for (const [gesture, drive] of [
          ['Ctrl+click (terminal)', terminalCtrlClick],
          ['Open Link chord (editor)', editorChord],
        ] as const) {
          const s = surface();
          await drive(outsideLink(toPath(name)), name, s);
          if (s.opened.length > 0) {
            offenders.push(`${name}/${why}/${gesture}: ${s.opened.join(',')}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * T157 / FR-110 row three: an out-of-project file is SHOWN in OS Explorer — never handed to its
   * default program. What the user sees today (O11): Ctrl+click an out-of-project `.txt` or `.md` and
   * it opens in Notepad or whatever the OS associates, from a terminal and from an editor alike.
   */
  it('FR-110: every fixture, every way out of project, both gestures — exactly one reveal in OS Explorer', async () => {
    const wrong: string[] = [];
    for (const name of NAMES) {
      for (const [why, toPath] of OUTSIDE) {
        for (const [gesture, drive] of [
          ['Ctrl+click (terminal)', terminalCtrlClick],
          ['Open Link chord (editor)', editorChord],
        ] as const) {
          osCalls.length = 0;
          const s = surface();
          await drive(outsideLink(toPath(name)), name, s);
          // A name the grammar does not treat as a path draws no link; nothing to click, nothing to judge.
          if (s.opened.length === 0 && osCalls.length === 0) continue;
          if (osCalls.join(',') !== 'osExplorer' || s.opened.length > 0) {
            wrong.push(`${name}/${why}/${gesture}: ${[...s.opened, ...osCalls].join(',')}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

/**
 * 045 T157 — SC-013 (FR-111): across every file type in the fixture and every extension the
 * executable classification reports, in the project and outside it, `window.throng.links.open` — the
 * one bridge call that hands a file to the OS default program — records ZERO calls from Ctrl+click,
 * the Open Link chord or the plain Open Link item, in either panel type; and exactly ONE from each
 * explicit *Open in OS Default Program*.
 */
describe('SC-013 — no gesture hands any file to the OS default program', () => {
  const EXECUTABLES = new WindowsExecutableExtensions(() => ({
    PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
  })).executableExtensions();

  /** Every fixture name, plus a file per reported executable extension. */
  const SUBJECTS = [...NAMES, ...EXECUTABLES.map((ext) => `bin/tool${ext}`)];

  const linkFor = (name: string, inProject: boolean): ResolvedLink => ({
    path: `${inProject ? 'D:\\p' : 'C:\\elsewhere'}\\${name.replace(/\//g, '\\')}`,
    kind: 'file',
    inProject,
    executable: EXECUTABLES.some((ext) => name.toLowerCase().endsWith(ext)),
    preview: /\.md$/i.test(name) ? 'enabled' : 'none',
  });

  /** A spy on the bridge's `open`, counting every call and nothing else. */
  function spyOnOpen(): { calls: string[] } {
    const calls: string[] = [];
    const bridge = (window as unknown as { throng: { links: Record<string, unknown> } }).throng.links;
    bridge.open = (request: LinkResolutionRequest) => {
      calls.push(request.text);
      return Promise.resolve({ ok: true as const });
    };
    return { calls };
  }

  async function menuOpenLink(resolved: ResolvedLink, text: string, s: Surface): Promise<void> {
    mainLink = resolved;
    let pending: Promise<void> = Promise.resolve();
    const actions = linkMenuActions(
      {
        cls: 'onDevice',
        applicable: { inProjectByName: true, previewByExtension: 'none', executableByExtension: false, folderByGrammar: false },
        openLink: () => {
          pending = followLink({ request: requestFor(text), deps: s.deps });
          return pending;
        },
        copyLink: () => {},
      },
      resolutionOf(resolved),
    );
    actions.find((a) => a.label === 'Open Link')?.onClick?.();
    await pending;
  }

  it('zero `links.open` calls from every gesture and the plain Open Link item', async () => {
    const spy = spyOnOpen();
    const offenders: string[] = [];
    for (const name of SUBJECTS) {
      for (const inProject of [true, false]) {
        for (const [gesture, drive] of [
          ['Ctrl+click (terminal)', terminalCtrlClick],
          ['Open Link chord (editor)', editorChord],
          ['Open Link menu item', menuOpenLink],
        ] as const) {
          const before = spy.calls.length;
          await drive(linkFor(name, inProject), name, surface());
          if (spy.calls.length > before) offenders.push(`${name}/${inProject ? 'in' : 'out'}/${gesture}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('exactly one `links.open` call from each explicit *Open in OS Default Program* / *Open Program* (S8)', async () => {
    const spy = spyOnOpen();
    const wrong: string[] = [];
    for (const name of SUBJECTS) {
      for (const inProject of [true, false]) {
        const before = spy.calls.length;
        const s = surface();
        const resolved = linkFor(name, inProject);
        const items = linkMenuActions(
          {
            cls: 'onDevice',
            applicable: {
              inProjectByName: true,
              previewByExtension: 'none',
              executableByExtension: resolved.executable,
              folderByGrammar: false,
            },
            openLink: () => {},
            copyLink: () => {},
            performers: performersFor(resolved, requestFor(name), s.deps),
          },
          resolutionOf(resolved),
        );
        // S8 — an executable draws Open Program instead, the SAME route.
        const row = items.find((a) => a.label === (resolved.executable ? 'Open Program' : 'Open in OS Default Program'));
        await row?.onClick?.();
        if (spy.calls.length - before !== 1) wrong.push(`${name}/${inProject ? 'in' : 'out'}: ${spy.calls.length - before}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('SC-007 — and no MENU ITEM does either', () => {
  it('the menu offers neither Open In ▸ nor Open Preview for an out-of-project link', () => {
    const offered: string[] = [];
    for (const name of NAMES) {
      for (const [why, toPath] of OUTSIDE) {
        const link = outsideLink(toPath(name));
        const items = linkMenuActions(
          {
            cls: 'onDevice',
            applicable: {
              inProjectByName: false,
              previewByExtension: link.preview,
              executableByExtension: link.executable,
              folderByGrammar: false,
            },
            openLink: () => {},
            copyLink: () => {},
          },
          resolutionOf(link),
        );
        for (const item of items) {
          if (item.label === 'Open In' || item.label === 'Open Preview') offered.push(`${name}/${why}: ${item.label}`);
        }
      }
    }
    expect(offered).toEqual([]);
  });

  it('and a row invoked anyway — reaching past FR-030 — still opens nothing', async () => {
    const offenders: string[] = [];
    const targets = ['editor', 'preview', 'osExplorer', 'osDefaultProgram'] as const;
    for (const name of NAMES) {
      for (const [why, toPath] of OUTSIDE) {
        for (const target of targets) {
          const s = surface();
          await performLinkTarget({
            target,
            link: outsideLink(toPath(name)),
            request: requestFor(name),
            deps: { ...s.deps, ...osLinkActions() },
          });
          if (s.opened.length > 0) offenders.push(`${name}/${why}/${target}: ${s.opened.join(',')}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the rows the menu DOES draw are only the ones that leave the app', () => {
    const drawn = new Set<string>();
    for (const name of NAMES) {
      for (const [, toPath] of OUTSIDE) {
        const s = surface();
        const link = outsideLink(toPath(name));
        const request = requestFor(name);
        const items = linkMenuActions(
          {
            cls: 'onDevice',
            applicable: {
              inProjectByName: false,
              previewByExtension: link.preview,
              executableByExtension: link.executable,
              folderByGrammar: false,
            },
            openLink: () => {},
            copyLink: () => {},
            performers: performersFor(link, request, s.deps),
          },
          resolutionOf(link),
        );
        for (const action of items) drawn.add(action.label);
      }
    }
    expect([...drawn].sort()).toEqual([
      'Copy Link to Clipboard',
      'Open Link',
      'Open in OS Default Program',
      'Open in OS Explorer',
    ]);
  });
});
