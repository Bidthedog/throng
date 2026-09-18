import { beforeEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  DEFAULT_APP_SETTINGS,
  SHIPPED_PREVIEW_PROVIDERS,
  type AppSettings,
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

/**
 * 045 T108, FR-050 / SC-008 — *Default link action* applies to the **next gesture**, in both panel
 * types, with nothing remounted.
 *
 * ══ WHY THIS NEEDS A TEST OF ITS OWN ══
 *
 * Both surfaces build their link performers ONCE and hold them across the panel's whole life: the
 * terminal in a `useMemo` that the mount effect reads through a ref, the editor in a function the
 * CodeMirror extension closes over. Neither is rebuilt when a preference changes, and neither can be
 * — rebuilding the terminal's would tear down and re-attach a live shell.
 *
 * So a `defaultAction` VALUE on those deps is a value captured at mount, and a user who changes the
 * preference would keep the old behaviour until they closed the panel. `linkRouting` therefore takes
 * a READER and `followLink` consults it at the gesture. The assertions below change the settings
 * object *behind* deps that were built before the change, which is exactly the shape the running app
 * has.
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
let reads = 0;
const osCalls: string[] = [];

const routingInputs = (): LinkRoutingInputs => {
  reads += 1;
  return {
    defaultAction: settings.editor.links.defaultAction,
    previewRegistry: SHIPPED_PREVIEW_PROVIDERS,
    previewSettings: settings.editor.previews,
  };
};

beforeEach(() => {
  settings = structuredClone(DEFAULT_APP_SETTINGS);
  reads = 0;
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
  /** Drive one gesture through this panel's plumbing, using the deps it built at mount. */
  gesture(): Promise<void>;
}

/** A terminal panel, with its performers built ONCE — as `terminal-panel.tsx`'s `useMemo` does. */
function terminalPanel(): Panel {
  const performed: string[] = [];
  const deps: LinkFollowDeps = {
    openInEditor: (l) => void performed.push(`editor:${l.path}`),
    openInPreview: (l) => void performed.push(`preview:${l.path}`),
    reportFailure: (o) => void performed.push(`failure:${o.reason}`),
    ...linkRouting(routingInputs),
  };
  const provider = createFileLinkProvider({
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
  let pending: Promise<void> = Promise.resolve();
  return {
    performed,
    async gesture() {
      let links: { activate(event: MouseEvent, text: string): void }[] = [];
      provider.provideLinks(1, (provided) => {
        links = provided ?? [];
      });
      links[0]!.activate({ ctrlKey: true, metaKey: false } as MouseEvent, 'src/foo.ts');
      await pending;
    },
  };
}

/** An editor panel, with its performers built ONCE — as the link extension's deps are. */
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
      expect(followLinkAtCaret(view, editorDeps)).toBe(true);
      await pending;
    },
  };
}

const PANELS = [
  ['terminal', terminalPanel],
  ['editor', editorPanel],
] as const;

describe('SC-008 — a preference change lands on the next gesture, in both panel types', () => {
  it('with the panel’s performers built before the change', async () => {
    for (const [name, build] of PANELS) {
      settings = structuredClone(DEFAULT_APP_SETTINGS);
      osCalls.length = 0;
      const panel = build(); // mounted while the shipped value is in force

      await panel.gesture();
      expect(panel.performed, `${name}: the shipped value opens an editor`).toEqual([`editor:${TS}`]);

      settings.editor.links.defaultAction = 'osExplorer';
      await panel.gesture();
      expect(osCalls, `${name}: the change applied with nothing remounted`).toEqual([
        'osExplorer:src/foo.ts',
      ]);
      expect(panel.performed, `${name}: and opened no second editor`).toEqual([`editor:${TS}`]);

      settings.editor.links.defaultAction = 'osDefaultProgram';
      await panel.gesture();
      expect(osCalls, `${name}: and again, the very next gesture`).toEqual([
        'osExplorer:src/foo.ts',
        'osDefaultProgram:src/foo.ts',
      ]);
    }
  });

  it('the preference is READ at the gesture, not once at mount', async () => {
    reads = 0;
    const panel = terminalPanel();
    const atMount = reads;
    await panel.gesture();
    await panel.gesture();
    expect(reads, 'each gesture consults the live settings').toBeGreaterThan(atMount + 1);
  });

  it('a provider’s own default open action is live too (FR-051)', async () => {
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

    await followLink({ request, resolve: resolveMd, deps });
    expect(performed, 'shipped: Markdown opens an editor').toEqual([`editor:${mdLink.path}`]);

    settings.editor.previews.providers[markdown!.id]!.defaultOpenAction = 'preview';
    await followLink({ request, resolve: resolveMd, deps });
    expect(performed, 'and the change applies to the next gesture').toEqual([
      `editor:${mdLink.path}`,
      `preview:${mdLink.path}`,
    ]);
  });
});
