import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS, NO_MODES, type Match } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';
import { EditorService } from '../../src/main/editor-service.js';
import {
  EditorCoordinator,
  type DocMeta,
  type DocumentLifecycleListener,
  type EditorSyncMsg,
} from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { editDocument } from './helpers/edit-document.js';

/**
 * u4 (044 T043/T044) — the injected `DocumentLifecycleListener` `EditorCoordinator` gains for
 * `PreviewService` (u7, contracts/preview-ipc.md §3, as amended 2026-09-15) to observe:
 * `registered`, `unregistered`, `repointed`, `changed`, `dirtyChanged`.
 *
 * Three rules the contract binds, each with its own block below:
 * - `changed` fires on EVERY change of canonical text, resets included;
 * - `dirtyChanged` fires exactly once per flip of the document's dirty state, and never otherwise;
 * - a throwing listener never aborts the coordinator's own work.
 *
 * The listener is optional. The last block establishes the requirement that matters most for every
 * OTHER caller of the coordinator: injecting one changes nothing about what `relaySync` sends.
 */

type LifecycleEvent =
  | { kind: 'registered'; absPath: string; panelId: string }
  | { kind: 'unregistered'; absPath: string; panelId: string }
  | { kind: 'repointed'; from: string; to: string; panelId: string }
  | { kind: 'changed'; panelId: string }
  | { kind: 'dirtyChanged'; panelId: string; dirty: boolean };

type Kind = LifecycleEvent['kind'];

function recordingListener(events: LifecycleEvent[]): DocumentLifecycleListener {
  return {
    registered: (absPath, panelId) => events.push({ kind: 'registered', absPath, panelId }),
    unregistered: (absPath, panelId) => events.push({ kind: 'unregistered', absPath, panelId }),
    repointed: (from, to, panelId) => events.push({ kind: 'repointed', from, to, panelId }),
    changed: (panelId) => events.push({ kind: 'changed', panelId }),
    dirtyChanged: (panelId, dirty) => events.push({ kind: 'dirtyChanged', panelId, dirty }),
  };
}

/** A listener that throws on every event once armed — set-up edits run with it disarmed. */
function throwingListener(): DocumentLifecycleListener & { arm(): void; thrown: Kind[] } {
  let armed = false;
  const thrown: Kind[] = [];
  const boom = (kind: Kind) => (): void => {
    if (!armed) return;
    thrown.push(kind);
    throw new Error(`listener ${kind} exploded`);
  };
  return {
    registered: boom('registered'),
    unregistered: boom('unregistered'),
    repointed: boom('repointed'),
    changed: boom('changed'),
    dirtyChanged: boom('dirtyChanged'),
    arm: () => {
      armed = true;
    },
    thrown,
  };
}

const fs = new NodeFileSystem(async () => {});

let root: string;
let recoveryDir: string;
let events: LifecycleEvent[];
let synced: Array<{ from: number; msg: EditorSyncMsg }>;
let coord: EditorCoordinator;
let created: EditorCoordinator[];

function meta(panelId: string, absPath: string | null, atRoot = root): DocMeta {
  return {
    panelId,
    windowId: 'w1',
    ownerKind: 'project',
    ownerProjectId: 'A',
    ownerRoot: atRoot,
    allProjectRoots: [atRoot],
    tabId: 't1',
    absPath,
    encoding: 'utf8',
    hasBom: false,
    lineEnding: 'lf',
  };
}

/**
 * A coordinator with NO file watcher, for tests that write to the file they have open: with a watch
 * the write races a live reload, and the events under test would depend on which one won.
 */
function quiet(listener: DocumentLifecycleListener = recordingListener(events)): EditorCoordinator {
  const c = new EditorCoordinator(new EditorService(fs, () => DEFAULT_APP_SETTINGS), new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10,
    relaySync: (from, msg) => synced.push({ from, msg }),
    persistUndoHistory: () => true,
    documentLifecycle: listener,
  });
  created.push(c);
  return c;
}

