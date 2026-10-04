import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FileClipboard, TransferResult } from '@throng/core';
import { FileClipboardService } from '../../src/main/file-clipboard.js';
import {
  createTransferPush,
  registerTransferIpc,
  type TransferIpcMain,
  type TransferIpcService,
} from '../../src/main/transfer-ipc.js';

/**
 * Contract (050 T020): the `throng:fileClipboard:*` and `throng:transfer:*` wire of
 * contracts/transfer-ipc.md §1–§2, driven through the handlers `registerTransferIpc` registers on a
 * fake `ipcMain`. What is pinned is the WIRE: channel kinds, payload shape-checks that refuse with an
 * envelope and change nothing, and routing — a job's pushes reach the window that started it, and
 * only that window. The engine behind it is the `transfer-*.integration.test.ts` suite.
 */

type Listener = (event: unknown, ...args: unknown[]) => unknown;

function fakeIpc(): TransferIpcMain & { handles: Map<string, Listener>; ons: Map<string, Listener> } {
  const handles = new Map<string, Listener>();
  const ons = new Map<string, Listener>();
  return {
    handles,
    ons,
    handle: (channel, listener) => void handles.set(channel, listener as Listener),
    on: (channel, listener) => void ons.set(channel, listener as Listener),
  };
}

const ROOT = join('C:', 'work', 'beta');
const event = (id: number) => ({ sender: { id } });

function setup() {
  const ipc = fakeIpc();
  const pushedClipboard: FileClipboard[] = [];
  const clipboard = new FileClipboardService((c) => pushedClipboard.push(c));
  const sent: { windowId: number; channel: string; payload: unknown }[] = [];
  const push = createTransferPush((windowId, channel, payload) => {
    sent.push({ windowId, channel, payload });
    return true;
  });
  const calls: unknown[][] = [];
  const transfer: TransferIpcService = {
    paste: (windowId, targetDir, snapshot) => {
      calls.push(['paste', windowId, targetDir, snapshot]);
      return { jobId: 'job-1', result: new Promise<TransferResult>(() => {}) };
    },
    drop: async (windowId, sources, targetDir, mode) => {
      calls.push(['drop', windowId, sources, targetDir, mode]);
      return result('job-2');
    },
  };
  registerTransferIpc(ipc, {
    clipboard,
    transfer,
    push,
    activeRoot: () => ROOT,
    activeProjectId: async () => 'B',
  });
  return { ipc, clipboard, pushedClipboard, sent, push, calls };
}

function result(jobId: string): TransferResult {
  return {
    jobId,
    kind: 'paste',
    outcome: 'completed',
    placed: [],
    undo: null,
    failures: [],
    rollbackFailures: [],
    sourceProjectId: 'B',
    targetProjectId: 'B',
  };
}

describe('throng:fileClipboard:* (§1)', () => {
  it('get / set / clear round-trip, and each change is pushed', async () => {
    const { ipc, pushedClipboard } = setup();
    expect(await ipc.handles.get('throng:fileClipboard:get')!(event(1))).toBeNull();
    expect(await ipc.handles.get('throng:fileClipboard:set')!(event(1), 'cut', ['a.txt'])).toEqual({ ok: true });
    const expected = { mode: 'cut', items: [{ absPath: join(ROOT, 'a.txt'), projectId: 'B', projectRoot: ROOT }] };
    expect(await ipc.handles.get('throng:fileClipboard:get')!(event(2))).toEqual(expected);
    ipc.ons.get('throng:fileClipboard:clear')!(event(1));
    expect(await ipc.handles.get('throng:fileClipboard:get')!(event(1))).toBeNull();
    expect(pushedClipboard).toEqual([expected, null]);
  });

  it('a malformed set is refused with an error envelope and changes nothing', async () => {
    const { ipc, clipboard, pushedClipboard } = setup();
    const set = ipc.handles.get('throng:fileClipboard:set')!;
    expect(await set(event(1), 'move', ['a.txt'])).toHaveProperty('error');
    expect(await set(event(1), 'cut', 'a.txt')).toHaveProperty('error');
    expect(await set(event(1), 'cut', [42])).toHaveProperty('error');
    expect(clipboard.get()).toBeNull();
    expect(pushedClipboard).toEqual([]);
  });
});

