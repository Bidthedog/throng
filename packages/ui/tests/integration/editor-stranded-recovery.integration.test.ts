import { mkdtemp, rm, writeFile, rename, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta, type EditorSyncMsg } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { editDocument } from './helpers/edit-document.js';

/**
 * 027 / #161 — a stranded editor, and the rule that decides what recovery is allowed to take.
 *
 * The E2E covers the user's journey. This covers the DECISION inside it, which is the part that can
 * lose work if it is wrong and which no end-to-end assertion reaches: when the path comes back, does
 * the document adopt the file, or keep its buffer?
 *
 * It cannot be answered from `authority.dirty`. A document whose file went missing is FORCE-dirtied
 * — `markUnsaved` drops `savedText` so it cannot look saved while there is no file — so by the time
 * the path returns, every stranded document reports dirty whether the user typed a word or not.
 * Reading that flag means never recovering anything, which is the bug; ignoring it means silently
 * overwriting real unsaved edits, which is worse than the bug.
 */

const fs = new NodeFileSystem(async () => {});

let root: string;
let recoveryDir: string;
let coord: EditorCoordinator;
let synced: EditorSyncMsg[];

function meta(panelId: string, absPath: string): DocMeta {
  return {
    panelId, windowId: 'w1', ownerKind: 'project', ownerProjectId: 'A', ownerRoot: root,
    allProjectRoots: [root], tabId: 't1', absPath, encoding: 'utf8', hasBom: false, lineEnding: 'lf',
  };
}

async function until<T>(get: () => T | undefined, ms = 8000): Promise<T | undefined> {
  for (let i = 0; i < ms / 25; i++) {
    const v = get();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  return get();
}

/**
 * A coordinator, optionally WITHOUT the folder watch.
 *
 * The on-demand operations (`reload`, `verifyPath`) have to be observed in isolation: with a live
 * watch running, the auto-recovery would reach the document first and the test would pass without
 * the operation under test doing anything at all.
 */
function makeCoord(opts: { watch: boolean }): EditorCoordinator {
  const service = new EditorService(fs, () => DEFAULT_APP_SETTINGS);
  return new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10,
    relaySync: (_from, msg) => synced.push(msg),
    persistUndoHistory: () => true,
    ...(opts.watch ? { fileWatcher: new NodeFileWatcher(20) } : {}),
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-strand-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-strand-rec-'));
  synced = [];
  coord = makeCoord({ watch: true });
});

