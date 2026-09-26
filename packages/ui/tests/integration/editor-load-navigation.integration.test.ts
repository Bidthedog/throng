import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, isMissingReason, type NavigationHistory } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { NavigationHistoryService } from '../../src/main/navigation-history-service.js';
import { manualWatcher } from './helpers/preview-harness.js';
import { editDocument } from './helpers/edit-document.js';

/**
 * 044 T138 — an editor's history is recorded INSIDE `EditorCoordinator.load`, over a real coordinator,
 * a real `EditorService`, a real history service and a temp tree (contracts/navigation-history.md §3).
 *
 * Recording and moving have no renderer channel of their own: they are consequences of a load, so no
 * caller can move a position without the panel's content having changed. The table this pins:
 *
 * | Outcome of `load`   | Without `navigation` | With `navigation`                                  |
 * |---------------------|----------------------|----------------------------------------------------|
 * | Read succeeded      | `recordOpen`         | `moveTo(index)` if the entry still names the file  |
 * | File missing        | `recordOpen`         | `moveTo(index)` — FR-106d                          |
 * | Refused             | nothing              | nothing — FR-106c                                  |
 *
 * And the one path change that is the coordinator's own: Save As re-points the editor's current entry.
 */

const fs = new NodeFileSystem(async () => {});

let root: string;
let recoveryDir: string;
let coord: EditorCoordinator;
let history: NavigationHistoryService;
let changed: Array<{ panelId: string; history: NavigationHistory }>;
let a: string;
let b: string;
let c: string;
let binary: string;

function meta(panelId: string, absPath: string): Omit<DocMeta, 'encoding' | 'hasBom' | 'lineEnding' | 'absPath'> & { absPath: string } {
  return {
    panelId,
    windowId: '1',
    ownerKind: 'project',
    ownerProjectId: 'P',
    ownerRoot: root,
    allProjectRoots: [root],
    tabId: 't1',
    absPath,
  };
}

const open = (panelId: string, absPath: string) => coord.load(meta(panelId, absPath));
const back = (panelId: string, absPath: string, index: number) =>
  coord.load({ ...meta(panelId, absPath), navigation: { kind: 'history', index, filePath: absPath } });

const pathsOf = (panelId: string) => history.get(panelId)?.entries.map((e) => e.filePath);

function build(hooks?: ConstructorParameters<typeof EditorCoordinator>[2]['history']): EditorCoordinator {
  return new EditorCoordinator(new EditorService(fs, () => DEFAULT_APP_SETTINGS), new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10_000,
    relaySync: () => {},
    persistUndoHistory: () => false,
    history: hooks,
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-editor-nav-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-editor-nav-rec-'));
  a = join(root, 'a.ts');
  b = join(root, 'b.ts');
  c = join(root, 'c.ts');
  binary = join(root, 'blob.ts');
  await writeFile(a, 'export const a = 1;\n');
  await writeFile(b, 'export const b = 2;\n');
  await writeFile(c, 'export const c = 3;\n');
  await writeFile(binary, Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0x00, 0x00, 0x10]));
  changed = [];
  history = new NavigationHistoryService({ cap: () => 10, broadcastChanged: (msg) => void changed.push(msg) });
  coord = build(history);
});

