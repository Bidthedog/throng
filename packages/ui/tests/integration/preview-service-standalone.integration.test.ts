import { mkdtemp, mkdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHIPPED_PREVIEW_PROVIDERS, type PreviewUpdate } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { PreviewService } from '../../src/main/preview-service.js';
import {
  lateListener,
  liveSettings,
  recordingPush,
  recordingWindows,
  until,
} from './helpers/preview-harness.js';

/**
 * T058 (044) — a STANDALONE preview over a real `EditorService`, a real `NodeFileWatcher` and a temp
 * tree, on the real clock.
 *
 * The trap this suite exists for is Finding 5 (FR-025, SC-006): the easy way to read a file is to open
 * it as an editor document, and doing so would make the file count as open, dirty-able and already
 * owned by a panel. So every scenario below also asserts the coordinator saw nothing.
 */

const fs = new NodeFileSystem(async () => {});

let root: string;
let recoveryDir: string;
let push: ReturnType<typeof recordingPush>;
let settings: ReturnType<typeof liveSettings>;
let coord: EditorCoordinator;
let previews: PreviewService;

const VIEWER = 3;

const updatesFor = (panelId: string): PreviewUpdate[] =>
  push.updates.filter((u) => u.update.panelId === panelId).map((u) => u.update);

async function attach(panelId: string, filePath: string): Promise<PreviewUpdate> {
  const res = await previews.attach(VIEWER, { panelId, projectId: 'P', filePath });
  if (!res.ok) throw new Error(`attach refused: ${res.reason}`);
  return res.update;
}

function expectCoordinatorUntouched(...paths: string[]): void {
  expect(coord.list()).toEqual([]);
  for (const p of paths) {
    expect(coord.isOpen(p)).toBe(false);
    expect(coord.documentFor(p)).toBeNull();
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-preview-standalone-'));
  await mkdir(join(root, 'dest'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-preview-standalone-rec-'));
  push = recordingPush();
  settings = liveSettings();
  const relay = lateListener();
  const service = new EditorService(fs, settings.get);
  coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    relaySync: () => {},
    persistUndoHistory: () => false,
    fileWatcher: new NodeFileWatcher(20),
    documentLifecycle: relay,
  });
  previews = new PreviewService({
    documents: coord,
    reader: service,
    fs,
    fileWatcher: new NodeFileWatcher(20),
    settings: settings.get,
    registry: SHIPPED_PREVIEW_PROVIDERS,
    projectRoot: async (id) => (id === 'P' ? root : undefined),
    push,
    windows: recordingWindows(),
  });
  relay.bind(previews);
});

afterEach(async () => {
  for (const id of ['v1', 'v2']) previews.destroyed(id);
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('a standalone preview follows the disk (FR-023)', () => {
  it('shows a write to the file, never dirty, and never opens a document (FR-025, FR-043, SC-006)', async () => {
    const a = join(root, 'a.md');
    await writeFile(a, '# one\n');

    const first = await attach('v1', a);
    expect(first).toMatchObject({ content: { kind: 'text', text: '# one\n' }, dirty: false, parent: null });
    expectCoordinatorUntouched(a);

    await writeFile(a, '# two\n');
    const shown = await until(() =>
      updatesFor('v1').find((u) => u.content?.kind === 'text' && u.content.text === '# two\n'),
    );

    expect(shown).toBeDefined();
    expect(updatesFor('v1').every((u) => u.dirty === false)).toBe(true);
    expectCoordinatorUntouched(a);

    await previews.refresh('v1');
    previews.destroyed('v1');
    expectCoordinatorUntouched(a);
  });

  it('refresh re-reads the disk immediately (FR-028)', async () => {
    const a = join(root, 'a.md');
    await writeFile(a, '# one\n');
    await attach('v1', a);

    await writeFile(a, '# fresh\n');
    const { update } = await previews.refresh('v1');

    expect(update).toMatchObject({ content: { kind: 'text', text: '# fresh\n' }, dirty: false });
  });
});

describe('a preview that cannot show its file says so with one notice (FR-026)', () => {
  it('a deleted file raises deleted; the same condition again sets repeat', async () => {
    const a = join(root, 'a.md');
    await writeFile(a, '# one\n');
    await attach('v1', a);

    await unlink(a);
    const deleted = await until(() => updatesFor('v1').find((u) => u.notice?.kind === 'deleted'));
    expect(deleted?.notice).toEqual({ kind: 'deleted' });

    const { update } = await previews.refresh('v1');
    expect(update?.notice).toEqual({ kind: 'deleted', repeat: true });
  });

  it('a file over the size limit raises too-large', async () => {
    const a = join(root, 'big.md');
    await writeFile(a, 'x'.repeat(4096));
    settings.current.editor.maxOpenFileBytes = 1024;

    expect((await attach('v1', a)).notice).toEqual({ kind: 'too-large' });
  });

  it('a binary file raises not-text', async () => {
    const a = join(root, 'bin.md');
    await writeFile(a, Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0x00, 0x00, 0x10]));

    expect((await attach('v1', a)).notice).toEqual({ kind: 'not-text' });
  });

  it('a path that cannot be read as a file raises unreadable', async () => {
    const a = join(root, 'folder.md');
    await mkdir(a);

    expect((await attach('v1', a)).notice).toEqual({ kind: 'unreadable' });
  });

  it('a notice clears once the file reads again', async () => {
    const a = join(root, 'a.md');
    await writeFile(a, '# one\n');
    await attach('v1', a);
    await unlink(a);
    await until(() => updatesFor('v1').find((u) => u.notice?.kind === 'deleted'));

    await writeFile(a, '# back\n');
    const { update } = await previews.refresh('v1');

    expect(update).toMatchObject({ notice: null, content: { kind: 'text', text: '# back\n' } });
  });
});

