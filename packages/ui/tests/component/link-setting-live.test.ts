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
import {
  followLinkAtCaret,
  linkHitsBetween,
  type EditorLinkAt,
  type EditorLinkDeps,
} from '../../src/renderer/editor/link-decorations.js';
import { FileLinkResolver, type FileLinkResolverDeps } from '../../src/main/file-link-resolver.js';
import { linkScanOptions } from '../../src/renderer/links/link-scan-options.js';
import { __resetRefusedSchemesForTests } from '../../src/renderer/links/refused-schemes-client.js';
import { createLinkViewMarks, terminalViewScan } from '../../src/renderer/terminal/link-view-marks.js';

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
  mainLink = resolved;
  (window as unknown as { throng: unknown }).throng = {
    links: {
      // 045 T294 (data-model §16.18): a follow is ONE request; main answers the in-project file.
      follow: () => Promise.resolve({ kind: 'openInThrong' as const, link: mainLink }),
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

/** What main resolves the next follow to (T294). */
let mainLink: ResolvedLink;

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
    follow: ({ request }: { request: LinkResolutionRequest }) => {
      pending = followLink({ request, deps });
    },
  } as Parameters<typeof createFileLinkProvider>[0]);
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
  const editorDeps = {
    detect: () => settings.editor.links.detectInEditors,
    site: () => ({ panelId: 'editor-1', originProjectId: 'project-1', baseDirectory: ROOT }),
    ask: answer,
    follow: (hit: EditorLinkAt) => {
      if (hit.kind !== 'file') return;
      pending = followLink({ request: hit.request, deps });
    },
  } as EditorLinkDeps;
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
    mainLink = mdLink;

    settings.editor.previews.providers[markdown!.id]!.defaultOpenAction = 'editor';
    await followLink({ request, deps });
    settings.editor.previews.providers[markdown!.id]!.defaultOpenAction = 'preview';
    await followLink({ request, deps });
    expect(performed).toEqual([`editor:${mdLink.path}`, `preview:${mdLink.path}`]);
  });
});

/**
 * 045 T248 (FR-178) — the known-extension edits land on the NEXT editor decoration pass, with
 * nothing remounted: the deps below are built once, and the settings object changes behind them.
 *
 * Round five (#408) inverted `editor.links.knownFileExtensions` from a `{ added, removed }` delta
 * into the one list a user actually edits (`app-settings.links.test.ts` covers the parse and the
 * migration); these cases now edit that list directly rather than its two former edit-arrays.
 *
 * The editor half is the first case; the terminal half (the next terminal VIEW pass, `link-view-marks.ts`
 * from T237) the second. The allowlist half (`mailto` to/from the allowlist changing what is drawn) is
 * the block after these two.
 *
 * Every case here is about DRAWING. That a widened span can then be FOLLOWED — main reading the same
 * grammar rather than the shipped extension list — is `tests/unit/link-known-extension-follow.test.ts`,
 * split out because a green bar here was for a while compatible with a link that hovered and did
 * nothing.
 */
describe('T248 — a known-extension edit changes the next editor decoration pass (FR-178)', () => {
  it('adding `foo` to knownFileExtensions, then clearing it, with the deps built before either', () => {
    const doc = 'see D:\\p\\my dir\\a.foo here\n';
    const state = EditorState.create({ doc });
    const deps = {
      detect: () => settings.editor.links.detectInEditors,
      site: () => ({ panelId: 'editor-1', originProjectId: 'project-1', baseDirectory: ROOT }),
      ask: answer,
      follow: () => {},
      // Read per scan from the live settings object — through the helper `use-editor.ts` hands the
      // same deps, so its value-keyed memo is exercised too.
      scanOptions: () => linkScanOptions(settings.editor.links),
    } as EditorLinkDeps;
    const spans = (): string[] =>
      linkHitsBetween(state, 0, doc.length, deps).map((h) => doc.slice(h.from, h.to));

    expect(spans(), 'shipped set: `.foo` is not known, so the path stops at the space').toEqual([
      'D:\\p\\my',
      'dir\\a.foo',
    ]);

    settings.editor.links.knownFileExtensions = [...settings.editor.links.knownFileExtensions, 'foo'];
    expect(spans(), 'added: the very next pass crosses the space to `a.foo`').toEqual(['D:\\p\\my dir\\a.foo']);

    settings.editor.links.knownFileExtensions = [];
    expect(spans(), 'cleared: no extension ends a spaced path').toEqual(['D:\\p\\my', 'dir\\a.foo']);
  });
});

