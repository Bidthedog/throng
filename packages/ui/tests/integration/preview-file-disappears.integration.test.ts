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

async function shown(file: string): Promise<void> {
  const res = await previews.attach(3, { panelId: 'v1', projectId: 'P', filePath: file });
  if (!res.ok) throw new Error(`attach refused: ${res.reason}`);
  expect(res.update.notice).toBeNull();
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
      await writeFile(file, body);
      await shown(file);
      await unlink(file);
      expect(await saysGone()).toBeDefined();
    });
  }

  it('notes.md: moved away outside throng', async () => {
    const file = join(root, 'notes.md');
    await writeFile(file, '# Notes\n');
    await shown(file);
    await mkdir(join(root, 'elsewhere'));
    await rename(file, join(root, 'elsewhere', 'notes.md'));
    expect(await saysGone()).toBeDefined();
  });

  it('notes.md: its whole folder deleted', async () => {
    const dir = join(root, 'docs');
    await mkdir(dir);
    const file = join(dir, 'notes.md');
    await writeFile(file, '# Notes\n');
    await shown(file);
    await rm(dir, { recursive: true, force: true });
    expect(await saysGone()).toBeDefined();
  });

  it('notes.md: its folder renamed outside throng', async () => {
    const dir = join(root, 'docs');
    await mkdir(dir);
    const file = join(dir, 'notes.md');
    await writeFile(file, '# Notes\n');
    await shown(file);
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
    await unlink(file);
    expect(await saysGone()).toBeDefined();
  });
});