describe('throng:transfer:* (§2)', () => {
  it('paste snapshots the clipboard, answers { jobId }, and `done` reaches the SENDER only', async () => {
    const { ipc, calls, sent, push } = setup();
    await ipc.handles.get('throng:fileClipboard:set')!(event(7), 'copy', ['a.txt']);
    const answer = await ipc.handles.get('throng:transfer:paste')!(event(7), 'dest');
    expect(answer).toEqual({ jobId: 'job-1' });
    expect(calls[0]).toEqual([
      'paste',
      7,
      join(ROOT, 'dest'),
      { mode: 'copy', items: [{ absPath: join(ROOT, 'a.txt'), projectId: 'B', projectRoot: ROOT }] },
    ]);
    push.events.done(7, result('job-1'));
    expect(sent).toEqual([{ windowId: 7, channel: 'throng:transfer:done', payload: result('job-1') }]);
  });

  it('progress, cancel-choice and clash questions go to the owner window on their channels', async () => {
    const { push, sent } = setup();
    push.events.cancelChoice(3, 'job-9');
    const asked = push.clash.ask(3, {
      jobId: 'job-9',
      requestId: 'r1',
      name: 'a.txt',
      targetDir: ROOT,
      existing: { kind: 'file', newer: false },
      incoming: { kind: 'file', newer: true },
      permanentReplace: false,
    });
    expect(sent.map((s) => [s.windowId, s.channel])).toEqual([
      [3, 'throng:transfer:cancelChoice'],
      [3, 'throng:transfer:clash'],
    ]);
    expect(sent[0]!.payload).toEqual({ jobId: 'job-9' });
    push.resolveClash('r1', { choice: 'skip', applyToAll: true });
    expect(await asked).toEqual({ choice: 'skip', applyToAll: true });
  });

  it('resolveClash through the wire settles the question; a malformed answer is ignored', async () => {
    const { ipc, push } = setup();
    const asked = push.clash.ask(3, {
      jobId: 'j',
      requestId: 'r2',
      name: 'a',
      targetDir: ROOT,
      existing: { kind: 'file', newer: false },
      incoming: { kind: 'file', newer: false },
      permanentReplace: false,
    });
    ipc.ons.get('throng:transfer:resolveClash')!(event(3), 'r2', { choice: 'explode' });
    ipc.ons.get('throng:transfer:resolveClash')!(event(3), 'r2', { choice: 'keep-both', applyToAll: false });
    expect(await asked).toEqual({ choice: 'keep-both', applyToAll: false });
  });

  it('a window that is gone answers its open questions with Cancel', async () => {
    const { push } = setup();
    const asked = push.clash.ask(4, {
      jobId: 'j',
      requestId: 'r3',
      name: 'a',
      targetDir: ROOT,
      existing: { kind: 'file', newer: false },
      incoming: { kind: 'file', newer: false },
      permanentReplace: false,
    });
    push.windowGone(4);
    expect(await asked).toEqual({ choice: 'cancel' });
  });

  it('paste with an empty clipboard, or a malformed target, is refused and starts nothing', async () => {
    const { ipc, calls } = setup();
    expect(await ipc.handles.get('throng:transfer:paste')!(event(1), 'dest')).toHaveProperty('error');
    await ipc.handles.get('throng:fileClipboard:set')!(event(1), 'copy', ['a.txt']);
    expect(await ipc.handles.get('throng:transfer:paste')!(event(1), 42)).toHaveProperty('error');
    expect(calls).toEqual([]);
  });

  it('cancel, finishCancel, applyUndo, exists and quitChoice reach the engine; malformed calls do not', async () => {
    const ipc = fakeIpc();
    const calls: unknown[][] = [];
    registerTransferIpc(ipc, {
      clipboard: new FileClipboardService(() => {}),
      transfer: {
        paste: () => ({ jobId: 'j', result: new Promise<TransferResult>(() => {}) }),
        drop: async () => result('j'),
        cancel: (jobId) => void calls.push(['cancel', jobId]),
        finishCancel: (jobId, choice) => void calls.push(['finishCancel', jobId, choice]),
        applyUndo: async (entry, direction, windowId) => {
          calls.push(['applyUndo', entry, direction, windowId]);
          return { ok: true };
        },
        exists: async (paths) => paths.map(() => true),
      },
      push: createTransferPush(() => true),
      activeRoot: () => ROOT,
      activeProjectId: async () => 'B',
      quitChoice: (choice) => void calls.push(['quitChoice', choice]),
    });
    ipc.ons.get('throng:transfer:cancel')!(event(2), 'j1');
    ipc.ons.get('throng:transfer:cancel')!(event(2), 7);
    ipc.ons.get('throng:transfer:finishCancel')!(event(2), 'j1', 'rollback');
    ipc.ons.get('throng:transfer:finishCancel')!(event(2), 'j1', 'shrug');
    const entry = { kind: 'move', items: [], at: 1 };
    expect(await ipc.handles.get('throng:transfer:applyUndo')!(event(2), entry, 'undo')).toEqual({ ok: true });
    expect(await ipc.handles.get('throng:transfer:applyUndo')!(event(2), 'nope', 'undo')).toHaveProperty('error');
    expect(await ipc.handles.get('throng:transfer:exists')!(event(2), ['a', 'b'])).toEqual([true, true]);
    expect(await ipc.handles.get('throng:transfer:exists')!(event(2), 'a')).toEqual([]);
    ipc.ons.get('throng:transfer:quitChoice')!(event(2), 'wait');
    ipc.ons.get('throng:transfer:quitChoice')!(event(2), 'later');
    expect(calls).toEqual([
      ['cancel', 'j1'],
      ['finishCancel', 'j1', 'rollback'],
      ['applyUndo', entry, 'undo', 2],
      ['quitChoice', 'wait'],
    ]);
  });

  it('drop resolves relative sources against the active root and answers the result', async () => {
    const { ipc, calls } = setup();
    expect(await ipc.handles.get('throng:transfer:drop')!(event(5), ['x/a.txt'], 'dest', 'cut')).toEqual(result('job-2'));
    expect(calls[0]).toEqual(['drop', 5, [join(ROOT, 'x', 'a.txt')], join(ROOT, 'dest'), 'cut']);
    expect(await ipc.handles.get('throng:transfer:drop')!(event(5), ['a'], 'dest', 'teleport')).toHaveProperty('error');
    expect(await ipc.handles.get('throng:transfer:drop')!(event(5), [''], 'dest', 'cut')).toHaveProperty('error');
    expect(calls).toHaveLength(1);
  });
});
