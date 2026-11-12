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
  decidePasteSource,
  dropDeleted,
  followMoves,
  isWithinRoot,
  logCaught,
  retainProjects,
  type ClipboardItem,
  type FileClipboard,
  type FileListSnapshot,
  type IClipboard,
} from '@throng/core';
import type { MovePair } from './files-service.js';

export type ClipboardSetResult = { ok: true } | { error: string };

/** What a Paste should act on (067 research D3). */
export type PasteOrigin =
  | { kind: 'internal'; snapshot: NonNullable<FileClipboard> }
  | { kind: 'os'; list: FileListSnapshot }
  | { kind: 'none' };

export class FileClipboardService {
  private value: FileClipboard = null;

  /** `broadcast` pushes `throng:fileClipboard:changed` to EVERY window (FR-002). */
  /** The list last placed on the OS for {@link value}, or null. */
  private placed: FileListSnapshot | null = null;
  /** Clipboard writes run in order, and a Paste waits for them. */
  private osWork: Promise<void> = Promise.resolve();

  /**
   * `os` is the real clipboard, so a cut or copy reaches other applications (067 FR-003). Absent: the clipboard
   * stays private to throng, as a unit test of the pure transitions wants.
   */
  constructor(
    private readonly broadcast: (clipboard: FileClipboard) => void,
    private readonly os?: Pick<IClipboard, 'writeFileList' | 'readFileList' | 'writeText'>,
  ) {}

  /** Whether a Paste has anything to act on, the OS clipboard included. */
  async hasPasteable(): Promise<boolean> {
    return (await this.pasteOrigin()).kind !== 'none';
  }

  /**
   * What a Paste acts on now. The OS clipboard is the authority (FR-006): an internal record it no longer backs
   * is emptied here, so a cut replaced by another application can never run.
   */
  async pasteOrigin(): Promise<PasteOrigin> {
    await this.osWork;
    const osList = this.os ? await this.os.readFileList() : null;
    const source = decidePasteSource(this.value !== null, this.placed, osList);
    if (source === 'internal' && this.value !== null) return { kind: 'internal', snapshot: this.value };
    if (source === 'os' && osList !== null) {
      // Another application's list replaced ours, so nothing of ours is left to clear from the OS.
      this.placed = null;
      this.replace(null);
      return { kind: 'os', list: osList };
    }
    if (source === 'stale') {
      this.placed = null;
      this.replace(null);
    }
    return { kind: 'none' };
  }

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
    this.placeOnOs({ paths: items.map((it) => it.absPath), intent: mode });
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
    if (next === null) this.takeBackFromOs();
    this.broadcast(next);
  }

  private placeOnOs(list: FileListSnapshot): void {
    const os = this.os;
    if (!os) return;
    this.placed = null;
    this.osWork = this.osWork.then(async () => {
      try {
        await os.writeFileList(list);
        this.placed = list;
      } catch (error) {
        logCaught('file-clipboard: place a file list on the OS clipboard', error);
      }
    });
  }

  /**
   * An emptied internal clipboard takes its list off the OS too, but only if that list is still ours. Left there, a
   * cancelled cut would still paste, as a move, through the OS route.
   */
  private takeBackFromOs(): void {
    const os = this.os;
    const placed = this.placed;
    this.placed = null;
    if (!os || placed === null) return;
    this.osWork = this.osWork.then(async () => {
      try {
        const current = await os.readFileList();
        if (decidePasteSource(true, placed, current) === 'internal') await os.writeText('');
      } catch (error) {
        logCaught('file-clipboard: take a file list back off the OS clipboard', error);
      }
    });
  }
}

function sameFolder(a: string, b: string): boolean {
  return isWithinRoot(a, b) && isWithinRoot(b, a);
}
