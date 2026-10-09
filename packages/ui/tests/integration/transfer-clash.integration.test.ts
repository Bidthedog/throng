import { join } from 'node:path';
import { mkdtemp, readFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { ChangeSet } from '@codemirror/state';
import {
  DEFAULT_APP_SETTINGS,
  type ClashAnswer,
  type ClashQuestion,
  type ClipboardItem,
  type IFileWatcher,
} from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta, type EditorSyncMsg } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { disposeHarness, exists, makeHarness, put, snapshotTree, type Harness } from './helpers/transfer-harness.js';

/**
 * Name clashes are the user's decision (050 R3, FR-017 – FR-018f, SC-006 — T042).
 *
 * Nothing in the target changes before the answer; Replace, Skip and Keep both each do exactly what
 * they say; "apply to all" lasts for one job; a folder landing on a folder merges and asks only about
 * what actually clashes, at whatever depth.
 */

let h: Harness;
/** Scripted answers, in order; the harness records every question asked. */
let answers: ClashAnswer[];
/** What the target looked like at the moment each question was asked. */
let targetAtQuestion: Record<string, string>[];
let replaceMode: 'recycle' | 'permanent';

async function setup(): Promise<void> {
  answers = [];
  targetAtQuestion = [];
  replaceMode = 'recycle';
  h = await makeHarness({
    answer: async (_q: ClashQuestion) => {
      targetAtQuestion.push(await snapshotTree(join(h.rootB, 'dest')));
      return answers.shift() ?? { choice: 'cancel' };
    },
    deps: { replaceMode: () => replaceMode },
  });
  await put(join(h.rootA, 'a.txt'), 'incoming-a');
  await put(join(h.rootA, 'c.txt'), 'incoming-c');
  await put(join(h.rootB, 'dest', 'a.txt'), 'existing-a');
  await put(join(h.rootB, 'dest', 'c.txt'), 'existing-c');
}

const fromA = (...names: string[]): ClipboardItem[] =>
  names.map((n) => ({ absPath: join(h.rootA, n), projectId: 'A', projectRoot: h.rootA }));

const paste = (mode: 'cut' | 'copy', ...names: string[]) =>
  h.svc.paste(1, join(h.rootB, 'dest'), { mode, items: fromA(...names) }).result;

afterEach(async () => {
  await disposeHarness(h);
});

describe('the question (FR-017, FR-018)', () => {
  it('a file clash asks once, naming both sides, and NOTHING in the target changes before the answer', async () => {
    await setup();
    // The incoming file is the newer one.
    await utimes(join(h.rootB, 'dest', 'a.txt'), new Date(2020, 0, 1), new Date(2020, 0, 1));
    answers = [{ choice: 'skip', applyToAll: false }];
    await paste('copy', 'a.txt');
    expect(h.questions).toHaveLength(1);
    const q = h.questions[0]!;
    expect(q).toMatchObject({
      name: 'a.txt',
      targetDir: join(h.rootB, 'dest'),
      permanentReplace: false,
      existing: { kind: 'file', size: 'existing-a'.length, newer: false },
      incoming: { kind: 'file', size: 'incoming-a'.length, newer: true },
    });
    expect(typeof q.existing.modifiedMs).toBe('number');
    expect(typeof q.requestId).toBe('string');
    expect(targetAtQuestion[0]).toEqual({ 'a.txt': 'existing-a', 'c.txt': 'existing-c' });
  });

  it('under permanent replace the question says so', async () => {
    await setup();
    replaceMode = 'permanent';
    answers = [{ choice: 'skip', applyToAll: false }];
    await paste('copy', 'a.txt');
    expect(h.questions[0]!.permanentReplace).toBe(true);
  });

  it('a job with no clash never asks (FR-018d)', async () => {
    await setup();
    await put(join(h.rootA, 'fresh.txt'), 'fresh');
    const r = await paste('copy', 'fresh.txt');
    expect(r.failures).toEqual([]);
    expect(h.questions).toEqual([]);
  });
});