describe('a standalone preview follows an in-app move (FR-013c, standalone sentence)', () => {
  it('rebinds to the new path, broadcasts pathChanged once, and never pushes deleted during the move', async () => {
    const from = join(root, 'a.md');
    const to = join(root, 'dest', 'moved.md');
    await writeFile(from, '# one\n');
    await attach('v1', from);
    push.clear();

    previews.beginMove([from]);
    await rename(from, to);
    // Long enough for the watcher (20 ms debounce) to see the old path vanish and the read to fail.
    await new Promise((r) => setTimeout(r, 300));
    previews.moved([{ from, to }]);
    await until(() => updatesFor('v1').find((u) => u.filePath === to));
    await new Promise((r) => setTimeout(r, 300));

    expect(push.pathChanged).toEqual([{ panelId: 'v1', filePath: to }]);
    expect(previews.run('v1')?.filePath).toBe(to);
    expect(previews.isOpen(to)).toBe(true);
    expect(previews.isOpen(from)).toBe(false);
    expect(updatesFor('v1').filter((u) => u.notice?.kind === 'deleted')).toEqual([]);
    expectCoordinatorUntouched(from, to);

    // And it follows the file at its new home.
    await writeFile(to, '# after the move\n');
    expect(
      await until(() =>
        updatesFor('v1').find((u) => u.content?.kind === 'text' && u.content.text === '# after the move\n'),
      ),
    ).toBeDefined();
  });

  /*
   * Adversarial review (main item 3, ruling) — an in-app rename ONTO a path that already has a preview (one
   * showing its deleted notice, say). Rebinding the moved run there made two previews of one file (FR-012):
   * `claimPath` kept the holder and let the second run in beside it. As with a Save As onto a previewed
   * file (contracts/preview-ipc.md §3), the moved run stays standalone on its OLD path — now reading as
   * deleted — and the run already at the destination simply shows the file that arrived.
   */
  it('a rename onto a path that already has a preview keeps the moved run on its old path (FR-012)', async () => {
    const a = join(root, 'a.md');
    const b = join(root, 'b.md');
    await writeFile(a, '# was a\n');
    await writeFile(b, '# b\n');
    await attach('v1', a);
    await attach('v2', b);
    await unlink(a);
    await until(() => updatesFor('v1').find((u) => u.notice?.kind === 'deleted'));
    push.clear();

    previews.beginMove([b]);
    await rename(b, a);
    previews.moved([{ from: b, to: a }]);

    expect(previews.run('v2')?.filePath).toBe(b);
    expect(previews.run('v1')?.filePath).toBe(a);
    expect(push.pathChanged).toEqual([]);
    expect(previews.isOpen(a)).toBe(true);
    expect(previews.isOpen(b)).toBe(true);
    // The moved run says its file is gone; the one at the destination shows what arrived.
    expect(await until(() => updatesFor('v2').find((u) => u.notice?.kind === 'deleted'))).toBeDefined();
    expect(
      await until(() => updatesFor('v1').find((u) => u.notice === null && u.content?.kind === 'text' && u.content.text === '# b\n')),
    ).toBeDefined();
  });

  it('an external delete with no bracket still reads as deleted', async () => {
    const from = join(root, 'a.md');
    await writeFile(from, '# one\n');
    await attach('v1', from);

    await rename(from, join(root, 'dest', 'elsewhere.md'));

    expect(await until(() => updatesFor('v1').find((u) => u.notice?.kind === 'deleted'))).toBeDefined();
    expect(push.pathChanged).toEqual([]);
  });
});
