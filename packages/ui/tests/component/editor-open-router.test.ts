/**
 * The default open action router (044 US4 — FR-050 – FR-055, FR-062; research R20).
 *
 * ══ WHAT IS ROUTED, AND WHAT IS NOT ══
 *
 * A default open action of Preview is a REFINEMENT of 006 FR-011/FR-012/FR-013 and 033 FR-009: a click
 * or Enter in Files & Folders, and a Quick Open pick, open the file's preview instead of an editor
 * (FR-052) — and when the file is already open in an editor, the SAME `preview.open` command places the
 * preview beside it or focuses the one already open (FR-053; main decides, contracts/preview-ipc.md §1).
 *
 * Two routes are deliberately NOT refined: a Find in Files result always opens an editor at the match
 * (FR-054, 043 FR-037/FR-087c), and Open In's editor targets always open an editor (FR-055). Both are
 * asserted here against a Markdown provider set to Preview, because at the shipped default (Editor)
 * "always calls openFileInTab" is true of every route and proves nothing.
 *
 * ══ THE SEAMS ══
 *
 * `openFileInTab` is mocked at its module (the `quick-open-header.test.ts` precedent), so the call log
 * names the exact route taken. `preview.open` is observed through `registerPreviewOpener` — the real
 * registration every entry point asks through — so no preview module is mocked at all.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Every "no editor" assertion is paired with the opener having been called, and every "editor" one
 * with the opener NOT having been called; set Markdown's action back to `editor` in `PREVIEW` and the
 * FR-052/FR-053 tests fail on the opener, while the FR-054/FR-055 tests keep passing for the right
 * reason.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SHIPPED_PREVIEW_PROVIDERS,
  collectPanels,
  createDefaultLayout,
  parsePreviewSettings,
  type WorkspaceLayout,
} from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import {
  registerPreviewOpener,
  type OpenPreviewOutcome,
  type PreviewOpenIntent,
} from '../../src/renderer/preview/open-preview.js';
import { openFromQuickOpen, openFromTree, type OpenRoute } from '../../src/renderer/editor/open-router.js';
import { openResultRow } from '../../src/renderer/find-in-files/result-open.js';
import { performOpenIn } from '../../src/renderer/editor/open-in-perform.js';
import { EditorOpenListener } from '../../src/renderer/editor/editor-open.js';
import { QuickOpen } from '../../src/renderer/navigate/quick-open.js';

const openFileInTab = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../src/renderer/editor/editor-open.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/editor/editor-open.js')>()),
  openFileInTab,
}));

const PROJECT = 'project-1';
const ROOT = 'D:/proj';
const README = `${ROOT}/README.md`;
const SOURCE = `${ROOT}/src/app.ts`;

const PREVIEW = { providers: { markdown: { enabled: true, defaultOpenAction: 'preview' } } };
const PREVIEW_OFF = { providers: { markdown: { enabled: false, defaultOpenAction: 'preview' } } };

type Ws = ReturnType<typeof useWorkspace>;

/** A workspace slice holding one tab — enough for every route, none of which is mounted here. */
function sliceWs(): Ws {
  const layout: WorkspaceLayout = createDefaultLayout(PROJECT, { tab: 'tab-1', panel: 'panel-1' });
  return { layout } as unknown as Ws;
}

function route(previews: unknown, projectId: string | null = PROJECT): OpenRoute {
  return {
    registry: SHIPPED_PREVIEW_PROVIDERS,
    previews: parsePreviewSettings(previews, SHIPPED_PREVIEW_PROVIDERS),
    projectId,
    openInEditor: openFileInTab,
  };
}

let opened: PreviewOpenIntent[] = [];

/** The default fake opener answers as main does for an ordinary placement — a real refusal is
 *  registered per-test below (044 US4 fix round 1, item 5). */
const PLACED: OpenPreviewOutcome = { kind: 'placed', panelId: 'panel-x' };

beforeEach(() => {
  opened = [];
  registerPreviewOpener((intent) => {
    opened.push(intent);
    return Promise.resolve(PLACED);
  });
  openFileInTab.mockClear();
  openFileInTab.mockResolvedValue(true);
});

