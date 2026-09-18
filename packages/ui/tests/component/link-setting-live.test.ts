import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  DEFAULT_APP_SETTINGS,
  SHIPPED_PREVIEW_PROVIDERS,
  type AppSettings,
  type IExecutableExtensions,
  type IFileSystem,
  type IPathForms,
  type LinkResolution,
  type LinkResolutionRequest,
  type ResolvedLink,
} from '@throng/core';
import {
  followLink,
  linkRouting,
  type LinkFollowDeps,
  type LinkRoutingInputs,
} from '../../src/renderer/links/link-actions.js';
import { createFileLinkProvider } from '../../src/renderer/terminal/file-link-provider.js';
import { followLinkAtCaret, type EditorLinkDeps } from '../../src/renderer/editor/link-decorations.js';
import { FileLinkResolver, type FileLinkResolverDeps } from '../../src/main/file-link-resolver.js';

/**
 * 045 T108 → T157, SC-008 (amended 2026-09-18) — **either detection switch, or the existence-check
 * timeout**, applies to the next gesture in both panel types, with nothing remounted.
 *
 * ══ WHAT CHANGED ══
 *
 * SC-008 used to be about *Default link action*. FR-112 retires that setting, so its half of this file
 * is replaced by the settings that remain live: `editor.links.detectInTerminals`,
 * `editor.links.detectInEditors` and `editor.links.existenceCheckTimeoutMs` (FR-120). FR-051's
 * per-provider default open action is still read at the gesture and keeps its case.
 *
 * ══ WHY IT STILL NEEDS A TEST OF ITS OWN ══
 *
 * Both surfaces build their link plumbing ONCE and hold it across the panel's whole life — the
 * terminal's provider is registered once against a live shell, the editor's deps are closed over by
 * an installed extension, and main's resolver is constructed once at startup. A captured VALUE in any
 * of them freezes the preference at whatever it was when the panel appeared. So every assertion
 * below changes the settings object BEHIND plumbing that was built before the change.
 */

const ROOT = 'D:\\p';
const TS = `${ROOT}\\src\\foo.ts`;

const resolved: ResolvedLink = {
  path: TS,
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'none',
};

const answer = (): LinkResolution => ({ ok: true, link: resolved });

/** The whole settings document, exactly as `useAppSettings()` hands it over. */
let settings: AppSettings;
const osCalls: string[] = [];

/** FR-051's two inputs — cast until T158 drops the retired `defaultAction` from the type. */
const routingInputs = (): LinkRoutingInputs =>
  ({
    previewRegistry: SHIPPED_PREVIEW_PROVIDERS,
    previewSettings: settings.editor.previews,
  }) as unknown as LinkRoutingInputs;