afterEach(async () => {
  for (const id of ['ed1', 'ed2']) coord.destroy(id);
  for (const dir of [root, recoveryDir]) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('a load without navigation records (FR-103, FR-103a)', () => {
  it('a new editor’s first load is its first entry, and every window is told', async () => {
    expect((await open('ed1', a)).ok).toBe(true);
    expect(pathsOf('ed1')).toEqual([a]);
    expect(history.get('ed1')!.index).toBe(0);
    expect(changed.at(-1)).toEqual({ panelId: 'ed1', history: history.get('ed1') });
  });

  it('each later in-place load appends, and discards the entries newer than the position', async () => {
    await open('ed1', a);
    await open('ed1', b);
    await open('ed1', c);
    expect(pathsOf('ed1')).toEqual([a, b, c]);

    await back('ed1', a, 0);
    await open('ed1', c);
    // FR-103: appended again even though it occurs earlier; b and the old c are gone.
    expect(pathsOf('ed1')).toEqual([a, c]);
    expect(history.get('ed1')!.index).toBe(1);
  });

  it('loading the file that is already current adds nothing', async () => {
    await open('ed1', a);
    const before = history.get('ed1');
    const sent = changed.length;

    await open('ed1', a);

    expect(history.get('ed1')).toBe(before);
    expect(changed).toHaveLength(sent);
  });
});

describe('a load with a history intent moves only (FR-102)', () => {
  it('moves the index and leaves the list identical', async () => {
    await open('ed1', a);
    await open('ed1', b);
    const entries = history.get('ed1')!.entries;

    expect((await back('ed1', a, 0)).ok).toBe(true);
    expect(history.get('ed1')!.index).toBe(0);
    expect(history.get('ed1')!.entries).toBe(entries);

    expect((await back('ed1', b, 1)).ok).toBe(true);
    expect(history.get('ed1')!.index).toBe(1);
    expect(history.get('ed1')!.entries).toBe(entries);
    expect(coord.documentFor(b)).toMatchObject({ panelId: 'ed1' });
  });

  it('an intent whose entry no longer names that file changes nothing', async () => {
    await open('ed1', a);
    await open('ed1', b);
    const before = history.get('ed1');

    await coord.load({ ...meta('ed1', c), navigation: { kind: 'history', index: 0, filePath: c } });

    expect(history.get('ed1')).toBe(before);
  });

  it('a missing file with a history intent still moves, and the load reports could-not-read (FR-106d)', async () => {
    await open('ed1', a);
    await open('ed1', b);
    await unlink(a);

    const res = await back('ed1', a, 0);

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(isMissingReason(res.reason)).toBe(true);
    expect(history.get('ed1')!.index).toBe(0);
  });

  /*
   * US7b fix round 1, item 3 — the position moving is only half of FR-106d: the panel must SHOW that entry's
   * could-not-read state, not keep the previous file under a moved position. So the history step replaces
   * the panel's document with an empty, unloadable one at the target — the previous document torn down
   * exactly as a successful in-place open tears it down.
   */
  it('a history step onto a missing file replaces the document with an unloadable one at the target (FR-106d)', async () => {
    const events: string[] = [];
    const resets: Array<{ panelId: string; text: string }> = [];
    coord.destroy('ed1');
    coord = new EditorCoordinator(new EditorService(fs, () => DEFAULT_APP_SETTINGS), new EditorRecovery(recoveryDir), {
      recoveryDebounceMs: 10_000,
      relaySync: (_sender, msg) => {
        const m = msg as { panelId: string; reset?: { text: string } };
        if (m.reset) resets.push({ panelId: m.panelId, text: m.reset.text });
      },
      persistUndoHistory: () => false,
      history,
      documentLifecycle: {
        registered: (p) => events.push(`registered:${p}`),
        unregistered: (p) => events.push(`unregistered:${p}`),
        repointed: (f, t) => events.push(`repointed:${f}->${t}`),
        changed: () => {},
        dirtyChanged: () => {},
      },
    });
    await open('ed1', a);
    await open('ed1', b);
    await unlink(a);
    events.length = 0;
    resets.length = 0;

    const res = await back('ed1', a, 0);

    expect(res.ok).toBe(false);
    expect(history.get('ed1')!.index).toBe(0);
    const doc = coord.getContent('ed1');
    /*
     * US7b fix round 2, item 5 — `fileMissing` is left false, matching `register()`'s own restore-failure
     * path. Setting it true (the original round 1 shape) would route this doc through `markRestored`'s
     * keep-the-buffer branch on a later restore — which skips re-reading unless the buffer already equals
     * the disk text, clearing the banner over the empty stand-in before the folder watch ever reloads it.
     */
    expect(doc).toMatchObject({ absPath: a, text: '', unloadable: true, fileMissing: false });
    // The previous file is no longer held open by this panel; the target is.
    expect(coord.documentFor(b)).toBeNull();
    expect(coord.documentFor(a)).toMatchObject({ panelId: 'ed1' });
    // Every view adopts the replacement, and the listener hears the swap exactly once.
    expect(resets).toEqual([{ panelId: 'ed1', text: '' }]);
    expect(events).toEqual([`unregistered:${b}`, `registered:${a}`]);
  });

  /*
   * US7b fix round 2, item 1 (IMPORTANT) — the origin window's banner comes from its own `openFile`
   * failure branch in `use-editor.ts`, which a SECOND view of the same panel (Sync to a sub-workspace
   * window) never runs — it only ever adopts `broadcastReset`'s state (text/version/dirty) and the
   * generic `onSync` listener. So a step onto a missing file has to say `unloadable` on the wire too,
   * the same shape `markDeleted`, `pathCameBack` and `verifyPath` already relay, or a second view is left
   * showing an empty buffer with no banner (the 027/#161 hazard, one level up). And a later READABLE step
   * relays `unloadable: false`, so that view's banner clears on Forward too.
   */
  it('relays unloadable:true on the missing step, and unloadable:false on the readable step after it', async () => {
    const messages: Array<{ panelId: string; unloadable: boolean }> = [];
    coord.destroy('ed1');
    coord = new EditorCoordinator(new EditorService(fs, () => DEFAULT_APP_SETTINGS), new EditorRecovery(recoveryDir), {
      recoveryDebounceMs: 10_000,
      relaySync: (_sender, msg) => {
        const m = msg as { panelId: string; unloadable?: boolean };
        if (typeof m.unloadable === 'boolean') messages.push({ panelId: m.panelId, unloadable: m.unloadable });
      },
      persistUndoHistory: () => false,
      history,
    });
    await open('ed1', a);
    await open('ed1', b);
    await unlink(a);
    messages.length = 0;

    await back('ed1', a, 0);
    expect(messages).toEqual([{ panelId: 'ed1', unloadable: true }]);

    messages.length = 0;
    await back('ed1', b, 1);
    expect(messages).toEqual([{ panelId: 'ed1', unloadable: false }]);
  });

  /*
   * xwindow fix — a panel shown in two windows (Sync to) has ONE document (FR-110, Principle XI), and a
   * load that puts a DIFFERENT file into it is broadcast to every view as a reset. The window that asked
   * learns the new path from its own load's answer; every OTHER view has only the relays to go on. So the
   * reset has to name the file, or the other window keeps its pill, title and banner on the old one — found
   * by the E2E phase, 6/6: Back onto a deleted `a.txt` left the other window naming `b.txt` over an empty
   * document. The readable step and a plain in-place open replace the document through the same relays.
   */
  describe('every view is told WHICH file the panel now holds (FR-110, Sync to)', () => {
    let resets: Array<Record<string, unknown>>;

    beforeEach(() => {
      resets = [];
      coord.destroy('ed1');
      coord = new EditorCoordinator(new EditorService(fs, () => DEFAULT_APP_SETTINGS), new EditorRecovery(recoveryDir), {
        recoveryDebounceMs: 10_000,
        relaySync: (_sender, msg) => {
          const m = msg as { panelId: string; reset?: Record<string, unknown> };
          if (m.panelId === 'ed1' && m.reset) resets.push(m.reset);
        },
        persistUndoHistory: () => false,
        history,
      });
    });

    it('Back onto a MISSING file: the relayed reset names that file (FR-106d)', async () => {
      await open('ed1', a);
      await open('ed1', b);
      await unlink(a);
      resets.length = 0;

      await back('ed1', a, 0);

      expect(resets).toHaveLength(1);
      expect(resets[0]!.filePath).toBe(a);
    });

    it('Back onto a READABLE file: the relayed reset names that file', async () => {
      await open('ed1', a);
      await open('ed1', b);
      resets.length = 0;

      await back('ed1', a, 0);

      expect(resets).toHaveLength(1);
      expect(resets[0]!.filePath).toBe(a);
    });

    it('a plain in-place open of another file: the relayed reset names that file', async () => {
      await open('ed1', a);
      resets.length = 0;

      await open('ed1', c);

      expect(resets).toHaveLength(1);
      expect(resets[0]!.filePath).toBe(c);
    });
  });

  /*
   * Adversarial review (main item 2) — the FR-106d stand-in is an empty document for a file that does not
   * exist, and it is watched like any other. Every event in its FOLDER re-read the path, found it missing,
   * and routed it through `markDeleted` (FR-099): dirty, a recovery temp for an empty buffer, and a
   * Save & open prompt on the next Alt+Right whose Save would CREATE the empty file. FR-099 keeps a buffer
   * the user had from a file that went away; the stand-in never had its file in this panel, so there is
   * nothing to keep and nothing to dirty.
   */
  describe('the FR-106d stand-in is not dirtied by its folder watch', () => {
    let watcher: ReturnType<typeof manualWatcher>;
    let dirtyRelays: boolean[];

    const letTheWatchLand = async (): Promise<void> => {
      for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
    };

    beforeEach(() => {
      watcher = manualWatcher();
      dirtyRelays = [];
      coord.destroy('ed1');
      coord = new EditorCoordinator(new EditorService(fs, () => DEFAULT_APP_SETTINGS), new EditorRecovery(recoveryDir), {
        recoveryDebounceMs: 10_000,
        relaySync: (_sender, msg) => {
          if (msg.panelId === 'ed1' && typeof msg.dirty === 'boolean') dirtyRelays.push(msg.dirty);
        },
        persistUndoHistory: () => false,
        history,
        fileWatcher: watcher,
      });
    });

    it('an unrelated change in its folder leaves it clean, writes no recovery temp, and Forward just moves', async () => {
      await open('ed1', a);
      await open('ed1', b);
      await unlink(a);
      await back('ed1', a, 0);

      await writeFile(join(root, 'unrelated.ts'), 'x\n');
      watcher.fire();
      await letTheWatchLand();

      expect(coord.getContent('ed1')).toMatchObject({ absPath: a, text: '', dirty: false, unloadable: true, fileMissing: false });
      expect(dirtyRelays).not.toContain(true);
      expect(await coord.recoverOne('ed1')).toBeNull();

      // Clean, so the renderer raises no unsaved-open prompt: Forward is a plain load, and it moves.
      expect((await back('ed1', b, 1)).ok).toBe(true);
      expect(history.get('ed1')!.index).toBe(1);
      expect(coord.getContent('ed1')).toMatchObject({ absPath: b, dirty: false, unloadable: false });
    });

    it('a file that later appears at the stand-in’s path is still adopted from disk', async () => {
      await open('ed1', a);
      await open('ed1', b);
      await unlink(a);
      await back('ed1', a, 0);
      watcher.fire();
      await letTheWatchLand();

      await writeFile(a, 'export const back = true;\n');
      watcher.fire();
      await letTheWatchLand();

      expect(coord.getContent('ed1')).toMatchObject({
        absPath: a,
        text: 'export const back = true;\n',
        dirty: false,
        unloadable: false,
      });
    });

    /*
     * Fix round 1 ruling (concern 3) — the same shape one layer over: a RESTORE whose file was already gone
     * registers an empty, unloadable document (027 / #161, `use-editor.ts`'s load-failure branch). It was
     * never read in its panel either, so an unrelated event in its folder must not dirty it.
     */
    it('a restore-time unloadable register is not dirtied by an unrelated folder event either', async () => {
      await unlink(a);
      coord.register(
        { ...meta('ed1', a), encoding: 'utf8', hasBom: false, lineEnding: 'lf' },
        '',
        { unloadable: true },
      );

      await writeFile(join(root, 'unrelated.ts'), 'x\n');
      watcher.fire();
      await letTheWatchLand();

      expect(coord.getContent('ed1')).toMatchObject({ absPath: a, text: '', dirty: false, unloadable: true, fileMissing: false });
      expect(dirtyRelays).not.toContain(true);
      expect(await coord.recoverOne('ed1')).toBeNull();
    });

    /*
     * Review of batch B, M-2 — `neverRead` was honoured only by the folder WATCH. File Explorer's own delete
     * calls `markDeleted` directly (`FilesService.setOnDeleted`), and the stand-in passed its `fileMissing`
     * guard: an in-app delete of its folder dirtied the empty stand-in all the same.
     */
    it('an in-app delete of the stand-in’s folder leaves it clean, with no recovery temp', async () => {
      await open('ed1', a);
      await open('ed1', b);
      await unlink(a);
      await back('ed1', a, 0);
      dirtyRelays.length = 0;

      coord.markDeleted([root]);
      await letTheWatchLand();

      expect(coord.getContent('ed1')).toMatchObject({ absPath: a, text: '', dirty: false, fileMissing: false });
      expect(dirtyRelays).not.toContain(true);
      expect(await coord.recoverOne('ed1')).toBeNull();
    });

    it('an in-app delete of a restore-time unloadable register’s folder leaves it clean too', async () => {
      await unlink(a);
      coord.register({ ...meta('ed1', a), encoding: 'utf8', hasBom: false, lineEnding: 'lf' }, '', { unloadable: true });

      coord.markDeleted([root]);
      await letTheWatchLand();

      expect(coord.getContent('ed1')).toMatchObject({ absPath: a, text: '', dirty: false, fileMissing: false });
      expect(dirtyRelays).not.toContain(true);
      expect(await coord.recoverOne('ed1')).toBeNull();
    });

    it('a stand-in the user TYPED into is kept dirty by an in-app delete, like any buffer (FR-099)', async () => {
      await open('ed1', a);
      await open('ed1', b);
      await unlink(a);
      await back('ed1', a, 0);
      editDocument(coord, { ...meta('ed1', a), encoding: 'utf8', hasBom: false, lineEnding: 'lf' }, 'typed\n');

      coord.markDeleted([root]);

      expect(coord.getContent('ed1')).toMatchObject({ text: 'typed\n', dirty: true, fileMissing: true });
    });

    it('a document whose file WAS read in this panel and then vanished is still kept dirty (FR-099)', async () => {
      await open('ed1', a);
      await unlink(a);
      watcher.fire();
      await letTheWatchLand();

      expect(coord.getContent('ed1')).toMatchObject({ absPath: a, dirty: true, fileMissing: true, unloadable: true });
    });
  });

  it('a history step onto a missing file that is the CURRENT one keeps a single registration', async () => {
    await open('ed1', a);
    await unlink(a);
    history.purge('ed1');
    history.attach('ed1', 'editor', { v: 1, entries: [{ filePath: a }, { filePath: b }], index: 1 });

    await back('ed1', a, 0);

    expect(coord.getContent('ed1')).toMatchObject({ absPath: a, unloadable: true });
    expect(coord.documentFor(a)).toMatchObject({ panelId: 'ed1' });
  });

  it('a missing file WITHOUT an intent is still an open into the panel, and records (041 FR-015)', async () => {
    await open('ed1', a);
    const ghost = join(root, 'ghost.ts');

    const res = await open('ed1', ghost);

    expect(res.ok).toBe(false);
    expect(pathsOf('ed1')).toEqual([a, ghost]);
  });

  it('a refused load neither records nor moves (FR-106c)', async () => {
    await open('ed1', b);
    // A refused file can never be recorded by a load, so seed a history that names one — as a layout
    // would after the file was replaced by a binary one — then step back onto it.
    history.purge('ed1');
    history.attach('ed1', 'editor', { v: 1, entries: [{ filePath: binary }, { filePath: b }], index: 1 });
    const before = history.get('ed1');

    const refused = await back('ed1', binary, 0);
    const refusedOpen = await open('ed1', binary);

    expect(refused).toMatchObject({ ok: false, reason: 'binary' });
    expect(refusedOpen).toMatchObject({ ok: false, reason: 'binary' });
    expect(history.get('ed1')).toBe(before);
  });
});

describe('restore — the persisted history travels IN the load (§6, amended 2026-09-15)', () => {
  /*
   * The first cut restored an editor's history through a separate `throng:history:attach`, which only
   * worked if it reached main before the load. When the load won, `recordOpen` created `[file]`, the late
   * attach adopted THAT, and the persisted list was gone — and the broadcast then overwrote
   * `config.history` in every layout. Carrying the history in the load removes the ordering altogether.
   */
  const persistedAB = () => ({ v: 1 as const, entries: [{ filePath: a }, { filePath: b }], index: 1 });

  it('a restoring load with history and NO attach keeps the persisted entries', async () => {
    expect((await coord.load({ ...meta('ed1', b), history: persistedAB() })).ok).toBe(true);

    expect(pathsOf('ed1')).toEqual([a, b]);
    expect(history.get('ed1')!.index).toBe(1);
    // One broadcast carrying the adopted list — not an empty one, not `[b]`.
    expect(changed).toEqual([{ panelId: 'ed1', history: history.get('ed1') }]);
  });

  it('records correctly on top of the adopted history', async () => {
    await coord.load({ ...meta('ed1', b), history: persistedAB() });
    await coord.load({ ...meta('ed1', c), history: persistedAB() });

    // The second load's (stale) history is ignored: the record exists.
    expect(pathsOf('ed1')).toEqual([a, b, c]);
    expect(history.get('ed1')!.index).toBe(2);
  });

  it('a history-intent load carrying history adopts it and then moves against it', async () => {
    const res = await coord.load({
      ...meta('ed1', a),
      history: persistedAB(),
      navigation: { kind: 'history', index: 0, filePath: a },
    });

    expect(res.ok).toBe(true);
    expect(pathsOf('ed1')).toEqual([a, b]);
    expect(history.get('ed1')!.index).toBe(0);
  });

  it('a later attach adopts what the load already adopted', async () => {
    await coord.load({ ...meta('ed1', b), history: persistedAB() });
    const before = history.get('ed1');
    expect(history.attach('ed1', 'editor', { v: 1, entries: [{ filePath: c }], index: 0 })).toBe(before);
  });

  it('a REFUSED restoring load still adopts the persisted history, recording nothing on top', async () => {
    const res = await coord.load({
      ...meta('ed1', binary),
      history: { v: 1, entries: [{ filePath: a }, { filePath: binary }], index: 1 },
    });

    expect(res).toMatchObject({ ok: false, reason: 'binary' });
    expect(pathsOf('ed1')).toEqual([a, binary]);
    expect(history.get('ed1')!.index).toBe(1);
  });
});

describe('Save As re-points the current entry (FR-109, FR-103, R14)', () => {
  it('rewrites the current entry — no second entry, no stale one — so Back then Forward lands on the new path', async () => {
    await open('ed1', a);
    await open('ed1', b);
    const saved = join(root, 'renamed.ts');

    const res = await coord.save({ panelId: 'ed1', absPath: saved });
    expect(res.ok).toBe(true);

    expect(pathsOf('ed1')).toEqual([a, saved]);
    expect(history.get('ed1')!.index).toBe(1);

    // A later open of the new path is the current file: nothing added.
    const before = history.get('ed1');
    await open('ed1', saved);
    expect(history.get('ed1')).toBe(before);

    await back('ed1', a, 0);
    await back('ed1', saved, 1);
    expect(history.get('ed1')!.index).toBe(1);
    expect(pathsOf('ed1')).toEqual([a, saved]);
  });

  /*
   * Adversarial review (core M3, H2a) — Save As onto the file one step back rewrote the current entry into a
   * copy of its neighbour: `[a, a]`, where Back moved the position and the panel showed the same file.
   */
  it('Save As onto the PREVIOUS file merges the two entries: nothing left for Back to land on (H2a)', async () => {
    await open('ed1', a);
    await open('ed1', b);

    expect((await coord.save({ panelId: 'ed1', absPath: a })).ok).toBe(true);

    expect(pathsOf('ed1')).toEqual([a]);
    expect(history.get('ed1')!.index).toBe(0);
  });

  it('the first Save As of a new, unpathed document is that editor’s first entry (H8)', async () => {
    coord.register({
      panelId: 'ed2',
      windowId: '1',
      ownerKind: 'project',
      ownerProjectId: 'P',
      ownerRoot: root,
      allProjectRoots: [root],
      tabId: 't1',
      absPath: null,
      encoding: 'utf8',
      hasBom: false,
      lineEnding: 'lf',
    });
    const target = join(root, 'new.ts');

    expect((await coord.save({ panelId: 'ed2', absPath: target })).ok).toBe(true);

    expect(pathsOf('ed2')).toEqual([target]);
  });

  it('a plain save (no new path) rewrites nothing', async () => {
    await open('ed1', a);
    const before = history.get('ed1');
    await coord.save({ panelId: 'ed1' });
    expect(history.get('ed1')).toBe(before);
  });
});

describe('isolation — a throwing history never aborts the coordinator’s own work', () => {
  it('load still loads and Save As still saves', async () => {
    const boom = (): never => {
      throw new Error('history exploded');
    };
    coord.destroy('ed1');
    coord = build({ attach: boom, recordOpen: boom, moveTo: boom, rewriteCurrent: boom });

    expect((await coord.load(meta('ed1', a))).ok).toBe(true);
    expect(
      (await coord.load({ ...meta('ed1', binary), history: { v: 1, entries: [{ filePath: binary }], index: 0 } })).ok,
    ).toBe(false);
    expect(coord.documentFor(a)).toMatchObject({ panelId: 'ed1' });
    const saved = join(root, 'still-saved.ts');
    expect((await coord.save({ panelId: 'ed1', absPath: saved })).ok).toBe(true);
    expect(coord.documentFor(saved)).toMatchObject({ panelId: 'ed1' });
    expect(
      (await coord.load({ ...meta('ed1', a), navigation: { kind: 'history', index: 0, filePath: a } })).ok,
    ).toBe(true);
  });
});
