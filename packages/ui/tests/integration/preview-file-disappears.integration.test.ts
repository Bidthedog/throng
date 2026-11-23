// Layer: integration — whether a preview hears that its file went is a claim about a real folder and its watch.
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
import { lateListener, liveSettings, recordingPush, recordingWindows, until } from './helpers/preview-harness.js';

/**
 * #696 (044 FR-026, US2 scenario 6; 052: a move outside throng reads as a delete) — a previewed file that disappears
 * shows "the file no longer exists" in its panel, whatever kind of preview it is and however it went.
 */
const fs = new NodeFileSystem(async () => {});
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let root: string;
let recoveryDir: string;
let push: ReturnType<typeof recordingPush>;
let previews: PreviewService;
let coord: EditorCoordinator;

const updatesFor = (panelId: string): PreviewUpdate[] => push.updates.filter((u) => u.update.panelId === panelId).map((u) => u.update);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-preview-gone-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-preview-gone-rec-'));
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
  coord.destroy('ed1');
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/** Writes `body` to `file`, shows it in a standalone preview, and returns once the preview's watch is heard to work. */
async function shown(file: string, body: string | Buffer): Promise<void> {
  await writeFile(file, body);
  const res = await previews.attach(3, { panelId: 'v1', projectId: 'P', filePath: file });
  if (!res.ok) throw new Error(`attach refused: ${res.reason}`);
  expect(res.update.notice).toBeNull();
  await watchHeard(file, body);
}

/**
 * Waits until the preview's watch reports a change, so the removal that follows cannot fall before the watch is live.
 *
 * On macOS the watch is FSEvents, which libuv starts on its own thread after `fs.watch` has returned and restarts
 * whenever another watch is added; a change made before the stream is running is never reported. The first test in
 * this file removed its file inside that gap and no event ever came: no re-read, nothing logged, `saysGone` empty after
 * its full 4 s (pipeline 45121055096, macos-26). Linux and Windows arm their watch before `fs.watch` returns.
 *
 * So the file is rewritten until the preview re-reads it. Each re-read pushes an update: a text preview's text has
 * changed, and a binary preview's resource URL carries a new revision on every read. A rewrite lost to the gap is
 * followed by another. Each is given 250 ms — the 20 ms debounce, libuv's 50 ms FSEvents latency and a read, with
 * room under load — inside the same 4 s bound `saysGone` uses.
 */
async function watchHeard(file: string, body: string | Buffer): Promise<void> {
  const before = updatesFor('v1').length;
  const deadline = Date.now() + 4000;
  for (let i = 1; Date.now() < deadline; i++) {
    await writeFile(file, typeof body === 'string' ? `${body}${' '.repeat(i)}` : body);
    if (await until(() => (updatesFor('v1').length > before ? true : undefined), 250)) return;
  }
  throw new Error(`the preview's watch on ${file} never reported a change`);
}

const saysGone = (): Promise<PreviewUpdate | undefined> => until(() => updatesFor('v1').find((u) => u.notice?.kind === 'deleted'));

const FILES: Array<[string, string | Buffer]> = [
  ['notes.md', '# Notes\n'],
  ['flow.mmd', 'graph TD; A-->B\n'],
  ['data.csv', 'a,b\n1,2\n'],
  ['page.html', '<p>hi</p>'],
  ['logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'],
  ['photo.png', PNG],
];

describe('a previewed file that disappears says so (#696)', () => {
  for (const [name, body] of FILES) {
    it(`${name}: deleted`, async () => {
      const file = join(root, name);
      await shown(file, body);
      await unlink(file);
      expect(await saysGone()).toBeDefined();
    });
  }

  it('notes.md: moved away outside throng', async () => {
    const file = join(root, 'notes.md');
    await shown(file, '# Notes\n');
    await mkdir(join(root, 'elsewhere'));
    await rename(file, join(root, 'elsewhere', 'notes.md'));
    expect(await saysGone()).toBeDefined();
  });

  it('notes.md: its whole folder deleted', async () => {
    const dir = join(root, 'docs');
    await mkdir(dir);
    const file = join(dir, 'notes.md');
    await shown(file, '# Notes\n');
    await rm(dir, { recursive: true, force: true });
    expect(await saysGone()).toBeDefined();
  });

  it('notes.md: its folder renamed outside throng', async () => {
    const dir = join(root, 'docs');
    await mkdir(dir);
    const file = join(dir, 'notes.md');
    await shown(file, '# Notes\n');
    await rename(dir, join(root, 'docs-old'));
    expect(await saysGone()).toBeDefined();
  });
});

/**
 * #696 — the same with the file open in an editor (a parented preview): deleted outside throng, the editor's watch
 * marks its document's file missing, and the preview unloads rather than keep showing the editor's buffer.
 */
describe('a parented preview whose file disappears says so (#696)', () => {
  it('notes.md open in an editor: deleted outside throng', async () => {
    const file = join(root, 'notes.md');
    await writeFile(file, '# Notes\n');
    const loaded = await coord.load({
      panelId: 'ed1',
      windowId: 'w1',
      ownerKind: 'project',
      ownerProjectId: 'P',
      ownerRoot: root,
      allProjectRoots: [root],
      tabId: 't1',
      absPath: file,
      encoding: 'utf8',
      hasBom: false,
      lineEnding: 'lf',
    });
    expect(loaded.ok).toBe(true);
    const res = await previews.attach(3, { panelId: 'v1', projectId: 'P', filePath: file });
    if (!res.ok) throw new Error(`attach refused: ${res.reason}`);
    expect(res.update.parent).toMatchObject({ panelId: 'ed1' });
    await watchHeard(file, '# Notes\n'); // the editor's watch, which the preview hears through its document
    await unlink(file);
    expect(await saysGone()).toBeDefined();
  });
});
