/**
 * The `throng:fileClipboard:*` and `throng:transfer:*` wire (050, contracts/transfer-ipc.md §1–§2).
 *
 * Electron is not imported: `ipcMain` and the per-window send are handed in, so the contract test
 * drives the real handlers on fakes. Every handler shape-checks its payload and answers with an
 * envelope — a malformed call is refused and changes nothing, never thrown across the bridge.
 *
 * ══ ROUTING ══
 *
 * A job belongs to the window that started it (`event.sender.id`): its progress, its clash questions,
 * its cancel choice and its result go there and nowhere else. The clipboard is the opposite — one per
 * application, pushed to every window (by `FileClipboardService`'s broadcaster).
 */
import { join } from 'node:path';
import type {
  ClashAnswer,
  ClashQuestion,
  FileClipboard,
  FileOpUndoEntry,
  TransferQuitChoice,
  TransferResult,
} from '@throng/core';
import type { ClipboardSetResult } from './file-clipboard.js';
import type { ClashAsker, TransferEvents, TransferMode } from './transfer-service.js';

export interface TransferIpcEvent {
  sender: { id: number };
}

/** The subset of `ipcMain` this registers on. */
export interface TransferIpcMain {
  handle(channel: string, listener: (event: TransferIpcEvent, ...args: unknown[]) => unknown): void;
  on(channel: string, listener: (event: TransferIpcEvent, ...args: unknown[]) => void): void;
}

export interface TransferIpcClipboard {
  get(): FileClipboard;
  setFromRelative(mode: 'cut' | 'copy', relPaths: readonly string[], activeRoot: string, activeProjectId: string): ClipboardSetResult;
  clear(): void;
}

/**
 * The engine's surface. The optional members are registered only when present, so each lands with
 * the task that implements it.
 */
export interface TransferIpcService {
  paste(windowId: number, targetDir: string, snapshot: NonNullable<FileClipboard>): { jobId: string; result: Promise<TransferResult> };
  drop(windowId: number, sources: readonly string[], targetDir: string, mode: TransferMode): Promise<TransferResult>;
  cancel?(jobId: string): void;
  finishCancel?(jobId: string, choice: 'keep' | 'rollback'): void;
  applyUndo?(entry: FileOpUndoEntry, direction: 'undo' | 'redo', windowId: number): Promise<unknown>;
  exists?(absPaths: readonly string[]): Promise<boolean[]>;
}

export interface TransferIpcDeps {
  clipboard: TransferIpcClipboard;
  transfer: TransferIpcService;
  push: TransferPush;
  activeRoot(): string | null;
  /** The active project's id, from a FRESH project list. */
  activeProjectId(): Promise<string | null>;
  /** The quit gate's answer channel (FR-019f). */
  quitChoice?(choice: TransferQuitChoice): void;
}

const NO_ROOT = { error: 'No active project.' } as const;

