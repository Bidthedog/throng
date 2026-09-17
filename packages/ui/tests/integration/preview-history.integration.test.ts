import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SHIPPED_PREVIEW_PROVIDERS,
  type NavigationHistory,
  type PersistedHistory,
  type PreviewNavigateRequest,
  type PreviewUpdate,
} from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { PreviewService, type PreviewHistoryHooks } from '../../src/main/preview-service.js';
import { NavigationHistoryService } from '../../src/main/navigation-history-service.js';
import { createHistoryPush } from '../../src/main/navigation-history-ipc.js';
import { lateListener, liveSettings, manualWatcher, recordingPush, recordingWindows } from './helpers/preview-harness.js';

/**
 * 044 T142 — a preview's history, kept by `PreviewService` against the real `NavigationHistoryService`,
 * over a real coordinator and temp tree (contracts/navigation-history.md §3 *Previews*,
 * contracts/preview-ipc.md §1 `attach` and `navigate`, FR-100 – FR-112).
 *
 * A preview never calls `throng:history:attach`: `preview.attach` adopts the record in main, so there is
 * one attach per panel. And the history's `changed` is a BROADCAST — asserted at two fake windows, one
 * of which views the run and one of which attached and then detached, as a background tab does.
 */

const fs = new NodeFileSystem(async () => {});

const VIEWER = 7;
const SECOND = 9;

let root: string;
let recoveryDir: string;
let readme: string;
let setup: string;
let install: string;
let push: ReturnType<typeof recordingPush>;
let coord: EditorCoordinator;
let previews: PreviewService;
let history: NavigationHistoryService;
let settings: ReturnType<typeof liveSettings>;
let watcher: ReturnType<typeof manualWatcher>;
let windowChanged: Map<number, Array<{ panelId: string; history: NavigationHistory | null }>>;
/** Paths whose read fails with an I/O error although the file exists (FR-106d, amended). */
let unreadable: Set<string>;
/** A second service over the same coordinator and push, with the history hooks a test chooses. */
let build: (hooks: PreviewHistoryHooks) => PreviewService;
let outside: string;

function historyWindow(id: number) {
  const received: Array<{ panelId: string; history: NavigationHistory | null }> = [];
  windowChanged.set(id, received);
  return {
    isDestroyed: () => false,
    webContents: {
      id,
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => {
        if (channel === 'throng:history:changed') {
          received.push(payload as { panelId: string; history: NavigationHistory | null });
        }
      },
    },
  };
}

function meta(panelId: string, absPath: string): DocMeta {
  return {
    panelId,
    windowId: String(VIEWER),
    ownerKind: 'project',
    ownerProjectId: 'P',
    ownerRoot: root,
    allProjectRoots: [root],
    tabId: 't1',
    absPath,
    encoding: 'utf8',
    hasBom: false,
    lineEnding: 'lf',
  };
}

async function attach(
  panelId: string,
  filePath: string,
  viewer = VIEWER,
  persisted?: PersistedHistory,
): Promise<PreviewUpdate> {
  const res = await previews.attach(viewer, {
    panelId,
    projectId: 'P',
    filePath,
    ...(persisted ? { history: persisted } : {}),
  });
  if (!res.ok) throw new Error(`attach refused: ${res.reason}`);
  return res.update;
}

const link = (panelId: string, absPath: string, leavingViewState?: unknown) =>
  previews.navigate(VIEWER, {
    panelId,
    target: { absPath },
    intent: { kind: 'link' },
    ...(leavingViewState !== undefined ? { leavingViewState } : {}),
  });

const step = (panelId: string, absPath: string, index: number, leavingViewState?: unknown) => {
  const req: PreviewNavigateRequest = { panelId, target: { absPath }, intent: { kind: 'history', index } };
  if (leavingViewState !== undefined) req.leavingViewState = leavingViewState;
  return previews.navigate(VIEWER, req);
};