describe('the answers (FR-018a, FR-018b, FR-018f)', () => {
  it('Replace (recycle) sends the existing item to the Recycle Bin, then lands the incoming one', async () => {
    await setup();
    answers = [{ choice: 'replace', applyToAll: false }];
    const r = await paste('copy', 'a.txt');
    expect(r.failures).toEqual([]);
    expect(h.bin.trashed.map((t) => t.path)).toEqual([join(h.rootB, 'dest', 'a.txt')]);
    expect(await snapshotTree(join(h.rootB, 'dest'))).toEqual({ 'a.txt': 'incoming-a', 'c.txt': 'existing-c' });
  });

  it('Replace (permanent) deletes it for good and leaves the item out of the undo entry', async () => {
    await setup();
    replaceMode = 'permanent';
    answers = [{ choice: 'replace', applyToAll: false }];
    const r = await paste('cut', 'a.txt');
    expect(h.bin.trashed).toEqual([]);
    expect(await snapshotTree(join(h.rootB, 'dest'))).toEqual({ 'a.txt': 'incoming-a', 'c.txt': 'existing-c' });
    expect(r.undo).toBeNull();
  });

  it('Skip leaves both items untouched and the source on the clipboard', async () => {
    await setup();
    answers = [{ choice: 'skip', applyToAll: false }];
    const r = await paste('cut', 'a.txt');
    expect(r.failures).toEqual([]);
    expect(r.placed).toEqual([]);
    expect(await exists(join(h.rootA, 'a.txt'))).toBe(true);
    expect(await snapshotTree(join(h.rootB, 'dest'))).toEqual({ 'a.txt': 'existing-a', 'c.txt': 'existing-c' });
  });

  it('Keep both lands the incoming item as "name copy.ext"', async () => {
    await setup();
    answers = [{ choice: 'keep-both', applyToAll: false }];
    const r = await paste('cut', 'a.txt');
    expect(r.placed).toEqual([join(h.rootB, 'dest', 'a copy.txt')]);
    expect(await exists(join(h.rootA, 'a.txt'))).toBe(false);
    expect(await snapshotTree(join(h.rootB, 'dest'))).toEqual({
      'a.txt': 'existing-a',
      'a copy.txt': 'incoming-a',
      'c.txt': 'existing-c',
    });
    expect(r.undo).toMatchObject({ kind: 'move', items: [{ from: join(h.rootA, 'a.txt'), to: join(h.rootB, 'dest', 'a copy.txt') }] });
  });

  it('apply-to-all answers every later clash in the job, and does not carry into the next job', async () => {
    await setup();
    answers = [{ choice: 'keep-both', applyToAll: true }];
    await paste('copy', 'a.txt', 'c.txt');
    expect(h.questions).toHaveLength(1);
    expect(await exists(join(h.rootB, 'dest', 'c copy.txt'))).toBe(true);

    // Re-pasting the same set asks again — about every item (US5 AS7).
    answers = [
      { choice: 'skip', applyToAll: false },
      { choice: 'skip', applyToAll: false },
    ];
    await paste('copy', 'a.txt', 'c.txt');
    expect(h.questions).toHaveLength(3);
  });
});