describe('T248 — a known-extension edit changes the next terminal view pass (FR-178)', () => {
  it('adding `foo` to knownFileExtensions, then clearing it, with the view pass built before either', () => {
    const text = 'see D:\\p\\my dir\\a.foo here';
    let marked: string[] = [];
    let clock = 0;
    // Built ONCE, as `use-terminal.ts` builds it, reading the settings object that changes behind it.
    const view = createLinkViewMarks({
      onRender: () => () => {},
      onBufferChange: () => () => {},
      logicalLinesInView: () => [{ text, firstY: 1, rowStarts: [0] }],
      scan: terminalViewScan({
        links: () => settings.editor.links,
        detect: () => settings.editor.links.detectInTerminals,
      }),
      oscLinksInView: () => [],
      draw: (links) => {
        marked = links.filter((l) => l.kind === 'file').map((l) => l.text);
      },
      clear: () => {},
      // Every pass a full throttle interval after the last, so `refresh` runs one at once.
      now: () => (clock += 1_000),
      schedule: () => () => {},
    });

    expect(marked, 'shipped set: `.foo` is not known, so the path stops at the space').toEqual([
      'D:\\p\\my',
      'dir\\a.foo',
    ]);

    settings.editor.links.knownFileExtensions = [...settings.editor.links.knownFileExtensions, 'foo'];
    view.refresh();
    expect(marked, 'added: the very next pass crosses the space to `a.foo`').toEqual(['D:\\p\\my dir\\a.foo']);

    settings.editor.links.knownFileExtensions = [];
    view.refresh();
    expect(marked, 'cleared: no extension ends a spaced path').toEqual(['D:\\p\\my', 'dir\\a.foo']);

    settings.editor.links.detectInTerminals = false;
    view.refresh();
    expect(marked, 'FR-060: detection in terminals off — no guessed path is marked').toEqual([]);
    view.dispose();
  });
});

/**
 * 045 T248, the allowlist half (FR-159) — taking `mailto` off `editor.links.protocolAllowlist` and
 * putting it back changes the NEXT editor decoration pass and the NEXT terminal view pass, with the deps
 * and the view pass built before either edit. Written once T258's `throng:linkUri:openExternal` gave a
 * protocol mark a route to follow.
 */