afterEach(() => {
  registerPreviewOpener(null);
  Reflect.deleteProperty(window, 'throng');
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The router itself
 * ────────────────────────────────────────────────────────────────────────── */

describe('a default open action of Preview opens the preview, not an editor (FR-052, FR-053)', () => {
  it('openFromTree asks preview.open for the file in its project, and opens no editor', async () => {
    const result = await openFromTree(sliceWs(), README, 'lastActive', route(PREVIEW));
    expect(opened).toEqual([{ absPath: README, projectId: PROJECT }]);
    expect(openFileInTab).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('openFromQuickOpen does the same, and still answers that a file was opened', async () => {
    const result = await openFromQuickOpen(sliceWs(), 'tab-1', README, 'lastActive', route(PREVIEW));
    expect(opened).toEqual([{ absPath: README, projectId: PROJECT }]);
    expect(openFileInTab).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('a file already open in an editor goes to the same preview.open, with no requester (FR-053)', async () => {
    // Main owns "beside its editor, or focus the preview already open" (§1). The router's whole part is
    // to ask for it — naming no requester, so main looks the document up rather than trusting a panel.
    const ws = sliceWs();
    const layout = ws.layout as WorkspaceLayout;
    const panel = collectPanels(layout.tabs[0].root)[0];
    Object.assign(panel, { kind: 'editor', config: { filePath: README } });

    await openFromTree(ws, README, 'lastActive', route(PREVIEW));

    expect(opened).toEqual([{ absPath: README, projectId: PROJECT }]);
    expect(opened[0]).not.toHaveProperty('requesterPanelId');
    expect(openFileInTab).not.toHaveBeenCalled();
  });
});

/*
 * 044 US4 fix round 1, item 5 — a preview request main REFUSES must not, on its own, count as opened:
 * `opened` in Quick Open's `choose` (FR-061) must reflect whether something ACTUALLY appeared, not
 * whether a preview was merely asked for. The router already falls through to the editor route for
 * every other case where Preview turns out not to apply (a disabled provider, the shipped default,
 * a file no provider claims) — a refusal, discovered only after the round trip to main rather than
 * synchronously, takes that same fallback rather than reporting a false "opened" for nothing shown.
 */
describe('a refusal from main falls through to the editor route, not a false "opened" (item 5)', () => {
  it('openFromTree still asks preview.open, then opens an editor — and THAT is what "opened" reports', async () => {
    registerPreviewOpener((intent) => {
      opened.push(intent);
      return Promise.resolve({ kind: 'refused', reason: 'disabled' });
    });

    const result = await openFromTree(sliceWs(), README, 'lastActive', route(PREVIEW));

    expect(opened).toEqual([{ absPath: README, projectId: PROJECT }]);
    expect(openFileInTab).toHaveBeenCalledWith(expect.anything(), 'tab-1', README, 'lastActive', undefined);
    expect(result).toBe(true);
  });

  it('openFromQuickOpen: same fallback, and it answers false when the editor route itself declines', async () => {
    registerPreviewOpener((intent) => {
      opened.push(intent);
      return Promise.resolve({ kind: 'refused', reason: 'no-file' });
    });
    // The editor route declining too (a cancelled unsaved-open prompt, 033 FR-061) is what a genuine
    // "opened nothing at all" looks like — the case the query must not be remembered for.
    openFileInTab.mockResolvedValueOnce(false);

    const result = await openFromQuickOpen(sliceWs(), 'tab-1', README, 'lastActive', route(PREVIEW));

    expect(opened).toEqual([{ absPath: README, projectId: PROJECT }]);
    expect(openFileInTab).toHaveBeenCalledOnce();
    expect(result).toBe(false);
  });
});

describe('an editor where Preview is not the answer (FR-050, FR-062)', () => {
  it('a disabled provider suspends Preview: the file opens in an editor', async () => {
    await openFromTree(sliceWs(), README, 'lastActive', route(PREVIEW_OFF));
    expect(opened).toEqual([]);
    expect(openFileInTab).toHaveBeenCalledWith(expect.anything(), 'tab-1', README, 'lastActive', undefined);
  });

  it('the shipped default (Editor) calls openFileInTab exactly as before', async () => {
    await openFromTree(sliceWs(), README, 'new', route({}));
    expect(opened).toEqual([]);
    expect(openFileInTab).toHaveBeenCalledWith(expect.anything(), 'tab-1', README, 'new', undefined);
  });

  it('a file no provider claims opens in an editor', async () => {
    await openFromTree(sliceWs(), SOURCE, 'lastActive', route(PREVIEW));
    expect(opened).toEqual([]);
    expect(openFileInTab).toHaveBeenCalledOnce();
  });

  it('with no project to ask a preview for (a rootless window), opens an editor rather than nothing', async () => {
    await openFromQuickOpen(sliceWs(), 'tab-1', README, 'lastActive', route(PREVIEW, null));
    expect(opened).toEqual([]);
    expect(openFileInTab).toHaveBeenCalledOnce();
  });

  it('Quick Open passes the editor route’s answer through — a cancelled open is not an open (033 FR-061)', async () => {
    openFileInTab.mockResolvedValueOnce(false);
    await expect(openFromQuickOpen(sliceWs(), 'tab-1', SOURCE, 'lastActive', route({}))).resolves.toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The routes that are NOT refined
 * ────────────────────────────────────────────────────────────────────────── */

describe('Find in Files and Open In always open an editor (FR-054, FR-055)', () => {
  /*
   * Neither route reads the default open action at all — proved STRUCTURALLY, not by racing a live
   * setting. `openResultRow` and `performOpenIn` (below) never touch `route` or `defaultOpenActionFor`;
   * they call `openFileInTab` directly, as the module doc above says (`openFromTree`/`openFromQuickOpen`
   * are the ONLY two callers `route()` feeds). Neither test below sets Markdown to Preview through
   * `window.throng.config` at all — `sliceWs()` mounts nothing, so there is no config to read — which is
   * consistent with that guarantee, not a demonstration of it: a route that started consulting the
   * setting would still see no `route` object to consult and would fail to compile, not to run.
   */
  it('a Find in Files result row opens an editor at the match', async () => {
    await openResultRow({
      ws: sliceWs(),
      projectRoot: ROOT,
      openTarget: 'lastActive',
      request: { relPath: 'README.md', from: 3, to: 9 },
    });
    expect(opened).toEqual([]);
    expect(openFileInTab).toHaveBeenCalledWith(expect.anything(), 'tab-1', expect.stringMatching(/README\.md$/), 'lastActive', {
      from: 3,
      to: 9,
    });
  });

  it('Open In → New Editor opens an editor', async () => {
    await performOpenIn({ ws: sliceWs(), absPath: README, target: { kind: 'new' } });
    expect(opened).toEqual([]);
    expect(openFileInTab).toHaveBeenCalledWith(expect.anything(), 'tab-1', README, 'new', undefined);
  });

  it('Open In → Last Active Editor opens an editor', async () => {
    await performOpenIn({ ws: sliceWs(), absPath: README, target: { kind: 'lastActive' } });
    expect(opened).toEqual([]);
    expect(openFileInTab).toHaveBeenCalledOnce();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The wiring (T135): the tree's open intent, and Quick Open's choice
 * ────────────────────────────────────────────────────────────────────────── */

function fakeServices(layout: WorkspaceLayout): Services {
  const bridge: ThrongBridge = {
    invoke<T>(method: string): Promise<T> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout, restored: true } as T);
        case 'workspace.save':
          return Promise.resolve({ ok: true } as T);
        case 'projects.list':
          return Promise.resolve({ projects: [{ id: PROJECT, name: 'Proj', rootFolder: ROOT }] } as T);
        default:
          return Promise.resolve({} as T);
      }
    },
  };
  return {
    bridge,
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  } as Services;
}

const captured: { ws: Ws | null } = { ws: null };
function Probe(): null {
  captured.ws = useWorkspace();
  return null;
}
function WhenSettingsAreLive({ children }: { children: ReactNode }): ReactElement | null {
  return useConfigLoaded() ? createElement('div', null, children) : null;
}

/**
 * Mount the chrome and DO NOT RETURN UNTIL THIS TREE'S LISTENER IS LIVE.
 *
 * Both halves of that matter, and the second one is why this is `async`.
 *
 * `captured.ws` is a module-level slot: without the reset, a second mount in the same file finds the
 * PREVIOUS test's value already there, and a `waitFor(() => captured.ws?.layout)` written after the
 * mount is satisfied by it instantly — a gate that waits for nothing. That is what made the shipped-
 * default control flaky: `EditorOpenListener` lives inside `WhenSettingsAreLive` and does not exist
 * until `ConfigProvider`'s payload has arrived, so on a machine where that payload lost the race the
 * test dispatched `throng:open-file` into a window with no listener on it. Nothing re-dispatches, so
 * the intent was not late — it was dropped, and the test failed on `openInto` never being called.
 *
 * So the wait is for THIS tree's Probe (a sibling of `child` under `WhenSettingsAreLive`, so it
 * renders in the same commit), and the `act` flush that follows takes that commit's passive effects —
 * `EditorOpenListener`'s `addEventListener` among them — rather than assuming a poll interval
 * outran the scheduler.
 */
async function mountChrome(previews: unknown, child: ReactElement): Promise<{ openInto: ReturnType<typeof vi.fn> }> {
  captured.ws = null;
  const openInto = vi.fn(() => Promise.resolve({ action: 'open' }));
  Reflect.set(window, 'throng', {
    editor: { openInto },
    panel: { notifyTyped: () => {} },
    osName: 'windows',
    notices: { log: () => {} },
    config: { get: () => Promise.resolve({ settings: { editor: { previews } } }), onChange: () => () => {} },
  });
  const layout = createDefaultLayout(PROJECT, { tab: 'tab-1', panel: 'panel-1' });
  const services = fakeServices(layout);
  render(
    createElement(
      ServicesProvider,
      { services },
      createElement(
        ConfigProvider,
        null,
        createElement(
          ProjectsProvider,
          { client: services.projects },
          createElement(
            WorkspaceProvider,
            { client: services.workspace, activeProjectId: PROJECT },
            createElement(
              NotificationProvider,
              null,
              createElement(WhenSettingsAreLive, null, createElement(Probe, null), child),
            ),
          ),
        ),
      ),
    ),
  );
  await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
  await act(async () => {});
  return { openInto };
}

async function treeOpen(absPath: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new CustomEvent('throng:open-file', { detail: { projectId: PROJECT, relPath: 'README.md', absPath } }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('Files & Folders click and Enter go through the router (T135)', () => {
  it('with Markdown set to Preview, the open intent asks preview.open and opens no editor', async () => {
    const { openInto } = await mountChrome(PREVIEW, createElement(EditorOpenListener, null));

    await treeOpen(README);

    expect(opened).toEqual([{ absPath: README, projectId: PROJECT }]);
    // The editor route's first act is the one-buffer question to main; it was never asked.
    expect(openInto).not.toHaveBeenCalled();
    const panels = collectPanels(captured.ws!.layout!.tabs[0].root);
    expect(panels.filter((p) => p.kind === 'editor')).toHaveLength(0);
  });

  it('at the shipped default the intent reaches the editor route (the control)', async () => {
    const { openInto } = await mountChrome({}, createElement(EditorOpenListener, null));

    await treeOpen(README);

    expect(opened).toEqual([]);
    await waitFor(() => expect(openInto).toHaveBeenCalled());
  });
});

describe('Quick Open’s choice goes through the router (T135)', () => {
  function quickOpen(projectId?: string): ReactElement {
    return createElement(QuickOpen, {
      root: ROOT,
      ...(projectId !== undefined ? { projectId } : {}),
      index: { status: 'ready', paths: ['README.md', 'src/app.ts'] },
      invokedFrom: null,
      includeHidden: false,
      onIncludeHiddenChange: () => {},
      onDismiss: () => {},
    });
  }

  it('picking a Markdown file with Preview set asks preview.open, and opens no editor', async () => {
    const user = userEvent.setup();
    await mountChrome(PREVIEW, quickOpen(PROJECT));
    const input = await screen.findByTestId('quickopen-input');
    await user.click(input);
    await user.keyboard('README');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(opened).toEqual([{ absPath: README, projectId: PROJECT }]));
    expect(openFileInTab).not.toHaveBeenCalled();
  });

  it('picking a file no provider claims still opens it in an editor', async () => {
    const user = userEvent.setup();
    await mountChrome(PREVIEW, quickOpen(PROJECT));
    const input = await screen.findByTestId('quickopen-input');
    await user.click(input);
    await user.keyboard('app.ts');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(openFileInTab).toHaveBeenCalledWith(expect.anything(), 'tab-1', SOURCE, 'lastActive', undefined));
    expect(opened).toEqual([]);
  });
});