beforeEach(() => {
  settings = structuredClone(DEFAULT_APP_SETTINGS);
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

interface Panel {
  readonly performed: string[];
  /** Drive one gesture through this panel's plumbing, using what it built at mount. */
  gesture(): Promise<void>;
}

/** A terminal panel, its provider registered ONCE — as `use-terminal.ts` registers it. */
function terminalPanel(): Panel {
  const performed: string[] = [];
  const deps: LinkFollowDeps = {
    openInEditor: (l) => void performed.push(`editor:${l.path}`),
    openInPreview: (l) => void performed.push(`preview:${l.path}`),
    reportFailure: (o) => void performed.push(`failure:${o.reason}`),
    ...linkRouting(routingInputs),
  };
  let pending: Promise<void> = Promise.resolve();
  const provider = createFileLinkProvider({
    // FR-060, read per row — the reader `terminal-panel.tsx` hands over.
    detect: () => settings.editor.links.detectInTerminals,
    terminal: {
      buffer: { active: { getLine: () => ({ translateToString: () => 'see src/foo.ts here' }) } },
    },
    site: () => ({ panelId: 'terminal-1', originProjectId: 'project-1', baseDirectory: ROOT }),
    ask: answer,
    onHover: () => {},
    follow: ({ request }) => {
      pending = followLink({ request, resolve: answer, deps });
    },
  });
  return {
    performed,
    async gesture() {
      let links: { activate(event: MouseEvent, text: string): void }[] = [];
      provider.provideLinks(1, (provided) => {
        links = provided ?? [];
      });
      links[0]?.activate({ ctrlKey: true, metaKey: false } as MouseEvent, 'src/foo.ts');
      await pending;
    },
  };
}

/** An editor panel, its deps built ONCE — as the link extension's are. */
function editorPanel(): Panel {
  const performed: string[] = [];
  const deps: LinkFollowDeps = {
    openInEditor: (l) => void performed.push(`editor:${l.path}`),
    openInPreview: (l) => void performed.push(`preview:${l.path}`),
    reportFailure: (o) => void performed.push(`failure:${o.reason}`),
    ...linkRouting(routingInputs),
  };
  let pending: Promise<void> = Promise.resolve();
  const editorDeps: EditorLinkDeps = {
    detect: () => settings.editor.links.detectInEditors,
    site: () => ({ panelId: 'editor-1', originProjectId: 'project-1', baseDirectory: ROOT }),
    ask: answer,
    follow: (hit) => {
      pending = followLink({ request: hit.request, resolve: answer, deps });
    },
  };
  const doc = 'see src/foo.ts here\n';
  const view = {
    state: EditorState.create({ doc, selection: { anchor: doc.indexOf('src/foo.ts') + 2 } }),
    visibleRanges: [{ from: 0, to: doc.length }],
  };
  return {
    performed,
    async gesture() {
      followLinkAtCaret(view, editorDeps);
      await pending;
    },
  };
}

describe('SC-008 — a detection switch lands on the next gesture, in both panel types', () => {
  for (const [name, build, key] of [
    ['terminal', terminalPanel, 'detectInTerminals'],
    ['editor', editorPanel, 'detectInEditors'],
  ] as const) {
    it(`${name}: off, then on again, with the panel built before either change`, async () => {
      const panel = build(); // mounted while the shipped value (on) is in force

      await panel.gesture();
      expect(panel.performed, `${name}: detection on follows the link`).toEqual([`editor:${TS}`]);

      settings.editor.links[key] = false;
      await panel.gesture();
      expect(panel.performed, `${name}: off — the very next gesture finds no link`).toEqual([`editor:${TS}`]);

      settings.editor.links[key] = true;
      await panel.gesture();
      expect(panel.performed, `${name}: on again, with nothing remounted`).toEqual([`editor:${TS}`, `editor:${TS}`]);
    });
  }

  it('a provider\u2019s own default open action is live too (FR-051)', async () => {
    const markdown = SHIPPED_PREVIEW_PROVIDERS.forPath('a.md');
    expect(markdown, 'the shipped registry must still claim .md').toBeDefined();
    const mdLink: ResolvedLink = {
      path: `${ROOT}\\docs\\a.md`,
      kind: 'file',
      inProject: true,
      executable: false,
      preview: 'enabled',
    };
    const performed: string[] = [];
    const deps: LinkFollowDeps = {
      openInEditor: (l) => void performed.push(`editor:${l.path}`),
      openInPreview: (l) => void performed.push(`preview:${l.path}`),
      reportFailure: () => {},
      ...linkRouting(routingInputs),
    };
    const request: LinkResolutionRequest = {
      text: 'docs/a.md',
      kind: 'detectedPath',
      baseDirectory: ROOT,
      panelId: 'terminal-1',
      originProjectId: 'project-1',
    };
    const resolveMd = (): LinkResolution => ({ ok: true, link: mdLink });

    settings.editor.previews.providers[markdown!.id]!.defaultOpenAction = 'editor';
    await followLink({ request, resolve: resolveMd, deps });
    settings.editor.previews.providers[markdown!.id]!.defaultOpenAction = 'preview';
    await followLink({ request, resolve: resolveMd, deps });
    expect(performed).toEqual([`editor:${mdLink.path}`, `preview:${mdLink.path}`]);
  });
});

/**
 * SC-008 (amended) — the existence-check TIMEOUT is read per check (FR-120; data-model §13.5's
 * `readLinkSettings`, on the `readPreviewSettings` pattern). Main's resolver is built once at
 * startup, so a value captured at construction would freeze it until restart.
 *
 * The stuck share is a `stat` that never settles; the clock is vitest's fake one.
 */
describe('SC-008 — the existence-check timeout applies to the next check, with no restart', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('2 s, then raised to 5 s behind the same resolver', async () => {
    vi.useFakeTimers();
    const neverSettles = (): Promise<never> => new Promise(() => {});
    const deps = {
      fs: { stat: neverSettles } as unknown as IFileSystem,
      pathForms: {
        homeDirectory: () => 'C:\\Users\\someone',
        fromDriveForm: () => null,
        fromFileUrl: () => null,
        fromHomeForm: () => null,
      } as unknown as IPathForms,
      executables: { isExecutable: () => false } as unknown as IExecutableExtensions,
      projectRootFor: () => ROOT,
      previewRegistry: SHIPPED_PREVIEW_PROVIDERS,
      readPreviewSettings: () => settings.editor.previews,
      readLinkSettings: () => settings.editor.links,
    };
    const resolver = new FileLinkResolver(deps as FileLinkResolverDeps);
    const request = (text: string): LinkResolutionRequest => ({ text, kind: 'detectedPath', panelId: 'p1' });

    const outcome = async (running: Promise<LinkResolution>, ms: number) => {
      let got: LinkResolution | 'pending' = 'pending';
      void running.then((r) => (got = r));
      await vi.advanceTimersByTimeAsync(ms);
      return got;
    };

    (settings.editor.links as unknown as Record<string, number>).existenceCheckTimeoutMs = 2000;
    expect(await outcome(resolver.resolve(request('\\\\fileserver\\home\\a.txt')), 2000)).toEqual({
      ok: false,
      reason: 'unreachable',
    });

    // A different root, so FR-121's gate on the first one is not what answers.
    (settings.editor.links as unknown as Record<string, number>).existenceCheckTimeoutMs = 5000;
    const second = resolver.resolve(request('\\\\nas\\share\\b.txt'));
    expect(await outcome(second, 2000), 'the raised timeout is in force for the very next check').toBe('pending');
    expect(await outcome(second, 3000)).toEqual({ ok: false, reason: 'unreachable' });
  });
});
