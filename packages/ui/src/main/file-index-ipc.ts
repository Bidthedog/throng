/**
 * file-index-ipc — wires the `fileIndex.*` preload bridge to the {@link ProjectFileIndexService}
 * (033 T017, contracts/file-index.md §3, I1–I4).
 *
 * Three channels and no more: `subscribe` (invoke), `unsubscribe` (send) and the per-window
 * `update` push. They are NEW rather than additions to `files.*` (I4) because
 * `throng:files:setRoot` sets one process-wide root, while this index is keyed BY root — sharing
 * that surface would let one window's project decide another window's candidate set.
 *
 * The registration shape mirrors `files-ipc.ts`: the renderer is sandboxed, every payload is
 * treated as input, and the service is handed nothing it did not ask for. The one rule this file
 * adds is I1 — an update reaches the SUBSCRIBING `webContents` and nothing else, so two windows on
 * two different roots never see each other's sets (FR-017). There is deliberately no broadcast
 * here.
 */
import { ipcMain, webContents } from 'electron';
import type { FileIndexUpdate, ProjectFileIndexService } from './project-file-index.js';

const asRoot = (value: unknown): string => {
  if (typeof value === 'string') return value;
  const root = (value as { root?: unknown } | null)?.root;
  return typeof root === 'string' ? root : '';
};

/**
 * Which of the root's two indices the payload names (033 FR-069, plan D2).
 *
 * Anything that is not literally `true` is `false`, which is the SAFE default in both directions:
 * the shipped setting excludes hidden files, and a malformed payload that silently opted into the
 * unexcluded index would offer a project's `node_modules` to a user who never asked for it.
 */
const asIncludeHidden = (value: unknown): boolean =>
  (value as { includeHidden?: unknown } | null)?.includeHidden === true;

/**
 * Deliver one update to one window (I1).
 *
 * Exported so the composition root can hand it to the service as its `push` without either of them
 * knowing about the other — the service never touches Electron, and this never walks a directory.
 */
export function pushFileIndexUpdate(webContentsId: number, payload: FileIndexUpdate): void {
  const target = webContents.fromId(webContentsId);
  // A window can be gone between a change landing and the push reaching it; that is ordinary, and
  // the service drops the subscription when the `destroyed` handler in `main.ts` fires (S9).
  if (!target || target.isDestroyed()) return;
  target.send('throng:fileIndex:update', payload);
}

export function registerFileIndexIpc(service: ProjectFileIndexService): void {
  /*
   * The subscribing window is `event.sender`, never anything the renderer said.
   *
   * A webContents id taken from the payload would let one window subscribe another to a root it
   * cannot see — and the push would then be perfectly well targeted at the wrong window.
   */
  ipcMain.handle('throng:fileIndex:subscribe', (event, payload: unknown) => {
    const root = asRoot(payload);
    if (root.length === 0) return { status: 'building' as const };
    return service.subscribe(event.sender.id, root, asIncludeHidden(payload));
  });

  ipcMain.on('throng:fileIndex:unsubscribe', (event, payload: unknown) => {
    const root = asRoot(payload);
    // No root means "this window is leaving everything" — the shape a teardown needs (S9). With a
    // root, the flag is part of what is being left: a window holding both of a root's indices must
    // be able to give up one and keep the other (FR-069).
    service.unsubscribe(
      event.sender.id,
      root.length === 0 ? undefined : root,
      asIncludeHidden(payload),
    );
  });
}
