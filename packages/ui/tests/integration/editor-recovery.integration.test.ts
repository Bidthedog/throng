import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { editDocument } from './helpers/edit-document.js';

const fs = new NodeFileSystem(async () => {});
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let root: string;
let recoveryDir: string;

function makeCoordinator(): { coord: EditorCoordinator; recovery: EditorRecovery } {
  const service = new EditorService(fs, () => DEFAULT_APP_SETTINGS);
  const recovery = new EditorRecovery(recoveryDir);
  const coord = new EditorCoordinator(service, recovery, {
    recoveryDebounceMs: 10,
    relaySync: () => {},
    persistUndoHistory: () => true,
  });
  return { coord, recovery };
}

function meta(panelId: string, absPath: string | null): DocMeta {
  return {
    panelId,
    windowId: 'w1',
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
  root = await mkdtemp(join(tmpdir(), 'throng-rec-root-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-rec-dir-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('editor crash recovery (006, FR-041/042/043)', () => {
  it('writes in-progress content to a recovery temp and restores it after relaunch', async () => {
    // Session 1: an unsaved new document with in-progress content.
    const s1 = makeCoordinator();
    s1.coord.register(meta('p1', null), '');
    editDocument(s1.coord, meta('p1', null), 'work in progress');
    await wait(40); // let the debounced recovery write flush

    // Session 2 (simulated relaunch): a fresh coordinator recovers by panelId.
    const s2 = makeCoordinator();
    const recovered = await s2.coord.recover();
    // `toMatchObject`, not an exact shape: the snapshot is STRUCTURED since 016 (it also carries the
    // document version and, unless the user turned it off, the undo history — T088/T089). What this
    // test is about is the CONTENT surviving a relaunch, and that is what it asserts.
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ panelId: 'p1', text: 'work in progress' });
  });

  it('removes the recovery temp on full save (no stale temp)', async () => {
    const { coord } = makeCoordinator();
    const file = join(root, 'doc.txt');
    await writeFile(file, 'seed\n');
    coord.register(meta('p1', file), 'seed\n');
    editDocument(coord, meta('p1', file), 'edited\n');
    await wait(40);
    expect(existsSync(join(recoveryDir, encodeURIComponent('p1')))).toBe(true);

    const result = await coord.save({ panelId: 'p1' });
    expect(result.ok).toBe(true);
    await wait(20);
    expect(existsSync(join(recoveryDir, encodeURIComponent('p1')))).toBe(false);
    expect(await readFile(file, 'utf8')).toBe('edited\n');
  });

  it('removes the recovery temp when the editor is destroyed', async () => {
    const { coord } = makeCoordinator();
    coord.register(meta('p1', null), '');
    editDocument(coord, meta('p1', null), 'temp');
    await wait(40);
    expect(existsSync(join(recoveryDir, encodeURIComponent('p1')))).toBe(true);
    coord.destroy('p1');
    await wait(20);
    expect(existsSync(join(recoveryDir, encodeURIComponent('p1')))).toBe(false);
  });

  it('cleanupRecovery drops temps for panels that are no longer open', async () => {
    const { coord, recovery } = makeCoordinator();
    await recovery.write('gone', { version: 1, text: 'orphan content' });
    await recovery.write('kept', { version: 1, text: 'live content' });
    await coord.cleanupRecovery(['kept']);
    expect((await recovery.list()).map((r) => r.panelId).sort()).toEqual(['kept']);
  });
});

/**
 * RE-POINTING an editor at a different file (migrated from editor-recovery-stale.e2e.ts:68).
 *
 * ══ THE DEFECT, AND WHY IT LOOKED LIKE A RESTART BUG ══
 *
 * Edit A, discard, open B into the SAME editor. panelIds are stable across restarts — they are
 * persisted in the layout — so A's recovery temp, still on disk under that panelId, was restored
 * over B on the next launch. Users reported editors "opening CLAUDE.md" instead of the file they
 * had chosen.
 *
 * The E2E proved it by launching Electron twice against a seeded data directory and a seeded user
 * data directory: session one created a real project, opened a real file, typed into CodeMirror,
 * polled the recovery temp on disk, answered the unsaved-open dialog, polled the temp again, then
 * polled the daemon's SQLite layout; session two relaunched and read the editor's text back.
 *
 * The fix is nine lines at `editor-coordinator.ts:252-261`, and it is what both sessions were
 * circling: a load whose panel already holds a DIFFERENT path drops the watch, the registry entry
 * and — awaited, not fired and forgotten — the recovery temp. Everything the second launch proved
 * follows from the temp being absent, and `recover()` restoring what is present is asserted at the
 * top of this file. So the restart is not evidence, it is the long way round to the same fact.
 *
 * ══ THE AWAIT IS THE HALF WITH THE BUG IN IT ══
 *
 * `remove()` is awaited because a fast re-point-then-close must not leave the old temp behind. The
 * E2E could not distinguish awaited from fired-and-forgotten: it polled for up to fifteen seconds,
 * which any ordering satisfies. The last test here closes that gap by not waiting at all.
 */
