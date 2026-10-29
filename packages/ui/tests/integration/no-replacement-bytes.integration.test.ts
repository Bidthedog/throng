/**
 * No write path invents a replacement character (059 SC-004).
 *
 * `EF BF BD` is what a lossy decode leaves behind: a byte it could not read became `U+FFFD`, and the
 * encode wrote that out. Every fixture goes through every path that writes a file — editor save, Save
 * with Encoding, Save All, the Find in Files replace commit and the preview's task toggle — and the
 * output must hold exactly as many `EF BF BD` sequences as the input did, and still read in the
 * fixture's own encoding.
 *
 * Layer: integration — the property is about the WHOLE path from disk to disk through each shipped
 * service; the codec's own round trip is proven at unit level and is not re-run here as a matrix.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChangeSet } from '@codemirror/state';
import { DEFAULT_APP_SETTINGS, NO_MODES, encode, readText, type EncodingId } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { ReplaceCommitService } from '../../src/main/replace-commit-service.js';
import { TaskToggleService } from '../../src/main/task-toggle-service.js';
import { TEXT_FIXTURES } from '../../../core/tests/fixtures/text-formats.js';

const fs = new NodeFileSystem(async () => {});

let root: string;
let recoveryDir: string;
let coord: EditorCoordinator;

const meta = (panelId: string, absPath: string): DocMeta => ({
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
});

function replacementCount(bytes: Uint8Array): number {
  let n = 0;
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] === 0xef && bytes[i + 1] === 0xbf && bytes[i + 2] === 0xbd) n++;
  }
  return n;
}

/** The fixture's bytes with `prefix` put in front of its text, in the fixture's own format. */
function withPrefix(bytes: Uint8Array, prefix: string): Uint8Array {
  const read = readText(bytes);
  if (!read.ok) throw new Error(`fixture does not read: ${read.reason}`);
  const f = read.file;
  return encode(prefix + f.text, {
    encoding: f.encoding,
    hasBom: f.hasBom,
    lineEnding: f.lineEnding,
    ...(f.mixedLineEndings ? { mixedLineEndings: ['lf', ...f.mixedLineEndings] } : {}),
  });
}

async function open(panelId: string, name: string, bytes: Uint8Array): Promise<string> {
  const file = join(root, name);
  await writeFile(file, bytes);
  expect(await coord.load(meta(panelId, file))).toMatchObject({ ok: true });
  return file;
}

function insertAtStart(panelId: string, text: string): void {
  const current = coord.getContent(panelId)!;
  coord.dispatchChange(meta(panelId, current.absPath!), {
    documentId: panelId,
    viewId: 'view-1',
    changes: ChangeSet.of({ from: 0, insert: text }, current.text.length).toJSON(),
    baseVersion: current.version,
    selectionBefore: null,
    mergeClass: null,
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-no-fffd-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-no-fffd-rec-'));
  coord = new EditorCoordinator(new EditorService(fs, () => DEFAULT_APP_SETTINGS), new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10,
    relaySync: () => {},
    persistUndoHistory: () => false,
  });
});

afterEach(async () => {
  for (const id of ['save', 'with', 'all']) coord.destroy(id);
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await rm(recoveryDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe.each(Object.entries(TEXT_FIXTURES))('%s through every write path (SC-004)', (_name, fixture) => {
  const encoding = fixture.encoding as EncodingId;
  const input = fixture.bytes as Uint8Array;

  async function expectClean(file: string, before: Uint8Array): Promise<void> {
    const out = new Uint8Array(await readFile(file));
    expect(replacementCount(out)).toBe(replacementCount(before));
    const read = readText(out);
    expect(read.ok && read.file.encoding).toBe(encoding);
  }

  it('editor save, Change Encoding then save, and Save All', async () => {
    const saved = await open('save', 'save.txt', input);
    insertAtStart('save', 'X');
    expect(await coord.save({ panelId: 'save' })).toMatchObject({ ok: true });
    await expectClean(saved, input);

    const chosen = await open('with', 'with.txt', input);
    coord.changeEncoding('with', encoding, fixture.hasBom);
    expect(await coord.save({ panelId: 'with' })).toMatchObject({ ok: true });
    await expectClean(chosen, input);
    expect([...(await readFile(chosen))]).toEqual([...input]);

    const all = await open('all', 'all.txt', input);
    insertAtStart('all', 'X');
    await coord.saveAll('all', { activeTabId: null, activeProjectId: 'A' });
    await expectClean(all, input);
  });

  it('the Find in Files replace commit and the task toggle', async () => {
    const replaced = join(root, 'replaced.txt');
    const seeded = withPrefix(input, 'needle ');
    await writeFile(replaced, seeded);
    const res = await new ReplaceCommitService(fs, coord, () => DEFAULT_APP_SETTINGS).commit({
      panelId: 'fif',
      projectRoot: root,
      term: 'needle',
      modes: NO_MODES,
      replacement: 'thread',
      targets: [{ relPath: 'replaced.txt', edits: [{ from: 0, to: 6 }] }],
      confirmedIrreversible: true,
    });
    expect(res).toMatchObject({ committed: true, outcome: { failed: [], changedOnDisk: ['replaced.txt'] } });
    await expectClean(replaced, seeded);

    const tasks = join(root, 'tasks.md');
    const taskBytes = withPrefix(input, '- [ ] t\n');
    await writeFile(tasks, taskBytes);
    const toggles = new TaskToggleService(fs, coord, () => ({ projectRoot: root, filePath: tasks }));
    expect(
      await toggles.toggle({ panelId: 'pv', filePath: tasks, line: 0, expectChecked: false, itemText: 't' }),
    ).toEqual({ ok: true, savedToDisk: true });
    await expectClean(tasks, taskBytes);
  });
});