describe('folders (FR-018c, FR-018e)', () => {
  async function seedDocs(): Promise<void> {
    await put(join(h.rootA, 'docs', 'guide', 'intro.md'), 'incoming-intro');
    await put(join(h.rootA, 'docs', 'guide', 'img', 'logo.png'), 'PNG');
    await put(join(h.rootA, 'docs', 'top.md'), 'top');
    await put(join(h.rootB, 'dest', 'docs', 'guide', 'intro.md'), 'existing-intro');
    await put(join(h.rootB, 'dest', 'docs', 'mine.md'), 'mine');
  }

  it('a folder landing on a folder MERGES: non-clashing contents land, and only the deep clash is asked', async () => {
    await setup();
    await seedDocs();
    answers = [{ choice: 'skip', applyToAll: false }];
    const r = await paste('copy', 'docs');
    expect(r.failures).toEqual([]);
    expect(h.questions.map((q) => [q.name, q.targetDir])).toEqual([['intro.md', join(h.rootB, 'dest', 'docs', 'guide')]]);
    expect(await snapshotTree(join(h.rootB, 'dest', 'docs'))).toEqual({
      'guide/': '',
      'guide/intro.md': 'existing-intro',
      'guide/img/': '',
      'guide/img/logo.png': 'PNG',
      'top.md': 'top',
      'mine.md': 'mine',
    });
  });

  it('a cut merge removes the source folder only once it is empty', async () => {
    await setup();
    await seedDocs();
    answers = [{ choice: 'skip', applyToAll: false }];
    await paste('cut', 'docs');
    // The skipped file keeps its folders — and the folder its path — alive.
    expect(await snapshotTree(join(h.rootA, 'docs'))).toEqual({ 'guide/': '', 'guide/intro.md': 'incoming-intro' });

    answers = [{ choice: 'replace', applyToAll: false }];
    await paste('cut', 'docs');
    expect(await exists(join(h.rootA, 'docs'))).toBe(false);
    expect(await snapshotTree(join(h.rootB, 'dest', 'docs', 'guide'))).toEqual({
      'intro.md': 'incoming-intro',
      'img/': '',
      'img/logo.png': 'PNG',
    });
  });

  it('a file landing on a folder offers Replace (the folder to the Recycle Bin) and never merges', async () => {
    await setup();
    await put(join(h.rootA, 'thing'), 'a file');
    await put(join(h.rootB, 'dest', 'thing', 'inner.txt'), 'inner');
    answers = [{ choice: 'replace', applyToAll: false }];
    await paste('copy', 'thing');
    expect(h.questions[0]).toMatchObject({ existing: { kind: 'folder', itemCount: 1 }, incoming: { kind: 'file' } });
    expect(h.bin.trashed.map((t) => t.path)).toEqual([join(h.rootB, 'dest', 'thing')]);
    expect(await snapshotTree(join(h.rootB, 'dest'))).toMatchObject({ thing: 'a file' });
  });
});

describe('within one project (US5 AS5)', () => {
  it('the same rules hold for a paste inside the active project', async () => {
    await setup();
    await put(join(h.rootB, 'src', 'a.txt'), 'b-local');
    answers = [{ choice: 'keep-both', applyToAll: false }];
    const r = await h.svc.paste(1, join(h.rootB, 'dest'), {
      mode: 'copy',
      items: [{ absPath: join(h.rootB, 'src', 'a.txt'), projectId: 'B', projectRoot: h.rootB }],
    }).result;
    expect(h.questions).toHaveLength(1);
    expect(r.placed).toEqual([join(h.rootB, 'dest', 'a copy.txt')]);
  });
});

/**
 * Replace onto an open file, end to end through the real `TransferService` and the real coordinator
 * (052 US3, FR-010 – FR-013, SC-004 — T017, T018). The move bracket is wired exactly as `main.ts` wires it:
 * `beginMove` when it opens, `markMoved` when it closes, `markRestored` when a delete is restored.
 */
