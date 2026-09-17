import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EMPTY_HISTORY,
  SHIPPED_PREVIEW_PROVIDERS,
  normaliseForCompare,
  samePath,
  type PersistedHistory,
} from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import {
  OPEN_RESERVATION_TIMEOUT_MS,
  PreviewService,
  type PreviewHistoryHooks,
} from '../../src/main/preview-service.js';
import { editDocument } from './helpers/edit-document.js';
import {
  deferred,
  FakeClock,
  lateListener,
  liveSettings,
  manualWatcher,
  recordingPush,
  recordingWindows,
} from './helpers/preview-harness.js';

/**
 * T059 (044) — `open`'s decision order (contracts/preview-ipc.md §1), reservations, `attach` and its
 * viewers, `destroyed` and `dropProvider`.
 *
 * Window ids are webContents ids. The main window is 1; the editor registry records the window a
 * document was loaded from as the string form of its webContents id, exactly as `main.ts` does.
 */

const fs = new NodeFileSystem(async () => {});

const MAIN = 1;
const REQUESTER = 3;
const DOC_WINDOW = 5;

let root: string;
let outside: string;
let recoveryDir: string;
let clock: FakeClock;
let push: ReturnType<typeof recordingPush>;
let windows: ReturnType<typeof recordingWindows>;
let settings: ReturnType<typeof liveSettings>;
let coord: EditorCoordinator;
let previews: PreviewService;
let history: { calls: Array<[string, ...unknown[]]> } & PreviewHistoryHooks;
let watcher: ReturnType<typeof manualWatcher>;
/** Swappable per test, so one can hold the service inside an await. */
let projectRootImpl: (id: string) => Promise<string | undefined>;
let loadImpl: EditorService['load'];

function meta(panelId: string, absPath: string, windowId = DOC_WINDOW): DocMeta {
  return {
    panelId,
    windowId: String(windowId),
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

async function file(dir: string, name: string, text = '# x\n'): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, text);
  return path;
}

const open = (absPath: string, opts: { from?: number; hasParentLocally?: boolean; projectId?: string } = {}) =>
  previews.open(opts.from ?? REQUESTER, {
    absPath,
    projectId: opts.projectId ?? 'P',
    requesterPanelId: 'requester',
    hasParentLocally: opts.hasParentLocally ?? false,
  });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-preview-open-'));
  outside = await mkdtemp(join(tmpdir(), 'throng-preview-open-outside-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-preview-open-rec-'));
  clock = new FakeClock();
  push = recordingPush();
  windows = recordingWindows(MAIN);
  settings = liveSettings();
  const calls: Array<[string, ...unknown[]]> = [];
  history = {
    calls,
    attach: (panelId, kind, persisted) => {
      calls.push(['attach', panelId, kind, persisted]);
      return EMPTY_HISTORY;
    },
    get: () => undefined,
    rewriteCurrent: (panelId, filePath) => void calls.push(['rewriteCurrent', panelId, filePath]),
    purge: (panelId) => void calls.push(['purge', panelId]),
    recordOpen: (panelId, filePath) => void calls.push(['recordOpen', panelId, filePath]),
    moveTo: (panelId, index, filePath) => {
      calls.push(['moveTo', panelId, index, filePath]);
      return false;
    },
    setCurrentViewState: (panelId, viewState) => void calls.push(['setCurrentViewState', panelId, viewState]),
    recordJump: (panelId, leaving, arriving) => void calls.push(['recordJump', panelId, leaving, arriving]),
  };
  const relay = lateListener();
  const service = new EditorService(fs, settings.get);
  coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10_000,
    relaySync: () => {},
    persistUndoHistory: () => false,
    documentLifecycle: relay,
  });
  projectRootImpl = async (id) => (id === 'P' ? root : undefined);
  loadImpl = (req) => service.load(req);
  watcher = manualWatcher();
  previews = new PreviewService({
    documents: coord,
    reader: { load: (req) => loadImpl(req) },
    fs,
    fileWatcher: watcher,
    settings: settings.get,
    registry: SHIPPED_PREVIEW_PROVIDERS,
    projectRoot: (id) => projectRootImpl(id),
    push,
    windows,
    clock,
    history,
  });
  relay.bind(previews);
});