const pathsOf = (panelId: string) => history.get(panelId)?.entries.map((e) => e.filePath);
const updatesTo = (viewer: number, panelId: string) =>
  push.updates.filter((u) => u.to === viewer && u.update.panelId === panelId).map((u) => u.update);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-preview-history-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-preview-history-rec-'));
  await mkdir(join(root, 'docs'));
  readme = join(root, 'README.md');
  setup = join(root, 'docs', 'setup.md');
  install = join(root, 'docs', 'install.md');
  await writeFile(readme, '# Readme\n');
  await writeFile(setup, '# Setup\n');
  await writeFile(install, '# Install\n');

  push = recordingPush();
  settings = liveSettings();
  watcher = manualWatcher();
  windowChanged = new Map();
  const windowsForHistory = [historyWindow(VIEWER), historyWindow(SECOND)];
  history = new NavigationHistoryService({
    cap: () => settings.current.editor.navigation.historySize,
    broadcastChanged: createHistoryPush({ all: () => windowsForHistory }).broadcastChanged,
  });
  const relay = lateListener();
  const service = new EditorService(fs, settings.get);
  coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10_000,
    relaySync: () => {},
    persistUndoHistory: () => false,
    documentLifecycle: relay,
    history,
  });
  unreadable = new Set();
  build = (hooks) =>
    new PreviewService({
      documents: coord,
      // The real read path, except for paths a test marks as failing with an I/O error while they exist.
      reader: {
        load: async (req) =>
          unreadable.has(req.absPath) ? { ok: false, reason: 'io', error: 'EIO: i/o error' } : service.load(req),
      },
      fs,
      fileWatcher: watcher,
      settings: settings.get,
      registry: SHIPPED_PREVIEW_PROVIDERS,
      projectRoot: async (id) => (id === 'P' ? root : undefined),
      push,
      windows: recordingWindows(),
      history: hooks,
    });
  previews = build(history);
  relay.bind(previews);
  outside = await mkdtemp(join(tmpdir(), 'throng-preview-history-outside-'));
  await writeFile(join(outside, 'secret.md'), '# Not yours\n');
});

