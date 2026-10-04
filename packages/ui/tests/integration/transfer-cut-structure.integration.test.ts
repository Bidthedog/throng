import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FileClipboard, TransferResult } from '@throng/core';
import { FileClipboardService } from '../../src/main/file-clipboard.js';
import { createTransferPush, registerTransferIpc, type TransferIpcMain } from '../../src/main/transfer-ipc.js';
import { disposeHarness, exists, makeHarness, put, snapshotTree, type Harness } from './helpers/transfer-harness.js';

/**
 * A CUT keeps the selection's structure, through the wire the app uses (050 FR-033, SC-010, research R27
 * — T114).
 *
 * Reported: cutting `test/test.md` and `test.md` and pasting on `test2` did not land them as
 * `test2/test/test.md` and `test2/test.md`, while a copy did. Cut and copy share the engine's plan, so
 * this drives the user's path end to end in main: `throng:fileClipboard:set` with ROOT-RELATIVE paths
 * into the REAL `FileClipboardService`, then `throng:transfer:paste` on `test2` through
 * `registerTransferIpc` into the real engine — within project A, and across from A into B.
 */

type Listener = (event: unknown, ...args: unknown[]) => unknown;

let h: Harness;
let clipboard: FileClipboardService;
let handles: Map<string, Listener>;
let projectId: string;

async function setup(): Promise<void> {
  clipboard = new FileClipboardService(() => {});
  h = await makeHarness({
    deps: { clipboard },
    // No clash is planned; one that happened would be part of the answer, so it is skipped and seen.
    answer: () => ({ choice: 'skip', applyToAll: false }),
  });
  // The bracket's close re-points pending clipboard items, as main wires it (FR-009).
  h.files.setOnMoved((moves) => clipboard.followMoves(moves));
  for (const root of [h.rootA, h.rootB]) await mkdir(join(root, 'test2'));
  await put(join(h.rootA, 'test', 'test.md'), 'nested');
  await put(join(h.rootA, 'test.md'), 'top');
  handles = new Map();
  const ipc: TransferIpcMain = {
    handle: (channel, listener) => void handles.set(channel, listener as Listener),
    on: () => {},
  };
  registerTransferIpc(ipc, {
    clipboard,
    transfer: h.svc,
    push: createTransferPush(() => true),
    activeRoot: () => h.files.activeRoot(),
    activeProjectId: async () => projectId,
  });
}

afterEach(async () => {
  await disposeHarness(h);
});

/** Show a project: main's active root and id, as switching to it in the sidebar sets them. */
function show(id: 'A' | 'B'): void {
  projectId = id;
  h.files.setRoot(id === 'A' ? h.rootA : h.rootB);
}

const event = { sender: { id: 1 } };

async function cutInA(...relPaths: string[]): Promise<void> {
  show('A');
  expect(await handles.get('throng:fileClipboard:set')!(event, 'cut', relPaths)).toEqual({ ok: true });
  expect((clipboard.get() as NonNullable<FileClipboard>).mode).toBe('cut');
}

/** Paste on `test2` of the shown project and wait for the job's result. */
async function pasteOnTest2(): Promise<TransferResult> {
  const before = h.done.length;
  const res = (await handles.get('throng:transfer:paste')!(event, 'test2')) as { jobId: string } | { error: string };
  expect(res).toHaveProperty('jobId');
  await h.svc.whenIdle();
  expect(h.done.length).toBe(before + 1);
  return h.done.at(-1)!.r;
}

describe('a cut of test/test.md and test.md pasted on test2 (FR-033)', () => {
  it('within the project lands test2/test/test.md and test2/test.md', async () => {
    await setup();
    await cutInA('test/test.md', 'test.md');
    const r = await pasteOnTest2();

    expect(r.failures).toEqual([]);
    expect(h.questions).toEqual([]);
    expect(await snapshotTree(join(h.rootA, 'test2'))).toEqual({
      'test/': '',
      'test/test.md': 'nested',
      'test.md': 'top',
    });
    expect(await exists(join(h.rootA, 'test.md'))).toBe(false);
    expect(await exists(join(h.rootA, 'test', 'test.md'))).toBe(false);
    expect(r.undo).toMatchObject({ kind: 'move' });
  });

  it('across to another project lands test2/test/test.md and test2/test.md there', async () => {
    await setup();
    await cutInA('test/test.md', 'test.md');
    show('B');
    const r = await pasteOnTest2();

    expect(r.failures).toEqual([]);
    expect(h.questions).toEqual([]);
    expect(await snapshotTree(join(h.rootB, 'test2'))).toEqual({
      'test/': '',
      'test/test.md': 'nested',
      'test.md': 'top',
    });
    expect(await exists(join(h.rootA, 'test.md'))).toBe(false);
    expect(await exists(join(h.rootA, 'test', 'test.md'))).toBe(false);
    expect(r.undo).toMatchObject({ kind: 'move', projects: { source: 'A', target: 'B' } });
  });

  it('the selection order does not matter: test.md first lands the same', async () => {
    await setup();
    await cutInA('test.md', 'test/test.md');
    show('B');
    const r = await pasteOnTest2();

    expect(r.failures).toEqual([]);
    expect(await snapshotTree(join(h.rootB, 'test2'))).toEqual({
      'test/': '',
      'test/test.md': 'nested',
      'test.md': 'top',
    });
  });

  it('a copy of the same selection lands the same — the cut is no different', async () => {
    await setup();
    show('A');
    expect(await handles.get('throng:fileClipboard:set')!(event, 'copy', ['test/test.md', 'test.md'])).toEqual({ ok: true });
    show('B');
    const r = await pasteOnTest2();

    expect(r.failures).toEqual([]);
    expect(await snapshotTree(join(h.rootB, 'test2'))).toEqual({
      'test/': '',
      'test/test.md': 'nested',
      'test.md': 'top',
    });
  });
});
