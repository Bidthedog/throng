import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHIPPED_PREVIEW_PROVIDERS, type PreviewUpdate } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { PreviewService } from '../../src/main/preview-service.js';
import { editDocument } from './helpers/edit-document.js';
import { FakeClock, lateListener, liveSettings, manualWatcher, recordingPush, recordingWindows } from './helpers/preview-harness.js';

/**
 * Layer: integration — 074 FR-012 (defect, maintainer's MT-08 feedback 2026-11-20): "For a parented SVG or HTML
 * preview the limit applies to the source's current content". A preview beside an editor follows the unsaved text;
 * text past the provider's Maximum file size must show the one too-large notice naming its size and the limit — never
 * be drawn — and the preview recovers once the text is back under it.
 */

const fs = new NodeFileSystem(async () => {});
const VIEWER = 7;
const LIMIT = 100;

let root: string;
let recoveryDir: string;
let clock: FakeClock;
let push: ReturnType<typeof recordingPush>;
let settings: ReturnType<typeof liveSettings>;
let coord: EditorCoordinator;
let previews: PreviewService;

const meta = (panelId: string, absPath: string): DocMeta => ({
  panelId,
  windowId: String(VIEWER),
  ownerKind: 'project',
  ownerProjectId: 'P',
  ownerRoot: root,
  allProjectRoots: [root],
  tabId: 't1',
  absPath,
  encoding: 'utf8',
  hasBom: false,
  lineEnding: 'lf',
});

const lastFor = (panelId: string): PreviewUpdate | undefined =>
  push.updates.filter((u) => u.update.panelId === panelId).map((u) => u.update).at(-1);

async function attach(panelId: string, filePath: string): Promise<PreviewUpdate> {
  const res = await previews.attach(VIEWER, { panelId, projectId: 'P', filePath });
  if (!res.ok) throw new Error(`attach refused: ${res.reason}`);
  return res.update;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-preview-cap-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-preview-cap-rec-'));
  clock = new FakeClock();
  push = recordingPush();
  settings = liveSettings();
  settings.current.editor.previews.updateDelayMs = 300;
  settings.current.editor.previews.maxWaitMs = 1000;
  for (const id of ['svg', 'html']) {
    const p = settings.current.editor.previews.providers[id];
    if (p) p.maxFileBytes = LIMIT;
  }
  const relay = lateListener();
  const service = new EditorService(fs, settings.get);
  coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10_000,
    relaySync: () => {},
    persistUndoHistory: () => false,
    documentLifecycle: relay,
  });
  previews = new PreviewService({
    documents: coord,
    reader: service,
    fs,
    fileWatcher: manualWatcher(),
    settings: settings.get,
    registry: SHIPPED_PREVIEW_PROVIDERS,
    projectRoot: async (id) => (id === 'P' ? root : undefined),
    push,
    windows: recordingWindows(),
    clock,
  });
  relay.bind(previews);
});

afterEach(async () => {
  coord.destroy('ed1');
  previews.destroyed('v1');
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe.each([
  ['drawing.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
  ['page.html', '<p>small</p>'],
])('a parented %s preview past its Maximum file size (FR-012)', (name, small) => {
  it('shows the too-large notice for unsaved text past the limit, and the text again once under it', async () => {
    const path = join(root, name);
    await writeFile(path, small);
    const m = meta('ed1', path);
    expect((await coord.load(m)).ok).toBe(true);
    expect(await attach('v1', path)).toMatchObject({ parent: { panelId: 'ed1' }, notice: null, content: { kind: 'text', text: small } });

    const big = `${small}<!--${'é'.repeat(60)}-->`; // 2 bytes a character: over 100 bytes, under 100 characters + 60
    editDocument(coord, m, big);
    clock.advance(1000);
    const over = lastFor('v1');
    expect(over?.notice).toEqual({ kind: 'too-large', size: Buffer.byteLength(big, 'utf8'), limit: LIMIT });
    expect(over?.content).toEqual({ kind: 'text', text: '' });

    editDocument(coord, m, small);
    clock.advance(1000);
    expect(lastFor('v1')).toMatchObject({ notice: null, content: { kind: 'text', text: small } });
  });

  it('a preview attaching to an editor already past the limit shows the notice at once', async () => {
    const path = join(root, name);
    await writeFile(path, small);
    const m = meta('ed1', path);
    expect((await coord.load(m)).ok).toBe(true);
    const big = `${small}${' '.repeat(LIMIT)}`;
    editDocument(coord, m, big);

    expect(await attach('v1', path)).toMatchObject({
      notice: { kind: 'too-large', size: Buffer.byteLength(big, 'utf8'), limit: LIMIT },
      content: { kind: 'text', text: '' },
    });
  });
});

/*
 * Review finding (2026-11-20): a preview that MOVES onto a file whose editor holds unsaved text past the limit — a
 * followed link, or Back / Forward — showed the whole buffer. Every way onto a document's text goes through the cap.
 */
describe('a preview moving onto an editor already past the limit (FR-012)', () => {
  it('a followed link shows the too-large notice, not the text', async () => {
    const start = join(root, 'start.html');
    const target = join(root, 'big.html');
    await writeFile(start, '<a href="big.html">big</a>');
    await writeFile(target, '<p>small</p>');
    const m = meta('ed1', target);
    expect((await coord.load(m)).ok).toBe(true);
    const big = `<p>small</p>${' '.repeat(LIMIT)}`;
    editDocument(coord, m, big);
    clock.advance(1000);

    await attach('v1', start);
    await previews.navigate(VIEWER, { panelId: 'v1', target: { absPath: target }, intent: { kind: 'link' } });
    expect(lastFor('v1')).toMatchObject({
      notice: { kind: 'too-large', size: Buffer.byteLength(big, 'utf8'), limit: LIMIT },
      content: { kind: 'text', text: '' },
    });
  });
});
