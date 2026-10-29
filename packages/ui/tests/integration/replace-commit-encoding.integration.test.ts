/**
 * Find in Files, its replace commit, the preview and the preview's task toggle read and write UTF-16 and
 * Windows-1252 files in their own encoding (059 US5, FR-050–FR-052).
 *
 * Layer: integration — each case is a real file on disk going through the shipped service's read and
 * write. The codecs themselves are proven at unit level (`text-fidelity.test.ts`); what only this layer
 * can get wrong is a service that still reads with a UTF-8 decoder, skips a file as binary, or writes
 * back in the wrong encoding.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  NO_MODES,
  SHIPPED_PREVIEW_PROVIDERS,
  encode,
  type FileSearchUpdate,
  type Match,
} from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { NodeFileWatcher } from '../../src/main/node-file-watcher.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { FileSearchService } from '../../src/main/file-search-service.js';
import { ReplaceCommitService, type CommitResult } from '../../src/main/replace-commit-service.js';
import { TaskToggleService } from '../../src/main/task-toggle-service.js';
import { PreviewService } from '../../src/main/preview-service.js';
import { lateListener, liveSettings, recordingPush, recordingWindows, until } from './helpers/preview-harness.js';
import { BOM_UTF16LE, CP1252_SAMPLE, concat, utf16 } from '../../../core/tests/fixtures/text-formats.js';

const fs = new NodeFileSystem(async () => {});
const PANEL = 'fif-1';

let root: string;
let recoveryDir: string;
let coord: EditorCoordinator;
let service: EditorService;

const u16le = (text: string): Uint8Array => concat(BOM_UTF16LE, utf16(text, 'le'));
const bytesAt = async (name: string): Promise<number[]> => [...(await readFile(join(root, name)))];

function matchesOf(text: string, term: string): Match[] {
  const out: Match[] = [];
  for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + 1)) out.push({ from: i, to: i + term.length });
  return out;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-enc-commit-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-enc-commit-rec-'));
  service = new EditorService(fs, () => DEFAULT_APP_SETTINGS);
  coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10,
    relaySync: () => {},
    persistUndoHistory: () => false,
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('Find in Files searches every supported encoding (FR-050)', () => {
  it('finds the term in a UTF-16 LE and a Windows-1252 file, and still skips a binary one', async () => {
    await writeFile(join(root, 'wide.txt'), u16le('a café here\r\n'));
    await writeFile(join(root, 'legacy.txt'), CP1252_SAMPLE); // 'café £5 €\n'
    await writeFile(join(root, 'blob.bin'), Uint8Array.from([0x63, 0x61, 0x66, 0xc3, 0xa9, 0, 0, 0, 1, 2]));
    const sent: FileSearchUpdate[] = [];
    const search = new FileSearchService(
      fs,
      () => [],
      () => [],
      () => 10 * 1024 * 1024,
      (_id, payload) => sent.push(payload),
    );
    await search.start(1, { panelId: PANEL, projectRoot: root, scopeSubPath: null, term: 'café', modes: NO_MODES });
    const done = await until(() => sent.find((u) => u.status === 'complete'));
    expect(done, 'the scan completes').toBeDefined();
    const files = [...new Set(sent.flatMap((u) => u.rows ?? []).map((r) => r.relPath))].sort();
    expect(files).toEqual(['legacy.txt', 'wide.txt']);
  });
});

describe('the replace commit writes each file in its own encoding (FR-051)', () => {
  const commit = (replacement: string, targets: { relPath: string; edits: Match[] }[]): Promise<CommitResult> =>
    new ReplaceCommitService(fs, coord, () => DEFAULT_APP_SETTINGS).commit({
      panelId: PANEL,
      projectRoot: root,
      term: 'café',
      modes: NO_MODES,
      replacement,
      targets,
      confirmedIrreversible: true,
    });

  it('UTF-16 LE keeps its BOM and CRLF; Windows-1252 keeps its single bytes — only the match changes', async () => {
    await writeFile(join(root, 'wide.txt'), u16le('a café here\r\nnext\r\n'));
    await writeFile(join(root, 'legacy.txt'), CP1252_SAMPLE);
    const res = await commit('tea', [
      { relPath: 'wide.txt', edits: matchesOf('a café here\nnext\n', 'café') },
      { relPath: 'legacy.txt', edits: matchesOf('café £5 €\n', 'café') },
    ]);
    expect(res).toMatchObject({ committed: true, outcome: { failed: [] } });
    expect(await bytesAt('wide.txt')).toEqual([...u16le('a tea here\r\nnext\r\n')]);
    expect(await bytesAt('legacy.txt')).toEqual([0x74, 0x65, 0x61, ...CP1252_SAMPLE.subarray(4)]);
  });

  it('a replacement the encoding cannot hold refuses THAT file, names the encoding, and writes nothing', async () => {
    await writeFile(join(root, 'legacy.txt'), CP1252_SAMPLE);
    await writeFile(join(root, 'plain.txt'), 'café\n');
    const res = await commit('☕', [
      { relPath: 'legacy.txt', edits: matchesOf('café £5 €\n', 'café') },
      { relPath: 'plain.txt', edits: matchesOf('café\n', 'café') },
    ]);
    expect(res).toMatchObject({
      committed: true,
      outcome: { failed: [{ relPath: 'legacy.txt', reason: 'unrepresentable', encoding: 'windows1252' }] },
    });
    expect(await bytesAt('legacy.txt')).toEqual([...CP1252_SAMPLE]);
    expect(await readFile(join(root, 'plain.txt'), 'utf8')).toBe('☕\n');
  });
});

describe('the preview reads, and its task toggle rewrites, every supported encoding (FR-052)', () => {
  function toggles(): TaskToggleService {
    const runs = new Map([['pv', { projectRoot: root, filePath: '' }]]);
    return new TaskToggleService(fs, coord, (id) => {
      const run = runs.get(id);
      return run ? { ...run, filePath: currentPath } : undefined;
    });
  }
  let currentPath = '';

  it('toggles a task in a UTF-16 LE Markdown file and writes it back as UTF-16 LE', async () => {
    currentPath = join(root, 'tasks.md');
    await writeFile(currentPath, u16le('- [ ] one\r\n'));
    expect(
      await toggles().toggle({ panelId: 'pv', filePath: currentPath, line: 0, expectChecked: false, itemText: 'one' }),
    ).toEqual({ ok: true, savedToDisk: true });
    expect(await bytesAt('tasks.md')).toEqual([...u16le('- [x] one\r\n')]);
  });

  it('toggles a task in a Windows-1252 Markdown file, keeping its single-byte characters', async () => {
    currentPath = join(root, 'legacy.md');
    await writeFile(currentPath, Uint8Array.from([0x2d, 0x20, 0x5b, 0x20, 0x5d, 0x20, 0xe9, 0x0a]));
    expect(
      await toggles().toggle({ panelId: 'pv', filePath: currentPath, line: 0, expectChecked: false, itemText: 'é' }),
    ).toEqual({ ok: true, savedToDisk: true });
    expect(await bytesAt('legacy.md')).toEqual([0x2d, 0x20, 0x5b, 0x78, 0x5d, 0x20, 0xe9, 0x0a]);
  });

  it('a standalone preview renders a UTF-16 LE and a Windows-1252 Markdown source as text', async () => {
    const push = recordingPush();
    const settings = liveSettings();
    const relay = lateListener();
    const previews = new PreviewService({
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
    try {
      await writeFile(join(root, 'wide.md'), u16le('# café\r\n'));
      await writeFile(join(root, 'legacy.md'), CP1252_SAMPLE);
      const wide = await previews.attach(3, { panelId: 'v1', projectId: 'P', filePath: join(root, 'wide.md') });
      const legacy = await previews.attach(3, { panelId: 'v2', projectId: 'P', filePath: join(root, 'legacy.md') });
      expect(wide).toMatchObject({ ok: true, update: { content: { kind: 'text', text: '# café\n' } } });
      expect(legacy).toMatchObject({ ok: true, update: { content: { kind: 'text', text: 'café £5 €\n' } } });
    } finally {
      previews.destroyed('v1');
      previews.destroyed('v2');
    }
  });
});

describe('Find in Files and its replace read with the fallback encoding (059 FR-069)', () => {
  const PRIVET = 'Привет мир\nвторая строка\n';
  const RUSSIAN = encode(PRIVET, { encoding: 'windows1251', hasBom: false, lineEnding: 'lf' });
  const fallback1251 = { ...DEFAULT_APP_SETTINGS, editor: { ...DEFAULT_APP_SETTINGS.editor, fallbackEncoding: 'windows1251' as const } };

  it('finds a Cyrillic word in a Windows-1251 file, which as Western it would not', async () => {
    await writeFile(join(root, 'russian.txt'), RUSSIAN);
    const scan = async (fallback: () => typeof fallback1251.editor.fallbackEncoding | 'windows1252') => {
      const sent: FileSearchUpdate[] = [];
      const search = new FileSearchService(fs, () => [], () => [], () => 10 * 1024 * 1024, (_id, p) => sent.push(p), fallback);
      await search.start(1, { panelId: PANEL, projectRoot: root, scopeSubPath: null, term: 'мир', modes: NO_MODES });
      await until(() => sent.find((u) => u.status === 'complete'));
      return sent.flatMap((u) => u.rows ?? []).map((r) => r.relPath);
    };
    expect(await scan(() => 'windows1251')).toEqual(['russian.txt']);
    expect(await scan(() => 'windows1252')).toEqual([]);
  });

  it('a replace writes the file back in Windows-1251, changing only the match', async () => {
    await writeFile(join(root, 'russian.txt'), RUSSIAN);
    const res = await new ReplaceCommitService(fs, coord, () => fallback1251).commit({
      panelId: PANEL,
      projectRoot: root,
      term: 'мир',
      modes: NO_MODES,
      replacement: 'дом',
      targets: [{ relPath: 'russian.txt', edits: matchesOf(PRIVET, 'мир') }],
      confirmedIrreversible: true,
    });
    expect(res).toMatchObject({ committed: true, outcome: { failed: [] } });
    expect(await bytesAt('russian.txt')).toEqual([
      ...encode(PRIVET.replace('мир', 'дом'), { encoding: 'windows1251', hasBom: false, lineEnding: 'lf' }),
    ]);
  });
});