describe('Replace onto an open editor (052 FR-010 – FR-013)', () => {
  let coordinator: EditorCoordinator;
  let relays: EditorSyncMsg[];
  let recoveryDir: string;
  /** `src/x.md` — the file moved with Replace, open in panel A. */
  let src: string;
  /** `dest/x.md` — the file it replaces, open in panel B. */
  let dest: string;

  afterEach(async () => {
    await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  function meta(panelId: string, absPath: string): DocMeta {
    return {
      panelId,
      windowId: 'w1',
      ownerKind: 'project',
      ownerProjectId: 'B',
      ownerRoot: h.rootB,
      allProjectRoots: [h.rootA, h.rootB],
      tabId: 't1',
      absPath,
      encoding: 'utf8',
      hasBom: false,
      lineEnding: 'lf',
    };
  }

  async function setupEditors(fileWatcher?: IFileWatcher): Promise<void> {
    answers = [];
    h = await makeHarness({ answer: () => answers.shift() ?? { choice: 'cancel' } });
    recoveryDir = await mkdtemp(join(tmpdir(), 'throng-rec-'));
    relays = [];
    coordinator = new EditorCoordinator(
      new EditorService(new NodeFileSystem(async () => {}), () => DEFAULT_APP_SETTINGS),
      new EditorRecovery(recoveryDir),
      {
        relaySync: (_exclude, msg) => relays.push(msg),
        persistUndoHistory: () => true,
        ...(fileWatcher ? { fileWatcher } : {}),
      },
    );
    h.files.setOnMoveStarted((paths) => coordinator.beginMove(paths));
    h.files.setOnMoved((moves) => coordinator.markMoved(moves));
    h.files.setOnRestored((paths) => void coordinator.markRestored(paths));
    src = join(h.rootB, 'src', 'x.md');
    dest = join(h.rootB, 'dest', 'x.md');
    await put(src, 'moved\n');
    await put(dest, 'replaced\n');
  }

  /** Type into a panel's document, as its view would. */
  function type(panelId: string, text: string): void {
    const v = coordinator.getContent(panelId)!;
    coordinator.dispatchChange(meta(panelId, v.absPath!), {
      documentId: panelId,
      viewId: `view-${panelId}`,
      changes: ChangeSet.of([{ from: 0, insert: text }], v.text.length).toJSON(),
      baseVersion: v.version,
      selectionBefore: null,
    });
  }

  /** Cut `src/x.md` onto `dest/`, answering Replace. Returns the job's undo entry. */
  async function replaceSrcOntoDest() {
    answers = [{ choice: 'replace', applyToAll: false }];
    const r = await h.svc.paste(1, join(h.rootB, 'dest'), {
      mode: 'cut',
      items: [{ absPath: src, projectId: 'B', projectRoot: h.rootB }],
    }).result;
    expect(r.failures).toEqual([]);
    expect(await readFile(dest, 'utf8')).toBe('moved\n');
    return r.undo!;
  }

  /** Every open path has exactly one buffer (006 FR-011a): each claim names a distinct, live panel. */
  function expectOneBufferPerPath(): void {
    const docs = coordinator.list();
    const paths = docs.map((d) => d.absPath!.replace(/\\/g, '/').toLowerCase());
    expect(new Set(paths).size).toBe(paths.length);
  }

  it('undo after a clean Replace: A goes back to src, and B unlinks and loads the restored dest', async () => {
    await setupEditors();
    await coordinator.load(meta('pA', src));
    await coordinator.load(meta('pB', dest));
    const undo = await replaceSrcOntoDest();
    expect(relays).toContainEqual(expect.objectContaining({ panelId: 'pB', linkedTo: 'pA' }));
    expect(coordinator.list().map((d) => d.panelId)).toEqual(['pA']);

    relays.length = 0;
    expect(await h.svc.applyUndo(undo, 'undo')).toMatchObject({ ok: true });
    expect(await readFile(src, 'utf8')).toBe('moved\n');
    expect(await readFile(dest, 'utf8')).toBe('replaced\n');
    expect(coordinator.getContent('pA')).toMatchObject({ absPath: src, text: 'moved\n' });
    // B unlinked BEFORE A's move went out, so it never followed A to src.
    const unlink = relays.findIndex((m) => m.panelId === 'pB' && m.linkedTo === null);
    expect(unlink).toBeGreaterThanOrEqual(0);
    expect(relays.some((m) => m.panelId === 'pB' && m.movedTo !== undefined)).toBe(false);
    expect(coordinator.getContent('pB')).toBeNull();

    // The renderer answers `linkedTo: null` by loading its own filePath.
    expect(await coordinator.load(meta('pB', dest))).toMatchObject({ ok: true, text: 'replaced\n' });
    expect(await coordinator.openInto(src)).toMatchObject({ action: 'focus', panelId: 'pA' });
    expect(await coordinator.openInto(dest)).toMatchObject({ action: 'focus', panelId: 'pB' });
    expectOneBufferPerPath();
  });

  it('undo after a dirty Replace: A goes back to src, and B re-claims dest still dirty', async () => {
    await setupEditors();
    await coordinator.load(meta('pA', src));
    await coordinator.load(meta('pB', dest));
    type('pB', 'mine ');
    const undo = await replaceSrcOntoDest();
    expect(coordinator.getContent('pB')).toMatchObject({ replaced: true, dirty: true });

    relays.length = 0;
    expect(await h.svc.applyUndo(undo, 'undo')).toMatchObject({ ok: true });
    expect(await readFile(dest, 'utf8')).toBe('replaced\n');
    expect(coordinator.getContent('pA')).toMatchObject({ absPath: src, text: 'moved\n' });
    // B did not follow A's file back to src — it stayed on its own path, and holds it again.
    expect(coordinator.getContent('pB')).toMatchObject({
      absPath: dest,
      text: 'mine replaced\n',
      dirty: true,
      replaced: false,
    });
    expect(relays).toContainEqual({ panelId: 'pB', replaced: false });
    expect(await coordinator.openInto(src)).toMatchObject({ action: 'focus', panelId: 'pA' });
    expect(await coordinator.openInto(dest)).toMatchObject({ action: 'focus', panelId: 'pB' });
    expectOneBufferPerPath();
    // An ordinary document again: Save writes its changes over the restored file.
    expect(await coordinator.save({ panelId: 'pB' })).toMatchObject({ ok: true });
    expect(await readFile(dest, 'utf8')).toBe('mine replaced\n');
  });

  /*
   * T018 — only `dest/x.md` is open (research R7, "Only one side open"). Nothing new is built for this: the
   * folder watch already gives FR-011's and FR-012's outcomes, and these pin it. The watch is fired by hand,
   * once the Replace has landed, so the test decides when the event arrives rather than a timer.
   */
  class ManualWatcher implements IFileWatcher {
    private readonly subs = new Set<{ dir: string; cb: (path: string) => void }>();
    watch(dir: string, cb: (path: string) => void): { dispose(): void } {
      const sub = { dir, cb };
      this.subs.add(sub);
      return { dispose: () => this.subs.delete(sub) };
    }
    fire(path: string): void {
      for (const s of [...this.subs]) if (s.dir === join(path, '..')) s.cb(path);
    }
  }

  it('only dest open and clean: it reloads to the moved content, with one buffer', async () => {
    const watcher = new ManualWatcher();
    await setupEditors(watcher);
    await coordinator.load(meta('pB', dest));
    await replaceSrcOntoDest();
    watcher.fire(dest);
    await expect.poll(() => coordinator.getContent('pB')?.text).toBe('moved\n');
    expect(coordinator.getContent('pB')).toMatchObject({ absPath: dest, dirty: false });
    expect(coordinator.list().map((d) => d.panelId)).toEqual(['pB']);
    expect(await coordinator.openInto(dest)).toMatchObject({ action: 'focus', panelId: 'pB' });
    expect(coordinator.isOpen(src)).toBe(false);
  });

  /*
   * 052 R7a (code review) — T018 first pinned "keeps its buffer, external-change notice" here, which left a
   * plain Ctrl+S free to write over the moved file. US3 scenario 2 asks for the replaced state whether or not
   * the moved file is open: the notice, the kept buffer, and a refused Save.
   */
  it('only dest open and dirty: it becomes replaced — buffer kept, plain Save refused', async () => {
    const watcher = new ManualWatcher();
    await setupEditors(watcher);
    await coordinator.load(meta('pB', dest));
    type('pB', 'mine ');
    relays.length = 0;
    await replaceSrcOntoDest();
    expect(relays).toContainEqual({ panelId: 'pB', replaced: true });
    watcher.fire(dest); // released with the claim: nothing reaches the replaced document
    expect(coordinator.getContent('pB')).toMatchObject({ absPath: dest, text: 'mine replaced\n', dirty: true, replaced: true });
    expect(await coordinator.save({ panelId: 'pB' })).toMatchObject({ ok: false, reason: 'replaced' });
    expect(await readFile(dest, 'utf8')).toBe('moved\n');
  });

  it('a cross-project Replace onto a dirty open file makes it replaced, too', async () => {
    await setupEditors();
    const fromA = join(h.rootA, 'x.md');
    await put(fromA, 'moved\n');
    await coordinator.load({ ...meta('pA', fromA), ownerProjectId: 'A', ownerRoot: h.rootA });
    await coordinator.load(meta('pB', dest));
    type('pB', 'mine ');
    answers = [{ choice: 'replace', applyToAll: false }];
    const r = await h.svc.paste(1, join(h.rootB, 'dest'), {
      mode: 'cut',
      items: [{ absPath: fromA, projectId: 'A', projectRoot: h.rootA }],
    }).result;
    expect(r.failures).toEqual([]);
    expect(coordinator.getContent('pA')).toMatchObject({ movedOut: true, absPath: dest });
    expect(coordinator.getContent('pB')).toMatchObject({ replaced: true, dirty: true, text: 'mine replaced\n' });
    expect(await coordinator.save({ panelId: 'pB' })).toMatchObject({ ok: false, reason: 'replaced' });
    expect(await readFile(dest, 'utf8')).toBe('moved\n');
  });
});
