import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChangeSet } from '@codemirror/state';
import { DEFAULT_APP_SETTINGS, type DispatchChangeMsg } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta, type EditorSyncMsg } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';

const fs = new NodeFileSystem(async () => {});
// A no-op lock: this test exercises the app-wide one-buffer registry, not the OS lock.

let root: string;
let recoveryDir: string;
let coordinator: EditorCoordinator;
let relays: EditorSyncMsg[];

function meta(panelId: string, windowId: string, absPath: string): DocMeta {
  return {
    panelId,
    windowId,
    ownerKind: 'project',
    ownerProjectId: 'A',
    ownerRoot: root,
    allProjectRoots: [root],
    tabId: 't1',
    absPath,
    encoding: 'utf8',
    hasBom: false,
    lineEnding: 'lf',
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-onebuf-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-rec-'));
  const service = new EditorService(fs, () => DEFAULT_APP_SETTINGS);
  relays = [];
  coordinator = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    relaySync: (_exclude, msg) => relays.push(msg),
    persistUndoHistory: () => true,
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('app-wide one-buffer registry (006, FR-011a)', () => {
  it('a second open of an already-open file focuses the existing editor (no duplicate)', async () => {
    const file = join(root, 'shared.txt');
    await writeFile(file, 'hello\n');

    // Window 1 opens the file.
    const loaded = await coordinator.load(meta('p1', 'w1', file));
    expect(loaded.ok).toBe(true);
    expect(coordinator.isOpen(file)).toBe(true);

    // Window 2 tries to open the same file → focus the existing editor (w1/p1).
    const decision = await coordinator.openInto(file);
    expect(decision).toEqual({ action: 'focus', panelId: 'p1', windowId: 'w1' });
  });

  it('a fresh path opens; matching is case/separator-insensitive', async () => {
    const file = join(root, 'x.txt');
    await expect(coordinator.openInto(file)).resolves.toEqual({ action: 'open' });
  });

  it('destroying the editor frees the file for a fresh open', async () => {
    const file = join(root, 'shared.txt');
    await writeFile(file, 'hi\n');
    await coordinator.load(meta('p1', 'w1', file));
    coordinator.destroy('p1');
    expect(coordinator.isOpen(file)).toBe(false);
    await expect(coordinator.openInto(file)).resolves.toEqual({ action: 'open' });
  });

  it('re-pointing an editor at a new file releases its previous one-buffer claim', async () => {
    const a = join(root, 'a.txt');
    const b = join(root, 'b.txt');
    await writeFile(a, 'A\n');
    await writeFile(b, 'B\n');
    await coordinator.load(meta('p1', 'w1', a));
    await coordinator.load(meta('p1', 'w1', b)); // same panel, new file
    expect(coordinator.isOpen(a)).toBe(false);
    expect(coordinator.isOpen(b)).toBe(true);
  });
});

/** A change computed against `version`, inserting `text` at `at` — what a view's replica sends. */
function insertAt(documentId: string, version: number, length: number, at: number, text: string): DispatchChangeMsg {
  return {
    documentId,
    viewId: `view-${documentId}`,
    changes: ChangeSet.of([{ from: at, insert: text }], length).toJSON(),
    baseVersion: version,
    selectionBefore: null,
  };
}

/**
 * Replace onto an open file (052 US3, FR-010 – FR-012, contracts/editor-replace.md).
 *
 * `a.md` open in panel A is moved with Replace onto `b.md`, open in panel B. The move lands on disk
 * first, then `markMoved` re-points A — exactly the order `FilesService`'s bracket gives it.
 */
describe('Replace onto an open file — the clean case (FR-010, FR-011)', () => {
  let a: string;
  let b: string;

  beforeEach(async () => {
    a = join(root, 'a.md');
    b = join(root, 'b.md');
    await writeFile(a, 'moved\n');
    await writeFile(b, 'replaced\n');
    await coordinator.load(meta('pA', 'w1', a));
    await coordinator.load(meta('pB', 'w1', b));
  });

  async function replaceAOntoB(): Promise<void> {
    await rm(b);
    await rename(a, b);
    relays.length = 0;
    coordinator.markMoved([{ from: a, to: b }]);
  }

  it('disposes B\'s document and links B to A, leaving one claim on b.md', async () => {
    await replaceAOntoB();
    // One claim, and it is A's.
    expect(await coordinator.openInto(b)).toEqual({ action: 'focus', panelId: 'pA', windowId: 'w1' });
    expect(coordinator.isOpen(a)).toBe(false);
    expect(coordinator.list().map((d) => d.panelId)).toEqual(['pA']);
    // B adopts A's document through the reset relay, under B's own id.
    const linked = relays.find((m) => m.panelId === 'pB' && m.linkedTo !== undefined);
    expect(linked).toMatchObject({
      panelId: 'pB',
      linkedTo: 'pA',
      reset: { documentId: 'pA', text: 'moved\n', dirty: false, filePath: b },
    });
    // B's own panel id reads A's document.
    expect(coordinator.getContent('pB')).toMatchObject({ text: 'moved\n', absPath: b });
  });

  it('a change dispatched through B\'s panel id edits A\'s document', async () => {
    await replaceAOntoB();
    const before = coordinator.getContent('pA')!;
    coordinator.dispatchChange(meta('pB', 'w1', b), insertAt('pB', before.version, before.text.length, 0, '> '));
    expect(coordinator.getContent('pA')).toMatchObject({ text: '> moved\n', dirty: true });
  });

  it('every relay for A is also sent under B\'s id', async () => {
    await replaceAOntoB();
    relays.length = 0;
    const before = coordinator.getContent('pA')!;
    coordinator.dispatchChange(meta('pA', 'w1', b), insertAt('pA', before.version, before.text.length, 0, 'x'));
    const forA = relays.filter((m) => m.panelId === 'pA' && m.change);
    const forB = relays.filter((m) => m.panelId === 'pB' && m.change);
    expect(forA).toHaveLength(1);
    expect(forB).toEqual([{ ...forA[0], panelId: 'pB' }]);
  });

  it('undo, redo, save and revert through B\'s id act on A\'s document', async () => {
    await replaceAOntoB();
    const before = coordinator.getContent('pA')!;
    coordinator.dispatchChange(meta('pB', 'w1', b), insertAt('pB', before.version, before.text.length, 0, 'x'));
    coordinator.undo('pB', 'view-pB');
    expect(coordinator.getContent('pA')!.text).toBe('moved\n');
    coordinator.redo('pB', 'view-pB');
    expect(coordinator.getContent('pA')!.text).toBe('xmoved\n');
    expect(coordinator.revert('pB')).toBe(true);
    expect(coordinator.getContent('pA')).toMatchObject({ text: 'moved\n', dirty: false });
    const v = coordinator.getContent('pA')!;
    coordinator.dispatchChange(meta('pB', 'w1', b), insertAt('pB', v.version, v.text.length, 0, 'y'));
    expect(await coordinator.save({ panelId: 'pB' })).toMatchObject({ ok: true });
    expect(await readFile(b, 'utf8')).toBe('ymoved\n');
    expect(coordinator.getContent('pA')!.dirty).toBe(false);
  });

  it('closing the owner hands the document to the linked panel — no reload, no lost buffer', async () => {
    await replaceAOntoB();
    const v = coordinator.getContent('pA')!;
    coordinator.dispatchChange(meta('pA', 'w1', b), insertAt('pA', v.version, v.text.length, 0, 'unsaved '));
    const held = coordinator.getContent('pA')!;
    relays.length = 0;
    coordinator.destroy('pA');
    // B owns it now: same text, same version, still dirty, and the one claim is B's.
    expect(coordinator.getContent('pB')).toMatchObject({ text: 'unsaved moved\n', version: held.version, dirty: true });
    expect(coordinator.getContent('pA')).toBeNull();
    expect(await coordinator.openInto(b)).toEqual({ action: 'focus', panelId: 'pB', windowId: 'w1' });
    expect(relays).toContainEqual({
      panelId: 'pB',
      linkedTo: null,
      reset: { documentId: 'pB', text: 'unsaved moved\n', version: held.version, dirty: true, filePath: b },
    });
    // Its undo history came with it.
    coordinator.undo('pB', 'view-pB');
    expect(coordinator.getContent('pB')).toMatchObject({ text: 'moved\n', dirty: false });
    // A later change through B lands on the document, and is relayed under B's id only.
    relays.length = 0;
    const w = coordinator.getContent('pB')!;
    coordinator.dispatchChange(meta('pB', 'w1', b), insertAt('pB', w.version, w.text.length, 0, 'z'));
    expect(relays.filter((m) => m.change).map((m) => m.panelId)).toEqual(['pB']);
  });

  it('a restored panel links to an open owner, and is refused when the owner is not open', async () => {
    expect(coordinator.link('pC', 'pA')).toMatchObject({ documentId: 'pA', text: 'moved\n', filePath: a });
    expect(coordinator.getContent('pC')).toMatchObject({ text: 'moved\n' });
    expect(coordinator.link('pD', 'nobody')).toBeNull();
    expect(coordinator.getContent('pD')).toBeNull();
  });

  it('renaming the shared file keeps the link: both panels follow, one document (R2)', async () => {
    await replaceAOntoB();
    const c = join(root, 'c.md');
    await rename(b, c);
    relays.length = 0;
    coordinator.markMoved([{ from: b, to: c }]);
    expect(relays.some((m) => m.panelId === 'pB' && m.linkedTo === null)).toBe(false);
    expect(relays).toContainEqual({ panelId: 'pA', movedTo: c });
    expect(relays).toContainEqual({ panelId: 'pB', movedTo: c });
    expect(coordinator.list().map((d) => d.panelId)).toEqual(['pA']);
    expect(coordinator.getContent('pB')).toMatchObject({ absPath: c, text: 'moved\n' });
    const v = coordinator.getContent('pB')!;
    coordinator.dispatchChange(meta('pB', 'w1', c), insertAt('pB', v.version, v.text.length, 0, 'k'));
    expect(coordinator.getContent('pA')!.text).toBe('kmoved\n');
  });

  it('a case-only rename of the shared file keeps the link, and both panels follow (T028)', async () => {
    await replaceAOntoB();
    const upper = join(root, 'B.md');
    await rename(b, upper);
    relays.length = 0;
    coordinator.markMoved([{ from: b, to: upper }]);
    expect(relays.some((m) => m.panelId === 'pB' && m.linkedTo === null)).toBe(false);
    expect(relays).toContainEqual({ panelId: 'pA', movedTo: upper });
    expect(relays).toContainEqual({ panelId: 'pB', movedTo: upper });
    expect(coordinator.getContent('pB')).toMatchObject({ absPath: upper, text: 'moved\n' });
  });

  it('Save As through either linked panel moves both panels to the new path (R3)', async () => {
    await replaceAOntoB();
    const d = join(root, 'd.md');
    relays.length = 0;
    expect(await coordinator.save({ panelId: 'pB', absPath: d })).toMatchObject({ ok: true });
    expect(relays).toContainEqual({ panelId: 'pA', movedTo: d });
    expect(relays).toContainEqual({ panelId: 'pB', movedTo: d });
    expect(coordinator.getContent('pB')).toMatchObject({ absPath: d });
  });

  it('opening another file in the owner panel hands the document to the linked panel (R4)', async () => {
    await replaceAOntoB();
    const x = join(root, 'x.md');
    await writeFile(x, 'other\n');
    relays.length = 0;
    expect(await coordinator.load(meta('pA', 'w1', x))).toMatchObject({ ok: true, text: 'other\n' });
    expect(coordinator.getContent('pB')).toMatchObject({ absPath: b, text: 'moved\n' });
    expect(coordinator.getContent('pA')).toMatchObject({ absPath: x, text: 'other\n' });
    expect(await coordinator.openInto(b)).toEqual({ action: 'focus', panelId: 'pB', windowId: 'w1' });
    expect(await coordinator.openInto(x)).toEqual({ action: 'focus', panelId: 'pA', windowId: 'w1' });
    expect(relays).toContainEqual(expect.objectContaining({ panelId: 'pB', linkedTo: null }));
    // The new file's reset never reaches the panel that kept b.md.
    expect(relays.some((m) => m.panelId === 'pB' && m.reset?.filePath === x)).toBe(false);
  });

  it('closing the owner gives the linked panel its own window; a linked dispatch never moves the owner (R7b)', async () => {
    // B lives in another window.
    coordinator.destroy('pB');
    await coordinator.load(meta('pB', 'w2', b));
    await replaceAOntoB();
    // No dispatch from B: the hand-over alone must know B's window.
    coordinator.destroy('pA');
    expect(await coordinator.openInto(b)).toEqual({ action: 'focus', panelId: 'pB', windowId: 'w2' });
  });

  it('a change typed in the linked panel does not move the owner to the linked panel\'s window (R7b)', async () => {
    coordinator.destroy('pB');
    await coordinator.load(meta('pB', 'w2', b));
    await replaceAOntoB();
    const v = coordinator.getContent('pB')!;
    coordinator.dispatchChange(meta('pB', 'w2', b), insertAt('pB', v.version, v.text.length, 0, 'q'));
    // A move re-registers the owner from its own record — which must still say w1.
    const c = join(root, 'c.md');
    await rename(b, c);
    coordinator.markMoved([{ from: b, to: c }]);
    expect(await coordinator.openInto(c)).toEqual({ action: 'focus', panelId: 'pA', windowId: 'w1' });
  });

  it('closing the linked panel removes only the link', async () => {
    await replaceAOntoB();
    coordinator.destroy('pB');
    expect(coordinator.getContent('pB')).toBeNull();
    expect(coordinator.getContent('pA')).toMatchObject({ text: 'moved\n', absPath: b });
    expect(await coordinator.openInto(b)).toEqual({ action: 'focus', panelId: 'pA', windowId: 'w1' });
    relays.length = 0;
    const v = coordinator.getContent('pA')!;
    coordinator.dispatchChange(meta('pA', 'w1', b), insertAt('pA', v.version, v.text.length, 0, 'x'));
    expect(relays.filter((m) => m.change).map((m) => m.panelId)).toEqual(['pA']);
  });
});

describe('Replace onto an open file — the dirty case (FR-012)', () => {
  let a: string;
  let b: string;

  beforeEach(async () => {
    a = join(root, 'a.md');
    b = join(root, 'b.md');
    await writeFile(a, 'moved\n');
    await writeFile(b, 'replaced\n');
    await coordinator.load(meta('pA', 'w1', a));
    await coordinator.load(meta('pB', 'w1', b));
    const v = coordinator.getContent('pB')!;
    coordinator.dispatchChange(meta('pB', 'w1', b), insertAt('pB', v.version, v.text.length, 0, 'mine '));
    await rm(b);
    await rename(a, b);
    relays.length = 0;
    coordinator.markMoved([{ from: a, to: b }]);
  });

  it('B becomes replaced: its buffer and dirty state are kept, and it holds no claim', async () => {
    expect(coordinator.getContent('pB')).toMatchObject({ text: 'mine replaced\n', dirty: true, absPath: b, replaced: true });
    expect(coordinator.getContent('pA')).toMatchObject({ text: 'moved\n', absPath: b, replaced: false });
    expect(await coordinator.openInto(b)).toEqual({ action: 'focus', panelId: 'pA', windowId: 'w1' });
    expect(relays).toContainEqual({ panelId: 'pB', replaced: true });
    expect(relays.some((m) => m.panelId === 'pB' && m.linkedTo !== undefined)).toBe(false);
  });

  it('a plain save is refused and the moved file is untouched', async () => {
    expect(await coordinator.save({ panelId: 'pB' })).toEqual({
      ok: false,
      reason: 'replaced',
      error: 'This file was replaced. Use Save As to keep your changes.',
    });
    expect(await readFile(b, 'utf8')).toBe('moved\n');
    expect(coordinator.getContent('pB')!.dirty).toBe(true);
  });

  it('Save As onto the replaced path is refused — it is the moved document\'s file', async () => {
    expect(await coordinator.save({ panelId: 'pB', absPath: b })).toMatchObject({ ok: false });
    expect(await readFile(b, 'utf8')).toBe('moved\n');
  });

  it('Save As makes it an ordinary document at the new path', async () => {
    const c = join(root, 'c.md');
    relays.length = 0;
    expect(await coordinator.save({ panelId: 'pB', absPath: c })).toMatchObject({ ok: true });
    expect(await readFile(c, 'utf8')).toBe('mine replaced\n');
    expect(coordinator.getContent('pB')).toMatchObject({ absPath: c, dirty: false, replaced: false });
    expect(await coordinator.openInto(c)).toEqual({ action: 'focus', panelId: 'pB', windowId: 'w1' });
    expect(relays).toContainEqual({ panelId: 'pB', replaced: false });
    // Ordinary again: a plain save writes.
    expect(await coordinator.save({ panelId: 'pB' })).toMatchObject({ ok: true });
  });

  it('discardReplaced drops the buffer and its recovery temp, and links B to A', async () => {
    relays.length = 0;
    expect(await coordinator.discardReplaced('pB')).toEqual({ ok: true, linkedTo: 'pA' });
    expect(coordinator.getContent('pB')).toMatchObject({ text: 'moved\n', dirty: false, replaced: false });
    expect(coordinator.list().map((d) => d.panelId)).toEqual(['pA']);
    expect(await coordinator.recoverOne('pB')).toBeNull();
    expect(relays).toContainEqual({
      panelId: 'pB',
      linkedTo: 'pA',
      replaced: false,
      reset: expect.objectContaining({ documentId: 'pA', text: 'moved\n' }),
    });
  });

  it('discardReplaced loads the path itself when nobody claims it', async () => {
    coordinator.destroy('pA');
    expect(await coordinator.discardReplaced('pB')).toEqual({ ok: true, linkedTo: null });
    expect(coordinator.getContent('pB')).toMatchObject({ text: 'moved\n', dirty: false, replaced: false, absPath: b });
    expect(await coordinator.openInto(b)).toEqual({ action: 'focus', panelId: 'pB', windowId: 'w1' });
  });

  it('discardReplaced on an ordinary document is refused', async () => {
    expect(await coordinator.discardReplaced('pA')).toMatchObject({ ok: false });
  });

  it('Save All reports a dirty replaced document as failed, never passes it by silently (R5)', async () => {
    const result = await coordinator.saveAll('all', { activeTabId: 't1', activeProjectId: 'A' });
    expect(result.failed).toContainEqual({ panelId: 'pB', reason: 'replaced' });
    expect(result.saved).not.toContain('pB');
    expect(await readFile(b, 'utf8')).toBe('moved\n');
  });
});

/**
 * 052 T024 — a replaced document survives a restart. The panel config carries `replaced: true`, and the
 * mount registers it so (then restores its recovery snapshot, as a moved-out panel does): it must come back
 * replaced — no claim on the moved file, and a plain Save refused — never as an ordinary editor of that file.
 */
describe('a replaced panel restored after a restart (T024)', () => {
  it('stays replaced, holds no claim, and refuses a plain save', async () => {
    const b = join(root, 'b.md');
    await writeFile(b, 'moved\n');
    relays.length = 0;
    coordinator.register(meta('pB', 'w1', b), '', { replaced: true });
    coordinator.restoreRecovered('pB', 'mine replaced\n');
    expect(coordinator.getContent('pB')).toMatchObject({ text: 'mine replaced\n', dirty: true, replaced: true, absPath: b });
    expect(coordinator.isOpen(b)).toBe(false);
    expect(await coordinator.save({ panelId: 'pB' })).toEqual({
      ok: false,
      reason: 'replaced',
      error: 'This file was replaced. Use Save As to keep your changes.',
    });
    expect(await readFile(b, 'utf8')).toBe('moved\n');
    // Another panel opening the moved file gets a document of its own; the replaced one is not its holder.
    expect(await coordinator.load(meta('pA', 'w1', b))).toMatchObject({ ok: true, text: 'moved\n' });
    expect(coordinator.list().map((d) => d.panelId).sort()).toEqual(['pA', 'pB']);
    expect(coordinator.getContent('pB')).toMatchObject({ replaced: true, text: 'mine replaced\n' });
  });
});

/**
 * 052 R1 (code review) — a restored linked panel whose owner had not loaded yet reads its path itself; the
 * owner then loads the same path. Whichever loads second must join the first's document, never mint a
 * second one over its claim.
 */
describe('two panels loading one path (006 FR-011a, 052 FR-010)', () => {
  let b: string;

  beforeEach(async () => {
    b = join(root, 'b.md');
    await writeFile(b, 'shared\n');
  });

  for (const [first, second] of [
    ['pA', 'pB'],
    ['pB', 'pA'],
  ] as const) {
    it(`${first} then ${second}: one document, one claim, the second linked to the first`, async () => {
      await coordinator.load(meta(first, 'w1', b));
      relays.length = 0;
      expect(await coordinator.load(meta(second, 'w1', b))).toMatchObject({ ok: true, text: 'shared\n' });
      expect(coordinator.list().map((d) => d.panelId)).toEqual([first]);
      expect(await coordinator.openInto(b)).toEqual({ action: 'focus', panelId: first, windowId: 'w1' });
      expect(relays).toContainEqual({
        panelId: second,
        linkedTo: first,
        reset: expect.objectContaining({ documentId: first, text: 'shared\n' }),
      });
      // Edits through either panel land on the one document.
      const v = coordinator.getContent(second)!;
      coordinator.dispatchChange(meta(second, 'w1', b), insertAt(second, v.version, v.text.length, 0, '+'));
      expect(coordinator.getContent(first)!.text).toBe('+shared\n');
    });
  }

  it('a panel already showing another file that loads a held path lets its old document go', async () => {
    const x = join(root, 'x.md');
    await writeFile(x, 'x\n');
    await coordinator.load(meta('pA', 'w1', b));
    await coordinator.load(meta('pB', 'w1', x));
    await coordinator.load(meta('pB', 'w1', b));
    expect(coordinator.list().map((d) => d.panelId)).toEqual(['pA']);
    expect(coordinator.isOpen(x)).toBe(false);
  });
});