afterEach(async () => {
  for (const id of ['ed1', 'ed2']) coord.destroy(id);
  for (const id of ['v1', 'v2', 'v3']) previews.destroyed(id);
  for (const dir of [root, outside, recoveryDir]) {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe('open — refused (FR-004, FR-062)', () => {
  it('refuses a file no provider claims', async () => {
    expect(await open(await file(root, 'a.txt'))).toEqual({ kind: 'refused', reason: 'no-provider' });
  });

  it('refuses a file whose provider is disabled', async () => {
    settings.current.editor.previews.providers.markdown!.enabled = false;
    expect(await open(await file(root, 'a.md'))).toEqual({ kind: 'refused', reason: 'disabled' });
  });

  it('refuses a file outside the project, and an unknown project', async () => {
    expect(await open(await file(outside, 'a.md'))).toEqual({ kind: 'refused', reason: 'outside-project' });
    expect(await open(await file(root, 'b.md'), { projectId: 'nope' })).toEqual({
      kind: 'refused',
      reason: 'outside-project',
    });
  });

  it('refuses a path with no file — missing, or a folder', async () => {
    expect(await open(join(root, 'missing.md'))).toEqual({ kind: 'refused', reason: 'no-file' });
    await mkdir(join(root, 'folder.md'));
    expect(await open(join(root, 'folder.md'))).toEqual({ kind: 'refused', reason: 'no-file' });
  });

  it('a refusal reserves nothing', async () => {
    const a = await file(root, 'a.txt');
    await open(a);
    expect(previews.isOpen(a)).toBe(false);
  });
});

describe('open — where the preview goes (FR-010, FR-011, FR-012, FR-014)', () => {
  it('beside the parent when the requesting window holds it', async () => {
    const a = await file(root, 'a.md');
    await coord.load({ ...meta('ed1', a), absPath: a });

    const res = await open(a, { hasParentLocally: true });

    expect(res).toEqual({ kind: 'placeLocally', reservation: expect.any(String), besidePanelId: 'ed1' });
    expect(push.place).toEqual([]);
  });

  it('standalone, beside nothing, when no editor holds the file', async () => {
    const a = await file(root, 'a.md');
    expect(await open(a)).toEqual({ kind: 'placeLocally', reservation: expect.any(String), besidePanelId: null });
  });

  it('elsewhere: place goes to the main window, then to the registry’s window on decline, which is focused', async () => {
    const a = await file(root, 'a.md');
    await coord.load({ ...meta('ed1', a), absPath: a });

    const res = await open(a, { hasParentLocally: false });

    expect(res).toEqual({ kind: 'placedElsewhere' });
    expect(push.place).toEqual([
      {
        to: MAIN,
        payload: {
          requestId: expect.any(String),
          absPath: a,
          projectId: 'P',
          besidePanelId: 'ed1',
          reservation: expect.any(String),
        },
      },
    ]);
    const first = push.place[0]!.payload;

    previews.placeDeclined(first.requestId);

    expect(push.place).toHaveLength(2);
    expect(push.place[1]).toEqual({ to: DOC_WINDOW, payload: first });

    await previews.attach(DOC_WINDOW, { panelId: 'v1', projectId: 'P', filePath: a, reservation: first.reservation });
    expect(windows.raised).toContain(DOC_WINDOW);
  });

  /*
   * Review of batch B, M-1 — Open Preview must never be a silent no-op. When every window that might hold the
   * parent has declined, the REQUESTING window places it standalone: a `place` with no `besidePanelId`.
   * Parenting is derived (FR-013), so the preview still follows the document. A decline of THAT, or a decline
   * nobody asked for, sends nothing further.
   */
  it('after every parent window declines, the requesting window is asked to place it standalone; a decline of that ends it', async () => {
    const a = await file(root, 'a.md');
    await coord.load({ ...meta('ed1', a), absPath: a });
    await open(a);
    const first = push.place[0]!.payload;

    previews.placeDeclined(first.requestId);
    previews.placeDeclined(first.requestId);

    expect(push.place.map((p) => p.to)).toEqual([MAIN, DOC_WINDOW, REQUESTER]);
    expect(push.place[2]!.payload).toEqual({ ...first, besidePanelId: null });

    previews.placeDeclined(first.requestId);
    previews.placeDeclined('unknown');

    expect(push.place).toHaveLength(3);
    // Declined everywhere: the path is free, so the next Open Preview is not swallowed.
    expect(await open(a)).toEqual({ kind: 'placedElsewhere' });
  });

  it('the standalone fallback attaches with the reservation and raises the requesting window', async () => {
    const a = await file(root, 'a.md');
    await coord.load({ ...meta('ed1', a), absPath: a });
    await open(a);
    const { requestId, reservation } = push.place[0]!.payload;
    previews.placeDeclined(requestId);
    previews.placeDeclined(requestId);

    const attached = await previews.attach(REQUESTER, { panelId: 'v1', projectId: 'P', filePath: a, reservation });

    expect(attached).toMatchObject({ ok: true, update: { parent: { panelId: 'ed1' } } });
    expect(windows.raised).toContain(REQUESTER);
  });

  /*
   * Adversarial review (main item 4, ruling) — a `place` sent to a window that is gone (a closed sub-workspace
   * the registry still records, say) reaches nobody, so no `placeDeclined` ever comes back. Waiting for one
   * held the reservation for the full 10 s, and every Open Preview meanwhile answered `focused` with nothing
   * to focus — a button that does nothing. An undelivered place IS a decline, at once.
   */
  it('a place the main window cannot receive is declined at once, and goes on to the registry’s window', async () => {
    const a = await file(root, 'a.md');
    await coord.load({ ...meta('ed1', a), absPath: a });
    push.dead.add(MAIN);

    expect(await open(a)).toEqual({ kind: 'placedElsewhere' });

    expect(push.place.map((p) => p.to)).toEqual([MAIN, DOC_WINDOW]);
    expect(push.place[1]!.payload).toEqual(push.place[0]!.payload);
  });

  it('a decline whose next window is gone goes straight to the requesting window’s standalone place (M-1)', async () => {
    const a = await file(root, 'a.md');
    await coord.load({ ...meta('ed1', a), absPath: a });
    push.dead.add(DOC_WINDOW);
    await open(a);

    previews.placeDeclined(push.place[0]!.payload.requestId);

    expect(push.place.map((p) => p.to)).toEqual([MAIN, DOC_WINDOW, REQUESTER]);
    expect(push.place[2]!.payload.besidePanelId).toBeNull();
  });

  /*
   * M-1 / M-5 — every parent window gone DURING `open` itself: nothing asynchronous is left to wait for, so
   * the requester places it, standalone, from the answer — and the path stays reserved for that placement.
   */
  it('with every parent window gone during open, it answers placeLocally beside nothing, keeping the reservation', async () => {
    const a = await file(root, 'a.md');
    await coord.load({ ...meta('ed1', a), absPath: a });
    push.dead.add(MAIN);
    push.dead.add(DOC_WINDOW);

    const res = await open(a);

    expect(res).toEqual({ kind: 'placeLocally', reservation: expect.any(String), besidePanelId: null });
    expect(push.place.map((p) => p.to)).toEqual([MAIN, DOC_WINDOW]);
    expect(await open(a, { from: 6 })).toEqual({ kind: 'focused', panelId: null });
    windows.raised.length = 0;
    const reservation = (res as { reservation: string }).reservation;
    expect(await previews.attach(REQUESTER, { panelId: 'v1', projectId: 'P', filePath: a, reservation })).toMatchObject({
      ok: true,
      update: { parent: { panelId: 'ed1' } },
    });
    expect(windows.raised).toEqual([]); // placed locally, not elsewhere: nothing to raise
  });

  it('focuses the existing preview when a run exists for the file', async () => {
    const a = await file(root, 'a.md');
    await previews.attach(9, { panelId: 'v1', projectId: 'P', filePath: a });

    expect(await open(a)).toEqual({ kind: 'focused', panelId: 'v1' });
    expect(windows.raised).toEqual([9]);
    expect(push.focus).toEqual([{ to: 9, payload: { panelId: 'v1' } }]);
  });

  it('answers focused with panelId null, and sends no focus, when only a reservation exists', async () => {
    const a = await file(root, 'a.md');
    await open(a, { from: 4 });

    const second = await open(a, { from: 6 });

    expect(second).toEqual({ kind: 'focused', panelId: null });
    expect(push.focus).toEqual([]);
    expect(windows.raised).toEqual([4]);
  });

  it('two concurrent opens for one path produce one reservation (FR-012)', async () => {
    const a = await file(root, 'a.md');

    const results = await Promise.all([open(a, { from: 4 }), open(a, { from: 6 })]);

    expect(results.map((r) => r.kind).sort()).toEqual(['focused', 'placeLocally']);
  });

  it('a reservation no attach consumes is released after the timeout', async () => {
    const a = await file(root, 'a.md');
    expect((await open(a)).kind).toBe('placeLocally');

    clock.advance(OPEN_RESERVATION_TIMEOUT_MS - 1);
    expect((await open(a)).kind).toBe('focused');

    clock.advance(1);
    expect((await open(a)).kind).toBe('placeLocally');
  });

  it('attach consumes the reservation, so the timeout cannot release the run', async () => {
    const a = await file(root, 'a.md');
    const res = await open(a);
    if (res.kind !== 'placeLocally') throw new Error('expected placeLocally');

    expect(clock.pendingTimers).toBe(1);

    await previews.attach(REQUESTER, { panelId: 'v1', projectId: 'P', filePath: a, reservation: res.reservation });
    expect(clock.pendingTimers).toBe(0);
    clock.advance(OPEN_RESERVATION_TIMEOUT_MS * 2);

    expect(previews.isOpen(a)).toBe(true);
    expect(await open(a)).toEqual({ kind: 'focused', panelId: 'v1' });
  });
});

describe('attach — viewers, adoption and refusal (FR-022, FR-066, FR-067, FR-110)', () => {
  it('two viewers receive identical revisions, and the second attach adopts the run', async () => {
    const a = await file(root, 'a.md', 'v0\n');
    const other = await file(root, 'other.md');
    await coord.load({ ...meta('ed1', a), absPath: a });

    const one = await previews.attach(11, { panelId: 'v1', projectId: 'P', filePath: a });
    const two = await previews.attach(12, { panelId: 'v1', projectId: 'P', filePath: other });
    expect(one.ok && two.ok).toBe(true);
    if (!one.ok || !two.ok) return;
    expect(two.update.filePath).toBe(a);
    expect(two.update.revision).toBe(one.update.revision);
    push.clear();

    editDocument(coord, meta('ed1', a), 'v1\n');
    clock.advance(1000);

    const to11 = push.updates.filter((u) => u.to === 11).map((u) => u.update);
    const to12 = push.updates.filter((u) => u.to === 12).map((u) => u.update);
    expect(to11.length).toBeGreaterThan(0);
    expect(to12).toEqual(to11);
    expect(previews.isOpen(other)).toBe(false);
  });

  it('a detached viewer receives nothing more', async () => {
    const a = await file(root, 'a.md', 'v0\n');
    await coord.load({ ...meta('ed1', a), absPath: a });
    await previews.attach(11, { panelId: 'v1', projectId: 'P', filePath: a });
    await previews.attach(12, { panelId: 'v1', projectId: 'P', filePath: a });
    previews.detach(12, 'v1');
    push.clear();

    editDocument(coord, meta('ed1', a), 'v1\n');
    clock.advance(1000);

    expect(push.updates.some((u) => u.to === 11)).toBe(true);
    expect(push.updates.some((u) => u.to === 12)).toBe(false);
  });

  it('attach broadcasts openChanged for a new run and adopts the history record', async () => {
    const a = await file(root, 'a.md');
    const persisted: PersistedHistory = { v: 1, entries: [{ filePath: a }], index: 0 };

    await previews.attach(11, { panelId: 'v1', projectId: 'P', filePath: a, history: persisted });

    expect(push.openChanged).toEqual([{ path: expect.any(String), open: true }]);
    expect(samePath(push.openChanged[0]!.path, a)).toBe(true);
    expect(history.calls).toContainEqual(['attach', 'v1', 'preview', persisted]);
  });

  it('refuses a disabled provider, an unknown one, and a file outside the project', async () => {
    const a = await file(root, 'a.md');
    const txt = await file(root, 'a.txt');
    const far = await file(outside, 'far.md');

    settings.current.editor.previews.providers.markdown!.enabled = false;
    expect(await previews.attach(11, { panelId: 'v1', projectId: 'P', filePath: a })).toEqual({
      ok: false,
      reason: 'disabled',
    });
    settings.current.editor.previews.providers.markdown!.enabled = true;
    expect(await previews.attach(11, { panelId: 'v2', projectId: 'P', filePath: txt })).toEqual({
      ok: false,
      reason: 'no-provider',
    });
    expect(await previews.attach(11, { panelId: 'v3', projectId: 'P', filePath: far })).toEqual({
      ok: false,
      reason: 'outside-project',
    });
    expect(previews.run('v1')).toBeUndefined();
    expect(push.openChanged).toEqual([]);
  });
});

describe('destroyed and dropProvider (FR-042, FR-063, FR-110)', () => {
  it('destroyed drops the run, its path and its reservation, purges history and never touches the document', async () => {
    const a = await file(root, 'a.md', 'v0\n');
    await coord.load({ ...meta('ed1', a), absPath: a });
    const res = await open(a, { hasParentLocally: true });
    if (res.kind !== 'placeLocally') throw new Error('expected placeLocally');
    await previews.attach(11, { panelId: 'v1', projectId: 'P', filePath: a, reservation: res.reservation });
    editDocument(coord, meta('ed1', a), 'unsaved\n');
    const before = coord.getContent('ed1');
    push.clear();

    previews.destroyed('v1');

    expect(previews.run('v1')).toBeUndefined();
    expect(previews.isOpen(a)).toBe(false);
    expect(push.openChanged).toEqual([{ path: expect.any(String), open: false }]);
    expect(history.calls).toContainEqual(['purge', 'v1']);
    expect(coord.getContent('ed1')).toEqual(before);
    expect((await open(a, { hasParentLocally: true })).kind).toBe('placeLocally');

    // A run that is gone receives nothing when its old document changes.
    push.clear();
    editDocument(coord, meta('ed1', a), 'more\n');
    clock.advance(2000);
    expect(push.updates).toEqual([]);
  });

  it('dropProvider drops every run of that provider, tells its viewers, and broadcasts openChanged', async () => {
    const a = await file(root, 'a.md');
    const b = await file(root, 'b.md');
    await previews.attach(11, { panelId: 'v1', projectId: 'P', filePath: a });
    await previews.attach(12, { panelId: 'v2', projectId: 'P', filePath: b });
    push.clear();

    previews.dropProvider('markdown');

    expect(previews.run('v1')).toBeUndefined();
    expect(previews.run('v2')).toBeUndefined();
    expect(previews.isOpen(a)).toBe(false);
    expect(push.openChanged).toHaveLength(2);
    expect(push.openChanged.every((c) => c.open === false)).toBe(true);
    expect(push.updates.map((u) => [u.to, u.update.panelId, u.update.notice])).toEqual([
      [11, 'v1', null],
      [12, 'v2', null],
    ]);
  });
});

describe('openPaths — the seed a new window starts from (§1 amended, US1 review; FR-012, FR-014)', () => {
  it('answers the compare-form path of every file with a run, once per path, and follows destroys', async () => {
    const a = await file(root, 'A.md');
    const b = await file(root, 'b.md');
    expect(previews.openPaths()).toEqual([]);

    await previews.attach(11, { panelId: 'v1', projectId: 'P', filePath: a });
    await previews.attach(12, { panelId: 'v2', projectId: 'P', filePath: b });
    // A second run on the same file, spelled differently, is still ONE open path.
    await previews.attach(13, { panelId: 'v3', projectId: 'P', filePath: a.toUpperCase().replace(/\.MD$/, '.md') });

    expect([...previews.openPaths()].sort()).toEqual([normaliseForCompare(a), normaliseForCompare(b)].sort());

    previews.destroyed('v2');
    expect(previews.openPaths()).toEqual([normaliseForCompare(a)]);
    previews.destroyed('v1');
    expect(previews.openPaths()).toEqual([normaliseForCompare(a)]); // v3 still holds it
    previews.destroyed('v3');
    expect(previews.openPaths()).toEqual([]);
  });

  it('does not count a reservation — nothing is open until a preview attaches', async () => {
    const a = await file(root, 'a.md');
    const res = await open(a);
    expect(res.kind).toBe('placeLocally');
    expect(previews.openPaths()).toEqual([]);
  });
});

describe('two runs on one path: the path stays open while either remains (FR-012, FR-033; review item 1)', () => {
  it('destroying the run holding the path hands it to the survivor — no open:false, still focusable', async () => {
    // A sub-workspace restored its preview of x.md (v1) while the main window already had one (v2).
    const x = await file(root, 'x.md');
    await previews.attach(11, { panelId: 'v2', projectId: 'P', filePath: x });
    await previews.attach(12, { panelId: 'v1', projectId: 'P', filePath: x });
    push.clear();

    previews.destroyed('v2');

    expect(push.openChanged).toEqual([]);
    expect(previews.isOpen(x)).toBe(true);
    expect(await open(x)).toEqual({ kind: 'focused', panelId: 'v1' });

    previews.destroyed('v1');
    expect(push.openChanged).toEqual([{ path: normaliseForCompare(x), open: false }]);
    expect(previews.isOpen(x)).toBe(false);
  });

  it('a standalone move of both runs announces the old path closed once and the new one open once', async () => {
    const x = await file(root, 'x.md');
    const moved = join(root, 'moved.md');
    await previews.attach(11, { panelId: 'v2', projectId: 'P', filePath: x });
    await previews.attach(12, { panelId: 'v1', projectId: 'P', filePath: x });
    push.clear();

    previews.beginMove([x]);
    previews.moved([{ from: x, to: moved }]);

    expect(push.openChanged).toEqual([
      { path: normaliseForCompare(moved), open: true },
      { path: normaliseForCompare(x), open: false },
    ]);
    previews.destroyed('v2');
    expect(previews.isOpen(moved)).toBe(true);
  });

  it('spellings that differ only in case and separators are one path (compare form)', async () => {
    const a = await file(root, 'a.md');
    const variant = a.replace(/\\/g, '/').toUpperCase().replace(/\.MD$/, '.md');
    await previews.attach(11, { panelId: 'v1', projectId: 'P', filePath: a });
    await previews.attach(12, { panelId: 'v2', projectId: 'P', filePath: variant });

    expect(push.openChanged).toEqual([{ path: normaliseForCompare(a), open: true }]);
    expect(previews.isOpen(variant)).toBe(true);
    expect(await open(variant)).toEqual({ kind: 'focused', panelId: 'v1' });

    previews.destroyed('v1');
    expect(previews.isOpen(a)).toBe(true);
    expect(push.openChanged).toHaveLength(1);
  });
});

describe('destroyed while attach is in flight (§1 amended; review item 2)', () => {
  it('arriving during the project lookup: no run, no watch, no path, no broadcast, and a refusal', async () => {
    const a = await file(root, 'a.md');
    const lookup = deferred<string | undefined>();
    projectRootImpl = () => lookup.promise;

    const attaching = previews.attach(11, { panelId: 'v1', projectId: 'P', filePath: a });
    previews.destroyed('v1');
    lookup.resolve(root);
    const res = await attaching;

    expect(res.ok).toBe(false);
    expect(previews.run('v1')).toBeUndefined();
    expect(previews.isOpen(a)).toBe(false);
    expect(watcher.watched).toEqual([]);
    expect(push.openChanged).toEqual([]);
  });

  it('arriving during the disk read: the run is dropped, open:true is never re-broadcast, and a refusal', async () => {
    const a = await file(root, 'a.md');
    const entered = deferred<void>();
    const read = deferred<void>();
    const realLoad = loadImpl;
    loadImpl = async (req) => {
      entered.resolve();
      await read.promise;
      return realLoad(req);
    };

    const attaching = previews.attach(11, { panelId: 'v1', projectId: 'P', filePath: a });
    await entered.promise; // past the project lookup and containment, inside the read
    previews.destroyed('v1');
    read.resolve();
    const res = await attaching;

    expect(res.ok).toBe(false);
    expect(previews.run('v1')).toBeUndefined();
    expect(previews.isOpen(a)).toBe(false);
    expect(watcher.watched).toEqual([]);
    // The path was claimed before the read, so it is announced open and then closed — and never opened
    // again once the read comes back for a run that no longer exists.
    expect(push.openChanged).toEqual([
      { path: normaliseForCompare(a), open: true },
      { path: normaliseForCompare(a), open: false },
    ]);
  });

  it('a second attach that waited on the destroyed one does not resurrect the run', async () => {
    const a = await file(root, 'a.md');
    const lookup = deferred<string | undefined>();
    projectRootImpl = () => lookup.promise;

    const first = previews.attach(11, { panelId: 'v1', projectId: 'P', filePath: a });
    const second = previews.attach(12, { panelId: 'v1', projectId: 'P', filePath: a });
    previews.destroyed('v1');
    lookup.resolve(root);
    projectRootImpl = async () => root;

    expect((await first).ok).toBe(false);
    expect((await second).ok).toBe(false);
    expect(previews.run('v1')).toBeUndefined();
    expect(push.openChanged).toEqual([]);
  });
});

describe('refusals and isolation (§1 amended; review items 7, 8)', () => {
  it('a refused attach releases the reservation it carried', async () => {
    const a = await file(root, 'a.md');
    const res = await open(a);
    if (res.kind !== 'placeLocally') throw new Error('expected placeLocally');

    settings.current.editor.previews.providers.markdown!.enabled = false;
    const refused = await previews.attach(11, { panelId: 'v1', projectId: 'P', filePath: a, reservation: res.reservation });
    settings.current.editor.previews.providers.markdown!.enabled = true;

    expect(refused).toEqual({ ok: false, reason: 'disabled' });
    expect(clock.pendingTimers).toBe(0);
    expect((await open(a)).kind).toBe('placeLocally');
  });

  it('attaching an existing run from a different project is refused outside-project, and adds no viewer', async () => {
    const a = await file(root, 'a.md', 'v0\n');
    await coord.load({ ...meta('ed1', a), absPath: a });
    await previews.attach(11, { panelId: 'v1', projectId: 'P', filePath: a });

    const other = await previews.attach(12, { panelId: 'v1', projectId: 'Q', filePath: a });

    expect(other).toEqual({ ok: false, reason: 'outside-project' });
    push.clear();
    editDocument(coord, meta('ed1', a), 'v1\n');
    expect(push.updates.some((u) => u.to === 12)).toBe(false);
  });
});
