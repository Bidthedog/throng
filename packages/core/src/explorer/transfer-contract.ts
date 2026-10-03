/**
 * The payloads that cross the `throng:transfer:*` bridge (050, contracts/transfer-ipc.md §2).
 *
 * Types only, and in core so the main process that sends them and the renderer that reads them share ONE
 * declaration — two copies of a message shape drift in exactly the direction nobody tests.
 */
import type { FailureCause } from '../failure/cause.js';
import type { FileOpUndoEntry } from '../fileop-undo/undo-stack.js';
import type { ClashChoice } from './transfer-plan.js';

/** One side of a clash, as the prompt shows it (FR-018). */
export interface ClashSide {
  kind: 'file' | 'folder';
  /** Bytes, for a file. */
  size?: number;
  /** Epoch ms, for a file. */
  modifiedMs?: number;
  /** Immediate entries, for a folder. */
  itemCount?: number;
  /** This side is the newer one (`newerOf`); never both. */
  newer: boolean;
}

/** main → the window that started the job: an item's name is taken (FR-017). */
export interface ClashQuestion {
  jobId: string;
  requestId: string;
  /** The clashing leaf name. */
  name: string;
  /** The folder it would land in, absolute, for display. */
  targetDir: string;
  existing: ClashSide;
  incoming: ClashSide;
  /** `explorer.replaceMode` is `permanent`: Replace must say it cannot be undone (FR-018f). */
  permanentReplace: boolean;
}

/** The window's answer. Cancel ends the run and goes on to the keep-or-roll-back choice (FR-019a). */
export type ClashAnswer = { choice: ClashChoice; applyToAll: boolean } | { choice: 'cancel' };

export type TransferJobState = 'queued' | 'running' | 'awaiting-cancel-choice' | 'rolling-back' | 'done';

/** main → owner window, on every state change and after every top-level item (FR-019, FR-019d). */
export interface TransferProgress {
  jobId: string;
  kind: 'paste' | 'drag';
  state: TransferJobState;
  /** Top-level items finished. */
  done: number;
  /** Top-level items in the job. */
  total: number;
  /** The item in progress, absolute, or null between items. */
  current: string | null;
  /** How many jobs are ahead of this one (0 once it runs). */
  queuedBehind: number;
  /** The folder being pasted into, absolute. */
  targetDir: string;
}

/** One item that did not land (FR-013, FR-015). */
export interface TransferFailure {
  /** The item's leaf name. */
  name: string;
  /** Its containing folder's leaf, where the name alone would be ambiguous. */
  dir?: string;
  /** The sentence the user reads. */
  message: string;
  cause?: FailureCause;
}

/** main → owner window, once, when a job ends (contracts/transfer-ipc.md §2). */
export interface TransferResult {
  jobId: string;
  kind: 'paste' | 'drag';
  outcome: 'completed' | 'kept' | 'rolled-back';
  /** Absolute paths the job left in the target (FR-025b). */
  placed: string[];
  /** Built from the run's journal; null for a copy that replaced nothing and after a roll back. */
  undo: FileOpUndoEntry | null;
  failures: TransferFailure[];
  rollbackFailures: TransferFailure[];
  sourceProjectId: string;
  targetProjectId: string;
}

/** The renderer's answer to `throng:transfer:quitPrompt` (FR-019f). */
export type TransferQuitChoice = 'wait' | 'keep' | 'rollback' | 'dismiss';