describe('re-pointing an editor drops the OLD file recovery temp (migrated from editor-recovery-stale.e2e.ts:68)', () => {
  const tempFor = (panelId: string): string => join(recoveryDir, encodeURIComponent(panelId));

  it('drops the temp written for the previous file, and writes none for the fresh one', async () => {
    const { coord } = makeCoordinator();
    const claude = join(root, 'CLAUDE.md');
    const target = join(root, 'target.txt');
    await writeFile(claude, 'CLAUDE-DOC-BODY\n');
    await writeFile(target, 'TARGET-BODY-42\n');

    // Session 1, first half: open CLAUDE.md and edit it, so a recovery temp exists.
    await coord.load(meta('p1', claude));
    editDocument(coord, meta('p1', claude), 'CLAUDE-DOC-BODY\nEDIT\n');
    await wait(40);
    expect(existsSync(tempFor('p1'))).toBe(true);
    expect(JSON.parse(await readFile(tempFor('p1'), 'utf8')).text).toContain('EDIT');

    // The re-point. In the app this is "discard & open"; the discard is the renderer's business and
    // what reaches main is a load of a second path into the same panel.
    await coord.load(meta('p1', target));

    // The stale temp is gone, and no temp has been written for target.txt — the freshly loaded file
    // is clean, so there is nothing to recover for it yet.
    expect(existsSync(tempFor('p1'))).toBe(false);
    await wait(40);
    expect(existsSync(tempFor('p1'))).toBe(false);
  });

  it('leaves nothing for a relaunch to restore over the new file', async () => {
    const { coord } = makeCoordinator();
    const claude = join(root, 'CLAUDE.md');
    const target = join(root, 'target.txt');
    await writeFile(claude, 'CLAUDE-DOC-BODY\n');
    await writeFile(target, 'TARGET-BODY-42\n');

    await coord.load(meta('p1', claude));
    editDocument(coord, meta('p1', claude), 'CLAUDE-DOC-BODY\nEDIT\n');
    await wait(40);
    await coord.load(meta('p1', target));

    // Session 2, as the top of this file models it: a fresh coordinator over the same recovery
    // directory. This is the assertion the E2E's second Electron launch was making.
    const s2 = makeCoordinator();
    expect(await s2.coord.recover()).toEqual([]);
  });

  it('keeps the temp when the SAME file is loaded again', async () => {
    const { coord } = makeCoordinator();
    const claude = join(root, 'CLAUDE.md');
    await writeFile(claude, 'CLAUDE-DOC-BODY\n');

    await coord.load(meta('p1', claude));
    editDocument(coord, meta('p1', claude), 'CLAUDE-DOC-BODY\nEDIT\n');
    await wait(40);
    expect(existsSync(tempFor('p1'))).toBe(true);

    // A reload of the SAME path is not a re-point — a remount, a tab switch, a resync. Dropping the
    // temp here would throw away exactly the unsaved work recovery exists for, and the guard is one
    // `!==` that reads as an equality check either way round.
    await coord.load(meta('p1', claude));
    expect(existsSync(tempFor('p1'))).toBe(true);
  });

  it('does not leave the old temp behind when the app closes immediately after the re-point', async () => {
    const { coord } = makeCoordinator();
    const claude = join(root, 'CLAUDE.md');
    const target = join(root, 'target.txt');
    await writeFile(claude, 'CLAUDE-DOC-BODY\n');
    await writeFile(target, 'TARGET-BODY-42\n');

    await coord.load(meta('p1', claude));
    editDocument(coord, meta('p1', claude), 'CLAUDE-DOC-BODY\nEDIT\n');
    await wait(40);

    // No settle, no poll: the moment `load` resolves, the temp must already be gone. A
    // fire-and-forget `void this.recovery.remove(...)` passes every assertion above and fails this
    // one, which is the whole reason the production call is awaited.
    await coord.load(meta('p1', target));
    expect(existsSync(tempFor('p1'))).toBe(false);
  });
});