export function registerTransferIpc(ipc: TransferIpcMain, deps: TransferIpcDeps): void {
  const { clipboard, transfer } = deps;

  // ── §1 fileClipboard ──
  ipc.handle('throng:fileClipboard:get', () => clipboard.get());
  ipc.handle('throng:fileClipboard:set', async (_event, mode, relPaths) => {
    if (!isMode(mode) || !isStringArray(relPaths)) return { error: 'Invalid clipboard request.' };
    const root = deps.activeRoot();
    const projectId = await deps.activeProjectId();
    if (!root || !projectId) return NO_ROOT;
    return clipboard.setFromRelative(mode, relPaths, root, projectId);
  });
  ipc.on('throng:fileClipboard:clear', () => clipboard.clear());

  // ── §2 transfer ──
  ipc.handle('throng:transfer:paste', (event, targetRelDir) => {
    if (typeof targetRelDir !== 'string') return { error: 'Invalid paste request.' };
    const root = deps.activeRoot();
    if (!root) return NO_ROOT;
    const snapshot = clipboard.get();
    if (snapshot === null) return { error: 'Nothing to paste.' };
    return { jobId: transfer.paste(event.sender.id, absOf(root, targetRelDir), snapshot).jobId };
  });
  ipc.handle('throng:transfer:drop', async (event, srcRelPaths, targetRelDir, mode) => {
    if (!isStringArray(srcRelPaths) || typeof targetRelDir !== 'string' || !isMode(mode)) {
      return { error: 'Invalid drop request.' };
    }
    if (srcRelPaths.length === 0 || srcRelPaths.includes('')) return { error: 'The project root cannot be moved.' };
    const root = deps.activeRoot();
    if (!root) return NO_ROOT;
    return transfer.drop(
      event.sender.id,
      srcRelPaths.map((rel) => absOf(root, rel)),
      absOf(root, targetRelDir),
      mode,
    );
  });
  ipc.on('throng:transfer:resolveClash', (_event, requestId, answer) => {
    if (typeof requestId === 'string' && isClashAnswer(answer)) deps.push.resolveClash(requestId, answer);
  });
  if (transfer.cancel) {
    const cancel = transfer.cancel.bind(transfer);
    ipc.on('throng:transfer:cancel', (_event, jobId) => {
      if (typeof jobId === 'string') cancel(jobId);
    });
  }
  if (transfer.finishCancel) {
    const finish = transfer.finishCancel.bind(transfer);
    ipc.on('throng:transfer:finishCancel', (_event, jobId, choice) => {
      if (typeof jobId === 'string' && (choice === 'keep' || choice === 'rollback')) finish(jobId, choice);
    });
  }
  if (transfer.applyUndo) {
    const apply = transfer.applyUndo.bind(transfer);
    ipc.handle('throng:transfer:applyUndo', async (event, entry, direction) => {
      if (!isObject(entry) || (direction !== 'undo' && direction !== 'redo')) return { error: 'Invalid undo request.' };
      return apply(entry as unknown as FileOpUndoEntry, direction, event.sender.id);
    });
  }
  if (transfer.exists) {
    const exists = transfer.exists.bind(transfer);
    ipc.handle('throng:transfer:exists', async (_event, absPaths) => {
      if (!isStringArray(absPaths)) return [];
      return exists(absPaths);
    });
  }
  if (deps.quitChoice) {
    const quit = deps.quitChoice;
    ipc.on('throng:transfer:quitChoice', (_event, choice) => {
      if (choice === 'wait' || choice === 'keep' || choice === 'rollback' || choice === 'dismiss') quit(choice);
    });
  }
}

/** Sends one payload to one window; false when that window is gone. */
export type SendToWindow = (windowId: number, channel: string, payload: unknown) => boolean;

export interface TransferPush {
  /** The engine's owner-window events. */
  events: TransferEvents;
  /** The engine's clash port: asks the owner window and waits for `resolveClash`. */
  clash: ClashAsker;
  resolveClash(requestId: string, answer: ClashAnswer): void;
  /** A window closed: every question it was asked is answered Cancel (R9). */
  windowGone(windowId: number): void;
}

export function createTransferPush(send: SendToWindow): TransferPush {
  const pending = new Map<string, { windowId: number; resolve: (a: ClashAnswer) => void }>();
  return {
    events: {
      progress: (windowId, progress) => void send(windowId, 'throng:transfer:progress', progress),
      cancelChoice: (windowId, jobId) => send(windowId, 'throng:transfer:cancelChoice', { jobId }),
      done: (windowId, result) => void send(windowId, 'throng:transfer:done', result),
    },
    clash: {
      ask: (windowId: number, question: ClashQuestion) =>
        new Promise<ClashAnswer>((resolve) => {
          pending.set(question.requestId, { windowId, resolve });
          // Nobody left to answer: the conservative choice, which loses nothing (R9).
          if (!send(windowId, 'throng:transfer:clash', question)) {
            pending.delete(question.requestId);
            resolve({ choice: 'cancel' });
          }
        }),
    },
    resolveClash: (requestId, answer) => {
      const waiting = pending.get(requestId);
      if (!waiting) return;
      pending.delete(requestId);
      waiting.resolve(answer);
    },
    windowGone: (windowId) => {
      for (const [requestId, waiting] of [...pending]) {
        if (waiting.windowId !== windowId) continue;
        pending.delete(requestId);
        waiting.resolve({ choice: 'cancel' });
      }
    },
  };
}

function absOf(root: string, rel: string): string {
  return rel ? join(root, rel) : root;
}

function isMode(v: unknown): v is 'cut' | 'copy' {
  return v === 'cut' || v === 'copy';
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isClashAnswer(v: unknown): v is ClashAnswer {
  if (!isObject(v)) return false;
  if (v.choice === 'cancel') return true;
  return (v.choice === 'replace' || v.choice === 'skip' || v.choice === 'keep-both') && typeof v.applyToAll === 'boolean';
}
