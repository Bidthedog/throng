/**
 * 073 T026 — `readPreviewSource` through the real `throng-preview:` handler over a real temp tree (FR-061,
 * FR-062, FR-070; research R7; contracts/preview-ipc-073.md `throng:preview:readSource`).
 *
 * Layer: integration — containment and the cap are decided by the real handler on real files; this proves
 * the IPC read goes through that one route, and that the Spreadsheet provider's own limit replaces the
 * editor's for it.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, maxFileBytesFor, SHIPPED_PREVIEW_PROVIDERS, type AppSettings } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { createPreviewProtocolHandler, readPreviewSource } from '../../src/main/preview-protocol.js';

const fs = new NodeFileSystem(async () => {});
let root: string;
let outside: string;
let run: { projectRoot: string; filePath: string; providerId: string } | undefined;

/** Settings whose Spreadsheet limit is `megabytes` MB — stored in bytes since 077 FR-001 (`maxPreviewBytes`). */
function settingsWith(megabytes: number): AppSettings {
  const s = structuredClone(DEFAULT_APP_SETTINGS);
  s.editor.maxOpenFileBytes = 1024; // far below the workbook: only the provider's own limit may apply
  s.editor.previews.providers.spreadsheet = {
    ...s.editor.previews.providers.spreadsheet,
    enabled: true,
    maxPreviewBytes: megabytes * 1024 * 1024,
  };
  return s;
}

function handler(settings: AppSettings) {
  return createPreviewProtocolHandler({
    fs,
    previews: { run: () => run },
    settings: () => settings,
    registry: SHIPPED_PREVIEW_PROVIDERS,
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-read-source-'));
  outside = await mkdtemp(join(tmpdir(), 'throng-read-source-out-'));
});

afterEach(async () => {
  run = undefined;
  for (const dir of [root, outside]) await rm(dir, { recursive: true, force: true });
});

describe('readPreviewSource', () => {
  it('serves a workbook under the Spreadsheet limit, whatever the editor limit says', async () => {
    const file = join(root, 'book.xlsx');
    await writeFile(file, Buffer.alloc(4096, 1));
    run = { projectRoot: root, filePath: file, providerId: 'spreadsheet' };
    const answer = await readPreviewSource(handler(settingsWith(5)), 'pv');
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(answer.bytes.byteLength).toBe(4096);
  });

  it('refuses one over the Spreadsheet limit with 413 (FR-062)', async () => {
    const file = join(root, 'big.ods');
    await writeFile(file, Buffer.alloc(2 * 1024 * 1024, 1));
    run = { projectRoot: root, filePath: file, providerId: 'spreadsheet' };
    expect(await readPreviewSource(handler(settingsWith(1)), 'pv')).toEqual({ ok: false, status: 413 });
  });

  it('refuses a run outside its project, and a panel with no run (FR-070, FR-071)', async () => {
    const file = join(outside, 'book.xlsx');
    await writeFile(file, Buffer.alloc(10, 1));
    run = { projectRoot: root, filePath: file, providerId: 'spreadsheet' };
    expect((await readPreviewSource(handler(settingsWith(5)), 'pv')).ok).toBe(false);
    run = undefined;
    expect(await readPreviewSource(handler(settingsWith(5)), 'pv')).toEqual({ ok: false, status: 404 });
  });

  it('never hands a text provider’s document over as bytes', async () => {
    const file = join(root, 'data.csv');
    await writeFile(file, 'a,b\n');
    run = { projectRoot: root, filePath: file, providerId: 'csv' };
    expect(await readPreviewSource(handler(settingsWith(5)), 'pv')).toEqual({ ok: false, status: 403 });
  });
});

// Merged with 074 FR-012: one function decides every provider's cap, the Spreadsheet's own leaf included.
describe('maxFileBytesFor, for the Spreadsheet provider', () => {
  it('is the provider limit in bytes where it declares one, else the editor limit', () => {
    const s = settingsWith(25);
    const cap = (id: string): number => maxFileBytesFor(SHIPPED_PREVIEW_PROVIDERS, s.editor.previews, id, s.editor.maxOpenFileBytes);
    expect(cap('spreadsheet')).toBe(25 * 1024 * 1024);
    expect(cap('markdown')).toBe(1024);
  });
});
