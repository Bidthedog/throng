/**
 * FileClipboardService — the application's ONE File Explorer clipboard (050, research R1).
 *
 * ══ WHY IT LIVES IN MAIN ══
 *
 * It was React state inside one explorer, holding ROOT-RELATIVE paths: per explorer instance, and
 * meaningless the moment the tree showed another root — exactly what FR-001/FR-002 forbid. Main is
 * the one place that outlives every window and every project switch, and it is also where moves,
 * renames and deletes happen, so it can follow them exactly (FR-009) rather than guess from a watch.
 *
 * Memory only (FR-007): nothing here is written anywhere, so a restart starts empty. Separate from
 * the OS clipboard (FR-008): this holds paths the explorer will paste, not text the user copied.
 *
 * Every transition is a pure rule in core (`file-clipboard-rules.ts`); this class holds the one value
 * and pushes it to every window when — and only when — it actually changed.
 */
import { join, normalize } from 'node:path';
import {
  afterRun,
  dropDeleted,
  followMoves,
  isWithinRoot,
  retainProjects,
  type ClipboardItem,
  type FileClipboard,
} from '@throng/core';
import type { MovePair } from './files-service.js';

export type ClipboardSetResult = { ok: true } | { error: string };

export class FileClipboardService {
  private value: FileClipboard = null;

  /** `broadcast` pushes `throng:fileClipboard:changed` to EVERY window (FR-002). */
  constructor(private readonly broadcast: (clipboard: FileClipboard) => void) {}

  get(): FileClipboard {
    return this.value;
  }

  /**
   * Cut or copy root-relative paths of the ACTIVE project (contracts/transfer-ipc §1).
   *
   * Relative, resolved here against the root main holds, so the renderer cannot name a path outside
   * the project it is showing. The root row (`''`) is refused (004 FR-023), as is any path that
   * escapes the root lexically; the clipboard is left as it was.
   */
  setFromRelative(
    mode: 'cut' | 'copy',
    relPaths: readonly string[],
    activeRoot: string,
    activeProjectId: string,
  ): ClipboardSetResult {
    if (relPaths.length === 0) return { error: 'Nothing is selected.' };
    const items: ClipboardItem[] = [];
    for (const rel of relPaths) {
      if (rel === '') return { error: 'The project root cannot be cut or copied.' };
      const absPath = join(activeRoot, rel);
      if (!isWithinRoot(activeRoot, absPath) || sameFolder(activeRoot, absPath)) {
        return { error: 'Target is outside the project root.' };
      }
      items.push({ absPath, projectId: activeProjectId, projectRoot: activeRoot });
    }
    this.replace({ mode, items });
    return { ok: true };
  }

  /** Empty it (Escape in any explorer, FR-005). */
  clear(): void {
    this.replace(null);
  }

  /** An in-app move or rename: pending items follow by prefix (FR-009, 019 FR-005). */
  followMoves(moves: readonly MovePair[]): void {
    if (this.value === null) return;
    const items = followMoves(this.value.items, moves);
    if (items === this.value.items) return;
    // The core rule joins the remainder with `/`; the clipboard holds OS-spelled paths (FR-001).
    this.replace({ mode: this.value.mode, items: items.map((it) => ({ ...it, absPath: normalize(it.absPath) })) });
  }

  /** An in-app delete: items equal to or under a deleted path leave (FR-009). */
  dropDeleted(absPaths: readonly string[]): void {
    if (this.value === null) return;
    const items = dropDeleted(this.value.items, absPaths);
    if (items === this.value.items) return;
    this.replace(items.length === 0 ? null : { mode: this.value.mode, items });
  }

  /** After every projects refresh: the items' project removed or re-rooted empties it (FR-011). */
  retainProjects(idToRoot: ReadonlyMap<string, string>): void {
    this.replace(retainProjects(this.value, idToRoot));
  }

  /** What a finished or cancelled paste leaves behind (FR-006, FR-019c; data-model transitions). */
  afterRun(snapshot: FileClipboard, notMoved: readonly ClipboardItem[]): void {
    this.replace(afterRun(this.value, snapshot, notMoved));
  }

  /** Store and push — but only a value that differs from the one held. */
  private replace(next: FileClipboard): void {
    if (next === this.value) return;
    if (next === null && this.value === null) return;
    this.value = next;
    this.broadcast(next);
  }
}

function sameFolder(a: string, b: string): boolean {
  return isWithinRoot(a, b) && isWithinRoot(b, a);
}
