import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SHIPPED_PREVIEW_PROVIDERS,
  createProject,
  previewPathOf,
  serialiseHistory,
  toCanonicalPath,
  type Panel,
  type PathSeparator,
  type PreviewPanelConfig,
  type WorkspaceLayout,
} from '@throng/core';
import { openDatabase, runMigrations, ProjectRepository, WorkspaceRepository, type ThrongDatabase } from '@throng/persistence';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { PreviewService } from '../../src/main/preview-service.js';
import { NavigationHistoryService } from '../../src/main/navigation-history-service.js';
import { viewEndsPreview } from '../../src/renderer/preview/forget-preview-panel.js';
import { SubWorkspaceWorkspaceClient } from '../../src/renderer/state/subworkspace-window-client.js';
import { lateListener, liveSettings, manualWatcher, recordingPush, recordingWindows } from './helpers/preview-harness.js';

/**
 * 044 T143 — a layout holding a preview and an editor round-trips through a REAL `WorkspaceRepository`
 * row with its history (FR-066, FR-068, FR-109, SC-007's restart half).
 *
 * The state going in is produced the way the app produces it, not hand-built: main's history authority
 * and `PreviewService` decide it, and the config is what a window's mirrors would write from their
 * broadcasts — `config.history = serialiseHistory(h)` from `throng:history:changed`, and a preview's
 * `config.filePath` from `throng:preview:pathChanged`. So a change to what main records or broadcasts
 * is caught here as well as a change to what the repository stores.
 *
 * Paths go in spelled with forward slashes, as the tree produces them, and must come back in the host's
 * storage canon (FR-068) — the history's entries included, which are the first absolute paths in a
 * layout blob that live inside an array.
 */

const OWNER = 'alice';
const HOST = sep as PathSeparator;
const fs = new NodeFileSystem(async () => {});

let dataDir: string;
let db: ThrongDatabase;
let workspaces: WorkspaceRepository;
let projects: ProjectRepository;

let root: string;
let recoveryDir: string;
let readme: string;
let setup: string;
let app: string;
let pathChanged: Array<{ panelId: string; filePath: string }>;
let coord: EditorCoordinator;
let previews: PreviewService;
let history: NavigationHistoryService;

/** The tree's spelling: forward slashes, whatever the host. */
const treePath = (...parts: string[]) => join(...parts).replace(/\\/g, '/');

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'throng-preview-persist-db-'));
  db = openDatabase({ databasePath: join(dataDir, 'throng.db') });
  runMigrations(db);
  projects = new ProjectRepository(db);
  workspaces = new WorkspaceRepository(db);

  root = await mkdtemp(join(tmpdir(), 'throng-preview-persist-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-preview-persist-rec-'));
  await mkdir(join(root, 'docs'));
  await mkdir(join(root, 'src'));
  readme = treePath(root, 'README.md');
  setup = treePath(root, 'docs', 'setup.md');
  app = treePath(root, 'src', 'app.ts');
  await writeFile(readme, '# Readme\n\n[Setup](docs/setup.md)\n');
  await writeFile(setup, '# Setup\n');
  await writeFile(app, 'export const app = 1;\n');

  const settings = liveSettings();
  const push = recordingPush();
  pathChanged = push.pathChanged;
  history = new NavigationHistoryService({ cap: () => 10, broadcastChanged: () => {} });
  const relay = lateListener();
  const service = new EditorService(fs, settings.get);
  coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10_000,
    relaySync: () => {},
    persistUndoHistory: () => false,
    documentLifecycle: relay,
    history,
  });
  previews = new PreviewService({
    documents: coord,
    reader: service,
    fs,
    fileWatcher: manualWatcher(),
    settings: settings.get,
    registry: SHIPPED_PREVIEW_PROVIDERS,
    projectRoot: async (id) => (id === 'P' ? root : undefined),
    push,
    windows: recordingWindows(),
    history,
  });
  relay.bind(previews);
});