afterEach(async () => {
  for (const id of ['v1', 'v2']) previews.destroyed(id);
  for (const id of ['ed-readme', 'ed-setup']) coord.destroy(id);
  for (const dir of [root, recoveryDir, outside]) {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe('attach adopts the record in main (FR-103b, FR-110)', () => {
  it('a new preview’s first attach records its file as the first entry', async () => {
    await attach('v1', readme);
    expect(pathsOf('v1')).toEqual([readme]);
    expect(history.get('v1')!.index).toBe(0);
  });

  it('changed for the preview reaches every window — including one that attached and then detached', async () => {
    await attach('v1', readme);
    await attach('v1', readme, SECOND);
    previews.detach(SECOND, 'v1'); // a background tab
    for (const received of windowChanged.values()) received.length = 0;

    await link('v1', setup);

    for (const id of [VIEWER, SECOND]) {
      expect(windowChanged.get(id)!.at(-1)).toEqual({ panelId: 'v1', history: history.get('v1') });
    }
    expect(pathsOf('v1')).toEqual([readme, setup]);
  });

  it('a second window’s attach adopts the record: its older persisted history is ignored', async () => {
    await attach('v1', readme);
    await link('v1', setup);
    const before = history.get('v1');

    await attach('v1', readme, SECOND, { v: 1, entries: [{ filePath: readme }], index: 0 });

    expect(history.get('v1')).toBe(before);
  });
});

describe('restore precedence — the persisted history’s current entry wins over filePath (FR-066, FR-109)', () => {
  it('filePath still README, history current entry setup → the run opens on setup', async () => {
    const persisted: PersistedHistory = { v: 1, entries: [{ filePath: readme }, { filePath: setup }], index: 1 };

    const update = await attach('v1', readme, VIEWER, persisted);

    expect(update.filePath).toBe(setup);
    expect(update.content).toEqual({ kind: 'text', text: '# Setup\n' });
    expect(previews.run('v1')?.filePath).toBe(setup);
    expect(previews.isOpen(setup)).toBe(true);
    expect(previews.isOpen(readme)).toBe(false);
    expect(pathsOf('v1')).toEqual([readme, setup]);
    expect(history.get('v1')!.index).toBe(1);
    // The stale config.filePath is healed in every window's layout.
    expect(push.pathChanged).toEqual([{ panelId: 'v1', filePath: setup }]);
  });

  it('no history → the run opens on filePath, and no pathChanged is needed', async () => {
    const update = await attach('v1', setup);
    expect(update.filePath).toBe(setup);
    expect(push.pathChanged).toEqual([]);
  });

  it('a restore-time attach returns the current entry’s viewState; an ordinary content update carries none (FR-107)', async () => {
    const persisted: PersistedHistory = {
      v: 1,
      entries: [{ filePath: readme, viewState: { line: 1 } }, { filePath: setup, viewState: { line: 30 } }],
      index: 1,
    };

    const update = await attach('v1', readme, VIEWER, persisted);
    expect(update.viewState).toEqual({ line: 30 });

    await writeFile(setup, '# Setup, edited\n');
    const refreshed = await previews.refresh('v1');
    expect(refreshed.update).not.toBeNull();
    expect(refreshed.update).not.toHaveProperty('viewState');
    for (const u of updatesTo(VIEWER, 'v1')) expect(u).not.toHaveProperty('viewState');
  });
});

describe('a link followed in place (FR-090a, FR-103b, FR-107, FR-110)', () => {
  it('records, broadcasts pathChanged, pushes the same update to a second viewer, and keeps the leaving view state', async () => {
    await attach('v1', readme);
    await attach('v1', readme, SECOND);
    push.clear();

    const res = await link('v1', setup, { line: 4 });

    expect(res.kind).toBe('shown');
    if (res.kind !== 'shown') return;
    expect(pathsOf('v1')).toEqual([readme, setup]);
    expect(history.get('v1')!.index).toBe(1);
    expect(history.get('v1')!.entries[0]).toEqual({ filePath: readme, viewState: { line: 4 } });
    expect(push.pathChanged).toEqual([{ panelId: 'v1', filePath: setup }]);
    expect(updatesTo(SECOND, 'v1').at(-1)).toEqual(res.update);
  });
});

describe('navigate with a history intent (FR-102, FR-106, FR-107)', () => {
  async function readmeThenSetup(): Promise<void> {
    await attach('v1', readme);
    await link('v1', setup, { line: 4 });
  }

  it('stores the leaving view state on the entry left BEFORE moving, moves, and returns the target entry’s view state', async () => {
    await readmeThenSetup();
    const entries = history.get('v1')!.entries;

    const res = await step('v1', readme, 0, { line: 20 });

    expect(res.kind).toBe('shown');
    if (res.kind !== 'shown') return;
    expect(history.get('v1')!.index).toBe(0);
    expect(history.get('v1')!.entries[1]).toEqual({ filePath: setup, viewState: { line: 20 } });
    expect(history.get('v1')!.entries).not.toBe(entries); // the view state was stored…
    expect(pathsOf('v1')).toEqual([readme, setup]); // …and the list otherwise untouched
    expect(res.update).toMatchObject({ filePath: readme, content: { kind: 'text', text: '# Readme\n' }, notice: null });
    expect(res.update.viewState).toEqual({ line: 4 });
    expect(push.pathChanged.at(-1)).toEqual({ panelId: 'v1', filePath: readme });
  });

  it('Back with view state A, then Forward, returns A (US7 scenario 3)', async () => {
    await readmeThenSetup();

    await step('v1', readme, 0, { line: 20 });
    const forward = await step('v1', setup, 1, { line: 2 });

    expect(forward.kind === 'shown' && forward.update.viewState).toEqual({ line: 20 });
    expect(history.get('v1')!.entries[0].viewState).toEqual({ line: 2 });
  });

  it('pushes its update, with viewState, to the second viewer too (FR-110)', async () => {
    await readmeThenSetup();
    await attach('v1', readme, SECOND);

    const res = await step('v1', readme, 0, { line: 20 });

    expect(res.kind).toBe('shown');
    if (res.kind !== 'shown') return;
    expect(updatesTo(SECOND, 'v1').at(-1)).toEqual(res.update);
    expect(updatesTo(SECOND, 'v1').at(-1)?.viewState).toEqual({ line: 4 });
  });

  it('a refused target (not text) does not move and answers history-refused naming the file (FR-106c)', async () => {
    await readmeThenSetup();
    await writeFile(readme, Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0x00, 0x00, 0x10]));
    push.clear();

    const res = await step('v1', readme, 0, { line: 20 });

    expect(res).toMatchObject({ kind: 'refused', notice: { kind: 'history-refused', target: readme } });
    expect(history.get('v1')!.index).toBe(1);
    expect(previews.run('v1')?.filePath).toBe(setup);
    expect(push.pathChanged).toEqual([]);
    // Where the reader still is: the stored view state stays.
    expect(history.get('v1')!.entries[1].viewState).toEqual({ line: 20 });
  });

  it('a target no enabled provider claims does not move (FR-106c)', async () => {
    await readmeThenSetup();
    settings.current.editor.previews.providers.markdown.enabled = false;

    const res = await step('v1', readme, 0);

    expect(res).toMatchObject({ kind: 'refused', notice: { kind: 'history-refused', target: readme } });
    expect(history.get('v1')!.index).toBe(1);
  });

  it('a missing target moves, and the preview shows the deleted notice with its content cleared (FR-106d)', async () => {
    await readmeThenSetup();
    await unlink(readme);

    const res = await step('v1', readme, 0);

    expect(res.kind).toBe('shown');
    if (res.kind !== 'shown') return;
    expect(history.get('v1')!.index).toBe(0);
    expect(res.update).toMatchObject({ filePath: readme, notice: { kind: 'deleted' }, content: { kind: 'text', text: '' } });
    expect(previews.run('v1')?.filePath).toBe(readme);
  });

  it('a target with a preview open elsewhere focuses that preview and does not move (FR-106b)', async () => {
    await readmeThenSetup();
    await attach('v2', readme, SECOND);

    const res = await step('v1', readme, 0, { line: 20 });

    expect(res).toEqual({ kind: 'focusedOther', panelId: 'v2' });
    expect(history.get('v1')!.index).toBe(1);
    expect(previews.run('v1')?.filePath).toBe(setup);
    expect(history.get('v1')!.entries[1].viewState).toEqual({ line: 20 });
  });

  it('a target merely open in an editor is no obstacle: the preview shows it, parented (FR-106b)', async () => {
    await readmeThenSetup();
    expect((await coord.load(meta('ed-readme', readme))).ok).toBe(true);

    const res = await step('v1', readme, 0);

    expect(res.kind).toBe('shown');
    if (res.kind !== 'shown') return;
    expect(res.update.parent).toMatchObject({ panelId: 'ed-readme' });
    expect(history.get('v1')!.index).toBe(0);
  });

  it('an intent whose entry no longer names the target moves nothing', async () => {
    await readmeThenSetup();
    const before = history.get('v1')!.index;

    await step('v1', install, 0);

    expect(history.get('v1')!.index).toBe(before);
    expect(previews.run('v1')?.filePath).toBe(setup);
  });
});

describe('what history does NOT follow, and what purges it', () => {
  it('a parented ↔ standalone change leaves the history untouched (FR-103b)', async () => {
    await attach('v1', readme);
    const before = history.get('v1');

    expect((await coord.load(meta('ed-readme', readme))).ok).toBe(true);
    expect(previews.run('v1')).toBeDefined();
    coord.destroy('ed-readme');

    expect(history.get('v1')).toBe(before);
  });

  it('setViewState stores on the current entry (FR-107)', async () => {
    await attach('v1', readme);
    history.setCurrentViewState('v1', { line: 8 });
    expect(history.get('v1')!.entries[0]).toEqual({ filePath: readme, viewState: { line: 8 } });
  });

  it('a parented preview following its document’s Save As rewrites its current entry (FR-013c)', async () => {
    expect((await coord.load(meta('ed-setup', setup))).ok).toBe(true);
    await attach('v1', readme);
    await link('v1', setup);
    const saved = join(root, 'docs', 'getting-started.md');

    expect((await coord.save({ panelId: 'ed-setup', absPath: saved })).ok).toBe(true);

    expect(pathsOf('v1')).toEqual([readme, saved]);
  });

  it('destroyed purges the record — the route every removal of a preview takes (FR-110)', async () => {
    await attach('v1', readme);
    await link('v1', setup);

    previews.destroyed('v1');

    expect(history.get('v1')).toBeUndefined();
    expect(windowChanged.get(SECOND)!.at(-1)).toEqual({ panelId: 'v1', history: null });
  });
});

describe('fix round 1', () => {
  async function readmeThenSetup(): Promise<void> {
    await attach('v1', readme);
    await link('v1', setup, { line: 4 });
  }

  it('item 3 — a stale history intent stores leavingViewState FIRST, then answers an unchanged snapshot', async () => {
    await readmeThenSetup();
    const revisionBefore = updatesTo(VIEWER, 'v1').at(-1)!.revision;
    push.clear();

    // Entry 0 is README; this request names install — a history that changed since the renderer read it.
    const res = await step('v1', install, 0, { line: 77 });

    expect(res.kind).toBe('shown');
    if (res.kind !== 'shown') return;
    expect(res.update.revision).toBe(revisionBefore); // unchanged: the renderer's revision check drops it
    expect(res.update.filePath).toBe(setup);
    expect(res.update).not.toHaveProperty('viewState');
    expect(push.updates).toEqual([]);
    expect(history.get('v1')!.index).toBe(1);
    expect(history.get('v1')!.entries[1]).toEqual({ filePath: setup, viewState: { line: 77 } });
  });

  it('item 4 — a restore whose history names filePath in another SPELLING sends no pathChanged', async () => {
    // Separators only: the extension's case decides the provider, so it is left alone.
    const spelledOtherwise = readme.includes('\\') ? readme.replace(/\\/g, '/') : readme.replace(/\//g, '\\');
    expect(spelledOtherwise).not.toBe(readme);

    await attach('v1', readme, VIEWER, { v: 1, entries: [{ filePath: spelledOtherwise }], index: 0 });

    expect(push.pathChanged).toEqual([]);
  });

  it('item 5 — an UNREADABLE history target (I/O error) moves, with the unreadable notice (FR-106d, amended)', async () => {
    await readmeThenSetup();
    unreadable.add(readme);

    const res = await step('v1', readme, 0, { line: 20 });

    expect(res.kind).toBe('shown');
    if (res.kind !== 'shown') return;
    expect(history.get('v1')!.index).toBe(0);
    expect(previews.run('v1')?.filePath).toBe(readme);
    expect(res.update).toMatchObject({ filePath: readme, notice: { kind: 'unreadable' }, content: { kind: 'text', text: '' } });
    expect(push.pathChanged.at(-1)).toEqual({ panelId: 'v1', filePath: readme });
  });

  it('item 6 — a history target OUTSIDE the project is refused and the position stays', async () => {
    const secret = join(outside, 'secret.md');
    await attach('v1', readme, VIEWER, { v: 1, entries: [{ filePath: secret }, { filePath: readme }], index: 1 });

    const res = await step('v1', secret, 0);

    expect(res).toMatchObject({ kind: 'refused', notice: { kind: 'history-refused', target: secret } });
    expect(history.get('v1')!.index).toBe(1);
    expect(previews.run('v1')?.filePath).toBe(readme);
    expect(previews.isOpen(secret)).toBe(false);
  });

  it('item 6 — a TOO LARGE history target is refused and the position stays (FR-106c)', async () => {
    const big = join(root, 'docs', 'big.md');
    await writeFile(big, `# Big\n\n${'x'.repeat(4096)}\n`);
    await attach('v1', readme, VIEWER, { v: 1, entries: [{ filePath: big }, { filePath: readme }], index: 1 });
    settings.current.editor.maxOpenFileBytes = 1024;
    push.clear();

    const res = await step('v1', big, 0);

    expect(res).toMatchObject({ kind: 'refused', notice: { kind: 'history-refused', target: big, reason: 'too-large' } });
    expect(history.get('v1')!.index).toBe(1);
    expect(previews.run('v1')?.filePath).toBe(readme);
    expect(push.pathChanged).toEqual([]);
  });

  it('item 6 — a THROWING history never aborts an attach, a link, a history step, a re-point or a destroy', async () => {
    const boom = (): never => {
      throw new Error('history exploded');
    };
    previews.destroyed('v1');
    const isolated = build({
      attach: boom,
      get: boom,
      rewriteCurrent: boom,
      purge: boom,
      recordOpen: boom,
      moveTo: boom,
      setCurrentViewState: boom,
      recordJump: boom,
    });

    const attached = await isolated.attach(VIEWER, { panelId: 'v9', projectId: 'P', filePath: readme });
    expect(attached).toMatchObject({ ok: true, update: { filePath: readme, content: { kind: 'text', text: '# Readme\n' } } });

    // setup has an editor, so the followed link parents the run — which is what a re-point follows.
    expect((await coord.load(meta('ed-setup', setup))).ok).toBe(true);
    const followed = await isolated.navigate(VIEWER, {
      panelId: 'v9',
      target: { absPath: setup },
      intent: { kind: 'link' },
      leavingViewState: { line: 1 },
    });
    expect(followed).toMatchObject({ kind: 'shown', update: { filePath: setup, parent: { panelId: 'ed-setup' } } });
    expect(isolated.run('v9')?.filePath).toBe(setup);

    // With no readable history there is nothing to step to: refused or unchanged, never a throw.
    await expect(
      isolated.navigate(VIEWER, { panelId: 'v9', target: { absPath: readme }, intent: { kind: 'history', index: 0 } }),
    ).resolves.toBeDefined();
    expect(isolated.run('v9')?.filePath).toBe(setup);

    const renamed = join(root, 'docs', 'renamed.md');
    expect(() => isolated.repointed(setup, renamed, 'ed-setup')).not.toThrow(); // calls rewriteCurrent
    expect(isolated.run('v9')?.filePath).toBe(renamed);

    expect(() => isolated.destroyed('v9')).not.toThrow();
    expect(isolated.run('v9')).toBeUndefined();
    expect(isolated.isOpen(renamed)).toBe(false);
  });
});
