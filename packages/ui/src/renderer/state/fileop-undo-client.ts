import {
  FILEOP_UNDO_GET_METHOD,
  FILEOP_UNDO_SET_METHOD,
  type FileOpUndoGetResult,
} from '@throng/ipc-contract';
import { emptyStack, type FileOpUndoStack } from '@throng/core';
import type { ThrongBridge } from './bridge.js';

/**
 * The per-project file-operation undo/redo stack, over the daemon (024 US3, #85).
 *
 * The stack is stored as one opaque JSON blob and always read/written whole, because the pure
 * engine owns its shape and its 50-entry bound. Parsing is TOLERANT by design (FR-010a): a blob
 * written by an older build, or a corrupt one, resolves to an empty stack rather than throwing —
 * losing the history is a disappointment, but failing to open the project over it would be a bug.
 */
export class FileOpUndoClient {
  constructor(private readonly bridge: ThrongBridge) {}

  async load(projectId: string): Promise<FileOpUndoStack> {
    try {
      const result = await this.bridge.invoke<FileOpUndoGetResult>(FILEOP_UNDO_GET_METHOD, {
        projectId,
      });
      return parseStack(result.stackJson);
    } catch {
      return emptyStack(); // no history is never a reason to fail opening a project
    }
  }

  async save(projectId: string, stack: FileOpUndoStack): Promise<void> {
    try {
      await this.bridge.invoke(FILEOP_UNDO_SET_METHOD, {
        projectId,
        stackJson: JSON.stringify(stack),
      });
    } catch {
      /* history that could not be persisted still works for this session */
    }
  }
}

/** Tolerant parse: anything that is not a well-formed stack becomes an empty one (FR-010a). */
export function parseStack(json: string | null): FileOpUndoStack {
  if (!json) return emptyStack();
  try {
    const raw = JSON.parse(json) as Partial<FileOpUndoStack>;
    return {
      undo: Array.isArray(raw.undo) ? raw.undo : [],
      redo: Array.isArray(raw.redo) ? raw.redo : [],
    };
  } catch {
    return emptyStack();
  }
}