afterEach(async () => {
  for (const dir of [root, recoveryDir]) {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe('a stranded editor recovers when its path comes back (027 / #161)', () => {
  it('a document registered over an unreadable path is unloadable, and adopts the file when it appears', async () => {
    // Exactly what a mount does when its load fails: register the panel over the path it could not
    // read, with nothing in the buffer. This is the restart case — the folder was renamed away
    // while throng was closed, so no watch ever saw it go.
    const dir = join(root, 'src');
    const file = join(dir, 'code.txt');
    coord.register(meta('p1', file), '', { unloadable: true });
    expect(coord.getContent('p1')).toMatchObject({ unloadable: true, text: '' });

    // The user puts the folder back — with the file having moved on while it was away, so
    // "it recovered" cannot be satisfied by whatever was already in the buffer.
    await mkdir(dir);
    await writeFile(file, 'BACK-AND-CHANGED\n');

    const reset = await until(() =>
      synced.find((m) => m.panelId === 'p1' && m.reset?.text === 'BACK-AND-CHANGED\n'),
    );
    expect(reset, 'the path came back and the document never re-read it').toBeDefined();
    // Clean: what we hold is now demonstrably what the file holds, so there is nothing to save.
    expect(coord.getContent('p1')).toMatchObject({
      text: 'BACK-AND-CHANGED\n',
      dirty: false,
      unloadable: false,
    });
  });

  it('KEEPS genuine unsaved edits when the file comes back, rather than overwriting them', async () => {
    // The rule that protects the user's work. The buffer here holds something only the buffer has.
    const file = join(root, 'doc.txt');
    await writeFile(file, 'ON-DISK-V1\n');
    await coord.load({ ...meta('p1', file) });
    editDocument(coord, meta('p1', file), 'MY-UNSAVED-WORK\n');
    expect(coord.getContent('p1')).toMatchObject({ dirty: true });

    // The file is deleted out from under those edits, then comes back holding something else.
    coord.markDeleted([file]);
    expect(coord.getContent('p1')).toMatchObject({ fileMissing: true, unloadable: true });
    await writeFile(file, 'SOMEONE-ELSES-VERSION\n');

    const cleared = await until(() =>
      synced.find((m) => m.panelId === 'p1' && m.unloadable === false),
    );
    expect(cleared, 'the path reads again but the editor is still claiming it cannot').toBeDefined();
    // The banner goes — the path reads, so Save and Revert work again — but the edits stay. They
    // are the only copy, and replacing them with the disk would be data loss dressed as recovery.
    const state = coord.getContent('p1');
    expect(state?.text).toBe('MY-UNSAVED-WORK\n');
    expect(state?.unloadable).toBe(false);
    // …and the divergence is announced, so the user is not left unaware that the file moved on.
    expect(synced.some((m) => m.panelId === 'p1' && m.externalChange === true)).toBe(true);
  });

  it('`reload` re-reads the path on demand — where `revert` refuses because there is nothing cached', async () => {
    // No watch: this is the on-demand path, and an auto-recovery racing it would prove nothing.
    coord = makeCoord({ watch: false });
    const file = join(root, 'doc.txt');
    await writeFile(file, 'V1\n');
    await coord.load({ ...meta('p1', file) });

    // A file that has gone: revert has no cached content to restore to, by design (FR-075).
    await rm(file);
    coord.markDeleted([file]);
    expect(coord.revert('p1')).toBe(false);

    // The same document, the same moment — reload reads the path, which is the only thing that can
    // rescue it. Still missing: it says so and changes nothing.
    const stillGone = await coord.reload('p1');
    expect(stillGone.ok).toBe(false);
    expect(coord.getContent('p1')).toMatchObject({ unloadable: true });

    // Put it back and ask again: this is the escape hatch for everything a watch cannot see.
    await writeFile(file, 'V2-FROM-DISK\n');
    const res = await coord.reload('p1');
    expect(res.ok).toBe(true);
    expect(coord.getContent('p1')).toMatchObject({
      text: 'V2-FROM-DISK\n',
      dirty: false,
      unloadable: false,
      fileMissing: false,
    });
  });

  it('`verifyPath` tells a REMOUNTING view its path has broken — without touching fileMissing', async () => {
    // A panel that is unmounted and remounted (a project switch, a window reload) adopts the
    // in-memory document and never attempts a load, so a break that happened while it was away is
    // invisible to it. That is the reporter's "switch to another project and back — the editor is
    // still blank" case.
    coord = makeCoord({ watch: false }); // the remount's own check, not the watch's
    const file = join(root, 'doc.txt');
    await writeFile(file, 'V1\n');
    await coord.load({ ...meta('p1', file) });
    expect(coord.getContent('p1')).toMatchObject({ unloadable: false });

    await rename(file, join(root, 'moved-away.txt'));
    await coord.verifyPath('p1');

    expect(coord.getContent('p1')).toMatchObject({ unloadable: true });
    // NOT `fileMissing`. That drives the tab-open "cannot open file" dialog, which FR-105 requires
    // to stay silent on a remount — and publishing it from here is what reddened
    // `editor-missing-aggregate` when this issue was first attempted.
    expect(coord.getContent('p1')).toMatchObject({ fileMissing: false });

    // And when the path is repaired, a remount's verify recovers it just as the watch would.
    await rename(join(root, 'moved-away.txt'), file);
    await coord.verifyPath('p1');
    expect(coord.getContent('p1')).toMatchObject({ text: 'V1\n', unloadable: false, dirty: false });
  });

  /**
   * MIGRATED FROM `editor-stranded-recovery.e2e.ts:133` (035 T056) — "an editor recovers when its
   * folder is renamed away and back WHILE throng is running".
   *
   * ══ WHY IT WAS NOT ALREADY COVERED HERE ══
   *
   * The two cases above are the OTHER two shapes, and the difference matters:
   *
   *   `:81`  the RESTART case — the folder went while throng was closed, so the document is
   *          registered `unloadable` and has never held the file.
   *   `:107` the FILE case — one file deleted under live edits, announced via `markDeleted`.
   *
   * This is the third: a document that LOADED cleanly, whose containing FOLDER then goes away
   * underneath it with nothing telling the coordinator so. Nothing calls `markDeleted`; the folder
   * watch is the only thing that can notice, and the panel keeps rendering its buffer meanwhile —
   * which the migrated test's own comment records as the reason it could find no fence to wait on
   * and had to sleep a second instead. Here there is no debounce to sleep through: the wait is for
   * the sync message that carries the new text, which cannot arrive at the old value.
   *
   * The content CHANGES while the folder is away, deliberately. If the assertion were "the original
   * text is still shown", a throng that noticed nothing at all would pass it while being exactly as
   * broken — the same non-vacuity argument the migrated test made, kept.
   */
  it('adopts the file again when its whole FOLDER is renamed away and back under a live watch', async () => {
    const dir = join(root, 'src');
    const file = join(dir, 'code.txt');
    await mkdir(dir);
    await writeFile(file, 'ORIGINAL\n');
    await coord.load({ ...meta('p1', file) });
    expect(coord.getContent('p1')).toMatchObject({ text: 'ORIGINAL\n', unloadable: false });

    // Break the path from outside — a folder rename, which is what the reporter did — and move the
    // file on while it is away.
    await rename(dir, join(root, 'src-moved'));
    await writeFile(join(root, 'src-moved', 'code.txt'), 'CHANGED-WHILE-AWAY\n');

    // Rectify the cause, exactly as the user does.
    await rename(join(root, 'src-moved'), dir);

    const reset = await until(() =>
      synced.find((m) => m.panelId === 'p1' && m.reset?.text === 'CHANGED-WHILE-AWAY\n'),
    );
    expect(reset, 'the folder came back and the document never re-read its path').toBeDefined();
    expect(coord.getContent('p1')).toMatchObject({
      text: 'CHANGED-WHILE-AWAY\n',
      dirty: false,
      unloadable: false,
    });
  });

  it('says NOTHING to a document whose own file did not move, when a sibling changes', async () => {
    /*
     * The control for the case above, and it took two attempts to make it discriminate.
     *
     * The watch is on the DIRECTORY — it has to be, or a delete could never be noticed — so every
     * write in the folder wakes every open document in it. The first draft asserted a dirty buffer
     * was not overwritten, which is true and which a coordinator that "recovered" on every event
     * would ALSO satisfy: `pathCameBack` keeps genuine unsaved work (`:107`), so the assertion
     * could not tell a correct coordinator from one that ran recovery constantly.
     *
     * So the observable is the SYNC TRAFFIC, on a CLEAN document. A spurious `reset` is not
     * harmless — it replaces the document and clears the undo history with it (FR-026d) — and it is
     * exactly what the old FR-028 bug produced: saving one file announced "changed on disk" on
     * every other file in the folder.
     */
    const dir = join(root, 'src');
    const file = join(dir, 'code.txt');
    await mkdir(dir);
    await writeFile(file, 'MINE\n');
    await coord.load({ ...meta('p1', file) });
    synced.length = 0;

    await writeFile(join(dir, 'sibling.txt'), 'SOMETHING-ELSE\n');
    await new Promise((r) => setTimeout(r, 250));

    expect(
      synced.filter((m) => m.panelId === 'p1' && m.reset),
      'a sibling write is not news about this document',
    ).toEqual([]);
    expect(synced.filter((m) => m.panelId === 'p1' && m.externalChange)).toEqual([]);
    expect(coord.getContent('p1')?.text).toBe('MINE\n');
  });

  it('keeps an unsaved buffer when a sibling changes', async () => {
    // The same event against a DIRTY document. Separate from the case above because the branches
    // are different — clean adopts, dirty warns — and a coordinator can get one right and the
    // other wrong.
    const dir = join(root, 'src');
    const file = join(dir, 'code.txt');
    await mkdir(dir);
    await writeFile(file, 'MINE\n');
    await coord.load({ ...meta('p1', file) });
    editDocument(coord, meta('p1', file), 'MY-UNSAVED-WORK\n');

    await writeFile(join(dir, 'sibling.txt'), 'SOMETHING-ELSE\n');
    await new Promise((r) => setTimeout(r, 250));

    expect(coord.getContent('p1')?.text).toBe('MY-UNSAVED-WORK\n');
  });
});
