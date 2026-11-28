// Layer: integration — a standalone preview hears its file go through a real folder watch and re-reads the real disk.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHIPPED_PREVIEW_PROVIDERS, type PreviewUpdate } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { EXTERNAL_DELETE_SETTLE_MS } from '../../src/main/external-delete-settle.js';
import { PreviewService } from '../../src/main/preview-service.js';
import { lateListener, liveSettings, recordingPush, recordingWindows, until } from './helpers/preview-harness.js';

/**
 * 081 US2, FR-013 — a standalone Markdown preview waits the same settle window before it says its file is gone (#728).
 *
 * #728 candidate cause: "a file an agent deleted and rewrote within a second". The preview's own folder watch read
 * the gap as a delete and showed "the file no longer exists" over a file that was back a moment later.
 */

const fs = new NodeFileSystem(async () => {});

let root: string;
let recoveryDir: string;
let push: ReturnType<typeof recordingPush>;
let previews: PreviewService;
let coord: EditorCoordinator;

const updates = (): PreviewUpdate[] => push.updates.filter((u) => u.update.panelId === 'v1').map((u) => u.update);
const goneNotices = (): PreviewUpdate[] => updates().filter((u) => u.notice?.kind === 'deleted');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-preview-settle-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-preview-settle-rec-'));
  push = recordingPush();
  const settings = liveSettings();
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
  previews.destroyed('v1');
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/** Shows `file` in a standalone preview and returns once its watch is heard to work (see `preview-file-disappears`). */
async function shown(file: string, body: string): Promise<void> {
  await writeFile(file, body);
  const res = await previews.attach(3, { panelId: 'v1', projectId: 'P', filePath: file });
  if (!res.ok) throw new Error(`attach refused: ${res.reason}`);
  const before = updates().length;
  const deadline = Date.now() + 4000;
  for (let i = 1; Date.now() < deadline; i++) {
    await writeFile(file, `${body}${' '.repeat(i)}`);
    if (await until(() => (updates().length > before ? true : undefined), 250)) return;
  }
  throw new Error(`the preview's watch on ${file} never reported a change`);
}

const textOf = (u: PreviewUpdate | undefined): string | undefined =>
  u?.content?.kind === 'text' ? u.content.text : undefined;

describe('a standalone preview waits the settle window (081 FR-013; #728 "deleted and rewritten within a second")', () => {
  it('notes.md deleted and re-written within 200 ms shows the new text and never says it is gone', async () => {
    const file = join(root, 'notes.md');
    await shown(file, '# Notes\n');

    await rm(file, { force: true });
    await sleep(200);
    await writeFile(file, '# Rewritten\n');

    const fresh = await until(() => updates().find((u) => textOf(u) === '# Rewritten\n'));
    expect(fresh, 'the preview shows the re-written file').toBeDefined();
    await sleep(EXTERNAL_DELETE_SETTLE_MS + 200);
    expect(goneNotices(), 'a rewrite was shown as a deleted file').toEqual([]);
  });

  it('notes.md deleted and not re-written says it is gone once, after the window', async () => {
    const file = join(root, 'notes.md');
    await shown(file, '# Notes\n');

    const removedAt = Date.now();
    await rm(file, { force: true });
    await sleep(EXTERNAL_DELETE_SETTLE_MS - 200);
    expect(goneNotices(), 'said gone before the settle window ended').toEqual([]);

    expect(await until(() => goneNotices()[0])).toBeDefined();
    expect(Date.now() - removedAt).toBeGreaterThanOrEqual(EXTERNAL_DELETE_SETTLE_MS);
    await sleep(EXTERNAL_DELETE_SETTLE_MS + 200);
    expect(goneNotices(), 'said once').toHaveLength(1);
  });
});