async function until<T>(get: () => T | undefined | Promise<T | undefined>, ms = 4000): Promise<T | undefined> {
  for (let i = 0; i < ms / 25; i++) {
    const v = await get();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  return get();
}

async function moveFile(c: EditorCoordinator, from: string, to: string): Promise<void> {
  c.beginMove([from]);
  await rename(from, to);
  c.markMoved([{ from, to }]);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-lifecycle-'));
  await mkdir(join(root, 'dest'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-lifecycle-rec-'));
  events = [];
  synced = [];
  created = [];
  const service = new EditorService(fs, () => DEFAULT_APP_SETTINGS);
  coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10,
    relaySync: (from, msg) => synced.push({ from, msg }),
    persistUndoHistory: () => true,
    fileWatcher: new NodeFileWatcher(20),
    documentLifecycle: recordingListener(events),
  });
  created.push(coord);
});

afterEach(async () => {
  vi.restoreAllMocks();
  // See editor-move.integration.test.ts: dispose every doc's watch/timer BEFORE the directories
  // that back them disappear, or a leaked callback contaminates a later test.
  for (const c of created) for (const id of ['p1', 'p2', 'p3']) c.destroy(id);
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('DocumentLifecycleListener — registered / unregistered (T043)', () => {
  it('fires registered on load', async () => {
    const path = join(root, 'a.txt');
    await writeFile(path, 'v1\n');

    await coord.load({ ...meta('p1', path), absPath: path });

    expect(events).toEqual([{ kind: 'registered', absPath: path, panelId: 'p1' }]);
  });

  it('fires registered on register only when a path is given', () => {
    coord.register(meta('p2', null), 'scratch\n');
    expect(events).toEqual([]);

    const path = join(root, 'b.txt');
    coord.register(meta('p3', path), 'scratch\n');

    expect(events).toEqual([{ kind: 'registered', absPath: path, panelId: 'p3' }]);
  });

  it('fires unregistered on destroy', async () => {
    const path = join(root, 'a.txt');
    await writeFile(path, 'v1\n');
    await coord.load({ ...meta('p1', path), absPath: path });
    events.length = 0;

    coord.destroy('p1');

    expect(events).toEqual([{ kind: 'unregistered', absPath: path, panelId: 'p1' }]);
  });

  it('fires no unregistered destroying an unpathed document', () => {
    coord.register(meta('p2', null), 'scratch\n');
    events.length = 0;

    coord.destroy('p2');

    expect(events).toEqual([]);
  });

  it('fires unregistered THEN registered on an in-place re-point — never repointed', async () => {
    const a = join(root, 'a.txt');
    const b = join(root, 'b.txt');
    await writeFile(a, 'v1\n');
    await writeFile(b, 'v2\n');
    await coord.load({ ...meta('p1', a), absPath: a });
    events.length = 0;

    // The same panel, loaded onto a DIFFERENT file — an "Open File" replacing what p1 shows, not a
    // rename of the file it already held.
    await coord.load({ ...meta('p1', b), absPath: b });

    expect(events).toEqual([
      { kind: 'unregistered', absPath: a, panelId: 'p1' },
      { kind: 'registered', absPath: b, panelId: 'p1' },
    ]);
  });

  it('fires nothing on a same-path re-load of the same panel, and one unregistered on its destroy', async () => {
    // Reachable: two opens of one file into one editor that both pass `openInto` before either
    // `load` lands (a double-click on the tree), or two views of a mirrored panel mounting at once.
    const c = quiet();
    const a = join(root, 'a.txt');
    await writeFile(a, 'v1\n');
    await c.load({ ...meta('p1', a), absPath: a });
    events.length = 0;

    await c.load({ ...meta('p1', a), absPath: a });
    c.register(meta('p1', a), 'v1\n');
    expect(events).toEqual([]);

    c.destroy('p1');
    expect(events).toEqual([{ kind: 'unregistered', absPath: a, panelId: 'p1' }]);
  });

  it('reports the text and dirty flip a same-path re-load causes, without re-registering', async () => {
    const c = quiet();
    const a = join(root, 'a.txt');
    await writeFile(a, 'v1\n');
    await c.load({ ...meta('p1', a), absPath: a });
    editDocument(c, meta('p1', a), 'mine\n');
    await writeFile(a, 'disk v2\n');
    events.length = 0;

    await c.load({ ...meta('p1', a), absPath: a });

    expect(events).toEqual([
      { kind: 'changed', panelId: 'p1' },
      { kind: 'dirtyChanged', panelId: 'p1', dirty: false },
    ]);
  });
});

describe('DocumentLifecycleListener — repointed (T043)', () => {
  it('fires repointed(from, to) exactly once on an in-app move — no unregistered/registered', async () => {
    const from = join(root, 'note.txt');
    const to = join(root, 'dest', 'note.txt');
    await writeFile(from, 'body\n');
    await coord.load({ ...meta('p1', from), absPath: from });
    events.length = 0;

    await moveFile(coord, from, to);

    expect(events).toEqual([{ kind: 'repointed', from, to, panelId: 'p1' }]);
  });

  it('fires exactly repointed(from, to) on Save As of a clean pathed document — save relays no movedTo', async () => {
    const from = join(root, 'note.txt');
    const to = join(root, 'dest', 'renamed.txt');
    await writeFile(from, 'body\n');
    await coord.load({ ...meta('p1', from), absPath: from });
    events.length = 0;
    synced.length = 0;

    const res = await coord.save({ panelId: 'p1', absPath: to });

    expect(res.ok).toBe(true);
    expect(events).toEqual([{ kind: 'repointed', from, to, panelId: 'p1' }]);
    // The relay stream itself carries no `movedTo` for a save — only `dirty: false` — which is
    // exactly why PreviewService needs the listener rather than reading the sync stream (T043).
    expect(synced.some((s) => s.msg.movedTo !== undefined)).toBe(false);
  });

  it('fires no repointed when a save keeps the same path', async () => {
    const path = join(root, 'note.txt');
    await writeFile(path, 'body\n');
    await coord.load({ ...meta('p1', path), absPath: path });
    editDocument(coord, meta('p1', path), 'body v2\n');
    events.length = 0;

    await coord.save({ panelId: 'p1' });

    expect(events).toEqual([{ kind: 'dirtyChanged', panelId: 'p1', dirty: false }]);
  });

  it('fires registered(to) on the first Save As of an unpathed document (FR-013a)', async () => {
    coord.register(meta('p2', null), 'scratch\n');
    const target = join(root, 'README.md');
    events.length = 0;

    const res = await coord.save({ panelId: 'p2', absPath: target });

    expect(res.ok).toBe(true);
    expect(events).toEqual([{ kind: 'registered', absPath: target, panelId: 'p2' }]);

    events.length = 0;
    coord.destroy('p2');
    expect(events).toEqual([{ kind: 'unregistered', absPath: target, panelId: 'p2' }]);
  });

  it('fires registered(to) then dirtyChanged(false) on the first Save As of a DIRTY unpathed document', async () => {
    coord.register(meta('p2', null), '');
    editDocument(coord, meta('p2', null), 'typed\n');
    const target = join(root, 'README.md');
    events.length = 0;

    const res = await coord.save({ panelId: 'p2', absPath: target });

    expect(res.ok).toBe(true);
    expect(events).toEqual([
      { kind: 'registered', absPath: target, panelId: 'p2' },
      { kind: 'dirtyChanged', panelId: 'p2', dirty: false },
    ]);
  });
});

describe('DocumentLifecycleListener — changed and dirtyChanged on edits (T043)', () => {
  it('fires changed + dirtyChanged(true) on the first edit into a clean document, and only changed after', async () => {
    const path = join(root, 'a.txt');
    await writeFile(path, 'v1\n');
    await coord.load({ ...meta('p1', path), absPath: path });
    events.length = 0;

    editDocument(coord, meta('p1', path), 'v2\n');
    expect(events).toEqual([
      { kind: 'changed', panelId: 'p1' },
      { kind: 'dirtyChanged', panelId: 'p1', dirty: true },
    ]);

    events.length = 0;
    editDocument(coord, meta('p1', path), 'v3\n');
    expect(events).toEqual([{ kind: 'changed', panelId: 'p1' }]);
  });

  it('fires dirtyChanged(false) on an undo back to the saved text, and dirtyChanged(true) on the redo', async () => {
    const path = join(root, 'a.txt');
    await writeFile(path, 'v1\n');
    await coord.load({ ...meta('p1', path), absPath: path });
    editDocument(coord, meta('p1', path), 'v2\n');
    events.length = 0;

    coord.undo('p1', 'view-1');
    expect(events).toEqual([
      { kind: 'changed', panelId: 'p1' },
      { kind: 'dirtyChanged', panelId: 'p1', dirty: false },
    ]);

    events.length = 0;
    coord.redo('p1', 'view-1');
    expect(events).toEqual([
      { kind: 'changed', panelId: 'p1' },
      { kind: 'dirtyChanged', panelId: 'p1', dirty: true },
    ]);
  });

  it('fires changed + dirtyChanged(true) on a bulk replace into a clean document', async () => {
    const path = join(root, 'a.txt');
    await writeFile(path, 'foo\n');
    await coord.load({ ...meta('p1', path), absPath: path });
    events.length = 0;

    const result = coord.bulkReplace({
      absPath: path,
      term: 'foo',
      modes: NO_MODES,
      replacement: 'bar',
      edits: [{ from: 0, to: 3 } satisfies Match],
    });

    expect(result?.applied).toHaveLength(1);
    expect(events).toEqual([
      { kind: 'changed', panelId: 'p1' },
      { kind: 'dirtyChanged', panelId: 'p1', dirty: true },
    ]);
  });
});

describe('DocumentLifecycleListener — changed and dirtyChanged on resets (T043, contract §3 amended)', () => {
  it('revert: changed + dirtyChanged(false)', async () => {
    const path = join(root, 'a.txt');
    await writeFile(path, 'v1\n');
    await coord.load({ ...meta('p1', path), absPath: path });
    editDocument(coord, meta('p1', path), 'discard me\n');
    events.length = 0;

    expect(coord.revert('p1')).toBe(true);

    expect(events).toEqual([
      { kind: 'changed', panelId: 'p1' },
      { kind: 'dirtyChanged', panelId: 'p1', dirty: false },
    ]);
  });

  it('restoreRecovered: changed + dirtyChanged(true)', async () => {
    const path = join(root, 'a.txt');
    await writeFile(path, 'v1\n');
    await coord.load({ ...meta('p1', path), absPath: path });
    events.length = 0;

    coord.restoreRecovered('p1', 'recovered after a crash\n');

    expect(events).toEqual([
      { kind: 'changed', panelId: 'p1' },
      { kind: 'dirtyChanged', panelId: 'p1', dirty: true },
    ]);
  });

  it('live external reload of a clean document: changed (it stays clean, so no dirtyChanged)', async () => {
    const path = join(root, 'a.txt');
    await writeFile(path, 'v1\n');
    await coord.load({ ...meta('p1', path), absPath: path });
    events.length = 0;

    await writeFile(path, 'v2 from another program\n');
    await until(() => (coord.getContent('p1')?.text === 'v2 from another program\n' ? true : undefined));
    // Let any further watch events for the same write settle; they must add nothing.
    await new Promise((r) => setTimeout(r, 200));

    expect(coord.getContent('p1')?.text).toBe('v2 from another program\n');
    expect(events).toEqual([{ kind: 'changed', panelId: 'p1' }]);
  });

  it('reload of a dirty document: changed + dirtyChanged(false)', async () => {
    const c = quiet();
    const path = join(root, 'a.txt');
    await writeFile(path, 'v1\n');
    await c.load({ ...meta('p1', path), absPath: path });
    editDocument(c, meta('p1', path), 'mine\n');
    await writeFile(path, 'v2 on disk\n');
    events.length = 0;

    const res = await c.reload('p1');

    expect(res.ok).toBe(true);
    expect(events).toEqual([
      { kind: 'changed', panelId: 'p1' },
      { kind: 'dirtyChanged', panelId: 'p1', dirty: false },
    ]);
  });

  it('reload of a clean document whose file changed: changed only', async () => {
    const c = quiet();
    const path = join(root, 'a.txt');
    await writeFile(path, 'v1\n');
    await c.load({ ...meta('p1', path), absPath: path });
    await writeFile(path, 'v2 on disk\n');
    events.length = 0;

    const res = await c.reload('p1');

    expect(res.ok).toBe(true);
    expect(events).toEqual([{ kind: 'changed', panelId: 'p1' }]);
  });

  it('auto-recovery adopting a returned file with different text: changed + dirtyChanged(false)', async () => {
    const c = quiet();
    const path = join(root, 'a.txt');
    await writeFile(path, 'v1\n');
    await c.load({ ...meta('p1', path), absPath: path });
    c.markDeleted([path]);
    await writeFile(path, 'came back different\n');
    events.length = 0;

    await c.verifyPath('p1');

    expect(c.getContent('p1')?.text).toBe('came back different\n');
    expect(events).toEqual([
      { kind: 'changed', panelId: 'p1' },
      { kind: 'dirtyChanged', panelId: 'p1', dirty: false },
    ]);
  });

  it('file deleted under a clean document: dirtyChanged(true) only', async () => {
    const c = quiet();
    const path = join(root, 'a.txt');
    await writeFile(path, 'v1\n');
    await c.load({ ...meta('p1', path), absPath: path });
    events.length = 0;

    c.markDeleted([path]);

    expect(events).toEqual([{ kind: 'dirtyChanged', panelId: 'p1', dirty: true }]);
  });

  it('file restored holding the buffer text: dirtyChanged(false) only', async () => {
    const c = quiet();
    const path = join(root, 'a.txt');
    await writeFile(path, 'v1\n');
    await c.load({ ...meta('p1', path), absPath: path });
    c.markDeleted([path]);
    events.length = 0;

    await c.markRestored([path]);

    expect(events).toEqual([{ kind: 'dirtyChanged', panelId: 'p1', dirty: false }]);
  });

  /*
   * Contract §3 (amended, adversarial review main item 1 + fix round 1 ruling): `changed` also fires once per
   * flip of `contentless` — the document has no content of its file to follow — text or no text, because a
   * parented preview shows FR-026's notice exactly while that holds. A document that was READ keeps its
   * buffer when its file goes (FR-099) and never becomes contentless, so the cases above fire nothing extra.
   */
  it('a restore-time unloadable register whose file appears EMPTY: changed once (content to follow now), though no text changed', async () => {
    const c = quiet();
    const path = join(root, 'a.txt');
    c.register({ ...meta('p1', path), absPath: path }, '', { unloadable: true });
    expect(c.getContent('p1')).toMatchObject({ unloadable: true, contentless: true });
    events.length = 0;

    await writeFile(path, '');
    await c.verifyPath('p1');

    expect(c.getContent('p1')).toMatchObject({ text: '', unloadable: false, contentless: false });
    expect(events).toEqual([{ kind: 'changed', panelId: 'p1' }]);
  });

  it('a failed verify of a document that was read: nothing (it keeps content to follow)', async () => {
    const c = quiet();
    const dir = join(root, 'going');
    await mkdir(dir);
    const path = join(dir, 'a.txt');
    await writeFile(path, 'v1\n');
    expect((await c.load({ ...meta('p1', path), absPath: path })).ok).toBe(true);
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    events.length = 0;

    await c.verifyPath('p1');

    expect(c.getContent('p1')).toMatchObject({ unloadable: true, contentless: false });
    expect(events).toEqual([]);
  });
});

describe('DocumentLifecycleListener — no dirtyChanged when nothing flipped (T043)', () => {
  it('markDeleted on an already-dirty document', async () => {
    const c = quiet();
    const path = join(root, 'a.txt');
    await writeFile(path, 'v1\n');
    await c.load({ ...meta('p1', path), absPath: path });
    editDocument(c, meta('p1', path), 'mine\n');
    events.length = 0;

    c.markDeleted([path]);

    expect(events).toEqual([]);
  });

  it('markRestored when the restored file differs from the buffer', async () => {
    const c = quiet();
    const path = join(root, 'a.txt');
    await writeFile(path, 'v1\n');
    await c.load({ ...meta('p1', path), absPath: path });
    editDocument(c, meta('p1', path), 'mine\n');
    c.markDeleted([path]);
    events.length = 0;

    await c.markRestored([path]);

    expect(c.getContent('p1')?.dirty).toBe(true);
    expect(events).toEqual([]);
  });

  it('a path coming back under a document holding the user’s own work', async () => {
    const c = quiet();
    const path = join(root, 'a.txt');
    await writeFile(path, 'v1\n');
    await c.load({ ...meta('p1', path), absPath: path });
    editDocument(c, meta('p1', path), 'mine\n');
    c.markDeleted([path]);
    events.length = 0;

    await c.verifyPath('p1');

    expect(c.getContent('p1')).toMatchObject({ text: 'mine\n', dirty: true, unloadable: false });
    expect(events).toEqual([]);
  });

  it('saving a clean document', async () => {
    const c = quiet();
    const path = join(root, 'a.txt');
    await writeFile(path, 'v1\n');
    await c.load({ ...meta('p1', path), absPath: path });
    events.length = 0;

    const res = await c.save({ panelId: 'p1' });

    expect(res.ok).toBe(true);
    expect(events).toEqual([]);
  });

  it('reverting a clean document', async () => {
    const c = quiet();
    const path = join(root, 'a.txt');
    await writeFile(path, 'v1\n');
    await c.load({ ...meta('p1', path), absPath: path });
    events.length = 0;

    expect(c.revert('p1')).toBe(true);

    expect(events).toEqual([]);
  });
});

describe('DocumentLifecycleListener — a throwing listener never aborts the coordinator (contract §3)', () => {
  function silenceLog(): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(console, 'error').mockImplementation(() => {});
  }

  it('save (Save As of a dirty document) completes, relays, and drops its recovery temp', async () => {
    const log = silenceLog();
    const listener = throwingListener();
    const c = quiet(listener);
    const from = join(root, 'a.txt');
    const to = join(root, 'dest', 'b.txt');
    await writeFile(from, 'v1\n');
    await c.load({ ...meta('p1', from), absPath: from });
    editDocument(c, meta('p1', from), 'unsaved\n');
    expect(await until(() => c.recoverOne('p1').then((s) => s ?? undefined))).toBeTruthy();
    listener.arm();
    synced.length = 0;

    const res = await c.save({ panelId: 'p1', absPath: to });

    expect(res.ok).toBe(true);
    expect(listener.thrown).toEqual(['repointed', 'dirtyChanged']);
    expect(c.getContent('p1')).toMatchObject({ absPath: to, dirty: false });
    expect(c.isOpen(to)).toBe(true);
    expect(c.isOpen(from)).toBe(false);
    expect(synced.map((s) => s.msg)).toContainEqual({ panelId: 'p1', dirty: false });
    expect(await until(async () => ((await c.recoverOne('p1')) === null ? true : undefined))).toBe(true);
    expect(log).toHaveBeenCalled();
  });

  it('saveAll saves every dirty document', async () => {
    silenceLog();
    const listener = throwingListener();
    const c = quiet(listener);
    const a = join(root, 'a.txt');
    const b = join(root, 'b.txt');
    await writeFile(a, 'a\n');
    await writeFile(b, 'b\n');
    await c.load({ ...meta('p1', a), absPath: a });
    await c.load({ ...meta('p2', b), absPath: b });
    editDocument(c, meta('p1', a), 'a2\n');
    editDocument(c, meta('p2', b), 'b2\n');
    listener.arm();

    const result = await c.saveAll('all', { activeTabId: 't1', activeProjectId: 'A' });

    expect(result.saved).toEqual(['p1', 'p2']);
    expect(c.getContent('p1')?.dirty).toBe(false);
    expect(c.getContent('p2')?.dirty).toBe(false);
    expect(listener.thrown).toEqual(['dirtyChanged', 'dirtyChanged']);
  });

  it('markMoved re-points and relays movedTo for EVERY moved document', async () => {
    silenceLog();
    const listener = throwingListener();
    const c = quiet(listener);
    const x = join(root, 'x.txt');
    const y = join(root, 'y.txt');
    const x2 = join(root, 'dest', 'x.txt');
    const y2 = join(root, 'dest', 'y.txt');
    await writeFile(x, 'x\n');
    await writeFile(y, 'y\n');
    await c.load({ ...meta('p1', x), absPath: x });
    await c.load({ ...meta('p2', y), absPath: y });
    c.beginMove([x, y]);
    await rename(x, x2);
    await rename(y, y2);
    listener.arm();
    synced.length = 0;

    expect(() => c.markMoved([{ from: x, to: x2 }, { from: y, to: y2 }])).not.toThrow();

    expect(synced.map((s) => s.msg)).toEqual([
      { panelId: 'p1', movedTo: x2 },
      { panelId: 'p2', movedTo: y2 },
    ]);
    expect(c.getContent('p1')?.absPath).toBe(x2);
    expect(c.getContent('p2')?.absPath).toBe(y2);
    expect(listener.thrown).toEqual(['repointed', 'repointed']);
  });

  it('load re-point still deletes the old recovery temp', async () => {
    silenceLog();
    const listener = throwingListener();
    const c = quiet(listener);
    const a = join(root, 'a.txt');
    const b = join(root, 'b.txt');
    await writeFile(a, 'a\n');
    await writeFile(b, 'b\n');
    await c.load({ ...meta('p1', a), absPath: a });
    editDocument(c, meta('p1', a), 'a unsaved\n');
    expect(await until(() => c.recoverOne('p1').then((s) => s ?? undefined))).toBeTruthy();
    listener.arm();

    const res = await c.load({ ...meta('p1', b), absPath: b });

    expect(res.ok).toBe(true);
    expect(await c.recoverOne('p1')).toBeNull();
    expect(c.isOpen(a)).toBe(false);
    expect(c.isOpen(b)).toBe(true);
    expect(listener.thrown).toEqual(['unregistered', 'registered']);
  });

  it('destroy removes the document and its recovery temp', async () => {
    silenceLog();
    const listener = throwingListener();
    const c = quiet(listener);
    const a = join(root, 'a.txt');
    await writeFile(a, 'a\n');
    await c.load({ ...meta('p1', a), absPath: a });
    editDocument(c, meta('p1', a), 'a unsaved\n');
    expect(await until(() => c.recoverOne('p1').then((s) => s ?? undefined))).toBeTruthy();
    listener.arm();

    expect(() => c.destroy('p1')).not.toThrow();

    expect(c.getContent('p1')).toBeNull();
    expect(c.isOpen(a)).toBe(false);
    expect(await until(async () => ((await c.recoverOne('p1')) === null ? true : undefined))).toBe(true);
    expect(listener.thrown).toEqual(['unregistered']);
  });

  it('markDeleted marks and relays every affected document', async () => {
    silenceLog();
    const listener = throwingListener();
    const c = quiet(listener);
    const a = join(root, 'a.txt');
    const b = join(root, 'b.txt');
    await writeFile(a, 'a\n');
    await writeFile(b, 'b\n');
    await c.load({ ...meta('p1', a), absPath: a });
    await c.load({ ...meta('p2', b), absPath: b });
    listener.arm();
    synced.length = 0;

    expect(() => c.markDeleted([a, b])).not.toThrow();

    expect(synced.map((s) => s.msg)).toEqual([
      { panelId: 'p1', deleted: true, dirty: true, unloadable: true },
      { panelId: 'p2', deleted: true, dirty: true, unloadable: true },
    ]);
    expect(listener.thrown).toEqual(['dirtyChanged', 'dirtyChanged']);
  });

  it('markRestored restores and relays every affected document', async () => {
    silenceLog();
    const listener = throwingListener();
    const c = quiet(listener);
    const a = join(root, 'a.txt');
    const b = join(root, 'b.txt');
    await writeFile(a, 'a\n');
    await writeFile(b, 'b\n');
    await c.load({ ...meta('p1', a), absPath: a });
    await c.load({ ...meta('p2', b), absPath: b });
    c.markDeleted([a, b]);
    listener.arm();
    synced.length = 0;

    await c.markRestored([a, b]);

    expect(synced.map((s) => s.msg).filter((m) => m.deleted === false)).toEqual([
      { panelId: 'p1', deleted: false, unloadable: false, dirty: false },
      { panelId: 'p2', deleted: false, unloadable: false, dirty: false },
    ]);
    expect(c.getContent('p1')?.dirty).toBe(false);
    expect(c.getContent('p2')?.dirty).toBe(false);
    expect(listener.thrown).toEqual(['dirtyChanged', 'dirtyChanged']);
  });

  it('a dispatched edit relays its change and does not throw back into the caller', async () => {
    silenceLog();
    const listener = throwingListener();
    const c = quiet(listener);
    const a = join(root, 'a.txt');
    await writeFile(a, 'a\n');
    await c.load({ ...meta('p1', a), absPath: a });
    listener.arm();
    synced.length = 0;

    expect(() => editDocument(c, meta('p1', a), 'a2\n')).not.toThrow();

    expect(synced.some((s) => s.msg.change !== undefined)).toBe(true);
    expect(listener.thrown).toEqual(['changed', 'dirtyChanged']);
  });
});

describe('relaySync output is unaffected by an injected listener (T043)', () => {
  it('is identical, { from, msg } for { from, msg }, whether or not a listener is injected', async () => {
    // A fixed directory reused by both runs, so the paths the messages carry are the same strings. No
    // file watcher: a watch event racing the scripted steps would make the two streams differ for a
    // reason that has nothing to do with the listener.
    const dir = join(root, 'parity');

    async function run(withListener: boolean): Promise<Array<{ from: number; msg: EditorSyncMsg }>> {
      await mkdir(join(dir, 'dest'), { recursive: true });
      const a = join(dir, 'a.txt');
      const b = join(dir, 'b.txt');
      const moved = join(dir, 'dest', 'b.txt');
      await writeFile(a, 'foo v1\n');
      const recDir = await mkdtemp(join(tmpdir(), 'throng-lifecycle-parity-'));
      const out: Array<{ from: number; msg: EditorSyncMsg }> = [];
      const c = new EditorCoordinator(new EditorService(fs, () => DEFAULT_APP_SETTINGS), new EditorRecovery(recDir), {
        recoveryDebounceMs: 10_000,
        relaySync: (from, msg) => out.push({ from, msg }),
        persistUndoHistory: () => true,
        ...(withListener ? { documentLifecycle: recordingListener([]) } : {}),
      });
      const m1 = meta('p1', a, dir);

      await c.load({ ...m1, absPath: a });
      editDocument(c, m1, 'foo v2\n');
      c.undo('p1', 'view-1');
      c.redo('p1', 'view-1');
      c.undo('p1', 'view-1');
      c.bulkReplace({ absPath: a, term: 'foo', modes: NO_MODES, replacement: 'bar', edits: [{ from: 0, to: 3 }] });
      await c.save({ panelId: 'p1' });
      await c.save({ panelId: 'p1', absPath: b }); // Save As
      c.beginMove([b]);
      await rename(b, moved);
      c.markMoved([{ from: b, to: moved }]);
      editDocument(c, m1, 'dirty before delete\n');
      c.markDeleted([moved]);
      await c.markRestored([moved]);
      await c.reload('p1');
      editDocument(c, m1, 'to revert\n');
      c.revert('p1');
      c.restoreRecovered('p1', 'recovered\n');
      c.register(meta('p2', null, dir), '');
      editDocument(c, meta('p2', null, dir), 'scratch\n');
      await c.save({ panelId: 'p2', absPath: join(dir, 'c.txt') }); // first Save As
      c.destroy('p1');
      c.destroy('p2');

      await rm(recDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      return out;
    }

    const withListener = await run(true);
    const withoutListener = await run(false);

    expect(withListener.length).toBeGreaterThan(15);
    expect(withListener).toEqual(withoutListener);
  });
});