describe('T248 — an allowlist edit changes the next pass in both panel types (FR-159)', () => {
  const MAIL = 'write to mailto:a@b.c now';

  it('the editor: mailto on, off, on again, with the deps built before either', () => {
    const doc = `${MAIL}\n`;
    const state = EditorState.create({ doc });
    const deps = {
      detect: () => settings.editor.links.detectInEditors,
      site: () => ({ panelId: 'editor-1', originProjectId: 'project-1', baseDirectory: ROOT }),
      ask: answer,
      follow: () => {},
      scanOptions: () => linkScanOptions(settings.editor.links),
    } as EditorLinkDeps;
    const spans = (): string[] => linkHitsBetween(state, 0, doc.length, deps).map((h) => doc.slice(h.from, h.to));

    expect(spans(), 'shipped allowlist: mailto is a link').toEqual(['mailto:a@b.c']);
    settings.editor.links.protocolAllowlist = ['tel', 'slack'];
    expect(spans(), 'off the allowlist: the very next pass draws nothing').toEqual([]);
    settings.editor.links.protocolAllowlist = ['tel', ' MailTo: '];
    expect(spans(), 'back on, as typed (FR-159b)').toEqual(['mailto:a@b.c']);
  });

  it('the terminal: mailto on, off, on again, with the view pass built before either', () => {
    let marked: string[] = [];
    let clock = 0;
    const view = createLinkViewMarks({
      onRender: () => () => {},
      onBufferChange: () => () => {},
      logicalLinesInView: () => [{ text: MAIL, firstY: 1, rowStarts: [0] }],
      scan: terminalViewScan({
        links: () => settings.editor.links,
        detect: () => settings.editor.links.detectInTerminals,
      }),
      oscLinksInView: () => [],
      draw: (links) => {
        marked = links.map((l) => l.text);
      },
      clear: () => {},
      now: () => (clock += 1_000),
      schedule: () => () => {},
    });

    expect(marked, 'shipped allowlist: mailto is marked').toEqual(['mailto:a@b.c']);
    settings.editor.links.protocolAllowlist = ['tel'];
    view.refresh();
    expect(marked, 'off the allowlist: not marked on the next pass').toEqual([]);
    settings.editor.links.protocolAllowlist = ['mailto'];
    view.refresh();
    expect(marked, 'back on: marked again').toEqual(['mailto:a@b.c']);
    view.dispose();
  });
});

/**
 * 045 T287 (FR-159, US13 scenario 8; research R34) — an allowlisted `ms-msdt:` is NOT drawn as a link
 * once the platform's refused set has arrived: refused wins over the allowlist, for drawing too.
 */
describe('T287 — a platform-refused scheme is not drawn, even allowlisted (FR-159)', () => {
  afterEach(() => {
    __resetRefusedSchemesForTests();
  });

  it('ms-msdt on the allowlist: drawn only until the platform set arrives, then never', async () => {
    let respond: (schemes: string[]) => void = () => {};
    (window as unknown as { throng: Record<string, unknown> }).throng.linkUri = {
      openExternal: () => {},
      refusedSchemes: () =>
        new Promise<string[]>((resolve) => {
          respond = resolve;
        }),
    };
    __resetRefusedSchemesForTests();
    settings.editor.links.protocolAllowlist = ['mailto', 'ms-msdt'];
    const doc = 'run ms-msdt:x or mailto:a@b.c\n';
    const state = EditorState.create({ doc });
    const deps = {
      detect: () => true,
      site: () => ({ panelId: 'editor-1', originProjectId: 'project-1', baseDirectory: ROOT }),
      ask: answer,
      follow: () => {},
      scanOptions: () => linkScanOptions(settings.editor.links),
    } as EditorLinkDeps;
    const spans = (): string[] => linkHitsBetween(state, 0, doc.length, deps).map((h) => doc.slice(h.from, h.to));

    expect(spans(), 'core’s half alone does not name ms-msdt, so it draws until main answers').toEqual([
      'ms-msdt:x',
      'mailto:a@b.c',
    ]);
    respond(['ms-msdt', 'search-ms']);
    await Promise.resolve();
    await Promise.resolve();
    expect(spans(), 'the platform set has arrived: ms-msdt is not a link, whatever the allowlist says').toEqual([
      'mailto:a@b.c',
    ]);
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
    expect(await outcome(resolver.resolve(request('\\\\fileserver\\home\\a.txt')), 2000)).toMatchObject({
      ok: false,
      reason: 'unreachable',
    });

    // A different root, so FR-121's gate on the first one is not what answers.
    (settings.editor.links as unknown as Record<string, number>).existenceCheckTimeoutMs = 5000;
    const second = resolver.resolve(request('\\\\nas\\share\\b.txt'));
    expect(await outcome(second, 2000), 'the raised timeout is in force for the very next check').toBe('pending');
    expect(await outcome(second, 3000)).toMatchObject({ ok: false, reason: 'unreachable' });
  });
});