afterEach(async () => {
  previews.destroyed('pv1');
  for (const id of ['ed-setup', 'ed-app']) coord.destroy(id);
  db.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  for (const dir of [root, recoveryDir]) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function seedProject(): string {
  const project = createProject(
    { name: 'Docs', colour: '#6aa3ff', rootFolder: root },
    { id: 'P', ownerUser: OWNER, now: new Date().toISOString(), isActive: false },
  );
  projects.insert(project);
  return project.id;
}

/** What each window's mirrors write for a panel it holds, from main's broadcasts. */
function mirroredPreviewConfig(panelId: string, attachedWith: string): PreviewPanelConfig {
  const lastPath = [...pathChanged].reverse().find((p) => p.panelId === panelId)?.filePath ?? attachedWith;
  return { filePath: lastPath, history: serialiseHistory(history.get(panelId)!) };
}

function mirroredEditorConfig(panelId: string, filePath: string): Record<string, unknown> {
  return { filePath, history: serialiseHistory(history.get(panelId)!) };
}

/** Save a layout whose one tab holds `panel`, and read it back out of the row. */
function roundTrip(projectId: string, panel: Panel): Panel {
  const base = workspaces.load(OWNER, projectId).layout;
  const layout: WorkspaceLayout = { ...base, tabs: [{ id: base.tabs[0].id, title: 'Tab 1', root: panel }] };
  workspaces.save(OWNER, projectId, layout);
  return workspaces.load(OWNER, projectId).layout.tabs[0].root as Panel;
}

describe('a preview and an editor round-trip with their histories (FR-066, FR-109)', () => {
  it('a preview that followed a link from README to setup comes back on setup, in canonical form, with zoom', async () => {
    const projectId = seedProject();
    // Parented: an editor holds setup, so the run follows that document — and none of that may persist.
    expect((await coord.load({ panelId: 'ed-setup', windowId: '7', ownerKind: 'project', ownerProjectId: 'P', ownerRoot: root, allProjectRoots: [root], tabId: 't1', absPath: setup })).ok).toBe(true);
    const attached = await previews.attach(7, { panelId: 'pv1', projectId: 'P', filePath: readme });
    expect(attached.ok).toBe(true);
    const followed = await previews.navigate(7, {
      panelId: 'pv1',
      target: { absPath: setup },
      intent: { kind: 'link' },
      leavingViewState: { line: 3 },
    });
    expect(followed.kind === 'shown' && followed.update.parent).toMatchObject({ panelId: 'ed-setup' });

    const preview: Panel = {
      type: 'panel',
      id: 'pv1',
      originProjectId: 'P',
      title: 'setup.md',
      kind: 'preview',
      zoom: 2,
      config: mirroredPreviewConfig('pv1', readme),
    };
    const restored = roundTrip(projectId, preview);
    const config = restored.config as PreviewPanelConfig;

    expect(restored.zoom).toBe(2);
    expect(config.filePath).toBe(toCanonicalPath(setup, HOST));
    expect(config.history).toEqual({
      v: 1,
      entries: [
        { filePath: toCanonicalPath(readme, HOST), viewState: { line: 3 } },
        { filePath: toCanonicalPath(setup, HOST) },
      ],
      index: 1,
    });
    // filePath and the history's current entry agree — and the precedence reader says setup either way.
    expect(previewPathOf(config)).toBe(toCanonicalPath(setup, HOST));
  });

  it('never writes parented state or a parent id (FR-066, data-model §9)', async () => {
    const projectId = seedProject();
    expect((await coord.load({ panelId: 'ed-setup', windowId: '7', ownerKind: 'project', ownerProjectId: 'P', ownerRoot: root, allProjectRoots: [root], tabId: 't1', absPath: setup })).ok).toBe(true);
    const attached = await previews.attach(7, { panelId: 'pv1', projectId: 'P', filePath: setup });
    expect(attached.ok && attached.update.parent).toMatchObject({ panelId: 'ed-setup' });

    const restored = roundTrip(projectId, {
      type: 'panel',
      id: 'pv1',
      originProjectId: 'P',
      title: 'setup.md',
      kind: 'preview',
      config: mirroredPreviewConfig('pv1', setup),
    });

    expect(Object.keys(restored.config ?? {}).sort()).toEqual(['filePath', 'history']);
    const stored = JSON.stringify(restored);
    for (const leak of ['ed-setup', 'parent', 'dirty', 'notice', 'revision']) expect(stored).not.toContain(leak);
  });

  it('an editor’s history round-trips beside it, paths canonical, no view state (FR-101, FR-109)', async () => {
    const projectId = seedProject();
    const load = (absPath: string) =>
      coord.load({ panelId: 'ed-app', windowId: '7', ownerKind: 'project', ownerProjectId: 'P', ownerRoot: root, allProjectRoots: [root], tabId: 't1', absPath });
    expect((await load(readme)).ok).toBe(true);
    expect((await load(app)).ok).toBe(true);

    const restored = roundTrip(projectId, {
      type: 'panel',
      id: 'ed-app',
      originProjectId: 'P',
      title: 'app.ts',
      kind: 'editor',
      config: mirroredEditorConfig('ed-app', app),
    });

    expect(restored.config).toEqual({
      filePath: toCanonicalPath(app, HOST),
      history: {
        v: 1,
        entries: [{ filePath: toCanonicalPath(readme, HOST) }, { filePath: toCanonicalPath(app, HOST) }],
        index: 1,
      },
    });
  });

  it('what comes back restores the run on the history’s current entry, with its Back entry intact (SC-007)', async () => {
    const projectId = seedProject();
    await previews.attach(7, { panelId: 'pv1', projectId: 'P', filePath: readme });
    await previews.navigate(7, { panelId: 'pv1', target: { absPath: setup }, intent: { kind: 'link' } });
    const restored = roundTrip(projectId, {
      type: 'panel',
      id: 'pv1',
      originProjectId: 'P',
      title: 'setup.md',
      kind: 'preview',
      config: mirroredPreviewConfig('pv1', readme),
    });
    const config = restored.config as PreviewPanelConfig;

    // A restart: main holds nothing, and the persisted filePath is deliberately stale.
    previews.destroyed('pv1');
    const again = await previews.attach(7, {
      panelId: 'pv1',
      projectId: 'P',
      filePath: toCanonicalPath(readme, HOST),
      history: config.history,
    });

    expect(again.ok && again.update.filePath).toBe(toCanonicalPath(setup, HOST));
    expect(history.get('pv1')!.entries.map((e) => e.filePath)).toEqual([
      toCanonicalPath(readme, HOST),
      toCanonicalPath(setup, HOST),
    ]);
    expect(history.get('pv1')!.index).toBe(1);
  });
});

/*
 * Review finding 2 — WHICH WINDOW ENDS THE RUN, after a relaunch (FR-012, FR-014).
 *
 * A preview opened in a sub-workspace window belongs to the real project it previews, and lives in that
 * window's own `subworkspace:<id>` layout — the same shape as a project preview SYNCED into the window,
 * which is a second view of a run the project still shows. The window that must tell them apart after a
 * relaunch is a new process: whatever it knows, it read out of the sub-workspace row. So the row is the
 * thing under test here, through the REAL repository, and the rule is applied to exactly what comes back.
 *
 * The renderer half — that closing such a panel takes the route this decides — is
 * `preview-destroy-routes.test.ts`; nothing here mounts a window.
 */
describe('a sub-workspace’s own preview survives a relaunch as its own (FR-012)', () => {
  const SUB_LAYOUT = SubWorkspaceWorkspaceClient.layoutProjectId('sw-1');

  /** A sub-workspace row holding one tab per panel, as the window's save writes it. */
  function roundTripSub(panels: Panel[]): Panel[] {
    workspaces.persistSubWorkspaces(OWNER, [
      {
        id: 'sw-1',
        ownerUser: OWNER,
        name: 'Docs',
        colour: '#6aa3ff',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        tabs: panels.map((panel, i) => ({ id: `t${i + 1}`, title: `Tab ${i + 1}`, root: panel, activePanelId: panel.id })),
        activeTabId: 't1',
      },
    ]);
    const sub = workspaces.loadSubWorkspaces(OWNER).find((s) => s.id === 'sw-1');
    return (sub?.tabs ?? []).map((t) => t.root as Panel);
  }

  const previewPanel = (id: string, placedInLayoutProjectId: string): Panel => ({
    type: 'panel',
    id,
    // The project's, on BOTH: a preview panel owned by the sub-workspace's synthetic id is refused at
    // attach (review I-1), so origin cannot be what separates them.
    originProjectId: 'P',
    title: 'README.md',
    kind: 'preview',
    config: { filePath: readme, placedInLayoutProjectId },
  });

  it('the placing layout comes back out of the row, and decides the close both ways', () => {
    const [opened, synced] = roundTripSub([previewPanel('pv-opened', SUB_LAYOUT), previewPanel('pv-synced', 'P')]);

    expect((opened.config as PreviewPanelConfig).placedInLayoutProjectId).toBe(SUB_LAYOUT);
    expect((synced.config as PreviewPanelConfig).placedInLayoutProjectId).toBe('P');

    const place = { inSubWorkspace: true, layoutProjectId: SUB_LAYOUT };
    // The one this window opened is its to end: nothing else holds a view, so nothing else can end it.
    expect(viewEndsPreview(opened, place)).toBe(true);
    // The one synced in from the project window is not: the project still shows that run.
    expect(viewEndsPreview(synced, place)).toBe(false);
  });

  it('a row written before the field decides as it did then — the origin rule alone', () => {
    const [legacy] = roundTripSub([
      { type: 'panel', id: 'pv-old', originProjectId: 'P', title: 'README.md', kind: 'preview', config: { filePath: readme } },
    ]);

    expect((legacy.config as PreviewPanelConfig).placedInLayoutProjectId).toBeUndefined();
    expect(viewEndsPreview(legacy, { inSubWorkspace: true, layoutProjectId: SUB_LAYOUT })).toBe(false);
  });
});
